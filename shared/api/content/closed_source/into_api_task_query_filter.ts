import {parseDate} from "@internationalized/date";
import {intoApiTaskStatus} from "~/shared/api/content/closed_source/into_api_task_status.js";
import {
    ApiTaskLayout,
    ApiTaskPriority,
    ApiTaskQueryAccountFilterOperation,
    ApiTaskQueryCreatorFilterOperation,
    ApiTaskQueryFilter,
    ApiTaskQueryTimeFilterOperation,
    ApiTaskQueryTimeFilterOperationDuration,
    ApiTaskQueryTimeFilterOperationTime,
    ApiTaskStatus,
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

export function intoApiTaskQueryFilter(filter: TaskQueryFilter): ApiTaskQueryFilter {
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
                operation: intoApiTaskQueryAccountFilterOperation(filter.operation),
            };
        }
        case "Creator": {
            return {
                type: "Creator",
                operation: intoApiTaskQueryCreatorFilterOperation(filter.operation),
            };
        }
        case "Assigner": {
            return {
                type: "Assigner",
                operation: intoApiTaskQueryAccountFilterOperation(filter.operation),
            };
        }
        case "DueDate": {
            return {
                type: "Due",
                operation:
                    filter.operation.type === "Overdue" || filter.operation.type === "IsEmpty"
                        ? filter.operation
                        : intoApiTaskQueryTimeFilterOperation(filter.operation),
            };
        }
        case "CreatedDate": {
            return {
                type: "CreatedTime",
                operation: intoApiTaskQueryTimeFilterOperation(filter.operation),
            };
        }
        case "AssignedDate": {
            return {
                type: "AssignedTime",
                operation: intoApiTaskQueryTimeFilterOperation(filter.operation),
            };
        }
        case "ClosedDate": {
            return {
                type: "ClosedTime",
                operation: intoApiTaskQueryTimeFilterOperation(filter.operation),
            };
        }
        case "ActivatedDate": {
            return {
                type: "ActivatedTime",
                operation: intoApiTaskQueryTimeFilterOperation(filter.operation),
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

function intoApiTaskQueryAccountFilterOperation(
    operation: TaskQueryFilterAccountOperation,
): ApiTaskQueryAccountFilterOperation {
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

function intoApiTaskQueryCreatorFilterOperation(
    operation: TaskQueryFilterCreatorAccountOperation,
): ApiTaskQueryCreatorFilterOperation {
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

function intoApiTaskQueryTimeFilterOperation(
    operation: TaskQueryFilterDateOperation,
): ApiTaskQueryTimeFilterOperation {
    switch (operation.type) {
        case "LessThan":
        case "GreaterThan":
            return {
                type: operation.type,
                time: intoApiTaskQueryTimeFilterOperationTime(operation.date),
            };
        default:
            throw exhaustive(operation);
    }
}

function intoApiTaskQueryTimeFilterOperationTime(
    date: TaskQueryFilterDateOperationDate,
): ApiTaskQueryTimeFilterOperationTime {
    switch (date.type) {
        case "Absolute":
            return {type: "AbsoluteDate", date: date.date?.toString() ?? null};
        case "RelativeToday":
            return {type: "RelativeToday"};
        case "RelativeAfterToday":
        case "RelativeBeforeToday":
            return {
                type: date.type,
                duration: intoApiTaskQueryTimeFilterOperationDuration(date.duration),
            };
        default:
            throw exhaustive(date);
    }
}

function intoApiTaskQueryTimeFilterOperationDuration(
    duration: TaskQueryFilterDateOperationDuration,
): ApiTaskQueryTimeFilterOperationDuration {
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

export function fromApiTaskQueryFilter(filter: ApiTaskQueryFilter): TaskQueryFilter {
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
                    layouts: fromApiTaskQueryLayoutFilterLayouts(filter.operation.layouts),
                },
            };
        }
        case "Title": {
            return {type: "Title", operation: filter.operation};
        }
        case "Assignee": {
            return {
                type: "Assignee",
                operation: fromApiTaskQueryAccountFilterOperation(filter.operation),
            };
        }
        case "Creator": {
            return {
                type: "Creator",
                operation: fromApiTaskQueryCreatorFilterOperation(filter.operation),
            };
        }
        case "Assigner": {
            return {
                type: "Assigner",
                operation: fromApiTaskQueryAccountFilterOperation(filter.operation),
            };
        }
        case "Due": {
            return {
                type: "DueDate",
                operation:
                    filter.operation.type === "Overdue" || filter.operation.type === "IsEmpty"
                        ? filter.operation
                        : fromApiTaskQueryTimeFilterOperation(filter.operation),
            };
        }
        case "CreatedTime": {
            return {
                type: "CreatedDate",
                operation: fromApiTaskQueryTimeFilterOperation(filter.operation),
            };
        }
        case "AssignedTime": {
            return {
                type: "AssignedDate",
                operation: fromApiTaskQueryTimeFilterOperation(filter.operation),
            };
        }
        case "ClosedTime": {
            return {
                type: "ClosedDate",
                operation: fromApiTaskQueryTimeFilterOperation(filter.operation),
            };
        }
        case "ActivatedTime": {
            return {
                type: "ActivatedDate",
                operation: fromApiTaskQueryTimeFilterOperation(filter.operation),
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

function fromApiTaskQueryAccountFilterOperation(
    operation: ApiTaskQueryAccountFilterOperation,
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

function fromApiTaskQueryCreatorFilterOperation(
    operation: ApiTaskQueryCreatorFilterOperation,
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

function fromApiTaskQueryTimeFilterOperation(
    operation: ApiTaskQueryTimeFilterOperation,
): TaskQueryFilterDateOperation {
    switch (operation.type) {
        case "LessThan":
        case "GreaterThan":
            return {
                type: operation.type,
                date: fromApiTaskQueryTimeFilterOperationTime(operation.time),
            };
        default:
            throw exhaustive(operation);
    }
}

function fromApiTaskQueryTimeFilterOperationTime(
    time: ApiTaskQueryTimeFilterOperationTime,
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
                duration: fromApiTaskQueryTimeFilterOperationDuration(time.duration),
            };
        default:
            throw exhaustive(time);
    }
}

function fromApiTaskQueryTimeFilterOperationDuration(
    duration: ApiTaskQueryTimeFilterOperationDuration,
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

function fromApiTaskQueryLayoutFilterLayouts(
    layouts: ReadonlyArray<ApiTaskLayout>,
): readonly [TaskLayout] {
    const normalizedLayouts = new Set(layouts.map(fromApiTaskLayout));

    if (normalizedLayouts.size !== 1) {
        throw new InvalidArgumentError("Task layout filters must include exactly one layout");
    }

    return [Array.from(normalizedLayouts)[0]!];
}
