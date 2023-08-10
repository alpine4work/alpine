import {createEmptyTaskIndexDoc} from "~/server/tasks/index/create_empty_task_index_doc.js";
import {mergeTaskIndexDocs} from "~/server/tasks/index/merge_task_index_docs.js";
import {HybridLogicalTime} from "~/shared/helpers/clock/hybrid_logical_clock.js";
import {defaultTimeZone} from "~/shared/helpers/date/time_zone.js";
import {generateId} from "~/shared/id/id.js";
import {SpaceId} from "~/shared/id/types/id_types.js";
import {TaskPriorityRegister} from "~/shared/tasks/task_priority.js";
import {TaskSortableAccount} from "~/shared/tasks/task_sortable_account.js";

test("merging identical tasks returns a referentially equal value to the first one", () => {
    const spaceId = generateId<SpaceId>();
    const creator = new TaskSortableAccount({accountId: generateId(), workingAccountName: "Test"});
    const createdTime: HybridLogicalTime = [Date.now(), 0];

    const task1 = {
        spaceId,
        ...createEmptyTaskIndexDoc(createdTime, {
            type: "Create",
            creator,
            creatorTimeZone: defaultTimeZone,
        }),
    };
    const task2 = {
        spaceId,
        ...createEmptyTaskIndexDoc(createdTime, {
            type: "Create",
            creator,
            creatorTimeZone: defaultTimeZone,
        }),
    };

    expect(mergeTaskIndexDocs(task1, task2)).toBe(task1);
    expect(mergeTaskIndexDocs(task1, task2)).not.toBe(task2);
    expect(mergeTaskIndexDocs(task2, task1)).toBe(task2);
    expect(mergeTaskIndexDocs(task2, task1)).not.toBe(task1);
});

test("merging tasks returns a referentially equal value to the first one if the first task didn't change", () => {
    const spaceId = generateId<SpaceId>();
    const creator = new TaskSortableAccount({accountId: generateId(), workingAccountName: "Test"});
    const createdTime: HybridLogicalTime = [Date.now(), 0];

    const task1a = {
        spaceId,
        ...createEmptyTaskIndexDoc(createdTime, {
            type: "Create",
            creator,
            creatorTimeZone: defaultTimeZone,
        }),
    };
    const task2 = {
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

    expect(mergeTaskIndexDocs(task1b, task2)).toBe(task1b);
    expect(mergeTaskIndexDocs(task1b, task2)).not.toBe(task2);
    expect(mergeTaskIndexDocs(task2, task1b)).not.toBe(task2);
    expect(mergeTaskIndexDocs(task2, task1b)).not.toBe(task1b);
    expect(mergeTaskIndexDocs(task2, task1b)).toEqual(task1b);
});
