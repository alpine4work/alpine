import {TaskClientStoreCollectionEntry} from "~/client/web/tasks/core/task_client_store.js";
import {getAccountAccessLevelAssumingSpaceAccess} from "~/shared/access/access_policy.js";
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
            if (collectionEntry.collection.isDeleted()) return;

            // Make sure we don't show task collections the user isn't allowed to see. If
            // the user changes the collection's access policy it may take a minute or so
            // before the server sends an update marking the collection as unauthorized. We
            // want to hide the collection immediately, though.
            const accessPolicy = collectionEntry.collection.getAccessPolicy();
            const accessLevel = getAccountAccessLevelAssumingSpaceAccess(
                accessPolicy,
                currentAccount?.id,
            );
            if (accessLevel === null) return;

            return collectionEntry.collection;
        });
    });
}
