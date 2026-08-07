import {CalendarDate} from "@internationalized/date";
import {filterMapArray} from "~/shared/helpers/array/filter_map_array.open_source.js";
import {assertEqualTypes} from "~/shared/helpers/control/assert_equal_types.open_source.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.open_source.js";
import {findMapIterable} from "~/shared/helpers/iterable/find_map_iterable.js";
import {AccountId, TaskCollectionId, TaskId} from "~/shared/id/types/id_types.open_source.js";
import {TaskLayout} from "~/shared/tasks/task_layout.js";
import {TaskPriority} from "~/shared/tasks/task_priority.js";
import {TaskQueryEvaluationContext} from "~/shared/tasks/task_query_evaluation_context.js";
import {TaskQueryNormalizedFilters} from "~/shared/tasks/task_query_normalized_filters.js";

// TypeScript errors here when new normalized filters are added. If you add a new
// normalized filter you should make sure to update
// `getTaskQueryNormalizedFiltersInitialFields()`.
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

export type TaskQueryNormalizedFiltersInitialFields = {
    readonly parentTaskId: TaskId | null;
    readonly status: "Open" | "Closed";
    readonly collectionIds: ReadonlySet<TaskCollectionId>;
    readonly priority: TaskPriority | null;
    readonly layout: TaskLayout | null;
    readonly title: string;
    readonly assigneeId: AccountId | null;
    readonly assigneeStatus: "Inactive" | "Active";
    readonly dueDate: CalendarDate | null;
};

/**
 * Get the initial fields for a task based on a task query's filters. This function
 * is best effort. We won't always be able to produce task fields that match the
 * filters. For example, if there's a created time filter, we can't control the
 * task creation time. When the choice for which value to pick is ambiguous then we
 * make a decision. For example, if a task can be medium or high priority then we
 * pick medium priority. It's unlikely that our decision will be correct so the
 * user will likely need to go and update any choice we make.
 */
export function getTaskQueryNormalizedFiltersInitialFields(
    filters: TaskQueryNormalizedFilters,
    evaluationContext: TaskQueryEvaluationContext,
): TaskQueryNormalizedFiltersInitialFields {
    let parentTaskId: TaskId | null = null;
    let status: "Open" | "Closed" = "Open";
    const collectionIds = new Set<TaskCollectionId>();
    let priority: TaskPriority | null = null;
    let layout: TaskLayout | null = null;
    let title: string = "";
    let assigneeId: AccountId | null = null;
    let assigneeStatus: "Inactive" | "Active" = "Inactive";
    let dueDate: CalendarDate | null = null;

    if (filters.parentFilter) {
        parentTaskId = filters.parentFilter.parentTaskId;
    }

    if (filters.displayStatusFilter.ifOpenInactive) {
        status = "Open";
        assigneeStatus = "Inactive";
    } else if (
        filters.displayStatusFilter.ifOpenActive &&
        evaluationContext.currentAccountId !== null
    ) {
        status = "Open";
        assigneeStatus = "Active";
        assigneeId = evaluationContext.currentAccountId;
    } else if (filters.displayStatusFilter.ifClosed) {
        status = "Closed";
        assigneeStatus = "Inactive";
    }

    if (filters.collectionsFilter) {
        for (const clause of filters.collectionsFilter) {
            for (const [term, not] of clause) {
                if (not) continue;
                if (term !== "IsEmpty") collectionIds.add(term);
                break;
            }
        }
    }

    if (filters.priorityFilter) {
        if (filters.priorityFilter.ifNull) {
            priority = null;
        } else if (filters.priorityFilter.ifLow) {
            priority = "Low";
        } else if (filters.priorityFilter.ifMedium) {
            priority = "Medium";
        } else if (filters.priorityFilter.ifHigh) {
            priority = "High";
        } else if (filters.priorityFilter.ifUrgent) {
            priority = "Urgent";
        } else {
            throw exhaustive(filters.priorityFilter);
        }
    }

    if (filters.layoutFilter) {
        if (filters.layoutFilter.ifNull) {
            layout = null;
        } else if (filters.layoutFilter.ifProject) {
            layout = "Project";
        } else {
            throw exhaustive(filters.layoutFilter);
        }
    }

    if (filters.titleFilter) {
        title = filterMapArray(filters.titleFilter, ({operationType, titleQuery}) =>
            operationType === "Includes" ? titleQuery : undefined,
        ).join(" ");
    }

    if (filters.assigneeFilter) {
        switch (filters.assigneeFilter.type) {
            case "OneOf": {
                if (filters.assigneeFilter.accountIds.has(assigneeId ?? "MissingAccount")) {
                    // `assigneeId` already matches the filter!
                    break;
                }

                const firstAccountId = findMapIterable(
                    filters.assigneeFilter.accountIds,
                    accountId => (accountId !== "MissingAccount" ? accountId : undefined),
                );

                if (firstAccountId !== undefined) {
                    assigneeId = firstAccountId;
                } else {
                    // If we didn't find an `accountId` then the only member of the set must be
                    // `MissingAccount`.
                    assigneeId = null;

                    // Can't have an active assignee status (which we set earlier) if there's no
                    // assignee.
                    if (assigneeStatus === "Active") assigneeStatus = "Inactive";
                }
                break;
            }
            case "NoneOf": {
                if (!filters.assigneeFilter.accountIds.has(assigneeId ?? "MissingAccount")) {
                    // `assigneeId` already matches the filter!
                    break;
                }

                if (
                    evaluationContext.currentAccountId !== null &&
                    !filters.assigneeFilter.accountIds.has(evaluationContext.currentAccountId)
                ) {
                    assigneeId = evaluationContext.currentAccountId;
                    break;
                }

                if (!filters.assigneeFilter.accountIds.has("MissingAccount")) {
                    assigneeId = null;

                    // Can't have an active assignee status (which we set earlier) if there's no
                    // assignee.
                    if (assigneeStatus === "Active") assigneeStatus = "Inactive";
                    break;
                }
                break;
            }
            default:
                throw exhaustive(filters.assigneeFilter);
        }
    }

    if (filters.dueDateFilter) {
        switch (filters.dueDateFilter.type) {
            case "IsEmpty":
            case "RangeOrIsEmpty":
                break;
            case "Range": {
                const filter = filters.dueDateFilter;

                // We look for the closest date in our range filter to a week from today and set
                // that as the due date. Setting the due date to a week from today feels better
                // than setting it to today. Since generally due dates are set in the future.
                const date = evaluationContext.currentDate.add({days: 7});

                // If the current date is within the range then let's use the current date!
                if (
                    (filter.exclusiveLowerBoundDate
                        ? filter.exclusiveLowerBoundDate.compare(date) < 0
                        : true) &&
                    (filter.exclusiveUpperBoundDate
                        ? filter.exclusiveUpperBoundDate.compare(date) > 0
                        : true)
                ) {
                    dueDate = date;
                }
                // If the current date is not within the range then let's use the closest day to
                // the current date in the range.
                else {
                    if (
                        filter.exclusiveLowerBoundDate !== null &&
                        filter.exclusiveLowerBoundDate.compare(date) > 0
                    ) {
                        dueDate = filter.exclusiveLowerBoundDate.add({days: 1});
                    } else if (
                        filter.exclusiveUpperBoundDate !== null &&
                        filter.exclusiveUpperBoundDate.compare(date) < 0
                    ) {
                        dueDate = filter.exclusiveUpperBoundDate.subtract({days: 1});
                    }
                }
                break;
            }
            default:
                throw exhaustive(filters.dueDateFilter);
        }
    }

    return {
        parentTaskId,
        status,
        collectionIds,
        priority,
        layout,
        title,
        assigneeId,
        assigneeStatus,
        dueDate,
    };
}
