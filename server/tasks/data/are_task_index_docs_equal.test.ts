import {areTaskIndexDocsEqual} from "~/server/tasks/data/are_task_index_docs_equal.js";
import {createEmptyTaskIndexDoc} from "~/server/tasks/data/create_empty_task_index_doc.js";
import {TaskIndexDocWithVersion} from "~/server/tasks/data/task_index_doc.js";
import {HybridLogicalTime} from "~/shared/helpers/clock/hybrid_logical_clock.js";
import {defaultTimeZone} from "~/shared/helpers/date/time_zone.js";
import {generateId} from "~/shared/id/id.js";
import {SpaceId, TaskId} from "~/shared/id/types/id_types.js";
import {TaskPriorityRegister} from "~/shared/tasks/task_priority.js";
import {TaskSortableAccount} from "~/shared/tasks/task_sortable_account.js";

test("identical tasks return true", () => {
    const spaceId = generateId<SpaceId>();
    const taskId = generateId<TaskId>();
    const creator = new TaskSortableAccount({accountId: generateId(), workingAccountName: "Test"});
    const createdTime: HybridLogicalTime = [Date.now(), 0];

    const task1 = {
        id: taskId,
        spaceId,
        ...createEmptyTaskIndexDoc(createdTime, {
            type: "Create",
            creator,
            creatorTimeZone: defaultTimeZone,
        }),
    };
    const task2 = {
        id: taskId,
        spaceId,
        ...createEmptyTaskIndexDoc(createdTime, {
            type: "Create",
            creator,
            creatorTimeZone: defaultTimeZone,
        }),
    };

    expect(areTaskIndexDocsEqual(task1, task2)).toEqual(true);
    expect(areTaskIndexDocsEqual(task2, task1)).toEqual(true);
});

test("non-identical tasks return false", () => {
    const spaceId = generateId<SpaceId>();
    const taskId = generateId<TaskId>();
    const creator = new TaskSortableAccount({accountId: generateId(), workingAccountName: "Test"});
    const createdTime: HybridLogicalTime = [Date.now(), 0];

    const task1a = {
        id: taskId,
        spaceId,
        ...createEmptyTaskIndexDoc(createdTime, {
            type: "Create",
            creator,
            creatorTimeZone: defaultTimeZone,
        }),
    };
    const task2 = {
        id: taskId,
        spaceId,
        ...createEmptyTaskIndexDoc(createdTime, {
            type: "Create",
            creator,
            creatorTimeZone: defaultTimeZone,
        }),
    };

    const task1b = {
        ...task1a,
        priority: new TaskPriorityRegister("High", [createdTime[0], 1]),
    };

    expect(areTaskIndexDocsEqual(task1a, task2)).toEqual(true);
    expect(areTaskIndexDocsEqual(task2, task1a)).toEqual(true);
    expect(areTaskIndexDocsEqual(task1b, task2)).toEqual(false);
    expect(areTaskIndexDocsEqual(task2, task1b)).toEqual(false);
    expect(areTaskIndexDocsEqual(task1a, task1b)).toEqual(false);
    expect(areTaskIndexDocsEqual(task1b, task1a)).toEqual(false);
});

test("identical tasks ignore version number", () => {
    const spaceId = generateId<SpaceId>();
    const taskId = generateId<TaskId>();
    const creator = new TaskSortableAccount({accountId: generateId(), workingAccountName: "Test"});
    const createdTime: HybridLogicalTime = [Date.now(), 0];

    const task1: TaskIndexDocWithVersion = {
        id: taskId,
        spaceId,
        ...createEmptyTaskIndexDoc(createdTime, {
            type: "Create",
            creator,
            creatorTimeZone: defaultTimeZone,
        }),
        version: {
            sequenceNumber: 42,
            primaryTerm: 1,
        },
    };
    const task2 = {
        id: taskId,
        spaceId,
        ...createEmptyTaskIndexDoc(createdTime, {
            type: "Create",
            creator,
            creatorTimeZone: defaultTimeZone,
        }),
    };

    expect(areTaskIndexDocsEqual(task1, task2)).toEqual(true);
    expect(areTaskIndexDocsEqual(task2, task1)).toEqual(true);
});
