import {
    TaskRealtimeServiceRouterBase,
    TaskRealtimeServiceRoutes,
} from "~/server/tasks/router/task_realtime_service_router_base.js";
import {Context} from "~/shared/context/context.js";
import {ProcessContextModule} from "~/shared/context/process_context_module.js";
import {TracerContextModule} from "~/shared/context/tracer_context_module.js";
import {MaybeThunk} from "~/shared/helpers/types/maybe_thunk.open_source.js";

export class TaskRealtimeServiceLocalRouter extends TaskRealtimeServiceRouterBase {
    private _port: MaybeThunk<number>;

    constructor({port}: {port: MaybeThunk<number>}) {
        super();
        this._port = port;
    }

    /**
     * Construct a router, load its routes once, and start the background refresh loop.
     * Mirrors `TaskRealtimeServiceEcsRouter.new()` so services construct either the
     * same way. `registerShutdown` is wired to stop the loop on process shutdown.
     */
    public static async new(
        {port}: {port: MaybeThunk<number>},
        {
            context,
            registerShutdown,
        }: {
            context: Context<{process: ProcessContextModule; tracer: TracerContextModule}>;
            registerShutdown: (cleanup: () => void) => void;
        },
    ): Promise<TaskRealtimeServiceLocalRouter> {
        const router = new TaskRealtimeServiceLocalRouter({port});
        await router._getRoutesAndStartRefreshInterval(context, {registerShutdown});

        return router;
    }

    public override async _loadRoutes(): Promise<TaskRealtimeServiceRoutes> {
        const port = typeof this._port === "function" ? this._port() : this._port;

        return {
            partitionPlanes: [
                {
                    partitions: [
                        {
                            instances: [
                                {
                                    isHealthy: true,
                                    // When running locally there's only one worker. All traffic goes there.
                                    workers: [{host: `localhost:${port}`}],
                                },
                            ],
                        },
                    ],
                },
            ],
        };
    }
}
