import {assert} from "~/shared/helpers/control/assert.open_source.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.open_source.js";
import {TaskId} from "~/shared/id/types/id_types.open_source.js";
import {TaskQueryNormalizedSort} from "~/shared/tasks/task_query_normalized_sort.js";

/**
 * A sort cursor represents a task's position in a query according to its sorts. We
 * have one cursor value for each sort and the `TaskId` to disambiguate adjacent
 * tasks with identical sorts.
 */
export type TaskQuerySortCursor = [...ReadonlyArray<TaskQuerySortCursorValue>, TaskId];

export type TaskQuerySortCursorValue = string | number | ReadonlyArray<string | number> | null;

export function getTaskQuerySortCursorTaskId(cursor: TaskQuerySortCursor): TaskId {
    return cursor[cursor.length - 1] as TaskId;
}

/**
 * Compare two query sort cursors to determine where the task belongs in the query
 * relative to other tasks.
 *
 * - If <0 then `cursor1 < cursor2`
 * - If >0 then `cursor1 > cursor2`
 * - If 0 then `cursor1 = cursor2`
 */
export function compareTaskQuerySortCursors(
    sorts: ReadonlyArray<TaskQueryNormalizedSort>,
    cursor1: TaskQuerySortCursor,
    cursor2: TaskQuerySortCursor,
): number {
    assert(cursor1.length === sorts.length + 1);
    assert(cursor2.length === sorts.length + 1);

    let i = 0;
    const sortsLength = sorts.length;
    for (; i < sortsLength; i++) {
        const {direction, missing} = sorts[i]!;
        const value1 = cursor1[i] as TaskQuerySortCursorValue;
        const value2 = cursor2[i] as TaskQuerySortCursorValue;

        if (value1 === null && value2 === null) continue;
        if (value1 === null) return missing === "Last" ? 1 : -1;
        if (value2 === null) return missing === "Last" ? -1 : 1;

        switch (typeof value1) {
            case "number": {
                if (typeof value2 !== "number") return -1;
                let comparison = value1 - value2;
                if (comparison !== 0) {
                    if (direction !== "Ascending") comparison = -comparison;
                    return comparison;
                }
                break;
            }
            case "string": {
                if (typeof value2 !== "string") return typeof value2 === "object" ? -1 : 1;
                if (value1 < value2) return direction === "Ascending" ? -1 : 1;
                if (value1 > value2) return direction === "Ascending" ? 1 : -1;
                break;
            }
            case "object": {
                if (typeof value2 !== "object") return 1;

                const valueLength = Math.min(value1.length, value2.length);
                for (let j = 0; j < valueLength; j++) {
                    const subValue1 = value1[j]!;
                    const subValue2 = value2[j]!;

                    switch (typeof subValue1) {
                        case "number": {
                            if (typeof subValue2 !== "number") return -1;
                            let comparison = subValue1 - subValue2;
                            if (comparison !== 0) {
                                if (direction !== "Ascending") comparison = -comparison;
                                return comparison;
                            }
                            break;
                        }
                        case "string": {
                            if (typeof subValue2 !== "string") return 1;
                            if (subValue1 < subValue2) return direction === "Ascending" ? -1 : 1;
                            if (subValue1 > subValue2) return direction === "Ascending" ? 1 : -1;
                            break;
                        }
                        default:
                            throw exhaustive(subValue1);
                    }
                }

                let comparison = value1.length - value2.length;
                if (comparison !== 0) {
                    if (missing === "Last") comparison = -comparison;
                    return comparison;
                }
                break;
            }
            default:
                throw exhaustive(value1);
        }
    }

    const taskId1 = cursor1[i] as TaskId;
    const taskId2 = cursor2[i] as TaskId;

    if (taskId1 < taskId2) return -1;
    if (taskId1 > taskId2) return 1;
    return 0;
}
