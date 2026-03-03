import {getAccountRegistry} from "~/client/web/accounts/account_registry_context.js";
import {TaskClientStore} from "~/client/web/tasks/core/task_client_store.js";
import {
    TaskGridViewVirtualizedListState,
    TaskGridViewVirtualizedListStateItem,
} from "~/client/web/tasks/internal/task_grid_view_virtualized_list_state.js";
import {InternalError} from "~/shared/error/error.js";
import {createArrayWithLength} from "~/shared/helpers/array/create_array_with_length.js";
import {shuffleArray} from "~/shared/helpers/array/shuffle_array.js";
import {HybridLogicalTime} from "~/shared/helpers/clock/hybrid_logical_clock.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {defaultTimeZone} from "~/shared/helpers/intl/time_zone.js";
import {generateId} from "~/shared/id/id.js";
import {AccountId, SpaceId, TaskId} from "~/shared/id/types/id_types.js";
import {createTestAccountModel} from "~/shared/spaces/test_helpers/account_model_test_helpers.js";
import {StoreMap} from "~/shared/store/store_map.js";
import {TaskCreateAction} from "~/shared/tasks/actions/task_task_action.js";
import {getTaskQueryNormalizedSortCursorForModel} from "~/shared/tasks/model/get_task_query_normalized_sort_cursor_for_model.js";
import {TaskModel} from "~/shared/tasks/model/task_model.js";
import {
    assertNonEmptyReadonlySet,
    defaultTaskQueryNormalizedFilters,
} from "~/shared/tasks/task_query_normalized_filters.js";
import {defaultTaskQueryNormalizedSorts} from "~/shared/tasks/task_query_normalized_sort.js";
import {getTaskQuerySortCursorTaskId} from "~/shared/tasks/task_query_sort_cursor.js";

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

function expectItems(
    state: TaskGridViewVirtualizedListState,
    expectedItems: Array<TaskGridViewVirtualizedListStateItem>,
) {
    const actualItems: Array<TaskGridViewVirtualizedListStateItem> = [];
    const reversedActualItems: Array<TaskGridViewVirtualizedListStateItem> = [];
    const shuffledActualItems: Array<TaskGridViewVirtualizedListStateItem> = [];

    const itemCount = state.getItemCount();

    const shuffledItemIndexes = createArrayWithLength(itemCount, index => index);
    shuffleArray(shuffledItemIndexes);

    for (let i = 0; i < itemCount; i++) {
        actualItems.push(state.getItem(i));
    }

    // Reset the internal iterator state so getting the last item isn't O(1).
    if (itemCount > 0) state.getItem(0);

    // Get items backwards as well as forwards. We implement an optimization that
    // allows `getItem(n + 1)` preceded by `getItem(n)` to be O(1) but that's not the
    // case for `getItem(n - 1)` preceded by `getItem(n)`.
    for (let i = itemCount - 1; i >= 0; i--) {
        reversedActualItems.push(state.getItem(i));
    }

    // For good measure, let's also get all our items in a random order to really make
    // sure there are no internal iteration state bugs.
    for (const i of shuffledItemIndexes) {
        shuffledActualItems.push(state.getItem(i));
    }

    expect(actualItems).toEqual(expectedItems);
    expect(reversedActualItems).toEqual([...expectedItems].reverse());
    expect(shuffledActualItems).toEqual(shuffledItemIndexes.map(i => expectedItems[i]));
}

test("can represent items of an empty query", () => {
    const store = new TaskClientStore({
        accountRegistry,
        spaceId,
        currentAccountId,
        onError: handleError,
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

    store.loadTasksIntoQuery(query, {
        limit: 100,
        loadedState: {type: "Full"},
        previouslyBackfilledTaskIds: [],
    });

    store.applyUpdateEvent({
        type: "Update",
        defaultAuthorizationStateVersion: store.clock.now(),
        actions: [],
        backfillTasks: [],
        backfillCollections: [],
        referencedAccounts: [],
        originClientId: null,
    });

    expect(query.taskOrderStore.getSnapshot().keys.map(getTaskQuerySortCursorTaskId)).toEqual([]);

    const areChildTasksExpandedStoreByPath = new StoreMap<string, true>();

    const state = TaskGridViewVirtualizedListState.new(
        query,
        taskPath => areChildTasksExpandedStoreByPath.get(taskPath.join("-")),
        100,
    );

    expectItems(state.getSnapshot(), []);
});

test("can represent items of a query", () => {
    const store = new TaskClientStore({
        accountRegistry,
        spaceId,
        currentAccountId,
        onError: handleError,
    });

    const task1 = createTask(store);
    const task2 = createTask(store);
    const task3 = createTask(store);
    const task4 = createTask(store);

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

    store.applyUpdateEvent({
        type: "Update",
        defaultAuthorizationStateVersion: store.clock.now(),
        actions: [],
        backfillTasks: [
            {type: "Authorized", task: task1},
            {type: "Authorized", task: task2},
            {type: "Authorized", task: task3},
            {type: "Authorized", task: task4},
        ],
        backfillCollections: [],
        referencedAccounts: [],
        originClientId: null,
    });

    expect(query.taskOrderStore.getSnapshot().keys.map(getTaskQuerySortCursorTaskId)).toEqual([
        task1.id,
        task2.id,
        task3.id,
        task4.id,
    ]);

    const areChildTasksExpandedStoreByPath = new StoreMap<string, true>();

    const state = TaskGridViewVirtualizedListState.new(
        query,
        taskPath => areChildTasksExpandedStoreByPath.get(taskPath.join("-")),
        100,
    );

    expectItems(state.getSnapshot(), [
        {
            type: "Task",
            parents: [],
            query,
            cursor: getTaskQueryNormalizedSortCursorForModel(query.sorts, task1),
            isFirstTaskInQuery: true,
        },
        {
            type: "Task",
            parents: [],
            query,
            cursor: getTaskQueryNormalizedSortCursorForModel(query.sorts, task2),
            isFirstTaskInQuery: false,
        },
        {
            type: "Task",
            parents: [],
            query,
            cursor: getTaskQueryNormalizedSortCursorForModel(query.sorts, task3),
            isFirstTaskInQuery: false,
        },
        {
            type: "Task",
            parents: [],
            query,
            cursor: getTaskQueryNormalizedSortCursorForModel(query.sorts, task4),
            isFirstTaskInQuery: false,
        },
    ]);
});

test("can represent items of a query with some expanded unloaded child tasks", () => {
    const store = new TaskClientStore({
        accountRegistry,
        spaceId,
        currentAccountId,
        onError: handleError,
    });

    const task1 = createTask(store);

    let task2 = createTask(store);

    task2 = task2.applyAction(
        {
            type: "UpdateTask",
            time: store.clock.now(),
            taskId: task2.id,
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

    let task3 = createTask(store);

    task3 = task3.applyAction(
        {
            type: "UpdateTask",
            time: store.clock.now(),
            taskId: task3.id,
            taskAction: {
                type: "UpdateChildrenCounts",
                addedChildTaskCount: 1,
                removedChildTaskCount: 0,
                addedClosedChildTaskCount: 0,
                removedClosedChildTaskCount: 0,
            },
        },
        getSortableAccount,
    );

    const task4 = createTask(store);

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

    store.applyUpdateEvent({
        type: "Update",
        defaultAuthorizationStateVersion: store.clock.now(),
        actions: [],
        backfillTasks: [
            {type: "Authorized", task: task1},
            {type: "Authorized", task: task2},
            {type: "Authorized", task: task3},
            {type: "Authorized", task: task4},
        ],
        backfillCollections: [],
        referencedAccounts: [],
        originClientId: null,
    });

    expect(query.taskOrderStore.getSnapshot().keys.map(getTaskQuerySortCursorTaskId)).toEqual([
        task1.id,
        task2.id,
        task3.id,
        task4.id,
    ]);

    const areChildTasksExpandedStoreByPath = new StoreMap<string, true>();

    const state = TaskGridViewVirtualizedListState.new(
        query,
        taskPath => areChildTasksExpandedStoreByPath.get(taskPath.join("-")),
        100,
    );

    expectItems(state.getSnapshot(), [
        {
            type: "Task",
            parents: [],
            query,
            cursor: getTaskQueryNormalizedSortCursorForModel(query.sorts, task1),
            isFirstTaskInQuery: true,
        },
        {
            type: "Task",
            parents: [],
            query,
            cursor: getTaskQueryNormalizedSortCursorForModel(query.sorts, task2),
            isFirstTaskInQuery: false,
        },
        {
            type: "Task",
            parents: [],
            query,
            cursor: getTaskQueryNormalizedSortCursorForModel(query.sorts, task3),
            isFirstTaskInQuery: false,
        },
        {
            type: "Task",
            parents: [],
            query,
            cursor: getTaskQueryNormalizedSortCursorForModel(query.sorts, task4),
            isFirstTaskInQuery: false,
        },
    ]);

    areChildTasksExpandedStoreByPath.set(task2.id, true);

    expectItems(state.getSnapshot(), [
        {
            type: "Task",
            parents: [],
            query,
            cursor: getTaskQueryNormalizedSortCursorForModel(query.sorts, task1),
            isFirstTaskInQuery: true,
        },
        {
            type: "Task",
            parents: [],
            query,
            cursor: getTaskQueryNormalizedSortCursorForModel(query.sorts, task2),
            isFirstTaskInQuery: false,
        },
        {
            type: "UnloadedChildTask",
            parents: [
                {query, cursor: getTaskQueryNormalizedSortCursorForModel(query.sorts, task2)},
            ],
            unloadedChildTaskIndex: 0,
        },
        {
            type: "UnloadedChildTask",
            parents: [
                {query, cursor: getTaskQueryNormalizedSortCursorForModel(query.sorts, task2)},
            ],
            unloadedChildTaskIndex: 1,
        },
        {
            type: "UnloadedChildTask",
            parents: [
                {query, cursor: getTaskQueryNormalizedSortCursorForModel(query.sorts, task2)},
            ],
            unloadedChildTaskIndex: 2,
        },
        {
            type: "Task",
            parents: [],
            query,
            cursor: getTaskQueryNormalizedSortCursorForModel(query.sorts, task3),
            isFirstTaskInQuery: false,
        },
        {
            type: "Task",
            parents: [],
            query,
            cursor: getTaskQueryNormalizedSortCursorForModel(query.sorts, task4),
            isFirstTaskInQuery: false,
        },
    ]);

    areChildTasksExpandedStoreByPath.set(task3.id, true);

    expectItems(state.getSnapshot(), [
        {
            type: "Task",
            parents: [],
            query,
            cursor: getTaskQueryNormalizedSortCursorForModel(query.sorts, task1),
            isFirstTaskInQuery: true,
        },
        {
            type: "Task",
            parents: [],
            query,
            cursor: getTaskQueryNormalizedSortCursorForModel(query.sorts, task2),
            isFirstTaskInQuery: false,
        },
        {
            type: "UnloadedChildTask",
            parents: [
                {query, cursor: getTaskQueryNormalizedSortCursorForModel(query.sorts, task2)},
            ],
            unloadedChildTaskIndex: 0,
        },
        {
            type: "UnloadedChildTask",
            parents: [
                {query, cursor: getTaskQueryNormalizedSortCursorForModel(query.sorts, task2)},
            ],
            unloadedChildTaskIndex: 1,
        },
        {
            type: "UnloadedChildTask",
            parents: [
                {query, cursor: getTaskQueryNormalizedSortCursorForModel(query.sorts, task2)},
            ],
            unloadedChildTaskIndex: 2,
        },
        {
            type: "Task",
            parents: [],
            query,
            cursor: getTaskQueryNormalizedSortCursorForModel(query.sorts, task3),
            isFirstTaskInQuery: false,
        },
        {
            type: "UnloadedChildTask",
            parents: [
                {query, cursor: getTaskQueryNormalizedSortCursorForModel(query.sorts, task3)},
            ],
            unloadedChildTaskIndex: 0,
        },
        {
            type: "Task",
            parents: [],
            query,
            cursor: getTaskQueryNormalizedSortCursorForModel(query.sorts, task4),
            isFirstTaskInQuery: false,
        },
    ]);

    areChildTasksExpandedStoreByPath.set(task4.id, true);

    expectItems(state.getSnapshot(), [
        {
            type: "Task",
            parents: [],
            query,
            cursor: getTaskQueryNormalizedSortCursorForModel(query.sorts, task1),
            isFirstTaskInQuery: true,
        },
        {
            type: "Task",
            parents: [],
            query,
            cursor: getTaskQueryNormalizedSortCursorForModel(query.sorts, task2),
            isFirstTaskInQuery: false,
        },
        {
            type: "UnloadedChildTask",
            parents: [
                {query, cursor: getTaskQueryNormalizedSortCursorForModel(query.sorts, task2)},
            ],
            unloadedChildTaskIndex: 0,
        },
        {
            type: "UnloadedChildTask",
            parents: [
                {query, cursor: getTaskQueryNormalizedSortCursorForModel(query.sorts, task2)},
            ],
            unloadedChildTaskIndex: 1,
        },
        {
            type: "UnloadedChildTask",
            parents: [
                {query, cursor: getTaskQueryNormalizedSortCursorForModel(query.sorts, task2)},
            ],
            unloadedChildTaskIndex: 2,
        },
        {
            type: "Task",
            parents: [],
            query,
            cursor: getTaskQueryNormalizedSortCursorForModel(query.sorts, task3),
            isFirstTaskInQuery: false,
        },
        {
            type: "UnloadedChildTask",
            parents: [
                {query, cursor: getTaskQueryNormalizedSortCursorForModel(query.sorts, task3)},
            ],
            unloadedChildTaskIndex: 0,
        },
        {
            type: "Task",
            parents: [],
            query,
            cursor: getTaskQueryNormalizedSortCursorForModel(query.sorts, task4),
            isFirstTaskInQuery: false,
        },
    ]);
});

test("can represent items of a query with some expanded child tasks", () => {
    const store = new TaskClientStore({
        accountRegistry,
        spaceId,
        currentAccountId,
        onError: handleError,
    });

    const task1 = createTask(store);

    let task2 = createTask(store);

    task2 = task2.applyAction(
        {
            type: "UpdateTask",
            time: store.clock.now(),
            taskId: task2.id,
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

    let task2a = createTask(store);

    task2a = task2a
        .applyAction(
            {
                type: "UpdateTask",
                time: store.clock.now(),
                taskId: task2a.id,
                taskAction: {
                    type: "UpdatePriority",
                    priority: "Low",
                },
            },
            getSortableAccount,
        )
        .applyAction(
            {
                type: "UpdateTask",
                time: store.clock.now(),
                taskId: task2a.id,
                taskAction: {
                    type: "UpdateParentTaskId",
                    parentTaskId: task2.id,
                },
            },
            getSortableAccount,
        );

    let task2b = createTask(store);

    task2b = task2b
        .applyAction(
            {
                type: "UpdateTask",
                time: store.clock.now(),
                taskId: task2b.id,
                taskAction: {
                    type: "UpdatePriority",
                    priority: "Low",
                },
            },
            getSortableAccount,
        )
        .applyAction(
            {
                type: "UpdateTask",
                time: store.clock.now(),
                taskId: task2b.id,
                taskAction: {
                    type: "UpdateParentTaskId",
                    parentTaskId: task2.id,
                },
            },
            getSortableAccount,
        );

    let task2c = createTask(store);

    task2c = task2c
        .applyAction(
            {
                type: "UpdateTask",
                time: store.clock.now(),
                taskId: task2c.id,
                taskAction: {
                    type: "UpdatePriority",
                    priority: "Low",
                },
            },
            getSortableAccount,
        )
        .applyAction(
            {
                type: "UpdateTask",
                time: store.clock.now(),
                taskId: task2c.id,
                taskAction: {
                    type: "UpdateParentTaskId",
                    parentTaskId: task2.id,
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
                type: "UpdateChildrenCounts",
                addedChildTaskCount: 1,
                removedChildTaskCount: 0,
                addedClosedChildTaskCount: 0,
                removedClosedChildTaskCount: 0,
            },
        },
        getSortableAccount,
    );

    let task3a = createTask(store);

    task3a = task3a
        .applyAction(
            {
                type: "UpdateTask",
                time: store.clock.now(),
                taskId: task3a.id,
                taskAction: {
                    type: "UpdatePriority",
                    priority: "Low",
                },
            },
            getSortableAccount,
        )
        .applyAction(
            {
                type: "UpdateTask",
                time: store.clock.now(),
                taskId: task3a.id,
                taskAction: {
                    type: "UpdateParentTaskId",
                    parentTaskId: task3.id,
                },
            },
            getSortableAccount,
        );

    const task4 = createTask(store);

    const rootQuery = store.createAndRetainQuery({
        filters: {
            ...defaultTaskQueryNormalizedFilters,
            creatorFilter: {
                type: "OneOf",
                accountIds: assertNonEmptyReadonlySet(new Set([account1.id])),
            },
            priorityFilter: {
                ifNull: true,
                ifLow: false,
                ifMedium: false,
                ifHigh: false,
                ifUrgent: false,
            },
        },
        sorts: defaultTaskQueryNormalizedSorts,
        limit: 100,
    });

    const query2 = store.ensureAndRetainTaskChildrenQuery(task2.id, {limit: 100});
    const query3 = store.ensureAndRetainTaskChildrenQuery(task3.id, {limit: 100});

    store.loadTasksIntoQuery(rootQuery, {
        limit: 100,
        loadedState: {type: "Full"},
        previouslyBackfilledTaskIds: [],
    });

    store.loadTasksIntoQuery(query2, {
        limit: 100,
        loadedState: {type: "Full"},
        previouslyBackfilledTaskIds: [],
    });

    store.loadTasksIntoQuery(query3, {
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
            {type: "Authorized", task: task2a},
            {type: "Authorized", task: task2b},
            {type: "Authorized", task: task2c},
            {type: "Authorized", task: task3a},
        ],
        backfillCollections: [],
        referencedAccounts: [],
        originClientId: null,
    });

    expect(rootQuery.taskOrderStore.getSnapshot().keys.map(getTaskQuerySortCursorTaskId)).toEqual([
        task1.id,
        task2.id,
        task3.id,
        task4.id,
    ]);

    const areChildTasksExpandedStoreByPath = new StoreMap<string, true>();

    const state = TaskGridViewVirtualizedListState.new(
        rootQuery,
        taskPath => areChildTasksExpandedStoreByPath.get(taskPath.join("-")),
        100,
    );

    expectItems(state.getSnapshot(), [
        {
            type: "Task",
            parents: [],
            query: rootQuery,
            cursor: getTaskQueryNormalizedSortCursorForModel(rootQuery.sorts, task1),
            isFirstTaskInQuery: true,
        },
        {
            type: "Task",
            parents: [],
            query: rootQuery,
            cursor: getTaskQueryNormalizedSortCursorForModel(rootQuery.sorts, task2),
            isFirstTaskInQuery: false,
        },
        {
            type: "Task",
            parents: [],
            query: rootQuery,
            cursor: getTaskQueryNormalizedSortCursorForModel(rootQuery.sorts, task3),
            isFirstTaskInQuery: false,
        },
        {
            type: "Task",
            parents: [],
            query: rootQuery,
            cursor: getTaskQueryNormalizedSortCursorForModel(rootQuery.sorts, task4),
            isFirstTaskInQuery: false,
        },
    ]);

    areChildTasksExpandedStoreByPath.set(task2.id, true);

    expectItems(state.getSnapshot(), [
        {
            type: "Task",
            parents: [],
            query: rootQuery,
            cursor: getTaskQueryNormalizedSortCursorForModel(rootQuery.sorts, task1),
            isFirstTaskInQuery: true,
        },
        {
            type: "Task",
            parents: [],
            query: rootQuery,
            cursor: getTaskQueryNormalizedSortCursorForModel(rootQuery.sorts, task2),
            isFirstTaskInQuery: false,
        },
        {
            type: "Task",
            parents: [
                {
                    query: rootQuery,
                    cursor: getTaskQueryNormalizedSortCursorForModel(rootQuery.sorts, task2),
                },
            ],
            query: query2,
            cursor: getTaskQueryNormalizedSortCursorForModel(query2.sorts, task2a),
            isFirstTaskInQuery: true,
        },
        {
            type: "Task",
            parents: [
                {
                    query: rootQuery,
                    cursor: getTaskQueryNormalizedSortCursorForModel(rootQuery.sorts, task2),
                },
            ],
            query: query2,
            cursor: getTaskQueryNormalizedSortCursorForModel(query2.sorts, task2b),
            isFirstTaskInQuery: false,
        },
        {
            type: "Task",
            parents: [
                {
                    query: rootQuery,
                    cursor: getTaskQueryNormalizedSortCursorForModel(rootQuery.sorts, task2),
                },
            ],
            query: query2,
            cursor: getTaskQueryNormalizedSortCursorForModel(query2.sorts, task2c),
            isFirstTaskInQuery: false,
        },
        {
            type: "Task",
            parents: [],
            query: rootQuery,
            cursor: getTaskQueryNormalizedSortCursorForModel(rootQuery.sorts, task3),
            isFirstTaskInQuery: false,
        },
        {
            type: "Task",
            parents: [],
            query: rootQuery,
            cursor: getTaskQueryNormalizedSortCursorForModel(rootQuery.sorts, task4),
            isFirstTaskInQuery: false,
        },
    ]);

    areChildTasksExpandedStoreByPath.set(task3.id, true);

    expectItems(state.getSnapshot(), [
        {
            type: "Task",
            parents: [],
            query: rootQuery,
            cursor: getTaskQueryNormalizedSortCursorForModel(rootQuery.sorts, task1),
            isFirstTaskInQuery: true,
        },
        {
            type: "Task",
            parents: [],
            query: rootQuery,
            cursor: getTaskQueryNormalizedSortCursorForModel(rootQuery.sorts, task2),
            isFirstTaskInQuery: false,
        },
        {
            type: "Task",
            parents: [
                {
                    query: rootQuery,
                    cursor: getTaskQueryNormalizedSortCursorForModel(rootQuery.sorts, task2),
                },
            ],
            query: query2,
            cursor: getTaskQueryNormalizedSortCursorForModel(query2.sorts, task2a),
            isFirstTaskInQuery: true,
        },
        {
            type: "Task",
            parents: [
                {
                    query: rootQuery,
                    cursor: getTaskQueryNormalizedSortCursorForModel(rootQuery.sorts, task2),
                },
            ],
            query: query2,
            cursor: getTaskQueryNormalizedSortCursorForModel(query2.sorts, task2b),
            isFirstTaskInQuery: false,
        },
        {
            type: "Task",
            parents: [
                {
                    query: rootQuery,
                    cursor: getTaskQueryNormalizedSortCursorForModel(rootQuery.sorts, task2),
                },
            ],
            query: query2,
            cursor: getTaskQueryNormalizedSortCursorForModel(query2.sorts, task2c),
            isFirstTaskInQuery: false,
        },
        {
            type: "Task",
            parents: [],
            query: rootQuery,
            cursor: getTaskQueryNormalizedSortCursorForModel(rootQuery.sorts, task3),
            isFirstTaskInQuery: false,
        },
        {
            type: "Task",
            parents: [
                {
                    query: rootQuery,
                    cursor: getTaskQueryNormalizedSortCursorForModel(rootQuery.sorts, task3),
                },
            ],
            query: query3,
            cursor: getTaskQueryNormalizedSortCursorForModel(query3.sorts, task3a),
            isFirstTaskInQuery: true,
        },
        {
            type: "Task",
            parents: [],
            query: rootQuery,
            cursor: getTaskQueryNormalizedSortCursorForModel(rootQuery.sorts, task4),
            isFirstTaskInQuery: false,
        },
    ]);

    areChildTasksExpandedStoreByPath.set(task4.id, true);

    expectItems(state.getSnapshot(), [
        {
            type: "Task",
            parents: [],
            query: rootQuery,
            cursor: getTaskQueryNormalizedSortCursorForModel(rootQuery.sorts, task1),
            isFirstTaskInQuery: true,
        },
        {
            type: "Task",
            parents: [],
            query: rootQuery,
            cursor: getTaskQueryNormalizedSortCursorForModel(rootQuery.sorts, task2),
            isFirstTaskInQuery: false,
        },
        {
            type: "Task",
            parents: [
                {
                    query: rootQuery,
                    cursor: getTaskQueryNormalizedSortCursorForModel(rootQuery.sorts, task2),
                },
            ],
            query: query2,
            cursor: getTaskQueryNormalizedSortCursorForModel(query2.sorts, task2a),
            isFirstTaskInQuery: true,
        },
        {
            type: "Task",
            parents: [
                {
                    query: rootQuery,
                    cursor: getTaskQueryNormalizedSortCursorForModel(rootQuery.sorts, task2),
                },
            ],
            query: query2,
            cursor: getTaskQueryNormalizedSortCursorForModel(query2.sorts, task2b),
            isFirstTaskInQuery: false,
        },
        {
            type: "Task",
            parents: [
                {
                    query: rootQuery,
                    cursor: getTaskQueryNormalizedSortCursorForModel(rootQuery.sorts, task2),
                },
            ],
            query: query2,
            cursor: getTaskQueryNormalizedSortCursorForModel(query2.sorts, task2c),
            isFirstTaskInQuery: false,
        },
        {
            type: "Task",
            parents: [],
            query: rootQuery,
            cursor: getTaskQueryNormalizedSortCursorForModel(rootQuery.sorts, task3),
            isFirstTaskInQuery: false,
        },
        {
            type: "Task",
            parents: [
                {
                    query: rootQuery,
                    cursor: getTaskQueryNormalizedSortCursorForModel(rootQuery.sorts, task3),
                },
            ],
            query: query3,
            cursor: getTaskQueryNormalizedSortCursorForModel(query3.sorts, task3a),
            isFirstTaskInQuery: true,
        },
        {
            type: "Task",
            parents: [],
            query: rootQuery,
            cursor: getTaskQueryNormalizedSortCursorForModel(rootQuery.sorts, task4),
            isFirstTaskInQuery: false,
        },
    ]);
});

test("can represent items of a query with some expanded child tasks and extra unloaded child tasks", () => {
    const store = new TaskClientStore({
        accountRegistry,
        spaceId,
        currentAccountId,
        onError: handleError,
    });

    const task1 = createTask(store);

    let task2 = createTask(store);

    task2 = task2.applyAction(
        {
            type: "UpdateTask",
            time: store.clock.now(),
            taskId: task2.id,
            taskAction: {
                type: "UpdateChildrenCounts",
                addedChildTaskCount: 4,
                removedChildTaskCount: 0,
                addedClosedChildTaskCount: 0,
                removedClosedChildTaskCount: 0,
            },
        },
        getSortableAccount,
    );

    let task2a = createTask(store);

    task2a = task2a
        .applyAction(
            {
                type: "UpdateTask",
                time: store.clock.now(),
                taskId: task2a.id,
                taskAction: {
                    type: "UpdatePriority",
                    priority: "Low",
                },
            },
            getSortableAccount,
        )
        .applyAction(
            {
                type: "UpdateTask",
                time: store.clock.now(),
                taskId: task2a.id,
                taskAction: {
                    type: "UpdateParentTaskId",
                    parentTaskId: task2.id,
                },
            },
            getSortableAccount,
        );

    let task2b = createTask(store);

    task2b = task2b
        .applyAction(
            {
                type: "UpdateTask",
                time: store.clock.now(),
                taskId: task2b.id,
                taskAction: {
                    type: "UpdatePriority",
                    priority: "Low",
                },
            },
            getSortableAccount,
        )
        .applyAction(
            {
                type: "UpdateTask",
                time: store.clock.now(),
                taskId: task2b.id,
                taskAction: {
                    type: "UpdateParentTaskId",
                    parentTaskId: task2.id,
                },
            },
            getSortableAccount,
        );

    let task2c = createTask(store);

    task2c = task2c
        .applyAction(
            {
                type: "UpdateTask",
                time: store.clock.now(),
                taskId: task2c.id,
                taskAction: {
                    type: "UpdatePriority",
                    priority: "Low",
                },
            },
            getSortableAccount,
        )
        .applyAction(
            {
                type: "UpdateTask",
                time: store.clock.now(),
                taskId: task2c.id,
                taskAction: {
                    type: "UpdateParentTaskId",
                    parentTaskId: task2.id,
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
                type: "UpdateChildrenCounts",
                addedChildTaskCount: 4,
                removedChildTaskCount: 0,
                addedClosedChildTaskCount: 0,
                removedClosedChildTaskCount: 0,
            },
        },
        getSortableAccount,
    );

    let task3a = createTask(store);

    task3a = task3a
        .applyAction(
            {
                type: "UpdateTask",
                time: store.clock.now(),
                taskId: task3a.id,
                taskAction: {
                    type: "UpdatePriority",
                    priority: "Low",
                },
            },
            getSortableAccount,
        )
        .applyAction(
            {
                type: "UpdateTask",
                time: store.clock.now(),
                taskId: task3a.id,
                taskAction: {
                    type: "UpdateParentTaskId",
                    parentTaskId: task3.id,
                },
            },
            getSortableAccount,
        );

    const task4 = createTask(store);

    const rootQuery = store.createAndRetainQuery({
        filters: {
            ...defaultTaskQueryNormalizedFilters,
            creatorFilter: {
                type: "OneOf",
                accountIds: assertNonEmptyReadonlySet(new Set([account1.id])),
            },
            priorityFilter: {
                ifNull: true,
                ifLow: false,
                ifMedium: false,
                ifHigh: false,
                ifUrgent: false,
            },
        },
        sorts: defaultTaskQueryNormalizedSorts,
        limit: 100,
    });

    const query2 = store.ensureAndRetainTaskChildrenQuery(task2.id, {limit: 100});
    const query3 = store.ensureAndRetainTaskChildrenQuery(task3.id, {limit: 100});

    store.loadTasksIntoQuery(rootQuery, {
        limit: 100,
        loadedState: {type: "Full"},
        previouslyBackfilledTaskIds: [],
    });

    store.loadTasksIntoQuery(query2, {
        limit: 100,
        loadedState: {type: "Full"},
        previouslyBackfilledTaskIds: [],
    });

    store.loadTasksIntoQuery(query3, {
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
            {type: "Authorized", task: task2a},
            {type: "Authorized", task: task2b},
            {type: "Authorized", task: task2c},
            {type: "Authorized", task: task3a},
        ],
        backfillCollections: [],
        referencedAccounts: [],
        originClientId: null,
    });

    expect(rootQuery.taskOrderStore.getSnapshot().keys.map(getTaskQuerySortCursorTaskId)).toEqual([
        task1.id,
        task2.id,
        task3.id,
        task4.id,
    ]);

    const areChildTasksExpandedStoreByPath = new StoreMap<string, true>();

    const state = TaskGridViewVirtualizedListState.new(
        rootQuery,
        taskPath => areChildTasksExpandedStoreByPath.get(taskPath.join("-")),
        100,
    );

    expectItems(state.getSnapshot(), [
        {
            type: "Task",
            parents: [],
            query: rootQuery,
            cursor: getTaskQueryNormalizedSortCursorForModel(rootQuery.sorts, task1),
            isFirstTaskInQuery: true,
        },
        {
            type: "Task",
            parents: [],
            query: rootQuery,
            cursor: getTaskQueryNormalizedSortCursorForModel(rootQuery.sorts, task2),
            isFirstTaskInQuery: false,
        },
        {
            type: "Task",
            parents: [],
            query: rootQuery,
            cursor: getTaskQueryNormalizedSortCursorForModel(rootQuery.sorts, task3),
            isFirstTaskInQuery: false,
        },
        {
            type: "Task",
            parents: [],
            query: rootQuery,
            cursor: getTaskQueryNormalizedSortCursorForModel(rootQuery.sorts, task4),
            isFirstTaskInQuery: false,
        },
    ]);

    areChildTasksExpandedStoreByPath.set(task2.id, true);

    expectItems(state.getSnapshot(), [
        {
            type: "Task",
            parents: [],
            query: rootQuery,
            cursor: getTaskQueryNormalizedSortCursorForModel(rootQuery.sorts, task1),
            isFirstTaskInQuery: true,
        },
        {
            type: "Task",
            parents: [],
            query: rootQuery,
            cursor: getTaskQueryNormalizedSortCursorForModel(rootQuery.sorts, task2),
            isFirstTaskInQuery: false,
        },
        {
            type: "Task",
            parents: [
                {
                    query: rootQuery,
                    cursor: getTaskQueryNormalizedSortCursorForModel(rootQuery.sorts, task2),
                },
            ],
            query: query2,
            cursor: getTaskQueryNormalizedSortCursorForModel(query2.sorts, task2a),
            isFirstTaskInQuery: true,
        },
        {
            type: "Task",
            parents: [
                {
                    query: rootQuery,
                    cursor: getTaskQueryNormalizedSortCursorForModel(rootQuery.sorts, task2),
                },
            ],
            query: query2,
            cursor: getTaskQueryNormalizedSortCursorForModel(query2.sorts, task2b),
            isFirstTaskInQuery: false,
        },
        {
            type: "Task",
            parents: [
                {
                    query: rootQuery,
                    cursor: getTaskQueryNormalizedSortCursorForModel(rootQuery.sorts, task2),
                },
            ],
            query: query2,
            cursor: getTaskQueryNormalizedSortCursorForModel(query2.sorts, task2c),
            isFirstTaskInQuery: false,
        },
        {
            type: "UnloadedChildTask",
            parents: [
                {
                    query: rootQuery,
                    cursor: getTaskQueryNormalizedSortCursorForModel(rootQuery.sorts, task2),
                },
            ],
            unloadedChildTaskIndex: 0,
        },
        {
            type: "Task",
            parents: [],
            query: rootQuery,
            cursor: getTaskQueryNormalizedSortCursorForModel(rootQuery.sorts, task3),
            isFirstTaskInQuery: false,
        },
        {
            type: "Task",
            parents: [],
            query: rootQuery,
            cursor: getTaskQueryNormalizedSortCursorForModel(rootQuery.sorts, task4),
            isFirstTaskInQuery: false,
        },
    ]);

    areChildTasksExpandedStoreByPath.set(task3.id, true);

    expectItems(state.getSnapshot(), [
        {
            type: "Task",
            parents: [],
            query: rootQuery,
            cursor: getTaskQueryNormalizedSortCursorForModel(rootQuery.sorts, task1),
            isFirstTaskInQuery: true,
        },
        {
            type: "Task",
            parents: [],
            query: rootQuery,
            cursor: getTaskQueryNormalizedSortCursorForModel(rootQuery.sorts, task2),
            isFirstTaskInQuery: false,
        },
        {
            type: "Task",
            parents: [
                {
                    query: rootQuery,
                    cursor: getTaskQueryNormalizedSortCursorForModel(rootQuery.sorts, task2),
                },
            ],
            query: query2,
            cursor: getTaskQueryNormalizedSortCursorForModel(query2.sorts, task2a),
            isFirstTaskInQuery: true,
        },
        {
            type: "Task",
            parents: [
                {
                    query: rootQuery,
                    cursor: getTaskQueryNormalizedSortCursorForModel(rootQuery.sorts, task2),
                },
            ],
            query: query2,
            cursor: getTaskQueryNormalizedSortCursorForModel(query2.sorts, task2b),
            isFirstTaskInQuery: false,
        },
        {
            type: "Task",
            parents: [
                {
                    query: rootQuery,
                    cursor: getTaskQueryNormalizedSortCursorForModel(rootQuery.sorts, task2),
                },
            ],
            query: query2,
            cursor: getTaskQueryNormalizedSortCursorForModel(query2.sorts, task2c),
            isFirstTaskInQuery: false,
        },
        {
            type: "UnloadedChildTask",
            parents: [
                {
                    query: rootQuery,
                    cursor: getTaskQueryNormalizedSortCursorForModel(rootQuery.sorts, task2),
                },
            ],
            unloadedChildTaskIndex: 0,
        },
        {
            type: "Task",
            parents: [],
            query: rootQuery,
            cursor: getTaskQueryNormalizedSortCursorForModel(rootQuery.sorts, task3),
            isFirstTaskInQuery: false,
        },
        {
            type: "Task",
            parents: [
                {
                    query: rootQuery,
                    cursor: getTaskQueryNormalizedSortCursorForModel(rootQuery.sorts, task3),
                },
            ],
            query: query3,
            cursor: getTaskQueryNormalizedSortCursorForModel(query3.sorts, task3a),
            isFirstTaskInQuery: true,
        },
        {
            type: "UnloadedChildTask",
            parents: [
                {
                    query: rootQuery,
                    cursor: getTaskQueryNormalizedSortCursorForModel(rootQuery.sorts, task3),
                },
            ],
            unloadedChildTaskIndex: 0,
        },
        {
            type: "UnloadedChildTask",
            parents: [
                {
                    query: rootQuery,
                    cursor: getTaskQueryNormalizedSortCursorForModel(rootQuery.sorts, task3),
                },
            ],
            unloadedChildTaskIndex: 1,
        },
        {
            type: "UnloadedChildTask",
            parents: [
                {
                    query: rootQuery,
                    cursor: getTaskQueryNormalizedSortCursorForModel(rootQuery.sorts, task3),
                },
            ],
            unloadedChildTaskIndex: 2,
        },
        {
            type: "Task",
            parents: [],
            query: rootQuery,
            cursor: getTaskQueryNormalizedSortCursorForModel(rootQuery.sorts, task4),
            isFirstTaskInQuery: false,
        },
    ]);

    areChildTasksExpandedStoreByPath.set(task4.id, true);

    expectItems(state.getSnapshot(), [
        {
            type: "Task",
            parents: [],
            query: rootQuery,
            cursor: getTaskQueryNormalizedSortCursorForModel(rootQuery.sorts, task1),
            isFirstTaskInQuery: true,
        },
        {
            type: "Task",
            parents: [],
            query: rootQuery,
            cursor: getTaskQueryNormalizedSortCursorForModel(rootQuery.sorts, task2),
            isFirstTaskInQuery: false,
        },
        {
            type: "Task",
            parents: [
                {
                    query: rootQuery,
                    cursor: getTaskQueryNormalizedSortCursorForModel(rootQuery.sorts, task2),
                },
            ],
            query: query2,
            cursor: getTaskQueryNormalizedSortCursorForModel(query2.sorts, task2a),
            isFirstTaskInQuery: true,
        },
        {
            type: "Task",
            parents: [
                {
                    query: rootQuery,
                    cursor: getTaskQueryNormalizedSortCursorForModel(rootQuery.sorts, task2),
                },
            ],
            query: query2,
            cursor: getTaskQueryNormalizedSortCursorForModel(query2.sorts, task2b),
            isFirstTaskInQuery: false,
        },
        {
            type: "Task",
            parents: [
                {
                    query: rootQuery,
                    cursor: getTaskQueryNormalizedSortCursorForModel(rootQuery.sorts, task2),
                },
            ],
            query: query2,
            cursor: getTaskQueryNormalizedSortCursorForModel(query2.sorts, task2c),
            isFirstTaskInQuery: false,
        },
        {
            type: "UnloadedChildTask",
            parents: [
                {
                    query: rootQuery,
                    cursor: getTaskQueryNormalizedSortCursorForModel(rootQuery.sorts, task2),
                },
            ],
            unloadedChildTaskIndex: 0,
        },
        {
            type: "Task",
            parents: [],
            query: rootQuery,
            cursor: getTaskQueryNormalizedSortCursorForModel(rootQuery.sorts, task3),
            isFirstTaskInQuery: false,
        },
        {
            type: "Task",
            parents: [
                {
                    query: rootQuery,
                    cursor: getTaskQueryNormalizedSortCursorForModel(rootQuery.sorts, task3),
                },
            ],
            query: query3,
            cursor: getTaskQueryNormalizedSortCursorForModel(query3.sorts, task3a),
            isFirstTaskInQuery: true,
        },
        {
            type: "UnloadedChildTask",
            parents: [
                {
                    query: rootQuery,
                    cursor: getTaskQueryNormalizedSortCursorForModel(rootQuery.sorts, task3),
                },
            ],
            unloadedChildTaskIndex: 0,
        },
        {
            type: "UnloadedChildTask",
            parents: [
                {
                    query: rootQuery,
                    cursor: getTaskQueryNormalizedSortCursorForModel(rootQuery.sorts, task3),
                },
            ],
            unloadedChildTaskIndex: 1,
        },
        {
            type: "UnloadedChildTask",
            parents: [
                {
                    query: rootQuery,
                    cursor: getTaskQueryNormalizedSortCursorForModel(rootQuery.sorts, task3),
                },
            ],
            unloadedChildTaskIndex: 2,
        },
        {
            type: "Task",
            parents: [],
            query: rootQuery,
            cursor: getTaskQueryNormalizedSortCursorForModel(rootQuery.sorts, task4),
            isFirstTaskInQuery: false,
        },
    ]);
});

test("can represent items of a query with some expanded child tasks where task reports fewer than query", () => {
    const store = new TaskClientStore({
        accountRegistry,
        spaceId,
        currentAccountId,
        onError: handleError,
    });

    const task1 = createTask(store);

    let task2 = createTask(store);

    task2 = task2.applyAction(
        {
            type: "UpdateTask",
            time: store.clock.now(),
            taskId: task2.id,
            taskAction: {
                type: "UpdateChildrenCounts",
                addedChildTaskCount: 1,
                removedChildTaskCount: 0,
                addedClosedChildTaskCount: 0,
                removedClosedChildTaskCount: 0,
            },
        },
        getSortableAccount,
    );

    let task2a = createTask(store);

    task2a = task2a
        .applyAction(
            {
                type: "UpdateTask",
                time: store.clock.now(),
                taskId: task2a.id,
                taskAction: {
                    type: "UpdatePriority",
                    priority: "Low",
                },
            },
            getSortableAccount,
        )
        .applyAction(
            {
                type: "UpdateTask",
                time: store.clock.now(),
                taskId: task2a.id,
                taskAction: {
                    type: "UpdateParentTaskId",
                    parentTaskId: task2.id,
                },
            },
            getSortableAccount,
        );

    let task2b = createTask(store);

    task2b = task2b
        .applyAction(
            {
                type: "UpdateTask",
                time: store.clock.now(),
                taskId: task2b.id,
                taskAction: {
                    type: "UpdatePriority",
                    priority: "Low",
                },
            },
            getSortableAccount,
        )
        .applyAction(
            {
                type: "UpdateTask",
                time: store.clock.now(),
                taskId: task2b.id,
                taskAction: {
                    type: "UpdateParentTaskId",
                    parentTaskId: task2.id,
                },
            },
            getSortableAccount,
        );

    let task2c = createTask(store);

    task2c = task2c
        .applyAction(
            {
                type: "UpdateTask",
                time: store.clock.now(),
                taskId: task2c.id,
                taskAction: {
                    type: "UpdatePriority",
                    priority: "Low",
                },
            },
            getSortableAccount,
        )
        .applyAction(
            {
                type: "UpdateTask",
                time: store.clock.now(),
                taskId: task2c.id,
                taskAction: {
                    type: "UpdateParentTaskId",
                    parentTaskId: task2.id,
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
                type: "UpdateChildrenCounts",
                addedChildTaskCount: 0,
                removedChildTaskCount: 0,
                addedClosedChildTaskCount: 0,
                removedClosedChildTaskCount: 0,
            },
        },
        getSortableAccount,
    );

    let task3a = createTask(store);

    task3a = task3a
        .applyAction(
            {
                type: "UpdateTask",
                time: store.clock.now(),
                taskId: task3a.id,
                taskAction: {
                    type: "UpdatePriority",
                    priority: "Low",
                },
            },
            getSortableAccount,
        )
        .applyAction(
            {
                type: "UpdateTask",
                time: store.clock.now(),
                taskId: task3a.id,
                taskAction: {
                    type: "UpdateParentTaskId",
                    parentTaskId: task3.id,
                },
            },
            getSortableAccount,
        );

    const task4 = createTask(store);

    const rootQuery = store.createAndRetainQuery({
        filters: {
            ...defaultTaskQueryNormalizedFilters,
            creatorFilter: {
                type: "OneOf",
                accountIds: assertNonEmptyReadonlySet(new Set([account1.id])),
            },
            priorityFilter: {
                ifNull: true,
                ifLow: false,
                ifMedium: false,
                ifHigh: false,
                ifUrgent: false,
            },
        },
        sorts: defaultTaskQueryNormalizedSorts,
        limit: 100,
    });

    const query2 = store.ensureAndRetainTaskChildrenQuery(task2.id, {limit: 100});
    const query3 = store.ensureAndRetainTaskChildrenQuery(task3.id, {limit: 100});

    store.loadTasksIntoQuery(rootQuery, {
        limit: 100,
        loadedState: {type: "Full"},
        previouslyBackfilledTaskIds: [],
    });

    store.loadTasksIntoQuery(query2, {
        limit: 100,
        loadedState: {type: "Full"},
        previouslyBackfilledTaskIds: [],
    });

    store.loadTasksIntoQuery(query3, {
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
            {type: "Authorized", task: task2a},
            {type: "Authorized", task: task2b},
            {type: "Authorized", task: task2c},
            {type: "Authorized", task: task3a},
        ],
        backfillCollections: [],
        referencedAccounts: [],
        originClientId: null,
    });

    expect(rootQuery.taskOrderStore.getSnapshot().keys.map(getTaskQuerySortCursorTaskId)).toEqual([
        task1.id,
        task2.id,
        task3.id,
        task4.id,
    ]);

    const areChildTasksExpandedStoreByPath = new StoreMap<string, true>();

    const state = TaskGridViewVirtualizedListState.new(
        rootQuery,
        taskPath => areChildTasksExpandedStoreByPath.get(taskPath.join("-")),
        100,
    );

    expectItems(state.getSnapshot(), [
        {
            type: "Task",
            parents: [],
            query: rootQuery,
            cursor: getTaskQueryNormalizedSortCursorForModel(rootQuery.sorts, task1),
            isFirstTaskInQuery: true,
        },
        {
            type: "Task",
            parents: [],
            query: rootQuery,
            cursor: getTaskQueryNormalizedSortCursorForModel(rootQuery.sorts, task2),
            isFirstTaskInQuery: false,
        },
        {
            type: "Task",
            parents: [],
            query: rootQuery,
            cursor: getTaskQueryNormalizedSortCursorForModel(rootQuery.sorts, task3),
            isFirstTaskInQuery: false,
        },
        {
            type: "Task",
            parents: [],
            query: rootQuery,
            cursor: getTaskQueryNormalizedSortCursorForModel(rootQuery.sorts, task4),
            isFirstTaskInQuery: false,
        },
    ]);

    areChildTasksExpandedStoreByPath.set(task2.id, true);

    expectItems(state.getSnapshot(), [
        {
            type: "Task",
            parents: [],
            query: rootQuery,
            cursor: getTaskQueryNormalizedSortCursorForModel(rootQuery.sorts, task1),
            isFirstTaskInQuery: true,
        },
        {
            type: "Task",
            parents: [],
            query: rootQuery,
            cursor: getTaskQueryNormalizedSortCursorForModel(rootQuery.sorts, task2),
            isFirstTaskInQuery: false,
        },
        {
            type: "Task",
            parents: [
                {
                    query: rootQuery,
                    cursor: getTaskQueryNormalizedSortCursorForModel(rootQuery.sorts, task2),
                },
            ],
            query: query2,
            cursor: getTaskQueryNormalizedSortCursorForModel(query2.sorts, task2a),
            isFirstTaskInQuery: true,
        },
        {
            type: "Task",
            parents: [
                {
                    query: rootQuery,
                    cursor: getTaskQueryNormalizedSortCursorForModel(rootQuery.sorts, task2),
                },
            ],
            query: query2,
            cursor: getTaskQueryNormalizedSortCursorForModel(query2.sorts, task2b),
            isFirstTaskInQuery: false,
        },
        {
            type: "Task",
            parents: [
                {
                    query: rootQuery,
                    cursor: getTaskQueryNormalizedSortCursorForModel(rootQuery.sorts, task2),
                },
            ],
            query: query2,
            cursor: getTaskQueryNormalizedSortCursorForModel(query2.sorts, task2c),
            isFirstTaskInQuery: false,
        },
        {
            type: "Task",
            parents: [],
            query: rootQuery,
            cursor: getTaskQueryNormalizedSortCursorForModel(rootQuery.sorts, task3),
            isFirstTaskInQuery: false,
        },
        {
            type: "Task",
            parents: [],
            query: rootQuery,
            cursor: getTaskQueryNormalizedSortCursorForModel(rootQuery.sorts, task4),
            isFirstTaskInQuery: false,
        },
    ]);

    areChildTasksExpandedStoreByPath.set(task3.id, true);

    expectItems(state.getSnapshot(), [
        {
            type: "Task",
            parents: [],
            query: rootQuery,
            cursor: getTaskQueryNormalizedSortCursorForModel(rootQuery.sorts, task1),
            isFirstTaskInQuery: true,
        },
        {
            type: "Task",
            parents: [],
            query: rootQuery,
            cursor: getTaskQueryNormalizedSortCursorForModel(rootQuery.sorts, task2),
            isFirstTaskInQuery: false,
        },
        {
            type: "Task",
            parents: [
                {
                    query: rootQuery,
                    cursor: getTaskQueryNormalizedSortCursorForModel(rootQuery.sorts, task2),
                },
            ],
            query: query2,
            cursor: getTaskQueryNormalizedSortCursorForModel(query2.sorts, task2a),
            isFirstTaskInQuery: true,
        },
        {
            type: "Task",
            parents: [
                {
                    query: rootQuery,
                    cursor: getTaskQueryNormalizedSortCursorForModel(rootQuery.sorts, task2),
                },
            ],
            query: query2,
            cursor: getTaskQueryNormalizedSortCursorForModel(query2.sorts, task2b),
            isFirstTaskInQuery: false,
        },
        {
            type: "Task",
            parents: [
                {
                    query: rootQuery,
                    cursor: getTaskQueryNormalizedSortCursorForModel(rootQuery.sorts, task2),
                },
            ],
            query: query2,
            cursor: getTaskQueryNormalizedSortCursorForModel(query2.sorts, task2c),
            isFirstTaskInQuery: false,
        },
        {
            type: "Task",
            parents: [],
            query: rootQuery,
            cursor: getTaskQueryNormalizedSortCursorForModel(rootQuery.sorts, task3),
            isFirstTaskInQuery: false,
        },
        {
            type: "Task",
            parents: [],
            query: rootQuery,
            cursor: getTaskQueryNormalizedSortCursorForModel(rootQuery.sorts, task4),
            isFirstTaskInQuery: false,
        },
    ]);

    areChildTasksExpandedStoreByPath.set(task4.id, true);

    expectItems(state.getSnapshot(), [
        {
            type: "Task",
            parents: [],
            query: rootQuery,
            cursor: getTaskQueryNormalizedSortCursorForModel(rootQuery.sorts, task1),
            isFirstTaskInQuery: true,
        },
        {
            type: "Task",
            parents: [],
            query: rootQuery,
            cursor: getTaskQueryNormalizedSortCursorForModel(rootQuery.sorts, task2),
            isFirstTaskInQuery: false,
        },
        {
            type: "Task",
            parents: [
                {
                    query: rootQuery,
                    cursor: getTaskQueryNormalizedSortCursorForModel(rootQuery.sorts, task2),
                },
            ],
            query: query2,
            cursor: getTaskQueryNormalizedSortCursorForModel(query2.sorts, task2a),
            isFirstTaskInQuery: true,
        },
        {
            type: "Task",
            parents: [
                {
                    query: rootQuery,
                    cursor: getTaskQueryNormalizedSortCursorForModel(rootQuery.sorts, task2),
                },
            ],
            query: query2,
            cursor: getTaskQueryNormalizedSortCursorForModel(query2.sorts, task2b),
            isFirstTaskInQuery: false,
        },
        {
            type: "Task",
            parents: [
                {
                    query: rootQuery,
                    cursor: getTaskQueryNormalizedSortCursorForModel(rootQuery.sorts, task2),
                },
            ],
            query: query2,
            cursor: getTaskQueryNormalizedSortCursorForModel(query2.sorts, task2c),
            isFirstTaskInQuery: false,
        },
        {
            type: "Task",
            parents: [],
            query: rootQuery,
            cursor: getTaskQueryNormalizedSortCursorForModel(rootQuery.sorts, task3),
            isFirstTaskInQuery: false,
        },
        {
            type: "Task",
            parents: [],
            query: rootQuery,
            cursor: getTaskQueryNormalizedSortCursorForModel(rootQuery.sorts, task4),
            isFirstTaskInQuery: false,
        },
    ]);
});

test("can represent items of a query with some double nested expanded child tasks", () => {
    const store = new TaskClientStore({
        accountRegistry,
        spaceId,
        currentAccountId,
        onError: handleError,
    });

    const task1 = createTask(store);

    let task2 = createTask(store);

    task2 = task2.applyAction(
        {
            type: "UpdateTask",
            time: store.clock.now(),
            taskId: task2.id,
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

    let task2a = createTask(store);

    task2a = task2a
        .applyAction(
            {
                type: "UpdateTask",
                time: store.clock.now(),
                taskId: task2a.id,
                taskAction: {
                    type: "UpdatePriority",
                    priority: "Low",
                },
            },
            getSortableAccount,
        )
        .applyAction(
            {
                type: "UpdateTask",
                time: store.clock.now(),
                taskId: task2a.id,
                taskAction: {
                    type: "UpdateParentTaskId",
                    parentTaskId: task2.id,
                },
            },
            getSortableAccount,
        );

    let task2b = createTask(store);

    task2b = task2b
        .applyAction(
            {
                type: "UpdateTask",
                time: store.clock.now(),
                taskId: task2b.id,
                taskAction: {
                    type: "UpdatePriority",
                    priority: "Low",
                },
            },
            getSortableAccount,
        )
        .applyAction(
            {
                type: "UpdateTask",
                time: store.clock.now(),
                taskId: task2b.id,
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
                taskId: task2b.id,
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

    let task2c = createTask(store);

    task2c = task2c
        .applyAction(
            {
                type: "UpdateTask",
                time: store.clock.now(),
                taskId: task2c.id,
                taskAction: {
                    type: "UpdatePriority",
                    priority: "Low",
                },
            },
            getSortableAccount,
        )
        .applyAction(
            {
                type: "UpdateTask",
                time: store.clock.now(),
                taskId: task2c.id,
                taskAction: {
                    type: "UpdateParentTaskId",
                    parentTaskId: task2.id,
                },
            },
            getSortableAccount,
        );

    let task2b1 = createTask(store);

    task2b1 = task2b1
        .applyAction(
            {
                type: "UpdateTask",
                time: store.clock.now(),
                taskId: task2b1.id,
                taskAction: {
                    type: "UpdatePriority",
                    priority: "Low",
                },
            },
            getSortableAccount,
        )
        .applyAction(
            {
                type: "UpdateTask",
                time: store.clock.now(),
                taskId: task2b1.id,
                taskAction: {
                    type: "UpdateParentTaskId",
                    parentTaskId: task2b.id,
                },
            },
            getSortableAccount,
        );

    let task2b2 = createTask(store);

    task2b2 = task2b2
        .applyAction(
            {
                type: "UpdateTask",
                time: store.clock.now(),
                taskId: task2b2.id,
                taskAction: {
                    type: "UpdatePriority",
                    priority: "Low",
                },
            },
            getSortableAccount,
        )
        .applyAction(
            {
                type: "UpdateTask",
                time: store.clock.now(),
                taskId: task2b2.id,
                taskAction: {
                    type: "UpdateParentTaskId",
                    parentTaskId: task2b.id,
                },
            },
            getSortableAccount,
        );

    let task2b3 = createTask(store);

    task2b3 = task2b3
        .applyAction(
            {
                type: "UpdateTask",
                time: store.clock.now(),
                taskId: task2b3.id,
                taskAction: {
                    type: "UpdatePriority",
                    priority: "Low",
                },
            },
            getSortableAccount,
        )
        .applyAction(
            {
                type: "UpdateTask",
                time: store.clock.now(),
                taskId: task2b3.id,
                taskAction: {
                    type: "UpdateParentTaskId",
                    parentTaskId: task2b.id,
                },
            },
            getSortableAccount,
        );

    const task3 = createTask(store);
    const task4 = createTask(store);

    const rootQuery = store.createAndRetainQuery({
        filters: {
            ...defaultTaskQueryNormalizedFilters,
            creatorFilter: {
                type: "OneOf",
                accountIds: assertNonEmptyReadonlySet(new Set([account1.id])),
            },
            priorityFilter: {
                ifNull: true,
                ifLow: false,
                ifMedium: false,
                ifHigh: false,
                ifUrgent: false,
            },
        },
        sorts: defaultTaskQueryNormalizedSorts,
        limit: 100,
    });

    const query2 = store.ensureAndRetainTaskChildrenQuery(task2.id, {limit: 100});
    const query2b = store.ensureAndRetainTaskChildrenQuery(task2b.id, {limit: 100});

    store.loadTasksIntoQuery(rootQuery, {
        limit: 100,
        loadedState: {type: "Full"},
        previouslyBackfilledTaskIds: [],
    });

    store.loadTasksIntoQuery(query2, {
        limit: 100,
        loadedState: {type: "Full"},
        previouslyBackfilledTaskIds: [],
    });

    store.loadTasksIntoQuery(query2b, {
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
            {type: "Authorized", task: task2a},
            {type: "Authorized", task: task2b},
            {type: "Authorized", task: task2b1},
            {type: "Authorized", task: task2b2},
            {type: "Authorized", task: task2b3},
            {type: "Authorized", task: task2c},
        ],
        backfillCollections: [],
        referencedAccounts: [],
        originClientId: null,
    });

    expect(rootQuery.taskOrderStore.getSnapshot().keys.map(getTaskQuerySortCursorTaskId)).toEqual([
        task1.id,
        task2.id,
        task3.id,
        task4.id,
    ]);

    const areChildTasksExpandedStoreByPath = new StoreMap<string, true>();

    const state = TaskGridViewVirtualizedListState.new(
        rootQuery,
        taskPath => areChildTasksExpandedStoreByPath.get(taskPath.join("-")),
        100,
    );

    expectItems(state.getSnapshot(), [
        {
            type: "Task",
            parents: [],
            query: rootQuery,
            cursor: getTaskQueryNormalizedSortCursorForModel(rootQuery.sorts, task1),
            isFirstTaskInQuery: true,
        },
        {
            type: "Task",
            parents: [],
            query: rootQuery,
            cursor: getTaskQueryNormalizedSortCursorForModel(rootQuery.sorts, task2),
            isFirstTaskInQuery: false,
        },
        {
            type: "Task",
            parents: [],
            query: rootQuery,
            cursor: getTaskQueryNormalizedSortCursorForModel(rootQuery.sorts, task3),
            isFirstTaskInQuery: false,
        },
        {
            type: "Task",
            parents: [],
            query: rootQuery,
            cursor: getTaskQueryNormalizedSortCursorForModel(rootQuery.sorts, task4),
            isFirstTaskInQuery: false,
        },
    ]);

    areChildTasksExpandedStoreByPath.set(task2.id, true);

    expectItems(state.getSnapshot(), [
        {
            type: "Task",
            parents: [],
            query: rootQuery,
            cursor: getTaskQueryNormalizedSortCursorForModel(rootQuery.sorts, task1),
            isFirstTaskInQuery: true,
        },
        {
            type: "Task",
            parents: [],
            query: rootQuery,
            cursor: getTaskQueryNormalizedSortCursorForModel(rootQuery.sorts, task2),
            isFirstTaskInQuery: false,
        },
        {
            type: "Task",
            parents: [
                {
                    query: rootQuery,
                    cursor: getTaskQueryNormalizedSortCursorForModel(rootQuery.sorts, task2),
                },
            ],
            query: query2,
            cursor: getTaskQueryNormalizedSortCursorForModel(query2.sorts, task2a),
            isFirstTaskInQuery: true,
        },
        {
            type: "Task",
            parents: [
                {
                    query: rootQuery,
                    cursor: getTaskQueryNormalizedSortCursorForModel(rootQuery.sorts, task2),
                },
            ],
            query: query2,
            cursor: getTaskQueryNormalizedSortCursorForModel(query2.sorts, task2b),
            isFirstTaskInQuery: false,
        },
        {
            type: "Task",
            parents: [
                {
                    query: rootQuery,
                    cursor: getTaskQueryNormalizedSortCursorForModel(rootQuery.sorts, task2),
                },
            ],
            query: query2,
            cursor: getTaskQueryNormalizedSortCursorForModel(query2.sorts, task2c),
            isFirstTaskInQuery: false,
        },
        {
            type: "Task",
            parents: [],
            query: rootQuery,
            cursor: getTaskQueryNormalizedSortCursorForModel(rootQuery.sorts, task3),
            isFirstTaskInQuery: false,
        },
        {
            type: "Task",
            parents: [],
            query: rootQuery,
            cursor: getTaskQueryNormalizedSortCursorForModel(rootQuery.sorts, task4),
            isFirstTaskInQuery: false,
        },
    ]);

    areChildTasksExpandedStoreByPath.set(`${task2.id}-${task2b.id}`, true);

    expectItems(state.getSnapshot(), [
        {
            type: "Task",
            parents: [],
            query: rootQuery,
            cursor: getTaskQueryNormalizedSortCursorForModel(rootQuery.sorts, task1),
            isFirstTaskInQuery: true,
        },
        {
            type: "Task",
            parents: [],
            query: rootQuery,
            cursor: getTaskQueryNormalizedSortCursorForModel(rootQuery.sorts, task2),
            isFirstTaskInQuery: false,
        },
        {
            type: "Task",
            parents: [
                {
                    query: rootQuery,
                    cursor: getTaskQueryNormalizedSortCursorForModel(rootQuery.sorts, task2),
                },
            ],
            query: query2,
            cursor: getTaskQueryNormalizedSortCursorForModel(query2.sorts, task2a),
            isFirstTaskInQuery: true,
        },
        {
            type: "Task",
            parents: [
                {
                    query: rootQuery,
                    cursor: getTaskQueryNormalizedSortCursorForModel(rootQuery.sorts, task2),
                },
            ],
            query: query2,
            cursor: getTaskQueryNormalizedSortCursorForModel(query2.sorts, task2b),
            isFirstTaskInQuery: false,
        },
        {
            type: "Task",
            parents: [
                {
                    query: rootQuery,
                    cursor: getTaskQueryNormalizedSortCursorForModel(rootQuery.sorts, task2),
                },
                {
                    query: query2,
                    cursor: getTaskQueryNormalizedSortCursorForModel(query2.sorts, task2b),
                },
            ],
            query: query2b,
            cursor: getTaskQueryNormalizedSortCursorForModel(query2b.sorts, task2b1),
            isFirstTaskInQuery: true,
        },
        {
            type: "Task",
            parents: [
                {
                    query: rootQuery,
                    cursor: getTaskQueryNormalizedSortCursorForModel(rootQuery.sorts, task2),
                },
                {
                    query: query2,
                    cursor: getTaskQueryNormalizedSortCursorForModel(query2.sorts, task2b),
                },
            ],
            query: query2b,
            cursor: getTaskQueryNormalizedSortCursorForModel(query2b.sorts, task2b2),
            isFirstTaskInQuery: false,
        },
        {
            type: "Task",
            parents: [
                {
                    query: rootQuery,
                    cursor: getTaskQueryNormalizedSortCursorForModel(rootQuery.sorts, task2),
                },
                {
                    query: query2,
                    cursor: getTaskQueryNormalizedSortCursorForModel(query2.sorts, task2b),
                },
            ],
            query: query2b,
            cursor: getTaskQueryNormalizedSortCursorForModel(query2b.sorts, task2b3),
            isFirstTaskInQuery: false,
        },
        {
            type: "Task",
            parents: [
                {
                    query: rootQuery,
                    cursor: getTaskQueryNormalizedSortCursorForModel(rootQuery.sorts, task2),
                },
            ],
            query: query2,
            cursor: getTaskQueryNormalizedSortCursorForModel(query2.sorts, task2c),
            isFirstTaskInQuery: false,
        },
        {
            type: "Task",
            parents: [],
            query: rootQuery,
            cursor: getTaskQueryNormalizedSortCursorForModel(rootQuery.sorts, task3),
            isFirstTaskInQuery: false,
        },
        {
            type: "Task",
            parents: [],
            query: rootQuery,
            cursor: getTaskQueryNormalizedSortCursorForModel(rootQuery.sorts, task4),
            isFirstTaskInQuery: false,
        },
    ]);
});

test("can get the index of items including nested items if the path to the task is known", () => {
    const store = new TaskClientStore({
        accountRegistry,
        spaceId,
        currentAccountId,
        onError: handleError,
    });

    const task1 = createTask(store);

    let task2 = createTask(store);

    task2 = task2.applyAction(
        {
            type: "UpdateTask",
            time: store.clock.now(),
            taskId: task2.id,
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

    let task2a = createTask(store);

    task2a = task2a
        .applyAction(
            {
                type: "UpdateTask",
                time: store.clock.now(),
                taskId: task2a.id,
                taskAction: {
                    type: "UpdatePriority",
                    priority: "Low",
                },
            },
            getSortableAccount,
        )
        .applyAction(
            {
                type: "UpdateTask",
                time: store.clock.now(),
                taskId: task2a.id,
                taskAction: {
                    type: "UpdateParentTaskId",
                    parentTaskId: task2.id,
                },
            },
            getSortableAccount,
        );

    let task2b = createTask(store);

    task2b = task2b
        .applyAction(
            {
                type: "UpdateTask",
                time: store.clock.now(),
                taskId: task2b.id,
                taskAction: {
                    type: "UpdatePriority",
                    priority: "Low",
                },
            },
            getSortableAccount,
        )
        .applyAction(
            {
                type: "UpdateTask",
                time: store.clock.now(),
                taskId: task2b.id,
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
                taskId: task2b.id,
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

    let task2c = createTask(store);

    task2c = task2c
        .applyAction(
            {
                type: "UpdateTask",
                time: store.clock.now(),
                taskId: task2c.id,
                taskAction: {
                    type: "UpdatePriority",
                    priority: "Low",
                },
            },
            getSortableAccount,
        )
        .applyAction(
            {
                type: "UpdateTask",
                time: store.clock.now(),
                taskId: task2c.id,
                taskAction: {
                    type: "UpdateParentTaskId",
                    parentTaskId: task2.id,
                },
            },
            getSortableAccount,
        );

    let task2b1 = createTask(store);

    task2b1 = task2b1
        .applyAction(
            {
                type: "UpdateTask",
                time: store.clock.now(),
                taskId: task2b1.id,
                taskAction: {
                    type: "UpdatePriority",
                    priority: "Low",
                },
            },
            getSortableAccount,
        )
        .applyAction(
            {
                type: "UpdateTask",
                time: store.clock.now(),
                taskId: task2b1.id,
                taskAction: {
                    type: "UpdateParentTaskId",
                    parentTaskId: task2b.id,
                },
            },
            getSortableAccount,
        );

    let task2b2 = createTask(store);

    task2b2 = task2b2
        .applyAction(
            {
                type: "UpdateTask",
                time: store.clock.now(),
                taskId: task2b2.id,
                taskAction: {
                    type: "UpdatePriority",
                    priority: "Low",
                },
            },
            getSortableAccount,
        )
        .applyAction(
            {
                type: "UpdateTask",
                time: store.clock.now(),
                taskId: task2b2.id,
                taskAction: {
                    type: "UpdateParentTaskId",
                    parentTaskId: task2b.id,
                },
            },
            getSortableAccount,
        );

    let task2b3 = createTask(store);

    task2b3 = task2b3
        .applyAction(
            {
                type: "UpdateTask",
                time: store.clock.now(),
                taskId: task2b3.id,
                taskAction: {
                    type: "UpdatePriority",
                    priority: "Low",
                },
            },
            getSortableAccount,
        )
        .applyAction(
            {
                type: "UpdateTask",
                time: store.clock.now(),
                taskId: task2b3.id,
                taskAction: {
                    type: "UpdateParentTaskId",
                    parentTaskId: task2b.id,
                },
            },
            getSortableAccount,
        );

    const task3 = createTask(store);
    const task4 = createTask(store);

    const rootQuery = store.createAndRetainQuery({
        filters: {
            ...defaultTaskQueryNormalizedFilters,
            creatorFilter: {
                type: "OneOf",
                accountIds: assertNonEmptyReadonlySet(new Set([account1.id])),
            },
            priorityFilter: {
                ifNull: true,
                ifLow: false,
                ifMedium: false,
                ifHigh: false,
                ifUrgent: false,
            },
        },
        sorts: defaultTaskQueryNormalizedSorts,
        limit: 100,
    });

    const query2 = store.ensureAndRetainTaskChildrenQuery(task2.id, {limit: 100});
    const query2b = store.ensureAndRetainTaskChildrenQuery(task2b.id, {limit: 100});

    store.loadTasksIntoQuery(rootQuery, {
        limit: 100,
        loadedState: {type: "Full"},
        previouslyBackfilledTaskIds: [],
    });

    store.loadTasksIntoQuery(query2, {
        limit: 100,
        loadedState: {type: "Full"},
        previouslyBackfilledTaskIds: [],
    });

    store.loadTasksIntoQuery(query2b, {
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
            {type: "Authorized", task: task2a},
            {type: "Authorized", task: task2b},
            {type: "Authorized", task: task2b1},
            {type: "Authorized", task: task2b2},
            {type: "Authorized", task: task2b3},
            {type: "Authorized", task: task2c},
        ],
        backfillCollections: [],
        referencedAccounts: [],
        originClientId: null,
    });

    expect(rootQuery.taskOrderStore.getSnapshot().keys.map(getTaskQuerySortCursorTaskId)).toEqual([
        task1.id,
        task2.id,
        task3.id,
        task4.id,
    ]);

    const areChildTasksExpandedStoreByPath = new StoreMap<string, true>();

    const state = TaskGridViewVirtualizedListState.new(
        rootQuery,
        taskPath => areChildTasksExpandedStoreByPath.get(taskPath.join("-")),
        100,
    );

    areChildTasksExpandedStoreByPath.set(task2.id, true);

    expect(
        state
            .getSnapshot()
            .getIndexByRootCursorIfExists(
                getTaskQueryNormalizedSortCursorForModel(rootQuery.sorts, task1),
            ),
    ).toEqual(0);

    expect(
        state
            .getSnapshot()
            .getIndexByRootCursorIfExists(
                getTaskQueryNormalizedSortCursorForModel(rootQuery.sorts, task2),
            ),
    ).toEqual(1);

    expect(
        state
            .getSnapshot()
            .getIndexByRootCursorIfExists(
                getTaskQueryNormalizedSortCursorForModel(rootQuery.sorts, task2b),
            ),
    ).toEqual(null);

    expect(
        state
            .getSnapshot()
            .getIndexByRootCursorIfExists(
                getTaskQueryNormalizedSortCursorForModel(rootQuery.sorts, task2b1),
            ),
    ).toEqual(null);

    expect(
        state
            .getSnapshot()
            .getIndexByRootCursorIfExists(
                getTaskQueryNormalizedSortCursorForModel(rootQuery.sorts, task3),
            ),
    ).toEqual(5);

    expect(
        state
            .getSnapshot()
            .getIndexByRootCursorIfExists(
                getTaskQueryNormalizedSortCursorForModel(rootQuery.sorts, task4),
            ),
    ).toEqual(6);

    expect(
        state.getSnapshot().getIndexByCursorAndParentsIfExists({
            parents: [],
            cursor: getTaskQueryNormalizedSortCursorForModel(rootQuery.sorts, task1),
        }),
    ).toEqual(0);

    expect(
        state.getSnapshot().getIndexByCursorAndParentsIfExists({
            parents: [],
            cursor: getTaskQueryNormalizedSortCursorForModel(rootQuery.sorts, task2),
        }),
    ).toEqual(1);

    expect(
        state.getSnapshot().getIndexByCursorAndParentsIfExists({
            parents: [
                {
                    query: rootQuery,
                    cursor: getTaskQueryNormalizedSortCursorForModel(rootQuery.sorts, task2),
                },
            ],
            cursor: getTaskQueryNormalizedSortCursorForModel(query2.sorts, task2a),
        }),
    ).toEqual(2);

    expect(
        state.getSnapshot().getIndexByCursorAndParentsIfExists({
            parents: [
                {
                    query: rootQuery,
                    cursor: getTaskQueryNormalizedSortCursorForModel(rootQuery.sorts, task2),
                },
            ],
            cursor: getTaskQueryNormalizedSortCursorForModel(query2.sorts, task2b),
        }),
    ).toEqual(3);

    expect(
        state.getSnapshot().getIndexByCursorAndParentsIfExists({
            parents: [
                {
                    query: rootQuery,
                    cursor: getTaskQueryNormalizedSortCursorForModel(rootQuery.sorts, task2),
                },
                {
                    query: query2,
                    cursor: getTaskQueryNormalizedSortCursorForModel(query2.sorts, task2b),
                },
            ],
            cursor: getTaskQueryNormalizedSortCursorForModel(query2b.sorts, task2b1),
        }),
    ).toEqual(null);

    expect(
        state.getSnapshot().getIndexByCursorAndParentsIfExists({
            parents: [
                {
                    query: rootQuery,
                    cursor: getTaskQueryNormalizedSortCursorForModel(rootQuery.sorts, task2),
                },
                {
                    query: query2,
                    cursor: getTaskQueryNormalizedSortCursorForModel(query2.sorts, task2b),
                },
            ],
            cursor: getTaskQueryNormalizedSortCursorForModel(query2b.sorts, task2b2),
        }),
    ).toEqual(null);

    expect(
        state.getSnapshot().getIndexByCursorAndParentsIfExists({
            parents: [
                {
                    query: rootQuery,
                    cursor: getTaskQueryNormalizedSortCursorForModel(rootQuery.sorts, task2),
                },
                {
                    query: query2,
                    cursor: getTaskQueryNormalizedSortCursorForModel(query2.sorts, task2b),
                },
            ],
            cursor: getTaskQueryNormalizedSortCursorForModel(query2b.sorts, task2b3),
        }),
    ).toEqual(null);

    expect(
        state.getSnapshot().getIndexByCursorAndParentsIfExists({
            parents: [
                {
                    query: rootQuery,
                    cursor: getTaskQueryNormalizedSortCursorForModel(rootQuery.sorts, task2),
                },
            ],
            cursor: getTaskQueryNormalizedSortCursorForModel(query2.sorts, task2c),
        }),
    ).toEqual(4);

    expect(
        state.getSnapshot().getIndexByCursorAndParentsIfExists({
            parents: [],
            cursor: getTaskQueryNormalizedSortCursorForModel(rootQuery.sorts, task3),
        }),
    ).toEqual(5);

    expect(
        state.getSnapshot().getIndexByCursorAndParentsIfExists({
            parents: [],
            cursor: getTaskQueryNormalizedSortCursorForModel(rootQuery.sorts, task4),
        }),
    ).toEqual(6);

    areChildTasksExpandedStoreByPath.set(`${task2.id}-${task2b.id}`, true);

    expect(
        state
            .getSnapshot()
            .getIndexByRootCursorIfExists(
                getTaskQueryNormalizedSortCursorForModel(rootQuery.sorts, task1),
            ),
    ).toEqual(0);

    expect(
        state
            .getSnapshot()
            .getIndexByRootCursorIfExists(
                getTaskQueryNormalizedSortCursorForModel(rootQuery.sorts, task2),
            ),
    ).toEqual(1);

    expect(
        state
            .getSnapshot()
            .getIndexByRootCursorIfExists(
                getTaskQueryNormalizedSortCursorForModel(rootQuery.sorts, task2b),
            ),
    ).toEqual(null);

    expect(
        state
            .getSnapshot()
            .getIndexByRootCursorIfExists(
                getTaskQueryNormalizedSortCursorForModel(rootQuery.sorts, task2b1),
            ),
    ).toEqual(null);

    expect(
        state
            .getSnapshot()
            .getIndexByRootCursorIfExists(
                getTaskQueryNormalizedSortCursorForModel(rootQuery.sorts, task3),
            ),
    ).toEqual(8);

    expect(
        state
            .getSnapshot()
            .getIndexByRootCursorIfExists(
                getTaskQueryNormalizedSortCursorForModel(rootQuery.sorts, task4),
            ),
    ).toEqual(9);

    expect(
        state.getSnapshot().getIndexByCursorAndParentsIfExists({
            parents: [],
            cursor: getTaskQueryNormalizedSortCursorForModel(rootQuery.sorts, task1),
        }),
    ).toEqual(0);

    expect(
        state.getSnapshot().getIndexByCursorAndParentsIfExists({
            parents: [],
            cursor: getTaskQueryNormalizedSortCursorForModel(rootQuery.sorts, task2),
        }),
    ).toEqual(1);

    expect(
        state.getSnapshot().getIndexByCursorAndParentsIfExists({
            parents: [
                {
                    query: rootQuery,
                    cursor: getTaskQueryNormalizedSortCursorForModel(rootQuery.sorts, task2),
                },
            ],
            cursor: getTaskQueryNormalizedSortCursorForModel(query2.sorts, task2a),
        }),
    ).toEqual(2);

    expect(
        state.getSnapshot().getIndexByCursorAndParentsIfExists({
            parents: [
                {
                    query: rootQuery,
                    cursor: getTaskQueryNormalizedSortCursorForModel(rootQuery.sorts, task2),
                },
            ],
            cursor: getTaskQueryNormalizedSortCursorForModel(query2.sorts, task2b),
        }),
    ).toEqual(3);

    expect(
        state.getSnapshot().getIndexByCursorAndParentsIfExists({
            parents: [
                {
                    query: rootQuery,
                    cursor: getTaskQueryNormalizedSortCursorForModel(rootQuery.sorts, task2),
                },
                {
                    query: query2,
                    cursor: getTaskQueryNormalizedSortCursorForModel(query2.sorts, task2b),
                },
            ],
            cursor: getTaskQueryNormalizedSortCursorForModel(query2b.sorts, task2b1),
        }),
    ).toEqual(4);

    expect(
        state.getSnapshot().getIndexByCursorAndParentsIfExists({
            parents: [
                {
                    query: rootQuery,
                    cursor: getTaskQueryNormalizedSortCursorForModel(rootQuery.sorts, task2),
                },
                {
                    query: query2,
                    cursor: getTaskQueryNormalizedSortCursorForModel(query2.sorts, task2b),
                },
            ],
            cursor: getTaskQueryNormalizedSortCursorForModel(query2b.sorts, task2b2),
        }),
    ).toEqual(5);

    expect(
        state.getSnapshot().getIndexByCursorAndParentsIfExists({
            parents: [
                {
                    query: rootQuery,
                    cursor: getTaskQueryNormalizedSortCursorForModel(rootQuery.sorts, task2),
                },
                {
                    query: query2,
                    cursor: getTaskQueryNormalizedSortCursorForModel(query2.sorts, task2b),
                },
            ],
            cursor: getTaskQueryNormalizedSortCursorForModel(query2b.sorts, task2b3),
        }),
    ).toEqual(6);

    expect(
        state.getSnapshot().getIndexByCursorAndParentsIfExists({
            parents: [
                {
                    query: rootQuery,
                    cursor: getTaskQueryNormalizedSortCursorForModel(rootQuery.sorts, task2),
                },
            ],
            cursor: getTaskQueryNormalizedSortCursorForModel(query2.sorts, task2c),
        }),
    ).toEqual(7);

    expect(
        state.getSnapshot().getIndexByCursorAndParentsIfExists({
            parents: [],
            cursor: getTaskQueryNormalizedSortCursorForModel(rootQuery.sorts, task3),
        }),
    ).toEqual(8);

    expect(
        state.getSnapshot().getIndexByCursorAndParentsIfExists({
            parents: [],
            cursor: getTaskQueryNormalizedSortCursorForModel(rootQuery.sorts, task4),
        }),
    ).toEqual(9);

    // Cases introducing errors:

    expect(
        state.getSnapshot().getIndexByCursorAndParentsIfExists({
            parents: [
                {
                    query: rootQuery,
                    cursor: getTaskQueryNormalizedSortCursorForModel(rootQuery.sorts, task2),
                },
                {
                    query: query2,
                    cursor: getTaskQueryNormalizedSortCursorForModel(query2.sorts, task2b),
                },
            ],
            cursor: getTaskQueryNormalizedSortCursorForModel(query2b.sorts, task2b2),
        }),
    ).toEqual(5);

    expect(
        state.getSnapshot().getIndexByCursorAndParentsIfExists({
            parents: [
                {
                    query: query2,
                    cursor: getTaskQueryNormalizedSortCursorForModel(query2.sorts, task2b),
                },
                {
                    query: rootQuery,
                    cursor: getTaskQueryNormalizedSortCursorForModel(rootQuery.sorts, task2),
                },
            ],
            cursor: getTaskQueryNormalizedSortCursorForModel(query2b.sorts, task2b2),
        }),
    ).toEqual(null);

    expect(
        state.getSnapshot().getIndexByCursorAndParentsIfExists({
            parents: [
                {
                    query: rootQuery,
                    cursor: getTaskQueryNormalizedSortCursorForModel(rootQuery.sorts, task2),
                },
            ],
            cursor: getTaskQueryNormalizedSortCursorForModel(query2b.sorts, task2b2),
        }),
    ).toEqual(null);
});
