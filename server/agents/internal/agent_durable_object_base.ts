import {addHours, subHours} from "date-fns";
import {ApiClient, createApiClient} from "~/server/agents/api/api_client.js";
import {AgentServiceEnv} from "~/server/agents/internal/agent_service_env.js";
import {OpenAiClient} from "~/server/agents/internal/open_ai_client.js";
import {createSimpleErrorResponse} from "~/server/helpers/create_simple_error_response.js";
import {createServerTracer} from "~/server/tracer/server_tracer.js";
import {traceServerResponse} from "~/server/tracer/trace_server_response.js";
import {ApiMessageRoomPathObject, parseApiMessageRoomPath} from "~/shared/api/parse_api_path.js";
import {
    ApiBotWebhookEvent,
    ApiBotWebhookRequestBody,
} from "~/shared/api/types/api_specification_convenience_types.js";
import {Context} from "~/shared/context/context.js";
import {ProcessContextModule} from "~/shared/context/process_context_module.js";
import {TracerContextModule} from "~/shared/context/tracer_context_module.js";
import {UnknownError} from "~/shared/error/error.js";
import {createInterval} from "~/shared/helpers/async/interval.js";
import {MutexValue} from "~/shared/helpers/async/mutex_value.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {Lazy} from "~/shared/helpers/control/lazy.js";
import {AccountId, SpaceId} from "~/shared/id/types/id_types.js";
import {fetchWithTracer} from "~/shared/tracer/fetch_with_tracer.js";
import {TracerBase} from "~/shared/tracer/tracer_base.js";
import {TracerRoot, TracerServiceName} from "~/shared/tracer/tracer_root.js";
import {TracerSpan} from "~/shared/tracer/tracer_span.js";

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

export type ConversationStateRequest = {
    readonly storage: DurableObjectStorage;
};

/**
 * Delete the agent's storage after 6 hours of inactivity. So the agent resets
 * overnight.
 */
export const agentDeleteAllStorageAlarmHours = 6;

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
    return currentTime > subHours(alarmTime, agentDeleteAllStorageAlarmHours - 1);
}

/**
 * Base class for agent Cloudflare Durable Objects. Sets up some basic
 * infrastructure like the tracer and process context module.
 */
export abstract class AgentDurableObjectBase<Route> {
    private readonly _state: DurableObjectState;
    protected readonly _env: AgentServiceEnv;
    private readonly _tracer: Lazy<TracerRoot>;
    private readonly _processContext: Lazy<AgentContext>;
    private readonly _openAiClient: Lazy<OpenAiClient>;

    private readonly _alarmTimeMutex: MutexValue<Date | null> = new MutexValue(null);

    constructor(serviceName: TracerServiceName, state: DurableObjectState, env: AgentServiceEnv) {
        this._state = state;
        this._env = env;

        this._tracer = new Lazy(() =>
            createServerTracer({
                serviceName,
                jsHost: "CloudflareWorker",
                honeycombApiKey: env.HONEYCOMB_API_KEY,
                waitUntil: promise => state.waitUntil(promise),
            }),
        );

        this._processContext = new Lazy(() =>
            Context.new({
                process: new ProcessContextModule({
                    waitUntil: promise =>
                        this._state.waitUntil(
                            promise.catch(error => {
                                this._tracer
                                    .get()
                                    .logException("Uncaught exception from `waitUntil()`", error);
                            }),
                        ),
                }),
                tracer: new TracerContextModule(this._tracer.get()),
            }),
        );

        this._openAiClient = new Lazy(() => {
            return new OpenAiClient({
                apiKey: assertExists(
                    this._env.OPEN_AI_API_KEY,
                    "Missing `OPEN_AI_API_KEY` environment variable",
                ),
            });
        });
    }

    public getStorage(): DurableObjectStorage {
        return this._state.storage;
    }

    /**
     * Parse the route from a URL. We include the route in the tracer span for this
     * request which helps since we can search our logs for all requests to a
     * certain route.
     */
    protected abstract _parseRoute(url: URL): [string, Route];

    /**
     * Execute an HTTP request against the Durable Object.
     */
    protected abstract _fetch(
        context: AgentContext,
        request: Request,
        route: Route,
        span: TracerSpan,
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

        let route: string;
        let routeObject: Route | "Webhook" | "KeepAlive";

        switch (url.pathname) {
            case "/webhook": {
                route = "/webhook";
                routeObject = "Webhook";
                break;
            }
            case "/keep-alive": {
                route = "/keep-alive";
                routeObject = "KeepAlive";
                break;
            }
            default: {
                [route, routeObject] = this._parseRoute(url);
                break;
            }
        }

        return traceServerResponse(
            this._tracer.get(),
            request,
            url,
            route,
            async (span, request) => {
                try {
                    const response = await this._processContext.get().with<{}, Response>(
                        {
                            // Replace the tracer context module with one that uses our span for
                            // this request.
                            tracer: new TracerContextModule(span),
                        },
                        async actionContext => {
                            switch (routeObject) {
                                case "Webhook": {
                                    return this._fetchWebhook(actionContext, request, url);
                                }
                                case "KeepAlive": {
                                    return new Response("200 OK", {
                                        status: 200,
                                        headers: {"content-type": "text/plain"},
                                    });
                                }
                                default: {
                                    return this._fetch(actionContext, request, routeObject, span);
                                }
                            }
                        },
                    );
                    return response;
                } catch (error) {
                    span.addException(error);
                    return createSimpleErrorResponse(error);
                }
            },
        );
    }

    private async _fetchWebhook(
        context: AgentContext,
        request: Request,
        url: URL,
    ): Promise<Response> {
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
        void context.tracer.getTracer().withSpan("Process agent webhook", async span => {
            // HACK(calebmer, 2025-12-09): We were running into an issue where our Durable
            // Object would die with the error message "IoContext timed out due to
            // inactivity, waitUntil tasks were cancelled without completing" after ~90
            // seconds of work. I reached out to an old coworker ([@sunilpai][1]) who's
            // working at Cloudflare on Durable Objects who suspected this may be a bug in
            // Durable Objects. After some investigation he provided this response:
            //
            // > ok I have a workaround for you, tldr -
            // >
            // > - there's a 70-140 second timeout for a DO's own loop
            // > - immediate workaround for your problem: you can restart this timer by
            // >   sending the DO a request again, even from itself
            // > - be careful you terminate this self calling request or you'll get a
            // >   proper big bill haha
            // > - long term solution: an alarm also resets the timer, so you should plan
            // >   on refactoring your timeouts/intervals to alarms
            // >
            // > happy to walk through details with you tomorrow if you'd like, and even
            // > look at code, but that's the basic plan (edited)
            // >
            // > alarms last for a max of 15 mins which is why it's a good idea
            // >
            // > and you can run timeouts/intervals inside it of course
            //
            // Hence this keep alive interval. By sending the Durable Object a request
            // every 30 seconds (even from within itself!) while we're generating the LLM
            // response we continually extend the Durable Object's lifespan until all
            // webhook activity has completed.
            //
            // [1]: https://x.com/threepointone
            const keepAliveInterval = createInterval(() => {
                const agentServiceBasePath = url.pathname.slice(1).split("/", 2)[0]!;

                void fetchWithTracer(
                    span,
                    new URL(
                        `/${agentServiceBasePath}/keep-alive?id=${this._state.id.toString()}`,
                        request.url,
                    ),
                    {
                        serviceName: "AgentService",
                        route: `/${agentServiceBasePath}/keep-alive`,
                    },
                    async response => {
                        if (!response.ok) {
                            throw new UnknownError(
                                `Keep alive request failed with status ${response.status}`,
                            );
                        }

                        // Drain the response body...
                        await response.text();
                    },
                );
            }, 30_000);

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
            } finally {
                keepAliveInterval.clear();
            }
        });

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
                    alarmTimeRef.current = addHours(currentTime, agentDeleteAllStorageAlarmHours);
                    await this._state.storage.setAlarm(alarmTimeRef.current);
                }
            }

            if (
                shouldResetAgentDeleteAllStorageAlarm({
                    currentTime,
                    alarmTime: alarmTimeRef.current,
                })
            ) {
                alarmTimeRef.current = addHours(currentTime, agentDeleteAllStorageAlarmHours);
                await this._state.storage.setAlarm(alarmTimeRef.current);
            }
        });
    }
}
