import {getAccountRegistry} from "~/client/web/accounts/account_registry_context.js";
import {getSiteRegistry} from "~/client/web/sites/site_registry_context.js";
import {
    TaskClientStore,
    TaskClientStoreSearchAffinityManager,
} from "~/client/web/tasks/core/task_client_store.js";
import {Context} from "~/shared/context/context.js";
import {DeadlineExceededError, InternalError} from "~/shared/error/error.js";
import {ErrorCode} from "~/shared/error/error_code.js";
import {waitMacrotask} from "~/shared/helpers/async/wait_macrotask.js";
import {
    HybridLogicalTime,
    zeroHybridLogicalTime,
} from "~/shared/helpers/clock/hybrid_logical_clock.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {defaultTimeZone} from "~/shared/helpers/intl/time_zone.js";
import {getOrSetDefaultMapValue} from "~/shared/helpers/map/get_or_set_default_map_value.js";
import {initialOrderKey} from "~/shared/helpers/sort/order_key.js";
import {assertId, generateId} from "~/shared/id/id.js";
import {AccountId, SpaceId, TaskCollectionId, TaskId} from "~/shared/id/types/id_types.js";
import {RpcDefinition} from "~/shared/rpc/rpc_definition.js";
import {
    commitTaskActionTransaction,
    deleteTaskAndAllChildren,
} from "~/shared/rpc/tasks_rpc_definitions.js";
import {TestRpcContextModule} from "~/shared/rpc/test_rpc_context_module.js";
import {AccountModel} from "~/shared/spaces/account_model.js";
import {createTestAccountModel} from "~/shared/spaces/test_helpers/account_model_test_helpers.js";
import {TaskAction} from "~/shared/tasks/actions/task_action.js";
import {TaskActionModel} from "~/shared/tasks/actions/task_action_model.js";
import {TaskCreateAction} from "~/shared/tasks/actions/task_task_action.js";
import {TaskCollectionModel} from "~/shared/tasks/model/task_collection_model.js";
import {TaskModel} from "~/shared/tasks/model/task_model.js";
import {
    assertNonEmptyReadonlyMap,
    assertNonEmptyReadonlySet,
    defaultTaskQueryNormalizedFilters,
} from "~/shared/tasks/task_query_normalized_filters.js";
import {defaultTaskQueryNormalizedSorts} from "~/shared/tasks/task_query_normalized_sort.js";
import {getTaskQuerySortCursorTaskId} from "~/shared/tasks/task_query_sort_cursor.js";
import {
    TaskAuthorizationStateRegister,
    TaskRealtimeUpdateEventSchema,
    taskAuthorizedState,
} from "~/shared/tasks/task_realtime_protocol.js";

beforeEach(() => {
    import.meta.jest.useFakeTimers();
});

afterEach(() => {
    const hadNoTimers = import.meta.jest.getTimerCount() === 0;
    import.meta.jest.clearAllTimers();
    import.meta.jest.useRealTimers();
    assert(hadNoTimers, "Expected all timers to be cleaned up by the end of each test");
});

const spaceId = generateId<SpaceId>();
const currentAccountId = generateId<AccountId>();
const accountRegistry = getAccountRegistry(spaceId);
const siteRegistry = getSiteRegistry(spaceId);

const account1 = createTestAccountModel({name: "Test Account 1"});
const account2 = createTestAccountModel({name: "Test Account 2"});

// Make sure we hold a reference to the `account1` store for the entire test.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const account1Store = accountRegistry.getAccountStore(account1);
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const account2Store = accountRegistry.getAccountStore(account2);

const getSortableAccount = (accountId: AccountId) => {
    const accountData = assertExists(
        accountRegistry.weakGetAccountStoreByIdIfExists(accountId),
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
    const taskEntry = store.getTaskEntrySnapshot(taskId);
    if (!taskEntry) return null;

    // This test was written before we added `actionReferencedAccountStoreById` to task
    // entries. Discard `actionReferencedAccountStoreById` so we can avoid rewriting
    // tests.

    // Use a `WeakMap` to make sure we maintain referential equality if the task entry
    // doesn't change.
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

let errors: Array<unknown> = [];

const handleError = ({error}: {error: unknown}) => {
    errors.push(error);
};

afterEach(() => {
    const previousError = errors;
    errors = [];

    if (previousError.length > 0) {
        throw InternalError.from(previousError[0], "Received error");
    }
});

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

const noopAffinityManager: TaskClientStoreSearchAffinityManager = {
    markLowIntentUpdateInteraction: () => {},
    addGlobalLoadingIndicator: () => {},
};

async function resolveLastRpcExecution<Input, Output>(
    definition: RpcDefinition<Input, Output>,
    output: Output,
): Promise<void> {
    // `TaskClientStore` might not schedule RPCs from `commitActionTransaction()` until
    // after a microtask. So wait for that to happen.
    await waitMacrotask();

    TestRpcContextModule.resolveLastExecution(definition, output);

    // Wait a macrotask for promise resolution to update data in `TaskClientStore`.
    await waitMacrotask();
}

async function rejectRpcExecution<Input, Output>(
    definition: RpcDefinition<Input, Output>,
    n: number,
): Promise<void> {
    // `TaskClientStore` might not schedule RPCs from `commitActionTransaction()` until
    // after a microtask. So wait for that to happen.
    await waitMacrotask();

    TestRpcContextModule.rejectExecution(definition, n);

    // Wait a macrotask for promise resolution to update data in `TaskClientStore`.
    await waitMacrotask();
}

async function rejectLastRpcExecution<Input, Output>(
    definition: RpcDefinition<Input, Output>,
): Promise<void> {
    // `TaskClientStore` might not schedule RPCs from `commitActionTransaction()` until
    // after a microtask. So wait for that to happen.
    await waitMacrotask();

    TestRpcContextModule.rejectLastExecution(definition);

    // Wait a macrotask for promise resolution to update data in `TaskClientStore`.
    await waitMacrotask();
}

test("if optimistic task creation is reverted then queries remove the task", async () => {
    const store = new TaskClientStore({
        accountRegistry,
        siteRegistry,
        spaceId,
        currentAccountId,
        onError: handleError,
    });

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

    // Make sure the task is retained when priority is not set.
    const allQuery = store.createAndRetainQuery({
        filters: {
            ...defaultTaskQueryNormalizedFilters,
            creatorFilter: {
                type: "OneOf",
                accountIds: assertNonEmptyReadonlySet(new Set([account1.id])),
            },
        },
        sorts: defaultTaskQueryNormalizedSorts,
        limit: 100,
    });

    store.loadTasksIntoQuery(allQuery, {
        limit: 100,
        loadedState: {type: "Full"},
        previouslyBackfilledTaskIds: [],
    });

    const query = store.createAndRetainQuery({
        filters: {
            ...defaultTaskQueryNormalizedFilters,
            creatorFilter: {
                type: "OneOf",
                accountIds: assertNonEmptyReadonlySet(new Set([account1.id])),
            },
            priorityFilter: {
                ifHigh: true,
                ifNull: false,
                ifLow: false,
                ifMedium: false,
                ifUrgent: false,
            },
        },
        sorts: defaultTaskQueryNormalizedSorts,
        limit: 100,
    });

    store.loadTasksIntoQuery(query, {
        limit: 100,
        loadedState: {type: "Full"},
        previouslyBackfilledTaskIds: [],
    });

    expect(getTaskEntryIfExists(store, task.id)).toEqual(null);

    expect(query.taskOrderStore.getSnapshot().keys.map(getTaskQuerySortCursorTaskId)).toEqual([]);

    store.commitTaskActionTransaction(context, [action1], {
        undoManager: null,
        affinityManager: noopAffinityManager,
    });

    expect(getTaskEntryIfExists(store, task.id)).toEqual({
        task: task,
        actions: null,
        optimisticState: {
            original: {
                task: null,
                actions: [],
            },
            actions: [{isOptimistic: true, action: action1}],
        },
        authorizationState: expect.objectContaining({
            value: taskAuthorizedState,
            version: zeroHybridLogicalTime,
        }),
    });

    expect(query.taskOrderStore.getSnapshot().keys.map(getTaskQuerySortCursorTaskId)).toEqual([]);

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
            value: taskAuthorizedState,
            version: zeroHybridLogicalTime,
        }),
    });

    expect(query.taskOrderStore.getSnapshot().keys.map(getTaskQuerySortCursorTaskId)).toEqual([
        task.id,
    ]);

    await rejectRpcExecution(commitTaskActionTransaction, 0);

    expect(getTaskEntryIfExists(store, task.id)).toEqual(null);

    expect(query.taskOrderStore.getSnapshot().keys.map(getTaskQuerySortCursorTaskId)).toEqual([]);

    await rejectRpcExecution(commitTaskActionTransaction, 1);

    expect(getTaskEntryIfExists(store, task.id)).toEqual(null);

    expect(query.taskOrderStore.getSnapshot().keys.map(getTaskQuerySortCursorTaskId)).toEqual([]);

    expect(errors.length).toEqual(2);
    errors = [];
});

test("task can be added to query through backfill", () => {
    const store = new TaskClientStore({
        accountRegistry,
        siteRegistry,
        spaceId,
        currentAccountId,
        onError: handleError,
    });

    const task = createTask(store);

    const query = store.createAndRetainQuery({
        filters: {
            ...defaultTaskQueryNormalizedFilters,
            creatorFilter: {
                type: "OneOf",
                accountIds: assertNonEmptyReadonlySet(new Set([account1.id])),
            },
        },
        sorts: defaultTaskQueryNormalizedSorts,
        limit: 100,
    });

    store.loadTasksIntoQuery(query, {
        limit: 100,
        loadedState: {type: "Full"},
        previouslyBackfilledTaskIds: [],
    });

    expect(query.taskOrderStore.getSnapshot().keys.map(getTaskQuerySortCursorTaskId)).toEqual([]);

    store.applyUpdateEvent({
        type: "Update",
        defaultAuthorizationStateVersion: store.clock.now(),
        actions: [],
        backfillTasks: [{type: "Authorized", task: task}],
        backfillCollections: [],
        referencedAccounts: [],
        referencedSites: [],
        originClientId: null,
    });

    expect(query.taskOrderStore.getSnapshot().keys.map(getTaskQuerySortCursorTaskId)).toEqual([
        task.id,
    ]);
});

test("task can be added to query through previously backfilled tasks", () => {
    const store = new TaskClientStore({
        accountRegistry,
        siteRegistry,
        spaceId,
        currentAccountId,
        onError: handleError,
    });

    const task = createTask(store);

    // Make sure another query retains the task.
    const allQuery = store.createAndRetainQuery({
        filters: {
            ...defaultTaskQueryNormalizedFilters,
            creatorFilter: {
                type: "OneOf",
                accountIds: assertNonEmptyReadonlySet(new Set([account1.id])),
            },
        },
        sorts: defaultTaskQueryNormalizedSorts,
        limit: 100,
    });

    store.loadTasksIntoQuery(allQuery, {
        limit: 100,
        loadedState: {type: "Full"},
        previouslyBackfilledTaskIds: [],
    });

    store.applyUpdateEvent({
        type: "Update",
        defaultAuthorizationStateVersion: store.clock.now(),
        actions: [],
        backfillTasks: [{type: "Authorized", task: task}],
        backfillCollections: [],
        referencedAccounts: [],
        referencedSites: [],
        originClientId: null,
    });

    const query = store.createAndRetainQuery({
        filters: {
            ...defaultTaskQueryNormalizedFilters,
            creatorFilter: {
                type: "OneOf",
                accountIds: assertNonEmptyReadonlySet(new Set([account1.id])),
            },
        },
        sorts: defaultTaskQueryNormalizedSorts,
        limit: 100,
    });

    expect(query.taskOrderStore.getSnapshot().keys.map(getTaskQuerySortCursorTaskId)).toEqual([]);

    store.loadTasksIntoQuery(query, {
        limit: 100,
        loadedState: {type: "Full"},
        previouslyBackfilledTaskIds: [task.id],
    });

    expect(query.taskOrderStore.getSnapshot().keys.map(getTaskQuerySortCursorTaskId)).toEqual([
        task.id,
    ]);
});

test("task can be added to query through action", () => {
    const store = new TaskClientStore({
        accountRegistry,
        siteRegistry,
        spaceId,
        currentAccountId,
        onError: handleError,
    });

    const task = createTask(store);

    const action = {
        type: "UpdateTask",
        time: store.clock.now(),
        taskId: task.id,
        taskAction: {
            type: "UpdatePriority",
            priority: "High",
        },
    } satisfies TaskAction;

    // Make sure another query retains the task.
    const allQuery = store.createAndRetainQuery({
        filters: {
            ...defaultTaskQueryNormalizedFilters,
            creatorFilter: {
                type: "OneOf",
                accountIds: assertNonEmptyReadonlySet(new Set([account1.id])),
            },
        },
        sorts: defaultTaskQueryNormalizedSorts,
        limit: 100,
    });

    store.loadTasksIntoQuery(allQuery, {
        limit: 100,
        loadedState: {type: "Full"},
        previouslyBackfilledTaskIds: [],
    });

    const query = store.createAndRetainQuery({
        filters: {
            ...defaultTaskQueryNormalizedFilters,
            creatorFilter: {
                type: "OneOf",
                accountIds: assertNonEmptyReadonlySet(new Set([account1.id])),
            },
            priorityFilter: {
                ifHigh: true,
                ifNull: false,
                ifLow: false,
                ifMedium: false,
                ifUrgent: false,
            },
        },
        sorts: defaultTaskQueryNormalizedSorts,
        limit: 100,
    });

    store.loadTasksIntoQuery(query, {
        limit: 100,
        loadedState: {type: "Full"},
        previouslyBackfilledTaskIds: [],
    });

    expect(query.taskOrderStore.getSnapshot().keys.map(getTaskQuerySortCursorTaskId)).toEqual([]);

    store.applyUpdateEvent({
        type: "Update",
        defaultAuthorizationStateVersion: store.clock.now(),
        actions: [],
        backfillTasks: [{type: "Authorized", task: task}],
        backfillCollections: [],
        referencedAccounts: [],
        referencedSites: [],
        originClientId: null,
    });

    expect(query.taskOrderStore.getSnapshot().keys.map(getTaskQuerySortCursorTaskId)).toEqual([]);

    store.applyUpdateEvent({
        type: "Update",
        defaultAuthorizationStateVersion: store.clock.now(),
        actions: [action],
        backfillTasks: [],
        backfillCollections: [],
        referencedAccounts: [],
        referencedSites: [],
        originClientId: null,
    });

    expect(query.taskOrderStore.getSnapshot().keys.map(getTaskQuerySortCursorTaskId)).toEqual([
        task.id,
    ]);
});

test("task can be removed from a query through an action", () => {
    const store = new TaskClientStore({
        accountRegistry,
        siteRegistry,
        spaceId,
        currentAccountId,
        onError: handleError,
    });

    const task = createTask(store);

    const action1 = {
        type: "UpdateTask",
        time: store.clock.now(),
        taskId: task.id,
        taskAction: {
            type: "UpdatePriority",
            priority: "High",
        },
    } satisfies TaskAction;

    const action2 = {
        type: "UpdateTask",
        time: store.clock.now(),
        taskId: task.id,
        taskAction: {
            type: "UpdatePriority",
            priority: "Low",
        },
    } satisfies TaskAction;

    const query = store.createAndRetainQuery({
        filters: {
            ...defaultTaskQueryNormalizedFilters,
            creatorFilter: {
                type: "OneOf",
                accountIds: assertNonEmptyReadonlySet(new Set([account1.id])),
            },
            priorityFilter: {
                ifHigh: true,
                ifNull: false,
                ifLow: false,
                ifMedium: false,
                ifUrgent: false,
            },
        },
        sorts: defaultTaskQueryNormalizedSorts,
        limit: 100,
    });

    store.loadTasksIntoQuery(query, {
        limit: 100,
        loadedState: {type: "Full"},
        previouslyBackfilledTaskIds: [],
    });

    expect(query.taskOrderStore.getSnapshot().keys.map(getTaskQuerySortCursorTaskId)).toEqual([]);

    store.applyUpdateEvent({
        type: "Update",
        defaultAuthorizationStateVersion: store.clock.now(),
        actions: [],
        backfillTasks: [{type: "Authorized", task: task.applyAction(action1, getSortableAccount)}],
        backfillCollections: [],
        referencedAccounts: [],
        referencedSites: [],
        originClientId: null,
    });

    expect(query.taskOrderStore.getSnapshot().keys.map(getTaskQuerySortCursorTaskId)).toEqual([
        task.id,
    ]);

    store.applyUpdateEvent({
        type: "Update",
        defaultAuthorizationStateVersion: store.clock.now(),
        actions: [action2],
        backfillTasks: [],
        backfillCollections: [],
        referencedAccounts: [],
        referencedSites: [],
        originClientId: null,
    });

    expect(query.taskOrderStore.getSnapshot().keys.map(getTaskQuerySortCursorTaskId)).toEqual([]);
});

test("task can be moved in query through an action", () => {
    const store = new TaskClientStore({
        accountRegistry,
        siteRegistry,
        spaceId,
        currentAccountId,
        onError: handleError,
    });

    const task1 = createTask(store);

    const task2 = createTask(store);

    const task3 = createTask(store);

    const action1 = {
        type: "UpdateTask",
        time: store.clock.now(),
        taskId: task1.id,
        taskAction: {
            type: "UpdatePriority",
            priority: "Medium",
        },
    } satisfies TaskAction;

    const action2 = {
        type: "UpdateTask",
        time: store.clock.now(),
        taskId: task2.id,
        taskAction: {
            type: "UpdatePriority",
            priority: "High",
        },
    } satisfies TaskAction;

    const action3 = {
        type: "UpdateTask",
        time: store.clock.now(),
        taskId: task3.id,
        taskAction: {
            type: "UpdatePriority",
            priority: "Medium",
        },
    } satisfies TaskAction;

    const action4 = {
        type: "UpdateTask",
        time: store.clock.now(),
        taskId: task2.id,
        taskAction: {
            type: "UpdatePriority",
            priority: "Low",
        },
    } satisfies TaskAction;

    const query = store.createAndRetainQuery({
        filters: {
            ...defaultTaskQueryNormalizedFilters,
            creatorFilter: {
                type: "OneOf",
                accountIds: assertNonEmptyReadonlySet(new Set([account1.id])),
            },
        },
        sorts: [
            {type: "Priority", direction: "Ascending", missing: "Last"},
            ...defaultTaskQueryNormalizedSorts,
        ],
        limit: 100,
    });

    store.loadTasksIntoQuery(query, {
        limit: 100,
        loadedState: {type: "Full"},
        previouslyBackfilledTaskIds: [],
    });

    expect(query.taskOrderStore.getSnapshot().keys.map(getTaskQuerySortCursorTaskId)).toEqual([]);

    store.applyUpdateEvent({
        type: "Update",
        defaultAuthorizationStateVersion: store.clock.now(),
        actions: [],
        backfillTasks: [
            {type: "Authorized", task: task1.applyAction(action1, getSortableAccount)},
            {type: "Authorized", task: task2.applyAction(action2, getSortableAccount)},
            {type: "Authorized", task: task3.applyAction(action3, getSortableAccount)},
        ],
        backfillCollections: [],
        referencedAccounts: [],
        referencedSites: [],
        originClientId: null,
    });

    expect(query.taskOrderStore.getSnapshot().keys.map(getTaskQuerySortCursorTaskId)).toEqual([
        task1.id,
        task3.id,
        task2.id,
    ]);

    store.applyUpdateEvent({
        type: "Update",
        defaultAuthorizationStateVersion: store.clock.now(),
        actions: [action4],
        backfillTasks: [],
        backfillCollections: [],
        referencedAccounts: [],
        referencedSites: [],
        originClientId: null,
    });

    expect(query.taskOrderStore.getSnapshot().keys.map(getTaskQuerySortCursorTaskId)).toEqual([
        task2.id,
        task1.id,
        task3.id,
    ]);
});

test("task can be left alone through an action", () => {
    const store = new TaskClientStore({
        accountRegistry,
        siteRegistry,
        spaceId,
        currentAccountId,
        onError: handleError,
    });

    const task1 = createTask(store);

    const task2 = createTask(store);

    const task3 = createTask(store);

    const action1 = {
        type: "UpdateTask",
        time: store.clock.now(),
        taskId: task1.id,
        taskAction: {
            type: "UpdatePriority",
            priority: "Medium",
        },
    } satisfies TaskAction;

    const action2 = {
        type: "UpdateTask",
        time: store.clock.now(),
        taskId: task2.id,
        taskAction: {
            type: "UpdatePriority",
            priority: "High",
        },
    } satisfies TaskAction;

    const action3 = {
        type: "UpdateTask",
        time: store.clock.now(),
        taskId: task3.id,
        taskAction: {
            type: "UpdatePriority",
            priority: "Medium",
        },
    } satisfies TaskAction;

    const action4 = {
        type: "UpdateTask",
        time: store.clock.now(),
        taskId: task2.id,
        taskAction: {
            type: "UpdatePriority",
            priority: "Low",
        },
    } satisfies TaskAction;

    const query = store.createAndRetainQuery({
        filters: {
            ...defaultTaskQueryNormalizedFilters,
            creatorFilter: {
                type: "OneOf",
                accountIds: assertNonEmptyReadonlySet(new Set([account1.id])),
            },
        },
        sorts: defaultTaskQueryNormalizedSorts,
        limit: 100,
    });

    store.loadTasksIntoQuery(query, {
        limit: 100,
        loadedState: {type: "Full"},
        previouslyBackfilledTaskIds: [],
    });

    expect(query.taskOrderStore.getSnapshot().keys.map(getTaskQuerySortCursorTaskId)).toEqual([]);

    store.applyUpdateEvent({
        type: "Update",
        defaultAuthorizationStateVersion: store.clock.now(),
        actions: [],
        backfillTasks: [
            {type: "Authorized", task: task1.applyAction(action1, getSortableAccount)},
            {type: "Authorized", task: task2.applyAction(action2, getSortableAccount)},
            {type: "Authorized", task: task3.applyAction(action3, getSortableAccount)},
        ],
        backfillCollections: [],
        referencedAccounts: [],
        referencedSites: [],
        originClientId: null,
    });

    expect(query.taskOrderStore.getSnapshot().keys.map(getTaskQuerySortCursorTaskId)).toEqual([
        task1.id,
        task2.id,
        task3.id,
    ]);

    store.applyUpdateEvent({
        type: "Update",
        defaultAuthorizationStateVersion: store.clock.now(),
        actions: [action4],
        backfillTasks: [],
        backfillCollections: [],
        referencedAccounts: [],
        referencedSites: [],
        originClientId: null,
    });

    expect(query.taskOrderStore.getSnapshot().keys.map(getTaskQuerySortCursorTaskId)).toEqual([
        task1.id,
        task2.id,
        task3.id,
    ]);
});

test("task references can be added to query through backfill", () => {
    const store = new TaskClientStore({
        accountRegistry,
        siteRegistry,
        spaceId,
        currentAccountId,
        onError: handleError,
    });

    const collection1 = TaskCollectionModel.createFromAction(
        store.spaceId,
        generateId(),
        store.clock.now(),
        {
            type: "Create",
            creatorId: null,
            name: "Test 1",
            accessPolicy: {
                type: "Local",
                accountGrantById: new Map([]),
                defaultGrant: {level: "Manage", generation: 0},
                urlGrant: null,
            },
        },
    );

    const collection2 = TaskCollectionModel.createFromAction(
        store.spaceId,
        generateId(),
        store.clock.now(),
        {
            type: "Create",
            creatorId: null,
            name: "Test 2",
            accessPolicy: {
                type: "Local",
                accountGrantById: new Map([]),
                defaultGrant: {level: "Manage", generation: 0},
                urlGrant: null,
            },
        },
    );

    const collection3 = TaskCollectionModel.createFromAction(
        store.spaceId,
        generateId(),
        store.clock.now(),
        {
            type: "Create",
            creatorId: null,
            name: "Test 3",
            accessPolicy: {
                type: "Local",
                accountGrantById: new Map([]),
                defaultGrant: {level: "Manage", generation: 0},
                urlGrant: null,
            },
        },
    );

    let task3 = createTask(store);

    task3 = task3
        .applyAction(
            {
                type: "UpdateTask",
                time: store.clock.now(),
                taskId: task3.id,
                taskAction: {
                    type: "AddCollection",
                    collectionId: collection1.id,
                    orderKey: initialOrderKey,
                },
            },
            getSortableAccount,
        )
        .applyAction(
            {
                type: "UpdateTask",
                time: store.clock.now(),
                taskId: task3.id,
                taskAction: {
                    type: "AddCollection",
                    collectionId: collection2.id,
                    orderKey: initialOrderKey,
                },
            },
            getSortableAccount,
        );

    let task2 = createTask(store);

    task2 = task2.applyAction(
        {
            type: "UpdateTask",
            time: store.clock.now(),
            taskId: task2.id,
            taskAction: {
                type: "UpdateParentTaskId",
                parentTaskId: task3.id,
            },
        },
        getSortableAccount,
    );

    let task1 = createTask(store);

    task1 = task1
        .applyAction(
            {
                type: "UpdateTask",
                time: store.clock.now(),
                taskId: task1.id,
                taskAction: {
                    type: "UpdateParentTaskId",
                    parentTaskId: task2.id,
                },
            },
            getSortableAccount,
        )
        .applyAction(
            {
                type: "UpdateTask",
                time: store.clock.now(),
                taskId: task1.id,
                taskAction: {
                    type: "UpdatePriority",
                    priority: "High",
                },
            },
            getSortableAccount,
        );

    let task5 = createTask(store);

    task5 = task5
        .applyAction(
            {
                type: "UpdateTask",
                time: store.clock.now(),
                taskId: task5.id,
                taskAction: {
                    type: "UpdatePriority",
                    priority: "High",
                },
            },
            getSortableAccount,
        )
        .applyAction(
            {
                type: "UpdateTask",
                time: store.clock.now(),
                taskId: task5.id,
                taskAction: {
                    type: "AddCollection",
                    collectionId: collection2.id,
                    orderKey: initialOrderKey,
                },
            },
            getSortableAccount,
        )
        .applyAction(
            {
                type: "UpdateTask",
                time: store.clock.now(),
                taskId: task5.id,
                taskAction: {
                    type: "AddCollection",
                    collectionId: collection3.id,
                    orderKey: initialOrderKey,
                },
            },
            getSortableAccount,
        );

    let task4 = createTask(store);

    task4 = task4
        .applyAction(
            {
                type: "UpdateTask",
                time: store.clock.now(),
                taskId: task4.id,
                taskAction: {
                    type: "UpdateParentTaskId",
                    parentTaskId: task5.id,
                },
            },
            getSortableAccount,
        )
        .applyAction(
            {
                type: "UpdateTask",
                time: store.clock.now(),
                taskId: task4.id,
                taskAction: {
                    type: "UpdatePriority",
                    priority: "High",
                },
            },
            getSortableAccount,
        );

    const query = store.createAndRetainQuery({
        filters: {
            ...defaultTaskQueryNormalizedFilters,
            creatorFilter: {
                type: "OneOf",
                accountIds: assertNonEmptyReadonlySet(new Set([account1.id])),
            },
            priorityFilter: {
                ifHigh: true,
                ifNull: false,
                ifLow: false,
                ifMedium: false,
                ifUrgent: false,
            },
        },
        sorts: defaultTaskQueryNormalizedSorts,
        limit: 100,
    });

    store.loadTasksIntoQuery(query, {
        limit: 100,
        loadedState: {type: "Full"},
        previouslyBackfilledTaskIds: [],
    });

    expect(query.taskOrderStore.getSnapshot().keys.map(getTaskQuerySortCursorTaskId)).toEqual([]);

    expect(query.getReferencedTaskIdsForTest()).toEqual(new Set());
    expect(query.getReferencedCollectionIdsForTest()).toEqual(new Set());

    store.applyUpdateEvent({
        type: "Update",
        defaultAuthorizationStateVersion: store.clock.now(),
        actions: [],
        backfillTasks: [
            {type: "Authorized", task: task1},
            {type: "Authorized", task: task2},
            {type: "Authorized", task: task3},
            {type: "Authorized", task: task4},
            {type: "Authorized", task: task5},
        ],
        backfillCollections: [
            {type: "Authorized", collection: collection1},
            {type: "Authorized", collection: collection2},
            {type: "Authorized", collection: collection3},
        ],
        referencedAccounts: [],
        referencedSites: [],
        originClientId: null,
    });

    expect(query.taskOrderStore.getSnapshot().keys.map(getTaskQuerySortCursorTaskId)).toEqual([
        task1.id,
        task5.id,
        task4.id,
    ]);

    expect(query.getReferencedTaskIdsForTest()).toEqual(new Set([task2.id, task3.id, task5.id]));
    expect(query.getReferencedCollectionIdsForTest()).toEqual(
        new Set([collection1.id, collection2.id, collection3.id]),
    );
});

test("task references can be added to query through previous backfill", () => {
    const store = new TaskClientStore({
        accountRegistry,
        siteRegistry,
        spaceId,
        currentAccountId,
        onError: handleError,
    });

    const collection1 = TaskCollectionModel.createFromAction(
        store.spaceId,
        generateId(),
        store.clock.now(),
        {
            type: "Create",
            creatorId: null,
            name: "Test 1",
            accessPolicy: {
                type: "Local",
                accountGrantById: new Map([]),
                defaultGrant: {level: "Manage", generation: 0},
                urlGrant: null,
            },
        },
    );

    const collection2 = TaskCollectionModel.createFromAction(
        store.spaceId,
        generateId(),
        store.clock.now(),
        {
            type: "Create",
            creatorId: null,
            name: "Test 2",
            accessPolicy: {
                type: "Local",
                accountGrantById: new Map([]),
                defaultGrant: {level: "Manage", generation: 0},
                urlGrant: null,
            },
        },
    );

    const collection3 = TaskCollectionModel.createFromAction(
        store.spaceId,
        generateId(),
        store.clock.now(),
        {
            type: "Create",
            creatorId: null,
            name: "Test 3",
            accessPolicy: {
                type: "Local",
                accountGrantById: new Map([]),
                defaultGrant: {level: "Manage", generation: 0},
                urlGrant: null,
            },
        },
    );

    let task3 = createTask(store);

    task3 = task3
        .applyAction(
            {
                type: "UpdateTask",
                time: store.clock.now(),
                taskId: task3.id,
                taskAction: {
                    type: "AddCollection",
                    collectionId: collection1.id,
                    orderKey: initialOrderKey,
                },
            },
            getSortableAccount,
        )
        .applyAction(
            {
                type: "UpdateTask",
                time: store.clock.now(),
                taskId: task3.id,
                taskAction: {
                    type: "AddCollection",
                    collectionId: collection2.id,
                    orderKey: initialOrderKey,
                },
            },
            getSortableAccount,
        );

    let task2 = createTask(store);

    task2 = task2.applyAction(
        {
            type: "UpdateTask",
            time: store.clock.now(),
            taskId: task2.id,
            taskAction: {
                type: "UpdateParentTaskId",
                parentTaskId: task3.id,
            },
        },
        getSortableAccount,
    );

    let task1 = createTask(store);

    task1 = task1
        .applyAction(
            {
                type: "UpdateTask",
                time: store.clock.now(),
                taskId: task1.id,
                taskAction: {
                    type: "UpdateParentTaskId",
                    parentTaskId: task2.id,
                },
            },
            getSortableAccount,
        )
        .applyAction(
            {
                type: "UpdateTask",
                time: store.clock.now(),
                taskId: task1.id,
                taskAction: {
                    type: "UpdatePriority",
                    priority: "High",
                },
            },
            getSortableAccount,
        );

    let task5 = createTask(store);

    task5 = task5
        .applyAction(
            {
                type: "UpdateTask",
                time: store.clock.now(),
                taskId: task5.id,
                taskAction: {
                    type: "UpdatePriority",
                    priority: "High",
                },
            },
            getSortableAccount,
        )
        .applyAction(
            {
                type: "UpdateTask",
                time: store.clock.now(),
                taskId: task5.id,
                taskAction: {
                    type: "AddCollection",
                    collectionId: collection2.id,
                    orderKey: initialOrderKey,
                },
            },
            getSortableAccount,
        )
        .applyAction(
            {
                type: "UpdateTask",
                time: store.clock.now(),
                taskId: task5.id,
                taskAction: {
                    type: "AddCollection",
                    collectionId: collection3.id,
                    orderKey: initialOrderKey,
                },
            },
            getSortableAccount,
        );

    let task4 = createTask(store);

    task4 = task4
        .applyAction(
            {
                type: "UpdateTask",
                time: store.clock.now(),
                taskId: task4.id,
                taskAction: {
                    type: "UpdateParentTaskId",
                    parentTaskId: task5.id,
                },
            },
            getSortableAccount,
        )
        .applyAction(
            {
                type: "UpdateTask",
                time: store.clock.now(),
                taskId: task4.id,
                taskAction: {
                    type: "UpdatePriority",
                    priority: "High",
                },
            },
            getSortableAccount,
        );

    // Make sure another query retains everything.
    const allQuery = store.createAndRetainQuery({
        filters: {
            ...defaultTaskQueryNormalizedFilters,
            creatorFilter: {
                type: "OneOf",
                accountIds: assertNonEmptyReadonlySet(new Set([account1.id])),
            },
        },
        sorts: defaultTaskQueryNormalizedSorts,
        limit: 100,
    });

    store.loadTasksIntoQuery(allQuery, {
        limit: 100,
        loadedState: {type: "Full"},
        previouslyBackfilledTaskIds: [],
    });

    store.applyUpdateEvent({
        type: "Update",
        defaultAuthorizationStateVersion: store.clock.now(),
        actions: [],
        backfillTasks: [
            {type: "Authorized", task: task1},
            {type: "Authorized", task: task2},
            {type: "Authorized", task: task3},
            {type: "Authorized", task: task4},
            {type: "Authorized", task: task5},
        ],
        backfillCollections: [
            {type: "Authorized", collection: collection1},
            {type: "Authorized", collection: collection2},
            {type: "Authorized", collection: collection3},
        ],
        referencedAccounts: [],
        referencedSites: [],
        originClientId: null,
    });

    const query = store.createAndRetainQuery({
        filters: {
            ...defaultTaskQueryNormalizedFilters,
            creatorFilter: {
                type: "OneOf",
                accountIds: assertNonEmptyReadonlySet(new Set([account1.id])),
            },
            priorityFilter: {
                ifHigh: true,
                ifNull: false,
                ifLow: false,
                ifMedium: false,
                ifUrgent: false,
            },
        },
        sorts: defaultTaskQueryNormalizedSorts,
        limit: 100,
    });

    expect(query.taskOrderStore.getSnapshot().keys.map(getTaskQuerySortCursorTaskId)).toEqual([]);

    expect(query.getReferencedTaskIdsForTest()).toEqual(new Set());
    expect(query.getReferencedCollectionIdsForTest()).toEqual(new Set());

    store.loadTasksIntoQuery(query, {
        limit: 100,
        loadedState: {type: "Full"},
        previouslyBackfilledTaskIds: [task1.id, task5.id, task4.id],
    });

    expect(query.taskOrderStore.getSnapshot().keys.map(getTaskQuerySortCursorTaskId)).toEqual([
        task1.id,
        task5.id,
        task4.id,
    ]);

    expect(query.getReferencedTaskIdsForTest()).toEqual(new Set([task2.id, task3.id, task5.id]));
    expect(query.getReferencedCollectionIdsForTest()).toEqual(
        new Set([collection1.id, collection2.id, collection3.id]),
    );
});

test("task references can be added to query through action", () => {
    const store = new TaskClientStore({
        accountRegistry,
        siteRegistry,
        spaceId,
        currentAccountId,
        onError: handleError,
    });

    const collection1 = TaskCollectionModel.createFromAction(
        store.spaceId,
        generateId(),
        store.clock.now(),
        {
            type: "Create",
            creatorId: null,
            name: "Test 1",
            accessPolicy: {
                type: "Local",
                accountGrantById: new Map([]),
                defaultGrant: {level: "Manage", generation: 0},
                urlGrant: null,
            },
        },
    );

    const collection2 = TaskCollectionModel.createFromAction(
        store.spaceId,
        generateId(),
        store.clock.now(),
        {
            type: "Create",
            creatorId: null,
            name: "Test 2",
            accessPolicy: {
                type: "Local",
                accountGrantById: new Map([]),
                defaultGrant: {level: "Manage", generation: 0},
                urlGrant: null,
            },
        },
    );

    const collection3 = TaskCollectionModel.createFromAction(
        store.spaceId,
        generateId(),
        store.clock.now(),
        {
            type: "Create",
            creatorId: null,
            name: "Test 3",
            accessPolicy: {
                type: "Local",
                accountGrantById: new Map([]),
                defaultGrant: {level: "Manage", generation: 0},
                urlGrant: null,
            },
        },
    );

    let task3 = createTask(store);

    task3 = task3
        .applyAction(
            {
                type: "UpdateTask",
                time: store.clock.now(),
                taskId: task3.id,
                taskAction: {
                    type: "AddCollection",
                    collectionId: collection1.id,
                    orderKey: initialOrderKey,
                },
            },
            getSortableAccount,
        )
        .applyAction(
            {
                type: "UpdateTask",
                time: store.clock.now(),
                taskId: task3.id,
                taskAction: {
                    type: "AddCollection",
                    collectionId: collection2.id,
                    orderKey: initialOrderKey,
                },
            },
            getSortableAccount,
        );

    let task2 = createTask(store);

    task2 = task2.applyAction(
        {
            type: "UpdateTask",
            time: store.clock.now(),
            taskId: task2.id,
            taskAction: {
                type: "UpdateParentTaskId",
                parentTaskId: task3.id,
            },
        },
        getSortableAccount,
    );

    let task1 = createTask(store);

    task1 = task1.applyAction(
        {
            type: "UpdateTask",
            time: store.clock.now(),
            taskId: task1.id,
            taskAction: {
                type: "UpdateParentTaskId",
                parentTaskId: task2.id,
            },
        },
        getSortableAccount,
    );

    let task5 = createTask(store);

    task5 = task5
        .applyAction(
            {
                type: "UpdateTask",
                time: store.clock.now(),
                taskId: task5.id,
                taskAction: {
                    type: "AddCollection",
                    collectionId: collection2.id,
                    orderKey: initialOrderKey,
                },
            },
            getSortableAccount,
        )
        .applyAction(
            {
                type: "UpdateTask",
                time: store.clock.now(),
                taskId: task5.id,
                taskAction: {
                    type: "AddCollection",
                    collectionId: collection3.id,
                    orderKey: initialOrderKey,
                },
            },
            getSortableAccount,
        );

    let task4 = createTask(store);

    task4 = task4.applyAction(
        {
            type: "UpdateTask",
            time: store.clock.now(),
            taskId: task4.id,
            taskAction: {
                type: "UpdateParentTaskId",
                parentTaskId: task5.id,
            },
        },
        getSortableAccount,
    );

    const action1: TaskAction = {
        type: "UpdateTask",
        time: store.clock.now(),
        taskId: task4.id,
        taskAction: {
            type: "UpdatePriority",
            priority: "High",
        },
    };

    const action2: TaskAction = {
        type: "UpdateTask",
        time: store.clock.now(),
        taskId: task1.id,
        taskAction: {
            type: "UpdatePriority",
            priority: "High",
        },
    };

    const action3: TaskAction = {
        type: "UpdateTask",
        time: store.clock.now(),
        taskId: task5.id,
        taskAction: {
            type: "UpdatePriority",
            priority: "High",
        },
    };

    const query = store.createAndRetainQuery({
        filters: {
            ...defaultTaskQueryNormalizedFilters,
            creatorFilter: {
                type: "OneOf",
                accountIds: assertNonEmptyReadonlySet(new Set([account1.id])),
            },
            priorityFilter: {
                ifHigh: true,
                ifNull: false,
                ifLow: false,
                ifMedium: false,
                ifUrgent: false,
            },
        },
        sorts: defaultTaskQueryNormalizedSorts,
        limit: 100,
    });

    store.loadTasksIntoQuery(query, {
        limit: 100,
        loadedState: {type: "Full"},
        previouslyBackfilledTaskIds: [],
    });

    expect(query.taskOrderStore.getSnapshot().keys.map(getTaskQuerySortCursorTaskId)).toEqual([]);

    expect(query.getReferencedTaskIdsForTest()).toEqual(new Set());
    expect(query.getReferencedCollectionIdsForTest()).toEqual(new Set());

    store.applyUpdateEvent({
        type: "Update",
        defaultAuthorizationStateVersion: store.clock.now(),
        actions: [],
        backfillTasks: [
            {type: "Authorized", task: task4.applyAction(action1, getSortableAccount)},
            {type: "Authorized", task: task5},
        ],
        backfillCollections: [
            {type: "Authorized", collection: collection2},
            {type: "Authorized", collection: collection3},
        ],
        referencedAccounts: [],
        referencedSites: [],
        originClientId: null,
    });

    expect(query.taskOrderStore.getSnapshot().keys.map(getTaskQuerySortCursorTaskId)).toEqual([
        task4.id,
    ]);

    expect(query.getReferencedTaskIdsForTest()).toEqual(new Set([task5.id]));
    expect(query.getReferencedCollectionIdsForTest()).toEqual(
        new Set([collection2.id, collection3.id]),
    );

    store.applyUpdateEvent({
        type: "Update",
        defaultAuthorizationStateVersion: store.clock.now(),
        actions: [],
        backfillTasks: [
            {type: "Authorized", task: task1.applyAction(action2, getSortableAccount)},
            {type: "Authorized", task: task2},
            {type: "Authorized", task: task3},
        ],
        backfillCollections: [{type: "Authorized", collection: collection1}],
        referencedAccounts: [],
        referencedSites: [],
        originClientId: null,
    });

    expect(query.taskOrderStore.getSnapshot().keys.map(getTaskQuerySortCursorTaskId)).toEqual([
        task1.id,
        task4.id,
    ]);

    expect(query.getReferencedTaskIdsForTest()).toEqual(new Set([task2.id, task3.id, task5.id]));
    expect(query.getReferencedCollectionIdsForTest()).toEqual(
        new Set([collection1.id, collection2.id, collection3.id]),
    );

    store.applyUpdateEvent({
        type: "Update",
        defaultAuthorizationStateVersion: store.clock.now(),
        actions: [action3],
        backfillTasks: [],
        backfillCollections: [],
        referencedAccounts: [],
        referencedSites: [],
        originClientId: null,
    });

    expect(query.taskOrderStore.getSnapshot().keys.map(getTaskQuerySortCursorTaskId)).toEqual([
        task1.id,
        task5.id,
        task4.id,
    ]);

    expect(query.getReferencedTaskIdsForTest()).toEqual(new Set([task2.id, task3.id, task5.id]));
    expect(query.getReferencedCollectionIdsForTest()).toEqual(
        new Set([collection1.id, collection2.id, collection3.id]),
    );
});

test("task references can be removed from query through actions", () => {
    const store = new TaskClientStore({
        accountRegistry,
        siteRegistry,
        spaceId,
        currentAccountId,
        onError: handleError,
    });

    const collection1 = TaskCollectionModel.createFromAction(
        store.spaceId,
        generateId(),
        store.clock.now(),
        {
            type: "Create",
            creatorId: null,
            name: "Test 1",
            accessPolicy: {
                type: "Local",
                accountGrantById: new Map([]),
                defaultGrant: {level: "Manage", generation: 0},
                urlGrant: null,
            },
        },
    );

    const collection2 = TaskCollectionModel.createFromAction(
        store.spaceId,
        generateId(),
        store.clock.now(),
        {
            type: "Create",
            creatorId: null,
            name: "Test 2",
            accessPolicy: {
                type: "Local",
                accountGrantById: new Map([]),
                defaultGrant: {level: "Manage", generation: 0},
                urlGrant: null,
            },
        },
    );

    const collection3 = TaskCollectionModel.createFromAction(
        store.spaceId,
        generateId(),
        store.clock.now(),
        {
            type: "Create",
            creatorId: null,
            name: "Test 3",
            accessPolicy: {
                type: "Local",
                accountGrantById: new Map([]),
                defaultGrant: {level: "Manage", generation: 0},
                urlGrant: null,
            },
        },
    );

    let task3 = createTask(store);

    task3 = task3
        .applyAction(
            {
                type: "UpdateTask",
                time: store.clock.now(),
                taskId: task3.id,
                taskAction: {
                    type: "AddCollection",
                    collectionId: collection1.id,
                    orderKey: initialOrderKey,
                },
            },
            getSortableAccount,
        )
        .applyAction(
            {
                type: "UpdateTask",
                time: store.clock.now(),
                taskId: task3.id,
                taskAction: {
                    type: "AddCollection",
                    collectionId: collection2.id,
                    orderKey: initialOrderKey,
                },
            },
            getSortableAccount,
        );

    let task2 = createTask(store);

    task2 = task2.applyAction(
        {
            type: "UpdateTask",
            time: store.clock.now(),
            taskId: task2.id,
            taskAction: {
                type: "UpdateParentTaskId",
                parentTaskId: task3.id,
            },
        },
        getSortableAccount,
    );

    let task1 = createTask(store);

    task1 = task1
        .applyAction(
            {
                type: "UpdateTask",
                time: store.clock.now(),
                taskId: task1.id,
                taskAction: {
                    type: "UpdateParentTaskId",
                    parentTaskId: task2.id,
                },
            },
            getSortableAccount,
        )
        .applyAction(
            {
                type: "UpdateTask",
                time: store.clock.now(),
                taskId: task1.id,
                taskAction: {
                    type: "UpdatePriority",
                    priority: "High",
                },
            },
            getSortableAccount,
        );

    let task5 = createTask(store);

    task5 = task5
        .applyAction(
            {
                type: "UpdateTask",
                time: store.clock.now(),
                taskId: task5.id,
                taskAction: {
                    type: "UpdatePriority",
                    priority: "High",
                },
            },
            getSortableAccount,
        )
        .applyAction(
            {
                type: "UpdateTask",
                time: store.clock.now(),
                taskId: task5.id,
                taskAction: {
                    type: "AddCollection",
                    collectionId: collection3.id,
                    orderKey: initialOrderKey,
                },
            },
            getSortableAccount,
        );

    let task4 = createTask(store);

    task4 = task4
        .applyAction(
            {
                type: "UpdateTask",
                time: store.clock.now(),
                taskId: task4.id,
                taskAction: {
                    type: "UpdateParentTaskId",
                    parentTaskId: task5.id,
                },
            },
            getSortableAccount,
        )
        .applyAction(
            {
                type: "UpdateTask",
                time: store.clock.now(),
                taskId: task4.id,
                taskAction: {
                    type: "AddCollection",
                    collectionId: collection2.id,
                    orderKey: initialOrderKey,
                },
            },
            getSortableAccount,
        )
        .applyAction(
            {
                type: "UpdateTask",
                time: store.clock.now(),
                taskId: task4.id,
                taskAction: {
                    type: "UpdatePriority",
                    priority: "High",
                },
            },
            getSortableAccount,
        );

    const action1: TaskAction = {
        type: "UpdateTask",
        time: store.clock.now(),
        taskId: task4.id,
        taskAction: {
            type: "UpdatePriority",
            priority: "Low",
        },
    };

    const action2: TaskAction = {
        type: "UpdateTask",
        time: store.clock.now(),
        taskId: task1.id,
        taskAction: {
            type: "UpdatePriority",
            priority: "Low",
        },
    };

    const action3: TaskAction = {
        type: "UpdateTask",
        time: store.clock.now(),
        taskId: task5.id,
        taskAction: {
            type: "UpdatePriority",
            priority: "Low",
        },
    };

    const query = store.createAndRetainQuery({
        filters: {
            ...defaultTaskQueryNormalizedFilters,
            creatorFilter: {
                type: "OneOf",
                accountIds: assertNonEmptyReadonlySet(new Set([account1.id])),
            },
            priorityFilter: {
                ifHigh: true,
                ifNull: false,
                ifLow: false,
                ifMedium: false,
                ifUrgent: false,
            },
        },
        sorts: defaultTaskQueryNormalizedSorts,
        limit: 100,
    });

    store.loadTasksIntoQuery(query, {
        limit: 100,
        loadedState: {type: "Full"},
        previouslyBackfilledTaskIds: [],
    });

    expect(query.taskOrderStore.getSnapshot().keys.map(getTaskQuerySortCursorTaskId)).toEqual([]);

    expect(query.getReferencedTaskIdsForTest()).toEqual(new Set());
    expect(query.getReferencedCollectionIdsForTest()).toEqual(new Set());

    store.applyUpdateEvent({
        type: "Update",
        defaultAuthorizationStateVersion: store.clock.now(),
        actions: [],
        backfillTasks: [
            {type: "Authorized", task: task1},
            {type: "Authorized", task: task2},
            {type: "Authorized", task: task3},
            {type: "Authorized", task: task4},
            {type: "Authorized", task: task5},
        ],
        backfillCollections: [
            {type: "Authorized", collection: collection1},
            {type: "Authorized", collection: collection2},
            {type: "Authorized", collection: collection3},
        ],
        referencedAccounts: [],
        referencedSites: [],
        originClientId: null,
    });

    expect(query.taskOrderStore.getSnapshot().keys.map(getTaskQuerySortCursorTaskId)).toEqual([
        task1.id,
        task5.id,
        task4.id,
    ]);

    expect(query.getReferencedTaskIdsForTest()).toEqual(new Set([task2.id, task3.id, task5.id]));
    expect(query.getReferencedCollectionIdsForTest()).toEqual(
        new Set([collection1.id, collection2.id, collection3.id]),
    );

    store.applyUpdateEvent({
        type: "Update",
        defaultAuthorizationStateVersion: store.clock.now(),
        actions: [action1],
        backfillTasks: [],
        backfillCollections: [],
        referencedAccounts: [],
        referencedSites: [],
        originClientId: null,
    });

    expect(query.taskOrderStore.getSnapshot().keys.map(getTaskQuerySortCursorTaskId)).toEqual([
        task1.id,
        task5.id,
    ]);

    expect(query.getReferencedTaskIdsForTest()).toEqual(new Set([task2.id, task3.id]));
    expect(query.getReferencedCollectionIdsForTest()).toEqual(
        new Set([collection1.id, collection2.id, collection3.id]),
    );

    store.applyUpdateEvent({
        type: "Update",
        defaultAuthorizationStateVersion: store.clock.now(),
        actions: [action2],
        backfillTasks: [],
        backfillCollections: [],
        referencedAccounts: [],
        referencedSites: [],
        originClientId: null,
    });

    expect(query.taskOrderStore.getSnapshot().keys.map(getTaskQuerySortCursorTaskId)).toEqual([
        task5.id,
    ]);

    expect(query.getReferencedTaskIdsForTest()).toEqual(new Set([]));
    expect(query.getReferencedCollectionIdsForTest()).toEqual(new Set([collection3.id]));

    store.applyUpdateEvent({
        type: "Update",
        defaultAuthorizationStateVersion: store.clock.now(),
        actions: [action3],
        backfillTasks: [],
        backfillCollections: [],
        referencedAccounts: [],
        referencedSites: [],
        originClientId: null,
    });

    expect(query.taskOrderStore.getSnapshot().keys.map(getTaskQuerySortCursorTaskId)).toEqual([]);

    expect(query.getReferencedTaskIdsForTest()).toEqual(new Set([]));
    expect(query.getReferencedCollectionIdsForTest()).toEqual(new Set([]));
});

test("references from optimistic task can be removed", async () => {
    const store = new TaskClientStore({
        accountRegistry,
        siteRegistry,
        spaceId,
        currentAccountId,
        onError: handleError,
    });

    const collection1 = TaskCollectionModel.createFromAction(
        store.spaceId,
        generateId(),
        store.clock.now(),
        {
            type: "Create",
            creatorId: null,
            name: "Test 1",
            accessPolicy: {
                type: "Local",
                accountGrantById: new Map([]),
                defaultGrant: {level: "Manage", generation: 0},
                urlGrant: null,
            },
        },
    );

    const collection2 = TaskCollectionModel.createFromAction(
        store.spaceId,
        generateId(),
        store.clock.now(),
        {
            type: "Create",
            creatorId: null,
            name: "Test 2",
            accessPolicy: {
                type: "Local",
                accountGrantById: new Map([]),
                defaultGrant: {level: "Manage", generation: 0},
                urlGrant: null,
            },
        },
    );

    const collection3 = TaskCollectionModel.createFromAction(
        store.spaceId,
        generateId(),
        store.clock.now(),
        {
            type: "Create",
            creatorId: null,
            name: "Test 3",
            accessPolicy: {
                type: "Local",
                accountGrantById: new Map([]),
                defaultGrant: {level: "Manage", generation: 0},
                urlGrant: null,
            },
        },
    );

    let task3 = createTask(store);

    task3 = task3
        .applyAction(
            {
                type: "UpdateTask",
                time: store.clock.now(),
                taskId: task3.id,
                taskAction: {
                    type: "AddCollection",
                    collectionId: collection1.id,
                    orderKey: initialOrderKey,
                },
            },
            getSortableAccount,
        )
        .applyAction(
            {
                type: "UpdateTask",
                time: store.clock.now(),
                taskId: task3.id,
                taskAction: {
                    type: "AddCollection",
                    collectionId: collection2.id,
                    orderKey: initialOrderKey,
                },
            },
            getSortableAccount,
        );

    let task2 = createTask(store);

    task2 = task2.applyAction(
        {
            type: "UpdateTask",
            time: store.clock.now(),
            taskId: task2.id,
            taskAction: {
                type: "UpdateParentTaskId",
                parentTaskId: task3.id,
            },
        },
        getSortableAccount,
    );

    let task1 = createTask(store);

    task1 = task1
        .applyAction(
            {
                type: "UpdateTask",
                time: store.clock.now(),
                taskId: task1.id,
                taskAction: {
                    type: "UpdateParentTaskId",
                    parentTaskId: task2.id,
                },
            },
            getSortableAccount,
        )
        .applyAction(
            {
                type: "UpdateTask",
                time: store.clock.now(),
                taskId: task1.id,
                taskAction: {
                    type: "UpdatePriority",
                    priority: "High",
                },
            },
            getSortableAccount,
        );

    let task5 = createTask(store);

    task5 = task5.applyAction(
        {
            type: "UpdateTask",
            time: store.clock.now(),
            taskId: task5.id,
            taskAction: {
                type: "AddCollection",
                collectionId: collection3.id,
                orderKey: initialOrderKey,
            },
        },
        getSortableAccount,
    );

    // Make sure another query retains everything.
    const allQuery = store.createAndRetainQuery({
        filters: {
            ...defaultTaskQueryNormalizedFilters,
            creatorFilter: {
                type: "OneOf",
                accountIds: assertNonEmptyReadonlySet(new Set([account1.id])),
            },
        },
        sorts: defaultTaskQueryNormalizedSorts,
        limit: 100,
    });

    store.loadTasksIntoQuery(allQuery, {
        limit: 100,
        loadedState: {type: "Full"},
        previouslyBackfilledTaskIds: [],
    });

    const query = store.createAndRetainQuery({
        filters: {
            ...defaultTaskQueryNormalizedFilters,
            creatorFilter: {
                type: "OneOf",
                accountIds: assertNonEmptyReadonlySet(new Set([account1.id])),
            },
            priorityFilter: {
                ifHigh: true,
                ifNull: false,
                ifLow: false,
                ifMedium: false,
                ifUrgent: false,
            },
        },
        sorts: defaultTaskQueryNormalizedSorts,
        limit: 100,
    });

    store.loadTasksIntoQuery(query, {
        limit: 100,
        loadedState: {type: "Full"},
        previouslyBackfilledTaskIds: [],
    });

    expect(query.taskOrderStore.getSnapshot().keys.map(getTaskQuerySortCursorTaskId)).toEqual([]);

    expect(query.getReferencedTaskIdsForTest()).toEqual(new Set());
    expect(query.getReferencedCollectionIdsForTest()).toEqual(new Set());

    store.applyUpdateEvent({
        type: "Update",
        defaultAuthorizationStateVersion: store.clock.now(),
        actions: [],
        backfillTasks: [
            {type: "Authorized", task: task1},
            {type: "Authorized", task: task2},
            {type: "Authorized", task: task3},
        ],
        backfillCollections: [
            {type: "Authorized", collection: collection1},
            {type: "Authorized", collection: collection2},
        ],
        referencedAccounts: [],
        referencedSites: [],
        originClientId: null,
    });

    expect(query.taskOrderStore.getSnapshot().keys.map(getTaskQuerySortCursorTaskId)).toEqual([
        task1.id,
    ]);

    expect(query.getReferencedTaskIdsForTest()).toEqual(new Set([task2.id, task3.id]));
    expect(query.getReferencedCollectionIdsForTest()).toEqual(
        new Set([collection1.id, collection2.id]),
    );

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

    const task4 = createTask(store, {
        id: action1.taskId,
        time: action1.time,
        taskAction: action1.taskAction,
    });

    const action2: TaskActionModel = {
        type: "UpdateTask",
        time: store.clock.now(),
        taskId: task4.id,
        taskAction: {
            type: "UpdateParentTaskId",
            parentTaskId: task5.id,
        },
    };

    const action3: TaskActionModel = {
        type: "UpdateTask",
        time: store.clock.now(),
        taskId: task4.id,
        taskAction: {
            type: "AddCollection",
            collectionId: collection2.id,
            orderKey: initialOrderKey,
        },
    };

    const action4: TaskActionModel = {
        type: "UpdateTask",
        time: store.clock.now(),
        taskId: task4.id,
        taskAction: {
            type: "UpdatePriority",
            priority: "High",
        },
    };

    store.applyUpdateEvent({
        type: "Update",
        defaultAuthorizationStateVersion: store.clock.now(),
        actions: [],
        backfillTasks: [{type: "Authorized", task: task5}],
        backfillCollections: [{type: "Authorized", collection: collection3}],
        referencedAccounts: [],
        referencedSites: [],
        originClientId: null,
    });

    expect(query.taskOrderStore.getSnapshot().keys.map(getTaskQuerySortCursorTaskId)).toEqual([
        task1.id,
    ]);

    expect(query.getReferencedTaskIdsForTest()).toEqual(new Set([task2.id, task3.id]));
    expect(query.getReferencedCollectionIdsForTest()).toEqual(
        new Set([collection1.id, collection2.id]),
    );

    store.commitTaskActionTransaction(context, [action1, action2, action3, action4], {
        undoManager: null,
        affinityManager: noopAffinityManager,
    });

    expect(query.taskOrderStore.getSnapshot().keys.map(getTaskQuerySortCursorTaskId)).toEqual([
        task1.id,
        task4.id,
    ]);

    expect(query.getReferencedTaskIdsForTest()).toEqual(new Set([task2.id, task3.id, task5.id]));
    expect(query.getReferencedCollectionIdsForTest()).toEqual(
        new Set([collection1.id, collection2.id, collection3.id]),
    );

    await rejectLastRpcExecution(commitTaskActionTransaction);

    expect(query.taskOrderStore.getSnapshot().keys.map(getTaskQuerySortCursorTaskId)).toEqual([
        task1.id,
    ]);

    expect(query.getReferencedTaskIdsForTest()).toEqual(new Set([task2.id, task3.id]));
    expect(query.getReferencedCollectionIdsForTest()).toEqual(
        new Set([collection1.id, collection2.id]),
    );

    expect(errors.length).toEqual(1);
    errors = [];
});

test("task references can be added and removed through actions", () => {
    const store = new TaskClientStore({
        accountRegistry,
        siteRegistry,
        spaceId,
        currentAccountId,
        onError: handleError,
    });

    const collection1 = TaskCollectionModel.createFromAction(
        store.spaceId,
        generateId(),
        store.clock.now(),
        {
            type: "Create",
            creatorId: null,
            name: "Test 1",
            accessPolicy: {
                type: "Local",
                accountGrantById: new Map([]),
                defaultGrant: {level: "Manage", generation: 0},
                urlGrant: null,
            },
        },
    );

    const collection2 = TaskCollectionModel.createFromAction(
        store.spaceId,
        generateId(),
        store.clock.now(),
        {
            type: "Create",
            creatorId: null,
            name: "Test 2",
            accessPolicy: {
                type: "Local",
                accountGrantById: new Map([]),
                defaultGrant: {level: "Manage", generation: 0},
                urlGrant: null,
            },
        },
    );

    const collection3 = TaskCollectionModel.createFromAction(
        store.spaceId,
        generateId(),
        store.clock.now(),
        {
            type: "Create",
            creatorId: null,
            name: "Test 3",
            accessPolicy: {
                type: "Local",
                accountGrantById: new Map([]),
                defaultGrant: {level: "Manage", generation: 0},
                urlGrant: null,
            },
        },
    );

    let task2 = createTask(store);

    task2 = task2.applyAction(
        {
            type: "UpdateTask",
            time: store.clock.now(),
            taskId: task2.id,
            taskAction: {
                type: "AddCollection",
                collectionId: collection2.id,
                orderKey: initialOrderKey,
            },
        },
        getSortableAccount,
    );

    let task3 = createTask(store);

    task3 = task3.applyAction(
        {
            type: "UpdateTask",
            time: store.clock.now(),
            taskId: task3.id,
            taskAction: {
                type: "AddCollection",
                collectionId: collection3.id,
                orderKey: initialOrderKey,
            },
        },
        getSortableAccount,
    );

    let task1 = createTask(store);

    task1 = task1.applyAction(
        {
            type: "UpdateTask",
            time: store.clock.now(),
            taskId: task1.id,
            taskAction: {
                type: "UpdatePriority",
                priority: "High",
            },
        },
        getSortableAccount,
    );

    const action1: TaskAction = {
        type: "UpdateTask",
        time: store.clock.now(),
        taskId: task1.id,
        taskAction: {
            type: "UpdateParentTaskId",
            parentTaskId: task2.id,
        },
    };

    const action2: TaskAction = {
        type: "UpdateTask",
        time: store.clock.now(),
        taskId: task1.id,
        taskAction: {
            type: "UpdateParentTaskId",
            parentTaskId: task3.id,
        },
    };

    const action3: TaskAction = {
        type: "UpdateTask",
        time: store.clock.now(),
        taskId: task1.id,
        taskAction: {
            type: "AddCollection",
            collectionId: collection1.id,
            orderKey: initialOrderKey,
        },
    };

    const action4: TaskAction = {
        type: "UpdateTask",
        time: store.clock.now(),
        taskId: task1.id,
        taskAction: {
            type: "RemoveCollection",
            collectionId: collection1.id,
        },
    };

    const action5: TaskAction = {
        type: "UpdateTask",
        time: store.clock.now(),
        taskId: task1.id,
        taskAction: {
            type: "UpdateParentTaskId",
            parentTaskId: null,
        },
    };

    const query = store.createAndRetainQuery({
        filters: {
            ...defaultTaskQueryNormalizedFilters,
            creatorFilter: {
                type: "OneOf",
                accountIds: assertNonEmptyReadonlySet(new Set([account1.id])),
            },
            priorityFilter: {
                ifHigh: true,
                ifNull: false,
                ifLow: false,
                ifMedium: false,
                ifUrgent: false,
            },
        },
        sorts: defaultTaskQueryNormalizedSorts,
        limit: 100,
    });

    store.loadTasksIntoQuery(query, {
        limit: 100,
        loadedState: {type: "Full"},
        previouslyBackfilledTaskIds: [],
    });

    expect(query.taskOrderStore.getSnapshot().keys.map(getTaskQuerySortCursorTaskId)).toEqual([]);

    expect(query.getReferencedTaskIdsForTest()).toEqual(new Set());
    expect(query.getReferencedCollectionIdsForTest()).toEqual(new Set());

    store.applyUpdateEvent({
        type: "Update",
        defaultAuthorizationStateVersion: store.clock.now(),
        actions: [],
        backfillTasks: [{type: "Authorized", task: task1}],
        backfillCollections: [],
        referencedAccounts: [],
        referencedSites: [],
        originClientId: null,
    });

    expect(query.taskOrderStore.getSnapshot().keys.map(getTaskQuerySortCursorTaskId)).toEqual([
        task1.id,
    ]);

    expect(query.getReferencedTaskIdsForTest()).toEqual(new Set([]));
    expect(query.getReferencedCollectionIdsForTest()).toEqual(new Set([]));

    store.applyUpdateEvent({
        type: "Update",
        defaultAuthorizationStateVersion: store.clock.now(),
        actions: [action1],
        backfillTasks: [{type: "Authorized", task: task2}],
        backfillCollections: [{type: "Authorized", collection: collection2}],
        referencedAccounts: [],
        referencedSites: [],
        originClientId: null,
    });

    expect(query.taskOrderStore.getSnapshot().keys.map(getTaskQuerySortCursorTaskId)).toEqual([
        task1.id,
    ]);

    expect(query.getReferencedTaskIdsForTest()).toEqual(new Set([task2.id]));
    expect(query.getReferencedCollectionIdsForTest()).toEqual(new Set([collection2.id]));

    store.applyUpdateEvent({
        type: "Update",
        defaultAuthorizationStateVersion: store.clock.now(),
        actions: [action2],
        backfillTasks: [{type: "Authorized", task: task3}],
        backfillCollections: [{type: "Authorized", collection: collection3}],
        referencedAccounts: [],
        referencedSites: [],
        originClientId: null,
    });

    expect(query.taskOrderStore.getSnapshot().keys.map(getTaskQuerySortCursorTaskId)).toEqual([
        task1.id,
    ]);

    expect(query.getReferencedTaskIdsForTest()).toEqual(new Set([task3.id]));
    expect(query.getReferencedCollectionIdsForTest()).toEqual(new Set([collection3.id]));

    store.applyUpdateEvent({
        type: "Update",
        defaultAuthorizationStateVersion: store.clock.now(),
        actions: [action3],
        backfillTasks: [],
        backfillCollections: [{type: "Authorized", collection: collection1}],
        referencedAccounts: [],
        referencedSites: [],
        originClientId: null,
    });

    expect(query.taskOrderStore.getSnapshot().keys.map(getTaskQuerySortCursorTaskId)).toEqual([
        task1.id,
    ]);

    expect(query.getReferencedTaskIdsForTest()).toEqual(new Set([task3.id]));
    expect(query.getReferencedCollectionIdsForTest()).toEqual(
        new Set([collection3.id, collection1.id]),
    );

    store.applyUpdateEvent({
        type: "Update",
        defaultAuthorizationStateVersion: store.clock.now(),
        actions: [action4],
        backfillTasks: [],
        backfillCollections: [],
        referencedAccounts: [],
        referencedSites: [],
        originClientId: null,
    });

    expect(query.taskOrderStore.getSnapshot().keys.map(getTaskQuerySortCursorTaskId)).toEqual([
        task1.id,
    ]);

    expect(query.getReferencedTaskIdsForTest()).toEqual(new Set([task3.id]));
    expect(query.getReferencedCollectionIdsForTest()).toEqual(new Set([collection3.id]));

    store.applyUpdateEvent({
        type: "Update",
        defaultAuthorizationStateVersion: store.clock.now(),
        actions: [action5],
        backfillTasks: [],
        backfillCollections: [],
        referencedAccounts: [],
        referencedSites: [],
        originClientId: null,
    });

    expect(query.taskOrderStore.getSnapshot().keys.map(getTaskQuerySortCursorTaskId)).toEqual([
        task1.id,
    ]);

    expect(query.getReferencedTaskIdsForTest()).toEqual(new Set([]));
    expect(query.getReferencedCollectionIdsForTest()).toEqual(new Set([]));
});

test("task references can be added and removed through actions on a referenced task", () => {
    const store = new TaskClientStore({
        accountRegistry,
        siteRegistry,
        spaceId,
        currentAccountId,
        onError: handleError,
    });

    const collection1 = TaskCollectionModel.createFromAction(
        store.spaceId,
        generateId(),
        store.clock.now(),
        {
            type: "Create",
            creatorId: null,
            name: "Test 1",
            accessPolicy: {
                type: "Local",
                accountGrantById: new Map([]),
                defaultGrant: {level: "Manage", generation: 0},
                urlGrant: null,
            },
        },
    );

    const collection2 = TaskCollectionModel.createFromAction(
        store.spaceId,
        generateId(),
        store.clock.now(),
        {
            type: "Create",
            creatorId: null,
            name: "Test 2",
            accessPolicy: {
                type: "Local",
                accountGrantById: new Map([]),
                defaultGrant: {level: "Manage", generation: 0},
                urlGrant: null,
            },
        },
    );

    const collection3 = TaskCollectionModel.createFromAction(
        store.spaceId,
        generateId(),
        store.clock.now(),
        {
            type: "Create",
            creatorId: null,
            name: "Test 3",
            accessPolicy: {
                type: "Local",
                accountGrantById: new Map([]),
                defaultGrant: {level: "Manage", generation: 0},
                urlGrant: null,
            },
        },
    );

    let task3 = createTask(store);

    task3 = task3.applyAction(
        {
            type: "UpdateTask",
            time: store.clock.now(),
            taskId: task3.id,
            taskAction: {
                type: "AddCollection",
                collectionId: collection2.id,
                orderKey: initialOrderKey,
            },
        },
        getSortableAccount,
    );

    let task4 = createTask(store);

    task4 = task4.applyAction(
        {
            type: "UpdateTask",
            time: store.clock.now(),
            taskId: task4.id,
            taskAction: {
                type: "AddCollection",
                collectionId: collection3.id,
                orderKey: initialOrderKey,
            },
        },
        getSortableAccount,
    );

    const task2 = createTask(store);

    let task1 = createTask(store);

    task1 = task1
        .applyAction(
            {
                type: "UpdateTask",
                time: store.clock.now(),
                taskId: task1.id,
                taskAction: {
                    type: "UpdateParentTaskId",
                    parentTaskId: task2.id,
                },
            },
            getSortableAccount,
        )
        .applyAction(
            {
                type: "UpdateTask",
                time: store.clock.now(),
                taskId: task1.id,
                taskAction: {
                    type: "UpdatePriority",
                    priority: "High",
                },
            },
            getSortableAccount,
        );

    const action1: TaskAction = {
        type: "UpdateTask",
        time: store.clock.now(),
        taskId: task2.id,
        taskAction: {
            type: "UpdateParentTaskId",
            parentTaskId: task3.id,
        },
    };

    const action2: TaskAction = {
        type: "UpdateTask",
        time: store.clock.now(),
        taskId: task2.id,
        taskAction: {
            type: "UpdateParentTaskId",
            parentTaskId: task4.id,
        },
    };

    const action3: TaskAction = {
        type: "UpdateTask",
        time: store.clock.now(),
        taskId: task2.id,
        taskAction: {
            type: "AddCollection",
            collectionId: collection1.id,
            orderKey: initialOrderKey,
        },
    };

    const action4: TaskAction = {
        type: "UpdateTask",
        time: store.clock.now(),
        taskId: task2.id,
        taskAction: {
            type: "RemoveCollection",
            collectionId: collection1.id,
        },
    };

    const action5: TaskAction = {
        type: "UpdateTask",
        time: store.clock.now(),
        taskId: task2.id,
        taskAction: {
            type: "UpdateParentTaskId",
            parentTaskId: null,
        },
    };

    const query = store.createAndRetainQuery({
        filters: {
            ...defaultTaskQueryNormalizedFilters,
            creatorFilter: {
                type: "OneOf",
                accountIds: assertNonEmptyReadonlySet(new Set([account1.id])),
            },
            priorityFilter: {
                ifHigh: true,
                ifNull: false,
                ifLow: false,
                ifMedium: false,
                ifUrgent: false,
            },
        },
        sorts: defaultTaskQueryNormalizedSorts,
        limit: 100,
    });

    store.loadTasksIntoQuery(query, {
        limit: 100,
        loadedState: {type: "Full"},
        previouslyBackfilledTaskIds: [],
    });

    expect(query.taskOrderStore.getSnapshot().keys.map(getTaskQuerySortCursorTaskId)).toEqual([]);

    expect(query.getReferencedTaskIdsForTest()).toEqual(new Set());
    expect(query.getReferencedCollectionIdsForTest()).toEqual(new Set());

    store.applyUpdateEvent({
        type: "Update",
        defaultAuthorizationStateVersion: store.clock.now(),
        actions: [],
        backfillTasks: [
            {type: "Authorized", task: task1},
            {type: "Authorized", task: task2},
        ],
        backfillCollections: [],
        referencedAccounts: [],
        referencedSites: [],
        originClientId: null,
    });

    expect(query.taskOrderStore.getSnapshot().keys.map(getTaskQuerySortCursorTaskId)).toEqual([
        task1.id,
    ]);

    expect(query.getReferencedTaskIdsForTest()).toEqual(new Set([task2.id]));
    expect(query.getReferencedCollectionIdsForTest()).toEqual(new Set([]));

    store.applyUpdateEvent({
        type: "Update",
        defaultAuthorizationStateVersion: store.clock.now(),
        actions: [action1],
        backfillTasks: [{type: "Authorized", task: task3}],
        backfillCollections: [{type: "Authorized", collection: collection2}],
        referencedAccounts: [],
        referencedSites: [],
        originClientId: null,
    });

    expect(query.taskOrderStore.getSnapshot().keys.map(getTaskQuerySortCursorTaskId)).toEqual([
        task1.id,
    ]);

    expect(query.getReferencedTaskIdsForTest()).toEqual(new Set([task2.id, task3.id]));
    expect(query.getReferencedCollectionIdsForTest()).toEqual(new Set([collection2.id]));

    store.applyUpdateEvent({
        type: "Update",
        defaultAuthorizationStateVersion: store.clock.now(),
        actions: [action2],
        backfillTasks: [{type: "Authorized", task: task4}],
        backfillCollections: [{type: "Authorized", collection: collection3}],
        referencedAccounts: [],
        referencedSites: [],
        originClientId: null,
    });

    expect(query.taskOrderStore.getSnapshot().keys.map(getTaskQuerySortCursorTaskId)).toEqual([
        task1.id,
    ]);

    expect(query.getReferencedTaskIdsForTest()).toEqual(new Set([task2.id, task4.id]));
    expect(query.getReferencedCollectionIdsForTest()).toEqual(new Set([collection3.id]));

    store.applyUpdateEvent({
        type: "Update",
        defaultAuthorizationStateVersion: store.clock.now(),
        actions: [action3],
        backfillTasks: [],
        backfillCollections: [{type: "Authorized", collection: collection1}],
        referencedAccounts: [],
        referencedSites: [],
        originClientId: null,
    });

    expect(query.taskOrderStore.getSnapshot().keys.map(getTaskQuerySortCursorTaskId)).toEqual([
        task1.id,
    ]);

    expect(query.getReferencedTaskIdsForTest()).toEqual(new Set([task2.id, task4.id]));
    expect(query.getReferencedCollectionIdsForTest()).toEqual(
        new Set([collection3.id, collection1.id]),
    );

    store.applyUpdateEvent({
        type: "Update",
        defaultAuthorizationStateVersion: store.clock.now(),
        actions: [action4],
        backfillTasks: [],
        backfillCollections: [],
        referencedAccounts: [],
        referencedSites: [],
        originClientId: null,
    });

    expect(query.taskOrderStore.getSnapshot().keys.map(getTaskQuerySortCursorTaskId)).toEqual([
        task1.id,
    ]);

    expect(query.getReferencedTaskIdsForTest()).toEqual(new Set([task2.id, task4.id]));
    expect(query.getReferencedCollectionIdsForTest()).toEqual(new Set([collection3.id]));

    store.applyUpdateEvent({
        type: "Update",
        defaultAuthorizationStateVersion: store.clock.now(),
        actions: [action5],
        backfillTasks: [],
        backfillCollections: [],
        referencedAccounts: [],
        referencedSites: [],
        originClientId: null,
    });

    expect(query.taskOrderStore.getSnapshot().keys.map(getTaskQuerySortCursorTaskId)).toEqual([
        task1.id,
    ]);

    expect(query.getReferencedTaskIdsForTest()).toEqual(new Set([task2.id]));
    expect(query.getReferencedCollectionIdsForTest()).toEqual(new Set([]));
});

test("task references can be added and removed through actions on a task that\u2019s both loaded and referenced", () => {
    const store = new TaskClientStore({
        accountRegistry,
        siteRegistry,
        spaceId,
        currentAccountId,
        onError: handleError,
    });

    const collection1 = TaskCollectionModel.createFromAction(
        store.spaceId,
        generateId(),
        store.clock.now(),
        {
            type: "Create",
            creatorId: null,
            name: "Test 1",
            accessPolicy: {
                type: "Local",
                accountGrantById: new Map([]),
                defaultGrant: {level: "Manage", generation: 0},
                urlGrant: null,
            },
        },
    );

    const collection2 = TaskCollectionModel.createFromAction(
        store.spaceId,
        generateId(),
        store.clock.now(),
        {
            type: "Create",
            creatorId: null,
            name: "Test 2",
            accessPolicy: {
                type: "Local",
                accountGrantById: new Map([]),
                defaultGrant: {level: "Manage", generation: 0},
                urlGrant: null,
            },
        },
    );

    const collection3 = TaskCollectionModel.createFromAction(
        store.spaceId,
        generateId(),
        store.clock.now(),
        {
            type: "Create",
            creatorId: null,
            name: "Test 3",
            accessPolicy: {
                type: "Local",
                accountGrantById: new Map([]),
                defaultGrant: {level: "Manage", generation: 0},
                urlGrant: null,
            },
        },
    );

    let task3 = createTask(store);

    task3 = task3.applyAction(
        {
            type: "UpdateTask",
            time: store.clock.now(),
            taskId: task3.id,
            taskAction: {
                type: "AddCollection",
                collectionId: collection2.id,
                orderKey: initialOrderKey,
            },
        },
        getSortableAccount,
    );

    let task4 = createTask(store);

    task4 = task4.applyAction(
        {
            type: "UpdateTask",
            time: store.clock.now(),
            taskId: task4.id,
            taskAction: {
                type: "AddCollection",
                collectionId: collection3.id,
                orderKey: initialOrderKey,
            },
        },
        getSortableAccount,
    );

    let task2 = createTask(store);

    task2 = task2.applyAction(
        {
            type: "UpdateTask",
            time: store.clock.now(),
            taskId: task2.id,
            taskAction: {
                type: "UpdatePriority",
                priority: "High",
            },
        },
        getSortableAccount,
    );

    let task1 = createTask(store);

    task1 = task1
        .applyAction(
            {
                type: "UpdateTask",
                time: store.clock.now(),
                taskId: task1.id,
                taskAction: {
                    type: "UpdateParentTaskId",
                    parentTaskId: task2.id,
                },
            },
            getSortableAccount,
        )
        .applyAction(
            {
                type: "UpdateTask",
                time: store.clock.now(),
                taskId: task1.id,
                taskAction: {
                    type: "UpdatePriority",
                    priority: "High",
                },
            },
            getSortableAccount,
        );

    const action1: TaskAction = {
        type: "UpdateTask",
        time: store.clock.now(),
        taskId: task2.id,
        taskAction: {
            type: "UpdateParentTaskId",
            parentTaskId: task3.id,
        },
    };

    const action2: TaskAction = {
        type: "UpdateTask",
        time: store.clock.now(),
        taskId: task2.id,
        taskAction: {
            type: "UpdateParentTaskId",
            parentTaskId: task4.id,
        },
    };

    const action3: TaskAction = {
        type: "UpdateTask",
        time: store.clock.now(),
        taskId: task2.id,
        taskAction: {
            type: "AddCollection",
            collectionId: collection1.id,
            orderKey: initialOrderKey,
        },
    };

    const action4: TaskAction = {
        type: "UpdateTask",
        time: store.clock.now(),
        taskId: task2.id,
        taskAction: {
            type: "RemoveCollection",
            collectionId: collection1.id,
        },
    };

    const action5: TaskAction = {
        type: "UpdateTask",
        time: store.clock.now(),
        taskId: task2.id,
        taskAction: {
            type: "UpdateParentTaskId",
            parentTaskId: null,
        },
    };

    const query = store.createAndRetainQuery({
        filters: {
            ...defaultTaskQueryNormalizedFilters,
            creatorFilter: {
                type: "OneOf",
                accountIds: assertNonEmptyReadonlySet(new Set([account1.id])),
            },
            priorityFilter: {
                ifHigh: true,
                ifNull: false,
                ifLow: false,
                ifMedium: false,
                ifUrgent: false,
            },
        },
        sorts: defaultTaskQueryNormalizedSorts,
        limit: 100,
    });

    store.loadTasksIntoQuery(query, {
        limit: 100,
        loadedState: {type: "Full"},
        previouslyBackfilledTaskIds: [],
    });

    expect(query.taskOrderStore.getSnapshot().keys.map(getTaskQuerySortCursorTaskId)).toEqual([]);

    expect(query.getReferencedTaskIdsForTest()).toEqual(new Set());
    expect(query.getReferencedCollectionIdsForTest()).toEqual(new Set());

    store.applyUpdateEvent({
        type: "Update",
        defaultAuthorizationStateVersion: store.clock.now(),
        actions: [],
        backfillTasks: [
            {type: "Authorized", task: task1},
            {type: "Authorized", task: task2},
        ],
        backfillCollections: [],
        referencedAccounts: [],
        referencedSites: [],
        originClientId: null,
    });

    expect(query.taskOrderStore.getSnapshot().keys.map(getTaskQuerySortCursorTaskId)).toEqual([
        task2.id,
        task1.id,
    ]);

    expect(query.getReferencedTaskIdsForTest()).toEqual(new Set([task2.id]));
    expect(query.getReferencedCollectionIdsForTest()).toEqual(new Set([]));

    store.applyUpdateEvent({
        type: "Update",
        defaultAuthorizationStateVersion: store.clock.now(),
        actions: [action1],
        backfillTasks: [{type: "Authorized", task: task3}],
        backfillCollections: [{type: "Authorized", collection: collection2}],
        referencedAccounts: [],
        referencedSites: [],
        originClientId: null,
    });

    expect(query.taskOrderStore.getSnapshot().keys.map(getTaskQuerySortCursorTaskId)).toEqual([
        task2.id,
        task1.id,
    ]);

    expect(query.getReferencedTaskIdsForTest()).toEqual(new Set([task2.id, task3.id]));
    expect(query.getReferencedCollectionIdsForTest()).toEqual(new Set([collection2.id]));

    store.applyUpdateEvent({
        type: "Update",
        defaultAuthorizationStateVersion: store.clock.now(),
        actions: [action2],
        backfillTasks: [{type: "Authorized", task: task4}],
        backfillCollections: [{type: "Authorized", collection: collection3}],
        referencedAccounts: [],
        referencedSites: [],
        originClientId: null,
    });

    expect(query.taskOrderStore.getSnapshot().keys.map(getTaskQuerySortCursorTaskId)).toEqual([
        task2.id,
        task1.id,
    ]);

    expect(query.getReferencedTaskIdsForTest()).toEqual(new Set([task2.id, task4.id]));
    expect(query.getReferencedCollectionIdsForTest()).toEqual(new Set([collection3.id]));

    store.applyUpdateEvent({
        type: "Update",
        defaultAuthorizationStateVersion: store.clock.now(),
        actions: [action3],
        backfillTasks: [],
        backfillCollections: [{type: "Authorized", collection: collection1}],
        referencedAccounts: [],
        referencedSites: [],
        originClientId: null,
    });

    expect(query.taskOrderStore.getSnapshot().keys.map(getTaskQuerySortCursorTaskId)).toEqual([
        task2.id,
        task1.id,
    ]);

    expect(query.getReferencedTaskIdsForTest()).toEqual(new Set([task2.id, task4.id]));
    expect(query.getReferencedCollectionIdsForTest()).toEqual(
        new Set([collection3.id, collection1.id]),
    );

    store.applyUpdateEvent({
        type: "Update",
        defaultAuthorizationStateVersion: store.clock.now(),
        actions: [action4],
        backfillTasks: [],
        backfillCollections: [],
        referencedAccounts: [],
        referencedSites: [],
        originClientId: null,
    });

    expect(query.taskOrderStore.getSnapshot().keys.map(getTaskQuerySortCursorTaskId)).toEqual([
        task2.id,
        task1.id,
    ]);

    expect(query.getReferencedTaskIdsForTest()).toEqual(new Set([task2.id, task4.id]));
    expect(query.getReferencedCollectionIdsForTest()).toEqual(new Set([collection3.id]));

    store.applyUpdateEvent({
        type: "Update",
        defaultAuthorizationStateVersion: store.clock.now(),
        actions: [action5],
        backfillTasks: [],
        backfillCollections: [],
        referencedAccounts: [],
        referencedSites: [],
        originClientId: null,
    });

    expect(query.taskOrderStore.getSnapshot().keys.map(getTaskQuerySortCursorTaskId)).toEqual([
        task2.id,
        task1.id,
    ]);

    expect(query.getReferencedTaskIdsForTest()).toEqual(new Set([task2.id]));
    expect(query.getReferencedCollectionIdsForTest()).toEqual(new Set([]));
});

test("can handle a temporary cycle", () => {
    const store = new TaskClientStore({
        accountRegistry,
        siteRegistry,
        spaceId,
        currentAccountId,
        onError: handleError,
    });

    let task1 = createTask(store);

    let task2 = createTask(store);

    let task3 = createTask(store);

    task1 = task1.applyAction(
        {
            type: "UpdateTask",
            time: store.clock.now(),
            taskId: task1.id,
            taskAction: {
                type: "UpdateParentTaskId",
                parentTaskId: task2.id,
            },
        },
        getSortableAccount,
    );

    task2 = task2.applyAction(
        {
            type: "UpdateTask",
            time: store.clock.now(),
            taskId: task2.id,
            taskAction: {
                type: "UpdateParentTaskId",
                parentTaskId: task3.id,
            },
        },
        getSortableAccount,
    );

    task3 = task3.applyAction(
        {
            type: "UpdateTask",
            time: store.clock.now(),
            taskId: task3.id,
            taskAction: {
                type: "UpdatePriority",
                priority: "High",
            },
        },
        getSortableAccount,
    );

    const action1: TaskAction = {
        type: "UpdateTask",
        time: store.clock.now(),
        taskId: task3.id,
        taskAction: {
            type: "UpdateParentTaskId",
            parentTaskId: task1.id,
        },
    };

    const action2: TaskAction = {
        type: "UpdateTask",
        time: store.clock.now(),
        taskId: task3.id,
        taskAction: {
            type: "UpdateParentTaskId",
            parentTaskId: null,
        },
    };

    const query = store.createAndRetainQuery({
        filters: {
            ...defaultTaskQueryNormalizedFilters,
            creatorFilter: {
                type: "OneOf",
                accountIds: assertNonEmptyReadonlySet(new Set([account1.id])),
            },
            priorityFilter: {
                ifHigh: true,
                ifNull: false,
                ifLow: false,
                ifMedium: false,
                ifUrgent: false,
            },
        },
        sorts: defaultTaskQueryNormalizedSorts,
        limit: 100,
    });

    store.loadTasksIntoQuery(query, {
        limit: 100,
        loadedState: {type: "Full"},
        previouslyBackfilledTaskIds: [],
    });

    expect(query.taskOrderStore.getSnapshot().keys.map(getTaskQuerySortCursorTaskId)).toEqual([]);

    expect(query.getReferencedTaskIdsForTest()).toEqual(new Set());
    expect(query.getReferencedCollectionIdsForTest()).toEqual(new Set());

    store.applyUpdateEvent({
        type: "Update",
        defaultAuthorizationStateVersion: store.clock.now(),
        actions: [],
        backfillTasks: [{type: "Authorized", task: task3}],
        backfillCollections: [],
        referencedAccounts: [],
        referencedSites: [],
        originClientId: null,
    });

    expect(query.taskOrderStore.getSnapshot().keys.map(getTaskQuerySortCursorTaskId)).toEqual([
        task3.id,
    ]);

    expect(query.getReferencedTaskIdsForTest()).toEqual(new Set([]));
    expect(query.getReferencedCollectionIdsForTest()).toEqual(new Set([]));

    store.applyUpdateEvent({
        type: "Update",
        defaultAuthorizationStateVersion: store.clock.now(),
        actions: [action1],
        backfillTasks: [
            {type: "Authorized", task: task1},
            {type: "Authorized", task: task2},
        ],
        backfillCollections: [],
        referencedAccounts: [],
        referencedSites: [],
        originClientId: null,
    });

    expect(query.taskOrderStore.getSnapshot().keys.map(getTaskQuerySortCursorTaskId)).toEqual([
        task3.id,
    ]);

    expect(query.getReferencedTaskIdsForTest()).toEqual(new Set([task1.id, task2.id, task3.id]));
    expect(query.getReferencedCollectionIdsForTest()).toEqual(new Set([]));

    store.applyUpdateEvent({
        type: "Update",
        defaultAuthorizationStateVersion: store.clock.now(),
        actions: [action2],
        backfillTasks: [],
        backfillCollections: [],
        referencedAccounts: [],
        referencedSites: [],
        originClientId: null,
    });

    expect(query.taskOrderStore.getSnapshot().keys.map(getTaskQuerySortCursorTaskId)).toEqual([
        task3.id,
    ]);

    expect(query.getReferencedTaskIdsForTest()).toEqual(new Set([]));
    expect(query.getReferencedCollectionIdsForTest()).toEqual(new Set([]));
});

test("can handle a temporary cycle unrelated to loaded task", () => {
    const store = new TaskClientStore({
        accountRegistry,
        siteRegistry,
        spaceId,
        currentAccountId,
        onError: handleError,
    });

    let task1 = createTask(store);

    let task2 = createTask(store);

    const task3 = createTask(store);

    let task4 = createTask(store);

    task1 = task1.applyAction(
        {
            type: "UpdateTask",
            time: store.clock.now(),
            taskId: task1.id,
            taskAction: {
                type: "UpdateParentTaskId",
                parentTaskId: task2.id,
            },
        },
        getSortableAccount,
    );

    task2 = task2.applyAction(
        {
            type: "UpdateTask",
            time: store.clock.now(),
            taskId: task2.id,
            taskAction: {
                type: "UpdateParentTaskId",
                parentTaskId: task3.id,
            },
        },
        getSortableAccount,
    );

    task4 = task4
        .applyAction(
            {
                type: "UpdateTask",
                time: store.clock.now(),
                taskId: task4.id,
                taskAction: {
                    type: "UpdatePriority",
                    priority: "High",
                },
            },
            getSortableAccount,
        )
        .applyAction(
            {
                type: "UpdateTask",
                time: store.clock.now(),
                taskId: task4.id,
                taskAction: {
                    type: "UpdateParentTaskId",
                    parentTaskId: task2.id,
                },
            },
            getSortableAccount,
        );

    const action1: TaskAction = {
        type: "UpdateTask",
        time: store.clock.now(),
        taskId: task3.id,
        taskAction: {
            type: "UpdateParentTaskId",
            parentTaskId: task1.id,
        },
    };

    const action2: TaskAction = {
        type: "UpdateTask",
        time: store.clock.now(),
        taskId: task4.id,
        taskAction: {
            type: "UpdateParentTaskId",
            parentTaskId: null,
        },
    };

    const query = store.createAndRetainQuery({
        filters: {
            ...defaultTaskQueryNormalizedFilters,
            creatorFilter: {
                type: "OneOf",
                accountIds: assertNonEmptyReadonlySet(new Set([account1.id])),
            },
            priorityFilter: {
                ifHigh: true,
                ifNull: false,
                ifLow: false,
                ifMedium: false,
                ifUrgent: false,
            },
        },
        sorts: defaultTaskQueryNormalizedSorts,
        limit: 100,
    });

    store.loadTasksIntoQuery(query, {
        limit: 100,
        loadedState: {type: "Full"},
        previouslyBackfilledTaskIds: [],
    });

    expect(query.taskOrderStore.getSnapshot().keys.map(getTaskQuerySortCursorTaskId)).toEqual([]);

    expect(query.getReferencedTaskIdsForTest()).toEqual(new Set());
    expect(query.getReferencedCollectionIdsForTest()).toEqual(new Set());

    store.applyUpdateEvent({
        type: "Update",
        defaultAuthorizationStateVersion: store.clock.now(),
        actions: [],
        backfillTasks: [
            {type: "Authorized", task: task4},
            {type: "Authorized", task: task2},
            {type: "Authorized", task: task3},
        ],
        backfillCollections: [],
        referencedAccounts: [],
        referencedSites: [],
        originClientId: null,
    });

    expect(query.taskOrderStore.getSnapshot().keys.map(getTaskQuerySortCursorTaskId)).toEqual([
        task4.id,
    ]);

    expect(query.getReferencedTaskIdsForTest()).toEqual(new Set([task2.id, task3.id]));
    expect(query.getReferencedCollectionIdsForTest()).toEqual(new Set([]));

    store.applyUpdateEvent({
        type: "Update",
        defaultAuthorizationStateVersion: store.clock.now(),
        actions: [action1],
        backfillTasks: [{type: "Authorized", task: task1}],
        backfillCollections: [],
        referencedAccounts: [],
        referencedSites: [],
        originClientId: null,
    });

    expect(query.taskOrderStore.getSnapshot().keys.map(getTaskQuerySortCursorTaskId)).toEqual([
        task4.id,
    ]);

    expect(query.getReferencedTaskIdsForTest()).toEqual(new Set([task2.id, task3.id, task1.id]));
    expect(query.getReferencedCollectionIdsForTest()).toEqual(new Set([]));

    store.applyUpdateEvent({
        type: "Update",
        defaultAuthorizationStateVersion: store.clock.now(),
        actions: [action2],
        backfillTasks: [],
        backfillCollections: [],
        referencedAccounts: [],
        referencedSites: [],
        originClientId: null,
    });

    expect(query.taskOrderStore.getSnapshot().keys.map(getTaskQuerySortCursorTaskId)).toEqual([
        task4.id,
    ]);

    expect(query.getReferencedTaskIdsForTest()).toEqual(new Set([]));
    expect(query.getReferencedCollectionIdsForTest()).toEqual(new Set([]));
});

test("temporarily holds on to actions applied to task that wasn\u2019t backfilled", () => {
    const store = new TaskClientStore({
        accountRegistry,
        siteRegistry,
        spaceId,
        currentAccountId,
        onError: handleError,
    });

    const action = {
        type: "UpdateTask",
        time: store.clock.now(),
        taskId: generateId(),
        taskAction: {
            type: "UpdatePriority",
            priority: "High",
        },
    } satisfies TaskAction;

    expect(getTaskEntryIfExists(store, action.taskId)).toEqual(null);

    store.applyUpdateEvent({
        type: "Update",
        defaultAuthorizationStateVersion: store.clock.now(),
        actions: [action],
        backfillTasks: [],
        backfillCollections: [],
        referencedAccounts: [],
        referencedSites: [],
        originClientId: null,
    });

    expect(getTaskEntryIfExists(store, action.taskId)).toEqual({
        task: null,
        actions: [action],
        optimisticState: null,
        authorizationState: null,
    });

    expect(errors.length).toEqual(0);

    import.meta.jest.runAllTimers();

    expect(getTaskEntryIfExists(store, action.taskId)).toEqual(null);

    expect(errors.length).toEqual(1);
    expect(errors[0]).toBeInstanceOf(DeadlineExceededError);
    errors = [];
});

test("temporarily holds on to actions applied to collection that wasn\u2019t backfilled", () => {
    const store = new TaskClientStore({
        accountRegistry,
        siteRegistry,
        spaceId,
        currentAccountId,
        onError: handleError,
    });

    const action = {
        type: "UpdateCollection",
        time: store.clock.now(),
        collectionId: generateId(),
        collectionAction: {
            type: "UpdateName",
            name: "Yo",
        },
    } satisfies TaskAction;

    expect(store.getCollectionEntrySnapshot(action.collectionId)).toBeNull();

    store.applyUpdateEvent({
        type: "Update",
        defaultAuthorizationStateVersion: store.clock.now(),
        actions: [action],
        backfillTasks: [],
        backfillCollections: [],
        referencedAccounts: [],
        referencedSites: [],
        originClientId: null,
    });

    expect(store.getCollectionEntrySnapshot(action.collectionId)).not.toBeNull();

    expect(errors.length).toEqual(0);

    import.meta.jest.runAllTimers();

    expect(store.getCollectionEntrySnapshot(action.collectionId)).toBeNull();

    expect(errors.length).toEqual(1);
    expect(errors[0]).toBeInstanceOf(DeadlineExceededError);
    errors = [];
});

test("action removing from the query immediately releases task", async () => {
    const store = new TaskClientStore({
        accountRegistry,
        siteRegistry,
        spaceId,
        currentAccountId,
        onError: handleError,
    });

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
            type: "UpdatePriority",
            priority: "Low",
        },
    } satisfies TaskAction;

    const query = store.createAndRetainQuery({
        filters: {
            ...defaultTaskQueryNormalizedFilters,
            creatorFilter: {
                type: "OneOf",
                accountIds: assertNonEmptyReadonlySet(new Set([account1.id])),
            },
            priorityFilter: {
                ifHigh: true,
                ifNull: false,
                ifLow: false,
                ifMedium: false,
                ifUrgent: false,
            },
        },
        sorts: defaultTaskQueryNormalizedSorts,
        limit: 100,
    });

    store.loadTasksIntoQuery(query, {
        limit: 100,
        loadedState: {type: "Full"},
        previouslyBackfilledTaskIds: [],
    });

    expect(store.getTaskCountForTest()).toEqual(0);
    expect(query.taskOrderStore.getSnapshot().keys.map(getTaskQuerySortCursorTaskId)).toEqual([]);

    store.applyUpdateEvent({
        type: "Update",
        defaultAuthorizationStateVersion: store.clock.now(),
        actions: [],
        backfillTasks: [{type: "Authorized", task: task.applyAction(action2, getSortableAccount)}],
        backfillCollections: [],
        referencedAccounts: [],
        referencedSites: [],
        originClientId: null,
    });

    expect(store.getTaskCountForTest()).toEqual(1);
    expect(query.taskOrderStore.getSnapshot().keys.map(getTaskQuerySortCursorTaskId)).toEqual([
        task.id,
    ]);

    store.applyUpdateEvent({
        type: "Update",
        defaultAuthorizationStateVersion: store.clock.now(),
        actions: [action3],
        backfillTasks: [],
        backfillCollections: [],
        referencedAccounts: [],
        referencedSites: [],
        originClientId: null,
    });

    expect(store.getTaskCountForTest()).toEqual(0);
    expect(query.taskOrderStore.getSnapshot().keys.map(getTaskQuerySortCursorTaskId)).toEqual([]);
});

test("optimistic update retains task until resolved", async () => {
    const store = new TaskClientStore({
        accountRegistry,
        siteRegistry,
        spaceId,
        currentAccountId,
        onError: handleError,
    });

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
            type: "UpdatePriority",
            priority: "Low",
        },
    } satisfies TaskAction;

    const query = store.createAndRetainQuery({
        filters: {
            ...defaultTaskQueryNormalizedFilters,
            creatorFilter: {
                type: "OneOf",
                accountIds: assertNonEmptyReadonlySet(new Set([account1.id])),
            },
            priorityFilter: {
                ifHigh: true,
                ifNull: false,
                ifLow: false,
                ifMedium: false,
                ifUrgent: false,
            },
        },
        sorts: defaultTaskQueryNormalizedSorts,
        limit: 100,
    });

    store.loadTasksIntoQuery(query, {
        limit: 100,
        loadedState: {type: "Full"},
        previouslyBackfilledTaskIds: [],
    });

    expect(store.getTaskCountForTest()).toEqual(0);
    expect(query.taskOrderStore.getSnapshot().keys.map(getTaskQuerySortCursorTaskId)).toEqual([]);

    store.applyUpdateEvent({
        type: "Update",
        defaultAuthorizationStateVersion: store.clock.now(),
        actions: [],
        backfillTasks: [{type: "Authorized", task: task.applyAction(action2, getSortableAccount)}],
        backfillCollections: [],
        referencedAccounts: [],
        referencedSites: [],
        originClientId: null,
    });

    expect(store.getTaskCountForTest()).toEqual(1);
    expect(query.taskOrderStore.getSnapshot().keys.map(getTaskQuerySortCursorTaskId)).toEqual([
        task.id,
    ]);

    store.commitTaskActionTransaction(context, [action3], {
        undoManager: null,
        affinityManager: noopAffinityManager,
    });

    expect(store.getTaskCountForTest()).toEqual(1);
    expect(query.taskOrderStore.getSnapshot().keys.map(getTaskQuerySortCursorTaskId)).toEqual([]);

    await resolveLastRpcExecution(commitTaskActionTransaction, {
        extraActions: [],
        referencedAccounts: [],
        referencedSites: [],
    });

    expect(store.getTaskCountForTest()).toEqual(0);
    expect(query.taskOrderStore.getSnapshot().keys.map(getTaskQuerySortCursorTaskId)).toEqual([]);
});

test("optimistic update retains task until rejected", async () => {
    const store = new TaskClientStore({
        accountRegistry,
        siteRegistry,
        spaceId,
        currentAccountId,
        onError: handleError,
    });

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
            type: "UpdatePriority",
            priority: "Low",
        },
    } satisfies TaskAction;

    const query = store.createAndRetainQuery({
        filters: {
            ...defaultTaskQueryNormalizedFilters,
            creatorFilter: {
                type: "OneOf",
                accountIds: assertNonEmptyReadonlySet(new Set([account1.id])),
            },
            priorityFilter: {
                ifHigh: true,
                ifNull: false,
                ifLow: false,
                ifMedium: false,
                ifUrgent: false,
            },
        },
        sorts: defaultTaskQueryNormalizedSorts,
        limit: 100,
    });

    store.loadTasksIntoQuery(query, {
        limit: 100,
        loadedState: {type: "Full"},
        previouslyBackfilledTaskIds: [],
    });

    expect(store.getTaskCountForTest()).toEqual(0);
    expect(query.taskOrderStore.getSnapshot().keys.map(getTaskQuerySortCursorTaskId)).toEqual([]);

    store.applyUpdateEvent({
        type: "Update",
        defaultAuthorizationStateVersion: store.clock.now(),
        actions: [],
        backfillTasks: [{type: "Authorized", task: task.applyAction(action2, getSortableAccount)}],
        backfillCollections: [],
        referencedAccounts: [],
        referencedSites: [],
        originClientId: null,
    });

    expect(store.getTaskCountForTest()).toEqual(1);
    expect(query.taskOrderStore.getSnapshot().keys.map(getTaskQuerySortCursorTaskId)).toEqual([
        task.id,
    ]);

    store.commitTaskActionTransaction(context, [action3], {
        undoManager: null,
        affinityManager: noopAffinityManager,
    });

    expect(store.getTaskCountForTest()).toEqual(1);
    expect(query.taskOrderStore.getSnapshot().keys.map(getTaskQuerySortCursorTaskId)).toEqual([]);

    await rejectLastRpcExecution(commitTaskActionTransaction);

    expect(store.getTaskCountForTest()).toEqual(1);
    expect(query.taskOrderStore.getSnapshot().keys.map(getTaskQuerySortCursorTaskId)).toEqual([
        task.id,
    ]);

    expect(errors.length).toEqual(1);
    errors = [];
});

test("deleting task and all children when subscribed to task and its children", async () => {
    const store = new TaskClientStore({
        accountRegistry,
        siteRegistry,
        spaceId,
        currentAccountId,
        onError: handleError,
    });

    const collection = TaskCollectionModel.createFromAction(
        store.spaceId,
        generateId(),
        store.clock.now(),
        {
            type: "Create",
            creatorId: null,
            name: "Test",
            accessPolicy: {
                type: "Local",
                accountGrantById: new Map([[account1.id, {level: "Manage", generation: 0}]]),
                defaultGrant: null,
                urlGrant: null,
            },
        },
    );

    let task1 = createTask(store);

    task1 = task1
        .applyAction(
            {
                type: "UpdateTask",
                time: store.clock.now(),
                taskId: task1.id,
                taskAction: {
                    type: "AddCollection",
                    collectionId: collection.id,
                    orderKey: initialOrderKey,
                },
            },
            getSortableAccount,
        )
        .applyAction(
            {
                type: "UpdateTask",
                time: store.clock.now(),
                taskId: task1.id,
                taskAction: {
                    type: "UpdateChildrenCounts",
                    addedChildTaskCount: 3,
                    removedChildTaskCount: 0,
                    addedClosedChildTaskCount: 0,
                    removedClosedChildTaskCount: 0,
                },
            },
            getSortableAccount,
        );

    let task2 = createTask(store);

    task2 = task2.applyAction(
        {
            type: "UpdateTask",
            time: store.clock.now(),
            taskId: task2.id,
            taskAction: {
                type: "UpdateParentTaskId",
                parentTaskId: task1.id,
            },
        },
        getSortableAccount,
    );

    let task3 = createTask(store);

    task3 = task3.applyAction(
        {
            type: "UpdateTask",
            time: store.clock.now(),
            taskId: task3.id,
            taskAction: {
                type: "UpdateParentTaskId",
                parentTaskId: task1.id,
            },
        },
        getSortableAccount,
    );

    let task4 = createTask(store);

    task4 = task4.applyAction(
        {
            type: "UpdateTask",
            time: store.clock.now(),
            taskId: task4.id,
            taskAction: {
                type: "UpdateParentTaskId",
                parentTaskId: task1.id,
            },
        },
        getSortableAccount,
    );

    let task5 = createTask(store);

    task5 = task5.applyAction(
        {
            type: "UpdateTask",
            time: store.clock.now(),
            taskId: task5.id,
            taskAction: {
                type: "AddCollection",
                collectionId: collection.id,
                orderKey: initialOrderKey,
            },
        },
        getSortableAccount,
    );

    const query1 = store.createAndRetainQuery({
        filters: {
            ...defaultTaskQueryNormalizedFilters,
            collectionsFilter: [assertNonEmptyReadonlyMap(new Map([[collection.id, false]]))],
        },
        sorts: defaultTaskQueryNormalizedSorts,
        limit: 100,
    });

    const query2 = store.ensureAndRetainTaskChildrenQuery(task1.id, {limit: 100});

    store.loadTasksIntoQuery(query1, {
        limit: 100,
        loadedState: {type: "Full"},
        previouslyBackfilledTaskIds: [],
    });

    store.loadTasksIntoQuery(query2, {
        limit: 100,
        loadedState: {type: "Full"},
        previouslyBackfilledTaskIds: [],
    });

    store.applyUpdateEvent({
        type: "Update",
        defaultAuthorizationStateVersion: store.clock.now(),
        actions: [],
        backfillTasks: [
            {type: "Authorized", task: task1},
            {type: "Authorized", task: task2},
            {type: "Authorized", task: task3},
            {type: "Authorized", task: task4},
            {type: "Authorized", task: task5},
        ],
        backfillCollections: [{type: "Authorized", collection: collection}],
        referencedAccounts: [account1],
        referencedSites: [],
        originClientId: null,
    });

    expect(query1.taskOrderStore.getSnapshot().keys.map(getTaskQuerySortCursorTaskId)).toEqual([
        task1.id,
        task5.id,
    ]);

    expect(query2.taskOrderStore.getSnapshot().keys.map(getTaskQuerySortCursorTaskId)).toEqual([
        task2.id,
        task3.id,
        task4.id,
    ]);

    const deleteTime = store.clock.now();

    void store.deleteTaskAndAllChildren(context, task1.id, {
        undoManager: null,
        time: deleteTime,
    });

    expect(query1.taskOrderStore.getSnapshot().keys.map(getTaskQuerySortCursorTaskId)).toEqual([
        task1.id,
        task5.id,
    ]);

    expect(query2.taskOrderStore.getSnapshot().keys.map(getTaskQuerySortCursorTaskId)).toEqual([
        task2.id,
        task3.id,
        task4.id,
    ]);

    await resolveLastRpcExecution(deleteTaskAndAllChildren, {
        actions: [
            {
                type: "UpdateTask",
                time: deleteTime,
                taskId: task1.id,
                taskAction: {type: "Delete"},
            },
            {
                type: "UpdateTask",
                time: deleteTime,
                taskId: task2.id,
                taskAction: {type: "Delete"},
            },
            {
                type: "UpdateTask",
                time: deleteTime,
                taskId: task3.id,
                taskAction: {type: "Delete"},
            },
            {
                type: "UpdateTask",
                time: deleteTime,
                taskId: task4.id,
                taskAction: {type: "Delete"},
            },
            {
                type: "UpdateTask",
                time: deleteTime,
                taskId: task1.id,
                taskAction: {
                    type: "UpdateChildrenCounts",
                    addedChildTaskCount: 3,
                    removedChildTaskCount: 3,
                    addedClosedChildTaskCount: 0,
                    removedClosedChildTaskCount: 0,
                },
            },
        ],
        referencedAccounts: [],
        referencedSites: [],
    });

    expect(query1.taskOrderStore.getSnapshot().keys.map(getTaskQuerySortCursorTaskId)).toEqual([
        task5.id,
    ]);

    expect(query2.taskOrderStore.getSnapshot().keys.map(getTaskQuerySortCursorTaskId)).toEqual([]);
});

test("backfilling tasks a store already has adds them to query", async () => {
    const store = new TaskClientStore({
        accountRegistry,
        siteRegistry,
        spaceId,
        currentAccountId,
        onError: handleError,
    });

    const authorizationStateVersion = store.clock.now();

    const task1 = createTask(store);
    const task2 = createTask(store);
    const task3 = createTask(store);

    const query1 = store.createAndRetainQuery({
        filters: {
            ...defaultTaskQueryNormalizedFilters,
            creatorFilter: {
                type: "OneOf",
                accountIds: assertNonEmptyReadonlySet(new Set([account1.id])),
            },
        },
        sorts: defaultTaskQueryNormalizedSorts,
        limit: 100,
    });

    store.loadTasksIntoQuery(query1, {
        limit: 100,
        loadedState: {type: "Full"},
        previouslyBackfilledTaskIds: [],
    });

    expect(query1.taskOrderStore.getSnapshot().keys.map(getTaskQuerySortCursorTaskId)).toEqual([]);

    store.applyUpdateEvent({
        type: "Update",
        defaultAuthorizationStateVersion: authorizationStateVersion,
        actions: [],
        backfillTasks: [
            {type: "Authorized", task: task1},
            {type: "Authorized", task: task2},
            {type: "Authorized", task: task3},
        ],
        backfillCollections: [],
        referencedAccounts: [],
        referencedSites: [],
        originClientId: null,
    });

    expect(query1.taskOrderStore.getSnapshot().keys.map(getTaskQuerySortCursorTaskId)).toEqual([
        task1.id,
        task2.id,
        task3.id,
    ]);

    const query2 = store.createAndRetainQuery({
        filters: {
            ...defaultTaskQueryNormalizedFilters,
            creatorFilter: {
                type: "OneOf",
                accountIds: assertNonEmptyReadonlySet(new Set([account1.id])),
            },
        },
        sorts: defaultTaskQueryNormalizedSorts,
        limit: 100,
    });

    store.loadTasksIntoQuery(query2, {
        limit: 100,
        loadedState: {type: "Full"},
        previouslyBackfilledTaskIds: [],
    });

    expect(query2.taskOrderStore.getSnapshot().keys.map(getTaskQuerySortCursorTaskId)).toEqual([]);

    store.applyUpdateEvent({
        type: "Update",
        defaultAuthorizationStateVersion: authorizationStateVersion,
        actions: [],
        backfillTasks: [
            {type: "Authorized", task: task1},
            {type: "Authorized", task: task2},
            {type: "Authorized", task: task3},
        ],
        backfillCollections: [],
        referencedAccounts: [],
        referencedSites: [],
        originClientId: null,
    });

    expect(query2.taskOrderStore.getSnapshot().keys.map(getTaskQuerySortCursorTaskId)).toEqual([
        task1.id,
        task2.id,
        task3.id,
    ]);
});

// NOTE(calebmer): This test scenario is reduced from a real scenario I was seeing
// in my development environment with actual data.
test("peek task over collection initial load scenario", () => {
    const store = new TaskClientStore({
        accountRegistry,
        siteRegistry,
        spaceId,
        currentAccountId,
        onError: handleError,
    });

    const creator1 = {
        accountId: account1.id,
        workingAccountName: "Test Account 1",
        workingAccountNameVersion: 8,
    };

    const task1Id = generateId<TaskId>();
    const task2Id = generateId<TaskId>();
    const task3Id = generateId<TaskId>();

    const collection1Id = generateId<TaskCollectionId>();

    const query1 = store.createAndRetainQuery({
        filters: {
            displayStatusFilter: {
                ifOpenInactive: true,
                ifOpenActive: true,
                ifClosed: false,
            },
            collectionsFilter: [assertNonEmptyReadonlyMap(new Map([[collection1Id, false]]))],
        },
        sorts: [{type: "CreatedTime", direction: "Ascending", missing: "Last"}],
        limit: 120,
    });

    const query2 = store.createAndRetainQuery({
        filters: {
            displayStatusFilter: {
                ifOpenInactive: true,
                ifOpenActive: true,
                ifClosed: true,
            },
            parentFilter: {parentTaskId: task2Id},
        },
        sorts: [
            {
                type: "ParentPosition",
                direction: "Ascending",
                missing: "Last",
            },
            {type: "CreatedTime", direction: "Ascending", missing: "Last"},
        ],
        limit: 4,
    });

    store.createAndRetainCollectionSubscription(collection1Id);

    const query3 = store.createAndRetainQuery({
        filters: {
            displayStatusFilter: {
                ifOpenInactive: true,
                ifOpenActive: true,
                ifClosed: true,
            },
            parentFilter: {parentTaskId: assertId<TaskId>(task3Id)},
        },
        sorts: [
            {
                type: "ParentPosition",
                direction: "Ascending",
                missing: "Last",
            },
            {type: "CreatedTime", direction: "Ascending", missing: "Last"},
        ],
        limit: 0,
    });

    store.createAndRetainTaskSubscription(assertId<TaskId>(task3Id));

    store.loadTasksIntoQuery(query1, {
        limit: 120,
        loadedState: {type: "Full"},
        previouslyBackfilledTaskIds: [],
    });

    store.loadTasksIntoQuery(query2, {
        limit: 4,
        loadedState: {type: "Full"},
        previouslyBackfilledTaskIds: [],
    });

    store.applyUpdateEvent(
        TaskRealtimeUpdateEventSchema.deserialize({
            type: "Update",
            actions: [],
            backfillTasks: [
                {
                    type: "Authorized",
                    task: {
                        id: task1Id,
                        spaceId: store.spaceId,
                        creator: creator1,
                        createdTime: {
                            absoluteTime: "111292192539475968",
                            setterTimeZone: "America/New_York",
                        },
                        deletedTime: null,
                        undeletedTime: null,
                        parent: {
                            taskId: {value: task2Id, version: "111292192539475969"},
                            position: {
                                value: {orderTime: "111292192539475970", orderKey: "a0"},
                                version: "111292192539475970",
                            },
                        },
                        addedChildTaskCount: 2,
                        removedChildTaskCount: 0,
                        addedClosedChildTaskCount: 0,
                        removedClosedChildTaskCount: 0,
                        collections: [
                            [collection1Id, {value: null, version: "111292211367378944"}],
                        ],
                        positionByCollectionId: [],
                        status: {value: {type: "Open"}, version: "111292192539475968"},
                        assignee: {value: null, version: "111296379693105152"},
                        assigneeStatus: {value: {type: "Inactive"}, version: "111296379693105152"},
                        assigneePosition: {value: null, version: "111292192539475968"},
                        title: "AAAG3f6e6hwRAwADDwAFBwAEAIQZFWRvY3dpdGggc29tZSBjaGlsZHJlbgNBEAMBAAABBgABEwAA",
                        dueDate: {value: null, version: "111292192539475968"},
                        priority: {value: "Medium", version: "111296380828516352"},
                    },
                },
                {
                    type: "Authorized",
                    task: {
                        id: task2Id,
                        spaceId: store.spaceId,
                        creator: creator1,
                        createdTime: {
                            absoluteTime: "111137674037297152",
                            setterTimeZone: "America/New_York",
                        },
                        deletedTime: null,
                        undeletedTime: null,
                        parent: {
                            taskId: {value: null, version: "111137674037297152"},
                            position: {
                                value: {orderTime: "111137674037297152", orderKey: "a0"},
                                version: "111137674037297152",
                            },
                        },
                        addedChildTaskCount: 37,
                        removedChildTaskCount: 33,
                        addedClosedChildTaskCount: 0,
                        removedClosedChildTaskCount: 0,
                        collections: [
                            [collection1Id, {value: "a0", version: "111268357449383936"}],
                        ],
                        positionByCollectionId: [],
                        status: {value: {type: "Open"}, version: "111137674037297152"},
                        assignee: {value: null, version: "111137674037297152"},
                        assigneeStatus: {value: {type: "Inactive"}, version: "111137674037297152"},
                        assigneePosition: {value: null, version: "111137674037297152"},
                        title: "AAAGyq/iiA0NAwADCwAFBwAEAIQVEWRvY3RoaXMgaXMgYSB0YXNrA0EMAwEAAAEGAAEPAAA=",
                        dueDate: {value: null, version: "111137674037297152"},
                        priority: {value: null, version: "111137674037297152"},
                    },
                },
            ],
            backfillCollections: [
                {
                    type: "Authorized",
                    collection: {
                        id: collection1Id,
                        spaceId: store.spaceId,
                        createdTime: "111178016799522816",
                        deletedTime: null,
                        undeletedTime: null,
                        name: {value: "Awesome", version: "111267807335350272"},
                        color: {value: "purple", version: "111267806774231040"},
                        accessPolicy: {
                            value: {
                                type: "Local",
                                accountGrantById: [[account1.id, {level: "Manage", generation: 0}]],
                                defaultGrant: null,
                                urlGrant: null,
                            },
                            version: "111296374519169024",
                        },
                    },
                },
            ],
            defaultAuthorizationStateVersion: "111296531173474304",
            referencedAccounts: [AccountModel.schema.serialize(account1)],
            referencedSites: [],
            originClientId: null,
        }),
    );

    store.loadTasksIntoQuery(query3, {
        limit: 120,
        loadedState: {type: "Full"},
        previouslyBackfilledTaskIds: [],
    });

    store.applyUpdateEvent(
        TaskRealtimeUpdateEventSchema.deserialize({
            type: "Update",
            actions: [],
            backfillTasks: [
                {
                    type: "Authorized",
                    task: {
                        id: task3Id,
                        spaceId: store.spaceId,
                        creator: creator1,
                        createdTime: {
                            absoluteTime: "111296386826108928",
                            setterTimeZone: "America/New_York",
                        },
                        deletedTime: null,
                        undeletedTime: null,
                        parent: {
                            taskId: {value: task1Id, version: "111296386826174464"},
                            position: {
                                value: {orderTime: "111296386826174465", orderKey: "a0"},
                                version: "111296386826174465",
                            },
                        },
                        addedChildTaskCount: 0,
                        removedChildTaskCount: 0,
                        addedClosedChildTaskCount: 0,
                        removedClosedChildTaskCount: 0,
                        collections: [],
                        positionByCollectionId: [],
                        status: {value: {type: "Open"}, version: "111296386826108928"},
                        assignee: {value: null, version: "111296386826108928"},
                        assigneeStatus: {value: {type: "Inactive"}, version: "111296386826108928"},
                        assigneePosition: {value: null, version: "111296386826108928"},
                        title: "AAAG6vD8wBgWAwADFAAFBwAEAIQeGmRvY3RoaXMgaXMgYW5vdGhlciBzdWJ0YXNrA0EVAwEAAAEGAAEYAAA=",
                        dueDate: {value: null, version: "111296386826108928"},
                        priority: {value: null, version: "111296386826108928"},
                    },
                },
                {
                    type: "Authorized",
                    task: {
                        id: task2Id,
                        spaceId: store.spaceId,
                        creator: creator1,
                        createdTime: {
                            absoluteTime: "111137674037297152",
                            setterTimeZone: "America/New_York",
                        },
                        deletedTime: null,
                        undeletedTime: null,
                        parent: {
                            taskId: {value: null, version: "111137674037297152"},
                            position: {
                                value: {orderTime: "111137674037297152", orderKey: "a0"},
                                version: "111137674037297152",
                            },
                        },
                        addedChildTaskCount: 37,
                        removedChildTaskCount: 33,
                        addedClosedChildTaskCount: 0,
                        removedClosedChildTaskCount: 0,
                        collections: [
                            [collection1Id, {value: "a0", version: "111268357449383936"}],
                        ],
                        positionByCollectionId: [],
                        status: {value: {type: "Open"}, version: "111137674037297152"},
                        assignee: {value: null, version: "111137674037297152"},
                        assigneeStatus: {value: {type: "Inactive"}, version: "111137674037297152"},
                        assigneePosition: {value: null, version: "111137674037297152"},
                        title: "AAAGyq/iiA0NAwADCwAFBwAEAIQVEWRvY3RoaXMgaXMgYSB0YXNrA0EMAwEAAAEGAAEPAAA=",
                        dueDate: {value: null, version: "111137674037297152"},
                        priority: {value: null, version: "111137674037297152"},
                    },
                },
                {
                    type: "Authorized",
                    task: {
                        id: task1Id,
                        spaceId: store.spaceId,
                        creator: creator1,
                        createdTime: {
                            absoluteTime: "111292192539475968",
                            setterTimeZone: "America/New_York",
                        },
                        deletedTime: null,
                        undeletedTime: null,
                        parent: {
                            taskId: {value: task2Id, version: "111292192539475969"},
                            position: {
                                value: {orderTime: "111292192539475970", orderKey: "a0"},
                                version: "111292192539475970",
                            },
                        },
                        addedChildTaskCount: 2,
                        removedChildTaskCount: 0,
                        addedClosedChildTaskCount: 0,
                        removedClosedChildTaskCount: 0,
                        collections: [
                            [collection1Id, {value: null, version: "111292211367378944"}],
                        ],
                        positionByCollectionId: [],
                        status: {value: {type: "Open"}, version: "111292192539475968"},
                        assignee: {value: null, version: "111296379693105152"},
                        assigneeStatus: {value: {type: "Inactive"}, version: "111296379693105152"},
                        assigneePosition: {value: null, version: "111292192539475968"},
                        title: "AAAG3f6e6hwRAwADDwAFBwAEAIQZFWRvY3dpdGggc29tZSBjaGlsZHJlbgNBEAMBAAABBgABEwAA",
                        dueDate: {value: null, version: "111292192539475968"},
                        priority: {value: "Medium", version: "111296380828516352"},
                    },
                },
            ],
            backfillCollections: [
                {
                    type: "Authorized",
                    collection: {
                        id: collection1Id,
                        spaceId: store.spaceId,
                        createdTime: "111178016799522816",
                        deletedTime: null,
                        undeletedTime: null,
                        name: {
                            value: "Awesome",
                            version: "111267807335350272",
                        },
                        color: {
                            value: "purple",
                            version: "111267806774231040",
                        },
                        accessPolicy: {
                            value: {
                                type: "Local",
                                accountGrantById: [[account1.id, {level: "Manage", generation: 0}]],
                                defaultGrant: null,
                                urlGrant: null,
                            },
                            version: "111296374519169024",
                        },
                    },
                },
            ],
            defaultAuthorizationStateVersion: "111296587857461248",
            referencedAccounts: [AccountModel.schema.serialize(account1)],
            referencedSites: [],
            originClientId: null,
        }),
    );
});

test("can handle unauthorized task with another unauthorized task parent due to a collection becoming authorized", () => {
    const store = new TaskClientStore({
        accountRegistry,
        siteRegistry,
        spaceId,
        currentAccountId,
        onError: handleError,
    });

    const collection = TaskCollectionModel.createFromAction(
        store.spaceId,
        generateId(),
        store.clock.now(),
        {
            type: "Create",
            creatorId: null,
            name: "Test",
            accessPolicy: {
                type: "Local",
                accountGrantById: new Map([[account2.id, {level: "Manage", generation: 0}]]),
                defaultGrant: null,
                urlGrant: null,
            },
        },
    );

    const collectionAction = {
        type: "UpdateCollection",
        time: store.clock.now(),
        collectionId: collection.id,
        collectionAction: {
            type: "UpdateAccessPolicy",
            accessPolicy: {
                type: "Local",
                accountGrantById: new Map([[account2.id, {level: "Manage", generation: 0}]]),
                defaultGrant: {level: "Manage", generation: 0},
                urlGrant: null,
            },
        },
    } satisfies TaskAction;

    const task1 = createTask(store, {
        taskAction: {
            type: "Create",
            creatorId: account2.id,
            creatorTimeZone: defaultTimeZone,
        },
    });

    let task2 = createTask(store, {
        taskAction: {
            type: "Create",
            creatorId: account2.id,
            creatorTimeZone: defaultTimeZone,
        },
    });

    task2 = task2
        .applyAction(
            {
                type: "UpdateTask",
                time: store.clock.now(),
                taskId: task2.id,
                taskAction: {
                    type: "UpdateParentTaskId",
                    parentTaskId: task1.id,
                },
            },
            getSortableAccount,
        )
        .applyAction(
            {
                type: "UpdateTask",
                time: store.clock.now(),
                taskId: task2.id,
                taskAction: {
                    type: "AddCollection",
                    collectionId: collection.id,
                    orderKey: initialOrderKey,
                },
            },
            getSortableAccount,
        );

    let task3 = createTask(store);

    task3 = task3.applyAction(
        {
            type: "UpdateTask",
            time: store.clock.now(),
            taskId: task3.id,
            taskAction: {
                type: "UpdateParentTaskId",
                parentTaskId: task2.id,
            },
        },
        getSortableAccount,
    );

    const query = store.createAndRetainQuery({
        filters: {
            ...defaultTaskQueryNormalizedFilters,
            creatorFilter: {
                type: "OneOf",
                accountIds: assertNonEmptyReadonlySet(new Set([account1.id])),
            },
        },
        sorts: defaultTaskQueryNormalizedSorts,
        limit: 100,
    });

    store.loadTasksIntoQuery(query, {
        limit: 100,
        loadedState: {type: "Full"},
        previouslyBackfilledTaskIds: [],
    });

    expect(query.taskOrderStore.getSnapshot().keys.map(getTaskQuerySortCursorTaskId)).toEqual([]);

    expect(getTaskEntryIfExists(store, task2.id)).toEqual(null);
    expect(getTaskEntryIfExists(store, task3.id)).toEqual(null);
    expect(store.getCollectionEntrySnapshot(collection.id)).toEqual(null);

    const authorizationStateVersion1 = store.clock.now();

    store.applyUpdateEvent({
        type: "Update",
        defaultAuthorizationStateVersion: authorizationStateVersion1,
        actions: [],
        backfillTasks: [
            {type: "Authorized", task: task3},
            {type: "Unauthorized", errorCode: ErrorCode.PermissionDenied, taskId: task2.id},
        ],
        backfillCollections: [],
        referencedAccounts: [],
        referencedSites: [],
        originClientId: null,
    });

    expect(query.taskOrderStore.getSnapshot().keys.map(getTaskQuerySortCursorTaskId)).toEqual([
        task3.id,
    ]);

    expect(getTaskEntryIfExists(store, task2.id)).toEqual({
        task: null,
        actions: [],
        authorizationState: new TaskAuthorizationStateRegister(
            {type: "Unauthorized", errorCode: ErrorCode.PermissionDenied},
            authorizationStateVersion1,
        ),
        optimisticState: null,
    });

    expect(getTaskEntryIfExists(store, task3.id)).toEqual({
        task: task3,
        actions: null,
        authorizationState: new TaskAuthorizationStateRegister(
            taskAuthorizedState,
            authorizationStateVersion1,
        ),
        optimisticState: null,
    });

    expect(store.getCollectionEntrySnapshot(collection.id)).toEqual(null);

    const authorizationStateVersion2 = store.clock.now();

    store.applyUpdateEvent({
        type: "Update",
        defaultAuthorizationStateVersion: authorizationStateVersion2,
        actions: [],
        backfillTasks: [
            {type: "Authorized", task: task2},
            {type: "Unauthorized", errorCode: ErrorCode.PermissionDenied, taskId: task1.id},
        ],
        backfillCollections: [
            {type: "Authorized", collection: collection.applyAction(collectionAction)},
        ],
        referencedAccounts: [],
        referencedSites: [],
        originClientId: null,
    });

    expect(query.taskOrderStore.getSnapshot().keys.map(getTaskQuerySortCursorTaskId)).toEqual([
        task3.id,
    ]);

    expect(getTaskEntryIfExists(store, task2.id)).toEqual({
        task: task2,
        actions: null,
        authorizationState: new TaskAuthorizationStateRegister(
            taskAuthorizedState,
            authorizationStateVersion2,
        ),
        optimisticState: null,
    });

    expect(getTaskEntryIfExists(store, task3.id)).toEqual({
        task: task3,
        actions: null,
        authorizationState: new TaskAuthorizationStateRegister(
            taskAuthorizedState,
            authorizationStateVersion1,
        ),
        optimisticState: null,
    });

    expect(store.getCollectionEntrySnapshot(collection.id)).toEqual({
        collection: collection.applyAction(collectionAction),
        actions: null,
        authorizationState: new TaskAuthorizationStateRegister(
            taskAuthorizedState,
            authorizationStateVersion2,
        ),
        optimisticState: null,
    });

    expect(query.getReferencedCollectionEntryStore(collection.id).getSnapshot()).toEqual({
        collection: collection.applyAction(collectionAction),
        actions: null,
        authorizationState: new TaskAuthorizationStateRegister(
            taskAuthorizedState,
            authorizationStateVersion2,
        ),
        optimisticState: null,
    });
});
