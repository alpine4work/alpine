import {getAccountClientStoreForClient} from "~/client/accounts/account_client_store_context_provider.js";
import {TaskClientStore} from "~/client/tasks/task_client_store.js";
import {AccountModel} from "~/shared/accounts/account_model.js";
import {InternalError} from "~/shared/error/error.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {initialOrderKey} from "~/shared/helpers/sort/order_key.js";
import {generateId} from "~/shared/id/id.js";
import {SpaceId, TaskCollectionId, TaskId} from "~/shared/id/types/id_types.js";
import {testTaskActionPermutations} from "~/shared/tasks/test_helpers/test_task_action_permutations.js";

const accountStore = getAccountClientStoreForClient();

const spaceId = generateId<SpaceId>();
let eventNumber = 1;

let store: TaskClientStore;
let retainedTaskIds = new Set<TaskId>();
let retainedCollectionIds = new Set<TaskCollectionId>();
let errors: Array<unknown> = [];

const handleError = ({error}: {error: unknown}) => {
    errors.push(error);
};

beforeEach(() => {
    import.meta.jest.useFakeTimers();

    store = new TaskClientStore({
        accountStore,
        spaceId,
        onError: handleError,
    });

    // Auto-retain tasks and collections that are updated until the end of the test.
    store.subscribeToBatchUpdate(({taskEntryUpdateById, updatedCollectionIds}) => {
        for (const taskId of taskEntryUpdateById.keys()) {
            if (retainedTaskIds.has(taskId)) continue;
            retainedTaskIds.add(taskId);

            store.getInternalForTest().retainTaskEntryStore(taskId);
        }

        for (const collectionId of updatedCollectionIds) {
            if (retainedCollectionIds.has(collectionId)) continue;
            retainedCollectionIds.add(collectionId);

            store.getInternalForTest().retainCollectionEntryStore(collectionId);
        }
    });
});

afterEach(() => {
    import.meta.jest.runAllTimers();

    const previousErrors = errors;
    errors = [];

    if (previousErrors.length > 0) {
        throw InternalError.from(previousErrors[0]!, "Received error");
    }

    const previousRetainedTaskIds = retainedTaskIds;
    retainedTaskIds = new Set();
    for (const taskId of previousRetainedTaskIds) {
        store.getInternalForTest().releaseTaskEntryStore(taskId);
    }

    const previousRetainedCollectionIds = retainedCollectionIds;
    retainedCollectionIds = new Set();
    for (const collectionId of previousRetainedCollectionIds) {
        store.getInternalForTest().releaseCollectionEntryStore(collectionId);
    }

    assert(store.getTaskCountForTest() === 0, "Expected all tasks to be released");
    assert(store.getCollectionCountForTest() === 0, "Expected all collections to be released");
});

const account1 = new AccountModel({
    id: generateId(),
    name: "Test Account 1",
    nameVersion: 0,
    createdTime: new Date(),
    version: 0,
});

const account2 = new AccountModel({
    id: generateId(),
    name: "Test Account 2",
    nameVersion: 0,
    createdTime: new Date(),
    version: 0,
});

// Make sure we hold a reference to the account stores for the entire test.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const account1Store = accountStore.getAccountStore(account1);
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const account2Store = accountStore.getAccountStore(account2);

testTaskActionPermutations({
    account1,
    account2,
    applyTaskAction: action => {
        store.applyUpdateEvent({
            type: "Update",
            number: eventNumber++,
            actions: [action],
            backfillAuthorizedTasks: [],
            backfillUnauthorizedTaskIds: [],
            backfillAuthorizedCollections: [],
            backfillUnauthorizedCollectionIds: [],
            referencedAccounts: [],
        });
    },
    getTask: taskId => {
        // Task should exist. We auto-retain tasks in our store.
        const task = assertExists(store.getTaskEntryStoreIfExists(taskId)?.getSnapshot()?.task);

        const taskStatus = task.getStatus();
        const taskAssignee = task.getAssignee();

        return {
            creatorId: task.getCreator().accountId,
            createdTime: task.getCreatedTime(),
            isDeleted: task.isDeleted(),
            parent: task.getParent(),
            addedChildTaskCount: task.rawData.addedChildTaskCount,
            removedChildTaskCount: task.rawData.removedChildTaskCount,
            addedClosedChildTaskCount: task.rawData.addedClosedChildTaskCount,
            removedClosedChildTaskCount: task.rawData.removedClosedChildTaskCount,
            collections: task.getCollections(),
            collectionPositions: new Map(
                task
                    .getCollections()
                    .getArray()
                    .map(({collectionId, version}) => [
                        collectionId,
                        task.rawData.positionByCollectionId.get(collectionId) ?? {
                            orderTime: version,
                            orderKey: initialOrderKey,
                        },
                    ]),
            ),
            notepadPagePositions: new Map(task.rawData.positionByAccountIdAndNotepadPageId),
            status:
                taskStatus.type === "Closed"
                    ? {
                          type: "Closed",
                          closerId: taskStatus.closer.accountId,
                          closedTime: taskStatus.closedTime,
                      }
                    : taskStatus,
            assignee: taskAssignee
                ? {
                      assigneeId: taskAssignee.assignee.accountId,
                      assignerId: taskAssignee.assigner.accountId,
                      assignedTime: taskAssignee.assignedTime,
                  }
                : null,
            assigneeStatus: task.getAssigneeStatus(),
            assigneeActivePosition: task.getAssigneeActivePosition(),
            title: task.getTitle().raw,
            dueDate: task.getDueDate(),
            priority: task.getPriority(),
        };
    },
    getTaskCollection: collectionId => {
        // Task should exist. We auto-retain collections in our store.
        const collection = assertExists(
            store.getCollectionEntryStoreIfExists(collectionId)?.getSnapshot()?.collection,
        );

        return {
            createdTime: collection.getCreatedTime(),
            isDeleted: collection.isDeleted(),
            name: collection.getName(),
            accessPolicy: collection.getAccessPolicy(),
        };
    },
});
