import {LocalTask} from "~/client/tasks/demo_2/local_tasks_state.js";
import {TaskQuerySort} from "~/client/tasks/demo_2/task_query_sort.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {defaultCompareStrings} from "~/shared/helpers/string/default_compare_strings.js";

/**
 * Create a function that will compare two tasks based on our sorts from the
 * sort editor.
 */
export function createTaskQuerySortsCompareFunction(
    sorts: ReadonlyArray<TaskQuerySort>,
): (task1: LocalTask, task2: LocalTask) => number {
    const compareFunctions: Array<(task1: LocalTask, task2: LocalTask) => number> = [];

    function pushCompareFunction<Value>({
        get,
        compare,
        reverse,
    }: {
        get: (task: LocalTask) => Value;
        compare: (value1: Value, value2: Value) => number;
        reverse?: boolean;
    }) {
        compareFunctions.push((task1, task2) => {
            const value1 = get(task1);
            const value2 = get(task2);

            const comparison = compare(value1, value2);

            if (reverse) return -comparison;
            return comparison;
        });
    }

    for (const sort of sorts) {
        switch (sort.type) {
            case "Status": {
                pushCompareFunction({
                    get: task =>
                        task.status.type === "Open" && task.assignee?.status.type === "Active"
                            ? "Active"
                            : task.status.type,

                    compare: (value1, value2) => {
                        if (value1 === "Open" && value2 === "Open") return 0;
                        if (value1 === "Open") return -1;
                        if (value2 === "Open") return 1;

                        if (value1 === "Active" && value2 === "Active") return 0;
                        if (value1 === "Active") return -1;
                        if (value2 === "Active") return 1;

                        if (value1 === "Closed" && value2 === "Closed") return 0;
                        if (value1 === "Closed") return -1;
                        if (value2 === "Closed") return 1;

                        exhaustive(value1);
                        throw exhaustive(value2);
                    },

                    reverse: sort.direction === "Descending",
                });
                break;
            }
            case "Priority": {
                pushCompareFunction({
                    get: task => task.priority,
                    compare: (value1, value2) => {
                        if (value1 === null && value2 === null) return 0;
                        if (value1 === null) return -1;
                        if (value2 === null) return 1;

                        if (value1 === "Low" && value2 === "Low") return 0;
                        if (value1 === "Low") return -1;
                        if (value2 === "Low") return 1;

                        if (value1 === "Medium" && value2 === "Medium") return 0;
                        if (value1 === "Medium") return -1;
                        if (value2 === "Medium") return 1;

                        if (value1 === "High" && value2 === "High") return 0;
                        if (value1 === "High") return -1;
                        if (value2 === "High") return 1;

                        if (value1 === "Urgent" && value2 === "Urgent") return 0;
                        if (value1 === "Urgent") return -1;
                        if (value2 === "Urgent") return 1;

                        exhaustive(value1);
                        throw exhaustive(value2);
                    },
                    reverse: sort.direction === "Descending",
                });
                break;
            }
            // TODO(calebmer): In a production implementation this should be sorted alphabetically.
            case "Assignee": {
                pushCompareFunction({
                    get: task => task.assignee?.account.id ?? null,

                    compare: (value1, value2) => {
                        if (value1 === null && value2 === null) return 0;
                        if (value1 === null) return sort.noAccountSide === "Start" ? -1 : 1;
                        if (value2 === null) return sort.noAccountSide === "Start" ? 1 : -1;

                        return defaultCompareStrings(value1, value2);
                    },
                });
                break;
            }
            // TODO(calebmer): In a production implementation this should be sorted alphabetically.
            case "Creator": {
                pushCompareFunction({
                    get: task => task.creatorId,
                    compare: defaultCompareStrings,
                });
                break;
            }
            // TODO(calebmer): In a production implementation this should be sorted alphabetically.
            case "Assigner": {
                pushCompareFunction({
                    get: task => task.assignee?.assignerId ?? null,

                    compare: (value1, value2) => {
                        if (value1 === null && value2 === null) return 0;
                        if (value1 === null) return sort.noAccountSide === "Start" ? -1 : 1;
                        if (value2 === null) return sort.noAccountSide === "Start" ? 1 : -1;

                        return defaultCompareStrings(value1, value2);
                    },
                });
                break;
            }
            case "DueDate": {
                pushCompareFunction({
                    get: task => task.dueDate,
                    compare: (value1, value2) => {
                        if (value1 === null && value2 === null) return 0;
                        if (value1 === null) return -1;
                        if (value2 === null) return 1;

                        return value1.compare(value2);
                    },
                    reverse: sort.direction === "Descending",
                });
                break;
            }
            case "CreatedDate": {
                pushCompareFunction({
                    get: task => ({date: task.createdDate, time: task.createdTime}),
                    compare: (value1, value2) =>
                        value1.date.compare(value2.date) ||
                        defaultCompareStrings(value1.time.toISOString(), value2.time.toISOString()),
                    reverse: sort.direction === "Descending",
                });
                break;
            }
            case "AssignedDate": {
                pushCompareFunction({
                    get: task =>
                        task.assignee
                            ? {date: task.assignee.assignedDate, time: task.assignee.assignedTime}
                            : null,
                    compare: (value1, value2) => {
                        if (value1 === null && value2 === null) return 0;
                        if (value1 === null) return -1;
                        if (value2 === null) return 1;

                        return (
                            value1.date.compare(value2.date) ||
                            defaultCompareStrings(
                                value1.time.toISOString(),
                                value2.time.toISOString(),
                            )
                        );
                    },
                    reverse: sort.direction === "Descending",
                });
                break;
            }
            case "ClosedDate": {
                pushCompareFunction({
                    get: task =>
                        task.status.type === "Closed"
                            ? {date: task.status.closedDate, time: task.status.closedTime}
                            : null,
                    compare: (value1, value2) => {
                        if (value1 === null && value2 === null) return 0;
                        if (value1 === null) return -1;
                        if (value2 === null) return 1;

                        return (
                            value1.date.compare(value2.date) ||
                            defaultCompareStrings(
                                value1.time.toISOString(),
                                value2.time.toISOString(),
                            )
                        );
                    },
                    reverse: sort.direction === "Descending",
                });
                break;
            }
            case "ActivatedDate": {
                pushCompareFunction({
                    get: task =>
                        task.assignee?.status.type === "Active"
                            ? {
                                  date: task.assignee.status.activatedDate,
                                  time: task.assignee.status.activatedTime,
                              }
                            : null,
                    compare: (value1, value2) => {
                        if (value1 === null && value2 === null) return 0;
                        if (value1 === null) return -1;
                        if (value2 === null) return 1;

                        return (
                            value1.date.compare(value2.date) ||
                            defaultCompareStrings(
                                value1.time.toISOString(),
                                value2.time.toISOString(),
                            )
                        );
                    },
                    reverse: sort.direction === "Descending",
                });
                break;
            }
            default:
                throw exhaustive(sort);
        }
    }

    // If we are not already sorting by created date then check created date as a
    // tiebreaker.
    if (!sorts.some(sort => sort.type === "CreatedDate")) {
        pushCompareFunction({
            get: task => ({date: task.createdDate, time: task.createdTime}),
            compare: (value1, value2) =>
                value1.date.compare(value2.date) ||
                defaultCompareStrings(value1.time.toISOString(), value2.time.toISOString()),
        });
    }

    // Final tiebreaker is to sort by task ID which gives us a canonical order for
    // tasks (just in case created time is not unique) that doesn't depend on the
    // undefined task order before sorting.
    pushCompareFunction({
        get: task => task.id,
        compare: defaultCompareStrings,
    });

    return (task1: LocalTask, task2: LocalTask) => {
        for (const compare of compareFunctions) {
            const comparison = compare(task1, task2);
            if (comparison !== 0) return comparison;
        }

        return 0;
    };
}
