import {ServerActionContext} from "~/server/context/server_action_context.js";
import {filterMapArray} from "~/shared/helpers/array/filter_map_array.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {SpaceId, TaskCollectionId} from "~/shared/id/types/id_types.js";

export async function getApiTaskCollectionItems(
    context: ServerActionContext,
    spaceId: SpaceId,
    collectionIds: ReadonlyArray<TaskCollectionId>,
): Promise<Array<{collection: {id: TaskCollectionId}}>> {
    const collectionResults = await runAllPromises(
        collectionIds.map(collectionId =>
            context.tasks.getCollectionIfPossible(spaceId, collectionId, {
                consistency: "StrongWithinCache",
            }),
        ),
    );

    return filterMapArray(collectionResults, collectionResult => {
        if (!collectionResult?.ok) return;
        if (collectionResult.value.isDeleted()) return;
        return {collection: {id: collectionResult.value.id}};
    });
}
