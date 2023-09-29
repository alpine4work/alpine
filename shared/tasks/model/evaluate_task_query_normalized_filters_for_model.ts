import {CalendarDate} from "@internationalized/date";
import {assertEqualTypes} from "~/shared/helpers/control/assert_equal_types.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {iterableEvery} from "~/shared/helpers/iterable/iterable_every.js";
import {iterableSome} from "~/shared/helpers/iterable/iterable_some.js";
import {AccountId} from "~/shared/id/types/id_types.js";
import {analyzeTaskTitleText} from "~/shared/tasks/analyze_task_title_text.js";
import {TaskModel} from "~/shared/tasks/model/task_model.js";
import {
    TaskQueryAccountNormalizedFilter,
    TaskQueryDateNormalizedFilter,
    TaskQueryNormalizedFilters,
} from "~/shared/tasks/task_query_normalized_filters.js";

// TypeScript errors here when new normalized filters are added. If you add a
// new normalized filter you should make sure to update
// `evaluateTaskQueryNormalizedFiltersForIndexDoc()`.
assertEqualTypes<
    keyof TaskQueryNormalizedFilters,
    | "deletedFilter"
    | "displayStatusFilter"
    | "collectionsFilter"
    | "priorityFilter"
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
    | "notepadPageFilter"
>();

/**
 * Evaluates the provided task query filters against
 */
export function evaluateTaskQueryNormalizedFiltersForModel(
    filters: TaskQueryNormalizedFilters,
    task: TaskModel,
): boolean {
    if (!filters.deletedFilter.isDeleted && task.isDeleted()) return false;
    if (filters.deletedFilter.isDeleted && !task.isDeleted()) return false;

    {
        const displayStatus = task.getDisplayStatus();

        const pass =
            (filters.displayStatusFilter.ifOpenInactive && displayStatus === "OpenInactive") ||
            (filters.displayStatusFilter.ifOpenActive && displayStatus === "OpenActive") ||
            (filters.displayStatusFilter.ifClosed && displayStatus === "Closed");

        if (!pass) return false;
    }

    if (filters.collectionsFilter !== undefined) {
        const collections = task.getCollections();

        const pass = iterableEvery(filters.collectionsFilter, clause =>
            iterableSome(clause, ([term, not]) => {
                const pass =
                    term === "IsEmpty"
                        ? collections.getArray().length === 0
                        : collections.has(term);

                return not ? !pass : pass;
            }),
        );

        if (!pass) return false;
    }

    if (filters.priorityFilter !== undefined) {
        const priority = task.getPriority();

        const pass =
            (filters.priorityFilter.ifNull && priority === null) ||
            (filters.priorityFilter.ifLow && priority === "Low") ||
            (filters.priorityFilter.ifMedium && priority === "Medium") ||
            (filters.priorityFilter.ifHigh && priority === "High") ||
            (filters.priorityFilter.ifUrgent && priority === "Urgent");

        if (!pass) return false;
    }

    if (filters.titleFilter !== undefined) {
        const titleText = task.getTitle().getText();
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
            task.getAssignee()?.assignee.accountId ?? "MissingAccount",
        )
    ) {
        return false;
    }

    if (
        filters.creatorFilter !== undefined &&
        !evaluateTaskQueryAccountNormalizedFilter(
            filters.creatorFilter,
            task.getCreator().accountId,
        )
    ) {
        return false;
    }

    if (
        filters.assignerFilter !== undefined &&
        !evaluateTaskQueryAccountNormalizedFilter(
            filters.assignerFilter,
            task.getAssignee()?.assigner.accountId ?? "MissingAccount",
        )
    ) {
        return false;
    }

    if (
        filters.dueDateFilter !== undefined &&
        !evaluateTaskQueryDateNormalizedFilter(filters.dueDateFilter, task.getDueDate())
    ) {
        return false;
    }

    if (
        filters.createdDateFilter !== undefined &&
        !evaluateTaskQueryDateNormalizedFilter(
            filters.createdDateFilter,
            task.getCreatedTime().setterDate,
        )
    ) {
        return false;
    }

    if (
        filters.assignedDateFilter !== undefined &&
        !evaluateTaskQueryDateNormalizedFilter(
            filters.assignedDateFilter,
            task.getAssignee()?.assignedTime.setterDate ?? null,
        )
    ) {
        return false;
    }

    if (filters.closedDateFilter !== undefined) {
        const status = task.getStatus();

        if (
            !evaluateTaskQueryDateNormalizedFilter(
                filters.closedDateFilter,
                status.type === "Closed" ? status.closedTime.setterDate : null,
            )
        ) {
            return false;
        }
    }

    if (filters.activatedDateFilter !== undefined) {
        const assigneeStatus = task.getAssigneeStatus();

        if (
            !evaluateTaskQueryDateNormalizedFilter(
                filters.activatedDateFilter,
                assigneeStatus.type === "Active" ? assigneeStatus.activatedTime.setterDate : null,
            )
        ) {
            return false;
        }
    }

    if (
        filters.parentFilter !== undefined &&
        filters.parentFilter.parentTaskId !== task.getParent()?.taskId
    ) {
        return false;
    }

    if (
        filters.notepadPageFilter !== undefined &&
        (task.getCreator().accountId !== filters.notepadPageFilter.accountId ||
            !task.rawData.positionByAccountIdAndNotepadPageId.has(
                `${filters.notepadPageFilter.accountId}-${filters.notepadPageFilter.notepadPageId}`,
            ))
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
