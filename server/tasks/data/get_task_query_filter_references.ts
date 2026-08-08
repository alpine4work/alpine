import {ServerActionContext} from "~/server/context/server_action_context.js";
import {getAccount} from "~/server/spaces/get_account.js";
import {getTaskCollectionSearchResult} from "~/server/tasks/data/get_task_collection_search_result.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.open_source.js";
import {SpaceId} from "~/shared/id/types/id_types.open_source.js";
import {TaskQueryFilter} from "~/shared/tasks/task_query_filter.js";
import {
    TaskQueryFilterReferences,
    getTaskQueryFiltersReferencedIds,
} from "~/shared/tasks/task_query_filter_references.js";

/**
 * Load all the data referenced in our task query filters.
 */
export async function getTaskQueryFilterReferences(
    context: ServerActionContext,
    spaceId: SpaceId,
    filters: ReadonlyArray<TaskQueryFilter>,
): Promise<TaskQueryFilterReferences> {
    const {accountIds, collectionIds} = getTaskQueryFiltersReferencedIds(filters);

    const [accounts, collectionResults] = await runAllPromises([
        runAllPromises(
            Array.from(accountIds, accountId => getAccount(context, spaceId, accountId)),
        ),
        runAllPromises(
            Array.from(collectionIds, collectionId =>
                getTaskCollectionSearchResult(context, collectionId),
            ),
        ),
    ]);

    return {
        accountById: new Map(accounts.map(account => [account.id, account])),
        collectionResultById: new Map(
            collectionResults.map(collectionResult => [
                collectionResult.collection.id,
                collectionResult,
            ]),
        ),
    };
}
