import {TaskClientStore} from "~/client/tasks/internal/store/task_client_store.js";
import {AccountModel} from "~/shared/accounts/account_model.js";
import {waitMacrotask} from "~/shared/helpers/async/wait_macrotask.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {initialOrderKey} from "~/shared/helpers/sort/order_key.js";
import {generateId} from "~/shared/id/id.js";
import {SpaceId} from "~/shared/id/types/id_types.js";
import {testTaskActionPermutations} from "~/shared/tasks/test_helpers/test_task_action_permutations.js";

const spaceId = generateId<SpaceId>();
let eventNumber = 1;
const store = new TaskClientStore({spaceId});

const account1 = new AccountModel({
    id: generateId(),
    name: "Test Account 1",
    createdTime: new Date(),
});

const account2 = new AccountModel({
    id: generateId(),
    name: "Test Account 2",
    createdTime: new Date(),
});

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
        // Task should exist. `WeakRef`s aren't garbage collected until the end of the
        // current JavaScript job (synchronous code and promise reactions).
        const task = assertExists(store.getTaskIfExistsForTest(taskId));

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
            notepadPagePositions: new Map(task.rawData.positionByAccountIdAndNotepadPageId),
            status: task.getStatus(),
            assignee: task.getAssignee(),
            assigneeStatus: task.getAssigneeStatus(),
            assigneeActivePosition: task.getAssigneeActivePosition(),
            title: task.getTitle(),
            dueDate: task.getDueDate(),
            priority: task.getPriority(),
        };
    },
    getTaskCollection: collectionId => {
        // Collection should exist. `WeakRef`s aren't garbage collected until the end
        // of the current JavaScript job (synchronous code and promise reactions).
        const collection = assertExists(store.getCollectionIfExistsForTest(collectionId));

        return {
            createdTime: collection.getCreatedTime(),
            isDeleted: collection.isDeleted(),
            name: collection.getName(),
            accessPolicy: collection.getAccessPolicy(),
        };
    },
});

test("the store empties out after a garbage collection", async () => {
    // We need multiple garbage collections to fully clean out the store. I'm not
    // sure why V8 needs this.
    await waitMacrotask();
    global.gc!();
    await waitMacrotask();
    global.gc!();
    await waitMacrotask();
    global.gc!();
    await waitMacrotask();
    global.gc!();
    await waitMacrotask();
    global.gc!();

    expect(store.getTaskCountForTest()).toEqual(0);
    expect(store.getCollectionCountForTest()).toEqual(0);
});
