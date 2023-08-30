import {
    TaskRealtimeServiceRouterBase,
    TaskRealtimeServiceRoutes,
} from "~/server/tasks/router/task_realtime_service_router_base.js";
import {Context} from "~/shared/context/context.js";
import {ProcessContextModule} from "~/shared/context/process_context_module.js";
import {TracerContextModule} from "~/shared/context/tracer_context_module.js";

export class LocalTaskRealtimeServiceRouter extends TaskRealtimeServiceRouterBase {
    private readonly _port: number;

    constructor({port}: {port: number}) {
        super();
        this._port = port;
    }

    public override async _loadRoutes(
        context: Context<{process: ProcessContextModule; tracer: TracerContextModule}>,
    ): Promise<TaskRealtimeServiceRoutes> {
        return {
            partitions: [
                {
                    instances: [
                        {
                            // When running locally there's only one worker. All traffic goes there.
                            workers: [{host: `localhost:${this._port}`}],
                        },
                    ],
                },
            ],
        };
    }
}
