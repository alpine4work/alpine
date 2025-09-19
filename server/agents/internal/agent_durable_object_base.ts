import {addDays, subDays} from "date-fns";
import {ApiClient, createApiClient} from "~/server/agents/internal/api_client.js";
import {OpenAiClient} from "~/server/agents/internal/open_ai_client.js";
import {
    ApiMessageRoomPathObject,
    parseApiMessageRoomPath,
} from "~/server/api/specification/parse_api_path.js";
import {
    ApiBotWebhookEvent,
    ApiBotWebhookRequestBody,
} from "~/server/api/specification/types/api_specification_convenience_types.js";
import {createSimpleErrorResponse} from "~/server/helpers/create_simple_error_response.js";
import {createServerTracer} from "~/server/tracer/server_tracer.js";
import {traceServerResponse} from "~/server/tracer/trace_server_response.js";
import {Context} from "~/shared/context/context.js";
import {ProcessContextModule} from "~/shared/context/process_context_module.js";
import {TracerContextModule} from "~/shared/context/tracer_context_module.js";
import {MutexValue} from "~/shared/helpers/async/mutex_value.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {Lazy} from "~/shared/helpers/control/lazy.js";
import {AccountId, SpaceId} from "~/shared/id/types/id_types.js";
import {TracerBase} from "~/shared/tracer/tracer_base.js";
import {TracerRoot, TracerServiceName} from "~/shared/tracer/tracer_root.js";

export type AgentDurableObjectEnv = {
    API_SERVICE_URL: string;
    CHAT_GPT_API_SERVICE_KEY: string;
    OPEN_AI_API_KEY?: string;
    HONEYCOMB_API_KEY?: string;
};

export type AgentContext = Context<AgentContextModules>;

export type AgentContextModules = {
    process: ProcessContextModule;
    tracer: TracerContextModule;
};

export type AgentWebhookRequest = {
    readonly storage: DurableObjectStorage;
    readonly apiClient: ApiClient;
    readonly openAiClient: Lazy<OpenAiClient>;
    readonly spaceId: SpaceId;
    readonly accountId: AccountId;
    readonly event: ApiBotWebhookEvent;
    readonly room: ApiMessageRoomPathObject;
};

/**
 * Delete the agent's storage after thirty days of inactivity (about a month).
 */
export const agentDeleteAllStorageAlarmDays = 30;

/**
 * Reset the agent's alarm every day there's some activity.
 */
export function shouldResetAgentDeleteAllStorageAlarm({
    currentTime,
    alarmTime,
}: {
    currentTime: Date;
    alarmTime: Date;
}) {
    return currentTime > subDays(alarmTime, agentDeleteAllStorageAlarmDays - 1);
}

/**
 * Base class for agent Cloudflare Durable Objects. Sets up some basic
 * infrastructure like the tracer and process context module.
 */
export abstract class AgentDurableObjectBase<Route> {
    private readonly _state: DurableObjectState;
    private readonly _env: AgentDurableObjectEnv;
    private readonly _tracer: TracerRoot;
    private readonly _processContext: AgentContext;
    private readonly _openAiClient: Lazy<OpenAiClient>;

    private readonly _alarmTimeMutex: MutexValue<Date | null> = new MutexValue(null);

    constructor(
        serviceName: TracerServiceName,
        state: DurableObjectState,
        env: AgentDurableObjectEnv,
    ) {
        this._state = state;
        this._env = env;

        this._tracer = createServerTracer({
            serviceName,
            jsHost: "CloudflareWorker",
            honeycombApiKey: env.HONEYCOMB_API_KEY,
            waitUntil: promise => state.waitUntil(promise),
        });

        this._processContext = Context.new({
            process: new ProcessContextModule({
                waitUntil: promise =>
                    this._state.waitUntil(
                        promise.catch(error => {
                            this._tracer.logException(
                                "Uncaught exception from `waitUntil()`",
                                error,
                            );
                        }),
                    ),
            }),
            tracer: new TracerContextModule(this._tracer),
        });

        this._openAiClient = new Lazy(() => {
            return new OpenAiClient({
                apiKey: assertExists(
                    this._env.OPEN_AI_API_KEY,
                    "Missing `OPEN_AI_API_KEY` environment variable",
                ),
            });
        });
    }

    /**
     * Parse the route from a URL. We include the route in the tracer span for this
     * request which helps since we can search our logs for all requests to a
     * certain route.
     */
    protected abstract _parseRoute(url: URL): [string, Route | "Webhook"];

    /**
     * Execute an HTTP request against the Durable Object.
     */
    protected abstract _fetch(
        context: AgentContext,
        request: Request,
        route: Route,
    ): Promise<Response>;

    /**
     * Handle an HTTP webhook call from Alpine.
     */
    protected abstract _webhook(tracer: TracerBase, request: AgentWebhookRequest): Promise<void>;

    public async fetch(request: Request): Promise<Response> {
        // When the Durable Object's alarm is triggered, we delete all storage
        // associated with the Durable Object.
        await this._maybeResetAlarm();

        const url = new URL(request.url);

        const [route, routeObject] = this._parseRoute(url);

        return traceServerResponse(this._tracer, request, url, route, async (span, request) => {
            try {
                const response = await this._processContext.with<{}, Response>(
                    {
                        // Replace the tracer context module with one that uses our span for
                        // this request.
                        tracer: new TracerContextModule(span),
                    },
                    actionContext => {
                        if (routeObject === "Webhook") {
                            return this._fetchWebhook(actionContext, request);
                        } else {
                            return this._fetch(actionContext, request, routeObject);
                        }
                    },
                );
                return response;
            } catch (error) {
                span.addException(error);
                return createSimpleErrorResponse(error);
            }
        });
    }

    private async _fetchWebhook(context: AgentContext, request: Request): Promise<Response> {
        if (request.method !== "POST") {
            return new Response("405 Method Not Allowed", {
                status: 405,
                headers: {"content-type": "text/plain"},
            });
        }

        const {accessToken, spaceId, accountId, event}: ApiBotWebhookRequestBody =
            await request.json();

        // We immediately return 200 to Alpine so the request isn't retried and we
        // process the webhook in the background. This is also important since
        // long-running webhooks will cause the request to timeout and Alpine to send
        // a retry.
        context.process.waitUntil(
            context.tracer.getTracer().withSpan("Process agent webhook", async span => {
                try {
                    const context: AgentWebhookRequest = {
                        storage: this._state.storage,
                        spaceId,
                        accountId,
                        event,
                        room: parseApiMessageRoomPath(event.roomPath),
                        apiClient: createApiClient({
                            baseUrl: assertExists(
                                this._env.API_SERVICE_URL,
                                "Missing `API_SERVICE_URL` environment variable",
                            ),
                            apiKey: assertExists(
                                this._env.CHAT_GPT_API_SERVICE_KEY,
                                "Missing `CHAT_GPT_API_SERVICE_KEY` environment variable",
                            ),
                            accessToken,
                        }),
                        openAiClient: this._openAiClient,
                    };

                    await this._webhook(span, context);
                } catch (error) {
                    // Log errors in development since webhook errors aren't shown to the user in
                    // the UI. So we need to show webhook errors in our logs.
                    if (process.env.NODE_ENV !== "production") {
                        // eslint-disable-next-line no-console
                        console.error("Agent webhook failed:", error);
                    }

                    span.addException(error);
                }
            }),
        );

        return new Response(null, {status: 200});
    }

    /**
     * Alarm has run! Delete all storage associated with the Durable Object.
     */
    public async alarm() {
        await this._state.storage.deleteAll();
    }

    /**
     * We maintain an alarm that'll run a month from now that deletes all storage
     * associated with the Durable Object. This function checks if the alarm will
     * run soon and if so resets the alarm to a point later in the future.
     */
    private async _maybeResetAlarm() {
        const currentTime = new Date();

        await this._alarmTimeMutex.withLock(async alarmTimeRef => {
            // If no alarm time is set, read the alarm time from storage. If there's no
            // alarm time in storage then set an alarm to cleanup the durable object.
            if (alarmTimeRef.current === null) {
                const alarmTimeFromStorage = await this._state.storage.getAlarm();

                if (alarmTimeFromStorage !== null) {
                    alarmTimeRef.current = new Date(alarmTimeFromStorage);
                } else {
                    alarmTimeRef.current = addDays(currentTime, agentDeleteAllStorageAlarmDays);
                    await this._state.storage.setAlarm(alarmTimeRef.current);
                }
            }

            if (
                shouldResetAgentDeleteAllStorageAlarm({
                    currentTime,
                    alarmTime: alarmTimeRef.current,
                })
            ) {
                alarmTimeRef.current = addDays(currentTime, agentDeleteAllStorageAlarmDays);
                await this._state.storage.setAlarm(alarmTimeRef.current);
            }
        });
    }
}
