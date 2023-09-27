import {CalendarDate} from "@internationalized/date";
import {getAccountClientStoreForClient} from "~/client/accounts/account_client_store_context_provider.js";
import {
    TaskClientStore,
    setShouldDisableCommitTaskActionTransactionMutexForTest,
} from "~/client/tasks/task_client_store.js";
import {AccountModel} from "~/shared/accounts/account_model.js";
import {Context} from "~/shared/context/context.js";
import {InternalError} from "~/shared/error/error.js";
import {waitMacrotask} from "~/shared/helpers/async/wait_macrotask.js";
import {HybridLogicalTime} from "~/shared/helpers/clock/hybrid_logical_clock.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {defaultTimeZone} from "~/shared/helpers/date/time_zone.js";
import {getOrSetDefaultMapValue} from "~/shared/helpers/map/get_or_set_default_map_value.js";
import {generateId} from "~/shared/id/id.js";
import {AccountId, TaskId} from "~/shared/id/types/id_types.js";
import {commitTaskActionTransaction} from "~/shared/rpc/tasks_rpc_definitions.js";
import {TestRpcContextModule} from "~/shared/rpc/test_rpc_context_module.js";
import {TaskAction} from "~/shared/tasks/actions/task_action.js";
import {TaskCreateAction} from "~/shared/tasks/actions/task_task_action.js";
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

test("backfills an authorized task", () => {
    const store = new TaskClientStore({
        accountStore,
        spaceId: generateId(),
        onDisplayError: handleDisplayError,
    });

    const task = createTask(store);

    expect(getTaskEntryIfExists(store, task.id)).toEqual(null);

    store.applyUpdateEvent({
        type: "Update",
        number: 1,
        actions: [],
        backfillAuthorizedTasks: [task],
        backfillUnauthorizedTaskIds: [],
        backfillAuthorizedCollections: [],
        backfillUnauthorizedCollectionIds: [],
        referencedAccounts: [account1],
    });

    expect(getTaskEntryIfExists(store, task.id)).toEqual({
        task,
        actions: null,
        optimisticState: null,
        isAuthorized: true,
        authorizationEventNumber: 1,
    });
});

test("backfills authorized tasks", () => {
    const store = new TaskClientStore({
        accountStore,
        spaceId: generateId(),
        onDisplayError: handleDisplayError,
    });

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
        number: 1,
        actions: [],
        backfillAuthorizedTasks: [task1, task2],
        backfillUnauthorizedTaskIds: [],
        backfillAuthorizedCollections: [],
        backfillUnauthorizedCollectionIds: [],
        referencedAccounts: [account1],
    });

    expect(getTaskEntryIfExists(store, task1.id)).toEqual({
        task: task1,
        actions: null,
        optimisticState: null,
        isAuthorized: true,
        authorizationEventNumber: 1,
    });

    expect(getTaskEntryIfExists(store, task2.id)).toEqual({
        task: task2,
        actions: null,
        optimisticState: null,
        isAuthorized: true,
        authorizationEventNumber: 1,
    });

    expect(getTaskEntryIfExists(store, task3.id)).toEqual(null);
    expect(getTaskEntryIfExists(store, task4.id)).toEqual(null);

    store.applyUpdateEvent({
        type: "Update",
        number: 2,
        actions: [],
        backfillAuthorizedTasks: [task3, task4],
        backfillUnauthorizedTaskIds: [],
        backfillAuthorizedCollections: [],
        backfillUnauthorizedCollectionIds: [],
        referencedAccounts: [account1],
    });

    expect(getTaskEntryIfExists(store, task1.id)).toEqual({
        task: task1,
        actions: null,
        optimisticState: null,
        isAuthorized: true,
        authorizationEventNumber: 1,
    });

    expect(getTaskEntryIfExists(store, task2.id)).toEqual({
        task: task2,
        actions: null,
        optimisticState: null,
        isAuthorized: true,
        authorizationEventNumber: 1,
    });

    expect(getTaskEntryIfExists(store, task3.id)).toEqual({
        task: task3,
        actions: null,
        optimisticState: null,
        isAuthorized: true,
        authorizationEventNumber: 2,
    });

    expect(getTaskEntryIfExists(store, task4.id)).toEqual({
        task: task4,
        actions: null,
        optimisticState: null,
        isAuthorized: true,
        authorizationEventNumber: 2,
    });
});

test("backfill merges with existing authorized task", () => {
    const store = new TaskClientStore({
        accountStore,
        spaceId: generateId(),
        onDisplayError: handleDisplayError,
    });

    const task1a = createTask(store);

    const task1b = task1a.apply(
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
        number: 1,
        actions: [],
        backfillAuthorizedTasks: [task1a],
        backfillUnauthorizedTaskIds: [],
        backfillAuthorizedCollections: [],
        backfillUnauthorizedCollectionIds: [],
        referencedAccounts: [account1],
    });

    expect(getTaskEntryIfExists(store, task1a.id)).toEqual({
        task: task1a,
        actions: null,
        optimisticState: null,
        isAuthorized: true,
        authorizationEventNumber: 1,
    });

    store.applyUpdateEvent({
        type: "Update",
        number: 2,
        actions: [],
        backfillAuthorizedTasks: [task1b],
        backfillUnauthorizedTaskIds: [],
        backfillAuthorizedCollections: [],
        backfillUnauthorizedCollectionIds: [],
        referencedAccounts: [account1],
    });

    expect(getTaskEntryIfExists(store, task1a.id)).toEqual({
        task: task1b,
        actions: null,
        optimisticState: null,
        isAuthorized: true,
        authorizationEventNumber: 2,
    });
});

test("backfill merges with existing unauthorized task", () => {
    const store = new TaskClientStore({
        accountStore,
        spaceId: generateId(),
        onDisplayError: handleDisplayError,
    });

    const task1a = createTask(store);

    const task1b = task1a.apply(
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
        number: 1,
        actions: [],
        backfillAuthorizedTasks: [task1a],
        backfillUnauthorizedTaskIds: [],
        backfillAuthorizedCollections: [],
        backfillUnauthorizedCollectionIds: [],
        referencedAccounts: [account1],
    });

    expect(getTaskEntryIfExists(store, task1a.id)).toEqual({
        task: task1a,
        actions: null,
        optimisticState: null,
        isAuthorized: true,
        authorizationEventNumber: 1,
    });

    store.applyUpdateEvent({
        type: "Update",
        number: 2,
        actions: [],
        backfillAuthorizedTasks: [],
        backfillUnauthorizedTaskIds: [task1a.id],
        backfillAuthorizedCollections: [],
        backfillUnauthorizedCollectionIds: [],
        referencedAccounts: [account1],
    });

    expect(getTaskEntryIfExists(store, task1a.id)).toEqual({
        task: task1a,
        actions: null,
        optimisticState: null,
        isAuthorized: false,
        authorizationEventNumber: 2,
    });

    store.applyUpdateEvent({
        type: "Update",
        number: 3,
        actions: [],
        backfillAuthorizedTasks: [task1b],
        backfillUnauthorizedTaskIds: [],
        backfillAuthorizedCollections: [],
        backfillUnauthorizedCollectionIds: [],
        referencedAccounts: [account1],
    });

    expect(getTaskEntryIfExists(store, task1a.id)).toEqual({
        task: task1b,
        actions: null,
        optimisticState: null,
        isAuthorized: true,
        authorizationEventNumber: 3,
    });
});

test("backfill merges behind existing unauthorized task", () => {
    const store = new TaskClientStore({
        accountStore,
        spaceId: generateId(),
        onDisplayError: handleDisplayError,
    });

    const task1a = createTask(store);

    const task1b = task1a.apply(
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
        number: 1,
        actions: [],
        backfillAuthorizedTasks: [task1a],
        backfillUnauthorizedTaskIds: [],
        backfillAuthorizedCollections: [],
        backfillUnauthorizedCollectionIds: [],
        referencedAccounts: [account1],
    });

    expect(getTaskEntryIfExists(store, task1a.id)).toEqual({
        task: task1a,
        actions: null,
        optimisticState: null,
        isAuthorized: true,
        authorizationEventNumber: 1,
    });

    store.applyUpdateEvent({
        type: "Update",
        number: 3,
        actions: [],
        backfillAuthorizedTasks: [],
        backfillUnauthorizedTaskIds: [task1a.id],
        backfillAuthorizedCollections: [],
        backfillUnauthorizedCollectionIds: [],
        referencedAccounts: [account1],
    });

    expect(getTaskEntryIfExists(store, task1a.id)).toEqual({
        task: task1a,
        actions: null,
        optimisticState: null,
        isAuthorized: false,
        authorizationEventNumber: 3,
    });

    store.applyUpdateEvent({
        type: "Update",
        number: 2,
        actions: [],
        backfillAuthorizedTasks: [task1b],
        backfillUnauthorizedTaskIds: [],
        backfillAuthorizedCollections: [],
        backfillUnauthorizedCollectionIds: [],
        referencedAccounts: [account1],
    });

    expect(getTaskEntryIfExists(store, task1a.id)).toEqual({
        task: task1b,
        actions: null,
        optimisticState: null,
        isAuthorized: false,
        authorizationEventNumber: 3,
    });
});

test("backfill adds task behind existing unauthorized task", () => {
    const store = new TaskClientStore({
        accountStore,
        spaceId: generateId(),
        onDisplayError: handleDisplayError,
    });

    const task1a = createTask(store);

    const task1b = task1a.apply(
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
        number: 3,
        actions: [],
        backfillAuthorizedTasks: [],
        backfillUnauthorizedTaskIds: [task1a.id],
        backfillAuthorizedCollections: [],
        backfillUnauthorizedCollectionIds: [],
        referencedAccounts: [account1],
    });

    expect(getTaskEntryIfExists(store, task1a.id)).toEqual({
        task: null,
        actions: [],
        optimisticState: null,
        isAuthorized: false,
        authorizationEventNumber: 3,
    });

    store.applyUpdateEvent({
        type: "Update",
        number: 2,
        actions: [],
        backfillAuthorizedTasks: [task1b],
        backfillUnauthorizedTaskIds: [],
        backfillAuthorizedCollections: [],
        backfillUnauthorizedCollectionIds: [],
        referencedAccounts: [account1],
    });

    expect(getTaskEntryIfExists(store, task1a.id)).toEqual({
        task: task1b,
        actions: null,
        optimisticState: null,
        isAuthorized: false,
        authorizationEventNumber: 3,
    });
});

test("action is applied to authorized task", () => {
    const store = new TaskClientStore({
        accountStore,
        spaceId: generateId(),
        onDisplayError: handleDisplayError,
    });

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

    const task1b = task1a.apply(action1a, getSortableAccount);

    expect(task1a.rawData).not.toEqual(task1b.rawData);

    expect(getTaskEntryIfExists(store, task1a.id)).toEqual(null);

    store.applyUpdateEvent({
        type: "Update",
        number: 1,
        actions: [],
        backfillAuthorizedTasks: [task1a],
        backfillUnauthorizedTaskIds: [],
        backfillAuthorizedCollections: [],
        backfillUnauthorizedCollectionIds: [],
        referencedAccounts: [account1],
    });

    expect(getTaskEntryIfExists(store, task1a.id)).toEqual({
        task: task1a,
        actions: null,
        optimisticState: null,
        isAuthorized: true,
        authorizationEventNumber: 1,
    });

    store.applyUpdateEvent({
        type: "Update",
        number: 2,
        actions: [action1a],
        backfillAuthorizedTasks: [],
        backfillUnauthorizedTaskIds: [],
        backfillAuthorizedCollections: [],
        backfillUnauthorizedCollectionIds: [],
        referencedAccounts: [],
    });

    expect(getTaskEntryIfExists(store, task1a.id)).toEqual({
        task: task1b,
        actions: null,
        optimisticState: null,
        isAuthorized: true,
        authorizationEventNumber: 1,
    });
});

test("action is applied to unauthorized task", () => {
    const store = new TaskClientStore({
        accountStore,
        spaceId: generateId(),
        onDisplayError: handleDisplayError,
    });

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
        number: 1,
        actions: [],
        backfillAuthorizedTasks: [task1a],
        backfillUnauthorizedTaskIds: [],
        backfillAuthorizedCollections: [],
        backfillUnauthorizedCollectionIds: [],
        referencedAccounts: [account1],
    });

    expect(getTaskEntryIfExists(store, task1a.id)).toEqual({
        task: task1a,
        actions: null,
        optimisticState: null,
        isAuthorized: true,
        authorizationEventNumber: 1,
    });

    store.applyUpdateEvent({
        type: "Update",
        number: 2,
        actions: [],
        backfillAuthorizedTasks: [],
        backfillUnauthorizedTaskIds: [task1a.id],
        backfillAuthorizedCollections: [],
        backfillUnauthorizedCollectionIds: [],
        referencedAccounts: [],
    });

    expect(getTaskEntryIfExists(store, task1a.id)).toEqual({
        task: task1a,
        actions: null,
        optimisticState: null,
        isAuthorized: false,
        authorizationEventNumber: 2,
    });

    store.applyUpdateEvent({
        type: "Update",
        number: 3,
        actions: [action1a],
        backfillAuthorizedTasks: [],
        backfillUnauthorizedTaskIds: [],
        backfillAuthorizedCollections: [],
        backfillUnauthorizedCollectionIds: [],
        referencedAccounts: [],
    });

    expect(task1a.rawData).not.toEqual(task1a.apply(action1a, getSortableAccount).rawData);

    expect(getTaskEntryIfExists(store, task1a.id)).toEqual({
        task: task1a.apply(action1a, getSortableAccount),
        actions: null,
        optimisticState: null,
        isAuthorized: false,
        authorizationEventNumber: 2,
    });
});

test("actions can be applied out of order", () => {
    const store = new TaskClientStore({
        accountStore,
        spaceId: generateId(),
        onDisplayError: handleDisplayError,
    });

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
        number: 1,
        actions: [action1a],
        backfillAuthorizedTasks: [],
        backfillUnauthorizedTaskIds: [],
        backfillAuthorizedCollections: [],
        backfillUnauthorizedCollectionIds: [],
        referencedAccounts: [],
    });

    expect(getTaskEntryIfExists(store, task1a.id)).toEqual({
        task: null,
        actions: [action1a],
        optimisticState: null,
        isAuthorized: null,
        authorizationEventNumber: null,
    });

    store.applyUpdateEvent({
        type: "Update",
        number: 2,
        actions: [],
        backfillAuthorizedTasks: [task1a],
        backfillUnauthorizedTaskIds: [],
        backfillAuthorizedCollections: [],
        backfillUnauthorizedCollectionIds: [],
        referencedAccounts: [account1],
    });

    expect(task1a.rawData).not.toEqual(task1a.apply(action1a, getSortableAccount).rawData);

    expect(getTaskEntryIfExists(store, task1a.id)).toEqual({
        task: task1a.apply(action1a, getSortableAccount),
        actions: null,
        optimisticState: null,
        isAuthorized: true,
        authorizationEventNumber: 2,
    });
});

test("actions can be applied out of order to unauthorized tasks", () => {
    const store = new TaskClientStore({
        accountStore,
        spaceId: generateId(),
        onDisplayError: handleDisplayError,
    });

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
        number: 1,
        actions: [],
        backfillAuthorizedTasks: [],
        backfillUnauthorizedTaskIds: [task1a.id],
        backfillAuthorizedCollections: [],
        backfillUnauthorizedCollectionIds: [],
        referencedAccounts: [],
    });

    expect(getTaskEntryIfExists(store, task1a.id)).toEqual({
        task: null,
        actions: [],
        optimisticState: null,
        isAuthorized: false,
        authorizationEventNumber: 1,
    });

    store.applyUpdateEvent({
        type: "Update",
        number: 2,
        actions: [action1a],
        backfillAuthorizedTasks: [],
        backfillUnauthorizedTaskIds: [],
        backfillAuthorizedCollections: [],
        backfillUnauthorizedCollectionIds: [],
        referencedAccounts: [],
    });

    expect(getTaskEntryIfExists(store, task1a.id)).toEqual({
        task: null,
        actions: [action1a],
        optimisticState: null,
        isAuthorized: false,
        authorizationEventNumber: 1,
    });

    store.applyUpdateEvent({
        type: "Update",
        number: 3,
        actions: [],
        backfillAuthorizedTasks: [task1a],
        backfillUnauthorizedTaskIds: [],
        backfillAuthorizedCollections: [],
        backfillUnauthorizedCollectionIds: [],
        referencedAccounts: [account1],
    });

    expect(task1a.rawData).not.toEqual(task1a.apply(action1a, getSortableAccount).rawData);

    expect(getTaskEntryIfExists(store, task1a.id)).toEqual({
        task: task1a.apply(action1a, getSortableAccount),
        actions: null,
        optimisticState: null,
        isAuthorized: true,
        authorizationEventNumber: 3,
    });
});

test("if nothing changes in the task entry after action it's left as same reference", () => {
    const store = new TaskClientStore({
        accountStore,
        spaceId: generateId(),
        onDisplayError: handleDisplayError,
    });

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
        number: 1,
        actions: [],
        backfillAuthorizedTasks: [task1a],
        backfillUnauthorizedTaskIds: [],
        backfillAuthorizedCollections: [],
        backfillUnauthorizedCollectionIds: [],
        referencedAccounts: [],
    });

    expect(getTaskEntryIfExists(store, task1a.id)).toEqual({
        task: task1a,
        actions: null,
        optimisticState: null,
        isAuthorized: true,
        authorizationEventNumber: 1,
    });

    store.applyUpdateEvent({
        type: "Update",
        number: 2,
        actions: [action1a],
        backfillAuthorizedTasks: [],
        backfillUnauthorizedTaskIds: [],
        backfillAuthorizedCollections: [],
        backfillUnauthorizedCollectionIds: [],
        referencedAccounts: [],
    });

    expect(task1a.rawData).not.toEqual(task1a.apply(action1a, getSortableAccount).rawData);

    const taskEntry = getTaskEntryIfExists(store, task1a.id);

    expect(taskEntry).toEqual({
        task: task1a.apply(action1a, getSortableAccount),
        actions: null,
        optimisticState: null,
        isAuthorized: true,
        authorizationEventNumber: 1,
    });

    store.applyUpdateEvent({
        type: "Update",
        number: 3,
        actions: [action1a],
        backfillAuthorizedTasks: [],
        backfillUnauthorizedTaskIds: [],
        backfillAuthorizedCollections: [],
        backfillUnauthorizedCollectionIds: [],
        referencedAccounts: [],
    });

    expect(getTaskEntryIfExists(store, task1a.id)).toBe(taskEntry);
});

test("if nothing changes in the task entry after backfill it's left as same reference", () => {
    const store = new TaskClientStore({
        accountStore,
        spaceId: generateId(),
        onDisplayError: handleDisplayError,
    });

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
        number: 2,
        actions: [],
        backfillAuthorizedTasks: [task1a],
        backfillUnauthorizedTaskIds: [],
        backfillAuthorizedCollections: [],
        backfillUnauthorizedCollectionIds: [],
        referencedAccounts: [],
    });

    expect(getTaskEntryIfExists(store, task1a.id)).toEqual({
        task: task1a,
        actions: null,
        optimisticState: null,
        isAuthorized: true,
        authorizationEventNumber: 2,
    });

    store.applyUpdateEvent({
        type: "Update",
        number: 3,
        actions: [action1a],
        backfillAuthorizedTasks: [],
        backfillUnauthorizedTaskIds: [],
        backfillAuthorizedCollections: [],
        backfillUnauthorizedCollectionIds: [],
        referencedAccounts: [],
    });

    expect(task1a.rawData).not.toEqual(task1a.apply(action1a, getSortableAccount).rawData);

    const taskEntry = getTaskEntryIfExists(store, task1a.id);

    expect(taskEntry).toEqual({
        task: task1a.apply(action1a, getSortableAccount),
        actions: null,
        optimisticState: null,
        isAuthorized: true,
        authorizationEventNumber: 2,
    });

    store.applyUpdateEvent({
        type: "Update",
        number: 1,
        actions: [],
        backfillAuthorizedTasks: [task1a.apply(action1a, getSortableAccount)],
        backfillUnauthorizedTaskIds: [],
        backfillAuthorizedCollections: [],
        backfillUnauthorizedCollectionIds: [],
        referencedAccounts: [],
    });

    expect(getTaskEntryIfExists(store, task1a.id)).toBe(taskEntry);
});

test("action can be applied then task can be marked unauthorized", () => {
    const store = new TaskClientStore({
        accountStore,
        spaceId: generateId(),
        onDisplayError: handleDisplayError,
    });

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
        number: 1,
        actions: [action1a],
        backfillAuthorizedTasks: [],
        backfillUnauthorizedTaskIds: [],
        backfillAuthorizedCollections: [],
        backfillUnauthorizedCollectionIds: [],
        referencedAccounts: [],
    });

    expect(getTaskEntryIfExists(store, task1a.id)).toEqual({
        task: null,
        actions: [action1a],
        optimisticState: null,
        isAuthorized: null,
        authorizationEventNumber: null,
    });

    store.applyUpdateEvent({
        type: "Update",
        number: 2,
        actions: [],
        backfillAuthorizedTasks: [],
        backfillUnauthorizedTaskIds: [task1a.id],
        backfillAuthorizedCollections: [],
        backfillUnauthorizedCollectionIds: [],
        referencedAccounts: [],
    });

    expect(getTaskEntryIfExists(store, task1a.id)).toEqual({
        task: null,
        actions: [action1a],
        optimisticState: null,
        isAuthorized: false,
        authorizationEventNumber: 2,
    });
});

test("redundant unauthorized action doesn't change task", () => {
    const store = new TaskClientStore({
        accountStore,
        spaceId: generateId(),
        onDisplayError: handleDisplayError,
    });

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
        number: 2,
        actions: [],
        backfillAuthorizedTasks: [],
        backfillUnauthorizedTaskIds: [task1a.id],
        backfillAuthorizedCollections: [],
        backfillUnauthorizedCollectionIds: [],
        referencedAccounts: [],
    });

    expect(getTaskEntryIfExists(store, task1a.id)).toEqual({
        task: null,
        actions: [],
        optimisticState: null,
        isAuthorized: false,
        authorizationEventNumber: 2,
    });

    store.applyUpdateEvent({
        type: "Update",
        number: 3,
        actions: [action1a],
        backfillAuthorizedTasks: [],
        backfillUnauthorizedTaskIds: [],
        backfillAuthorizedCollections: [],
        backfillUnauthorizedCollectionIds: [],
        referencedAccounts: [],
    });

    const taskEntry = getTaskEntryIfExists(store, task1a.id);

    expect(taskEntry).toEqual({
        task: null,
        actions: [action1a],
        optimisticState: null,
        isAuthorized: false,
        authorizationEventNumber: 2,
    });

    store.applyUpdateEvent({
        type: "Update",
        number: 1,
        actions: [],
        backfillAuthorizedTasks: [],
        backfillUnauthorizedTaskIds: [task1a.id],
        backfillAuthorizedCollections: [],
        backfillUnauthorizedCollectionIds: [],
        referencedAccounts: [],
    });

    expect(getTaskEntryIfExists(store, task1a.id)).toBe(taskEntry);
});

test("create action will create a task", () => {
    const store = new TaskClientStore({
        accountStore,
        spaceId: generateId(),
        onDisplayError: handleDisplayError,
    });

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
        number: 1,
        actions: [action],
        backfillAuthorizedTasks: [],
        backfillUnauthorizedTaskIds: [],
        backfillAuthorizedCollections: [],
        backfillUnauthorizedCollectionIds: [],
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
        isAuthorized: true,
        authorizationEventNumber: 1,
    });
});

test("can receive create action out of order", () => {
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
        number: 1,
        actions: [action1],
        backfillAuthorizedTasks: [],
        backfillUnauthorizedTaskIds: [],
        backfillAuthorizedCollections: [],
        backfillUnauthorizedCollectionIds: [],
        referencedAccounts: [],
    });

    expect(getTaskEntryIfExists(store, action1.taskId)).toEqual({
        task: null,
        actions: [action1],
        optimisticState: null,
        isAuthorized: null,
        authorizationEventNumber: null,
    });

    store.applyUpdateEvent({
        type: "Update",
        number: 2,
        actions: [action2],
        backfillAuthorizedTasks: [],
        backfillUnauthorizedTaskIds: [],
        backfillAuthorizedCollections: [],
        backfillUnauthorizedCollectionIds: [],
        referencedAccounts: [account1],
    });

    expect(getTaskEntryIfExists(store, action1.taskId)).toEqual({
        task: createTask(store, {
            id: action2.taskId,
            time: action2.time,
            taskAction: action2.taskAction,
        }).apply(action1, getSortableAccount),
        actions: null,
        optimisticState: null,
        isAuthorized: true,
        authorizationEventNumber: 2,
    });
});

test("can receive create action with another action within a transaction", () => {
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
        number: 1,
        actions: [action1, action2],
        backfillAuthorizedTasks: [],
        backfillUnauthorizedTaskIds: [],
        backfillAuthorizedCollections: [],
        backfillUnauthorizedCollectionIds: [],
        referencedAccounts: [account1],
    });

    expect(getTaskEntryIfExists(store, action1.taskId)).toEqual({
        task: createTask(store, {
            id: action1.taskId,
            time: action1.time,
            taskAction: action1.taskAction,
        }).apply(action2, getSortableAccount),
        actions: null,
        optimisticState: null,
        isAuthorized: true,
        authorizationEventNumber: 1,
    });
});

test("can receive create action out of order within a transaction", () => {
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
        number: 1,
        actions: [action1, action2],
        backfillAuthorizedTasks: [],
        backfillUnauthorizedTaskIds: [],
        backfillAuthorizedCollections: [],
        backfillUnauthorizedCollectionIds: [],
        referencedAccounts: [account1],
    });

    expect(getTaskEntryIfExists(store, action1.taskId)).toEqual({
        task: createTask(store, {
            id: action2.taskId,
            time: action2.time,
            taskAction: action2.taskAction,
        }).apply(action1, getSortableAccount),
        actions: null,
        optimisticState: null,
        isAuthorized: true,
        authorizationEventNumber: 1,
    });
});

test("applies commit action calls optimistically", async () => {
    const store = new TaskClientStore({
        accountStore,
        spaceId: generateId(),
        onDisplayError: handleDisplayError,
    });

    const task = createTask(store);

    expect(getTaskEntryIfExists(store, task.id)).toEqual(null);

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

    expect(getTaskEntryIfExists(store, task.id)).toEqual({
        task,
        actions: null,
        optimisticState: null,
        isAuthorized: true,
        authorizationEventNumber: 1,
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

    store.commitTaskActionTransaction(context, [action]);

    expect(getTaskEntryIfExists(store, task.id)).toEqual({
        task: task.apply(action, getSortableAccount),
        actions: null,
        optimisticState: {
            original: {
                task,
                actions: null,
            },
            actions: [{isOptimistic: true, action}],
        },
        isAuthorized: true,
        authorizationEventNumber: 1,
    });

    await TestRpcContextModule.resolveLastExecution(commitTaskActionTransaction, {
        extraActions: [],
        referencedAccounts: [],
    });

    expect(getTaskEntryIfExists(store, task.id)).toEqual({
        task: task.apply(action, getSortableAccount),
        actions: null,
        optimisticState: null,
        isAuthorized: true,
        authorizationEventNumber: 1,
    });
});

test("can create tasks optimistically", async () => {
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

    expect(getTaskEntryIfExists(store, action1.taskId)).toEqual(null);

    store.commitTaskActionTransaction(context, [action1]);

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
        isAuthorized: true,
        authorizationEventNumber: 0,
    });

    await TestRpcContextModule.resolveLastExecution(commitTaskActionTransaction, {
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
        isAuthorized: true,
        authorizationEventNumber: 0,
    });
});

test("can create then update tasks optimistically", async () => {
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

    store.commitTaskActionTransaction(context, [action1]);

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
        isAuthorized: true,
        authorizationEventNumber: 0,
    });

    store.commitTaskActionTransaction(context, [action2]);

    expect(getTaskEntryIfExists(store, action1.taskId)).toEqual({
        task: createTask(store, {
            id: action1.taskId,
            time: action1.time,
            taskAction: action1.taskAction,
        }).apply(action2, getSortableAccount),
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

    await TestRpcContextModule.resolveExecution(commitTaskActionTransaction, 0, {
        extraActions: [],
        referencedAccounts: [],
    });

    expect(getTaskEntryIfExists(store, action1.taskId)).toEqual({
        task: createTask(store, {
            id: action1.taskId,
            time: action1.time,
            taskAction: action1.taskAction,
        }).apply(action2, getSortableAccount),
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
        isAuthorized: true,
        authorizationEventNumber: 0,
    });

    await TestRpcContextModule.resolveExecution(commitTaskActionTransaction, 1, {
        extraActions: [],
        referencedAccounts: [],
    });

    expect(getTaskEntryIfExists(store, action1.taskId)).toEqual({
        task: createTask(store, {
            id: action1.taskId,
            time: action1.time,
            taskAction: action1.taskAction,
        }).apply(action2, getSortableAccount),
        actions: null,
        optimisticState: null,
        isAuthorized: true,
        authorizationEventNumber: 0,
    });
});

test("can create then update tasks optimistically and resolve commits out of order", async () => {
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

    store.commitTaskActionTransaction(context, [action1]);

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
        isAuthorized: true,
        authorizationEventNumber: 0,
    });

    store.commitTaskActionTransaction(context, [action2]);

    expect(getTaskEntryIfExists(store, action1.taskId)).toEqual({
        task: createTask(store, {
            id: action1.taskId,
            time: action1.time,
            taskAction: action1.taskAction,
        }).apply(action2, getSortableAccount),
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

    await TestRpcContextModule.resolveExecution(commitTaskActionTransaction, 1, {
        extraActions: [],
        referencedAccounts: [],
    });

    expect(getTaskEntryIfExists(store, action1.taskId)).toEqual({
        task: createTask(store, {
            id: action1.taskId,
            time: action1.time,
            taskAction: action1.taskAction,
        }).apply(action2, getSortableAccount),
        actions: null,
        optimisticState: {
            original: {
                task: null,
                actions: [action2],
            },
            actions: [{isOptimistic: true, action: action1}],
        },
        isAuthorized: true,
        authorizationEventNumber: 0,
    });

    await TestRpcContextModule.resolveExecution(commitTaskActionTransaction, 0, {
        extraActions: [],
        referencedAccounts: [],
    });

    expect(getTaskEntryIfExists(store, action1.taskId)).toEqual({
        task: createTask(store, {
            id: action1.taskId,
            time: action1.time,
            taskAction: action1.taskAction,
        }).apply(action2, getSortableAccount),
        actions: null,
        optimisticState: null,
        isAuthorized: true,
        authorizationEventNumber: 0,
    });
});

test("can create then update tasks optimistically after an action from the server", async () => {
    const store = new TaskClientStore({
        accountStore,
        spaceId: generateId(),
        onDisplayError: handleDisplayError,
    });

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
        number: 1,
        actions: [action1],
        backfillAuthorizedTasks: [],
        backfillUnauthorizedTaskIds: [],
        backfillAuthorizedCollections: [],
        backfillUnauthorizedCollectionIds: [],
        referencedAccounts: [],
    });

    expect(getTaskEntryIfExists(store, action2.taskId)).toEqual({
        task: null,
        actions: [action1],
        optimisticState: null,
        isAuthorized: null,
        authorizationEventNumber: null,
    });

    store.commitTaskActionTransaction(context, [action2]);

    expect(getTaskEntryIfExists(store, action2.taskId)).toEqual({
        task: createTask(store, {
            id: action2.taskId,
            time: action2.time,
            taskAction: action2.taskAction,
        }).apply(action1, getSortableAccount),
        actions: null,
        optimisticState: {
            original: {
                task: null,
                actions: [action1],
            },
            actions: [{isOptimistic: true, action: action2}],
        },
        isAuthorized: true,
        authorizationEventNumber: 0,
    });

    store.commitTaskActionTransaction(context, [action3]);

    expect(getTaskEntryIfExists(store, action2.taskId)).toEqual({
        task: createTask(store, {
            id: action2.taskId,
            time: action2.time,
            taskAction: action2.taskAction,
        })
            .apply(action1, getSortableAccount)
            .apply(action3, getSortableAccount),
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
        isAuthorized: true,
        authorizationEventNumber: 0,
    });

    await TestRpcContextModule.resolveExecution(commitTaskActionTransaction, 0, {
        extraActions: [],
        referencedAccounts: [],
    });

    expect(getTaskEntryIfExists(store, action2.taskId)).toEqual({
        task: createTask(store, {
            id: action2.taskId,
            time: action2.time,
            taskAction: action2.taskAction,
        })
            .apply(action1, getSortableAccount)
            .apply(action3, getSortableAccount),
        actions: null,
        optimisticState: {
            original: {
                task: createTask(store, {
                    id: action2.taskId,
                    time: action2.time,
                    taskAction: action2.taskAction,
                }).apply(action1, getSortableAccount),
                actions: null,
            },
            actions: [{isOptimistic: true, action: action3}],
        },
        isAuthorized: true,
        authorizationEventNumber: 0,
    });

    await TestRpcContextModule.resolveExecution(commitTaskActionTransaction, 1, {
        extraActions: [],
        referencedAccounts: [],
    });

    expect(getTaskEntryIfExists(store, action2.taskId)).toEqual({
        task: createTask(store, {
            id: action2.taskId,
            time: action2.time,
            taskAction: action2.taskAction,
        })
            .apply(action1, getSortableAccount)
            .apply(action3, getSortableAccount),
        actions: null,
        optimisticState: null,
        isAuthorized: true,
        authorizationEventNumber: 0,
    });
});

test("can create then update tasks optimistically our of order", async () => {
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

    store.commitTaskActionTransaction(context, [action2]);

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
        isAuthorized: null,
        authorizationEventNumber: null,
    });

    store.commitTaskActionTransaction(context, [action1]);

    expect(getTaskEntryIfExists(store, action1.taskId)).toEqual({
        task: createTask(store, {
            id: action1.taskId,
            time: action1.time,
            taskAction: action1.taskAction,
        }).apply(action2, getSortableAccount),
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
        isAuthorized: true,
        authorizationEventNumber: 0,
    });

    await TestRpcContextModule.resolveExecution(commitTaskActionTransaction, 0, {
        extraActions: [],
        referencedAccounts: [],
    });

    expect(getTaskEntryIfExists(store, action1.taskId)).toEqual({
        task: createTask(store, {
            id: action1.taskId,
            time: action1.time,
            taskAction: action1.taskAction,
        }).apply(action2, getSortableAccount),
        actions: null,
        optimisticState: {
            original: {
                task: null,
                actions: [action2],
            },
            actions: [{isOptimistic: true, action: action1}],
        },
        isAuthorized: true,
        authorizationEventNumber: 0,
    });

    await TestRpcContextModule.resolveExecution(commitTaskActionTransaction, 1, {
        extraActions: [],
        referencedAccounts: [],
    });

    expect(getTaskEntryIfExists(store, action1.taskId)).toEqual({
        task: createTask(store, {
            id: action1.taskId,
            time: action1.time,
            taskAction: action1.taskAction,
        }).apply(action2, getSortableAccount),
        actions: null,
        optimisticState: null,
        isAuthorized: true,
        authorizationEventNumber: 0,
    });
});

test("can create then update tasks optimistically out of order after an action from the server", async () => {
    const store = new TaskClientStore({
        accountStore,
        spaceId: generateId(),
        onDisplayError: handleDisplayError,
    });

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
        number: 1,
        actions: [action1],
        backfillAuthorizedTasks: [],
        backfillUnauthorizedTaskIds: [],
        backfillAuthorizedCollections: [],
        backfillUnauthorizedCollectionIds: [],
        referencedAccounts: [],
    });

    expect(getTaskEntryIfExists(store, action2.taskId)).toEqual({
        task: null,
        actions: [action1],
        optimisticState: null,
        isAuthorized: null,
        authorizationEventNumber: null,
    });

    store.commitTaskActionTransaction(context, [action3]);

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
        isAuthorized: null,
        authorizationEventNumber: null,
    });

    store.commitTaskActionTransaction(context, [action2]);

    expect(getTaskEntryIfExists(store, action2.taskId)).toEqual({
        task: createTask(store, {
            id: action2.taskId,
            time: action2.time,
            taskAction: action2.taskAction,
        })
            .apply(action1, getSortableAccount)
            .apply(action3, getSortableAccount),
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
        isAuthorized: true,
        authorizationEventNumber: 0,
    });

    await TestRpcContextModule.resolveExecution(commitTaskActionTransaction, 0, {
        extraActions: [],
        referencedAccounts: [],
    });

    expect(getTaskEntryIfExists(store, action2.taskId)).toEqual({
        task: createTask(store, {
            id: action2.taskId,
            time: action2.time,
            taskAction: action2.taskAction,
        })
            .apply(action1, getSortableAccount)
            .apply(action3, getSortableAccount),
        actions: null,
        optimisticState: {
            original: {
                task: null,
                actions: [action1, action3],
            },
            actions: [{isOptimistic: true, action: action2}],
        },
        isAuthorized: true,
        authorizationEventNumber: 0,
    });

    await TestRpcContextModule.resolveExecution(commitTaskActionTransaction, 1, {
        extraActions: [],
        referencedAccounts: [],
    });

    expect(getTaskEntryIfExists(store, action2.taskId)).toEqual({
        task: createTask(store, {
            id: action2.taskId,
            time: action2.time,
            taskAction: action2.taskAction,
        })
            .apply(action1, getSortableAccount)
            .apply(action3, getSortableAccount),
        actions: null,
        optimisticState: null,
        isAuthorized: true,
        authorizationEventNumber: 0,
    });
});

test("can create then update tasks optimistically out of order with more non-create tasks", async () => {
    const store = new TaskClientStore({
        accountStore,
        spaceId: generateId(),
        onDisplayError: handleDisplayError,
    });

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

    store.commitTaskActionTransaction(context, [action1]);

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
        isAuthorized: null,
        authorizationEventNumber: null,
    });

    store.commitTaskActionTransaction(context, [action3]);

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
        isAuthorized: null,
        authorizationEventNumber: null,
    });

    store.commitTaskActionTransaction(context, [action2]);

    expect(getTaskEntryIfExists(store, action2.taskId)).toEqual({
        task: createTask(store, {
            id: action2.taskId,
            time: action2.time,
            taskAction: action2.taskAction,
        })
            .apply(action1, getSortableAccount)
            .apply(action3, getSortableAccount),
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
        isAuthorized: true,
        authorizationEventNumber: 0,
    });

    await TestRpcContextModule.resolveExecution(commitTaskActionTransaction, 0, {
        extraActions: [],
        referencedAccounts: [],
    });

    expect(getTaskEntryIfExists(store, action2.taskId)).toEqual({
        task: createTask(store, {
            id: action2.taskId,
            time: action2.time,
            taskAction: action2.taskAction,
        })
            .apply(action1, getSortableAccount)
            .apply(action3, getSortableAccount),
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
        isAuthorized: true,
        authorizationEventNumber: 0,
    });

    await TestRpcContextModule.resolveExecution(commitTaskActionTransaction, 1, {
        extraActions: [],
        referencedAccounts: [],
    });

    expect(getTaskEntryIfExists(store, action2.taskId)).toEqual({
        task: createTask(store, {
            id: action2.taskId,
            time: action2.time,
            taskAction: action2.taskAction,
        })
            .apply(action1, getSortableAccount)
            .apply(action3, getSortableAccount),
        actions: null,
        optimisticState: {
            original: {
                task: null,
                actions: [action1, action3],
            },
            actions: [{isOptimistic: true, action: action2}],
        },
        isAuthorized: true,
        authorizationEventNumber: 0,
    });

    await TestRpcContextModule.resolveExecution(commitTaskActionTransaction, 2, {
        extraActions: [],
        referencedAccounts: [],
    });

    expect(getTaskEntryIfExists(store, action2.taskId)).toEqual({
        task: createTask(store, {
            id: action2.taskId,
            time: action2.time,
            taskAction: action2.taskAction,
        })
            .apply(action1, getSortableAccount)
            .apply(action3, getSortableAccount),
        actions: null,
        optimisticState: null,
        isAuthorized: true,
        authorizationEventNumber: 0,
    });
});

test("resolving optimistic update after garbage collection is ok", async () => {
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

    store.commitTaskActionTransaction(context, [action1]);

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
        isAuthorized: true,
        authorizationEventNumber: 0,
    });

    store.commitTaskActionTransaction(context, [action2]);

    expect(getTaskEntryIfExists(store, action1.taskId)).toEqual({
        task: createTask(store, {
            id: action1.taskId,
            time: action1.time,
            taskAction: action1.taskAction,
        }).apply(action2, getSortableAccount),
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

    await TestRpcContextModule.resolveExecution(commitTaskActionTransaction, 0, {
        extraActions: [],
        referencedAccounts: [],
    });

    expect(getTaskEntryIfExists(store, action1.taskId)).toEqual({
        task: createTask(store, {
            id: action1.taskId,
            time: action1.time,
            taskAction: action1.taskAction,
        }).apply(action2, getSortableAccount),
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
        isAuthorized: true,
        authorizationEventNumber: 0,
    });

    await waitMacrotask();
    global.gc!();

    expect(getTaskEntryIfExists(store, action1.taskId)).toEqual(null);

    await TestRpcContextModule.resolveExecution(commitTaskActionTransaction, 1, {
        extraActions: [],
        referencedAccounts: [],
    });

    expect(getTaskEntryIfExists(store, action1.taskId)).toEqual(null);
});

test("regular actions are added to optimistic state", async () => {
    const store = new TaskClientStore({
        accountStore,
        spaceId: generateId(),
        onDisplayError: handleDisplayError,
    });

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
        number: 1,
        actions: [],
        backfillAuthorizedTasks: [task],
        backfillUnauthorizedTaskIds: [],
        backfillAuthorizedCollections: [],
        backfillUnauthorizedCollectionIds: [],
        referencedAccounts: [],
    });

    expect(getTaskEntryIfExists(store, task.id)).toEqual({
        task,
        actions: null,
        optimisticState: null,
        isAuthorized: true,
        authorizationEventNumber: 1,
    });

    store.commitTaskActionTransaction(context, [action2]);

    expect(getTaskEntryIfExists(store, task.id)).toEqual({
        task: task.apply(action2, getSortableAccount),
        actions: null,
        optimisticState: {
            original: {
                task: task,
                actions: null,
            },
            actions: [{isOptimistic: true, action: action2}],
        },
        isAuthorized: true,
        authorizationEventNumber: 1,
    });

    store.applyUpdateEvent({
        type: "Update",
        number: 2,
        actions: [action3],
        backfillAuthorizedTasks: [],
        backfillUnauthorizedTaskIds: [],
        backfillAuthorizedCollections: [],
        backfillUnauthorizedCollectionIds: [],
        referencedAccounts: [],
    });

    expect(getTaskEntryIfExists(store, task.id)).toEqual({
        task: task.apply(action2, getSortableAccount).apply(action3, getSortableAccount),
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
        isAuthorized: true,
        authorizationEventNumber: 1,
    });

    await TestRpcContextModule.resolveExecution(commitTaskActionTransaction, 0, {
        extraActions: [],
        referencedAccounts: [],
    });

    expect(getTaskEntryIfExists(store, task.id)).toEqual({
        task: task.apply(action2, getSortableAccount).apply(action3, getSortableAccount),
        actions: null,
        optimisticState: null,
        isAuthorized: true,
        authorizationEventNumber: 1,
    });
});

test("regular actions are added to optimistic state with multiple actions", async () => {
    const store = new TaskClientStore({
        accountStore,
        spaceId: generateId(),
        onDisplayError: handleDisplayError,
    });

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
        number: 1,
        actions: [],
        backfillAuthorizedTasks: [task],
        backfillUnauthorizedTaskIds: [],
        backfillAuthorizedCollections: [],
        backfillUnauthorizedCollectionIds: [],
        referencedAccounts: [],
    });

    expect(getTaskEntryIfExists(store, task.id)).toEqual({
        task,
        actions: null,
        optimisticState: null,
        isAuthorized: true,
        authorizationEventNumber: 1,
    });

    store.commitTaskActionTransaction(context, [action2]);

    expect(getTaskEntryIfExists(store, task.id)).toEqual({
        task: task.apply(action2, getSortableAccount),
        actions: null,
        optimisticState: {
            original: {
                task: task,
                actions: null,
            },
            actions: [{isOptimistic: true, action: action2}],
        },
        isAuthorized: true,
        authorizationEventNumber: 1,
    });

    store.applyUpdateEvent({
        type: "Update",
        number: 2,
        actions: [action3],
        backfillAuthorizedTasks: [],
        backfillUnauthorizedTaskIds: [],
        backfillAuthorizedCollections: [],
        backfillUnauthorizedCollectionIds: [],
        referencedAccounts: [],
    });

    expect(getTaskEntryIfExists(store, task.id)).toEqual({
        task: task.apply(action2, getSortableAccount).apply(action3, getSortableAccount),
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
        isAuthorized: true,
        authorizationEventNumber: 1,
    });

    store.commitTaskActionTransaction(context, [action4]);

    expect(getTaskEntryIfExists(store, task.id)).toEqual({
        task: task
            .apply(action2, getSortableAccount)
            .apply(action3, getSortableAccount)
            .apply(action4, getSortableAccount),
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
        isAuthorized: true,
        authorizationEventNumber: 1,
    });

    await TestRpcContextModule.resolveExecution(commitTaskActionTransaction, 0, {
        extraActions: [],
        referencedAccounts: [],
    });

    expect(getTaskEntryIfExists(store, task.id)).toEqual({
        task: task
            .apply(action2, getSortableAccount)
            .apply(action3, getSortableAccount)
            .apply(action4, getSortableAccount),
        actions: null,
        optimisticState: {
            original: {
                task: task.apply(action2, getSortableAccount).apply(action3, getSortableAccount),
                actions: null,
            },
            actions: [{isOptimistic: true, action: action4}],
        },
        isAuthorized: true,
        authorizationEventNumber: 1,
    });

    await TestRpcContextModule.resolveExecution(commitTaskActionTransaction, 1, {
        extraActions: [],
        referencedAccounts: [],
    });

    expect(getTaskEntryIfExists(store, task.id)).toEqual({
        task: task
            .apply(action2, getSortableAccount)
            .apply(action3, getSortableAccount)
            .apply(action4, getSortableAccount),
        actions: null,
        optimisticState: null,
        isAuthorized: true,
        authorizationEventNumber: 1,
    });
});

test("regular actions are added to optimistic state with multiple actions that are committed out of order", async () => {
    const store = new TaskClientStore({
        accountStore,
        spaceId: generateId(),
        onDisplayError: handleDisplayError,
    });

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
        number: 1,
        actions: [],
        backfillAuthorizedTasks: [task],
        backfillUnauthorizedTaskIds: [],
        backfillAuthorizedCollections: [],
        backfillUnauthorizedCollectionIds: [],
        referencedAccounts: [],
    });

    expect(getTaskEntryIfExists(store, task.id)).toEqual({
        task,
        actions: null,
        optimisticState: null,
        isAuthorized: true,
        authorizationEventNumber: 1,
    });

    store.commitTaskActionTransaction(context, [action2]);

    expect(getTaskEntryIfExists(store, task.id)).toEqual({
        task: task.apply(action2, getSortableAccount),
        actions: null,
        optimisticState: {
            original: {
                task: task,
                actions: null,
            },
            actions: [{isOptimistic: true, action: action2}],
        },
        isAuthorized: true,
        authorizationEventNumber: 1,
    });

    store.applyUpdateEvent({
        type: "Update",
        number: 2,
        actions: [action3],
        backfillAuthorizedTasks: [],
        backfillUnauthorizedTaskIds: [],
        backfillAuthorizedCollections: [],
        backfillUnauthorizedCollectionIds: [],
        referencedAccounts: [],
    });

    expect(getTaskEntryIfExists(store, task.id)).toEqual({
        task: task.apply(action2, getSortableAccount).apply(action3, getSortableAccount),
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
        isAuthorized: true,
        authorizationEventNumber: 1,
    });

    store.commitTaskActionTransaction(context, [action4]);

    expect(getTaskEntryIfExists(store, task.id)).toEqual({
        task: task
            .apply(action2, getSortableAccount)
            .apply(action3, getSortableAccount)
            .apply(action4, getSortableAccount),
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
        isAuthorized: true,
        authorizationEventNumber: 1,
    });

    await TestRpcContextModule.resolveExecution(commitTaskActionTransaction, 1, {
        extraActions: [],
        referencedAccounts: [],
    });

    expect(getTaskEntryIfExists(store, task.id)).toEqual({
        task: task
            .apply(action2, getSortableAccount)
            .apply(action3, getSortableAccount)
            .apply(action4, getSortableAccount),
        actions: null,
        optimisticState: {
            original: {
                task: task.apply(action4, getSortableAccount),
                actions: null,
            },
            actions: [
                {isOptimistic: true, action: action2},
                {isOptimistic: false, action: action3},
            ],
        },
        isAuthorized: true,
        authorizationEventNumber: 1,
    });

    await TestRpcContextModule.resolveExecution(commitTaskActionTransaction, 0, {
        extraActions: [],
        referencedAccounts: [],
    });

    expect(getTaskEntryIfExists(store, task.id)).toEqual({
        task: task
            .apply(action2, getSortableAccount)
            .apply(action3, getSortableAccount)
            .apply(action4, getSortableAccount),
        actions: null,
        optimisticState: null,
        isAuthorized: true,
        authorizationEventNumber: 1,
    });
});

test("regular actions are added to optimistic state when task is not backfilled", async () => {
    const store = new TaskClientStore({
        accountStore,
        spaceId: generateId(),
        onDisplayError: handleDisplayError,
    });

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

    store.commitTaskActionTransaction(context, [action2]);

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
        isAuthorized: null,
        authorizationEventNumber: null,
    });

    store.applyUpdateEvent({
        type: "Update",
        number: 2,
        actions: [action3],
        backfillAuthorizedTasks: [],
        backfillUnauthorizedTaskIds: [],
        backfillAuthorizedCollections: [],
        backfillUnauthorizedCollectionIds: [],
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
        isAuthorized: null,
        authorizationEventNumber: null,
    });

    await TestRpcContextModule.resolveExecution(commitTaskActionTransaction, 0, {
        extraActions: [],
        referencedAccounts: [],
    });

    expect(getTaskEntryIfExists(store, task.id)).toEqual({
        task: null,
        actions: [action2, action3],
        optimisticState: null,
        isAuthorized: null,
        authorizationEventNumber: null,
    });
});

test("regular actions are added to optimistic state with multiple actions when task is not backfilled", async () => {
    const store = new TaskClientStore({
        accountStore,
        spaceId: generateId(),
        onDisplayError: handleDisplayError,
    });

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

    store.commitTaskActionTransaction(context, [action2]);

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
        isAuthorized: null,
        authorizationEventNumber: null,
    });

    store.applyUpdateEvent({
        type: "Update",
        number: 2,
        actions: [action3],
        backfillAuthorizedTasks: [],
        backfillUnauthorizedTaskIds: [],
        backfillAuthorizedCollections: [],
        backfillUnauthorizedCollectionIds: [],
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
        isAuthorized: null,
        authorizationEventNumber: null,
    });

    store.commitTaskActionTransaction(context, [action4]);

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
        isAuthorized: null,
        authorizationEventNumber: null,
    });

    await TestRpcContextModule.resolveExecution(commitTaskActionTransaction, 0, {
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
        isAuthorized: null,
        authorizationEventNumber: null,
    });

    await TestRpcContextModule.resolveExecution(commitTaskActionTransaction, 1, {
        extraActions: [],
        referencedAccounts: [],
    });

    expect(getTaskEntryIfExists(store, task.id)).toEqual({
        task: null,
        actions: [action2, action3, action4],
        optimisticState: null,
        isAuthorized: null,
        authorizationEventNumber: null,
    });
});

test("regular actions are added to optimistic state with multiple actions that are committed out of order when task is not backfilled", async () => {
    const store = new TaskClientStore({
        accountStore,
        spaceId: generateId(),
        onDisplayError: handleDisplayError,
    });

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

    store.commitTaskActionTransaction(context, [action2]);

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
        isAuthorized: null,
        authorizationEventNumber: null,
    });

    store.applyUpdateEvent({
        type: "Update",
        number: 2,
        actions: [action3],
        backfillAuthorizedTasks: [],
        backfillUnauthorizedTaskIds: [],
        backfillAuthorizedCollections: [],
        backfillUnauthorizedCollectionIds: [],
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
        isAuthorized: null,
        authorizationEventNumber: null,
    });

    store.commitTaskActionTransaction(context, [action4]);

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
        isAuthorized: null,
        authorizationEventNumber: null,
    });

    await TestRpcContextModule.resolveExecution(commitTaskActionTransaction, 1, {
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
        isAuthorized: null,
        authorizationEventNumber: null,
    });

    await TestRpcContextModule.resolveExecution(commitTaskActionTransaction, 0, {
        extraActions: [],
        referencedAccounts: [],
    });

    expect(getTaskEntryIfExists(store, task.id)).toEqual({
        task: null,
        actions: [action2, action3, action4],
        optimisticState: null,
        isAuthorized: null,
        authorizationEventNumber: null,
    });
});

test("regular actions are added to optimistic state when task is created optimistically", async () => {
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

    store.commitTaskActionTransaction(context, [action1]);

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
        isAuthorized: true,
        authorizationEventNumber: 0,
    });

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

    store.applyUpdateEvent({
        type: "Update",
        number: 2,
        actions: [action3],
        backfillAuthorizedTasks: [],
        backfillUnauthorizedTaskIds: [],
        backfillAuthorizedCollections: [],
        backfillUnauthorizedCollectionIds: [],
        referencedAccounts: [],
    });

    expect(getTaskEntryIfExists(store, task.id)).toEqual({
        task: task.apply(action2, getSortableAccount).apply(action3, getSortableAccount),
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
        isAuthorized: true,
        authorizationEventNumber: 0,
    });

    await TestRpcContextModule.resolveExecution(commitTaskActionTransaction, 0, {
        extraActions: [],
        referencedAccounts: [],
    });

    expect(getTaskEntryIfExists(store, task.id)).toEqual({
        task: task.apply(action2, getSortableAccount).apply(action3, getSortableAccount),
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
        isAuthorized: true,
        authorizationEventNumber: 0,
    });

    await TestRpcContextModule.resolveExecution(commitTaskActionTransaction, 1, {
        extraActions: [],
        referencedAccounts: [],
    });

    expect(getTaskEntryIfExists(store, task.id)).toEqual({
        task: task.apply(action2, getSortableAccount).apply(action3, getSortableAccount),
        actions: null,
        optimisticState: null,
        isAuthorized: true,
        authorizationEventNumber: 0,
    });
});

test("regular actions are added to optimistic state with multiple actions when task is created optimistically", async () => {
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

    store.commitTaskActionTransaction(context, [action1]);

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
        isAuthorized: true,
        authorizationEventNumber: 0,
    });

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

    store.applyUpdateEvent({
        type: "Update",
        number: 2,
        actions: [action3],
        backfillAuthorizedTasks: [],
        backfillUnauthorizedTaskIds: [],
        backfillAuthorizedCollections: [],
        backfillUnauthorizedCollectionIds: [],
        referencedAccounts: [],
    });

    expect(getTaskEntryIfExists(store, task.id)).toEqual({
        task: task.apply(action2, getSortableAccount).apply(action3, getSortableAccount),
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
        isAuthorized: true,
        authorizationEventNumber: 0,
    });

    store.commitTaskActionTransaction(context, [action4]);

    expect(getTaskEntryIfExists(store, task.id)).toEqual({
        task: task
            .apply(action2, getSortableAccount)
            .apply(action3, getSortableAccount)
            .apply(action4, getSortableAccount),
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
        isAuthorized: true,
        authorizationEventNumber: 0,
    });

    await TestRpcContextModule.resolveExecution(commitTaskActionTransaction, 0, {
        extraActions: [],
        referencedAccounts: [],
    });

    expect(getTaskEntryIfExists(store, task.id)).toEqual({
        task: task
            .apply(action2, getSortableAccount)
            .apply(action3, getSortableAccount)
            .apply(action4, getSortableAccount),
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
        isAuthorized: true,
        authorizationEventNumber: 0,
    });

    await TestRpcContextModule.resolveExecution(commitTaskActionTransaction, 1, {
        extraActions: [],
        referencedAccounts: [],
    });

    expect(getTaskEntryIfExists(store, task.id)).toEqual({
        task: task
            .apply(action2, getSortableAccount)
            .apply(action3, getSortableAccount)
            .apply(action4, getSortableAccount),
        actions: null,
        optimisticState: {
            original: {
                task: task.apply(action2, getSortableAccount).apply(action3, getSortableAccount),
                actions: null,
            },
            actions: [{isOptimistic: true, action: action4}],
        },
        isAuthorized: true,
        authorizationEventNumber: 0,
    });

    await TestRpcContextModule.resolveExecution(commitTaskActionTransaction, 2, {
        extraActions: [],
        referencedAccounts: [],
    });

    expect(getTaskEntryIfExists(store, task.id)).toEqual({
        task: task
            .apply(action2, getSortableAccount)
            .apply(action3, getSortableAccount)
            .apply(action4, getSortableAccount),
        actions: null,
        optimisticState: null,
        isAuthorized: true,
        authorizationEventNumber: 0,
    });
});

test("regular actions are added to optimistic state with multiple actions that are committed out of order when task is created optimistically", async () => {
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

    store.commitTaskActionTransaction(context, [action1]);

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
        isAuthorized: true,
        authorizationEventNumber: 0,
    });

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

    store.applyUpdateEvent({
        type: "Update",
        number: 2,
        actions: [action3],
        backfillAuthorizedTasks: [],
        backfillUnauthorizedTaskIds: [],
        backfillAuthorizedCollections: [],
        backfillUnauthorizedCollectionIds: [],
        referencedAccounts: [],
    });

    expect(getTaskEntryIfExists(store, task.id)).toEqual({
        task: task.apply(action2, getSortableAccount).apply(action3, getSortableAccount),
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
        isAuthorized: true,
        authorizationEventNumber: 0,
    });

    store.commitTaskActionTransaction(context, [action4]);

    expect(getTaskEntryIfExists(store, task.id)).toEqual({
        task: task
            .apply(action2, getSortableAccount)
            .apply(action3, getSortableAccount)
            .apply(action4, getSortableAccount),
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
        isAuthorized: true,
        authorizationEventNumber: 0,
    });

    await TestRpcContextModule.resolveExecution(commitTaskActionTransaction, 0, {
        extraActions: [],
        referencedAccounts: [],
    });

    expect(getTaskEntryIfExists(store, task.id)).toEqual({
        task: task
            .apply(action2, getSortableAccount)
            .apply(action3, getSortableAccount)
            .apply(action4, getSortableAccount),
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
        isAuthorized: true,
        authorizationEventNumber: 0,
    });

    await TestRpcContextModule.resolveExecution(commitTaskActionTransaction, 2, {
        extraActions: [],
        referencedAccounts: [],
    });

    expect(getTaskEntryIfExists(store, task.id)).toEqual({
        task: task
            .apply(action2, getSortableAccount)
            .apply(action3, getSortableAccount)
            .apply(action4, getSortableAccount),
        actions: null,
        optimisticState: {
            original: {
                task: task.apply(action4, getSortableAccount),
                actions: null,
            },
            actions: [
                {isOptimistic: true, action: action2},
                {isOptimistic: false, action: action3},
            ],
        },
        isAuthorized: true,
        authorizationEventNumber: 0,
    });

    await TestRpcContextModule.resolveExecution(commitTaskActionTransaction, 1, {
        extraActions: [],
        referencedAccounts: [],
    });

    expect(getTaskEntryIfExists(store, task.id)).toEqual({
        task: task
            .apply(action2, getSortableAccount)
            .apply(action3, getSortableAccount)
            .apply(action4, getSortableAccount),
        actions: null,
        optimisticState: null,
        isAuthorized: true,
        authorizationEventNumber: 0,
    });
});

test("three optimistic actions when task is not backfilled", async () => {
    const store = new TaskClientStore({
        accountStore,
        spaceId: generateId(),
        onDisplayError: handleDisplayError,
    });

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

    store.commitTaskActionTransaction(context, [action2]);

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
        isAuthorized: null,
        authorizationEventNumber: null,
    });

    store.commitTaskActionTransaction(context, [action3]);

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
        isAuthorized: null,
        authorizationEventNumber: null,
    });

    store.commitTaskActionTransaction(context, [action4]);

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
        isAuthorized: null,
        authorizationEventNumber: null,
    });

    await TestRpcContextModule.resolveExecution(commitTaskActionTransaction, 0, {
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
        isAuthorized: null,
        authorizationEventNumber: null,
    });

    await TestRpcContextModule.resolveExecution(commitTaskActionTransaction, 1, {
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
        isAuthorized: null,
        authorizationEventNumber: null,
    });

    await TestRpcContextModule.resolveExecution(commitTaskActionTransaction, 2, {
        extraActions: [],
        referencedAccounts: [],
    });

    expect(getTaskEntryIfExists(store, task.id)).toEqual({
        task: null,
        actions: [action2, action3, action4],
        optimisticState: null,
        isAuthorized: null,
        authorizationEventNumber: null,
    });
});

test("backfilling a task when none exists and there are optimistic actions works", async () => {
    const store = new TaskClientStore({
        accountStore,
        spaceId: generateId(),
        onDisplayError: handleDisplayError,
    });

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

    store.commitTaskActionTransaction(context, [action2]);

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
        isAuthorized: null,
        authorizationEventNumber: null,
    });

    store.applyUpdateEvent({
        type: "Update",
        number: 2,
        actions: [action3],
        backfillAuthorizedTasks: [],
        backfillUnauthorizedTaskIds: [],
        backfillAuthorizedCollections: [],
        backfillUnauthorizedCollectionIds: [],
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
        isAuthorized: null,
        authorizationEventNumber: null,
    });

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

    expect(getTaskEntryIfExists(store, task.id)).toEqual({
        task: task.apply(action2, getSortableAccount).apply(action3, getSortableAccount),
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
        isAuthorized: true,
        authorizationEventNumber: 1,
    });

    await TestRpcContextModule.resolveLastExecution(commitTaskActionTransaction, {
        extraActions: [],
        referencedAccounts: [],
    });

    expect(getTaskEntryIfExists(store, task.id)).toEqual({
        task: task.apply(action2, getSortableAccount).apply(action3, getSortableAccount),
        actions: null,
        optimisticState: null,
        isAuthorized: true,
        authorizationEventNumber: 1,
    });
});

test("backfilling a task when one is already backfilled and there are optimistic actions works", async () => {
    const store = new TaskClientStore({
        accountStore,
        spaceId: generateId(),
        onDisplayError: handleDisplayError,
    });

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
        number: 1,
        actions: [],
        backfillAuthorizedTasks: [task],
        backfillUnauthorizedTaskIds: [],
        backfillAuthorizedCollections: [],
        backfillUnauthorizedCollectionIds: [],
        referencedAccounts: [],
    });

    expect(getTaskEntryIfExists(store, task.id)).toEqual({
        task,
        actions: null,
        optimisticState: null,
        isAuthorized: true,
        authorizationEventNumber: 1,
    });

    store.commitTaskActionTransaction(context, [action2]);

    expect(getTaskEntryIfExists(store, task.id)).toEqual({
        task: task.apply(action2, getSortableAccount),
        actions: null,
        optimisticState: {
            original: {
                task,
                actions: null,
            },
            actions: [{isOptimistic: true, action: action2}],
        },
        isAuthorized: true,
        authorizationEventNumber: 1,
    });

    store.applyUpdateEvent({
        type: "Update",
        number: 2,
        actions: [],
        backfillAuthorizedTasks: [task.apply(action3, getSortableAccount)],
        backfillUnauthorizedTaskIds: [],
        backfillAuthorizedCollections: [],
        backfillUnauthorizedCollectionIds: [],
        referencedAccounts: [],
    });

    expect(getTaskEntryIfExists(store, task.id)).toEqual({
        task: task.apply(action2, getSortableAccount).apply(action3, getSortableAccount),
        actions: null,
        optimisticState: {
            original: {
                task: task.apply(action3, getSortableAccount),
                actions: null,
            },
            actions: [{isOptimistic: true, action: action2}],
        },
        isAuthorized: true,
        authorizationEventNumber: 2,
    });

    await TestRpcContextModule.resolveLastExecution(commitTaskActionTransaction, {
        extraActions: [],
        referencedAccounts: [],
    });

    expect(getTaskEntryIfExists(store, task.id)).toEqual({
        task: task.apply(action2, getSortableAccount).apply(action3, getSortableAccount),
        actions: null,
        optimisticState: null,
        isAuthorized: true,
        authorizationEventNumber: 2,
    });
});

test("backfilling a task when there are optimistic actions but no previously backfilled task works", async () => {
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
        number: 2,
        actions: [action3],
        backfillAuthorizedTasks: [],
        backfillUnauthorizedTaskIds: [],
        backfillAuthorizedCollections: [],
        backfillUnauthorizedCollectionIds: [],
        referencedAccounts: [],
    });

    expect(getTaskEntryIfExists(store, task.id)).toEqual({
        task: null,
        actions: [action3],
        optimisticState: null,
        isAuthorized: null,
        authorizationEventNumber: null,
    });

    store.commitTaskActionTransaction(context, [action1]);

    expect(getTaskEntryIfExists(store, task.id)).toEqual({
        task: task.apply(action3, getSortableAccount),
        actions: null,
        optimisticState: {
            original: {
                task: null,
                actions: [action3],
            },
            actions: [{isOptimistic: true, action: action1}],
        },
        isAuthorized: true,
        authorizationEventNumber: 0,
    });

    store.commitTaskActionTransaction(context, [action2]);

    expect(getTaskEntryIfExists(store, task.id)).toEqual({
        task: task.apply(action3, getSortableAccount).apply(action2, getSortableAccount),
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
        isAuthorized: true,
        authorizationEventNumber: 0,
    });

    store.applyUpdateEvent({
        type: "Update",
        number: 2,
        actions: [],
        backfillAuthorizedTasks: [task.apply(action4, getSortableAccount)],
        backfillUnauthorizedTaskIds: [],
        backfillAuthorizedCollections: [],
        backfillUnauthorizedCollectionIds: [],
        referencedAccounts: [],
    });

    expect(getTaskEntryIfExists(store, task.id)).toEqual({
        task: task
            .apply(action4, getSortableAccount)
            .apply(action3, getSortableAccount)
            .apply(action2, getSortableAccount),
        actions: null,
        optimisticState: {
            original: {
                task: task.apply(action4, getSortableAccount).apply(action3, getSortableAccount),
                actions: null,
            },
            actions: [
                {isOptimistic: true, action: action1},
                {isOptimistic: true, action: action2},
            ],
        },
        isAuthorized: true,
        authorizationEventNumber: 2,
    });

    await TestRpcContextModule.resolveExecution(commitTaskActionTransaction, 0, {
        extraActions: [],
        referencedAccounts: [],
    });

    expect(getTaskEntryIfExists(store, task.id)).toEqual({
        task: task
            .apply(action4, getSortableAccount)
            .apply(action3, getSortableAccount)
            .apply(action2, getSortableAccount),
        actions: null,
        optimisticState: {
            original: {
                task: task
                    .apply(action4, getSortableAccount)
                    .apply(action3, getSortableAccount)
                    .apply(action1, getSortableAccount),
                actions: null,
            },
            actions: [{isOptimistic: true, action: action2}],
        },
        isAuthorized: true,
        authorizationEventNumber: 2,
    });

    await TestRpcContextModule.resolveExecution(commitTaskActionTransaction, 1, {
        extraActions: [],
        referencedAccounts: [],
    });

    expect(getTaskEntryIfExists(store, task.id)).toEqual({
        task: task
            .apply(action4, getSortableAccount)
            .apply(action3, getSortableAccount)
            .apply(action2, getSortableAccount),
        actions: null,
        optimisticState: null,
        isAuthorized: true,
        authorizationEventNumber: 2,
    });
});

test("applies commit action calls optimistically (rejected)", async () => {
    const store = new TaskClientStore({
        accountStore,
        spaceId: generateId(),
        onDisplayError: handleDisplayError,
    });

    const task = createTask(store);

    expect(getTaskEntryIfExists(store, task.id)).toEqual(null);

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

    expect(getTaskEntryIfExists(store, task.id)).toEqual({
        task,
        actions: null,
        optimisticState: null,
        isAuthorized: true,
        authorizationEventNumber: 1,
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

    store.commitTaskActionTransaction(context, [action]);

    expect(getTaskEntryIfExists(store, task.id)).toEqual({
        task: task.apply(action, getSortableAccount),
        actions: null,
        optimisticState: {
            original: {
                task,
                actions: null,
            },
            actions: [{isOptimistic: true, action}],
        },
        isAuthorized: true,
        authorizationEventNumber: 1,
    });

    await TestRpcContextModule.rejectLastExecution(commitTaskActionTransaction);

    expect(getTaskEntryIfExists(store, task.id)).toEqual({
        task,
        actions: null,
        optimisticState: null,
        isAuthorized: true,
        authorizationEventNumber: 1,
    });

    expect(displayErrors.length).toEqual(1);
    displayErrors = [];
});

test("can create tasks optimistically (rejected)", async () => {
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

    expect(getTaskEntryIfExists(store, action1.taskId)).toEqual(null);

    store.commitTaskActionTransaction(context, [action1]);

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
        isAuthorized: true,
        authorizationEventNumber: 0,
    });

    await TestRpcContextModule.rejectLastExecution(commitTaskActionTransaction);

    expect(getTaskEntryIfExists(store, action1.taskId)).toEqual({
        task: null,
        actions: [],
        optimisticState: null,
        isAuthorized: true,
        authorizationEventNumber: 0,
    });

    expect(displayErrors.length).toEqual(1);
    displayErrors = [];
});

test("can create then update tasks optimistically (rejected)", async () => {
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

    store.commitTaskActionTransaction(context, [action1]);

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
        isAuthorized: true,
        authorizationEventNumber: 0,
    });

    store.commitTaskActionTransaction(context, [action2]);

    expect(getTaskEntryIfExists(store, action1.taskId)).toEqual({
        task: createTask(store, {
            id: action1.taskId,
            time: action1.time,
            taskAction: action1.taskAction,
        }).apply(action2, getSortableAccount),
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

    await TestRpcContextModule.rejectExecution(commitTaskActionTransaction, 0);

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
        isAuthorized: true,
        authorizationEventNumber: 0,
    });

    await TestRpcContextModule.rejectExecution(commitTaskActionTransaction, 1);

    expect(getTaskEntryIfExists(store, action1.taskId)).toEqual({
        task: null,
        actions: [],
        optimisticState: null,
        isAuthorized: true,
        authorizationEventNumber: 0,
    });

    expect(displayErrors.length).toEqual(2);
    displayErrors = [];
});

test("can create then update tasks optimistically and resolve commits out of order (rejected)", async () => {
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

    store.commitTaskActionTransaction(context, [action1]);

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
        isAuthorized: true,
        authorizationEventNumber: 0,
    });

    store.commitTaskActionTransaction(context, [action2]);

    expect(getTaskEntryIfExists(store, action1.taskId)).toEqual({
        task: createTask(store, {
            id: action1.taskId,
            time: action1.time,
            taskAction: action1.taskAction,
        }).apply(action2, getSortableAccount),
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

    await TestRpcContextModule.rejectExecution(commitTaskActionTransaction, 1);

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
        isAuthorized: true,
        authorizationEventNumber: 0,
    });

    await TestRpcContextModule.rejectExecution(commitTaskActionTransaction, 0);

    expect(getTaskEntryIfExists(store, action1.taskId)).toEqual({
        task: null,
        actions: [],
        optimisticState: null,
        isAuthorized: true,
        authorizationEventNumber: 0,
    });

    expect(displayErrors.length).toEqual(2);
    displayErrors = [];
});

test("can create then update tasks optimistically after an action from the server (rejected)", async () => {
    const store = new TaskClientStore({
        accountStore,
        spaceId: generateId(),
        onDisplayError: handleDisplayError,
    });

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
        number: 1,
        actions: [action1],
        backfillAuthorizedTasks: [],
        backfillUnauthorizedTaskIds: [],
        backfillAuthorizedCollections: [],
        backfillUnauthorizedCollectionIds: [],
        referencedAccounts: [],
    });

    expect(getTaskEntryIfExists(store, action2.taskId)).toEqual({
        task: null,
        actions: [action1],
        optimisticState: null,
        isAuthorized: null,
        authorizationEventNumber: null,
    });

    store.commitTaskActionTransaction(context, [action2]);

    expect(getTaskEntryIfExists(store, action2.taskId)).toEqual({
        task: createTask(store, {
            id: action2.taskId,
            time: action2.time,
            taskAction: action2.taskAction,
        }).apply(action1, getSortableAccount),
        actions: null,
        optimisticState: {
            original: {
                task: null,
                actions: [action1],
            },
            actions: [{isOptimistic: true, action: action2}],
        },
        isAuthorized: true,
        authorizationEventNumber: 0,
    });

    store.commitTaskActionTransaction(context, [action3]);

    expect(getTaskEntryIfExists(store, action2.taskId)).toEqual({
        task: createTask(store, {
            id: action2.taskId,
            time: action2.time,
            taskAction: action2.taskAction,
        })
            .apply(action1, getSortableAccount)
            .apply(action3, getSortableAccount),
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
        isAuthorized: true,
        authorizationEventNumber: 0,
    });

    await TestRpcContextModule.rejectExecution(commitTaskActionTransaction, 0);

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
        isAuthorized: true,
        authorizationEventNumber: 0,
    });

    await TestRpcContextModule.rejectExecution(commitTaskActionTransaction, 1);

    expect(getTaskEntryIfExists(store, action2.taskId)).toEqual({
        task: null,
        actions: [action1],
        optimisticState: null,
        isAuthorized: true,
        authorizationEventNumber: 0,
    });

    expect(displayErrors.length).toEqual(2);
    displayErrors = [];
});

test("can create then update tasks optimistically our of order (rejected)", async () => {
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

    store.commitTaskActionTransaction(context, [action2]);

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
        isAuthorized: null,
        authorizationEventNumber: null,
    });

    store.commitTaskActionTransaction(context, [action1]);

    expect(getTaskEntryIfExists(store, action1.taskId)).toEqual({
        task: createTask(store, {
            id: action1.taskId,
            time: action1.time,
            taskAction: action1.taskAction,
        }).apply(action2, getSortableAccount),
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
        isAuthorized: true,
        authorizationEventNumber: 0,
    });

    await TestRpcContextModule.rejectExecution(commitTaskActionTransaction, 0);

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
        isAuthorized: true,
        authorizationEventNumber: 0,
    });

    await TestRpcContextModule.rejectExecution(commitTaskActionTransaction, 1);

    expect(getTaskEntryIfExists(store, action1.taskId)).toEqual({
        task: null,
        actions: [],
        optimisticState: null,
        isAuthorized: true,
        authorizationEventNumber: 0,
    });

    expect(displayErrors.length).toEqual(2);
    displayErrors = [];
});

test("can create then update tasks optimistically out of order after an action from the server (rejected)", async () => {
    const store = new TaskClientStore({
        accountStore,
        spaceId: generateId(),
        onDisplayError: handleDisplayError,
    });

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
        number: 1,
        actions: [action1],
        backfillAuthorizedTasks: [],
        backfillUnauthorizedTaskIds: [],
        backfillAuthorizedCollections: [],
        backfillUnauthorizedCollectionIds: [],
        referencedAccounts: [],
    });

    expect(getTaskEntryIfExists(store, action2.taskId)).toEqual({
        task: null,
        actions: [action1],
        optimisticState: null,
        isAuthorized: null,
        authorizationEventNumber: null,
    });

    store.commitTaskActionTransaction(context, [action3]);

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
        isAuthorized: null,
        authorizationEventNumber: null,
    });

    store.commitTaskActionTransaction(context, [action2]);

    expect(getTaskEntryIfExists(store, action2.taskId)).toEqual({
        task: createTask(store, {
            id: action2.taskId,
            time: action2.time,
            taskAction: action2.taskAction,
        })
            .apply(action1, getSortableAccount)
            .apply(action3, getSortableAccount),
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
        isAuthorized: true,
        authorizationEventNumber: 0,
    });

    await TestRpcContextModule.rejectExecution(commitTaskActionTransaction, 0);

    expect(getTaskEntryIfExists(store, action2.taskId)).toEqual({
        task: createTask(store, {
            id: action2.taskId,
            time: action2.time,
            taskAction: action2.taskAction,
        }).apply(action1, getSortableAccount),
        actions: null,
        optimisticState: {
            original: {
                task: null,
                actions: [action1],
            },
            actions: [{isOptimistic: true, action: action2}],
        },
        isAuthorized: true,
        authorizationEventNumber: 0,
    });

    await TestRpcContextModule.rejectExecution(commitTaskActionTransaction, 1);

    expect(getTaskEntryIfExists(store, action2.taskId)).toEqual({
        task: null,
        actions: [action1],
        optimisticState: null,
        isAuthorized: true,
        authorizationEventNumber: 0,
    });

    expect(displayErrors.length).toEqual(2);
    displayErrors = [];
});

test("can create then update tasks optimistically out of order with more non-create tasks (rejected)", async () => {
    const store = new TaskClientStore({
        accountStore,
        spaceId: generateId(),
        onDisplayError: handleDisplayError,
    });

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

    store.commitTaskActionTransaction(context, [action1]);

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
        isAuthorized: null,
        authorizationEventNumber: null,
    });

    store.commitTaskActionTransaction(context, [action3]);

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
        isAuthorized: null,
        authorizationEventNumber: null,
    });

    store.commitTaskActionTransaction(context, [action2]);

    expect(getTaskEntryIfExists(store, action2.taskId)).toEqual({
        task: createTask(store, {
            id: action2.taskId,
            time: action2.time,
            taskAction: action2.taskAction,
        })
            .apply(action1, getSortableAccount)
            .apply(action3, getSortableAccount),
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
        isAuthorized: true,
        authorizationEventNumber: 0,
    });

    await TestRpcContextModule.rejectExecution(commitTaskActionTransaction, 0);

    expect(getTaskEntryIfExists(store, action2.taskId)).toEqual({
        task: createTask(store, {
            id: action2.taskId,
            time: action2.time,
            taskAction: action2.taskAction,
        }).apply(action3, getSortableAccount),
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
        isAuthorized: true,
        authorizationEventNumber: 0,
    });

    await TestRpcContextModule.rejectExecution(commitTaskActionTransaction, 1);

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
        isAuthorized: true,
        authorizationEventNumber: 0,
    });

    await TestRpcContextModule.rejectExecution(commitTaskActionTransaction, 2);

    expect(getTaskEntryIfExists(store, action2.taskId)).toEqual({
        task: null,
        actions: [],
        optimisticState: null,
        isAuthorized: true,
        authorizationEventNumber: 0,
    });

    expect(displayErrors.length).toEqual(3);
    displayErrors = [];
});

test("resolving optimistic update after garbage collection is ok (rejected)", async () => {
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

    store.commitTaskActionTransaction(context, [action1]);

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
        isAuthorized: true,
        authorizationEventNumber: 0,
    });

    store.commitTaskActionTransaction(context, [action2]);

    expect(getTaskEntryIfExists(store, action1.taskId)).toEqual({
        task: createTask(store, {
            id: action1.taskId,
            time: action1.time,
            taskAction: action1.taskAction,
        }).apply(action2, getSortableAccount),
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

    await TestRpcContextModule.resolveExecution(commitTaskActionTransaction, 0, {
        extraActions: [],
        referencedAccounts: [],
    });

    expect(getTaskEntryIfExists(store, action1.taskId)).toEqual({
        task: createTask(store, {
            id: action1.taskId,
            time: action1.time,
            taskAction: action1.taskAction,
        }).apply(action2, getSortableAccount),
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
        isAuthorized: true,
        authorizationEventNumber: 0,
    });

    await waitMacrotask();
    global.gc!();

    expect(getTaskEntryIfExists(store, action1.taskId)).toEqual(null);

    await TestRpcContextModule.rejectExecution(commitTaskActionTransaction, 1);

    expect(getTaskEntryIfExists(store, action1.taskId)).toEqual(null);

    expect(displayErrors.length).toEqual(1);
    displayErrors = [];
});

test("regular actions are added to optimistic state (rejected)", async () => {
    const store = new TaskClientStore({
        accountStore,
        spaceId: generateId(),
        onDisplayError: handleDisplayError,
    });

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
        number: 1,
        actions: [],
        backfillAuthorizedTasks: [task],
        backfillUnauthorizedTaskIds: [],
        backfillAuthorizedCollections: [],
        backfillUnauthorizedCollectionIds: [],
        referencedAccounts: [],
    });

    expect(getTaskEntryIfExists(store, task.id)).toEqual({
        task,
        actions: null,
        optimisticState: null,
        isAuthorized: true,
        authorizationEventNumber: 1,
    });

    store.commitTaskActionTransaction(context, [action2]);

    expect(getTaskEntryIfExists(store, task.id)).toEqual({
        task: task.apply(action2, getSortableAccount),
        actions: null,
        optimisticState: {
            original: {
                task: task,
                actions: null,
            },
            actions: [{isOptimistic: true, action: action2}],
        },
        isAuthorized: true,
        authorizationEventNumber: 1,
    });

    store.applyUpdateEvent({
        type: "Update",
        number: 2,
        actions: [action3],
        backfillAuthorizedTasks: [],
        backfillUnauthorizedTaskIds: [],
        backfillAuthorizedCollections: [],
        backfillUnauthorizedCollectionIds: [],
        referencedAccounts: [],
    });

    expect(getTaskEntryIfExists(store, task.id)).toEqual({
        task: task.apply(action2, getSortableAccount).apply(action3, getSortableAccount),
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
        isAuthorized: true,
        authorizationEventNumber: 1,
    });

    await TestRpcContextModule.rejectExecution(commitTaskActionTransaction, 0);

    expect(getTaskEntryIfExists(store, task.id)).toEqual({
        task: task.apply(action3, getSortableAccount),
        actions: null,
        optimisticState: null,
        isAuthorized: true,
        authorizationEventNumber: 1,
    });

    expect(displayErrors.length).toEqual(1);
    displayErrors = [];
});

test("regular actions are added to optimistic state with multiple actions (rejected)", async () => {
    const store = new TaskClientStore({
        accountStore,
        spaceId: generateId(),
        onDisplayError: handleDisplayError,
    });

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
        number: 1,
        actions: [],
        backfillAuthorizedTasks: [task],
        backfillUnauthorizedTaskIds: [],
        backfillAuthorizedCollections: [],
        backfillUnauthorizedCollectionIds: [],
        referencedAccounts: [],
    });

    expect(getTaskEntryIfExists(store, task.id)).toEqual({
        task,
        actions: null,
        optimisticState: null,
        isAuthorized: true,
        authorizationEventNumber: 1,
    });

    store.commitTaskActionTransaction(context, [action2]);

    expect(getTaskEntryIfExists(store, task.id)).toEqual({
        task: task.apply(action2, getSortableAccount),
        actions: null,
        optimisticState: {
            original: {
                task: task,
                actions: null,
            },
            actions: [{isOptimistic: true, action: action2}],
        },
        isAuthorized: true,
        authorizationEventNumber: 1,
    });

    store.applyUpdateEvent({
        type: "Update",
        number: 2,
        actions: [action3],
        backfillAuthorizedTasks: [],
        backfillUnauthorizedTaskIds: [],
        backfillAuthorizedCollections: [],
        backfillUnauthorizedCollectionIds: [],
        referencedAccounts: [],
    });

    expect(getTaskEntryIfExists(store, task.id)).toEqual({
        task: task.apply(action2, getSortableAccount).apply(action3, getSortableAccount),
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
        isAuthorized: true,
        authorizationEventNumber: 1,
    });

    store.commitTaskActionTransaction(context, [action4]);

    expect(getTaskEntryIfExists(store, task.id)).toEqual({
        task: task
            .apply(action2, getSortableAccount)
            .apply(action3, getSortableAccount)
            .apply(action4, getSortableAccount),
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
        isAuthorized: true,
        authorizationEventNumber: 1,
    });

    await TestRpcContextModule.rejectExecution(commitTaskActionTransaction, 0);

    expect(getTaskEntryIfExists(store, task.id)).toEqual({
        task: task.apply(action3, getSortableAccount).apply(action4, getSortableAccount),
        actions: null,
        optimisticState: {
            original: {
                task: task.apply(action3, getSortableAccount),
                actions: null,
            },
            actions: [{isOptimistic: true, action: action4}],
        },
        isAuthorized: true,
        authorizationEventNumber: 1,
    });

    await TestRpcContextModule.rejectExecution(commitTaskActionTransaction, 1);

    expect(getTaskEntryIfExists(store, task.id)).toEqual({
        task: task.apply(action3, getSortableAccount),
        actions: null,
        optimisticState: null,
        isAuthorized: true,
        authorizationEventNumber: 1,
    });

    expect(displayErrors.length).toEqual(2);
    displayErrors = [];
});

test("regular actions are added to optimistic state with multiple actions that are committed out of order (rejected)", async () => {
    const store = new TaskClientStore({
        accountStore,
        spaceId: generateId(),
        onDisplayError: handleDisplayError,
    });

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
        number: 1,
        actions: [],
        backfillAuthorizedTasks: [task],
        backfillUnauthorizedTaskIds: [],
        backfillAuthorizedCollections: [],
        backfillUnauthorizedCollectionIds: [],
        referencedAccounts: [],
    });

    expect(getTaskEntryIfExists(store, task.id)).toEqual({
        task,
        actions: null,
        optimisticState: null,
        isAuthorized: true,
        authorizationEventNumber: 1,
    });

    store.commitTaskActionTransaction(context, [action2]);

    expect(getTaskEntryIfExists(store, task.id)).toEqual({
        task: task.apply(action2, getSortableAccount),
        actions: null,
        optimisticState: {
            original: {
                task: task,
                actions: null,
            },
            actions: [{isOptimistic: true, action: action2}],
        },
        isAuthorized: true,
        authorizationEventNumber: 1,
    });

    store.applyUpdateEvent({
        type: "Update",
        number: 2,
        actions: [action3],
        backfillAuthorizedTasks: [],
        backfillUnauthorizedTaskIds: [],
        backfillAuthorizedCollections: [],
        backfillUnauthorizedCollectionIds: [],
        referencedAccounts: [],
    });

    expect(getTaskEntryIfExists(store, task.id)).toEqual({
        task: task.apply(action2, getSortableAccount).apply(action3, getSortableAccount),
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
        isAuthorized: true,
        authorizationEventNumber: 1,
    });

    store.commitTaskActionTransaction(context, [action4]);

    expect(getTaskEntryIfExists(store, task.id)).toEqual({
        task: task
            .apply(action2, getSortableAccount)
            .apply(action3, getSortableAccount)
            .apply(action4, getSortableAccount),
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
        isAuthorized: true,
        authorizationEventNumber: 1,
    });

    await TestRpcContextModule.rejectExecution(commitTaskActionTransaction, 1);

    expect(getTaskEntryIfExists(store, task.id)).toEqual({
        task: task.apply(action2, getSortableAccount).apply(action3, getSortableAccount),
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
        isAuthorized: true,
        authorizationEventNumber: 1,
    });

    await TestRpcContextModule.rejectExecution(commitTaskActionTransaction, 0);

    expect(getTaskEntryIfExists(store, task.id)).toEqual({
        task: task.apply(action3, getSortableAccount),
        actions: null,
        optimisticState: null,
        isAuthorized: true,
        authorizationEventNumber: 1,
    });

    expect(displayErrors.length).toEqual(2);
    displayErrors = [];
});

test("regular actions are added to optimistic state when task is not backfilled (rejected)", async () => {
    const store = new TaskClientStore({
        accountStore,
        spaceId: generateId(),
        onDisplayError: handleDisplayError,
    });

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

    store.commitTaskActionTransaction(context, [action2]);

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
        isAuthorized: null,
        authorizationEventNumber: null,
    });

    store.applyUpdateEvent({
        type: "Update",
        number: 2,
        actions: [action3],
        backfillAuthorizedTasks: [],
        backfillUnauthorizedTaskIds: [],
        backfillAuthorizedCollections: [],
        backfillUnauthorizedCollectionIds: [],
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
        isAuthorized: null,
        authorizationEventNumber: null,
    });

    await TestRpcContextModule.rejectExecution(commitTaskActionTransaction, 0);

    expect(getTaskEntryIfExists(store, task.id)).toEqual({
        task: null,
        actions: [action3],
        optimisticState: null,
        isAuthorized: null,
        authorizationEventNumber: null,
    });

    expect(displayErrors.length).toEqual(1);
    displayErrors = [];
});

test("regular actions are added to optimistic state with multiple actions when task is not backfilled (rejected)", async () => {
    const store = new TaskClientStore({
        accountStore,
        spaceId: generateId(),
        onDisplayError: handleDisplayError,
    });

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

    store.commitTaskActionTransaction(context, [action2]);

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
        isAuthorized: null,
        authorizationEventNumber: null,
    });

    store.applyUpdateEvent({
        type: "Update",
        number: 2,
        actions: [action3],
        backfillAuthorizedTasks: [],
        backfillUnauthorizedTaskIds: [],
        backfillAuthorizedCollections: [],
        backfillUnauthorizedCollectionIds: [],
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
        isAuthorized: null,
        authorizationEventNumber: null,
    });

    store.commitTaskActionTransaction(context, [action4]);

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
        isAuthorized: null,
        authorizationEventNumber: null,
    });

    await TestRpcContextModule.rejectExecution(commitTaskActionTransaction, 0);

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
        isAuthorized: null,
        authorizationEventNumber: null,
    });

    await TestRpcContextModule.rejectExecution(commitTaskActionTransaction, 1);

    expect(getTaskEntryIfExists(store, task.id)).toEqual({
        task: null,
        actions: [action3],
        optimisticState: null,
        isAuthorized: null,
        authorizationEventNumber: null,
    });

    expect(displayErrors.length).toEqual(2);
    displayErrors = [];
});

test("regular actions are added to optimistic state with multiple actions that are committed out of order when task is not backfilled (rejected)", async () => {
    const store = new TaskClientStore({
        accountStore,
        spaceId: generateId(),
        onDisplayError: handleDisplayError,
    });

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

    store.commitTaskActionTransaction(context, [action2]);

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
        isAuthorized: null,
        authorizationEventNumber: null,
    });

    store.applyUpdateEvent({
        type: "Update",
        number: 2,
        actions: [action3],
        backfillAuthorizedTasks: [],
        backfillUnauthorizedTaskIds: [],
        backfillAuthorizedCollections: [],
        backfillUnauthorizedCollectionIds: [],
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
        isAuthorized: null,
        authorizationEventNumber: null,
    });

    store.commitTaskActionTransaction(context, [action4]);

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
        isAuthorized: null,
        authorizationEventNumber: null,
    });

    await TestRpcContextModule.rejectExecution(commitTaskActionTransaction, 1);

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
        isAuthorized: null,
        authorizationEventNumber: null,
    });

    await TestRpcContextModule.rejectExecution(commitTaskActionTransaction, 0);

    expect(getTaskEntryIfExists(store, task.id)).toEqual({
        task: null,
        actions: [action3],
        optimisticState: null,
        isAuthorized: null,
        authorizationEventNumber: null,
    });

    expect(displayErrors.length).toEqual(2);
    displayErrors = [];
});

test("regular actions are added to optimistic state when task is created optimistically (rejected)", async () => {
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

    store.commitTaskActionTransaction(context, [action1]);

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
        isAuthorized: true,
        authorizationEventNumber: 0,
    });

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

    store.applyUpdateEvent({
        type: "Update",
        number: 2,
        actions: [action3],
        backfillAuthorizedTasks: [],
        backfillUnauthorizedTaskIds: [],
        backfillAuthorizedCollections: [],
        backfillUnauthorizedCollectionIds: [],
        referencedAccounts: [],
    });

    expect(getTaskEntryIfExists(store, task.id)).toEqual({
        task: task.apply(action2, getSortableAccount).apply(action3, getSortableAccount),
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
        isAuthorized: true,
        authorizationEventNumber: 0,
    });

    await TestRpcContextModule.rejectExecution(commitTaskActionTransaction, 0);

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
        isAuthorized: true,
        authorizationEventNumber: 0,
    });

    await TestRpcContextModule.rejectExecution(commitTaskActionTransaction, 1);

    expect(getTaskEntryIfExists(store, task.id)).toEqual({
        task: null,
        actions: [action3],
        optimisticState: null,
        isAuthorized: true,
        authorizationEventNumber: 0,
    });

    expect(displayErrors.length).toEqual(2);
    displayErrors = [];
});

test("regular actions are added to optimistic state with multiple actions when task is created optimistically (rejected)", async () => {
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

    store.commitTaskActionTransaction(context, [action1]);

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
        isAuthorized: true,
        authorizationEventNumber: 0,
    });

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

    store.applyUpdateEvent({
        type: "Update",
        number: 2,
        actions: [action3],
        backfillAuthorizedTasks: [],
        backfillUnauthorizedTaskIds: [],
        backfillAuthorizedCollections: [],
        backfillUnauthorizedCollectionIds: [],
        referencedAccounts: [],
    });

    expect(getTaskEntryIfExists(store, task.id)).toEqual({
        task: task.apply(action2, getSortableAccount).apply(action3, getSortableAccount),
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
        isAuthorized: true,
        authorizationEventNumber: 0,
    });

    store.commitTaskActionTransaction(context, [action4]);

    expect(getTaskEntryIfExists(store, task.id)).toEqual({
        task: task
            .apply(action2, getSortableAccount)
            .apply(action3, getSortableAccount)
            .apply(action4, getSortableAccount),
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
        isAuthorized: true,
        authorizationEventNumber: 0,
    });

    await TestRpcContextModule.rejectExecution(commitTaskActionTransaction, 0);

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
        isAuthorized: true,
        authorizationEventNumber: 0,
    });

    await TestRpcContextModule.rejectExecution(commitTaskActionTransaction, 1);

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
        isAuthorized: true,
        authorizationEventNumber: 0,
    });

    await TestRpcContextModule.rejectExecution(commitTaskActionTransaction, 2);

    expect(getTaskEntryIfExists(store, task.id)).toEqual({
        task: null,
        actions: [action3],
        optimisticState: null,
        isAuthorized: true,
        authorizationEventNumber: 0,
    });

    expect(displayErrors.length).toEqual(3);
    displayErrors = [];
});

test("regular actions are added to optimistic state with multiple actions that are committed out of order when task is created optimistically (rejected)", async () => {
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

    store.commitTaskActionTransaction(context, [action1]);

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
        isAuthorized: true,
        authorizationEventNumber: 0,
    });

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

    store.applyUpdateEvent({
        type: "Update",
        number: 2,
        actions: [action3],
        backfillAuthorizedTasks: [],
        backfillUnauthorizedTaskIds: [],
        backfillAuthorizedCollections: [],
        backfillUnauthorizedCollectionIds: [],
        referencedAccounts: [],
    });

    expect(getTaskEntryIfExists(store, task.id)).toEqual({
        task: task.apply(action2, getSortableAccount).apply(action3, getSortableAccount),
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
        isAuthorized: true,
        authorizationEventNumber: 0,
    });

    store.commitTaskActionTransaction(context, [action4]);

    expect(getTaskEntryIfExists(store, task.id)).toEqual({
        task: task
            .apply(action2, getSortableAccount)
            .apply(action3, getSortableAccount)
            .apply(action4, getSortableAccount),
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
        isAuthorized: true,
        authorizationEventNumber: 0,
    });

    await TestRpcContextModule.rejectExecution(commitTaskActionTransaction, 0);

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
        isAuthorized: true,
        authorizationEventNumber: 0,
    });

    await TestRpcContextModule.rejectExecution(commitTaskActionTransaction, 2);

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
        isAuthorized: true,
        authorizationEventNumber: 0,
    });

    await TestRpcContextModule.rejectExecution(commitTaskActionTransaction, 1);

    expect(getTaskEntryIfExists(store, task.id)).toEqual({
        task: null,
        actions: [action3],
        optimisticState: null,
        isAuthorized: true,
        authorizationEventNumber: 0,
    });

    expect(displayErrors.length).toEqual(3);
    displayErrors = [];
});

test("three optimistic actions when task is not backfilled (rejected)", async () => {
    const store = new TaskClientStore({
        accountStore,
        spaceId: generateId(),
        onDisplayError: handleDisplayError,
    });

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

    store.commitTaskActionTransaction(context, [action2]);

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
        isAuthorized: null,
        authorizationEventNumber: null,
    });

    store.commitTaskActionTransaction(context, [action3]);

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
        isAuthorized: null,
        authorizationEventNumber: null,
    });

    store.commitTaskActionTransaction(context, [action4]);

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
        isAuthorized: null,
        authorizationEventNumber: null,
    });

    await TestRpcContextModule.rejectExecution(commitTaskActionTransaction, 0);

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
        isAuthorized: null,
        authorizationEventNumber: null,
    });

    await TestRpcContextModule.rejectExecution(commitTaskActionTransaction, 1);

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
        isAuthorized: null,
        authorizationEventNumber: null,
    });

    await TestRpcContextModule.rejectExecution(commitTaskActionTransaction, 2);

    expect(getTaskEntryIfExists(store, task.id)).toEqual({
        task: null,
        actions: [],
        optimisticState: null,
        isAuthorized: null,
        authorizationEventNumber: null,
    });

    expect(displayErrors.length).toEqual(3);
    displayErrors = [];
});

test("backfilling a task when none exists and there are optimistic actions works (rejected)", async () => {
    const store = new TaskClientStore({
        accountStore,
        spaceId: generateId(),
        onDisplayError: handleDisplayError,
    });

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

    store.commitTaskActionTransaction(context, [action2]);

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
        isAuthorized: null,
        authorizationEventNumber: null,
    });

    store.applyUpdateEvent({
        type: "Update",
        number: 2,
        actions: [action3],
        backfillAuthorizedTasks: [],
        backfillUnauthorizedTaskIds: [],
        backfillAuthorizedCollections: [],
        backfillUnauthorizedCollectionIds: [],
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
        isAuthorized: null,
        authorizationEventNumber: null,
    });

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

    expect(getTaskEntryIfExists(store, task.id)).toEqual({
        task: task.apply(action2, getSortableAccount).apply(action3, getSortableAccount),
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
        isAuthorized: true,
        authorizationEventNumber: 1,
    });

    await TestRpcContextModule.rejectLastExecution(commitTaskActionTransaction);

    expect(getTaskEntryIfExists(store, task.id)).toEqual({
        task: task.apply(action3, getSortableAccount),
        actions: null,
        optimisticState: null,
        isAuthorized: true,
        authorizationEventNumber: 1,
    });

    expect(displayErrors.length).toEqual(1);
    displayErrors = [];
});

test("backfilling a task when one is already backfilled and there are optimistic actions works (rejected)", async () => {
    const store = new TaskClientStore({
        accountStore,
        spaceId: generateId(),
        onDisplayError: handleDisplayError,
    });

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
        number: 1,
        actions: [],
        backfillAuthorizedTasks: [task],
        backfillUnauthorizedTaskIds: [],
        backfillAuthorizedCollections: [],
        backfillUnauthorizedCollectionIds: [],
        referencedAccounts: [],
    });

    expect(getTaskEntryIfExists(store, task.id)).toEqual({
        task,
        actions: null,
        optimisticState: null,
        isAuthorized: true,
        authorizationEventNumber: 1,
    });

    store.commitTaskActionTransaction(context, [action2]);

    expect(getTaskEntryIfExists(store, task.id)).toEqual({
        task: task.apply(action2, getSortableAccount),
        actions: null,
        optimisticState: {
            original: {
                task,
                actions: null,
            },
            actions: [{isOptimistic: true, action: action2}],
        },
        isAuthorized: true,
        authorizationEventNumber: 1,
    });

    store.applyUpdateEvent({
        type: "Update",
        number: 2,
        actions: [],
        backfillAuthorizedTasks: [task.apply(action3, getSortableAccount)],
        backfillUnauthorizedTaskIds: [],
        backfillAuthorizedCollections: [],
        backfillUnauthorizedCollectionIds: [],
        referencedAccounts: [],
    });

    expect(getTaskEntryIfExists(store, task.id)).toEqual({
        task: task.apply(action2, getSortableAccount).apply(action3, getSortableAccount),
        actions: null,
        optimisticState: {
            original: {
                task: task.apply(action3, getSortableAccount),
                actions: null,
            },
            actions: [{isOptimistic: true, action: action2}],
        },
        isAuthorized: true,
        authorizationEventNumber: 2,
    });

    await TestRpcContextModule.rejectLastExecution(commitTaskActionTransaction);

    expect(getTaskEntryIfExists(store, task.id)).toEqual({
        task: task.apply(action3, getSortableAccount),
        actions: null,
        optimisticState: null,
        isAuthorized: true,
        authorizationEventNumber: 2,
    });

    expect(displayErrors.length).toEqual(1);
    displayErrors = [];
});

test("backfilling a task when there are optimistic actions but no previously backfilled task works (rejected)", async () => {
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
        number: 2,
        actions: [action3],
        backfillAuthorizedTasks: [],
        backfillUnauthorizedTaskIds: [],
        backfillAuthorizedCollections: [],
        backfillUnauthorizedCollectionIds: [],
        referencedAccounts: [],
    });

    expect(getTaskEntryIfExists(store, task.id)).toEqual({
        task: null,
        actions: [action3],
        optimisticState: null,
        isAuthorized: null,
        authorizationEventNumber: null,
    });

    store.commitTaskActionTransaction(context, [action1]);

    expect(getTaskEntryIfExists(store, task.id)).toEqual({
        task: task.apply(action3, getSortableAccount),
        actions: null,
        optimisticState: {
            original: {
                task: null,
                actions: [action3],
            },
            actions: [{isOptimistic: true, action: action1}],
        },
        isAuthorized: true,
        authorizationEventNumber: 0,
    });

    store.commitTaskActionTransaction(context, [action2]);

    expect(getTaskEntryIfExists(store, task.id)).toEqual({
        task: task.apply(action3, getSortableAccount).apply(action2, getSortableAccount),
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
        isAuthorized: true,
        authorizationEventNumber: 0,
    });

    store.applyUpdateEvent({
        type: "Update",
        number: 2,
        actions: [],
        backfillAuthorizedTasks: [task.apply(action4, getSortableAccount)],
        backfillUnauthorizedTaskIds: [],
        backfillAuthorizedCollections: [],
        backfillUnauthorizedCollectionIds: [],
        referencedAccounts: [],
    });

    expect(getTaskEntryIfExists(store, task.id)).toEqual({
        task: task
            .apply(action4, getSortableAccount)
            .apply(action3, getSortableAccount)
            .apply(action2, getSortableAccount),
        actions: null,
        optimisticState: {
            original: {
                task: task.apply(action4, getSortableAccount).apply(action3, getSortableAccount),
                actions: null,
            },
            actions: [
                {isOptimistic: true, action: action1},
                {isOptimistic: true, action: action2},
            ],
        },
        isAuthorized: true,
        authorizationEventNumber: 2,
    });

    await TestRpcContextModule.rejectExecution(commitTaskActionTransaction, 0);

    expect(getTaskEntryIfExists(store, task.id)).toEqual({
        task: task
            .apply(action4, getSortableAccount)
            .apply(action3, getSortableAccount)
            .apply(action2, getSortableAccount),
        actions: null,
        optimisticState: {
            original: {
                task: task.apply(action4, getSortableAccount).apply(action3, getSortableAccount),
                actions: null,
            },
            actions: [{isOptimistic: true, action: action2}],
        },
        isAuthorized: true,
        authorizationEventNumber: 2,
    });

    await TestRpcContextModule.rejectExecution(commitTaskActionTransaction, 1);

    expect(getTaskEntryIfExists(store, task.id)).toEqual({
        task: task.apply(action4, getSortableAccount).apply(action3, getSortableAccount),
        actions: null,
        optimisticState: null,
        isAuthorized: true,
        authorizationEventNumber: 2,
    });

    expect(displayErrors.length).toEqual(2);
    displayErrors = [];
});

test("create task applied after optimistic updates", async () => {
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

    store.commitTaskActionTransaction(context, [action2]);

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
        isAuthorized: null,
        authorizationEventNumber: null,
    });

    store.applyUpdateEvent({
        type: "Update",
        number: 1,
        actions: [action1],
        backfillAuthorizedTasks: [],
        backfillUnauthorizedTaskIds: [],
        backfillAuthorizedCollections: [],
        backfillUnauthorizedCollectionIds: [],
        referencedAccounts: [account1],
    });

    expect(getTaskEntryIfExists(store, task.id)).toEqual({
        task: task.apply(action2, getSortableAccount),
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
        isAuthorized: true,
        authorizationEventNumber: 1,
    });

    store.commitTaskActionTransaction(context, [action3]);

    expect(getTaskEntryIfExists(store, task.id)).toEqual({
        task: task.apply(action2, getSortableAccount).apply(action3, getSortableAccount),
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
        isAuthorized: true,
        authorizationEventNumber: 1,
    });

    await TestRpcContextModule.resolveExecution(commitTaskActionTransaction, 0, {
        extraActions: [],
        referencedAccounts: [],
    });

    expect(getTaskEntryIfExists(store, task.id)).toEqual({
        task: task.apply(action2, getSortableAccount).apply(action3, getSortableAccount),
        actions: null,
        optimisticState: {
            original: {
                task: task.apply(action2, getSortableAccount),
                actions: null,
            },
            actions: [{isOptimistic: true, action: action3}],
        },
        isAuthorized: true,
        authorizationEventNumber: 1,
    });

    await TestRpcContextModule.resolveExecution(commitTaskActionTransaction, 1, {
        extraActions: [],
        referencedAccounts: [],
    });

    expect(getTaskEntryIfExists(store, task.id)).toEqual({
        task: task.apply(action2, getSortableAccount).apply(action3, getSortableAccount),
        actions: null,
        optimisticState: null,
        isAuthorized: true,
        authorizationEventNumber: 1,
    });
});

test("create task applied after optimistic updates that are resolved out of order", async () => {
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

    store.commitTaskActionTransaction(context, [action2]);

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
        isAuthorized: null,
        authorizationEventNumber: null,
    });

    store.applyUpdateEvent({
        type: "Update",
        number: 1,
        actions: [action1],
        backfillAuthorizedTasks: [],
        backfillUnauthorizedTaskIds: [],
        backfillAuthorizedCollections: [],
        backfillUnauthorizedCollectionIds: [],
        referencedAccounts: [account1],
    });

    expect(getTaskEntryIfExists(store, task.id)).toEqual({
        task: task.apply(action2, getSortableAccount),
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
        isAuthorized: true,
        authorizationEventNumber: 1,
    });

    store.commitTaskActionTransaction(context, [action3]);

    expect(getTaskEntryIfExists(store, task.id)).toEqual({
        task: task.apply(action2, getSortableAccount).apply(action3, getSortableAccount),
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
        isAuthorized: true,
        authorizationEventNumber: 1,
    });

    await TestRpcContextModule.resolveExecution(commitTaskActionTransaction, 1, {
        extraActions: [],
        referencedAccounts: [],
    });

    expect(getTaskEntryIfExists(store, task.id)).toEqual({
        task: task.apply(action2, getSortableAccount).apply(action3, getSortableAccount),
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
        isAuthorized: true,
        authorizationEventNumber: 1,
    });

    await TestRpcContextModule.resolveExecution(commitTaskActionTransaction, 0, {
        extraActions: [],
        referencedAccounts: [],
    });

    expect(getTaskEntryIfExists(store, task.id)).toEqual({
        task: task.apply(action2, getSortableAccount).apply(action3, getSortableAccount),
        actions: null,
        optimisticState: null,
        isAuthorized: true,
        authorizationEventNumber: 1,
    });
});

test("create task applied after optimistic updates (rejected)", async () => {
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

    store.commitTaskActionTransaction(context, [action2]);

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
        isAuthorized: null,
        authorizationEventNumber: null,
    });

    store.applyUpdateEvent({
        type: "Update",
        number: 1,
        actions: [action1],
        backfillAuthorizedTasks: [],
        backfillUnauthorizedTaskIds: [],
        backfillAuthorizedCollections: [],
        backfillUnauthorizedCollectionIds: [],
        referencedAccounts: [account1],
    });

    expect(getTaskEntryIfExists(store, task.id)).toEqual({
        task: task.apply(action2, getSortableAccount),
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
        isAuthorized: true,
        authorizationEventNumber: 1,
    });

    store.commitTaskActionTransaction(context, [action3]);

    expect(getTaskEntryIfExists(store, task.id)).toEqual({
        task: task.apply(action2, getSortableAccount).apply(action3, getSortableAccount),
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
        isAuthorized: true,
        authorizationEventNumber: 1,
    });

    await TestRpcContextModule.rejectExecution(commitTaskActionTransaction, 0);

    expect(getTaskEntryIfExists(store, task.id)).toEqual({
        task: task.apply(action3, getSortableAccount),
        actions: null,
        optimisticState: {
            original: {
                task: task,
                actions: null,
            },
            actions: [{isOptimistic: true, action: action3}],
        },
        isAuthorized: true,
        authorizationEventNumber: 1,
    });

    await TestRpcContextModule.rejectExecution(commitTaskActionTransaction, 1);

    expect(getTaskEntryIfExists(store, task.id)).toEqual({
        task: task,
        actions: null,
        optimisticState: null,
        isAuthorized: true,
        authorizationEventNumber: 1,
    });

    expect(displayErrors.length).toEqual(2);
    displayErrors = [];
});

test("create task applied after optimistic updates that are resolved out of order (rejected)", async () => {
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

    store.commitTaskActionTransaction(context, [action2]);

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
        isAuthorized: null,
        authorizationEventNumber: null,
    });

    store.applyUpdateEvent({
        type: "Update",
        number: 1,
        actions: [action1],
        backfillAuthorizedTasks: [],
        backfillUnauthorizedTaskIds: [],
        backfillAuthorizedCollections: [],
        backfillUnauthorizedCollectionIds: [],
        referencedAccounts: [account1],
    });

    expect(getTaskEntryIfExists(store, task.id)).toEqual({
        task: task.apply(action2, getSortableAccount),
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
        isAuthorized: true,
        authorizationEventNumber: 1,
    });

    store.commitTaskActionTransaction(context, [action3]);

    expect(getTaskEntryIfExists(store, task.id)).toEqual({
        task: task.apply(action2, getSortableAccount).apply(action3, getSortableAccount),
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
        isAuthorized: true,
        authorizationEventNumber: 1,
    });

    await TestRpcContextModule.rejectExecution(commitTaskActionTransaction, 1);

    expect(getTaskEntryIfExists(store, task.id)).toEqual({
        task: task.apply(action2, getSortableAccount),
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
        isAuthorized: true,
        authorizationEventNumber: 1,
    });

    await TestRpcContextModule.rejectExecution(commitTaskActionTransaction, 0);

    expect(getTaskEntryIfExists(store, task.id)).toEqual({
        task: task,
        actions: null,
        optimisticState: null,
        isAuthorized: true,
        authorizationEventNumber: 1,
    });

    expect(displayErrors.length).toEqual(2);
    displayErrors = [];
});
