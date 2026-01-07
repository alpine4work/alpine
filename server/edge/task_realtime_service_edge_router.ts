import {
    TaskRealtimeServiceRouterBase,
    TaskRealtimeServiceRoutes,
    TaskRealtimeServiceRoutesSchema,
} from "~/server/tasks/router/task_realtime_service_router_base.js";
import {TokenAgent} from "~/server/tokens/token_agent.js";
import {Context} from "~/shared/context/context.js";
import {ProcessContextModule} from "~/shared/context/process_context_module.js";
import {TracerContextModule} from "~/shared/context/tracer_context_module.js";
import {ErrorSchema} from "~/shared/error/error_schema.js";
import {fetchWithTracer} from "~/shared/tracer/fetch_with_tracer.js";

/**
 * Our task realtime service router for use in `EdgeService`. Reads routes by
 * fetching from `/api/task-realtime-service-routes` on `AppService`.
 */
export class TaskRealtimeServiceEdgeRouter extends TaskRealtimeServiceRouterBase {
    private readonly _protocol: string;
    private readonly _host: string;
    private readonly _tokenAgent: TokenAgent;

    constructor({
        protocol,
        host,
        tokenAgent,
    }: {
        protocol: string;
        host: string;
        tokenAgent: TokenAgent;
    }) {
        super();
        this._protocol = protocol;
        this._host = host;
        this._tokenAgent = tokenAgent;
    }

    protected override async _loadRoutes(
        context: Context<{process: ProcessContextModule; tracer: TracerContextModule}>,
    ): Promise<TaskRealtimeServiceRoutes> {
        return fetchWithTracer(
            context.tracer.getTracer(),
            `${this._protocol}//${this._host}/api/task-realtime-service-routes`,
            {serviceName: "AppService", route: "/api/task-realtime-service-routes"},
            async response => {
                if (response.status !== 200) {
                    const body = await response.json();
                    const error = ErrorSchema.deserialize(body.error);
                    throw error;
                }

                const encryptedRoutesString = await response.text();
                const routesString =
                    await this._tokenAgent.privateSide.decrypt(encryptedRoutesString);
                const routes = TaskRealtimeServiceRoutesSchema.deserialize(
                    JSON.parse(routesString),
                );

                return routes;
            },
        );
    }
}
