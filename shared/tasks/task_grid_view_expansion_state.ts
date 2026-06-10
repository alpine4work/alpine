import {emptyArray} from "~/shared/helpers/array/empty_array.js";
import {TaskId} from "~/shared/id/types/id_types.js";
import {Schema} from "~/shared/schema/schema.js";

/**
 * Describes the expanded structure of tasks in a grid view. A top level task may
 * be expanded then its children might be expanded and so on.
 *
 * We store this state in the database so we can load expanded tasks immediately
 * when the user opens the page. As opposed to storing in `localStorage` and
 * causing many loading spinners or request waterfalls on page navigation.
 *
 * The expansion state is saved per browser (so a user on multiple devices will
 * have multiple expansion states) and is expired if not used for many months to
 * reduce storage costs.
 *
 * Expansion state mirrors the tree structure of a grid view. So what do we tasks
 * change their parents? We have no mechanism to keep expansion state consistent.
 * So code must deal with the fact that expansion state may reference tasks at
 * positions that don't actually exist. We have two mechanisms to try and keep
 * expansion state eventually consistent:
 *
 * 1. Every 3min or so in the browser we compare expansion state to what's rendered
 *    on the screen. Removing any branches of the expansion state tree that
 *    correspond to tasks that don't exist in that position.
 *
 * 2. If the user is connected to our realtime service then in the browser when we
 *    observe the parent of a task changing, we move the expansion state in the
 *    browser's open grid view (and only the open grid view) to the task's new
 *    location with `moveTaskGridViewExpansionTaskState()`. So if you're
 *    collaborating in realtime with someone your expansion state isn't lost.
 *
 * These two mechanisms are best effort and only run in the user's browser. Saying
 * expansion state is "eventually consistent" is itself a bit of a stretch given
 * expansion state may never converge on a consistent value.
 *
 * It's important we keep expansion state kind of clean because we use it for
 * preloading child queries when the user opens a view. If we're always preloading
 * a bunch of dead child queries because their position in the tree moved, that's
 * wasteful.
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
    let currentState: TaskGridViewExpansionState = state;

    for (const taskId of taskPath) {
        const nextState: {isExpanded: boolean; childTasks: TaskGridViewExpansionState} | undefined =
            currentState?.get(taskId);
        if (!nextState || !nextState.isExpanded) return false;

        currentState = nextState.childTasks;
    }

    return true;
}

/**
 * Expand the children of this task path in the grid view.
 */
export function expandChildTaskInGridView(
    state: TaskGridViewExpansionState,
    taskPath: ReadonlyArray<TaskId>,
): TaskGridViewExpansionState {
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
    state: TaskGridViewExpansionState,
    taskPath: ReadonlyArray<TaskId>,
): TaskGridViewExpansionState {
    if (taskPath.length === 0) return state;

    const taskId = taskPath[0]!;
    const nextTaskPath = taskPath.slice(1);

    const taskState = state?.get(taskId);
    if (!taskState) return state;

    const newChildTasks = collapseChildTaskInGridView(taskState.childTasks, nextTaskPath);

    // Optimization: If child tasks didn't change and this isn't the task we want to
    // collapse then don't create a new map.
    if (nextTaskPath.length > 0 && newChildTasks === taskState.childTasks) return state;

    const newState = new Map(state);

    // If this is the final task then set `isExpanded` to false regardless of what it
    // was earlier.
    const isExpanded = nextTaskPath.length === 0 ? false : (taskState?.isExpanded ?? false);

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
 * If a task is re-parented (e.g. by an indent/dedent operation) we want to move
 * its expansion state to the task's new position in the tree. This function moves
 * the task's expansion state to its new location.
 *
 * The `TaskId` is the task that's moving and the task paths are as many parent
 * task paths as you know about. The parent tasks do not need to be visible in the
 * task expansion state.
 */
export function moveTaskGridViewExpansionTaskState(
    state: TaskGridViewExpansionState,
    oldTaskPath: ReadonlyArray<TaskId>,
    newTaskPath: ReadonlyArray<TaskId>,
    targetTaskId: TaskId,
): TaskGridViewExpansionState {
    const recoverTaskStates: Array<TaskGridViewExpansionTaskState> = [];

    for (let i = 0; i < oldTaskPath.length + 1; i++) {
        const remove = (
            state: TaskGridViewExpansionState,
            taskPath: ReadonlyArray<TaskId>,
        ): TaskGridViewExpansionState => {
            if (taskPath.length === 0) {
                const taskState = state?.get(targetTaskId);
                if (!taskState) return state;

                recoverTaskStates.push(taskState);

                const newState = new Map(state);
                newState.delete(targetTaskId);
                return newState.size > 0 ? newState : null;
            }

            const taskId = taskPath[0]!;
            const nextTaskPath = taskPath.slice(1);

            const taskState = state?.get(taskId);
            if (!taskState) return state;

            const newChildTasks = remove(taskState.childTasks, nextTaskPath);
            if (newChildTasks === taskState.childTasks) return state;

            const newState = new Map(state);

            newState.set(taskId, {
                isExpanded: taskState.isExpanded,
                childTasks: newChildTasks,
            });

            return newState.size > 1 || taskState.isExpanded || newChildTasks !== null
                ? newState
                : null;
        };

        state = remove(state, oldTaskPath.slice(i));
    }

    for (let i = 0; i < Math.max(newTaskPath.length, 1); i++) {
        const add = (
            state: TaskGridViewExpansionState,
            taskPath: ReadonlyArray<TaskId>,
        ): TaskGridViewExpansionState => {
            if (taskPath.length === 0) {
                const recoverTaskState = recoverTaskStates.shift();
                if (!recoverTaskState) return state;

                const newState = new Map(state);
                newState.set(targetTaskId, recoverTaskState);
                return newState;
            }

            const taskId = taskPath[0]!;
            const nextTaskPath = taskPath.slice(1);

            const taskState = state?.get(taskId);
            if (!taskState) return state;

            const newChildTasks = add(taskState.childTasks, nextTaskPath);
            if (newChildTasks === taskState.childTasks) return state;

            const newState = new Map(state);

            newState.set(taskId, {
                isExpanded: taskState.isExpanded,
                childTasks: newChildTasks,
            });

            return newState.size > 1 || taskState.isExpanded || newChildTasks !== null
                ? newState
                : null;
        };

        state = add(state, newTaskPath.slice(i));
    }

    return state;
}

/**
 * Get the changes between `oldState` and `newState`. This function is useful for
 * incrementally updating some data structures that depend on expansion state.
 */
export function* diffTaskGridViewExpansionStates(
    oldState: TaskGridViewExpansionState,
    newState: TaskGridViewExpansionState,
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
                // The task is collapsed, that means everything under it is also collapsed. So that
                // matches what's in `newTaskState` for this task (nothing).
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
            // The task is collapsed, that means everything under it is also collapsed. So that
            // matches what's in `oldTaskState` for this task (nothing).
        }
    }
}
