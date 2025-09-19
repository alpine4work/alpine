import createOpenapiClient, {Client as OpenapiClient} from "openapi-fetch";
import {
    ApiBotWebhookEvent,
    ApiBotWebhookRequestBody,
    ApiErrorResponseBody,
} from "~/server/api/specification/types/api_specification_convenience_types.js";
import {ApiSpecification} from "~/server/api/specification/types/api_specification_types.js";
import {createSimpleErrorResponse} from "~/server/helpers/create_simple_error_response.js";
import {createServerTracer} from "~/server/tracer/server_tracer.js";
import {traceServerResponse} from "~/server/tracer/trace_server_response.js";
import {Context} from "~/shared/context/context.js";
import {ProcessContextModule} from "~/shared/context/process_context_module.js";
import {TracerContextModule} from "~/shared/context/tracer_context_module.js";
import {InternalError} from "~/shared/error/error.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {DefaultMap} from "~/shared/helpers/map/default_map.js";
import {isIdentifier} from "~/shared/helpers/string/is_identifier.js";
import {SpaceId} from "~/shared/id/types/id_types.js";
import {fetchWithTracer} from "~/shared/tracer/fetch_with_tracer.js";
import {TracerBase} from "~/shared/tracer/tracer_base.js";
import {TracerRoot, TracerServiceName} from "~/shared/tracer/tracer_root.js";

export type ApiClient = OpenapiClient<ApiSpecification.paths>;

export type AgentDurableObjectEnv = {
    API_SERVICE_URL: string;
    CHAT_GPT_API_SERVICE_KEY: string;
    HONEYCOMB_API_KEY?: string;
};

export type AgentContext = Context<AgentContextModules>;

export type AgentContextModules = {
    process: ProcessContextModule;
    tracer: TracerContextModule;
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
    protected abstract _webhook(
        apiClient: ApiClient,
        requestBody: {spaceId: SpaceId; event: ApiBotWebhookEvent},
    ): Promise<void>;

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

        const {accessToken, spaceId, event}: ApiBotWebhookRequestBody = await request.json();

        // We immediately return 200 to Alpine so the request isn't retried and we
        // process the webhook in the background. This is also important since
        // long-running webhooks will cause the request to timeout and Alpine to send
        // a retry.
        context.process.waitUntil(
            context.tracer.getTracer().withSpan("Process agent webhook", async span => {
                const apiClient = this._createApiClient(span, accessToken);

                try {
                    await this._webhook(apiClient, {spaceId, event});
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

    protected _createApiClient(tracer: TracerBase, accessToken: string): ApiClient {
        const routeBySchemaPath = new DefaultMap<string, string>(schemaPath => {
            // Convert path params from the OpenAPI format (`/hello/{name}`) to the
            // format expected by `fetchWithTracer()` (`/hello/:name`). Right now we only
            // support path params that are an entire path segment. Paths like
            // `/report.{format}` aren't currently accepted.
            const route = schemaPath
                .split("/")
                .map(pathSegment => {
                    if (!pathSegment.startsWith("{")) {
                        assert(!/[{}]/.test(pathSegment));
                        return pathSegment;
                    }

                    assert(pathSegment.endsWith("}"));

                    const pathParamName = pathSegment.slice(1, -1);
                    assert(isIdentifier(pathParamName));

                    return `:${pathParamName}`;
                })
                .join("/");

            return route;
        });

        const apiClient: ApiClient = createOpenapiClient({
            baseUrl: this._env.API_SERVICE_URL,
            headers: {
                authorization: `bearer ${this._env.CHAT_GPT_API_SERVICE_KEY}~${accessToken}`,
            },
        });

        apiClient.use({
            onRequest: ({request, schemaPath, options}) => {
                return fetchWithTracer(
                    tracer,
                    request.url,
                    {
                        serviceName: "ApiService",
                        route: routeBySchemaPath.getOrSetDefault(schemaPath),
                        method: request.method,
                        headers: request.headers,
                        body: request.body,
                        signal: request.signal,
                    },
                    async response => {
                        // If the request failed, then throw an error. We want to mark this span as
                        // failed and we don't want to handle errors inline.
                        if (!response.ok) {
                            const responseBody: ApiErrorResponseBody = await response.json();

                            throw new InternalError(
                                `API request failed: ${responseBody.error.message}`,
                                {cause: {status: response.status, ...responseBody}},
                            );
                        }

                        if (options.parseAs === "stream") {
                            return response;
                        }

                        // Parse the response body in our `fetchWithTracer()` action so the time it
                        // takes for the response body to be streamed is included in the span.
                        const responseBody = await response[options.parseAs]();

                        // Don't throw an error when `openapi-fetch` [calls this method a second
                        // time][1]. Instead return what we already parsed.
                        //
                        // [1]: https://github.com/openapi-ts/openapi-typescript/blob/b24ff133a62156fb6145092884a1025cff4f2360/packages/openapi-fetch/src/index.js#L234-L241
                        (response as any)[options.parseAs] = () => responseBody;

                        // For error handling `openapi-fetch` [calls `response.text()` and tries to
                        // parse it as JSON][1]. So add a `text()` handler if we're parsing as JSON and
                        // the request is not ok.
                        //
                        // [1]: https://github.com/openapi-ts/openapi-typescript/blob/b24ff133a62156fb6145092884a1025cff4f2360/packages/openapi-fetch/src/index.js#L243-L250
                        if (!response.ok && options.parseAs === "json") {
                            (response as any).text = () => JSON.stringify(responseBody);
                        }

                        return response;
                    },
                );
            },
        });

        return apiClient;
    }
}
