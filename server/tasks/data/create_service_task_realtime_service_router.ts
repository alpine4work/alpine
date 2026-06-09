import {TaskRealtimeServiceEcsRouter} from "~/server/tasks/router/task_realtime_service_ecs_router.js";
import {TaskRealtimeServiceLocalRouter} from "~/server/tasks/router/task_realtime_service_local_router.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";

export const serviceTaskRealtimeServiceRouterOptions = {
    taskRealtimeServiceLocalPort: {type: "string"},
    ecsCluster: {type: "string"},
    taskRealtimeServiceEcsTaskDefinitionFamily: {type: "string"},
    taskRealtimeServiceSecurityGroupId: {type: "string"},
} as const;

export type ServiceTaskRealtimeServiceRouterOptions = {
    readonly taskRealtimeServiceLocalPort?: string;
    readonly ecsCluster?: string;
    readonly taskRealtimeServiceEcsTaskDefinitionFamily?: string;
    readonly taskRealtimeServiceSecurityGroupId?: string;
};

export function createServiceTaskRealtimeServiceRouter(
    options: ServiceTaskRealtimeServiceRouterOptions,
) {
    if (process.env.NODE_ENV === "production") {
        return new TaskRealtimeServiceEcsRouter({
            region: "us-east-1",
            ecsCluster: assertExists(
                options.ecsCluster,
                "`ecsCluster` option is required in production",
            ),
            ecsTaskDefinitionFamily: assertExists(
                options.taskRealtimeServiceEcsTaskDefinitionFamily,
                "`taskRealtimeServiceEcsTaskDefinitionFamily` option is required in production",
            ),
            securityGroupId: assertExists(
                options.taskRealtimeServiceSecurityGroupId,
                "`taskRealtimeServiceSecurityGroupId` option is required in production",
            ),
        });
    } else {
        return new TaskRealtimeServiceLocalRouter({
            port: parseInt(
                assertExists(
                    options.taskRealtimeServiceLocalPort,
                    "`taskRealtimeServiceLocalPort` option is required",
                ),
                10,
            ),
        });
    }
}
