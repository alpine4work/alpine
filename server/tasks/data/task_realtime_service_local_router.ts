import {
    TaskRealtimeServiceRouterBase,
    TaskRealtimeServiceRoutes,
} from "~/server/tasks/router/task_realtime_service_router_base.js";

export class TaskRealtimeServiceLocalRouter extends TaskRealtimeServiceRouterBase {
    private readonly _port: number;

    constructor({port}: {port: number}) {
        super();
        this._port = port;
    }

    public override async _loadRoutes(): Promise<TaskRealtimeServiceRoutes> {
        return {
            partitionPlanes: [
                {
                    partitions: [
                        {
                            instances: [
                                {
                                    isHealthy: true,
                                    // When running locally there's only one worker. All traffic goes there.
                                    workers: [{host: `localhost:${this._port}`}],
                                },
                            ],
                        },
                    ],
                },
            ],
        };
    }
}
