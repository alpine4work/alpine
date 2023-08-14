import {createEmptyTaskIndexDoc} from "~/server/tasks/index/create_empty_task_index_doc.js";
import {
    evaluateTaskQueryAccountNormalizedFilter,
    evaluateTaskQueryDateNormalizedFilter,
    evaluateTaskQueryNormalizedFiltersForIndexDoc,
} from "~/server/tasks/index/evaluate_task_query_normalized_filters_for_index_doc.js";
import {HybridLogicalTime} from "~/shared/helpers/clock/hybrid_logical_clock.js";
import {assertEqualTypes} from "~/shared/helpers/control/assert_equal_types.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {iterableSome} from "~/shared/helpers/iterable/iterable_some.js";
import {TaskTaskAction} from "~/shared/tasks/actions/task_task_action.js";
import {TaskQueryNormalizedFilters} from "~/shared/tasks/task_query_normalized_filters.js";

// TypeScript errors here when new normalized filters are added. If you add a
// new normalized filter you should make sure to update
// `mightTaskActionAddVisibleTaskInQueryNormalizedFilters()`.
assertEqualTypes<
    keyof TaskQueryNormalizedFilters,
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
    | "notepadPageFilter"
>();

/**
 * Returns false if when this action is applied to a task that does not pass
 * the provided filters the task will still not pass the provided filters.
 * Returns true if applying the action might make the task pass the provided
 * filters.
 *
 * This function does not know what the state of the task is so must err on the
 * side of caution. If there's any case where the underlying task may pass the
 * filters you must return true.
 *
 * This function is used as an optimization to prevent some unnecessary
 * computation. If this function always returns true it shouldn't affect the
 * behavior of the system, only its efficiency.
 *
 * Again: Returning false means we definitively know a task will not be made
 * visible as a result of this action. Returning true means it might but we
 * don't know for sure. You'd need to load the task to find out.
 */
// TODO(calebmer): This could really use some tests. Maybe an assertion in
// development mode that `false` is truly `false`. The return value of this
// function is critical.
export function mightTaskActionAddVisibleTaskInQueryNormalizedFilters(
    actionTime: HybridLogicalTime,
    action: TaskTaskAction,
    filters: TaskQueryNormalizedFilters,
): boolean {
    switch (action.type) {
        case "Create": {
            // We know what the task document looks like when it's created so evaluate it
            // against our filters.
            return evaluateTaskQueryNormalizedFiltersForIndexDoc(
                filters,
                createEmptyTaskIndexDoc(actionTime, action),
            );
        }
        case "Delete": {
            return false;
        }
        case "Undelete": {
            // We have no idea what was in the deleted task. Any undelete may expose
            // the task.
            return true;
        }
        case "UpdateParentTaskId":
        case "UpdateChildrenCounts":
        case "UpdateParentPosition": {
            // We don't currently have filters for parent/child tasks.
            return false;
        }
        case "AddCollection": {
            if (!filters.collectionsFilter) return false;

            // If any term, whether it is "AND"ed or "OR"ed, would match a task with the
            // added collection then the overall filter expression might go from false to
            // true.
            return filters.collectionsFilter.some(clause =>
                iterableSome(
                    clause,
                    ([term, not]) =>
                        (term === "IsEmpty" && not === true) ||
                        (term === action.collectionId && not === false),
                ),
            );
        }
        case "RemoveCollection": {
            if (!filters.collectionsFilter) return false;

            // If any term, whether it is "AND"ed or "OR"ed, would match a task with the
            // removed collection then the overall filter expression might go from false to
            // true.
            return filters.collectionsFilter.some(clause =>
                iterableSome(
                    clause,
                    ([term, not]) =>
                        (term === "IsEmpty" && not === false) ||
                        (term === action.collectionId && not === true),
                ),
            );
        }
        case "UpdateCollectionPosition": {
            // No filters match collection position.
            return false;
        }
        case "UpdateNotepadPagePosition": {
            if (!filters.notepadPageFilter) return false;

            return (
                action.position !== null &&
                action.accountId === filters.notepadPageFilter.accountId &&
                action.notepadPageId === filters.notepadPageFilter.notepadPageId
            );
        }
        case "UpdateStatus": {
            // If all statuses are allowed then changing the status will not change the
            // visibility state.
            if (
                filters.displayStatusFilter.ifOpenInactive &&
                filters.displayStatusFilter.ifOpenActive &&
                filters.displayStatusFilter.ifClosed &&
                // A closed date filter will filter out open tasks.
                !filters.closedDateFilter
            ) {
                return false;
            }

            switch (action.status.type) {
                case "Open": {
                    return (
                        (filters.displayStatusFilter.ifOpenInactive ||
                            filters.displayStatusFilter.ifOpenActive) &&
                        !filters.closedDateFilter
                    );
                }
                case "Closed": {
                    return (
                        filters.displayStatusFilter.ifClosed &&
                        (!filters.closedDateFilter ||
                            evaluateTaskQueryDateNormalizedFilter(
                                filters.closedDateFilter,
                                action.status.closedTime.setterDate,
                            ))
                    );
                }
                default:
                    throw exhaustive(action.status);
            }
        }
        case "UpdateAssignee": {
            // When we change a task's assignee, it also resets our assignee status from
            // active to inactive. If we are filtering for inactive tasks and not active
            // tasks then this change might expose the task.
            if (
                filters.displayStatusFilter.ifOpenInactive &&
                !filters.displayStatusFilter.ifOpenActive
            ) {
                return true;
            }

            const pass1 = filters.assigneeFilter
                ? evaluateTaskQueryAccountNormalizedFilter(
                      filters.assigneeFilter,
                      action.assignee?.assignee.accountId ?? "MissingAccount",
                  )
                : true;

            const pass2 = filters.assignerFilter
                ? evaluateTaskQueryAccountNormalizedFilter(
                      filters.assignerFilter,
                      action.assignee?.assigner.accountId ?? "MissingAccount",
                  )
                : true;

            const pass3 = filters.assignedDateFilter
                ? evaluateTaskQueryDateNormalizedFilter(
                      filters.assignedDateFilter,
                      action.assignee?.assignedTime.setterDate ?? null,
                  )
                : true;

            // Must pass all the assignee filters to be visible.
            return pass1 && pass2 && pass3;
        }
        case "UpdateAssigneeStatus": {
            // If all open statuses are allowed then changing the status will not change
            // the visibility state.
            if (
                filters.displayStatusFilter.ifOpenInactive &&
                filters.displayStatusFilter.ifOpenActive &&
                // An activated date filter will filter out inactive tasks.
                !filters.activatedDateFilter
            ) {
                return false;
            }

            switch (action.assigneeStatus.type) {
                case "Inactive": {
                    return (
                        filters.displayStatusFilter.ifOpenInactive && !filters.activatedDateFilter
                    );
                }
                case "Active": {
                    return (
                        filters.displayStatusFilter.ifOpenActive &&
                        (!filters.activatedDateFilter ||
                            evaluateTaskQueryDateNormalizedFilter(
                                filters.activatedDateFilter,
                                action.assigneeStatus.activatedTime.setterDate,
                            ))
                    );
                }
                default:
                    throw exhaustive(action.assigneeStatus);
            }
        }
        case "UpdateTitle": {
            // We don't know what the title will be when this action is applied so return
            // true for any title filter.
            return !!filters.titleFilter;
        }
        case "UpdateDueDate": {
            if (!filters.dueDateFilter) return false;
            return evaluateTaskQueryDateNormalizedFilter(filters.dueDateFilter, action.dueDate);
        }
        case "UpdatePriority": {
            if (!filters.priorityFilter) return false;

            switch (action.priority) {
                case null:
                    return filters.priorityFilter.ifNull;
                case "Low":
                    return filters.priorityFilter.ifLow;
                case "Medium":
                    return filters.priorityFilter.ifMedium;
                case "High":
                    return filters.priorityFilter.ifHigh;
                case "Urgent":
                    return filters.priorityFilter.ifUrgent;
                default:
                    throw exhaustive(action.priority);
            }
        }
        default:
            throw exhaustive(action);
    }
}
