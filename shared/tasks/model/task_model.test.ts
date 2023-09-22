import {HybridLogicalTime} from "~/shared/helpers/clock/hybrid_logical_clock.js";
import {defaultTimeZone} from "~/shared/helpers/date/time_zone.js";
import {generateId} from "~/shared/id/id.js";
import {SpaceId, TaskId} from "~/shared/id/types/id_types.js";
import {TaskModel} from "~/shared/tasks/model/task_model.js";
import {TaskPriorityRegister} from "~/shared/tasks/task_priority.js";
import {TaskSortableAccount} from "~/shared/tasks/task_sortable_account.js";

test("merging identical tasks returns a referentially equal value to the first one", () => {
    const spaceId = generateId<SpaceId>();
    const taskId = generateId<TaskId>();
    const creator = new TaskSortableAccount({
        accountId: generateId(),
        workingAccountName: "Test",
        workingAccountNameVersion: 0,
    });
    const createdTime: HybridLogicalTime = [Date.now(), 0];

    const task1 = TaskModel.createFromAction(spaceId, taskId, createdTime, {
        type: "Create",
        creator,
        creatorTimeZone: defaultTimeZone,
    });
    const task2 = TaskModel.createFromAction(spaceId, taskId, createdTime, {
        type: "Create",
        creator,
        creatorTimeZone: defaultTimeZone,
    });

    expect(task1.merge(task2)).toBe(task1);
    expect(task1.merge(task2)).not.toBe(task2);
    expect(task2.merge(task1)).toBe(task2);
    expect(task2.merge(task1)).not.toBe(task1);
});

test("merging tasks returns a referentially equal value to the first one if the first task didn't change", () => {
    const spaceId = generateId<SpaceId>();
    const taskId = generateId<TaskId>();
    const creator = new TaskSortableAccount({
        accountId: generateId(),
        workingAccountName: "Test",
        workingAccountNameVersion: 0,
    });
    const createdTime: HybridLogicalTime = [Date.now(), 0];

    const task1a = TaskModel.createFromAction(spaceId, taskId, createdTime, {
        type: "Create",
        creator,
        creatorTimeZone: defaultTimeZone,
    });
    const task2 = TaskModel.createFromAction(spaceId, taskId, createdTime, {
        type: "Create",
        creator,
        creatorTimeZone: defaultTimeZone,
    });

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
