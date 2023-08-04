import {CalendarDate} from "@internationalized/date";
import {
    TaskIndexDoc,
    getTaskIndexDocAssigneeStatus,
    getTaskIndexDocDisplayStatus,
} from "~/server/tasks/index/task_index_doc.js";
import {assertEqualTypes} from "~/shared/helpers/control/assert_equal_types.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {iterableEvery} from "~/shared/helpers/iterable/iterable_every.js";
import {iterableSome} from "~/shared/helpers/iterable/iterable_some.js";
import {AccountId} from "~/shared/id/types/id_types.js";
import {
    TaskQueryAccountNormalizedFilter,
    TaskQueryDateNormalizedFilter,
    TaskQueryNormalizedFilters,
} from "~/shared/tasks/normalize_task_query_filters.js";

// TypeScript errors here when new normalized filters are added. If you add a
// new normalized filter you should make sure to update
// `evaluateTaskQueryNormalizedFiltersForTaskIndexDoc()`.
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

/**
 * Evaluates the provided task query filters against
 */
export function evaluateTaskQueryNormalizedFiltersForTaskIndexDoc(
    filters: TaskQueryNormalizedFilters,
    task: TaskIndexDoc,
): boolean {
    {
        const displayStatus = getTaskIndexDocDisplayStatus(task);

        const pass =
            (filters.statusFilter.ifOpenInactive && displayStatus === "OpenInactive") ||
            (filters.statusFilter.ifOpenActive && displayStatus === "OpenActive") ||
            (filters.statusFilter.ifClosed && displayStatus === "Closed");

        if (!pass) return false;
    }

    if (filters.collectionsFilter !== undefined) {
        switch (filters.collectionsFilter.type) {
            case "IncludesOneOf": {
                if (
                    !iterableSome(filters.collectionsFilter.collectionIds, collectionId =>
                        task.collections.raw.collections.has(collectionId),
                    )
                ) {
                    return false;
                }
                break;
            }
            case "IncludesAllOf": {
                if (
                    !iterableEvery(filters.collectionsFilter.collectionIds, collectionId =>
                        task.collections.raw.collections.has(collectionId),
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
                        collectionId => !task.collections.raw.collections.has(collectionId),
                    )
                ) {
                    return false;
                }
                break;
            }
            case "IsEmpty": {
                if (task.collections.raw.collections.getArray().length !== 0) return false;
                break;
            }
            default:
                throw exhaustive(filters.collectionsFilter);
        }
    }

    if (filters.priorityFilter !== undefined) {
        const pass =
            (filters.priorityFilter.ifNull && task.priority.value === null) ||
            (filters.priorityFilter.ifLow && task.priority.value === "Low") ||
            (filters.priorityFilter.ifMedium && task.priority.value === "Medium") ||
            (filters.priorityFilter.ifHigh && task.priority.value === "High") ||
            (filters.priorityFilter.ifUrgent && task.priority.value === "Urgent");

        if (!pass) return false;
    }

    if (
        filters.assigneeFilter !== undefined &&
        !evaluateTaskQueryAccountNormalizedFilter(
            filters.assigneeFilter,
            task.assignee.value?.assignee.accountId ?? "MissingAccount",
        )
    ) {
        return false;
    }

    if (
        filters.creatorFilter !== undefined &&
        !evaluateTaskQueryAccountNormalizedFilter(filters.creatorFilter, task.creator.accountId)
    ) {
        return false;
    }

    if (
        filters.assignerFilter !== undefined &&
        !evaluateTaskQueryAccountNormalizedFilter(
            filters.assignerFilter,
            task.assignee.value?.assigner.accountId ?? "MissingAccount",
        )
    ) {
        return false;
    }

    if (
        filters.dueDateFilter !== undefined &&
        !evaluateTaskQueryDateNormalizedFilter(filters.dueDateFilter, task.dueDate.value)
    ) {
        return false;
    }

    if (
        filters.createdDateFilter !== undefined &&
        !evaluateTaskQueryDateNormalizedFilter(
            filters.createdDateFilter,
            task.createdTime.setterDate,
        )
    ) {
        return false;
    }

    if (
        filters.assignedDateFilter !== undefined &&
        !evaluateTaskQueryDateNormalizedFilter(
            filters.assignedDateFilter,
            task.assignee.value?.assignedTime.setterDate ?? null,
        )
    ) {
        return false;
    }

    if (
        filters.closedDateFilter !== undefined &&
        !evaluateTaskQueryDateNormalizedFilter(
            filters.closedDateFilter,
            task.status.value.type === "Closed" ? task.status.value.closedTime.setterDate : null,
        )
    ) {
        return false;
    }

    if (filters.activatedDateFilter !== undefined) {
        const assigneeStatus = getTaskIndexDocAssigneeStatus(task);

        if (
            !evaluateTaskQueryDateNormalizedFilter(
                filters.activatedDateFilter,
                assigneeStatus.type === "Active" ? assigneeStatus.activatedTime.setterDate : null,
            )
        ) {
            return false;
        }
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
