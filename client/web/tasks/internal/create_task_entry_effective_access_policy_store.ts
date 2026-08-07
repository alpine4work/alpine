import {TaskClientQuery} from "~/client/web/tasks/core/task_client_query.js";
import {TaskClientStoreTaskEntry} from "~/client/web/tasks/core/task_client_store.js";
import {TaskClientTaskSubscription} from "~/client/web/tasks/core/task_client_task_subscription.js";
import {
    AccessLevel,
    EffectiveAccessPolicy,
    getAccountAccessLevelAssumingSpaceAccess,
    maxAccessLevel,
    minAccessLevel,
} from "~/shared/access/access_policy.js";
import {cast} from "~/shared/helpers/control/cast.open_source.js";
import {isDeepEqual} from "~/shared/helpers/control/is_deep_equal.open_source.js";
import {mapIterable} from "~/shared/helpers/iterable/map_iterable.open_source.js";
import {AccountId, TaskCollectionId, TaskId} from "~/shared/id/types/id_types.open_source.js";
import {computeStore} from "~/shared/store/compute_store.js";
import {Store} from "~/shared/store/store.js";
import {TaskCollectionModel} from "~/shared/tasks/model/task_collection_model.js";
import {TaskModel} from "~/shared/tasks/model/task_model.js";

export function createTaskEffectiveAccessPolicyStore(
    referencesSubscription: TaskClientQuery | TaskClientTaskSubscription,
    taskEntryStore: Store<TaskClientStoreTaskEntry>,
): Store<{
    effectiveAccessPolicyWithOptimisticState: EffectiveAccessPolicy;
    effectiveAccessPolicyWithoutOptimisticState: EffectiveAccessPolicy;
    inheritedAccessPolicyWithOptimisticState: EffectiveAccessPolicy;
    inheritedAccessPolicyWithoutOptimisticState: EffectiveAccessPolicy;
}> {
    const store = computeStore(get => {
        const taskEntry = get(taskEntryStore);

        const withOptimisticState = computeTaskEffectiveAccessPolicy(
            get,
            referencesSubscription,
            taskEntry,
            true,
        );

        const withoutOptimisticState = computeTaskEffectiveAccessPolicy(
            get,
            referencesSubscription,
            taskEntry,
            false,
        );

        return {
            effectiveAccessPolicyWithOptimisticState: withOptimisticState.effectiveAccessPolicy,
            effectiveAccessPolicyWithoutOptimisticState:
                withoutOptimisticState.effectiveAccessPolicy,
            inheritedAccessPolicyWithOptimisticState: withOptimisticState.inheritedAccessPolicy,
            inheritedAccessPolicyWithoutOptimisticState:
                withoutOptimisticState.inheritedAccessPolicy,
        };
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

        const {effectiveAccessPolicy: effectiveAccessPolicyWithOptimisticState} =
            computeTaskEffectiveAccessPolicy(get, referencesSubscription, taskEntry, true);

        const {effectiveAccessPolicy: effectiveAccessPolicyWithoutOptimisticState} =
            computeTaskEffectiveAccessPolicy(get, referencesSubscription, taskEntry, false);

        // Slightly more efficient than using
        // `createTaskEffectiveAccessPolicyStore().map((...) => getAccountAccessLevelAssumingSpaceAccess(...))`
        // because we can skip the `isDeepEqual()` check.
        return minAccessLevel(
            getAccountAccessLevelAssumingSpaceAccess(
                effectiveAccessPolicyWithOptimisticState,
                currentAccountId,
            ),
            getAccountAccessLevelAssumingSpaceAccess(
                effectiveAccessPolicyWithoutOptimisticState,
                currentAccountId,
            ),
        );
    });
}

/**
 * A task's effective access policy is the union of the task's own access policy,
 * the task's collections access policy, and the task's parent effective access
 * policy.
 *
 * Note: This computes a merged Regular access policy. Site access policies are
 * resolved by extracting the grants from the underlying entities.
 */
function computeTaskEffectiveAccessPolicy(
    get: <Value>(store: Store<Value>) => Value,
    referencesSubscription: TaskClientQuery | TaskClientTaskSubscription,
    // We use a really ugly name for `taskEntry`s to encourage unwrapping the `task`
    // field and checking `withOptimisticState` first to make sure you use the original
    // when optimistic updates are disabled.
    rootTaskEntryWithOptimisticState: TaskClientStoreTaskEntry,
    withOptimisticState: boolean,
): {
    effectiveAccessPolicy: EffectiveAccessPolicy;
    inheritedAccessPolicy: EffectiveAccessPolicy;
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

    function addGrants(accessPolicy: EffectiveAccessPolicy) {
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

    function addTaskGrants(
        taskEntryWithOptimisticState: TaskClientStoreTaskEntry,
        isRoot: boolean,
    ) {
        if (!taskEntryWithOptimisticState.task) return;

        const task = withOptimisticState
            ? taskEntryWithOptimisticState.task
            : (taskEntryWithOptimisticState.optimisticState?.original.task ??
              taskEntryWithOptimisticState.task);

        if (task.isDeleted()) return;

        if (!isRoot) {
            addGrants(getTaskAccessPolicy(task));
        }

        const assignee = task.getAssignee();
        if (assignee) {
            addAccountGrant(assignee.assignee.accountId, "Edit");
        }

        const parent = task.getParent();
        if (parent && !seenTaskIds.has(parent.taskId)) {
            seenTaskIds.add(parent.taskId);

            const parentTaskEntryWithOptimisticState = get(
                referencesSubscription.getReferencedTaskEntryStore(parent.taskId),
            );

            addTaskGrants(parentTaskEntryWithOptimisticState, false);
        }

        for (const {collectionId} of task.getCollections().getArray()) {
            if (seenCollectionIds.has(collectionId)) continue;
            seenCollectionIds.add(collectionId);

            const collectionEntryWithOptimisticState = get(
                referencesSubscription.getReferencedCollectionEntryStore(collectionId),
            );

            if (!collectionEntryWithOptimisticState.collection) continue;

            const collection = withOptimisticState
                ? collectionEntryWithOptimisticState.collection
                : (collectionEntryWithOptimisticState.optimisticState?.original.collection ??
                  collectionEntryWithOptimisticState.collection);

            if (collection.isDeleted()) continue;

            addGrants(getCollectionAccessPolicy(collection));
        }
    }

    addTaskGrants(rootTaskEntryWithOptimisticState, true);

    // Clone the access policy into `inheritedAccessPolicy` before we add grants from
    // the root task to get the effective access policy.
    const inheritedAccessPolicy: EffectiveAccessPolicy = {
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

    if (rootTaskEntryWithOptimisticState.task) {
        const rootTask = withOptimisticState
            ? rootTaskEntryWithOptimisticState.task
            : (rootTaskEntryWithOptimisticState.optimisticState?.original.task ??
              rootTaskEntryWithOptimisticState.task);

        if (!rootTask.isDeleted()) {
            addGrants(getTaskAccessPolicy(rootTask));
        }
    }

    return {
        inheritedAccessPolicy,
        effectiveAccessPolicy: {
            accountGrantById,
            defaultGrant,
            urlGrant,
        },
    };

    function getTaskAccessPolicy(task: TaskModel): EffectiveAccessPolicy {
        return get(referencesSubscription.store.getTaskImmediateResolvedAccessPolicy(task));
    }

    function getCollectionAccessPolicy(collection: TaskCollectionModel): EffectiveAccessPolicy {
        return get(referencesSubscription.store.getCollectionResolvedAccessPolicy(collection));
    }
}
