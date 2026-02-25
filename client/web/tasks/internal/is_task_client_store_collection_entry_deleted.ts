import {TaskClientStoreCollectionEntry} from "~/client/web/tasks/core/task_client_store.js";
import {ErrorCode} from "~/shared/error/error_code.js";

/**
 * Should we consider the provided collection entry to be a deleted collection?
 * It's not as simple as checking `isDeleted()` on `TaskModel`. For
 * unauthorized collections we need to check the error code (since deleted
 * collections are unauthorized).
 */
export function isTaskClientStoreCollectionEntryDeleted(
    collectionEntry: TaskClientStoreCollectionEntry,
): boolean {
    if (collectionEntry.collection) return collectionEntry.collection.isDeleted();

    // We use the `NotFound` error code for deleted collections.
    return (
        collectionEntry.authorizationState?.value.type !== "Authorized" &&
        collectionEntry.authorizationState?.value.errorCode === ErrorCode.NotFound
    );
}
