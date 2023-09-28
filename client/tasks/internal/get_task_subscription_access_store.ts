import jsonStableStringify from "json-stable-stringify";
import {computeStore} from "~/client/helpers/store/compute_store.js";
import {Store} from "~/client/helpers/store/store.js";
import {TaskClientStoreTaskEntry} from "~/client/tasks/task_client_store.js";
import {TaskClientTaskSubscription} from "~/client/tasks/task_client_task_subscription.js";
import {cast} from "~/shared/helpers/control/cast.js";
import {getOrSetDefaultMapValue} from "~/shared/helpers/map/get_or_set_default_map_value.js";
import {AccountId} from "~/shared/id/types/id_types.js";
import {
    TaskCollectionAccessLevel,
    maxTaskCollectionAccessLevel,
} from "~/shared/tasks/task_collection_access_policy.js";

export type TaskAccess =
    | {readonly type: "Deleted"}
    | {readonly type: "PermissionGranted"; readonly level: TaskCollectionAccessLevel}
    | {readonly type: "PermissionDenied"};

// Used to intern `TaskAccess` objects. Since there are only a small number of
// `TaskAccess` objects we intern them so we can always return the same
// reference, preventing React re-renders and store re-computations.
//
// Costs a trivial amount of memory. We should revisit if the `TaskAccess`
// object becomes high cardinality! e.g. By including a `TaskId` or
// `TaskCollectionId`.
//
// https://en.wikipedia.org/wiki/String_interning
const taskAccessInternMap = new Map<string, TaskAccess>();

/**
 * Determines whether our client has access to the provided task and at what
 * access level. This is a client-side implementation of the server-side task
 * authorization functions (e.g. `isTaskAccessAuthorized()`).
 *
 * We load all parent tasks and collections referenced by a task so we can
 * determine whether we have access in realtime. This function returns a
 * `Store` so the UI can immediately re-render if any dependency changes such
 * that we no longer have access.
 */
export function getTaskSubscriptionAccessStore(
    currentAccountId: AccountId,
    taskSubscription: TaskClientTaskSubscription,
): Store<TaskAccess> {
    return computeStore(get => {
        const getTaskAccess = (taskEntry: TaskClientStoreTaskEntry): TaskAccess => {
            // The task is not loaded. Assume we don't have permission. Principle of
            // least privilege.
            if (!taskEntry.task) return {type: "PermissionDenied"};

            // If the task is marked as unauthorized, we don't have permission. Even if the
            // task was previously loaded. Our client might not see the action which makes
            // the task unauthorized.
            if (!taskEntry.isAuthorized) return {type: "PermissionDenied"};

            // The task is deleted. Special access rules apply.
            if (taskEntry.task.isDeleted()) {
                return {type: "Deleted"};
            }

            // The task creator has edit access level on their own task.
            if (taskEntry.task.getCreator().accountId === currentAccountId) {
                return {type: "PermissionGranted", level: "Edit"};
            }

            // The task assignee has edit access level on their own task.
            if (taskEntry.task.getAssignee()?.assignee.accountId === currentAccountId) {
                return {type: "PermissionGranted", level: "Edit"};
            }

            const accessLevels: Array<TaskCollectionAccessLevel> = [];

            // We inherit the highest access level of our collections.
            for (const {collectionId} of taskEntry.task.getCollections().getArray()) {
                const collectionEntry = get(
                    taskSubscription.getReferencedCollectionEntryStore(collectionId),
                );

                // The collection is not loaded. Assume we don't have permission. Principle of
                // least privilege.
                if (!collectionEntry.collection) continue;

                // If the collection is marked as unauthorized, we don't have permission. Even
                // if the task was previously loaded. Our client might not see the action which
                // makes the task unauthorized.
                if (!collectionEntry.isAuthorized) continue;

                const accessPolicy = collectionEntry.collection.getAccessPolicy();

                if (accessPolicy.defaultGrant) {
                    // If we ever add other default grant types then TypeScript will error here
                    // forcing us to update this code.
                    cast<"Space">(accessPolicy.defaultGrant.type);

                    accessLevels.push(accessPolicy.defaultGrant.level);
                }

                const accountGrant = accessPolicy.accountGrantById.get(currentAccountId);
                if (accountGrant) {
                    accessLevels.push(accountGrant.level);
                }
            }

            // We inherit our parent's access level.
            const parent = taskEntry.task.getParent();
            if (parent) {
                const parentTaskEntry = get(
                    taskSubscription.getReferencedTaskEntryStore(parent.taskId),
                );
                const parentAccess = getTaskAccess(parentTaskEntry);

                if (parentAccess.type === "PermissionGranted") {
                    accessLevels.push(parentAccess.level);
                }
            }

            if (accessLevels.length === 0) return {type: "PermissionDenied"};

            return {
                type: "PermissionGranted",
                level: accessLevels.slice(1).reduce(maxTaskCollectionAccessLevel, accessLevels[0]!),
            };
        };

        const taskEntry = get(taskSubscription.taskEntryStore);
        const access = getTaskAccess(taskEntry);

        return getOrSetDefaultMapValue(
            taskAccessInternMap,
            jsonStableStringify(access),
            () => access,
        );
    });
}
