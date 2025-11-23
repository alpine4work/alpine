import jsonStableStringify from "json-stable-stringify";
import {TaskClientQuery} from "~/client/web/tasks/core/task_client_query.js";
import {
    TaskClientStoreCollectionEntry,
    TaskClientStoreTaskEntry,
} from "~/client/web/tasks/core/task_client_store.js";
import {TaskClientTaskSubscription} from "~/client/web/tasks/core/task_client_task_subscription.js";
import {
    AccessLevel,
    getAccountAccessLevelAssumingSpaceAccess,
    maxAccessLevel,
} from "~/shared/access/access_policy.js";
import {ErrorCode} from "~/shared/error/error_code.js";
import {getOrSetDefaultMapValue} from "~/shared/helpers/map/get_or_set_default_map_value.js";
import {AccountId} from "~/shared/id/types/id_types.js";
import {computeStore} from "~/shared/store/compute_store.js";
import {Store} from "~/shared/store/store.js";

export type TaskAccess =
    | {readonly type: "Deleted"; readonly level: null}
    | {readonly type: "PermissionGranted"; readonly level: AccessLevel}
    | {readonly type: "PermissionDenied"; readonly level: null};

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

export function getPermissionGrantedTaskAccess(level: AccessLevel) {
    const access: TaskAccess = {type: "PermissionGranted", level};
    return getOrSetDefaultMapValue(taskAccessInternMap, jsonStableStringify(access), () => access);
}

export function getPermissionDeniedTaskAccess() {
    const access: TaskAccess = {type: "PermissionDenied", level: null};
    return getOrSetDefaultMapValue(taskAccessInternMap, jsonStableStringify(access), () => access);
}

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
export function createTaskEntryAccessStore(
    currentAccountId: AccountId | null | undefined,
    referencesSubscription: TaskClientQuery | TaskClientTaskSubscription,
    taskEntryStore: Store<TaskClientStoreTaskEntry>,
): Store<TaskAccess> {
    return computeStore(get => {
        const taskEntry = get(taskEntryStore);

        return computeTaskEntryAccess(get, currentAccountId, referencesSubscription, taskEntry);
    });
}

/**
 * Underlying implementation of `getTaskEntryAccessStore()`. Expects to be
 * called within the context of a `computeStore()` function call. May be called
 * directly if you're building a larger `computeStore()` computation.
 */
export function computeTaskEntryAccess(
    get: <Value>(store: Store<Value>) => Value,
    currentAccountId: AccountId | null | undefined,
    referencesSubscription: TaskClientQuery | TaskClientTaskSubscription,
    taskEntry: TaskClientStoreTaskEntry,
): TaskAccess {
    const getTaskAccess = (taskEntry: TaskClientStoreTaskEntry): TaskAccess => {
        // If the task is marked as unauthorized, we don't have permission. Even if the
        // task was previously loaded. Our client might not see the action which makes
        // the task unauthorized.
        if (taskEntry.authorizationState?.value.type !== "Authorized") {
            // We use the `NotFound` error code for deleted tasks.
            if (taskEntry.authorizationState?.value.errorCode === ErrorCode.NotFound) {
                return {type: "Deleted", level: null};
            } else {
                return {type: "PermissionDenied", level: null};
            }
        }

        // The task is not loaded and we don't have an `authorizationState`. Assume we
        // don't have permission.
        if (!taskEntry.task) {
            return {type: "PermissionDenied", level: null};
        }

        // Can't access a deleted task. We reach this case if a task is
        // deleted in realtime before we've had a chance to re-run authorization. When
        // authorization re-runs then we'll get an `Unauthorized` `authorizationState`
        // with `ErrorCode.NotFound` and end up returning above.
        if (taskEntry.task.isDeleted()) {
            return {type: "Deleted", level: null};
        }

        if (currentAccountId) {
            // The task creator has edit access level on their own task.
            if (taskEntry.task.getCreator().accountId === currentAccountId) {
                return {type: "PermissionGranted", level: "Edit"};
            }

            // The task assignee has edit access level on their own task.
            if (taskEntry.task.getAssignee()?.assignee.accountId === currentAccountId) {
                return {type: "PermissionGranted", level: "Edit"};
            }
        }

        const accessLevels: Array<AccessLevel> = [];

        // We inherit the highest access level of our collections.
        for (const {collectionId} of taskEntry.task.getCollections().getArray()) {
            const collectionEntry = get(
                referencesSubscription.getReferencedCollectionEntryStore(collectionId),
            );

            const collectionAccess = computeTaskCollectionEntryAccess(
                currentAccountId,
                collectionEntry,
            );
            if (collectionAccess.type === "PermissionGranted") {
                accessLevels.push(collectionAccess.level);
            }
        }

        // We inherit our parent's access level.
        const parent = taskEntry.task.getParent();
        if (parent) {
            const parentTaskEntry = get(
                referencesSubscription.getReferencedTaskEntryStore(parent.taskId),
            );
            const parentAccess = getTaskAccess(parentTaskEntry);

            if (parentAccess.type === "PermissionGranted") {
                accessLevels.push(parentAccess.level);
            }
        }

        if (accessLevels.length === 0) return {type: "PermissionDenied", level: null};

        let accessLevel = accessLevels[0]!;

        for (let i = 1; i < accessLevels.length; i++) {
            accessLevel = maxAccessLevel(accessLevel, accessLevels[i]!);
        }

        return {
            type: "PermissionGranted",
            level: accessLevel,
        };
    };

    const access = getTaskAccess(taskEntry);

    return getOrSetDefaultMapValue(taskAccessInternMap, jsonStableStringify(access), () => access);
}

/**
 * Determines whether our client has access to the provided collection and at
 * what access level. This is a client-side implementation of the server-side
 * collection authorization functions (e.g.
 * `isTaskCollectionAccessAuthorized()`).
 */
export function getTaskCollectionEntryAccess(
    currentAccountId: AccountId | null | undefined,
    collectionEntry: TaskClientStoreCollectionEntry,
): TaskAccess {
    const access = computeTaskCollectionEntryAccess(currentAccountId, collectionEntry);

    return getOrSetDefaultMapValue(taskAccessInternMap, jsonStableStringify(access), () => access);
}

function computeTaskCollectionEntryAccess(
    currentAccountId: AccountId | null | undefined,
    collectionEntry: TaskClientStoreCollectionEntry,
): TaskAccess {
    // If the collection is marked as unauthorized, we don't have permission. Even
    // if the task was previously loaded. Our client might not see the action which
    // makes the task unauthorized.
    if (collectionEntry.authorizationState?.value.type !== "Authorized") {
        // We use the `NotFound` error code for deleted tasks collections.
        if (collectionEntry.authorizationState?.value.errorCode === ErrorCode.NotFound) {
            return {type: "Deleted", level: null};
        } else {
            return {type: "PermissionDenied", level: null};
        }
    }

    // The collection is not loaded and we don't have an `authorizationState`.
    // Assume we don't have permission.
    if (!collectionEntry.collection) {
        return {type: "PermissionDenied", level: null};
    }

    // Can't access a deleted collection. We reach this case if a collection is
    // deleted in realtime before we've had a chance to re-run authorization. When
    // authorization re-runs then we'll get an `Unauthorized` `authorizationState`
    // with `ErrorCode.NotFound` and end up returning above.
    if (collectionEntry.collection.isDeleted()) {
        return {type: "Deleted", level: null};
    }

    const accessPolicy = collectionEntry.collection.getAccessPolicy();
    const accessLevel = getAccountAccessLevelAssumingSpaceAccess(accessPolicy, currentAccountId);

    if (accessLevel === null) {
        return {type: "PermissionDenied", level: null};
    }

    return {
        type: "PermissionGranted",
        level: accessLevel,
    };
}
