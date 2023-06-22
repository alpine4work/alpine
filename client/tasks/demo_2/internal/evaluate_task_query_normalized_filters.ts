import {CalendarDate} from "@internationalized/date";
import {
    TaskQueryAccountNormalizedFilter,
    TaskQueryDateNormalizedFilter,
    TaskQueryNormalizedFilters,
} from "~/client/tasks/demo_2/internal/normalize_task_query_filters";
import {LocalTask} from "~/client/tasks/demo_2/local_tasks_state";
import {assertEqualTypes} from "~/shared/helpers/control/assert_equal_types";
import {exhaustive} from "~/shared/helpers/control/exhaustive";
import {iterableEvery} from "~/shared/helpers/iterable/iterable_every";
import {iterableSome} from "~/shared/helpers/iterable/iterable_some";
import {AccountId} from "~/shared/id/types/id_types";

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
                ? "Active"
                : task.status.type;

        const pass =
            (filters.statusFilter.ifOpen && status === "Open") ||
            (filters.statusFilter.ifActive && status === "Active") ||
            (filters.statusFilter.ifClosed && status === "Closed");

        if (!pass) return false;
    }

    if (filters.collectionsFilter !== undefined) {
        switch (filters.collectionsFilter.type) {
            case "IncludesOneOf": {
                return iterableSome(filters.collectionsFilter.collectionIds, collectionId =>
                    task.collectionIds.has(collectionId),
                );
            }
            case "IncludesAllOf": {
                return iterableEvery(filters.collectionsFilter.collectionIds, collectionId =>
                    task.collectionIds.has(collectionId),
                );
            }
            case "ExcludesAllOf": {
                return iterableEvery(
                    filters.collectionsFilter.collectionIds,
                    collectionId => !task.collectionIds.has(collectionId),
                );
            }
            case "IsEmpty": {
                return task.collectionIds.size === 0;
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
            task.assignee?.account.id ?? "NoAccount",
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
            task.assignee?.assignerId ?? "NoAccount",
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
    accountId: AccountId | "NoAccount",
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
