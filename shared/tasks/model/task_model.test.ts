import {HybridLogicalTime} from "~/shared/helpers/clock/hybrid_logical_clock.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {defaultTimeZone} from "~/shared/helpers/intl/time_zone.js";
import {generateId} from "~/shared/id/id.js";
import {AccountId, SpaceId, TaskId} from "~/shared/id/types/id_types.js";
import {TaskModel} from "~/shared/tasks/model/task_model.js";
import {TaskPriorityRegister} from "~/shared/tasks/task_priority.js";

test("merging identical tasks returns a referentially equal value to the first one", () => {
    const spaceId = generateId<SpaceId>();
    const taskId = generateId<TaskId>();
    const accountId = generateId<AccountId>();
    const createdTime: HybridLogicalTime = [Date.now(), 0];

    const task1 = TaskModel.createFromAction(
        spaceId,
        taskId,
        createdTime,
        {
            type: "Create",
            creatorId: accountId,
            creatorTimeZone: defaultTimeZone,
        },
        otherAccountId => {
            assert(accountId === otherAccountId);

            return {
                accountId,
                workingAccountName: "Test",
                workingAccountNameVersion: 0,
            };
        },
    );
    const task2 = TaskModel.createFromAction(
        spaceId,
        taskId,
        createdTime,
        {
            type: "Create",
            creatorId: accountId,
            creatorTimeZone: defaultTimeZone,
        },
        otherAccountId => {
            assert(accountId === otherAccountId);

            return {
                accountId,
                workingAccountName: "Test",
                workingAccountNameVersion: 0,
            };
        },
    );

    expect(task1.merge(task2)).toBe(task1);
    expect(task1.merge(task2)).not.toBe(task2);
    expect(task2.merge(task1)).toBe(task2);
    expect(task2.merge(task1)).not.toBe(task1);
});

test("merging tasks returns a referentially equal value to the first one if the first task didn't change", () => {
    const spaceId = generateId<SpaceId>();
    const taskId = generateId<TaskId>();
    const accountId = generateId<AccountId>();
    const createdTime: HybridLogicalTime = [Date.now(), 0];

    const task1a = TaskModel.createFromAction(
        spaceId,
        taskId,
        createdTime,
        {
            type: "Create",
            creatorId: accountId,
            creatorTimeZone: defaultTimeZone,
        },
        otherAccountId => {
            assert(accountId === otherAccountId);

            return {
                accountId,
                workingAccountName: "Test",
                workingAccountNameVersion: 0,
            };
        },
    );
    const task2 = TaskModel.createFromAction(
        spaceId,
        taskId,
        createdTime,
        {
            type: "Create",
            creatorId: accountId,
            creatorTimeZone: defaultTimeZone,
        },
        otherAccountId => {
            assert(accountId === otherAccountId);

            return {
                accountId,
                workingAccountName: "Test",
                workingAccountNameVersion: 0,
            };
        },
    );

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
