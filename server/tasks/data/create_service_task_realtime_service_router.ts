import {TaskRealtimeServiceEcsRouter} from "~/server/tasks/router/task_realtime_service_ecs_router.js";
import {TaskRealtimeServiceLocalRouter} from "~/server/tasks/router/task_realtime_service_local_router.js";
import {TaskRealtimeServiceRouterBase} from "~/server/tasks/router/task_realtime_service_router_base.js";
import {Context} from "~/shared/context/context.js";
import {ProcessContextModule} from "~/shared/context/process_context_module.js";
import {TracerContextModule} from "~/shared/context/tracer_context_module.js";
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

/**
 * Construct the router for the current environment, load its routes once, and
 * start the background refresh loop. Resolves only after routes are ready, so a
 * service can block startup on it.
 *
 * The loop is torn down on process shutdown. This factory accepts a plain
 * `registerShutdown` callback so `server/tasks/data` stays free of `server/node`.
 */
export async function createServiceTaskRealtimeServiceRouter({
    options,
    context,
    registerShutdown,
}: {
    options: ServiceTaskRealtimeServiceRouterOptions;
    context: Context<{process: ProcessContextModule; tracer: TracerContextModule}>;
    registerShutdown: (cleanup: () => void) => void;
}): Promise<TaskRealtimeServiceRouterBase> {
    if (process.env.NODE_ENV === "production") {
        return await TaskRealtimeServiceEcsRouter.new(
            {
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
            },
            {context, registerShutdown},
        );
    } else {
        return await TaskRealtimeServiceLocalRouter.new(
            {
                port: parseInt(
                    assertExists(
                        options.taskRealtimeServiceLocalPort,
                        "`taskRealtimeServiceLocalPort` option is required",
                    ),
                    10,
                ),
            },
            {context, registerShutdown},
        );
    }
}
