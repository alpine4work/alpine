import {AccountClientStore} from "~/client/accounts/account_client_store.js";
import {Store} from "~/client/helpers/store/store.js";
import {createGetTaskActionReferencedSortableAccount} from "~/client/tasks/internal/create_get_task_action_referenced_sortable_account.js";
import {TaskClientStore, TaskClientStoreTaskEntry} from "~/client/tasks/task_client_store.js";
import {HybridLogicalClock} from "~/shared/helpers/clock/hybrid_logical_clock.js";
import {assertAssignableTypes} from "~/shared/helpers/control/assert_assignable_types.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {getOrSetDefaultMapValue} from "~/shared/helpers/map/get_or_set_default_map_value.js";
import {initialOrderKey} from "~/shared/helpers/sort/order_key.js";
import {AccountId, SpaceId, TaskId} from "~/shared/id/types/id_types.js";
import {serializeHybridLogicalTime} from "~/shared/schema/helpers/hybrid_logical_time_schema.js";
import {TaskAction, TaskUpdateTaskAction} from "~/shared/tasks/actions/task_action.js";
import {TaskModel} from "~/shared/tasks/model/task_model.js";
import {upcastTaskAssigneeWithSortableAccount} from "~/shared/tasks/task_assignee.js";
import {TaskSortableAccount} from "~/shared/tasks/task_sortable_account.js";
import {upcastTaskStatusWithSortableAccount} from "~/shared/tasks/task_status.js";

// We use an interface to prevent you from calling methods that mutate the
// store or accessing `store.clock`.
interface TaskClientStoreInterface {
    readonly spaceId: SpaceId;
    readonly accountStore: AccountClientStore;
    getTaskEntryStoreIfExists(task: TaskId): Store<TaskClientStoreTaskEntry> | null;
}

assertAssignableTypes<TaskClientStore, TaskClientStoreInterface>();

/**
 * Class that holds some actions we can apply to undo a previous set of
 * actions. In this class wrapper since we need to generate the task times on
 * the fly. When you call `get()` we will return actions with the current time.
 */
export class TaskUndoActions {
    private readonly _actions: ReadonlyArray<TaskUpdateTaskAction>;

    constructor(actions: ReadonlyArray<TaskUpdateTaskAction>) {
        this._actions = actions;
    }

    public get(clock: HybridLogicalClock): ReadonlyArray<TaskUpdateTaskAction> {
        const oldTimes = new Set<bigint>();

        for (const action of this._actions) {
            oldTimes.add(serializeHybridLogicalTime(action.time));
        }

        const newTimeByOldTime = new Map(
            Array.from(oldTimes)
                .sort((time1, time2) => {
                    if (time1 < time2) return -1;
                    if (time1 > time2) return 1;
                    return 0;
                })
                // Reverse the times. In a drag-and-drop action we have `RemoveCollection` at
                // t1 and `AddCollection` at t2. t1 < t2 to make sure the `AddCollection` wins.
                //
                // Then we invert the actions so we get `AddCollection` at t1' and
                // `RemoveCollection` at t2'. Here t2' < t1' to make sure the remove
                // collection wins.
                .reverse()
                .map(time => [time, clock.now()]),
        );

        const newActions = this._actions.map(action => ({
            ...action,
            time: assertExists(newTimeByOldTime.get(serializeHybridLogicalTime(action.time))),
        }));

        // Reverse our actions from the undo. Actions are ordered to not trip any
        // authorization errors when committed on the server. So for instance a move
        // action transaction will have `UpdateParentTaskId` before `RemoveCollection`.
        // If we applied `RemoveCollection` first then we'd get an authorization error
        // when we try to apply `UpdateParentTaskId`.
        //
        // For undo actions we apply in reverse. We want to apply `AddCollection`
        // before `UpdateParentTaskId` to null.
        newActions.reverse();

        return newActions;
    }

    public getWithOldTimes() {
        return this._actions;
    }
}

/**
 * Get actions that undo changes made by the provided actions. When the user
 * hits Cmd-Z we will apply these actions.
 *
 * Undo is best effort. We don't have a clever universal solution. When undoing
 * we revert values back to what the client thinks the current value is (the
 * server may think something different) ignoring intermediate updates.
 *
 * Sometimes, it's not possible to generate undo actions.
 *
 * The `store` you pass in must not have `actions` applied. So we can read old
 * values to generate new actions.
 */
export function createTaskUndoActionsIfPossible(
    store: TaskClientStoreInterface,
    actions: ReadonlyArray<TaskAction>,
): TaskUndoActions | null {
    // The new actions that are returned will have identical `time`s to the
    // `action`s you passed in. Before applying the undo actions you must replace
    // all action times with new ones. The new times you generate must preserve the
    // relative order of old times but reversed. If two actions have the same old
    // time then they must get the same new time.
    //
    // This is managed by `TaskUndoActions`.
    const undoActions: Array<TaskUpdateTaskAction> = [];

    const workingTaskEntryById = new Map<
        TaskId,
        | {task: TaskModel; actions: null}
        | {
              task: null;
              actions: Array<{
                  action: TaskUpdateTaskAction;
                  getActionReferencedSortableAccount: (accountId: AccountId) => TaskSortableAccount;
              }>;
          }
    >();

    for (const action of actions) {
        // To generate undo actions we need to know the old task value. Including any
        // actions made during this transaction. Importantly, if a task was created in
        // this transaction we still need the `TaskModel` when generating an undo
        // action.
        const getTask = (taskId: TaskId): TaskModel | null => {
            return getOrSetDefaultMapValue(workingTaskEntryById, taskId, () => {
                const task = store.getTaskEntryStoreIfExists(taskId)?.getSnapshot().task;
                return task ? {task, actions: null} : {task: null, actions: []};
            }).task;
        };

        switch (action.type) {
            // These actions are not undo-able.
            case "UpdateCollection":
            case "UpdateNotepadPage":
            case "UpdateAccountName":
                return null;

            case "UpdateTask": {
                switch (action.taskAction.type) {
                    case "Create":
                    case "Undelete": {
                        undoActions.push({
                            type: "UpdateTask",
                            time: action.time,
                            taskId: action.taskId,
                            taskAction: {
                                type: "Delete",
                            },
                        });
                        break;
                    }
                    case "Delete": {
                        undoActions.push({
                            type: "UpdateTask",
                            time: action.time,
                            taskId: action.taskId,
                            taskAction: {
                                type: "Undelete",
                            },
                        });
                        break;
                    }
                    case "UpdateParentTaskId": {
                        const task = getTask(action.taskId);
                        if (!task) return null;

                        undoActions.push({
                            type: "UpdateTask",
                            time: action.time,
                            taskId: action.taskId,
                            taskAction: {
                                type: "UpdateParentTaskId",
                                parentTaskId: task.rawData.parent.taskId.value,
                                parentPosition: task.rawData.parent.position.value,
                            },
                        });
                        break;
                    }
                    case "UpdateParentPosition": {
                        const task = getTask(action.taskId);
                        if (!task) return null;

                        undoActions.push({
                            type: "UpdateTask",
                            time: action.time,
                            taskId: action.taskId,
                            taskAction: {
                                type: "UpdateParentPosition",
                                parentPosition: task.rawData.parent.position.value ?? null,
                            },
                        });
                        break;
                    }
                    case "UpdateChildrenCounts": {
                        // Children counts only increment. They don't revert back. The server will tell
                        // us the correct value through `extraActions`.
                        break;
                    }
                    case "AddCollection": {
                        undoActions.push({
                            type: "UpdateTask",
                            time: action.time,
                            taskId: action.taskId,
                            taskAction: {
                                type: "RemoveCollection",
                                collectionId: action.taskAction.collectionId,
                            },
                        });
                        break;
                    }
                    case "RemoveCollection": {
                        const task = getTask(action.taskId);
                        if (!task) return null;

                        // If there is no order key, collection was not added in the first place.
                        const orderKey = task.rawData.collections.getOrderKey(
                            action.taskAction.collectionId,
                        );
                        if (!orderKey) return null;

                        undoActions.push({
                            type: "UpdateTask",
                            time: action.time,
                            taskId: action.taskId,
                            taskAction: {
                                type: "AddCollection",
                                collectionId: action.taskAction.collectionId,
                                orderKey,
                            },
                        });
                        break;
                    }
                    case "UpdateCollectionPosition": {
                        const task = getTask(action.taskId);
                        if (!task) return null;

                        // If there is no version, collection was not part of task in the first place.
                        const version = task.rawData.collections.getVersion(
                            action.taskAction.collectionId,
                        );
                        if (!version) return null;

                        undoActions.push({
                            type: "UpdateTask",
                            time: action.time,
                            taskId: action.taskId,
                            taskAction: {
                                type: "UpdateCollectionPosition",
                                collectionId: action.taskAction.collectionId,
                                // If a position is not set, we default to using the collection's version from
                                // the collection set.
                                position: task.rawData.positionByCollectionId.get(
                                    action.taskAction.collectionId,
                                ) ?? {
                                    orderTime: version,
                                    orderKey: initialOrderKey,
                                },
                            },
                        });
                        break;
                    }
                    case "UpdateNotepadPagePosition": {
                        const task = getTask(action.taskId);
                        if (!task) return null;

                        // `UpdateNotepadPagePosition` is used to add tasks to a notepad page and
                        // remove them from a notepad page. So if a position doesn't exist it means
                        // to undo we need to remove the task from the notepad page.
                        const position =
                            task.rawData.positionByAccountIdAndNotepadPageId.get(
                                `${action.taskAction.accountId}-${action.taskAction.notepadPageId}`,
                            ) ?? null;

                        undoActions.push({
                            type: "UpdateTask",
                            time: action.time,
                            taskId: action.taskId,
                            taskAction: {
                                type: "UpdateNotepadPagePosition",
                                accountId: action.taskAction.accountId,
                                notepadPageId: action.taskAction.notepadPageId,
                                position,
                            },
                        });
                        break;
                    }
                    case "UpdateStatus": {
                        const task = getTask(action.taskId);
                        if (!task) return null;

                        undoActions.push({
                            type: "UpdateTask",
                            time: action.time,
                            taskId: action.taskId,
                            taskAction: {
                                type: "UpdateStatus",
                                status: upcastTaskStatusWithSortableAccount(
                                    task.rawData.status.value,
                                ),
                                assigneeStatus: task.rawData.assigneeStatus.value,
                            },
                        });
                        break;
                    }
                    case "UpdateAssignee": {
                        const task = getTask(action.taskId);
                        if (!task) return null;

                        undoActions.push({
                            type: "UpdateTask",
                            time: action.time,
                            taskId: action.taskId,
                            taskAction: {
                                type: "UpdateAssignee",
                                assignee: upcastTaskAssigneeWithSortableAccount(
                                    task.rawData.assignee.value,
                                ),
                                assigneeStatus: task.rawData.assigneeStatus.value,
                            },
                        });
                        break;
                    }
                    case "UpdateAssigneeStatus": {
                        const task = getTask(action.taskId);
                        if (!task) return null;

                        undoActions.push({
                            type: "UpdateTask",
                            time: action.time,
                            taskId: action.taskId,
                            taskAction: {
                                type: "UpdateAssigneeStatus",
                                assigneeStatus: task.rawData.assigneeStatus.value,
                            },
                        });
                        break;
                    }
                    case "UpdateAssigneeActivePosition": {
                        const task = getTask(action.taskId);
                        if (!task) return null;

                        const accountId =
                            task.rawData.assigneeActivePosition.value?.accountId ??
                            task.rawData.assignee.value?.assignee.accountId;

                        // If the task has neither `assigneeActivePosition` or `assignee` then updating
                        // the active position will fail since you may only update the active position
                        // if your current user is assigned to a task.
                        if (!accountId) {
                            return null;
                        }

                        undoActions.push({
                            type: "UpdateTask",
                            time: action.time,
                            taskId: action.taskId,
                            taskAction: {
                                type: "UpdateAssigneeActivePosition",
                                accountId,
                                position: task.rawData.assigneeActivePosition.value?.position ?? {
                                    orderTime: task.rawData.assigneeStatus.version,
                                    orderKey: initialOrderKey,
                                },
                            },
                        });
                        break;
                    }
                    case "UpdateTitle": {
                        // Title undo is not handled by generating inverted actions. We need to use
                        // `Y.UndoManager`. We use that class instead of trying to generate inverted
                        // updates since `Y.UndoManager` makes sure selection is properly set after
                        // an undo among other things.
                        //
                        // NOTE(calebmer, 2023-10-30): One approach I tried (which maybe we should try
                        // again in the future) is trying to get Y.js to generate an invert action. My
                        // [naive approach had bugs][1] and it was unclear how to handle selection
                        // state so I abandoned that approach. I opened a [forum post][1] on the topic.
                        // If we can figure out a proper implementation of inverting Y.js updates that
                        // may be a superior implementation to keep things consistent.
                        //
                        // [1]: https://discuss.yjs.dev/t/how-to-go-about-building-an-alternative-stateless-undo-implementation/2200

                        // Special case: We still want to generate undo actions when you create a task
                        // and update the title at the same time (like when you create a ghost task).
                        // When ghost task titles are updated we don't register an undo stack entry
                        // with `Y.UndoManager`. This will leave the title in the deleted task so it's
                        // available when the user undeletes the task.
                        if (
                            actions.some(
                                otherAction =>
                                    otherAction.type === "UpdateTask" &&
                                    otherAction.taskAction.type === "Create",
                            )
                        ) {
                            break;
                        }

                        return null;
                    }
                    case "UpdateDueDate": {
                        const task = getTask(action.taskId);
                        if (!task) return null;

                        undoActions.push({
                            type: "UpdateTask",
                            time: action.time,
                            taskId: action.taskId,
                            taskAction: {
                                type: "UpdateDueDate",
                                dueDate: task.rawData.dueDate.value,
                            },
                        });
                        break;
                    }
                    case "UpdatePriority": {
                        const task = getTask(action.taskId);
                        if (!task) return null;

                        undoActions.push({
                            type: "UpdateTask",
                            time: action.time,
                            taskId: action.taskId,
                            taskAction: {
                                type: "UpdatePriority",
                                priority: task.rawData.priority.value,
                            },
                        });
                        break;
                    }
                    default:
                        throw exhaustive(action.taskAction);
                }

                const getActionReferencedSortableAccount =
                    createGetTaskActionReferencedSortableAccount(store.accountStore, action);

                let taskEntry = workingTaskEntryById.get(action.taskId);

                // If we don't have an entry for this task, try to get one from our store.
                if (!taskEntry) {
                    const task = store.getTaskEntryStoreIfExists(action.taskId)?.getSnapshot().task;
                    if (task) {
                        taskEntry = {task, actions: null};
                    }
                }

                // Update the task entry with our action...
                if (
                    action.type === "UpdateTask" &&
                    action.taskAction.type === "Create" &&
                    !taskEntry?.task
                ) {
                    taskEntry = {
                        task: (taskEntry?.actions ?? []).reduce(
                            (task, {action, getActionReferencedSortableAccount}) =>
                                task.applyAction(action, getActionReferencedSortableAccount),
                            TaskModel.createFromAction(
                                store.spaceId,
                                action.taskId,
                                action.time,
                                action.taskAction,
                                getActionReferencedSortableAccount,
                            ),
                        ),
                        actions: null,
                    };
                } else if (!taskEntry) {
                    taskEntry = {
                        task: null,
                        actions: [{action, getActionReferencedSortableAccount}],
                    };
                } else if (!taskEntry.task) {
                    taskEntry.actions.push({action, getActionReferencedSortableAccount});
                } else {
                    taskEntry.task = taskEntry.task.applyAction(
                        action,
                        getActionReferencedSortableAccount,
                    );
                }

                workingTaskEntryById.set(action.taskId, taskEntry);
                break;
            }
            default:
                throw exhaustive(action);
        }
    }

    // If we got no undo actions, an undo isn't possible.
    if (undoActions.length === 0) return null;

    return new TaskUndoActions(undoActions);
}
