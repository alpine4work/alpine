import {
    TaskClientStore,
    TaskClientStoreCollectionEntry,
} from "~/client/web/tasks/core/task_client_store.js";
import {emptyArray} from "~/shared/helpers/array/empty_array.js";
import {zeroHybridLogicalTime} from "~/shared/helpers/clock/hybrid_logical_clock.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {iterableFirst} from "~/shared/helpers/iterable/iterable_first.js";
import {TaskCollectionId} from "~/shared/id/types/id_types.js";
import {nullStore} from "~/shared/store/const_store.js";
import {Store} from "~/shared/store/store.js";
import {TaskCollectionModelSearchResult} from "~/shared/tasks/model/task_collection_model_search_result.js";
import {TaskQueryCollectionsFilter} from "~/shared/tasks/task_query_filter.js";
import {TaskQueryFilterReferences} from "~/shared/tasks/task_query_filter_references.js";
import {
    TaskAuthorizationStateRegister,
    taskAuthorizedState,
} from "~/shared/tasks/task_realtime_protocol.js";

/**
 * Get the collection result objects for all the `collectionIds` in our filter
 * operation. We expect that `<TaskQueryCollectionsFilterOperationEditor>` will
 * setup a subscription to all collections referenced by our filters. But it may
 * take a second since the subscriptions are setup in a `useEffect()`. So subscribe
 * to our subscription store and wait for the collection subscriptions to become
 * available.
 *
 * Returns both a `TaskCollectionModelSearchResult` object and a
 * `TaskClientStoreCollectionEntry` object depending on what you're looking for.
 */
export function createTaskQueryCollectionsFilterCollectionResultsStore({
    store,
    filter,
    filterReferences,
}: {
    store: TaskClientStore;
    filter: TaskQueryCollectionsFilter;
    filterReferences: TaskQueryFilterReferences;
}): Store<
    ReadonlyArray<TaskCollectionModelSearchResult & {entry: TaskClientStoreCollectionEntry}>
> {
    const collectionIds =
        filter.operation.type !== "IsEmpty" ? filter.operation.collectionIds : emptyArray;

    return Store.many(
        Array.from(collectionIds, collectionId => {
            return createTaskQueryCollectionsFilterCollectionResultStore({
                store,
                filterReferences,
                collectionId,
            });
        }),
    );
}

export function createTaskQueryCollectionsFilterCollectionResultStore({
    store,
    filterReferences,
    collectionId,
}: {
    store: TaskClientStore;
    filterReferences: TaskQueryFilterReferences;
    collectionId: TaskCollectionId;
}): Store<TaskCollectionModelSearchResult & {entry: TaskClientStoreCollectionEntry}> {
    const collectionResult = assertExists(filterReferences.collectionResultById.get(collectionId));

    return (
        store
            .getSubscriptionsStore()
            // Optimization: If subscriptions change but our `collectionEntryStore` stays the
            // same then we don't want to recompute the full collection results array.
            .flatMap(
                ({collectionSubscriptionsById}) =>
                    iterableFirst(collectionSubscriptionsById.get(collectionId)?.keys() ?? [])
                        ?.collectionEntryStore ?? nullStore,
            )
            .map(
                (
                    collectionEntry,
                ): TaskCollectionModelSearchResult & {
                    entry: TaskClientStoreCollectionEntry;
                } => {
                    const collection = collectionEntry?.collection
                        ? collectionResult.collection.merge(collectionEntry.collection)
                        : collectionResult.collection;

                    return {
                        ...collectionResult,
                        collection,
                        entry: collectionEntry?.collection
                            ? collectionEntry
                            : {
                                  collection,
                                  actions: null,
                                  optimisticState: null,
                                  authorizationState: new TaskAuthorizationStateRegister(
                                      taskAuthorizedState,
                                      // Any authorization state change from the server should override us.
                                      zeroHybridLogicalTime,
                                  ),
                              },
                    };
                },
            )
    );
}
