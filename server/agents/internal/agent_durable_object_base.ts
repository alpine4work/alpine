import {createSimpleErrorResponse} from "~/server/helpers/create_simple_error_response.js";
import {createServerTracer} from "~/server/tracer/server_tracer.js";
import {traceServerResponse} from "~/server/tracer/trace_server_response.js";
import {Context} from "~/shared/context/context.js";
import {ProcessContextModule} from "~/shared/context/process_context_module.js";
import {TracerContextModule} from "~/shared/context/tracer_context_module.js";
import {TracerRoot, TracerServiceName} from "~/shared/tracer/tracer_root.js";

export type AgentDurableObjectEnv = {
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

    constructor(
        serviceName: TracerServiceName,
        state: DurableObjectState,
        env: AgentDurableObjectEnv,
    ) {
        this._state = state;

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
    protected abstract _parseRoute(url: URL): [string, Route];

    /**
     * Execute an HTTP request against the Durable Object.
     */
    protected abstract _fetch(
        context: AgentContext,
        request: Request,
        route: Route,
    ): Promise<Response>;

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
                        return this._fetch(actionContext, request, routeObject);
                    },
                );
                return response;
            } catch (error) {
                span.addException(error);
                return createSimpleErrorResponse(error);
            }
        });
    }
}
