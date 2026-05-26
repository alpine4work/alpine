import {DynamoCacheReadConsistency} from "~/server/dynamo/core/dynamo_read_consistency.js";
import {ActorContextModule} from "~/server/helpers/actor_context_module.js";
import {prepareTaskCollectionForClient} from "~/server/tasks/data/prepare_task_collection_for_client.js";
import {
    TaskRealtimeActionContext,
    TaskRealtimeSystemActionContext,
} from "~/server/tasks/data/task_realtime_context.js";
import {TaskRealtimeServer} from "~/server/tasks/realtime/task_realtime_server.js";
import {BatchContextModule} from "~/shared/context/batch_context_module.js";
import {CacheContextModule} from "~/shared/context/cache_context_module.js";
import {Context} from "~/shared/context/context.js";
import {TracerContextModule} from "~/shared/context/tracer_context_module.js";
import {SpaceId, TaskCollectionId} from "~/shared/id/types/id_types.js";
import {TaskRealtimeGetCollectionOutput} from "~/shared/tasks/task_realtime_service_procedure_schemas.js";

export async function getTaskCollectionForRealtime(
    originalContext: TaskRealtimeActionContext,
    {
        server,
        dangerouslyEscalateToSystemContext,
        spaceId,
        collectionId,
        consistency,
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
        collectionId: TaskCollectionId;
        consistency: DynamoCacheReadConsistency;
    },
): Promise<TaskRealtimeGetCollectionOutput> {
    // If a strong read consistency was requested then expect strong consistency in
    // `DynamoContextModule` as a precaution to help make sure all reads are strongly
    // consistent.
    if (consistency !== "Eventual") {
        originalContext = originalContext.dynamo.expectStrongReadConsistency();
    }

    const result = await server.authorizeCollectionAccessIfPossible(
        originalContext,
        spaceId,
        collectionId,
        "View",
        {consistency},
    );
    if (!result?.ok) return {ok: true, collectionResult: result};

    return await dangerouslyEscalateToSystemContext(originalContext, spaceId, async context => {
        const collection = await server.getCollection(context, spaceId, collectionId);

        const collectionModel = prepareTaskCollectionForClient(collection);

        return {
            ok: true,
            collectionResult: {ok: true, value: collectionModel},
        };
    });
}
