import {RBTree} from "bintrees";
import {evaluateTaskQueryNormalizedFiltersForIndexDoc} from "~/server/tasks/index/evaluate_task_query_normalized_filters_for_index_doc.js";
import {getTaskQueryNormalizedSortCursorFromIndexDoc} from "~/server/tasks/index/get_task_query_normalized_sort_cursor_from_index_doc.js";
import {TaskIndexDoc} from "~/server/tasks/index/task_index_doc.js";
import {mightTaskActionAddVisibleTaskInQueryNormalizedFilters} from "~/server/tasks/realtime/internal/might_task_action_add_visible_task_in_query_normalized_filters.js";
import {TaskRealtimeQueryStore} from "~/server/tasks/realtime/internal/task_realtime_query_store.js";
import {HybridLogicalTime} from "~/shared/helpers/clock/hybrid_logical_clock.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {getOrSetDefaultMapValue} from "~/shared/helpers/map/get_or_set_default_map_value.js";
import {SpaceId, TaskId} from "~/shared/id/types/id_types.js";
import {TaskTaskAction} from "~/shared/tasks/actions/task_task_action.js";
import {TaskQueryNormalizedFilters} from "~/shared/tasks/task_query_normalized_filters.js";
import {TaskQueryNormalizedSort} from "~/shared/tasks/task_query_normalized_sort.js";
import {
    TaskQuerySortCursor,
    compareTaskQuerySortCursors,
} from "~/shared/tasks/task_query_sort_cursor.js";

const previousTaskIdByQueryForTest =
    process.env.NODE_ENV !== "production"
        ? new WeakMap<TaskRealtimeQuery, Map<TaskId, TaskIndexDoc>>()
        : null;

export class TaskRealtimeQuery {
    private readonly _store: TaskRealtimeQueryStore;
    private readonly _filters: TaskQueryNormalizedFilters;
    private readonly _sorts: ReadonlyArray<TaskQueryNormalizedSort>;

    /**
     * Tasks in a query are represented with a red-black tree. We use a red-black
     * tree to get O(log(n)) insertion/removal of tasks at any point in the list.
     *
     * We only store task cursors in our tree (to establish order). The full task
     * object can be found in `TaskRealtimeQueryStore` which is shared across all
     * queries in a space.
     *
     * Queries have a "loaded range" in which we keep all tasks in the query of
     * that range available in realtime. We don't load all tasks in a query at once
     * as that would be inefficient for really large queries. The start of our
     * loaded range is the start of the tree and the end is `loadedBeforeCursor`
     * (inclusive).
     *
     * We may have tasks in the query outside of the loaded range. This happens
     * when a task inside the loaded range moves outside of the loaded range or
     * when we add a newly visible task to the query and it happens to land outside
     * of the loaded range. So when iterating over tasks, stop at
     * `loadedBeforeCursor`. Otherwise you'll get a sparse and inconsistent list
     * of tasks.
     */
    private readonly _tree = new RBTree<TaskQuerySortCursor>((cursor1, cursor2) =>
        compareTaskQuerySortCursors(this._sorts, cursor1, cursor2),
    );

    /**
     * The range from the beginning of `tree` to `loadedBeforeCursor` (inclusive)
     * is considered the "loaded range". We will have loaded all tasks within the
     * loaded range and keep them up-to-date in realtime.
     */
    private _loadedBeforeCursor: TaskQuerySortCursor | null;

    public static load({
        spaceId,
        filters,
        sorts,
    }: {
        spaceId: SpaceId;
        filters: TaskQueryNormalizedFilters;
        sorts: ReadonlyArray<TaskQueryNormalizedSort>;
    }) {}

    /**
     * When a task that's visible in our query changes `TaskRealtimeQueryStore`
     * calls this function. The query is then responsible for:
     *
     * 1. Determining if the task is still visible after the update
     * 2. Moving the task to its new position if the sort order changed
     * 3. Propagating this update to connected clients
     *
     * Expectations:
     *
     * - The `TaskId` must be visible in the query
     * - `oldTask` must be exactly the same as the last task object our query
     *   has seen for this `TaskId`
     *
     * If expectations fail then we throw an error in dev and test.
     */
    public onVisibleTaskUpdate(
        taskId: TaskId,
        oldTask: TaskIndexDoc,
        newTask: TaskIndexDoc,
    ): {isStillVisible: boolean} {
        // When testing, track that the query class observes every update to a task and
        // that no updates are skipped.
        if (process.env.NODE_ENV !== "production") {
            assert(previousTaskIdByQueryForTest);

            const previousTaskById = getOrSetDefaultMapValue(
                previousTaskIdByQueryForTest,
                this,
                () => new Map(),
            );

            const previousTask = previousTaskById.get(taskId);
            assert(
                previousTask,
                "Query can't update hidden task that hasn't been added with `maybeAddVisibleTask()`",
            );
            assert(
                previousTask === oldTask,
                "Query must observe all updates to a visible task through `onVisibleTaskUpdate()`",
            );
            previousTaskById.set(taskId, newTask);
        }

        const oldCursor = getTaskQueryNormalizedSortCursorFromIndexDoc(
            this._sorts,
            taskId,
            oldTask,
        );

        // If the task is no longer visible, remove it from our tree.
        const isStillVisible = evaluateTaskQueryNormalizedFiltersForIndexDoc(
            this._filters,
            newTask,
        );
        if (!isStillVisible) {
            const wasRemoved = this._tree.remove(oldCursor);
            assert(wasRemoved);

            // When testing, track that the task has been removed from the query.
            if (process.env.NODE_ENV !== "production") {
                assertExists(previousTaskIdByQueryForTest).get(this)?.delete(taskId);
            }

            return {isStillVisible: false};
        }

        const newCursor = getTaskQueryNormalizedSortCursorFromIndexDoc(
            this._sorts,
            taskId,
            newTask,
        );

        // If the sort values of our task have changed then we want to move it to a new
        // position in our tree. This has O(log(n)) performance since we use a binary
        // search tree.
        const haveSortValuesChanged =
            compareTaskQuerySortCursors(this._sorts, oldCursor, newCursor) !== 0;
        if (haveSortValuesChanged) {
            const wasRemoved = this._tree.remove(oldCursor);
            assert(wasRemoved);
            this._tree.insert(newCursor);
        }

        return {isStillVisible: true};
    }

    public mightActionAddVisibleTask(
        actionTime: HybridLogicalTime,
        action: TaskTaskAction,
    ): boolean {
        return mightTaskActionAddVisibleTaskInQueryNormalizedFilters(
            actionTime,
            action,
            this._filters,
        );
    }

    /**
     * Tests whether the task is visible in our query and adds it if so.
     *
     * Expectations:
     *
     * - The task must be hidden in our query, whether or not we end up adding
     *   it as a visible task
     *
     * If expectations fail then we throw an error in dev and test.
     */
    public maybeAddVisibleTask(taskId: TaskId, task: TaskIndexDoc): {isVisible: boolean} {
        // When testing, track that the query class observes every update to a task and
        // that no updates are skipped.
        if (process.env.NODE_ENV !== "production") {
            assert(
                !assertExists(previousTaskIdByQueryForTest).get(this)?.get(taskId),
                "Query can't add task that's already visible again with `maybeAddVisibleTask()`",
            );
        }

        const isVisible = evaluateTaskQueryNormalizedFiltersForIndexDoc(this._filters, task);
        if (!isVisible) return {isVisible: false};

        const cursor = getTaskQueryNormalizedSortCursorFromIndexDoc(this._sorts, taskId, task);
        this._tree.insert(cursor);

        // When testing, track that the task has been added to the query.
        if (process.env.NODE_ENV !== "production") {
            assert(previousTaskIdByQueryForTest);

            const previousTaskById = getOrSetDefaultMapValue(
                previousTaskIdByQueryForTest,
                this,
                () => new Map(),
            );

            previousTaskById.set(taskId, task);
        }

        return {isVisible: true};
    }
}
