import {TaskClientStoreCollectionEntry} from "~/client/web/tasks/core/task_client_store.js";
import {getTaskCollectionEntryAccess} from "~/client/web/tasks/internal/create_task_entry_access_store.js";
import {filterMapArray} from "~/shared/helpers/array/filter_map_array.js";
import {TaskCollectionId} from "~/shared/id/types/id_types.js";
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
    currentAccount: AccountModel | null;
    referencesSubscription: {
        getReferencedCollectionEntryStore(
            collectionId: TaskCollectionId,
        ): Store<TaskClientStoreCollectionEntry>;
    };
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
            const access = getTaskCollectionEntryAccess(currentAccount?.id, collectionEntry);
            if (access.type !== "PermissionGranted") return;

            return collectionEntry.collection;
        });
    });
}
