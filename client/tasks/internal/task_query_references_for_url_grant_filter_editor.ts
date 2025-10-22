import {useMemo} from "react";
import {useStateWithDependenciesWithoutDispatch} from "~/client/helpers/lifecycle/use_state_with_dependencies.js";
import {useStore} from "~/client/helpers/use_store.js";
import {TaskClientQuery} from "~/client/tasks/core/task_client_query.js";
import {filterMapIterable} from "~/shared/helpers/iterable/filter_map_iterable.js";
import {AccountId, TaskCollectionId} from "~/shared/id/types/id_types.js";
import {AccountModel, AccountModelData} from "~/shared/spaces/account_model.js";
import {computeStore} from "~/shared/store/compute_store.js";
import {collectReferencedAccountIdsFromTaskModelData} from "~/shared/tasks/model/collected_referenced_account_ids_from_task_model_data.js";
import {TaskCollectionModel} from "~/shared/tasks/model/task_collection_model.js";
import {getTaskQuerySortCursorTaskId} from "~/shared/tasks/task_query_sort_cursor.js";

export type TaskQueryReferencesForUrlGrantFilterEditor = {
    readonly accountById: ReadonlyMap<AccountId, AccountModelData>;
    readonly collectionById: ReadonlyMap<TaskCollectionId, TaskCollectionModel>;
};

/**
 * Finds all the referenced accounts and collections in a query. Will search
 * through the query for referenced accounts and collections then remember
 * those accounts/collections forever. So if the user applies a filter and a
 * new `query` is passed in, we still return a map including accounts from the
 * original query.
 *
 * This is used when a user without space access is looking at a task view with
 * a `urlGrant`. Since the user doesn't have space access, they won't be able
 * to search collections or load the full list of accounts in the space.
 * Instead when they go to filter by assignee we show them the list of accounts
 * referenced by the query instead of every account in the space.
 *
 * This approach isn't perfect. Since we'll only see loaded referenced
 * accounts/collections. If the view is large then when the user scrolls more
 * accounts and collections may be loaded in.
 *
 * If `query` is null then this function will return null.
 */
export function useTaskQueryReferencesForUrlGrantFilterEditor(
    query: TaskClientQuery | null,
): TaskQueryReferencesForUrlGrantFilterEditor | null {
    const currentReferences = useStore(
        useMemo(
            () =>
                computeStore((get): TaskQueryReferencesForUrlGrantFilterEditor | null => {
                    if (!query) return null;

                    const taskOrder = get(query.taskOrderStore);

                    const iterator = taskOrder.begin;
                    const accountIds = new Set<AccountId>();
                    const collectionIds = new Set<TaskCollectionId>();

                    while (iterator.valid) {
                        const taskId = getTaskQuerySortCursorTaskId(iterator.key!);
                        const taskEntry = get(query.getLoadedTaskEntryStore(taskId));

                        if (taskEntry.task) {
                            collectReferencedAccountIdsFromTaskModelData(
                                accountIds,
                                taskEntry.task.rawData,
                            );

                            for (const {collectionId} of taskEntry.task
                                .getCollections()
                                .getArray()) {
                                collectionIds.add(collectionId);
                            }
                        }

                        iterator.next();
                    }

                    const accountById = new Map(
                        filterMapIterable(accountIds, accountId => {
                            const accountStore =
                                query.store.getReferencedAccountStoreIfExists(accountId);
                            if (!accountStore) return;

                            return [accountId, get(accountStore)];
                        }),
                    );

                    const collectionById = new Map(
                        filterMapIterable(collectionIds, collectionId => {
                            const collectionEntry = get(
                                query.getReferencedCollectionEntryStore(collectionId),
                            );
                            if (!collectionEntry.collection) return;
                            if (collectionEntry.collection.isDeleted()) return;

                            return [collectionId, collectionEntry.collection];
                        }),
                    );

                    return {accountById, collectionById};
                }),
            [query],
        ),
    );

    const references = useStateWithDependenciesWithoutDispatch<
        TaskQueryReferencesForUrlGrantFilterEditor | null,
        [TaskQueryReferencesForUrlGrantFilterEditor | null]
    >(
        ([newReferences], oldReferences) => {
            if (!newReferences) return null;

            const accountById = new Map<AccountId, AccountModelData>(oldReferences?.accountById);
            const collectionById = new Map<TaskCollectionId, TaskCollectionModel>(
                oldReferences?.collectionById,
            );

            for (const [accountId, newAccount] of newReferences.accountById) {
                const oldAccount = accountById.get(accountId);

                accountById.set(
                    accountId,
                    oldAccount ? AccountModel.mergeData(oldAccount, newAccount) : newAccount,
                );
            }

            for (const [collectionId, newCollection] of newReferences.collectionById) {
                const oldCollection = collectionById.get(collectionId);

                collectionById.set(
                    collectionId,
                    oldCollection ? oldCollection.merge(newCollection) : newCollection,
                );
            }

            return {accountById, collectionById};
        },
        [currentReferences],
    );

    return references;
}
