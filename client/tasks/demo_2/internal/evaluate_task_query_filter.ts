import {CalendarDate} from "@internationalized/date";
import {LocalTask} from "~/client/tasks/demo_2/local_tasks_state";
import {
    TaskQueryFilter,
    TaskQueryFilterDateOperation,
    TaskQueryFilterDateOperationDate,
} from "~/client/tasks/demo_2/task_query_filter";
import {exhaustive} from "~/shared/helpers/control/exhaustive";
import {iterableEvery} from "~/shared/helpers/iterable/iterable_every";
import {iterableSome} from "~/shared/helpers/iterable/iterable_some";
import {AccountId} from "~/shared/id/types/id_types";

export function evaluateTaskQueryFilter(
    filter: TaskQueryFilter,
    task: LocalTask,
    context: {
        currentAccountId: AccountId;
        currentDate: CalendarDate;
    },
): boolean {
    switch (filter.type) {
        case "Status": {
            const status =
                task.status.type === "Open" && task.assignee?.status.type === "Active"
                    ? "Active"
                    : task.status.type;

            switch (filter.operation.type) {
                case "OneOf":
                    return filter.operation.statuses.has(status);
                case "NoneOf":
                    return !filter.operation.statuses.has(status);
                default:
                    throw exhaustive(filter.operation);
            }
        }
        case "Collections": {
            switch (filter.operation.type) {
                case "IncludesOneOf": {
                    return iterableSome(filter.operation.collectionIds, collectionId =>
                        task.collectionIds.has(collectionId),
                    );
                }
                case "IncludesAllOf": {
                    return iterableEvery(filter.operation.collectionIds, collectionId =>
                        task.collectionIds.has(collectionId),
                    );
                }
                case "ExcludesAllOf": {
                    return iterableEvery(
                        filter.operation.collectionIds,
                        collectionId => !task.collectionIds.has(collectionId),
                    );
                }
                case "IsEmpty": {
                    return task.collectionIds.size === 0;
                }
                default:
                    throw exhaustive(filter.operation);
            }
        }
        case "Assignee": {
            const accountIds = new Set(
                filter.operation.accounts.map(account => {
                    switch (account.type) {
                        case "Account":
                            return account.accountId;
                        case "CurrentAccount":
                            return context.currentAccountId;
                        case "NoAccount":
                            return account.type;
                        default:
                            throw exhaustive(account);
                    }
                }),
            );

            switch (filter.operation.type) {
                case "OneOf":
                    return accountIds.has(task.assignee?.account.id ?? "NoAccount");
                case "NoneOf":
                    return !accountIds.has(task.assignee?.account.id ?? "NoAccount");
                default:
                    throw exhaustive(filter.operation);
            }
        }
        case "Creator": {
            const accountIds = new Set(
                filter.operation.accounts.map(account => {
                    switch (account.type) {
                        case "Account":
                            return account.accountId;
                        case "CurrentAccount":
                            return context.currentAccountId;
                        case "NoAccount":
                            return account.type;
                        default:
                            throw exhaustive(account);
                    }
                }),
            );

            switch (filter.operation.type) {
                case "OneOf":
                    return accountIds.has(task.creatorId);
                case "NoneOf":
                    return !accountIds.has(task.creatorId);
                default:
                    throw exhaustive(filter.operation);
            }
        }
        case "Assigner": {
            const accountIds = new Set(
                filter.operation.accounts.map(account => {
                    switch (account.type) {
                        case "Account":
                            return account.accountId;
                        case "CurrentAccount":
                            return context.currentAccountId;
                        case "NoAccount":
                            return account.type;
                        default:
                            throw exhaustive(account);
                    }
                }),
            );

            switch (filter.operation.type) {
                case "OneOf":
                    return accountIds.has(task.assignee?.assignerId ?? "NoAccount");
                case "NoneOf":
                    return !accountIds.has(task.assignee?.assignerId ?? "NoAccount");
                default:
                    throw exhaustive(filter.operation);
            }
        }
        case "DueDate": {
            switch (filter.operation.type) {
                case "Overdue": {
                    if (task.dueDate === null) return false;
                    return evaluateTaskQueryFilterDateOperation(
                        {type: "LessThan", date: {type: "RelativeToday"}},
                        task.dueDate,
                        context,
                    );
                }
                case "IsEmpty": {
                    return task.dueDate === null;
                }
                default: {
                    if (task.dueDate === null) return false;
                    return evaluateTaskQueryFilterDateOperation(
                        filter.operation,
                        task.dueDate,
                        context,
                    );
                }
            }
        }
        case "CreatedDate": {
            return evaluateTaskQueryFilterDateOperation(
                filter.operation,
                task.createdDate,
                context,
            );
        }
        case "AssignedDate": {
            if (!task.assignee?.assignedDate) return false;
            return evaluateTaskQueryFilterDateOperation(
                filter.operation,
                task.assignee.assignedDate,
                context,
            );
        }
        case "ClosedDate": {
            if (task.status.type === "Open") return false;
            return evaluateTaskQueryFilterDateOperation(
                filter.operation,
                task.status.closedDate,
                context,
            );
        }
        case "ActivatedDate": {
            if (task.assignee?.status.type !== "Active") return false;
            return evaluateTaskQueryFilterDateOperation(
                filter.operation,
                task.assignee.status.activatedDate,
                context,
            );
        }
        default:
            throw exhaustive(filter);
    }
}

function evaluateTaskQueryFilterDateOperation(
    operation: TaskQueryFilterDateOperation,
    date: CalendarDate,
    context: {currentDate: CalendarDate},
): boolean {
    switch (operation.type) {
        case "LessThan": {
            const comparisonDate = getTaskQueryFilterDateOperationDate(operation.date, context);
            if (comparisonDate === null) return true;
            return date.compare(comparisonDate) < 0;
        }
        case "GreaterThan": {
            const comparisonDate = getTaskQueryFilterDateOperationDate(operation.date, context);
            if (comparisonDate === null) return true;
            return date.compare(comparisonDate) > 0;
        }
        default:
            throw exhaustive(operation);
    }
}

function getTaskQueryFilterDateOperationDate(
    date: TaskQueryFilterDateOperationDate,
    context: {currentDate: CalendarDate},
): CalendarDate | null {
    switch (date.type) {
        case "Absolute":
            return date.date;
        case "RelativeToday":
            return context.currentDate;
        case "RelativeAfterToday": {
            switch (date.duration.type) {
                case "Days":
                    return context.currentDate.add({days: date.duration.count});
                case "Weeks":
                    return context.currentDate.add({weeks: date.duration.count});
                case "Months":
                    return context.currentDate.add({months: date.duration.count});
                case "Years":
                    return context.currentDate.add({years: date.duration.count});
                default:
                    throw exhaustive(date.duration);
            }
        }
        case "RelativeBeforeToday": {
            switch (date.duration.type) {
                case "Days":
                    return context.currentDate.subtract({days: date.duration.count});
                case "Weeks":
                    return context.currentDate.subtract({weeks: date.duration.count});
                case "Months":
                    return context.currentDate.subtract({months: date.duration.count});
                case "Years":
                    return context.currentDate.subtract({years: date.duration.count});
                default:
                    throw exhaustive(date.duration);
            }
        }
        default:
            throw exhaustive(date);
    }
}
