import fs from "fs";
import {updateOurAccountName} from "~/server/accounts/update_our_account_name.js";
import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {createTestSession} from "~/server/dynamo/test_helpers/create_test_session.js";
import {createTestSpace} from "~/server/dynamo/test_helpers/create_test_space.js";
import {getAccount} from "~/server/spaces/get_account.js";
import {spacesInjection} from "~/server/spaces/spaces_injection.js";
import {
    getTaskCollectionIndexDocIfExistsForTest,
    getTaskIndexDocIfExistsForTest,
    indexTaskActionTransactionAssumingItsCommittedForTest,
} from "~/server/tasks/data/task_index.js";
import {
    getTaskIndexDocAssigneePosition,
    isTaskIndexDocDeleted,
} from "~/server/tasks/data/task_index_doc.js";
import {tasksInjection} from "~/server/tasks/data/tasks_injection.js";
import {NotFoundError} from "~/shared/error/error.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {initialOrderKey} from "~/shared/helpers/sort/order_key.js";
import {
    TaskCollectionTestInterface,
    TaskTestInterface,
    testTaskActionPermutations,
} from "~/shared/tasks/test_helpers/test_task_action_permutations.js";

const context = createTestContext({
    shouldStartOpensearch: true,
    spacesInjection,
    tasksInjection,
});
const space = createTestSpace(context);
const session1 = createTestSession(context, space);
const session2 = createTestSession(context, space);

import.meta.jest.setTimeout(1000 * 30);

beforeAll(() => {
    const shardStatusPath = assertExists(process.env.TEST_SHARD_STATUS_FILE);
    const currentTime = new Date();

    try {
        fs.utimesSync(shardStatusPath, currentTime, currentTime);
    } catch {
        const descriptor = fs.openSync(shardStatusPath, "a");
        fs.closeSync(descriptor);
    }
});

testTaskActionPermutations({
    // This test takes a ridiculously long time to run given it needs to talk to
    // OpenSearch. Only run 15% of the test permutations. Our client-side
    // implementation will run all the tests for coverage.
    percent: 0.15,
    partitionNumber: parseInt(process.env.TEST_SHARD_INDEX ?? "0", 10) + 1,
    partitionCount: parseInt(process.env.TEST_TOTAL_SHARDS ?? "1", 10),
    account1: session1.account,
    account2: session2.account,
    applyTaskAction: async (action, next) => {
        let hasCalledNext = false;

        // We need to update the account name in DynamoDB first before we can index the
        // action.
        if (action.type === "UpdateAccountName") {
            const account = await getAccount(
                context.systemAction(space.id),
                space.id,
                action.accountId,
                {consistency: "Strong"},
            );

            if (account.initialData.nameVersion === action.accountNameVersion) {
                assert(account.initialData.name === action.accountName);
            } else if (account.initialData.nameVersion < action.accountNameVersion) {
                await updateOurAccountName(
                    context
                        .action(action.accountId === session2.accountId ? session2 : session1)
                        .clone({
                            tasksInjection: context.tasksInjection.cloneForTest({
                                // NOTE(calebmer, 2025-08-18): Match behavior of test from before the
                                // `TasksInjectionContextModule` refactor.
                                internalGetUpdateOurAccountNameTaskTransactionEntries: () => [],
                            }),
                        }),
                    action.accountName,
                    {nameVersionForTest: action.accountNameVersion},
                );
            }
        }

        await indexTaskActionTransactionAssumingItsCommittedForTest(
            context.systemAction(space.id),
            space.id,
            null,
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
            isDeleted: isTaskIndexDocDeleted(task),
            parent: task.parent.taskId.value
                ? {taskId: task.parent.taskId.value, position: task.parent.rawPosition.value}
                : null,
            addedChildTaskCount: task.addedChildTaskCount,
            removedChildTaskCount: task.removedChildTaskCount,
            addedClosedChildTaskCount: task.addedClosedChildTaskCount,
            removedClosedChildTaskCount: task.removedClosedChildTaskCount,
            accessPolicy: task.accessPolicy?.value ?? null,
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
            status: task.status.value,
            assignee: task.assignee.value,
            assigneeStatus:
                task.status.value.type === "Open" && task.assignee.value
                    ? task.rawAssigneeStatus.value
                    : {type: "Inactive"},
            assigneePosition: getTaskIndexDocAssigneePosition(task),
            title: task.title.raw,
            dueDate: task.dueDate.value,
            priority: task.priority.value,
            layout: task.layout?.value ?? null,
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
            color: collection.color.value,
            accessPolicy: collection.accessPolicy.value,
            defaults: collection.defaults.value,
        };
    },
});
