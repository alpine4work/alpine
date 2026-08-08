import {TaskGridViewVirtualizedListState} from "~/client/web/tasks/internal/task_grid_view_virtualized_list_state.js";
import {TaskId} from "~/shared/id/types/id_types.open_source.js";
import {getTaskQueryNormalizedSortCursorForModel} from "~/shared/tasks/model/get_task_query_normalized_sort_cursor_for_model.js";
import {getTaskQuerySortCursorTaskId} from "~/shared/tasks/task_query_sort_cursor.js";

/**
 * Procedure to help us find the index of a task in a grid view based on the grid
 * view's state so we can scroll to it.
 *
 * We're looking for the provided `TaskId` in the grid view's state. A `TaskId` may
 * appear multiple times in a grid view. We will return the first index the task
 * appears (if it appears at all) unless `scopeRootTaskId` is provided. In that
 * case if we find the `TaskId` as a child of `scopeRootTaskId` then we'll return
 * that index, ignoring the others.
 *
 * You need to provide `iterateRootExpandedTaskIds()` from
 * `useTaskGridViewExpansionState()`. We use this method to discover expanded tasks
 * efficiently instead of inefficiently iterating over every item in state.
 *
 * If there are no expanded tasks this function is O(1). Otherwise it's
 * O(expandedTaskCount). We check if the task is a member of our root query in O(1)
 * time then we need to iterate over expanded tasks to find our other indexes.
 */
export function findTaskIndexInGridViewVirtualizedListIfExists({
    state,
    iterateRootExpandedTaskIds,
    rootParentTaskId,
    taskId: targetTaskId,
}: {
    state: TaskGridViewVirtualizedListState;
    iterateRootExpandedTaskIds: () => Iterable<TaskId>;
    rootParentTaskId: TaskId | null;
    taskId: TaskId;
}): number | null {
    const rootQuery = state.getRootQueryIfExists();
    if (!rootQuery) return null;

    const itemCount = state.getItemCount();
    const indexes: Array<number> = [];

    // 1. Check whether the target task is in our root query. If it is, great! Return
    //    that index.
    const rootTargetTask = rootQuery
        .getLoadedTaskEntryStoreIfExists(targetTaskId)
        ?.getSnapshot().task;
    if (rootTargetTask) {
        const rootTargetCursor = getTaskQueryNormalizedSortCursorForModel(
            rootQuery.sorts,
            rootTargetTask,
        );

        const rootTargetIndex = state.getIndexByRootCursorIfExists(rootTargetCursor);

        if (rootTargetIndex !== null) {
            // We prefer returning the index within `scopeTaskKey` if possible.
            if (rootParentTaskId === targetTaskId) {
                return rootTargetIndex;
            }

            indexes.push(rootTargetIndex);
        }
    }

    // 2. Loop through all our root-level expanded tasks. Then recursively loop through
    //    the child tasks of those expanded tasks looking for our target task.
    for (const rootExpandedTaskId of iterateRootExpandedTaskIds()) {
        // If our target task is in the root query then we already found it in our code
        // branch above.
        if (rootExpandedTaskId === targetTaskId) continue;

        const rootExpandedTask = rootQuery
            .getLoadedTaskEntryStoreIfExists(rootExpandedTaskId)
            ?.getSnapshot().task;
        if (!rootExpandedTask) continue;

        const rootExpandedCursor = getTaskQueryNormalizedSortCursorForModel(
            rootQuery.sorts,
            rootExpandedTask,
        );

        const rootExpandedIndex = state.getIndexByRootCursorIfExists(rootExpandedCursor);
        if (rootExpandedIndex === null) continue;

        let targetIndex = rootExpandedIndex + 1;
        while (targetIndex < itemCount) {
            const item = state.getItem(targetIndex);

            const isChildOfRootExpandedTask =
                item.parents.length > 0 &&
                getTaskQuerySortCursorTaskId(item.parents[0]!.cursor) === rootExpandedTaskId;

            // We keep looping until we leave the root expanded task we're looking at.
            if (!isChildOfRootExpandedTask) break;

            if (
                item.type === "Task" &&
                getTaskQuerySortCursorTaskId(item.cursor) === targetTaskId
            ) {
                // We prefer returning the index within `scopeTaskKey` if possible.
                if (rootParentTaskId === rootExpandedTaskId) {
                    return targetIndex;
                }

                indexes.push(targetIndex);

                // If we find the task, we know it can't appear twice in an expanded task tree so
                // we can break out of our loop early.
                break;
            }

            targetIndex++;
        }
    }

    // Sort the indexes we found and pick the first one. If `scopeTaskKey` was provided
    // then we try to return the index within that scope.
    indexes.sort();
    return indexes[0] ?? null;
}
