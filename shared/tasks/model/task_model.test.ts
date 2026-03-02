import {CalendarDate} from "@internationalized/date";
import {AccessPolicy, AccessPolicyAccountGrant} from "~/shared/access/access_policy.js";
import {
    HybridLogicalClock,
    HybridLogicalTime,
} from "~/shared/helpers/clock/hybrid_logical_clock.js";
import {unsynchronizedSystemClock} from "~/shared/helpers/clock/unsynchronized_system_clock.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {defaultTimeZone} from "~/shared/helpers/intl/time_zone.js";
import {generateOrderKeyBetween, initialOrderKey} from "~/shared/helpers/sort/order_key.js";
import {generateId} from "~/shared/id/id.js";
import {AccountId, SpaceId, TaskCollectionId, TaskId} from "~/shared/id/types/id_types.js";
import {TaskAction, TaskUpdateTaskAction} from "~/shared/tasks/actions/task_action.js";
import {
    TaskAddCollectionAction,
    TaskCreateAction,
    TaskTaskAction,
    TaskUpdateAssigneeAction,
    TaskUpdateDueDateAction,
    TaskUpdateParentTaskIdAction,
    TaskUpdatePriorityAction,
    TaskUpdateTitleAction,
} from "~/shared/tasks/actions/task_task_action.js";
import {TaskModel} from "~/shared/tasks/model/task_model.js";
import {TaskFilterableTime} from "~/shared/tasks/task_filterable_time.js";
import {TaskPriorityRegister} from "~/shared/tasks/task_priority.js";
import {TaskSortableAccount} from "~/shared/tasks/task_sortable_account.js";
import {
    createTestTaskModel,
    updateTestTaskWithTitle,
} from "~/shared/tasks/test_helpers/task_model_test_helpers.js";
import {
    TaskTitleModel,
    applyTaskTitleUpdate,
    emptyTaskTitle,
    getTaskTitleText,
} from "~/shared/tasks/title/task_title.js";

function getActionReferencedSortableAccountWrapper(creatorAccountId: AccountId) {
    return (otherAccountId: AccountId) => {
        assert(creatorAccountId === otherAccountId);

        return {
            accountId: creatorAccountId,
            workingAccountName: "Test",
            workingAccountNameVersion: 0,
        };
    };
}

test("merging identical tasks returns a referentially equal value to the first one", () => {
    const spaceId = generateId<SpaceId>();
    const taskId = generateId<TaskId>();
    const accountId = generateId<AccountId>();
    const createdTime: HybridLogicalTime = [Date.now(), 0];

    const getActionReferencedSortableAccount = getActionReferencedSortableAccountWrapper(accountId);
    const commonTaskCreationProperties = {
        spaceId,
        taskId,
        creatorId: accountId,
        createdTime,
        getActionReferencedSortableAccount,
    };
    const task1 = createTestTaskModel(commonTaskCreationProperties);
    const task2 = createTestTaskModel(commonTaskCreationProperties);

    expect(task1.merge(task2)).toBe(task1);
    expect(task1.merge(task2)).not.toBe(task2);
    expect(task2.merge(task1)).toBe(task2);
    expect(task2.merge(task1)).not.toBe(task1);
});

test("merging tasks returns a referentially equal value to the first one if the first task didn\u2019t change", () => {
    const spaceId = generateId<SpaceId>();
    const taskId = generateId<TaskId>();
    const accountId = generateId<AccountId>();
    const createdTime: HybridLogicalTime = [Date.now(), 0];

    const getActionReferencedSortableAccount = getActionReferencedSortableAccountWrapper(accountId);
    const commonTaskCreationProperties = {
        spaceId,
        taskId,
        creatorId: accountId,
        createdTime,
        getActionReferencedSortableAccount,
    };
    const task1a = createTestTaskModel(commonTaskCreationProperties);
    const task2 = createTestTaskModel(commonTaskCreationProperties);

    const task1b = new TaskModel({
        ...task1a.rawData,
        priority: new TaskPriorityRegister("High", [createdTime[0], 1]),
    });

    expect(task1b.merge(task2)).toBe(task1b);
    expect(task1b.merge(task2)).not.toBe(task2);
    expect(task2.merge(task1b)).not.toBe(task2);
    expect(task2.merge(task1b)).not.toBe(task1b);
    expect(task2.merge(task1b)).toEqual(task1b);
});

describe("getCloneActions", () => {
    const spaceId = generateId<SpaceId>();
    const accountId = generateId<AccountId>();
    const clock = new HybridLogicalClock(unsynchronizedSystemClock);
    const createdTime = clock.now();
    const filterableTime = new TaskFilterableTime({
        absoluteTime: clock.now(),
        setterTimeZone: defaultTimeZone,
    });
    const timeZone = defaultTimeZone;

    let task: TaskModel;

    const getActionReferencedSortableAccount: (id: AccountId) => TaskSortableAccount = id => {
        return {
            accountId: id,
            workingAccountName: "Test",
            workingAccountNameVersion: 0,
        };
    };

    beforeEach(() => {
        task = createTestTaskModel({
            spaceId,
            creatorId: accountId,
            createdTime,
            getActionReferencedSortableAccount,
        });
    });

    function findActions<T extends TaskTaskAction>(
        actions: Array<TaskAction>,
        type: string,
        expectedCount: number,
    ): Array<TaskUpdateTaskAction & {readonly taskAction: T}> {
        const foundActions = actions.filter(
            a => a.type === "UpdateTask" && a.taskAction.type === type,
        ) as Array<TaskUpdateTaskAction>;
        expect(foundActions.length).toBe(expectedCount);
        return foundActions.map(action => ({
            type: action.type,
            time: action.time,
            taskId: action.taskId,
            taskAction: action.taskAction as T,
        }));
    }

    function findAction<T extends TaskTaskAction>(actions: Array<TaskAction>, type: string) {
        const foundActions = findActions<T>(actions, type, 1);
        return foundActions[0]!;
    }

    test("creates a new task with the correct creator and basic actions", () => {
        const {actions} = task.getDuplicateActions({
            creatorId: accountId,
            actionTime: clock.now(),
            creatorTimeZone: timeZone,
        });
        const createAction = findAction<TaskCreateAction>(actions, "Create");
        expect(createAction.taskAction.creatorId).toBe(accountId);

        const basicActionTypes = actions.map(
            action => "taskAction" in action && action.taskAction.type,
        );
        expect(basicActionTypes).toEqual(["Create", "UpdateTitle", "UpdateStatus"]);
    });

    test("copies parent task relationship", () => {
        const parentId = generateId<TaskId>();
        task = task.applyAction(
            {
                type: "UpdateTask",
                taskId: task.id,
                time: clock.now(),
                taskAction: {
                    type: "UpdateParentTaskId",
                    parentTaskId: parentId,
                },
            },
            getActionReferencedSortableAccount,
        );

        const {actions} = task.getDuplicateActions({
            creatorId: accountId,
            actionTime: clock.now(),
            creatorTimeZone: timeZone,
        });
        const parentAction = findAction<TaskUpdateParentTaskIdAction>(
            actions,
            "UpdateParentTaskId",
        );
        expect(parentAction?.taskAction.parentTaskId).toBe(parentId);
    });

    test("doesn\u2019t copy access policy", () => {
        const otherManagerId = generateId<AccountId>();
        const editorId = generateId<AccountId>();
        const accessPolicy: AccessPolicy = {
            accountGrantById: new Map<AccountId, AccessPolicyAccountGrant>([
                [accountId, {level: "Manage", generation: 0}],
                [otherManagerId, {level: "Manage", generation: 2}],
                [editorId, {level: "Edit"}],
            ]),
            defaultGrant: {level: "Manage", generation: 3},
            urlGrant: {level: "View"},
        };

        task = task.applyAction(
            {
                type: "UpdateTask",
                taskId: task.id,
                time: clock.now(),
                taskAction: {
                    type: "UpdateAccessPolicy",
                    accessPolicy,
                },
            },
            getActionReferencedSortableAccount,
        );

        const newCreatorId = generateId<AccountId>();

        const {actions} = task.getDuplicateActions({
            creatorId: newCreatorId,
            actionTime: clock.now(),
            creatorTimeZone: timeZone,
        });

        expect(
            actions.some(
                action =>
                    action.type === "UpdateTask" && action.taskAction.type === "UpdateAccessPolicy",
            ),
        ).toBe(false);
    });

    test("copies title", () => {
        const expected = "Test Task";
        task = updateTestTaskWithTitle({task, title: expected});

        const {actions} = task.getDuplicateActions({
            creatorId: accountId,
            actionTime: clock.now(),
            creatorTimeZone: timeZone,
        });
        const titleAction = findAction<TaskUpdateTitleAction>(actions, "UpdateTitle");
        // create a model and play the update on it
        const titleModel = new TaskTitleModel(emptyTaskTitle.get()).apply(
            titleAction.taskAction.titleUpdate,
        );
        expect(titleModel.getText()).toEqual(expected);
    });

    const titleCopiesCases = [
        {initial: "Test Task", expected: "Test Task (copy)"},
        {initial: "Test Task (copy)", expected: "Test Task (copy 2)"},
        {initial: "Test Task (copy 2)", expected: "Test Task (copy 3)"},
        {initial: "Test Task (copy 35)", expected: "Test Task (copy 36)"},
    ];

    for (const {initial, expected} of titleCopiesCases) {
        test(`adds suffix to title without existing suffix: ${initial} -> ${expected}`, () => {
            task = updateTestTaskWithTitle({task, title: initial});

            const {actions} = task.getDuplicateActions({
                creatorId: accountId,
                actionTime: clock.now(),
                creatorTimeZone: timeZone,
                withTitleUpdate: true,
            });
            const titleAction = findAction<TaskUpdateTitleAction>(actions, "UpdateTitle");

            expect(
                getTaskTitleText(
                    applyTaskTitleUpdate(emptyTaskTitle.get(), titleAction.taskAction.titleUpdate),
                ),
            ).toEqual(expected);
        });
    }

    test("copies assignee information", () => {
        const assigneeId = generateId<AccountId>();
        task = task.applyAction(
            {
                type: "UpdateTask",
                taskId: task.id,
                time: clock.now(),
                taskAction: {
                    type: "UpdateAssignee",
                    assignee: {
                        assigneeId,
                        assignerId: accountId,
                        assignedTime: filterableTime,
                    },
                },
            },
            getActionReferencedSortableAccount,
        );

        const {actions} = task.getDuplicateActions({
            creatorId: accountId,
            actionTime: clock.now(),
            creatorTimeZone: timeZone,
        });
        const assigneeAction = findAction<TaskUpdateAssigneeAction>(actions, "UpdateAssignee");
        expect(assigneeAction?.taskAction.assignee?.assigneeId).toBe(assigneeId);
    });

    test("copies collection ids", () => {
        const collectionId1 = generateId<TaskCollectionId>();
        const collectionId2 = generateId<TaskCollectionId>();
        task = task.applyAction(
            {
                type: "UpdateTask",
                taskId: task.id,
                time: clock.now(),
                taskAction: {
                    type: "AddCollection",
                    collectionId: collectionId1,
                    orderKey: initialOrderKey,
                },
            },
            getActionReferencedSortableAccount,
        );

        task = task.applyAction(
            {
                type: "UpdateTask",
                taskId: task.id,
                time: clock.now(),
                taskAction: {
                    type: "AddCollection",
                    collectionId: collectionId2,
                    orderKey: generateOrderKeyBetween(initialOrderKey, null),
                },
            },
            getActionReferencedSortableAccount,
        );

        const {actions} = task.getDuplicateActions({
            creatorId: accountId,
            actionTime: clock.now(),
            creatorTimeZone: timeZone,
        });
        const collectionActions = findActions<TaskAddCollectionAction>(actions, "AddCollection", 2);

        expect(collectionActions[0]?.taskAction.collectionId).toBe(collectionId1);
        expect(collectionActions[1]?.taskAction.collectionId).toBe(collectionId2);
    });

    test("copies due date", () => {
        const dueDate = new CalendarDate(2025, 5, 20);
        task = task.applyAction(
            {
                type: "UpdateTask",
                taskId: task.id,
                time: clock.now(),
                taskAction: {
                    type: "UpdateDueDate",
                    dueDate: dueDate,
                },
            },
            getActionReferencedSortableAccount,
        );

        const {actions} = task.getDuplicateActions({
            creatorId: accountId,
            actionTime: clock.now(),
            creatorTimeZone: timeZone,
        });
        const dueDateAction = findAction<TaskUpdateDueDateAction>(actions, "UpdateDueDate");
        expect(dueDateAction?.taskAction.dueDate).toBe(dueDate);
    });

    test("copies priority", () => {
        task = task.applyAction(
            {
                type: "UpdateTask",
                taskId: task.id,
                time: clock.now(),
                taskAction: {
                    type: "UpdatePriority",
                    priority: "High",
                },
            },
            getActionReferencedSortableAccount,
        );

        const {actions} = task.getDuplicateActions({
            creatorId: accountId,
            actionTime: clock.now(),
            creatorTimeZone: timeZone,
        });
        const priorityAction = findAction<TaskUpdatePriorityAction>(actions, "UpdatePriority");
        expect(priorityAction?.taskAction.priority).toBe("High");
    });

    test("copies layout when not default", () => {
        task = task.applyAction(
            {
                type: "UpdateTask",
                taskId: task.id,
                time: clock.now(),
                taskAction: {
                    type: "UpdateLayout",
                    layout: "Project",
                },
            },
            getActionReferencedSortableAccount,
        );

        const {actions} = task.getDuplicateActions({
            creatorId: accountId,
            actionTime: clock.now(),
            creatorTimeZone: timeZone,
        });
        const layoutAction = findAction(actions, "UpdateLayout");
        expect(layoutAction?.taskAction.type).toBe("UpdateLayout");
        assert(layoutAction?.taskAction.type === "UpdateLayout");
        expect(layoutAction.taskAction.layout).toBe("Project");
    });
});
