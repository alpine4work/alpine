import {getAccountRegistry} from "~/client/web/accounts/account_registry_context.js";
import {TaskClientStore} from "~/client/web/tasks/core/task_client_store.js";
import {InternalError} from "~/shared/error/error.js";
import {HybridLogicalClock} from "~/shared/helpers/clock/hybrid_logical_clock.js";
import {unsynchronizedSystemClock} from "~/shared/helpers/clock/unsynchronized_system_clock.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {initialOrderKey} from "~/shared/helpers/sort/order_key.js";
import {generateId} from "~/shared/id/id.js";
import {AccountId, SpaceId, TaskCollectionId, TaskId} from "~/shared/id/types/id_types.js";
import {createTestAccountModel} from "~/shared/spaces/test_helpers/account_model_test_helpers.js";
import {testTaskActionPermutations} from "~/shared/tasks/test_helpers/test_task_action_permutations.js";

const clock = new HybridLogicalClock(unsynchronizedSystemClock);

const spaceId = generateId<SpaceId>();
const currentAccountId = generateId<AccountId>();

const accountRegistry = getAccountRegistry(spaceId);

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
        accountRegistry,
        spaceId,
        currentAccountId,
        onError: handleError,
    });

    // Auto-retain tasks and collections that are updated until the end of the test.
    store.subscribeToBatchUpdate(({taskEntryUpdateById, collectionEntryUpdateById}) => {
        for (const taskId of taskEntryUpdateById.keys()) {
            if (retainedTaskIds.has(taskId)) continue;
            retainedTaskIds.add(taskId);

            store.getInternalForTest().retainTaskEntryStore(taskId);
        }

        for (const collectionId of collectionEntryUpdateById.keys()) {
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
        throw InternalError.from(previousErrors[0], "Received error");
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

const account1 = createTestAccountModel({name: "Test Account 1"});
const account2 = createTestAccountModel({name: "Test Account 2"});

// Make sure we hold a reference to the account stores for the entire test.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const account1Store = accountRegistry.getAccountStore(account1);
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const account2Store = accountRegistry.getAccountStore(account2);

testTaskActionPermutations({
    account1,
    account2,
    applyTaskAction: action => {
        store.applyUpdateEvent({
            type: "Update",
            actions: [action],
            backfillTasks: [],
            backfillCollections: [],
            defaultAuthorizationStateVersion: clock.now(),
            // The server must send an updated `AccountModel` whenever there's an
            // `UpdateAccountName` action. There's a hard assert in our requirement requiring
            // this.
            referencedAccounts:
                action.type === "UpdateAccountName"
                    ? [
                          createTestAccountModel({
                              ...assertExists(
                                  accountRegistry
                                      .weakGetAccountStoreByIdIfExists(action.accountId)
                                      ?.getSnapshot(),
                              ),
                              name: action.accountName,
                              nameVersion: action.accountNameVersion,
                              version: action.accountNameVersion,
                          }),
                      ]
                    : [],
            originClientId: null,
        });
    },
    getTask: taskId => {
        // Task should exist. We auto-retain tasks in our store.
        const task = assertExists(store.getTaskEntrySnapshot(taskId)?.task);

        return {
            creator: task.getCreator(),
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
            status: task.getStatus(),
            assignee: task.getAssignee(),
            assigneeStatus: task.getAssigneeStatus(),
            assigneePosition: task.getAssigneePosition(),
            title: task.getTitle().getRaw(),
            dueDate: task.getDueDate(),
            priority: task.getPriority(),
            layout: task.getLayout(),
        };
    },
    getTaskCollection: collectionId => {
        // Task should exist. We auto-retain collections in our store.
        const collection = assertExists(store.getCollectionEntrySnapshot(collectionId)?.collection);

        return {
            createdTime: collection.getCreatedTime(),
            isDeleted: collection.isDeleted(),
            name: collection.getName(),
            color: collection.getColor(),
            accessPolicy: collection.getAccessPolicy(),
        };
    },
});
