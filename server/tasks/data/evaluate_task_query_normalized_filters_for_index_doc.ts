import {CalendarDate} from "@internationalized/date";
import {
    TaskIndexDoc,
    getTaskIndexDocAssigneeStatus,
    getTaskIndexDocDisplayStatus,
    isTaskIndexDocDeleted,
} from "~/server/tasks/data/task_index_doc.js";
import {assertEqualTypes} from "~/shared/helpers/control/assert_equal_types.open_source.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.open_source.js";
import {iterableEvery} from "~/shared/helpers/iterable/iterable_every.js";
import {iterableSome} from "~/shared/helpers/iterable/iterable_some.open_source.js";
import {Replace} from "~/shared/helpers/types/replace.open_source.js";
import {AccountId} from "~/shared/id/types/id_types.open_source.js";
import {analyzeTaskTitleText} from "~/shared/tasks/analyze_task_title_text.js";
import {
    TaskQueryAccountNormalizedFilter,
    TaskQueryDateNormalizedFilter,
    TaskQueryNormalizedFilters,
} from "~/shared/tasks/task_query_normalized_filters.js";
import {getTaskTitleText} from "~/shared/tasks/title/task_title.js";

// TypeScript errors here when new normalized filters are added. If you add a new
// normalized filter you should make sure to update
// `evaluateTaskQueryNormalizedFiltersForIndexDoc()`.
assertEqualTypes<
    keyof TaskQueryNormalizedFilters,
    | "displayStatusFilter"
    | "collectionsFilter"
    | "priorityFilter"
    | "layoutFilter"
    | "titleFilter"
    | "assigneeFilter"
    | "creatorFilter"
    | "assignerFilter"
    | "dueDateFilter"
    | "createdDateFilter"
    | "assignedDateFilter"
    | "closedDateFilter"
    | "activatedDateFilter"
    | "parentFilter"
>();

/**
 * Evaluates the provided task query filters against
 */
export function evaluateTaskQueryNormalizedFiltersForIndexDoc(
    filters: TaskQueryNormalizedFilters,
    task: Omit<TaskIndexDoc, "id" | "spaceId" | "creator" | "lastIndexSearchEntityJob"> & {
        creator: {accountId: AccountId};
    },
): boolean {
    // Deleted tasks should always be filtered out.
    if (isTaskIndexDocDeleted(task)) return false;

    {
        const displayStatus = getTaskIndexDocDisplayStatus(task);

        const pass =
            (filters.displayStatusFilter.ifOpenInactive && displayStatus === "OpenInactive") ||
            (filters.displayStatusFilter.ifOpenActive && displayStatus === "OpenActive") ||
            (filters.displayStatusFilter.ifClosed && displayStatus === "Closed");

        if (!pass) return false;
    }

    if (filters.collectionsFilter !== undefined) {
        const pass = iterableEvery(filters.collectionsFilter, clause =>
            iterableSome(clause, ([term, not]) => {
                const pass =
                    term === "IsEmpty"
                        ? task.collections.raw.collections.getArray().length === 0
                        : task.collections.raw.collections.has(term);

                return not ? !pass : pass;
            }),
        );

        if (!pass) return false;
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

    if (filters.layoutFilter !== undefined) {
        const layout = task.layout?.value ?? null;

        const pass =
            (filters.layoutFilter.ifNull && layout === null) ||
            (filters.layoutFilter.ifProject && layout === "Project");

        if (!pass) return false;
    }

    if (filters.titleFilter !== undefined) {
        // NOTE(calebmer): If we could get access to computed properties here we wouldn't
        // need to call `getTaskTitleText()` again because we could used the stored title
        // text. That's a minor performance optimization.
        const titleText = getTaskTitleText(task.title.raw);
        const titleWords = analyzeTaskTitleText(titleText);

        for (const filter of filters.titleFilter) {
            switch (filter.operationType) {
                case "Includes": {
                    if (!containsArray(titleWords, filter.titleQueryWords)) return false;
                    break;
                }
                case "Excludes": {
                    if (containsArray(titleWords, filter.titleQueryWords)) return false;
                    break;
                }
                default:
                    throw exhaustive(filter.operationType);
            }
        }
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
            task.createdTime.getSetterDate(),
        )
    ) {
        return false;
    }

    if (
        filters.assignedDateFilter !== undefined &&
        !evaluateTaskQueryDateNormalizedFilter(
            filters.assignedDateFilter,
            task.assignee.value?.assignedTime.getSetterDate() ?? null,
        )
    ) {
        return false;
    }

    if (
        filters.closedDateFilter !== undefined &&
        !evaluateTaskQueryDateNormalizedFilter(
            filters.closedDateFilter,
            task.status.value.type === "Closed"
                ? task.status.value.closedTime.getSetterDate()
                : null,
        )
    ) {
        return false;
    }

    if (filters.activatedDateFilter !== undefined) {
        const assigneeStatus = getTaskIndexDocAssigneeStatus(task);

        if (
            !evaluateTaskQueryDateNormalizedFilter(
                filters.activatedDateFilter,
                assigneeStatus.type === "Active"
                    ? assigneeStatus.activatedTime.getSetterDate()
                    : null,
            )
        ) {
            return false;
        }
    }

    if (
        filters.parentFilter !== undefined &&
        filters.parentFilter.parentTaskId !== task.parent.taskId.value
    ) {
        return false;
    }

    return true;
}

export function evaluateTaskQueryAccountNormalizedFilter(
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

export function evaluateTaskQueryDateNormalizedFilter(
    filter:
        | TaskQueryDateNormalizedFilter
        | {readonly type: "IsEmpty"}
        | Replace<TaskQueryDateNormalizedFilter, {readonly type: "RangeOrIsEmpty"}>,
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
        case "RangeOrIsEmpty": {
            if (date === null) return true;

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

function containsArray<T>(array1: ReadonlyArray<T>, array2: ReadonlyArray<T>): boolean {
    if (array2.length === 0) return true;

    for (let i = 0; i < array1.length; i++) {
        if (array1[i]! !== array2[0]) continue;

        let hasArray = true;
        for (let j = 1; j < array2.length; j++) {
            if (array1[i + j]! !== array2[j]!) {
                hasArray = false;
                break;
            }
        }

        if (hasArray) return true;
    }

    return false;
}
