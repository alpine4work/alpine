import {assert} from "~/shared/helpers/control/assert.js";
import {assertId} from "~/shared/id/id.js";
import {TaskId} from "~/shared/id/types/id_types.js";

/**
 * The key of a task in a grid view. Tasks are unique within a query but
 * because you may expand a task's children a task might not be unique in a
 * grid view. Since you could have a task in the root query and a task visible
 * in an expanded parent.
 *
 * So the way we key tasks in a grid view is by saying a task in the root query
 * has the key `TaskId`. Then child tasks have a key that's their root parent
 * task in the query (not the same as the root parent task, just the highest
 * task in the query) combined with their `TaskId`. Since tasks within a child
 * task tree are always unique.
 *
 * This key will be unique for any task within the grid view. Unfortunately it
 * does mean when indenting/dedenting between root tasks and child tasks our
 * task's key changes so React will need to remount the component. For those
 * operations we take care to place focus in the new task.
 */
export type TaskGridViewTaskKey = TaskId | `${TaskId}-${TaskId}`;

export function parseTaskGridViewTaskKey(key: TaskGridViewTaskKey): {
    rootTaskId: TaskId | null;
    taskId: TaskId;
} {
    if (!key.includes("-")) {
        return {rootTaskId: null, taskId: assertId<TaskId>(key)};
    } else {
        const [rootTaskId, taskId] = key.split("-", 2);
        assert(rootTaskId && taskId);
        return {rootTaskId: assertId<TaskId>(rootTaskId), taskId: assertId<TaskId>(taskId)};
    }
}
