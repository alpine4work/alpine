import {TaskClientQuery} from "~/client/tasks/core/task_client_query.js";
import {TaskClientTaskSubscription} from "~/client/tasks/core/task_client_task_subscription.js";
import {getTaskCollectionEntryAccess} from "~/client/tasks/internal/create_task_entry_access_store.js";
import {filterMapArray} from "~/shared/helpers/array/filter_map_array.js";
import {AccountModel} from "~/shared/spaces/account_model.js";
import {computeStore} from "~/shared/store/compute_store.js";
import {Store} from "~/shared/store/store.js";
import {TaskCollectionModel} from "~/shared/tasks/model/task_collection_model.js";
import {TaskCollectionSet} from "~/shared/tasks/task_collection_set.js";

/**
 * Get the array of task collections to display to the user. This list excludes
 * deleted collections and collections the user doesn't have access to. Both of
 * which are included in `TaskCollectionSet` just not presented to the user.
 */
export function createDisplayTaskCollectionsStore({
    currentAccount,
    referencesSubscription,
    collections,
}: {
    currentAccount: AccountModel;
    referencesSubscription: TaskClientQuery | TaskClientTaskSubscription;
    collections: TaskCollectionSet;
}): Store<ReadonlyArray<TaskCollectionModel>> {
    return computeStore(get => {
        return filterMapArray(collections.getArray(), ({collectionId}) => {
            const collectionEntry = get(
                referencesSubscription.getReferencedCollectionEntryStore(collectionId),
            );
            if (!collectionEntry.collection) return;

            // Test that the collection is not deleted and we have access via the
            // access policy.
            const access = getTaskCollectionEntryAccess(currentAccount.id, collectionEntry);
            if (access.type !== "PermissionGranted") return;

            return collectionEntry.collection;
        });
    });
}
