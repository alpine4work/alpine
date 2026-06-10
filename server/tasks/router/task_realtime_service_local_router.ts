import {
    TaskRealtimeServiceRouterBase,
    TaskRealtimeServiceRoutes,
} from "~/server/tasks/router/task_realtime_service_router_base.js";
import {MaybeThunk} from "~/shared/helpers/types/maybe_thunk.js";

export class TaskRealtimeServiceLocalRouter extends TaskRealtimeServiceRouterBase {
    private _port: MaybeThunk<number>;

    constructor({port}: {port: MaybeThunk<number>}) {
        super();
        this._port = port;
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
