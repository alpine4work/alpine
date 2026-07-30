import {UnimplementedError} from "~/shared/error/error.js";
import {HybridLogicalTime} from "~/shared/helpers/clock/hybrid_logical_clock.js";
import {defaultTimeZone} from "~/shared/helpers/intl/time_zone.js";
import {assertId, generateId} from "~/shared/id/id.js";
import {AccountId, SpaceId, TaskId} from "~/shared/id/types/id_types.js";
import {TaskModel} from "~/shared/tasks/model/task_model.js";
import {TaskFilterableTime} from "~/shared/tasks/task_filterable_time.js";
import {TaskSortableAccount} from "~/shared/tasks/task_sortable_account.js";
import {
    createTaskTitleFromText,
    randomlyGenerateTaskTitleClientId,
} from "~/shared/tasks/title/task_title.js";

const defaultTestTaskAccountId = assertId<AccountId>("ne9xp93dwgcwccj661x3ntdb9w");

function getActionReferencedSortableAccountDefault(accountId: AccountId) {
    if (accountId === defaultTestTaskAccountId) {
        return {
            accountId,
            workingAccountName: "Default Test Task Account",
            workingAccountNameVersion: 0,
        };
    }
    throw new UnimplementedError(
        "An implementation of `getActionReferencedSortableAccount()` wasn\u2019t provided",
    );
}

export function createTestTaskModel({
    spaceId = generateId<SpaceId>(),
    taskId = generateId<TaskId>(),
    creatorId = defaultTestTaskAccountId,
    createdTime = [Date.now(), 0],
    getActionReferencedSortableAccount = getActionReferencedSortableAccountDefault,
}: {
    spaceId?: SpaceId;
    taskId?: TaskId;
    creatorId?: AccountId;
    createdTime?: HybridLogicalTime;
    getActionReferencedSortableAccount?: (accountId: AccountId) => TaskSortableAccount;
}): TaskModel {
    return TaskModel.createFromAction(
        spaceId,
        taskId,
        createdTime,
        {
            type: "Create",
            creator: {accountId: creatorId, from: null},
            creatorTimeZone: defaultTimeZone,
        },
        getActionReferencedSortableAccount,
    );
}

export function createTestTaskWithTitle({
    spaceId,
    taskId,
    creatorId = defaultTestTaskAccountId,
    createdTime,
    title = "Test Task",
    getActionReferencedSortableAccount = getActionReferencedSortableAccountDefault,
}: {
    spaceId?: SpaceId;
    taskId?: TaskId;
    creatorId?: AccountId;
    createdTime?: HybridLogicalTime;
    title?: string;
    getActionReferencedSortableAccount?: (accountId: AccountId) => TaskSortableAccount;
}): TaskModel {
    const task = createTestTaskModel({spaceId, taskId, creatorId, createdTime});
    return updateTestTaskWithTitle({task, title, getActionReferencedSortableAccount});
}

export function updateTestTaskWithTitle({
    task,
    title = "Test Task",
    getActionReferencedSortableAccount = getActionReferencedSortableAccountDefault,
}: {
    task: TaskModel;
    title?: string;
    getActionReferencedSortableAccount?: (accountId: AccountId) => TaskSortableAccount;
}): TaskModel {
    return task.applyAction(
        {
            type: "UpdateTask",
            taskId: task.id,
            time: [Date.now(), 0],
            taskAction: {
                type: "UpdateTitle",
                titleUpdate: createTaskTitleFromText(randomlyGenerateTaskTitleClientId(), title),
            },
        },
        getActionReferencedSortableAccount,
    );
}

export function updateTestTaskWithStatus({
    task,
    displayStatus,
    getActionReferencedSortableAccount = getActionReferencedSortableAccountDefault,
}: {
    task: TaskModel;
    displayStatus: "Open" | "Closed";
    getActionReferencedSortableAccount?: (accountId: AccountId) => TaskSortableAccount;
}): TaskModel {
    const time: HybridLogicalTime = [Date.now(), 0];

    return task.applyAction(
        {
            type: "UpdateTask",
            taskId: task.id,
            time,
            taskAction: {
                type: "UpdateStatus",
                status: {
                    type: displayStatus,
                    closerId: task.getCreator().accountId,
                    closedTime: new TaskFilterableTime({
                        absoluteTime: time,
                        setterTimeZone: defaultTimeZone,
                    }),
                },
            },
        },
        getActionReferencedSortableAccount,
    );
}
