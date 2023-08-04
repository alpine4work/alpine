import {createTestContext} from "~/server/dynamo/test_helpers/shared/create_test_context.js";
import {createTestSession} from "~/server/dynamo/test_helpers/shared/create_test_session.js";
import {createTestSpace} from "~/server/dynamo/test_helpers/shared/create_test_space.js";
import {OpensearchClient} from "~/server/opensearch/opensearch_client.js";
import {indexTaskSpaceActionTransactionWithoutCommitForTest} from "~/server/tasks/index/index_task_space_action_transaction.js";
import {TaskCollectionIndex} from "~/server/tasks/index/task_collection_index.js";
import {TaskIndex} from "~/server/tasks/index/task_index.js";
import {NotFoundError} from "~/shared/error/error.js";
import {compareHybridLogicalTimes} from "~/shared/helpers/clock/hybrid_logical_clock.js";
import {Lazy} from "~/shared/helpers/control/lazy.js";
import {initialOrderKey} from "~/shared/helpers/sort/order_key.js";
import {
    TaskCollectionTestInterface,
    TaskTestInterface,
    testTaskSpaceActionPermutations,
} from "~/shared/tasks/test_helpers/test_task_space_action_permutations.js";

const context = createTestContext({shouldStartOpensearch: true});
const space = createTestSpace(context);
const session1 = createTestSession(context, space);
const session2 = createTestSession(context, space);

const opensearchClient = new Lazy(() => {
    return new OpensearchClient({
        protocol: "http",
        host: `localhost:${context.getOpensearchLocalPort()}`,
    });
});

import.meta.jest.setTimeout(1000 * 30);

testTaskSpaceActionPermutations({
    partitionNumber: parseInt(process.env.TEST_SHARD_INDEX ?? "0", 10) + 1,
    partitionCount: parseInt(process.env.TEST_TOTAL_SHARDS ?? "1", 10),
    account1: session1.account,
    account2: session2.account,
    applyTaskSpaceAction: async (action, next) => {
        let hasCalledNext = false;

        await indexTaskSpaceActionTransactionWithoutCommitForTest(
            context.systemAction(space.id),
            opensearchClient.get(),
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
        const task = await opensearchClient
            .get()
            .getDocIfExists(context.systemAction(space.id), TaskIndex, space.id, taskId);

        if (!task) throw new NotFoundError("Task not found");

        return {
            creator: task.creator,
            createdTime: task.createdTime,
            isDeleted:
                !!task.rawDeletedTime &&
                (!task.rawUndeletedTime ||
                    compareHybridLogicalTimes(task.rawDeletedTime, task.rawUndeletedTime) > 0),
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
        const collection = await opensearchClient
            .get()
            .getDocIfExists(
                context.systemAction(space.id),
                TaskCollectionIndex,
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
