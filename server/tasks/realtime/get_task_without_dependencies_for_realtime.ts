import {DynamoCacheReadConsistency} from "~/server/dynamo/core/dynamo_read_consistency.js";
import {ActorContextModule} from "~/server/helpers/actor_context_module.js";
import {authorizeSiteAccessIfPossible} from "~/server/sites/data/authorize_site_access.js";
import {authorizeSpaceAccessIfPossible} from "~/server/spaces/authorize_space_access.js";
import {prepareTaskForClient} from "~/server/tasks/data/prepare_task_for_client.js";
import {
    TaskRealtimeActionContext,
    TaskRealtimeSystemActionContext,
} from "~/server/tasks/data/task_realtime_context.js";
import {TaskRealtimeServer} from "~/server/tasks/realtime/task_realtime_server.js";
import {BatchContextModule} from "~/shared/context/batch_context_module.js";
import {CacheContextModule} from "~/shared/context/cache_context_module.js";
import {Context} from "~/shared/context/context.js";
import {TracerContextModule} from "~/shared/context/tracer_context_module.js";
import {SiteId, SpaceId, TaskCollectionId, TaskId} from "~/shared/id/types/id_types.open_source.js";
import {TaskRealtimeGetTaskWithoutDependenciesOutput} from "~/shared/tasks/task_realtime_service_procedure_schemas.js";

export async function getTaskWithoutDependenciesForRealtime(
    originalContext: TaskRealtimeActionContext,
    {
        server,
        dangerouslyEscalateToSystemContext,
        spaceId,
        taskId,
        consistency,
        dangerouslyAllowDeleted,
    }: {
        server: TaskRealtimeServer;
        dangerouslyEscalateToSystemContext: <Value>(
            context: Context<{
                tracer: TracerContextModule;
                actor: ActorContextModule;
                cache: CacheContextModule;
                batch: BatchContextModule;
            }>,
            spaceId: SpaceId,
            action: (context: TaskRealtimeSystemActionContext) => Promise<Value>,
        ) => Promise<Value>;
        spaceId: SpaceId;
        taskId: TaskId;
        consistency: DynamoCacheReadConsistency;
        dangerouslyAllowDeleted: boolean;
    },
): Promise<TaskRealtimeGetTaskWithoutDependenciesOutput> {
    // If a strong read consistency was requested then expect strong consistency in
    // `DynamoContextModule` as a precaution to help make sure all reads are strongly
    // consistent.
    if (consistency !== "Eventual") {
        originalContext = originalContext.dynamo.expectStrongReadConsistency();
    }

    const result = await server.authorizeTaskAccessIfPossible(
        originalContext,
        spaceId,
        taskId,
        "View",
        {consistency, dangerouslyAllowDeleted},
    );
    if (!result?.ok) return {ok: true, taskResult: result};

    return await dangerouslyEscalateToSystemContext(originalContext, spaceId, async context => {
        const task = await server.getTask(context, spaceId, taskId);

        const prepareContext = {
            actor: originalContext.actor,
            isSpaceAccessAuthorized: (
                await authorizeSpaceAccessIfPossible(originalContext, spaceId)
            ).ok,
            isCollectionAccessAuthorized: async (collectionId: TaskCollectionId) => {
                const result = await server.authorizeCollectionAccessIfPossible(
                    context,
                    spaceId,
                    collectionId,
                    "View",
                    {consistency},
                );

                return result?.ok ?? false;
            },
            isSiteAccessAuthorized: async (siteId: SiteId) => {
                const result = await authorizeSiteAccessIfPossible(
                    originalContext,
                    siteId,
                    "View",
                    {consistency},
                );

                return result?.ok ?? false;
            },
        };

        const taskModel = await prepareTaskForClient(task, prepareContext);

        return {
            ok: true,
            taskResult: {ok: true, value: taskModel},
        };
    });
}
