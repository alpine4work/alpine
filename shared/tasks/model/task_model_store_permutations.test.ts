import {AccountModel} from "~/shared/accounts/account_model.js";
import {initialOrderKey} from "~/shared/helpers/sort/order_key.js";
import {generateId} from "~/shared/id/id.js";
import {SpaceId} from "~/shared/id/types/id_types.js";
import {TaskModelStore} from "~/shared/tasks/model/task_model_store.js";
import {testTaskActionPermutations} from "~/shared/tasks/test_helpers/test_task_action_permutations.js";

const spaceId = generateId<SpaceId>();
let eventNumber = 1;
let store = TaskModelStore.new({spaceId});

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
        store = store.applyUpdateEvent({
            type: "Update",
            number: eventNumber++,
            actions: [action],
            backfillAuthorizedTasks: [],
            backfillUnauthorizedTaskIds: [],
            backfillAuthorizedCollections: [],
            backfillUnauthorizedCollectionIds: [],
            referencedAccounts: [],
        });

        const otherStore = store.applyUpdateEvent({
            type: "Update",
            number: eventNumber++,
            actions: [action],
            backfillAuthorizedTasks: [],
            backfillUnauthorizedTaskIds: [],
            backfillAuthorizedCollections: [],
            backfillUnauthorizedCollectionIds: [],
            referencedAccounts: [],
        });

        // Test that if we apply an action twice it's a noop.
        expect(otherStore).toBe(store);
    },
    getTask: taskId => {
        const task = store.getTaskForTest(taskId);

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
        const collection = store.getCollectionForTest(collectionId);

        return {
            createdTime: collection.getCreatedTime(),
            isDeleted: collection.isDeleted(),
            name: collection.getName(),
            accessPolicy: collection.getAccessPolicy(),
        };
    },
});
