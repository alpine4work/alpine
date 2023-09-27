import {getAccountClientStoreForClient} from "~/client/accounts/account_client_store_context_provider.js";
import {TaskClientStore} from "~/client/tasks/task_client_store.js";
import {AccountModel} from "~/shared/accounts/account_model.js";
import {Context} from "~/shared/context/context.js";
import {InternalError} from "~/shared/error/error.js";
import {HybridLogicalTime} from "~/shared/helpers/clock/hybrid_logical_clock.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {defaultTimeZone} from "~/shared/helpers/date/time_zone.js";
import {getOrSetDefaultMapValue} from "~/shared/helpers/map/get_or_set_default_map_value.js";
import {initialOrderKey} from "~/shared/helpers/sort/order_key.js";
import {generateId} from "~/shared/id/id.js";
import {AccountId, TaskId} from "~/shared/id/types/id_types.js";
import {commitTaskActionTransaction} from "~/shared/rpc/tasks_rpc_definitions.js";
import {TestRpcContextModule} from "~/shared/rpc/test_rpc_context_module.js";
import {TaskAction} from "~/shared/tasks/actions/task_action.js";
import {TaskCreateAction} from "~/shared/tasks/actions/task_task_action.js";
import {TaskCollectionModel} from "~/shared/tasks/model/task_collection_model.js";
import {TaskModel} from "~/shared/tasks/model/task_model.js";
import {
    assertNonEmptyReadonlySet,
    defaultTaskQueryNormalizedFilters,
} from "~/shared/tasks/task_query_normalized_filters.js";
import {defaultTaskQueryNormalizedSorts} from "~/shared/tasks/task_query_normalized_sort.js";
import {getTaskQuerySortCursorTaskId} from "~/shared/tasks/task_query_sort_cursor.js";

const accountStore = getAccountClientStoreForClient();

const account1 = new AccountModel({
    id: generateId(),
    name: "Test Account 1",
    nameVersion: 0,
    createdTime: new Date(),
    version: 0,
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

let displayErrors: Array<unknown> = [];

const handleDisplayError = ({error}: {error: unknown}) => {
    displayErrors.push(error);
};

afterEach(() => {
    const previousDisplayErrors = displayErrors;
    displayErrors = [];

    if (previousDisplayErrors.length > 0) {
        throw InternalError.from(previousDisplayErrors[0]!, "Received display error");
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

test("if optimistic task creation is reverted then queries remove the task", async () => {
    const store = new TaskClientStore({
        accountStore,
        spaceId: generateId(),
        onDisplayError: handleDisplayError,
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
    });

    store.loadTasksIntoQuery(query, {
        limit: 100,
        loadedState: {type: "Full"},
        previouslyBackfilledTaskIds: [],
    });

    expect(getTaskEntryIfExists(store, task.id)).toEqual(null);

    expect(query.taskOrderStore.getSnapshot().keys.map(getTaskQuerySortCursorTaskId)).toEqual([]);

    store.commitTaskActionTransaction(context, [action1]);

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
        isAuthorized: true,
        authorizationEventNumber: 0,
    });

    expect(query.taskOrderStore.getSnapshot().keys.map(getTaskQuerySortCursorTaskId)).toEqual([]);

    store.commitTaskActionTransaction(context, [action2]);

    expect(getTaskEntryIfExists(store, task.id)).toEqual({
        task: task.apply(action2, getSortableAccount),
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
        isAuthorized: true,
        authorizationEventNumber: 0,
    });

    expect(query.taskOrderStore.getSnapshot().keys.map(getTaskQuerySortCursorTaskId)).toEqual([
        task.id,
    ]);

    await TestRpcContextModule.rejectExecution(commitTaskActionTransaction, 0);

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
        isAuthorized: true,
        authorizationEventNumber: 0,
    });

    expect(query.taskOrderStore.getSnapshot().keys.map(getTaskQuerySortCursorTaskId)).toEqual([]);

    await TestRpcContextModule.rejectExecution(commitTaskActionTransaction, 1);

    expect(getTaskEntryIfExists(store, task.id)).toEqual({
        task: null,
        actions: [],
        optimisticState: null,
        isAuthorized: true,
        authorizationEventNumber: 0,
    });

    expect(query.taskOrderStore.getSnapshot().keys.map(getTaskQuerySortCursorTaskId)).toEqual([]);

    expect(displayErrors.length).toEqual(2);
    displayErrors = [];
});

test("task can be added to query through backfill", () => {
    const store = new TaskClientStore({
        accountStore,
        spaceId: generateId(),
        onDisplayError: handleDisplayError,
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
    });

    store.loadTasksIntoQuery(query, {
        limit: 100,
        loadedState: {type: "Full"},
        previouslyBackfilledTaskIds: [],
    });

    expect(query.taskOrderStore.getSnapshot().keys.map(getTaskQuerySortCursorTaskId)).toEqual([]);

    store.applyUpdateEvent({
        type: "Update",
        number: 1,
        actions: [],
        backfillAuthorizedTasks: [task],
        backfillUnauthorizedTaskIds: [],
        backfillAuthorizedCollections: [],
        backfillUnauthorizedCollectionIds: [],
        referencedAccounts: [],
    });

    expect(query.taskOrderStore.getSnapshot().keys.map(getTaskQuerySortCursorTaskId)).toEqual([
        task.id,
    ]);
});

test("task can be added to query through previously backfilled tasks", () => {
    const store = new TaskClientStore({
        accountStore,
        spaceId: generateId(),
        onDisplayError: handleDisplayError,
    });

    const task = createTask(store);

    store.applyUpdateEvent({
        type: "Update",
        number: 1,
        actions: [],
        backfillAuthorizedTasks: [task],
        backfillUnauthorizedTaskIds: [],
        backfillAuthorizedCollections: [],
        backfillUnauthorizedCollectionIds: [],
        referencedAccounts: [],
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
        accountStore,
        spaceId: generateId(),
        onDisplayError: handleDisplayError,
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
    });

    store.loadTasksIntoQuery(query, {
        limit: 100,
        loadedState: {type: "Full"},
        previouslyBackfilledTaskIds: [],
    });

    expect(query.taskOrderStore.getSnapshot().keys.map(getTaskQuerySortCursorTaskId)).toEqual([]);

    store.applyUpdateEvent({
        type: "Update",
        number: 1,
        actions: [],
        backfillAuthorizedTasks: [task],
        backfillUnauthorizedTaskIds: [],
        backfillAuthorizedCollections: [],
        backfillUnauthorizedCollectionIds: [],
        referencedAccounts: [],
    });

    expect(query.taskOrderStore.getSnapshot().keys.map(getTaskQuerySortCursorTaskId)).toEqual([]);

    store.applyUpdateEvent({
        type: "Update",
        number: 1,
        actions: [action],
        backfillAuthorizedTasks: [],
        backfillUnauthorizedTaskIds: [],
        backfillAuthorizedCollections: [],
        backfillUnauthorizedCollectionIds: [],
        referencedAccounts: [],
    });

    expect(query.taskOrderStore.getSnapshot().keys.map(getTaskQuerySortCursorTaskId)).toEqual([
        task.id,
    ]);
});

test("task can be removed from a query through an action", () => {
    const store = new TaskClientStore({
        accountStore,
        spaceId: generateId(),
        onDisplayError: handleDisplayError,
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
    });

    store.loadTasksIntoQuery(query, {
        limit: 100,
        loadedState: {type: "Full"},
        previouslyBackfilledTaskIds: [],
    });

    expect(query.taskOrderStore.getSnapshot().keys.map(getTaskQuerySortCursorTaskId)).toEqual([]);

    store.applyUpdateEvent({
        type: "Update",
        number: 1,
        actions: [],
        backfillAuthorizedTasks: [task.apply(action1, getSortableAccount)],
        backfillUnauthorizedTaskIds: [],
        backfillAuthorizedCollections: [],
        backfillUnauthorizedCollectionIds: [],
        referencedAccounts: [],
    });

    expect(query.taskOrderStore.getSnapshot().keys.map(getTaskQuerySortCursorTaskId)).toEqual([
        task.id,
    ]);

    store.applyUpdateEvent({
        type: "Update",
        number: 1,
        actions: [action2],
        backfillAuthorizedTasks: [],
        backfillUnauthorizedTaskIds: [],
        backfillAuthorizedCollections: [],
        backfillUnauthorizedCollectionIds: [],
        referencedAccounts: [],
    });

    expect(query.taskOrderStore.getSnapshot().keys.map(getTaskQuerySortCursorTaskId)).toEqual([]);
});

test("task can be moved in query through an action", () => {
    const store = new TaskClientStore({
        accountStore,
        spaceId: generateId(),
        onDisplayError: handleDisplayError,
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
    });

    store.loadTasksIntoQuery(query, {
        limit: 100,
        loadedState: {type: "Full"},
        previouslyBackfilledTaskIds: [],
    });

    expect(query.taskOrderStore.getSnapshot().keys.map(getTaskQuerySortCursorTaskId)).toEqual([]);

    store.applyUpdateEvent({
        type: "Update",
        number: 1,
        actions: [],
        backfillAuthorizedTasks: [
            task1.apply(action1, getSortableAccount),
            task2.apply(action2, getSortableAccount),
            task3.apply(action3, getSortableAccount),
        ],
        backfillUnauthorizedTaskIds: [],
        backfillAuthorizedCollections: [],
        backfillUnauthorizedCollectionIds: [],
        referencedAccounts: [],
    });

    expect(query.taskOrderStore.getSnapshot().keys.map(getTaskQuerySortCursorTaskId)).toEqual([
        task1.id,
        task3.id,
        task2.id,
    ]);

    store.applyUpdateEvent({
        type: "Update",
        number: 1,
        actions: [action4],
        backfillAuthorizedTasks: [],
        backfillUnauthorizedTaskIds: [],
        backfillAuthorizedCollections: [],
        backfillUnauthorizedCollectionIds: [],
        referencedAccounts: [],
    });

    expect(query.taskOrderStore.getSnapshot().keys.map(getTaskQuerySortCursorTaskId)).toEqual([
        task2.id,
        task1.id,
        task3.id,
    ]);
});

test("task can be left alone through an action", () => {
    const store = new TaskClientStore({
        accountStore,
        spaceId: generateId(),
        onDisplayError: handleDisplayError,
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
    });

    store.loadTasksIntoQuery(query, {
        limit: 100,
        loadedState: {type: "Full"},
        previouslyBackfilledTaskIds: [],
    });

    expect(query.taskOrderStore.getSnapshot().keys.map(getTaskQuerySortCursorTaskId)).toEqual([]);

    store.applyUpdateEvent({
        type: "Update",
        number: 1,
        actions: [],
        backfillAuthorizedTasks: [
            task1.apply(action1, getSortableAccount),
            task2.apply(action2, getSortableAccount),
            task3.apply(action3, getSortableAccount),
        ],
        backfillUnauthorizedTaskIds: [],
        backfillAuthorizedCollections: [],
        backfillUnauthorizedCollectionIds: [],
        referencedAccounts: [],
    });

    expect(query.taskOrderStore.getSnapshot().keys.map(getTaskQuerySortCursorTaskId)).toEqual([
        task1.id,
        task2.id,
        task3.id,
    ]);

    store.applyUpdateEvent({
        type: "Update",
        number: 1,
        actions: [action4],
        backfillAuthorizedTasks: [],
        backfillUnauthorizedTaskIds: [],
        backfillAuthorizedCollections: [],
        backfillUnauthorizedCollectionIds: [],
        referencedAccounts: [],
    });

    expect(query.taskOrderStore.getSnapshot().keys.map(getTaskQuerySortCursorTaskId)).toEqual([
        task1.id,
        task2.id,
        task3.id,
    ]);
});

test("task references can be added to query through backfill", () => {
    const store = new TaskClientStore({
        accountStore,
        spaceId: generateId(),
        onDisplayError: handleDisplayError,
    });

    const collection1 = TaskCollectionModel.createFromAction(
        store.spaceId,
        generateId(),
        store.clock.now(),
        {
            type: "Create",
            name: "Test 1",
            accessPolicy: {
                accountGrantById: new Map([]),
                defaultGrant: {type: "Space", level: "Manage"},
            },
        },
    );

    const collection2 = TaskCollectionModel.createFromAction(
        store.spaceId,
        generateId(),
        store.clock.now(),
        {
            type: "Create",
            name: "Test 2",
            accessPolicy: {
                accountGrantById: new Map([]),
                defaultGrant: {type: "Space", level: "Manage"},
            },
        },
    );

    const collection3 = TaskCollectionModel.createFromAction(
        store.spaceId,
        generateId(),
        store.clock.now(),
        {
            type: "Create",
            name: "Test 3",
            accessPolicy: {
                accountGrantById: new Map([]),
                defaultGrant: {type: "Space", level: "Manage"},
            },
        },
    );

    let task3 = createTask(store);

    task3 = task3
        .apply(
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
        .apply(
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

    task2 = task2.apply(
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
        .apply(
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
        .apply(
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
        .apply(
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
        .apply(
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
        .apply(
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
        .apply(
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
        .apply(
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
        number: 1,
        actions: [],
        backfillAuthorizedTasks: [task1, task2, task3, task4, task5],
        backfillUnauthorizedTaskIds: [],
        backfillAuthorizedCollections: [collection1, collection2, collection3],
        backfillUnauthorizedCollectionIds: [],
        referencedAccounts: [],
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
        accountStore,
        spaceId: generateId(),
        onDisplayError: handleDisplayError,
    });

    const collection1 = TaskCollectionModel.createFromAction(
        store.spaceId,
        generateId(),
        store.clock.now(),
        {
            type: "Create",
            name: "Test 1",
            accessPolicy: {
                accountGrantById: new Map([]),
                defaultGrant: {type: "Space", level: "Manage"},
            },
        },
    );

    const collection2 = TaskCollectionModel.createFromAction(
        store.spaceId,
        generateId(),
        store.clock.now(),
        {
            type: "Create",
            name: "Test 2",
            accessPolicy: {
                accountGrantById: new Map([]),
                defaultGrant: {type: "Space", level: "Manage"},
            },
        },
    );

    const collection3 = TaskCollectionModel.createFromAction(
        store.spaceId,
        generateId(),
        store.clock.now(),
        {
            type: "Create",
            name: "Test 3",
            accessPolicy: {
                accountGrantById: new Map([]),
                defaultGrant: {type: "Space", level: "Manage"},
            },
        },
    );

    let task3 = createTask(store);

    task3 = task3
        .apply(
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
        .apply(
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

    task2 = task2.apply(
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
        .apply(
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
        .apply(
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
        .apply(
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
        .apply(
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
        .apply(
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
        .apply(
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
        .apply(
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

    store.applyUpdateEvent({
        type: "Update",
        number: 1,
        actions: [],
        backfillAuthorizedTasks: [task1, task2, task3, task4, task5],
        backfillUnauthorizedTaskIds: [],
        backfillAuthorizedCollections: [collection1, collection2, collection3],
        backfillUnauthorizedCollectionIds: [],
        referencedAccounts: [],
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
        accountStore,
        spaceId: generateId(),
        onDisplayError: handleDisplayError,
    });

    const collection1 = TaskCollectionModel.createFromAction(
        store.spaceId,
        generateId(),
        store.clock.now(),
        {
            type: "Create",
            name: "Test 1",
            accessPolicy: {
                accountGrantById: new Map([]),
                defaultGrant: {type: "Space", level: "Manage"},
            },
        },
    );

    const collection2 = TaskCollectionModel.createFromAction(
        store.spaceId,
        generateId(),
        store.clock.now(),
        {
            type: "Create",
            name: "Test 2",
            accessPolicy: {
                accountGrantById: new Map([]),
                defaultGrant: {type: "Space", level: "Manage"},
            },
        },
    );

    const collection3 = TaskCollectionModel.createFromAction(
        store.spaceId,
        generateId(),
        store.clock.now(),
        {
            type: "Create",
            name: "Test 3",
            accessPolicy: {
                accountGrantById: new Map([]),
                defaultGrant: {type: "Space", level: "Manage"},
            },
        },
    );

    let task3 = createTask(store);

    task3 = task3
        .apply(
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
        .apply(
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

    task2 = task2.apply(
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

    task1 = task1.apply(
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
        .apply(
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
        .apply(
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

    task4 = task4.apply(
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
        number: 1,
        actions: [],
        backfillAuthorizedTasks: [task4.apply(action1, getSortableAccount), task5],
        backfillUnauthorizedTaskIds: [],
        backfillAuthorizedCollections: [collection2, collection3],
        backfillUnauthorizedCollectionIds: [],
        referencedAccounts: [],
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
        number: 1,
        actions: [],
        backfillAuthorizedTasks: [task1.apply(action2, getSortableAccount), task2, task3],
        backfillUnauthorizedTaskIds: [],
        backfillAuthorizedCollections: [collection1],
        backfillUnauthorizedCollectionIds: [],
        referencedAccounts: [],
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
        number: 1,
        actions: [action3],
        backfillAuthorizedTasks: [],
        backfillUnauthorizedTaskIds: [],
        backfillAuthorizedCollections: [],
        backfillUnauthorizedCollectionIds: [],
        referencedAccounts: [],
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
        accountStore,
        spaceId: generateId(),
        onDisplayError: handleDisplayError,
    });

    const collection1 = TaskCollectionModel.createFromAction(
        store.spaceId,
        generateId(),
        store.clock.now(),
        {
            type: "Create",
            name: "Test 1",
            accessPolicy: {
                accountGrantById: new Map([]),
                defaultGrant: {type: "Space", level: "Manage"},
            },
        },
    );

    const collection2 = TaskCollectionModel.createFromAction(
        store.spaceId,
        generateId(),
        store.clock.now(),
        {
            type: "Create",
            name: "Test 2",
            accessPolicy: {
                accountGrantById: new Map([]),
                defaultGrant: {type: "Space", level: "Manage"},
            },
        },
    );

    const collection3 = TaskCollectionModel.createFromAction(
        store.spaceId,
        generateId(),
        store.clock.now(),
        {
            type: "Create",
            name: "Test 3",
            accessPolicy: {
                accountGrantById: new Map([]),
                defaultGrant: {type: "Space", level: "Manage"},
            },
        },
    );

    let task3 = createTask(store);

    task3 = task3
        .apply(
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
        .apply(
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

    task2 = task2.apply(
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
        .apply(
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
        .apply(
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
        .apply(
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
        .apply(
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
        .apply(
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
        .apply(
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
        .apply(
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
        number: 1,
        actions: [],
        backfillAuthorizedTasks: [task1, task2, task3, task4, task5],
        backfillUnauthorizedTaskIds: [],
        backfillAuthorizedCollections: [collection1, collection2, collection3],
        backfillUnauthorizedCollectionIds: [],
        referencedAccounts: [],
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
        number: 1,
        actions: [action1],
        backfillAuthorizedTasks: [],
        backfillUnauthorizedTaskIds: [],
        backfillAuthorizedCollections: [],
        backfillUnauthorizedCollectionIds: [],
        referencedAccounts: [],
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
        number: 1,
        actions: [action2],
        backfillAuthorizedTasks: [],
        backfillUnauthorizedTaskIds: [],
        backfillAuthorizedCollections: [],
        backfillUnauthorizedCollectionIds: [],
        referencedAccounts: [],
    });

    expect(query.taskOrderStore.getSnapshot().keys.map(getTaskQuerySortCursorTaskId)).toEqual([
        task5.id,
    ]);

    expect(query.getReferencedTaskIdsForTest()).toEqual(new Set([]));
    expect(query.getReferencedCollectionIdsForTest()).toEqual(new Set([collection3.id]));

    store.applyUpdateEvent({
        type: "Update",
        number: 1,
        actions: [action3],
        backfillAuthorizedTasks: [],
        backfillUnauthorizedTaskIds: [],
        backfillAuthorizedCollections: [],
        backfillUnauthorizedCollectionIds: [],
        referencedAccounts: [],
    });

    expect(query.taskOrderStore.getSnapshot().keys.map(getTaskQuerySortCursorTaskId)).toEqual([]);

    expect(query.getReferencedTaskIdsForTest()).toEqual(new Set([]));
    expect(query.getReferencedCollectionIdsForTest()).toEqual(new Set([]));
});

test("references from optimistic task can be removed", async () => {
    const store = new TaskClientStore({
        accountStore,
        spaceId: generateId(),
        onDisplayError: handleDisplayError,
    });

    const collection1 = TaskCollectionModel.createFromAction(
        store.spaceId,
        generateId(),
        store.clock.now(),
        {
            type: "Create",
            name: "Test 1",
            accessPolicy: {
                accountGrantById: new Map([]),
                defaultGrant: {type: "Space", level: "Manage"},
            },
        },
    );

    const collection2 = TaskCollectionModel.createFromAction(
        store.spaceId,
        generateId(),
        store.clock.now(),
        {
            type: "Create",
            name: "Test 2",
            accessPolicy: {
                accountGrantById: new Map([]),
                defaultGrant: {type: "Space", level: "Manage"},
            },
        },
    );

    const collection3 = TaskCollectionModel.createFromAction(
        store.spaceId,
        generateId(),
        store.clock.now(),
        {
            type: "Create",
            name: "Test 3",
            accessPolicy: {
                accountGrantById: new Map([]),
                defaultGrant: {type: "Space", level: "Manage"},
            },
        },
    );

    let task3 = createTask(store);

    task3 = task3
        .apply(
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
        .apply(
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

    task2 = task2.apply(
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
        .apply(
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
        .apply(
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

    task5 = task5.apply(
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
        number: 1,
        actions: [],
        backfillAuthorizedTasks: [task1, task2, task3],
        backfillUnauthorizedTaskIds: [],
        backfillAuthorizedCollections: [collection1, collection2],
        backfillUnauthorizedCollectionIds: [],
        referencedAccounts: [],
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

    const action2: TaskAction = {
        type: "UpdateTask",
        time: store.clock.now(),
        taskId: task4.id,
        taskAction: {
            type: "UpdateParentTaskId",
            parentTaskId: task5.id,
        },
    };

    const action3: TaskAction = {
        type: "UpdateTask",
        time: store.clock.now(),
        taskId: task4.id,
        taskAction: {
            type: "AddCollection",
            collectionId: collection2.id,
            orderKey: initialOrderKey,
        },
    };

    const action4: TaskAction = {
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
        number: 1,
        actions: [],
        backfillAuthorizedTasks: [task5],
        backfillUnauthorizedTaskIds: [],
        backfillAuthorizedCollections: [collection3],
        backfillUnauthorizedCollectionIds: [],
        referencedAccounts: [],
    });

    expect(query.taskOrderStore.getSnapshot().keys.map(getTaskQuerySortCursorTaskId)).toEqual([
        task1.id,
    ]);

    expect(query.getReferencedTaskIdsForTest()).toEqual(new Set([task2.id, task3.id]));
    expect(query.getReferencedCollectionIdsForTest()).toEqual(
        new Set([collection1.id, collection2.id]),
    );

    store.commitTaskActionTransaction(context, [action1, action2, action3, action4]);

    expect(query.taskOrderStore.getSnapshot().keys.map(getTaskQuerySortCursorTaskId)).toEqual([
        task1.id,
        task4.id,
    ]);

    expect(query.getReferencedTaskIdsForTest()).toEqual(new Set([task2.id, task3.id, task5.id]));
    expect(query.getReferencedCollectionIdsForTest()).toEqual(
        new Set([collection1.id, collection2.id, collection3.id]),
    );

    await TestRpcContextModule.rejectLastExecution(commitTaskActionTransaction);

    expect(query.taskOrderStore.getSnapshot().keys.map(getTaskQuerySortCursorTaskId)).toEqual([
        task1.id,
    ]);

    expect(query.getReferencedTaskIdsForTest()).toEqual(new Set([task2.id, task3.id]));
    expect(query.getReferencedCollectionIdsForTest()).toEqual(
        new Set([collection1.id, collection2.id]),
    );

    expect(displayErrors.length).toEqual(1);
    displayErrors = [];
});

test("task references can be added and removed through actions", () => {
    const store = new TaskClientStore({
        accountStore,
        spaceId: generateId(),
        onDisplayError: handleDisplayError,
    });

    const collection1 = TaskCollectionModel.createFromAction(
        store.spaceId,
        generateId(),
        store.clock.now(),
        {
            type: "Create",
            name: "Test 1",
            accessPolicy: {
                accountGrantById: new Map([]),
                defaultGrant: {type: "Space", level: "Manage"},
            },
        },
    );

    const collection2 = TaskCollectionModel.createFromAction(
        store.spaceId,
        generateId(),
        store.clock.now(),
        {
            type: "Create",
            name: "Test 2",
            accessPolicy: {
                accountGrantById: new Map([]),
                defaultGrant: {type: "Space", level: "Manage"},
            },
        },
    );

    const collection3 = TaskCollectionModel.createFromAction(
        store.spaceId,
        generateId(),
        store.clock.now(),
        {
            type: "Create",
            name: "Test 3",
            accessPolicy: {
                accountGrantById: new Map([]),
                defaultGrant: {type: "Space", level: "Manage"},
            },
        },
    );

    let task2 = createTask(store);

    task2 = task2.apply(
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

    task3 = task3.apply(
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

    task1 = task1.apply(
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
        number: 1,
        actions: [],
        backfillAuthorizedTasks: [task1],
        backfillUnauthorizedTaskIds: [],
        backfillAuthorizedCollections: [],
        backfillUnauthorizedCollectionIds: [],
        referencedAccounts: [],
    });

    expect(query.taskOrderStore.getSnapshot().keys.map(getTaskQuerySortCursorTaskId)).toEqual([
        task1.id,
    ]);

    expect(query.getReferencedTaskIdsForTest()).toEqual(new Set([]));
    expect(query.getReferencedCollectionIdsForTest()).toEqual(new Set([]));

    store.applyUpdateEvent({
        type: "Update",
        number: 1,
        actions: [action1],
        backfillAuthorizedTasks: [task2],
        backfillUnauthorizedTaskIds: [],
        backfillAuthorizedCollections: [collection2],
        backfillUnauthorizedCollectionIds: [],
        referencedAccounts: [],
    });

    expect(query.taskOrderStore.getSnapshot().keys.map(getTaskQuerySortCursorTaskId)).toEqual([
        task1.id,
    ]);

    expect(query.getReferencedTaskIdsForTest()).toEqual(new Set([task2.id]));
    expect(query.getReferencedCollectionIdsForTest()).toEqual(new Set([collection2.id]));

    store.applyUpdateEvent({
        type: "Update",
        number: 1,
        actions: [action2],
        backfillAuthorizedTasks: [task3],
        backfillUnauthorizedTaskIds: [],
        backfillAuthorizedCollections: [collection3],
        backfillUnauthorizedCollectionIds: [],
        referencedAccounts: [],
    });

    expect(query.taskOrderStore.getSnapshot().keys.map(getTaskQuerySortCursorTaskId)).toEqual([
        task1.id,
    ]);

    expect(query.getReferencedTaskIdsForTest()).toEqual(new Set([task3.id]));
    expect(query.getReferencedCollectionIdsForTest()).toEqual(new Set([collection3.id]));

    store.applyUpdateEvent({
        type: "Update",
        number: 1,
        actions: [action3],
        backfillAuthorizedTasks: [],
        backfillUnauthorizedTaskIds: [],
        backfillAuthorizedCollections: [collection1],
        backfillUnauthorizedCollectionIds: [],
        referencedAccounts: [],
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
        number: 1,
        actions: [action4],
        backfillAuthorizedTasks: [],
        backfillUnauthorizedTaskIds: [],
        backfillAuthorizedCollections: [],
        backfillUnauthorizedCollectionIds: [],
        referencedAccounts: [],
    });

    expect(query.taskOrderStore.getSnapshot().keys.map(getTaskQuerySortCursorTaskId)).toEqual([
        task1.id,
    ]);

    expect(query.getReferencedTaskIdsForTest()).toEqual(new Set([task3.id]));
    expect(query.getReferencedCollectionIdsForTest()).toEqual(new Set([collection3.id]));

    store.applyUpdateEvent({
        type: "Update",
        number: 1,
        actions: [action5],
        backfillAuthorizedTasks: [],
        backfillUnauthorizedTaskIds: [],
        backfillAuthorizedCollections: [],
        backfillUnauthorizedCollectionIds: [],
        referencedAccounts: [],
    });

    expect(query.taskOrderStore.getSnapshot().keys.map(getTaskQuerySortCursorTaskId)).toEqual([
        task1.id,
    ]);

    expect(query.getReferencedTaskIdsForTest()).toEqual(new Set([]));
    expect(query.getReferencedCollectionIdsForTest()).toEqual(new Set([]));
});

test("task references can be added and removed through actions on a referenced task", () => {
    const store = new TaskClientStore({
        accountStore,
        spaceId: generateId(),
        onDisplayError: handleDisplayError,
    });

    const collection1 = TaskCollectionModel.createFromAction(
        store.spaceId,
        generateId(),
        store.clock.now(),
        {
            type: "Create",
            name: "Test 1",
            accessPolicy: {
                accountGrantById: new Map([]),
                defaultGrant: {type: "Space", level: "Manage"},
            },
        },
    );

    const collection2 = TaskCollectionModel.createFromAction(
        store.spaceId,
        generateId(),
        store.clock.now(),
        {
            type: "Create",
            name: "Test 2",
            accessPolicy: {
                accountGrantById: new Map([]),
                defaultGrant: {type: "Space", level: "Manage"},
            },
        },
    );

    const collection3 = TaskCollectionModel.createFromAction(
        store.spaceId,
        generateId(),
        store.clock.now(),
        {
            type: "Create",
            name: "Test 3",
            accessPolicy: {
                accountGrantById: new Map([]),
                defaultGrant: {type: "Space", level: "Manage"},
            },
        },
    );

    let task3 = createTask(store);

    task3 = task3.apply(
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

    task4 = task4.apply(
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
        .apply(
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
        .apply(
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
        number: 1,
        actions: [],
        backfillAuthorizedTasks: [task1, task2],
        backfillUnauthorizedTaskIds: [],
        backfillAuthorizedCollections: [],
        backfillUnauthorizedCollectionIds: [],
        referencedAccounts: [],
    });

    expect(query.taskOrderStore.getSnapshot().keys.map(getTaskQuerySortCursorTaskId)).toEqual([
        task1.id,
    ]);

    expect(query.getReferencedTaskIdsForTest()).toEqual(new Set([task2.id]));
    expect(query.getReferencedCollectionIdsForTest()).toEqual(new Set([]));

    store.applyUpdateEvent({
        type: "Update",
        number: 1,
        actions: [action1],
        backfillAuthorizedTasks: [task3],
        backfillUnauthorizedTaskIds: [],
        backfillAuthorizedCollections: [collection2],
        backfillUnauthorizedCollectionIds: [],
        referencedAccounts: [],
    });

    expect(query.taskOrderStore.getSnapshot().keys.map(getTaskQuerySortCursorTaskId)).toEqual([
        task1.id,
    ]);

    expect(query.getReferencedTaskIdsForTest()).toEqual(new Set([task2.id, task3.id]));
    expect(query.getReferencedCollectionIdsForTest()).toEqual(new Set([collection2.id]));

    store.applyUpdateEvent({
        type: "Update",
        number: 1,
        actions: [action2],
        backfillAuthorizedTasks: [task4],
        backfillUnauthorizedTaskIds: [],
        backfillAuthorizedCollections: [collection3],
        backfillUnauthorizedCollectionIds: [],
        referencedAccounts: [],
    });

    expect(query.taskOrderStore.getSnapshot().keys.map(getTaskQuerySortCursorTaskId)).toEqual([
        task1.id,
    ]);

    expect(query.getReferencedTaskIdsForTest()).toEqual(new Set([task2.id, task4.id]));
    expect(query.getReferencedCollectionIdsForTest()).toEqual(new Set([collection3.id]));

    store.applyUpdateEvent({
        type: "Update",
        number: 1,
        actions: [action3],
        backfillAuthorizedTasks: [],
        backfillUnauthorizedTaskIds: [],
        backfillAuthorizedCollections: [collection1],
        backfillUnauthorizedCollectionIds: [],
        referencedAccounts: [],
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
        number: 1,
        actions: [action4],
        backfillAuthorizedTasks: [],
        backfillUnauthorizedTaskIds: [],
        backfillAuthorizedCollections: [],
        backfillUnauthorizedCollectionIds: [],
        referencedAccounts: [],
    });

    expect(query.taskOrderStore.getSnapshot().keys.map(getTaskQuerySortCursorTaskId)).toEqual([
        task1.id,
    ]);

    expect(query.getReferencedTaskIdsForTest()).toEqual(new Set([task2.id, task4.id]));
    expect(query.getReferencedCollectionIdsForTest()).toEqual(new Set([collection3.id]));

    store.applyUpdateEvent({
        type: "Update",
        number: 1,
        actions: [action5],
        backfillAuthorizedTasks: [],
        backfillUnauthorizedTaskIds: [],
        backfillAuthorizedCollections: [],
        backfillUnauthorizedCollectionIds: [],
        referencedAccounts: [],
    });

    expect(query.taskOrderStore.getSnapshot().keys.map(getTaskQuerySortCursorTaskId)).toEqual([
        task1.id,
    ]);

    expect(query.getReferencedTaskIdsForTest()).toEqual(new Set([task2.id]));
    expect(query.getReferencedCollectionIdsForTest()).toEqual(new Set([]));
});

test("task references can be added and removed through actions on a task that's both loaded and referenced", () => {
    const store = new TaskClientStore({
        accountStore,
        spaceId: generateId(),
        onDisplayError: handleDisplayError,
    });

    const collection1 = TaskCollectionModel.createFromAction(
        store.spaceId,
        generateId(),
        store.clock.now(),
        {
            type: "Create",
            name: "Test 1",
            accessPolicy: {
                accountGrantById: new Map([]),
                defaultGrant: {type: "Space", level: "Manage"},
            },
        },
    );

    const collection2 = TaskCollectionModel.createFromAction(
        store.spaceId,
        generateId(),
        store.clock.now(),
        {
            type: "Create",
            name: "Test 2",
            accessPolicy: {
                accountGrantById: new Map([]),
                defaultGrant: {type: "Space", level: "Manage"},
            },
        },
    );

    const collection3 = TaskCollectionModel.createFromAction(
        store.spaceId,
        generateId(),
        store.clock.now(),
        {
            type: "Create",
            name: "Test 3",
            accessPolicy: {
                accountGrantById: new Map([]),
                defaultGrant: {type: "Space", level: "Manage"},
            },
        },
    );

    let task3 = createTask(store);

    task3 = task3.apply(
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

    task4 = task4.apply(
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

    task2 = task2.apply(
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
        .apply(
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
        .apply(
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
        number: 1,
        actions: [],
        backfillAuthorizedTasks: [task1, task2],
        backfillUnauthorizedTaskIds: [],
        backfillAuthorizedCollections: [],
        backfillUnauthorizedCollectionIds: [],
        referencedAccounts: [],
    });

    expect(query.taskOrderStore.getSnapshot().keys.map(getTaskQuerySortCursorTaskId)).toEqual([
        task2.id,
        task1.id,
    ]);

    expect(query.getReferencedTaskIdsForTest()).toEqual(new Set([task2.id]));
    expect(query.getReferencedCollectionIdsForTest()).toEqual(new Set([]));

    store.applyUpdateEvent({
        type: "Update",
        number: 1,
        actions: [action1],
        backfillAuthorizedTasks: [task3],
        backfillUnauthorizedTaskIds: [],
        backfillAuthorizedCollections: [collection2],
        backfillUnauthorizedCollectionIds: [],
        referencedAccounts: [],
    });

    expect(query.taskOrderStore.getSnapshot().keys.map(getTaskQuerySortCursorTaskId)).toEqual([
        task2.id,
        task1.id,
    ]);

    expect(query.getReferencedTaskIdsForTest()).toEqual(new Set([task2.id, task3.id]));
    expect(query.getReferencedCollectionIdsForTest()).toEqual(new Set([collection2.id]));

    store.applyUpdateEvent({
        type: "Update",
        number: 1,
        actions: [action2],
        backfillAuthorizedTasks: [task4],
        backfillUnauthorizedTaskIds: [],
        backfillAuthorizedCollections: [collection3],
        backfillUnauthorizedCollectionIds: [],
        referencedAccounts: [],
    });

    expect(query.taskOrderStore.getSnapshot().keys.map(getTaskQuerySortCursorTaskId)).toEqual([
        task2.id,
        task1.id,
    ]);

    expect(query.getReferencedTaskIdsForTest()).toEqual(new Set([task2.id, task4.id]));
    expect(query.getReferencedCollectionIdsForTest()).toEqual(new Set([collection3.id]));

    store.applyUpdateEvent({
        type: "Update",
        number: 1,
        actions: [action3],
        backfillAuthorizedTasks: [],
        backfillUnauthorizedTaskIds: [],
        backfillAuthorizedCollections: [collection1],
        backfillUnauthorizedCollectionIds: [],
        referencedAccounts: [],
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
        number: 1,
        actions: [action4],
        backfillAuthorizedTasks: [],
        backfillUnauthorizedTaskIds: [],
        backfillAuthorizedCollections: [],
        backfillUnauthorizedCollectionIds: [],
        referencedAccounts: [],
    });

    expect(query.taskOrderStore.getSnapshot().keys.map(getTaskQuerySortCursorTaskId)).toEqual([
        task2.id,
        task1.id,
    ]);

    expect(query.getReferencedTaskIdsForTest()).toEqual(new Set([task2.id, task4.id]));
    expect(query.getReferencedCollectionIdsForTest()).toEqual(new Set([collection3.id]));

    store.applyUpdateEvent({
        type: "Update",
        number: 1,
        actions: [action5],
        backfillAuthorizedTasks: [],
        backfillUnauthorizedTaskIds: [],
        backfillAuthorizedCollections: [],
        backfillUnauthorizedCollectionIds: [],
        referencedAccounts: [],
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
        accountStore,
        spaceId: generateId(),
        onDisplayError: handleDisplayError,
    });

    let task1 = createTask(store);

    let task2 = createTask(store);

    let task3 = createTask(store);

    task1 = task1.apply(
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

    task2 = task2.apply(
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

    task3 = task3.apply(
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
        number: 1,
        actions: [],
        backfillAuthorizedTasks: [task3],
        backfillUnauthorizedTaskIds: [],
        backfillAuthorizedCollections: [],
        backfillUnauthorizedCollectionIds: [],
        referencedAccounts: [],
    });

    expect(query.taskOrderStore.getSnapshot().keys.map(getTaskQuerySortCursorTaskId)).toEqual([
        task3.id,
    ]);

    expect(query.getReferencedTaskIdsForTest()).toEqual(new Set([]));
    expect(query.getReferencedCollectionIdsForTest()).toEqual(new Set([]));

    store.applyUpdateEvent({
        type: "Update",
        number: 1,
        actions: [action1],
        backfillAuthorizedTasks: [task1, task2],
        backfillUnauthorizedTaskIds: [],
        backfillAuthorizedCollections: [],
        backfillUnauthorizedCollectionIds: [],
        referencedAccounts: [],
    });

    expect(query.taskOrderStore.getSnapshot().keys.map(getTaskQuerySortCursorTaskId)).toEqual([
        task3.id,
    ]);

    expect(query.getReferencedTaskIdsForTest()).toEqual(new Set([task1.id, task2.id, task3.id]));
    expect(query.getReferencedCollectionIdsForTest()).toEqual(new Set([]));

    store.applyUpdateEvent({
        type: "Update",
        number: 1,
        actions: [action2],
        backfillAuthorizedTasks: [],
        backfillUnauthorizedTaskIds: [],
        backfillAuthorizedCollections: [],
        backfillUnauthorizedCollectionIds: [],
        referencedAccounts: [],
    });

    expect(query.taskOrderStore.getSnapshot().keys.map(getTaskQuerySortCursorTaskId)).toEqual([
        task3.id,
    ]);

    expect(query.getReferencedTaskIdsForTest()).toEqual(new Set([]));
    expect(query.getReferencedCollectionIdsForTest()).toEqual(new Set([]));
});

test("can handle a temporary cycle unrelated to loaded task", () => {
    const store = new TaskClientStore({
        accountStore,
        spaceId: generateId(),
        onDisplayError: handleDisplayError,
    });

    let task1 = createTask(store);

    let task2 = createTask(store);

    const task3 = createTask(store);

    let task4 = createTask(store);

    task1 = task1.apply(
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

    task2 = task2.apply(
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
        .apply(
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
        .apply(
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
        number: 1,
        actions: [],
        backfillAuthorizedTasks: [task4, task2, task3],
        backfillUnauthorizedTaskIds: [],
        backfillAuthorizedCollections: [],
        backfillUnauthorizedCollectionIds: [],
        referencedAccounts: [],
    });

    expect(query.taskOrderStore.getSnapshot().keys.map(getTaskQuerySortCursorTaskId)).toEqual([
        task4.id,
    ]);

    expect(query.getReferencedTaskIdsForTest()).toEqual(new Set([task2.id, task3.id]));
    expect(query.getReferencedCollectionIdsForTest()).toEqual(new Set([]));

    store.applyUpdateEvent({
        type: "Update",
        number: 1,
        actions: [action1],
        backfillAuthorizedTasks: [task1],
        backfillUnauthorizedTaskIds: [],
        backfillAuthorizedCollections: [],
        backfillUnauthorizedCollectionIds: [],
        referencedAccounts: [],
    });

    expect(query.taskOrderStore.getSnapshot().keys.map(getTaskQuerySortCursorTaskId)).toEqual([
        task4.id,
    ]);

    expect(query.getReferencedTaskIdsForTest()).toEqual(new Set([task2.id, task3.id, task1.id]));
    expect(query.getReferencedCollectionIdsForTest()).toEqual(new Set([]));

    store.applyUpdateEvent({
        type: "Update",
        number: 1,
        actions: [action2],
        backfillAuthorizedTasks: [],
        backfillUnauthorizedTaskIds: [],
        backfillAuthorizedCollections: [],
        backfillUnauthorizedCollectionIds: [],
        referencedAccounts: [],
    });

    expect(query.taskOrderStore.getSnapshot().keys.map(getTaskQuerySortCursorTaskId)).toEqual([
        task4.id,
    ]);

    expect(query.getReferencedTaskIdsForTest()).toEqual(new Set([]));
    expect(query.getReferencedCollectionIdsForTest()).toEqual(new Set([]));
});
