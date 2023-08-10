import {CalendarDate} from "@internationalized/date";
import {
    TaskQueryAccountNormalizedFilter,
    TaskQueryDateNormalizedFilter,
    TaskQueryNormalizedFilters,
} from "~/shared/tasks/task_query_normalized_filters.js";
import {LocalTask} from "~/client/tasks/demo_2/local_tasks_state.js";
import {assertEqualTypes} from "~/shared/helpers/control/assert_equal_types.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {iterableEvery} from "~/shared/helpers/iterable/iterable_every.js";
import {iterableSome} from "~/shared/helpers/iterable/iterable_some.js";
import {AccountId} from "~/shared/id/types/id_types.js";

// TypeScript errors here when new normalized filters are added. If you add a
// new normalized filter you should make sure to update
// `evaluateTaskQueryNormalizedFilters()`.
assertEqualTypes<
    keyof TaskQueryNormalizedFilters,
    | "statusFilter"
    | "collectionsFilter"
    | "priorityFilter"
    | "assigneeFilter"
    | "creatorFilter"
    | "assignerFilter"
    | "dueDateFilter"
    | "createdDateFilter"
    | "assignedDateFilter"
    | "closedDateFilter"
    | "activatedDateFilter"
>();

export function evaluateTaskQueryNormalizedFilters(
    filters: TaskQueryNormalizedFilters,
    task: LocalTask,
): boolean {
    {
        const status =
            task.status.type === "Open" && task.assignee?.status.type === "Active"
                ? "OpenActive"
                : task.status.type === "Open"
                ? "OpenInactive"
                : "Closed";

        const pass =
            (filters.displayStatusFilter.ifOpenInactive && status === "OpenInactive") ||
            (filters.displayStatusFilter.ifOpenActive && status === "OpenActive") ||
            (filters.displayStatusFilter.ifClosed && status === "Closed");

        if (!pass) return false;
    }

    if (filters.collectionsFilter !== undefined) {
        switch (filters.collectionsFilter.type) {
            case "IncludesOneOf": {
                if (
                    !iterableSome(filters.collectionsFilter.collectionIds, collectionId =>
                        task.collectionIds.has(collectionId),
                    )
                ) {
                    return false;
                }
                break;
            }
            case "IncludesAllOf": {
                if (
                    !iterableEvery(filters.collectionsFilter.collectionIds, collectionId =>
                        task.collectionIds.has(collectionId),
                    )
                ) {
                    return false;
                }
                break;
            }
            case "ExcludesAllOf": {
                if (
                    !iterableEvery(
                        filters.collectionsFilter.collectionIds,
                        collectionId => !task.collectionIds.has(collectionId),
                    )
                ) {
                    return false;
                }
                break;
            }
            case "IsEmpty": {
                if (task.collectionIds.size !== 0) return false;
                break;
            }
            default:
                throw exhaustive(filters.collectionsFilter);
        }
    }

    if (filters.priorityFilter !== undefined) {
        const pass =
            (filters.priorityFilter.ifNull && task.priority === null) ||
            (filters.priorityFilter.ifLow && task.priority === "Low") ||
            (filters.priorityFilter.ifMedium && task.priority === "Medium") ||
            (filters.priorityFilter.ifHigh && task.priority === "High") ||
            (filters.priorityFilter.ifUrgent && task.priority === "Urgent");

        if (!pass) return false;
    }

    if (
        filters.assigneeFilter !== undefined &&
        !evaluateTaskQueryAccountNormalizedFilter(
            filters.assigneeFilter,
            task.assignee?.account.id ?? "MissingAccount",
        )
    ) {
        return false;
    }

    if (
        filters.creatorFilter !== undefined &&
        !evaluateTaskQueryAccountNormalizedFilter(filters.creatorFilter, task.creatorId)
    ) {
        return false;
    }

    if (
        filters.assignerFilter !== undefined &&
        !evaluateTaskQueryAccountNormalizedFilter(
            filters.assignerFilter,
            task.assignee?.assignerId ?? "MissingAccount",
        )
    ) {
        return false;
    }

    if (
        filters.dueDateFilter !== undefined &&
        !evaluateTaskQueryDateNormalizedFilter(filters.dueDateFilter, task.dueDate)
    ) {
        return false;
    }

    if (
        filters.createdDateFilter !== undefined &&
        !evaluateTaskQueryDateNormalizedFilter(filters.createdDateFilter, task.createdDate)
    ) {
        return false;
    }

    if (
        filters.assignedDateFilter !== undefined &&
        !evaluateTaskQueryDateNormalizedFilter(
            filters.assignedDateFilter,
            task.assignee?.assignedDate ?? null,
        )
    ) {
        return false;
    }

    if (
        filters.closedDateFilter !== undefined &&
        !evaluateTaskQueryDateNormalizedFilter(
            filters.closedDateFilter,
            task.status.type === "Closed" ? task.status.closedDate : null,
        )
    ) {
        return false;
    }

    if (
        filters.activatedDateFilter !== undefined &&
        !evaluateTaskQueryDateNormalizedFilter(
            filters.activatedDateFilter,
            task.assignee?.status.type === "Active" ? task.assignee.status.activatedDate : null,
        )
    ) {
        return false;
    }

    return true;
}

function evaluateTaskQueryAccountNormalizedFilter(
    filter: TaskQueryAccountNormalizedFilter,
    accountId: AccountId | "MissingAccount",
): boolean {
    switch (filter.type) {
        case "OneOf":
            return filter.accountIds.has(accountId);
        case "NoneOf":
            return !filter.accountIds.has(accountId);
        default:
            throw exhaustive(filter);
    }
}

function evaluateTaskQueryDateNormalizedFilter(
    filter: TaskQueryDateNormalizedFilter | {type: "IsEmpty"},
    date: CalendarDate | null,
): boolean {
    switch (filter.type) {
        case "IsEmpty": {
            return date === null;
        }
        case "Range": {
            if (date === null) return false;

            return (
                (filter.exclusiveLowerBoundDate
                    ? filter.exclusiveLowerBoundDate.compare(date) < 0
                    : true) &&
                (filter.exclusiveUpperBoundDate
                    ? filter.exclusiveUpperBoundDate.compare(date) > 0
                    : true)
            );
        }
    }
}
