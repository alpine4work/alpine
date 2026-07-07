import {parseDate} from "@internationalized/date";
import {intoApiTaskStatus} from "~/shared/api/content/closed_source/into_api_task_status.js";
import {
    ApiTaskAccountFilterOperation,
    ApiTaskCreatorFilterOperation,
    ApiTaskFilter,
    ApiTaskLayout,
    ApiTaskPriority,
    ApiTaskStatus,
    ApiTaskTimeFilterOperation,
    ApiTaskTimeFilterOperationDuration,
    ApiTaskTimeFilterOperationTime,
} from "~/shared/api/specification/types/api_specification_convenience_types.js";
import {InvalidArgumentError} from "~/shared/error/error.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {TaskDisplayStatus} from "~/shared/tasks/task_display_status.js";
import {TaskLayout} from "~/shared/tasks/task_layout.js";
import {TaskPriority} from "~/shared/tasks/task_priority.js";
import {
    TaskQueryFilter,
    TaskQueryFilterAccountOperation,
    TaskQueryFilterCreatorAccountOperation,
    TaskQueryFilterDateOperation,
    TaskQueryFilterDateOperationDate,
    TaskQueryFilterDateOperationDuration,
} from "~/shared/tasks/task_query_filter.js";

export function intoApiFilter(filter: TaskQueryFilter): ApiTaskFilter {
    switch (filter.type) {
        case "DisplayStatus": {
            return {
                type: "Status",
                operation: {
                    type: filter.operation.type,
                    statuses: Array.from(filter.operation.displayStatuses, intoApiTaskStatus),
                },
            };
        }
        case "Collections": {
            return {
                type: "Collections",
                operation:
                    filter.operation.type === "IsEmpty"
                        ? {type: "IsEmpty"}
                        : {
                              type: filter.operation.type,
                              collections: Array.from(
                                  filter.operation.collectionIds,
                                  collectionId => ({id: collectionId}),
                              ),
                          },
            };
        }
        case "Priority": {
            return {
                type: "Priority",
                operation: {
                    type: filter.operation.type,
                    priorities: Array.from(filter.operation.priorities, intoApiTaskPriority),
                },
            };
        }
        case "Layout": {
            return {
                type: "Layout",
                operation: {
                    type: filter.operation.type,
                    layouts: filter.operation.layouts.map(intoApiTaskLayout),
                },
            };
        }
        case "Title": {
            return {type: "Title", operation: filter.operation};
        }
        case "Assignee": {
            return {
                type: "Assignee",
                operation: intoApiTaskAccountFilterOperation(filter.operation),
            };
        }
        case "Creator": {
            return {
                type: "Creator",
                operation: intoApiTaskCreatorFilterOperation(filter.operation),
            };
        }
        case "Assigner": {
            return {
                type: "Assigner",
                operation: intoApiTaskAccountFilterOperation(filter.operation),
            };
        }
        case "DueDate": {
            return {
                type: "Due",
                operation:
                    filter.operation.type === "Overdue" || filter.operation.type === "IsEmpty"
                        ? filter.operation
                        : intoApiTaskTimeFilterOperation(filter.operation),
            };
        }
        case "CreatedDate": {
            return {
                type: "CreatedTime",
                operation: intoApiTaskTimeFilterOperation(filter.operation),
            };
        }
        case "AssignedDate": {
            return {
                type: "AssignedTime",
                operation: intoApiTaskTimeFilterOperation(filter.operation),
            };
        }
        case "ClosedDate": {
            return {
                type: "ClosedTime",
                operation: intoApiTaskTimeFilterOperation(filter.operation),
            };
        }
        case "ActivatedDate": {
            return {
                type: "ActivatedTime",
                operation: intoApiTaskTimeFilterOperation(filter.operation),
            };
        }
        default:
            throw exhaustive(filter);
    }
}

function intoApiTaskPriority(priority: TaskPriority | null): ApiTaskPriority | null {
    switch (priority) {
        case "Low":
            return {type: "Low"};
        case "Medium":
            return {type: "Medium"};
        case "High":
            return {type: "High"};
        case "Urgent":
            return {type: "Urgent"};
        case null:
            return null;
        default:
            throw exhaustive(priority);
    }
}

function intoApiTaskLayout(layout: TaskLayout): ApiTaskLayout {
    switch (layout) {
        case "Project":
            return {type: "Project"};
        default:
            throw exhaustive(layout);
    }
}

function intoApiTaskAccountFilterOperation(
    operation: TaskQueryFilterAccountOperation,
): ApiTaskAccountFilterOperation {
    return {
        type: operation.type,
        accounts: operation.accounts.map(account => {
            switch (account.type) {
                case "Account":
                    return {type: "Account", account: {id: account.accountId}};
                case "CurrentAccount":
                    return {type: "CurrentAccount"};
                case "MissingAccount":
                    return {type: "MissingAccount"};
                default:
                    throw exhaustive(account);
            }
        }),
    };
}

function intoApiTaskCreatorFilterOperation(
    operation: TaskQueryFilterCreatorAccountOperation,
): ApiTaskCreatorFilterOperation {
    return {
        type: operation.type,
        accounts: operation.accounts.map(account => {
            switch (account.type) {
                case "Account":
                    return {type: "Account", account: {id: account.accountId}};
                case "CurrentAccount":
                    return {type: "CurrentAccount"};
                default:
                    throw exhaustive(account);
            }
        }),
    };
}

function intoApiTaskTimeFilterOperation(
    operation: TaskQueryFilterDateOperation,
): ApiTaskTimeFilterOperation {
    switch (operation.type) {
        case "LessThan":
        case "GreaterThan":
            return {type: operation.type, time: intoApiTaskTimeFilterOperationTime(operation.date)};
        default:
            throw exhaustive(operation);
    }
}

function intoApiTaskTimeFilterOperationTime(
    date: TaskQueryFilterDateOperationDate,
): ApiTaskTimeFilterOperationTime {
    switch (date.type) {
        case "Absolute":
            return {type: "AbsoluteDate", date: date.date?.toString() ?? null};
        case "RelativeToday":
            return {type: "RelativeToday"};
        case "RelativeAfterToday":
        case "RelativeBeforeToday":
            return {
                type: date.type,
                duration: intoApiTaskTimeFilterOperationDuration(date.duration),
            };
        default:
            throw exhaustive(date);
    }
}

function intoApiTaskTimeFilterOperationDuration(
    duration: TaskQueryFilterDateOperationDuration,
): ApiTaskTimeFilterOperationDuration {
    switch (duration.type) {
        case "Days":
            return {type: "Days", days: duration.count};
        case "Weeks":
            return {type: "Weeks", weeks: duration.count};
        case "Months":
            return {type: "Months", months: duration.count};
        case "Years":
            return {type: "Years", years: duration.count};
        default:
            throw exhaustive(duration);
    }
}

export function fromApiFilter(filter: ApiTaskFilter): TaskQueryFilter {
    switch (filter.type) {
        case "Status": {
            return {
                type: "DisplayStatus",
                operation: {
                    type: filter.operation.type,
                    displayStatuses: new Set(filter.operation.statuses.map(fromApiTaskStatus)),
                },
            };
        }
        case "Collections": {
            return {
                type: "Collections",
                operation:
                    filter.operation.type === "IsEmpty"
                        ? {type: "IsEmpty"}
                        : {
                              type: filter.operation.type,
                              collectionIds: new Set(
                                  filter.operation.collections.map(({id}) => id),
                              ),
                          },
            };
        }
        case "Priority": {
            return {
                type: "Priority",
                operation: {
                    type: filter.operation.type,
                    priorities: new Set(filter.operation.priorities.map(fromApiTaskPriority)),
                },
            };
        }
        case "Layout": {
            return {
                type: "Layout",
                operation: {
                    type: filter.operation.type,
                    layouts: fromApiTaskLayoutFilterLayouts(filter.operation.layouts),
                },
            };
        }
        case "Title": {
            return {type: "Title", operation: filter.operation};
        }
        case "Assignee": {
            return {
                type: "Assignee",
                operation: fromApiTaskAccountFilterOperation(filter.operation),
            };
        }
        case "Creator": {
            return {
                type: "Creator",
                operation: fromApiTaskCreatorFilterOperation(filter.operation),
            };
        }
        case "Assigner": {
            return {
                type: "Assigner",
                operation: fromApiTaskAccountFilterOperation(filter.operation),
            };
        }
        case "Due": {
            return {
                type: "DueDate",
                operation:
                    filter.operation.type === "Overdue" || filter.operation.type === "IsEmpty"
                        ? filter.operation
                        : fromApiTaskTimeFilterOperation(filter.operation),
            };
        }
        case "CreatedTime": {
            return {
                type: "CreatedDate",
                operation: fromApiTaskTimeFilterOperation(filter.operation),
            };
        }
        case "AssignedTime": {
            return {
                type: "AssignedDate",
                operation: fromApiTaskTimeFilterOperation(filter.operation),
            };
        }
        case "ClosedTime": {
            return {
                type: "ClosedDate",
                operation: fromApiTaskTimeFilterOperation(filter.operation),
            };
        }
        case "ActivatedTime": {
            return {
                type: "ActivatedDate",
                operation: fromApiTaskTimeFilterOperation(filter.operation),
            };
        }
        default:
            throw exhaustive(filter);
    }
}

function fromApiTaskPriority(priority: ApiTaskPriority | null): TaskPriority | null {
    if (priority === null) return null;

    switch (priority.type) {
        case "Low":
        case "Medium":
        case "High":
        case "Urgent":
            return priority.type;
        default:
            throw exhaustive(priority);
    }
}

function fromApiTaskLayout(layout: ApiTaskLayout): TaskLayout {
    switch (layout.type) {
        case "Project":
            return "Project";
        default:
            throw exhaustive(layout.type);
    }
}

function fromApiTaskAccountFilterOperation(
    operation: ApiTaskAccountFilterOperation,
): TaskQueryFilterAccountOperation {
    return {
        type: operation.type,
        accounts: operation.accounts.map(account => {
            switch (account.type) {
                case "Account":
                    return {type: "Account", accountId: account.account.id};
                case "CurrentAccount":
                    return {type: "CurrentAccount"};
                case "MissingAccount":
                    return {type: "MissingAccount"};
                default:
                    throw exhaustive(account);
            }
        }),
    };
}

function fromApiTaskCreatorFilterOperation(
    operation: ApiTaskCreatorFilterOperation,
): TaskQueryFilterCreatorAccountOperation {
    return {
        type: operation.type,
        accounts: operation.accounts.map(account => {
            switch (account.type) {
                case "Account":
                    return {type: "Account", accountId: account.account.id};
                case "CurrentAccount":
                    return {type: "CurrentAccount"};
                default:
                    throw exhaustive(account);
            }
        }),
    };
}

function fromApiTaskTimeFilterOperation(
    operation: ApiTaskTimeFilterOperation,
): TaskQueryFilterDateOperation {
    switch (operation.type) {
        case "LessThan":
        case "GreaterThan":
            return {type: operation.type, date: fromApiTaskTimeFilterOperationTime(operation.time)};
        default:
            throw exhaustive(operation);
    }
}

function fromApiTaskTimeFilterOperationTime(
    time: ApiTaskTimeFilterOperationTime,
): TaskQueryFilterDateOperationDate {
    switch (time.type) {
        case "AbsoluteDate":
            return {type: "Absolute", date: time.date === null ? null : parseDate(time.date)};
        case "RelativeToday":
            return {type: "RelativeToday"};
        case "RelativeAfterToday":
        case "RelativeBeforeToday":
            return {
                type: time.type,
                duration: fromApiTaskTimeFilterOperationDuration(time.duration),
            };
        default:
            throw exhaustive(time);
    }
}

function fromApiTaskTimeFilterOperationDuration(
    duration: ApiTaskTimeFilterOperationDuration,
): TaskQueryFilterDateOperationDuration {
    switch (duration.type) {
        case "Days":
            return {type: "Days", count: duration.days};
        case "Weeks":
            return {type: "Weeks", count: duration.weeks};
        case "Months":
            return {type: "Months", count: duration.months};
        case "Years":
            return {type: "Years", count: duration.years};
        default:
            throw exhaustive(duration);
    }
}

function fromApiTaskStatus(status: ApiTaskStatus): TaskDisplayStatus {
    switch (status.type) {
        case "Open":
            return status.isActive ? "OpenActive" : "OpenInactive";
        case "Closed":
            return "Closed";
        default:
            throw exhaustive(status);
    }
}

function fromApiTaskLayoutFilterLayouts(
    layouts: ReadonlyArray<ApiTaskLayout>,
): readonly [TaskLayout] {
    const normalizedLayouts = new Set(layouts.map(fromApiTaskLayout));

    if (normalizedLayouts.size !== 1) {
        throw new InvalidArgumentError("Task layout filters must include exactly one layout");
    }

    return [Array.from(normalizedLayouts)[0]!];
}
