import {CalendarDate} from "@internationalized/date";
import {addDays} from "date-fns";
import {getSpacesTableForTest} from "~/server/dynamo/spaces_table.js";
import {
    commitTaskSpaceActionTransaction,
    commitTaskSpaceActionTransactionBeforeExecuteTestCheckpoint,
} from "~/server/dynamo/tasks_table.js";
import {createTestContext} from "~/server/dynamo/test_helpers/shared/create_test_context.js";
import {createTestSession} from "~/server/dynamo/test_helpers/shared/create_test_session.js";
import {createTestSpace} from "~/server/dynamo/test_helpers/shared/create_test_space.js";
import {
    FailedPreconditionError,
    InvalidArgumentError,
    NotFoundError,
    PermissionDeniedError,
} from "~/shared/error/error.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {defaultTimeZone} from "~/shared/helpers/date/time_zone.js";
import {assertOrderKey, initialOrderKey} from "~/shared/helpers/sort/order_key.js";
import {generateId} from "~/shared/id/id.js";
import {SpaceId, TaskCollectionId, TaskId} from "~/shared/id/types/id_types.js";
import {TaskCollectionAccessPolicyRegister} from "~/shared/tasks/task_collection_access_policy.js";
import {TaskFilterableTime} from "~/shared/tasks/task_filterable_time.js";
import {generateTaskNotepadPageId} from "~/shared/tasks/task_notepad_page_id.js";
import {TaskSortableAccount} from "~/shared/tasks/task_sortable_account.js";
import {taskTitleTestScenario} from "~/shared/tasks/test_helpers/task_title_test_helpers.js";

const context = createTestContext();
const space = createTestSpace(context);
const session1 = createTestSession(context, space);
const session2 = createTestSession(context, space);
const session3 = createTestSession(context, space);
const otherSpace = createTestSpace(context);
const otherSession = createTestSession(context, otherSpace);

const taskAccount1 = new TaskSortableAccount({
    accountId: session1.accountId,
    workingAccountName: session1.account.name,
});

const taskAccount2 = new TaskSortableAccount({
    accountId: session2.accountId,
    workingAccountName: session2.account.name,
});

const otherTaskAccount = new TaskSortableAccount({
    accountId: otherSession.accountId,
    workingAccountName: otherSession.account.name,
});

let lastTime = Date.now();

// Make sure this function returns a monotonically increasing date to
// avoid flaky errors.
function getCurrentTime() {
    const currentTime = Math.max(Date.now(), lastTime + 1);
    lastTime = currentTime;
    return new Date(currentTime);
}

function getCurrentTaskTime() {
    return new TaskFilterableTime({
        absoluteTime: getCurrentTime(),
        setterTimeZone: defaultTimeZone,
    });
}

function getUnreasonableTime() {
    return addDays(getCurrentTime(), 7);
}

function getUnreasonableTaskTime() {
    return new TaskFilterableTime({
        absoluteTime: getUnreasonableTime(),
        setterTimeZone: defaultTimeZone,
    });
}

let spaceCount = 2;

// We create a new space for some tests for resources that are tied to account
// + space. So tests don't conflict.
async function createSeparateSpace() {
    const SpacesTable = getSpacesTableForTest();

    const spaceId = generateId<SpaceId>();

    const createdTime = new Date();

    await runAllPromises([
        SpacesTable.createItem(context, {
            partitionType: "Space",
            sortRangeType: "Attributes",
            spaceId,
            name: `Space ${spaceCount++}`,
            createdTime,
        }),
        SpacesTable.createItem(context, {
            partitionType: "Space",
            sortRangeType: "Account",
            spaceId,
            accountId: session1.accountId,
            joinedTime: createdTime,
        }),
        SpacesTable.createItem(context, {
            partitionType: "Space",
            sortRangeType: "Account",
            spaceId,
            accountId: session2.accountId,
            joinedTime: createdTime,
        }),
        SpacesTable.createItem(context, {
            partitionType: "Space",
            sortRangeType: "Account",
            spaceId,
            accountId: session3.accountId,
            joinedTime: createdTime,
        }),
    ]);

    return {space: {id: spaceId}};
}

test("can create a task", async () => {
    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            taskId: generateId(),
            taskAction: {
                type: "Create",
                creator: taskAccount1,
                createdTime: getCurrentTaskTime(),
            },
        },
    ]);
});

test("can't create task in space you don't have access to", async () => {
    await expect(
        commitTaskSpaceActionTransaction(context.action(session1), otherSpace.id, [
            {
                type: "UpdateTask",
                taskId: generateId(),
                taskAction: {
                    type: "Create",
                    creator: taskAccount1,
                    createdTime: getCurrentTaskTime(),
                },
            },
        ]),
    ).rejects.toThrow(PermissionDeniedError);
});

test("can't create a task twice", async () => {
    const taskId = generateId<TaskId>();

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            taskId,
            taskAction: {
                type: "Create",
                creator: taskAccount1,
                createdTime: getCurrentTaskTime(),
            },
        },
    ]);

    await expect(
        commitTaskSpaceActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                taskId,
                taskAction: {
                    type: "Create",
                    creator: taskAccount1,
                    createdTime: getCurrentTaskTime(),
                },
            },
        ]),
    ).rejects.toThrow(FailedPreconditionError);
});

test("can't create a task with the wrong account as the creator", async () => {
    await expect(
        commitTaskSpaceActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                taskId: generateId(),
                taskAction: {
                    type: "Create",
                    creator: taskAccount1,
                    createdTime: getUnreasonableTaskTime(),
                },
            },
        ]),
    ).rejects.toThrow(InvalidArgumentError);
});

test("can delete a task", async () => {
    const taskId = generateId<TaskId>();

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            taskId,
            taskAction: {
                type: "Create",
                creator: taskAccount1,
                createdTime: getCurrentTaskTime(),
            },
        },
    ]);

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            taskId,
            taskAction: {
                type: "Delete",
                deletedTime: getCurrentTime(),
            },
        },
    ]);
});

test("can't delete a task that doesn't exist", async () => {
    const taskId = generateId<TaskId>();

    await expect(
        commitTaskSpaceActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                taskId,
                taskAction: {
                    type: "Delete",
                    deletedTime: getCurrentTime(),
                },
            },
        ]),
    ).rejects.toThrow(NotFoundError);
});

test("can't delete a task twice", async () => {
    const taskId = generateId<TaskId>();

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            taskId,
            taskAction: {
                type: "Create",
                creator: taskAccount1,
                createdTime: getCurrentTaskTime(),
            },
        },
    ]);

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            taskId,
            taskAction: {
                type: "Delete",
                deletedTime: getCurrentTime(),
            },
        },
    ]);

    await expect(
        commitTaskSpaceActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                taskId,
                taskAction: {
                    type: "Delete",
                    deletedTime: getCurrentTime(),
                },
            },
        ]),
    ).rejects.toThrow(FailedPreconditionError);
});

test("can't delete a task with the same time as task creation", async () => {
    const taskId = generateId<TaskId>();

    const createdTime = getCurrentTaskTime();

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            taskId,
            taskAction: {
                type: "Create",
                creator: taskAccount1,
                createdTime,
            },
        },
    ]);

    await expect(
        commitTaskSpaceActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                taskId,
                taskAction: {
                    type: "Delete",
                    deletedTime: createdTime.absoluteTime,
                },
            },
        ]),
    ).rejects.toThrow(FailedPreconditionError);
});

test("can't delete a task with a time earlier than task creation", async () => {
    const taskId = generateId<TaskId>();

    const deletedTime = getCurrentTime();

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            taskId,
            taskAction: {
                type: "Create",
                creator: taskAccount1,
                createdTime: getCurrentTaskTime(),
            },
        },
    ]);

    await expect(
        commitTaskSpaceActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                taskId,
                taskAction: {
                    type: "Delete",
                    deletedTime,
                },
            },
        ]),
    ).rejects.toThrow(FailedPreconditionError);
});

test("can't delete a task with an unreasonable time", async () => {
    const taskId = generateId<TaskId>();

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            taskId,
            taskAction: {
                type: "Create",
                creator: taskAccount1,
                createdTime: getCurrentTaskTime(),
            },
        },
    ]);

    await expect(
        commitTaskSpaceActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                taskId,
                taskAction: {
                    type: "Delete",
                    deletedTime: getUnreasonableTime(),
                },
            },
        ]),
    ).rejects.toThrow(InvalidArgumentError);
});

test("can't delete a task that's not yours", async () => {
    const taskId = generateId<TaskId>();

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            taskId,
            taskAction: {
                type: "Create",
                creator: taskAccount1,
                createdTime: getCurrentTaskTime(),
            },
        },
    ]);

    await expect(
        commitTaskSpaceActionTransaction(context.action(session2), space.id, [
            {
                type: "UpdateTask",
                taskId,
                taskAction: {
                    type: "Delete",
                    deletedTime: getCurrentTime(),
                },
            },
        ]),
    ).rejects.toThrow(PermissionDeniedError);
});

test("can delete a task that's in a collection you specifically can edit", async () => {
    const taskId = generateId<TaskId>();
    const collectionId = generateId<TaskCollectionId>();

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTaskCollection",
            collectionId,
            collectionAction: {
                type: "Create",
                creatorId: taskAccount1.accountId,
                createdTime: getCurrentTime(),
                accessPolicy: new TaskCollectionAccessPolicyRegister(
                    {
                        accountGrantById: new Map([
                            [taskAccount1.accountId, {level: "Manage"}],
                            [taskAccount2.accountId, {level: "Edit"}],
                        ]),
                        defaultGrant: null,
                    },
                    getCurrentTime(),
                ),
            },
        },
        {
            type: "UpdateTask",
            taskId,
            taskAction: {
                type: "Create",
                creator: taskAccount1,
                createdTime: getCurrentTaskTime(),
            },
        },
        {
            type: "UpdateTask",
            taskId,
            taskAction: {
                type: "UpdateCollections",
                collectionsAction: {
                    type: "Set",
                    key: collectionId,
                    value: assertOrderKey("a0"),
                    updatedTime: getCurrentTime(),
                },
            },
        },
    ]);

    await commitTaskSpaceActionTransaction(context.action(session2), space.id, [
        {
            type: "UpdateTask",
            taskId,
            taskAction: {
                type: "Delete",
                deletedTime: getCurrentTime(),
            },
        },
    ]);
});

test("can't delete a task that's only in a collection you specifically can view", async () => {
    const taskId = generateId<TaskId>();
    const collectionId = generateId<TaskCollectionId>();

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTaskCollection",
            collectionId,
            collectionAction: {
                type: "Create",
                creatorId: taskAccount1.accountId,
                createdTime: getCurrentTime(),
                accessPolicy: new TaskCollectionAccessPolicyRegister(
                    {
                        accountGrantById: new Map([
                            [taskAccount1.accountId, {level: "Manage"}],
                            [taskAccount2.accountId, {level: "View"}],
                        ]),
                        defaultGrant: null,
                    },
                    getCurrentTime(),
                ),
            },
        },
        {
            type: "UpdateTask",
            taskId,
            taskAction: {
                type: "Create",
                creator: taskAccount1,
                createdTime: getCurrentTaskTime(),
            },
        },
        {
            type: "UpdateTask",
            taskId,
            taskAction: {
                type: "UpdateCollections",
                collectionsAction: {
                    type: "Set",
                    key: collectionId,
                    value: assertOrderKey("a0"),
                    updatedTime: getCurrentTime(),
                },
            },
        },
    ]);

    await expect(
        commitTaskSpaceActionTransaction(context.action(session2), space.id, [
            {
                type: "UpdateTask",
                taskId,
                taskAction: {
                    type: "Delete",
                    deletedTime: getCurrentTime(),
                },
            },
        ]),
    ).rejects.toThrow(PermissionDeniedError);
});

test("can delete a task that's in a collection you can edit by default", async () => {
    const taskId = generateId<TaskId>();
    const collectionId = generateId<TaskCollectionId>();

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTaskCollection",
            collectionId,
            collectionAction: {
                type: "Create",
                creatorId: taskAccount1.accountId,
                createdTime: getCurrentTime(),
                accessPolicy: new TaskCollectionAccessPolicyRegister(
                    {
                        accountGrantById: new Map([[taskAccount1.accountId, {level: "Manage"}]]),
                        defaultGrant: {type: "Space", level: "Edit"},
                    },
                    getCurrentTime(),
                ),
            },
        },
        {
            type: "UpdateTask",
            taskId,
            taskAction: {
                type: "Create",
                creator: taskAccount1,
                createdTime: getCurrentTaskTime(),
            },
        },
        {
            type: "UpdateTask",
            taskId,
            taskAction: {
                type: "UpdateCollections",
                collectionsAction: {
                    type: "Set",
                    key: collectionId,
                    value: assertOrderKey("a0"),
                    updatedTime: getCurrentTime(),
                },
            },
        },
    ]);

    await commitTaskSpaceActionTransaction(context.action(session2), space.id, [
        {
            type: "UpdateTask",
            taskId,
            taskAction: {
                type: "Delete",
                deletedTime: getCurrentTime(),
            },
        },
    ]);
});

test("can't delete a task that's only in a collection you can view by default", async () => {
    const taskId = generateId<TaskId>();
    const collectionId = generateId<TaskCollectionId>();

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTaskCollection",
            collectionId,
            collectionAction: {
                type: "Create",
                creatorId: taskAccount1.accountId,
                createdTime: getCurrentTime(),
                accessPolicy: new TaskCollectionAccessPolicyRegister(
                    {
                        accountGrantById: new Map([[taskAccount1.accountId, {level: "Manage"}]]),
                        defaultGrant: {type: "Space", level: "View"},
                    },
                    getCurrentTime(),
                ),
            },
        },
        {
            type: "UpdateTask",
            taskId,
            taskAction: {
                type: "Create",
                creator: taskAccount1,
                createdTime: getCurrentTaskTime(),
            },
        },
        {
            type: "UpdateTask",
            taskId,
            taskAction: {
                type: "UpdateCollections",
                collectionsAction: {
                    type: "Set",
                    key: collectionId,
                    value: assertOrderKey("a0"),
                    updatedTime: getCurrentTime(),
                },
            },
        },
    ]);

    await expect(
        commitTaskSpaceActionTransaction(context.action(session2), space.id, [
            {
                type: "UpdateTask",
                taskId,
                taskAction: {
                    type: "Delete",
                    deletedTime: getCurrentTime(),
                },
            },
        ]),
    ).rejects.toThrow(PermissionDeniedError);
});

test("can't delete a task that's only in a collection space accounts can edit by default if you're from a different space", async () => {
    const taskId = generateId<TaskId>();
    const collectionId = generateId<TaskCollectionId>();

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTaskCollection",
            collectionId,
            collectionAction: {
                type: "Create",
                creatorId: taskAccount1.accountId,
                createdTime: getCurrentTime(),
                accessPolicy: new TaskCollectionAccessPolicyRegister(
                    {
                        accountGrantById: new Map([[taskAccount1.accountId, {level: "Manage"}]]),
                        defaultGrant: {type: "Space", level: "Edit"},
                    },
                    getCurrentTime(),
                ),
            },
        },
        {
            type: "UpdateTask",
            taskId,
            taskAction: {
                type: "Create",
                creator: taskAccount1,
                createdTime: getCurrentTaskTime(),
            },
        },
        {
            type: "UpdateTask",
            taskId,
            taskAction: {
                type: "UpdateCollections",
                collectionsAction: {
                    type: "Set",
                    key: collectionId,
                    value: assertOrderKey("a0"),
                    updatedTime: getCurrentTime(),
                },
            },
        },
    ]);

    await expect(
        commitTaskSpaceActionTransaction(context.action(otherSession), space.id, [
            {
                type: "UpdateTask",
                taskId,
                taskAction: {
                    type: "Delete",
                    deletedTime: getCurrentTime(),
                },
            },
        ]),
    ).rejects.toThrow(PermissionDeniedError);
});

test("can undelete a task", async () => {
    const taskId = generateId<TaskId>();

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            taskId,
            taskAction: {
                type: "Create",
                creator: taskAccount1,
                createdTime: getCurrentTaskTime(),
            },
        },
    ]);

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            taskId,
            taskAction: {
                type: "Delete",
                deletedTime: getCurrentTime(),
            },
        },
    ]);

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            taskId,
            taskAction: {
                type: "Undelete",
                undeletedTime: getCurrentTime(),
            },
        },
    ]);
});

test("can undelete a task twice if there's another delete", async () => {
    const taskId = generateId<TaskId>();

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            taskId,
            taskAction: {
                type: "Create",
                creator: taskAccount1,
                createdTime: getCurrentTaskTime(),
            },
        },
    ]);

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            taskId,
            taskAction: {
                type: "Delete",
                deletedTime: getCurrentTime(),
            },
        },
    ]);

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            taskId,
            taskAction: {
                type: "Undelete",
                undeletedTime: getCurrentTime(),
            },
        },
    ]);

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            taskId,
            taskAction: {
                type: "Delete",
                deletedTime: getCurrentTime(),
            },
        },
    ]);

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            taskId,
            taskAction: {
                type: "Undelete",
                undeletedTime: getCurrentTime(),
            },
        },
    ]);
});

test("can undelete a task twice if there's another delete in one transaction", async () => {
    const taskId = generateId<TaskId>();

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            taskId,
            taskAction: {
                type: "Create",
                creator: taskAccount1,
                createdTime: getCurrentTaskTime(),
            },
        },
        {
            type: "UpdateTask",
            taskId,
            taskAction: {
                type: "Delete",
                deletedTime: getCurrentTime(),
            },
        },
        {
            type: "UpdateTask",
            taskId,
            taskAction: {
                type: "Undelete",
                undeletedTime: getCurrentTime(),
            },
        },
        {
            type: "UpdateTask",
            taskId,
            taskAction: {
                type: "Delete",
                deletedTime: getCurrentTime(),
            },
        },
        {
            type: "UpdateTask",
            taskId,
            taskAction: {
                type: "Undelete",
                undeletedTime: getCurrentTime(),
            },
        },
    ]);
});

test("can't undelete a task twice", async () => {
    const taskId = generateId<TaskId>();

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            taskId,
            taskAction: {
                type: "Create",
                creator: taskAccount1,
                createdTime: getCurrentTaskTime(),
            },
        },
    ]);

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            taskId,
            taskAction: {
                type: "Delete",
                deletedTime: getCurrentTime(),
            },
        },
    ]);

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            taskId,
            taskAction: {
                type: "Undelete",
                undeletedTime: getCurrentTime(),
            },
        },
    ]);

    await expect(
        commitTaskSpaceActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                taskId,
                taskAction: {
                    type: "Undelete",
                    undeletedTime: getCurrentTime(),
                },
            },
        ]),
    ).rejects.toThrow(FailedPreconditionError);
});

test("can't a task that doesn't exist", async () => {
    const taskId = generateId<TaskId>();

    await expect(
        commitTaskSpaceActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                taskId,
                taskAction: {
                    type: "Undelete",
                    undeletedTime: getCurrentTime(),
                },
            },
        ]),
    ).rejects.toThrow(NotFoundError);
});

test("can't undelete a task with the same time as the deletion time", async () => {
    const taskId = generateId<TaskId>();

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            taskId,
            taskAction: {
                type: "Create",
                creator: taskAccount1,
                createdTime: getCurrentTaskTime(),
            },
        },
    ]);

    const deletedTime = getCurrentTime();

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            taskId,
            taskAction: {
                type: "Delete",
                deletedTime,
            },
        },
    ]);

    await expect(
        commitTaskSpaceActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                taskId,
                taskAction: {
                    type: "Undelete",
                    undeletedTime: deletedTime,
                },
            },
        ]),
    ).rejects.toThrow(FailedPreconditionError);
});

test("can't undelete a task with a time before the deletion time", async () => {
    const taskId = generateId<TaskId>();

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            taskId,
            taskAction: {
                type: "Create",
                creator: taskAccount1,
                createdTime: getCurrentTaskTime(),
            },
        },
    ]);

    const undeletedTime = getCurrentTime();

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            taskId,
            taskAction: {
                type: "Delete",
                deletedTime: getCurrentTime(),
            },
        },
    ]);

    await expect(
        commitTaskSpaceActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                taskId,
                taskAction: {
                    type: "Undelete",
                    undeletedTime,
                },
            },
        ]),
    ).rejects.toThrow(FailedPreconditionError);
});

test("can't undelete a task with an unreasonable time", async () => {
    const taskId = generateId<TaskId>();

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            taskId,
            taskAction: {
                type: "Create",
                creator: taskAccount1,
                createdTime: getCurrentTaskTime(),
            },
        },
    ]);

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            taskId,
            taskAction: {
                type: "Delete",
                deletedTime: getCurrentTime(),
            },
        },
    ]);

    await expect(
        commitTaskSpaceActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                taskId,
                taskAction: {
                    type: "Undelete",
                    undeletedTime: getUnreasonableTime(),
                },
            },
        ]),
    ).rejects.toThrow(InvalidArgumentError);
});

test("can't undelete a task that isn't yours", async () => {
    const taskId = generateId<TaskId>();

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            taskId,
            taskAction: {
                type: "Create",
                creator: taskAccount1,
                createdTime: getCurrentTaskTime(),
            },
        },
    ]);

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            taskId,
            taskAction: {
                type: "Delete",
                deletedTime: getCurrentTime(),
            },
        },
    ]);

    await expect(
        commitTaskSpaceActionTransaction(context.action(session2), space.id, [
            {
                type: "UpdateTask",
                taskId,
                taskAction: {
                    type: "Undelete",
                    undeletedTime: getCurrentTime(),
                },
            },
        ]),
    ).rejects.toThrow(PermissionDeniedError);
});

test("can't undelete a task in a collection you don't have edit access to", async () => {
    const taskId = generateId<TaskId>();
    const collectionId = generateId<TaskCollectionId>();

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTaskCollection",
            collectionId,
            collectionAction: {
                type: "Create",
                creatorId: taskAccount1.accountId,
                createdTime: getCurrentTime(),
                accessPolicy: new TaskCollectionAccessPolicyRegister(
                    {
                        accountGrantById: new Map([[taskAccount1.accountId, {level: "Manage"}]]),
                        defaultGrant: {type: "Space", level: "View"},
                    },
                    getCurrentTime(),
                ),
            },
        },
        {
            type: "UpdateTask",
            taskId,
            taskAction: {
                type: "Create",
                creator: taskAccount1,
                createdTime: getCurrentTaskTime(),
            },
        },
        {
            type: "UpdateTask",
            taskId,
            taskAction: {
                type: "UpdateCollections",
                collectionsAction: {
                    type: "Set",
                    key: collectionId,
                    value: assertOrderKey("a0"),
                    updatedTime: getCurrentTime(),
                },
            },
        },
    ]);

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            taskId,
            taskAction: {
                type: "Delete",
                deletedTime: getCurrentTime(),
            },
        },
    ]);

    await expect(
        commitTaskSpaceActionTransaction(context.action(session2), space.id, [
            {
                type: "UpdateTask",
                taskId,
                taskAction: {
                    type: "Undelete",
                    undeletedTime: getCurrentTime(),
                },
            },
        ]),
    ).rejects.toThrow(PermissionDeniedError);
});

test("can undelete a task in a collection you have edit access to", async () => {
    const taskId = generateId<TaskId>();
    const collectionId = generateId<TaskCollectionId>();

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTaskCollection",
            collectionId,
            collectionAction: {
                type: "Create",
                creatorId: taskAccount1.accountId,
                createdTime: getCurrentTime(),
                accessPolicy: new TaskCollectionAccessPolicyRegister(
                    {
                        accountGrantById: new Map([[taskAccount1.accountId, {level: "Manage"}]]),
                        defaultGrant: {type: "Space", level: "Edit"},
                    },
                    getCurrentTime(),
                ),
            },
        },
        {
            type: "UpdateTask",
            taskId,
            taskAction: {
                type: "Create",
                creator: taskAccount1,
                createdTime: getCurrentTaskTime(),
            },
        },
        {
            type: "UpdateTask",
            taskId,
            taskAction: {
                type: "UpdateCollections",
                collectionsAction: {
                    type: "Set",
                    key: collectionId,
                    value: assertOrderKey("a0"),
                    updatedTime: getCurrentTime(),
                },
            },
        },
    ]);

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            taskId,
            taskAction: {
                type: "Delete",
                deletedTime: getCurrentTime(),
            },
        },
    ]);

    await commitTaskSpaceActionTransaction(context.action(session2), space.id, [
        {
            type: "UpdateTask",
            taskId,
            taskAction: {
                type: "Undelete",
                undeletedTime: getCurrentTime(),
            },
        },
    ]);
});

test("can update a task's title", async () => {
    const taskId = generateId<TaskId>();

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            taskId,
            taskAction: {
                type: "Create",
                creator: taskAccount1,
                createdTime: getCurrentTaskTime(),
            },
        },
    ]);

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            taskId,
            taskAction: {
                type: "UpdateTitle",
                titleUpdate: taskTitleTestScenario.update0,
            },
        },
    ]);

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            taskId,
            taskAction: {
                type: "UpdateTitle",
                titleUpdate: taskTitleTestScenario.update1,
            },
        },
    ]);

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            taskId,
            taskAction: {
                type: "UpdateTitle",
                titleUpdate: taskTitleTestScenario.update2,
            },
        },
    ]);
});

test("can update a task's title in any order", async () => {
    const taskId = generateId<TaskId>();

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            taskId,
            taskAction: {
                type: "Create",
                creator: taskAccount1,
                createdTime: getCurrentTaskTime(),
            },
        },
    ]);

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            taskId,
            taskAction: {
                type: "UpdateTitle",
                titleUpdate: taskTitleTestScenario.update1,
            },
        },
    ]);

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            taskId,
            taskAction: {
                type: "UpdateTitle",
                titleUpdate: taskTitleTestScenario.update2,
            },
        },
    ]);

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            taskId,
            taskAction: {
                type: "UpdateTitle",
                titleUpdate: taskTitleTestScenario.update0,
            },
        },
    ]);
});

test("can't update a task title for a task that doesn't exist", async () => {
    const taskId = generateId<TaskId>();

    await expect(
        commitTaskSpaceActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                taskId,
                taskAction: {
                    type: "UpdateTitle",
                    titleUpdate: taskTitleTestScenario.update0,
                },
            },
        ]),
    ).rejects.toThrow(NotFoundError);
});

test("can't update a deleted task's title", async () => {
    const taskId = generateId<TaskId>();

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            taskId,
            taskAction: {
                type: "Create",
                creator: taskAccount1,
                createdTime: getCurrentTaskTime(),
            },
        },
    ]);

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            taskId,
            taskAction: {
                type: "Delete",
                deletedTime: getCurrentTime(),
            },
        },
    ]);

    await expect(
        commitTaskSpaceActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                taskId,
                taskAction: {
                    type: "UpdateTitle",
                    titleUpdate: taskTitleTestScenario.update0,
                },
            },
        ]),
    ).rejects.toThrow(FailedPreconditionError);
});

test("can't update a task title that's not yours", async () => {
    const taskId = generateId<TaskId>();

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            taskId,
            taskAction: {
                type: "Create",
                creator: taskAccount1,
                createdTime: getCurrentTaskTime(),
            },
        },
    ]);

    await expect(
        commitTaskSpaceActionTransaction(context.action(session2), space.id, [
            {
                type: "UpdateTask",
                taskId,
                taskAction: {
                    type: "UpdateTitle",
                    titleUpdate: taskTitleTestScenario.update0,
                },
            },
        ]),
    ).rejects.toThrow(PermissionDeniedError);
});

test("can update a task's title that's in a collection you can edit", async () => {
    const taskId = generateId<TaskId>();
    const collectionId = generateId<TaskCollectionId>();

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTaskCollection",
            collectionId,
            collectionAction: {
                type: "Create",
                creatorId: taskAccount1.accountId,
                createdTime: getCurrentTime(),
                accessPolicy: new TaskCollectionAccessPolicyRegister(
                    {
                        accountGrantById: new Map([
                            [taskAccount1.accountId, {level: "Manage"}],
                            [taskAccount2.accountId, {level: "Edit"}],
                        ]),
                        defaultGrant: null,
                    },
                    getCurrentTime(),
                ),
            },
        },
        {
            type: "UpdateTask",
            taskId,
            taskAction: {
                type: "Create",
                creator: taskAccount1,
                createdTime: getCurrentTaskTime(),
            },
        },
        {
            type: "UpdateTask",
            taskId,
            taskAction: {
                type: "UpdateCollections",
                collectionsAction: {
                    type: "Set",
                    key: collectionId,
                    value: assertOrderKey("a0"),
                    updatedTime: getCurrentTime(),
                },
            },
        },
    ]);

    await commitTaskSpaceActionTransaction(context.action(session2), space.id, [
        {
            type: "UpdateTask",
            taskId,
            taskAction: {
                type: "UpdateTitle",
                titleUpdate: taskTitleTestScenario.update0,
            },
        },
    ]);
});

test("can't update a task's title that's only in a collection you specifically can view", async () => {
    const taskId = generateId<TaskId>();
    const collectionId = generateId<TaskCollectionId>();

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTaskCollection",
            collectionId,
            collectionAction: {
                type: "Create",
                creatorId: taskAccount1.accountId,
                createdTime: getCurrentTime(),
                accessPolicy: new TaskCollectionAccessPolicyRegister(
                    {
                        accountGrantById: new Map([
                            [taskAccount1.accountId, {level: "Manage"}],
                            [taskAccount2.accountId, {level: "View"}],
                        ]),
                        defaultGrant: null,
                    },
                    getCurrentTime(),
                ),
            },
        },
        {
            type: "UpdateTask",
            taskId,
            taskAction: {
                type: "Create",
                creator: taskAccount1,
                createdTime: getCurrentTaskTime(),
            },
        },
        {
            type: "UpdateTask",
            taskId,
            taskAction: {
                type: "UpdateCollections",
                collectionsAction: {
                    type: "Set",
                    key: collectionId,
                    value: assertOrderKey("a0"),
                    updatedTime: getCurrentTime(),
                },
            },
        },
    ]);

    await expect(
        commitTaskSpaceActionTransaction(context.action(session2), space.id, [
            {
                type: "UpdateTask",
                taskId,
                taskAction: {
                    type: "UpdateTitle",
                    titleUpdate: taskTitleTestScenario.update0,
                },
            },
        ]),
    ).rejects.toThrow(PermissionDeniedError);
});

test("can add a task to a collection", async () => {
    const taskId = generateId<TaskId>();
    const collectionId = generateId<TaskCollectionId>();

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTaskCollection",
            collectionId,
            collectionAction: {
                type: "Create",
                creatorId: taskAccount1.accountId,
                createdTime: getCurrentTime(),
                accessPolicy: new TaskCollectionAccessPolicyRegister(
                    {
                        accountGrantById: new Map([[taskAccount1.accountId, {level: "Manage"}]]),
                        defaultGrant: null,
                    },
                    getCurrentTime(),
                ),
            },
        },
        {
            type: "UpdateTask",
            taskId,
            taskAction: {
                type: "Create",
                creator: taskAccount1,
                createdTime: getCurrentTaskTime(),
            },
        },
    ]);

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            taskId,
            taskAction: {
                type: "UpdateCollections",
                collectionsAction: {
                    type: "Set",
                    key: collectionId,
                    value: assertOrderKey("a0"),
                    updatedTime: getCurrentTime(),
                },
            },
        },
    ]);
});

test("can't add a task you don't have access to to a collection", async () => {
    const taskId = generateId<TaskId>();
    const collectionId = generateId<TaskCollectionId>();

    await commitTaskSpaceActionTransaction(context.action(session2), space.id, [
        {
            type: "UpdateTaskCollection",
            collectionId,
            collectionAction: {
                type: "Create",
                creatorId: taskAccount2.accountId,
                createdTime: getCurrentTime(),
                accessPolicy: new TaskCollectionAccessPolicyRegister(
                    {
                        accountGrantById: new Map([[taskAccount2.accountId, {level: "Manage"}]]),
                        defaultGrant: null,
                    },
                    getCurrentTime(),
                ),
            },
        },
    ]);

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            taskId,
            taskAction: {
                type: "Create",
                creator: taskAccount1,
                createdTime: getCurrentTaskTime(),
            },
        },
    ]);

    await expect(
        commitTaskSpaceActionTransaction(context.action(session2), space.id, [
            {
                type: "UpdateTask",
                taskId,
                taskAction: {
                    type: "UpdateCollections",
                    collectionsAction: {
                        type: "Set",
                        key: collectionId,
                        value: assertOrderKey("a0"),
                        updatedTime: getCurrentTime(),
                    },
                },
            },
        ]),
    ).rejects.toThrow(PermissionDeniedError);
});

test("can't add a task to a collection you don't have access to", async () => {
    const taskId = generateId<TaskId>();
    const collectionId = generateId<TaskCollectionId>();

    await commitTaskSpaceActionTransaction(context.action(session2), space.id, [
        {
            type: "UpdateTaskCollection",
            collectionId,
            collectionAction: {
                type: "Create",
                creatorId: taskAccount2.accountId,
                createdTime: getCurrentTime(),
                accessPolicy: new TaskCollectionAccessPolicyRegister(
                    {
                        accountGrantById: new Map([[taskAccount2.accountId, {level: "Manage"}]]),
                        defaultGrant: null,
                    },
                    getCurrentTime(),
                ),
            },
        },
    ]);

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            taskId,
            taskAction: {
                type: "Create",
                creator: taskAccount1,
                createdTime: getCurrentTaskTime(),
            },
        },
    ]);

    await expect(
        commitTaskSpaceActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                taskId,
                taskAction: {
                    type: "UpdateCollections",
                    collectionsAction: {
                        type: "Set",
                        key: collectionId,
                        value: assertOrderKey("a0"),
                        updatedTime: getCurrentTime(),
                    },
                },
            },
        ]),
    ).rejects.toThrow(PermissionDeniedError);
});

test("can add a task that's not yours to a collection", async () => {
    const taskId = generateId<TaskId>();
    const collectionId1 = generateId<TaskCollectionId>();
    const collectionId2 = generateId<TaskCollectionId>();

    await commitTaskSpaceActionTransaction(context.action(session2), space.id, [
        {
            type: "UpdateTaskCollection",
            collectionId: collectionId1,
            collectionAction: {
                type: "Create",
                creatorId: taskAccount2.accountId,
                createdTime: getCurrentTime(),
                accessPolicy: new TaskCollectionAccessPolicyRegister(
                    {
                        accountGrantById: new Map([[taskAccount2.accountId, {level: "Manage"}]]),
                        defaultGrant: null,
                    },
                    getCurrentTime(),
                ),
            },
        },
    ]);

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTaskCollection",
            collectionId: collectionId2,
            collectionAction: {
                type: "Create",
                creatorId: taskAccount1.accountId,
                createdTime: getCurrentTime(),
                accessPolicy: new TaskCollectionAccessPolicyRegister(
                    {
                        accountGrantById: new Map([
                            [taskAccount1.accountId, {level: "Manage"}],
                            [taskAccount2.accountId, {level: "Edit"}],
                        ]),
                        defaultGrant: null,
                    },
                    getCurrentTime(),
                ),
            },
        },
        {
            type: "UpdateTask",
            taskId,
            taskAction: {
                type: "Create",
                creator: taskAccount1,
                createdTime: getCurrentTaskTime(),
            },
        },
        {
            type: "UpdateTask",
            taskId,
            taskAction: {
                type: "UpdateCollections",
                collectionsAction: {
                    type: "Set",
                    key: collectionId2,
                    value: assertOrderKey("a0"),
                    updatedTime: getCurrentTime(),
                },
            },
        },
    ]);

    await commitTaskSpaceActionTransaction(context.action(session2), space.id, [
        {
            type: "UpdateTask",
            taskId,
            taskAction: {
                type: "UpdateCollections",
                collectionsAction: {
                    type: "Set",
                    key: collectionId1,
                    value: assertOrderKey("a0"),
                    updatedTime: getCurrentTime(),
                },
            },
        },
    ]);
});

test("can't add a task to a collection you don't have edit access to", async () => {
    const taskId = generateId<TaskId>();
    const collectionId1 = generateId<TaskCollectionId>();
    const collectionId2 = generateId<TaskCollectionId>();

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTaskCollection",
            collectionId: collectionId1,
            collectionAction: {
                type: "Create",
                creatorId: taskAccount1.accountId,
                createdTime: getCurrentTime(),
                accessPolicy: new TaskCollectionAccessPolicyRegister(
                    {
                        accountGrantById: new Map([
                            [taskAccount1.accountId, {level: "Manage"}],
                            [taskAccount2.accountId, {level: "View"}],
                        ]),
                        defaultGrant: null,
                    },
                    getCurrentTime(),
                ),
            },
        },
        {
            type: "UpdateTaskCollection",
            collectionId: collectionId2,
            collectionAction: {
                type: "Create",
                creatorId: taskAccount1.accountId,
                createdTime: getCurrentTime(),
                accessPolicy: new TaskCollectionAccessPolicyRegister(
                    {
                        accountGrantById: new Map([
                            [taskAccount1.accountId, {level: "Manage"}],
                            [taskAccount2.accountId, {level: "Edit"}],
                        ]),
                        defaultGrant: null,
                    },
                    getCurrentTime(),
                ),
            },
        },
        {
            type: "UpdateTask",
            taskId,
            taskAction: {
                type: "Create",
                creator: taskAccount1,
                createdTime: getCurrentTaskTime(),
            },
        },
        {
            type: "UpdateTask",
            taskId,
            taskAction: {
                type: "UpdateCollections",
                collectionsAction: {
                    type: "Set",
                    key: collectionId2,
                    value: assertOrderKey("a0"),
                    updatedTime: getCurrentTime(),
                },
            },
        },
    ]);

    await expect(
        commitTaskSpaceActionTransaction(context.action(session2), space.id, [
            {
                type: "UpdateTask",
                taskId,
                taskAction: {
                    type: "UpdateCollections",
                    collectionsAction: {
                        type: "Set",
                        key: collectionId1,
                        value: assertOrderKey("a0"),
                        updatedTime: getCurrentTime(),
                    },
                },
            },
        ]),
    ).rejects.toThrow(PermissionDeniedError);

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            taskId,
            taskAction: {
                type: "UpdateCollections",
                collectionsAction: {
                    type: "Set",
                    key: collectionId1,
                    value: assertOrderKey("a0"),
                    updatedTime: getCurrentTime(),
                },
            },
        },
    ]);
});

test("can't add a task to a collection with an unreasonable update time", async () => {
    const taskId = generateId<TaskId>();
    const collectionId = generateId<TaskCollectionId>();

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTaskCollection",
            collectionId,
            collectionAction: {
                type: "Create",
                creatorId: taskAccount1.accountId,
                createdTime: getCurrentTime(),
                accessPolicy: new TaskCollectionAccessPolicyRegister(
                    {
                        accountGrantById: new Map([[taskAccount1.accountId, {level: "Manage"}]]),
                        defaultGrant: null,
                    },
                    getCurrentTime(),
                ),
            },
        },
        {
            type: "UpdateTask",
            taskId,
            taskAction: {
                type: "Create",
                creator: taskAccount1,
                createdTime: getCurrentTaskTime(),
            },
        },
    ]);

    await expect(
        commitTaskSpaceActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                taskId,
                taskAction: {
                    type: "UpdateCollections",
                    collectionsAction: {
                        type: "Set",
                        key: collectionId,
                        value: assertOrderKey("a0"),
                        updatedTime: getUnreasonableTime(),
                    },
                },
            },
        ]),
    ).rejects.toThrow(InvalidArgumentError);
});

test("can delete a task from a collection", async () => {
    const taskId = generateId<TaskId>();
    const collectionId = generateId<TaskCollectionId>();

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTaskCollection",
            collectionId,
            collectionAction: {
                type: "Create",
                creatorId: taskAccount1.accountId,
                createdTime: getCurrentTime(),
                accessPolicy: new TaskCollectionAccessPolicyRegister(
                    {
                        accountGrantById: new Map([[taskAccount1.accountId, {level: "Manage"}]]),
                        defaultGrant: null,
                    },
                    getCurrentTime(),
                ),
            },
        },
        {
            type: "UpdateTask",
            taskId,
            taskAction: {
                type: "Create",
                creator: taskAccount1,
                createdTime: getCurrentTaskTime(),
            },
        },
        {
            type: "UpdateTask",
            taskId,
            taskAction: {
                type: "UpdateCollections",
                collectionsAction: {
                    type: "Set",
                    key: collectionId,
                    value: assertOrderKey("a0"),
                    updatedTime: getCurrentTime(),
                },
            },
        },
    ]);

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            taskId,
            taskAction: {
                type: "UpdateCollections",
                collectionsAction: {
                    type: "Delete",
                    key: collectionId,
                    deletedTime: getCurrentTime(),
                },
            },
        },
    ]);
});

test("can't delete a task from a collection with an unreasonable time", async () => {
    const taskId = generateId<TaskId>();
    const collectionId = generateId<TaskCollectionId>();

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTaskCollection",
            collectionId,
            collectionAction: {
                type: "Create",
                creatorId: taskAccount1.accountId,
                createdTime: getCurrentTime(),
                accessPolicy: new TaskCollectionAccessPolicyRegister(
                    {
                        accountGrantById: new Map([[taskAccount1.accountId, {level: "Manage"}]]),
                        defaultGrant: null,
                    },
                    getCurrentTime(),
                ),
            },
        },
        {
            type: "UpdateTask",
            taskId,
            taskAction: {
                type: "Create",
                creator: taskAccount1,
                createdTime: getCurrentTaskTime(),
            },
        },
        {
            type: "UpdateTask",
            taskId,
            taskAction: {
                type: "UpdateCollections",
                collectionsAction: {
                    type: "Set",
                    key: collectionId,
                    value: assertOrderKey("a0"),
                    updatedTime: getCurrentTime(),
                },
            },
        },
    ]);

    await expect(
        commitTaskSpaceActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                taskId,
                taskAction: {
                    type: "UpdateCollections",
                    collectionsAction: {
                        type: "Delete",
                        key: collectionId,
                        deletedTime: getUnreasonableTime(),
                    },
                },
            },
        ]),
    ).rejects.toThrow(InvalidArgumentError);
});

test("can't delete a task from a collection you don't have access to", async () => {
    const taskId = generateId<TaskId>();
    const collectionId = generateId<TaskCollectionId>();

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTaskCollection",
            collectionId,
            collectionAction: {
                type: "Create",
                creatorId: taskAccount1.accountId,
                createdTime: getCurrentTime(),
                accessPolicy: new TaskCollectionAccessPolicyRegister(
                    {
                        accountGrantById: new Map([[taskAccount1.accountId, {level: "Manage"}]]),
                        defaultGrant: null,
                    },
                    getCurrentTime(),
                ),
            },
        },
        {
            type: "UpdateTask",
            taskId,
            taskAction: {
                type: "Create",
                creator: taskAccount1,
                createdTime: getCurrentTaskTime(),
            },
        },
        {
            type: "UpdateTask",
            taskId,
            taskAction: {
                type: "UpdateCollections",
                collectionsAction: {
                    type: "Set",
                    key: collectionId,
                    value: assertOrderKey("a0"),
                    updatedTime: getCurrentTime(),
                },
            },
        },
    ]);

    await expect(
        commitTaskSpaceActionTransaction(context.action(session2), space.id, [
            {
                type: "UpdateTask",
                taskId,
                taskAction: {
                    type: "UpdateCollections",
                    collectionsAction: {
                        type: "Delete",
                        key: collectionId,
                        deletedTime: getCurrentTime(),
                    },
                },
            },
        ]),
    ).rejects.toThrow(PermissionDeniedError);
});

test("can't delete a task from a collection you don't have edit access to", async () => {
    const taskId = generateId<TaskId>();
    const collectionId = generateId<TaskCollectionId>();

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTaskCollection",
            collectionId,
            collectionAction: {
                type: "Create",
                creatorId: taskAccount1.accountId,
                createdTime: getCurrentTime(),
                accessPolicy: new TaskCollectionAccessPolicyRegister(
                    {
                        accountGrantById: new Map([
                            [taskAccount1.accountId, {level: "Manage"}],
                            [taskAccount2.accountId, {level: "View"}],
                        ]),
                        defaultGrant: null,
                    },
                    getCurrentTime(),
                ),
            },
        },
        {
            type: "UpdateTask",
            taskId,
            taskAction: {
                type: "Create",
                creator: taskAccount1,
                createdTime: getCurrentTaskTime(),
            },
        },
        {
            type: "UpdateTask",
            taskId,
            taskAction: {
                type: "UpdateCollections",
                collectionsAction: {
                    type: "Set",
                    key: collectionId,
                    value: assertOrderKey("a0"),
                    updatedTime: getCurrentTime(),
                },
            },
        },
    ]);

    await expect(
        commitTaskSpaceActionTransaction(context.action(session2), space.id, [
            {
                type: "UpdateTask",
                taskId,
                taskAction: {
                    type: "UpdateCollections",
                    collectionsAction: {
                        type: "Delete",
                        key: collectionId,
                        deletedTime: getCurrentTime(),
                    },
                },
            },
        ]),
    ).rejects.toThrow(PermissionDeniedError);
});

test("can delete a task from a collection you have edit access to", async () => {
    const taskId = generateId<TaskId>();
    const collectionId = generateId<TaskCollectionId>();

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTaskCollection",
            collectionId,
            collectionAction: {
                type: "Create",
                creatorId: taskAccount1.accountId,
                createdTime: getCurrentTime(),
                accessPolicy: new TaskCollectionAccessPolicyRegister(
                    {
                        accountGrantById: new Map([
                            [taskAccount1.accountId, {level: "Manage"}],
                            [taskAccount2.accountId, {level: "Edit"}],
                        ]),
                        defaultGrant: null,
                    },
                    getCurrentTime(),
                ),
            },
        },
        {
            type: "UpdateTask",
            taskId,
            taskAction: {
                type: "Create",
                creator: taskAccount1,
                createdTime: getCurrentTaskTime(),
            },
        },
        {
            type: "UpdateTask",
            taskId,
            taskAction: {
                type: "UpdateCollections",
                collectionsAction: {
                    type: "Set",
                    key: collectionId,
                    value: assertOrderKey("a0"),
                    updatedTime: getCurrentTime(),
                },
            },
        },
    ]);

    await commitTaskSpaceActionTransaction(context.action(session2), space.id, [
        {
            type: "UpdateTask",
            taskId,
            taskAction: {
                type: "UpdateCollections",
                collectionsAction: {
                    type: "Delete",
                    key: collectionId,
                    deletedTime: getCurrentTime(),
                },
            },
        },
    ]);
});

test("can create a collection", async () => {
    const collectionId = generateId<TaskCollectionId>();

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTaskCollection",
            collectionId,
            collectionAction: {
                type: "Create",
                creatorId: taskAccount1.accountId,
                createdTime: getCurrentTime(),
                accessPolicy: new TaskCollectionAccessPolicyRegister(
                    {
                        accountGrantById: new Map([[taskAccount1.accountId, {level: "Manage"}]]),
                        defaultGrant: null,
                    },
                    getCurrentTime(),
                ),
            },
        },
    ]);
});

test("can't create a collection twice", async () => {
    const collectionId = generateId<TaskCollectionId>();

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTaskCollection",
            collectionId,
            collectionAction: {
                type: "Create",
                creatorId: taskAccount1.accountId,
                createdTime: getCurrentTime(),
                accessPolicy: new TaskCollectionAccessPolicyRegister(
                    {
                        accountGrantById: new Map([[taskAccount1.accountId, {level: "Manage"}]]),
                        defaultGrant: null,
                    },
                    getCurrentTime(),
                ),
            },
        },
    ]);

    await expect(
        commitTaskSpaceActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTaskCollection",
                collectionId,
                collectionAction: {
                    type: "Create",
                    creatorId: taskAccount1.accountId,
                    createdTime: getCurrentTime(),
                    accessPolicy: new TaskCollectionAccessPolicyRegister(
                        {
                            accountGrantById: new Map([
                                [taskAccount1.accountId, {level: "Manage"}],
                            ]),
                            defaultGrant: null,
                        },
                        getCurrentTime(),
                    ),
                },
            },
        ]),
    ).rejects.toThrow(FailedPreconditionError);
});

test("can't create a collection with the wrong creator", async () => {
    const collectionId = generateId<TaskCollectionId>();

    await expect(
        commitTaskSpaceActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTaskCollection",
                collectionId,
                collectionAction: {
                    type: "Create",
                    creatorId: taskAccount2.accountId,
                    createdTime: getCurrentTime(),
                    accessPolicy: new TaskCollectionAccessPolicyRegister(
                        {
                            accountGrantById: new Map([
                                [taskAccount2.accountId, {level: "Manage"}],
                            ]),
                            defaultGrant: null,
                        },
                        getCurrentTime(),
                    ),
                },
            },
        ]),
    ).rejects.toThrow(PermissionDeniedError);
});

test("can't create a collection with an unreasonable created time", async () => {
    const collectionId = generateId<TaskCollectionId>();

    await expect(
        commitTaskSpaceActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTaskCollection",
                collectionId,
                collectionAction: {
                    type: "Create",
                    creatorId: taskAccount1.accountId,
                    createdTime: getUnreasonableTime(),
                    accessPolicy: new TaskCollectionAccessPolicyRegister(
                        {
                            accountGrantById: new Map([
                                [taskAccount1.accountId, {level: "Manage"}],
                            ]),
                            defaultGrant: null,
                        },
                        getCurrentTime(),
                    ),
                },
            },
        ]),
    ).rejects.toThrow(InvalidArgumentError);
});

test("can't create a collection without our account as a manager", async () => {
    const collectionId = generateId<TaskCollectionId>();

    await expect(
        commitTaskSpaceActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTaskCollection",
                collectionId,
                collectionAction: {
                    type: "Create",
                    creatorId: taskAccount1.accountId,
                    createdTime: getCurrentTime(),
                    accessPolicy: new TaskCollectionAccessPolicyRegister(
                        {
                            accountGrantById: new Map([]),
                            defaultGrant: null,
                        },
                        getCurrentTime(),
                    ),
                },
            },
        ]),
    ).rejects.toThrow(InvalidArgumentError);
});

test("can delete a collection", async () => {
    const collectionId = generateId<TaskCollectionId>();

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTaskCollection",
            collectionId,
            collectionAction: {
                type: "Create",
                creatorId: taskAccount1.accountId,
                createdTime: getCurrentTime(),
                accessPolicy: new TaskCollectionAccessPolicyRegister(
                    {
                        accountGrantById: new Map([[taskAccount1.accountId, {level: "Manage"}]]),
                        defaultGrant: null,
                    },
                    getCurrentTime(),
                ),
            },
        },
    ]);

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTaskCollection",
            collectionId,
            collectionAction: {
                type: "Delete",
                deletedTime: getCurrentTime(),
            },
        },
    ]);
});

test("can't delete a collection that doesn't exist", async () => {
    const collectionId = generateId<TaskCollectionId>();

    await expect(
        commitTaskSpaceActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTaskCollection",
                collectionId,
                collectionAction: {
                    type: "Delete",
                    deletedTime: getCurrentTime(),
                },
            },
        ]),
    ).rejects.toThrow(NotFoundError);
});

test("can't delete a collection twice", async () => {
    const collectionId = generateId<TaskCollectionId>();

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTaskCollection",
            collectionId,
            collectionAction: {
                type: "Create",
                creatorId: taskAccount1.accountId,
                createdTime: getCurrentTime(),
                accessPolicy: new TaskCollectionAccessPolicyRegister(
                    {
                        accountGrantById: new Map([[taskAccount1.accountId, {level: "Manage"}]]),
                        defaultGrant: null,
                    },
                    getCurrentTime(),
                ),
            },
        },
    ]);

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTaskCollection",
            collectionId,
            collectionAction: {
                type: "Delete",
                deletedTime: getCurrentTime(),
            },
        },
    ]);

    await expect(
        commitTaskSpaceActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTaskCollection",
                collectionId,
                collectionAction: {
                    type: "Delete",
                    deletedTime: getCurrentTime(),
                },
            },
        ]),
    ).rejects.toThrow(FailedPreconditionError);
});

test("can't delete a collection with the created time", async () => {
    const collectionId = generateId<TaskCollectionId>();

    const createdTime = getCurrentTime();

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTaskCollection",
            collectionId,
            collectionAction: {
                type: "Create",
                creatorId: taskAccount1.accountId,
                createdTime,
                accessPolicy: new TaskCollectionAccessPolicyRegister(
                    {
                        accountGrantById: new Map([[taskAccount1.accountId, {level: "Manage"}]]),
                        defaultGrant: null,
                    },
                    getCurrentTime(),
                ),
            },
        },
    ]);

    await expect(
        commitTaskSpaceActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTaskCollection",
                collectionId,
                collectionAction: {
                    type: "Delete",
                    deletedTime: createdTime,
                },
            },
        ]),
    ).rejects.toThrow(FailedPreconditionError);
});

test("can't delete a collection with a time before the created time", async () => {
    const collectionId = generateId<TaskCollectionId>();

    const deletedTime = getCurrentTime();

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTaskCollection",
            collectionId,
            collectionAction: {
                type: "Create",
                creatorId: taskAccount1.accountId,
                createdTime: getCurrentTime(),
                accessPolicy: new TaskCollectionAccessPolicyRegister(
                    {
                        accountGrantById: new Map([[taskAccount1.accountId, {level: "Manage"}]]),
                        defaultGrant: null,
                    },
                    getCurrentTime(),
                ),
            },
        },
    ]);

    await expect(
        commitTaskSpaceActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTaskCollection",
                collectionId,
                collectionAction: {
                    type: "Delete",
                    deletedTime,
                },
            },
        ]),
    ).rejects.toThrow(FailedPreconditionError);
});

test("can't delete a collection with an unreasonable deleted time", async () => {
    const collectionId = generateId<TaskCollectionId>();

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTaskCollection",
            collectionId,
            collectionAction: {
                type: "Create",
                creatorId: taskAccount1.accountId,
                createdTime: getCurrentTime(),
                accessPolicy: new TaskCollectionAccessPolicyRegister(
                    {
                        accountGrantById: new Map([[taskAccount1.accountId, {level: "Manage"}]]),
                        defaultGrant: null,
                    },
                    getCurrentTime(),
                ),
            },
        },
    ]);

    await expect(
        commitTaskSpaceActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTaskCollection",
                collectionId,
                collectionAction: {
                    type: "Delete",
                    deletedTime: getUnreasonableTime(),
                },
            },
        ]),
    ).rejects.toThrow(InvalidArgumentError);
});

test("can't delete a collection you don't have access to", async () => {
    const collectionId = generateId<TaskCollectionId>();

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTaskCollection",
            collectionId,
            collectionAction: {
                type: "Create",
                creatorId: taskAccount1.accountId,
                createdTime: getCurrentTime(),
                accessPolicy: new TaskCollectionAccessPolicyRegister(
                    {
                        accountGrantById: new Map([[taskAccount1.accountId, {level: "Manage"}]]),
                        defaultGrant: null,
                    },
                    getCurrentTime(),
                ),
            },
        },
    ]);

    await expect(
        commitTaskSpaceActionTransaction(context.action(session2), space.id, [
            {
                type: "UpdateTaskCollection",
                collectionId,
                collectionAction: {
                    type: "Delete",
                    deletedTime: getCurrentTime(),
                },
            },
        ]),
    ).rejects.toThrow(PermissionDeniedError);
});

test("can't delete a collection you only have access to as an editor", async () => {
    const collectionId = generateId<TaskCollectionId>();

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTaskCollection",
            collectionId,
            collectionAction: {
                type: "Create",
                creatorId: taskAccount1.accountId,
                createdTime: getCurrentTime(),
                accessPolicy: new TaskCollectionAccessPolicyRegister(
                    {
                        accountGrantById: new Map([
                            [taskAccount1.accountId, {level: "Manage"}],
                            [taskAccount2.accountId, {level: "Edit"}],
                        ]),
                        defaultGrant: null,
                    },
                    getCurrentTime(),
                ),
            },
        },
    ]);

    await expect(
        commitTaskSpaceActionTransaction(context.action(session2), space.id, [
            {
                type: "UpdateTaskCollection",
                collectionId,
                collectionAction: {
                    type: "Delete",
                    deletedTime: getCurrentTime(),
                },
            },
        ]),
    ).rejects.toThrow(PermissionDeniedError);
});

test("can delete a collection you have access to as a manager", async () => {
    const collectionId = generateId<TaskCollectionId>();

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTaskCollection",
            collectionId,
            collectionAction: {
                type: "Create",
                creatorId: taskAccount1.accountId,
                createdTime: getCurrentTime(),
                accessPolicy: new TaskCollectionAccessPolicyRegister(
                    {
                        accountGrantById: new Map([
                            [taskAccount1.accountId, {level: "Manage"}],
                            [taskAccount2.accountId, {level: "Manage"}],
                        ]),
                        defaultGrant: null,
                    },
                    getCurrentTime(),
                ),
            },
        },
    ]);

    await commitTaskSpaceActionTransaction(context.action(session2), space.id, [
        {
            type: "UpdateTaskCollection",
            collectionId,
            collectionAction: {
                type: "Delete",
                deletedTime: getCurrentTime(),
            },
        },
    ]);
});

test("can undelete a collection", async () => {
    const collectionId = generateId<TaskCollectionId>();

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTaskCollection",
            collectionId,
            collectionAction: {
                type: "Create",
                creatorId: taskAccount1.accountId,
                createdTime: getCurrentTime(),
                accessPolicy: new TaskCollectionAccessPolicyRegister(
                    {
                        accountGrantById: new Map([[taskAccount1.accountId, {level: "Manage"}]]),
                        defaultGrant: null,
                    },
                    getCurrentTime(),
                ),
            },
        },
    ]);

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTaskCollection",
            collectionId,
            collectionAction: {
                type: "Delete",
                deletedTime: getCurrentTime(),
            },
        },
    ]);

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTaskCollection",
            collectionId,
            collectionAction: {
                type: "Undelete",
                undeletedTime: getCurrentTime(),
            },
        },
    ]);
});

test("can't undelete a collection that doesn't exist", async () => {
    const collectionId = generateId<TaskCollectionId>();

    await expect(
        commitTaskSpaceActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTaskCollection",
                collectionId,
                collectionAction: {
                    type: "Undelete",
                    undeletedTime: getCurrentTime(),
                },
            },
        ]),
    ).rejects.toThrow(NotFoundError);
});

test("can undelete a collection twice if there's another delete", async () => {
    const collectionId = generateId<TaskCollectionId>();

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTaskCollection",
            collectionId,
            collectionAction: {
                type: "Create",
                creatorId: taskAccount1.accountId,
                createdTime: getCurrentTime(),
                accessPolicy: new TaskCollectionAccessPolicyRegister(
                    {
                        accountGrantById: new Map([[taskAccount1.accountId, {level: "Manage"}]]),
                        defaultGrant: null,
                    },
                    getCurrentTime(),
                ),
            },
        },
    ]);

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTaskCollection",
            collectionId,
            collectionAction: {
                type: "Delete",
                deletedTime: getCurrentTime(),
            },
        },
    ]);

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTaskCollection",
            collectionId,
            collectionAction: {
                type: "Undelete",
                undeletedTime: getCurrentTime(),
            },
        },
    ]);

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTaskCollection",
            collectionId,
            collectionAction: {
                type: "Delete",
                deletedTime: getCurrentTime(),
            },
        },
    ]);

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTaskCollection",
            collectionId,
            collectionAction: {
                type: "Undelete",
                undeletedTime: getCurrentTime(),
            },
        },
    ]);
});

test("can undelete a collection twice if there's another delete in one transaction", async () => {
    const collectionId = generateId<TaskCollectionId>();

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTaskCollection",
            collectionId,
            collectionAction: {
                type: "Create",
                creatorId: taskAccount1.accountId,
                createdTime: getCurrentTime(),
                accessPolicy: new TaskCollectionAccessPolicyRegister(
                    {
                        accountGrantById: new Map([[taskAccount1.accountId, {level: "Manage"}]]),
                        defaultGrant: null,
                    },
                    getCurrentTime(),
                ),
            },
        },
        {
            type: "UpdateTaskCollection",
            collectionId,
            collectionAction: {
                type: "Delete",
                deletedTime: getCurrentTime(),
            },
        },
        {
            type: "UpdateTaskCollection",
            collectionId,
            collectionAction: {
                type: "Undelete",
                undeletedTime: getCurrentTime(),
            },
        },
        {
            type: "UpdateTaskCollection",
            collectionId,
            collectionAction: {
                type: "Delete",
                deletedTime: getCurrentTime(),
            },
        },
        {
            type: "UpdateTaskCollection",
            collectionId,
            collectionAction: {
                type: "Undelete",
                undeletedTime: getCurrentTime(),
            },
        },
    ]);
});

test("can't undelete a collection twice", async () => {
    const collectionId = generateId<TaskCollectionId>();

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTaskCollection",
            collectionId,
            collectionAction: {
                type: "Create",
                creatorId: taskAccount1.accountId,
                createdTime: getCurrentTime(),
                accessPolicy: new TaskCollectionAccessPolicyRegister(
                    {
                        accountGrantById: new Map([[taskAccount1.accountId, {level: "Manage"}]]),
                        defaultGrant: null,
                    },
                    getCurrentTime(),
                ),
            },
        },
    ]);

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTaskCollection",
            collectionId,
            collectionAction: {
                type: "Delete",
                deletedTime: getCurrentTime(),
            },
        },
    ]);

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTaskCollection",
            collectionId,
            collectionAction: {
                type: "Undelete",
                undeletedTime: getCurrentTime(),
            },
        },
    ]);

    await expect(
        commitTaskSpaceActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTaskCollection",
                collectionId,
                collectionAction: {
                    type: "Undelete",
                    undeletedTime: getCurrentTime(),
                },
            },
        ]),
    ).rejects.toThrow(FailedPreconditionError);
});

test("can't undelete a collection with the deleted time", async () => {
    const collectionId = generateId<TaskCollectionId>();

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTaskCollection",
            collectionId,
            collectionAction: {
                type: "Create",
                creatorId: taskAccount1.accountId,
                createdTime: getCurrentTime(),
                accessPolicy: new TaskCollectionAccessPolicyRegister(
                    {
                        accountGrantById: new Map([[taskAccount1.accountId, {level: "Manage"}]]),
                        defaultGrant: null,
                    },
                    getCurrentTime(),
                ),
            },
        },
    ]);

    const deletedTime = getCurrentTime();

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTaskCollection",
            collectionId,
            collectionAction: {
                type: "Delete",
                deletedTime,
            },
        },
    ]);

    await expect(
        commitTaskSpaceActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTaskCollection",
                collectionId,
                collectionAction: {
                    type: "Undelete",
                    undeletedTime: deletedTime,
                },
            },
        ]),
    ).rejects.toThrow(FailedPreconditionError);
});

test("can't undelete a collection a time before the deleted time", async () => {
    const collectionId = generateId<TaskCollectionId>();

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTaskCollection",
            collectionId,
            collectionAction: {
                type: "Create",
                creatorId: taskAccount1.accountId,
                createdTime: getCurrentTime(),
                accessPolicy: new TaskCollectionAccessPolicyRegister(
                    {
                        accountGrantById: new Map([[taskAccount1.accountId, {level: "Manage"}]]),
                        defaultGrant: null,
                    },
                    getCurrentTime(),
                ),
            },
        },
    ]);

    const undeletedTime = getCurrentTime();

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTaskCollection",
            collectionId,
            collectionAction: {
                type: "Delete",
                deletedTime: getCurrentTime(),
            },
        },
    ]);

    await expect(
        commitTaskSpaceActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTaskCollection",
                collectionId,
                collectionAction: {
                    type: "Undelete",
                    undeletedTime,
                },
            },
        ]),
    ).rejects.toThrow(FailedPreconditionError);
});

test("can't undelete a collection with an unreasonable time", async () => {
    const collectionId = generateId<TaskCollectionId>();

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTaskCollection",
            collectionId,
            collectionAction: {
                type: "Create",
                creatorId: taskAccount1.accountId,
                createdTime: getCurrentTime(),
                accessPolicy: new TaskCollectionAccessPolicyRegister(
                    {
                        accountGrantById: new Map([[taskAccount1.accountId, {level: "Manage"}]]),
                        defaultGrant: null,
                    },
                    getCurrentTime(),
                ),
            },
        },
    ]);

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTaskCollection",
            collectionId,
            collectionAction: {
                type: "Delete",
                deletedTime: getCurrentTime(),
            },
        },
    ]);

    await expect(
        commitTaskSpaceActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTaskCollection",
                collectionId,
                collectionAction: {
                    type: "Undelete",
                    undeletedTime: getUnreasonableTime(),
                },
            },
        ]),
    ).rejects.toThrow(InvalidArgumentError);
});

test("can't undelete a collection you don't have access to", async () => {
    const collectionId = generateId<TaskCollectionId>();

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTaskCollection",
            collectionId,
            collectionAction: {
                type: "Create",
                creatorId: taskAccount1.accountId,
                createdTime: getCurrentTime(),
                accessPolicy: new TaskCollectionAccessPolicyRegister(
                    {
                        accountGrantById: new Map([[taskAccount1.accountId, {level: "Manage"}]]),
                        defaultGrant: null,
                    },
                    getCurrentTime(),
                ),
            },
        },
        {
            type: "UpdateTaskCollection",
            collectionId,
            collectionAction: {
                type: "Delete",
                deletedTime: getCurrentTime(),
            },
        },
    ]);

    await expect(
        commitTaskSpaceActionTransaction(context.action(session2), space.id, [
            {
                type: "UpdateTaskCollection",
                collectionId,
                collectionAction: {
                    type: "Undelete",
                    undeletedTime: getCurrentTime(),
                },
            },
        ]),
    ).rejects.toThrow(PermissionDeniedError);
});

test("can't undelete a collection you only have access to as an editor", async () => {
    const collectionId = generateId<TaskCollectionId>();

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTaskCollection",
            collectionId,
            collectionAction: {
                type: "Create",
                creatorId: taskAccount1.accountId,
                createdTime: getCurrentTime(),
                accessPolicy: new TaskCollectionAccessPolicyRegister(
                    {
                        accountGrantById: new Map([
                            [taskAccount1.accountId, {level: "Manage"}],
                            [taskAccount2.accountId, {level: "Edit"}],
                        ]),
                        defaultGrant: null,
                    },
                    getCurrentTime(),
                ),
            },
        },
        {
            type: "UpdateTaskCollection",
            collectionId,
            collectionAction: {
                type: "Delete",
                deletedTime: getCurrentTime(),
            },
        },
    ]);

    await expect(
        commitTaskSpaceActionTransaction(context.action(session2), space.id, [
            {
                type: "UpdateTaskCollection",
                collectionId,
                collectionAction: {
                    type: "Undelete",
                    undeletedTime: getCurrentTime(),
                },
            },
        ]),
    ).rejects.toThrow(PermissionDeniedError);
});

test("can undelete a collection you have access to as a manager", async () => {
    const collectionId = generateId<TaskCollectionId>();

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTaskCollection",
            collectionId,
            collectionAction: {
                type: "Create",
                creatorId: taskAccount1.accountId,
                createdTime: getCurrentTime(),
                accessPolicy: new TaskCollectionAccessPolicyRegister(
                    {
                        accountGrantById: new Map([
                            [taskAccount1.accountId, {level: "Manage"}],
                            [taskAccount2.accountId, {level: "Manage"}],
                        ]),
                        defaultGrant: null,
                    },
                    getCurrentTime(),
                ),
            },
        },
        {
            type: "UpdateTaskCollection",
            collectionId,
            collectionAction: {
                type: "Delete",
                deletedTime: getCurrentTime(),
            },
        },
    ]);

    await commitTaskSpaceActionTransaction(context.action(session2), space.id, [
        {
            type: "UpdateTaskCollection",
            collectionId,
            collectionAction: {
                type: "Undelete",
                undeletedTime: getCurrentTime(),
            },
        },
    ]);
});

test("can update a collection's name", async () => {
    const collectionId = generateId<TaskCollectionId>();

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTaskCollection",
            collectionId,
            collectionAction: {
                type: "Create",
                creatorId: session1.accountId,
                createdTime: getCurrentTime(),
                accessPolicy: new TaskCollectionAccessPolicyRegister(
                    {
                        accountGrantById: new Map([[session1.accountId, {level: "Manage"}]]),
                        defaultGrant: null,
                    },
                    getCurrentTime(),
                ),
            },
        },
    ]);

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTaskCollection",
            collectionId,
            collectionAction: {
                type: "UpdateName",
                nameAction: {
                    value: "test2",
                    updatedTime: getCurrentTime(),
                },
            },
        },
    ]);
});

test("can't update a collection name for a collection that doesn't exist", async () => {
    const collectionId = generateId<TaskCollectionId>();

    await expect(
        commitTaskSpaceActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTaskCollection",
                collectionId,
                collectionAction: {
                    type: "UpdateName",
                    nameAction: {
                        value: "test2",
                        updatedTime: getCurrentTime(),
                    },
                },
            },
        ]),
    ).rejects.toThrow(NotFoundError);
});

test("can't update a deleted collection's title", async () => {
    const collectionId = generateId<TaskCollectionId>();

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTaskCollection",
            collectionId,
            collectionAction: {
                type: "Create",
                creatorId: session1.accountId,
                createdTime: getCurrentTime(),
                accessPolicy: new TaskCollectionAccessPolicyRegister(
                    {
                        accountGrantById: new Map([[session1.accountId, {level: "Manage"}]]),
                        defaultGrant: null,
                    },
                    getCurrentTime(),
                ),
            },
        },
    ]);

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTaskCollection",
            collectionId,
            collectionAction: {
                type: "Delete",
                deletedTime: getCurrentTime(),
            },
        },
    ]);

    await expect(
        commitTaskSpaceActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTaskCollection",
                collectionId,
                collectionAction: {
                    type: "UpdateName",
                    nameAction: {
                        value: "test2",
                        updatedTime: getCurrentTime(),
                    },
                },
            },
        ]),
    ).rejects.toThrow(FailedPreconditionError);
});

test("can't update a collection name that's not yours", async () => {
    const collectionId = generateId<TaskCollectionId>();

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTaskCollection",
            collectionId,
            collectionAction: {
                type: "Create",
                creatorId: session1.accountId,
                createdTime: getCurrentTime(),
                accessPolicy: new TaskCollectionAccessPolicyRegister(
                    {
                        accountGrantById: new Map([[session1.accountId, {level: "Manage"}]]),
                        defaultGrant: null,
                    },
                    getCurrentTime(),
                ),
            },
        },
    ]);

    await expect(
        commitTaskSpaceActionTransaction(context.action(session2), space.id, [
            {
                type: "UpdateTaskCollection",
                collectionId,
                collectionAction: {
                    type: "UpdateName",
                    nameAction: {
                        value: "test2",
                        updatedTime: getCurrentTime(),
                    },
                },
            },
        ]),
    ).rejects.toThrow(PermissionDeniedError);
});

test("can't update a collection name with an unreasonable time", async () => {
    const collectionId = generateId<TaskCollectionId>();

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTaskCollection",
            collectionId,
            collectionAction: {
                type: "Create",
                creatorId: taskAccount1.accountId,
                createdTime: getCurrentTime(),
                accessPolicy: new TaskCollectionAccessPolicyRegister(
                    {
                        accountGrantById: new Map([[taskAccount1.accountId, {level: "Manage"}]]),
                        defaultGrant: null,
                    },
                    getCurrentTime(),
                ),
            },
        },
    ]);

    await expect(
        commitTaskSpaceActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTaskCollection",
                collectionId,
                collectionAction: {
                    type: "UpdateName",
                    nameAction: {
                        value: "test2",
                        updatedTime: getUnreasonableTime(),
                    },
                },
            },
        ]),
    ).rejects.toThrow(InvalidArgumentError);
});

test("can't update a collection name you don't have access to", async () => {
    const collectionId = generateId<TaskCollectionId>();

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTaskCollection",
            collectionId,
            collectionAction: {
                type: "Create",
                creatorId: taskAccount1.accountId,
                createdTime: getCurrentTime(),
                accessPolicy: new TaskCollectionAccessPolicyRegister(
                    {
                        accountGrantById: new Map([[taskAccount1.accountId, {level: "Manage"}]]),
                        defaultGrant: null,
                    },
                    getCurrentTime(),
                ),
            },
        },
    ]);

    await expect(
        commitTaskSpaceActionTransaction(context.action(session2), space.id, [
            {
                type: "UpdateTaskCollection",
                collectionId,
                collectionAction: {
                    type: "UpdateName",
                    nameAction: {
                        value: "test2",
                        updatedTime: getCurrentTime(),
                    },
                },
            },
        ]),
    ).rejects.toThrow(PermissionDeniedError);
});

test("can't update a collection name you only have access to as an editor", async () => {
    const collectionId = generateId<TaskCollectionId>();

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTaskCollection",
            collectionId,
            collectionAction: {
                type: "Create",
                creatorId: taskAccount1.accountId,
                createdTime: getCurrentTime(),
                accessPolicy: new TaskCollectionAccessPolicyRegister(
                    {
                        accountGrantById: new Map([
                            [taskAccount1.accountId, {level: "Manage"}],
                            [taskAccount2.accountId, {level: "Edit"}],
                        ]),
                        defaultGrant: null,
                    },
                    getCurrentTime(),
                ),
            },
        },
    ]);

    await expect(
        commitTaskSpaceActionTransaction(context.action(session2), space.id, [
            {
                type: "UpdateTaskCollection",
                collectionId,
                collectionAction: {
                    type: "UpdateName",
                    nameAction: {
                        value: "test2",
                        updatedTime: getCurrentTime(),
                    },
                },
            },
        ]),
    ).rejects.toThrow(PermissionDeniedError);
});

test("can update a collection name you have access to as a manager", async () => {
    const collectionId = generateId<TaskCollectionId>();

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTaskCollection",
            collectionId,
            collectionAction: {
                type: "Create",
                creatorId: taskAccount1.accountId,
                createdTime: getCurrentTime(),
                accessPolicy: new TaskCollectionAccessPolicyRegister(
                    {
                        accountGrantById: new Map([
                            [taskAccount1.accountId, {level: "Manage"}],
                            [taskAccount2.accountId, {level: "Manage"}],
                        ]),
                        defaultGrant: null,
                    },
                    getCurrentTime(),
                ),
            },
        },
    ]);

    await commitTaskSpaceActionTransaction(context.action(session2), space.id, [
        {
            type: "UpdateTaskCollection",
            collectionId,
            collectionAction: {
                type: "UpdateName",
                nameAction: {
                    value: "test2",
                    updatedTime: getCurrentTime(),
                },
            },
        },
    ]);
});

test("can update a collection's access policy", async () => {
    const collectionId = generateId<TaskCollectionId>();

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTaskCollection",
            collectionId,
            collectionAction: {
                type: "Create",
                creatorId: session1.accountId,
                createdTime: getCurrentTime(),
                accessPolicy: new TaskCollectionAccessPolicyRegister(
                    {
                        accountGrantById: new Map([[session1.accountId, {level: "Manage"}]]),
                        defaultGrant: null,
                    },
                    getCurrentTime(),
                ),
            },
        },
    ]);

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTaskCollection",
            collectionId,
            collectionAction: {
                type: "UpdateAccessPolicy",
                accessPolicyAction: {
                    value: {
                        accountGrantById: new Map([
                            [session1.accountId, {level: "Manage"}],
                            [session3.accountId, {level: "Edit"}],
                        ]),
                        defaultGrant: null,
                    },
                    updatedTime: getCurrentTime(),
                },
            },
        },
    ]);
});

test("can't update a collection access policy for a collection that doesn't exist", async () => {
    const collectionId = generateId<TaskCollectionId>();

    await expect(
        commitTaskSpaceActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTaskCollection",
                collectionId,
                collectionAction: {
                    type: "UpdateAccessPolicy",
                    accessPolicyAction: {
                        value: {
                            accountGrantById: new Map([
                                [session1.accountId, {level: "Manage"}],
                                [session3.accountId, {level: "Edit"}],
                            ]),
                            defaultGrant: null,
                        },
                        updatedTime: getCurrentTime(),
                    },
                },
            },
        ]),
    ).rejects.toThrow(NotFoundError);
});

test("can't update a deleted collection's access policy", async () => {
    const collectionId = generateId<TaskCollectionId>();

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTaskCollection",
            collectionId,
            collectionAction: {
                type: "Create",
                creatorId: session1.accountId,
                createdTime: getCurrentTime(),
                accessPolicy: new TaskCollectionAccessPolicyRegister(
                    {
                        accountGrantById: new Map([[session1.accountId, {level: "Manage"}]]),
                        defaultGrant: null,
                    },
                    getCurrentTime(),
                ),
            },
        },
    ]);

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTaskCollection",
            collectionId,
            collectionAction: {
                type: "Delete",
                deletedTime: getCurrentTime(),
            },
        },
    ]);

    await expect(
        commitTaskSpaceActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTaskCollection",
                collectionId,
                collectionAction: {
                    type: "UpdateAccessPolicy",
                    accessPolicyAction: {
                        value: {
                            accountGrantById: new Map([
                                [session1.accountId, {level: "Manage"}],
                                [session3.accountId, {level: "Edit"}],
                            ]),
                            defaultGrant: null,
                        },
                        updatedTime: getCurrentTime(),
                    },
                },
            },
        ]),
    ).rejects.toThrow(FailedPreconditionError);
});

test("can't update a collection access policy that's not yours", async () => {
    const collectionId = generateId<TaskCollectionId>();

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTaskCollection",
            collectionId,
            collectionAction: {
                type: "Create",
                creatorId: session1.accountId,
                createdTime: getCurrentTime(),
                accessPolicy: new TaskCollectionAccessPolicyRegister(
                    {
                        accountGrantById: new Map([[session1.accountId, {level: "Manage"}]]),
                        defaultGrant: null,
                    },
                    getCurrentTime(),
                ),
            },
        },
    ]);

    await expect(
        commitTaskSpaceActionTransaction(context.action(session2), space.id, [
            {
                type: "UpdateTaskCollection",
                collectionId,
                collectionAction: {
                    type: "UpdateAccessPolicy",
                    accessPolicyAction: {
                        value: {
                            accountGrantById: new Map([
                                [session1.accountId, {level: "Manage"}],
                                [session3.accountId, {level: "Edit"}],
                            ]),
                            defaultGrant: null,
                        },
                        updatedTime: getCurrentTime(),
                    },
                },
            },
        ]),
    ).rejects.toThrow(PermissionDeniedError);
});

test("can't update a collection access policy with an unreasonable time", async () => {
    const collectionId = generateId<TaskCollectionId>();

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTaskCollection",
            collectionId,
            collectionAction: {
                type: "Create",
                creatorId: taskAccount1.accountId,
                createdTime: getCurrentTime(),
                accessPolicy: new TaskCollectionAccessPolicyRegister(
                    {
                        accountGrantById: new Map([[taskAccount1.accountId, {level: "Manage"}]]),
                        defaultGrant: null,
                    },
                    getCurrentTime(),
                ),
            },
        },
    ]);

    await expect(
        commitTaskSpaceActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTaskCollection",
                collectionId,
                collectionAction: {
                    type: "UpdateAccessPolicy",
                    accessPolicyAction: {
                        value: {
                            accountGrantById: new Map([
                                [session1.accountId, {level: "Manage"}],
                                [session3.accountId, {level: "Edit"}],
                            ]),
                            defaultGrant: null,
                        },
                        updatedTime: getUnreasonableTime(),
                    },
                },
            },
        ]),
    ).rejects.toThrow(InvalidArgumentError);
});

test("can't update a collection access policy you don't have access to", async () => {
    const collectionId = generateId<TaskCollectionId>();

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTaskCollection",
            collectionId,
            collectionAction: {
                type: "Create",
                creatorId: taskAccount1.accountId,
                createdTime: getCurrentTime(),
                accessPolicy: new TaskCollectionAccessPolicyRegister(
                    {
                        accountGrantById: new Map([[taskAccount1.accountId, {level: "Manage"}]]),
                        defaultGrant: null,
                    },
                    getCurrentTime(),
                ),
            },
        },
    ]);

    await expect(
        commitTaskSpaceActionTransaction(context.action(session2), space.id, [
            {
                type: "UpdateTaskCollection",
                collectionId,
                collectionAction: {
                    type: "UpdateAccessPolicy",
                    accessPolicyAction: {
                        value: {
                            accountGrantById: new Map([
                                [session1.accountId, {level: "Manage"}],
                                [session3.accountId, {level: "Edit"}],
                            ]),
                            defaultGrant: null,
                        },
                        updatedTime: getCurrentTime(),
                    },
                },
            },
        ]),
    ).rejects.toThrow(PermissionDeniedError);
});

test("can't update a collection access policy you only have access to as an editor", async () => {
    const collectionId = generateId<TaskCollectionId>();

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTaskCollection",
            collectionId,
            collectionAction: {
                type: "Create",
                creatorId: taskAccount1.accountId,
                createdTime: getCurrentTime(),
                accessPolicy: new TaskCollectionAccessPolicyRegister(
                    {
                        accountGrantById: new Map([
                            [taskAccount1.accountId, {level: "Manage"}],
                            [taskAccount2.accountId, {level: "Edit"}],
                        ]),
                        defaultGrant: null,
                    },
                    getCurrentTime(),
                ),
            },
        },
    ]);

    await expect(
        commitTaskSpaceActionTransaction(context.action(session2), space.id, [
            {
                type: "UpdateTaskCollection",
                collectionId,
                collectionAction: {
                    type: "UpdateAccessPolicy",
                    accessPolicyAction: {
                        value: {
                            accountGrantById: new Map([
                                [session1.accountId, {level: "Manage"}],
                                [session3.accountId, {level: "Edit"}],
                            ]),
                            defaultGrant: null,
                        },
                        updatedTime: getCurrentTime(),
                    },
                },
            },
        ]),
    ).rejects.toThrow(PermissionDeniedError);
});

test("can update a collection access policy you have access to as a manager", async () => {
    const collectionId = generateId<TaskCollectionId>();

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTaskCollection",
            collectionId,
            collectionAction: {
                type: "Create",
                creatorId: taskAccount1.accountId,
                createdTime: getCurrentTime(),
                accessPolicy: new TaskCollectionAccessPolicyRegister(
                    {
                        accountGrantById: new Map([
                            [taskAccount1.accountId, {level: "Manage"}],
                            [taskAccount2.accountId, {level: "Manage"}],
                        ]),
                        defaultGrant: null,
                    },
                    getCurrentTime(),
                ),
            },
        },
    ]);

    await commitTaskSpaceActionTransaction(context.action(session2), space.id, [
        {
            type: "UpdateTaskCollection",
            collectionId,
            collectionAction: {
                type: "UpdateAccessPolicy",
                accessPolicyAction: {
                    value: {
                        accountGrantById: new Map([
                            [session1.accountId, {level: "Manage"}],
                            [session3.accountId, {level: "Edit"}],
                        ]),
                        defaultGrant: null,
                    },
                    updatedTime: getCurrentTime(),
                },
            },
        },
    ]);
});

test("can't update a collection access policy with no manage grants", async () => {
    const collectionId = generateId<TaskCollectionId>();

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTaskCollection",
            collectionId,
            collectionAction: {
                type: "Create",
                creatorId: taskAccount1.accountId,
                createdTime: getCurrentTime(),
                accessPolicy: new TaskCollectionAccessPolicyRegister(
                    {
                        accountGrantById: new Map([
                            [taskAccount1.accountId, {level: "Manage"}],
                            [taskAccount2.accountId, {level: "Manage"}],
                        ]),
                        defaultGrant: null,
                    },
                    getCurrentTime(),
                ),
            },
        },
    ]);

    await expect(
        commitTaskSpaceActionTransaction(context.action(session2), space.id, [
            {
                type: "UpdateTaskCollection",
                collectionId,
                collectionAction: {
                    type: "UpdateAccessPolicy",
                    accessPolicyAction: {
                        value: {
                            accountGrantById: new Map([
                                [session1.accountId, {level: "Edit"}],
                                [session3.accountId, {level: "Edit"}],
                            ]),
                            defaultGrant: null,
                        },
                        updatedTime: getCurrentTime(),
                    },
                },
            },
        ]),
    ).rejects.toThrow(
        new InvalidArgumentError(
            '`accessPolicy` must grant at least one account the "Manage" access level',
        ),
    );

    await expect(
        commitTaskSpaceActionTransaction(context.action(session2), space.id, [
            {
                type: "UpdateTaskCollection",
                collectionId,
                collectionAction: {
                    type: "UpdateAccessPolicy",
                    accessPolicyAction: {
                        value: {
                            accountGrantById: new Map([]),
                            defaultGrant: {type: "Space", level: "Edit"},
                        },
                        updatedTime: getCurrentTime(),
                    },
                },
            },
        ]),
    ).rejects.toThrow(
        new InvalidArgumentError(
            '`accessPolicy` must grant at least one account the "Manage" access level',
        ),
    );

    await commitTaskSpaceActionTransaction(context.action(session2), space.id, [
        {
            type: "UpdateTaskCollection",
            collectionId,
            collectionAction: {
                type: "UpdateAccessPolicy",
                accessPolicyAction: {
                    value: {
                        accountGrantById: new Map([]),
                        defaultGrant: {type: "Space", level: "Manage"},
                    },
                    updatedTime: getCurrentTime(),
                },
            },
        },
    ]);
});

test("can update a collection access policy to remove access from yourself", async () => {
    const collectionId = generateId<TaskCollectionId>();

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTaskCollection",
            collectionId,
            collectionAction: {
                type: "Create",
                creatorId: taskAccount1.accountId,
                createdTime: getCurrentTime(),
                accessPolicy: new TaskCollectionAccessPolicyRegister(
                    {
                        accountGrantById: new Map([
                            [taskAccount1.accountId, {level: "Manage"}],
                            [taskAccount2.accountId, {level: "Manage"}],
                        ]),
                        defaultGrant: null,
                    },
                    getCurrentTime(),
                ),
            },
        },
    ]);

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTaskCollection",
            collectionId,
            collectionAction: {
                type: "UpdateAccessPolicy",
                accessPolicyAction: {
                    value: {
                        accountGrantById: new Map([[taskAccount2.accountId, {level: "Manage"}]]),
                        defaultGrant: null,
                    },
                    updatedTime: getCurrentTime(),
                },
            },
        },
    ]);

    await expect(
        commitTaskSpaceActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTaskCollection",
                collectionId,
                collectionAction: {
                    type: "UpdateAccessPolicy",
                    accessPolicyAction: {
                        value: {
                            accountGrantById: new Map([
                                [taskAccount1.accountId, {level: "Manage"}],
                                [taskAccount2.accountId, {level: "Manage"}],
                            ]),
                            defaultGrant: null,
                        },
                        updatedTime: getCurrentTime(),
                    },
                },
            },
        ]),
    ).rejects.toThrow(PermissionDeniedError);
});

test("can't create task twice race condition", async () => {
    const taskId = generateId<TaskId>();

    const pausePromise = commitTaskSpaceActionTransactionBeforeExecuteTestCheckpoint.pauseForTest(
        session1.accountId,
    );

    const commit1Promise = commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            taskId,
            taskAction: {
                type: "Create",
                creator: taskAccount1,
                createdTime: getCurrentTaskTime(),
            },
        },
    ]);

    const {unpause} = await pausePromise;

    await commitTaskSpaceActionTransaction(context.action(session2), space.id, [
        {
            type: "UpdateTask",
            taskId,
            taskAction: {
                type: "Create",
                creator: taskAccount2,
                createdTime: getCurrentTaskTime(),
            },
        },
    ]);

    unpause();

    await expect(commit1Promise).rejects.toThrow(FailedPreconditionError);
});

test("can't create collection twice race condition", async () => {
    const collectionId = generateId<TaskCollectionId>();

    const pausePromise = commitTaskSpaceActionTransactionBeforeExecuteTestCheckpoint.pauseForTest(
        session1.accountId,
    );

    const commit1Promise = commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTaskCollection",
            collectionId,
            collectionAction: {
                type: "Create",
                creatorId: taskAccount1.accountId,
                createdTime: getCurrentTime(),
                accessPolicy: new TaskCollectionAccessPolicyRegister(
                    {
                        accountGrantById: new Map([[taskAccount1.accountId, {level: "Manage"}]]),
                        defaultGrant: null,
                    },
                    getCurrentTime(),
                ),
            },
        },
    ]);

    const {unpause} = await pausePromise;

    await commitTaskSpaceActionTransaction(context.action(session2), space.id, [
        {
            type: "UpdateTaskCollection",
            collectionId,
            collectionAction: {
                type: "Create",
                creatorId: taskAccount2.accountId,
                createdTime: getCurrentTime(),
                accessPolicy: new TaskCollectionAccessPolicyRegister(
                    {
                        accountGrantById: new Map([[taskAccount2.accountId, {level: "Manage"}]]),
                        defaultGrant: null,
                    },
                    getCurrentTime(),
                ),
            },
        },
    ]);

    unpause();

    await expect(commit1Promise).rejects.toThrow(FailedPreconditionError);
});

// Our authorization code is implemented with the reasoning: if you had access
// in a small window of time (<1 min) before the commit we allow the action.
test("can update task when collection you have access to is removed in a race condition", async () => {
    const taskId = generateId<TaskId>();
    const collectionId = generateId<TaskCollectionId>();

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTaskCollection",
            collectionId,
            collectionAction: {
                type: "Create",
                creatorId: taskAccount1.accountId,
                createdTime: getCurrentTime(),
                accessPolicy: new TaskCollectionAccessPolicyRegister(
                    {
                        accountGrantById: new Map([
                            [taskAccount1.accountId, {level: "Manage"}],
                            [taskAccount2.accountId, {level: "Edit"}],
                        ]),
                        defaultGrant: null,
                    },
                    getCurrentTime(),
                ),
            },
        },
        {
            type: "UpdateTask",
            taskId,
            taskAction: {
                type: "Create",
                creator: taskAccount1,
                createdTime: getCurrentTaskTime(),
            },
        },
        {
            type: "UpdateTask",
            taskId,
            taskAction: {
                type: "UpdateCollections",
                collectionsAction: {
                    type: "Set",
                    key: collectionId,
                    value: assertOrderKey("a0"),
                    updatedTime: getCurrentTime(),
                },
            },
        },
    ]);

    await commitTaskSpaceActionTransaction(context.action(session2), space.id, [
        {
            type: "UpdateTask",
            taskId,
            taskAction: {
                type: "UpdateTitle",
                titleUpdate: taskTitleTestScenario.update0,
            },
        },
    ]);

    const pausePromise = commitTaskSpaceActionTransactionBeforeExecuteTestCheckpoint.pauseForTest(
        session2.accountId,
    );

    const commitPromise = commitTaskSpaceActionTransaction(context.action(session2), space.id, [
        {
            type: "UpdateTask",
            taskId,
            taskAction: {
                type: "UpdateTitle",
                titleUpdate: taskTitleTestScenario.update1,
            },
        },
    ]);

    const {unpause} = await pausePromise;

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            taskId,
            taskAction: {
                type: "UpdateCollections",
                collectionsAction: {
                    type: "Delete",
                    key: collectionId,
                    deletedTime: getCurrentTime(),
                },
            },
        },
    ]);

    unpause();

    await expect(commitPromise).resolves.not.toThrow(PermissionDeniedError);
});

// Our authorization code is implemented with the reasoning: if you had access
// in a small window of time (<1 min) before the commit we allow the action.
test("can update task when collection you have access to removes your access in a race condition", async () => {
    const taskId = generateId<TaskId>();
    const collectionId = generateId<TaskCollectionId>();

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTaskCollection",
            collectionId,
            collectionAction: {
                type: "Create",
                creatorId: taskAccount1.accountId,
                createdTime: getCurrentTime(),
                accessPolicy: new TaskCollectionAccessPolicyRegister(
                    {
                        accountGrantById: new Map([
                            [taskAccount1.accountId, {level: "Manage"}],
                            [taskAccount2.accountId, {level: "Edit"}],
                        ]),
                        defaultGrant: null,
                    },
                    getCurrentTime(),
                ),
            },
        },
        {
            type: "UpdateTask",
            taskId,
            taskAction: {
                type: "Create",
                creator: taskAccount1,
                createdTime: getCurrentTaskTime(),
            },
        },
        {
            type: "UpdateTask",
            taskId,
            taskAction: {
                type: "UpdateCollections",
                collectionsAction: {
                    type: "Set",
                    key: collectionId,
                    value: assertOrderKey("a0"),
                    updatedTime: getCurrentTime(),
                },
            },
        },
    ]);

    await commitTaskSpaceActionTransaction(context.action(session2), space.id, [
        {
            type: "UpdateTask",
            taskId,
            taskAction: {
                type: "UpdateTitle",
                titleUpdate: taskTitleTestScenario.update0,
            },
        },
    ]);

    const pausePromise = commitTaskSpaceActionTransactionBeforeExecuteTestCheckpoint.pauseForTest(
        session2.accountId,
    );

    const commitPromise = commitTaskSpaceActionTransaction(context.action(session2), space.id, [
        {
            type: "UpdateTask",
            taskId,
            taskAction: {
                type: "UpdateTitle",
                titleUpdate: taskTitleTestScenario.update1,
            },
        },
    ]);

    const {unpause} = await pausePromise;

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTaskCollection",
            collectionId,
            collectionAction: {
                type: "UpdateAccessPolicy",
                accessPolicyAction: {
                    value: {
                        accountGrantById: new Map([
                            [taskAccount1.accountId, {level: "Manage"}],
                            [taskAccount2.accountId, {level: "View"}],
                        ]),
                        defaultGrant: null,
                    },
                    updatedTime: getCurrentTime(),
                },
            },
        },
    ]);

    unpause();

    await expect(commitPromise).resolves.not.toThrow(PermissionDeniedError);
});

test("can update task due date", async () => {
    const taskId = generateId<TaskId>();

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            taskId,
            taskAction: {
                type: "Create",
                creator: taskAccount1,
                createdTime: getCurrentTaskTime(),
            },
        },
    ]);

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            taskId,
            taskAction: {
                type: "UpdateDueDate",
                dueDateAction: {
                    value: new CalendarDate(2023, 7, 12),
                    updatedTime: getCurrentTime(),
                },
            },
        },
    ]);
});

test("can't update task due date with unreasonable updated time", async () => {
    const taskId = generateId<TaskId>();

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            taskId,
            taskAction: {
                type: "Create",
                creator: taskAccount1,
                createdTime: getCurrentTaskTime(),
            },
        },
    ]);

    await expect(
        commitTaskSpaceActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                taskId,
                taskAction: {
                    type: "UpdateDueDate",
                    dueDateAction: {
                        value: new CalendarDate(2023, 7, 12),
                        updatedTime: getUnreasonableTime(),
                    },
                },
            },
        ]),
    ).rejects.toThrow(InvalidArgumentError);
});

test("can update task priority", async () => {
    const taskId = generateId<TaskId>();

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            taskId,
            taskAction: {
                type: "Create",
                creator: taskAccount1,
                createdTime: getCurrentTaskTime(),
            },
        },
    ]);

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            taskId,
            taskAction: {
                type: "UpdatePriority",
                priorityAction: {
                    value: "Medium",
                    updatedTime: getCurrentTime(),
                },
            },
        },
    ]);
});

test("can't update priority with unreasonable updated time", async () => {
    const taskId = generateId<TaskId>();

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            taskId,
            taskAction: {
                type: "Create",
                creator: taskAccount1,
                createdTime: getCurrentTaskTime(),
            },
        },
    ]);

    await expect(
        commitTaskSpaceActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                taskId,
                taskAction: {
                    type: "UpdatePriority",
                    priorityAction: {
                        value: "Medium",
                        updatedTime: getUnreasonableTime(),
                    },
                },
            },
        ]),
    ).rejects.toThrow(InvalidArgumentError);
});

test("can update task parent", async () => {
    const taskId1 = generateId<TaskId>();
    const taskId2 = generateId<TaskId>();

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            taskId: taskId1,
            taskAction: {
                type: "Create",
                creator: taskAccount1,
                createdTime: getCurrentTaskTime(),
            },
        },
    ]);

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            taskId: taskId2,
            taskAction: {
                type: "Create",
                creator: taskAccount1,
                createdTime: getCurrentTaskTime(),
            },
        },
    ]);

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            taskId: taskId2,
            taskAction: {
                type: "UpdateParentTaskId",
                parentTaskIdAction: {
                    value: taskId1,
                    updatedTime: getCurrentTime(),
                },
            },
        },
    ]);
});

test("can't update task parent with unreasonable update time", async () => {
    const taskId1 = generateId<TaskId>();
    const taskId2 = generateId<TaskId>();

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            taskId: taskId1,
            taskAction: {
                type: "Create",
                creator: taskAccount1,
                createdTime: getCurrentTaskTime(),
            },
        },
    ]);

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            taskId: taskId2,
            taskAction: {
                type: "Create",
                creator: taskAccount1,
                createdTime: getCurrentTaskTime(),
            },
        },
    ]);

    await expect(
        commitTaskSpaceActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                taskId: taskId2,
                taskAction: {
                    type: "UpdateParentTaskId",
                    parentTaskIdAction: {
                        value: taskId1,
                        updatedTime: getUnreasonableTime(),
                    },
                },
            },
        ]),
    ).rejects.toThrow(InvalidArgumentError);
});

test("can update task parent in one transaction", async () => {
    const taskId1 = generateId<TaskId>();
    const taskId2 = generateId<TaskId>();

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            taskId: taskId1,
            taskAction: {
                type: "Create",
                creator: taskAccount1,
                createdTime: getCurrentTaskTime(),
            },
        },
        {
            type: "UpdateTask",
            taskId: taskId2,
            taskAction: {
                type: "Create",
                creator: taskAccount1,
                createdTime: getCurrentTaskTime(),
            },
        },
        {
            type: "UpdateTask",
            taskId: taskId2,
            taskAction: {
                type: "UpdateParentTaskId",
                parentTaskIdAction: {
                    value: taskId1,
                    updatedTime: getCurrentTime(),
                },
            },
        },
    ]);
});

test("can update task parent in two transactions (scenario 1)", async () => {
    const taskId1 = generateId<TaskId>();
    const taskId2 = generateId<TaskId>();

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            taskId: taskId1,
            taskAction: {
                type: "Create",
                creator: taskAccount1,
                createdTime: getCurrentTaskTime(),
            },
        },
        {
            type: "UpdateTask",
            taskId: taskId2,
            taskAction: {
                type: "Create",
                creator: taskAccount1,
                createdTime: getCurrentTaskTime(),
            },
        },
    ]);

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            taskId: taskId2,
            taskAction: {
                type: "UpdateParentTaskId",
                parentTaskIdAction: {
                    value: taskId1,
                    updatedTime: getCurrentTime(),
                },
            },
        },
    ]);
});

test("can update task parent in two transactions (scenario 2)", async () => {
    const taskId1 = generateId<TaskId>();
    const taskId2 = generateId<TaskId>();

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            taskId: taskId1,
            taskAction: {
                type: "Create",
                creator: taskAccount1,
                createdTime: getCurrentTaskTime(),
            },
        },
    ]);

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            taskId: taskId2,
            taskAction: {
                type: "Create",
                creator: taskAccount1,
                createdTime: getCurrentTaskTime(),
            },
        },
        {
            type: "UpdateTask",
            taskId: taskId2,
            taskAction: {
                type: "UpdateParentTaskId",
                parentTaskIdAction: {
                    value: taskId1,
                    updatedTime: getCurrentTime(),
                },
            },
        },
    ]);
});

test("can't update task parent on a task that doesn't exist", async () => {
    const taskId1 = generateId<TaskId>();
    const taskId2 = generateId<TaskId>();

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            taskId: taskId1,
            taskAction: {
                type: "Create",
                creator: taskAccount1,
                createdTime: getCurrentTaskTime(),
            },
        },
    ]);

    await expect(
        commitTaskSpaceActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                taskId: taskId2,
                taskAction: {
                    type: "UpdateParentTaskId",
                    parentTaskIdAction: {
                        value: taskId1,
                        updatedTime: getCurrentTime(),
                    },
                },
            },
        ]),
    ).rejects.toThrow(new NotFoundError("Task not found"));
});

test("can't update task parent with a task that doesn't exist", async () => {
    const taskId1 = generateId<TaskId>();
    const taskId2 = generateId<TaskId>();

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            taskId: taskId2,
            taskAction: {
                type: "Create",
                creator: taskAccount1,
                createdTime: getCurrentTaskTime(),
            },
        },
    ]);

    await expect(
        commitTaskSpaceActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                taskId: taskId2,
                taskAction: {
                    type: "UpdateParentTaskId",
                    parentTaskIdAction: {
                        value: taskId1,
                        updatedTime: getCurrentTime(),
                    },
                },
            },
        ]),
    ).rejects.toThrow(new NotFoundError("Parent task not found"));
});

test("can't update task parent to deleted task", async () => {
    const taskId1 = generateId<TaskId>();
    const taskId2 = generateId<TaskId>();

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            taskId: taskId1,
            taskAction: {
                type: "Create",
                creator: taskAccount1,
                createdTime: getCurrentTaskTime(),
            },
        },
    ]);

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            taskId: taskId2,
            taskAction: {
                type: "Create",
                creator: taskAccount1,
                createdTime: getCurrentTaskTime(),
            },
        },
    ]);

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            taskId: taskId1,
            taskAction: {
                type: "Delete",
                deletedTime: getCurrentTime(),
            },
        },
    ]);

    await expect(
        commitTaskSpaceActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                taskId: taskId2,
                taskAction: {
                    type: "UpdateParentTaskId",
                    parentTaskIdAction: {
                        value: taskId1,
                        updatedTime: getCurrentTime(),
                    },
                },
            },
        ]),
    ).rejects.toThrow(new FailedPreconditionError("Parent task is deleted"));
});

test("can't update task parent where grandparent is a deleted task", async () => {
    const taskId1 = generateId<TaskId>();
    const taskId2 = generateId<TaskId>();
    const taskId3 = generateId<TaskId>();

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            taskId: taskId1,
            taskAction: {
                type: "Create",
                creator: taskAccount1,
                createdTime: getCurrentTaskTime(),
            },
        },
    ]);

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            taskId: taskId2,
            taskAction: {
                type: "Create",
                creator: taskAccount1,
                createdTime: getCurrentTaskTime(),
            },
        },
    ]);

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            taskId: taskId3,
            taskAction: {
                type: "Create",
                creator: taskAccount1,
                createdTime: getCurrentTaskTime(),
            },
        },
    ]);

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            taskId: taskId1,
            taskAction: {
                type: "Delete",
                deletedTime: getCurrentTime(),
            },
        },
    ]);

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            taskId: taskId3,
            taskAction: {
                type: "UpdateParentTaskId",
                parentTaskIdAction: {
                    value: taskId2,
                    updatedTime: getCurrentTime(),
                },
            },
        },
    ]);
});

test("can't update task parent on a task you don't have edit access to", async () => {
    const taskId1 = generateId<TaskId>();
    const taskId2 = generateId<TaskId>();

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            taskId: taskId1,
            taskAction: {
                type: "Create",
                creator: taskAccount1,
                createdTime: getCurrentTaskTime(),
            },
        },
    ]);

    await commitTaskSpaceActionTransaction(context.action(session2), space.id, [
        {
            type: "UpdateTask",
            taskId: taskId2,
            taskAction: {
                type: "Create",
                creator: taskAccount2,
                createdTime: getCurrentTaskTime(),
            },
        },
    ]);

    await expect(
        commitTaskSpaceActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                taskId: taskId2,
                taskAction: {
                    type: "UpdateParentTaskId",
                    parentTaskIdAction: {
                        value: taskId1,
                        updatedTime: getCurrentTime(),
                    },
                },
            },
        ]),
    ).rejects.toThrow(PermissionDeniedError);
});

test("can't update task parent to a task you don't have edit access to", async () => {
    const taskId1 = generateId<TaskId>();
    const taskId2 = generateId<TaskId>();

    await commitTaskSpaceActionTransaction(context.action(session2), space.id, [
        {
            type: "UpdateTask",
            taskId: taskId1,
            taskAction: {
                type: "Create",
                creator: taskAccount2,
                createdTime: getCurrentTaskTime(),
            },
        },
    ]);

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            taskId: taskId2,
            taskAction: {
                type: "Create",
                creator: taskAccount1,
                createdTime: getCurrentTaskTime(),
            },
        },
    ]);

    await expect(
        commitTaskSpaceActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                taskId: taskId2,
                taskAction: {
                    type: "UpdateParentTaskId",
                    parentTaskIdAction: {
                        value: taskId1,
                        updatedTime: getCurrentTime(),
                    },
                },
            },
        ]),
    ).rejects.toThrow(PermissionDeniedError);
});

test("can't update task parent to a task you have view but not edit access to", async () => {
    const taskId1 = generateId<TaskId>();
    const taskId2 = generateId<TaskId>();
    const collectionId = generateId<TaskCollectionId>();

    await commitTaskSpaceActionTransaction(context.action(session2), space.id, [
        {
            type: "UpdateTaskCollection",
            collectionId,
            collectionAction: {
                type: "Create",
                creatorId: taskAccount2.accountId,
                createdTime: getCurrentTime(),
                accessPolicy: new TaskCollectionAccessPolicyRegister(
                    {
                        accountGrantById: new Map([
                            [taskAccount2.accountId, {level: "Manage"}],
                            [taskAccount1.accountId, {level: "View"}],
                        ]),
                        defaultGrant: null,
                    },
                    getCurrentTime(),
                ),
            },
        },
        {
            type: "UpdateTask",
            taskId: taskId1,
            taskAction: {
                type: "Create",
                creator: taskAccount2,
                createdTime: getCurrentTaskTime(),
            },
        },
        {
            type: "UpdateTask",
            taskId: taskId1,
            taskAction: {
                type: "UpdateCollections",
                collectionsAction: {
                    type: "Set",
                    key: collectionId,
                    value: assertOrderKey("a0"),
                    updatedTime: getCurrentTime(),
                },
            },
        },
    ]);

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            taskId: taskId2,
            taskAction: {
                type: "Create",
                creator: taskAccount1,
                createdTime: getCurrentTaskTime(),
            },
        },
    ]);

    await expect(
        commitTaskSpaceActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                taskId: taskId2,
                taskAction: {
                    type: "UpdateParentTaskId",
                    parentTaskIdAction: {
                        value: taskId1,
                        updatedTime: getCurrentTime(),
                    },
                },
            },
        ]),
    ).rejects.toThrow(PermissionDeniedError);
});

test("can update task parent to a task when you have edit access", async () => {
    const taskId1 = generateId<TaskId>();
    const taskId2 = generateId<TaskId>();
    const collectionId = generateId<TaskCollectionId>();

    await commitTaskSpaceActionTransaction(context.action(session2), space.id, [
        {
            type: "UpdateTaskCollection",
            collectionId,
            collectionAction: {
                type: "Create",
                creatorId: taskAccount2.accountId,
                createdTime: getCurrentTime(),
                accessPolicy: new TaskCollectionAccessPolicyRegister(
                    {
                        accountGrantById: new Map([
                            [taskAccount2.accountId, {level: "Manage"}],
                            [taskAccount1.accountId, {level: "Edit"}],
                        ]),
                        defaultGrant: null,
                    },
                    getCurrentTime(),
                ),
            },
        },
        {
            type: "UpdateTask",
            taskId: taskId1,
            taskAction: {
                type: "Create",
                creator: taskAccount2,
                createdTime: getCurrentTaskTime(),
            },
        },
        {
            type: "UpdateTask",
            taskId: taskId1,
            taskAction: {
                type: "UpdateCollections",
                collectionsAction: {
                    type: "Set",
                    key: collectionId,
                    value: assertOrderKey("a0"),
                    updatedTime: getCurrentTime(),
                },
            },
        },
    ]);

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            taskId: taskId2,
            taskAction: {
                type: "Create",
                creator: taskAccount1,
                createdTime: getCurrentTaskTime(),
            },
        },
    ]);

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            taskId: taskId2,
            taskAction: {
                type: "UpdateParentTaskId",
                parentTaskIdAction: {
                    value: taskId1,
                    updatedTime: getCurrentTime(),
                },
            },
        },
    ]);
});

test("child tasks inherit the permissions of their parent task", async () => {
    const taskId1 = generateId<TaskId>();
    const taskId2 = generateId<TaskId>();
    const collectionId = generateId<TaskCollectionId>();

    await commitTaskSpaceActionTransaction(context.action(session2), space.id, [
        {
            type: "UpdateTaskCollection",
            collectionId,
            collectionAction: {
                type: "Create",
                creatorId: taskAccount2.accountId,
                createdTime: getCurrentTime(),
                accessPolicy: new TaskCollectionAccessPolicyRegister(
                    {
                        accountGrantById: new Map([
                            [taskAccount2.accountId, {level: "Manage"}],
                            [taskAccount1.accountId, {level: "Edit"}],
                        ]),
                        defaultGrant: null,
                    },
                    getCurrentTime(),
                ),
            },
        },
        {
            type: "UpdateTask",
            taskId: taskId1,
            taskAction: {
                type: "Create",
                creator: taskAccount2,
                createdTime: getCurrentTaskTime(),
            },
        },
        {
            type: "UpdateTask",
            taskId: taskId1,
            taskAction: {
                type: "UpdateCollections",
                collectionsAction: {
                    type: "Set",
                    key: collectionId,
                    value: assertOrderKey("a0"),
                    updatedTime: getCurrentTime(),
                },
            },
        },
    ]);

    await commitTaskSpaceActionTransaction(context.action(session2), space.id, [
        {
            type: "UpdateTask",
            taskId: taskId2,
            taskAction: {
                type: "Create",
                creator: taskAccount2,
                createdTime: getCurrentTaskTime(),
            },
        },
    ]);

    await expect(
        commitTaskSpaceActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                taskId: taskId2,
                taskAction: {
                    type: "UpdateTitle",
                    titleUpdate: taskTitleTestScenario.update0,
                },
            },
        ]),
    ).rejects.toThrow(PermissionDeniedError);

    await commitTaskSpaceActionTransaction(context.action(session2), space.id, [
        {
            type: "UpdateTask",
            taskId: taskId2,
            taskAction: {
                type: "UpdateParentTaskId",
                parentTaskIdAction: {
                    value: taskId1,
                    updatedTime: getCurrentTime(),
                },
            },
        },
    ]);

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            taskId: taskId2,
            taskAction: {
                type: "UpdateTitle",
                titleUpdate: taskTitleTestScenario.update0,
            },
        },
    ]);
});

test("child tasks inherit the permissions of their parent task multiple levels up", async () => {
    const taskId1 = generateId<TaskId>();
    const taskId2 = generateId<TaskId>();
    const taskId3 = generateId<TaskId>();
    const taskId4 = generateId<TaskId>();
    const collectionId = generateId<TaskCollectionId>();

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTaskCollection",
            collectionId,
            collectionAction: {
                type: "Create",
                creatorId: taskAccount1.accountId,
                createdTime: getCurrentTime(),
                accessPolicy: new TaskCollectionAccessPolicyRegister(
                    {
                        accountGrantById: new Map([
                            [taskAccount1.accountId, {level: "Manage"}],
                            [taskAccount2.accountId, {level: "Edit"}],
                        ]),
                        defaultGrant: null,
                    },
                    getCurrentTime(),
                ),
            },
        },
        {
            type: "UpdateTask",
            taskId: taskId1,
            taskAction: {
                type: "Create",
                creator: taskAccount1,
                createdTime: getCurrentTaskTime(),
            },
        },
        {
            type: "UpdateTask",
            taskId: taskId1,
            taskAction: {
                type: "UpdateCollections",
                collectionsAction: {
                    type: "Set",
                    key: collectionId,
                    value: assertOrderKey("a0"),
                    updatedTime: getCurrentTime(),
                },
            },
        },
    ]);

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            taskId: taskId2,
            taskAction: {
                type: "Create",
                creator: taskAccount1,
                createdTime: getCurrentTaskTime(),
            },
        },
    ]);

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            taskId: taskId3,
            taskAction: {
                type: "Create",
                creator: taskAccount1,
                createdTime: getCurrentTaskTime(),
            },
        },
    ]);

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            taskId: taskId4,
            taskAction: {
                type: "Create",
                creator: taskAccount1,
                createdTime: getCurrentTaskTime(),
            },
        },
    ]);

    await expect(
        commitTaskSpaceActionTransaction(context.action(session2), space.id, [
            {
                type: "UpdateTask",
                taskId: taskId4,
                taskAction: {
                    type: "UpdateTitle",
                    titleUpdate: taskTitleTestScenario.update0,
                },
            },
        ]),
    ).rejects.toThrow(PermissionDeniedError);

    await expect(
        commitTaskSpaceActionTransaction(context.action(session2), space.id, [
            {
                type: "UpdateTask",
                taskId: taskId3,
                taskAction: {
                    type: "UpdateTitle",
                    titleUpdate: taskTitleTestScenario.update0,
                },
            },
        ]),
    ).rejects.toThrow(PermissionDeniedError);

    await expect(
        commitTaskSpaceActionTransaction(context.action(session2), space.id, [
            {
                type: "UpdateTask",
                taskId: taskId2,
                taskAction: {
                    type: "UpdateTitle",
                    titleUpdate: taskTitleTestScenario.update0,
                },
            },
        ]),
    ).rejects.toThrow(PermissionDeniedError);

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            taskId: taskId4,
            taskAction: {
                type: "UpdateParentTaskId",
                parentTaskIdAction: {
                    value: taskId3,
                    updatedTime: getCurrentTime(),
                },
            },
        },
    ]);

    await expect(
        commitTaskSpaceActionTransaction(context.action(session2), space.id, [
            {
                type: "UpdateTask",
                taskId: taskId4,
                taskAction: {
                    type: "UpdateTitle",
                    titleUpdate: taskTitleTestScenario.update0,
                },
            },
        ]),
    ).rejects.toThrow(PermissionDeniedError);

    await expect(
        commitTaskSpaceActionTransaction(context.action(session2), space.id, [
            {
                type: "UpdateTask",
                taskId: taskId3,
                taskAction: {
                    type: "UpdateTitle",
                    titleUpdate: taskTitleTestScenario.update0,
                },
            },
        ]),
    ).rejects.toThrow(PermissionDeniedError);

    await expect(
        commitTaskSpaceActionTransaction(context.action(session2), space.id, [
            {
                type: "UpdateTask",
                taskId: taskId2,
                taskAction: {
                    type: "UpdateTitle",
                    titleUpdate: taskTitleTestScenario.update0,
                },
            },
        ]),
    ).rejects.toThrow(PermissionDeniedError);

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            taskId: taskId3,
            taskAction: {
                type: "UpdateParentTaskId",
                parentTaskIdAction: {
                    value: taskId2,
                    updatedTime: getCurrentTime(),
                },
            },
        },
    ]);

    await expect(
        commitTaskSpaceActionTransaction(context.action(session2), space.id, [
            {
                type: "UpdateTask",
                taskId: taskId4,
                taskAction: {
                    type: "UpdateTitle",
                    titleUpdate: taskTitleTestScenario.update0,
                },
            },
        ]),
    ).rejects.toThrow(PermissionDeniedError);

    await expect(
        commitTaskSpaceActionTransaction(context.action(session2), space.id, [
            {
                type: "UpdateTask",
                taskId: taskId3,
                taskAction: {
                    type: "UpdateTitle",
                    titleUpdate: taskTitleTestScenario.update0,
                },
            },
        ]),
    ).rejects.toThrow(PermissionDeniedError);

    await expect(
        commitTaskSpaceActionTransaction(context.action(session2), space.id, [
            {
                type: "UpdateTask",
                taskId: taskId2,
                taskAction: {
                    type: "UpdateTitle",
                    titleUpdate: taskTitleTestScenario.update0,
                },
            },
        ]),
    ).rejects.toThrow(PermissionDeniedError);

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            taskId: taskId2,
            taskAction: {
                type: "UpdateParentTaskId",
                parentTaskIdAction: {
                    value: taskId1,
                    updatedTime: getCurrentTime(),
                },
            },
        },
    ]);

    await commitTaskSpaceActionTransaction(context.action(session2), space.id, [
        {
            type: "UpdateTask",
            taskId: taskId4,
            taskAction: {
                type: "UpdateTitle",
                titleUpdate: taskTitleTestScenario.update0,
            },
        },
    ]);

    await commitTaskSpaceActionTransaction(context.action(session2), space.id, [
        {
            type: "UpdateTask",
            taskId: taskId3,
            taskAction: {
                type: "UpdateTitle",
                titleUpdate: taskTitleTestScenario.update0,
            },
        },
    ]);

    await commitTaskSpaceActionTransaction(context.action(session2), space.id, [
        {
            type: "UpdateTask",
            taskId: taskId2,
            taskAction: {
                type: "UpdateTitle",
                titleUpdate: taskTitleTestScenario.update0,
            },
        },
    ]);
});

test("child tasks don't inherit the permissions of their deleted parent task", async () => {
    const taskId1 = generateId<TaskId>();
    const taskId2 = generateId<TaskId>();
    const collectionId = generateId<TaskCollectionId>();

    await commitTaskSpaceActionTransaction(context.action(session2), space.id, [
        {
            type: "UpdateTaskCollection",
            collectionId,
            collectionAction: {
                type: "Create",
                creatorId: taskAccount2.accountId,
                createdTime: getCurrentTime(),
                accessPolicy: new TaskCollectionAccessPolicyRegister(
                    {
                        accountGrantById: new Map([
                            [taskAccount2.accountId, {level: "Manage"}],
                            [taskAccount1.accountId, {level: "Edit"}],
                        ]),
                        defaultGrant: null,
                    },
                    getCurrentTime(),
                ),
            },
        },
        {
            type: "UpdateTask",
            taskId: taskId1,
            taskAction: {
                type: "Create",
                creator: taskAccount2,
                createdTime: getCurrentTaskTime(),
            },
        },
        {
            type: "UpdateTask",
            taskId: taskId1,
            taskAction: {
                type: "UpdateCollections",
                collectionsAction: {
                    type: "Set",
                    key: collectionId,
                    value: assertOrderKey("a0"),
                    updatedTime: getCurrentTime(),
                },
            },
        },
    ]);

    await commitTaskSpaceActionTransaction(context.action(session2), space.id, [
        {
            type: "UpdateTask",
            taskId: taskId2,
            taskAction: {
                type: "Create",
                creator: taskAccount2,
                createdTime: getCurrentTaskTime(),
            },
        },
    ]);

    await expect(
        commitTaskSpaceActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                taskId: taskId2,
                taskAction: {
                    type: "UpdateTitle",
                    titleUpdate: taskTitleTestScenario.update0,
                },
            },
        ]),
    ).rejects.toThrow(PermissionDeniedError);

    await commitTaskSpaceActionTransaction(context.action(session2), space.id, [
        {
            type: "UpdateTask",
            taskId: taskId2,
            taskAction: {
                type: "UpdateParentTaskId",
                parentTaskIdAction: {
                    value: taskId1,
                    updatedTime: getCurrentTime(),
                },
            },
        },
    ]);

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            taskId: taskId2,
            taskAction: {
                type: "UpdateTitle",
                titleUpdate: taskTitleTestScenario.update0,
            },
        },
    ]);

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            taskId: taskId1,
            taskAction: {
                type: "Delete",
                deletedTime: getCurrentTime(),
            },
        },
    ]);

    await expect(
        commitTaskSpaceActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                taskId: taskId2,
                taskAction: {
                    type: "UpdateTitle",
                    titleUpdate: taskTitleTestScenario.update1,
                },
            },
        ]),
    ).rejects.toThrow(PermissionDeniedError);
});

test("child tasks don't inherit the permissions of their deleted parent task multiple levels up", async () => {
    const taskId1 = generateId<TaskId>();
    const taskId2 = generateId<TaskId>();
    const taskId3 = generateId<TaskId>();
    const taskId4 = generateId<TaskId>();
    const collectionId = generateId<TaskCollectionId>();

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTaskCollection",
            collectionId,
            collectionAction: {
                type: "Create",
                creatorId: taskAccount1.accountId,
                createdTime: getCurrentTime(),
                accessPolicy: new TaskCollectionAccessPolicyRegister(
                    {
                        accountGrantById: new Map([
                            [taskAccount1.accountId, {level: "Manage"}],
                            [taskAccount2.accountId, {level: "Edit"}],
                        ]),
                        defaultGrant: null,
                    },
                    getCurrentTime(),
                ),
            },
        },
        {
            type: "UpdateTask",
            taskId: taskId1,
            taskAction: {
                type: "Create",
                creator: taskAccount1,
                createdTime: getCurrentTaskTime(),
            },
        },
        {
            type: "UpdateTask",
            taskId: taskId1,
            taskAction: {
                type: "UpdateCollections",
                collectionsAction: {
                    type: "Set",
                    key: collectionId,
                    value: assertOrderKey("a0"),
                    updatedTime: getCurrentTime(),
                },
            },
        },
    ]);

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            taskId: taskId2,
            taskAction: {
                type: "Create",
                creator: taskAccount1,
                createdTime: getCurrentTaskTime(),
            },
        },
    ]);

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            taskId: taskId3,
            taskAction: {
                type: "Create",
                creator: taskAccount1,
                createdTime: getCurrentTaskTime(),
            },
        },
    ]);

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            taskId: taskId4,
            taskAction: {
                type: "Create",
                creator: taskAccount1,
                createdTime: getCurrentTaskTime(),
            },
        },
    ]);

    await expect(
        commitTaskSpaceActionTransaction(context.action(session2), space.id, [
            {
                type: "UpdateTask",
                taskId: taskId4,
                taskAction: {
                    type: "UpdateTitle",
                    titleUpdate: taskTitleTestScenario.update0,
                },
            },
        ]),
    ).rejects.toThrow(PermissionDeniedError);

    await expect(
        commitTaskSpaceActionTransaction(context.action(session2), space.id, [
            {
                type: "UpdateTask",
                taskId: taskId3,
                taskAction: {
                    type: "UpdateTitle",
                    titleUpdate: taskTitleTestScenario.update0,
                },
            },
        ]),
    ).rejects.toThrow(PermissionDeniedError);

    await expect(
        commitTaskSpaceActionTransaction(context.action(session2), space.id, [
            {
                type: "UpdateTask",
                taskId: taskId2,
                taskAction: {
                    type: "UpdateTitle",
                    titleUpdate: taskTitleTestScenario.update0,
                },
            },
        ]),
    ).rejects.toThrow(PermissionDeniedError);

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            taskId: taskId4,
            taskAction: {
                type: "UpdateParentTaskId",
                parentTaskIdAction: {
                    value: taskId3,
                    updatedTime: getCurrentTime(),
                },
            },
        },
    ]);

    await expect(
        commitTaskSpaceActionTransaction(context.action(session2), space.id, [
            {
                type: "UpdateTask",
                taskId: taskId4,
                taskAction: {
                    type: "UpdateTitle",
                    titleUpdate: taskTitleTestScenario.update0,
                },
            },
        ]),
    ).rejects.toThrow(PermissionDeniedError);

    await expect(
        commitTaskSpaceActionTransaction(context.action(session2), space.id, [
            {
                type: "UpdateTask",
                taskId: taskId3,
                taskAction: {
                    type: "UpdateTitle",
                    titleUpdate: taskTitleTestScenario.update0,
                },
            },
        ]),
    ).rejects.toThrow(PermissionDeniedError);

    await expect(
        commitTaskSpaceActionTransaction(context.action(session2), space.id, [
            {
                type: "UpdateTask",
                taskId: taskId2,
                taskAction: {
                    type: "UpdateTitle",
                    titleUpdate: taskTitleTestScenario.update0,
                },
            },
        ]),
    ).rejects.toThrow(PermissionDeniedError);

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            taskId: taskId3,
            taskAction: {
                type: "UpdateParentTaskId",
                parentTaskIdAction: {
                    value: taskId2,
                    updatedTime: getCurrentTime(),
                },
            },
        },
    ]);

    await expect(
        commitTaskSpaceActionTransaction(context.action(session2), space.id, [
            {
                type: "UpdateTask",
                taskId: taskId4,
                taskAction: {
                    type: "UpdateTitle",
                    titleUpdate: taskTitleTestScenario.update0,
                },
            },
        ]),
    ).rejects.toThrow(PermissionDeniedError);

    await expect(
        commitTaskSpaceActionTransaction(context.action(session2), space.id, [
            {
                type: "UpdateTask",
                taskId: taskId3,
                taskAction: {
                    type: "UpdateTitle",
                    titleUpdate: taskTitleTestScenario.update0,
                },
            },
        ]),
    ).rejects.toThrow(PermissionDeniedError);

    await expect(
        commitTaskSpaceActionTransaction(context.action(session2), space.id, [
            {
                type: "UpdateTask",
                taskId: taskId2,
                taskAction: {
                    type: "UpdateTitle",
                    titleUpdate: taskTitleTestScenario.update0,
                },
            },
        ]),
    ).rejects.toThrow(PermissionDeniedError);

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            taskId: taskId2,
            taskAction: {
                type: "UpdateParentTaskId",
                parentTaskIdAction: {
                    value: taskId1,
                    updatedTime: getCurrentTime(),
                },
            },
        },
    ]);

    await commitTaskSpaceActionTransaction(context.action(session2), space.id, [
        {
            type: "UpdateTask",
            taskId: taskId4,
            taskAction: {
                type: "UpdateTitle",
                titleUpdate: taskTitleTestScenario.update0,
            },
        },
    ]);

    await commitTaskSpaceActionTransaction(context.action(session2), space.id, [
        {
            type: "UpdateTask",
            taskId: taskId3,
            taskAction: {
                type: "UpdateTitle",
                titleUpdate: taskTitleTestScenario.update0,
            },
        },
    ]);

    await commitTaskSpaceActionTransaction(context.action(session2), space.id, [
        {
            type: "UpdateTask",
            taskId: taskId2,
            taskAction: {
                type: "UpdateTitle",
                titleUpdate: taskTitleTestScenario.update0,
            },
        },
    ]);

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            taskId: taskId2,
            taskAction: {
                type: "Delete",
                deletedTime: getCurrentTime(),
            },
        },
    ]);

    await expect(
        commitTaskSpaceActionTransaction(context.action(session2), space.id, [
            {
                type: "UpdateTask",
                taskId: taskId4,
                taskAction: {
                    type: "UpdateTitle",
                    titleUpdate: taskTitleTestScenario.update1,
                },
            },
        ]),
    ).rejects.toThrow(PermissionDeniedError);

    await expect(
        commitTaskSpaceActionTransaction(context.action(session2), space.id, [
            {
                type: "UpdateTask",
                taskId: taskId3,
                taskAction: {
                    type: "UpdateTitle",
                    titleUpdate: taskTitleTestScenario.update1,
                },
            },
        ]),
    ).rejects.toThrow(PermissionDeniedError);
});

test("child tasks can be nested more than 5 levels deep", async () => {
    const taskId1 = generateId<TaskId>();
    const taskId2 = generateId<TaskId>();
    const taskId3 = generateId<TaskId>();
    const taskId4 = generateId<TaskId>();
    const taskId5 = generateId<TaskId>();
    const taskId6 = generateId<TaskId>();
    const taskId7 = generateId<TaskId>();

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            taskId: taskId1,
            taskAction: {
                type: "Create",
                creator: taskAccount1,
                createdTime: getCurrentTaskTime(),
            },
        },
    ]);

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            taskId: taskId2,
            taskAction: {
                type: "Create",
                creator: taskAccount1,
                createdTime: getCurrentTaskTime(),
            },
        },
    ]);

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            taskId: taskId3,
            taskAction: {
                type: "Create",
                creator: taskAccount1,
                createdTime: getCurrentTaskTime(),
            },
        },
    ]);

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            taskId: taskId4,
            taskAction: {
                type: "Create",
                creator: taskAccount1,
                createdTime: getCurrentTaskTime(),
            },
        },
    ]);

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            taskId: taskId5,
            taskAction: {
                type: "Create",
                creator: taskAccount1,
                createdTime: getCurrentTaskTime(),
            },
        },
    ]);

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            taskId: taskId6,
            taskAction: {
                type: "Create",
                creator: taskAccount1,
                createdTime: getCurrentTaskTime(),
            },
        },
    ]);

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            taskId: taskId7,
            taskAction: {
                type: "Create",
                creator: taskAccount1,
                createdTime: getCurrentTaskTime(),
            },
        },
    ]);

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            taskId: taskId2,
            taskAction: {
                type: "UpdateParentTaskId",
                parentTaskIdAction: {
                    value: taskId1,
                    updatedTime: getCurrentTime(),
                },
            },
        },
    ]);

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            taskId: taskId3,
            taskAction: {
                type: "UpdateParentTaskId",
                parentTaskIdAction: {
                    value: taskId2,
                    updatedTime: getCurrentTime(),
                },
            },
        },
    ]);

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            taskId: taskId4,
            taskAction: {
                type: "UpdateParentTaskId",
                parentTaskIdAction: {
                    value: taskId3,
                    updatedTime: getCurrentTime(),
                },
            },
        },
    ]);

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            taskId: taskId5,
            taskAction: {
                type: "UpdateParentTaskId",
                parentTaskIdAction: {
                    value: taskId4,
                    updatedTime: getCurrentTime(),
                },
            },
        },
    ]);

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            taskId: taskId6,
            taskAction: {
                type: "UpdateParentTaskId",
                parentTaskIdAction: {
                    value: taskId5,
                    updatedTime: getCurrentTime(),
                },
            },
        },
    ]);

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            taskId: taskId7,
            taskAction: {
                type: "UpdateParentTaskId",
                parentTaskIdAction: {
                    value: taskId6,
                    updatedTime: getCurrentTime(),
                },
            },
        },
    ]);
});

test("child tasks can't create a circular dependency", async () => {
    const taskId1 = generateId<TaskId>();
    const taskId2 = generateId<TaskId>();
    const taskId3 = generateId<TaskId>();
    const taskId4 = generateId<TaskId>();
    const taskId5 = generateId<TaskId>();

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            taskId: taskId1,
            taskAction: {
                type: "Create",
                creator: taskAccount1,
                createdTime: getCurrentTaskTime(),
            },
        },
    ]);

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            taskId: taskId2,
            taskAction: {
                type: "Create",
                creator: taskAccount1,
                createdTime: getCurrentTaskTime(),
            },
        },
    ]);

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            taskId: taskId3,
            taskAction: {
                type: "Create",
                creator: taskAccount1,
                createdTime: getCurrentTaskTime(),
            },
        },
    ]);

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            taskId: taskId4,
            taskAction: {
                type: "Create",
                creator: taskAccount1,
                createdTime: getCurrentTaskTime(),
            },
        },
    ]);

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            taskId: taskId5,
            taskAction: {
                type: "Create",
                creator: taskAccount1,
                createdTime: getCurrentTaskTime(),
            },
        },
    ]);

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            taskId: taskId2,
            taskAction: {
                type: "UpdateParentTaskId",
                parentTaskIdAction: {
                    value: taskId1,
                    updatedTime: getCurrentTime(),
                },
            },
        },
    ]);

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            taskId: taskId3,
            taskAction: {
                type: "UpdateParentTaskId",
                parentTaskIdAction: {
                    value: taskId2,
                    updatedTime: getCurrentTime(),
                },
            },
        },
    ]);

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            taskId: taskId4,
            taskAction: {
                type: "UpdateParentTaskId",
                parentTaskIdAction: {
                    value: taskId3,
                    updatedTime: getCurrentTime(),
                },
            },
        },
    ]);

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            taskId: taskId5,
            taskAction: {
                type: "UpdateParentTaskId",
                parentTaskIdAction: {
                    value: taskId4,
                    updatedTime: getCurrentTime(),
                },
            },
        },
    ]);

    await expect(
        commitTaskSpaceActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                taskId: taskId1,
                taskAction: {
                    type: "UpdateParentTaskId",
                    parentTaskIdAction: {
                        value: taskId5,
                        updatedTime: getCurrentTime(),
                    },
                },
            },
        ]),
    ).rejects.toThrow(
        new FailedPreconditionError(
            "Updating task's `parentTaskId` would create a circular dependency",
        ),
    );
});

test("child tasks can't create a circular dependency even in race conditions (2 tasks)", async () => {
    const taskId1 = generateId<TaskId>();
    const taskId2 = generateId<TaskId>();
    const collectionId = generateId<TaskCollectionId>();

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTaskCollection",
            collectionId,
            collectionAction: {
                type: "Create",
                creatorId: session1.accountId,
                createdTime: getCurrentTime(),
                accessPolicy: new TaskCollectionAccessPolicyRegister(
                    {
                        accountGrantById: new Map([[session1.accountId, {level: "Manage"}]]),
                        defaultGrant: {type: "Space", level: "Manage"},
                    },
                    getCurrentTime(),
                ),
            },
        },
    ]);

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            taskId: taskId1,
            taskAction: {
                type: "Create",
                creator: taskAccount1,
                createdTime: getCurrentTaskTime(),
            },
        },
        {
            type: "UpdateTask",
            taskId: taskId1,
            taskAction: {
                type: "UpdateCollections",
                collectionsAction: {
                    type: "Set",
                    key: collectionId,
                    value: assertOrderKey("a0"),
                    updatedTime: getCurrentTime(),
                },
            },
        },
    ]);

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            taskId: taskId2,
            taskAction: {
                type: "Create",
                creator: taskAccount1,
                createdTime: getCurrentTaskTime(),
            },
        },
        {
            type: "UpdateTask",
            taskId: taskId2,
            taskAction: {
                type: "UpdateCollections",
                collectionsAction: {
                    type: "Set",
                    key: collectionId,
                    value: assertOrderKey("a0"),
                    updatedTime: getCurrentTime(),
                },
            },
        },
    ]);

    const pausePromise = commitTaskSpaceActionTransactionBeforeExecuteTestCheckpoint.pauseForTest(
        session2.accountId,
    );

    const commitPromise = commitTaskSpaceActionTransaction(context.action(session2), space.id, [
        {
            type: "UpdateTask",
            taskId: taskId2,
            taskAction: {
                type: "UpdateParentTaskId",
                parentTaskIdAction: {
                    value: taskId1,
                    updatedTime: getCurrentTime(),
                },
            },
        },
    ]);

    const {unpause} = await pausePromise;

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            taskId: taskId1,
            taskAction: {
                type: "UpdateParentTaskId",
                parentTaskIdAction: {
                    value: taskId2,
                    updatedTime: getCurrentTime(),
                },
            },
        },
    ]);

    unpause();

    await expect(commitPromise).rejects.toThrow(
        new FailedPreconditionError(
            "Updating task's `parentTaskId` would create a circular dependency",
        ),
    );
});

test("child tasks can't create a circular dependency even in race conditions (3 tasks)", async () => {
    const taskId1 = generateId<TaskId>();
    const taskId2 = generateId<TaskId>();
    const taskId3 = generateId<TaskId>();
    const collectionId = generateId<TaskCollectionId>();

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTaskCollection",
            collectionId,
            collectionAction: {
                type: "Create",
                creatorId: session1.accountId,
                createdTime: getCurrentTime(),
                accessPolicy: new TaskCollectionAccessPolicyRegister(
                    {
                        accountGrantById: new Map([[session1.accountId, {level: "Manage"}]]),
                        defaultGrant: {type: "Space", level: "Manage"},
                    },
                    getCurrentTime(),
                ),
            },
        },
    ]);

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            taskId: taskId1,
            taskAction: {
                type: "Create",
                creator: taskAccount1,
                createdTime: getCurrentTaskTime(),
            },
        },
        {
            type: "UpdateTask",
            taskId: taskId1,
            taskAction: {
                type: "UpdateCollections",
                collectionsAction: {
                    type: "Set",
                    key: collectionId,
                    value: assertOrderKey("a0"),
                    updatedTime: getCurrentTime(),
                },
            },
        },
    ]);

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            taskId: taskId2,
            taskAction: {
                type: "Create",
                creator: taskAccount1,
                createdTime: getCurrentTaskTime(),
            },
        },
        {
            type: "UpdateTask",
            taskId: taskId2,
            taskAction: {
                type: "UpdateCollections",
                collectionsAction: {
                    type: "Set",
                    key: collectionId,
                    value: assertOrderKey("a0"),
                    updatedTime: getCurrentTime(),
                },
            },
        },
    ]);

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            taskId: taskId3,
            taskAction: {
                type: "Create",
                creator: taskAccount1,
                createdTime: getCurrentTaskTime(),
            },
        },
        {
            type: "UpdateTask",
            taskId: taskId3,
            taskAction: {
                type: "UpdateCollections",
                collectionsAction: {
                    type: "Set",
                    key: collectionId,
                    value: assertOrderKey("a0"),
                    updatedTime: getCurrentTime(),
                },
            },
        },
    ]);

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            taskId: taskId2,
            taskAction: {
                type: "UpdateParentTaskId",
                parentTaskIdAction: {
                    value: taskId1,
                    updatedTime: getCurrentTime(),
                },
            },
        },
    ]);

    const pausePromise = commitTaskSpaceActionTransactionBeforeExecuteTestCheckpoint.pauseForTest(
        session2.accountId,
    );

    const commitPromise = commitTaskSpaceActionTransaction(context.action(session2), space.id, [
        {
            type: "UpdateTask",
            taskId: taskId3,
            taskAction: {
                type: "UpdateParentTaskId",
                parentTaskIdAction: {
                    value: taskId2,
                    updatedTime: getCurrentTime(),
                },
            },
        },
    ]);

    const {unpause} = await pausePromise;

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            taskId: taskId1,
            taskAction: {
                type: "UpdateParentTaskId",
                parentTaskIdAction: {
                    value: taskId3,
                    updatedTime: getCurrentTime(),
                },
            },
        },
    ]);

    unpause();

    await expect(commitPromise).rejects.toThrow(
        new FailedPreconditionError(
            "Updating task's `parentTaskId` would create a circular dependency",
        ),
    );
});

test("child tasks can't create a circular dependency even in race conditions (5 tasks, scenario 1)", async () => {
    const taskId1 = generateId<TaskId>();
    const taskId2 = generateId<TaskId>();
    const taskId3 = generateId<TaskId>();
    const taskId4 = generateId<TaskId>();
    const taskId5 = generateId<TaskId>();
    const collectionId = generateId<TaskCollectionId>();

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTaskCollection",
            collectionId,
            collectionAction: {
                type: "Create",
                creatorId: session1.accountId,
                createdTime: getCurrentTime(),
                accessPolicy: new TaskCollectionAccessPolicyRegister(
                    {
                        accountGrantById: new Map([[session1.accountId, {level: "Manage"}]]),
                        defaultGrant: {type: "Space", level: "Manage"},
                    },
                    getCurrentTime(),
                ),
            },
        },
    ]);

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            taskId: taskId1,
            taskAction: {
                type: "Create",
                creator: taskAccount1,
                createdTime: getCurrentTaskTime(),
            },
        },
        {
            type: "UpdateTask",
            taskId: taskId1,
            taskAction: {
                type: "UpdateCollections",
                collectionsAction: {
                    type: "Set",
                    key: collectionId,
                    value: assertOrderKey("a0"),
                    updatedTime: getCurrentTime(),
                },
            },
        },
    ]);

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            taskId: taskId2,
            taskAction: {
                type: "Create",
                creator: taskAccount1,
                createdTime: getCurrentTaskTime(),
            },
        },
        {
            type: "UpdateTask",
            taskId: taskId2,
            taskAction: {
                type: "UpdateCollections",
                collectionsAction: {
                    type: "Set",
                    key: collectionId,
                    value: assertOrderKey("a0"),
                    updatedTime: getCurrentTime(),
                },
            },
        },
    ]);

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            taskId: taskId3,
            taskAction: {
                type: "Create",
                creator: taskAccount1,
                createdTime: getCurrentTaskTime(),
            },
        },
        {
            type: "UpdateTask",
            taskId: taskId3,
            taskAction: {
                type: "UpdateCollections",
                collectionsAction: {
                    type: "Set",
                    key: collectionId,
                    value: assertOrderKey("a0"),
                    updatedTime: getCurrentTime(),
                },
            },
        },
    ]);

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            taskId: taskId4,
            taskAction: {
                type: "Create",
                creator: taskAccount1,
                createdTime: getCurrentTaskTime(),
            },
        },
        {
            type: "UpdateTask",
            taskId: taskId4,
            taskAction: {
                type: "UpdateCollections",
                collectionsAction: {
                    type: "Set",
                    key: collectionId,
                    value: assertOrderKey("a0"),
                    updatedTime: getCurrentTime(),
                },
            },
        },
    ]);

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            taskId: taskId5,
            taskAction: {
                type: "Create",
                creator: taskAccount1,
                createdTime: getCurrentTaskTime(),
            },
        },
        {
            type: "UpdateTask",
            taskId: taskId5,
            taskAction: {
                type: "UpdateCollections",
                collectionsAction: {
                    type: "Set",
                    key: collectionId,
                    value: assertOrderKey("a0"),
                    updatedTime: getCurrentTime(),
                },
            },
        },
    ]);

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            taskId: taskId2,
            taskAction: {
                type: "UpdateParentTaskId",
                parentTaskIdAction: {
                    value: taskId1,
                    updatedTime: getCurrentTime(),
                },
            },
        },
    ]);

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            taskId: taskId3,
            taskAction: {
                type: "UpdateParentTaskId",
                parentTaskIdAction: {
                    value: taskId2,
                    updatedTime: getCurrentTime(),
                },
            },
        },
    ]);

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            taskId: taskId4,
            taskAction: {
                type: "UpdateParentTaskId",
                parentTaskIdAction: {
                    value: taskId3,
                    updatedTime: getCurrentTime(),
                },
            },
        },
    ]);

    const pausePromise = commitTaskSpaceActionTransactionBeforeExecuteTestCheckpoint.pauseForTest(
        session2.accountId,
    );

    const commitPromise = commitTaskSpaceActionTransaction(context.action(session2), space.id, [
        {
            type: "UpdateTask",
            taskId: taskId5,
            taskAction: {
                type: "UpdateParentTaskId",
                parentTaskIdAction: {
                    value: taskId4,
                    updatedTime: getCurrentTime(),
                },
            },
        },
    ]);

    const {unpause} = await pausePromise;

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            taskId: taskId1,
            taskAction: {
                type: "UpdateParentTaskId",
                parentTaskIdAction: {
                    value: taskId5,
                    updatedTime: getCurrentTime(),
                },
            },
        },
    ]);

    unpause();

    await expect(commitPromise).rejects.toThrow(
        new FailedPreconditionError(
            "Updating task's `parentTaskId` would create a circular dependency",
        ),
    );
});

test("child tasks can't create a circular dependency even in race conditions (5 tasks, scenario 2)", async () => {
    const taskId1 = generateId<TaskId>();
    const taskId2 = generateId<TaskId>();
    const taskId3 = generateId<TaskId>();
    const taskId4 = generateId<TaskId>();
    const taskId5 = generateId<TaskId>();
    const collectionId = generateId<TaskCollectionId>();

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTaskCollection",
            collectionId,
            collectionAction: {
                type: "Create",
                creatorId: session1.accountId,
                createdTime: getCurrentTime(),
                accessPolicy: new TaskCollectionAccessPolicyRegister(
                    {
                        accountGrantById: new Map([[session1.accountId, {level: "Manage"}]]),
                        defaultGrant: {type: "Space", level: "Manage"},
                    },
                    getCurrentTime(),
                ),
            },
        },
    ]);

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            taskId: taskId1,
            taskAction: {
                type: "Create",
                creator: taskAccount1,
                createdTime: getCurrentTaskTime(),
            },
        },
        {
            type: "UpdateTask",
            taskId: taskId1,
            taskAction: {
                type: "UpdateCollections",
                collectionsAction: {
                    type: "Set",
                    key: collectionId,
                    value: assertOrderKey("a0"),
                    updatedTime: getCurrentTime(),
                },
            },
        },
    ]);

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            taskId: taskId2,
            taskAction: {
                type: "Create",
                creator: taskAccount1,
                createdTime: getCurrentTaskTime(),
            },
        },
        {
            type: "UpdateTask",
            taskId: taskId2,
            taskAction: {
                type: "UpdateCollections",
                collectionsAction: {
                    type: "Set",
                    key: collectionId,
                    value: assertOrderKey("a0"),
                    updatedTime: getCurrentTime(),
                },
            },
        },
    ]);

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            taskId: taskId3,
            taskAction: {
                type: "Create",
                creator: taskAccount1,
                createdTime: getCurrentTaskTime(),
            },
        },
        {
            type: "UpdateTask",
            taskId: taskId3,
            taskAction: {
                type: "UpdateCollections",
                collectionsAction: {
                    type: "Set",
                    key: collectionId,
                    value: assertOrderKey("a0"),
                    updatedTime: getCurrentTime(),
                },
            },
        },
    ]);

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            taskId: taskId4,
            taskAction: {
                type: "Create",
                creator: taskAccount1,
                createdTime: getCurrentTaskTime(),
            },
        },
        {
            type: "UpdateTask",
            taskId: taskId4,
            taskAction: {
                type: "UpdateCollections",
                collectionsAction: {
                    type: "Set",
                    key: collectionId,
                    value: assertOrderKey("a0"),
                    updatedTime: getCurrentTime(),
                },
            },
        },
    ]);

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            taskId: taskId5,
            taskAction: {
                type: "Create",
                creator: taskAccount1,
                createdTime: getCurrentTaskTime(),
            },
        },
        {
            type: "UpdateTask",
            taskId: taskId5,
            taskAction: {
                type: "UpdateCollections",
                collectionsAction: {
                    type: "Set",
                    key: collectionId,
                    value: assertOrderKey("a0"),
                    updatedTime: getCurrentTime(),
                },
            },
        },
    ]);

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            taskId: taskId2,
            taskAction: {
                type: "UpdateParentTaskId",
                parentTaskIdAction: {
                    value: taskId1,
                    updatedTime: getCurrentTime(),
                },
            },
        },
    ]);

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            taskId: taskId3,
            taskAction: {
                type: "UpdateParentTaskId",
                parentTaskIdAction: {
                    value: taskId2,
                    updatedTime: getCurrentTime(),
                },
            },
        },
    ]);

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            taskId: taskId4,
            taskAction: {
                type: "UpdateParentTaskId",
                parentTaskIdAction: {
                    value: taskId3,
                    updatedTime: getCurrentTime(),
                },
            },
        },
    ]);

    const pausePromise = commitTaskSpaceActionTransactionBeforeExecuteTestCheckpoint.pauseForTest(
        session2.accountId,
    );

    const commitPromise = commitTaskSpaceActionTransaction(context.action(session2), space.id, [
        {
            type: "UpdateTask",
            taskId: taskId5,
            taskAction: {
                type: "UpdateParentTaskId",
                parentTaskIdAction: {
                    value: taskId4,
                    updatedTime: getCurrentTime(),
                },
            },
        },
    ]);

    const {unpause} = await pausePromise;

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            taskId: taskId3,
            taskAction: {
                type: "UpdateParentTaskId",
                parentTaskIdAction: {
                    value: taskId5,
                    updatedTime: getCurrentTime(),
                },
            },
        },
    ]);

    unpause();

    await expect(commitPromise).rejects.toThrow(
        new FailedPreconditionError(
            "Updating task's `parentTaskId` would create a circular dependency",
        ),
    );
});

test("child tasks can't create a circular dependency even in race conditions (5 tasks, scenario 3)", async () => {
    const taskId1 = generateId<TaskId>();
    const taskId2 = generateId<TaskId>();
    const taskId3 = generateId<TaskId>();
    const taskId4 = generateId<TaskId>();
    const taskId5 = generateId<TaskId>();
    const collectionId = generateId<TaskCollectionId>();

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTaskCollection",
            collectionId,
            collectionAction: {
                type: "Create",
                creatorId: session1.accountId,
                createdTime: getCurrentTime(),
                accessPolicy: new TaskCollectionAccessPolicyRegister(
                    {
                        accountGrantById: new Map([[session1.accountId, {level: "Manage"}]]),
                        defaultGrant: {type: "Space", level: "Manage"},
                    },
                    getCurrentTime(),
                ),
            },
        },
    ]);

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            taskId: taskId1,
            taskAction: {
                type: "Create",
                creator: taskAccount1,
                createdTime: getCurrentTaskTime(),
            },
        },
        {
            type: "UpdateTask",
            taskId: taskId1,
            taskAction: {
                type: "UpdateCollections",
                collectionsAction: {
                    type: "Set",
                    key: collectionId,
                    value: assertOrderKey("a0"),
                    updatedTime: getCurrentTime(),
                },
            },
        },
    ]);

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            taskId: taskId2,
            taskAction: {
                type: "Create",
                creator: taskAccount1,
                createdTime: getCurrentTaskTime(),
            },
        },
        {
            type: "UpdateTask",
            taskId: taskId2,
            taskAction: {
                type: "UpdateCollections",
                collectionsAction: {
                    type: "Set",
                    key: collectionId,
                    value: assertOrderKey("a0"),
                    updatedTime: getCurrentTime(),
                },
            },
        },
    ]);

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            taskId: taskId3,
            taskAction: {
                type: "Create",
                creator: taskAccount1,
                createdTime: getCurrentTaskTime(),
            },
        },
        {
            type: "UpdateTask",
            taskId: taskId3,
            taskAction: {
                type: "UpdateCollections",
                collectionsAction: {
                    type: "Set",
                    key: collectionId,
                    value: assertOrderKey("a0"),
                    updatedTime: getCurrentTime(),
                },
            },
        },
    ]);

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            taskId: taskId4,
            taskAction: {
                type: "Create",
                creator: taskAccount1,
                createdTime: getCurrentTaskTime(),
            },
        },
        {
            type: "UpdateTask",
            taskId: taskId4,
            taskAction: {
                type: "UpdateCollections",
                collectionsAction: {
                    type: "Set",
                    key: collectionId,
                    value: assertOrderKey("a0"),
                    updatedTime: getCurrentTime(),
                },
            },
        },
    ]);

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            taskId: taskId5,
            taskAction: {
                type: "Create",
                creator: taskAccount1,
                createdTime: getCurrentTaskTime(),
            },
        },
        {
            type: "UpdateTask",
            taskId: taskId5,
            taskAction: {
                type: "UpdateCollections",
                collectionsAction: {
                    type: "Set",
                    key: collectionId,
                    value: assertOrderKey("a0"),
                    updatedTime: getCurrentTime(),
                },
            },
        },
    ]);

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            taskId: taskId2,
            taskAction: {
                type: "UpdateParentTaskId",
                parentTaskIdAction: {
                    value: taskId1,
                    updatedTime: getCurrentTime(),
                },
            },
        },
    ]);

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            taskId: taskId3,
            taskAction: {
                type: "UpdateParentTaskId",
                parentTaskIdAction: {
                    value: taskId2,
                    updatedTime: getCurrentTime(),
                },
            },
        },
    ]);

    const pausePromise = commitTaskSpaceActionTransactionBeforeExecuteTestCheckpoint.pauseForTest(
        session2.accountId,
    );

    const commitPromise = commitTaskSpaceActionTransaction(context.action(session2), space.id, [
        {
            type: "UpdateTask",
            taskId: taskId5,
            taskAction: {
                type: "UpdateParentTaskId",
                parentTaskIdAction: {
                    value: taskId4,
                    updatedTime: getCurrentTime(),
                },
            },
        },
    ]);

    const {unpause} = await pausePromise;

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            taskId: taskId4,
            taskAction: {
                type: "UpdateParentTaskId",
                parentTaskIdAction: {
                    value: taskId3,
                    updatedTime: getCurrentTime(),
                },
            },
        },
    ]);

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            taskId: taskId3,
            taskAction: {
                type: "UpdateParentTaskId",
                parentTaskIdAction: {
                    value: taskId5,
                    updatedTime: getCurrentTime(),
                },
            },
        },
    ]);

    unpause();

    await expect(commitPromise).rejects.toThrow(
        new FailedPreconditionError(
            "Updating task's `parentTaskId` would create a circular dependency",
        ),
    );
});

test("child tasks can't create a circular dependency even in race conditions (5 tasks, scenario 4)", async () => {
    const taskId1 = generateId<TaskId>();
    const taskId2 = generateId<TaskId>();
    const taskId3 = generateId<TaskId>();
    const taskId4 = generateId<TaskId>();
    const taskId5 = generateId<TaskId>();
    const collectionId = generateId<TaskCollectionId>();

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTaskCollection",
            collectionId,
            collectionAction: {
                type: "Create",
                creatorId: session1.accountId,
                createdTime: getCurrentTime(),
                accessPolicy: new TaskCollectionAccessPolicyRegister(
                    {
                        accountGrantById: new Map([[session1.accountId, {level: "Manage"}]]),
                        defaultGrant: {type: "Space", level: "Manage"},
                    },
                    getCurrentTime(),
                ),
            },
        },
    ]);

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            taskId: taskId1,
            taskAction: {
                type: "Create",
                creator: taskAccount1,
                createdTime: getCurrentTaskTime(),
            },
        },
        {
            type: "UpdateTask",
            taskId: taskId1,
            taskAction: {
                type: "UpdateCollections",
                collectionsAction: {
                    type: "Set",
                    key: collectionId,
                    value: assertOrderKey("a0"),
                    updatedTime: getCurrentTime(),
                },
            },
        },
    ]);

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            taskId: taskId2,
            taskAction: {
                type: "Create",
                creator: taskAccount1,
                createdTime: getCurrentTaskTime(),
            },
        },
        {
            type: "UpdateTask",
            taskId: taskId2,
            taskAction: {
                type: "UpdateCollections",
                collectionsAction: {
                    type: "Set",
                    key: collectionId,
                    value: assertOrderKey("a0"),
                    updatedTime: getCurrentTime(),
                },
            },
        },
    ]);

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            taskId: taskId3,
            taskAction: {
                type: "Create",
                creator: taskAccount1,
                createdTime: getCurrentTaskTime(),
            },
        },
        {
            type: "UpdateTask",
            taskId: taskId3,
            taskAction: {
                type: "UpdateCollections",
                collectionsAction: {
                    type: "Set",
                    key: collectionId,
                    value: assertOrderKey("a0"),
                    updatedTime: getCurrentTime(),
                },
            },
        },
    ]);

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            taskId: taskId4,
            taskAction: {
                type: "Create",
                creator: taskAccount1,
                createdTime: getCurrentTaskTime(),
            },
        },
        {
            type: "UpdateTask",
            taskId: taskId4,
            taskAction: {
                type: "UpdateCollections",
                collectionsAction: {
                    type: "Set",
                    key: collectionId,
                    value: assertOrderKey("a0"),
                    updatedTime: getCurrentTime(),
                },
            },
        },
    ]);

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            taskId: taskId5,
            taskAction: {
                type: "Create",
                creator: taskAccount1,
                createdTime: getCurrentTaskTime(),
            },
        },
        {
            type: "UpdateTask",
            taskId: taskId5,
            taskAction: {
                type: "UpdateCollections",
                collectionsAction: {
                    type: "Set",
                    key: collectionId,
                    value: assertOrderKey("a0"),
                    updatedTime: getCurrentTime(),
                },
            },
        },
    ]);

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            taskId: taskId2,
            taskAction: {
                type: "UpdateParentTaskId",
                parentTaskIdAction: {
                    value: taskId1,
                    updatedTime: getCurrentTime(),
                },
            },
        },
    ]);

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            taskId: taskId3,
            taskAction: {
                type: "UpdateParentTaskId",
                parentTaskIdAction: {
                    value: taskId2,
                    updatedTime: getCurrentTime(),
                },
            },
        },
    ]);

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            taskId: taskId5,
            taskAction: {
                type: "UpdateParentTaskId",
                parentTaskIdAction: {
                    value: taskId4,
                    updatedTime: getCurrentTime(),
                },
            },
        },
    ]);

    const pausePromise = commitTaskSpaceActionTransactionBeforeExecuteTestCheckpoint.pauseForTest(
        session2.accountId,
    );

    const commitPromise = commitTaskSpaceActionTransaction(context.action(session2), space.id, [
        {
            type: "UpdateTask",
            taskId: taskId4,
            taskAction: {
                type: "UpdateParentTaskId",
                parentTaskIdAction: {
                    value: taskId3,
                    updatedTime: getCurrentTime(),
                },
            },
        },
    ]);

    const {unpause} = await pausePromise;

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            taskId: taskId1,
            taskAction: {
                type: "UpdateParentTaskId",
                parentTaskIdAction: {
                    value: taskId5,
                    updatedTime: getCurrentTime(),
                },
            },
        },
    ]);

    unpause();

    await expect(commitPromise).rejects.toThrow(
        new FailedPreconditionError(
            "Updating task's `parentTaskId` would create a circular dependency",
        ),
    );
});

test("child tasks can't create a circular dependency even in race conditions (5 tasks, scenario 5)", async () => {
    const taskId1 = generateId<TaskId>();
    const taskId2 = generateId<TaskId>();
    const taskId3 = generateId<TaskId>();
    const taskId4 = generateId<TaskId>();
    const taskId5 = generateId<TaskId>();
    const collectionId = generateId<TaskCollectionId>();

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTaskCollection",
            collectionId,
            collectionAction: {
                type: "Create",
                creatorId: session1.accountId,
                createdTime: getCurrentTime(),
                accessPolicy: new TaskCollectionAccessPolicyRegister(
                    {
                        accountGrantById: new Map([[session1.accountId, {level: "Manage"}]]),
                        defaultGrant: {type: "Space", level: "Manage"},
                    },
                    getCurrentTime(),
                ),
            },
        },
    ]);

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            taskId: taskId1,
            taskAction: {
                type: "Create",
                creator: taskAccount1,
                createdTime: getCurrentTaskTime(),
            },
        },
        {
            type: "UpdateTask",
            taskId: taskId1,
            taskAction: {
                type: "UpdateCollections",
                collectionsAction: {
                    type: "Set",
                    key: collectionId,
                    value: assertOrderKey("a0"),
                    updatedTime: getCurrentTime(),
                },
            },
        },
    ]);

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            taskId: taskId2,
            taskAction: {
                type: "Create",
                creator: taskAccount1,
                createdTime: getCurrentTaskTime(),
            },
        },
        {
            type: "UpdateTask",
            taskId: taskId2,
            taskAction: {
                type: "UpdateCollections",
                collectionsAction: {
                    type: "Set",
                    key: collectionId,
                    value: assertOrderKey("a0"),
                    updatedTime: getCurrentTime(),
                },
            },
        },
    ]);

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            taskId: taskId3,
            taskAction: {
                type: "Create",
                creator: taskAccount1,
                createdTime: getCurrentTaskTime(),
            },
        },
        {
            type: "UpdateTask",
            taskId: taskId3,
            taskAction: {
                type: "UpdateCollections",
                collectionsAction: {
                    type: "Set",
                    key: collectionId,
                    value: assertOrderKey("a0"),
                    updatedTime: getCurrentTime(),
                },
            },
        },
    ]);

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            taskId: taskId4,
            taskAction: {
                type: "Create",
                creator: taskAccount1,
                createdTime: getCurrentTaskTime(),
            },
        },
        {
            type: "UpdateTask",
            taskId: taskId4,
            taskAction: {
                type: "UpdateCollections",
                collectionsAction: {
                    type: "Set",
                    key: collectionId,
                    value: assertOrderKey("a0"),
                    updatedTime: getCurrentTime(),
                },
            },
        },
    ]);

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            taskId: taskId5,
            taskAction: {
                type: "Create",
                creator: taskAccount1,
                createdTime: getCurrentTaskTime(),
            },
        },
        {
            type: "UpdateTask",
            taskId: taskId5,
            taskAction: {
                type: "UpdateCollections",
                collectionsAction: {
                    type: "Set",
                    key: collectionId,
                    value: assertOrderKey("a0"),
                    updatedTime: getCurrentTime(),
                },
            },
        },
    ]);

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            taskId: taskId2,
            taskAction: {
                type: "UpdateParentTaskId",
                parentTaskIdAction: {
                    value: taskId1,
                    updatedTime: getCurrentTime(),
                },
            },
        },
    ]);

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            taskId: taskId3,
            taskAction: {
                type: "UpdateParentTaskId",
                parentTaskIdAction: {
                    value: taskId2,
                    updatedTime: getCurrentTime(),
                },
            },
        },
    ]);

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            taskId: taskId5,
            taskAction: {
                type: "UpdateParentTaskId",
                parentTaskIdAction: {
                    value: taskId4,
                    updatedTime: getCurrentTime(),
                },
            },
        },
    ]);

    const pausePromise = commitTaskSpaceActionTransactionBeforeExecuteTestCheckpoint.pauseForTest(
        session2.accountId,
    );

    const commitPromise = commitTaskSpaceActionTransaction(context.action(session2), space.id, [
        {
            type: "UpdateTask",
            taskId: taskId4,
            taskAction: {
                type: "UpdateParentTaskId",
                parentTaskIdAction: {
                    value: taskId3,
                    updatedTime: getCurrentTime(),
                },
            },
        },
    ]);

    const {unpause} = await pausePromise;

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            taskId: taskId2,
            taskAction: {
                type: "UpdateParentTaskId",
                parentTaskIdAction: {
                    value: taskId5,
                    updatedTime: getCurrentTime(),
                },
            },
        },
    ]);

    unpause();

    await expect(commitPromise).rejects.toThrow(
        new FailedPreconditionError(
            "Updating task's `parentTaskId` would create a circular dependency",
        ),
    );
});

test("child tasks can't create a circular dependency even in race conditions (9 tasks)", async () => {
    const taskId1 = generateId<TaskId>();
    const taskId2 = generateId<TaskId>();
    const taskId3 = generateId<TaskId>();
    const taskId4 = generateId<TaskId>();
    const taskId5 = generateId<TaskId>();
    const taskId6 = generateId<TaskId>();
    const taskId7 = generateId<TaskId>();
    const taskId8 = generateId<TaskId>();
    const taskId9 = generateId<TaskId>();
    const collectionId = generateId<TaskCollectionId>();

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTaskCollection",
            collectionId,
            collectionAction: {
                type: "Create",
                creatorId: session1.accountId,
                createdTime: getCurrentTime(),
                accessPolicy: new TaskCollectionAccessPolicyRegister(
                    {
                        accountGrantById: new Map([[session1.accountId, {level: "Manage"}]]),
                        defaultGrant: {type: "Space", level: "Manage"},
                    },
                    getCurrentTime(),
                ),
            },
        },
    ]);

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            taskId: taskId1,
            taskAction: {
                type: "Create",
                creator: taskAccount1,
                createdTime: getCurrentTaskTime(),
            },
        },
        {
            type: "UpdateTask",
            taskId: taskId1,
            taskAction: {
                type: "UpdateCollections",
                collectionsAction: {
                    type: "Set",
                    key: collectionId,
                    value: assertOrderKey("a0"),
                    updatedTime: getCurrentTime(),
                },
            },
        },
    ]);

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            taskId: taskId2,
            taskAction: {
                type: "Create",
                creator: taskAccount1,
                createdTime: getCurrentTaskTime(),
            },
        },
        {
            type: "UpdateTask",
            taskId: taskId2,
            taskAction: {
                type: "UpdateCollections",
                collectionsAction: {
                    type: "Set",
                    key: collectionId,
                    value: assertOrderKey("a0"),
                    updatedTime: getCurrentTime(),
                },
            },
        },
    ]);

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            taskId: taskId3,
            taskAction: {
                type: "Create",
                creator: taskAccount1,
                createdTime: getCurrentTaskTime(),
            },
        },
        {
            type: "UpdateTask",
            taskId: taskId3,
            taskAction: {
                type: "UpdateCollections",
                collectionsAction: {
                    type: "Set",
                    key: collectionId,
                    value: assertOrderKey("a0"),
                    updatedTime: getCurrentTime(),
                },
            },
        },
    ]);

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            taskId: taskId4,
            taskAction: {
                type: "Create",
                creator: taskAccount1,
                createdTime: getCurrentTaskTime(),
            },
        },
        {
            type: "UpdateTask",
            taskId: taskId4,
            taskAction: {
                type: "UpdateCollections",
                collectionsAction: {
                    type: "Set",
                    key: collectionId,
                    value: assertOrderKey("a0"),
                    updatedTime: getCurrentTime(),
                },
            },
        },
    ]);

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            taskId: taskId5,
            taskAction: {
                type: "Create",
                creator: taskAccount1,
                createdTime: getCurrentTaskTime(),
            },
        },
        {
            type: "UpdateTask",
            taskId: taskId5,
            taskAction: {
                type: "UpdateCollections",
                collectionsAction: {
                    type: "Set",
                    key: collectionId,
                    value: assertOrderKey("a0"),
                    updatedTime: getCurrentTime(),
                },
            },
        },
    ]);

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            taskId: taskId6,
            taskAction: {
                type: "Create",
                creator: taskAccount1,
                createdTime: getCurrentTaskTime(),
            },
        },
        {
            type: "UpdateTask",
            taskId: taskId6,
            taskAction: {
                type: "UpdateCollections",
                collectionsAction: {
                    type: "Set",
                    key: collectionId,
                    value: assertOrderKey("a0"),
                    updatedTime: getCurrentTime(),
                },
            },
        },
    ]);

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            taskId: taskId7,
            taskAction: {
                type: "Create",
                creator: taskAccount1,
                createdTime: getCurrentTaskTime(),
            },
        },
        {
            type: "UpdateTask",
            taskId: taskId7,
            taskAction: {
                type: "UpdateCollections",
                collectionsAction: {
                    type: "Set",
                    key: collectionId,
                    value: assertOrderKey("a0"),
                    updatedTime: getCurrentTime(),
                },
            },
        },
    ]);

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            taskId: taskId8,
            taskAction: {
                type: "Create",
                creator: taskAccount1,
                createdTime: getCurrentTaskTime(),
            },
        },
        {
            type: "UpdateTask",
            taskId: taskId8,
            taskAction: {
                type: "UpdateCollections",
                collectionsAction: {
                    type: "Set",
                    key: collectionId,
                    value: assertOrderKey("a0"),
                    updatedTime: getCurrentTime(),
                },
            },
        },
    ]);

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            taskId: taskId9,
            taskAction: {
                type: "Create",
                creator: taskAccount1,
                createdTime: getCurrentTaskTime(),
            },
        },
        {
            type: "UpdateTask",
            taskId: taskId9,
            taskAction: {
                type: "UpdateCollections",
                collectionsAction: {
                    type: "Set",
                    key: collectionId,
                    value: assertOrderKey("a0"),
                    updatedTime: getCurrentTime(),
                },
            },
        },
    ]);

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            taskId: taskId2,
            taskAction: {
                type: "UpdateParentTaskId",
                parentTaskIdAction: {
                    value: taskId1,
                    updatedTime: getCurrentTime(),
                },
            },
        },
    ]);

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            taskId: taskId3,
            taskAction: {
                type: "UpdateParentTaskId",
                parentTaskIdAction: {
                    value: taskId2,
                    updatedTime: getCurrentTime(),
                },
            },
        },
    ]);

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            taskId: taskId4,
            taskAction: {
                type: "UpdateParentTaskId",
                parentTaskIdAction: {
                    value: taskId3,
                    updatedTime: getCurrentTime(),
                },
            },
        },
    ]);

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            taskId: taskId6,
            taskAction: {
                type: "UpdateParentTaskId",
                parentTaskIdAction: {
                    value: taskId5,
                    updatedTime: getCurrentTime(),
                },
            },
        },
    ]);

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            taskId: taskId7,
            taskAction: {
                type: "UpdateParentTaskId",
                parentTaskIdAction: {
                    value: taskId6,
                    updatedTime: getCurrentTime(),
                },
            },
        },
    ]);

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            taskId: taskId8,
            taskAction: {
                type: "UpdateParentTaskId",
                parentTaskIdAction: {
                    value: taskId7,
                    updatedTime: getCurrentTime(),
                },
            },
        },
    ]);

    const pausePromise = commitTaskSpaceActionTransactionBeforeExecuteTestCheckpoint.pauseForTest(
        session2.accountId,
    );

    const commitPromise = commitTaskSpaceActionTransaction(context.action(session2), space.id, [
        {
            type: "UpdateTask",
            taskId: taskId6,
            taskAction: {
                type: "UpdateParentTaskId",
                parentTaskIdAction: {
                    value: taskId4,
                    updatedTime: getCurrentTime(),
                },
            },
        },
    ]);

    const {unpause} = await pausePromise;

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            taskId: taskId3,
            taskAction: {
                type: "UpdateParentTaskId",
                parentTaskIdAction: {
                    value: null,
                    updatedTime: getCurrentTime(),
                },
            },
        },
    ]);

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            taskId: taskId3,
            taskAction: {
                type: "UpdateParentTaskId",
                parentTaskIdAction: {
                    value: taskId9,
                    updatedTime: getCurrentTime(),
                },
            },
        },
    ]);

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            taskId: taskId9,
            taskAction: {
                type: "UpdateParentTaskId",
                parentTaskIdAction: {
                    value: taskId8,
                    updatedTime: getCurrentTime(),
                },
            },
        },
    ]);

    unpause();

    await expect(commitPromise).rejects.toThrow(
        new FailedPreconditionError(
            "Updating task's `parentTaskId` would create a circular dependency",
        ),
    );
});

test("can create circular dependency involving deleted task", async () => {
    const taskId1 = generateId<TaskId>();
    const taskId2 = generateId<TaskId>();
    const taskId3 = generateId<TaskId>();
    const taskId4 = generateId<TaskId>();

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            taskId: taskId1,
            taskAction: {
                type: "Create",
                creator: taskAccount1,
                createdTime: getCurrentTaskTime(),
            },
        },
    ]);

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            taskId: taskId2,
            taskAction: {
                type: "Create",
                creator: taskAccount1,
                createdTime: getCurrentTaskTime(),
            },
        },
    ]);

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            taskId: taskId3,
            taskAction: {
                type: "Create",
                creator: taskAccount1,
                createdTime: getCurrentTaskTime(),
            },
        },
    ]);

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            taskId: taskId4,
            taskAction: {
                type: "Create",
                creator: taskAccount1,
                createdTime: getCurrentTaskTime(),
            },
        },
    ]);

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            taskId: taskId2,
            taskAction: {
                type: "UpdateParentTaskId",
                parentTaskIdAction: {
                    value: taskId1,
                    updatedTime: getCurrentTime(),
                },
            },
        },
    ]);

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            taskId: taskId3,
            taskAction: {
                type: "UpdateParentTaskId",
                parentTaskIdAction: {
                    value: taskId2,
                    updatedTime: getCurrentTime(),
                },
            },
        },
    ]);

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            taskId: taskId4,
            taskAction: {
                type: "UpdateParentTaskId",
                parentTaskIdAction: {
                    value: taskId3,
                    updatedTime: getCurrentTime(),
                },
            },
        },
    ]);

    await expect(
        commitTaskSpaceActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                taskId: taskId1,
                taskAction: {
                    type: "UpdateParentTaskId",
                    parentTaskIdAction: {
                        value: taskId4,
                        updatedTime: getCurrentTime(),
                    },
                },
            },
        ]),
    ).rejects.toThrow(
        new FailedPreconditionError(
            "Updating task's `parentTaskId` would create a circular dependency",
        ),
    );

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            taskId: taskId2,
            taskAction: {
                type: "Delete",
                deletedTime: getCurrentTime(),
            },
        },
    ]);

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            taskId: taskId1,
            taskAction: {
                type: "UpdateParentTaskId",
                parentTaskIdAction: {
                    value: taskId4,
                    updatedTime: getCurrentTime(),
                },
            },
        },
    ]);

    await expect(
        commitTaskSpaceActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                taskId: taskId2,
                taskAction: {
                    type: "Undelete",
                    undeletedTime: getCurrentTime(),
                },
            },
        ]),
    ).rejects.toThrow(
        new FailedPreconditionError("Undeleting task would create a circular dependency"),
    );
});

test("can use undelete to create circular dependency involving deleted task", async () => {
    const taskId1 = generateId<TaskId>();
    const taskId2 = generateId<TaskId>();
    const taskId3 = generateId<TaskId>();
    const taskId4 = generateId<TaskId>();

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            taskId: taskId1,
            taskAction: {
                type: "Create",
                creator: taskAccount1,
                createdTime: getCurrentTaskTime(),
            },
        },
    ]);

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            taskId: taskId2,
            taskAction: {
                type: "Create",
                creator: taskAccount1,
                createdTime: getCurrentTaskTime(),
            },
        },
    ]);

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            taskId: taskId3,
            taskAction: {
                type: "Create",
                creator: taskAccount1,
                createdTime: getCurrentTaskTime(),
            },
        },
    ]);

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            taskId: taskId4,
            taskAction: {
                type: "Create",
                creator: taskAccount1,
                createdTime: getCurrentTaskTime(),
            },
        },
    ]);

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            taskId: taskId2,
            taskAction: {
                type: "UpdateParentTaskId",
                parentTaskIdAction: {
                    value: taskId1,
                    updatedTime: getCurrentTime(),
                },
            },
        },
    ]);

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            taskId: taskId3,
            taskAction: {
                type: "UpdateParentTaskId",
                parentTaskIdAction: {
                    value: taskId2,
                    updatedTime: getCurrentTime(),
                },
            },
        },
    ]);

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            taskId: taskId4,
            taskAction: {
                type: "UpdateParentTaskId",
                parentTaskIdAction: {
                    value: taskId3,
                    updatedTime: getCurrentTime(),
                },
            },
        },
    ]);

    await expect(
        commitTaskSpaceActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                taskId: taskId1,
                taskAction: {
                    type: "UpdateParentTaskId",
                    parentTaskIdAction: {
                        value: taskId4,
                        updatedTime: getCurrentTime(),
                    },
                },
            },
        ]),
    ).rejects.toThrow(
        new FailedPreconditionError(
            "Updating task's `parentTaskId` would create a circular dependency",
        ),
    );

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            taskId: taskId2,
            taskAction: {
                type: "Delete",
                deletedTime: getCurrentTime(),
            },
        },
    ]);

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            taskId: taskId1,
            taskAction: {
                type: "UpdateParentTaskId",
                parentTaskIdAction: {
                    value: taskId4,
                    updatedTime: getCurrentTime(),
                },
            },
        },
    ]);

    await expect(
        commitTaskSpaceActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                taskId: taskId2,
                taskAction: {
                    type: "Undelete",
                    undeletedTime: getCurrentTime(),
                },
            },
        ]),
    ).rejects.toThrow(
        new FailedPreconditionError("Undeleting task would create a circular dependency"),
    );

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            taskId: taskId3,
            taskAction: {
                type: "Delete",
                deletedTime: getCurrentTime(),
            },
        },
    ]);

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            taskId: taskId2,
            taskAction: {
                type: "Undelete",
                undeletedTime: getCurrentTime(),
            },
        },
    ]);

    await expect(
        commitTaskSpaceActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                taskId: taskId3,
                taskAction: {
                    type: "Undelete",
                    undeletedTime: getCurrentTime(),
                },
            },
        ]),
    ).rejects.toThrow(
        new FailedPreconditionError("Undeleting task would create a circular dependency"),
    );
});

test("can't create a circular dependency with undelete even in race conditions", async () => {
    const taskId1 = generateId<TaskId>();
    const taskId2 = generateId<TaskId>();
    const taskId3 = generateId<TaskId>();
    const taskId4 = generateId<TaskId>();
    const taskId5 = generateId<TaskId>();
    const collectionId = generateId<TaskCollectionId>();

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTaskCollection",
            collectionId,
            collectionAction: {
                type: "Create",
                creatorId: session1.accountId,
                createdTime: getCurrentTime(),
                accessPolicy: new TaskCollectionAccessPolicyRegister(
                    {
                        accountGrantById: new Map([[session1.accountId, {level: "Manage"}]]),
                        defaultGrant: {type: "Space", level: "Manage"},
                    },
                    getCurrentTime(),
                ),
            },
        },
    ]);

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            taskId: taskId1,
            taskAction: {
                type: "Create",
                creator: taskAccount1,
                createdTime: getCurrentTaskTime(),
            },
        },
        {
            type: "UpdateTask",
            taskId: taskId1,
            taskAction: {
                type: "UpdateCollections",
                collectionsAction: {
                    type: "Set",
                    key: collectionId,
                    value: assertOrderKey("a0"),
                    updatedTime: getCurrentTime(),
                },
            },
        },
    ]);

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            taskId: taskId2,
            taskAction: {
                type: "Create",
                creator: taskAccount1,
                createdTime: getCurrentTaskTime(),
            },
        },
        {
            type: "UpdateTask",
            taskId: taskId2,
            taskAction: {
                type: "UpdateCollections",
                collectionsAction: {
                    type: "Set",
                    key: collectionId,
                    value: assertOrderKey("a0"),
                    updatedTime: getCurrentTime(),
                },
            },
        },
    ]);

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            taskId: taskId3,
            taskAction: {
                type: "Create",
                creator: taskAccount1,
                createdTime: getCurrentTaskTime(),
            },
        },
        {
            type: "UpdateTask",
            taskId: taskId3,
            taskAction: {
                type: "UpdateCollections",
                collectionsAction: {
                    type: "Set",
                    key: collectionId,
                    value: assertOrderKey("a0"),
                    updatedTime: getCurrentTime(),
                },
            },
        },
    ]);

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            taskId: taskId4,
            taskAction: {
                type: "Create",
                creator: taskAccount1,
                createdTime: getCurrentTaskTime(),
            },
        },
        {
            type: "UpdateTask",
            taskId: taskId4,
            taskAction: {
                type: "UpdateCollections",
                collectionsAction: {
                    type: "Set",
                    key: collectionId,
                    value: assertOrderKey("a0"),
                    updatedTime: getCurrentTime(),
                },
            },
        },
    ]);

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            taskId: taskId5,
            taskAction: {
                type: "Create",
                creator: taskAccount1,
                createdTime: getCurrentTaskTime(),
            },
        },
        {
            type: "UpdateTask",
            taskId: taskId5,
            taskAction: {
                type: "UpdateCollections",
                collectionsAction: {
                    type: "Set",
                    key: collectionId,
                    value: assertOrderKey("a0"),
                    updatedTime: getCurrentTime(),
                },
            },
        },
    ]);

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            taskId: taskId2,
            taskAction: {
                type: "UpdateParentTaskId",
                parentTaskIdAction: {
                    value: taskId1,
                    updatedTime: getCurrentTime(),
                },
            },
        },
    ]);

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            taskId: taskId3,
            taskAction: {
                type: "UpdateParentTaskId",
                parentTaskIdAction: {
                    value: taskId2,
                    updatedTime: getCurrentTime(),
                },
            },
        },
    ]);

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            taskId: taskId4,
            taskAction: {
                type: "UpdateParentTaskId",
                parentTaskIdAction: {
                    value: taskId3,
                    updatedTime: getCurrentTime(),
                },
            },
        },
    ]);

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            taskId: taskId5,
            taskAction: {
                type: "UpdateParentTaskId",
                parentTaskIdAction: {
                    value: taskId4,
                    updatedTime: getCurrentTime(),
                },
            },
        },
    ]);

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            taskId: taskId2,
            taskAction: {
                type: "Delete",
                deletedTime: getCurrentTime(),
            },
        },
    ]);

    const pausePromise = commitTaskSpaceActionTransactionBeforeExecuteTestCheckpoint.pauseForTest(
        session2.accountId,
    );

    const commitPromise = commitTaskSpaceActionTransaction(context.action(session2), space.id, [
        {
            type: "UpdateTask",
            taskId: taskId1,
            taskAction: {
                type: "UpdateParentTaskId",
                parentTaskIdAction: {
                    value: taskId5,
                    updatedTime: getCurrentTime(),
                },
            },
        },
    ]);

    const {unpause} = await pausePromise;

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            taskId: taskId2,
            taskAction: {
                type: "Undelete",
                undeletedTime: getCurrentTime(),
            },
        },
    ]);

    unpause();

    await expect(commitPromise).rejects.toThrow(
        new FailedPreconditionError(
            "Updating task's `parentTaskId` would create a circular dependency",
        ),
    );
});

test("can create a circular dependency with delete", async () => {
    const taskId1 = generateId<TaskId>();
    const taskId2 = generateId<TaskId>();
    const taskId3 = generateId<TaskId>();
    const taskId4 = generateId<TaskId>();
    const taskId5 = generateId<TaskId>();
    const collectionId = generateId<TaskCollectionId>();

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTaskCollection",
            collectionId,
            collectionAction: {
                type: "Create",
                creatorId: session1.accountId,
                createdTime: getCurrentTime(),
                accessPolicy: new TaskCollectionAccessPolicyRegister(
                    {
                        accountGrantById: new Map([[session1.accountId, {level: "Manage"}]]),
                        defaultGrant: {type: "Space", level: "Manage"},
                    },
                    getCurrentTime(),
                ),
            },
        },
    ]);

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            taskId: taskId1,
            taskAction: {
                type: "Create",
                creator: taskAccount1,
                createdTime: getCurrentTaskTime(),
            },
        },
        {
            type: "UpdateTask",
            taskId: taskId1,
            taskAction: {
                type: "UpdateCollections",
                collectionsAction: {
                    type: "Set",
                    key: collectionId,
                    value: assertOrderKey("a0"),
                    updatedTime: getCurrentTime(),
                },
            },
        },
    ]);

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            taskId: taskId2,
            taskAction: {
                type: "Create",
                creator: taskAccount1,
                createdTime: getCurrentTaskTime(),
            },
        },
        {
            type: "UpdateTask",
            taskId: taskId2,
            taskAction: {
                type: "UpdateCollections",
                collectionsAction: {
                    type: "Set",
                    key: collectionId,
                    value: assertOrderKey("a0"),
                    updatedTime: getCurrentTime(),
                },
            },
        },
    ]);

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            taskId: taskId3,
            taskAction: {
                type: "Create",
                creator: taskAccount1,
                createdTime: getCurrentTaskTime(),
            },
        },
        {
            type: "UpdateTask",
            taskId: taskId3,
            taskAction: {
                type: "UpdateCollections",
                collectionsAction: {
                    type: "Set",
                    key: collectionId,
                    value: assertOrderKey("a0"),
                    updatedTime: getCurrentTime(),
                },
            },
        },
    ]);

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            taskId: taskId4,
            taskAction: {
                type: "Create",
                creator: taskAccount1,
                createdTime: getCurrentTaskTime(),
            },
        },
        {
            type: "UpdateTask",
            taskId: taskId4,
            taskAction: {
                type: "UpdateCollections",
                collectionsAction: {
                    type: "Set",
                    key: collectionId,
                    value: assertOrderKey("a0"),
                    updatedTime: getCurrentTime(),
                },
            },
        },
    ]);

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            taskId: taskId5,
            taskAction: {
                type: "Create",
                creator: taskAccount1,
                createdTime: getCurrentTaskTime(),
            },
        },
        {
            type: "UpdateTask",
            taskId: taskId5,
            taskAction: {
                type: "UpdateCollections",
                collectionsAction: {
                    type: "Set",
                    key: collectionId,
                    value: assertOrderKey("a0"),
                    updatedTime: getCurrentTime(),
                },
            },
        },
    ]);

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            taskId: taskId2,
            taskAction: {
                type: "UpdateParentTaskId",
                parentTaskIdAction: {
                    value: taskId1,
                    updatedTime: getCurrentTime(),
                },
            },
        },
    ]);

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            taskId: taskId3,
            taskAction: {
                type: "UpdateParentTaskId",
                parentTaskIdAction: {
                    value: taskId2,
                    updatedTime: getCurrentTime(),
                },
            },
        },
    ]);

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            taskId: taskId4,
            taskAction: {
                type: "UpdateParentTaskId",
                parentTaskIdAction: {
                    value: taskId3,
                    updatedTime: getCurrentTime(),
                },
            },
        },
    ]);

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            taskId: taskId5,
            taskAction: {
                type: "UpdateParentTaskId",
                parentTaskIdAction: {
                    value: taskId4,
                    updatedTime: getCurrentTime(),
                },
            },
        },
    ]);

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            taskId: taskId2,
            taskAction: {
                type: "Delete",
                deletedTime: getCurrentTime(),
            },
        },
    ]);

    await commitTaskSpaceActionTransaction(context.action(session2), space.id, [
        {
            type: "UpdateTask",
            taskId: taskId1,
            taskAction: {
                type: "UpdateParentTaskId",
                parentTaskIdAction: {
                    value: taskId5,
                    updatedTime: getCurrentTime(),
                },
            },
        },
    ]);
});

test("can remove the parent of a child task when you don't have access to the parent task", async () => {
    const taskId1 = generateId<TaskId>();
    const taskId2 = generateId<TaskId>();
    const collectionId1 = generateId<TaskCollectionId>();
    const collectionId2 = generateId<TaskCollectionId>();

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTaskCollection",
            collectionId: collectionId1,
            collectionAction: {
                type: "Create",
                creatorId: session1.accountId,
                createdTime: getCurrentTime(),
                accessPolicy: new TaskCollectionAccessPolicyRegister(
                    {
                        accountGrantById: new Map([[session1.accountId, {level: "Manage"}]]),
                        defaultGrant: null,
                    },
                    getCurrentTime(),
                ),
            },
        },
        {
            type: "UpdateTaskCollection",
            collectionId: collectionId2,
            collectionAction: {
                type: "Create",
                creatorId: session1.accountId,
                createdTime: getCurrentTime(),
                accessPolicy: new TaskCollectionAccessPolicyRegister(
                    {
                        accountGrantById: new Map([[session1.accountId, {level: "Manage"}]]),
                        defaultGrant: {type: "Space", level: "Manage"},
                    },
                    getCurrentTime(),
                ),
            },
        },
        {
            type: "UpdateTask",
            taskId: taskId1,
            taskAction: {
                type: "Create",
                creator: taskAccount1,
                createdTime: getCurrentTaskTime(),
            },
        },
        {
            type: "UpdateTask",
            taskId: taskId1,
            taskAction: {
                type: "UpdateCollections",
                collectionsAction: {
                    type: "Set",
                    key: collectionId1,
                    value: assertOrderKey("a0"),
                    updatedTime: getCurrentTime(),
                },
            },
        },
    ]);

    await commitTaskSpaceActionTransaction(context.action(session2), space.id, [
        {
            type: "UpdateTask",
            taskId: taskId2,
            taskAction: {
                type: "Create",
                creator: taskAccount2,
                createdTime: getCurrentTaskTime(),
            },
        },
        {
            type: "UpdateTask",
            taskId: taskId2,
            taskAction: {
                type: "UpdateCollections",
                collectionsAction: {
                    type: "Set",
                    key: collectionId2,
                    value: assertOrderKey("a0"),
                    updatedTime: getCurrentTime(),
                },
            },
        },
    ]);

    await expect(
        commitTaskSpaceActionTransaction(context.action(session2), space.id, [
            {
                type: "UpdateTask",
                taskId: taskId2,
                taskAction: {
                    type: "UpdateParentTaskId",
                    parentTaskIdAction: {
                        value: taskId1,
                        updatedTime: getCurrentTime(),
                    },
                },
            },
        ]),
    ).rejects.toThrow(PermissionDeniedError);

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            taskId: taskId2,
            taskAction: {
                type: "UpdateParentTaskId",
                parentTaskIdAction: {
                    value: taskId1,
                    updatedTime: getCurrentTime(),
                },
            },
        },
    ]);

    await commitTaskSpaceActionTransaction(context.action(session2), space.id, [
        {
            type: "UpdateTask",
            taskId: taskId2,
            taskAction: {
                type: "UpdateParentTaskId",
                parentTaskIdAction: {
                    value: null,
                    updatedTime: getCurrentTime(),
                },
            },
        },
    ]);
});

test("can change the parent of a child task when you don't have access to the parent task", async () => {
    const taskId1 = generateId<TaskId>();
    const taskId2 = generateId<TaskId>();
    const taskId3 = generateId<TaskId>();
    const collectionId1 = generateId<TaskCollectionId>();
    const collectionId2 = generateId<TaskCollectionId>();

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTaskCollection",
            collectionId: collectionId1,
            collectionAction: {
                type: "Create",
                creatorId: session1.accountId,
                createdTime: getCurrentTime(),
                accessPolicy: new TaskCollectionAccessPolicyRegister(
                    {
                        accountGrantById: new Map([[session1.accountId, {level: "Manage"}]]),
                        defaultGrant: null,
                    },
                    getCurrentTime(),
                ),
            },
        },
        {
            type: "UpdateTaskCollection",
            collectionId: collectionId2,
            collectionAction: {
                type: "Create",
                creatorId: session1.accountId,
                createdTime: getCurrentTime(),
                accessPolicy: new TaskCollectionAccessPolicyRegister(
                    {
                        accountGrantById: new Map([[session1.accountId, {level: "Manage"}]]),
                        defaultGrant: {type: "Space", level: "Manage"},
                    },
                    getCurrentTime(),
                ),
            },
        },
        {
            type: "UpdateTask",
            taskId: taskId1,
            taskAction: {
                type: "Create",
                creator: taskAccount1,
                createdTime: getCurrentTaskTime(),
            },
        },
        {
            type: "UpdateTask",
            taskId: taskId1,
            taskAction: {
                type: "UpdateCollections",
                collectionsAction: {
                    type: "Set",
                    key: collectionId1,
                    value: assertOrderKey("a0"),
                    updatedTime: getCurrentTime(),
                },
            },
        },
    ]);

    await commitTaskSpaceActionTransaction(context.action(session2), space.id, [
        {
            type: "UpdateTask",
            taskId: taskId2,
            taskAction: {
                type: "Create",
                creator: taskAccount2,
                createdTime: getCurrentTaskTime(),
            },
        },
        {
            type: "UpdateTask",
            taskId: taskId2,
            taskAction: {
                type: "UpdateCollections",
                collectionsAction: {
                    type: "Set",
                    key: collectionId2,
                    value: assertOrderKey("a0"),
                    updatedTime: getCurrentTime(),
                },
            },
        },
        {
            type: "UpdateTask",
            taskId: taskId3,
            taskAction: {
                type: "Create",
                creator: taskAccount2,
                createdTime: getCurrentTaskTime(),
            },
        },
        {
            type: "UpdateTask",
            taskId: taskId3,
            taskAction: {
                type: "UpdateCollections",
                collectionsAction: {
                    type: "Set",
                    key: collectionId2,
                    value: assertOrderKey("a0"),
                    updatedTime: getCurrentTime(),
                },
            },
        },
    ]);

    await expect(
        commitTaskSpaceActionTransaction(context.action(session2), space.id, [
            {
                type: "UpdateTask",
                taskId: taskId2,
                taskAction: {
                    type: "UpdateParentTaskId",
                    parentTaskIdAction: {
                        value: taskId1,
                        updatedTime: getCurrentTime(),
                    },
                },
            },
        ]),
    ).rejects.toThrow(PermissionDeniedError);

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            taskId: taskId2,
            taskAction: {
                type: "UpdateParentTaskId",
                parentTaskIdAction: {
                    value: taskId1,
                    updatedTime: getCurrentTime(),
                },
            },
        },
    ]);

    await commitTaskSpaceActionTransaction(context.action(session2), space.id, [
        {
            type: "UpdateTask",
            taskId: taskId2,
            taskAction: {
                type: "UpdateParentTaskId",
                parentTaskIdAction: {
                    value: taskId3,
                    updatedTime: getCurrentTime(),
                },
            },
        },
    ]);
});

test("can delete a child task when you don't have access to the parent task", async () => {
    const taskId1 = generateId<TaskId>();
    const taskId2 = generateId<TaskId>();
    const collectionId1 = generateId<TaskCollectionId>();
    const collectionId2 = generateId<TaskCollectionId>();

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTaskCollection",
            collectionId: collectionId1,
            collectionAction: {
                type: "Create",
                creatorId: session1.accountId,
                createdTime: getCurrentTime(),
                accessPolicy: new TaskCollectionAccessPolicyRegister(
                    {
                        accountGrantById: new Map([[session1.accountId, {level: "Manage"}]]),
                        defaultGrant: null,
                    },
                    getCurrentTime(),
                ),
            },
        },
        {
            type: "UpdateTaskCollection",
            collectionId: collectionId2,
            collectionAction: {
                type: "Create",
                creatorId: session1.accountId,
                createdTime: getCurrentTime(),
                accessPolicy: new TaskCollectionAccessPolicyRegister(
                    {
                        accountGrantById: new Map([[session1.accountId, {level: "Manage"}]]),
                        defaultGrant: {type: "Space", level: "Manage"},
                    },
                    getCurrentTime(),
                ),
            },
        },
        {
            type: "UpdateTask",
            taskId: taskId1,
            taskAction: {
                type: "Create",
                creator: taskAccount1,
                createdTime: getCurrentTaskTime(),
            },
        },
        {
            type: "UpdateTask",
            taskId: taskId1,
            taskAction: {
                type: "UpdateCollections",
                collectionsAction: {
                    type: "Set",
                    key: collectionId1,
                    value: assertOrderKey("a0"),
                    updatedTime: getCurrentTime(),
                },
            },
        },
    ]);

    await commitTaskSpaceActionTransaction(context.action(session2), space.id, [
        {
            type: "UpdateTask",
            taskId: taskId2,
            taskAction: {
                type: "Create",
                creator: taskAccount2,
                createdTime: getCurrentTaskTime(),
            },
        },
        {
            type: "UpdateTask",
            taskId: taskId2,
            taskAction: {
                type: "UpdateCollections",
                collectionsAction: {
                    type: "Set",
                    key: collectionId2,
                    value: assertOrderKey("a0"),
                    updatedTime: getCurrentTime(),
                },
            },
        },
    ]);

    await expect(
        commitTaskSpaceActionTransaction(context.action(session2), space.id, [
            {
                type: "UpdateTask",
                taskId: taskId2,
                taskAction: {
                    type: "UpdateParentTaskId",
                    parentTaskIdAction: {
                        value: taskId1,
                        updatedTime: getCurrentTime(),
                    },
                },
            },
        ]),
    ).rejects.toThrow(PermissionDeniedError);

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            taskId: taskId2,
            taskAction: {
                type: "UpdateParentTaskId",
                parentTaskIdAction: {
                    value: taskId1,
                    updatedTime: getCurrentTime(),
                },
            },
        },
    ]);

    await commitTaskSpaceActionTransaction(context.action(session2), space.id, [
        {
            type: "UpdateTask",
            taskId: taskId2,
            taskAction: {
                type: "Delete",
                deletedTime: getCurrentTime(),
            },
        },
    ]);
});

test("can't update task parent order key when there is no parent", async () => {
    const taskId = generateId<TaskId>();

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            taskId,
            taskAction: {
                type: "Create",
                creator: taskAccount1,
                createdTime: getCurrentTaskTime(),
            },
        },
    ]);

    await expect(
        commitTaskSpaceActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                taskId,
                taskAction: {
                    type: "UpdateParentPosition",
                    parentPositionAction: {
                        value: {orderTime: getCurrentTime(), orderKey: initialOrderKey},
                        updatedTime: getCurrentTime(),
                    },
                },
            },
        ]),
    ).rejects.toThrow(new FailedPreconditionError("Task does not have a parent"));
});

test("can update task parent order key", async () => {
    const taskId1 = generateId<TaskId>();
    const taskId2 = generateId<TaskId>();

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            taskId: taskId1,
            taskAction: {
                type: "Create",
                creator: taskAccount1,
                createdTime: getCurrentTaskTime(),
            },
        },
        {
            type: "UpdateTask",
            taskId: taskId2,
            taskAction: {
                type: "Create",
                creator: taskAccount1,
                createdTime: getCurrentTaskTime(),
            },
        },
        {
            type: "UpdateTask",
            taskId: taskId2,
            taskAction: {
                type: "UpdateParentTaskId",
                parentTaskIdAction: {
                    value: taskId1,
                    updatedTime: getCurrentTime(),
                },
            },
        },
    ]);

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            taskId: taskId2,
            taskAction: {
                type: "UpdateParentPosition",
                parentPositionAction: {
                    value: {orderTime: getCurrentTime(), orderKey: initialOrderKey},
                    updatedTime: getCurrentTime(),
                },
            },
        },
    ]);
});

test("can't update task parent order key with unreasonable updated time", async () => {
    const taskId1 = generateId<TaskId>();
    const taskId2 = generateId<TaskId>();

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            taskId: taskId1,
            taskAction: {
                type: "Create",
                creator: taskAccount1,
                createdTime: getCurrentTaskTime(),
            },
        },
        {
            type: "UpdateTask",
            taskId: taskId2,
            taskAction: {
                type: "Create",
                creator: taskAccount1,
                createdTime: getCurrentTaskTime(),
            },
        },
        {
            type: "UpdateTask",
            taskId: taskId2,
            taskAction: {
                type: "UpdateParentTaskId",
                parentTaskIdAction: {
                    value: taskId1,
                    updatedTime: getCurrentTime(),
                },
            },
        },
    ]);

    await expect(
        commitTaskSpaceActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                taskId: taskId2,
                taskAction: {
                    type: "UpdateParentPosition",
                    parentPositionAction: {
                        value: {orderTime: getCurrentTime(), orderKey: initialOrderKey},
                        updatedTime: getUnreasonableTime(),
                    },
                },
            },
        ]),
    ).rejects.toThrow(new InvalidArgumentError("Action `updatedTime` is too far in the future"));
});

test("can't update task parent order key when parent is deleted", async () => {
    const taskId1 = generateId<TaskId>();
    const taskId2 = generateId<TaskId>();

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            taskId: taskId1,
            taskAction: {
                type: "Create",
                creator: taskAccount1,
                createdTime: getCurrentTaskTime(),
            },
        },
        {
            type: "UpdateTask",
            taskId: taskId2,
            taskAction: {
                type: "Create",
                creator: taskAccount1,
                createdTime: getCurrentTaskTime(),
            },
        },
        {
            type: "UpdateTask",
            taskId: taskId2,
            taskAction: {
                type: "UpdateParentTaskId",
                parentTaskIdAction: {
                    value: taskId1,
                    updatedTime: getCurrentTime(),
                },
            },
        },
    ]);

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            taskId: taskId1,
            taskAction: {
                type: "Delete",
                deletedTime: getCurrentTime(),
            },
        },
    ]);

    await expect(
        commitTaskSpaceActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                taskId: taskId2,
                taskAction: {
                    type: "UpdateParentPosition",
                    parentPositionAction: {
                        value: {orderTime: getCurrentTime(), orderKey: initialOrderKey},
                        updatedTime: getCurrentTime(),
                    },
                },
            },
        ]),
    ).rejects.toThrow(new FailedPreconditionError("Parent task is deleted"));
});

test("can't update task parent order key when you don't have edit access to parent", async () => {
    const taskId1 = generateId<TaskId>();
    const taskId2 = generateId<TaskId>();
    const collectionId = generateId<TaskCollectionId>();

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            taskId: taskId1,
            taskAction: {
                type: "Create",
                creator: taskAccount1,
                createdTime: getCurrentTaskTime(),
            },
        },
    ]);

    await commitTaskSpaceActionTransaction(context.action(session2), space.id, [
        {
            type: "UpdateTaskCollection",
            collectionId,
            collectionAction: {
                type: "Create",
                creatorId: session2.accountId,
                createdTime: getCurrentTime(),
                accessPolicy: new TaskCollectionAccessPolicyRegister(
                    {
                        accountGrantById: new Map([]),
                        defaultGrant: {type: "Space", level: "Manage"},
                    },
                    getCurrentTime(),
                ),
            },
        },
        {
            type: "UpdateTask",
            taskId: taskId2,
            taskAction: {
                type: "Create",
                creator: taskAccount2,
                createdTime: getCurrentTaskTime(),
            },
        },
        {
            type: "UpdateTask",
            taskId: taskId2,
            taskAction: {
                type: "UpdateCollections",
                collectionsAction: {
                    type: "Set",
                    key: collectionId,
                    value: assertOrderKey("a0"),
                    updatedTime: getCurrentTime(),
                },
            },
        },
    ]);

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            taskId: taskId2,
            taskAction: {
                type: "UpdateParentTaskId",
                parentTaskIdAction: {
                    value: taskId1,
                    updatedTime: getCurrentTime(),
                },
            },
        },
    ]);

    await expect(
        commitTaskSpaceActionTransaction(context.action(session2), space.id, [
            {
                type: "UpdateTask",
                taskId: taskId2,
                taskAction: {
                    type: "UpdateParentPosition",
                    parentPositionAction: {
                        value: {orderTime: getCurrentTime(), orderKey: initialOrderKey},
                        updatedTime: getCurrentTime(),
                    },
                },
            },
        ]),
    ).rejects.toThrow(PermissionDeniedError);

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            taskId: taskId2,
            taskAction: {
                type: "UpdateParentPosition",
                parentPositionAction: {
                    value: {orderTime: getCurrentTime(), orderKey: initialOrderKey},
                    updatedTime: getCurrentTime(),
                },
            },
        },
    ]);
});

test("can't update task parent order key if order time is unreasonable", async () => {
    const taskId1 = generateId<TaskId>();
    const taskId2 = generateId<TaskId>();

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            taskId: taskId1,
            taskAction: {
                type: "Create",
                creator: taskAccount1,
                createdTime: getCurrentTaskTime(),
            },
        },
        {
            type: "UpdateTask",
            taskId: taskId2,
            taskAction: {
                type: "Create",
                creator: taskAccount1,
                createdTime: getCurrentTaskTime(),
            },
        },
        {
            type: "UpdateTask",
            taskId: taskId2,
            taskAction: {
                type: "UpdateParentTaskId",
                parentTaskIdAction: {
                    value: taskId1,
                    updatedTime: getCurrentTime(),
                },
            },
        },
    ]);

    await expect(
        commitTaskSpaceActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                taskId: taskId2,
                taskAction: {
                    type: "UpdateParentPosition",
                    parentPositionAction: {
                        value: {orderTime: getUnreasonableTime(), orderKey: initialOrderKey},
                        updatedTime: getCurrentTime(),
                    },
                },
            },
        ]),
    ).rejects.toThrow(new InvalidArgumentError("Action `orderTime` is too far in the future"));
});

test("can update task status", async () => {
    const taskId = generateId<TaskId>();

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            taskId,
            taskAction: {
                type: "Create",
                creator: taskAccount1,
                createdTime: getCurrentTaskTime(),
            },
        },
    ]);

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            taskId,
            taskAction: {
                type: "UpdateStatus",
                statusAction: {
                    value: {type: "Closed", closer: taskAccount1, closedTime: getCurrentTaskTime()},
                    updatedTime: getCurrentTime(),
                },
            },
        },
    ]);

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            taskId,
            taskAction: {
                type: "UpdateStatus",
                statusAction: {
                    value: {type: "Open"},
                    updatedTime: getCurrentTime(),
                },
            },
        },
    ]);
});

test("can't update task status with unreasonable updated time", async () => {
    const taskId = generateId<TaskId>();

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            taskId,
            taskAction: {
                type: "Create",
                creator: taskAccount1,
                createdTime: getCurrentTaskTime(),
            },
        },
    ]);

    await expect(
        commitTaskSpaceActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                taskId,
                taskAction: {
                    type: "UpdateStatus",
                    statusAction: {
                        value: {
                            type: "Closed",
                            closer: taskAccount1,
                            closedTime: getCurrentTaskTime(),
                        },
                        updatedTime: getUnreasonableTime(),
                    },
                },
            },
        ]),
    ).rejects.toThrow(new InvalidArgumentError("Action `updatedTime` is too far in the future"));
});

test("can't update task status with unreasonable closed time", async () => {
    const taskId = generateId<TaskId>();

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            taskId,
            taskAction: {
                type: "Create",
                creator: taskAccount1,
                createdTime: getCurrentTaskTime(),
            },
        },
    ]);

    await expect(
        commitTaskSpaceActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                taskId,
                taskAction: {
                    type: "UpdateStatus",
                    statusAction: {
                        value: {
                            type: "Closed",
                            closer: taskAccount1,
                            closedTime: getUnreasonableTaskTime(),
                        },
                        updatedTime: getCurrentTime(),
                    },
                },
            },
        ]),
    ).rejects.toThrow(new InvalidArgumentError("Action `closedTime` is too far in the future"));
});

test("can't update task status with a closer other than your account", async () => {
    const taskId = generateId<TaskId>();

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            taskId,
            taskAction: {
                type: "Create",
                creator: taskAccount1,
                createdTime: getCurrentTaskTime(),
            },
        },
    ]);

    await expect(
        commitTaskSpaceActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                taskId,
                taskAction: {
                    type: "UpdateStatus",
                    statusAction: {
                        value: {
                            type: "Closed",
                            closer: taskAccount2,
                            closedTime: getCurrentTaskTime(),
                        },
                        updatedTime: getCurrentTime(),
                    },
                },
            },
        ]),
    ).rejects.toThrow(
        new PermissionDeniedError("Can only close a task with yourself as the closer"),
    );
});

test("can update task assignee", async () => {
    const taskId = generateId<TaskId>();

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            taskId,
            taskAction: {
                type: "Create",
                creator: taskAccount1,
                createdTime: getCurrentTaskTime(),
            },
        },
    ]);

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            taskId,
            taskAction: {
                type: "UpdateAssignee",
                assigneeAction: {
                    value: {
                        assignee: taskAccount2,
                        assigner: taskAccount1,
                        assignedTime: getCurrentTaskTime(),
                    },
                    updatedTime: getCurrentTime(),
                },
            },
        },
    ]);

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            taskId,
            taskAction: {
                type: "UpdateAssignee",
                assigneeAction: {
                    value: null,
                    updatedTime: getCurrentTime(),
                },
            },
        },
    ]);

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            taskId,
            taskAction: {
                type: "UpdateAssignee",
                assigneeAction: {
                    value: {
                        assignee: taskAccount1,
                        assigner: taskAccount1,
                        assignedTime: getCurrentTaskTime(),
                    },
                    updatedTime: getCurrentTime(),
                },
            },
        },
    ]);
});

test("can't update task assignee with unreasonable updated time", async () => {
    const taskId = generateId<TaskId>();

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            taskId,
            taskAction: {
                type: "Create",
                creator: taskAccount1,
                createdTime: getCurrentTaskTime(),
            },
        },
    ]);

    await expect(
        commitTaskSpaceActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                taskId,
                taskAction: {
                    type: "UpdateAssignee",
                    assigneeAction: {
                        value: {
                            assignee: taskAccount2,
                            assigner: taskAccount1,
                            assignedTime: getCurrentTaskTime(),
                        },
                        updatedTime: getUnreasonableTime(),
                    },
                },
            },
        ]),
    ).rejects.toThrow(new InvalidArgumentError("Action `updatedTime` is too far in the future"));
});

test("can't update task assignee with unreasonable assigned time", async () => {
    const taskId = generateId<TaskId>();

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            taskId,
            taskAction: {
                type: "Create",
                creator: taskAccount1,
                createdTime: getCurrentTaskTime(),
            },
        },
    ]);

    await expect(
        commitTaskSpaceActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                taskId,
                taskAction: {
                    type: "UpdateAssignee",
                    assigneeAction: {
                        value: {
                            assignee: taskAccount2,
                            assigner: taskAccount1,
                            assignedTime: getUnreasonableTaskTime(),
                        },
                        updatedTime: getCurrentTime(),
                    },
                },
            },
        ]),
    ).rejects.toThrow(new InvalidArgumentError("Action `assignedTime` is too far in the future"));
});

test("can't update task assignee with an assigner other than your account", async () => {
    const taskId = generateId<TaskId>();

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            taskId,
            taskAction: {
                type: "Create",
                creator: taskAccount1,
                createdTime: getCurrentTaskTime(),
            },
        },
    ]);

    await expect(
        commitTaskSpaceActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                taskId,
                taskAction: {
                    type: "UpdateAssignee",
                    assigneeAction: {
                        value: {
                            assignee: taskAccount2,
                            assigner: taskAccount2,
                            assignedTime: getCurrentTaskTime(),
                        },
                        updatedTime: getCurrentTime(),
                    },
                },
            },
        ]),
    ).rejects.toThrow(
        new PermissionDeniedError("Can only assign a task with yourself as the assigner"),
    );
});

test("can't update task assignee with an assignee outside the current space", async () => {
    const taskId = generateId<TaskId>();

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            taskId,
            taskAction: {
                type: "Create",
                creator: taskAccount1,
                createdTime: getCurrentTaskTime(),
            },
        },
    ]);

    await expect(
        commitTaskSpaceActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                taskId,
                taskAction: {
                    type: "UpdateAssignee",
                    assigneeAction: {
                        value: {
                            assignee: otherTaskAccount,
                            assigner: taskAccount1,
                            assignedTime: getCurrentTaskTime(),
                        },
                        updatedTime: getCurrentTime(),
                    },
                },
            },
        ]),
    ).rejects.toThrow(
        new FailedPreconditionError(
            "Can't assign a task to an account outside of the current space",
        ),
    );
});

test("can update task assignee status", async () => {
    const taskId = generateId<TaskId>();
    const collectionId = generateId<TaskCollectionId>();

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTaskCollection",
            collectionId,
            collectionAction: {
                type: "Create",
                creatorId: taskAccount1.accountId,
                createdTime: getCurrentTime(),
                accessPolicy: new TaskCollectionAccessPolicyRegister(
                    {
                        accountGrantById: new Map([]),
                        defaultGrant: {type: "Space", level: "Manage"},
                    },
                    getCurrentTime(),
                ),
            },
        },
        {
            type: "UpdateTask",
            taskId,
            taskAction: {
                type: "Create",
                creator: taskAccount1,
                createdTime: getCurrentTaskTime(),
            },
        },
        {
            type: "UpdateTask",
            taskId,
            taskAction: {
                type: "UpdateCollections",
                collectionsAction: {
                    type: "Set",
                    key: collectionId,
                    value: assertOrderKey("a0"),
                    updatedTime: getCurrentTime(),
                },
            },
        },
    ]);

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            taskId,
            taskAction: {
                type: "UpdateAssignee",
                assigneeAction: {
                    value: {
                        assignee: taskAccount2,
                        assigner: taskAccount1,
                        assignedTime: getCurrentTaskTime(),
                    },
                    updatedTime: getCurrentTime(),
                },
            },
        },
    ]);

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            taskId,
            taskAction: {
                type: "UpdateAssigneeStatus",
                assigneeStatusAction: {
                    value: {
                        type: "Active",
                        position: {orderTime: getCurrentTime(), orderKey: initialOrderKey},
                        activatedTime: getCurrentTaskTime(),
                    },
                    updatedTime: getCurrentTime(),
                },
            },
        },
    ]);

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            taskId,
            taskAction: {
                type: "UpdateAssigneeStatus",
                assigneeStatusAction: {
                    value: {type: "Inactive"},
                    updatedTime: getCurrentTime(),
                },
            },
        },
    ]);

    await commitTaskSpaceActionTransaction(context.action(session2), space.id, [
        {
            type: "UpdateTask",
            taskId,
            taskAction: {
                type: "UpdateAssigneeStatus",
                assigneeStatusAction: {
                    value: {
                        type: "Active",
                        position: {orderTime: getCurrentTime(), orderKey: initialOrderKey},
                        activatedTime: getCurrentTaskTime(),
                    },
                    updatedTime: getCurrentTime(),
                },
            },
        },
    ]);

    await commitTaskSpaceActionTransaction(context.action(session2), space.id, [
        {
            type: "UpdateTask",
            taskId,
            taskAction: {
                type: "UpdateAssigneeStatus",
                assigneeStatusAction: {
                    value: {type: "Inactive"},
                    updatedTime: getCurrentTime(),
                },
            },
        },
    ]);
});

test("can't update task assignee status with unreasonable updated time", async () => {
    const taskId = generateId<TaskId>();

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            taskId,
            taskAction: {
                type: "Create",
                creator: taskAccount1,
                createdTime: getCurrentTaskTime(),
            },
        },
    ]);

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            taskId,
            taskAction: {
                type: "UpdateAssignee",
                assigneeAction: {
                    value: {
                        assignee: taskAccount2,
                        assigner: taskAccount1,
                        assignedTime: getCurrentTaskTime(),
                    },
                    updatedTime: getCurrentTime(),
                },
            },
        },
    ]);

    await expect(
        commitTaskSpaceActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                taskId,
                taskAction: {
                    type: "UpdateAssigneeStatus",
                    assigneeStatusAction: {
                        value: {
                            type: "Active",
                            position: {orderTime: getCurrentTime(), orderKey: initialOrderKey},
                            activatedTime: getCurrentTaskTime(),
                        },
                        updatedTime: getUnreasonableTime(),
                    },
                },
            },
        ]),
    ).rejects.toThrow(new InvalidArgumentError("Action `updatedTime` is too far in the future"));
});

test("can't update task assignee status with unreasonable activated time", async () => {
    const taskId = generateId<TaskId>();

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            taskId,
            taskAction: {
                type: "Create",
                creator: taskAccount1,
                createdTime: getCurrentTaskTime(),
            },
        },
    ]);

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            taskId,
            taskAction: {
                type: "UpdateAssignee",
                assigneeAction: {
                    value: {
                        assignee: taskAccount2,
                        assigner: taskAccount1,
                        assignedTime: getCurrentTaskTime(),
                    },
                    updatedTime: getCurrentTime(),
                },
            },
        },
    ]);

    await expect(
        commitTaskSpaceActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                taskId,
                taskAction: {
                    type: "UpdateAssigneeStatus",
                    assigneeStatusAction: {
                        value: {
                            type: "Active",
                            position: {orderTime: getCurrentTime(), orderKey: initialOrderKey},
                            activatedTime: getUnreasonableTaskTime(),
                        },
                        updatedTime: getCurrentTime(),
                    },
                },
            },
        ]),
    ).rejects.toThrow(new InvalidArgumentError("Action `activatedTime` is too far in the future"));
});

test("can't update task assignee status with unreasonable order time", async () => {
    const taskId = generateId<TaskId>();

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            taskId,
            taskAction: {
                type: "Create",
                creator: taskAccount1,
                createdTime: getCurrentTaskTime(),
            },
        },
    ]);

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            taskId,
            taskAction: {
                type: "UpdateAssignee",
                assigneeAction: {
                    value: {
                        assignee: taskAccount2,
                        assigner: taskAccount1,
                        assignedTime: getCurrentTaskTime(),
                    },
                    updatedTime: getCurrentTime(),
                },
            },
        },
    ]);

    await expect(
        commitTaskSpaceActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                taskId,
                taskAction: {
                    type: "UpdateAssigneeStatus",
                    assigneeStatusAction: {
                        value: {
                            type: "Active",
                            position: {orderTime: getUnreasonableTime(), orderKey: initialOrderKey},
                            activatedTime: getCurrentTaskTime(),
                        },
                        updatedTime: getCurrentTime(),
                    },
                },
            },
        ]),
    ).rejects.toThrow(new InvalidArgumentError("Action `orderTime` is too far in the future"));
});

test("can update task position in a collection", async () => {
    const taskId = generateId<TaskId>();
    const collectionId = generateId<TaskCollectionId>();

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTaskCollection",
            collectionId,
            collectionAction: {
                type: "Create",
                creatorId: taskAccount1.accountId,
                createdTime: getCurrentTime(),
                accessPolicy: new TaskCollectionAccessPolicyRegister(
                    {
                        accountGrantById: new Map([[taskAccount1.accountId, {level: "Manage"}]]),
                        defaultGrant: null,
                    },
                    getCurrentTime(),
                ),
            },
        },
        {
            type: "UpdateTask",
            taskId,
            taskAction: {
                type: "Create",
                creator: taskAccount1,
                createdTime: getCurrentTaskTime(),
            },
        },
        {
            type: "UpdateTask",
            taskId,
            taskAction: {
                type: "UpdateCollections",
                collectionsAction: {
                    type: "Set",
                    key: collectionId,
                    value: assertOrderKey("a0"),
                    updatedTime: getCurrentTime(),
                },
            },
        },
    ]);

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTaskCollection",
            collectionId,
            collectionAction: {
                type: "UpdateTaskPosition",
                taskId,
                position: {orderTime: getCurrentTime(), orderKey: assertOrderKey("a1")},
                updatedTime: getCurrentTime(),
            },
        },
    ]);
});

test("can't update task position with an unreasonable update time", async () => {
    const taskId = generateId<TaskId>();
    const collectionId = generateId<TaskCollectionId>();

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTaskCollection",
            collectionId,
            collectionAction: {
                type: "Create",
                creatorId: taskAccount1.accountId,
                createdTime: getCurrentTime(),
                accessPolicy: new TaskCollectionAccessPolicyRegister(
                    {
                        accountGrantById: new Map([[taskAccount1.accountId, {level: "Manage"}]]),
                        defaultGrant: null,
                    },
                    getCurrentTime(),
                ),
            },
        },
        {
            type: "UpdateTask",
            taskId,
            taskAction: {
                type: "Create",
                creator: taskAccount1,
                createdTime: getCurrentTaskTime(),
            },
        },
        {
            type: "UpdateTask",
            taskId,
            taskAction: {
                type: "UpdateCollections",
                collectionsAction: {
                    type: "Set",
                    key: collectionId,
                    value: assertOrderKey("a0"),
                    updatedTime: getCurrentTime(),
                },
            },
        },
    ]);

    await expect(
        commitTaskSpaceActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTaskCollection",
                collectionId,
                collectionAction: {
                    type: "UpdateTaskPosition",
                    taskId,
                    position: {orderTime: getCurrentTime(), orderKey: assertOrderKey("a1")},
                    updatedTime: getUnreasonableTime(),
                },
            },
        ]),
    ).rejects.toThrow(new InvalidArgumentError("Action `updatedTime` is too far in the future"));
});

test("can't update task position with an unreasonable order time", async () => {
    const taskId = generateId<TaskId>();
    const collectionId = generateId<TaskCollectionId>();

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTaskCollection",
            collectionId,
            collectionAction: {
                type: "Create",
                creatorId: taskAccount1.accountId,
                createdTime: getCurrentTime(),
                accessPolicy: new TaskCollectionAccessPolicyRegister(
                    {
                        accountGrantById: new Map([[taskAccount1.accountId, {level: "Manage"}]]),
                        defaultGrant: null,
                    },
                    getCurrentTime(),
                ),
            },
        },
        {
            type: "UpdateTask",
            taskId,
            taskAction: {
                type: "Create",
                creator: taskAccount1,
                createdTime: getCurrentTaskTime(),
            },
        },
        {
            type: "UpdateTask",
            taskId,
            taskAction: {
                type: "UpdateCollections",
                collectionsAction: {
                    type: "Set",
                    key: collectionId,
                    value: assertOrderKey("a0"),
                    updatedTime: getCurrentTime(),
                },
            },
        },
    ]);

    await expect(
        commitTaskSpaceActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTaskCollection",
                collectionId,
                collectionAction: {
                    type: "UpdateTaskPosition",
                    taskId,
                    position: {orderTime: getUnreasonableTime(), orderKey: assertOrderKey("a1")},
                    updatedTime: getCurrentTime(),
                },
            },
        ]),
    ).rejects.toThrow(new InvalidArgumentError("Action `orderTime` is too far in the future"));
});

test("can't update task position with a task that doesn't exist", async () => {
    const taskId = generateId<TaskId>();
    const collectionId = generateId<TaskCollectionId>();

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTaskCollection",
            collectionId,
            collectionAction: {
                type: "Create",
                creatorId: taskAccount1.accountId,
                createdTime: getCurrentTime(),
                accessPolicy: new TaskCollectionAccessPolicyRegister(
                    {
                        accountGrantById: new Map([[taskAccount1.accountId, {level: "Manage"}]]),
                        defaultGrant: null,
                    },
                    getCurrentTime(),
                ),
            },
        },
        {
            type: "UpdateTask",
            taskId,
            taskAction: {
                type: "Create",
                creator: taskAccount1,
                createdTime: getCurrentTaskTime(),
            },
        },
        {
            type: "UpdateTask",
            taskId,
            taskAction: {
                type: "UpdateCollections",
                collectionsAction: {
                    type: "Set",
                    key: collectionId,
                    value: assertOrderKey("a0"),
                    updatedTime: getCurrentTime(),
                },
            },
        },
    ]);

    await expect(
        commitTaskSpaceActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTaskCollection",
                collectionId,
                collectionAction: {
                    type: "UpdateTaskPosition",
                    taskId: generateId(),
                    position: {orderTime: getCurrentTime(), orderKey: assertOrderKey("a1")},
                    updatedTime: getCurrentTime(),
                },
            },
        ]),
    ).rejects.toThrow(new NotFoundError("Task not found"));
});

test("can't update task position with a task that's not in the collection", async () => {
    const taskId1 = generateId<TaskId>();
    const taskId2 = generateId<TaskId>();
    const collectionId = generateId<TaskCollectionId>();

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTaskCollection",
            collectionId,
            collectionAction: {
                type: "Create",
                creatorId: taskAccount1.accountId,
                createdTime: getCurrentTime(),
                accessPolicy: new TaskCollectionAccessPolicyRegister(
                    {
                        accountGrantById: new Map([[taskAccount1.accountId, {level: "Manage"}]]),
                        defaultGrant: null,
                    },
                    getCurrentTime(),
                ),
            },
        },
        {
            type: "UpdateTask",
            taskId: taskId1,
            taskAction: {
                type: "Create",
                creator: taskAccount1,
                createdTime: getCurrentTaskTime(),
            },
        },
        {
            type: "UpdateTask",
            taskId: taskId2,
            taskAction: {
                type: "Create",
                creator: taskAccount1,
                createdTime: getCurrentTaskTime(),
            },
        },
        {
            type: "UpdateTask",
            taskId: taskId1,
            taskAction: {
                type: "UpdateCollections",
                collectionsAction: {
                    type: "Set",
                    key: collectionId,
                    value: assertOrderKey("a0"),
                    updatedTime: getCurrentTime(),
                },
            },
        },
    ]);

    await expect(
        commitTaskSpaceActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTaskCollection",
                collectionId,
                collectionAction: {
                    type: "UpdateTaskPosition",
                    taskId: taskId2,
                    position: {orderTime: getCurrentTime(), orderKey: assertOrderKey("a1")},
                    updatedTime: getCurrentTime(),
                },
            },
        ]),
    ).rejects.toThrow(new FailedPreconditionError("Task is not in collection"));
});

test("can't update task position with a task that was removed from the collection", async () => {
    const taskId = generateId<TaskId>();
    const collectionId = generateId<TaskCollectionId>();

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTaskCollection",
            collectionId,
            collectionAction: {
                type: "Create",
                creatorId: taskAccount1.accountId,
                createdTime: getCurrentTime(),
                accessPolicy: new TaskCollectionAccessPolicyRegister(
                    {
                        accountGrantById: new Map([[taskAccount1.accountId, {level: "Manage"}]]),
                        defaultGrant: null,
                    },
                    getCurrentTime(),
                ),
            },
        },
        {
            type: "UpdateTask",
            taskId,
            taskAction: {
                type: "Create",
                creator: taskAccount1,
                createdTime: getCurrentTaskTime(),
            },
        },
        {
            type: "UpdateTask",
            taskId,
            taskAction: {
                type: "UpdateCollections",
                collectionsAction: {
                    type: "Set",
                    key: collectionId,
                    value: assertOrderKey("a0"),
                    updatedTime: getCurrentTime(),
                },
            },
        },
    ]);

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            taskId,
            taskAction: {
                type: "UpdateCollections",
                collectionsAction: {
                    type: "Delete",
                    key: collectionId,
                    deletedTime: getCurrentTime(),
                },
            },
        },
    ]);

    await expect(
        commitTaskSpaceActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTaskCollection",
                collectionId,
                collectionAction: {
                    type: "UpdateTaskPosition",
                    taskId,
                    position: {orderTime: getCurrentTime(), orderKey: assertOrderKey("a1")},
                    updatedTime: getCurrentTime(),
                },
            },
        ]),
    ).rejects.toThrow(new FailedPreconditionError("Task is not in collection"));
});

test("can't update task position when you don't have access to the collection", async () => {
    const taskId = generateId<TaskId>();
    const collectionId = generateId<TaskCollectionId>();

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTaskCollection",
            collectionId,
            collectionAction: {
                type: "Create",
                creatorId: taskAccount1.accountId,
                createdTime: getCurrentTime(),
                accessPolicy: new TaskCollectionAccessPolicyRegister(
                    {
                        accountGrantById: new Map([[taskAccount1.accountId, {level: "Manage"}]]),
                        defaultGrant: null,
                    },
                    getCurrentTime(),
                ),
            },
        },
        {
            type: "UpdateTask",
            taskId,
            taskAction: {
                type: "Create",
                creator: taskAccount1,
                createdTime: getCurrentTaskTime(),
            },
        },
        {
            type: "UpdateTask",
            taskId,
            taskAction: {
                type: "UpdateCollections",
                collectionsAction: {
                    type: "Set",
                    key: collectionId,
                    value: assertOrderKey("a0"),
                    updatedTime: getCurrentTime(),
                },
            },
        },
    ]);

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            taskId,
            taskAction: {
                type: "UpdateCollections",
                collectionsAction: {
                    type: "Delete",
                    key: collectionId,
                    deletedTime: getCurrentTime(),
                },
            },
        },
    ]);

    await expect(
        commitTaskSpaceActionTransaction(context.action(session2), space.id, [
            {
                type: "UpdateTaskCollection",
                collectionId,
                collectionAction: {
                    type: "UpdateTaskPosition",
                    taskId: generateId(),
                    position: {orderTime: getCurrentTime(), orderKey: assertOrderKey("a1")},
                    updatedTime: getCurrentTime(),
                },
            },
        ]),
    ).rejects.toThrow(PermissionDeniedError);
});

test("can't update task position when you only have view access to the collection", async () => {
    const taskId = generateId<TaskId>();
    const collectionId = generateId<TaskCollectionId>();

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTaskCollection",
            collectionId,
            collectionAction: {
                type: "Create",
                creatorId: taskAccount1.accountId,
                createdTime: getCurrentTime(),
                accessPolicy: new TaskCollectionAccessPolicyRegister(
                    {
                        accountGrantById: new Map([[taskAccount1.accountId, {level: "Manage"}]]),
                        defaultGrant: {type: "Space", level: "View"},
                    },
                    getCurrentTime(),
                ),
            },
        },
        {
            type: "UpdateTask",
            taskId,
            taskAction: {
                type: "Create",
                creator: taskAccount1,
                createdTime: getCurrentTaskTime(),
            },
        },
        {
            type: "UpdateTask",
            taskId,
            taskAction: {
                type: "UpdateCollections",
                collectionsAction: {
                    type: "Set",
                    key: collectionId,
                    value: assertOrderKey("a0"),
                    updatedTime: getCurrentTime(),
                },
            },
        },
    ]);

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            taskId,
            taskAction: {
                type: "UpdateCollections",
                collectionsAction: {
                    type: "Delete",
                    key: collectionId,
                    deletedTime: getCurrentTime(),
                },
            },
        },
    ]);

    await expect(
        commitTaskSpaceActionTransaction(context.action(session2), space.id, [
            {
                type: "UpdateTaskCollection",
                collectionId,
                collectionAction: {
                    type: "UpdateTaskPosition",
                    taskId: generateId(),
                    position: {orderTime: getCurrentTime(), orderKey: assertOrderKey("a1")},
                    updatedTime: getCurrentTime(),
                },
            },
        ]),
    ).rejects.toThrow(PermissionDeniedError);
});

test("can add task to notepad page", async () => {
    const {space} = await createSeparateSpace();
    const taskId = generateId<TaskId>();
    const notepadPageId = generateTaskNotepadPageId();

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTaskNotepadPage",
            accountId: session1.accountId,
            notepadPageId,
            notepadPageAction: {
                type: "Create",
            },
        },
    ]);

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            taskId,
            taskAction: {
                type: "Create",
                creator: taskAccount1,
                createdTime: getCurrentTaskTime(),
            },
        },
    ]);

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTaskNotepadPage",
            accountId: session1.accountId,
            notepadPageId,
            notepadPageAction: {
                type: "AddTask",
                taskId,
                position: {orderTime: getCurrentTime(), orderKey: initialOrderKey},
                updatedTime: getCurrentTime(),
            },
        },
    ]);
});

test("can add task to notepad page in one transaction", async () => {
    const {space} = await createSeparateSpace();
    const taskId = generateId<TaskId>();
    const notepadPageId = generateTaskNotepadPageId();

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTaskNotepadPage",
            accountId: session1.accountId,
            notepadPageId,
            notepadPageAction: {
                type: "Create",
            },
        },
        {
            type: "UpdateTask",
            taskId,
            taskAction: {
                type: "Create",
                creator: taskAccount1,
                createdTime: getCurrentTaskTime(),
            },
        },
        {
            type: "UpdateTaskNotepadPage",
            accountId: session1.accountId,
            notepadPageId,
            notepadPageAction: {
                type: "AddTask",
                taskId,
                position: {orderTime: getCurrentTime(), orderKey: initialOrderKey},
                updatedTime: getCurrentTime(),
            },
        },
    ]);
});

test("can't add task to notepad page that hasn't been created", async () => {
    const {space} = await createSeparateSpace();
    const taskId = generateId<TaskId>();
    const notepadPageId = generateTaskNotepadPageId();

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            taskId,
            taskAction: {
                type: "Create",
                creator: taskAccount1,
                createdTime: getCurrentTaskTime(),
            },
        },
    ]);

    await expect(
        commitTaskSpaceActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTaskNotepadPage",
                accountId: session1.accountId,
                notepadPageId,
                notepadPageAction: {
                    type: "AddTask",
                    taskId,
                    position: {orderTime: getCurrentTime(), orderKey: initialOrderKey},
                    updatedTime: getCurrentTime(),
                },
            },
        ]),
    ).rejects.toThrow(new NotFoundError("Notepad page not found"));
});

test("can't create a notepad page for someone else", async () => {
    const {space} = await createSeparateSpace();
    const notepadPageId = generateTaskNotepadPageId();

    await expect(
        commitTaskSpaceActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTaskNotepadPage",
                accountId: session2.accountId,
                notepadPageId,
                notepadPageAction: {
                    type: "Create",
                },
            },
        ]),
    ).rejects.toThrow(new PermissionDeniedError("Can only access your account's notepad"));
});

test("can't add a task to someone else's notepad page", async () => {
    const {space} = await createSeparateSpace();
    const taskId = generateId<TaskId>();
    const notepadPageId = generateTaskNotepadPageId();

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTaskNotepadPage",
            accountId: session1.accountId,
            notepadPageId,
            notepadPageAction: {
                type: "Create",
            },
        },
    ]);

    await commitTaskSpaceActionTransaction(context.action(session2), space.id, [
        {
            type: "UpdateTask",
            taskId,
            taskAction: {
                type: "Create",
                creator: taskAccount2,
                createdTime: getCurrentTaskTime(),
            },
        },
    ]);

    await expect(
        commitTaskSpaceActionTransaction(context.action(session2), space.id, [
            {
                type: "UpdateTaskNotepadPage",
                accountId: session1.accountId,
                notepadPageId,
                notepadPageAction: {
                    type: "AddTask",
                    taskId,
                    position: {orderTime: getCurrentTime(), orderKey: initialOrderKey},
                    updatedTime: getCurrentTime(),
                },
            },
        ]),
    ).rejects.toThrow(new PermissionDeniedError("Can only access your account's notepad"));
});

test("can't create a notepad page twice", async () => {
    const {space} = await createSeparateSpace();
    const notepadPageId = generateTaskNotepadPageId();

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTaskNotepadPage",
            accountId: session1.accountId,
            notepadPageId,
            notepadPageAction: {
                type: "Create",
            },
        },
    ]);

    await expect(
        commitTaskSpaceActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTaskNotepadPage",
                accountId: session1.accountId,
                notepadPageId,
                notepadPageAction: {
                    type: "Create",
                },
            },
        ]),
    ).rejects.toThrow(new FailedPreconditionError("Notepad page already exists"));
});

test("can't remove task from notepad page that hasn't been created", async () => {
    const {space} = await createSeparateSpace();
    const taskId = generateId<TaskId>();
    const notepadPageId = generateTaskNotepadPageId();

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            taskId,
            taskAction: {
                type: "Create",
                creator: taskAccount1,
                createdTime: getCurrentTaskTime(),
            },
        },
    ]);

    await expect(
        commitTaskSpaceActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTaskNotepadPage",
                accountId: session1.accountId,
                notepadPageId,
                notepadPageAction: {
                    type: "RemoveTask",
                    taskId,
                    updatedTime: getCurrentTime(),
                },
            },
        ]),
    ).rejects.toThrow(new NotFoundError("Notepad page not found"));
});

test("can't add task to notepad page with an unreasonable update time", async () => {
    const {space} = await createSeparateSpace();
    const taskId = generateId<TaskId>();
    const notepadPageId = generateTaskNotepadPageId();

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTaskNotepadPage",
            accountId: session1.accountId,
            notepadPageId,
            notepadPageAction: {
                type: "Create",
            },
        },
    ]);

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            taskId,
            taskAction: {
                type: "Create",
                creator: taskAccount1,
                createdTime: getCurrentTaskTime(),
            },
        },
    ]);

    await expect(
        commitTaskSpaceActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTaskNotepadPage",
                accountId: session1.accountId,
                notepadPageId,
                notepadPageAction: {
                    type: "AddTask",
                    taskId,
                    position: {orderTime: getCurrentTime(), orderKey: initialOrderKey},
                    updatedTime: getUnreasonableTime(),
                },
            },
        ]),
    ).rejects.toThrow(new InvalidArgumentError("Action `updatedTime` is too far in the future"));
});

test("can't add task to notepad page with an unreasonable order time", async () => {
    const {space} = await createSeparateSpace();
    const taskId = generateId<TaskId>();
    const notepadPageId = generateTaskNotepadPageId();

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTaskNotepadPage",
            accountId: session1.accountId,
            notepadPageId,
            notepadPageAction: {
                type: "Create",
            },
        },
    ]);

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            taskId,
            taskAction: {
                type: "Create",
                creator: taskAccount1,
                createdTime: getCurrentTaskTime(),
            },
        },
    ]);

    await expect(
        commitTaskSpaceActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTaskNotepadPage",
                accountId: session1.accountId,
                notepadPageId,
                notepadPageAction: {
                    type: "AddTask",
                    taskId,
                    position: {orderTime: getUnreasonableTime(), orderKey: initialOrderKey},
                    updatedTime: getCurrentTime(),
                },
            },
        ]),
    ).rejects.toThrow(new InvalidArgumentError("Action `orderTime` is too far in the future"));
});

test("can't add task to notepad page that doesn't exist", async () => {
    const {space} = await createSeparateSpace();
    const taskId = generateId<TaskId>();
    const notepadPageId = generateTaskNotepadPageId();

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTaskNotepadPage",
            accountId: session1.accountId,
            notepadPageId,
            notepadPageAction: {
                type: "Create",
            },
        },
    ]);

    await expect(
        commitTaskSpaceActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTaskNotepadPage",
                accountId: session1.accountId,
                notepadPageId,
                notepadPageAction: {
                    type: "AddTask",
                    taskId,
                    position: {orderTime: getCurrentTime(), orderKey: initialOrderKey},
                    updatedTime: getCurrentTime(),
                },
            },
        ]),
    ).rejects.toThrow(new NotFoundError("Task not found"));
});

test("can't add task you don't have access to to notepad page", async () => {
    const {space} = await createSeparateSpace();
    const taskId = generateId<TaskId>();
    const notepadPageId = generateTaskNotepadPageId();

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTaskNotepadPage",
            accountId: session1.accountId,
            notepadPageId,
            notepadPageAction: {
                type: "Create",
            },
        },
    ]);

    await commitTaskSpaceActionTransaction(context.action(session2), space.id, [
        {
            type: "UpdateTask",
            taskId,
            taskAction: {
                type: "Create",
                creator: taskAccount2,
                createdTime: getCurrentTaskTime(),
            },
        },
    ]);

    await expect(
        commitTaskSpaceActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTaskNotepadPage",
                accountId: session1.accountId,
                notepadPageId,
                notepadPageAction: {
                    type: "AddTask",
                    taskId,
                    position: {orderTime: getCurrentTime(), orderKey: initialOrderKey},
                    updatedTime: getCurrentTime(),
                },
            },
        ]),
    ).rejects.toThrow(PermissionDeniedError);
});

test("can add task you have view access to to notepad page", async () => {
    const {space} = await createSeparateSpace();
    const taskId = generateId<TaskId>();
    const notepadPageId = generateTaskNotepadPageId();
    const collectionId = generateId<TaskCollectionId>();

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTaskNotepadPage",
            accountId: session1.accountId,
            notepadPageId,
            notepadPageAction: {
                type: "Create",
            },
        },
    ]);

    await commitTaskSpaceActionTransaction(context.action(session2), space.id, [
        {
            type: "UpdateTaskCollection",
            collectionId,
            collectionAction: {
                type: "Create",
                creatorId: taskAccount2.accountId,
                createdTime: getCurrentTime(),
                accessPolicy: new TaskCollectionAccessPolicyRegister(
                    {
                        accountGrantById: new Map([[taskAccount2.accountId, {level: "Manage"}]]),
                        defaultGrant: {type: "Space", level: "View"},
                    },
                    getCurrentTime(),
                ),
            },
        },
        {
            type: "UpdateTask",
            taskId,
            taskAction: {
                type: "Create",
                creator: taskAccount2,
                createdTime: getCurrentTaskTime(),
            },
        },
        {
            type: "UpdateTask",
            taskId,
            taskAction: {
                type: "UpdateCollections",
                collectionsAction: {
                    type: "Set",
                    key: collectionId,
                    value: assertOrderKey("a0"),
                    updatedTime: getCurrentTime(),
                },
            },
        },
    ]);

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTaskNotepadPage",
            accountId: session1.accountId,
            notepadPageId,
            notepadPageAction: {
                type: "AddTask",
                taskId,
                position: {orderTime: getCurrentTime(), orderKey: initialOrderKey},
                updatedTime: getCurrentTime(),
            },
        },
    ]);
});

test("can remove task from notepad page", async () => {
    const {space} = await createSeparateSpace();
    const taskId = generateId<TaskId>();
    const notepadPageId = generateTaskNotepadPageId();

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTaskNotepadPage",
            accountId: session1.accountId,
            notepadPageId,
            notepadPageAction: {
                type: "Create",
            },
        },
    ]);

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            taskId,
            taskAction: {
                type: "Create",
                creator: taskAccount1,
                createdTime: getCurrentTaskTime(),
            },
        },
    ]);

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTaskNotepadPage",
            accountId: session1.accountId,
            notepadPageId,
            notepadPageAction: {
                type: "AddTask",
                taskId,
                position: {orderTime: getCurrentTime(), orderKey: initialOrderKey},
                updatedTime: getCurrentTime(),
            },
        },
    ]);

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTaskNotepadPage",
            accountId: session1.accountId,
            notepadPageId,
            notepadPageAction: {
                type: "RemoveTask",
                taskId,
                updatedTime: getCurrentTime(),
            },
        },
    ]);
});

test("can remove task from notepad page twice", async () => {
    const {space} = await createSeparateSpace();
    const taskId = generateId<TaskId>();
    const notepadPageId = generateTaskNotepadPageId();

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTaskNotepadPage",
            accountId: session1.accountId,
            notepadPageId,
            notepadPageAction: {
                type: "Create",
            },
        },
    ]);

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            taskId,
            taskAction: {
                type: "Create",
                creator: taskAccount1,
                createdTime: getCurrentTaskTime(),
            },
        },
    ]);

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTaskNotepadPage",
            accountId: session1.accountId,
            notepadPageId,
            notepadPageAction: {
                type: "AddTask",
                taskId,
                position: {orderTime: getCurrentTime(), orderKey: initialOrderKey},
                updatedTime: getCurrentTime(),
            },
        },
    ]);

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTaskNotepadPage",
            accountId: session1.accountId,
            notepadPageId,
            notepadPageAction: {
                type: "RemoveTask",
                taskId,
                updatedTime: getCurrentTime(),
            },
        },
    ]);

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTaskNotepadPage",
            accountId: session1.accountId,
            notepadPageId,
            notepadPageAction: {
                type: "RemoveTask",
                taskId,
                updatedTime: getCurrentTime(),
            },
        },
    ]);
});

test("can remove task from notepad page even if the task was not added", async () => {
    const {space} = await createSeparateSpace();
    const taskId = generateId<TaskId>();
    const notepadPageId = generateTaskNotepadPageId();

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTaskNotepadPage",
            accountId: session1.accountId,
            notepadPageId,
            notepadPageAction: {
                type: "Create",
            },
        },
    ]);

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            taskId,
            taskAction: {
                type: "Create",
                creator: taskAccount1,
                createdTime: getCurrentTaskTime(),
            },
        },
    ]);

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTaskNotepadPage",
            accountId: session1.accountId,
            notepadPageId,
            notepadPageAction: {
                type: "RemoveTask",
                taskId,
                updatedTime: getCurrentTime(),
            },
        },
    ]);
});

test("can't remove task from notepad page with an unreasonable update time", async () => {
    const {space} = await createSeparateSpace();
    const taskId = generateId<TaskId>();
    const notepadPageId = generateTaskNotepadPageId();

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTaskNotepadPage",
            accountId: session1.accountId,
            notepadPageId,
            notepadPageAction: {
                type: "Create",
            },
        },
    ]);

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            taskId,
            taskAction: {
                type: "Create",
                creator: taskAccount1,
                createdTime: getCurrentTaskTime(),
            },
        },
    ]);

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTaskNotepadPage",
            accountId: session1.accountId,
            notepadPageId,
            notepadPageAction: {
                type: "AddTask",
                taskId,
                position: {orderTime: getCurrentTime(), orderKey: initialOrderKey},
                updatedTime: getCurrentTime(),
            },
        },
    ]);

    await expect(
        commitTaskSpaceActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTaskNotepadPage",
                accountId: session1.accountId,
                notepadPageId,
                notepadPageAction: {
                    type: "RemoveTask",
                    taskId,
                    updatedTime: getUnreasonableTime(),
                },
            },
        ]),
    ).rejects.toThrow(new InvalidArgumentError("Action `updatedTime` is too far in the future"));
});

test("can't remove task from notepad page when the task doesn't exist", async () => {
    const {space} = await createSeparateSpace();
    const taskId = generateId<TaskId>();
    const notepadPageId = generateTaskNotepadPageId();

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTaskNotepadPage",
            accountId: session1.accountId,
            notepadPageId,
            notepadPageAction: {
                type: "Create",
            },
        },
    ]);

    await expect(
        commitTaskSpaceActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTaskNotepadPage",
                accountId: session1.accountId,
                notepadPageId,
                notepadPageAction: {
                    type: "RemoveTask",
                    taskId,
                    updatedTime: getCurrentTime(),
                },
            },
        ]),
    ).rejects.toThrow(new NotFoundError("Task not found"));
});

test("can't remove task you don't have access to from notepad page", async () => {
    const {space} = await createSeparateSpace();
    const taskId = generateId<TaskId>();
    const notepadPageId = generateTaskNotepadPageId();

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTaskNotepadPage",
            accountId: session1.accountId,
            notepadPageId,
            notepadPageAction: {
                type: "Create",
            },
        },
    ]);

    await commitTaskSpaceActionTransaction(context.action(session2), space.id, [
        {
            type: "UpdateTask",
            taskId,
            taskAction: {
                type: "Create",
                creator: taskAccount2,
                createdTime: getCurrentTaskTime(),
            },
        },
    ]);

    await expect(
        commitTaskSpaceActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTaskNotepadPage",
                accountId: session1.accountId,
                notepadPageId,
                notepadPageAction: {
                    type: "RemoveTask",
                    taskId,
                    updatedTime: getCurrentTime(),
                },
            },
        ]),
    ).rejects.toThrow(PermissionDeniedError);
});

test("can remove task you have view access to from notepad page", async () => {
    const {space} = await createSeparateSpace();
    const taskId = generateId<TaskId>();
    const notepadPageId = generateTaskNotepadPageId();
    const collectionId = generateId<TaskCollectionId>();

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTaskNotepadPage",
            accountId: session1.accountId,
            notepadPageId,
            notepadPageAction: {
                type: "Create",
            },
        },
    ]);

    await commitTaskSpaceActionTransaction(context.action(session2), space.id, [
        {
            type: "UpdateTaskCollection",
            collectionId,
            collectionAction: {
                type: "Create",
                creatorId: taskAccount2.accountId,
                createdTime: getCurrentTime(),
                accessPolicy: new TaskCollectionAccessPolicyRegister(
                    {
                        accountGrantById: new Map([[taskAccount2.accountId, {level: "Manage"}]]),
                        defaultGrant: {type: "Space", level: "View"},
                    },
                    getCurrentTime(),
                ),
            },
        },
        {
            type: "UpdateTask",
            taskId,
            taskAction: {
                type: "Create",
                creator: taskAccount2,
                createdTime: getCurrentTaskTime(),
            },
        },
        {
            type: "UpdateTask",
            taskId,
            taskAction: {
                type: "UpdateCollections",
                collectionsAction: {
                    type: "Set",
                    key: collectionId,
                    value: assertOrderKey("a0"),
                    updatedTime: getCurrentTime(),
                },
            },
        },
    ]);

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTaskNotepadPage",
            accountId: session1.accountId,
            notepadPageId,
            notepadPageAction: {
                type: "AddTask",
                taskId,
                position: {orderTime: getCurrentTime(), orderKey: initialOrderKey},
                updatedTime: getCurrentTime(),
            },
        },
    ]);

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTaskNotepadPage",
            accountId: session1.accountId,
            notepadPageId,
            notepadPageAction: {
                type: "RemoveTask",
                taskId,
                updatedTime: getCurrentTime(),
            },
        },
    ]);
});
