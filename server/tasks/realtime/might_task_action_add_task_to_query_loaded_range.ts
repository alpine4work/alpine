import {createEmptyTaskIndexDoc} from "~/server/tasks/data/create_empty_task_index_doc.js";
import {
    evaluateTaskQueryAccountNormalizedFilter,
    evaluateTaskQueryDateNormalizedFilter,
    evaluateTaskQueryNormalizedFiltersForIndexDoc,
} from "~/server/tasks/data/evaluate_task_query_normalized_filters_for_index_doc.js";
import {HybridLogicalTime} from "~/shared/helpers/clock/hybrid_logical_clock.js";
import {assertEqualTypes} from "~/shared/helpers/control/assert_equal_types.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {iterableSome} from "~/shared/helpers/iterable/iterable_some.js";
import {TaskTaskAction} from "~/shared/tasks/actions/task_task_action.js";
import {TaskQueryNormalizedFilters} from "~/shared/tasks/task_query_normalized_filters.js";
import {TaskQueryNormalizedSort} from "~/shared/tasks/task_query_normalized_sort.js";

// TypeScript errors here when new normalized filters are added. If you add a
// new normalized filter you should make sure to update
// `mightTaskActionAddVisibleTaskInQueryNormalizedFilters()`.
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

// TypeScript errors here when new normalized sorts are added. If you add a
// new normalized filter you should make sure to update
// `mightTaskActionMoveVisibleTaskForQueryNormalizedSorts()`.
assertEqualTypes<
    TaskQueryNormalizedSort["type"],
    | "DisplayStatus"
    | "Priority"
    | "Layout"
    | "Assignee"
    | "Creator"
    | "Assigner"
    | "DueDate"
    | "CreatedTime"
    | "AssignedTime"
    | "ClosedTime"
    | "ActivatedTime"
    | "ParentPosition"
    | "CollectionPosition"
    | "AssigneePosition"
>();

/**
 * For a query with the provided filters/sorts.
 *
 * Let there be a task outside of the query's loaded range.
 *
 * This function returns false if that task definitely won't be added to the
 * query's loaded range after the provided action. This function returns true
 * if the task MAY be added to the query's loaded range after the provided
 * action.
 *
 * Returning false is definite. Returning true means the caller needs to load
 * the underlying task and test it against the query's filters/sorts to see if
 * the task needs to be added.
 *
 * This function does not know what the state of the task is so must err on the
 * side of caution. If there's any case where the underlying task may pass the
 * filters you must return true. It's critical that this function returns false
 * only if it absolutely knows for sure an action outside the query's loaded
 * range will not be added to the query's loaded range.
 *
 * This function is used as an optimization to prevent some unnecessary
 * computation. If this function always returns true it shouldn't affect the
 * behavior of the system, only its efficiency.
 *
 * - For filters: We check if a hidden task may be made visible with the
 *   provided action.
 *
 * - For sorts: We check if a task near the bottom of the query (outside the
 *   loaded range) may be moved to the top (inside the loaded range) with the
 *   provided action.
 *
 * Sometimes we use a combination of both filters and sorts. For example if
 * you're sorting on `ParentPosition` then task updating its `parentTaskId`
 * will change the parent position possibly moving the task into the query's
 * loaded range. However, if you're sorting on `ParentPosition` and filtering
 * with `parentFilter` then we only need to care about `parentTaskId` updates
 * that match the filter.
 */
// TODO(calebmer): This could really use some tests. Maybe an assertion in
// development mode that `false` is truly `false`. The return value of this
// function is critical.
export function mightTaskActionAddTaskToQueryLoadedRange(
    actionTime: HybridLogicalTime,
    action: TaskTaskAction,
    filters: TaskQueryNormalizedFilters,
    sorts: ReadonlyArray<TaskQueryNormalizedSort>,
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
        case "UpdateParentTaskId": {
            // This action updates the task's parent position. If you are sorting by parent
            // position with no parent filter then every parent task update may move a task
            // into the loaded range.
            //
            // However, this is inefficient in the common case where you are filtering for
            // a specific parent task and sorting its children. We don't want this function
            // to return true for every parent task update. In that case, if another task's
            // parent changes but its outside the filter it doesn't matter that it's parent
            // position changed, it can never appear in our query.
            if (
                sorts.some(sort => sort.type === "ParentPosition") &&
                (!filters.parentFilter || filters.parentFilter.parentTaskId === action.parentTaskId)
            ) {
                return true;
            }

            if (!filters.parentFilter) return false;

            return filters.parentFilter.parentTaskId === action.parentTaskId;
        }
        case "UpdateChildrenCounts":
        case "UpdateParentPosition": {
            // We don't currently have filters for parent/child tasks.
            return false;
        }
        case "AddCollection": {
            // Sorting by collection position may move a task into the loaded range when
            // the collection is added.
            if (
                sorts.some(sort => sort.type === "CollectionPosition") &&
                sorts.every(
                    sort =>
                        sort.type !== "CollectionPosition" ||
                        sort.collectionId === action.collectionId,
                )
            ) {
                return true;
            }

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
            // Sorting by collection position may move a task into the loaded range when
            // the collection is removed.
            if (
                sorts.some(sort => sort.type === "CollectionPosition") &&
                sorts.every(
                    sort =>
                        sort.type !== "CollectionPosition" ||
                        sort.collectionId === action.collectionId,
                )
            ) {
                return true;
            }

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
            // Sorting by collection position may move a task into the loaded range when the
            // collection position changes.
            if (
                sorts.some(sort => sort.type === "CollectionPosition") &&
                sorts.every(
                    sort =>
                        sort.type !== "CollectionPosition" ||
                        sort.collectionId === action.collectionId,
                )
            ) {
                return true;
            }

            // No filters match collection position.
            return false;
        }
        case "UpdateStatus": {
            // If we are setting `assigneeStatus` as well then run our logic for an
            // `UpdateAssigneeStatus` action.
            if (
                action.assigneeStatus &&
                mightTaskActionAddTaskToQueryLoadedRange(
                    actionTime,
                    {type: "UpdateAssigneeStatus", assigneeStatus: action.assigneeStatus},
                    filters,
                    sorts,
                )
            ) {
                return true;
            }

            if (
                sorts.some(
                    sort =>
                        sort.type === "DisplayStatus" ||
                        sort.type === "ClosedTime" ||
                        // Updating status may reset assignee status so may change sorting related to
                        // assignee status...
                        sort.type === "ActivatedTime",
                )
            ) {
                return true;
            }

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
                                action.status.closedTime.getSetterDate(),
                            ))
                    );
                }
                default:
                    throw exhaustive(action.status);
            }
        }
        case "UpdateAssignee": {
            // If we are setting `assigneeStatus` as well then run our logic for an
            // `UpdateAssigneeStatus` action.
            if (
                action.assigneeStatus &&
                mightTaskActionAddTaskToQueryLoadedRange(
                    actionTime,
                    {type: "UpdateAssigneeStatus", assigneeStatus: action.assigneeStatus},
                    filters,
                    sorts,
                )
            ) {
                return true;
            }

            if (
                sorts.some(
                    sort =>
                        sort.type === "Assignee" ||
                        sort.type === "Assigner" ||
                        sort.type === "AssignedTime" ||
                        // Updating assignee may reset assignee status so may change sorting related to
                        // assignee status...
                        sort.type === "DisplayStatus" ||
                        sort.type === "ActivatedTime" ||
                        sort.type === "AssigneePosition",
                )
            ) {
                return true;
            }

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
                      action.assignee?.assigneeId ?? "MissingAccount",
                  )
                : true;

            const pass2 = filters.assignerFilter
                ? evaluateTaskQueryAccountNormalizedFilter(
                      filters.assignerFilter,
                      action.assignee?.assignerId ?? "MissingAccount",
                  )
                : true;

            const pass3 = filters.assignedDateFilter
                ? evaluateTaskQueryDateNormalizedFilter(
                      filters.assignedDateFilter,
                      action.assignee?.assignedTime.getSetterDate() ?? null,
                  )
                : true;

            // Must pass all the assignee filters to be visible.
            return pass1 && pass2 && pass3;
        }
        case "UpdateAssigneeStatus": {
            if (
                sorts.some(sort => sort.type === "DisplayStatus" || sort.type === "ActivatedTime")
            ) {
                return true;
            }

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
                                action.assigneeStatus.activatedTime.getSetterDate(),
                            ))
                    );
                }
                default:
                    throw exhaustive(action.assigneeStatus);
            }
        }
        case "UpdateAssigneePosition": {
            return sorts.some(sort => sort.type === "AssigneePosition");
        }
        case "UpdateTitle": {
            // We don't know what the title will be when this action is applied so return
            // true for any title filter.
            return !!filters.titleFilter;
        }
        case "UpdateDueDate": {
            if (sorts.some(sort => sort.type === "DueDate")) return true;

            if (!filters.dueDateFilter) return false;
            return evaluateTaskQueryDateNormalizedFilter(filters.dueDateFilter, action.dueDate);
        }
        case "UpdatePriority": {
            if (sorts.some(sort => sort.type === "Priority")) return true;

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
        case "UpdateLayout": {
            if (sorts.some(sort => sort.type === "Layout")) return true;

            if (!filters.layoutFilter) return false;

            switch (action.layout) {
                case null:
                    return filters.layoutFilter.ifNull;
                case "Project":
                    return filters.layoutFilter.ifProject;
                default:
                    throw exhaustive(action.layout);
            }
        }
        case "UpdateAccessPolicy":
        case "UpdateNotepadPagePosition":
        case "UpdateAssigneeActivePosition": {
            return false;
        }
        default:
            throw exhaustive(action);
    }
}
