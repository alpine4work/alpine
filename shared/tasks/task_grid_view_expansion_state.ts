import {emptyArray} from "~/shared/helpers/array/empty_array.js";
import {TaskId} from "~/shared/id/types/id_types.js";
import {Schema} from "~/shared/schema/schema.js";

/**
 * Describes the expanded structure of tasks in a grid view. A top level task
 * may be expanded then its children might be expanded and so on.
 *
 * We store this state in the database so we can load expanded tasks
 * immediately when the user opens the page. As opposed to storing in
 * `localStorage` and causing many loading spinners or request waterfalls on
 * page navigation.
 *
 * The expansion state is saved per browser (so a user on multiple devices will
 * have multiple expansion states) and is expired if not used for many months
 * to reduce storage costs.
 */
export type TaskGridViewExpansionState = ReadonlyMap<TaskId, TaskGridViewExpansionTaskState> | null;

export type TaskGridViewExpansionTaskState = {
    readonly isExpanded: boolean;
    readonly childTasks: TaskGridViewExpansionState;
};

const TaskGridViewExpansionStateRecursiveSchema = Schema.declare<TaskGridViewExpansionState>();

export const TaskGridViewExpansionStateSchema: Schema<TaskGridViewExpansionState> = Schema.map(
    Schema.id<TaskId>(),
    Schema.object({
        isExpanded: Schema.boolean,
        childTasks: TaskGridViewExpansionStateRecursiveSchema,
    }),
).nullable();

TaskGridViewExpansionStateRecursiveSchema.define(TaskGridViewExpansionStateSchema);

/**
 * Are the children of this task path expanded in the grid view?
 */
export function areChildTasksExpandedInGridView(
    state: TaskGridViewExpansionState,
    taskPath: ReadonlyArray<TaskId>,
): boolean {
    let currentState: TaskGridViewExpansionState | null = state;

    for (const taskId of taskPath) {
        const nextState:
            | {isExpanded: boolean; childTasks: TaskGridViewExpansionState | null}
            | undefined = currentState?.get(taskId);
        if (!nextState || !nextState.isExpanded) return false;

        currentState = nextState.childTasks;
    }

    return true;
}

/**
 * Expand the children of this task path in the grid view.
 */
export function expandChildTaskInGridView(
    state: TaskGridViewExpansionState | null,
    taskPath: ReadonlyArray<TaskId>,
): TaskGridViewExpansionState | null {
    if (taskPath.length === 0) return state;

    const taskId = taskPath[0]!;
    const nextTaskPath = taskPath.slice(1);

    const taskState = state?.get(taskId);

    const oldChildTasks = taskState?.childTasks ?? null;
    const newChildTasks = expandChildTaskInGridView(oldChildTasks, nextTaskPath);

    // Optimization: If nothing changed then we don't need to create a new map.
    if (taskState && taskState.isExpanded && oldChildTasks === newChildTasks) {
        return state;
    }

    const newState = new Map(state);

    newState.set(taskId, {
        isExpanded: true,
        childTasks: newChildTasks,
    });

    return newState;
}

/**
 * Collapse the children of this task path in the grid view.
 */
export function collapseChildTaskInGridView(
    state: TaskGridViewExpansionState | null,
    taskPath: ReadonlyArray<TaskId>,
): TaskGridViewExpansionState | null {
    if (taskPath.length === 0) return state;

    const taskId = taskPath[0]!;
    const nextTaskPath = taskPath.slice(1);

    const taskState = state?.get(taskId);
    const newChildTasks = collapseChildTaskInGridView(taskState?.childTasks ?? null, nextTaskPath);

    const newState = new Map(state);

    // If this is the final task then set `isExpanded` to false regardless of what
    // it was earlier.
    const isExpanded = nextTaskPath.length === 0 ? false : taskState?.isExpanded ?? false;

    if (!isExpanded && newChildTasks === null) {
        newState.delete(taskId);
    } else {
        newState.set(taskId, {
            isExpanded,
            childTasks: newChildTasks,
        });
    }

    return newState.size > 0 ? newState : null;
}

/**
 * Get the changes between `oldState` and `newState`. This function is useful
 * for incrementally updating some data structures that depend on
 * expansion state.
 */
export function* diffTaskGridViewExpansionStates(
    oldState: TaskGridViewExpansionState | null,
    newState: TaskGridViewExpansionState | null,
): IterableIterator<{taskPath: Array<TaskId>; isExpanded: boolean}> {
    if (oldState === newState) return;

    const addedNewState = new Map(newState);

    for (const [taskId, oldTaskState] of oldState ?? emptyArray) {
        const newTaskState = addedNewState.delete(taskId) ? newState?.get(taskId) : undefined;

        if (!newTaskState) {
            if (oldTaskState.isExpanded) {
                yield {
                    taskPath: [taskId],
                    isExpanded: false,
                };

                for (const change of diffTaskGridViewExpansionStates(
                    oldTaskState.childTasks,
                    null,
                )) {
                    change.taskPath.unshift(taskId);
                    yield change;
                }
            } else {
                // The task is collapsed, that means everything under it is also collapsed. So
                // that matches what's in `newTaskState` for this task (nothing).
            }
        } else {
            if (oldTaskState.isExpanded && !newTaskState.isExpanded) {
                yield {
                    taskPath: [taskId],
                    isExpanded: false,
                };

                for (const change of diffTaskGridViewExpansionStates(
                    oldTaskState.childTasks,
                    null,
                )) {
                    change.taskPath.unshift(taskId);
                    yield change;
                }
            } else if (!oldTaskState.isExpanded && newTaskState.isExpanded) {
                yield {
                    taskPath: [taskId],
                    isExpanded: true,
                };

                for (const change of diffTaskGridViewExpansionStates(
                    null,
                    newTaskState.childTasks,
                )) {
                    change.taskPath.unshift(taskId);
                    yield change;
                }
            } else {
                for (const change of diffTaskGridViewExpansionStates(
                    oldTaskState.childTasks,
                    newTaskState.childTasks,
                )) {
                    change.taskPath.unshift(taskId);
                    yield change;
                }
            }
        }
    }

    for (const [taskId, newTaskState] of addedNewState) {
        if (newTaskState.isExpanded) {
            yield {
                taskPath: [taskId],
                isExpanded: true,
            };

            for (const change of diffTaskGridViewExpansionStates(null, newTaskState.childTasks)) {
                change.taskPath.unshift(taskId);
                yield change;
            }
        } else {
            // The task is collapsed, that means everything under it is also collapsed. So
            // that matches what's in `oldTaskState` for this task (nothing).
        }
    }
}
