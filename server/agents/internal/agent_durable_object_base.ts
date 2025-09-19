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
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {Lazy} from "~/shared/helpers/control/lazy.js";
import {AccountId, SpaceId} from "~/shared/id/types/id_types.js";
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
 * Base class for agent Cloudflare Durable Objects. Sets up some basic
 * infrastructure like the tracer and process context module.
 */
export abstract class AgentDurableObjectBase<Route> {
    protected readonly _state: DurableObjectState;
    protected readonly _tracer: TracerRoot;
    protected readonly _processContext: AgentContext;
    private readonly _env: AgentDurableObjectEnv;

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
    protected abstract _webhook(request: AgentWebhookRequest): Promise<void>;

    public fetch(request: Request): Promise<Response> {
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
                        apiClient: createApiClient(span, {
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
                        openAiClient: new Lazy(() => {
                            return new OpenAiClient(span, {
                                apiKey: assertExists(
                                    this._env.OPEN_AI_API_KEY,
                                    "Missing `OPEN_AI_API_KEY` environment variable",
                                ),
                            });
                        }),
                    };

                    await this._webhook(context);
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
}
