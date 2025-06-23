import {CalendarDate} from "@internationalized/date";
import {getAccountClientStore} from "~/client/accounts/account_client_store_context.js";
import {TaskClientCollectionSubscription} from "~/client/tasks/core/task_client_collection_subscription.js";
import {
    TaskClientReadonlyStore,
    TaskClientStore,
    TaskClientStoreSearchAffinityManager,
    setShouldDisableCommitTaskActionTransactionMutexForTest,
} from "~/client/tasks/core/task_client_store.js";
import {TaskClientTaskSubscription} from "~/client/tasks/core/task_client_task_subscription.js";
import {Context} from "~/shared/context/context.js";
import {InternalError} from "~/shared/error/error.js";
import {waitMacrotask} from "~/shared/helpers/async/wait_macrotask.js";
import {
    HybridLogicalClock,
    HybridLogicalTime,
    zeroHybridLogicalTime,
} from "~/shared/helpers/clock/hybrid_logical_clock.js";
import {unsynchronizedSystemClock} from "~/shared/helpers/clock/unsynchronized_system_clock.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {defaultTimeZone} from "~/shared/helpers/intl/time_zone.js";
import {getOrSetDefaultMapValue} from "~/shared/helpers/map/get_or_set_default_map_value.js";
import {generateId} from "~/shared/id/id.js";
import {AccountId, SpaceId, TaskCollectionId, TaskId} from "~/shared/id/types/id_types.js";
import {RpcDefinition} from "~/shared/rpc/rpc_definition.js";
import {commitTaskActionTransaction} from "~/shared/rpc/tasks_rpc_definitions.js";
import {TestRpcContextModule} from "~/shared/rpc/test_rpc_context_module.js";
import {AccountModel} from "~/shared/spaces/account_model.js";
import {TaskAction} from "~/shared/tasks/actions/task_action.js";
import {TaskActionModel} from "~/shared/tasks/actions/task_action_model.js";
import {TaskCollectionCreateAction} from "~/shared/tasks/actions/task_collection_action.js";
import {TaskCreateAction} from "~/shared/tasks/actions/task_task_action.js";
import {TaskCollectionModel} from "~/shared/tasks/model/task_collection_model.js";
import {TaskModel} from "~/shared/tasks/model/task_model.js";

// We disable the `commitTaskActionTransaction()` mutex in this file so commits
// can be sent and responses received out-of-order. These tests were written
// before we placed a mutex around `commitTaskActionTransaction()` and the
// out-of-order tests tickle interesting code-paths in `TaskClientStore` we
// want to keep testing.
//
// So even though out-of-order commits aren't possible in a web browser, allow
// them in this test file.
beforeAll(() => {
    setShouldDisableCommitTaskActionTransactionMutexForTest(true);
});

afterAll(() => {
    setShouldDisableCommitTaskActionTransactionMutexForTest(false);
});

const clock = new HybridLogicalClock(unsynchronizedSystemClock);

const spaceId = generateId<SpaceId>();
const currentAccountId = generateId<AccountId>();
const accountStore = getAccountClientStore(spaceId);

const account1 = new AccountModel({
    id: generateId(),
    version: 0,
    name: "Test Account 1",
    nameVersion: 0,
    space: {
        version: 0,
        joinedTime: new Date(),
        wasRemoved: false,
    },
});

// Make sure we hold a reference to the `account1` store for the entire test.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const account1Store = accountStore.getAccountStore(account1);

const getSortableAccount = (accountId: AccountId) => {
    const accountData = assertExists(
        accountStore.weakGetAccountStoreByIdIfExists(accountId),
    ).getSnapshot();

    return {
        accountId,
        workingAccountName: accountData.name,
        workingAccountNameVersion: accountData.version,
    };
};

const context = Context.new({
    rpc: new TestRpcContextModule(),
});

const taskEntryCache = new WeakMap();

function getTaskEntryIfExists(store: TaskClientStore, taskId: TaskId) {
    const taskEntry = store.getTaskEntryStoreIfExists(taskId)?.getSnapshot();
    if (!taskEntry) return null;

    // This test was written before we added `actionReferencedAccountStoreById` to
    // task entries. Discard `actionReferencedAccountStoreById` so we can avoid
    // rewriting tests.

    // Use a `WeakMap` to make sure we maintain referential equality if the task
    // entry doesn't change.
    return getOrSetDefaultMapValue(taskEntryCache, taskEntry, () => ({
        ...taskEntry,
        actions: taskEntry.actions?.map(({action}) => action) ?? null,
        optimisticState: taskEntry.optimisticState
            ? {
                  ...taskEntry.optimisticState,
                  original: !taskEntry.optimisticState.original.task
                      ? {
                            ...taskEntry.optimisticState.original,
                            actions: taskEntry.optimisticState.original.actions.map(
                                ({action}) => action,
                            ),
                        }
                      : taskEntry.optimisticState.original,
                  actions: taskEntry.optimisticState.actions.map(({isOptimistic, action}) => ({
                      isOptimistic,
                      action,
                  })),
              }
            : null,
    }));
}

const collectionEntryCache = new WeakMap();

function getCollectionEntryIfExists(store: TaskClientStore, collectionId: TaskCollectionId) {
    const collectionEntry = store.getCollectionEntryStoreIfExists(collectionId)?.getSnapshot();
    if (!collectionEntry) return null;

    // This test was written before we added `actionReferencedAccountStoreById` to
    // collection entries. Discard `actionReferencedAccountStoreById` so we can avoid
    // rewriting tests.

    // Use a `WeakMap` to make sure we maintain referential equality if the collection
    // entry doesn't change.
    return getOrSetDefaultMapValue(collectionEntryCache, collectionEntry, () => ({
        ...collectionEntry,
        actions: collectionEntry.actions?.map(({action}) => action) ?? null,
        optimisticState: collectionEntry.optimisticState
            ? {
                  ...collectionEntry.optimisticState,
                  original: !collectionEntry.optimisticState.original.collection
                      ? {
                            ...collectionEntry.optimisticState.original,
                            actions: collectionEntry.optimisticState.original.actions.map(
                                ({action}) => action,
                            ),
                        }
                      : collectionEntry.optimisticState.original,
                  actions: collectionEntry.optimisticState.actions.map(
                      ({isOptimistic, action}) => ({
                          isOptimistic,
                          action,
                      }),
                  ),
              }
            : null,
    }));
}

let taskSubscriptions: Array<TaskClientTaskSubscription> = [];
let collectionSubscriptions: Array<TaskClientCollectionSubscription> = [];
let errors: Array<unknown> = [];

const handleError = ({error}: {error: unknown}) => {
    errors.push(error);
};

afterEach(() => {
    const previousErrors = errors;
    errors = [];

    if (previousErrors.length > 0) {
        throw InternalError.from(previousErrors[0], "Received error");
    }

    const stores = new Set<TaskClientReadonlyStore>();

    const previousTaskSubscriptions = taskSubscriptions;
    taskSubscriptions = [];
    for (const subscription of previousTaskSubscriptions) {
        stores.add(subscription.store);
        subscription.release();
    }

    const previousCollectionSubscriptions = collectionSubscriptions;
    collectionSubscriptions = [];
    for (const subscription of previousCollectionSubscriptions) {
        stores.add(subscription.store);
        subscription.release();
    }

    for (const store of stores) {
        assert(store.getTaskCountForTest() === 0, "Expected all tasks to be released");
        assert(store.getCollectionCountForTest() === 0, "Expected all collections to be released");
    }
});

function createAutoRetainStore() {
    const store = new TaskClientStore({
        accountStore,
        spaceId,
        currentAccountId,
        onError: handleError,
    });

    const taskIdsWithSubscription = new Set<TaskId>();
    const collectionIdsWithSubscription = new Set<TaskCollectionId>();

    store.subscribeToBatchUpdate(({taskEntryUpdateById, collectionEntryUpdateById}) => {
        for (const taskId of taskEntryUpdateById.keys()) {
            if (taskIdsWithSubscription.has(taskId)) continue;
            taskIdsWithSubscription.add(taskId);

            // Create a subscription to every `TaskId` we see updated so our tests don't
            // have to worry about retaining task entries.
            taskSubscriptions.push(store.createAndRetainTaskSubscription(taskId));
        }

        for (const collectionId of collectionEntryUpdateById.keys()) {
            if (collectionIdsWithSubscription.has(collectionId)) continue;
            collectionIdsWithSubscription.add(collectionId);

            // Create a subscription to every `TaskId` we see updated so our tests don't
            // have to worry about retaining task entries.
            collectionSubscriptions.push(store.createAndRetainCollectionSubscription(collectionId));
        }
    });

    // Immediately unsubscribe from released subscriptions.
    store.getSubscriptionsStore().subscribe(() => {
        const subscriptions = store.getSubscriptionsStore().getSnapshot();

        for (const [query, {isUnsubscribing}] of subscriptions.queries) {
            if (!isUnsubscribing) continue;
            store._onQueryUnsubscribed(query);
        }

        for (const taskSubscriptions of subscriptions.taskSubscriptionsById.values()) {
            for (const [subscription, {isUnsubscribing}] of taskSubscriptions) {
                if (!isUnsubscribing) continue;
                store._onTaskSubscriptionUnsubscribed(subscription);
            }
        }

        for (const collectionSubscriptions of subscriptions.collectionSubscriptionsById.values()) {
            for (const [subscription, {isUnsubscribing}] of collectionSubscriptions) {
                if (!isUnsubscribing) continue;
                store._onCollectionSubscriptionUnsubscribed(subscription);
            }
        }
    });

    return store;
}

function createTask(
    store: TaskClientStore,
    {
        id = generateId<TaskId>(),
        time = store.clock.now(),
        taskAction = {
            type: "Create",
            creatorId: account1.id,
            creatorTimeZone: defaultTimeZone,
        },
    }: {
        id?: TaskId;
        time?: HybridLogicalTime;
        taskAction?: TaskCreateAction;
    } = {},
) {
    return TaskModel.createFromAction(store.spaceId, id, time, taskAction, getSortableAccount);
}

function createCollection(
    store: TaskClientStore,
    {
        id = generateId<TaskCollectionId>(),
        time = store.clock.now(),
        collectionAction = {
            type: "Create",
            creatorId: null,
            name: "Test",
            accessPolicy: {
                accountGrantById: new Map([[account1.id, {level: "Manage", generation: 0}]]),
                defaultGrant: null,
                urlGrant: null,
            },
        },
    }: {
        id?: TaskCollectionId;
        time?: HybridLogicalTime;
        collectionAction?: TaskCollectionCreateAction;
    } = {},
) {
    return TaskCollectionModel.createFromAction(store.spaceId, id, time, collectionAction);
}

const noopAffinityManager: TaskClientStoreSearchAffinityManager = {
    markLowIntentUpdateInteraction: () => {},
    addGlobalLoadingIndicator: () => {},
};

async function resolveLastRpcExecution<Input, Output>(
    definition: RpcDefinition<Input, Output>,
    output: Output,
): Promise<void> {
    // `TaskClientStore` might not schedule RPCs from `commitActionTransaction()`
    // until after a microtask. So wait for that to happen.
    await waitMacrotask();

    TestRpcContextModule.resolveLastExecution(definition, output);

    // Wait a macrotask for promise resolution to update data in `TaskClientStore`.
    await waitMacrotask();
}

async function resolveRpcExecution<Input, Output>(
    definition: RpcDefinition<Input, Output>,
    n: number,
    output: Output,
): Promise<void> {
    // `TaskClientStore` might not schedule RPCs from `commitActionTransaction()`
    // until after a microtask. So wait for that to happen.
    await waitMacrotask();

    TestRpcContextModule.resolveExecution(definition, n, output);

    // Wait a macrotask for promise resolution to update data in `TaskClientStore`.
    await waitMacrotask();
}

async function rejectRpcExecution<Input, Output>(
    definition: RpcDefinition<Input, Output>,
    n: number,
): Promise<void> {
    // `TaskClientStore` might not schedule RPCs from `commitActionTransaction()`
    // until after a microtask. So wait for that to happen.
    await waitMacrotask();

    TestRpcContextModule.rejectExecution(definition, n);

    // Wait a macrotask for promise resolution to update data in `TaskClientStore`.
    await waitMacrotask();
}

async function rejectLastRpcExecution<Input, Output>(
    definition: RpcDefinition<Input, Output>,
): Promise<void> {
    // `TaskClientStore` might not schedule RPCs from `commitActionTransaction()`
    // until after a microtask. So wait for that to happen.
    await waitMacrotask();

    TestRpcContextModule.rejectLastExecution(definition);

    // Wait a macrotask for promise resolution to update data in `TaskClientStore`.
    await waitMacrotask();
}

test("backfills an authorized task", () => {
    const store = createAutoRetainStore();

    const task = createTask(store);

    expect(getTaskEntryIfExists(store, task.id)).toEqual(null);

    store.applyUpdateEvent({
        type: "Update",
        originClientId: null,
        defaultAuthorizationStateVersion: clock.now(),
        actions: [],
        backfillTasks: [{type: "Authorized", task: task}],
        backfillCollections: [],
        referencedAccounts: [account1],
    });

    expect(getTaskEntryIfExists(store, task.id)).toEqual({
        task,
        actions: null,
        optimisticState: null,
        authorizationState: expect.objectContaining({value: "Authorized"}),
    });
});

test("backfills authorized tasks", () => {
    const store = createAutoRetainStore();

    const task1 = createTask(store);

    const task2 = createTask(store);

    const task3 = createTask(store);

    const task4 = createTask(store);

    expect(getTaskEntryIfExists(store, task1.id)).toEqual(null);
    expect(getTaskEntryIfExists(store, task2.id)).toEqual(null);
    expect(getTaskEntryIfExists(store, task3.id)).toEqual(null);
    expect(getTaskEntryIfExists(store, task4.id)).toEqual(null);

    store.applyUpdateEvent({
        type: "Update",
        originClientId: null,
        defaultAuthorizationStateVersion: clock.now(),
        actions: [],
        backfillTasks: [
            {type: "Authorized", task: task1},
            {type: "Authorized", task: task2},
        ],
        backfillCollections: [],
        referencedAccounts: [account1],
    });

    expect(getTaskEntryIfExists(store, task1.id)).toEqual({
        task: task1,
        actions: null,
        optimisticState: null,
        authorizationState: expect.objectContaining({value: "Authorized"}),
    });

    expect(getTaskEntryIfExists(store, task2.id)).toEqual({
        task: task2,
        actions: null,
        optimisticState: null,
        authorizationState: expect.objectContaining({value: "Authorized"}),
    });

    expect(getTaskEntryIfExists(store, task3.id)).toEqual(null);
    expect(getTaskEntryIfExists(store, task4.id)).toEqual(null);

    store.applyUpdateEvent({
        type: "Update",
        originClientId: null,
        defaultAuthorizationStateVersion: clock.now(),
        actions: [],
        backfillTasks: [
            {type: "Authorized", task: task3},
            {type: "Authorized", task: task4},
        ],
        backfillCollections: [],
        referencedAccounts: [account1],
    });

    expect(getTaskEntryIfExists(store, task1.id)).toEqual({
        task: task1,
        actions: null,
        optimisticState: null,
        authorizationState: expect.objectContaining({value: "Authorized"}),
    });

    expect(getTaskEntryIfExists(store, task2.id)).toEqual({
        task: task2,
        actions: null,
        optimisticState: null,
        authorizationState: expect.objectContaining({value: "Authorized"}),
    });

    expect(getTaskEntryIfExists(store, task3.id)).toEqual({
        task: task3,
        actions: null,
        optimisticState: null,
        authorizationState: expect.objectContaining({value: "Authorized"}),
    });

    expect(getTaskEntryIfExists(store, task4.id)).toEqual({
        task: task4,
        actions: null,
        optimisticState: null,
        authorizationState: expect.objectContaining({value: "Authorized"}),
    });
});

test("backfill merges with existing authorized task", () => {
    const store = createAutoRetainStore();

    const task1a = createTask(store);

    const task1b = task1a.applyAction(
        {
            type: "UpdateTask",
            time: store.clock.now(),
            taskId: task1a.id,
            taskAction: {
                type: "UpdatePriority",
                priority: "High",
            },
        },
        getSortableAccount,
    );

    expect(task1a.rawData).not.toEqual(task1b.rawData);

    expect(getTaskEntryIfExists(store, task1a.id)).toEqual(null);

    store.applyUpdateEvent({
        type: "Update",
        originClientId: null,
        defaultAuthorizationStateVersion: clock.now(),
        actions: [],
        backfillTasks: [{type: "Authorized", task: task1a}],
        backfillCollections: [],
        referencedAccounts: [account1],
    });

    expect(getTaskEntryIfExists(store, task1a.id)).toEqual({
        task: task1a,
        actions: null,
        optimisticState: null,
        authorizationState: expect.objectContaining({value: "Authorized"}),
    });

    store.applyUpdateEvent({
        type: "Update",
        originClientId: null,
        defaultAuthorizationStateVersion: clock.now(),
        actions: [],
        backfillTasks: [{type: "Authorized", task: task1b}],
        backfillCollections: [],
        referencedAccounts: [account1],
    });

    expect(getTaskEntryIfExists(store, task1a.id)).toEqual({
        task: task1b,
        actions: null,
        optimisticState: null,
        authorizationState: expect.objectContaining({value: "Authorized"}),
    });
});

test("backfill merges with existing unauthorized task", () => {
    const store = createAutoRetainStore();

    const task1a = createTask(store);

    const task1b = task1a.applyAction(
        {
            type: "UpdateTask",
            time: store.clock.now(),
            taskId: task1a.id,
            taskAction: {
                type: "UpdatePriority",
                priority: "High",
            },
        },
        getSortableAccount,
    );

    expect(task1a.rawData).not.toEqual(task1b.rawData);

    expect(getTaskEntryIfExists(store, task1a.id)).toEqual(null);

    store.applyUpdateEvent({
        type: "Update",
        originClientId: null,
        defaultAuthorizationStateVersion: clock.now(),
        actions: [],
        backfillTasks: [{type: "Authorized", task: task1a}],
        backfillCollections: [],
        referencedAccounts: [account1],
    });

    expect(getTaskEntryIfExists(store, task1a.id)).toEqual({
        task: task1a,
        actions: null,
        optimisticState: null,
        authorizationState: expect.objectContaining({value: "Authorized"}),
    });

    store.applyUpdateEvent({
        type: "Update",
        originClientId: null,
        defaultAuthorizationStateVersion: clock.now(),
        actions: [],
        backfillTasks: [{type: "Unauthorized", taskId: task1a.id}],
        backfillCollections: [],
        referencedAccounts: [account1],
    });

    expect(getTaskEntryIfExists(store, task1a.id)).toEqual({
        task: task1a,
        actions: null,
        optimisticState: null,
        authorizationState: expect.objectContaining({value: "Unauthorized"}),
    });

    store.applyUpdateEvent({
        type: "Update",
        originClientId: null,
        defaultAuthorizationStateVersion: clock.now(),
        actions: [],
        backfillTasks: [{type: "Authorized", task: task1b}],
        backfillCollections: [],
        referencedAccounts: [account1],
    });

    expect(getTaskEntryIfExists(store, task1a.id)).toEqual({
        task: task1b,
        actions: null,
        optimisticState: null,
        authorizationState: expect.objectContaining({value: "Authorized"}),
    });
});

test("backfill merges behind existing unauthorized task", () => {
    const store = createAutoRetainStore();

    const task1a = createTask(store);

    const task1b = task1a.applyAction(
        {
            type: "UpdateTask",
            time: store.clock.now(),
            taskId: task1a.id,
            taskAction: {
                type: "UpdatePriority",
                priority: "High",
            },
        },
        getSortableAccount,
    );

    const time1 = clock.now();
    const time2 = clock.now();
    const time3 = clock.now();

    expect(task1a.rawData).not.toEqual(task1b.rawData);

    expect(getTaskEntryIfExists(store, task1a.id)).toEqual(null);

    store.applyUpdateEvent({
        type: "Update",
        originClientId: null,
        defaultAuthorizationStateVersion: time1,
        actions: [],
        backfillTasks: [{type: "Authorized", task: task1a}],
        backfillCollections: [],
        referencedAccounts: [account1],
    });

    expect(getTaskEntryIfExists(store, task1a.id)).toEqual({
        task: task1a,
        actions: null,
        optimisticState: null,
        authorizationState: expect.objectContaining({value: "Authorized"}),
    });

    store.applyUpdateEvent({
        type: "Update",
        originClientId: null,
        defaultAuthorizationStateVersion: time3,
        actions: [],
        backfillTasks: [{type: "Unauthorized", taskId: task1a.id}],
        backfillCollections: [],
        referencedAccounts: [account1],
    });

    expect(getTaskEntryIfExists(store, task1a.id)).toEqual({
        task: task1a,
        actions: null,
        optimisticState: null,
        authorizationState: expect.objectContaining({value: "Unauthorized"}),
    });

    store.applyUpdateEvent({
        type: "Update",
        originClientId: null,
        defaultAuthorizationStateVersion: time2,
        actions: [],
        backfillTasks: [{type: "Authorized", task: task1b}],
        backfillCollections: [],
        referencedAccounts: [account1],
    });

    expect(getTaskEntryIfExists(store, task1a.id)).toEqual({
        task: task1b,
        actions: null,
        optimisticState: null,
        authorizationState: expect.objectContaining({value: "Unauthorized"}),
    });
});

test("backfill adds task behind existing unauthorized task", () => {
    const store = createAutoRetainStore();

    const task1a = createTask(store);

    const task1b = task1a.applyAction(
        {
            type: "UpdateTask",
            time: store.clock.now(),
            taskId: task1a.id,
            taskAction: {
                type: "UpdatePriority",
                priority: "High",
            },
        },
        getSortableAccount,
    );

    const time1 = clock.now();
    const time2 = clock.now();

    expect(task1a.rawData).not.toEqual(task1b.rawData);

    expect(getTaskEntryIfExists(store, task1a.id)).toEqual(null);

    store.applyUpdateEvent({
        type: "Update",
        originClientId: null,
        defaultAuthorizationStateVersion: time2,
        actions: [],
        backfillTasks: [{type: "Unauthorized", taskId: task1a.id}],
        backfillCollections: [],
        referencedAccounts: [account1],
    });

    expect(getTaskEntryIfExists(store, task1a.id)).toEqual({
        task: null,
        actions: [],
        optimisticState: null,
        authorizationState: expect.objectContaining({value: "Unauthorized"}),
    });

    store.applyUpdateEvent({
        type: "Update",
        originClientId: null,
        defaultAuthorizationStateVersion: time1,
        actions: [],
        backfillTasks: [{type: "Authorized", task: task1b}],
        backfillCollections: [],
        referencedAccounts: [account1],
    });

    expect(getTaskEntryIfExists(store, task1a.id)).toEqual({
        task: task1b,
        actions: null,
        optimisticState: null,
        authorizationState: expect.objectContaining({value: "Unauthorized"}),
    });
});

test("action is applied to authorized task", () => {
    const store = createAutoRetainStore();

    const task1a = createTask(store);

    const action1a: TaskAction = {
        type: "UpdateTask",
        time: store.clock.now(),
        taskId: task1a.id,
        taskAction: {
            type: "UpdatePriority",
            priority: "High",
        },
    };

    const task1b = task1a.applyAction(action1a, getSortableAccount);

    expect(task1a.rawData).not.toEqual(task1b.rawData);

    expect(getTaskEntryIfExists(store, task1a.id)).toEqual(null);

    store.applyUpdateEvent({
        type: "Update",
        originClientId: null,
        defaultAuthorizationStateVersion: clock.now(),
        actions: [],
        backfillTasks: [{type: "Authorized", task: task1a}],
        backfillCollections: [],
        referencedAccounts: [account1],
    });

    expect(getTaskEntryIfExists(store, task1a.id)).toEqual({
        task: task1a,
        actions: null,
        optimisticState: null,
        authorizationState: expect.objectContaining({value: "Authorized"}),
    });

    store.applyUpdateEvent({
        type: "Update",
        originClientId: null,
        defaultAuthorizationStateVersion: clock.now(),
        actions: [action1a],
        backfillTasks: [],
        backfillCollections: [],
        referencedAccounts: [],
    });

    expect(getTaskEntryIfExists(store, task1a.id)).toEqual({
        task: task1b,
        actions: null,
        optimisticState: null,
        authorizationState: expect.objectContaining({value: "Authorized"}),
    });
});

test("action is applied to unauthorized task", () => {
    const store = createAutoRetainStore();

    const task1a = createTask(store);

    const action1a: TaskAction = {
        type: "UpdateTask",
        time: store.clock.now(),
        taskId: task1a.id,
        taskAction: {
            type: "UpdatePriority",
            priority: "High",
        },
    };

    expect(getTaskEntryIfExists(store, task1a.id)).toEqual(null);

    store.applyUpdateEvent({
        type: "Update",
        originClientId: null,
        defaultAuthorizationStateVersion: clock.now(),
        actions: [],
        backfillTasks: [{type: "Authorized", task: task1a}],
        backfillCollections: [],
        referencedAccounts: [account1],
    });

    expect(getTaskEntryIfExists(store, task1a.id)).toEqual({
        task: task1a,
        actions: null,
        optimisticState: null,
        authorizationState: expect.objectContaining({value: "Authorized"}),
    });

    store.applyUpdateEvent({
        type: "Update",
        originClientId: null,
        defaultAuthorizationStateVersion: clock.now(),
        actions: [],
        backfillTasks: [{type: "Unauthorized", taskId: task1a.id}],
        backfillCollections: [],
        referencedAccounts: [],
    });

    expect(getTaskEntryIfExists(store, task1a.id)).toEqual({
        task: task1a,
        actions: null,
        optimisticState: null,
        authorizationState: expect.objectContaining({value: "Unauthorized"}),
    });

    store.applyUpdateEvent({
        type: "Update",
        originClientId: null,
        defaultAuthorizationStateVersion: clock.now(),
        actions: [action1a],
        backfillTasks: [],
        backfillCollections: [],
        referencedAccounts: [],
    });

    expect(task1a.rawData).not.toEqual(task1a.applyAction(action1a, getSortableAccount).rawData);

    expect(getTaskEntryIfExists(store, task1a.id)).toEqual({
        task: task1a.applyAction(action1a, getSortableAccount),
        actions: null,
        optimisticState: null,
        authorizationState: expect.objectContaining({value: "Unauthorized"}),
    });
});

test("actions can be applied out of order", () => {
    const store = createAutoRetainStore();

    const task1a = createTask(store);

    const action1a: TaskAction = {
        type: "UpdateTask",
        time: store.clock.now(),
        taskId: task1a.id,
        taskAction: {
            type: "UpdatePriority",
            priority: "High",
        },
    };

    expect(getTaskEntryIfExists(store, task1a.id)).toEqual(null);

    store.applyUpdateEvent({
        type: "Update",
        originClientId: null,
        defaultAuthorizationStateVersion: clock.now(),
        actions: [action1a],
        backfillTasks: [],
        backfillCollections: [],
        referencedAccounts: [],
    });

    expect(getTaskEntryIfExists(store, task1a.id)).toEqual({
        task: null,
        actions: [action1a],
        optimisticState: null,
        authorizationState: null,
    });

    store.applyUpdateEvent({
        type: "Update",
        originClientId: null,
        defaultAuthorizationStateVersion: clock.now(),
        actions: [],
        backfillTasks: [{type: "Authorized", task: task1a}],
        backfillCollections: [],
        referencedAccounts: [account1],
    });

    expect(task1a.rawData).not.toEqual(task1a.applyAction(action1a, getSortableAccount).rawData);

    expect(getTaskEntryIfExists(store, task1a.id)).toEqual({
        task: task1a.applyAction(action1a, getSortableAccount),
        actions: null,
        optimisticState: null,
        authorizationState: expect.objectContaining({value: "Authorized"}),
    });
});

test("actions can be applied out of order to unauthorized tasks", () => {
    const store = createAutoRetainStore();

    const task1a = createTask(store);

    const action1a: TaskAction = {
        type: "UpdateTask",
        time: store.clock.now(),
        taskId: task1a.id,
        taskAction: {
            type: "UpdatePriority",
            priority: "High",
        },
    };

    expect(getTaskEntryIfExists(store, task1a.id)).toEqual(null);

    store.applyUpdateEvent({
        type: "Update",
        originClientId: null,
        defaultAuthorizationStateVersion: clock.now(),
        actions: [],
        backfillTasks: [{type: "Unauthorized", taskId: task1a.id}],
        backfillCollections: [],
        referencedAccounts: [],
    });

    expect(getTaskEntryIfExists(store, task1a.id)).toEqual({
        task: null,
        actions: [],
        optimisticState: null,
        authorizationState: expect.objectContaining({value: "Unauthorized"}),
    });

    store.applyUpdateEvent({
        type: "Update",
        originClientId: null,
        defaultAuthorizationStateVersion: clock.now(),
        actions: [action1a],
        backfillTasks: [],
        backfillCollections: [],
        referencedAccounts: [],
    });

    expect(getTaskEntryIfExists(store, task1a.id)).toEqual({
        task: null,
        actions: [action1a],
        optimisticState: null,
        authorizationState: expect.objectContaining({value: "Unauthorized"}),
    });

    store.applyUpdateEvent({
        type: "Update",
        originClientId: null,
        defaultAuthorizationStateVersion: clock.now(),
        actions: [],
        backfillTasks: [{type: "Authorized", task: task1a}],
        backfillCollections: [],
        referencedAccounts: [account1],
    });

    expect(task1a.rawData).not.toEqual(task1a.applyAction(action1a, getSortableAccount).rawData);

    expect(getTaskEntryIfExists(store, task1a.id)).toEqual({
        task: task1a.applyAction(action1a, getSortableAccount),
        actions: null,
        optimisticState: null,
        authorizationState: expect.objectContaining({value: "Authorized"}),
    });
});

test("if nothing changes in the task entry after action it’s left as same reference", () => {
    const store = createAutoRetainStore();

    const task1a = createTask(store);

    const action1a: TaskAction = {
        type: "UpdateTask",
        time: store.clock.now(),
        taskId: task1a.id,
        taskAction: {
            type: "UpdatePriority",
            priority: "High",
        },
    };

    expect(getTaskEntryIfExists(store, task1a.id)).toEqual(null);

    store.applyUpdateEvent({
        type: "Update",
        originClientId: null,
        defaultAuthorizationStateVersion: clock.now(),
        actions: [],
        backfillTasks: [{type: "Authorized", task: task1a}],
        backfillCollections: [],
        referencedAccounts: [],
    });

    expect(getTaskEntryIfExists(store, task1a.id)).toEqual({
        task: task1a,
        actions: null,
        optimisticState: null,
        authorizationState: expect.objectContaining({value: "Authorized"}),
    });

    store.applyUpdateEvent({
        type: "Update",
        originClientId: null,
        defaultAuthorizationStateVersion: clock.now(),
        actions: [action1a],
        backfillTasks: [],
        backfillCollections: [],
        referencedAccounts: [],
    });

    expect(task1a.rawData).not.toEqual(task1a.applyAction(action1a, getSortableAccount).rawData);

    const taskEntry = getTaskEntryIfExists(store, task1a.id);

    expect(taskEntry).toEqual({
        task: task1a.applyAction(action1a, getSortableAccount),
        actions: null,
        optimisticState: null,
        authorizationState: expect.objectContaining({value: "Authorized"}),
    });

    store.applyUpdateEvent({
        type: "Update",
        originClientId: null,
        defaultAuthorizationStateVersion: clock.now(),
        actions: [action1a],
        backfillTasks: [],
        backfillCollections: [],
        referencedAccounts: [],
    });

    expect(getTaskEntryIfExists(store, task1a.id)).toBe(taskEntry);
});

test("if nothing changes in the task entry after backfill it’s left as same reference", () => {
    const store = createAutoRetainStore();

    const task1a = createTask(store);

    const action1a: TaskAction = {
        type: "UpdateTask",
        time: store.clock.now(),
        taskId: task1a.id,
        taskAction: {
            type: "UpdatePriority",
            priority: "High",
        },
    };

    const time1 = clock.now();
    const time2 = clock.now();
    const time3 = clock.now();

    expect(getTaskEntryIfExists(store, task1a.id)).toEqual(null);

    store.applyUpdateEvent({
        type: "Update",
        originClientId: null,
        defaultAuthorizationStateVersion: time2,
        actions: [],
        backfillTasks: [{type: "Authorized", task: task1a}],
        backfillCollections: [],
        referencedAccounts: [],
    });

    expect(getTaskEntryIfExists(store, task1a.id)).toEqual({
        task: task1a,
        actions: null,
        optimisticState: null,
        authorizationState: expect.objectContaining({value: "Authorized"}),
    });

    store.applyUpdateEvent({
        type: "Update",
        originClientId: null,
        defaultAuthorizationStateVersion: time3,
        actions: [action1a],
        backfillTasks: [],
        backfillCollections: [],
        referencedAccounts: [],
    });

    expect(task1a.rawData).not.toEqual(task1a.applyAction(action1a, getSortableAccount).rawData);

    const taskEntry = getTaskEntryIfExists(store, task1a.id);

    expect(taskEntry).toEqual({
        task: task1a.applyAction(action1a, getSortableAccount),
        actions: null,
        optimisticState: null,
        authorizationState: expect.objectContaining({value: "Authorized"}),
    });

    store.applyUpdateEvent({
        type: "Update",
        originClientId: null,
        defaultAuthorizationStateVersion: time1,
        actions: [],
        backfillTasks: [
            {type: "Authorized", task: task1a.applyAction(action1a, getSortableAccount)},
        ],
        backfillCollections: [],
        referencedAccounts: [],
    });

    expect(getTaskEntryIfExists(store, task1a.id)).toBe(taskEntry);
});

test("action can be applied then task can be marked unauthorized", () => {
    const store = createAutoRetainStore();

    const task1a = createTask(store);

    const action1a: TaskAction = {
        type: "UpdateTask",
        time: store.clock.now(),
        taskId: task1a.id,
        taskAction: {
            type: "UpdatePriority",
            priority: "High",
        },
    };

    expect(getTaskEntryIfExists(store, task1a.id)).toEqual(null);

    store.applyUpdateEvent({
        type: "Update",
        originClientId: null,
        defaultAuthorizationStateVersion: clock.now(),
        actions: [action1a],
        backfillTasks: [],
        backfillCollections: [],
        referencedAccounts: [],
    });

    expect(getTaskEntryIfExists(store, task1a.id)).toEqual({
        task: null,
        actions: [action1a],
        optimisticState: null,
        authorizationState: null,
    });

    store.applyUpdateEvent({
        type: "Update",
        originClientId: null,
        defaultAuthorizationStateVersion: clock.now(),
        actions: [],
        backfillTasks: [{type: "Unauthorized", taskId: task1a.id}],
        backfillCollections: [],
        referencedAccounts: [],
    });

    expect(getTaskEntryIfExists(store, task1a.id)).toEqual({
        task: null,
        actions: [action1a],
        optimisticState: null,
        authorizationState: expect.objectContaining({value: "Unauthorized"}),
    });
});

test("redundant unauthorized action doesn’t change task", () => {
    const store = createAutoRetainStore();

    const task1a = createTask(store);

    const action1a: TaskAction = {
        type: "UpdateTask",
        time: store.clock.now(),
        taskId: task1a.id,
        taskAction: {
            type: "UpdatePriority",
            priority: "High",
        },
    };

    expect(getTaskEntryIfExists(store, task1a.id)).toEqual(null);

    const time1 = clock.now();
    const time2 = clock.now();
    const time3 = clock.now();

    store.applyUpdateEvent({
        type: "Update",
        originClientId: null,
        defaultAuthorizationStateVersion: time2,
        actions: [],
        backfillTasks: [{type: "Unauthorized", taskId: task1a.id}],
        backfillCollections: [],
        referencedAccounts: [],
    });

    expect(getTaskEntryIfExists(store, task1a.id)).toEqual({
        task: null,
        actions: [],
        optimisticState: null,
        authorizationState: expect.objectContaining({value: "Unauthorized"}),
    });

    store.applyUpdateEvent({
        type: "Update",
        originClientId: null,
        defaultAuthorizationStateVersion: time3,
        actions: [action1a],
        backfillTasks: [],
        backfillCollections: [],
        referencedAccounts: [],
    });

    const taskEntry = getTaskEntryIfExists(store, task1a.id);

    expect(taskEntry).toEqual({
        task: null,
        actions: [action1a],
        optimisticState: null,
        authorizationState: expect.objectContaining({value: "Unauthorized"}),
    });

    store.applyUpdateEvent({
        type: "Update",
        originClientId: null,
        defaultAuthorizationStateVersion: time1,
        actions: [],
        backfillTasks: [{type: "Unauthorized", taskId: task1a.id}],
        backfillCollections: [],
        referencedAccounts: [],
    });

    expect(getTaskEntryIfExists(store, task1a.id)).toBe(taskEntry);
});

test("create action will create a task", () => {
    const store = createAutoRetainStore();

    const action = {
        type: "UpdateTask",
        time: store.clock.now(),
        taskId: generateId(),
        taskAction: {
            type: "Create",
            creatorId: account1.id,
            creatorTimeZone: defaultTimeZone,
        },
    } satisfies TaskAction;

    expect(getTaskEntryIfExists(store, action.taskId)).toEqual(null);

    store.applyUpdateEvent({
        type: "Update",
        originClientId: null,
        defaultAuthorizationStateVersion: clock.now(),
        actions: [action],
        backfillTasks: [],
        backfillCollections: [],
        referencedAccounts: [account1],
    });

    expect(getTaskEntryIfExists(store, action.taskId)).toEqual({
        task: createTask(store, {
            id: action.taskId,
            time: action.time,
            taskAction: action.taskAction,
        }),
        actions: null,
        optimisticState: null,
        authorizationState: expect.objectContaining({value: "Authorized"}),
    });
});

test("can receive create action out of order", () => {
    const store = createAutoRetainStore();

    const action1 = {
        type: "UpdateTask",
        time: store.clock.now(),
        taskId: generateId(),
        taskAction: {
            type: "UpdatePriority",
            priority: "High",
        },
    } satisfies TaskAction;

    const action2 = {
        type: "UpdateTask",
        time: store.clock.now(),
        taskId: action1.taskId,
        taskAction: {
            type: "Create",
            creatorId: account1.id,
            creatorTimeZone: defaultTimeZone,
        },
    } satisfies TaskAction;

    expect(getTaskEntryIfExists(store, action2.taskId)).toEqual(null);

    store.applyUpdateEvent({
        type: "Update",
        originClientId: null,
        defaultAuthorizationStateVersion: clock.now(),
        actions: [action1],
        backfillTasks: [],
        backfillCollections: [],
        referencedAccounts: [],
    });

    expect(getTaskEntryIfExists(store, action1.taskId)).toEqual({
        task: null,
        actions: [action1],
        optimisticState: null,
        authorizationState: null,
    });

    store.applyUpdateEvent({
        type: "Update",
        originClientId: null,
        defaultAuthorizationStateVersion: clock.now(),
        actions: [action2],
        backfillTasks: [],
        backfillCollections: [],
        referencedAccounts: [account1],
    });

    expect(getTaskEntryIfExists(store, action1.taskId)).toEqual({
        task: createTask(store, {
            id: action2.taskId,
            time: action2.time,
            taskAction: action2.taskAction,
        }).applyAction(action1, getSortableAccount),
        actions: null,
        optimisticState: null,
        authorizationState: expect.objectContaining({value: "Authorized"}),
    });
});

test("can receive create action with another action within a transaction", () => {
    const store = createAutoRetainStore();

    const action1 = {
        type: "UpdateTask",
        time: store.clock.now(),
        taskId: generateId(),
        taskAction: {
            type: "Create",
            creatorId: account1.id,
            creatorTimeZone: defaultTimeZone,
        },
    } satisfies TaskAction;

    const action2 = {
        type: "UpdateTask",
        time: store.clock.now(),
        taskId: action1.taskId,
        taskAction: {
            type: "UpdatePriority",
            priority: "High",
        },
    } satisfies TaskAction;

    expect(getTaskEntryIfExists(store, action1.taskId)).toEqual(null);

    store.applyUpdateEvent({
        type: "Update",
        originClientId: null,
        defaultAuthorizationStateVersion: clock.now(),
        actions: [action1, action2],
        backfillTasks: [],
        backfillCollections: [],
        referencedAccounts: [account1],
    });

    expect(getTaskEntryIfExists(store, action1.taskId)).toEqual({
        task: createTask(store, {
            id: action1.taskId,
            time: action1.time,
            taskAction: action1.taskAction,
        }).applyAction(action2, getSortableAccount),
        actions: null,
        optimisticState: null,
        authorizationState: expect.objectContaining({value: "Authorized"}),
    });
});

test("can receive create action out of order within a transaction", () => {
    const store = createAutoRetainStore();

    const action1 = {
        type: "UpdateTask",
        time: store.clock.now(),
        taskId: generateId(),
        taskAction: {
            type: "UpdatePriority",
            priority: "High",
        },
    } satisfies TaskAction;

    const action2 = {
        type: "UpdateTask",
        time: store.clock.now(),
        taskId: action1.taskId,
        taskAction: {
            type: "Create",
            creatorId: account1.id,
            creatorTimeZone: defaultTimeZone,
        },
    } satisfies TaskAction;

    expect(getTaskEntryIfExists(store, action2.taskId)).toEqual(null);

    store.applyUpdateEvent({
        type: "Update",
        originClientId: null,
        defaultAuthorizationStateVersion: clock.now(),
        actions: [action1, action2],
        backfillTasks: [],
        backfillCollections: [],
        referencedAccounts: [account1],
    });

    expect(getTaskEntryIfExists(store, action1.taskId)).toEqual({
        task: createTask(store, {
            id: action2.taskId,
            time: action2.time,
            taskAction: action2.taskAction,
        }).applyAction(action1, getSortableAccount),
        actions: null,
        optimisticState: null,
        authorizationState: expect.objectContaining({value: "Authorized"}),
    });
});

test("applies commit action calls optimistically", async () => {
    const store = createAutoRetainStore();

    const task = createTask(store);

    expect(getTaskEntryIfExists(store, task.id)).toEqual(null);

    store.applyUpdateEvent({
        type: "Update",
        originClientId: null,
        defaultAuthorizationStateVersion: clock.now(),
        actions: [],
        backfillTasks: [{type: "Authorized", task: task}],
        backfillCollections: [],
        referencedAccounts: [],
    });

    expect(getTaskEntryIfExists(store, task.id)).toEqual({
        task,
        actions: null,
        optimisticState: null,
        authorizationState: expect.objectContaining({value: "Authorized"}),
    });

    const action = {
        type: "UpdateTask",
        time: store.clock.now(),
        taskId: task.id,
        taskAction: {
            type: "UpdatePriority",
            priority: "High",
        },
    } satisfies TaskAction;

    store.commitTaskActionTransaction(context, [action], {
        undoManager: null,
        affinityManager: noopAffinityManager,
    });

    expect(getTaskEntryIfExists(store, task.id)).toEqual({
        task: task.applyAction(action, getSortableAccount),
        actions: null,
        optimisticState: {
            original: {
                task,
                actions: null,
            },
            actions: [{isOptimistic: true, action}],
        },
        authorizationState: expect.objectContaining({value: "Authorized"}),
    });

    await resolveLastRpcExecution(commitTaskActionTransaction, {
        extraActions: [],
        referencedAccounts: [],
    });

    expect(getTaskEntryIfExists(store, task.id)).toEqual({
        task: task.applyAction(action, getSortableAccount),
        actions: null,
        optimisticState: null,
        authorizationState: expect.objectContaining({value: "Authorized"}),
    });
});

test("can create tasks optimistically", async () => {
    const store = createAutoRetainStore();

    const action1 = {
        type: "UpdateTask",
        time: store.clock.now(),
        taskId: generateId(),
        taskAction: {
            type: "Create",
            creatorId: account1.id,
            creatorTimeZone: defaultTimeZone,
        },
    } satisfies TaskAction;

    expect(getTaskEntryIfExists(store, action1.taskId)).toEqual(null);

    store.commitTaskActionTransaction(context, [action1], {
        undoManager: null,
        affinityManager: noopAffinityManager,
    });

    expect(getTaskEntryIfExists(store, action1.taskId)).toEqual({
        task: createTask(store, {
            id: action1.taskId,
            time: action1.time,
            taskAction: action1.taskAction,
        }),
        actions: null,
        optimisticState: {
            original: {
                task: null,
                actions: [],
            },
            actions: [{isOptimistic: true, action: action1}],
        },
        authorizationState: expect.objectContaining({
            value: "Authorized",
            version: zeroHybridLogicalTime,
        }),
    });

    await resolveLastRpcExecution(commitTaskActionTransaction, {
        extraActions: [],
        referencedAccounts: [],
    });

    expect(getTaskEntryIfExists(store, action1.taskId)).toEqual({
        task: createTask(store, {
            id: action1.taskId,
            time: action1.time,
            taskAction: action1.taskAction,
        }),
        actions: null,
        optimisticState: null,
        authorizationState: expect.objectContaining({
            value: "Authorized",
            version: zeroHybridLogicalTime,
        }),
    });
});

test("can create then update tasks optimistically", async () => {
    const store = createAutoRetainStore();

    const action1 = {
        type: "UpdateTask",
        time: store.clock.now(),
        taskId: generateId(),
        taskAction: {
            type: "Create",
            creatorId: account1.id,
            creatorTimeZone: defaultTimeZone,
        },
    } satisfies TaskAction;

    const action2 = {
        type: "UpdateTask",
        time: store.clock.now(),
        taskId: action1.taskId,
        taskAction: {
            type: "UpdatePriority",
            priority: "High",
        },
    } satisfies TaskAction;

    expect(getTaskEntryIfExists(store, action1.taskId)).toEqual(null);

    store.commitTaskActionTransaction(context, [action1], {
        undoManager: null,
        affinityManager: noopAffinityManager,
    });

    expect(getTaskEntryIfExists(store, action1.taskId)).toEqual({
        task: createTask(store, {
            id: action1.taskId,
            time: action1.time,
            taskAction: action1.taskAction,
        }),
        actions: null,
        optimisticState: {
            original: {
                task: null,
                actions: [],
            },
            actions: [{isOptimistic: true, action: action1}],
        },
        authorizationState: expect.objectContaining({
            value: "Authorized",
            version: zeroHybridLogicalTime,
        }),
    });

    store.commitTaskActionTransaction(context, [action2], {
        undoManager: null,
        affinityManager: noopAffinityManager,
    });

    expect(getTaskEntryIfExists(store, action1.taskId)).toEqual({
        task: createTask(store, {
            id: action1.taskId,
            time: action1.time,
            taskAction: action1.taskAction,
        }).applyAction(action2, getSortableAccount),
        actions: null,
        optimisticState: {
            original: {
                task: null,
                actions: [],
            },
            actions: [
                {isOptimistic: true, action: action1},
                {isOptimistic: true, action: action2},
            ],
        },
        authorizationState: expect.objectContaining({
            value: "Authorized",
            version: zeroHybridLogicalTime,
        }),
    });

    await resolveRpcExecution(commitTaskActionTransaction, 0, {
        extraActions: [],
        referencedAccounts: [],
    });

    expect(getTaskEntryIfExists(store, action1.taskId)).toEqual({
        task: createTask(store, {
            id: action1.taskId,
            time: action1.time,
            taskAction: action1.taskAction,
        }).applyAction(action2, getSortableAccount),
        actions: null,
        optimisticState: {
            original: {
                task: createTask(store, {
                    id: action1.taskId,
                    time: action1.time,
                    taskAction: action1.taskAction,
                }),
                actions: null,
            },
            actions: [{isOptimistic: true, action: action2}],
        },
        authorizationState: expect.objectContaining({
            value: "Authorized",
            version: zeroHybridLogicalTime,
        }),
    });

    await resolveRpcExecution(commitTaskActionTransaction, 1, {
        extraActions: [],
        referencedAccounts: [],
    });

    expect(getTaskEntryIfExists(store, action1.taskId)).toEqual({
        task: createTask(store, {
            id: action1.taskId,
            time: action1.time,
            taskAction: action1.taskAction,
        }).applyAction(action2, getSortableAccount),
        actions: null,
        optimisticState: null,
        authorizationState: expect.objectContaining({
            value: "Authorized",
            version: zeroHybridLogicalTime,
        }),
    });
});

test("can create then update tasks optimistically and resolve commits out of order", async () => {
    const store = createAutoRetainStore();

    const action1 = {
        type: "UpdateTask",
        time: store.clock.now(),
        taskId: generateId(),
        taskAction: {
            type: "Create",
            creatorId: account1.id,
            creatorTimeZone: defaultTimeZone,
        },
    } satisfies TaskAction;

    const action2 = {
        type: "UpdateTask",
        time: store.clock.now(),
        taskId: action1.taskId,
        taskAction: {
            type: "UpdatePriority",
            priority: "High",
        },
    } satisfies TaskAction;

    expect(getTaskEntryIfExists(store, action1.taskId)).toEqual(null);

    store.commitTaskActionTransaction(context, [action1], {
        undoManager: null,
        affinityManager: noopAffinityManager,
    });

    expect(getTaskEntryIfExists(store, action1.taskId)).toEqual({
        task: createTask(store, {
            id: action1.taskId,
            time: action1.time,
            taskAction: action1.taskAction,
        }),
        actions: null,
        optimisticState: {
            original: {
                task: null,
                actions: [],
            },
            actions: [{isOptimistic: true, action: action1}],
        },
        authorizationState: expect.objectContaining({
            value: "Authorized",
            version: zeroHybridLogicalTime,
        }),
    });

    store.commitTaskActionTransaction(context, [action2], {
        undoManager: null,
        affinityManager: noopAffinityManager,
    });

    expect(getTaskEntryIfExists(store, action1.taskId)).toEqual({
        task: createTask(store, {
            id: action1.taskId,
            time: action1.time,
            taskAction: action1.taskAction,
        }).applyAction(action2, getSortableAccount),
        actions: null,
        optimisticState: {
            original: {
                task: null,
                actions: [],
            },
            actions: [
                {isOptimistic: true, action: action1},
                {isOptimistic: true, action: action2},
            ],
        },
        authorizationState: expect.objectContaining({
            value: "Authorized",
            version: zeroHybridLogicalTime,
        }),
    });

    await resolveRpcExecution(commitTaskActionTransaction, 1, {
        extraActions: [],
        referencedAccounts: [],
    });

    expect(getTaskEntryIfExists(store, action1.taskId)).toEqual({
        task: createTask(store, {
            id: action1.taskId,
            time: action1.time,
            taskAction: action1.taskAction,
        }).applyAction(action2, getSortableAccount),
        actions: null,
        optimisticState: {
            original: {
                task: null,
                actions: [action2],
            },
            actions: [{isOptimistic: true, action: action1}],
        },
        authorizationState: expect.objectContaining({
            value: "Authorized",
            version: zeroHybridLogicalTime,
        }),
    });

    await resolveRpcExecution(commitTaskActionTransaction, 0, {
        extraActions: [],
        referencedAccounts: [],
    });

    expect(getTaskEntryIfExists(store, action1.taskId)).toEqual({
        task: createTask(store, {
            id: action1.taskId,
            time: action1.time,
            taskAction: action1.taskAction,
        }).applyAction(action2, getSortableAccount),
        actions: null,
        optimisticState: null,
        authorizationState: expect.objectContaining({
            value: "Authorized",
            version: zeroHybridLogicalTime,
        }),
    });
});

test("can create then update tasks optimistically after an action from the server", async () => {
    const store = createAutoRetainStore();

    const action2Time = store.clock.now();

    const action1 = {
        type: "UpdateTask",
        time: store.clock.now(),
        taskId: generateId(),
        taskAction: {
            type: "UpdateDueDate",
            dueDate: new CalendarDate(1998, 7, 12),
        },
    } satisfies TaskAction;

    const action2 = {
        type: "UpdateTask",
        time: action2Time,
        taskId: action1.taskId,
        taskAction: {
            type: "Create",
            creatorId: account1.id,
            creatorTimeZone: defaultTimeZone,
        },
    } satisfies TaskAction;

    const action3 = {
        type: "UpdateTask",
        time: store.clock.now(),
        taskId: action2.taskId,
        taskAction: {
            type: "UpdatePriority",
            priority: "High",
        },
    } satisfies TaskAction;

    expect(getTaskEntryIfExists(store, action2.taskId)).toEqual(null);

    store.applyUpdateEvent({
        type: "Update",
        originClientId: null,
        defaultAuthorizationStateVersion: clock.now(),
        actions: [action1],
        backfillTasks: [],
        backfillCollections: [],
        referencedAccounts: [],
    });

    expect(getTaskEntryIfExists(store, action2.taskId)).toEqual({
        task: null,
        actions: [action1],
        optimisticState: null,
        authorizationState: null,
    });

    store.commitTaskActionTransaction(context, [action2], {
        undoManager: null,
        affinityManager: noopAffinityManager,
    });

    expect(getTaskEntryIfExists(store, action2.taskId)).toEqual({
        task: createTask(store, {
            id: action2.taskId,
            time: action2.time,
            taskAction: action2.taskAction,
        }).applyAction(action1, getSortableAccount),
        actions: null,
        optimisticState: {
            original: {
                task: null,
                actions: [action1],
            },
            actions: [{isOptimistic: true, action: action2}],
        },
        authorizationState: expect.objectContaining({
            value: "Authorized",
            version: zeroHybridLogicalTime,
        }),
    });

    store.commitTaskActionTransaction(context, [action3], {
        undoManager: null,
        affinityManager: noopAffinityManager,
    });

    expect(getTaskEntryIfExists(store, action2.taskId)).toEqual({
        task: createTask(store, {
            id: action2.taskId,
            time: action2.time,
            taskAction: action2.taskAction,
        })
            .applyAction(action1, getSortableAccount)
            .applyAction(action3, getSortableAccount),
        actions: null,
        optimisticState: {
            original: {
                task: null,
                actions: [action1],
            },
            actions: [
                {isOptimistic: true, action: action2},
                {isOptimistic: true, action: action3},
            ],
        },
        authorizationState: expect.objectContaining({
            value: "Authorized",
            version: zeroHybridLogicalTime,
        }),
    });

    await resolveRpcExecution(commitTaskActionTransaction, 0, {
        extraActions: [],
        referencedAccounts: [],
    });

    expect(getTaskEntryIfExists(store, action2.taskId)).toEqual({
        task: createTask(store, {
            id: action2.taskId,
            time: action2.time,
            taskAction: action2.taskAction,
        })
            .applyAction(action1, getSortableAccount)
            .applyAction(action3, getSortableAccount),
        actions: null,
        optimisticState: {
            original: {
                task: createTask(store, {
                    id: action2.taskId,
                    time: action2.time,
                    taskAction: action2.taskAction,
                }).applyAction(action1, getSortableAccount),
                actions: null,
            },
            actions: [{isOptimistic: true, action: action3}],
        },
        authorizationState: expect.objectContaining({
            value: "Authorized",
            version: zeroHybridLogicalTime,
        }),
    });

    await resolveRpcExecution(commitTaskActionTransaction, 1, {
        extraActions: [],
        referencedAccounts: [],
    });

    expect(getTaskEntryIfExists(store, action2.taskId)).toEqual({
        task: createTask(store, {
            id: action2.taskId,
            time: action2.time,
            taskAction: action2.taskAction,
        })
            .applyAction(action1, getSortableAccount)
            .applyAction(action3, getSortableAccount),
        actions: null,
        optimisticState: null,
        authorizationState: expect.objectContaining({
            value: "Authorized",
            version: zeroHybridLogicalTime,
        }),
    });
});

test("can create then update tasks optimistically our of order", async () => {
    const store = createAutoRetainStore();

    const action1 = {
        type: "UpdateTask",
        time: store.clock.now(),
        taskId: generateId(),
        taskAction: {
            type: "Create",
            creatorId: account1.id,
            creatorTimeZone: defaultTimeZone,
        },
    } satisfies TaskAction;

    const action2 = {
        type: "UpdateTask",
        time: store.clock.now(),
        taskId: action1.taskId,
        taskAction: {
            type: "UpdatePriority",
            priority: "High",
        },
    } satisfies TaskAction;

    expect(getTaskEntryIfExists(store, action1.taskId)).toEqual(null);

    store.commitTaskActionTransaction(context, [action2], {
        undoManager: null,
        affinityManager: noopAffinityManager,
    });

    expect(getTaskEntryIfExists(store, action1.taskId)).toEqual({
        task: null,
        actions: [action2],
        optimisticState: {
            original: {
                task: null,
                actions: [],
            },
            actions: [{isOptimistic: true, action: action2}],
        },
        authorizationState: null,
    });

    store.commitTaskActionTransaction(context, [action1], {
        undoManager: null,
        affinityManager: noopAffinityManager,
    });

    expect(getTaskEntryIfExists(store, action1.taskId)).toEqual({
        task: createTask(store, {
            id: action1.taskId,
            time: action1.time,
            taskAction: action1.taskAction,
        }).applyAction(action2, getSortableAccount),
        actions: null,
        optimisticState: {
            original: {
                task: null,
                actions: [],
            },
            actions: [
                {isOptimistic: true, action: action2},
                {isOptimistic: true, action: action1},
            ],
        },
        authorizationState: expect.objectContaining({
            value: "Authorized",
            version: zeroHybridLogicalTime,
        }),
    });

    await resolveRpcExecution(commitTaskActionTransaction, 0, {
        extraActions: [],
        referencedAccounts: [],
    });

    expect(getTaskEntryIfExists(store, action1.taskId)).toEqual({
        task: createTask(store, {
            id: action1.taskId,
            time: action1.time,
            taskAction: action1.taskAction,
        }).applyAction(action2, getSortableAccount),
        actions: null,
        optimisticState: {
            original: {
                task: null,
                actions: [action2],
            },
            actions: [{isOptimistic: true, action: action1}],
        },
        authorizationState: expect.objectContaining({
            value: "Authorized",
            version: zeroHybridLogicalTime,
        }),
    });

    await resolveRpcExecution(commitTaskActionTransaction, 1, {
        extraActions: [],
        referencedAccounts: [],
    });

    expect(getTaskEntryIfExists(store, action1.taskId)).toEqual({
        task: createTask(store, {
            id: action1.taskId,
            time: action1.time,
            taskAction: action1.taskAction,
        }).applyAction(action2, getSortableAccount),
        actions: null,
        optimisticState: null,
        authorizationState: expect.objectContaining({
            value: "Authorized",
            version: zeroHybridLogicalTime,
        }),
    });
});

test("can create then update tasks optimistically out of order after an action from the server", async () => {
    const store = createAutoRetainStore();

    const action2Time = store.clock.now();

    const action1 = {
        type: "UpdateTask",
        time: store.clock.now(),
        taskId: generateId(),
        taskAction: {
            type: "UpdateDueDate",
            dueDate: new CalendarDate(1998, 7, 12),
        },
    } satisfies TaskAction;

    const action2 = {
        type: "UpdateTask",
        time: action2Time,
        taskId: action1.taskId,
        taskAction: {
            type: "Create",
            creatorId: account1.id,
            creatorTimeZone: defaultTimeZone,
        },
    } satisfies TaskAction;

    const action3 = {
        type: "UpdateTask",
        time: store.clock.now(),
        taskId: action2.taskId,
        taskAction: {
            type: "UpdatePriority",
            priority: "High",
        },
    } satisfies TaskAction;

    expect(getTaskEntryIfExists(store, action2.taskId)).toEqual(null);

    store.applyUpdateEvent({
        type: "Update",
        originClientId: null,
        defaultAuthorizationStateVersion: clock.now(),
        actions: [action1],
        backfillTasks: [],
        backfillCollections: [],
        referencedAccounts: [],
    });

    expect(getTaskEntryIfExists(store, action2.taskId)).toEqual({
        task: null,
        actions: [action1],
        optimisticState: null,
        authorizationState: null,
    });

    store.commitTaskActionTransaction(context, [action3], {
        undoManager: null,
        affinityManager: noopAffinityManager,
    });

    expect(getTaskEntryIfExists(store, action2.taskId)).toEqual({
        task: null,
        actions: [action1, action3],
        optimisticState: {
            original: {
                task: null,
                actions: [action1],
            },
            actions: [{isOptimistic: true, action: action3}],
        },
        authorizationState: null,
    });

    store.commitTaskActionTransaction(context, [action2], {
        undoManager: null,
        affinityManager: noopAffinityManager,
    });

    expect(getTaskEntryIfExists(store, action2.taskId)).toEqual({
        task: createTask(store, {
            id: action2.taskId,
            time: action2.time,
            taskAction: action2.taskAction,
        })
            .applyAction(action1, getSortableAccount)
            .applyAction(action3, getSortableAccount),
        actions: null,
        optimisticState: {
            original: {
                task: null,
                actions: [action1],
            },
            actions: [
                {isOptimistic: true, action: action3},
                {isOptimistic: true, action: action2},
            ],
        },
        authorizationState: expect.objectContaining({
            value: "Authorized",
            version: zeroHybridLogicalTime,
        }),
    });

    await resolveRpcExecution(commitTaskActionTransaction, 0, {
        extraActions: [],
        referencedAccounts: [],
    });

    expect(getTaskEntryIfExists(store, action2.taskId)).toEqual({
        task: createTask(store, {
            id: action2.taskId,
            time: action2.time,
            taskAction: action2.taskAction,
        })
            .applyAction(action1, getSortableAccount)
            .applyAction(action3, getSortableAccount),
        actions: null,
        optimisticState: {
            original: {
                task: null,
                actions: [action1, action3],
            },
            actions: [{isOptimistic: true, action: action2}],
        },
        authorizationState: expect.objectContaining({
            value: "Authorized",
            version: zeroHybridLogicalTime,
        }),
    });

    await resolveRpcExecution(commitTaskActionTransaction, 1, {
        extraActions: [],
        referencedAccounts: [],
    });

    expect(getTaskEntryIfExists(store, action2.taskId)).toEqual({
        task: createTask(store, {
            id: action2.taskId,
            time: action2.time,
            taskAction: action2.taskAction,
        })
            .applyAction(action1, getSortableAccount)
            .applyAction(action3, getSortableAccount),
        actions: null,
        optimisticState: null,
        authorizationState: expect.objectContaining({
            value: "Authorized",
            version: zeroHybridLogicalTime,
        }),
    });
});

test("can create then update tasks optimistically out of order with more non-create tasks", async () => {
    const store = createAutoRetainStore();

    const action2Time = store.clock.now();

    const action1 = {
        type: "UpdateTask",
        time: store.clock.now(),
        taskId: generateId(),
        taskAction: {
            type: "UpdateDueDate",
            dueDate: new CalendarDate(1998, 7, 12),
        },
    } satisfies TaskAction;

    const action2 = {
        type: "UpdateTask",
        time: action2Time,
        taskId: action1.taskId,
        taskAction: {
            type: "Create",
            creatorId: account1.id,
            creatorTimeZone: defaultTimeZone,
        },
    } satisfies TaskAction;

    const action3 = {
        type: "UpdateTask",
        time: store.clock.now(),
        taskId: action2.taskId,
        taskAction: {
            type: "UpdatePriority",
            priority: "High",
        },
    } satisfies TaskAction;

    expect(getTaskEntryIfExists(store, action2.taskId)).toEqual(null);

    store.commitTaskActionTransaction(context, [action1], {
        undoManager: null,
        affinityManager: noopAffinityManager,
    });

    expect(getTaskEntryIfExists(store, action2.taskId)).toEqual({
        task: null,
        actions: [action1],
        optimisticState: {
            original: {
                task: null,
                actions: [],
            },
            actions: [{isOptimistic: true, action: action1}],
        },
        authorizationState: null,
    });

    store.commitTaskActionTransaction(context, [action3], {
        undoManager: null,
        affinityManager: noopAffinityManager,
    });

    expect(getTaskEntryIfExists(store, action2.taskId)).toEqual({
        task: null,
        actions: [action1, action3],
        optimisticState: {
            original: {
                task: null,
                actions: [],
            },
            actions: [
                {isOptimistic: true, action: action1},
                {isOptimistic: true, action: action3},
            ],
        },
        authorizationState: null,
    });

    store.commitTaskActionTransaction(context, [action2], {
        undoManager: null,
        affinityManager: noopAffinityManager,
    });

    expect(getTaskEntryIfExists(store, action2.taskId)).toEqual({
        task: createTask(store, {
            id: action2.taskId,
            time: action2.time,
            taskAction: action2.taskAction,
        })
            .applyAction(action1, getSortableAccount)
            .applyAction(action3, getSortableAccount),
        actions: null,
        optimisticState: {
            original: {
                task: null,
                actions: [],
            },
            actions: [
                {isOptimistic: true, action: action1},
                {isOptimistic: true, action: action3},
                {isOptimistic: true, action: action2},
            ],
        },
        authorizationState: expect.objectContaining({
            value: "Authorized",
            version: zeroHybridLogicalTime,
        }),
    });

    await resolveRpcExecution(commitTaskActionTransaction, 0, {
        extraActions: [],
        referencedAccounts: [],
    });

    expect(getTaskEntryIfExists(store, action2.taskId)).toEqual({
        task: createTask(store, {
            id: action2.taskId,
            time: action2.time,
            taskAction: action2.taskAction,
        })
            .applyAction(action1, getSortableAccount)
            .applyAction(action3, getSortableAccount),
        actions: null,
        optimisticState: {
            original: {
                task: null,
                actions: [action1],
            },
            actions: [
                {isOptimistic: true, action: action3},
                {isOptimistic: true, action: action2},
            ],
        },
        authorizationState: expect.objectContaining({
            value: "Authorized",
            version: zeroHybridLogicalTime,
        }),
    });

    await resolveRpcExecution(commitTaskActionTransaction, 1, {
        extraActions: [],
        referencedAccounts: [],
    });

    expect(getTaskEntryIfExists(store, action2.taskId)).toEqual({
        task: createTask(store, {
            id: action2.taskId,
            time: action2.time,
            taskAction: action2.taskAction,
        })
            .applyAction(action1, getSortableAccount)
            .applyAction(action3, getSortableAccount),
        actions: null,
        optimisticState: {
            original: {
                task: null,
                actions: [action1, action3],
            },
            actions: [{isOptimistic: true, action: action2}],
        },
        authorizationState: expect.objectContaining({
            value: "Authorized",
            version: zeroHybridLogicalTime,
        }),
    });

    await resolveRpcExecution(commitTaskActionTransaction, 2, {
        extraActions: [],
        referencedAccounts: [],
    });

    expect(getTaskEntryIfExists(store, action2.taskId)).toEqual({
        task: createTask(store, {
            id: action2.taskId,
            time: action2.time,
            taskAction: action2.taskAction,
        })
            .applyAction(action1, getSortableAccount)
            .applyAction(action3, getSortableAccount),
        actions: null,
        optimisticState: null,
        authorizationState: expect.objectContaining({
            value: "Authorized",
            version: zeroHybridLogicalTime,
        }),
    });
});

test("resolving task optimistic update after garbage collection is ok", async () => {
    const store = createAutoRetainStore();

    const action1 = {
        type: "UpdateTask",
        time: store.clock.now(),
        taskId: generateId(),
        taskAction: {
            type: "Create",
            creatorId: account1.id,
            creatorTimeZone: defaultTimeZone,
        },
    } satisfies TaskAction;

    const action2 = {
        type: "UpdateTask",
        time: store.clock.now(),
        taskId: action1.taskId,
        taskAction: {
            type: "UpdatePriority",
            priority: "High",
        },
    } satisfies TaskAction;

    expect(getTaskEntryIfExists(store, action1.taskId)).toEqual(null);

    store.commitTaskActionTransaction(context, [action1], {
        undoManager: null,
        affinityManager: noopAffinityManager,
    });

    expect(getTaskEntryIfExists(store, action1.taskId)).toEqual({
        task: createTask(store, {
            id: action1.taskId,
            time: action1.time,
            taskAction: action1.taskAction,
        }),
        actions: null,
        optimisticState: {
            original: {
                task: null,
                actions: [],
            },
            actions: [{isOptimistic: true, action: action1}],
        },
        authorizationState: expect.objectContaining({
            value: "Authorized",
            version: zeroHybridLogicalTime,
        }),
    });

    store.commitTaskActionTransaction(context, [action2], {
        undoManager: null,
        affinityManager: noopAffinityManager,
    });

    expect(getTaskEntryIfExists(store, action1.taskId)).toEqual({
        task: createTask(store, {
            id: action1.taskId,
            time: action1.time,
            taskAction: action1.taskAction,
        }).applyAction(action2, getSortableAccount),
        actions: null,
        optimisticState: {
            original: {
                task: null,
                actions: [],
            },
            actions: [
                {isOptimistic: true, action: action1},
                {isOptimistic: true, action: action2},
            ],
        },
        authorizationState: expect.objectContaining({
            value: "Authorized",
            version: zeroHybridLogicalTime,
        }),
    });

    await resolveRpcExecution(commitTaskActionTransaction, 0, {
        extraActions: [],
        referencedAccounts: [],
    });

    expect(getTaskEntryIfExists(store, action1.taskId)).toEqual({
        task: createTask(store, {
            id: action1.taskId,
            time: action1.time,
            taskAction: action1.taskAction,
        }).applyAction(action2, getSortableAccount),
        actions: null,
        optimisticState: {
            original: {
                task: createTask(store, {
                    id: action1.taskId,
                    time: action1.time,
                    taskAction: action1.taskAction,
                }),
                actions: null,
            },
            actions: [{isOptimistic: true, action: action2}],
        },
        authorizationState: expect.objectContaining({
            value: "Authorized",
            version: zeroHybridLogicalTime,
        }),
    });

    const previousTaskSubscriptions = taskSubscriptions;
    taskSubscriptions = [];
    for (const subscription of previousTaskSubscriptions) {
        subscription.release();
    }

    expect(getTaskEntryIfExists(store, action1.taskId)).toEqual(null);

    await resolveRpcExecution(commitTaskActionTransaction, 1, {
        extraActions: [],
        referencedAccounts: [],
    });

    expect(getTaskEntryIfExists(store, action1.taskId)).toEqual(null);
});

test("regular task actions are added to optimistic state", async () => {
    const store = createAutoRetainStore();

    const task = createTask(store);

    const action2 = {
        type: "UpdateTask",
        time: store.clock.now(),
        taskId: task.id,
        taskAction: {
            type: "UpdatePriority",
            priority: "High",
        },
    } satisfies TaskAction;

    const action3 = {
        type: "UpdateTask",
        time: store.clock.now(),
        taskId: task.id,
        taskAction: {
            type: "UpdateDueDate",
            dueDate: new CalendarDate(1998, 7, 12),
        },
    } satisfies TaskAction;

    expect(getTaskEntryIfExists(store, task.id)).toEqual(null);

    store.applyUpdateEvent({
        type: "Update",
        originClientId: null,
        defaultAuthorizationStateVersion: clock.now(),
        actions: [],
        backfillTasks: [{type: "Authorized", task: task}],
        backfillCollections: [],
        referencedAccounts: [],
    });

    expect(getTaskEntryIfExists(store, task.id)).toEqual({
        task,
        actions: null,
        optimisticState: null,
        authorizationState: expect.objectContaining({value: "Authorized"}),
    });

    store.commitTaskActionTransaction(context, [action2], {
        undoManager: null,
        affinityManager: noopAffinityManager,
    });

    expect(getTaskEntryIfExists(store, task.id)).toEqual({
        task: task.applyAction(action2, getSortableAccount),
        actions: null,
        optimisticState: {
            original: {
                task: task,
                actions: null,
            },
            actions: [{isOptimistic: true, action: action2}],
        },
        authorizationState: expect.objectContaining({value: "Authorized"}),
    });

    store.applyUpdateEvent({
        type: "Update",
        originClientId: null,
        defaultAuthorizationStateVersion: clock.now(),
        actions: [action3],
        backfillTasks: [],
        backfillCollections: [],
        referencedAccounts: [],
    });

    expect(getTaskEntryIfExists(store, task.id)).toEqual({
        task: task
            .applyAction(action2, getSortableAccount)
            .applyAction(action3, getSortableAccount),
        actions: null,
        optimisticState: {
            original: {
                task: task,
                actions: null,
            },
            actions: [
                {isOptimistic: true, action: action2},
                {isOptimistic: false, action: action3},
            ],
        },
        authorizationState: expect.objectContaining({value: "Authorized"}),
    });

    await resolveRpcExecution(commitTaskActionTransaction, 0, {
        extraActions: [],
        referencedAccounts: [],
    });

    expect(getTaskEntryIfExists(store, task.id)).toEqual({
        task: task
            .applyAction(action2, getSortableAccount)
            .applyAction(action3, getSortableAccount),
        actions: null,
        optimisticState: null,
        authorizationState: expect.objectContaining({value: "Authorized"}),
    });
});

test("regular task actions are added to optimistic state with multiple actions", async () => {
    const store = createAutoRetainStore();

    const task = createTask(store);

    const action2 = {
        type: "UpdateTask",
        time: store.clock.now(),
        taskId: task.id,
        taskAction: {
            type: "UpdatePriority",
            priority: "High",
        },
    } satisfies TaskAction;

    const action3 = {
        type: "UpdateTask",
        time: store.clock.now(),
        taskId: task.id,
        taskAction: {
            type: "UpdateDueDate",
            dueDate: new CalendarDate(1998, 7, 12),
        },
    } satisfies TaskAction;

    const action4 = {
        type: "UpdateTask",
        time: store.clock.now(),
        taskId: task.id,
        taskAction: {
            type: "UpdatePriority",
            priority: "Low",
        },
    } satisfies TaskAction;

    expect(getTaskEntryIfExists(store, task.id)).toEqual(null);

    store.applyUpdateEvent({
        type: "Update",
        originClientId: null,
        defaultAuthorizationStateVersion: clock.now(),
        actions: [],
        backfillTasks: [{type: "Authorized", task: task}],
        backfillCollections: [],
        referencedAccounts: [],
    });

    expect(getTaskEntryIfExists(store, task.id)).toEqual({
        task,
        actions: null,
        optimisticState: null,
        authorizationState: expect.objectContaining({value: "Authorized"}),
    });

    store.commitTaskActionTransaction(context, [action2], {
        undoManager: null,
        affinityManager: noopAffinityManager,
    });

    expect(getTaskEntryIfExists(store, task.id)).toEqual({
        task: task.applyAction(action2, getSortableAccount),
        actions: null,
        optimisticState: {
            original: {
                task: task,
                actions: null,
            },
            actions: [{isOptimistic: true, action: action2}],
        },
        authorizationState: expect.objectContaining({value: "Authorized"}),
    });

    store.applyUpdateEvent({
        type: "Update",
        originClientId: null,
        defaultAuthorizationStateVersion: clock.now(),
        actions: [action3],
        backfillTasks: [],
        backfillCollections: [],
        referencedAccounts: [],
    });

    expect(getTaskEntryIfExists(store, task.id)).toEqual({
        task: task
            .applyAction(action2, getSortableAccount)
            .applyAction(action3, getSortableAccount),
        actions: null,
        optimisticState: {
            original: {
                task: task,
                actions: null,
            },
            actions: [
                {isOptimistic: true, action: action2},
                {isOptimistic: false, action: action3},
            ],
        },
        authorizationState: expect.objectContaining({value: "Authorized"}),
    });

    store.commitTaskActionTransaction(context, [action4], {
        undoManager: null,
        affinityManager: noopAffinityManager,
    });

    expect(getTaskEntryIfExists(store, task.id)).toEqual({
        task: task
            .applyAction(action2, getSortableAccount)
            .applyAction(action3, getSortableAccount)
            .applyAction(action4, getSortableAccount),
        actions: null,
        optimisticState: {
            original: {
                task: task,
                actions: null,
            },
            actions: [
                {isOptimistic: true, action: action2},
                {isOptimistic: false, action: action3},
                {isOptimistic: true, action: action4},
            ],
        },
        authorizationState: expect.objectContaining({value: "Authorized"}),
    });

    await resolveRpcExecution(commitTaskActionTransaction, 0, {
        extraActions: [],
        referencedAccounts: [],
    });

    expect(getTaskEntryIfExists(store, task.id)).toEqual({
        task: task
            .applyAction(action2, getSortableAccount)
            .applyAction(action3, getSortableAccount)
            .applyAction(action4, getSortableAccount),
        actions: null,
        optimisticState: {
            original: {
                task: task
                    .applyAction(action2, getSortableAccount)
                    .applyAction(action3, getSortableAccount),
                actions: null,
            },
            actions: [{isOptimistic: true, action: action4}],
        },
        authorizationState: expect.objectContaining({value: "Authorized"}),
    });

    await resolveRpcExecution(commitTaskActionTransaction, 1, {
        extraActions: [],
        referencedAccounts: [],
    });

    expect(getTaskEntryIfExists(store, task.id)).toEqual({
        task: task
            .applyAction(action2, getSortableAccount)
            .applyAction(action3, getSortableAccount)
            .applyAction(action4, getSortableAccount),
        actions: null,
        optimisticState: null,
        authorizationState: expect.objectContaining({value: "Authorized"}),
    });
});

test("regular task actions are added to optimistic state with multiple actions that are committed out of order", async () => {
    const store = createAutoRetainStore();

    const task = createTask(store);

    const action2 = {
        type: "UpdateTask",
        time: store.clock.now(),
        taskId: task.id,
        taskAction: {
            type: "UpdatePriority",
            priority: "High",
        },
    } satisfies TaskAction;

    const action3 = {
        type: "UpdateTask",
        time: store.clock.now(),
        taskId: task.id,
        taskAction: {
            type: "UpdateDueDate",
            dueDate: new CalendarDate(1998, 7, 12),
        },
    } satisfies TaskAction;

    const action4 = {
        type: "UpdateTask",
        time: store.clock.now(),
        taskId: task.id,
        taskAction: {
            type: "UpdatePriority",
            priority: "Low",
        },
    } satisfies TaskAction;

    expect(getTaskEntryIfExists(store, task.id)).toEqual(null);

    store.applyUpdateEvent({
        type: "Update",
        originClientId: null,
        defaultAuthorizationStateVersion: clock.now(),
        actions: [],
        backfillTasks: [{type: "Authorized", task: task}],
        backfillCollections: [],
        referencedAccounts: [],
    });

    expect(getTaskEntryIfExists(store, task.id)).toEqual({
        task,
        actions: null,
        optimisticState: null,
        authorizationState: expect.objectContaining({value: "Authorized"}),
    });

    store.commitTaskActionTransaction(context, [action2], {
        undoManager: null,
        affinityManager: noopAffinityManager,
    });

    expect(getTaskEntryIfExists(store, task.id)).toEqual({
        task: task.applyAction(action2, getSortableAccount),
        actions: null,
        optimisticState: {
            original: {
                task: task,
                actions: null,
            },
            actions: [{isOptimistic: true, action: action2}],
        },
        authorizationState: expect.objectContaining({value: "Authorized"}),
    });

    store.applyUpdateEvent({
        type: "Update",
        originClientId: null,
        defaultAuthorizationStateVersion: clock.now(),
        actions: [action3],
        backfillTasks: [],
        backfillCollections: [],
        referencedAccounts: [],
    });

    expect(getTaskEntryIfExists(store, task.id)).toEqual({
        task: task
            .applyAction(action2, getSortableAccount)
            .applyAction(action3, getSortableAccount),
        actions: null,
        optimisticState: {
            original: {
                task: task,
                actions: null,
            },
            actions: [
                {isOptimistic: true, action: action2},
                {isOptimistic: false, action: action3},
            ],
        },
        authorizationState: expect.objectContaining({value: "Authorized"}),
    });

    store.commitTaskActionTransaction(context, [action4], {
        undoManager: null,
        affinityManager: noopAffinityManager,
    });

    expect(getTaskEntryIfExists(store, task.id)).toEqual({
        task: task
            .applyAction(action2, getSortableAccount)
            .applyAction(action3, getSortableAccount)
            .applyAction(action4, getSortableAccount),
        actions: null,
        optimisticState: {
            original: {
                task: task,
                actions: null,
            },
            actions: [
                {isOptimistic: true, action: action2},
                {isOptimistic: false, action: action3},
                {isOptimistic: true, action: action4},
            ],
        },
        authorizationState: expect.objectContaining({value: "Authorized"}),
    });

    await resolveRpcExecution(commitTaskActionTransaction, 1, {
        extraActions: [],
        referencedAccounts: [],
    });

    expect(getTaskEntryIfExists(store, task.id)).toEqual({
        task: task
            .applyAction(action2, getSortableAccount)
            .applyAction(action3, getSortableAccount)
            .applyAction(action4, getSortableAccount),
        actions: null,
        optimisticState: {
            original: {
                task: task.applyAction(action4, getSortableAccount),
                actions: null,
            },
            actions: [
                {isOptimistic: true, action: action2},
                {isOptimistic: false, action: action3},
            ],
        },
        authorizationState: expect.objectContaining({value: "Authorized"}),
    });

    await resolveRpcExecution(commitTaskActionTransaction, 0, {
        extraActions: [],
        referencedAccounts: [],
    });

    expect(getTaskEntryIfExists(store, task.id)).toEqual({
        task: task
            .applyAction(action2, getSortableAccount)
            .applyAction(action3, getSortableAccount)
            .applyAction(action4, getSortableAccount),
        actions: null,
        optimisticState: null,
        authorizationState: expect.objectContaining({value: "Authorized"}),
    });
});

test("regular actions are added to optimistic state when task is not backfilled", async () => {
    const store = createAutoRetainStore();

    const task = createTask(store);

    const action2 = {
        type: "UpdateTask",
        time: store.clock.now(),
        taskId: task.id,
        taskAction: {
            type: "UpdatePriority",
            priority: "High",
        },
    } satisfies TaskAction;

    const action3 = {
        type: "UpdateTask",
        time: store.clock.now(),
        taskId: task.id,
        taskAction: {
            type: "UpdateDueDate",
            dueDate: new CalendarDate(1998, 7, 12),
        },
    } satisfies TaskAction;

    expect(getTaskEntryIfExists(store, task.id)).toEqual(null);

    store.commitTaskActionTransaction(context, [action2], {
        undoManager: null,
        affinityManager: noopAffinityManager,
    });

    expect(getTaskEntryIfExists(store, task.id)).toEqual({
        task: null,
        actions: [action2],
        optimisticState: {
            original: {
                task: null,
                actions: [],
            },
            actions: [{isOptimistic: true, action: action2}],
        },
        authorizationState: null,
    });

    store.applyUpdateEvent({
        type: "Update",
        originClientId: null,
        defaultAuthorizationStateVersion: clock.now(),
        actions: [action3],
        backfillTasks: [],
        backfillCollections: [],
        referencedAccounts: [],
    });

    expect(getTaskEntryIfExists(store, task.id)).toEqual({
        task: null,
        actions: [action2, action3],
        optimisticState: {
            original: {
                task: null,
                actions: [],
            },
            actions: [
                {isOptimistic: true, action: action2},
                {isOptimistic: false, action: action3},
            ],
        },
        authorizationState: null,
    });

    await resolveRpcExecution(commitTaskActionTransaction, 0, {
        extraActions: [],
        referencedAccounts: [],
    });

    expect(getTaskEntryIfExists(store, task.id)).toEqual({
        task: null,
        actions: [action2, action3],
        optimisticState: null,
        authorizationState: null,
    });
});

test("regular actions are added to optimistic state with multiple actions when task is not backfilled", async () => {
    const store = createAutoRetainStore();

    const task = createTask(store);

    const action2 = {
        type: "UpdateTask",
        time: store.clock.now(),
        taskId: task.id,
        taskAction: {
            type: "UpdatePriority",
            priority: "High",
        },
    } satisfies TaskAction;

    const action3 = {
        type: "UpdateTask",
        time: store.clock.now(),
        taskId: task.id,
        taskAction: {
            type: "UpdateDueDate",
            dueDate: new CalendarDate(1998, 7, 12),
        },
    } satisfies TaskAction;

    const action4 = {
        type: "UpdateTask",
        time: store.clock.now(),
        taskId: task.id,
        taskAction: {
            type: "UpdatePriority",
            priority: "Low",
        },
    } satisfies TaskAction;

    expect(getTaskEntryIfExists(store, task.id)).toEqual(null);

    store.commitTaskActionTransaction(context, [action2], {
        undoManager: null,
        affinityManager: noopAffinityManager,
    });

    expect(getTaskEntryIfExists(store, task.id)).toEqual({
        task: null,
        actions: [action2],
        optimisticState: {
            original: {
                task: null,
                actions: [],
            },
            actions: [{isOptimistic: true, action: action2}],
        },
        authorizationState: null,
    });

    store.applyUpdateEvent({
        type: "Update",
        originClientId: null,
        defaultAuthorizationStateVersion: clock.now(),
        actions: [action3],
        backfillTasks: [],
        backfillCollections: [],
        referencedAccounts: [],
    });

    expect(getTaskEntryIfExists(store, task.id)).toEqual({
        task: null,
        actions: [action2, action3],
        optimisticState: {
            original: {
                task: null,
                actions: [],
            },
            actions: [
                {isOptimistic: true, action: action2},
                {isOptimistic: false, action: action3},
            ],
        },
        authorizationState: null,
    });

    store.commitTaskActionTransaction(context, [action4], {
        undoManager: null,
        affinityManager: noopAffinityManager,
    });

    expect(getTaskEntryIfExists(store, task.id)).toEqual({
        task: null,
        actions: [action2, action3, action4],
        optimisticState: {
            original: {
                task: null,
                actions: [],
            },
            actions: [
                {isOptimistic: true, action: action2},
                {isOptimistic: false, action: action3},
                {isOptimistic: true, action: action4},
            ],
        },
        authorizationState: null,
    });

    await resolveRpcExecution(commitTaskActionTransaction, 0, {
        extraActions: [],
        referencedAccounts: [],
    });

    expect(getTaskEntryIfExists(store, task.id)).toEqual({
        task: null,
        actions: [action2, action3, action4],
        optimisticState: {
            original: {
                task: null,
                actions: [action2, action3],
            },
            actions: [{isOptimistic: true, action: action4}],
        },
        authorizationState: null,
    });

    await resolveRpcExecution(commitTaskActionTransaction, 1, {
        extraActions: [],
        referencedAccounts: [],
    });

    expect(getTaskEntryIfExists(store, task.id)).toEqual({
        task: null,
        actions: [action2, action3, action4],
        optimisticState: null,
        authorizationState: null,
    });
});

test("regular actions are added to optimistic state with multiple actions that are committed out of order when task is not backfilled", async () => {
    const store = createAutoRetainStore();

    const task = createTask(store);

    const action2 = {
        type: "UpdateTask",
        time: store.clock.now(),
        taskId: task.id,
        taskAction: {
            type: "UpdatePriority",
            priority: "High",
        },
    } satisfies TaskAction;

    const action3 = {
        type: "UpdateTask",
        time: store.clock.now(),
        taskId: task.id,
        taskAction: {
            type: "UpdateDueDate",
            dueDate: new CalendarDate(1998, 7, 12),
        },
    } satisfies TaskAction;

    const action4 = {
        type: "UpdateTask",
        time: store.clock.now(),
        taskId: task.id,
        taskAction: {
            type: "UpdatePriority",
            priority: "Low",
        },
    } satisfies TaskAction;

    expect(getTaskEntryIfExists(store, task.id)).toEqual(null);

    store.commitTaskActionTransaction(context, [action2], {
        undoManager: null,
        affinityManager: noopAffinityManager,
    });

    expect(getTaskEntryIfExists(store, task.id)).toEqual({
        task: null,
        actions: [action2],
        optimisticState: {
            original: {
                task: null,
                actions: [],
            },
            actions: [{isOptimistic: true, action: action2}],
        },
        authorizationState: null,
    });

    store.applyUpdateEvent({
        type: "Update",
        originClientId: null,
        defaultAuthorizationStateVersion: clock.now(),
        actions: [action3],
        backfillTasks: [],
        backfillCollections: [],
        referencedAccounts: [],
    });

    expect(getTaskEntryIfExists(store, task.id)).toEqual({
        task: null,
        actions: [action2, action3],
        optimisticState: {
            original: {
                task: null,
                actions: [],
            },
            actions: [
                {isOptimistic: true, action: action2},
                {isOptimistic: false, action: action3},
            ],
        },
        authorizationState: null,
    });

    store.commitTaskActionTransaction(context, [action4], {
        undoManager: null,
        affinityManager: noopAffinityManager,
    });

    expect(getTaskEntryIfExists(store, task.id)).toEqual({
        task: null,
        actions: [action2, action3, action4],
        optimisticState: {
            original: {
                task: null,
                actions: [],
            },
            actions: [
                {isOptimistic: true, action: action2},
                {isOptimistic: false, action: action3},
                {isOptimistic: true, action: action4},
            ],
        },
        authorizationState: null,
    });

    await resolveRpcExecution(commitTaskActionTransaction, 1, {
        extraActions: [],
        referencedAccounts: [],
    });

    expect(getTaskEntryIfExists(store, task.id)).toEqual({
        task: null,
        actions: [action2, action3, action4],
        optimisticState: {
            original: {
                task: null,
                actions: [action4],
            },
            actions: [
                {isOptimistic: true, action: action2},
                {isOptimistic: false, action: action3},
            ],
        },
        authorizationState: null,
    });

    await resolveRpcExecution(commitTaskActionTransaction, 0, {
        extraActions: [],
        referencedAccounts: [],
    });

    expect(getTaskEntryIfExists(store, task.id)).toEqual({
        task: null,
        actions: [action2, action3, action4],
        optimisticState: null,
        authorizationState: null,
    });
});

test("regular actions are added to optimistic state when task is created optimistically", async () => {
    const store = createAutoRetainStore();

    const action1 = {
        type: "UpdateTask",
        time: store.clock.now(),
        taskId: generateId(),
        taskAction: {
            type: "Create",
            creatorId: account1.id,
            creatorTimeZone: defaultTimeZone,
        },
    } satisfies TaskAction;

    const task = createTask(store, {
        id: action1.taskId,
        time: action1.time,
        taskAction: action1.taskAction,
    });

    const action2 = {
        type: "UpdateTask",
        time: store.clock.now(),
        taskId: task.id,
        taskAction: {
            type: "UpdatePriority",
            priority: "High",
        },
    } satisfies TaskAction;

    const action3 = {
        type: "UpdateTask",
        time: store.clock.now(),
        taskId: task.id,
        taskAction: {
            type: "UpdateDueDate",
            dueDate: new CalendarDate(1998, 7, 12),
        },
    } satisfies TaskAction;

    expect(getTaskEntryIfExists(store, task.id)).toEqual(null);

    store.commitTaskActionTransaction(context, [action1], {
        undoManager: null,
        affinityManager: noopAffinityManager,
    });

    expect(getTaskEntryIfExists(store, task.id)).toEqual({
        task,
        actions: null,
        optimisticState: {
            original: {
                task: null,
                actions: [],
            },
            actions: [{isOptimistic: true, action: action1}],
        },
        authorizationState: expect.objectContaining({
            value: "Authorized",
            version: zeroHybridLogicalTime,
        }),
    });

    store.commitTaskActionTransaction(context, [action2], {
        undoManager: null,
        affinityManager: noopAffinityManager,
    });

    expect(getTaskEntryIfExists(store, task.id)).toEqual({
        task: task.applyAction(action2, getSortableAccount),
        actions: null,
        optimisticState: {
            original: {
                task: null,
                actions: [],
            },
            actions: [
                {isOptimistic: true, action: action1},
                {isOptimistic: true, action: action2},
            ],
        },
        authorizationState: expect.objectContaining({
            value: "Authorized",
            version: zeroHybridLogicalTime,
        }),
    });

    store.applyUpdateEvent({
        type: "Update",
        originClientId: null,
        defaultAuthorizationStateVersion: clock.now(),
        actions: [action3],
        backfillTasks: [],
        backfillCollections: [],
        referencedAccounts: [],
    });

    expect(getTaskEntryIfExists(store, task.id)).toEqual({
        task: task
            .applyAction(action2, getSortableAccount)
            .applyAction(action3, getSortableAccount),
        actions: null,
        optimisticState: {
            original: {
                task: null,
                actions: [],
            },
            actions: [
                {isOptimistic: true, action: action1},
                {isOptimistic: true, action: action2},
                {isOptimistic: false, action: action3},
            ],
        },
        authorizationState: expect.objectContaining({
            value: "Authorized",
            version: zeroHybridLogicalTime,
        }),
    });

    await resolveRpcExecution(commitTaskActionTransaction, 0, {
        extraActions: [],
        referencedAccounts: [],
    });

    expect(getTaskEntryIfExists(store, task.id)).toEqual({
        task: task
            .applyAction(action2, getSortableAccount)
            .applyAction(action3, getSortableAccount),
        actions: null,
        optimisticState: {
            original: {
                task,
                actions: null,
            },
            actions: [
                {isOptimistic: true, action: action2},
                {isOptimistic: false, action: action3},
            ],
        },
        authorizationState: expect.objectContaining({
            value: "Authorized",
            version: zeroHybridLogicalTime,
        }),
    });

    await resolveRpcExecution(commitTaskActionTransaction, 1, {
        extraActions: [],
        referencedAccounts: [],
    });

    expect(getTaskEntryIfExists(store, task.id)).toEqual({
        task: task
            .applyAction(action2, getSortableAccount)
            .applyAction(action3, getSortableAccount),
        actions: null,
        optimisticState: null,
        authorizationState: expect.objectContaining({
            value: "Authorized",
            version: zeroHybridLogicalTime,
        }),
    });
});

test("regular actions are added to optimistic state with multiple actions when task is created optimistically", async () => {
    const store = createAutoRetainStore();

    const action1 = {
        type: "UpdateTask",
        time: store.clock.now(),
        taskId: generateId(),
        taskAction: {
            type: "Create",
            creatorId: account1.id,
            creatorTimeZone: defaultTimeZone,
        },
    } satisfies TaskAction;

    const task = createTask(store, {
        id: action1.taskId,
        time: action1.time,
        taskAction: action1.taskAction,
    });

    const action2 = {
        type: "UpdateTask",
        time: store.clock.now(),
        taskId: task.id,
        taskAction: {
            type: "UpdatePriority",
            priority: "High",
        },
    } satisfies TaskAction;

    const action3 = {
        type: "UpdateTask",
        time: store.clock.now(),
        taskId: task.id,
        taskAction: {
            type: "UpdateDueDate",
            dueDate: new CalendarDate(1998, 7, 12),
        },
    } satisfies TaskAction;

    const action4 = {
        type: "UpdateTask",
        time: store.clock.now(),
        taskId: task.id,
        taskAction: {
            type: "UpdatePriority",
            priority: "Low",
        },
    } satisfies TaskAction;

    expect(getTaskEntryIfExists(store, task.id)).toEqual(null);

    store.commitTaskActionTransaction(context, [action1], {
        undoManager: null,
        affinityManager: noopAffinityManager,
    });

    expect(getTaskEntryIfExists(store, task.id)).toEqual({
        task,
        actions: null,
        optimisticState: {
            original: {
                task: null,
                actions: [],
            },
            actions: [{isOptimistic: true, action: action1}],
        },
        authorizationState: expect.objectContaining({
            value: "Authorized",
            version: zeroHybridLogicalTime,
        }),
    });

    store.commitTaskActionTransaction(context, [action2], {
        undoManager: null,
        affinityManager: noopAffinityManager,
    });

    expect(getTaskEntryIfExists(store, task.id)).toEqual({
        task: task.applyAction(action2, getSortableAccount),
        actions: null,
        optimisticState: {
            original: {
                task: null,
                actions: [],
            },
            actions: [
                {isOptimistic: true, action: action1},
                {isOptimistic: true, action: action2},
            ],
        },
        authorizationState: expect.objectContaining({
            value: "Authorized",
            version: zeroHybridLogicalTime,
        }),
    });

    store.applyUpdateEvent({
        type: "Update",
        originClientId: null,
        defaultAuthorizationStateVersion: clock.now(),
        actions: [action3],
        backfillTasks: [],
        backfillCollections: [],
        referencedAccounts: [],
    });

    expect(getTaskEntryIfExists(store, task.id)).toEqual({
        task: task
            .applyAction(action2, getSortableAccount)
            .applyAction(action3, getSortableAccount),
        actions: null,
        optimisticState: {
            original: {
                task: null,
                actions: [],
            },
            actions: [
                {isOptimistic: true, action: action1},
                {isOptimistic: true, action: action2},
                {isOptimistic: false, action: action3},
            ],
        },
        authorizationState: expect.objectContaining({
            value: "Authorized",
            version: zeroHybridLogicalTime,
        }),
    });

    store.commitTaskActionTransaction(context, [action4], {
        undoManager: null,
        affinityManager: noopAffinityManager,
    });

    expect(getTaskEntryIfExists(store, task.id)).toEqual({
        task: task
            .applyAction(action2, getSortableAccount)
            .applyAction(action3, getSortableAccount)
            .applyAction(action4, getSortableAccount),
        actions: null,
        optimisticState: {
            original: {
                task: null,
                actions: [],
            },
            actions: [
                {isOptimistic: true, action: action1},
                {isOptimistic: true, action: action2},
                {isOptimistic: false, action: action3},
                {isOptimistic: true, action: action4},
            ],
        },
        authorizationState: expect.objectContaining({
            value: "Authorized",
            version: zeroHybridLogicalTime,
        }),
    });

    await resolveRpcExecution(commitTaskActionTransaction, 0, {
        extraActions: [],
        referencedAccounts: [],
    });

    expect(getTaskEntryIfExists(store, task.id)).toEqual({
        task: task
            .applyAction(action2, getSortableAccount)
            .applyAction(action3, getSortableAccount)
            .applyAction(action4, getSortableAccount),
        actions: null,
        optimisticState: {
            original: {
                task,
                actions: null,
            },
            actions: [
                {isOptimistic: true, action: action2},
                {isOptimistic: false, action: action3},
                {isOptimistic: true, action: action4},
            ],
        },
        authorizationState: expect.objectContaining({
            value: "Authorized",
            version: zeroHybridLogicalTime,
        }),
    });

    await resolveRpcExecution(commitTaskActionTransaction, 1, {
        extraActions: [],
        referencedAccounts: [],
    });

    expect(getTaskEntryIfExists(store, task.id)).toEqual({
        task: task
            .applyAction(action2, getSortableAccount)
            .applyAction(action3, getSortableAccount)
            .applyAction(action4, getSortableAccount),
        actions: null,
        optimisticState: {
            original: {
                task: task
                    .applyAction(action2, getSortableAccount)
                    .applyAction(action3, getSortableAccount),
                actions: null,
            },
            actions: [{isOptimistic: true, action: action4}],
        },
        authorizationState: expect.objectContaining({
            value: "Authorized",
            version: zeroHybridLogicalTime,
        }),
    });

    await resolveRpcExecution(commitTaskActionTransaction, 2, {
        extraActions: [],
        referencedAccounts: [],
    });

    expect(getTaskEntryIfExists(store, task.id)).toEqual({
        task: task
            .applyAction(action2, getSortableAccount)
            .applyAction(action3, getSortableAccount)
            .applyAction(action4, getSortableAccount),
        actions: null,
        optimisticState: null,
        authorizationState: expect.objectContaining({
            value: "Authorized",
            version: zeroHybridLogicalTime,
        }),
    });
});

test("regular actions are added to optimistic state with multiple actions that are committed out of order when task is created optimistically", async () => {
    const store = createAutoRetainStore();

    const action1 = {
        type: "UpdateTask",
        time: store.clock.now(),
        taskId: generateId(),
        taskAction: {
            type: "Create",
            creatorId: account1.id,
            creatorTimeZone: defaultTimeZone,
        },
    } satisfies TaskAction;

    const task = createTask(store, {
        id: action1.taskId,
        time: action1.time,
        taskAction: action1.taskAction,
    });

    const action2 = {
        type: "UpdateTask",
        time: store.clock.now(),
        taskId: task.id,
        taskAction: {
            type: "UpdatePriority",
            priority: "High",
        },
    } satisfies TaskAction;

    const action3 = {
        type: "UpdateTask",
        time: store.clock.now(),
        taskId: task.id,
        taskAction: {
            type: "UpdateDueDate",
            dueDate: new CalendarDate(1998, 7, 12),
        },
    } satisfies TaskAction;

    const action4 = {
        type: "UpdateTask",
        time: store.clock.now(),
        taskId: task.id,
        taskAction: {
            type: "UpdatePriority",
            priority: "Low",
        },
    } satisfies TaskAction;

    expect(getTaskEntryIfExists(store, task.id)).toEqual(null);

    store.commitTaskActionTransaction(context, [action1], {
        undoManager: null,
        affinityManager: noopAffinityManager,
    });

    expect(getTaskEntryIfExists(store, task.id)).toEqual({
        task,
        actions: null,
        optimisticState: {
            original: {
                task: null,
                actions: [],
            },
            actions: [{isOptimistic: true, action: action1}],
        },
        authorizationState: expect.objectContaining({
            value: "Authorized",
            version: zeroHybridLogicalTime,
        }),
    });

    store.commitTaskActionTransaction(context, [action2], {
        undoManager: null,
        affinityManager: noopAffinityManager,
    });

    expect(getTaskEntryIfExists(store, task.id)).toEqual({
        task: task.applyAction(action2, getSortableAccount),
        actions: null,
        optimisticState: {
            original: {
                task: null,
                actions: [],
            },
            actions: [
                {isOptimistic: true, action: action1},
                {isOptimistic: true, action: action2},
            ],
        },
        authorizationState: expect.objectContaining({
            value: "Authorized",
            version: zeroHybridLogicalTime,
        }),
    });

    store.applyUpdateEvent({
        type: "Update",
        originClientId: null,
        defaultAuthorizationStateVersion: clock.now(),
        actions: [action3],
        backfillTasks: [],
        backfillCollections: [],
        referencedAccounts: [],
    });

    expect(getTaskEntryIfExists(store, task.id)).toEqual({
        task: task
            .applyAction(action2, getSortableAccount)
            .applyAction(action3, getSortableAccount),
        actions: null,
        optimisticState: {
            original: {
                task: null,
                actions: [],
            },
            actions: [
                {isOptimistic: true, action: action1},
                {isOptimistic: true, action: action2},
                {isOptimistic: false, action: action3},
            ],
        },
        authorizationState: expect.objectContaining({
            value: "Authorized",
            version: zeroHybridLogicalTime,
        }),
    });

    store.commitTaskActionTransaction(context, [action4], {
        undoManager: null,
        affinityManager: noopAffinityManager,
    });

    expect(getTaskEntryIfExists(store, task.id)).toEqual({
        task: task
            .applyAction(action2, getSortableAccount)
            .applyAction(action3, getSortableAccount)
            .applyAction(action4, getSortableAccount),
        actions: null,
        optimisticState: {
            original: {
                task: null,
                actions: [],
            },
            actions: [
                {isOptimistic: true, action: action1},
                {isOptimistic: true, action: action2},
                {isOptimistic: false, action: action3},
                {isOptimistic: true, action: action4},
            ],
        },
        authorizationState: expect.objectContaining({
            value: "Authorized",
            version: zeroHybridLogicalTime,
        }),
    });

    await resolveRpcExecution(commitTaskActionTransaction, 0, {
        extraActions: [],
        referencedAccounts: [],
    });

    expect(getTaskEntryIfExists(store, task.id)).toEqual({
        task: task
            .applyAction(action2, getSortableAccount)
            .applyAction(action3, getSortableAccount)
            .applyAction(action4, getSortableAccount),
        actions: null,
        optimisticState: {
            original: {
                task,
                actions: null,
            },
            actions: [
                {isOptimistic: true, action: action2},
                {isOptimistic: false, action: action3},
                {isOptimistic: true, action: action4},
            ],
        },
        authorizationState: expect.objectContaining({
            value: "Authorized",
            version: zeroHybridLogicalTime,
        }),
    });

    await resolveRpcExecution(commitTaskActionTransaction, 2, {
        extraActions: [],
        referencedAccounts: [],
    });

    expect(getTaskEntryIfExists(store, task.id)).toEqual({
        task: task
            .applyAction(action2, getSortableAccount)
            .applyAction(action3, getSortableAccount)
            .applyAction(action4, getSortableAccount),
        actions: null,
        optimisticState: {
            original: {
                task: task.applyAction(action4, getSortableAccount),
                actions: null,
            },
            actions: [
                {isOptimistic: true, action: action2},
                {isOptimistic: false, action: action3},
            ],
        },
        authorizationState: expect.objectContaining({
            value: "Authorized",
            version: zeroHybridLogicalTime,
        }),
    });

    await resolveRpcExecution(commitTaskActionTransaction, 1, {
        extraActions: [],
        referencedAccounts: [],
    });

    expect(getTaskEntryIfExists(store, task.id)).toEqual({
        task: task
            .applyAction(action2, getSortableAccount)
            .applyAction(action3, getSortableAccount)
            .applyAction(action4, getSortableAccount),
        actions: null,
        optimisticState: null,
        authorizationState: expect.objectContaining({
            value: "Authorized",
            version: zeroHybridLogicalTime,
        }),
    });
});

test("three optimistic actions when task is not backfilled", async () => {
    const store = createAutoRetainStore();

    const task = createTask(store);

    const action2 = {
        type: "UpdateTask",
        time: store.clock.now(),
        taskId: task.id,
        taskAction: {
            type: "UpdatePriority",
            priority: "High",
        },
    } satisfies TaskAction;

    const action3 = {
        type: "UpdateTask",
        time: store.clock.now(),
        taskId: task.id,
        taskAction: {
            type: "UpdateDueDate",
            dueDate: new CalendarDate(1998, 7, 12),
        },
    } satisfies TaskAction;

    const action4 = {
        type: "UpdateTask",
        time: store.clock.now(),
        taskId: task.id,
        taskAction: {
            type: "UpdatePriority",
            priority: "Low",
        },
    } satisfies TaskAction;

    expect(getTaskEntryIfExists(store, task.id)).toEqual(null);

    store.commitTaskActionTransaction(context, [action2], {
        undoManager: null,
        affinityManager: noopAffinityManager,
    });

    expect(getTaskEntryIfExists(store, task.id)).toEqual({
        task: null,
        actions: [action2],
        optimisticState: {
            original: {
                task: null,
                actions: [],
            },
            actions: [{isOptimistic: true, action: action2}],
        },
        authorizationState: null,
    });

    store.commitTaskActionTransaction(context, [action3], {
        undoManager: null,
        affinityManager: noopAffinityManager,
    });

    expect(getTaskEntryIfExists(store, task.id)).toEqual({
        task: null,
        actions: [action2, action3],
        optimisticState: {
            original: {
                task: null,
                actions: [],
            },
            actions: [
                {isOptimistic: true, action: action2},
                {isOptimistic: true, action: action3},
            ],
        },
        authorizationState: null,
    });

    store.commitTaskActionTransaction(context, [action4], {
        undoManager: null,
        affinityManager: noopAffinityManager,
    });

    expect(getTaskEntryIfExists(store, task.id)).toEqual({
        task: null,
        actions: [action2, action3, action4],
        optimisticState: {
            original: {
                task: null,
                actions: [],
            },
            actions: [
                {isOptimistic: true, action: action2},
                {isOptimistic: true, action: action3},
                {isOptimistic: true, action: action4},
            ],
        },
        authorizationState: null,
    });

    await resolveRpcExecution(commitTaskActionTransaction, 0, {
        extraActions: [],
        referencedAccounts: [],
    });

    expect(getTaskEntryIfExists(store, task.id)).toEqual({
        task: null,
        actions: [action2, action3, action4],
        optimisticState: {
            original: {
                task: null,
                actions: [action2],
            },
            actions: [
                {isOptimistic: true, action: action3},
                {isOptimistic: true, action: action4},
            ],
        },
        authorizationState: null,
    });

    await resolveRpcExecution(commitTaskActionTransaction, 1, {
        extraActions: [],
        referencedAccounts: [],
    });

    expect(getTaskEntryIfExists(store, task.id)).toEqual({
        task: null,
        actions: [action2, action3, action4],
        optimisticState: {
            original: {
                task: null,
                actions: [action2, action3],
            },
            actions: [{isOptimistic: true, action: action4}],
        },
        authorizationState: null,
    });

    await resolveRpcExecution(commitTaskActionTransaction, 2, {
        extraActions: [],
        referencedAccounts: [],
    });

    expect(getTaskEntryIfExists(store, task.id)).toEqual({
        task: null,
        actions: [action2, action3, action4],
        optimisticState: null,
        authorizationState: null,
    });
});

test("backfilling a task when none exists and there are optimistic actions works", async () => {
    const store = createAutoRetainStore();

    const task = createTask(store);

    const action2 = {
        type: "UpdateTask",
        time: store.clock.now(),
        taskId: task.id,
        taskAction: {
            type: "UpdatePriority",
            priority: "High",
        },
    } satisfies TaskAction;

    const action3 = {
        type: "UpdateTask",
        time: store.clock.now(),
        taskId: task.id,
        taskAction: {
            type: "UpdateDueDate",
            dueDate: new CalendarDate(1998, 7, 12),
        },
    } satisfies TaskAction;

    expect(getTaskEntryIfExists(store, task.id)).toEqual(null);

    store.commitTaskActionTransaction(context, [action2], {
        undoManager: null,
        affinityManager: noopAffinityManager,
    });

    expect(getTaskEntryIfExists(store, task.id)).toEqual({
        task: null,
        actions: [action2],
        optimisticState: {
            original: {
                task: null,
                actions: [],
            },
            actions: [{isOptimistic: true, action: action2}],
        },
        authorizationState: null,
    });

    store.applyUpdateEvent({
        type: "Update",
        originClientId: null,
        defaultAuthorizationStateVersion: clock.now(),
        actions: [action3],
        backfillTasks: [],
        backfillCollections: [],
        referencedAccounts: [],
    });

    expect(getTaskEntryIfExists(store, task.id)).toEqual({
        task: null,
        actions: [action2, action3],
        optimisticState: {
            original: {
                task: null,
                actions: [],
            },
            actions: [
                {isOptimistic: true, action: action2},
                {isOptimistic: false, action: action3},
            ],
        },
        authorizationState: null,
    });

    store.applyUpdateEvent({
        type: "Update",
        originClientId: null,
        defaultAuthorizationStateVersion: clock.now(),
        actions: [],
        backfillTasks: [{type: "Authorized", task: task}],
        backfillCollections: [],
        referencedAccounts: [],
    });

    expect(getTaskEntryIfExists(store, task.id)).toEqual({
        task: task
            .applyAction(action2, getSortableAccount)
            .applyAction(action3, getSortableAccount),
        actions: null,
        optimisticState: {
            original: {
                task,
                actions: null,
            },
            actions: [
                {isOptimistic: true, action: action2},
                {isOptimistic: false, action: action3},
            ],
        },
        authorizationState: expect.objectContaining({value: "Authorized"}),
    });

    await resolveLastRpcExecution(commitTaskActionTransaction, {
        extraActions: [],
        referencedAccounts: [],
    });

    expect(getTaskEntryIfExists(store, task.id)).toEqual({
        task: task
            .applyAction(action2, getSortableAccount)
            .applyAction(action3, getSortableAccount),
        actions: null,
        optimisticState: null,
        authorizationState: expect.objectContaining({value: "Authorized"}),
    });
});

test("backfilling a task when one is already backfilled and there are optimistic actions works", async () => {
    const store = createAutoRetainStore();

    const task = createTask(store);

    const action2 = {
        type: "UpdateTask",
        time: store.clock.now(),
        taskId: task.id,
        taskAction: {
            type: "UpdatePriority",
            priority: "High",
        },
    } satisfies TaskAction;

    const action3 = {
        type: "UpdateTask",
        time: store.clock.now(),
        taskId: task.id,
        taskAction: {
            type: "UpdateDueDate",
            dueDate: new CalendarDate(1998, 7, 12),
        },
    } satisfies TaskAction;

    expect(getTaskEntryIfExists(store, task.id)).toEqual(null);

    store.applyUpdateEvent({
        type: "Update",
        originClientId: null,
        defaultAuthorizationStateVersion: clock.now(),
        actions: [],
        backfillTasks: [{type: "Authorized", task: task}],
        backfillCollections: [],
        referencedAccounts: [],
    });

    expect(getTaskEntryIfExists(store, task.id)).toEqual({
        task,
        actions: null,
        optimisticState: null,
        authorizationState: expect.objectContaining({value: "Authorized"}),
    });

    store.commitTaskActionTransaction(context, [action2], {
        undoManager: null,
        affinityManager: noopAffinityManager,
    });

    expect(getTaskEntryIfExists(store, task.id)).toEqual({
        task: task.applyAction(action2, getSortableAccount),
        actions: null,
        optimisticState: {
            original: {
                task,
                actions: null,
            },
            actions: [{isOptimistic: true, action: action2}],
        },
        authorizationState: expect.objectContaining({value: "Authorized"}),
    });

    store.applyUpdateEvent({
        type: "Update",
        originClientId: null,
        defaultAuthorizationStateVersion: clock.now(),
        actions: [],
        backfillTasks: [{type: "Authorized", task: task.applyAction(action3, getSortableAccount)}],
        backfillCollections: [],
        referencedAccounts: [],
    });

    expect(getTaskEntryIfExists(store, task.id)).toEqual({
        task: task
            .applyAction(action2, getSortableAccount)
            .applyAction(action3, getSortableAccount),
        actions: null,
        optimisticState: {
            original: {
                task: task.applyAction(action3, getSortableAccount),
                actions: null,
            },
            actions: [{isOptimistic: true, action: action2}],
        },
        authorizationState: expect.objectContaining({value: "Authorized"}),
    });

    await resolveLastRpcExecution(commitTaskActionTransaction, {
        extraActions: [],
        referencedAccounts: [],
    });

    expect(getTaskEntryIfExists(store, task.id)).toEqual({
        task: task
            .applyAction(action2, getSortableAccount)
            .applyAction(action3, getSortableAccount),
        actions: null,
        optimisticState: null,
        authorizationState: expect.objectContaining({value: "Authorized"}),
    });
});

test("backfilling a task when there are optimistic actions but no previously backfilled task works", async () => {
    const store = createAutoRetainStore();

    const action1 = {
        type: "UpdateTask",
        time: store.clock.now(),
        taskId: generateId(),
        taskAction: {
            type: "Create",
            creatorId: account1.id,
            creatorTimeZone: defaultTimeZone,
        },
    } satisfies TaskAction;

    const task = createTask(store, {
        id: action1.taskId,
        time: action1.time,
        taskAction: action1.taskAction,
    });

    const action2 = {
        type: "UpdateTask",
        time: store.clock.now(),
        taskId: task.id,
        taskAction: {
            type: "UpdatePriority",
            priority: "High",
        },
    } satisfies TaskAction;

    const action3 = {
        type: "UpdateTask",
        time: store.clock.now(),
        taskId: task.id,
        taskAction: {
            type: "UpdateDueDate",
            dueDate: new CalendarDate(1998, 7, 12),
        },
    } satisfies TaskAction;

    const action4 = {
        type: "UpdateTask",
        time: store.clock.now(),
        taskId: task.id,
        taskAction: {
            type: "UpdatePriority",
            priority: "Low",
        },
    } satisfies TaskAction;

    expect(getTaskEntryIfExists(store, task.id)).toEqual(null);

    store.applyUpdateEvent({
        type: "Update",
        originClientId: null,
        defaultAuthorizationStateVersion: clock.now(),
        actions: [action3],
        backfillTasks: [],
        backfillCollections: [],
        referencedAccounts: [],
    });

    expect(getTaskEntryIfExists(store, task.id)).toEqual({
        task: null,
        actions: [action3],
        optimisticState: null,
        authorizationState: null,
    });

    store.commitTaskActionTransaction(context, [action1], {
        undoManager: null,
        affinityManager: noopAffinityManager,
    });

    expect(getTaskEntryIfExists(store, task.id)).toEqual({
        task: task.applyAction(action3, getSortableAccount),
        actions: null,
        optimisticState: {
            original: {
                task: null,
                actions: [action3],
            },
            actions: [{isOptimistic: true, action: action1}],
        },
        authorizationState: expect.objectContaining({
            value: "Authorized",
            version: zeroHybridLogicalTime,
        }),
    });

    store.commitTaskActionTransaction(context, [action2], {
        undoManager: null,
        affinityManager: noopAffinityManager,
    });

    expect(getTaskEntryIfExists(store, task.id)).toEqual({
        task: task
            .applyAction(action3, getSortableAccount)
            .applyAction(action2, getSortableAccount),
        actions: null,
        optimisticState: {
            original: {
                task: null,
                actions: [action3],
            },
            actions: [
                {isOptimistic: true, action: action1},
                {isOptimistic: true, action: action2},
            ],
        },
        authorizationState: expect.objectContaining({
            value: "Authorized",
            version: zeroHybridLogicalTime,
        }),
    });

    store.applyUpdateEvent({
        type: "Update",
        originClientId: null,
        defaultAuthorizationStateVersion: clock.now(),
        actions: [],
        backfillTasks: [{type: "Authorized", task: task.applyAction(action4, getSortableAccount)}],
        backfillCollections: [],
        referencedAccounts: [],
    });

    expect(getTaskEntryIfExists(store, task.id)).toEqual({
        task: task
            .applyAction(action4, getSortableAccount)
            .applyAction(action3, getSortableAccount)
            .applyAction(action2, getSortableAccount),
        actions: null,
        optimisticState: {
            original: {
                task: task
                    .applyAction(action4, getSortableAccount)
                    .applyAction(action3, getSortableAccount),
                actions: null,
            },
            actions: [
                {isOptimistic: true, action: action1},
                {isOptimistic: true, action: action2},
            ],
        },
        authorizationState: expect.objectContaining({value: "Authorized"}),
    });

    await resolveRpcExecution(commitTaskActionTransaction, 0, {
        extraActions: [],
        referencedAccounts: [],
    });

    expect(getTaskEntryIfExists(store, task.id)).toEqual({
        task: task
            .applyAction(action4, getSortableAccount)
            .applyAction(action3, getSortableAccount)
            .applyAction(action2, getSortableAccount),
        actions: null,
        optimisticState: {
            original: {
                task: task
                    .applyAction(action4, getSortableAccount)
                    .applyAction(action3, getSortableAccount)
                    .applyAction(action1, getSortableAccount),
                actions: null,
            },
            actions: [{isOptimistic: true, action: action2}],
        },
        authorizationState: expect.objectContaining({value: "Authorized"}),
    });

    await resolveRpcExecution(commitTaskActionTransaction, 1, {
        extraActions: [],
        referencedAccounts: [],
    });

    expect(getTaskEntryIfExists(store, task.id)).toEqual({
        task: task
            .applyAction(action4, getSortableAccount)
            .applyAction(action3, getSortableAccount)
            .applyAction(action2, getSortableAccount),
        actions: null,
        optimisticState: null,
        authorizationState: expect.objectContaining({value: "Authorized"}),
    });
});

test("applies task commit action calls optimistically (rejected)", async () => {
    const store = createAutoRetainStore();

    const task = createTask(store);

    expect(getTaskEntryIfExists(store, task.id)).toEqual(null);

    store.applyUpdateEvent({
        type: "Update",
        originClientId: null,
        defaultAuthorizationStateVersion: clock.now(),
        actions: [],
        backfillTasks: [{type: "Authorized", task: task}],
        backfillCollections: [],
        referencedAccounts: [],
    });

    expect(getTaskEntryIfExists(store, task.id)).toEqual({
        task,
        actions: null,
        optimisticState: null,
        authorizationState: expect.objectContaining({value: "Authorized"}),
    });

    const action = {
        type: "UpdateTask",
        time: store.clock.now(),
        taskId: task.id,
        taskAction: {
            type: "UpdatePriority",
            priority: "High",
        },
    } satisfies TaskAction;

    store.commitTaskActionTransaction(context, [action], {
        undoManager: null,
        affinityManager: noopAffinityManager,
    });

    expect(getTaskEntryIfExists(store, task.id)).toEqual({
        task: task.applyAction(action, getSortableAccount),
        actions: null,
        optimisticState: {
            original: {
                task,
                actions: null,
            },
            actions: [{isOptimistic: true, action}],
        },
        authorizationState: expect.objectContaining({value: "Authorized"}),
    });

    await rejectLastRpcExecution(commitTaskActionTransaction);

    expect(getTaskEntryIfExists(store, task.id)).toEqual({
        task,
        actions: null,
        optimisticState: null,
        authorizationState: expect.objectContaining({value: "Authorized"}),
    });

    expect(errors.length).toEqual(1);
    errors = [];
});

test("can create tasks optimistically (rejected)", async () => {
    const store = createAutoRetainStore();

    const action1 = {
        type: "UpdateTask",
        time: store.clock.now(),
        taskId: generateId(),
        taskAction: {
            type: "Create",
            creatorId: account1.id,
            creatorTimeZone: defaultTimeZone,
        },
    } satisfies TaskAction;

    expect(getTaskEntryIfExists(store, action1.taskId)).toEqual(null);

    store.commitTaskActionTransaction(context, [action1], {
        undoManager: null,
        affinityManager: noopAffinityManager,
    });

    expect(getTaskEntryIfExists(store, action1.taskId)).toEqual({
        task: createTask(store, {
            id: action1.taskId,
            time: action1.time,
            taskAction: action1.taskAction,
        }),
        actions: null,
        optimisticState: {
            original: {
                task: null,
                actions: [],
            },
            actions: [{isOptimistic: true, action: action1}],
        },
        authorizationState: expect.objectContaining({
            value: "Authorized",
            version: zeroHybridLogicalTime,
        }),
    });

    await rejectLastRpcExecution(commitTaskActionTransaction);

    expect(getTaskEntryIfExists(store, action1.taskId)).toEqual({
        task: null,
        actions: [],
        optimisticState: null,
        authorizationState: expect.objectContaining({
            value: "Authorized",
            version: zeroHybridLogicalTime,
        }),
    });

    expect(errors.length).toEqual(1);
    errors = [];
});

test("can create then update tasks optimistically (rejected)", async () => {
    const store = createAutoRetainStore();

    const action1 = {
        type: "UpdateTask",
        time: store.clock.now(),
        taskId: generateId(),
        taskAction: {
            type: "Create",
            creatorId: account1.id,
            creatorTimeZone: defaultTimeZone,
        },
    } satisfies TaskAction;

    const action2 = {
        type: "UpdateTask",
        time: store.clock.now(),
        taskId: action1.taskId,
        taskAction: {
            type: "UpdatePriority",
            priority: "High",
        },
    } satisfies TaskAction;

    expect(getTaskEntryIfExists(store, action1.taskId)).toEqual(null);

    store.commitTaskActionTransaction(context, [action1], {
        undoManager: null,
        affinityManager: noopAffinityManager,
    });

    expect(getTaskEntryIfExists(store, action1.taskId)).toEqual({
        task: createTask(store, {
            id: action1.taskId,
            time: action1.time,
            taskAction: action1.taskAction,
        }),
        actions: null,
        optimisticState: {
            original: {
                task: null,
                actions: [],
            },
            actions: [{isOptimistic: true, action: action1}],
        },
        authorizationState: expect.objectContaining({
            value: "Authorized",
            version: zeroHybridLogicalTime,
        }),
    });

    store.commitTaskActionTransaction(context, [action2], {
        undoManager: null,
        affinityManager: noopAffinityManager,
    });

    expect(getTaskEntryIfExists(store, action1.taskId)).toEqual({
        task: createTask(store, {
            id: action1.taskId,
            time: action1.time,
            taskAction: action1.taskAction,
        }).applyAction(action2, getSortableAccount),
        actions: null,
        optimisticState: {
            original: {
                task: null,
                actions: [],
            },
            actions: [
                {isOptimistic: true, action: action1},
                {isOptimistic: true, action: action2},
            ],
        },
        authorizationState: expect.objectContaining({
            value: "Authorized",
            version: zeroHybridLogicalTime,
        }),
    });

    await rejectRpcExecution(commitTaskActionTransaction, 0);

    expect(getTaskEntryIfExists(store, action1.taskId)).toEqual({
        task: null,
        actions: [action2],
        optimisticState: {
            original: {
                task: null,
                actions: [],
            },
            actions: [{isOptimistic: true, action: action2}],
        },
        authorizationState: expect.objectContaining({
            value: "Authorized",
            version: zeroHybridLogicalTime,
        }),
    });

    await rejectRpcExecution(commitTaskActionTransaction, 1);

    expect(getTaskEntryIfExists(store, action1.taskId)).toEqual({
        task: null,
        actions: [],
        optimisticState: null,
        authorizationState: expect.objectContaining({
            value: "Authorized",
            version: zeroHybridLogicalTime,
        }),
    });

    expect(errors.length).toEqual(2);
    errors = [];
});

test("can create then update tasks optimistically and resolve commits out of order (rejected)", async () => {
    const store = createAutoRetainStore();

    const action1 = {
        type: "UpdateTask",
        time: store.clock.now(),
        taskId: generateId(),
        taskAction: {
            type: "Create",
            creatorId: account1.id,
            creatorTimeZone: defaultTimeZone,
        },
    } satisfies TaskAction;

    const action2 = {
        type: "UpdateTask",
        time: store.clock.now(),
        taskId: action1.taskId,
        taskAction: {
            type: "UpdatePriority",
            priority: "High",
        },
    } satisfies TaskAction;

    expect(getTaskEntryIfExists(store, action1.taskId)).toEqual(null);

    store.commitTaskActionTransaction(context, [action1], {
        undoManager: null,
        affinityManager: noopAffinityManager,
    });

    expect(getTaskEntryIfExists(store, action1.taskId)).toEqual({
        task: createTask(store, {
            id: action1.taskId,
            time: action1.time,
            taskAction: action1.taskAction,
        }),
        actions: null,
        optimisticState: {
            original: {
                task: null,
                actions: [],
            },
            actions: [{isOptimistic: true, action: action1}],
        },
        authorizationState: expect.objectContaining({
            value: "Authorized",
            version: zeroHybridLogicalTime,
        }),
    });

    store.commitTaskActionTransaction(context, [action2], {
        undoManager: null,
        affinityManager: noopAffinityManager,
    });

    expect(getTaskEntryIfExists(store, action1.taskId)).toEqual({
        task: createTask(store, {
            id: action1.taskId,
            time: action1.time,
            taskAction: action1.taskAction,
        }).applyAction(action2, getSortableAccount),
        actions: null,
        optimisticState: {
            original: {
                task: null,
                actions: [],
            },
            actions: [
                {isOptimistic: true, action: action1},
                {isOptimistic: true, action: action2},
            ],
        },
        authorizationState: expect.objectContaining({
            value: "Authorized",
            version: zeroHybridLogicalTime,
        }),
    });

    await rejectRpcExecution(commitTaskActionTransaction, 1);

    expect(getTaskEntryIfExists(store, action1.taskId)).toEqual({
        task: createTask(store, {
            id: action1.taskId,
            time: action1.time,
            taskAction: action1.taskAction,
        }),
        actions: null,
        optimisticState: {
            original: {
                task: null,
                actions: [],
            },
            actions: [{isOptimistic: true, action: action1}],
        },
        authorizationState: expect.objectContaining({
            value: "Authorized",
            version: zeroHybridLogicalTime,
        }),
    });

    await rejectRpcExecution(commitTaskActionTransaction, 0);

    expect(getTaskEntryIfExists(store, action1.taskId)).toEqual({
        task: null,
        actions: [],
        optimisticState: null,
        authorizationState: expect.objectContaining({
            value: "Authorized",
            version: zeroHybridLogicalTime,
        }),
    });

    expect(errors.length).toEqual(2);
    errors = [];
});

test("can create then update tasks optimistically after an action from the server (rejected)", async () => {
    const store = createAutoRetainStore();

    const action2Time = store.clock.now();

    const action1 = {
        type: "UpdateTask",
        time: store.clock.now(),
        taskId: generateId(),
        taskAction: {
            type: "UpdateDueDate",
            dueDate: new CalendarDate(1998, 7, 12),
        },
    } satisfies TaskAction;

    const action2 = {
        type: "UpdateTask",
        time: action2Time,
        taskId: action1.taskId,
        taskAction: {
            type: "Create",
            creatorId: account1.id,
            creatorTimeZone: defaultTimeZone,
        },
    } satisfies TaskAction;

    const action3 = {
        type: "UpdateTask",
        time: store.clock.now(),
        taskId: action2.taskId,
        taskAction: {
            type: "UpdatePriority",
            priority: "High",
        },
    } satisfies TaskAction;

    expect(getTaskEntryIfExists(store, action2.taskId)).toEqual(null);

    store.applyUpdateEvent({
        type: "Update",
        originClientId: null,
        defaultAuthorizationStateVersion: clock.now(),
        actions: [action1],
        backfillTasks: [],
        backfillCollections: [],
        referencedAccounts: [],
    });

    expect(getTaskEntryIfExists(store, action2.taskId)).toEqual({
        task: null,
        actions: [action1],
        optimisticState: null,
        authorizationState: null,
    });

    store.commitTaskActionTransaction(context, [action2], {
        undoManager: null,
        affinityManager: noopAffinityManager,
    });

    expect(getTaskEntryIfExists(store, action2.taskId)).toEqual({
        task: createTask(store, {
            id: action2.taskId,
            time: action2.time,
            taskAction: action2.taskAction,
        }).applyAction(action1, getSortableAccount),
        actions: null,
        optimisticState: {
            original: {
                task: null,
                actions: [action1],
            },
            actions: [{isOptimistic: true, action: action2}],
        },
        authorizationState: expect.objectContaining({
            value: "Authorized",
            version: zeroHybridLogicalTime,
        }),
    });

    store.commitTaskActionTransaction(context, [action3], {
        undoManager: null,
        affinityManager: noopAffinityManager,
    });

    expect(getTaskEntryIfExists(store, action2.taskId)).toEqual({
        task: createTask(store, {
            id: action2.taskId,
            time: action2.time,
            taskAction: action2.taskAction,
        })
            .applyAction(action1, getSortableAccount)
            .applyAction(action3, getSortableAccount),
        actions: null,
        optimisticState: {
            original: {
                task: null,
                actions: [action1],
            },
            actions: [
                {isOptimistic: true, action: action2},
                {isOptimistic: true, action: action3},
            ],
        },
        authorizationState: expect.objectContaining({
            value: "Authorized",
            version: zeroHybridLogicalTime,
        }),
    });

    await rejectRpcExecution(commitTaskActionTransaction, 0);

    expect(getTaskEntryIfExists(store, action2.taskId)).toEqual({
        task: null,
        actions: [action1, action3],
        optimisticState: {
            original: {
                task: null,
                actions: [action1],
            },
            actions: [{isOptimistic: true, action: action3}],
        },
        authorizationState: expect.objectContaining({
            value: "Authorized",
            version: zeroHybridLogicalTime,
        }),
    });

    await rejectRpcExecution(commitTaskActionTransaction, 1);

    expect(getTaskEntryIfExists(store, action2.taskId)).toEqual({
        task: null,
        actions: [action1],
        optimisticState: null,
        authorizationState: expect.objectContaining({
            value: "Authorized",
            version: zeroHybridLogicalTime,
        }),
    });

    expect(errors.length).toEqual(2);
    errors = [];
});

test("can create then update tasks optimistically our of order (rejected)", async () => {
    const store = createAutoRetainStore();

    const action1 = {
        type: "UpdateTask",
        time: store.clock.now(),
        taskId: generateId(),
        taskAction: {
            type: "Create",
            creatorId: account1.id,
            creatorTimeZone: defaultTimeZone,
        },
    } satisfies TaskAction;

    const action2 = {
        type: "UpdateTask",
        time: store.clock.now(),
        taskId: action1.taskId,
        taskAction: {
            type: "UpdatePriority",
            priority: "High",
        },
    } satisfies TaskAction;

    expect(getTaskEntryIfExists(store, action1.taskId)).toEqual(null);

    store.commitTaskActionTransaction(context, [action2], {
        undoManager: null,
        affinityManager: noopAffinityManager,
    });

    expect(getTaskEntryIfExists(store, action1.taskId)).toEqual({
        task: null,
        actions: [action2],
        optimisticState: {
            original: {
                task: null,
                actions: [],
            },
            actions: [{isOptimistic: true, action: action2}],
        },
        authorizationState: null,
    });

    store.commitTaskActionTransaction(context, [action1], {
        undoManager: null,
        affinityManager: noopAffinityManager,
    });

    expect(getTaskEntryIfExists(store, action1.taskId)).toEqual({
        task: createTask(store, {
            id: action1.taskId,
            time: action1.time,
            taskAction: action1.taskAction,
        }).applyAction(action2, getSortableAccount),
        actions: null,
        optimisticState: {
            original: {
                task: null,
                actions: [],
            },
            actions: [
                {isOptimistic: true, action: action2},
                {isOptimistic: true, action: action1},
            ],
        },
        authorizationState: expect.objectContaining({
            value: "Authorized",
            version: zeroHybridLogicalTime,
        }),
    });

    await rejectRpcExecution(commitTaskActionTransaction, 0);

    expect(getTaskEntryIfExists(store, action1.taskId)).toEqual({
        task: createTask(store, {
            id: action1.taskId,
            time: action1.time,
            taskAction: action1.taskAction,
        }),
        actions: null,
        optimisticState: {
            original: {
                task: null,
                actions: [],
            },
            actions: [{isOptimistic: true, action: action1}],
        },
        authorizationState: expect.objectContaining({
            value: "Authorized",
            version: zeroHybridLogicalTime,
        }),
    });

    await rejectRpcExecution(commitTaskActionTransaction, 1);

    expect(getTaskEntryIfExists(store, action1.taskId)).toEqual({
        task: null,
        actions: [],
        optimisticState: null,
        authorizationState: expect.objectContaining({
            value: "Authorized",
            version: zeroHybridLogicalTime,
        }),
    });

    expect(errors.length).toEqual(2);
    errors = [];
});

test("can create then update tasks optimistically out of order after an action from the server (rejected)", async () => {
    const store = createAutoRetainStore();

    const action2Time = store.clock.now();

    const action1 = {
        type: "UpdateTask",
        time: store.clock.now(),
        taskId: generateId(),
        taskAction: {
            type: "UpdateDueDate",
            dueDate: new CalendarDate(1998, 7, 12),
        },
    } satisfies TaskAction;

    const action2 = {
        type: "UpdateTask",
        time: action2Time,
        taskId: action1.taskId,
        taskAction: {
            type: "Create",
            creatorId: account1.id,
            creatorTimeZone: defaultTimeZone,
        },
    } satisfies TaskAction;

    const action3 = {
        type: "UpdateTask",
        time: store.clock.now(),
        taskId: action2.taskId,
        taskAction: {
            type: "UpdatePriority",
            priority: "High",
        },
    } satisfies TaskAction;

    expect(getTaskEntryIfExists(store, action2.taskId)).toEqual(null);

    store.applyUpdateEvent({
        type: "Update",
        originClientId: null,
        defaultAuthorizationStateVersion: clock.now(),
        actions: [action1],
        backfillTasks: [],
        backfillCollections: [],
        referencedAccounts: [],
    });

    expect(getTaskEntryIfExists(store, action2.taskId)).toEqual({
        task: null,
        actions: [action1],
        optimisticState: null,
        authorizationState: null,
    });

    store.commitTaskActionTransaction(context, [action3], {
        undoManager: null,
        affinityManager: noopAffinityManager,
    });

    expect(getTaskEntryIfExists(store, action2.taskId)).toEqual({
        task: null,
        actions: [action1, action3],
        optimisticState: {
            original: {
                task: null,
                actions: [action1],
            },
            actions: [{isOptimistic: true, action: action3}],
        },
        authorizationState: null,
    });

    store.commitTaskActionTransaction(context, [action2], {
        undoManager: null,
        affinityManager: noopAffinityManager,
    });

    expect(getTaskEntryIfExists(store, action2.taskId)).toEqual({
        task: createTask(store, {
            id: action2.taskId,
            time: action2.time,
            taskAction: action2.taskAction,
        })
            .applyAction(action1, getSortableAccount)
            .applyAction(action3, getSortableAccount),
        actions: null,
        optimisticState: {
            original: {
                task: null,
                actions: [action1],
            },
            actions: [
                {isOptimistic: true, action: action3},
                {isOptimistic: true, action: action2},
            ],
        },
        authorizationState: expect.objectContaining({
            value: "Authorized",
            version: zeroHybridLogicalTime,
        }),
    });

    await rejectRpcExecution(commitTaskActionTransaction, 0);

    expect(getTaskEntryIfExists(store, action2.taskId)).toEqual({
        task: createTask(store, {
            id: action2.taskId,
            time: action2.time,
            taskAction: action2.taskAction,
        }).applyAction(action1, getSortableAccount),
        actions: null,
        optimisticState: {
            original: {
                task: null,
                actions: [action1],
            },
            actions: [{isOptimistic: true, action: action2}],
        },
        authorizationState: expect.objectContaining({
            value: "Authorized",
            version: zeroHybridLogicalTime,
        }),
    });

    await rejectRpcExecution(commitTaskActionTransaction, 1);

    expect(getTaskEntryIfExists(store, action2.taskId)).toEqual({
        task: null,
        actions: [action1],
        optimisticState: null,
        authorizationState: expect.objectContaining({
            value: "Authorized",
            version: zeroHybridLogicalTime,
        }),
    });

    expect(errors.length).toEqual(2);
    errors = [];
});

test("can create then update tasks optimistically out of order with more non-create tasks (rejected)", async () => {
    const store = createAutoRetainStore();

    const action2Time = store.clock.now();

    const action1 = {
        type: "UpdateTask",
        time: store.clock.now(),
        taskId: generateId(),
        taskAction: {
            type: "UpdateDueDate",
            dueDate: new CalendarDate(1998, 7, 12),
        },
    } satisfies TaskAction;

    const action2 = {
        type: "UpdateTask",
        time: action2Time,
        taskId: action1.taskId,
        taskAction: {
            type: "Create",
            creatorId: account1.id,
            creatorTimeZone: defaultTimeZone,
        },
    } satisfies TaskAction;

    const action3 = {
        type: "UpdateTask",
        time: store.clock.now(),
        taskId: action2.taskId,
        taskAction: {
            type: "UpdatePriority",
            priority: "High",
        },
    } satisfies TaskAction;

    expect(getTaskEntryIfExists(store, action2.taskId)).toEqual(null);

    store.commitTaskActionTransaction(context, [action1], {
        undoManager: null,
        affinityManager: noopAffinityManager,
    });

    expect(getTaskEntryIfExists(store, action2.taskId)).toEqual({
        task: null,
        actions: [action1],
        optimisticState: {
            original: {
                task: null,
                actions: [],
            },
            actions: [{isOptimistic: true, action: action1}],
        },
        authorizationState: null,
    });

    store.commitTaskActionTransaction(context, [action3], {
        undoManager: null,
        affinityManager: noopAffinityManager,
    });

    expect(getTaskEntryIfExists(store, action2.taskId)).toEqual({
        task: null,
        actions: [action1, action3],
        optimisticState: {
            original: {
                task: null,
                actions: [],
            },
            actions: [
                {isOptimistic: true, action: action1},
                {isOptimistic: true, action: action3},
            ],
        },
        authorizationState: null,
    });

    store.commitTaskActionTransaction(context, [action2], {
        undoManager: null,
        affinityManager: noopAffinityManager,
    });

    expect(getTaskEntryIfExists(store, action2.taskId)).toEqual({
        task: createTask(store, {
            id: action2.taskId,
            time: action2.time,
            taskAction: action2.taskAction,
        })
            .applyAction(action1, getSortableAccount)
            .applyAction(action3, getSortableAccount),
        actions: null,
        optimisticState: {
            original: {
                task: null,
                actions: [],
            },
            actions: [
                {isOptimistic: true, action: action1},
                {isOptimistic: true, action: action3},
                {isOptimistic: true, action: action2},
            ],
        },
        authorizationState: expect.objectContaining({
            value: "Authorized",
            version: zeroHybridLogicalTime,
        }),
    });

    await rejectRpcExecution(commitTaskActionTransaction, 0);

    expect(getTaskEntryIfExists(store, action2.taskId)).toEqual({
        task: createTask(store, {
            id: action2.taskId,
            time: action2.time,
            taskAction: action2.taskAction,
        }).applyAction(action3, getSortableAccount),
        actions: null,
        optimisticState: {
            original: {
                task: null,
                actions: [],
            },
            actions: [
                {isOptimistic: true, action: action3},
                {isOptimistic: true, action: action2},
            ],
        },
        authorizationState: expect.objectContaining({
            value: "Authorized",
            version: zeroHybridLogicalTime,
        }),
    });

    await rejectRpcExecution(commitTaskActionTransaction, 1);

    expect(getTaskEntryIfExists(store, action2.taskId)).toEqual({
        task: createTask(store, {
            id: action2.taskId,
            time: action2.time,
            taskAction: action2.taskAction,
        }),
        actions: null,
        optimisticState: {
            original: {
                task: null,
                actions: [],
            },
            actions: [{isOptimistic: true, action: action2}],
        },
        authorizationState: expect.objectContaining({
            value: "Authorized",
            version: zeroHybridLogicalTime,
        }),
    });

    await rejectRpcExecution(commitTaskActionTransaction, 2);

    expect(getTaskEntryIfExists(store, action2.taskId)).toEqual({
        task: null,
        actions: [],
        optimisticState: null,
        authorizationState: expect.objectContaining({
            value: "Authorized",
            version: zeroHybridLogicalTime,
        }),
    });

    expect(errors.length).toEqual(3);
    errors = [];
});

test("resolving task optimistic update after garbage collection is ok (rejected)", async () => {
    const store = createAutoRetainStore();

    const action1 = {
        type: "UpdateTask",
        time: store.clock.now(),
        taskId: generateId(),
        taskAction: {
            type: "Create",
            creatorId: account1.id,
            creatorTimeZone: defaultTimeZone,
        },
    } satisfies TaskAction;

    const action2 = {
        type: "UpdateTask",
        time: store.clock.now(),
        taskId: action1.taskId,
        taskAction: {
            type: "UpdatePriority",
            priority: "High",
        },
    } satisfies TaskAction;

    expect(getTaskEntryIfExists(store, action1.taskId)).toEqual(null);

    store.commitTaskActionTransaction(context, [action1], {
        undoManager: null,
        affinityManager: noopAffinityManager,
    });

    expect(getTaskEntryIfExists(store, action1.taskId)).toEqual({
        task: createTask(store, {
            id: action1.taskId,
            time: action1.time,
            taskAction: action1.taskAction,
        }),
        actions: null,
        optimisticState: {
            original: {
                task: null,
                actions: [],
            },
            actions: [{isOptimistic: true, action: action1}],
        },
        authorizationState: expect.objectContaining({
            value: "Authorized",
            version: zeroHybridLogicalTime,
        }),
    });

    store.commitTaskActionTransaction(context, [action2], {
        undoManager: null,
        affinityManager: noopAffinityManager,
    });

    expect(getTaskEntryIfExists(store, action1.taskId)).toEqual({
        task: createTask(store, {
            id: action1.taskId,
            time: action1.time,
            taskAction: action1.taskAction,
        }).applyAction(action2, getSortableAccount),
        actions: null,
        optimisticState: {
            original: {
                task: null,
                actions: [],
            },
            actions: [
                {isOptimistic: true, action: action1},
                {isOptimistic: true, action: action2},
            ],
        },
        authorizationState: expect.objectContaining({
            value: "Authorized",
            version: zeroHybridLogicalTime,
        }),
    });

    await resolveRpcExecution(commitTaskActionTransaction, 0, {
        extraActions: [],
        referencedAccounts: [],
    });

    expect(getTaskEntryIfExists(store, action1.taskId)).toEqual({
        task: createTask(store, {
            id: action1.taskId,
            time: action1.time,
            taskAction: action1.taskAction,
        }).applyAction(action2, getSortableAccount),
        actions: null,
        optimisticState: {
            original: {
                task: createTask(store, {
                    id: action1.taskId,
                    time: action1.time,
                    taskAction: action1.taskAction,
                }),
                actions: null,
            },
            actions: [{isOptimistic: true, action: action2}],
        },
        authorizationState: expect.objectContaining({
            value: "Authorized",
            version: zeroHybridLogicalTime,
        }),
    });

    const previousTaskSubscriptions = taskSubscriptions;
    taskSubscriptions = [];
    for (const subscription of previousTaskSubscriptions) {
        subscription.release();
    }

    expect(getTaskEntryIfExists(store, action1.taskId)).toEqual(null);

    await rejectRpcExecution(commitTaskActionTransaction, 1);

    expect(getTaskEntryIfExists(store, action1.taskId)).toEqual(null);

    expect(errors.length).toEqual(1);
    errors = [];
});

test("regular task actions are added to optimistic state (rejected)", async () => {
    const store = createAutoRetainStore();

    const task = createTask(store);

    const action2 = {
        type: "UpdateTask",
        time: store.clock.now(),
        taskId: task.id,
        taskAction: {
            type: "UpdatePriority",
            priority: "High",
        },
    } satisfies TaskAction;

    const action3 = {
        type: "UpdateTask",
        time: store.clock.now(),
        taskId: task.id,
        taskAction: {
            type: "UpdateDueDate",
            dueDate: new CalendarDate(1998, 7, 12),
        },
    } satisfies TaskAction;

    expect(getTaskEntryIfExists(store, task.id)).toEqual(null);

    store.applyUpdateEvent({
        type: "Update",
        originClientId: null,
        defaultAuthorizationStateVersion: clock.now(),
        actions: [],
        backfillTasks: [{type: "Authorized", task: task}],
        backfillCollections: [],
        referencedAccounts: [],
    });

    expect(getTaskEntryIfExists(store, task.id)).toEqual({
        task,
        actions: null,
        optimisticState: null,
        authorizationState: expect.objectContaining({value: "Authorized"}),
    });

    store.commitTaskActionTransaction(context, [action2], {
        undoManager: null,
        affinityManager: noopAffinityManager,
    });

    expect(getTaskEntryIfExists(store, task.id)).toEqual({
        task: task.applyAction(action2, getSortableAccount),
        actions: null,
        optimisticState: {
            original: {
                task: task,
                actions: null,
            },
            actions: [{isOptimistic: true, action: action2}],
        },
        authorizationState: expect.objectContaining({value: "Authorized"}),
    });

    store.applyUpdateEvent({
        type: "Update",
        originClientId: null,
        defaultAuthorizationStateVersion: clock.now(),
        actions: [action3],
        backfillTasks: [],
        backfillCollections: [],
        referencedAccounts: [],
    });

    expect(getTaskEntryIfExists(store, task.id)).toEqual({
        task: task
            .applyAction(action2, getSortableAccount)
            .applyAction(action3, getSortableAccount),
        actions: null,
        optimisticState: {
            original: {
                task: task,
                actions: null,
            },
            actions: [
                {isOptimistic: true, action: action2},
                {isOptimistic: false, action: action3},
            ],
        },
        authorizationState: expect.objectContaining({value: "Authorized"}),
    });

    await rejectRpcExecution(commitTaskActionTransaction, 0);

    expect(getTaskEntryIfExists(store, task.id)).toEqual({
        task: task.applyAction(action3, getSortableAccount),
        actions: null,
        optimisticState: null,
        authorizationState: expect.objectContaining({value: "Authorized"}),
    });

    expect(errors.length).toEqual(1);
    errors = [];
});

test("regular task actions are added to optimistic state with multiple actions (rejected)", async () => {
    const store = createAutoRetainStore();

    const task = createTask(store);

    const action2 = {
        type: "UpdateTask",
        time: store.clock.now(),
        taskId: task.id,
        taskAction: {
            type: "UpdatePriority",
            priority: "High",
        },
    } satisfies TaskAction;

    const action3 = {
        type: "UpdateTask",
        time: store.clock.now(),
        taskId: task.id,
        taskAction: {
            type: "UpdateDueDate",
            dueDate: new CalendarDate(1998, 7, 12),
        },
    } satisfies TaskAction;

    const action4 = {
        type: "UpdateTask",
        time: store.clock.now(),
        taskId: task.id,
        taskAction: {
            type: "UpdatePriority",
            priority: "Low",
        },
    } satisfies TaskAction;

    expect(getTaskEntryIfExists(store, task.id)).toEqual(null);

    store.applyUpdateEvent({
        type: "Update",
        originClientId: null,
        defaultAuthorizationStateVersion: clock.now(),
        actions: [],
        backfillTasks: [{type: "Authorized", task: task}],
        backfillCollections: [],
        referencedAccounts: [],
    });

    expect(getTaskEntryIfExists(store, task.id)).toEqual({
        task,
        actions: null,
        optimisticState: null,
        authorizationState: expect.objectContaining({value: "Authorized"}),
    });

    store.commitTaskActionTransaction(context, [action2], {
        undoManager: null,
        affinityManager: noopAffinityManager,
    });

    expect(getTaskEntryIfExists(store, task.id)).toEqual({
        task: task.applyAction(action2, getSortableAccount),
        actions: null,
        optimisticState: {
            original: {
                task: task,
                actions: null,
            },
            actions: [{isOptimistic: true, action: action2}],
        },
        authorizationState: expect.objectContaining({value: "Authorized"}),
    });

    store.applyUpdateEvent({
        type: "Update",
        originClientId: null,
        defaultAuthorizationStateVersion: clock.now(),
        actions: [action3],
        backfillTasks: [],
        backfillCollections: [],
        referencedAccounts: [],
    });

    expect(getTaskEntryIfExists(store, task.id)).toEqual({
        task: task
            .applyAction(action2, getSortableAccount)
            .applyAction(action3, getSortableAccount),
        actions: null,
        optimisticState: {
            original: {
                task: task,
                actions: null,
            },
            actions: [
                {isOptimistic: true, action: action2},
                {isOptimistic: false, action: action3},
            ],
        },
        authorizationState: expect.objectContaining({value: "Authorized"}),
    });

    store.commitTaskActionTransaction(context, [action4], {
        undoManager: null,
        affinityManager: noopAffinityManager,
    });

    expect(getTaskEntryIfExists(store, task.id)).toEqual({
        task: task
            .applyAction(action2, getSortableAccount)
            .applyAction(action3, getSortableAccount)
            .applyAction(action4, getSortableAccount),
        actions: null,
        optimisticState: {
            original: {
                task: task,
                actions: null,
            },
            actions: [
                {isOptimistic: true, action: action2},
                {isOptimistic: false, action: action3},
                {isOptimistic: true, action: action4},
            ],
        },
        authorizationState: expect.objectContaining({value: "Authorized"}),
    });

    await rejectRpcExecution(commitTaskActionTransaction, 0);

    expect(getTaskEntryIfExists(store, task.id)).toEqual({
        task: task
            .applyAction(action3, getSortableAccount)
            .applyAction(action4, getSortableAccount),
        actions: null,
        optimisticState: {
            original: {
                task: task.applyAction(action3, getSortableAccount),
                actions: null,
            },
            actions: [{isOptimistic: true, action: action4}],
        },
        authorizationState: expect.objectContaining({value: "Authorized"}),
    });

    await rejectRpcExecution(commitTaskActionTransaction, 1);

    expect(getTaskEntryIfExists(store, task.id)).toEqual({
        task: task.applyAction(action3, getSortableAccount),
        actions: null,
        optimisticState: null,
        authorizationState: expect.objectContaining({value: "Authorized"}),
    });

    expect(errors.length).toEqual(2);
    errors = [];
});

test("regular task actions are added to optimistic state with multiple actions that are committed out of order (rejected)", async () => {
    const store = createAutoRetainStore();

    const task = createTask(store);

    const action2 = {
        type: "UpdateTask",
        time: store.clock.now(),
        taskId: task.id,
        taskAction: {
            type: "UpdatePriority",
            priority: "High",
        },
    } satisfies TaskAction;

    const action3 = {
        type: "UpdateTask",
        time: store.clock.now(),
        taskId: task.id,
        taskAction: {
            type: "UpdateDueDate",
            dueDate: new CalendarDate(1998, 7, 12),
        },
    } satisfies TaskAction;

    const action4 = {
        type: "UpdateTask",
        time: store.clock.now(),
        taskId: task.id,
        taskAction: {
            type: "UpdatePriority",
            priority: "Low",
        },
    } satisfies TaskAction;

    expect(getTaskEntryIfExists(store, task.id)).toEqual(null);

    store.applyUpdateEvent({
        type: "Update",
        originClientId: null,
        defaultAuthorizationStateVersion: clock.now(),
        actions: [],
        backfillTasks: [{type: "Authorized", task: task}],
        backfillCollections: [],
        referencedAccounts: [],
    });

    expect(getTaskEntryIfExists(store, task.id)).toEqual({
        task,
        actions: null,
        optimisticState: null,
        authorizationState: expect.objectContaining({value: "Authorized"}),
    });

    store.commitTaskActionTransaction(context, [action2], {
        undoManager: null,
        affinityManager: noopAffinityManager,
    });

    expect(getTaskEntryIfExists(store, task.id)).toEqual({
        task: task.applyAction(action2, getSortableAccount),
        actions: null,
        optimisticState: {
            original: {
                task: task,
                actions: null,
            },
            actions: [{isOptimistic: true, action: action2}],
        },
        authorizationState: expect.objectContaining({value: "Authorized"}),
    });

    store.applyUpdateEvent({
        type: "Update",
        originClientId: null,
        defaultAuthorizationStateVersion: clock.now(),
        actions: [action3],
        backfillTasks: [],
        backfillCollections: [],
        referencedAccounts: [],
    });

    expect(getTaskEntryIfExists(store, task.id)).toEqual({
        task: task
            .applyAction(action2, getSortableAccount)
            .applyAction(action3, getSortableAccount),
        actions: null,
        optimisticState: {
            original: {
                task: task,
                actions: null,
            },
            actions: [
                {isOptimistic: true, action: action2},
                {isOptimistic: false, action: action3},
            ],
        },
        authorizationState: expect.objectContaining({value: "Authorized"}),
    });

    store.commitTaskActionTransaction(context, [action4], {
        undoManager: null,
        affinityManager: noopAffinityManager,
    });

    expect(getTaskEntryIfExists(store, task.id)).toEqual({
        task: task
            .applyAction(action2, getSortableAccount)
            .applyAction(action3, getSortableAccount)
            .applyAction(action4, getSortableAccount),
        actions: null,
        optimisticState: {
            original: {
                task: task,
                actions: null,
            },
            actions: [
                {isOptimistic: true, action: action2},
                {isOptimistic: false, action: action3},
                {isOptimistic: true, action: action4},
            ],
        },
        authorizationState: expect.objectContaining({value: "Authorized"}),
    });

    await rejectRpcExecution(commitTaskActionTransaction, 1);

    expect(getTaskEntryIfExists(store, task.id)).toEqual({
        task: task
            .applyAction(action2, getSortableAccount)
            .applyAction(action3, getSortableAccount),
        actions: null,
        optimisticState: {
            original: {
                task: task,
                actions: null,
            },
            actions: [
                {isOptimistic: true, action: action2},
                {isOptimistic: false, action: action3},
            ],
        },
        authorizationState: expect.objectContaining({value: "Authorized"}),
    });

    await rejectRpcExecution(commitTaskActionTransaction, 0);

    expect(getTaskEntryIfExists(store, task.id)).toEqual({
        task: task.applyAction(action3, getSortableAccount),
        actions: null,
        optimisticState: null,
        authorizationState: expect.objectContaining({value: "Authorized"}),
    });

    expect(errors.length).toEqual(2);
    errors = [];
});

test("regular actions are added to optimistic state when task is not backfilled (rejected)", async () => {
    const store = createAutoRetainStore();

    const task = createTask(store);

    const action2 = {
        type: "UpdateTask",
        time: store.clock.now(),
        taskId: task.id,
        taskAction: {
            type: "UpdatePriority",
            priority: "High",
        },
    } satisfies TaskAction;

    const action3 = {
        type: "UpdateTask",
        time: store.clock.now(),
        taskId: task.id,
        taskAction: {
            type: "UpdateDueDate",
            dueDate: new CalendarDate(1998, 7, 12),
        },
    } satisfies TaskAction;

    expect(getTaskEntryIfExists(store, task.id)).toEqual(null);

    store.commitTaskActionTransaction(context, [action2], {
        undoManager: null,
        affinityManager: noopAffinityManager,
    });

    expect(getTaskEntryIfExists(store, task.id)).toEqual({
        task: null,
        actions: [action2],
        optimisticState: {
            original: {
                task: null,
                actions: [],
            },
            actions: [{isOptimistic: true, action: action2}],
        },
        authorizationState: null,
    });

    store.applyUpdateEvent({
        type: "Update",
        originClientId: null,
        defaultAuthorizationStateVersion: clock.now(),
        actions: [action3],
        backfillTasks: [],
        backfillCollections: [],
        referencedAccounts: [],
    });

    expect(getTaskEntryIfExists(store, task.id)).toEqual({
        task: null,
        actions: [action2, action3],
        optimisticState: {
            original: {
                task: null,
                actions: [],
            },
            actions: [
                {isOptimistic: true, action: action2},
                {isOptimistic: false, action: action3},
            ],
        },
        authorizationState: null,
    });

    await rejectRpcExecution(commitTaskActionTransaction, 0);

    expect(getTaskEntryIfExists(store, task.id)).toEqual({
        task: null,
        actions: [action3],
        optimisticState: null,
        authorizationState: null,
    });

    expect(errors.length).toEqual(1);
    errors = [];
});

test("regular actions are added to optimistic state with multiple actions when task is not backfilled (rejected)", async () => {
    const store = createAutoRetainStore();

    const task = createTask(store);

    const action2 = {
        type: "UpdateTask",
        time: store.clock.now(),
        taskId: task.id,
        taskAction: {
            type: "UpdatePriority",
            priority: "High",
        },
    } satisfies TaskAction;

    const action3 = {
        type: "UpdateTask",
        time: store.clock.now(),
        taskId: task.id,
        taskAction: {
            type: "UpdateDueDate",
            dueDate: new CalendarDate(1998, 7, 12),
        },
    } satisfies TaskAction;

    const action4 = {
        type: "UpdateTask",
        time: store.clock.now(),
        taskId: task.id,
        taskAction: {
            type: "UpdatePriority",
            priority: "Low",
        },
    } satisfies TaskAction;

    expect(getTaskEntryIfExists(store, task.id)).toEqual(null);

    store.commitTaskActionTransaction(context, [action2], {
        undoManager: null,
        affinityManager: noopAffinityManager,
    });

    expect(getTaskEntryIfExists(store, task.id)).toEqual({
        task: null,
        actions: [action2],
        optimisticState: {
            original: {
                task: null,
                actions: [],
            },
            actions: [{isOptimistic: true, action: action2}],
        },
        authorizationState: null,
    });

    store.applyUpdateEvent({
        type: "Update",
        originClientId: null,
        defaultAuthorizationStateVersion: clock.now(),
        actions: [action3],
        backfillTasks: [],
        backfillCollections: [],
        referencedAccounts: [],
    });

    expect(getTaskEntryIfExists(store, task.id)).toEqual({
        task: null,
        actions: [action2, action3],
        optimisticState: {
            original: {
                task: null,
                actions: [],
            },
            actions: [
                {isOptimistic: true, action: action2},
                {isOptimistic: false, action: action3},
            ],
        },
        authorizationState: null,
    });

    store.commitTaskActionTransaction(context, [action4], {
        undoManager: null,
        affinityManager: noopAffinityManager,
    });

    expect(getTaskEntryIfExists(store, task.id)).toEqual({
        task: null,
        actions: [action2, action3, action4],
        optimisticState: {
            original: {
                task: null,
                actions: [],
            },
            actions: [
                {isOptimistic: true, action: action2},
                {isOptimistic: false, action: action3},
                {isOptimistic: true, action: action4},
            ],
        },
        authorizationState: null,
    });

    await rejectRpcExecution(commitTaskActionTransaction, 0);

    expect(getTaskEntryIfExists(store, task.id)).toEqual({
        task: null,
        actions: [action3, action4],
        optimisticState: {
            original: {
                task: null,
                actions: [action3],
            },
            actions: [{isOptimistic: true, action: action4}],
        },
        authorizationState: null,
    });

    await rejectRpcExecution(commitTaskActionTransaction, 1);

    expect(getTaskEntryIfExists(store, task.id)).toEqual({
        task: null,
        actions: [action3],
        optimisticState: null,
        authorizationState: null,
    });

    expect(errors.length).toEqual(2);
    errors = [];
});

test("regular actions are added to optimistic state with multiple actions that are committed out of order when task is not backfilled (rejected)", async () => {
    const store = createAutoRetainStore();

    const task = createTask(store);

    const action2 = {
        type: "UpdateTask",
        time: store.clock.now(),
        taskId: task.id,
        taskAction: {
            type: "UpdatePriority",
            priority: "High",
        },
    } satisfies TaskAction;

    const action3 = {
        type: "UpdateTask",
        time: store.clock.now(),
        taskId: task.id,
        taskAction: {
            type: "UpdateDueDate",
            dueDate: new CalendarDate(1998, 7, 12),
        },
    } satisfies TaskAction;

    const action4 = {
        type: "UpdateTask",
        time: store.clock.now(),
        taskId: task.id,
        taskAction: {
            type: "UpdatePriority",
            priority: "Low",
        },
    } satisfies TaskAction;

    expect(getTaskEntryIfExists(store, task.id)).toEqual(null);

    store.commitTaskActionTransaction(context, [action2], {
        undoManager: null,
        affinityManager: noopAffinityManager,
    });

    expect(getTaskEntryIfExists(store, task.id)).toEqual({
        task: null,
        actions: [action2],
        optimisticState: {
            original: {
                task: null,
                actions: [],
            },
            actions: [{isOptimistic: true, action: action2}],
        },
        authorizationState: null,
    });

    store.applyUpdateEvent({
        type: "Update",
        originClientId: null,
        defaultAuthorizationStateVersion: clock.now(),
        actions: [action3],
        backfillTasks: [],
        backfillCollections: [],
        referencedAccounts: [],
    });

    expect(getTaskEntryIfExists(store, task.id)).toEqual({
        task: null,
        actions: [action2, action3],
        optimisticState: {
            original: {
                task: null,
                actions: [],
            },
            actions: [
                {isOptimistic: true, action: action2},
                {isOptimistic: false, action: action3},
            ],
        },
        authorizationState: null,
    });

    store.commitTaskActionTransaction(context, [action4], {
        undoManager: null,
        affinityManager: noopAffinityManager,
    });

    expect(getTaskEntryIfExists(store, task.id)).toEqual({
        task: null,
        actions: [action2, action3, action4],
        optimisticState: {
            original: {
                task: null,
                actions: [],
            },
            actions: [
                {isOptimistic: true, action: action2},
                {isOptimistic: false, action: action3},
                {isOptimistic: true, action: action4},
            ],
        },
        authorizationState: null,
    });

    await rejectRpcExecution(commitTaskActionTransaction, 1);

    expect(getTaskEntryIfExists(store, task.id)).toEqual({
        task: null,
        actions: [action2, action3],
        optimisticState: {
            original: {
                task: null,
                actions: [],
            },
            actions: [
                {isOptimistic: true, action: action2},
                {isOptimistic: false, action: action3},
            ],
        },
        authorizationState: null,
    });

    await rejectRpcExecution(commitTaskActionTransaction, 0);

    expect(getTaskEntryIfExists(store, task.id)).toEqual({
        task: null,
        actions: [action3],
        optimisticState: null,
        authorizationState: null,
    });

    expect(errors.length).toEqual(2);
    errors = [];
});

test("regular actions are added to optimistic state when task is created optimistically (rejected)", async () => {
    const store = createAutoRetainStore();

    const action1 = {
        type: "UpdateTask",
        time: store.clock.now(),
        taskId: generateId(),
        taskAction: {
            type: "Create",
            creatorId: account1.id,
            creatorTimeZone: defaultTimeZone,
        },
    } satisfies TaskAction;

    const task = createTask(store, {
        id: action1.taskId,
        time: action1.time,
        taskAction: action1.taskAction,
    });

    const action2 = {
        type: "UpdateTask",
        time: store.clock.now(),
        taskId: task.id,
        taskAction: {
            type: "UpdatePriority",
            priority: "High",
        },
    } satisfies TaskAction;

    const action3 = {
        type: "UpdateTask",
        time: store.clock.now(),
        taskId: task.id,
        taskAction: {
            type: "UpdateDueDate",
            dueDate: new CalendarDate(1998, 7, 12),
        },
    } satisfies TaskAction;

    expect(getTaskEntryIfExists(store, task.id)).toEqual(null);

    store.commitTaskActionTransaction(context, [action1], {
        undoManager: null,
        affinityManager: noopAffinityManager,
    });

    expect(getTaskEntryIfExists(store, task.id)).toEqual({
        task,
        actions: null,
        optimisticState: {
            original: {
                task: null,
                actions: [],
            },
            actions: [{isOptimistic: true, action: action1}],
        },
        authorizationState: expect.objectContaining({
            value: "Authorized",
            version: zeroHybridLogicalTime,
        }),
    });

    store.commitTaskActionTransaction(context, [action2], {
        undoManager: null,
        affinityManager: noopAffinityManager,
    });

    expect(getTaskEntryIfExists(store, task.id)).toEqual({
        task: task.applyAction(action2, getSortableAccount),
        actions: null,
        optimisticState: {
            original: {
                task: null,
                actions: [],
            },
            actions: [
                {isOptimistic: true, action: action1},
                {isOptimistic: true, action: action2},
            ],
        },
        authorizationState: expect.objectContaining({
            value: "Authorized",
            version: zeroHybridLogicalTime,
        }),
    });

    store.applyUpdateEvent({
        type: "Update",
        originClientId: null,
        defaultAuthorizationStateVersion: clock.now(),
        actions: [action3],
        backfillTasks: [],
        backfillCollections: [],
        referencedAccounts: [],
    });

    expect(getTaskEntryIfExists(store, task.id)).toEqual({
        task: task
            .applyAction(action2, getSortableAccount)
            .applyAction(action3, getSortableAccount),
        actions: null,
        optimisticState: {
            original: {
                task: null,
                actions: [],
            },
            actions: [
                {isOptimistic: true, action: action1},
                {isOptimistic: true, action: action2},
                {isOptimistic: false, action: action3},
            ],
        },
        authorizationState: expect.objectContaining({
            value: "Authorized",
            version: zeroHybridLogicalTime,
        }),
    });

    await rejectRpcExecution(commitTaskActionTransaction, 0);

    expect(getTaskEntryIfExists(store, task.id)).toEqual({
        task: null,
        actions: [action2, action3],
        optimisticState: {
            original: {
                task: null,
                actions: [],
            },
            actions: [
                {isOptimistic: true, action: action2},
                {isOptimistic: false, action: action3},
            ],
        },
        authorizationState: expect.objectContaining({
            value: "Authorized",
            version: zeroHybridLogicalTime,
        }),
    });

    await rejectRpcExecution(commitTaskActionTransaction, 1);

    expect(getTaskEntryIfExists(store, task.id)).toEqual({
        task: null,
        actions: [action3],
        optimisticState: null,
        authorizationState: expect.objectContaining({
            value: "Authorized",
            version: zeroHybridLogicalTime,
        }),
    });

    expect(errors.length).toEqual(2);
    errors = [];
});

test("regular actions are added to optimistic state with multiple actions when task is created optimistically (rejected)", async () => {
    const store = createAutoRetainStore();

    const action1 = {
        type: "UpdateTask",
        time: store.clock.now(),
        taskId: generateId(),
        taskAction: {
            type: "Create",
            creatorId: account1.id,
            creatorTimeZone: defaultTimeZone,
        },
    } satisfies TaskAction;

    const task = createTask(store, {
        id: action1.taskId,
        time: action1.time,
        taskAction: action1.taskAction,
    });

    const action2 = {
        type: "UpdateTask",
        time: store.clock.now(),
        taskId: task.id,
        taskAction: {
            type: "UpdatePriority",
            priority: "High",
        },
    } satisfies TaskAction;

    const action3 = {
        type: "UpdateTask",
        time: store.clock.now(),
        taskId: task.id,
        taskAction: {
            type: "UpdateDueDate",
            dueDate: new CalendarDate(1998, 7, 12),
        },
    } satisfies TaskAction;

    const action4 = {
        type: "UpdateTask",
        time: store.clock.now(),
        taskId: task.id,
        taskAction: {
            type: "UpdatePriority",
            priority: "Low",
        },
    } satisfies TaskAction;

    expect(getTaskEntryIfExists(store, task.id)).toEqual(null);

    store.commitTaskActionTransaction(context, [action1], {
        undoManager: null,
        affinityManager: noopAffinityManager,
    });

    expect(getTaskEntryIfExists(store, task.id)).toEqual({
        task,
        actions: null,
        optimisticState: {
            original: {
                task: null,
                actions: [],
            },
            actions: [{isOptimistic: true, action: action1}],
        },
        authorizationState: expect.objectContaining({
            value: "Authorized",
            version: zeroHybridLogicalTime,
        }),
    });

    store.commitTaskActionTransaction(context, [action2], {
        undoManager: null,
        affinityManager: noopAffinityManager,
    });

    expect(getTaskEntryIfExists(store, task.id)).toEqual({
        task: task.applyAction(action2, getSortableAccount),
        actions: null,
        optimisticState: {
            original: {
                task: null,
                actions: [],
            },
            actions: [
                {isOptimistic: true, action: action1},
                {isOptimistic: true, action: action2},
            ],
        },
        authorizationState: expect.objectContaining({
            value: "Authorized",
            version: zeroHybridLogicalTime,
        }),
    });

    store.applyUpdateEvent({
        type: "Update",
        originClientId: null,
        defaultAuthorizationStateVersion: clock.now(),
        actions: [action3],
        backfillTasks: [],
        backfillCollections: [],
        referencedAccounts: [],
    });

    expect(getTaskEntryIfExists(store, task.id)).toEqual({
        task: task
            .applyAction(action2, getSortableAccount)
            .applyAction(action3, getSortableAccount),
        actions: null,
        optimisticState: {
            original: {
                task: null,
                actions: [],
            },
            actions: [
                {isOptimistic: true, action: action1},
                {isOptimistic: true, action: action2},
                {isOptimistic: false, action: action3},
            ],
        },
        authorizationState: expect.objectContaining({
            value: "Authorized",
            version: zeroHybridLogicalTime,
        }),
    });

    store.commitTaskActionTransaction(context, [action4], {
        undoManager: null,
        affinityManager: noopAffinityManager,
    });

    expect(getTaskEntryIfExists(store, task.id)).toEqual({
        task: task
            .applyAction(action2, getSortableAccount)
            .applyAction(action3, getSortableAccount)
            .applyAction(action4, getSortableAccount),
        actions: null,
        optimisticState: {
            original: {
                task: null,
                actions: [],
            },
            actions: [
                {isOptimistic: true, action: action1},
                {isOptimistic: true, action: action2},
                {isOptimistic: false, action: action3},
                {isOptimistic: true, action: action4},
            ],
        },
        authorizationState: expect.objectContaining({
            value: "Authorized",
            version: zeroHybridLogicalTime,
        }),
    });

    await rejectRpcExecution(commitTaskActionTransaction, 0);

    expect(getTaskEntryIfExists(store, task.id)).toEqual({
        task: null,
        actions: [action2, action3, action4],
        optimisticState: {
            original: {
                task: null,
                actions: [],
            },
            actions: [
                {isOptimistic: true, action: action2},
                {isOptimistic: false, action: action3},
                {isOptimistic: true, action: action4},
            ],
        },
        authorizationState: expect.objectContaining({
            value: "Authorized",
            version: zeroHybridLogicalTime,
        }),
    });

    await rejectRpcExecution(commitTaskActionTransaction, 1);

    expect(getTaskEntryIfExists(store, task.id)).toEqual({
        task: null,
        actions: [action3, action4],
        optimisticState: {
            original: {
                task: null,
                actions: [action3],
            },
            actions: [{isOptimistic: true, action: action4}],
        },
        authorizationState: expect.objectContaining({
            value: "Authorized",
            version: zeroHybridLogicalTime,
        }),
    });

    await rejectRpcExecution(commitTaskActionTransaction, 2);

    expect(getTaskEntryIfExists(store, task.id)).toEqual({
        task: null,
        actions: [action3],
        optimisticState: null,
        authorizationState: expect.objectContaining({
            value: "Authorized",
            version: zeroHybridLogicalTime,
        }),
    });

    expect(errors.length).toEqual(3);
    errors = [];
});

test("regular actions are added to optimistic state with multiple actions that are committed out of order when task is created optimistically (rejected)", async () => {
    const store = createAutoRetainStore();

    const action1 = {
        type: "UpdateTask",
        time: store.clock.now(),
        taskId: generateId(),
        taskAction: {
            type: "Create",
            creatorId: account1.id,
            creatorTimeZone: defaultTimeZone,
        },
    } satisfies TaskAction;

    const task = createTask(store, {
        id: action1.taskId,
        time: action1.time,
        taskAction: action1.taskAction,
    });

    const action2 = {
        type: "UpdateTask",
        time: store.clock.now(),
        taskId: task.id,
        taskAction: {
            type: "UpdatePriority",
            priority: "High",
        },
    } satisfies TaskAction;

    const action3 = {
        type: "UpdateTask",
        time: store.clock.now(),
        taskId: task.id,
        taskAction: {
            type: "UpdateDueDate",
            dueDate: new CalendarDate(1998, 7, 12),
        },
    } satisfies TaskAction;

    const action4 = {
        type: "UpdateTask",
        time: store.clock.now(),
        taskId: task.id,
        taskAction: {
            type: "UpdatePriority",
            priority: "Low",
        },
    } satisfies TaskAction;

    expect(getTaskEntryIfExists(store, task.id)).toEqual(null);

    store.commitTaskActionTransaction(context, [action1], {
        undoManager: null,
        affinityManager: noopAffinityManager,
    });

    expect(getTaskEntryIfExists(store, task.id)).toEqual({
        task,
        actions: null,
        optimisticState: {
            original: {
                task: null,
                actions: [],
            },
            actions: [{isOptimistic: true, action: action1}],
        },
        authorizationState: expect.objectContaining({
            value: "Authorized",
            version: zeroHybridLogicalTime,
        }),
    });

    store.commitTaskActionTransaction(context, [action2], {
        undoManager: null,
        affinityManager: noopAffinityManager,
    });

    expect(getTaskEntryIfExists(store, task.id)).toEqual({
        task: task.applyAction(action2, getSortableAccount),
        actions: null,
        optimisticState: {
            original: {
                task: null,
                actions: [],
            },
            actions: [
                {isOptimistic: true, action: action1},
                {isOptimistic: true, action: action2},
            ],
        },
        authorizationState: expect.objectContaining({
            value: "Authorized",
            version: zeroHybridLogicalTime,
        }),
    });

    store.applyUpdateEvent({
        type: "Update",
        originClientId: null,
        defaultAuthorizationStateVersion: clock.now(),
        actions: [action3],
        backfillTasks: [],
        backfillCollections: [],
        referencedAccounts: [],
    });

    expect(getTaskEntryIfExists(store, task.id)).toEqual({
        task: task
            .applyAction(action2, getSortableAccount)
            .applyAction(action3, getSortableAccount),
        actions: null,
        optimisticState: {
            original: {
                task: null,
                actions: [],
            },
            actions: [
                {isOptimistic: true, action: action1},
                {isOptimistic: true, action: action2},
                {isOptimistic: false, action: action3},
            ],
        },
        authorizationState: expect.objectContaining({
            value: "Authorized",
            version: zeroHybridLogicalTime,
        }),
    });

    store.commitTaskActionTransaction(context, [action4], {
        undoManager: null,
        affinityManager: noopAffinityManager,
    });

    expect(getTaskEntryIfExists(store, task.id)).toEqual({
        task: task
            .applyAction(action2, getSortableAccount)
            .applyAction(action3, getSortableAccount)
            .applyAction(action4, getSortableAccount),
        actions: null,
        optimisticState: {
            original: {
                task: null,
                actions: [],
            },
            actions: [
                {isOptimistic: true, action: action1},
                {isOptimistic: true, action: action2},
                {isOptimistic: false, action: action3},
                {isOptimistic: true, action: action4},
            ],
        },
        authorizationState: expect.objectContaining({
            value: "Authorized",
            version: zeroHybridLogicalTime,
        }),
    });

    await rejectRpcExecution(commitTaskActionTransaction, 0);

    expect(getTaskEntryIfExists(store, task.id)).toEqual({
        task: null,
        actions: [action2, action3, action4],
        optimisticState: {
            original: {
                task: null,
                actions: [],
            },
            actions: [
                {isOptimistic: true, action: action2},
                {isOptimistic: false, action: action3},
                {isOptimistic: true, action: action4},
            ],
        },
        authorizationState: expect.objectContaining({
            value: "Authorized",
            version: zeroHybridLogicalTime,
        }),
    });

    await rejectRpcExecution(commitTaskActionTransaction, 2);

    expect(getTaskEntryIfExists(store, task.id)).toEqual({
        task: null,
        actions: [action2, action3],
        optimisticState: {
            original: {
                task: null,
                actions: [],
            },
            actions: [
                {isOptimistic: true, action: action2},
                {isOptimistic: false, action: action3},
            ],
        },
        authorizationState: expect.objectContaining({
            value: "Authorized",
            version: zeroHybridLogicalTime,
        }),
    });

    await rejectRpcExecution(commitTaskActionTransaction, 1);

    expect(getTaskEntryIfExists(store, task.id)).toEqual({
        task: null,
        actions: [action3],
        optimisticState: null,
        authorizationState: expect.objectContaining({
            value: "Authorized",
            version: zeroHybridLogicalTime,
        }),
    });

    expect(errors.length).toEqual(3);
    errors = [];
});

test("three optimistic actions when task is not backfilled (rejected)", async () => {
    const store = createAutoRetainStore();

    const task = createTask(store);

    const action2 = {
        type: "UpdateTask",
        time: store.clock.now(),
        taskId: task.id,
        taskAction: {
            type: "UpdatePriority",
            priority: "High",
        },
    } satisfies TaskAction;

    const action3 = {
        type: "UpdateTask",
        time: store.clock.now(),
        taskId: task.id,
        taskAction: {
            type: "UpdateDueDate",
            dueDate: new CalendarDate(1998, 7, 12),
        },
    } satisfies TaskAction;

    const action4 = {
        type: "UpdateTask",
        time: store.clock.now(),
        taskId: task.id,
        taskAction: {
            type: "UpdatePriority",
            priority: "Low",
        },
    } satisfies TaskAction;

    expect(getTaskEntryIfExists(store, task.id)).toEqual(null);

    store.commitTaskActionTransaction(context, [action2], {
        undoManager: null,
        affinityManager: noopAffinityManager,
    });

    expect(getTaskEntryIfExists(store, task.id)).toEqual({
        task: null,
        actions: [action2],
        optimisticState: {
            original: {
                task: null,
                actions: [],
            },
            actions: [{isOptimistic: true, action: action2}],
        },
        authorizationState: null,
    });

    store.commitTaskActionTransaction(context, [action3], {
        undoManager: null,
        affinityManager: noopAffinityManager,
    });

    expect(getTaskEntryIfExists(store, task.id)).toEqual({
        task: null,
        actions: [action2, action3],
        optimisticState: {
            original: {
                task: null,
                actions: [],
            },
            actions: [
                {isOptimistic: true, action: action2},
                {isOptimistic: true, action: action3},
            ],
        },
        authorizationState: null,
    });

    store.commitTaskActionTransaction(context, [action4], {
        undoManager: null,
        affinityManager: noopAffinityManager,
    });

    expect(getTaskEntryIfExists(store, task.id)).toEqual({
        task: null,
        actions: [action2, action3, action4],
        optimisticState: {
            original: {
                task: null,
                actions: [],
            },
            actions: [
                {isOptimistic: true, action: action2},
                {isOptimistic: true, action: action3},
                {isOptimistic: true, action: action4},
            ],
        },
        authorizationState: null,
    });

    await rejectRpcExecution(commitTaskActionTransaction, 0);

    expect(getTaskEntryIfExists(store, task.id)).toEqual({
        task: null,
        actions: [action3, action4],
        optimisticState: {
            original: {
                task: null,
                actions: [],
            },
            actions: [
                {isOptimistic: true, action: action3},
                {isOptimistic: true, action: action4},
            ],
        },
        authorizationState: null,
    });

    await rejectRpcExecution(commitTaskActionTransaction, 1);

    expect(getTaskEntryIfExists(store, task.id)).toEqual({
        task: null,
        actions: [action4],
        optimisticState: {
            original: {
                task: null,
                actions: [],
            },
            actions: [{isOptimistic: true, action: action4}],
        },
        authorizationState: null,
    });

    await rejectRpcExecution(commitTaskActionTransaction, 2);

    expect(getTaskEntryIfExists(store, task.id)).toEqual({
        task: null,
        actions: [],
        optimisticState: null,
        authorizationState: null,
    });

    expect(errors.length).toEqual(3);
    errors = [];
});

test("backfilling a task when none exists and there are optimistic actions works (rejected)", async () => {
    const store = createAutoRetainStore();

    const task = createTask(store);

    const action2 = {
        type: "UpdateTask",
        time: store.clock.now(),
        taskId: task.id,
        taskAction: {
            type: "UpdatePriority",
            priority: "High",
        },
    } satisfies TaskAction;

    const action3 = {
        type: "UpdateTask",
        time: store.clock.now(),
        taskId: task.id,
        taskAction: {
            type: "UpdateDueDate",
            dueDate: new CalendarDate(1998, 7, 12),
        },
    } satisfies TaskAction;

    expect(getTaskEntryIfExists(store, task.id)).toEqual(null);

    store.commitTaskActionTransaction(context, [action2], {
        undoManager: null,
        affinityManager: noopAffinityManager,
    });

    expect(getTaskEntryIfExists(store, task.id)).toEqual({
        task: null,
        actions: [action2],
        optimisticState: {
            original: {
                task: null,
                actions: [],
            },
            actions: [{isOptimistic: true, action: action2}],
        },
        authorizationState: null,
    });

    store.applyUpdateEvent({
        type: "Update",
        originClientId: null,
        defaultAuthorizationStateVersion: clock.now(),
        actions: [action3],
        backfillTasks: [],
        backfillCollections: [],
        referencedAccounts: [],
    });

    expect(getTaskEntryIfExists(store, task.id)).toEqual({
        task: null,
        actions: [action2, action3],
        optimisticState: {
            original: {
                task: null,
                actions: [],
            },
            actions: [
                {isOptimistic: true, action: action2},
                {isOptimistic: false, action: action3},
            ],
        },
        authorizationState: null,
    });

    store.applyUpdateEvent({
        type: "Update",
        originClientId: null,
        defaultAuthorizationStateVersion: clock.now(),
        actions: [],
        backfillTasks: [{type: "Authorized", task: task}],
        backfillCollections: [],
        referencedAccounts: [],
    });

    expect(getTaskEntryIfExists(store, task.id)).toEqual({
        task: task
            .applyAction(action2, getSortableAccount)
            .applyAction(action3, getSortableAccount),
        actions: null,
        optimisticState: {
            original: {
                task,
                actions: null,
            },
            actions: [
                {isOptimistic: true, action: action2},
                {isOptimistic: false, action: action3},
            ],
        },
        authorizationState: expect.objectContaining({value: "Authorized"}),
    });

    await rejectLastRpcExecution(commitTaskActionTransaction);

    expect(getTaskEntryIfExists(store, task.id)).toEqual({
        task: task.applyAction(action3, getSortableAccount),
        actions: null,
        optimisticState: null,
        authorizationState: expect.objectContaining({value: "Authorized"}),
    });

    expect(errors.length).toEqual(1);
    errors = [];
});

test("backfilling a task when one is already backfilled and there are optimistic actions works (rejected)", async () => {
    const store = createAutoRetainStore();

    const task = createTask(store);

    const action2 = {
        type: "UpdateTask",
        time: store.clock.now(),
        taskId: task.id,
        taskAction: {
            type: "UpdatePriority",
            priority: "High",
        },
    } satisfies TaskAction;

    const action3 = {
        type: "UpdateTask",
        time: store.clock.now(),
        taskId: task.id,
        taskAction: {
            type: "UpdateDueDate",
            dueDate: new CalendarDate(1998, 7, 12),
        },
    } satisfies TaskAction;

    expect(getTaskEntryIfExists(store, task.id)).toEqual(null);

    store.applyUpdateEvent({
        type: "Update",
        originClientId: null,
        defaultAuthorizationStateVersion: clock.now(),
        actions: [],
        backfillTasks: [{type: "Authorized", task: task}],
        backfillCollections: [],
        referencedAccounts: [],
    });

    expect(getTaskEntryIfExists(store, task.id)).toEqual({
        task,
        actions: null,
        optimisticState: null,
        authorizationState: expect.objectContaining({value: "Authorized"}),
    });

    store.commitTaskActionTransaction(context, [action2], {
        undoManager: null,
        affinityManager: noopAffinityManager,
    });

    expect(getTaskEntryIfExists(store, task.id)).toEqual({
        task: task.applyAction(action2, getSortableAccount),
        actions: null,
        optimisticState: {
            original: {
                task,
                actions: null,
            },
            actions: [{isOptimistic: true, action: action2}],
        },
        authorizationState: expect.objectContaining({value: "Authorized"}),
    });

    store.applyUpdateEvent({
        type: "Update",
        originClientId: null,
        defaultAuthorizationStateVersion: clock.now(),
        actions: [],
        backfillTasks: [{type: "Authorized", task: task.applyAction(action3, getSortableAccount)}],
        backfillCollections: [],
        referencedAccounts: [],
    });

    expect(getTaskEntryIfExists(store, task.id)).toEqual({
        task: task
            .applyAction(action2, getSortableAccount)
            .applyAction(action3, getSortableAccount),
        actions: null,
        optimisticState: {
            original: {
                task: task.applyAction(action3, getSortableAccount),
                actions: null,
            },
            actions: [{isOptimistic: true, action: action2}],
        },
        authorizationState: expect.objectContaining({value: "Authorized"}),
    });

    await rejectLastRpcExecution(commitTaskActionTransaction);

    expect(getTaskEntryIfExists(store, task.id)).toEqual({
        task: task.applyAction(action3, getSortableAccount),
        actions: null,
        optimisticState: null,
        authorizationState: expect.objectContaining({value: "Authorized"}),
    });

    expect(errors.length).toEqual(1);
    errors = [];
});

test("backfilling a task when there are optimistic actions but no previously backfilled task works (rejected)", async () => {
    const store = createAutoRetainStore();

    const action1 = {
        type: "UpdateTask",
        time: store.clock.now(),
        taskId: generateId(),
        taskAction: {
            type: "Create",
            creatorId: account1.id,
            creatorTimeZone: defaultTimeZone,
        },
    } satisfies TaskAction;

    const task = createTask(store, {
        id: action1.taskId,
        time: action1.time,
        taskAction: action1.taskAction,
    });

    const action2 = {
        type: "UpdateTask",
        time: store.clock.now(),
        taskId: task.id,
        taskAction: {
            type: "UpdatePriority",
            priority: "High",
        },
    } satisfies TaskAction;

    const action3 = {
        type: "UpdateTask",
        time: store.clock.now(),
        taskId: task.id,
        taskAction: {
            type: "UpdateDueDate",
            dueDate: new CalendarDate(1998, 7, 12),
        },
    } satisfies TaskAction;

    const action4 = {
        type: "UpdateTask",
        time: store.clock.now(),
        taskId: task.id,
        taskAction: {
            type: "UpdatePriority",
            priority: "Low",
        },
    } satisfies TaskAction;

    expect(getTaskEntryIfExists(store, task.id)).toEqual(null);

    store.applyUpdateEvent({
        type: "Update",
        originClientId: null,
        defaultAuthorizationStateVersion: clock.now(),
        actions: [action3],
        backfillTasks: [],
        backfillCollections: [],
        referencedAccounts: [],
    });

    expect(getTaskEntryIfExists(store, task.id)).toEqual({
        task: null,
        actions: [action3],
        optimisticState: null,
        authorizationState: null,
    });

    store.commitTaskActionTransaction(context, [action1], {
        undoManager: null,
        affinityManager: noopAffinityManager,
    });

    expect(getTaskEntryIfExists(store, task.id)).toEqual({
        task: task.applyAction(action3, getSortableAccount),
        actions: null,
        optimisticState: {
            original: {
                task: null,
                actions: [action3],
            },
            actions: [{isOptimistic: true, action: action1}],
        },
        authorizationState: expect.objectContaining({
            value: "Authorized",
            version: zeroHybridLogicalTime,
        }),
    });

    store.commitTaskActionTransaction(context, [action2], {
        undoManager: null,
        affinityManager: noopAffinityManager,
    });

    expect(getTaskEntryIfExists(store, task.id)).toEqual({
        task: task
            .applyAction(action3, getSortableAccount)
            .applyAction(action2, getSortableAccount),
        actions: null,
        optimisticState: {
            original: {
                task: null,
                actions: [action3],
            },
            actions: [
                {isOptimistic: true, action: action1},
                {isOptimistic: true, action: action2},
            ],
        },
        authorizationState: expect.objectContaining({
            value: "Authorized",
            version: zeroHybridLogicalTime,
        }),
    });

    store.applyUpdateEvent({
        type: "Update",
        originClientId: null,
        defaultAuthorizationStateVersion: clock.now(),
        actions: [],
        backfillTasks: [{type: "Authorized", task: task.applyAction(action4, getSortableAccount)}],
        backfillCollections: [],
        referencedAccounts: [],
    });

    expect(getTaskEntryIfExists(store, task.id)).toEqual({
        task: task
            .applyAction(action4, getSortableAccount)
            .applyAction(action3, getSortableAccount)
            .applyAction(action2, getSortableAccount),
        actions: null,
        optimisticState: {
            original: {
                task: task
                    .applyAction(action4, getSortableAccount)
                    .applyAction(action3, getSortableAccount),
                actions: null,
            },
            actions: [
                {isOptimistic: true, action: action1},
                {isOptimistic: true, action: action2},
            ],
        },
        authorizationState: expect.objectContaining({value: "Authorized"}),
    });

    await rejectRpcExecution(commitTaskActionTransaction, 0);

    expect(getTaskEntryIfExists(store, task.id)).toEqual({
        task: task
            .applyAction(action4, getSortableAccount)
            .applyAction(action3, getSortableAccount)
            .applyAction(action2, getSortableAccount),
        actions: null,
        optimisticState: {
            original: {
                task: task
                    .applyAction(action4, getSortableAccount)
                    .applyAction(action3, getSortableAccount),
                actions: null,
            },
            actions: [{isOptimistic: true, action: action2}],
        },
        authorizationState: expect.objectContaining({value: "Authorized"}),
    });

    await rejectRpcExecution(commitTaskActionTransaction, 1);

    expect(getTaskEntryIfExists(store, task.id)).toEqual({
        task: task
            .applyAction(action4, getSortableAccount)
            .applyAction(action3, getSortableAccount),
        actions: null,
        optimisticState: null,
        authorizationState: expect.objectContaining({value: "Authorized"}),
    });

    expect(errors.length).toEqual(2);
    errors = [];
});

test("create task applied after optimistic updates", async () => {
    const store = createAutoRetainStore();

    const action1 = {
        type: "UpdateTask",
        time: store.clock.now(),
        taskId: generateId(),
        taskAction: {
            type: "Create",
            creatorId: account1.id,
            creatorTimeZone: defaultTimeZone,
        },
    } satisfies TaskAction;

    const task = createTask(store, {
        id: action1.taskId,
        time: action1.time,
        taskAction: action1.taskAction,
    });

    const action2 = {
        type: "UpdateTask",
        time: store.clock.now(),
        taskId: task.id,
        taskAction: {
            type: "UpdatePriority",
            priority: "High",
        },
    } satisfies TaskAction;

    const action3 = {
        type: "UpdateTask",
        time: store.clock.now(),
        taskId: task.id,
        taskAction: {
            type: "UpdateDueDate",
            dueDate: new CalendarDate(1998, 7, 12),
        },
    } satisfies TaskAction;

    expect(getTaskEntryIfExists(store, task.id)).toEqual(null);

    store.commitTaskActionTransaction(context, [action2], {
        undoManager: null,
        affinityManager: noopAffinityManager,
    });

    expect(getTaskEntryIfExists(store, task.id)).toEqual({
        task: null,
        actions: [action2],
        optimisticState: {
            original: {
                task: null,
                actions: [],
            },
            actions: [{isOptimistic: true, action: action2}],
        },
        authorizationState: null,
    });

    store.applyUpdateEvent({
        type: "Update",
        originClientId: null,
        defaultAuthorizationStateVersion: clock.now(),
        actions: [action1],
        backfillTasks: [],
        backfillCollections: [],
        referencedAccounts: [account1],
    });

    expect(getTaskEntryIfExists(store, task.id)).toEqual({
        task: task.applyAction(action2, getSortableAccount),
        actions: null,
        optimisticState: {
            original: {
                task: null,
                actions: [],
            },
            actions: [
                {isOptimistic: true, action: action2},
                {isOptimistic: false, action: action1},
            ],
        },
        authorizationState: expect.objectContaining({value: "Authorized"}),
    });

    store.commitTaskActionTransaction(context, [action3], {
        undoManager: null,
        affinityManager: noopAffinityManager,
    });

    expect(getTaskEntryIfExists(store, task.id)).toEqual({
        task: task
            .applyAction(action2, getSortableAccount)
            .applyAction(action3, getSortableAccount),
        actions: null,
        optimisticState: {
            original: {
                task: null,
                actions: [],
            },
            actions: [
                {isOptimistic: true, action: action2},
                {isOptimistic: false, action: action1},
                {isOptimistic: true, action: action3},
            ],
        },
        authorizationState: expect.objectContaining({value: "Authorized"}),
    });

    await resolveRpcExecution(commitTaskActionTransaction, 0, {
        extraActions: [],
        referencedAccounts: [],
    });

    expect(getTaskEntryIfExists(store, task.id)).toEqual({
        task: task
            .applyAction(action2, getSortableAccount)
            .applyAction(action3, getSortableAccount),
        actions: null,
        optimisticState: {
            original: {
                task: task.applyAction(action2, getSortableAccount),
                actions: null,
            },
            actions: [{isOptimistic: true, action: action3}],
        },
        authorizationState: expect.objectContaining({value: "Authorized"}),
    });

    await resolveRpcExecution(commitTaskActionTransaction, 1, {
        extraActions: [],
        referencedAccounts: [],
    });

    expect(getTaskEntryIfExists(store, task.id)).toEqual({
        task: task
            .applyAction(action2, getSortableAccount)
            .applyAction(action3, getSortableAccount),
        actions: null,
        optimisticState: null,
        authorizationState: expect.objectContaining({value: "Authorized"}),
    });
});

test("create task applied after optimistic updates that are resolved out of order", async () => {
    const store = createAutoRetainStore();

    const action1 = {
        type: "UpdateTask",
        time: store.clock.now(),
        taskId: generateId(),
        taskAction: {
            type: "Create",
            creatorId: account1.id,
            creatorTimeZone: defaultTimeZone,
        },
    } satisfies TaskAction;

    const task = createTask(store, {
        id: action1.taskId,
        time: action1.time,
        taskAction: action1.taskAction,
    });

    const action2 = {
        type: "UpdateTask",
        time: store.clock.now(),
        taskId: task.id,
        taskAction: {
            type: "UpdatePriority",
            priority: "High",
        },
    } satisfies TaskAction;

    const action3 = {
        type: "UpdateTask",
        time: store.clock.now(),
        taskId: task.id,
        taskAction: {
            type: "UpdateDueDate",
            dueDate: new CalendarDate(1998, 7, 12),
        },
    } satisfies TaskAction;

    expect(getTaskEntryIfExists(store, task.id)).toEqual(null);

    store.commitTaskActionTransaction(context, [action2], {
        undoManager: null,
        affinityManager: noopAffinityManager,
    });

    expect(getTaskEntryIfExists(store, task.id)).toEqual({
        task: null,
        actions: [action2],
        optimisticState: {
            original: {
                task: null,
                actions: [],
            },
            actions: [{isOptimistic: true, action: action2}],
        },
        authorizationState: null,
    });

    store.applyUpdateEvent({
        type: "Update",
        originClientId: null,
        defaultAuthorizationStateVersion: clock.now(),
        actions: [action1],
        backfillTasks: [],
        backfillCollections: [],
        referencedAccounts: [account1],
    });

    expect(getTaskEntryIfExists(store, task.id)).toEqual({
        task: task.applyAction(action2, getSortableAccount),
        actions: null,
        optimisticState: {
            original: {
                task: null,
                actions: [],
            },
            actions: [
                {isOptimistic: true, action: action2},
                {isOptimistic: false, action: action1},
            ],
        },
        authorizationState: expect.objectContaining({value: "Authorized"}),
    });

    store.commitTaskActionTransaction(context, [action3], {
        undoManager: null,
        affinityManager: noopAffinityManager,
    });

    expect(getTaskEntryIfExists(store, task.id)).toEqual({
        task: task
            .applyAction(action2, getSortableAccount)
            .applyAction(action3, getSortableAccount),
        actions: null,
        optimisticState: {
            original: {
                task: null,
                actions: [],
            },
            actions: [
                {isOptimistic: true, action: action2},
                {isOptimistic: false, action: action1},
                {isOptimistic: true, action: action3},
            ],
        },
        authorizationState: expect.objectContaining({value: "Authorized"}),
    });

    await resolveRpcExecution(commitTaskActionTransaction, 1, {
        extraActions: [],
        referencedAccounts: [],
    });

    expect(getTaskEntryIfExists(store, task.id)).toEqual({
        task: task
            .applyAction(action2, getSortableAccount)
            .applyAction(action3, getSortableAccount),
        actions: null,
        optimisticState: {
            original: {
                task: null,
                actions: [action3],
            },
            actions: [
                {isOptimistic: true, action: action2},
                {isOptimistic: false, action: action1},
            ],
        },
        authorizationState: expect.objectContaining({value: "Authorized"}),
    });

    await resolveRpcExecution(commitTaskActionTransaction, 0, {
        extraActions: [],
        referencedAccounts: [],
    });

    expect(getTaskEntryIfExists(store, task.id)).toEqual({
        task: task
            .applyAction(action2, getSortableAccount)
            .applyAction(action3, getSortableAccount),
        actions: null,
        optimisticState: null,
        authorizationState: expect.objectContaining({value: "Authorized"}),
    });
});

test("create task applied after optimistic updates (rejected)", async () => {
    const store = createAutoRetainStore();

    const action1 = {
        type: "UpdateTask",
        time: store.clock.now(),
        taskId: generateId(),
        taskAction: {
            type: "Create",
            creatorId: account1.id,
            creatorTimeZone: defaultTimeZone,
        },
    } satisfies TaskAction;

    const task = createTask(store, {
        id: action1.taskId,
        time: action1.time,
        taskAction: action1.taskAction,
    });

    const action2 = {
        type: "UpdateTask",
        time: store.clock.now(),
        taskId: task.id,
        taskAction: {
            type: "UpdatePriority",
            priority: "High",
        },
    } satisfies TaskAction;

    const action3 = {
        type: "UpdateTask",
        time: store.clock.now(),
        taskId: task.id,
        taskAction: {
            type: "UpdateDueDate",
            dueDate: new CalendarDate(1998, 7, 12),
        },
    } satisfies TaskAction;

    expect(getTaskEntryIfExists(store, task.id)).toEqual(null);

    store.commitTaskActionTransaction(context, [action2], {
        undoManager: null,
        affinityManager: noopAffinityManager,
    });

    expect(getTaskEntryIfExists(store, task.id)).toEqual({
        task: null,
        actions: [action2],
        optimisticState: {
            original: {
                task: null,
                actions: [],
            },
            actions: [{isOptimistic: true, action: action2}],
        },
        authorizationState: null,
    });

    store.applyUpdateEvent({
        type: "Update",
        originClientId: null,
        defaultAuthorizationStateVersion: clock.now(),
        actions: [action1],
        backfillTasks: [],
        backfillCollections: [],
        referencedAccounts: [account1],
    });

    expect(getTaskEntryIfExists(store, task.id)).toEqual({
        task: task.applyAction(action2, getSortableAccount),
        actions: null,
        optimisticState: {
            original: {
                task: null,
                actions: [],
            },
            actions: [
                {isOptimistic: true, action: action2},
                {isOptimistic: false, action: action1},
            ],
        },
        authorizationState: expect.objectContaining({value: "Authorized"}),
    });

    store.commitTaskActionTransaction(context, [action3], {
        undoManager: null,
        affinityManager: noopAffinityManager,
    });

    expect(getTaskEntryIfExists(store, task.id)).toEqual({
        task: task
            .applyAction(action2, getSortableAccount)
            .applyAction(action3, getSortableAccount),
        actions: null,
        optimisticState: {
            original: {
                task: null,
                actions: [],
            },
            actions: [
                {isOptimistic: true, action: action2},
                {isOptimistic: false, action: action1},
                {isOptimistic: true, action: action3},
            ],
        },
        authorizationState: expect.objectContaining({value: "Authorized"}),
    });

    await rejectRpcExecution(commitTaskActionTransaction, 0);

    expect(getTaskEntryIfExists(store, task.id)).toEqual({
        task: task.applyAction(action3, getSortableAccount),
        actions: null,
        optimisticState: {
            original: {
                task: task,
                actions: null,
            },
            actions: [{isOptimistic: true, action: action3}],
        },
        authorizationState: expect.objectContaining({value: "Authorized"}),
    });

    await rejectRpcExecution(commitTaskActionTransaction, 1);

    expect(getTaskEntryIfExists(store, task.id)).toEqual({
        task: task,
        actions: null,
        optimisticState: null,
        authorizationState: expect.objectContaining({value: "Authorized"}),
    });

    expect(errors.length).toEqual(2);
    errors = [];
});

test("create task applied after optimistic updates that are resolved out of order (rejected)", async () => {
    const store = createAutoRetainStore();

    const action1 = {
        type: "UpdateTask",
        time: store.clock.now(),
        taskId: generateId(),
        taskAction: {
            type: "Create",
            creatorId: account1.id,
            creatorTimeZone: defaultTimeZone,
        },
    } satisfies TaskAction;

    const task = createTask(store, {
        id: action1.taskId,
        time: action1.time,
        taskAction: action1.taskAction,
    });

    const action2 = {
        type: "UpdateTask",
        time: store.clock.now(),
        taskId: task.id,
        taskAction: {
            type: "UpdatePriority",
            priority: "High",
        },
    } satisfies TaskAction;

    const action3 = {
        type: "UpdateTask",
        time: store.clock.now(),
        taskId: task.id,
        taskAction: {
            type: "UpdateDueDate",
            dueDate: new CalendarDate(1998, 7, 12),
        },
    } satisfies TaskAction;

    expect(getTaskEntryIfExists(store, task.id)).toEqual(null);

    store.commitTaskActionTransaction(context, [action2], {
        undoManager: null,
        affinityManager: noopAffinityManager,
    });

    expect(getTaskEntryIfExists(store, task.id)).toEqual({
        task: null,
        actions: [action2],
        optimisticState: {
            original: {
                task: null,
                actions: [],
            },
            actions: [{isOptimistic: true, action: action2}],
        },
        authorizationState: null,
    });

    store.applyUpdateEvent({
        type: "Update",
        originClientId: null,
        defaultAuthorizationStateVersion: clock.now(),
        actions: [action1],
        backfillTasks: [],
        backfillCollections: [],
        referencedAccounts: [account1],
    });

    expect(getTaskEntryIfExists(store, task.id)).toEqual({
        task: task.applyAction(action2, getSortableAccount),
        actions: null,
        optimisticState: {
            original: {
                task: null,
                actions: [],
            },
            actions: [
                {isOptimistic: true, action: action2},
                {isOptimistic: false, action: action1},
            ],
        },
        authorizationState: expect.objectContaining({value: "Authorized"}),
    });

    store.commitTaskActionTransaction(context, [action3], {
        undoManager: null,
        affinityManager: noopAffinityManager,
    });

    expect(getTaskEntryIfExists(store, task.id)).toEqual({
        task: task
            .applyAction(action2, getSortableAccount)
            .applyAction(action3, getSortableAccount),
        actions: null,
        optimisticState: {
            original: {
                task: null,
                actions: [],
            },
            actions: [
                {isOptimistic: true, action: action2},
                {isOptimistic: false, action: action1},
                {isOptimistic: true, action: action3},
            ],
        },
        authorizationState: expect.objectContaining({value: "Authorized"}),
    });

    await rejectRpcExecution(commitTaskActionTransaction, 1);

    expect(getTaskEntryIfExists(store, task.id)).toEqual({
        task: task.applyAction(action2, getSortableAccount),
        actions: null,
        optimisticState: {
            original: {
                task: null,
                actions: [],
            },
            actions: [
                {isOptimistic: true, action: action2},
                {isOptimistic: false, action: action1},
            ],
        },
        authorizationState: expect.objectContaining({value: "Authorized"}),
    });

    await rejectRpcExecution(commitTaskActionTransaction, 0);

    expect(getTaskEntryIfExists(store, task.id)).toEqual({
        task: task,
        actions: null,
        optimisticState: null,
        authorizationState: expect.objectContaining({value: "Authorized"}),
    });

    expect(errors.length).toEqual(2);
    errors = [];
});

test("can create then update collections optimistically", async () => {
    const store = createAutoRetainStore();

    const action1 = {
        type: "UpdateCollection",
        time: store.clock.now(),
        collectionId: generateId(),
        collectionAction: {
            type: "Create",
            creatorId: null,
            name: "Test",
            accessPolicy: {
                accountGrantById: new Map([[account1.id, {level: "Manage", generation: 0}]]),
                defaultGrant: null,
                urlGrant: null,
            },
        },
    } satisfies TaskAction;

    const action2 = {
        type: "UpdateCollection",
        time: store.clock.now(),
        collectionId: action1.collectionId,
        collectionAction: {
            type: "UpdateName",
            name: "Test 2",
        },
    } satisfies TaskAction;

    expect(getCollectionEntryIfExists(store, action1.collectionId)).toEqual(null);

    store.commitTaskActionTransaction(context, [action1], {
        undoManager: null,
        affinityManager: noopAffinityManager,
    });

    expect(getCollectionEntryIfExists(store, action1.collectionId)).toEqual({
        collection: createCollection(store, {
            id: action1.collectionId,
            time: action1.time,
            collectionAction: action1.collectionAction,
        }),
        actions: null,
        optimisticState: {
            original: {
                collection: null,
                actions: [],
            },
            actions: [{isOptimistic: true, action: action1}],
        },
        authorizationState: expect.objectContaining({
            value: "Authorized",
            version: zeroHybridLogicalTime,
        }),
    });

    store.commitTaskActionTransaction(context, [action2], {
        undoManager: null,
        affinityManager: noopAffinityManager,
    });

    expect(getCollectionEntryIfExists(store, action1.collectionId)).toEqual({
        collection: createCollection(store, {
            id: action1.collectionId,
            time: action1.time,
            collectionAction: action1.collectionAction,
        }).applyAction(action2),
        actions: null,
        optimisticState: {
            original: {
                collection: null,
                actions: [],
            },
            actions: [
                {isOptimistic: true, action: action1},
                {isOptimistic: true, action: action2},
            ],
        },
        authorizationState: expect.objectContaining({
            value: "Authorized",
            version: zeroHybridLogicalTime,
        }),
    });

    await resolveRpcExecution(commitTaskActionTransaction, 0, {
        extraActions: [],
        referencedAccounts: [],
    });

    expect(getCollectionEntryIfExists(store, action1.collectionId)).toEqual({
        collection: createCollection(store, {
            id: action1.collectionId,
            time: action1.time,
            collectionAction: action1.collectionAction,
        }).applyAction(action2),
        actions: null,
        optimisticState: {
            original: {
                collection: createCollection(store, {
                    id: action1.collectionId,
                    time: action1.time,
                    collectionAction: action1.collectionAction,
                }),
                actions: null,
            },
            actions: [{isOptimistic: true, action: action2}],
        },
        authorizationState: expect.objectContaining({
            value: "Authorized",
            version: zeroHybridLogicalTime,
        }),
    });

    await resolveRpcExecution(commitTaskActionTransaction, 1, {
        extraActions: [],
        referencedAccounts: [],
    });

    expect(getCollectionEntryIfExists(store, action1.collectionId)).toEqual({
        collection: createCollection(store, {
            id: action1.collectionId,
            time: action1.time,
            collectionAction: action1.collectionAction,
        }).applyAction(action2),
        actions: null,
        optimisticState: null,
        authorizationState: expect.objectContaining({
            value: "Authorized",
            version: zeroHybridLogicalTime,
        }),
    });
});

test("can create then update collections optimistically and resolve commits out of order", async () => {
    const store = createAutoRetainStore();

    const action1 = {
        type: "UpdateCollection",
        time: store.clock.now(),
        collectionId: generateId(),
        collectionAction: {
            type: "Create",
            creatorId: null,
            name: "Test",
            accessPolicy: {
                accountGrantById: new Map([[account1.id, {level: "Manage", generation: 0}]]),
                defaultGrant: null,
                urlGrant: null,
            },
        },
    } satisfies TaskAction;

    const action2 = {
        type: "UpdateCollection",
        time: store.clock.now(),
        collectionId: action1.collectionId,
        collectionAction: {
            type: "UpdateName",
            name: "Test 2",
        },
    } satisfies TaskAction;

    expect(getCollectionEntryIfExists(store, action1.collectionId)).toEqual(null);

    store.commitTaskActionTransaction(context, [action1], {
        undoManager: null,
        affinityManager: noopAffinityManager,
    });

    expect(getCollectionEntryIfExists(store, action1.collectionId)).toEqual({
        collection: createCollection(store, {
            id: action1.collectionId,
            time: action1.time,
            collectionAction: action1.collectionAction,
        }),
        actions: null,
        optimisticState: {
            original: {
                collection: null,
                actions: [],
            },
            actions: [{isOptimistic: true, action: action1}],
        },
        authorizationState: expect.objectContaining({
            value: "Authorized",
            version: zeroHybridLogicalTime,
        }),
    });

    store.commitTaskActionTransaction(context, [action2], {
        undoManager: null,
        affinityManager: noopAffinityManager,
    });

    expect(getCollectionEntryIfExists(store, action1.collectionId)).toEqual({
        collection: createCollection(store, {
            id: action1.collectionId,
            time: action1.time,
            collectionAction: action1.collectionAction,
        }).applyAction(action2),
        actions: null,
        optimisticState: {
            original: {
                collection: null,
                actions: [],
            },
            actions: [
                {isOptimistic: true, action: action1},
                {isOptimistic: true, action: action2},
            ],
        },
        authorizationState: expect.objectContaining({
            value: "Authorized",
            version: zeroHybridLogicalTime,
        }),
    });

    await resolveRpcExecution(commitTaskActionTransaction, 1, {
        extraActions: [],
        referencedAccounts: [],
    });

    expect(getCollectionEntryIfExists(store, action1.collectionId)).toEqual({
        collection: createCollection(store, {
            id: action1.collectionId,
            time: action1.time,
            collectionAction: action1.collectionAction,
        }).applyAction(action2),
        actions: null,
        optimisticState: {
            original: {
                collection: null,
                actions: [action2],
            },
            actions: [{isOptimistic: true, action: action1}],
        },
        authorizationState: expect.objectContaining({
            value: "Authorized",
            version: zeroHybridLogicalTime,
        }),
    });

    await resolveRpcExecution(commitTaskActionTransaction, 0, {
        extraActions: [],
        referencedAccounts: [],
    });

    expect(getCollectionEntryIfExists(store, action1.collectionId)).toEqual({
        collection: createCollection(store, {
            id: action1.collectionId,
            time: action1.time,
            collectionAction: action1.collectionAction,
        }).applyAction(action2),
        actions: null,
        optimisticState: null,
        authorizationState: expect.objectContaining({
            value: "Authorized",
            version: zeroHybridLogicalTime,
        }),
    });
});

test("can create then update collections optimistically after an action from the server", async () => {
    const store = createAutoRetainStore();

    const action2Time = store.clock.now();

    const action1 = {
        type: "UpdateCollection",
        time: store.clock.now(),
        collectionId: generateId(),
        collectionAction: {
            type: "UpdateColor",
            color: "red",
        },
    } satisfies TaskAction;

    const action2 = {
        type: "UpdateCollection",
        time: action2Time,
        collectionId: action1.collectionId,
        collectionAction: {
            type: "Create",
            creatorId: null,
            name: "Test",
            accessPolicy: {
                accountGrantById: new Map([[account1.id, {level: "Manage", generation: 0}]]),
                defaultGrant: null,
                urlGrant: null,
            },
        },
    } satisfies TaskAction;

    const action3 = {
        type: "UpdateCollection",
        time: store.clock.now(),
        collectionId: action2.collectionId,
        collectionAction: {
            type: "UpdateName",
            name: "Test 2",
        },
    } satisfies TaskAction;

    expect(getCollectionEntryIfExists(store, action2.collectionId)).toEqual(null);

    store.applyUpdateEvent({
        type: "Update",
        originClientId: null,
        defaultAuthorizationStateVersion: clock.now(),
        actions: [action1],
        backfillTasks: [],
        backfillCollections: [],
        referencedAccounts: [],
    });

    expect(getCollectionEntryIfExists(store, action2.collectionId)).toEqual({
        collection: null,
        actions: [action1],
        optimisticState: null,
        authorizationState: null,
    });

    store.commitTaskActionTransaction(context, [action2], {
        undoManager: null,
        affinityManager: noopAffinityManager,
    });

    expect(getCollectionEntryIfExists(store, action2.collectionId)).toEqual({
        collection: createCollection(store, {
            id: action2.collectionId,
            time: action2.time,
            collectionAction: action2.collectionAction,
        }).applyAction(action1),
        actions: null,
        optimisticState: {
            original: {
                collection: null,
                actions: [action1],
            },
            actions: [{isOptimistic: true, action: action2}],
        },
        authorizationState: expect.objectContaining({
            value: "Authorized",
            version: zeroHybridLogicalTime,
        }),
    });

    store.commitTaskActionTransaction(context, [action3], {
        undoManager: null,
        affinityManager: noopAffinityManager,
    });

    expect(getCollectionEntryIfExists(store, action2.collectionId)).toEqual({
        collection: createCollection(store, {
            id: action2.collectionId,
            time: action2.time,
            collectionAction: action2.collectionAction,
        })
            .applyAction(action1)
            .applyAction(action3),
        actions: null,
        optimisticState: {
            original: {
                collection: null,
                actions: [action1],
            },
            actions: [
                {isOptimistic: true, action: action2},
                {isOptimistic: true, action: action3},
            ],
        },
        authorizationState: expect.objectContaining({
            value: "Authorized",
            version: zeroHybridLogicalTime,
        }),
    });

    await resolveRpcExecution(commitTaskActionTransaction, 0, {
        extraActions: [],
        referencedAccounts: [],
    });

    expect(getCollectionEntryIfExists(store, action2.collectionId)).toEqual({
        collection: createCollection(store, {
            id: action2.collectionId,
            time: action2.time,
            collectionAction: action2.collectionAction,
        })
            .applyAction(action1)
            .applyAction(action3),
        actions: null,
        optimisticState: {
            original: {
                collection: createCollection(store, {
                    id: action2.collectionId,
                    time: action2.time,
                    collectionAction: action2.collectionAction,
                }).applyAction(action1),
                actions: null,
            },
            actions: [{isOptimistic: true, action: action3}],
        },
        authorizationState: expect.objectContaining({
            value: "Authorized",
            version: zeroHybridLogicalTime,
        }),
    });

    await resolveRpcExecution(commitTaskActionTransaction, 1, {
        extraActions: [],
        referencedAccounts: [],
    });

    expect(getCollectionEntryIfExists(store, action2.collectionId)).toEqual({
        collection: createCollection(store, {
            id: action2.collectionId,
            time: action2.time,
            collectionAction: action2.collectionAction,
        })
            .applyAction(action1)
            .applyAction(action3),
        actions: null,
        optimisticState: null,
        authorizationState: expect.objectContaining({
            value: "Authorized",
            version: zeroHybridLogicalTime,
        }),
    });
});

test("can create then update collections optimistically our of order", async () => {
    const store = createAutoRetainStore();

    const action1 = {
        type: "UpdateCollection",
        time: store.clock.now(),
        collectionId: generateId(),
        collectionAction: {
            type: "Create",
            creatorId: null,
            name: "Test",
            accessPolicy: {
                accountGrantById: new Map([[account1.id, {level: "Manage", generation: 0}]]),
                defaultGrant: null,
                urlGrant: null,
            },
        },
    } satisfies TaskAction;

    const action2 = {
        type: "UpdateCollection",
        time: store.clock.now(),
        collectionId: action1.collectionId,
        collectionAction: {
            type: "UpdateName",
            name: "Test 2",
        },
    } satisfies TaskAction;

    expect(getCollectionEntryIfExists(store, action1.collectionId)).toEqual(null);

    store.commitTaskActionTransaction(context, [action2], {
        undoManager: null,
        affinityManager: noopAffinityManager,
    });

    expect(getCollectionEntryIfExists(store, action1.collectionId)).toEqual({
        collection: null,
        actions: [action2],
        optimisticState: {
            original: {
                collection: null,
                actions: [],
            },
            actions: [{isOptimistic: true, action: action2}],
        },
        authorizationState: null,
    });

    store.commitTaskActionTransaction(context, [action1], {
        undoManager: null,
        affinityManager: noopAffinityManager,
    });

    expect(getCollectionEntryIfExists(store, action1.collectionId)).toEqual({
        collection: createCollection(store, {
            id: action1.collectionId,
            time: action1.time,
            collectionAction: action1.collectionAction,
        }).applyAction(action2),
        actions: null,
        optimisticState: {
            original: {
                collection: null,
                actions: [],
            },
            actions: [
                {isOptimistic: true, action: action2},
                {isOptimistic: true, action: action1},
            ],
        },
        authorizationState: expect.objectContaining({
            value: "Authorized",
            version: zeroHybridLogicalTime,
        }),
    });

    await resolveRpcExecution(commitTaskActionTransaction, 0, {
        extraActions: [],
        referencedAccounts: [],
    });

    expect(getCollectionEntryIfExists(store, action1.collectionId)).toEqual({
        collection: createCollection(store, {
            id: action1.collectionId,
            time: action1.time,
            collectionAction: action1.collectionAction,
        }).applyAction(action2),
        actions: null,
        optimisticState: {
            original: {
                collection: null,
                actions: [action2],
            },
            actions: [{isOptimistic: true, action: action1}],
        },
        authorizationState: expect.objectContaining({
            value: "Authorized",
            version: zeroHybridLogicalTime,
        }),
    });

    await resolveRpcExecution(commitTaskActionTransaction, 1, {
        extraActions: [],
        referencedAccounts: [],
    });

    expect(getCollectionEntryIfExists(store, action1.collectionId)).toEqual({
        collection: createCollection(store, {
            id: action1.collectionId,
            time: action1.time,
            collectionAction: action1.collectionAction,
        }).applyAction(action2),
        actions: null,
        optimisticState: null,
        authorizationState: expect.objectContaining({
            value: "Authorized",
            version: zeroHybridLogicalTime,
        }),
    });
});

test("can create then update collections optimistically out of order after an action from the server", async () => {
    const store = createAutoRetainStore();

    const action2Time = store.clock.now();

    const action1 = {
        type: "UpdateCollection",
        time: store.clock.now(),
        collectionId: generateId(),
        collectionAction: {
            type: "UpdateColor",
            color: "red",
        },
    } satisfies TaskAction;

    const action2 = {
        type: "UpdateCollection",
        time: action2Time,
        collectionId: action1.collectionId,
        collectionAction: {
            type: "Create",
            creatorId: null,
            name: "Test",
            accessPolicy: {
                accountGrantById: new Map([[account1.id, {level: "Manage", generation: 0}]]),
                defaultGrant: null,
                urlGrant: null,
            },
        },
    } satisfies TaskAction;

    const action3 = {
        type: "UpdateCollection",
        time: store.clock.now(),
        collectionId: action2.collectionId,
        collectionAction: {
            type: "UpdateName",
            name: "Test 2",
        },
    } satisfies TaskAction;

    expect(getCollectionEntryIfExists(store, action2.collectionId)).toEqual(null);

    store.applyUpdateEvent({
        type: "Update",
        originClientId: null,
        defaultAuthorizationStateVersion: clock.now(),
        actions: [action1],
        backfillTasks: [],
        backfillCollections: [],
        referencedAccounts: [],
    });

    expect(getCollectionEntryIfExists(store, action2.collectionId)).toEqual({
        collection: null,
        actions: [action1],
        optimisticState: null,
        authorizationState: null,
    });

    store.commitTaskActionTransaction(context, [action3], {
        undoManager: null,
        affinityManager: noopAffinityManager,
    });

    expect(getCollectionEntryIfExists(store, action2.collectionId)).toEqual({
        collection: null,
        actions: [action1, action3],
        optimisticState: {
            original: {
                collection: null,
                actions: [action1],
            },
            actions: [{isOptimistic: true, action: action3}],
        },
        authorizationState: null,
    });

    store.commitTaskActionTransaction(context, [action2], {
        undoManager: null,
        affinityManager: noopAffinityManager,
    });

    expect(getCollectionEntryIfExists(store, action2.collectionId)).toEqual({
        collection: createCollection(store, {
            id: action2.collectionId,
            time: action2.time,
            collectionAction: action2.collectionAction,
        })
            .applyAction(action1)
            .applyAction(action3),
        actions: null,
        optimisticState: {
            original: {
                collection: null,
                actions: [action1],
            },
            actions: [
                {isOptimistic: true, action: action3},
                {isOptimistic: true, action: action2},
            ],
        },
        authorizationState: expect.objectContaining({
            value: "Authorized",
            version: zeroHybridLogicalTime,
        }),
    });

    await resolveRpcExecution(commitTaskActionTransaction, 0, {
        extraActions: [],
        referencedAccounts: [],
    });

    expect(getCollectionEntryIfExists(store, action2.collectionId)).toEqual({
        collection: createCollection(store, {
            id: action2.collectionId,
            time: action2.time,
            collectionAction: action2.collectionAction,
        })
            .applyAction(action1)
            .applyAction(action3),
        actions: null,
        optimisticState: {
            original: {
                collection: null,
                actions: [action1, action3],
            },
            actions: [{isOptimistic: true, action: action2}],
        },
        authorizationState: expect.objectContaining({
            value: "Authorized",
            version: zeroHybridLogicalTime,
        }),
    });

    await resolveRpcExecution(commitTaskActionTransaction, 1, {
        extraActions: [],
        referencedAccounts: [],
    });

    expect(getCollectionEntryIfExists(store, action2.collectionId)).toEqual({
        collection: createCollection(store, {
            id: action2.collectionId,
            time: action2.time,
            collectionAction: action2.collectionAction,
        })
            .applyAction(action1)
            .applyAction(action3),
        actions: null,
        optimisticState: null,
        authorizationState: expect.objectContaining({
            value: "Authorized",
            version: zeroHybridLogicalTime,
        }),
    });
});

test("can create then update collections optimistically out of order with more non-create collections", async () => {
    const store = createAutoRetainStore();

    const action2Time = store.clock.now();

    const action1 = {
        type: "UpdateCollection",
        time: store.clock.now(),
        collectionId: generateId(),
        collectionAction: {
            type: "UpdateColor",
            color: "red",
        },
    } satisfies TaskAction;

    const action2 = {
        type: "UpdateCollection",
        time: action2Time,
        collectionId: action1.collectionId,
        collectionAction: {
            type: "Create",
            creatorId: null,
            name: "Test",
            accessPolicy: {
                accountGrantById: new Map([[account1.id, {level: "Manage", generation: 0}]]),
                defaultGrant: null,
                urlGrant: null,
            },
        },
    } satisfies TaskAction;

    const action3 = {
        type: "UpdateCollection",
        time: store.clock.now(),
        collectionId: action2.collectionId,
        collectionAction: {
            type: "UpdateName",
            name: "Test 2",
        },
    } satisfies TaskAction;

    expect(getCollectionEntryIfExists(store, action2.collectionId)).toEqual(null);

    store.commitTaskActionTransaction(context, [action1], {
        undoManager: null,
        affinityManager: noopAffinityManager,
    });

    expect(getCollectionEntryIfExists(store, action2.collectionId)).toEqual({
        collection: null,
        actions: [action1],
        optimisticState: {
            original: {
                collection: null,
                actions: [],
            },
            actions: [{isOptimistic: true, action: action1}],
        },
        authorizationState: null,
    });

    store.commitTaskActionTransaction(context, [action3], {
        undoManager: null,
        affinityManager: noopAffinityManager,
    });

    expect(getCollectionEntryIfExists(store, action2.collectionId)).toEqual({
        collection: null,
        actions: [action1, action3],
        optimisticState: {
            original: {
                collection: null,
                actions: [],
            },
            actions: [
                {isOptimistic: true, action: action1},
                {isOptimistic: true, action: action3},
            ],
        },
        authorizationState: null,
    });

    store.commitTaskActionTransaction(context, [action2], {
        undoManager: null,
        affinityManager: noopAffinityManager,
    });

    expect(getCollectionEntryIfExists(store, action2.collectionId)).toEqual({
        collection: createCollection(store, {
            id: action2.collectionId,
            time: action2.time,
            collectionAction: action2.collectionAction,
        })
            .applyAction(action1)
            .applyAction(action3),
        actions: null,
        optimisticState: {
            original: {
                collection: null,
                actions: [],
            },
            actions: [
                {isOptimistic: true, action: action1},
                {isOptimistic: true, action: action3},
                {isOptimistic: true, action: action2},
            ],
        },
        authorizationState: expect.objectContaining({
            value: "Authorized",
            version: zeroHybridLogicalTime,
        }),
    });

    await resolveRpcExecution(commitTaskActionTransaction, 0, {
        extraActions: [],
        referencedAccounts: [],
    });

    expect(getCollectionEntryIfExists(store, action2.collectionId)).toEqual({
        collection: createCollection(store, {
            id: action2.collectionId,
            time: action2.time,
            collectionAction: action2.collectionAction,
        })
            .applyAction(action1)
            .applyAction(action3),
        actions: null,
        optimisticState: {
            original: {
                collection: null,
                actions: [action1],
            },
            actions: [
                {isOptimistic: true, action: action3},
                {isOptimistic: true, action: action2},
            ],
        },
        authorizationState: expect.objectContaining({
            value: "Authorized",
            version: zeroHybridLogicalTime,
        }),
    });

    await resolveRpcExecution(commitTaskActionTransaction, 1, {
        extraActions: [],
        referencedAccounts: [],
    });

    expect(getCollectionEntryIfExists(store, action2.collectionId)).toEqual({
        collection: createCollection(store, {
            id: action2.collectionId,
            time: action2.time,
            collectionAction: action2.collectionAction,
        })
            .applyAction(action1)
            .applyAction(action3),
        actions: null,
        optimisticState: {
            original: {
                collection: null,
                actions: [action1, action3],
            },
            actions: [{isOptimistic: true, action: action2}],
        },
        authorizationState: expect.objectContaining({
            value: "Authorized",
            version: zeroHybridLogicalTime,
        }),
    });

    await resolveRpcExecution(commitTaskActionTransaction, 2, {
        extraActions: [],
        referencedAccounts: [],
    });

    expect(getCollectionEntryIfExists(store, action2.collectionId)).toEqual({
        collection: createCollection(store, {
            id: action2.collectionId,
            time: action2.time,
            collectionAction: action2.collectionAction,
        })
            .applyAction(action1)
            .applyAction(action3),
        actions: null,
        optimisticState: null,
        authorizationState: expect.objectContaining({
            value: "Authorized",
            version: zeroHybridLogicalTime,
        }),
    });
});

test("resolving collection optimistic update after garbage collection is ok", async () => {
    const store = createAutoRetainStore();

    const action1 = {
        type: "UpdateCollection",
        time: store.clock.now(),
        collectionId: generateId(),
        collectionAction: {
            type: "Create",
            creatorId: null,
            name: "Test",
            accessPolicy: {
                accountGrantById: new Map([[account1.id, {level: "Manage", generation: 0}]]),
                defaultGrant: null,
                urlGrant: null,
            },
        },
    } satisfies TaskAction;

    const action2 = {
        type: "UpdateCollection",
        time: store.clock.now(),
        collectionId: action1.collectionId,
        collectionAction: {
            type: "UpdateName",
            name: "Test 2",
        },
    } satisfies TaskAction;

    expect(getCollectionEntryIfExists(store, action1.collectionId)).toEqual(null);

    store.commitTaskActionTransaction(context, [action1], {
        undoManager: null,
        affinityManager: noopAffinityManager,
    });

    expect(getCollectionEntryIfExists(store, action1.collectionId)).toEqual({
        collection: createCollection(store, {
            id: action1.collectionId,
            time: action1.time,
            collectionAction: action1.collectionAction,
        }),
        actions: null,
        optimisticState: {
            original: {
                collection: null,
                actions: [],
            },
            actions: [{isOptimistic: true, action: action1}],
        },
        authorizationState: expect.objectContaining({
            value: "Authorized",
            version: zeroHybridLogicalTime,
        }),
    });

    store.commitTaskActionTransaction(context, [action2], {
        undoManager: null,
        affinityManager: noopAffinityManager,
    });

    expect(getCollectionEntryIfExists(store, action1.collectionId)).toEqual({
        collection: createCollection(store, {
            id: action1.collectionId,
            time: action1.time,
            collectionAction: action1.collectionAction,
        }).applyAction(action2),
        actions: null,
        optimisticState: {
            original: {
                collection: null,
                actions: [],
            },
            actions: [
                {isOptimistic: true, action: action1},
                {isOptimistic: true, action: action2},
            ],
        },
        authorizationState: expect.objectContaining({
            value: "Authorized",
            version: zeroHybridLogicalTime,
        }),
    });

    await resolveRpcExecution(commitTaskActionTransaction, 0, {
        extraActions: [],
        referencedAccounts: [],
    });

    expect(getCollectionEntryIfExists(store, action1.collectionId)).toEqual({
        collection: createCollection(store, {
            id: action1.collectionId,
            time: action1.time,
            collectionAction: action1.collectionAction,
        }).applyAction(action2),
        actions: null,
        optimisticState: {
            original: {
                collection: createCollection(store, {
                    id: action1.collectionId,
                    time: action1.time,
                    collectionAction: action1.collectionAction,
                }),
                actions: null,
            },
            actions: [{isOptimistic: true, action: action2}],
        },
        authorizationState: expect.objectContaining({
            value: "Authorized",
            version: zeroHybridLogicalTime,
        }),
    });

    const previousCollectionSubscriptions = collectionSubscriptions;
    collectionSubscriptions = [];
    for (const subscription of previousCollectionSubscriptions) {
        subscription.release();
    }

    expect(getCollectionEntryIfExists(store, action1.collectionId)).toEqual(null);

    await resolveRpcExecution(commitTaskActionTransaction, 1, {
        extraActions: [],
        referencedAccounts: [],
    });

    expect(getCollectionEntryIfExists(store, action1.collectionId)).toEqual(null);
});

test("regular collection actions are added to optimistic state", async () => {
    const store = createAutoRetainStore();

    const collection = createCollection(store);

    const action2 = {
        type: "UpdateCollection",
        time: store.clock.now(),
        collectionId: collection.id,
        collectionAction: {
            type: "UpdateName",
            name: "Test 2",
        },
    } satisfies TaskAction;

    const action3 = {
        type: "UpdateCollection",
        time: store.clock.now(),
        collectionId: collection.id,
        collectionAction: {
            type: "UpdateColor",
            color: "red",
        },
    } satisfies TaskAction;

    expect(getCollectionEntryIfExists(store, collection.id)).toEqual(null);

    store.applyUpdateEvent({
        type: "Update",
        originClientId: null,
        defaultAuthorizationStateVersion: clock.now(),
        actions: [],
        backfillTasks: [],
        backfillCollections: [{type: "Authorized", collection: collection}],
        referencedAccounts: [],
    });

    expect(getCollectionEntryIfExists(store, collection.id)).toEqual({
        collection,
        actions: null,
        optimisticState: null,
        authorizationState: expect.objectContaining({value: "Authorized"}),
    });

    store.commitTaskActionTransaction(context, [action2], {
        undoManager: null,
        affinityManager: noopAffinityManager,
    });

    expect(getCollectionEntryIfExists(store, collection.id)).toEqual({
        collection: collection.applyAction(action2),
        actions: null,
        optimisticState: {
            original: {
                collection: collection,
                actions: null,
            },
            actions: [{isOptimistic: true, action: action2}],
        },
        authorizationState: expect.objectContaining({value: "Authorized"}),
    });

    store.applyUpdateEvent({
        type: "Update",
        originClientId: null,
        defaultAuthorizationStateVersion: clock.now(),
        actions: [action3],
        backfillTasks: [],
        backfillCollections: [],
        referencedAccounts: [],
    });

    expect(getCollectionEntryIfExists(store, collection.id)).toEqual({
        collection: collection.applyAction(action2).applyAction(action3),
        actions: null,
        optimisticState: {
            original: {
                collection: collection,
                actions: null,
            },
            actions: [
                {isOptimistic: true, action: action2},
                {isOptimistic: false, action: action3},
            ],
        },
        authorizationState: expect.objectContaining({value: "Authorized"}),
    });

    await resolveRpcExecution(commitTaskActionTransaction, 0, {
        extraActions: [],
        referencedAccounts: [],
    });

    expect(getCollectionEntryIfExists(store, collection.id)).toEqual({
        collection: collection.applyAction(action2).applyAction(action3),
        actions: null,
        optimisticState: null,
        authorizationState: expect.objectContaining({value: "Authorized"}),
    });
});

test("regular collection actions are added to optimistic state with multiple actions", async () => {
    const store = createAutoRetainStore();

    const collection = createCollection(store);

    const action2 = {
        type: "UpdateCollection",
        time: store.clock.now(),
        collectionId: collection.id,
        collectionAction: {
            type: "UpdateName",
            name: "Test 2",
        },
    } satisfies TaskAction;

    const action3 = {
        type: "UpdateCollection",
        time: store.clock.now(),
        collectionId: collection.id,
        collectionAction: {
            type: "UpdateColor",
            color: "red",
        },
    } satisfies TaskAction;

    const action4 = {
        type: "UpdateCollection",
        time: store.clock.now(),
        collectionId: collection.id,
        collectionAction: {
            type: "UpdateName",
            name: "Test 3",
        },
    } satisfies TaskAction;

    expect(getCollectionEntryIfExists(store, collection.id)).toEqual(null);

    store.applyUpdateEvent({
        type: "Update",
        originClientId: null,
        defaultAuthorizationStateVersion: clock.now(),
        actions: [],
        backfillTasks: [],
        backfillCollections: [{type: "Authorized", collection: collection}],
        referencedAccounts: [],
    });

    expect(getCollectionEntryIfExists(store, collection.id)).toEqual({
        collection,
        actions: null,
        optimisticState: null,
        authorizationState: expect.objectContaining({value: "Authorized"}),
    });

    store.commitTaskActionTransaction(context, [action2], {
        undoManager: null,
        affinityManager: noopAffinityManager,
    });

    expect(getCollectionEntryIfExists(store, collection.id)).toEqual({
        collection: collection.applyAction(action2),
        actions: null,
        optimisticState: {
            original: {
                collection: collection,
                actions: null,
            },
            actions: [{isOptimistic: true, action: action2}],
        },
        authorizationState: expect.objectContaining({value: "Authorized"}),
    });

    store.applyUpdateEvent({
        type: "Update",
        originClientId: null,
        defaultAuthorizationStateVersion: clock.now(),
        actions: [action3],
        backfillTasks: [],
        backfillCollections: [],
        referencedAccounts: [],
    });

    expect(getCollectionEntryIfExists(store, collection.id)).toEqual({
        collection: collection.applyAction(action2).applyAction(action3),
        actions: null,
        optimisticState: {
            original: {
                collection: collection,
                actions: null,
            },
            actions: [
                {isOptimistic: true, action: action2},
                {isOptimistic: false, action: action3},
            ],
        },
        authorizationState: expect.objectContaining({value: "Authorized"}),
    });

    store.commitTaskActionTransaction(context, [action4], {
        undoManager: null,
        affinityManager: noopAffinityManager,
    });

    expect(getCollectionEntryIfExists(store, collection.id)).toEqual({
        collection: collection.applyAction(action2).applyAction(action3).applyAction(action4),
        actions: null,
        optimisticState: {
            original: {
                collection: collection,
                actions: null,
            },
            actions: [
                {isOptimistic: true, action: action2},
                {isOptimistic: false, action: action3},
                {isOptimistic: true, action: action4},
            ],
        },
        authorizationState: expect.objectContaining({value: "Authorized"}),
    });

    await resolveRpcExecution(commitTaskActionTransaction, 0, {
        extraActions: [],
        referencedAccounts: [],
    });

    expect(getCollectionEntryIfExists(store, collection.id)).toEqual({
        collection: collection.applyAction(action2).applyAction(action3).applyAction(action4),
        actions: null,
        optimisticState: {
            original: {
                collection: collection.applyAction(action2).applyAction(action3),
                actions: null,
            },
            actions: [{isOptimistic: true, action: action4}],
        },
        authorizationState: expect.objectContaining({value: "Authorized"}),
    });

    await resolveRpcExecution(commitTaskActionTransaction, 1, {
        extraActions: [],
        referencedAccounts: [],
    });

    expect(getCollectionEntryIfExists(store, collection.id)).toEqual({
        collection: collection.applyAction(action2).applyAction(action3).applyAction(action4),
        actions: null,
        optimisticState: null,
        authorizationState: expect.objectContaining({value: "Authorized"}),
    });
});

test("regular collection actions are added to optimistic state with multiple actions that are committed out of order", async () => {
    const store = createAutoRetainStore();

    const collection = createCollection(store);

    const action2 = {
        type: "UpdateCollection",
        time: store.clock.now(),
        collectionId: collection.id,
        collectionAction: {
            type: "UpdateName",
            name: "Test 2",
        },
    } satisfies TaskAction;

    const action3 = {
        type: "UpdateCollection",
        time: store.clock.now(),
        collectionId: collection.id,
        collectionAction: {
            type: "UpdateColor",
            color: "red",
        },
    } satisfies TaskAction;

    const action4 = {
        type: "UpdateCollection",
        time: store.clock.now(),
        collectionId: collection.id,
        collectionAction: {
            type: "UpdateName",
            name: "Test 3",
        },
    } satisfies TaskAction;

    expect(getCollectionEntryIfExists(store, collection.id)).toEqual(null);

    store.applyUpdateEvent({
        type: "Update",
        originClientId: null,
        defaultAuthorizationStateVersion: clock.now(),
        actions: [],
        backfillTasks: [],
        backfillCollections: [{type: "Authorized", collection: collection}],
        referencedAccounts: [],
    });

    expect(getCollectionEntryIfExists(store, collection.id)).toEqual({
        collection,
        actions: null,
        optimisticState: null,
        authorizationState: expect.objectContaining({value: "Authorized"}),
    });

    store.commitTaskActionTransaction(context, [action2], {
        undoManager: null,
        affinityManager: noopAffinityManager,
    });

    expect(getCollectionEntryIfExists(store, collection.id)).toEqual({
        collection: collection.applyAction(action2),
        actions: null,
        optimisticState: {
            original: {
                collection: collection,
                actions: null,
            },
            actions: [{isOptimistic: true, action: action2}],
        },
        authorizationState: expect.objectContaining({value: "Authorized"}),
    });

    store.applyUpdateEvent({
        type: "Update",
        originClientId: null,
        defaultAuthorizationStateVersion: clock.now(),
        actions: [action3],
        backfillTasks: [],
        backfillCollections: [],
        referencedAccounts: [],
    });

    expect(getCollectionEntryIfExists(store, collection.id)).toEqual({
        collection: collection.applyAction(action2).applyAction(action3),
        actions: null,
        optimisticState: {
            original: {
                collection: collection,
                actions: null,
            },
            actions: [
                {isOptimistic: true, action: action2},
                {isOptimistic: false, action: action3},
            ],
        },
        authorizationState: expect.objectContaining({value: "Authorized"}),
    });

    store.commitTaskActionTransaction(context, [action4], {
        undoManager: null,
        affinityManager: noopAffinityManager,
    });

    expect(getCollectionEntryIfExists(store, collection.id)).toEqual({
        collection: collection.applyAction(action2).applyAction(action3).applyAction(action4),
        actions: null,
        optimisticState: {
            original: {
                collection: collection,
                actions: null,
            },
            actions: [
                {isOptimistic: true, action: action2},
                {isOptimistic: false, action: action3},
                {isOptimistic: true, action: action4},
            ],
        },
        authorizationState: expect.objectContaining({value: "Authorized"}),
    });

    await resolveRpcExecution(commitTaskActionTransaction, 1, {
        extraActions: [],
        referencedAccounts: [],
    });

    expect(getCollectionEntryIfExists(store, collection.id)).toEqual({
        collection: collection.applyAction(action2).applyAction(action3).applyAction(action4),
        actions: null,
        optimisticState: {
            original: {
                collection: collection.applyAction(action4),
                actions: null,
            },
            actions: [
                {isOptimistic: true, action: action2},
                {isOptimistic: false, action: action3},
            ],
        },
        authorizationState: expect.objectContaining({value: "Authorized"}),
    });

    await resolveRpcExecution(commitTaskActionTransaction, 0, {
        extraActions: [],
        referencedAccounts: [],
    });

    expect(getCollectionEntryIfExists(store, collection.id)).toEqual({
        collection: collection.applyAction(action2).applyAction(action3).applyAction(action4),
        actions: null,
        optimisticState: null,
        authorizationState: expect.objectContaining({value: "Authorized"}),
    });
});

test("regular actions are added to optimistic state when collection is not backfilled", async () => {
    const store = createAutoRetainStore();

    const collection = createCollection(store);

    const action2 = {
        type: "UpdateCollection",
        time: store.clock.now(),
        collectionId: collection.id,
        collectionAction: {
            type: "UpdateName",
            name: "Test 2",
        },
    } satisfies TaskAction;

    const action3 = {
        type: "UpdateCollection",
        time: store.clock.now(),
        collectionId: collection.id,
        collectionAction: {
            type: "UpdateColor",
            color: "red",
        },
    } satisfies TaskAction;

    expect(getCollectionEntryIfExists(store, collection.id)).toEqual(null);

    store.commitTaskActionTransaction(context, [action2], {
        undoManager: null,
        affinityManager: noopAffinityManager,
    });

    expect(getCollectionEntryIfExists(store, collection.id)).toEqual({
        collection: null,
        actions: [action2],
        optimisticState: {
            original: {
                collection: null,
                actions: [],
            },
            actions: [{isOptimistic: true, action: action2}],
        },
        authorizationState: null,
    });

    store.applyUpdateEvent({
        type: "Update",
        originClientId: null,
        defaultAuthorizationStateVersion: clock.now(),
        actions: [action3],
        backfillTasks: [],
        backfillCollections: [],
        referencedAccounts: [],
    });

    expect(getCollectionEntryIfExists(store, collection.id)).toEqual({
        collection: null,
        actions: [action2, action3],
        optimisticState: {
            original: {
                collection: null,
                actions: [],
            },
            actions: [
                {isOptimistic: true, action: action2},
                {isOptimistic: false, action: action3},
            ],
        },
        authorizationState: null,
    });

    await resolveRpcExecution(commitTaskActionTransaction, 0, {
        extraActions: [],
        referencedAccounts: [],
    });

    expect(getCollectionEntryIfExists(store, collection.id)).toEqual({
        collection: null,
        actions: [action2, action3],
        optimisticState: null,
        authorizationState: null,
    });
});

test("regular actions are added to optimistic state with multiple actions when collection is not backfilled", async () => {
    const store = createAutoRetainStore();

    const collection = createCollection(store);

    const action2 = {
        type: "UpdateCollection",
        time: store.clock.now(),
        collectionId: collection.id,
        collectionAction: {
            type: "UpdateName",
            name: "Test 2",
        },
    } satisfies TaskAction;

    const action3 = {
        type: "UpdateCollection",
        time: store.clock.now(),
        collectionId: collection.id,
        collectionAction: {
            type: "UpdateColor",
            color: "red",
        },
    } satisfies TaskAction;

    const action4 = {
        type: "UpdateCollection",
        time: store.clock.now(),
        collectionId: collection.id,
        collectionAction: {
            type: "UpdateName",
            name: "Test 3",
        },
    } satisfies TaskAction;

    expect(getCollectionEntryIfExists(store, collection.id)).toEqual(null);

    store.commitTaskActionTransaction(context, [action2], {
        undoManager: null,
        affinityManager: noopAffinityManager,
    });

    expect(getCollectionEntryIfExists(store, collection.id)).toEqual({
        collection: null,
        actions: [action2],
        optimisticState: {
            original: {
                collection: null,
                actions: [],
            },
            actions: [{isOptimistic: true, action: action2}],
        },
        authorizationState: null,
    });

    store.applyUpdateEvent({
        type: "Update",
        originClientId: null,
        defaultAuthorizationStateVersion: clock.now(),
        actions: [action3],
        backfillTasks: [],
        backfillCollections: [],
        referencedAccounts: [],
    });

    expect(getCollectionEntryIfExists(store, collection.id)).toEqual({
        collection: null,
        actions: [action2, action3],
        optimisticState: {
            original: {
                collection: null,
                actions: [],
            },
            actions: [
                {isOptimistic: true, action: action2},
                {isOptimistic: false, action: action3},
            ],
        },
        authorizationState: null,
    });

    store.commitTaskActionTransaction(context, [action4], {
        undoManager: null,
        affinityManager: noopAffinityManager,
    });

    expect(getCollectionEntryIfExists(store, collection.id)).toEqual({
        collection: null,
        actions: [action2, action3, action4],
        optimisticState: {
            original: {
                collection: null,
                actions: [],
            },
            actions: [
                {isOptimistic: true, action: action2},
                {isOptimistic: false, action: action3},
                {isOptimistic: true, action: action4},
            ],
        },
        authorizationState: null,
    });

    await resolveRpcExecution(commitTaskActionTransaction, 0, {
        extraActions: [],
        referencedAccounts: [],
    });

    expect(getCollectionEntryIfExists(store, collection.id)).toEqual({
        collection: null,
        actions: [action2, action3, action4],
        optimisticState: {
            original: {
                collection: null,
                actions: [action2, action3],
            },
            actions: [{isOptimistic: true, action: action4}],
        },
        authorizationState: null,
    });

    await resolveRpcExecution(commitTaskActionTransaction, 1, {
        extraActions: [],
        referencedAccounts: [],
    });

    expect(getCollectionEntryIfExists(store, collection.id)).toEqual({
        collection: null,
        actions: [action2, action3, action4],
        optimisticState: null,
        authorizationState: null,
    });
});

test("regular actions are added to optimistic state with multiple actions that are committed out of order when collection is not backfilled", async () => {
    const store = createAutoRetainStore();

    const collection = createCollection(store);

    const action2 = {
        type: "UpdateCollection",
        time: store.clock.now(),
        collectionId: collection.id,
        collectionAction: {
            type: "UpdateName",
            name: "Test 2",
        },
    } satisfies TaskAction;

    const action3 = {
        type: "UpdateCollection",
        time: store.clock.now(),
        collectionId: collection.id,
        collectionAction: {
            type: "UpdateColor",
            color: "red",
        },
    } satisfies TaskAction;

    const action4 = {
        type: "UpdateCollection",
        time: store.clock.now(),
        collectionId: collection.id,
        collectionAction: {
            type: "UpdateName",
            name: "Test 3",
        },
    } satisfies TaskAction;

    expect(getCollectionEntryIfExists(store, collection.id)).toEqual(null);

    store.commitTaskActionTransaction(context, [action2], {
        undoManager: null,
        affinityManager: noopAffinityManager,
    });

    expect(getCollectionEntryIfExists(store, collection.id)).toEqual({
        collection: null,
        actions: [action2],
        optimisticState: {
            original: {
                collection: null,
                actions: [],
            },
            actions: [{isOptimistic: true, action: action2}],
        },
        authorizationState: null,
    });

    store.applyUpdateEvent({
        type: "Update",
        originClientId: null,
        defaultAuthorizationStateVersion: clock.now(),
        actions: [action3],
        backfillTasks: [],
        backfillCollections: [],
        referencedAccounts: [],
    });

    expect(getCollectionEntryIfExists(store, collection.id)).toEqual({
        collection: null,
        actions: [action2, action3],
        optimisticState: {
            original: {
                collection: null,
                actions: [],
            },
            actions: [
                {isOptimistic: true, action: action2},
                {isOptimistic: false, action: action3},
            ],
        },
        authorizationState: null,
    });

    store.commitTaskActionTransaction(context, [action4], {
        undoManager: null,
        affinityManager: noopAffinityManager,
    });

    expect(getCollectionEntryIfExists(store, collection.id)).toEqual({
        collection: null,
        actions: [action2, action3, action4],
        optimisticState: {
            original: {
                collection: null,
                actions: [],
            },
            actions: [
                {isOptimistic: true, action: action2},
                {isOptimistic: false, action: action3},
                {isOptimistic: true, action: action4},
            ],
        },
        authorizationState: null,
    });

    await resolveRpcExecution(commitTaskActionTransaction, 1, {
        extraActions: [],
        referencedAccounts: [],
    });

    expect(getCollectionEntryIfExists(store, collection.id)).toEqual({
        collection: null,
        actions: [action2, action3, action4],
        optimisticState: {
            original: {
                collection: null,
                actions: [action4],
            },
            actions: [
                {isOptimistic: true, action: action2},
                {isOptimistic: false, action: action3},
            ],
        },
        authorizationState: null,
    });

    await resolveRpcExecution(commitTaskActionTransaction, 0, {
        extraActions: [],
        referencedAccounts: [],
    });

    expect(getCollectionEntryIfExists(store, collection.id)).toEqual({
        collection: null,
        actions: [action2, action3, action4],
        optimisticState: null,
        authorizationState: null,
    });
});

test("regular actions are added to optimistic state when collection is created optimistically", async () => {
    const store = createAutoRetainStore();

    const action1 = {
        type: "UpdateCollection",
        time: store.clock.now(),
        collectionId: generateId(),
        collectionAction: {
            type: "Create",
            creatorId: null,
            name: "Test",
            accessPolicy: {
                accountGrantById: new Map([[account1.id, {level: "Manage", generation: 0}]]),
                defaultGrant: null,
                urlGrant: null,
            },
        },
    } satisfies TaskAction;

    const collection = createCollection(store, {
        id: action1.collectionId,
        time: action1.time,
        collectionAction: action1.collectionAction,
    });

    const action2 = {
        type: "UpdateCollection",
        time: store.clock.now(),
        collectionId: collection.id,
        collectionAction: {
            type: "UpdateName",
            name: "Test 2",
        },
    } satisfies TaskAction;

    const action3 = {
        type: "UpdateCollection",
        time: store.clock.now(),
        collectionId: collection.id,
        collectionAction: {
            type: "UpdateColor",
            color: "red",
        },
    } satisfies TaskAction;

    expect(getCollectionEntryIfExists(store, collection.id)).toEqual(null);

    store.commitTaskActionTransaction(context, [action1], {
        undoManager: null,
        affinityManager: noopAffinityManager,
    });

    expect(getCollectionEntryIfExists(store, collection.id)).toEqual({
        collection,
        actions: null,
        optimisticState: {
            original: {
                collection: null,
                actions: [],
            },
            actions: [{isOptimistic: true, action: action1}],
        },
        authorizationState: expect.objectContaining({
            value: "Authorized",
            version: zeroHybridLogicalTime,
        }),
    });

    store.commitTaskActionTransaction(context, [action2], {
        undoManager: null,
        affinityManager: noopAffinityManager,
    });

    expect(getCollectionEntryIfExists(store, collection.id)).toEqual({
        collection: collection.applyAction(action2),
        actions: null,
        optimisticState: {
            original: {
                collection: null,
                actions: [],
            },
            actions: [
                {isOptimistic: true, action: action1},
                {isOptimistic: true, action: action2},
            ],
        },
        authorizationState: expect.objectContaining({
            value: "Authorized",
            version: zeroHybridLogicalTime,
        }),
    });

    store.applyUpdateEvent({
        type: "Update",
        originClientId: null,
        defaultAuthorizationStateVersion: clock.now(),
        actions: [action3],
        backfillTasks: [],
        backfillCollections: [],
        referencedAccounts: [],
    });

    expect(getCollectionEntryIfExists(store, collection.id)).toEqual({
        collection: collection.applyAction(action2).applyAction(action3),
        actions: null,
        optimisticState: {
            original: {
                collection: null,
                actions: [],
            },
            actions: [
                {isOptimistic: true, action: action1},
                {isOptimistic: true, action: action2},
                {isOptimistic: false, action: action3},
            ],
        },
        authorizationState: expect.objectContaining({
            value: "Authorized",
            version: zeroHybridLogicalTime,
        }),
    });

    await resolveRpcExecution(commitTaskActionTransaction, 0, {
        extraActions: [],
        referencedAccounts: [],
    });

    expect(getCollectionEntryIfExists(store, collection.id)).toEqual({
        collection: collection.applyAction(action2).applyAction(action3),
        actions: null,
        optimisticState: {
            original: {
                collection,
                actions: null,
            },
            actions: [
                {isOptimistic: true, action: action2},
                {isOptimistic: false, action: action3},
            ],
        },
        authorizationState: expect.objectContaining({
            value: "Authorized",
            version: zeroHybridLogicalTime,
        }),
    });

    await resolveRpcExecution(commitTaskActionTransaction, 1, {
        extraActions: [],
        referencedAccounts: [],
    });

    expect(getCollectionEntryIfExists(store, collection.id)).toEqual({
        collection: collection.applyAction(action2).applyAction(action3),
        actions: null,
        optimisticState: null,
        authorizationState: expect.objectContaining({
            value: "Authorized",
            version: zeroHybridLogicalTime,
        }),
    });
});

test("regular actions are added to optimistic state with multiple actions when collection is created optimistically", async () => {
    const store = createAutoRetainStore();

    const action1 = {
        type: "UpdateCollection",
        time: store.clock.now(),
        collectionId: generateId(),
        collectionAction: {
            type: "Create",
            creatorId: null,
            name: "Test",
            accessPolicy: {
                accountGrantById: new Map([[account1.id, {level: "Manage", generation: 0}]]),
                defaultGrant: null,
                urlGrant: null,
            },
        },
    } satisfies TaskAction;

    const collection = createCollection(store, {
        id: action1.collectionId,
        time: action1.time,
        collectionAction: action1.collectionAction,
    });

    const action2 = {
        type: "UpdateCollection",
        time: store.clock.now(),
        collectionId: collection.id,
        collectionAction: {
            type: "UpdateName",
            name: "Test 2",
        },
    } satisfies TaskAction;

    const action3 = {
        type: "UpdateCollection",
        time: store.clock.now(),
        collectionId: collection.id,
        collectionAction: {
            type: "UpdateColor",
            color: "red",
        },
    } satisfies TaskAction;

    const action4 = {
        type: "UpdateCollection",
        time: store.clock.now(),
        collectionId: collection.id,
        collectionAction: {
            type: "UpdateName",
            name: "Test 3",
        },
    } satisfies TaskAction;

    expect(getCollectionEntryIfExists(store, collection.id)).toEqual(null);

    store.commitTaskActionTransaction(context, [action1], {
        undoManager: null,
        affinityManager: noopAffinityManager,
    });

    expect(getCollectionEntryIfExists(store, collection.id)).toEqual({
        collection,
        actions: null,
        optimisticState: {
            original: {
                collection: null,
                actions: [],
            },
            actions: [{isOptimistic: true, action: action1}],
        },
        authorizationState: expect.objectContaining({
            value: "Authorized",
            version: zeroHybridLogicalTime,
        }),
    });

    store.commitTaskActionTransaction(context, [action2], {
        undoManager: null,
        affinityManager: noopAffinityManager,
    });

    expect(getCollectionEntryIfExists(store, collection.id)).toEqual({
        collection: collection.applyAction(action2),
        actions: null,
        optimisticState: {
            original: {
                collection: null,
                actions: [],
            },
            actions: [
                {isOptimistic: true, action: action1},
                {isOptimistic: true, action: action2},
            ],
        },
        authorizationState: expect.objectContaining({
            value: "Authorized",
            version: zeroHybridLogicalTime,
        }),
    });

    store.applyUpdateEvent({
        type: "Update",
        originClientId: null,
        defaultAuthorizationStateVersion: clock.now(),
        actions: [action3],
        backfillTasks: [],
        backfillCollections: [],
        referencedAccounts: [],
    });

    expect(getCollectionEntryIfExists(store, collection.id)).toEqual({
        collection: collection.applyAction(action2).applyAction(action3),
        actions: null,
        optimisticState: {
            original: {
                collection: null,
                actions: [],
            },
            actions: [
                {isOptimistic: true, action: action1},
                {isOptimistic: true, action: action2},
                {isOptimistic: false, action: action3},
            ],
        },
        authorizationState: expect.objectContaining({
            value: "Authorized",
            version: zeroHybridLogicalTime,
        }),
    });

    store.commitTaskActionTransaction(context, [action4], {
        undoManager: null,
        affinityManager: noopAffinityManager,
    });

    expect(getCollectionEntryIfExists(store, collection.id)).toEqual({
        collection: collection.applyAction(action2).applyAction(action3).applyAction(action4),
        actions: null,
        optimisticState: {
            original: {
                collection: null,
                actions: [],
            },
            actions: [
                {isOptimistic: true, action: action1},
                {isOptimistic: true, action: action2},
                {isOptimistic: false, action: action3},
                {isOptimistic: true, action: action4},
            ],
        },
        authorizationState: expect.objectContaining({
            value: "Authorized",
            version: zeroHybridLogicalTime,
        }),
    });

    await resolveRpcExecution(commitTaskActionTransaction, 0, {
        extraActions: [],
        referencedAccounts: [],
    });

    expect(getCollectionEntryIfExists(store, collection.id)).toEqual({
        collection: collection.applyAction(action2).applyAction(action3).applyAction(action4),
        actions: null,
        optimisticState: {
            original: {
                collection,
                actions: null,
            },
            actions: [
                {isOptimistic: true, action: action2},
                {isOptimistic: false, action: action3},
                {isOptimistic: true, action: action4},
            ],
        },
        authorizationState: expect.objectContaining({
            value: "Authorized",
            version: zeroHybridLogicalTime,
        }),
    });

    await resolveRpcExecution(commitTaskActionTransaction, 1, {
        extraActions: [],
        referencedAccounts: [],
    });

    expect(getCollectionEntryIfExists(store, collection.id)).toEqual({
        collection: collection.applyAction(action2).applyAction(action3).applyAction(action4),
        actions: null,
        optimisticState: {
            original: {
                collection: collection.applyAction(action2).applyAction(action3),
                actions: null,
            },
            actions: [{isOptimistic: true, action: action4}],
        },
        authorizationState: expect.objectContaining({
            value: "Authorized",
            version: zeroHybridLogicalTime,
        }),
    });

    await resolveRpcExecution(commitTaskActionTransaction, 2, {
        extraActions: [],
        referencedAccounts: [],
    });

    expect(getCollectionEntryIfExists(store, collection.id)).toEqual({
        collection: collection.applyAction(action2).applyAction(action3).applyAction(action4),
        actions: null,
        optimisticState: null,
        authorizationState: expect.objectContaining({
            value: "Authorized",
            version: zeroHybridLogicalTime,
        }),
    });
});

test("regular actions are added to optimistic state with multiple actions that are committed out of order when collection is created optimistically", async () => {
    const store = createAutoRetainStore();

    const action1 = {
        type: "UpdateCollection",
        time: store.clock.now(),
        collectionId: generateId(),
        collectionAction: {
            type: "Create",
            creatorId: null,
            name: "Test",
            accessPolicy: {
                accountGrantById: new Map([[account1.id, {level: "Manage", generation: 0}]]),
                defaultGrant: null,
                urlGrant: null,
            },
        },
    } satisfies TaskAction;

    const collection = createCollection(store, {
        id: action1.collectionId,
        time: action1.time,
        collectionAction: action1.collectionAction,
    });

    const action2 = {
        type: "UpdateCollection",
        time: store.clock.now(),
        collectionId: collection.id,
        collectionAction: {
            type: "UpdateName",
            name: "Test 2",
        },
    } satisfies TaskAction;

    const action3 = {
        type: "UpdateCollection",
        time: store.clock.now(),
        collectionId: collection.id,
        collectionAction: {
            type: "UpdateColor",
            color: "red",
        },
    } satisfies TaskAction;

    const action4 = {
        type: "UpdateCollection",
        time: store.clock.now(),
        collectionId: collection.id,
        collectionAction: {
            type: "UpdateName",
            name: "Test 3",
        },
    } satisfies TaskAction;

    expect(getCollectionEntryIfExists(store, collection.id)).toEqual(null);

    store.commitTaskActionTransaction(context, [action1], {
        undoManager: null,
        affinityManager: noopAffinityManager,
    });

    expect(getCollectionEntryIfExists(store, collection.id)).toEqual({
        collection,
        actions: null,
        optimisticState: {
            original: {
                collection: null,
                actions: [],
            },
            actions: [{isOptimistic: true, action: action1}],
        },
        authorizationState: expect.objectContaining({
            value: "Authorized",
            version: zeroHybridLogicalTime,
        }),
    });

    store.commitTaskActionTransaction(context, [action2], {
        undoManager: null,
        affinityManager: noopAffinityManager,
    });

    expect(getCollectionEntryIfExists(store, collection.id)).toEqual({
        collection: collection.applyAction(action2),
        actions: null,
        optimisticState: {
            original: {
                collection: null,
                actions: [],
            },
            actions: [
                {isOptimistic: true, action: action1},
                {isOptimistic: true, action: action2},
            ],
        },
        authorizationState: expect.objectContaining({
            value: "Authorized",
            version: zeroHybridLogicalTime,
        }),
    });

    store.applyUpdateEvent({
        type: "Update",
        originClientId: null,
        defaultAuthorizationStateVersion: clock.now(),
        actions: [action3],
        backfillTasks: [],
        backfillCollections: [],
        referencedAccounts: [],
    });

    expect(getCollectionEntryIfExists(store, collection.id)).toEqual({
        collection: collection.applyAction(action2).applyAction(action3),
        actions: null,
        optimisticState: {
            original: {
                collection: null,
                actions: [],
            },
            actions: [
                {isOptimistic: true, action: action1},
                {isOptimistic: true, action: action2},
                {isOptimistic: false, action: action3},
            ],
        },
        authorizationState: expect.objectContaining({
            value: "Authorized",
            version: zeroHybridLogicalTime,
        }),
    });

    store.commitTaskActionTransaction(context, [action4], {
        undoManager: null,
        affinityManager: noopAffinityManager,
    });

    expect(getCollectionEntryIfExists(store, collection.id)).toEqual({
        collection: collection.applyAction(action2).applyAction(action3).applyAction(action4),
        actions: null,
        optimisticState: {
            original: {
                collection: null,
                actions: [],
            },
            actions: [
                {isOptimistic: true, action: action1},
                {isOptimistic: true, action: action2},
                {isOptimistic: false, action: action3},
                {isOptimistic: true, action: action4},
            ],
        },
        authorizationState: expect.objectContaining({
            value: "Authorized",
            version: zeroHybridLogicalTime,
        }),
    });

    await resolveRpcExecution(commitTaskActionTransaction, 0, {
        extraActions: [],
        referencedAccounts: [],
    });

    expect(getCollectionEntryIfExists(store, collection.id)).toEqual({
        collection: collection.applyAction(action2).applyAction(action3).applyAction(action4),
        actions: null,
        optimisticState: {
            original: {
                collection,
                actions: null,
            },
            actions: [
                {isOptimistic: true, action: action2},
                {isOptimistic: false, action: action3},
                {isOptimistic: true, action: action4},
            ],
        },
        authorizationState: expect.objectContaining({
            value: "Authorized",
            version: zeroHybridLogicalTime,
        }),
    });

    await resolveRpcExecution(commitTaskActionTransaction, 2, {
        extraActions: [],
        referencedAccounts: [],
    });

    expect(getCollectionEntryIfExists(store, collection.id)).toEqual({
        collection: collection.applyAction(action2).applyAction(action3).applyAction(action4),
        actions: null,
        optimisticState: {
            original: {
                collection: collection.applyAction(action4),
                actions: null,
            },
            actions: [
                {isOptimistic: true, action: action2},
                {isOptimistic: false, action: action3},
            ],
        },
        authorizationState: expect.objectContaining({
            value: "Authorized",
            version: zeroHybridLogicalTime,
        }),
    });

    await resolveRpcExecution(commitTaskActionTransaction, 1, {
        extraActions: [],
        referencedAccounts: [],
    });

    expect(getCollectionEntryIfExists(store, collection.id)).toEqual({
        collection: collection.applyAction(action2).applyAction(action3).applyAction(action4),
        actions: null,
        optimisticState: null,
        authorizationState: expect.objectContaining({
            value: "Authorized",
            version: zeroHybridLogicalTime,
        }),
    });
});

test("three optimistic actions when collection is not backfilled", async () => {
    const store = createAutoRetainStore();

    const collection = createCollection(store);

    const action2 = {
        type: "UpdateCollection",
        time: store.clock.now(),
        collectionId: collection.id,
        collectionAction: {
            type: "UpdateName",
            name: "Test 2",
        },
    } satisfies TaskAction;

    const action3 = {
        type: "UpdateCollection",
        time: store.clock.now(),
        collectionId: collection.id,
        collectionAction: {
            type: "UpdateColor",
            color: "red",
        },
    } satisfies TaskAction;

    const action4 = {
        type: "UpdateCollection",
        time: store.clock.now(),
        collectionId: collection.id,
        collectionAction: {
            type: "UpdateName",
            name: "Test 3",
        },
    } satisfies TaskAction;

    expect(getCollectionEntryIfExists(store, collection.id)).toEqual(null);

    store.commitTaskActionTransaction(context, [action2], {
        undoManager: null,
        affinityManager: noopAffinityManager,
    });

    expect(getCollectionEntryIfExists(store, collection.id)).toEqual({
        collection: null,
        actions: [action2],
        optimisticState: {
            original: {
                collection: null,
                actions: [],
            },
            actions: [{isOptimistic: true, action: action2}],
        },
        authorizationState: null,
    });

    store.commitTaskActionTransaction(context, [action3], {
        undoManager: null,
        affinityManager: noopAffinityManager,
    });

    expect(getCollectionEntryIfExists(store, collection.id)).toEqual({
        collection: null,
        actions: [action2, action3],
        optimisticState: {
            original: {
                collection: null,
                actions: [],
            },
            actions: [
                {isOptimistic: true, action: action2},
                {isOptimistic: true, action: action3},
            ],
        },
        authorizationState: null,
    });

    store.commitTaskActionTransaction(context, [action4], {
        undoManager: null,
        affinityManager: noopAffinityManager,
    });

    expect(getCollectionEntryIfExists(store, collection.id)).toEqual({
        collection: null,
        actions: [action2, action3, action4],
        optimisticState: {
            original: {
                collection: null,
                actions: [],
            },
            actions: [
                {isOptimistic: true, action: action2},
                {isOptimistic: true, action: action3},
                {isOptimistic: true, action: action4},
            ],
        },
        authorizationState: null,
    });

    await resolveRpcExecution(commitTaskActionTransaction, 0, {
        extraActions: [],
        referencedAccounts: [],
    });

    expect(getCollectionEntryIfExists(store, collection.id)).toEqual({
        collection: null,
        actions: [action2, action3, action4],
        optimisticState: {
            original: {
                collection: null,
                actions: [action2],
            },
            actions: [
                {isOptimistic: true, action: action3},
                {isOptimistic: true, action: action4},
            ],
        },
        authorizationState: null,
    });

    await resolveRpcExecution(commitTaskActionTransaction, 1, {
        extraActions: [],
        referencedAccounts: [],
    });

    expect(getCollectionEntryIfExists(store, collection.id)).toEqual({
        collection: null,
        actions: [action2, action3, action4],
        optimisticState: {
            original: {
                collection: null,
                actions: [action2, action3],
            },
            actions: [{isOptimistic: true, action: action4}],
        },
        authorizationState: null,
    });

    await resolveRpcExecution(commitTaskActionTransaction, 2, {
        extraActions: [],
        referencedAccounts: [],
    });

    expect(getCollectionEntryIfExists(store, collection.id)).toEqual({
        collection: null,
        actions: [action2, action3, action4],
        optimisticState: null,
        authorizationState: null,
    });
});

test("backfilling a collection when none exists and there are optimistic actions works", async () => {
    const store = createAutoRetainStore();

    const collection = createCollection(store);

    const action2 = {
        type: "UpdateCollection",
        time: store.clock.now(),
        collectionId: collection.id,
        collectionAction: {
            type: "UpdateName",
            name: "Test 2",
        },
    } satisfies TaskAction;

    const action3 = {
        type: "UpdateCollection",
        time: store.clock.now(),
        collectionId: collection.id,
        collectionAction: {
            type: "UpdateColor",
            color: "red",
        },
    } satisfies TaskAction;

    expect(getCollectionEntryIfExists(store, collection.id)).toEqual(null);

    store.commitTaskActionTransaction(context, [action2], {
        undoManager: null,
        affinityManager: noopAffinityManager,
    });

    expect(getCollectionEntryIfExists(store, collection.id)).toEqual({
        collection: null,
        actions: [action2],
        optimisticState: {
            original: {
                collection: null,
                actions: [],
            },
            actions: [{isOptimistic: true, action: action2}],
        },
        authorizationState: null,
    });

    store.applyUpdateEvent({
        type: "Update",
        originClientId: null,
        defaultAuthorizationStateVersion: clock.now(),
        actions: [action3],
        backfillTasks: [],
        backfillCollections: [],
        referencedAccounts: [],
    });

    expect(getCollectionEntryIfExists(store, collection.id)).toEqual({
        collection: null,
        actions: [action2, action3],
        optimisticState: {
            original: {
                collection: null,
                actions: [],
            },
            actions: [
                {isOptimistic: true, action: action2},
                {isOptimistic: false, action: action3},
            ],
        },
        authorizationState: null,
    });

    store.applyUpdateEvent({
        type: "Update",
        originClientId: null,
        defaultAuthorizationStateVersion: clock.now(),
        actions: [],
        backfillTasks: [],
        backfillCollections: [{type: "Authorized", collection: collection}],
        referencedAccounts: [],
    });

    expect(getCollectionEntryIfExists(store, collection.id)).toEqual({
        collection: collection.applyAction(action2).applyAction(action3),
        actions: null,
        optimisticState: {
            original: {
                collection,
                actions: null,
            },
            actions: [
                {isOptimistic: true, action: action2},
                {isOptimistic: false, action: action3},
            ],
        },
        authorizationState: expect.objectContaining({value: "Authorized"}),
    });

    await resolveLastRpcExecution(commitTaskActionTransaction, {
        extraActions: [],
        referencedAccounts: [],
    });

    expect(getCollectionEntryIfExists(store, collection.id)).toEqual({
        collection: collection.applyAction(action2).applyAction(action3),
        actions: null,
        optimisticState: null,
        authorizationState: expect.objectContaining({value: "Authorized"}),
    });
});

test("backfilling a collection when one is already backfilled and there are optimistic actions works", async () => {
    const store = createAutoRetainStore();

    const collection = createCollection(store);

    const action2 = {
        type: "UpdateCollection",
        time: store.clock.now(),
        collectionId: collection.id,
        collectionAction: {
            type: "UpdateName",
            name: "Test 2",
        },
    } satisfies TaskAction;

    const action3 = {
        type: "UpdateCollection",
        time: store.clock.now(),
        collectionId: collection.id,
        collectionAction: {
            type: "UpdateColor",
            color: "red",
        },
    } satisfies TaskAction;

    expect(getCollectionEntryIfExists(store, collection.id)).toEqual(null);

    store.applyUpdateEvent({
        type: "Update",
        originClientId: null,
        defaultAuthorizationStateVersion: clock.now(),
        actions: [],
        backfillTasks: [],
        backfillCollections: [{type: "Authorized", collection: collection}],
        referencedAccounts: [],
    });

    expect(getCollectionEntryIfExists(store, collection.id)).toEqual({
        collection,
        actions: null,
        optimisticState: null,
        authorizationState: expect.objectContaining({value: "Authorized"}),
    });

    store.commitTaskActionTransaction(context, [action2], {
        undoManager: null,
        affinityManager: noopAffinityManager,
    });

    expect(getCollectionEntryIfExists(store, collection.id)).toEqual({
        collection: collection.applyAction(action2),
        actions: null,
        optimisticState: {
            original: {
                collection,
                actions: null,
            },
            actions: [{isOptimistic: true, action: action2}],
        },
        authorizationState: expect.objectContaining({value: "Authorized"}),
    });

    store.applyUpdateEvent({
        type: "Update",
        originClientId: null,
        defaultAuthorizationStateVersion: clock.now(),
        actions: [],
        backfillTasks: [],
        backfillCollections: [{type: "Authorized", collection: collection.applyAction(action3)}],
        referencedAccounts: [],
    });

    expect(getCollectionEntryIfExists(store, collection.id)).toEqual({
        collection: collection.applyAction(action2).applyAction(action3),
        actions: null,
        optimisticState: {
            original: {
                collection: collection.applyAction(action3),
                actions: null,
            },
            actions: [{isOptimistic: true, action: action2}],
        },
        authorizationState: expect.objectContaining({value: "Authorized"}),
    });

    await resolveLastRpcExecution(commitTaskActionTransaction, {
        extraActions: [],
        referencedAccounts: [],
    });

    expect(getCollectionEntryIfExists(store, collection.id)).toEqual({
        collection: collection.applyAction(action2).applyAction(action3),
        actions: null,
        optimisticState: null,
        authorizationState: expect.objectContaining({value: "Authorized"}),
    });
});

test("backfilling a collection when there are optimistic actions but no previously backfilled collection works", async () => {
    const store = createAutoRetainStore();

    const action1 = {
        type: "UpdateCollection",
        time: store.clock.now(),
        collectionId: generateId(),
        collectionAction: {
            type: "Create",
            creatorId: null,
            name: "Test",
            accessPolicy: {
                accountGrantById: new Map([[account1.id, {level: "Manage", generation: 0}]]),
                defaultGrant: null,
                urlGrant: null,
            },
        },
    } satisfies TaskAction;

    const collection = createCollection(store, {
        id: action1.collectionId,
        time: action1.time,
        collectionAction: action1.collectionAction,
    });

    const action2 = {
        type: "UpdateCollection",
        time: store.clock.now(),
        collectionId: collection.id,
        collectionAction: {
            type: "UpdateName",
            name: "Test 2",
        },
    } satisfies TaskAction;

    const action3 = {
        type: "UpdateCollection",
        time: store.clock.now(),
        collectionId: collection.id,
        collectionAction: {
            type: "UpdateColor",
            color: "red",
        },
    } satisfies TaskAction;

    const action4 = {
        type: "UpdateCollection",
        time: store.clock.now(),
        collectionId: collection.id,
        collectionAction: {
            type: "UpdateName",
            name: "Test 3",
        },
    } satisfies TaskAction;

    expect(getCollectionEntryIfExists(store, collection.id)).toEqual(null);

    store.applyUpdateEvent({
        type: "Update",
        originClientId: null,
        defaultAuthorizationStateVersion: clock.now(),
        actions: [action3],
        backfillTasks: [],
        backfillCollections: [],
        referencedAccounts: [],
    });

    expect(getCollectionEntryIfExists(store, collection.id)).toEqual({
        collection: null,
        actions: [action3],
        optimisticState: null,
        authorizationState: null,
    });

    store.commitTaskActionTransaction(context, [action1], {
        undoManager: null,
        affinityManager: noopAffinityManager,
    });

    expect(getCollectionEntryIfExists(store, collection.id)).toEqual({
        collection: collection.applyAction(action3),
        actions: null,
        optimisticState: {
            original: {
                collection: null,
                actions: [action3],
            },
            actions: [{isOptimistic: true, action: action1}],
        },
        authorizationState: expect.objectContaining({
            value: "Authorized",
            version: zeroHybridLogicalTime,
        }),
    });

    store.commitTaskActionTransaction(context, [action2], {
        undoManager: null,
        affinityManager: noopAffinityManager,
    });

    expect(getCollectionEntryIfExists(store, collection.id)).toEqual({
        collection: collection.applyAction(action3).applyAction(action2),
        actions: null,
        optimisticState: {
            original: {
                collection: null,
                actions: [action3],
            },
            actions: [
                {isOptimistic: true, action: action1},
                {isOptimistic: true, action: action2},
            ],
        },
        authorizationState: expect.objectContaining({
            value: "Authorized",
            version: zeroHybridLogicalTime,
        }),
    });

    store.applyUpdateEvent({
        type: "Update",
        originClientId: null,
        defaultAuthorizationStateVersion: clock.now(),
        actions: [],
        backfillTasks: [],
        backfillCollections: [{type: "Authorized", collection: collection.applyAction(action4)}],
        referencedAccounts: [],
    });

    expect(getCollectionEntryIfExists(store, collection.id)).toEqual({
        collection: collection.applyAction(action4).applyAction(action3).applyAction(action2),
        actions: null,
        optimisticState: {
            original: {
                collection: collection.applyAction(action4).applyAction(action3),
                actions: null,
            },
            actions: [
                {isOptimistic: true, action: action1},
                {isOptimistic: true, action: action2},
            ],
        },
        authorizationState: expect.objectContaining({value: "Authorized"}),
    });

    await resolveRpcExecution(commitTaskActionTransaction, 0, {
        extraActions: [],
        referencedAccounts: [],
    });

    expect(getCollectionEntryIfExists(store, collection.id)).toEqual({
        collection: collection.applyAction(action4).applyAction(action3).applyAction(action2),
        actions: null,
        optimisticState: {
            original: {
                collection: collection
                    .applyAction(action4)
                    .applyAction(action3)
                    .applyAction(action1),
                actions: null,
            },
            actions: [{isOptimistic: true, action: action2}],
        },
        authorizationState: expect.objectContaining({value: "Authorized"}),
    });

    await resolveRpcExecution(commitTaskActionTransaction, 1, {
        extraActions: [],
        referencedAccounts: [],
    });

    expect(getCollectionEntryIfExists(store, collection.id)).toEqual({
        collection: collection.applyAction(action4).applyAction(action3).applyAction(action2),
        actions: null,
        optimisticState: null,
        authorizationState: expect.objectContaining({value: "Authorized"}),
    });
});

test("applies collection commit action calls optimistically (rejected)", async () => {
    const store = createAutoRetainStore();

    const collection = createCollection(store);

    expect(getCollectionEntryIfExists(store, collection.id)).toEqual(null);

    store.applyUpdateEvent({
        type: "Update",
        originClientId: null,
        defaultAuthorizationStateVersion: clock.now(),
        actions: [],
        backfillTasks: [],
        backfillCollections: [{type: "Authorized", collection: collection}],
        referencedAccounts: [],
    });

    expect(getCollectionEntryIfExists(store, collection.id)).toEqual({
        collection,
        actions: null,
        optimisticState: null,
        authorizationState: expect.objectContaining({value: "Authorized"}),
    });

    const action = {
        type: "UpdateCollection",
        time: store.clock.now(),
        collectionId: collection.id,
        collectionAction: {
            type: "UpdateName",
            name: "Test 2",
        },
    } satisfies TaskAction;

    store.commitTaskActionTransaction(context, [action], {
        undoManager: null,
        affinityManager: noopAffinityManager,
    });

    expect(getCollectionEntryIfExists(store, collection.id)).toEqual({
        collection: collection.applyAction(action),
        actions: null,
        optimisticState: {
            original: {
                collection,
                actions: null,
            },
            actions: [{isOptimistic: true, action}],
        },
        authorizationState: expect.objectContaining({value: "Authorized"}),
    });

    await rejectLastRpcExecution(commitTaskActionTransaction);

    expect(getCollectionEntryIfExists(store, collection.id)).toEqual({
        collection,
        actions: null,
        optimisticState: null,
        authorizationState: expect.objectContaining({value: "Authorized"}),
    });

    expect(errors.length).toEqual(1);
    errors = [];
});

test("can create collections optimistically (rejected)", async () => {
    const store = createAutoRetainStore();

    const action1 = {
        type: "UpdateCollection",
        time: store.clock.now(),
        collectionId: generateId(),
        collectionAction: {
            type: "Create",
            creatorId: null,
            name: "Test",
            accessPolicy: {
                accountGrantById: new Map([[account1.id, {level: "Manage", generation: 0}]]),
                defaultGrant: null,
                urlGrant: null,
            },
        },
    } satisfies TaskAction;

    expect(getCollectionEntryIfExists(store, action1.collectionId)).toEqual(null);

    store.commitTaskActionTransaction(context, [action1], {
        undoManager: null,
        affinityManager: noopAffinityManager,
    });

    expect(getCollectionEntryIfExists(store, action1.collectionId)).toEqual({
        collection: createCollection(store, {
            id: action1.collectionId,
            time: action1.time,
            collectionAction: action1.collectionAction,
        }),
        actions: null,
        optimisticState: {
            original: {
                collection: null,
                actions: [],
            },
            actions: [{isOptimistic: true, action: action1}],
        },
        authorizationState: expect.objectContaining({
            value: "Authorized",
            version: zeroHybridLogicalTime,
        }),
    });

    await rejectLastRpcExecution(commitTaskActionTransaction);

    expect(getCollectionEntryIfExists(store, action1.collectionId)).toEqual({
        collection: null,
        actions: [],
        optimisticState: null,
        authorizationState: expect.objectContaining({
            value: "Authorized",
            version: zeroHybridLogicalTime,
        }),
    });

    expect(errors.length).toEqual(1);
    errors = [];
});

test("can create then update collections optimistically (rejected)", async () => {
    const store = createAutoRetainStore();

    const action1 = {
        type: "UpdateCollection",
        time: store.clock.now(),
        collectionId: generateId(),
        collectionAction: {
            type: "Create",
            creatorId: null,
            name: "Test",
            accessPolicy: {
                accountGrantById: new Map([[account1.id, {level: "Manage", generation: 0}]]),
                defaultGrant: null,
                urlGrant: null,
            },
        },
    } satisfies TaskAction;

    const action2 = {
        type: "UpdateCollection",
        time: store.clock.now(),
        collectionId: action1.collectionId,
        collectionAction: {
            type: "UpdateName",
            name: "Test 2",
        },
    } satisfies TaskAction;

    expect(getCollectionEntryIfExists(store, action1.collectionId)).toEqual(null);

    store.commitTaskActionTransaction(context, [action1], {
        undoManager: null,
        affinityManager: noopAffinityManager,
    });

    expect(getCollectionEntryIfExists(store, action1.collectionId)).toEqual({
        collection: createCollection(store, {
            id: action1.collectionId,
            time: action1.time,
            collectionAction: action1.collectionAction,
        }),
        actions: null,
        optimisticState: {
            original: {
                collection: null,
                actions: [],
            },
            actions: [{isOptimistic: true, action: action1}],
        },
        authorizationState: expect.objectContaining({
            value: "Authorized",
            version: zeroHybridLogicalTime,
        }),
    });

    store.commitTaskActionTransaction(context, [action2], {
        undoManager: null,
        affinityManager: noopAffinityManager,
    });

    expect(getCollectionEntryIfExists(store, action1.collectionId)).toEqual({
        collection: createCollection(store, {
            id: action1.collectionId,
            time: action1.time,
            collectionAction: action1.collectionAction,
        }).applyAction(action2),
        actions: null,
        optimisticState: {
            original: {
                collection: null,
                actions: [],
            },
            actions: [
                {isOptimistic: true, action: action1},
                {isOptimistic: true, action: action2},
            ],
        },
        authorizationState: expect.objectContaining({
            value: "Authorized",
            version: zeroHybridLogicalTime,
        }),
    });

    await rejectRpcExecution(commitTaskActionTransaction, 0);

    expect(getCollectionEntryIfExists(store, action1.collectionId)).toEqual({
        collection: null,
        actions: [action2],
        optimisticState: {
            original: {
                collection: null,
                actions: [],
            },
            actions: [{isOptimistic: true, action: action2}],
        },
        authorizationState: expect.objectContaining({
            value: "Authorized",
            version: zeroHybridLogicalTime,
        }),
    });

    await rejectRpcExecution(commitTaskActionTransaction, 1);

    expect(getCollectionEntryIfExists(store, action1.collectionId)).toEqual({
        collection: null,
        actions: [],
        optimisticState: null,
        authorizationState: expect.objectContaining({
            value: "Authorized",
            version: zeroHybridLogicalTime,
        }),
    });

    expect(errors.length).toEqual(2);
    errors = [];
});

test("can create then update collections optimistically and resolve commits out of order (rejected)", async () => {
    const store = createAutoRetainStore();

    const action1 = {
        type: "UpdateCollection",
        time: store.clock.now(),
        collectionId: generateId(),
        collectionAction: {
            type: "Create",
            creatorId: null,
            name: "Test",
            accessPolicy: {
                accountGrantById: new Map([[account1.id, {level: "Manage", generation: 0}]]),
                defaultGrant: null,
                urlGrant: null,
            },
        },
    } satisfies TaskAction;

    const action2 = {
        type: "UpdateCollection",
        time: store.clock.now(),
        collectionId: action1.collectionId,
        collectionAction: {
            type: "UpdateName",
            name: "Test 2",
        },
    } satisfies TaskAction;

    expect(getCollectionEntryIfExists(store, action1.collectionId)).toEqual(null);

    store.commitTaskActionTransaction(context, [action1], {
        undoManager: null,
        affinityManager: noopAffinityManager,
    });

    expect(getCollectionEntryIfExists(store, action1.collectionId)).toEqual({
        collection: createCollection(store, {
            id: action1.collectionId,
            time: action1.time,
            collectionAction: action1.collectionAction,
        }),
        actions: null,
        optimisticState: {
            original: {
                collection: null,
                actions: [],
            },
            actions: [{isOptimistic: true, action: action1}],
        },
        authorizationState: expect.objectContaining({
            value: "Authorized",
            version: zeroHybridLogicalTime,
        }),
    });

    store.commitTaskActionTransaction(context, [action2], {
        undoManager: null,
        affinityManager: noopAffinityManager,
    });

    expect(getCollectionEntryIfExists(store, action1.collectionId)).toEqual({
        collection: createCollection(store, {
            id: action1.collectionId,
            time: action1.time,
            collectionAction: action1.collectionAction,
        }).applyAction(action2),
        actions: null,
        optimisticState: {
            original: {
                collection: null,
                actions: [],
            },
            actions: [
                {isOptimistic: true, action: action1},
                {isOptimistic: true, action: action2},
            ],
        },
        authorizationState: expect.objectContaining({
            value: "Authorized",
            version: zeroHybridLogicalTime,
        }),
    });

    await rejectRpcExecution(commitTaskActionTransaction, 1);

    expect(getCollectionEntryIfExists(store, action1.collectionId)).toEqual({
        collection: createCollection(store, {
            id: action1.collectionId,
            time: action1.time,
            collectionAction: action1.collectionAction,
        }),
        actions: null,
        optimisticState: {
            original: {
                collection: null,
                actions: [],
            },
            actions: [{isOptimistic: true, action: action1}],
        },
        authorizationState: expect.objectContaining({
            value: "Authorized",
            version: zeroHybridLogicalTime,
        }),
    });

    await rejectRpcExecution(commitTaskActionTransaction, 0);

    expect(getCollectionEntryIfExists(store, action1.collectionId)).toEqual({
        collection: null,
        actions: [],
        optimisticState: null,
        authorizationState: expect.objectContaining({
            value: "Authorized",
            version: zeroHybridLogicalTime,
        }),
    });

    expect(errors.length).toEqual(2);
    errors = [];
});

test("can create then update collections optimistically after an action from the server (rejected)", async () => {
    const store = createAutoRetainStore();

    const action2Time = store.clock.now();

    const action1 = {
        type: "UpdateCollection",
        time: store.clock.now(),
        collectionId: generateId(),
        collectionAction: {
            type: "UpdateColor",
            color: "red",
        },
    } satisfies TaskAction;

    const action2 = {
        type: "UpdateCollection",
        time: action2Time,
        collectionId: action1.collectionId,
        collectionAction: {
            type: "Create",
            creatorId: null,
            name: "Test",
            accessPolicy: {
                accountGrantById: new Map([[account1.id, {level: "Manage", generation: 0}]]),
                defaultGrant: null,
                urlGrant: null,
            },
        },
    } satisfies TaskAction;

    const action3 = {
        type: "UpdateCollection",
        time: store.clock.now(),
        collectionId: action2.collectionId,
        collectionAction: {
            type: "UpdateName",
            name: "Test 2",
        },
    } satisfies TaskAction;

    expect(getCollectionEntryIfExists(store, action2.collectionId)).toEqual(null);

    store.applyUpdateEvent({
        type: "Update",
        originClientId: null,
        defaultAuthorizationStateVersion: clock.now(),
        actions: [action1],
        backfillTasks: [],
        backfillCollections: [],
        referencedAccounts: [],
    });

    expect(getCollectionEntryIfExists(store, action2.collectionId)).toEqual({
        collection: null,
        actions: [action1],
        optimisticState: null,
        authorizationState: null,
    });

    store.commitTaskActionTransaction(context, [action2], {
        undoManager: null,
        affinityManager: noopAffinityManager,
    });

    expect(getCollectionEntryIfExists(store, action2.collectionId)).toEqual({
        collection: createCollection(store, {
            id: action2.collectionId,
            time: action2.time,
            collectionAction: action2.collectionAction,
        }).applyAction(action1),
        actions: null,
        optimisticState: {
            original: {
                collection: null,
                actions: [action1],
            },
            actions: [{isOptimistic: true, action: action2}],
        },
        authorizationState: expect.objectContaining({
            value: "Authorized",
            version: zeroHybridLogicalTime,
        }),
    });

    store.commitTaskActionTransaction(context, [action3], {
        undoManager: null,
        affinityManager: noopAffinityManager,
    });

    expect(getCollectionEntryIfExists(store, action2.collectionId)).toEqual({
        collection: createCollection(store, {
            id: action2.collectionId,
            time: action2.time,
            collectionAction: action2.collectionAction,
        })
            .applyAction(action1)
            .applyAction(action3),
        actions: null,
        optimisticState: {
            original: {
                collection: null,
                actions: [action1],
            },
            actions: [
                {isOptimistic: true, action: action2},
                {isOptimistic: true, action: action3},
            ],
        },
        authorizationState: expect.objectContaining({
            value: "Authorized",
            version: zeroHybridLogicalTime,
        }),
    });

    await rejectRpcExecution(commitTaskActionTransaction, 0);

    expect(getCollectionEntryIfExists(store, action2.collectionId)).toEqual({
        collection: null,
        actions: [action1, action3],
        optimisticState: {
            original: {
                collection: null,
                actions: [action1],
            },
            actions: [{isOptimistic: true, action: action3}],
        },
        authorizationState: expect.objectContaining({
            value: "Authorized",
            version: zeroHybridLogicalTime,
        }),
    });

    await rejectRpcExecution(commitTaskActionTransaction, 1);

    expect(getCollectionEntryIfExists(store, action2.collectionId)).toEqual({
        collection: null,
        actions: [action1],
        optimisticState: null,
        authorizationState: expect.objectContaining({
            value: "Authorized",
            version: zeroHybridLogicalTime,
        }),
    });

    expect(errors.length).toEqual(2);
    errors = [];
});

test("can create then update collections optimistically our of order (rejected)", async () => {
    const store = createAutoRetainStore();

    const action1 = {
        type: "UpdateCollection",
        time: store.clock.now(),
        collectionId: generateId(),
        collectionAction: {
            type: "Create",
            creatorId: null,
            name: "Test",
            accessPolicy: {
                accountGrantById: new Map([[account1.id, {level: "Manage", generation: 0}]]),
                defaultGrant: null,
                urlGrant: null,
            },
        },
    } satisfies TaskAction;

    const action2 = {
        type: "UpdateCollection",
        time: store.clock.now(),
        collectionId: action1.collectionId,
        collectionAction: {
            type: "UpdateName",
            name: "Test 2",
        },
    } satisfies TaskAction;

    expect(getCollectionEntryIfExists(store, action1.collectionId)).toEqual(null);

    store.commitTaskActionTransaction(context, [action2], {
        undoManager: null,
        affinityManager: noopAffinityManager,
    });

    expect(getCollectionEntryIfExists(store, action1.collectionId)).toEqual({
        collection: null,
        actions: [action2],
        optimisticState: {
            original: {
                collection: null,
                actions: [],
            },
            actions: [{isOptimistic: true, action: action2}],
        },
        authorizationState: null,
    });

    store.commitTaskActionTransaction(context, [action1], {
        undoManager: null,
        affinityManager: noopAffinityManager,
    });

    expect(getCollectionEntryIfExists(store, action1.collectionId)).toEqual({
        collection: createCollection(store, {
            id: action1.collectionId,
            time: action1.time,
            collectionAction: action1.collectionAction,
        }).applyAction(action2),
        actions: null,
        optimisticState: {
            original: {
                collection: null,
                actions: [],
            },
            actions: [
                {isOptimistic: true, action: action2},
                {isOptimistic: true, action: action1},
            ],
        },
        authorizationState: expect.objectContaining({
            value: "Authorized",
            version: zeroHybridLogicalTime,
        }),
    });

    await rejectRpcExecution(commitTaskActionTransaction, 0);

    expect(getCollectionEntryIfExists(store, action1.collectionId)).toEqual({
        collection: createCollection(store, {
            id: action1.collectionId,
            time: action1.time,
            collectionAction: action1.collectionAction,
        }),
        actions: null,
        optimisticState: {
            original: {
                collection: null,
                actions: [],
            },
            actions: [{isOptimistic: true, action: action1}],
        },
        authorizationState: expect.objectContaining({
            value: "Authorized",
            version: zeroHybridLogicalTime,
        }),
    });

    await rejectRpcExecution(commitTaskActionTransaction, 1);

    expect(getCollectionEntryIfExists(store, action1.collectionId)).toEqual({
        collection: null,
        actions: [],
        optimisticState: null,
        authorizationState: expect.objectContaining({
            value: "Authorized",
            version: zeroHybridLogicalTime,
        }),
    });

    expect(errors.length).toEqual(2);
    errors = [];
});

test("can create then update collections optimistically out of order after an action from the server (rejected)", async () => {
    const store = createAutoRetainStore();

    const action2Time = store.clock.now();

    const action1 = {
        type: "UpdateCollection",
        time: store.clock.now(),
        collectionId: generateId(),
        collectionAction: {
            type: "UpdateColor",
            color: "red",
        },
    } satisfies TaskAction;

    const action2 = {
        type: "UpdateCollection",
        time: action2Time,
        collectionId: action1.collectionId,
        collectionAction: {
            type: "Create",
            creatorId: null,
            name: "Test",
            accessPolicy: {
                accountGrantById: new Map([[account1.id, {level: "Manage", generation: 0}]]),
                defaultGrant: null,
                urlGrant: null,
            },
        },
    } satisfies TaskAction;

    const action3 = {
        type: "UpdateCollection",
        time: store.clock.now(),
        collectionId: action2.collectionId,
        collectionAction: {
            type: "UpdateName",
            name: "Test 2",
        },
    } satisfies TaskAction;

    expect(getCollectionEntryIfExists(store, action2.collectionId)).toEqual(null);

    store.applyUpdateEvent({
        type: "Update",
        originClientId: null,
        defaultAuthorizationStateVersion: clock.now(),
        actions: [action1],
        backfillTasks: [],
        backfillCollections: [],
        referencedAccounts: [],
    });

    expect(getCollectionEntryIfExists(store, action2.collectionId)).toEqual({
        collection: null,
        actions: [action1],
        optimisticState: null,
        authorizationState: null,
    });

    store.commitTaskActionTransaction(context, [action3], {
        undoManager: null,
        affinityManager: noopAffinityManager,
    });

    expect(getCollectionEntryIfExists(store, action2.collectionId)).toEqual({
        collection: null,
        actions: [action1, action3],
        optimisticState: {
            original: {
                collection: null,
                actions: [action1],
            },
            actions: [{isOptimistic: true, action: action3}],
        },
        authorizationState: null,
    });

    store.commitTaskActionTransaction(context, [action2], {
        undoManager: null,
        affinityManager: noopAffinityManager,
    });

    expect(getCollectionEntryIfExists(store, action2.collectionId)).toEqual({
        collection: createCollection(store, {
            id: action2.collectionId,
            time: action2.time,
            collectionAction: action2.collectionAction,
        })
            .applyAction(action1)
            .applyAction(action3),
        actions: null,
        optimisticState: {
            original: {
                collection: null,
                actions: [action1],
            },
            actions: [
                {isOptimistic: true, action: action3},
                {isOptimistic: true, action: action2},
            ],
        },
        authorizationState: expect.objectContaining({
            value: "Authorized",
            version: zeroHybridLogicalTime,
        }),
    });

    await rejectRpcExecution(commitTaskActionTransaction, 0);

    expect(getCollectionEntryIfExists(store, action2.collectionId)).toEqual({
        collection: createCollection(store, {
            id: action2.collectionId,
            time: action2.time,
            collectionAction: action2.collectionAction,
        }).applyAction(action1),
        actions: null,
        optimisticState: {
            original: {
                collection: null,
                actions: [action1],
            },
            actions: [{isOptimistic: true, action: action2}],
        },
        authorizationState: expect.objectContaining({
            value: "Authorized",
            version: zeroHybridLogicalTime,
        }),
    });

    await rejectRpcExecution(commitTaskActionTransaction, 1);

    expect(getCollectionEntryIfExists(store, action2.collectionId)).toEqual({
        collection: null,
        actions: [action1],
        optimisticState: null,
        authorizationState: expect.objectContaining({
            value: "Authorized",
            version: zeroHybridLogicalTime,
        }),
    });

    expect(errors.length).toEqual(2);
    errors = [];
});

test("can create then update collections optimistically out of order with more non-create collections (rejected)", async () => {
    const store = createAutoRetainStore();

    const action2Time = store.clock.now();

    const action1 = {
        type: "UpdateCollection",
        time: store.clock.now(),
        collectionId: generateId(),
        collectionAction: {
            type: "UpdateColor",
            color: "red",
        },
    } satisfies TaskAction;

    const action2 = {
        type: "UpdateCollection",
        time: action2Time,
        collectionId: action1.collectionId,
        collectionAction: {
            type: "Create",
            creatorId: null,
            name: "Test",
            accessPolicy: {
                accountGrantById: new Map([[account1.id, {level: "Manage", generation: 0}]]),
                defaultGrant: null,
                urlGrant: null,
            },
        },
    } satisfies TaskAction;

    const action3 = {
        type: "UpdateCollection",
        time: store.clock.now(),
        collectionId: action2.collectionId,
        collectionAction: {
            type: "UpdateName",
            name: "Test 2",
        },
    } satisfies TaskAction;

    expect(getCollectionEntryIfExists(store, action2.collectionId)).toEqual(null);

    store.commitTaskActionTransaction(context, [action1], {
        undoManager: null,
        affinityManager: noopAffinityManager,
    });

    expect(getCollectionEntryIfExists(store, action2.collectionId)).toEqual({
        collection: null,
        actions: [action1],
        optimisticState: {
            original: {
                collection: null,
                actions: [],
            },
            actions: [{isOptimistic: true, action: action1}],
        },
        authorizationState: null,
    });

    store.commitTaskActionTransaction(context, [action3], {
        undoManager: null,
        affinityManager: noopAffinityManager,
    });

    expect(getCollectionEntryIfExists(store, action2.collectionId)).toEqual({
        collection: null,
        actions: [action1, action3],
        optimisticState: {
            original: {
                collection: null,
                actions: [],
            },
            actions: [
                {isOptimistic: true, action: action1},
                {isOptimistic: true, action: action3},
            ],
        },
        authorizationState: null,
    });

    store.commitTaskActionTransaction(context, [action2], {
        undoManager: null,
        affinityManager: noopAffinityManager,
    });

    expect(getCollectionEntryIfExists(store, action2.collectionId)).toEqual({
        collection: createCollection(store, {
            id: action2.collectionId,
            time: action2.time,
            collectionAction: action2.collectionAction,
        })
            .applyAction(action1)
            .applyAction(action3),
        actions: null,
        optimisticState: {
            original: {
                collection: null,
                actions: [],
            },
            actions: [
                {isOptimistic: true, action: action1},
                {isOptimistic: true, action: action3},
                {isOptimistic: true, action: action2},
            ],
        },
        authorizationState: expect.objectContaining({
            value: "Authorized",
            version: zeroHybridLogicalTime,
        }),
    });

    await rejectRpcExecution(commitTaskActionTransaction, 0);

    expect(getCollectionEntryIfExists(store, action2.collectionId)).toEqual({
        collection: createCollection(store, {
            id: action2.collectionId,
            time: action2.time,
            collectionAction: action2.collectionAction,
        }).applyAction(action3),
        actions: null,
        optimisticState: {
            original: {
                collection: null,
                actions: [],
            },
            actions: [
                {isOptimistic: true, action: action3},
                {isOptimistic: true, action: action2},
            ],
        },
        authorizationState: expect.objectContaining({
            value: "Authorized",
            version: zeroHybridLogicalTime,
        }),
    });

    await rejectRpcExecution(commitTaskActionTransaction, 1);

    expect(getCollectionEntryIfExists(store, action2.collectionId)).toEqual({
        collection: createCollection(store, {
            id: action2.collectionId,
            time: action2.time,
            collectionAction: action2.collectionAction,
        }),
        actions: null,
        optimisticState: {
            original: {
                collection: null,
                actions: [],
            },
            actions: [{isOptimistic: true, action: action2}],
        },
        authorizationState: expect.objectContaining({
            value: "Authorized",
            version: zeroHybridLogicalTime,
        }),
    });

    await rejectRpcExecution(commitTaskActionTransaction, 2);

    expect(getCollectionEntryIfExists(store, action2.collectionId)).toEqual({
        collection: null,
        actions: [],
        optimisticState: null,
        authorizationState: expect.objectContaining({
            value: "Authorized",
            version: zeroHybridLogicalTime,
        }),
    });

    expect(errors.length).toEqual(3);
    errors = [];
});

test("resolving collection optimistic update after garbage collection is ok (rejected)", async () => {
    const store = createAutoRetainStore();

    const action1 = {
        type: "UpdateCollection",
        time: store.clock.now(),
        collectionId: generateId(),
        collectionAction: {
            type: "Create",
            creatorId: null,
            name: "Test",
            accessPolicy: {
                accountGrantById: new Map([[account1.id, {level: "Manage", generation: 0}]]),
                defaultGrant: null,
                urlGrant: null,
            },
        },
    } satisfies TaskAction;

    const action2 = {
        type: "UpdateCollection",
        time: store.clock.now(),
        collectionId: action1.collectionId,
        collectionAction: {
            type: "UpdateName",
            name: "Test 2",
        },
    } satisfies TaskAction;

    expect(getCollectionEntryIfExists(store, action1.collectionId)).toEqual(null);

    store.commitTaskActionTransaction(context, [action1], {
        undoManager: null,
        affinityManager: noopAffinityManager,
    });

    expect(getCollectionEntryIfExists(store, action1.collectionId)).toEqual({
        collection: createCollection(store, {
            id: action1.collectionId,
            time: action1.time,
            collectionAction: action1.collectionAction,
        }),
        actions: null,
        optimisticState: {
            original: {
                collection: null,
                actions: [],
            },
            actions: [{isOptimistic: true, action: action1}],
        },
        authorizationState: expect.objectContaining({
            value: "Authorized",
            version: zeroHybridLogicalTime,
        }),
    });

    store.commitTaskActionTransaction(context, [action2], {
        undoManager: null,
        affinityManager: noopAffinityManager,
    });

    expect(getCollectionEntryIfExists(store, action1.collectionId)).toEqual({
        collection: createCollection(store, {
            id: action1.collectionId,
            time: action1.time,
            collectionAction: action1.collectionAction,
        }).applyAction(action2),
        actions: null,
        optimisticState: {
            original: {
                collection: null,
                actions: [],
            },
            actions: [
                {isOptimistic: true, action: action1},
                {isOptimistic: true, action: action2},
            ],
        },
        authorizationState: expect.objectContaining({
            value: "Authorized",
            version: zeroHybridLogicalTime,
        }),
    });

    await resolveRpcExecution(commitTaskActionTransaction, 0, {
        extraActions: [],
        referencedAccounts: [],
    });

    expect(getCollectionEntryIfExists(store, action1.collectionId)).toEqual({
        collection: createCollection(store, {
            id: action1.collectionId,
            time: action1.time,
            collectionAction: action1.collectionAction,
        }).applyAction(action2),
        actions: null,
        optimisticState: {
            original: {
                collection: createCollection(store, {
                    id: action1.collectionId,
                    time: action1.time,
                    collectionAction: action1.collectionAction,
                }),
                actions: null,
            },
            actions: [{isOptimistic: true, action: action2}],
        },
        authorizationState: expect.objectContaining({
            value: "Authorized",
            version: zeroHybridLogicalTime,
        }),
    });

    const previousCollectionSubscriptions = collectionSubscriptions;
    collectionSubscriptions = [];
    for (const subscription of previousCollectionSubscriptions) {
        subscription.release();
    }

    expect(getCollectionEntryIfExists(store, action1.collectionId)).toEqual(null);

    await rejectRpcExecution(commitTaskActionTransaction, 1);

    expect(getCollectionEntryIfExists(store, action1.collectionId)).toEqual(null);

    expect(errors.length).toEqual(1);
    errors = [];
});

test("regular collection actions are added to optimistic state (rejected)", async () => {
    const store = createAutoRetainStore();

    const collection = createCollection(store);

    const action2 = {
        type: "UpdateCollection",
        time: store.clock.now(),
        collectionId: collection.id,
        collectionAction: {
            type: "UpdateName",
            name: "Test 2",
        },
    } satisfies TaskAction;

    const action3 = {
        type: "UpdateCollection",
        time: store.clock.now(),
        collectionId: collection.id,
        collectionAction: {
            type: "UpdateColor",
            color: "red",
        },
    } satisfies TaskAction;

    expect(getCollectionEntryIfExists(store, collection.id)).toEqual(null);

    store.applyUpdateEvent({
        type: "Update",
        originClientId: null,
        defaultAuthorizationStateVersion: clock.now(),
        actions: [],
        backfillTasks: [],
        backfillCollections: [{type: "Authorized", collection: collection}],
        referencedAccounts: [],
    });

    expect(getCollectionEntryIfExists(store, collection.id)).toEqual({
        collection,
        actions: null,
        optimisticState: null,
        authorizationState: expect.objectContaining({value: "Authorized"}),
    });

    store.commitTaskActionTransaction(context, [action2], {
        undoManager: null,
        affinityManager: noopAffinityManager,
    });

    expect(getCollectionEntryIfExists(store, collection.id)).toEqual({
        collection: collection.applyAction(action2),
        actions: null,
        optimisticState: {
            original: {
                collection: collection,
                actions: null,
            },
            actions: [{isOptimistic: true, action: action2}],
        },
        authorizationState: expect.objectContaining({value: "Authorized"}),
    });

    store.applyUpdateEvent({
        type: "Update",
        originClientId: null,
        defaultAuthorizationStateVersion: clock.now(),
        actions: [action3],
        backfillTasks: [],
        backfillCollections: [],
        referencedAccounts: [],
    });

    expect(getCollectionEntryIfExists(store, collection.id)).toEqual({
        collection: collection.applyAction(action2).applyAction(action3),
        actions: null,
        optimisticState: {
            original: {
                collection: collection,
                actions: null,
            },
            actions: [
                {isOptimistic: true, action: action2},
                {isOptimistic: false, action: action3},
            ],
        },
        authorizationState: expect.objectContaining({value: "Authorized"}),
    });

    await rejectRpcExecution(commitTaskActionTransaction, 0);

    expect(getCollectionEntryIfExists(store, collection.id)).toEqual({
        collection: collection.applyAction(action3),
        actions: null,
        optimisticState: null,
        authorizationState: expect.objectContaining({value: "Authorized"}),
    });

    expect(errors.length).toEqual(1);
    errors = [];
});

test("regular collection actions are added to optimistic state with multiple actions (rejected)", async () => {
    const store = createAutoRetainStore();

    const collection = createCollection(store);

    const action2 = {
        type: "UpdateCollection",
        time: store.clock.now(),
        collectionId: collection.id,
        collectionAction: {
            type: "UpdateName",
            name: "Test 2",
        },
    } satisfies TaskAction;

    const action3 = {
        type: "UpdateCollection",
        time: store.clock.now(),
        collectionId: collection.id,
        collectionAction: {
            type: "UpdateColor",
            color: "red",
        },
    } satisfies TaskAction;

    const action4 = {
        type: "UpdateCollection",
        time: store.clock.now(),
        collectionId: collection.id,
        collectionAction: {
            type: "UpdateName",
            name: "Test 3",
        },
    } satisfies TaskAction;

    expect(getCollectionEntryIfExists(store, collection.id)).toEqual(null);

    store.applyUpdateEvent({
        type: "Update",
        originClientId: null,
        defaultAuthorizationStateVersion: clock.now(),
        actions: [],
        backfillTasks: [],
        backfillCollections: [{type: "Authorized", collection: collection}],
        referencedAccounts: [],
    });

    expect(getCollectionEntryIfExists(store, collection.id)).toEqual({
        collection,
        actions: null,
        optimisticState: null,
        authorizationState: expect.objectContaining({value: "Authorized"}),
    });

    store.commitTaskActionTransaction(context, [action2], {
        undoManager: null,
        affinityManager: noopAffinityManager,
    });

    expect(getCollectionEntryIfExists(store, collection.id)).toEqual({
        collection: collection.applyAction(action2),
        actions: null,
        optimisticState: {
            original: {
                collection: collection,
                actions: null,
            },
            actions: [{isOptimistic: true, action: action2}],
        },
        authorizationState: expect.objectContaining({value: "Authorized"}),
    });

    store.applyUpdateEvent({
        type: "Update",
        originClientId: null,
        defaultAuthorizationStateVersion: clock.now(),
        actions: [action3],
        backfillTasks: [],
        backfillCollections: [],
        referencedAccounts: [],
    });

    expect(getCollectionEntryIfExists(store, collection.id)).toEqual({
        collection: collection.applyAction(action2).applyAction(action3),
        actions: null,
        optimisticState: {
            original: {
                collection: collection,
                actions: null,
            },
            actions: [
                {isOptimistic: true, action: action2},
                {isOptimistic: false, action: action3},
            ],
        },
        authorizationState: expect.objectContaining({value: "Authorized"}),
    });

    store.commitTaskActionTransaction(context, [action4], {
        undoManager: null,
        affinityManager: noopAffinityManager,
    });

    expect(getCollectionEntryIfExists(store, collection.id)).toEqual({
        collection: collection.applyAction(action2).applyAction(action3).applyAction(action4),
        actions: null,
        optimisticState: {
            original: {
                collection: collection,
                actions: null,
            },
            actions: [
                {isOptimistic: true, action: action2},
                {isOptimistic: false, action: action3},
                {isOptimistic: true, action: action4},
            ],
        },
        authorizationState: expect.objectContaining({value: "Authorized"}),
    });

    await rejectRpcExecution(commitTaskActionTransaction, 0);

    expect(getCollectionEntryIfExists(store, collection.id)).toEqual({
        collection: collection.applyAction(action3).applyAction(action4),
        actions: null,
        optimisticState: {
            original: {
                collection: collection.applyAction(action3),
                actions: null,
            },
            actions: [{isOptimistic: true, action: action4}],
        },
        authorizationState: expect.objectContaining({value: "Authorized"}),
    });

    await rejectRpcExecution(commitTaskActionTransaction, 1);

    expect(getCollectionEntryIfExists(store, collection.id)).toEqual({
        collection: collection.applyAction(action3),
        actions: null,
        optimisticState: null,
        authorizationState: expect.objectContaining({value: "Authorized"}),
    });

    expect(errors.length).toEqual(2);
    errors = [];
});

test("regular collection actions are added to optimistic state with multiple actions that are committed out of order (rejected)", async () => {
    const store = createAutoRetainStore();

    const collection = createCollection(store);

    const action2 = {
        type: "UpdateCollection",
        time: store.clock.now(),
        collectionId: collection.id,
        collectionAction: {
            type: "UpdateName",
            name: "Test 2",
        },
    } satisfies TaskAction;

    const action3 = {
        type: "UpdateCollection",
        time: store.clock.now(),
        collectionId: collection.id,
        collectionAction: {
            type: "UpdateColor",
            color: "red",
        },
    } satisfies TaskAction;

    const action4 = {
        type: "UpdateCollection",
        time: store.clock.now(),
        collectionId: collection.id,
        collectionAction: {
            type: "UpdateName",
            name: "Test 3",
        },
    } satisfies TaskAction;

    expect(getCollectionEntryIfExists(store, collection.id)).toEqual(null);

    store.applyUpdateEvent({
        type: "Update",
        originClientId: null,
        defaultAuthorizationStateVersion: clock.now(),
        actions: [],
        backfillTasks: [],
        backfillCollections: [{type: "Authorized", collection: collection}],
        referencedAccounts: [],
    });

    expect(getCollectionEntryIfExists(store, collection.id)).toEqual({
        collection,
        actions: null,
        optimisticState: null,
        authorizationState: expect.objectContaining({value: "Authorized"}),
    });

    store.commitTaskActionTransaction(context, [action2], {
        undoManager: null,
        affinityManager: noopAffinityManager,
    });

    expect(getCollectionEntryIfExists(store, collection.id)).toEqual({
        collection: collection.applyAction(action2),
        actions: null,
        optimisticState: {
            original: {
                collection: collection,
                actions: null,
            },
            actions: [{isOptimistic: true, action: action2}],
        },
        authorizationState: expect.objectContaining({value: "Authorized"}),
    });

    store.applyUpdateEvent({
        type: "Update",
        originClientId: null,
        defaultAuthorizationStateVersion: clock.now(),
        actions: [action3],
        backfillTasks: [],
        backfillCollections: [],
        referencedAccounts: [],
    });

    expect(getCollectionEntryIfExists(store, collection.id)).toEqual({
        collection: collection.applyAction(action2).applyAction(action3),
        actions: null,
        optimisticState: {
            original: {
                collection: collection,
                actions: null,
            },
            actions: [
                {isOptimistic: true, action: action2},
                {isOptimistic: false, action: action3},
            ],
        },
        authorizationState: expect.objectContaining({value: "Authorized"}),
    });

    store.commitTaskActionTransaction(context, [action4], {
        undoManager: null,
        affinityManager: noopAffinityManager,
    });

    expect(getCollectionEntryIfExists(store, collection.id)).toEqual({
        collection: collection.applyAction(action2).applyAction(action3).applyAction(action4),
        actions: null,
        optimisticState: {
            original: {
                collection: collection,
                actions: null,
            },
            actions: [
                {isOptimistic: true, action: action2},
                {isOptimistic: false, action: action3},
                {isOptimistic: true, action: action4},
            ],
        },
        authorizationState: expect.objectContaining({value: "Authorized"}),
    });

    await rejectRpcExecution(commitTaskActionTransaction, 1);

    expect(getCollectionEntryIfExists(store, collection.id)).toEqual({
        collection: collection.applyAction(action2).applyAction(action3),
        actions: null,
        optimisticState: {
            original: {
                collection: collection,
                actions: null,
            },
            actions: [
                {isOptimistic: true, action: action2},
                {isOptimistic: false, action: action3},
            ],
        },
        authorizationState: expect.objectContaining({value: "Authorized"}),
    });

    await rejectRpcExecution(commitTaskActionTransaction, 0);

    expect(getCollectionEntryIfExists(store, collection.id)).toEqual({
        collection: collection.applyAction(action3),
        actions: null,
        optimisticState: null,
        authorizationState: expect.objectContaining({value: "Authorized"}),
    });

    expect(errors.length).toEqual(2);
    errors = [];
});

test("regular actions are added to optimistic state when collection is not backfilled (rejected)", async () => {
    const store = createAutoRetainStore();

    const collection = createCollection(store);

    const action2 = {
        type: "UpdateCollection",
        time: store.clock.now(),
        collectionId: collection.id,
        collectionAction: {
            type: "UpdateName",
            name: "Test 2",
        },
    } satisfies TaskAction;

    const action3 = {
        type: "UpdateCollection",
        time: store.clock.now(),
        collectionId: collection.id,
        collectionAction: {
            type: "UpdateColor",
            color: "red",
        },
    } satisfies TaskAction;

    expect(getCollectionEntryIfExists(store, collection.id)).toEqual(null);

    store.commitTaskActionTransaction(context, [action2], {
        undoManager: null,
        affinityManager: noopAffinityManager,
    });

    expect(getCollectionEntryIfExists(store, collection.id)).toEqual({
        collection: null,
        actions: [action2],
        optimisticState: {
            original: {
                collection: null,
                actions: [],
            },
            actions: [{isOptimistic: true, action: action2}],
        },
        authorizationState: null,
    });

    store.applyUpdateEvent({
        type: "Update",
        originClientId: null,
        defaultAuthorizationStateVersion: clock.now(),
        actions: [action3],
        backfillTasks: [],
        backfillCollections: [],
        referencedAccounts: [],
    });

    expect(getCollectionEntryIfExists(store, collection.id)).toEqual({
        collection: null,
        actions: [action2, action3],
        optimisticState: {
            original: {
                collection: null,
                actions: [],
            },
            actions: [
                {isOptimistic: true, action: action2},
                {isOptimistic: false, action: action3},
            ],
        },
        authorizationState: null,
    });

    await rejectRpcExecution(commitTaskActionTransaction, 0);

    expect(getCollectionEntryIfExists(store, collection.id)).toEqual({
        collection: null,
        actions: [action3],
        optimisticState: null,
        authorizationState: null,
    });

    expect(errors.length).toEqual(1);
    errors = [];
});

test("regular actions are added to optimistic state with multiple actions when collection is not backfilled (rejected)", async () => {
    const store = createAutoRetainStore();

    const collection = createCollection(store);

    const action2 = {
        type: "UpdateCollection",
        time: store.clock.now(),
        collectionId: collection.id,
        collectionAction: {
            type: "UpdateName",
            name: "Test 2",
        },
    } satisfies TaskAction;

    const action3 = {
        type: "UpdateCollection",
        time: store.clock.now(),
        collectionId: collection.id,
        collectionAction: {
            type: "UpdateColor",
            color: "red",
        },
    } satisfies TaskAction;

    const action4 = {
        type: "UpdateCollection",
        time: store.clock.now(),
        collectionId: collection.id,
        collectionAction: {
            type: "UpdateName",
            name: "Test 3",
        },
    } satisfies TaskAction;

    expect(getCollectionEntryIfExists(store, collection.id)).toEqual(null);

    store.commitTaskActionTransaction(context, [action2], {
        undoManager: null,
        affinityManager: noopAffinityManager,
    });

    expect(getCollectionEntryIfExists(store, collection.id)).toEqual({
        collection: null,
        actions: [action2],
        optimisticState: {
            original: {
                collection: null,
                actions: [],
            },
            actions: [{isOptimistic: true, action: action2}],
        },
        authorizationState: null,
    });

    store.applyUpdateEvent({
        type: "Update",
        originClientId: null,
        defaultAuthorizationStateVersion: clock.now(),
        actions: [action3],
        backfillTasks: [],
        backfillCollections: [],
        referencedAccounts: [],
    });

    expect(getCollectionEntryIfExists(store, collection.id)).toEqual({
        collection: null,
        actions: [action2, action3],
        optimisticState: {
            original: {
                collection: null,
                actions: [],
            },
            actions: [
                {isOptimistic: true, action: action2},
                {isOptimistic: false, action: action3},
            ],
        },
        authorizationState: null,
    });

    store.commitTaskActionTransaction(context, [action4], {
        undoManager: null,
        affinityManager: noopAffinityManager,
    });

    expect(getCollectionEntryIfExists(store, collection.id)).toEqual({
        collection: null,
        actions: [action2, action3, action4],
        optimisticState: {
            original: {
                collection: null,
                actions: [],
            },
            actions: [
                {isOptimistic: true, action: action2},
                {isOptimistic: false, action: action3},
                {isOptimistic: true, action: action4},
            ],
        },
        authorizationState: null,
    });

    await rejectRpcExecution(commitTaskActionTransaction, 0);

    expect(getCollectionEntryIfExists(store, collection.id)).toEqual({
        collection: null,
        actions: [action3, action4],
        optimisticState: {
            original: {
                collection: null,
                actions: [action3],
            },
            actions: [{isOptimistic: true, action: action4}],
        },
        authorizationState: null,
    });

    await rejectRpcExecution(commitTaskActionTransaction, 1);

    expect(getCollectionEntryIfExists(store, collection.id)).toEqual({
        collection: null,
        actions: [action3],
        optimisticState: null,
        authorizationState: null,
    });

    expect(errors.length).toEqual(2);
    errors = [];
});

test("regular actions are added to optimistic state with multiple actions that are committed out of order when collection is not backfilled (rejected)", async () => {
    const store = createAutoRetainStore();

    const collection = createCollection(store);

    const action2 = {
        type: "UpdateCollection",
        time: store.clock.now(),
        collectionId: collection.id,
        collectionAction: {
            type: "UpdateName",
            name: "Test 2",
        },
    } satisfies TaskAction;

    const action3 = {
        type: "UpdateCollection",
        time: store.clock.now(),
        collectionId: collection.id,
        collectionAction: {
            type: "UpdateColor",
            color: "red",
        },
    } satisfies TaskAction;

    const action4 = {
        type: "UpdateCollection",
        time: store.clock.now(),
        collectionId: collection.id,
        collectionAction: {
            type: "UpdateName",
            name: "Test 3",
        },
    } satisfies TaskAction;

    expect(getCollectionEntryIfExists(store, collection.id)).toEqual(null);

    store.commitTaskActionTransaction(context, [action2], {
        undoManager: null,
        affinityManager: noopAffinityManager,
    });

    expect(getCollectionEntryIfExists(store, collection.id)).toEqual({
        collection: null,
        actions: [action2],
        optimisticState: {
            original: {
                collection: null,
                actions: [],
            },
            actions: [{isOptimistic: true, action: action2}],
        },
        authorizationState: null,
    });

    store.applyUpdateEvent({
        type: "Update",
        originClientId: null,
        defaultAuthorizationStateVersion: clock.now(),
        actions: [action3],
        backfillTasks: [],
        backfillCollections: [],
        referencedAccounts: [],
    });

    expect(getCollectionEntryIfExists(store, collection.id)).toEqual({
        collection: null,
        actions: [action2, action3],
        optimisticState: {
            original: {
                collection: null,
                actions: [],
            },
            actions: [
                {isOptimistic: true, action: action2},
                {isOptimistic: false, action: action3},
            ],
        },
        authorizationState: null,
    });

    store.commitTaskActionTransaction(context, [action4], {
        undoManager: null,
        affinityManager: noopAffinityManager,
    });

    expect(getCollectionEntryIfExists(store, collection.id)).toEqual({
        collection: null,
        actions: [action2, action3, action4],
        optimisticState: {
            original: {
                collection: null,
                actions: [],
            },
            actions: [
                {isOptimistic: true, action: action2},
                {isOptimistic: false, action: action3},
                {isOptimistic: true, action: action4},
            ],
        },
        authorizationState: null,
    });

    await rejectRpcExecution(commitTaskActionTransaction, 1);

    expect(getCollectionEntryIfExists(store, collection.id)).toEqual({
        collection: null,
        actions: [action2, action3],
        optimisticState: {
            original: {
                collection: null,
                actions: [],
            },
            actions: [
                {isOptimistic: true, action: action2},
                {isOptimistic: false, action: action3},
            ],
        },
        authorizationState: null,
    });

    await rejectRpcExecution(commitTaskActionTransaction, 0);

    expect(getCollectionEntryIfExists(store, collection.id)).toEqual({
        collection: null,
        actions: [action3],
        optimisticState: null,
        authorizationState: null,
    });

    expect(errors.length).toEqual(2);
    errors = [];
});

test("regular actions are added to optimistic state when collection is created optimistically (rejected)", async () => {
    const store = createAutoRetainStore();

    const action1 = {
        type: "UpdateCollection",
        time: store.clock.now(),
        collectionId: generateId(),
        collectionAction: {
            type: "Create",
            creatorId: null,
            name: "Test",
            accessPolicy: {
                accountGrantById: new Map([[account1.id, {level: "Manage", generation: 0}]]),
                defaultGrant: null,
                urlGrant: null,
            },
        },
    } satisfies TaskAction;

    const collection = createCollection(store, {
        id: action1.collectionId,
        time: action1.time,
        collectionAction: action1.collectionAction,
    });

    const action2 = {
        type: "UpdateCollection",
        time: store.clock.now(),
        collectionId: collection.id,
        collectionAction: {
            type: "UpdateName",
            name: "Test 2",
        },
    } satisfies TaskAction;

    const action3 = {
        type: "UpdateCollection",
        time: store.clock.now(),
        collectionId: collection.id,
        collectionAction: {
            type: "UpdateColor",
            color: "red",
        },
    } satisfies TaskAction;

    expect(getCollectionEntryIfExists(store, collection.id)).toEqual(null);

    store.commitTaskActionTransaction(context, [action1], {
        undoManager: null,
        affinityManager: noopAffinityManager,
    });

    expect(getCollectionEntryIfExists(store, collection.id)).toEqual({
        collection,
        actions: null,
        optimisticState: {
            original: {
                collection: null,
                actions: [],
            },
            actions: [{isOptimistic: true, action: action1}],
        },
        authorizationState: expect.objectContaining({
            value: "Authorized",
            version: zeroHybridLogicalTime,
        }),
    });

    store.commitTaskActionTransaction(context, [action2], {
        undoManager: null,
        affinityManager: noopAffinityManager,
    });

    expect(getCollectionEntryIfExists(store, collection.id)).toEqual({
        collection: collection.applyAction(action2),
        actions: null,
        optimisticState: {
            original: {
                collection: null,
                actions: [],
            },
            actions: [
                {isOptimistic: true, action: action1},
                {isOptimistic: true, action: action2},
            ],
        },
        authorizationState: expect.objectContaining({
            value: "Authorized",
            version: zeroHybridLogicalTime,
        }),
    });

    store.applyUpdateEvent({
        type: "Update",
        originClientId: null,
        defaultAuthorizationStateVersion: clock.now(),
        actions: [action3],
        backfillTasks: [],
        backfillCollections: [],
        referencedAccounts: [],
    });

    expect(getCollectionEntryIfExists(store, collection.id)).toEqual({
        collection: collection.applyAction(action2).applyAction(action3),
        actions: null,
        optimisticState: {
            original: {
                collection: null,
                actions: [],
            },
            actions: [
                {isOptimistic: true, action: action1},
                {isOptimistic: true, action: action2},
                {isOptimistic: false, action: action3},
            ],
        },
        authorizationState: expect.objectContaining({
            value: "Authorized",
            version: zeroHybridLogicalTime,
        }),
    });

    await rejectRpcExecution(commitTaskActionTransaction, 0);

    expect(getCollectionEntryIfExists(store, collection.id)).toEqual({
        collection: null,
        actions: [action2, action3],
        optimisticState: {
            original: {
                collection: null,
                actions: [],
            },
            actions: [
                {isOptimistic: true, action: action2},
                {isOptimistic: false, action: action3},
            ],
        },
        authorizationState: expect.objectContaining({
            value: "Authorized",
            version: zeroHybridLogicalTime,
        }),
    });

    await rejectRpcExecution(commitTaskActionTransaction, 1);

    expect(getCollectionEntryIfExists(store, collection.id)).toEqual({
        collection: null,
        actions: [action3],
        optimisticState: null,
        authorizationState: expect.objectContaining({
            value: "Authorized",
            version: zeroHybridLogicalTime,
        }),
    });

    expect(errors.length).toEqual(2);
    errors = [];
});

test("regular actions are added to optimistic state with multiple actions when collection is created optimistically (rejected)", async () => {
    const store = createAutoRetainStore();

    const action1 = {
        type: "UpdateCollection",
        time: store.clock.now(),
        collectionId: generateId(),
        collectionAction: {
            type: "Create",
            creatorId: null,
            name: "Test",
            accessPolicy: {
                accountGrantById: new Map([[account1.id, {level: "Manage", generation: 0}]]),
                defaultGrant: null,
                urlGrant: null,
            },
        },
    } satisfies TaskAction;

    const collection = createCollection(store, {
        id: action1.collectionId,
        time: action1.time,
        collectionAction: action1.collectionAction,
    });

    const action2 = {
        type: "UpdateCollection",
        time: store.clock.now(),
        collectionId: collection.id,
        collectionAction: {
            type: "UpdateName",
            name: "Test 2",
        },
    } satisfies TaskAction;

    const action3 = {
        type: "UpdateCollection",
        time: store.clock.now(),
        collectionId: collection.id,
        collectionAction: {
            type: "UpdateColor",
            color: "red",
        },
    } satisfies TaskAction;

    const action4 = {
        type: "UpdateCollection",
        time: store.clock.now(),
        collectionId: collection.id,
        collectionAction: {
            type: "UpdateName",
            name: "Test 3",
        },
    } satisfies TaskAction;

    expect(getCollectionEntryIfExists(store, collection.id)).toEqual(null);

    store.commitTaskActionTransaction(context, [action1], {
        undoManager: null,
        affinityManager: noopAffinityManager,
    });

    expect(getCollectionEntryIfExists(store, collection.id)).toEqual({
        collection,
        actions: null,
        optimisticState: {
            original: {
                collection: null,
                actions: [],
            },
            actions: [{isOptimistic: true, action: action1}],
        },
        authorizationState: expect.objectContaining({
            value: "Authorized",
            version: zeroHybridLogicalTime,
        }),
    });

    store.commitTaskActionTransaction(context, [action2], {
        undoManager: null,
        affinityManager: noopAffinityManager,
    });

    expect(getCollectionEntryIfExists(store, collection.id)).toEqual({
        collection: collection.applyAction(action2),
        actions: null,
        optimisticState: {
            original: {
                collection: null,
                actions: [],
            },
            actions: [
                {isOptimistic: true, action: action1},
                {isOptimistic: true, action: action2},
            ],
        },
        authorizationState: expect.objectContaining({
            value: "Authorized",
            version: zeroHybridLogicalTime,
        }),
    });

    store.applyUpdateEvent({
        type: "Update",
        originClientId: null,
        defaultAuthorizationStateVersion: clock.now(),
        actions: [action3],
        backfillTasks: [],
        backfillCollections: [],
        referencedAccounts: [],
    });

    expect(getCollectionEntryIfExists(store, collection.id)).toEqual({
        collection: collection.applyAction(action2).applyAction(action3),
        actions: null,
        optimisticState: {
            original: {
                collection: null,
                actions: [],
            },
            actions: [
                {isOptimistic: true, action: action1},
                {isOptimistic: true, action: action2},
                {isOptimistic: false, action: action3},
            ],
        },
        authorizationState: expect.objectContaining({
            value: "Authorized",
            version: zeroHybridLogicalTime,
        }),
    });

    store.commitTaskActionTransaction(context, [action4], {
        undoManager: null,
        affinityManager: noopAffinityManager,
    });

    expect(getCollectionEntryIfExists(store, collection.id)).toEqual({
        collection: collection.applyAction(action2).applyAction(action3).applyAction(action4),
        actions: null,
        optimisticState: {
            original: {
                collection: null,
                actions: [],
            },
            actions: [
                {isOptimistic: true, action: action1},
                {isOptimistic: true, action: action2},
                {isOptimistic: false, action: action3},
                {isOptimistic: true, action: action4},
            ],
        },
        authorizationState: expect.objectContaining({
            value: "Authorized",
            version: zeroHybridLogicalTime,
        }),
    });

    await rejectRpcExecution(commitTaskActionTransaction, 0);

    expect(getCollectionEntryIfExists(store, collection.id)).toEqual({
        collection: null,
        actions: [action2, action3, action4],
        optimisticState: {
            original: {
                collection: null,
                actions: [],
            },
            actions: [
                {isOptimistic: true, action: action2},
                {isOptimistic: false, action: action3},
                {isOptimistic: true, action: action4},
            ],
        },
        authorizationState: expect.objectContaining({
            value: "Authorized",
            version: zeroHybridLogicalTime,
        }),
    });

    await rejectRpcExecution(commitTaskActionTransaction, 1);

    expect(getCollectionEntryIfExists(store, collection.id)).toEqual({
        collection: null,
        actions: [action3, action4],
        optimisticState: {
            original: {
                collection: null,
                actions: [action3],
            },
            actions: [{isOptimistic: true, action: action4}],
        },
        authorizationState: expect.objectContaining({
            value: "Authorized",
            version: zeroHybridLogicalTime,
        }),
    });

    await rejectRpcExecution(commitTaskActionTransaction, 2);

    expect(getCollectionEntryIfExists(store, collection.id)).toEqual({
        collection: null,
        actions: [action3],
        optimisticState: null,
        authorizationState: expect.objectContaining({
            value: "Authorized",
            version: zeroHybridLogicalTime,
        }),
    });

    expect(errors.length).toEqual(3);
    errors = [];
});

test("regular actions are added to optimistic state with multiple actions that are committed out of order when collection is created optimistically (rejected)", async () => {
    const store = createAutoRetainStore();

    const action1 = {
        type: "UpdateCollection",
        time: store.clock.now(),
        collectionId: generateId(),
        collectionAction: {
            type: "Create",
            creatorId: null,
            name: "Test",
            accessPolicy: {
                accountGrantById: new Map([[account1.id, {level: "Manage", generation: 0}]]),
                defaultGrant: null,
                urlGrant: null,
            },
        },
    } satisfies TaskAction;

    const collection = createCollection(store, {
        id: action1.collectionId,
        time: action1.time,
        collectionAction: action1.collectionAction,
    });

    const action2 = {
        type: "UpdateCollection",
        time: store.clock.now(),
        collectionId: collection.id,
        collectionAction: {
            type: "UpdateName",
            name: "Test 2",
        },
    } satisfies TaskAction;

    const action3 = {
        type: "UpdateCollection",
        time: store.clock.now(),
        collectionId: collection.id,
        collectionAction: {
            type: "UpdateColor",
            color: "red",
        },
    } satisfies TaskAction;

    const action4 = {
        type: "UpdateCollection",
        time: store.clock.now(),
        collectionId: collection.id,
        collectionAction: {
            type: "UpdateName",
            name: "Test 3",
        },
    } satisfies TaskAction;

    expect(getCollectionEntryIfExists(store, collection.id)).toEqual(null);

    store.commitTaskActionTransaction(context, [action1], {
        undoManager: null,
        affinityManager: noopAffinityManager,
    });

    expect(getCollectionEntryIfExists(store, collection.id)).toEqual({
        collection,
        actions: null,
        optimisticState: {
            original: {
                collection: null,
                actions: [],
            },
            actions: [{isOptimistic: true, action: action1}],
        },
        authorizationState: expect.objectContaining({
            value: "Authorized",
            version: zeroHybridLogicalTime,
        }),
    });

    store.commitTaskActionTransaction(context, [action2], {
        undoManager: null,
        affinityManager: noopAffinityManager,
    });

    expect(getCollectionEntryIfExists(store, collection.id)).toEqual({
        collection: collection.applyAction(action2),
        actions: null,
        optimisticState: {
            original: {
                collection: null,
                actions: [],
            },
            actions: [
                {isOptimistic: true, action: action1},
                {isOptimistic: true, action: action2},
            ],
        },
        authorizationState: expect.objectContaining({
            value: "Authorized",
            version: zeroHybridLogicalTime,
        }),
    });

    store.applyUpdateEvent({
        type: "Update",
        originClientId: null,
        defaultAuthorizationStateVersion: clock.now(),
        actions: [action3],
        backfillTasks: [],
        backfillCollections: [],
        referencedAccounts: [],
    });

    expect(getCollectionEntryIfExists(store, collection.id)).toEqual({
        collection: collection.applyAction(action2).applyAction(action3),
        actions: null,
        optimisticState: {
            original: {
                collection: null,
                actions: [],
            },
            actions: [
                {isOptimistic: true, action: action1},
                {isOptimistic: true, action: action2},
                {isOptimistic: false, action: action3},
            ],
        },
        authorizationState: expect.objectContaining({
            value: "Authorized",
            version: zeroHybridLogicalTime,
        }),
    });

    store.commitTaskActionTransaction(context, [action4], {
        undoManager: null,
        affinityManager: noopAffinityManager,
    });

    expect(getCollectionEntryIfExists(store, collection.id)).toEqual({
        collection: collection.applyAction(action2).applyAction(action3).applyAction(action4),
        actions: null,
        optimisticState: {
            original: {
                collection: null,
                actions: [],
            },
            actions: [
                {isOptimistic: true, action: action1},
                {isOptimistic: true, action: action2},
                {isOptimistic: false, action: action3},
                {isOptimistic: true, action: action4},
            ],
        },
        authorizationState: expect.objectContaining({
            value: "Authorized",
            version: zeroHybridLogicalTime,
        }),
    });

    await rejectRpcExecution(commitTaskActionTransaction, 0);

    expect(getCollectionEntryIfExists(store, collection.id)).toEqual({
        collection: null,
        actions: [action2, action3, action4],
        optimisticState: {
            original: {
                collection: null,
                actions: [],
            },
            actions: [
                {isOptimistic: true, action: action2},
                {isOptimistic: false, action: action3},
                {isOptimistic: true, action: action4},
            ],
        },
        authorizationState: expect.objectContaining({
            value: "Authorized",
            version: zeroHybridLogicalTime,
        }),
    });

    await rejectRpcExecution(commitTaskActionTransaction, 2);

    expect(getCollectionEntryIfExists(store, collection.id)).toEqual({
        collection: null,
        actions: [action2, action3],
        optimisticState: {
            original: {
                collection: null,
                actions: [],
            },
            actions: [
                {isOptimistic: true, action: action2},
                {isOptimistic: false, action: action3},
            ],
        },
        authorizationState: expect.objectContaining({
            value: "Authorized",
            version: zeroHybridLogicalTime,
        }),
    });

    await rejectRpcExecution(commitTaskActionTransaction, 1);

    expect(getCollectionEntryIfExists(store, collection.id)).toEqual({
        collection: null,
        actions: [action3],
        optimisticState: null,
        authorizationState: expect.objectContaining({
            value: "Authorized",
            version: zeroHybridLogicalTime,
        }),
    });

    expect(errors.length).toEqual(3);
    errors = [];
});

test("three optimistic actions when collection is not backfilled (rejected)", async () => {
    const store = createAutoRetainStore();

    const collection = createCollection(store);

    const action2 = {
        type: "UpdateCollection",
        time: store.clock.now(),
        collectionId: collection.id,
        collectionAction: {
            type: "UpdateName",
            name: "Test 2",
        },
    } satisfies TaskAction;

    const action3 = {
        type: "UpdateCollection",
        time: store.clock.now(),
        collectionId: collection.id,
        collectionAction: {
            type: "UpdateColor",
            color: "red",
        },
    } satisfies TaskAction;

    const action4 = {
        type: "UpdateCollection",
        time: store.clock.now(),
        collectionId: collection.id,
        collectionAction: {
            type: "UpdateName",
            name: "Test 3",
        },
    } satisfies TaskAction;

    expect(getCollectionEntryIfExists(store, collection.id)).toEqual(null);

    store.commitTaskActionTransaction(context, [action2], {
        undoManager: null,
        affinityManager: noopAffinityManager,
    });

    expect(getCollectionEntryIfExists(store, collection.id)).toEqual({
        collection: null,
        actions: [action2],
        optimisticState: {
            original: {
                collection: null,
                actions: [],
            },
            actions: [{isOptimistic: true, action: action2}],
        },
        authorizationState: null,
    });

    store.commitTaskActionTransaction(context, [action3], {
        undoManager: null,
        affinityManager: noopAffinityManager,
    });

    expect(getCollectionEntryIfExists(store, collection.id)).toEqual({
        collection: null,
        actions: [action2, action3],
        optimisticState: {
            original: {
                collection: null,
                actions: [],
            },
            actions: [
                {isOptimistic: true, action: action2},
                {isOptimistic: true, action: action3},
            ],
        },
        authorizationState: null,
    });

    store.commitTaskActionTransaction(context, [action4], {
        undoManager: null,
        affinityManager: noopAffinityManager,
    });

    expect(getCollectionEntryIfExists(store, collection.id)).toEqual({
        collection: null,
        actions: [action2, action3, action4],
        optimisticState: {
            original: {
                collection: null,
                actions: [],
            },
            actions: [
                {isOptimistic: true, action: action2},
                {isOptimistic: true, action: action3},
                {isOptimistic: true, action: action4},
            ],
        },
        authorizationState: null,
    });

    await rejectRpcExecution(commitTaskActionTransaction, 0);

    expect(getCollectionEntryIfExists(store, collection.id)).toEqual({
        collection: null,
        actions: [action3, action4],
        optimisticState: {
            original: {
                collection: null,
                actions: [],
            },
            actions: [
                {isOptimistic: true, action: action3},
                {isOptimistic: true, action: action4},
            ],
        },
        authorizationState: null,
    });

    await rejectRpcExecution(commitTaskActionTransaction, 1);

    expect(getCollectionEntryIfExists(store, collection.id)).toEqual({
        collection: null,
        actions: [action4],
        optimisticState: {
            original: {
                collection: null,
                actions: [],
            },
            actions: [{isOptimistic: true, action: action4}],
        },
        authorizationState: null,
    });

    await rejectRpcExecution(commitTaskActionTransaction, 2);

    expect(getCollectionEntryIfExists(store, collection.id)).toEqual({
        collection: null,
        actions: [],
        optimisticState: null,
        authorizationState: null,
    });

    expect(errors.length).toEqual(3);
    errors = [];
});

test("backfilling a collection when none exists and there are optimistic actions works (rejected)", async () => {
    const store = createAutoRetainStore();

    const collection = createCollection(store);

    const action2 = {
        type: "UpdateCollection",
        time: store.clock.now(),
        collectionId: collection.id,
        collectionAction: {
            type: "UpdateName",
            name: "Test 2",
        },
    } satisfies TaskAction;

    const action3 = {
        type: "UpdateCollection",
        time: store.clock.now(),
        collectionId: collection.id,
        collectionAction: {
            type: "UpdateColor",
            color: "red",
        },
    } satisfies TaskAction;

    expect(getCollectionEntryIfExists(store, collection.id)).toEqual(null);

    store.commitTaskActionTransaction(context, [action2], {
        undoManager: null,
        affinityManager: noopAffinityManager,
    });

    expect(getCollectionEntryIfExists(store, collection.id)).toEqual({
        collection: null,
        actions: [action2],
        optimisticState: {
            original: {
                collection: null,
                actions: [],
            },
            actions: [{isOptimistic: true, action: action2}],
        },
        authorizationState: null,
    });

    store.applyUpdateEvent({
        type: "Update",
        originClientId: null,
        defaultAuthorizationStateVersion: clock.now(),
        actions: [action3],
        backfillTasks: [],
        backfillCollections: [],
        referencedAccounts: [],
    });

    expect(getCollectionEntryIfExists(store, collection.id)).toEqual({
        collection: null,
        actions: [action2, action3],
        optimisticState: {
            original: {
                collection: null,
                actions: [],
            },
            actions: [
                {isOptimistic: true, action: action2},
                {isOptimistic: false, action: action3},
            ],
        },
        authorizationState: null,
    });

    store.applyUpdateEvent({
        type: "Update",
        originClientId: null,
        defaultAuthorizationStateVersion: clock.now(),
        actions: [],
        backfillTasks: [],
        backfillCollections: [{type: "Authorized", collection: collection}],
        referencedAccounts: [],
    });

    expect(getCollectionEntryIfExists(store, collection.id)).toEqual({
        collection: collection.applyAction(action2).applyAction(action3),
        actions: null,
        optimisticState: {
            original: {
                collection,
                actions: null,
            },
            actions: [
                {isOptimistic: true, action: action2},
                {isOptimistic: false, action: action3},
            ],
        },
        authorizationState: expect.objectContaining({value: "Authorized"}),
    });

    await rejectLastRpcExecution(commitTaskActionTransaction);

    expect(getCollectionEntryIfExists(store, collection.id)).toEqual({
        collection: collection.applyAction(action3),
        actions: null,
        optimisticState: null,
        authorizationState: expect.objectContaining({value: "Authorized"}),
    });

    expect(errors.length).toEqual(1);
    errors = [];
});

test("backfilling a collection when one is already backfilled and there are optimistic actions works (rejected)", async () => {
    const store = createAutoRetainStore();

    const collection = createCollection(store);

    const action2 = {
        type: "UpdateCollection",
        time: store.clock.now(),
        collectionId: collection.id,
        collectionAction: {
            type: "UpdateName",
            name: "Test 2",
        },
    } satisfies TaskAction;

    const action3 = {
        type: "UpdateCollection",
        time: store.clock.now(),
        collectionId: collection.id,
        collectionAction: {
            type: "UpdateColor",
            color: "red",
        },
    } satisfies TaskAction;

    expect(getCollectionEntryIfExists(store, collection.id)).toEqual(null);

    store.applyUpdateEvent({
        type: "Update",
        originClientId: null,
        defaultAuthorizationStateVersion: clock.now(),
        actions: [],
        backfillTasks: [],
        backfillCollections: [{type: "Authorized", collection: collection}],
        referencedAccounts: [],
    });

    expect(getCollectionEntryIfExists(store, collection.id)).toEqual({
        collection,
        actions: null,
        optimisticState: null,
        authorizationState: expect.objectContaining({value: "Authorized"}),
    });

    store.commitTaskActionTransaction(context, [action2], {
        undoManager: null,
        affinityManager: noopAffinityManager,
    });

    expect(getCollectionEntryIfExists(store, collection.id)).toEqual({
        collection: collection.applyAction(action2),
        actions: null,
        optimisticState: {
            original: {
                collection,
                actions: null,
            },
            actions: [{isOptimistic: true, action: action2}],
        },
        authorizationState: expect.objectContaining({value: "Authorized"}),
    });

    store.applyUpdateEvent({
        type: "Update",
        originClientId: null,
        defaultAuthorizationStateVersion: clock.now(),
        actions: [],
        backfillTasks: [],
        backfillCollections: [{type: "Authorized", collection: collection.applyAction(action3)}],
        referencedAccounts: [],
    });

    expect(getCollectionEntryIfExists(store, collection.id)).toEqual({
        collection: collection.applyAction(action2).applyAction(action3),
        actions: null,
        optimisticState: {
            original: {
                collection: collection.applyAction(action3),
                actions: null,
            },
            actions: [{isOptimistic: true, action: action2}],
        },
        authorizationState: expect.objectContaining({value: "Authorized"}),
    });

    await rejectLastRpcExecution(commitTaskActionTransaction);

    expect(getCollectionEntryIfExists(store, collection.id)).toEqual({
        collection: collection.applyAction(action3),
        actions: null,
        optimisticState: null,
        authorizationState: expect.objectContaining({value: "Authorized"}),
    });

    expect(errors.length).toEqual(1);
    errors = [];
});

test("backfilling a collection when there are optimistic actions but no previously backfilled collection works (rejected)", async () => {
    const store = createAutoRetainStore();

    const action1 = {
        type: "UpdateCollection",
        time: store.clock.now(),
        collectionId: generateId(),
        collectionAction: {
            type: "Create",
            creatorId: null,
            name: "Test",
            accessPolicy: {
                accountGrantById: new Map([[account1.id, {level: "Manage", generation: 0}]]),
                defaultGrant: null,
                urlGrant: null,
            },
        },
    } satisfies TaskAction;

    const collection = createCollection(store, {
        id: action1.collectionId,
        time: action1.time,
        collectionAction: action1.collectionAction,
    });

    const action2 = {
        type: "UpdateCollection",
        time: store.clock.now(),
        collectionId: collection.id,
        collectionAction: {
            type: "UpdateName",
            name: "Test 2",
        },
    } satisfies TaskAction;

    const action3 = {
        type: "UpdateCollection",
        time: store.clock.now(),
        collectionId: collection.id,
        collectionAction: {
            type: "UpdateColor",
            color: "red",
        },
    } satisfies TaskAction;

    const action4 = {
        type: "UpdateCollection",
        time: store.clock.now(),
        collectionId: collection.id,
        collectionAction: {
            type: "UpdateName",
            name: "Test 3",
        },
    } satisfies TaskAction;

    expect(getCollectionEntryIfExists(store, collection.id)).toEqual(null);

    store.applyUpdateEvent({
        type: "Update",
        originClientId: null,
        defaultAuthorizationStateVersion: clock.now(),
        actions: [action3],
        backfillTasks: [],
        backfillCollections: [],
        referencedAccounts: [],
    });

    expect(getCollectionEntryIfExists(store, collection.id)).toEqual({
        collection: null,
        actions: [action3],
        optimisticState: null,
        authorizationState: null,
    });

    store.commitTaskActionTransaction(context, [action1], {
        undoManager: null,
        affinityManager: noopAffinityManager,
    });

    expect(getCollectionEntryIfExists(store, collection.id)).toEqual({
        collection: collection.applyAction(action3),
        actions: null,
        optimisticState: {
            original: {
                collection: null,
                actions: [action3],
            },
            actions: [{isOptimistic: true, action: action1}],
        },
        authorizationState: expect.objectContaining({
            value: "Authorized",
            version: zeroHybridLogicalTime,
        }),
    });

    store.commitTaskActionTransaction(context, [action2], {
        undoManager: null,
        affinityManager: noopAffinityManager,
    });

    expect(getCollectionEntryIfExists(store, collection.id)).toEqual({
        collection: collection.applyAction(action3).applyAction(action2),
        actions: null,
        optimisticState: {
            original: {
                collection: null,
                actions: [action3],
            },
            actions: [
                {isOptimistic: true, action: action1},
                {isOptimistic: true, action: action2},
            ],
        },
        authorizationState: expect.objectContaining({
            value: "Authorized",
            version: zeroHybridLogicalTime,
        }),
    });

    store.applyUpdateEvent({
        type: "Update",
        originClientId: null,
        defaultAuthorizationStateVersion: clock.now(),
        actions: [],
        backfillTasks: [],
        backfillCollections: [{type: "Authorized", collection: collection.applyAction(action4)}],
        referencedAccounts: [],
    });

    expect(getCollectionEntryIfExists(store, collection.id)).toEqual({
        collection: collection.applyAction(action4).applyAction(action3).applyAction(action2),
        actions: null,
        optimisticState: {
            original: {
                collection: collection.applyAction(action4).applyAction(action3),
                actions: null,
            },
            actions: [
                {isOptimistic: true, action: action1},
                {isOptimistic: true, action: action2},
            ],
        },
        authorizationState: expect.objectContaining({value: "Authorized"}),
    });

    await rejectRpcExecution(commitTaskActionTransaction, 0);

    expect(getCollectionEntryIfExists(store, collection.id)).toEqual({
        collection: collection.applyAction(action4).applyAction(action3).applyAction(action2),
        actions: null,
        optimisticState: {
            original: {
                collection: collection.applyAction(action4).applyAction(action3),
                actions: null,
            },
            actions: [{isOptimistic: true, action: action2}],
        },
        authorizationState: expect.objectContaining({value: "Authorized"}),
    });

    await rejectRpcExecution(commitTaskActionTransaction, 1);

    expect(getCollectionEntryIfExists(store, collection.id)).toEqual({
        collection: collection.applyAction(action4).applyAction(action3),
        actions: null,
        optimisticState: null,
        authorizationState: expect.objectContaining({value: "Authorized"}),
    });

    expect(errors.length).toEqual(2);
    errors = [];
});

test("create collection applied after optimistic updates", async () => {
    const store = createAutoRetainStore();

    const action1 = {
        type: "UpdateCollection",
        time: store.clock.now(),
        collectionId: generateId(),
        collectionAction: {
            type: "Create",
            creatorId: null,
            name: "Test",
            accessPolicy: {
                accountGrantById: new Map([[account1.id, {level: "Manage", generation: 0}]]),
                defaultGrant: null,
                urlGrant: null,
            },
        },
    } satisfies TaskAction;

    const collection = createCollection(store, {
        id: action1.collectionId,
        time: action1.time,
        collectionAction: action1.collectionAction,
    });

    const action2 = {
        type: "UpdateCollection",
        time: store.clock.now(),
        collectionId: collection.id,
        collectionAction: {
            type: "UpdateName",
            name: "Test 2",
        },
    } satisfies TaskAction;

    const action3 = {
        type: "UpdateCollection",
        time: store.clock.now(),
        collectionId: collection.id,
        collectionAction: {
            type: "UpdateColor",
            color: "red",
        },
    } satisfies TaskAction;

    expect(getCollectionEntryIfExists(store, collection.id)).toEqual(null);

    store.commitTaskActionTransaction(context, [action2], {
        undoManager: null,
        affinityManager: noopAffinityManager,
    });

    expect(getCollectionEntryIfExists(store, collection.id)).toEqual({
        collection: null,
        actions: [action2],
        optimisticState: {
            original: {
                collection: null,
                actions: [],
            },
            actions: [{isOptimistic: true, action: action2}],
        },
        authorizationState: null,
    });

    store.applyUpdateEvent({
        type: "Update",
        originClientId: null,
        defaultAuthorizationStateVersion: clock.now(),
        actions: [action1],
        backfillTasks: [],
        backfillCollections: [],
        referencedAccounts: [account1],
    });

    expect(getCollectionEntryIfExists(store, collection.id)).toEqual({
        collection: collection.applyAction(action2),
        actions: null,
        optimisticState: {
            original: {
                collection: null,
                actions: [],
            },
            actions: [
                {isOptimistic: true, action: action2},
                {isOptimistic: false, action: action1},
            ],
        },
        authorizationState: expect.objectContaining({value: "Authorized"}),
    });

    store.commitTaskActionTransaction(context, [action3], {
        undoManager: null,
        affinityManager: noopAffinityManager,
    });

    expect(getCollectionEntryIfExists(store, collection.id)).toEqual({
        collection: collection.applyAction(action2).applyAction(action3),
        actions: null,
        optimisticState: {
            original: {
                collection: null,
                actions: [],
            },
            actions: [
                {isOptimistic: true, action: action2},
                {isOptimistic: false, action: action1},
                {isOptimistic: true, action: action3},
            ],
        },
        authorizationState: expect.objectContaining({value: "Authorized"}),
    });

    await resolveRpcExecution(commitTaskActionTransaction, 0, {
        extraActions: [],
        referencedAccounts: [],
    });

    expect(getCollectionEntryIfExists(store, collection.id)).toEqual({
        collection: collection.applyAction(action2).applyAction(action3),
        actions: null,
        optimisticState: {
            original: {
                collection: collection.applyAction(action2),
                actions: null,
            },
            actions: [{isOptimistic: true, action: action3}],
        },
        authorizationState: expect.objectContaining({value: "Authorized"}),
    });

    await resolveRpcExecution(commitTaskActionTransaction, 1, {
        extraActions: [],
        referencedAccounts: [],
    });

    expect(getCollectionEntryIfExists(store, collection.id)).toEqual({
        collection: collection.applyAction(action2).applyAction(action3),
        actions: null,
        optimisticState: null,
        authorizationState: expect.objectContaining({value: "Authorized"}),
    });
});

test("create collection applied after optimistic updates that are resolved out of order", async () => {
    const store = createAutoRetainStore();

    const action1 = {
        type: "UpdateCollection",
        time: store.clock.now(),
        collectionId: generateId(),
        collectionAction: {
            type: "Create",
            creatorId: null,
            name: "Test",
            accessPolicy: {
                accountGrantById: new Map([[account1.id, {level: "Manage", generation: 0}]]),
                defaultGrant: null,
                urlGrant: null,
            },
        },
    } satisfies TaskAction;

    const collection = createCollection(store, {
        id: action1.collectionId,
        time: action1.time,
        collectionAction: action1.collectionAction,
    });

    const action2 = {
        type: "UpdateCollection",
        time: store.clock.now(),
        collectionId: collection.id,
        collectionAction: {
            type: "UpdateName",
            name: "Test 2",
        },
    } satisfies TaskAction;

    const action3 = {
        type: "UpdateCollection",
        time: store.clock.now(),
        collectionId: collection.id,
        collectionAction: {
            type: "UpdateColor",
            color: "red",
        },
    } satisfies TaskAction;

    expect(getCollectionEntryIfExists(store, collection.id)).toEqual(null);

    store.commitTaskActionTransaction(context, [action2], {
        undoManager: null,
        affinityManager: noopAffinityManager,
    });

    expect(getCollectionEntryIfExists(store, collection.id)).toEqual({
        collection: null,
        actions: [action2],
        optimisticState: {
            original: {
                collection: null,
                actions: [],
            },
            actions: [{isOptimistic: true, action: action2}],
        },
        authorizationState: null,
    });

    store.applyUpdateEvent({
        type: "Update",
        originClientId: null,
        defaultAuthorizationStateVersion: clock.now(),
        actions: [action1],
        backfillTasks: [],
        backfillCollections: [],
        referencedAccounts: [account1],
    });

    expect(getCollectionEntryIfExists(store, collection.id)).toEqual({
        collection: collection.applyAction(action2),
        actions: null,
        optimisticState: {
            original: {
                collection: null,
                actions: [],
            },
            actions: [
                {isOptimistic: true, action: action2},
                {isOptimistic: false, action: action1},
            ],
        },
        authorizationState: expect.objectContaining({value: "Authorized"}),
    });

    store.commitTaskActionTransaction(context, [action3], {
        undoManager: null,
        affinityManager: noopAffinityManager,
    });

    expect(getCollectionEntryIfExists(store, collection.id)).toEqual({
        collection: collection.applyAction(action2).applyAction(action3),
        actions: null,
        optimisticState: {
            original: {
                collection: null,
                actions: [],
            },
            actions: [
                {isOptimistic: true, action: action2},
                {isOptimistic: false, action: action1},
                {isOptimistic: true, action: action3},
            ],
        },
        authorizationState: expect.objectContaining({value: "Authorized"}),
    });

    await resolveRpcExecution(commitTaskActionTransaction, 1, {
        extraActions: [],
        referencedAccounts: [],
    });

    expect(getCollectionEntryIfExists(store, collection.id)).toEqual({
        collection: collection.applyAction(action2).applyAction(action3),
        actions: null,
        optimisticState: {
            original: {
                collection: null,
                actions: [action3],
            },
            actions: [
                {isOptimistic: true, action: action2},
                {isOptimistic: false, action: action1},
            ],
        },
        authorizationState: expect.objectContaining({value: "Authorized"}),
    });

    await resolveRpcExecution(commitTaskActionTransaction, 0, {
        extraActions: [],
        referencedAccounts: [],
    });

    expect(getCollectionEntryIfExists(store, collection.id)).toEqual({
        collection: collection.applyAction(action2).applyAction(action3),
        actions: null,
        optimisticState: null,
        authorizationState: expect.objectContaining({value: "Authorized"}),
    });
});

test("create collection applied after optimistic updates (rejected)", async () => {
    const store = createAutoRetainStore();

    const action1 = {
        type: "UpdateCollection",
        time: store.clock.now(),
        collectionId: generateId(),
        collectionAction: {
            type: "Create",
            creatorId: null,
            name: "Test",
            accessPolicy: {
                accountGrantById: new Map([[account1.id, {level: "Manage", generation: 0}]]),
                defaultGrant: null,
                urlGrant: null,
            },
        },
    } satisfies TaskAction;

    const collection = createCollection(store, {
        id: action1.collectionId,
        time: action1.time,
        collectionAction: action1.collectionAction,
    });

    const action2 = {
        type: "UpdateCollection",
        time: store.clock.now(),
        collectionId: collection.id,
        collectionAction: {
            type: "UpdateName",
            name: "Test 2",
        },
    } satisfies TaskAction;

    const action3 = {
        type: "UpdateCollection",
        time: store.clock.now(),
        collectionId: collection.id,
        collectionAction: {
            type: "UpdateColor",
            color: "red",
        },
    } satisfies TaskAction;

    expect(getCollectionEntryIfExists(store, collection.id)).toEqual(null);

    store.commitTaskActionTransaction(context, [action2], {
        undoManager: null,
        affinityManager: noopAffinityManager,
    });

    expect(getCollectionEntryIfExists(store, collection.id)).toEqual({
        collection: null,
        actions: [action2],
        optimisticState: {
            original: {
                collection: null,
                actions: [],
            },
            actions: [{isOptimistic: true, action: action2}],
        },
        authorizationState: null,
    });

    store.applyUpdateEvent({
        type: "Update",
        originClientId: null,
        defaultAuthorizationStateVersion: clock.now(),
        actions: [action1],
        backfillTasks: [],
        backfillCollections: [],
        referencedAccounts: [account1],
    });

    expect(getCollectionEntryIfExists(store, collection.id)).toEqual({
        collection: collection.applyAction(action2),
        actions: null,
        optimisticState: {
            original: {
                collection: null,
                actions: [],
            },
            actions: [
                {isOptimistic: true, action: action2},
                {isOptimistic: false, action: action1},
            ],
        },
        authorizationState: expect.objectContaining({value: "Authorized"}),
    });

    store.commitTaskActionTransaction(context, [action3], {
        undoManager: null,
        affinityManager: noopAffinityManager,
    });

    expect(getCollectionEntryIfExists(store, collection.id)).toEqual({
        collection: collection.applyAction(action2).applyAction(action3),
        actions: null,
        optimisticState: {
            original: {
                collection: null,
                actions: [],
            },
            actions: [
                {isOptimistic: true, action: action2},
                {isOptimistic: false, action: action1},
                {isOptimistic: true, action: action3},
            ],
        },
        authorizationState: expect.objectContaining({value: "Authorized"}),
    });

    await rejectRpcExecution(commitTaskActionTransaction, 0);

    expect(getCollectionEntryIfExists(store, collection.id)).toEqual({
        collection: collection.applyAction(action3),
        actions: null,
        optimisticState: {
            original: {
                collection: collection,
                actions: null,
            },
            actions: [{isOptimistic: true, action: action3}],
        },
        authorizationState: expect.objectContaining({value: "Authorized"}),
    });

    await rejectRpcExecution(commitTaskActionTransaction, 1);

    expect(getCollectionEntryIfExists(store, collection.id)).toEqual({
        collection: collection,
        actions: null,
        optimisticState: null,
        authorizationState: expect.objectContaining({value: "Authorized"}),
    });

    expect(errors.length).toEqual(2);
    errors = [];
});

test("create collection applied after optimistic updates that are resolved out of order (rejected)", async () => {
    const store = createAutoRetainStore();

    const action1 = {
        type: "UpdateCollection",
        time: store.clock.now(),
        collectionId: generateId(),
        collectionAction: {
            type: "Create",
            creatorId: null,
            name: "Test",
            accessPolicy: {
                accountGrantById: new Map([[account1.id, {level: "Manage", generation: 0}]]),
                defaultGrant: null,
                urlGrant: null,
            },
        },
    } satisfies TaskAction;

    const collection = createCollection(store, {
        id: action1.collectionId,
        time: action1.time,
        collectionAction: action1.collectionAction,
    });

    const action2 = {
        type: "UpdateCollection",
        time: store.clock.now(),
        collectionId: collection.id,
        collectionAction: {
            type: "UpdateName",
            name: "Test 2",
        },
    } satisfies TaskAction;

    const action3 = {
        type: "UpdateCollection",
        time: store.clock.now(),
        collectionId: collection.id,
        collectionAction: {
            type: "UpdateColor",
            color: "red",
        },
    } satisfies TaskAction;

    expect(getCollectionEntryIfExists(store, collection.id)).toEqual(null);

    store.commitTaskActionTransaction(context, [action2], {
        undoManager: null,
        affinityManager: noopAffinityManager,
    });

    expect(getCollectionEntryIfExists(store, collection.id)).toEqual({
        collection: null,
        actions: [action2],
        optimisticState: {
            original: {
                collection: null,
                actions: [],
            },
            actions: [{isOptimistic: true, action: action2}],
        },
        authorizationState: null,
    });

    store.applyUpdateEvent({
        type: "Update",
        originClientId: null,
        defaultAuthorizationStateVersion: clock.now(),
        actions: [action1],
        backfillTasks: [],
        backfillCollections: [],
        referencedAccounts: [account1],
    });

    expect(getCollectionEntryIfExists(store, collection.id)).toEqual({
        collection: collection.applyAction(action2),
        actions: null,
        optimisticState: {
            original: {
                collection: null,
                actions: [],
            },
            actions: [
                {isOptimistic: true, action: action2},
                {isOptimistic: false, action: action1},
            ],
        },
        authorizationState: expect.objectContaining({value: "Authorized"}),
    });

    store.commitTaskActionTransaction(context, [action3], {
        undoManager: null,
        affinityManager: noopAffinityManager,
    });

    expect(getCollectionEntryIfExists(store, collection.id)).toEqual({
        collection: collection.applyAction(action2).applyAction(action3),
        actions: null,
        optimisticState: {
            original: {
                collection: null,
                actions: [],
            },
            actions: [
                {isOptimistic: true, action: action2},
                {isOptimistic: false, action: action1},
                {isOptimistic: true, action: action3},
            ],
        },
        authorizationState: expect.objectContaining({value: "Authorized"}),
    });

    await rejectRpcExecution(commitTaskActionTransaction, 1);

    expect(getCollectionEntryIfExists(store, collection.id)).toEqual({
        collection: collection.applyAction(action2),
        actions: null,
        optimisticState: {
            original: {
                collection: null,
                actions: [],
            },
            actions: [
                {isOptimistic: true, action: action2},
                {isOptimistic: false, action: action1},
            ],
        },
        authorizationState: expect.objectContaining({value: "Authorized"}),
    });

    await rejectRpcExecution(commitTaskActionTransaction, 0);

    expect(getCollectionEntryIfExists(store, collection.id)).toEqual({
        collection: collection,
        actions: null,
        optimisticState: null,
        authorizationState: expect.objectContaining({value: "Authorized"}),
    });

    expect(errors.length).toEqual(2);
    errors = [];
});

test("subscription to parent task captures all updates during child task removal", async () => {
    const store = createAutoRetainStore();

    // Create parent task
    const parentTask = createTask(store);
    const childTask = createTask(store);

    // Set up parent-child relationship
    const setParentAction: TaskAction = {
        type: "UpdateTask",
        time: store.clock.now(),
        taskId: childTask.id,
        taskAction: {
            type: "UpdateParentTaskId",
            parentTaskId: parentTask.id,
        },
    };

    // Backfill tasks into the store
    store.applyUpdateEvent({
        type: "Update",
        originClientId: null,
        defaultAuthorizationStateVersion: clock.now(),
        actions: [],
        backfillTasks: [
            {type: "Authorized", task: parentTask},
            {type: "Authorized", task: childTask},
        ],
        backfillCollections: [],
        referencedAccounts: [account1],
    });

    // Apply the set parent action to establish parent-child relationship
    store.applyUpdateEvent({
        type: "Update",
        originClientId: null,
        defaultAuthorizationStateVersion: clock.now(),
        actions: [setParentAction],
        backfillTasks: [],
        backfillCollections: [],
        referencedAccounts: [],
    });

    {
        // Verify parent-child relationship was established
        const newChildTask = assertExists(
            store.getTaskEntryStoreIfExists(childTask.id)?.getSnapshot().task,
        );
        expect(newChildTask.getParent()?.taskId).toBe(parentTask.id);
    }

    // Create subscription to parent task before performing the removal
    // This is crucial for the bug reproduction
    const parentSubscription = store.createAndRetainTaskSubscription(parentTask.id);

    // Now remove the parent reference which should update child counts on parent
    const removeParentAction: TaskActionModel = {
        type: "UpdateTask",
        time: store.clock.now(),
        taskId: childTask.id,
        taskAction: {
            type: "UpdateParentTaskId",
            parentTaskId: null,
        },
    };

    // The bug appears to be related to how these updates are processed
    // Commit the action instead of applying it directly to test the optimistic update path
    store.commitTaskActionTransaction(context, [removeParentAction], {
        undoManager: null,
        affinityManager: noopAffinityManager,
    });

    {
        // Verify that the child's parent is now null
        const newChildTask = assertExists(
            store.getTaskEntryStoreIfExists(childTask.id)?.getSnapshot().task,
        );
        expect(newChildTask.getParent()).toBeNull();
    }

    // Wait for the commit to process
    await resolveLastRpcExecution(commitTaskActionTransaction, {
        extraActions: [
            {
                type: "UpdateTask",
                time: store.clock.now(),
                taskId: parentTask.id,
                taskAction: {
                    type: "UpdateChildrenCounts",
                    addedChildTaskCount: 1,
                    removedChildTaskCount: 1,
                    addedClosedChildTaskCount: 0,
                    removedClosedChildTaskCount: 0,
                },
            },
        ],
        referencedAccounts: [],
    });

    {
        // Verify that the child's parent is now null
        const newChildTask = assertExists(
            store.getTaskEntryStoreIfExists(childTask.id)?.getSnapshot().task,
        );
        expect(newChildTask.getParent()).toBeNull();
    }

    // Clean up
    parentSubscription.release();
});
