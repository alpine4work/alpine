import {TaskClientQuery} from "~/client/web/tasks/core/task_client_query.js";
import {TaskClientStoreTaskEntry} from "~/client/web/tasks/core/task_client_store.js";
import {TaskClientTaskSubscription} from "~/client/web/tasks/core/task_client_task_subscription.js";
import {
    AccessLevel,
    AccessPolicy,
    AccessPolicyWithoutGenerations,
    getAccountAccessLevelAssumingSpaceAccess,
    maxAccessLevel,
} from "~/shared/access/access_policy.js";
import {cast} from "~/shared/helpers/control/cast.js";
import {isDeepEqual} from "~/shared/helpers/control/is_deep_equal.js";
import {mapIterable} from "~/shared/helpers/iterable/map_iterable.js";
import {AccountId, TaskCollectionId, TaskId} from "~/shared/id/types/id_types.js";
import {computeStore} from "~/shared/store/compute_store.js";
import {Store} from "~/shared/store/store.js";

export function createTaskEffectiveAccessPolicyStore(
    referencesSubscription: TaskClientQuery | TaskClientTaskSubscription,
    taskEntryStore: Store<TaskClientStoreTaskEntry>,
): Store<{
    effectiveAccessPolicy: AccessPolicyWithoutGenerations;
    inheritedAccessPolicy: AccessPolicyWithoutGenerations;
}> {
    const store = computeStore(get => {
        const taskEntry = get(taskEntryStore);

        return computeTaskEffectiveAccessPolicy(get, referencesSubscription, taskEntry);
    });

    return store.reduce((previousAccessPolicy, accessPolicy) => {
        // Optimization: Return a referentially equal access policy if the access policy is
        // deep equal. This prevents downstream recalculations which is useful given we
        // subscribe to the whole task model, task collection model, parent task collection
        // model, a lot of stuff basically, while computing the effective access policy.
        if (previousAccessPolicy && isDeepEqual(previousAccessPolicy, accessPolicy))
            return previousAccessPolicy;

        return accessPolicy;
    }, null);
}

export function createTaskEffectiveAccessLevelStore(
    currentAccountId: AccountId | null | undefined,
    referencesSubscription: TaskClientQuery | TaskClientTaskSubscription,
    taskEntryStore: Store<TaskClientStoreTaskEntry>,
) {
    return computeStore(get => {
        const taskEntry = get(taskEntryStore);

        const {effectiveAccessPolicy} = computeTaskEffectiveAccessPolicy(
            get,
            referencesSubscription,
            taskEntry,
        );

        // Slightly more efficient than using
        // `createTaskEffectiveAccessPolicyStore().map((...) => getAccountAccessLevelAssumingSpaceAccess(...))`
        // because we can skip the `isDeepEqual()` check.
        return getAccountAccessLevelAssumingSpaceAccess(effectiveAccessPolicy, currentAccountId);
    });
}

/**
 * A task's effective access policy is the union of the task's own access policy,
 * the task's collections access policy, and the task's parent effective access
 * policy.
 */
function computeTaskEffectiveAccessPolicy(
    get: <Value>(store: Store<Value>) => Value,
    referencesSubscription: TaskClientQuery | TaskClientTaskSubscription,
    taskEntry: TaskClientStoreTaskEntry,
): {
    effectiveAccessPolicy: AccessPolicyWithoutGenerations;
    inheritedAccessPolicy: AccessPolicyWithoutGenerations;
} {
    const accountGrantById = new Map<AccountId, {level: AccessLevel}>();
    let defaultGrant: {level: AccessLevel} | null = null;
    let urlGrant: {level: "View"} | null = null;

    const seenCollectionIds = new Set<TaskCollectionId>();
    const seenTaskIds = new Set<TaskId>();

    function addAccountGrant(accountId: AccountId, accessLevel: AccessLevel) {
        let accountGrant = accountGrantById.get(accountId);
        if (accountGrant === undefined) {
            accountGrant = {level: accessLevel};
            accountGrantById.set(accountId, accountGrant);
        } else {
            accountGrant.level = maxAccessLevel(accountGrant.level, accessLevel);
        }
    }

    function addDefaultGrant(accessLevel: AccessLevel) {
        if (defaultGrant === null) {
            defaultGrant = {level: accessLevel};
        } else {
            defaultGrant.level = maxAccessLevel(defaultGrant.level, accessLevel);
        }
    }

    function addUrlGrant(accessLevel: "View") {
        if (urlGrant === null) {
            urlGrant = {level: "View"};
        } else {
            // The only acceptable access level right now is `View`.
            cast<"View">(accessLevel);
        }
    }

    function addGrants(accessPolicy: AccessPolicy) {
        for (const [accountId, accountGrant] of accessPolicy.accountGrantById) {
            addAccountGrant(accountId, accountGrant.level);
        }

        if (accessPolicy.defaultGrant) {
            addDefaultGrant(accessPolicy.defaultGrant.level);
        }

        if (accessPolicy.urlGrant) {
            addUrlGrant(accessPolicy.urlGrant.level);
        }
    }

    function addTaskGrants(taskEntry: TaskClientStoreTaskEntry, isRoot: boolean) {
        if (!taskEntry.task) return;
        if (taskEntry.task.isDeleted()) return;

        if (!isRoot) {
            addGrants(taskEntry.task.getAccessPolicy());
        }

        const assignee = taskEntry.task.getAssignee();
        if (assignee) {
            addAccountGrant(assignee.assignee.accountId, "Edit");
        }

        const parent = taskEntry.task.getParent();
        if (parent && !seenTaskIds.has(parent.taskId)) {
            seenTaskIds.add(parent.taskId);

            const parentTaskEntry = get(
                referencesSubscription.getReferencedTaskEntryStore(parent.taskId),
            );

            addTaskGrants(parentTaskEntry, false);
        }

        for (const {collectionId} of taskEntry.task.getCollections().getArray()) {
            if (seenCollectionIds.has(collectionId)) continue;
            seenCollectionIds.add(collectionId);

            const collectionEntry = get(
                referencesSubscription.getReferencedCollectionEntryStore(collectionId),
            );

            if (!collectionEntry.collection) continue;
            if (collectionEntry.collection.isDeleted()) continue;

            addGrants(collectionEntry.collection.getAccessPolicy());
        }
    }

    addTaskGrants(taskEntry, true);

    // Clone the access policy into `inheritedAccessPolicy` before we add grants from
    // the root task to get the effective access policy.
    const inheritedAccessPolicy: AccessPolicyWithoutGenerations = {
        accountGrantById: new Map(
            mapIterable(accountGrantById, ([id, accountGrant]) => [
                id,
                {level: accountGrant.level},
            ]),
        ),
        defaultGrant: defaultGrant
            ? // @ts-expect-error: Annoying. TypeScript doesn't know `defaultGrant` could be
              // mutated at this point.
              {level: defaultGrant.level}
            : null,
        urlGrant: urlGrant
            ? // @ts-expect-error: Annoying. TypeScript doesn't know `defaultGrant` could be
              // mutated at this point.
              {level: urlGrant.level}
            : null,
    };

    if (taskEntry.task && !taskEntry.task.isDeleted()) {
        addGrants(taskEntry.task.getAccessPolicy());
    }

    return {
        inheritedAccessPolicy,
        effectiveAccessPolicy: {
            accountGrantById,
            defaultGrant,
            urlGrant,
        },
    };
}
