import {computeStore} from "~/client/helpers/store/compute_store.js";
import {Store} from "~/client/helpers/store/store.js";
import {getTaskCollectionEntryAccess} from "~/client/tasks/internal/create_task_entry_access_store.js";
import {TaskClientQuery} from "~/client/tasks/task_client_query.js";
import {TaskClientTaskSubscription} from "~/client/tasks/task_client_task_subscription.js";
import {AccountModel} from "~/shared/accounts/account_model.js";
import {filterMapArray} from "~/shared/helpers/array/filter_map_array.js";
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
            if (!collectionEntry.collection) return null;

            // Test that the collection is not deleted and we have access via the
            // access policy.
            const access = getTaskCollectionEntryAccess(currentAccount.id, collectionEntry);
            if (access.type !== "PermissionGranted") return null;

            return collectionEntry.collection;
        });
    });
}
