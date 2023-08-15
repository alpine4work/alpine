import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {createTestSession} from "~/server/dynamo/test_helpers/create_test_session.js";
import {createTestSpace} from "~/server/dynamo/test_helpers/create_test_space.js";
import {
    getTaskCollectionIndexDocIfExistsForTest,
    getTaskIndexDocIfExistsForTest,
    indexTaskActionTransactionAssumingItsCommitted,
} from "~/server/tasks/data/task_index.js";
import {getTaskIndexDocIsDeleted} from "~/server/tasks/data/task_index_doc.js";
import {NotFoundError} from "~/shared/error/error.js";
import {initialOrderKey} from "~/shared/helpers/sort/order_key.js";
import {
    TaskCollectionTestInterface,
    TaskTestInterface,
    testTaskActionPermutations,
} from "~/shared/tasks/test_helpers/test_task_action_permutations.js";

const context = createTestContext({shouldStartOpensearch: true});
const space = createTestSpace(context);
const session1 = createTestSession(context, space);
const session2 = createTestSession(context, space);

import.meta.jest.setTimeout(1000 * 30);

testTaskActionPermutations({
    partitionNumber: parseInt(process.env.TEST_SHARD_INDEX ?? "0", 10) + 1,
    partitionCount: parseInt(process.env.TEST_TOTAL_SHARDS ?? "1", 10),
    account1: session1.account,
    account2: session2.account,
    applyTaskAction: async (action, next) => {
        let hasCalledNext = false;

        await indexTaskActionTransactionAssumingItsCommitted(
            context.systemAction(space.id),
            space.id,
            [action],
            {
                onRetry: () => {
                    if (!hasCalledNext) {
                        next();
                        hasCalledNext = true;
                    }
                },
            },
        );
    },
    getTask: async (taskId): Promise<TaskTestInterface> => {
        const task = await getTaskIndexDocIfExistsForTest(
            context.systemAction(space.id),
            space.id,
            taskId,
        );

        if (!task) throw new NotFoundError("Task not found");

        return {
            creator: task.creator,
            createdTime: task.createdTime,
            isDeleted: getTaskIndexDocIsDeleted(task),
            parent: task.parent.taskId.value
                ? {taskId: task.parent.taskId.value, position: task.parent.position.value}
                : null,
            addedChildTaskCount: task.addedChildTaskCount,
            removedChildTaskCount: task.removedChildTaskCount,
            addedClosedChildTaskCount: task.addedClosedChildTaskCount,
            removedClosedChildTaskCount: task.removedClosedChildTaskCount,
            collections: task.collections.raw.collections,
            collectionPositions: new Map(
                task.collections.raw.collections.getArray().map(({collectionId, version}) => [
                    collectionId,
                    task.collections.raw.positionById.get(collectionId) ?? {
                        orderTime: version,
                        orderKey: initialOrderKey,
                    },
                ]),
            ),
            notepadPagePositions: new Map(task.notepadPages.raw.positionById),
            status: task.status.value,
            assignee: task.assignee.value,
            assigneeStatus:
                task.status.value.type === "Open" && task.assignee.value
                    ? task.rawAssigneeStatus.value
                    : {type: "Inactive"},
            title: task.title.raw,
            dueDate: task.dueDate.value,
            priority: task.priority.value,
        };
    },
    getTaskCollection: async (collectionId): Promise<TaskCollectionTestInterface> => {
        const collection = await getTaskCollectionIndexDocIfExistsForTest(
            context.systemAction(space.id),
            space.id,
            collectionId,
        );

        if (!collection) throw new NotFoundError("Task collection not found");

        return {
            createdTime: collection.createdTime,
            isDeleted:
                !!collection.rawDeletedTime &&
                (!collection.rawUndeletedTime ||
                    collection.rawDeletedTime > collection.rawUndeletedTime),
            name: collection.name.value,
            accessPolicy: collection.accessPolicy.value,
        };
    },
});
