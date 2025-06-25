import {AccountRegistry} from "~/client/accounts/account_registry.js";
import {createGetTaskActionReferencedSortableAccount} from "~/client/tasks/core/create_get_task_action_referenced_sortable_account.js";
import {TaskClientStore, TaskClientStoreTaskEntry} from "~/client/tasks/core/task_client_store.js";
import {
    HybridLogicalClock,
    HybridLogicalTime,
} from "~/shared/helpers/clock/hybrid_logical_clock.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertAssignableTypes} from "~/shared/helpers/control/assert_assignable_types.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {isNonNullable} from "~/shared/helpers/control/is_non_nullable.js";
import {iterableSome} from "~/shared/helpers/iterable/iterable_some.js";
import {getOrSetDefaultMapValue} from "~/shared/helpers/map/get_or_set_default_map_value.js";
import {initialOrderKey} from "~/shared/helpers/sort/order_key.js";
import {AccountId, SpaceId, TaskId} from "~/shared/id/types/id_types.js";
import {serializeHybridLogicalTime} from "~/shared/schema/helpers/hybrid_logical_time_schema.js";
import {Store} from "~/shared/store/store.js";
import {TaskUpdateTaskAction} from "~/shared/tasks/actions/task_action.js";
import {
    TaskActionModel,
    TaskUpdateTaskActionModel,
} from "~/shared/tasks/actions/task_action_model.js";
import {TaskModel} from "~/shared/tasks/model/task_model.js";
import {upcastTaskAssigneeWithSortableAccount} from "~/shared/tasks/task_assignee.js";
import {TaskSortableAccount} from "~/shared/tasks/task_sortable_account.js";
import {upcastTaskStatusWithSortableAccount} from "~/shared/tasks/task_status.js";
import {TaskTitleUpdateModel, emptyTaskTitleUpdateModel} from "~/shared/tasks/task_title.js";

// We use an interface to prevent you from calling methods that mutate the
// store or accessing `store.clock`.
interface TaskClientStoreInterface {
    readonly clock: HybridLogicalClock;
    readonly spaceId: SpaceId;
    readonly currentAccountId: AccountId | null;
    readonly accountRegistry: AccountRegistry;
    getTaskEntryStoreIfExists(task: TaskId): Store<TaskClientStoreTaskEntry> | null;
}

assertAssignableTypes<TaskClientStore, TaskClientStoreInterface>();

type TaskUndoAction =
    | TaskUpdateTaskActionModel
    | {
          readonly type: "UpdateTaskWithReconciliation";
          readonly time: HybridLogicalTime;
          readonly taskId: TaskId;
          readonly taskAction: {
              readonly type: "UpdateTitle";
              readonly withoutUndoMerge: boolean;
              readonly getTitleUpdate: (
                  getTask: (taskId: TaskId) => TaskModel | null,
              ) => TaskTitleUpdateModel;
          };
      };

/**
 * Class that holds some actions we can apply to undo a previous set of
 * actions. In this class wrapper since we need to generate the task times on
 * the fly. When you call `get()` we will return actions with the current time.
 */
export class TaskUndoActions {
    private readonly _actions: ReadonlyArray<TaskUndoAction>;

    constructor(actions: ReadonlyArray<TaskUndoAction>) {
        this._actions = actions;
    }

    public concat(other: TaskUndoActions): TaskUndoActions {
        return new TaskUndoActions(this._actions.concat(other._actions));
    }

    public get(store: TaskClientStoreInterface): ReadonlyArray<TaskUpdateTaskActionModel> {
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
                .map(time => [time, store.clock.now()]),
        );

        const newActions: Array<TaskUpdateTaskActionModel | null> = [];
        const titleUpdateByTaskId = new Map<
            TaskId,
            {
                actionIndex: number;
                time: HybridLogicalTime;
                titleUpdate: TaskTitleUpdateModel;
            }
        >();

        const workingTaskEntryById = new Map<
            TaskId,
            | {task: TaskModel; actions: null}
            | {
                  task: null;
                  actions: Array<{
                      action: TaskUpdateTaskActionModel;
                      getActionReferencedSortableAccount: (
                          accountId: AccountId,
                      ) => TaskSortableAccount;
                  }>;
              }
        >();

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

        for (let actionIndex = 0; actionIndex < this._actions.length; actionIndex++) {
            const unreconciledAction = this._actions[actionIndex]!;
            const {taskId} = unreconciledAction;

            const newTime = assertExists(
                newTimeByOldTime.get(serializeHybridLogicalTime(unreconciledAction.time)),
            );

            let action: TaskUpdateTaskActionModel;
            if (unreconciledAction.type === "UpdateTask") {
                action = {...unreconciledAction, time: newTime};
                newActions.push(action);
            } else {
                const titleUpdate = unreconciledAction.taskAction.getTitleUpdate(getTask);

                action = {
                    ...unreconciledAction,
                    type: "UpdateTask",
                    time: newTime,
                    taskAction: {
                        type: "UpdateTitle",
                        titleUpdate,
                    },
                };

                // We may use `concat()` to combine many `UpdateTitle` actions into one
                // `TaskUndoActions` object. When generating undo actions, we want to merge
                // `UpdateTitle` actions back into one `TaskTitleUpdate`.
                const existingTitleUpdate = titleUpdateByTaskId.get(taskId);
                if (existingTitleUpdate === undefined) {
                    titleUpdateByTaskId.set(taskId, {actionIndex, time: action.time, titleUpdate});
                } else {
                    existingTitleUpdate.titleUpdate =
                        existingTitleUpdate.titleUpdate.merge(titleUpdate);
                }

                // We'll assign our merged action to this action slot.
                newActions.push(null);
            }

            const getActionReferencedSortableAccount = createGetTaskActionReferencedSortableAccount(
                store.accountRegistry,
                action,
            );

            let taskEntry = workingTaskEntryById.get(taskId);

            // If we don't have an entry for this task, try to get one from our store.
            if (!taskEntry) {
                const task = store.getTaskEntryStoreIfExists(taskId)?.getSnapshot().task;
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
        }

        for (const [taskId, {actionIndex, time, titleUpdate}] of titleUpdateByTaskId) {
            newActions[actionIndex] = {
                type: "UpdateTask",
                time,
                taskId,
                taskAction: {
                    type: "UpdateTitle",
                    titleUpdate,
                },
            };
        }

        return newActions.filter(isNonNullable);
    }

    public getWithoutReconciliation(): ReadonlyArray<{
        readonly taskId: TaskId;
        readonly taskAction: {
            readonly type: TaskUpdateTaskAction["taskAction"]["type"];
            readonly withoutUndoMerge?: boolean;
        };
    }> {
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
    actions: Iterable<TaskActionModel>,
    undoableSlice: {startIndex: number | null; endIndex: number | null} | null = null,
): TaskUndoActions | null {
    // Currently, accounts without space access can't edit tasks. The max
    // permission level of `urlGrant` is `View`.
    assert(store.currentAccountId);

    // The new actions that are returned will have identical `time`s to the
    // `action`s you passed in. Before applying the undo actions you must replace
    // all action times with new ones. The new times you generate must preserve the
    // relative order of old times but reversed. If two actions have the same old
    // time then they must get the same new time.
    //
    // This is managed by `TaskUndoActions`.
    const undoActions: Array<TaskUndoAction> = [];

    const workingTaskEntryById = new Map<
        TaskId,
        | {task: TaskModel; actions: null}
        | {
              task: null;
              actions: Array<{
                  action: TaskUpdateTaskActionModel;
                  getActionReferencedSortableAccount: (accountId: AccountId) => TaskSortableAccount;
              }>;
          }
    >();

    let nextIndex = 0;
    for (const action of actions) {
        const index = nextIndex;
        nextIndex++;

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
            case "UpdateAccountName":
                return null;

            // Collection updates are not undo-able but if the user creates a collection in
            // the same action in which they add the collection to a task we want to
            // generate an undo transaction that removes the collection but does not delete
            // the collection.
            //
            // TODO(calebmer): Deleting the collection too is probably a good idea but
            // right now undo actions must be of the `TaskUpdateTaskAction` type.
            case "UpdateCollection": {
                if (
                    action.collectionAction.type === "Create" &&
                    iterableSome(
                        actions,
                        otherAction =>
                            otherAction.type === "UpdateTask" &&
                            otherAction.taskAction.type === "AddCollection" &&
                            otherAction.taskAction.collectionId === action.collectionId,
                    )
                ) {
                    break;
                }

                return null;
            }

            case "UpdateTask": {
                // Only generate `undoActions` for actions in the undoable slice. However, we
                // want to locally apply all the actions.
                if (
                    undoableSlice === null ||
                    ((undoableSlice.startIndex === null || undoableSlice.startIndex <= index) &&
                        (undoableSlice.endIndex === null || index < undoableSlice.endIndex))
                ) {
                    const result = pushTaskUndoAction(
                        store.currentAccountId,
                        getTask,
                        action,
                        undoActions,
                    );

                    if (result?.abort) {
                        return null;
                    }
                }

                const getActionReferencedSortableAccount =
                    createGetTaskActionReferencedSortableAccount(store.accountRegistry, action);

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
            case "UpdateNotepadPage": {
                break;
            }
            default:
                throw exhaustive(action);
        }
    }

    // If we got no undo actions, an undo isn't possible.
    if (undoActions.length === 0) return null;

    // Reverse our actions from the undo. Actions are ordered to not trip any
    // authorization errors when committed on the server. So for instance a move
    // action transaction from a parent task to a collection query will have
    // `UpdateParentTaskId` before `RemoveCollection`. If we applied
    // `RemoveCollection` first then we'd get an authorization error when we try to
    // apply `UpdateParentTaskId`.
    //
    // For undo actions we apply in reverse. We want to apply `AddCollection`
    // before setting `UpdateParentTaskId` to null.
    undoActions.reverse();

    return new TaskUndoActions(undoActions);
}

function pushTaskUndoAction(
    currentAccountId: AccountId,
    getTask: (taskId: TaskId) => TaskModel | null,
    action: TaskUpdateTaskActionModel,
    undoActions: Array<TaskUndoAction>,
): {abort: boolean} | undefined {
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
            if (!task) return {abort: true};

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
            if (!task) return {abort: true};

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
            if (!task) return {abort: true};

            // If there is no order key, collection was not added in the first place.
            const orderKey = task.rawData.collections.getOrderKey(action.taskAction.collectionId);
            if (!orderKey) return {abort: true};

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
            if (!task) return {abort: true};

            // If there is no version, collection was not part of task in the first place.
            const version = task.rawData.collections.getVersion(action.taskAction.collectionId);
            if (!version) return {abort: true};

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
        case "UpdateStatus": {
            const task = getTask(action.taskId);
            if (!task) return {abort: true};

            undoActions.push({
                type: "UpdateTask",
                time: action.time,
                taskId: action.taskId,
                taskAction: {
                    type: "UpdateStatus",
                    status: upcastTaskStatusWithSortableAccount(task.rawData.status.value),
                    assigneeStatus: task.rawData.assigneeStatus.value,
                },
            });
            break;
        }
        case "UpdateAssignee": {
            const task = getTask(action.taskId);
            if (!task) return {abort: true};

            undoActions.push({
                type: "UpdateTask",
                time: action.time,
                taskId: action.taskId,
                taskAction: {
                    type: "UpdateAssignee",
                    assignee: task.rawData.assignee.value
                        ? {
                              ...upcastTaskAssigneeWithSortableAccount(task.rawData.assignee.value),
                              // NOTE(calebmer): You may only set `assignerId` to your current account.
                              // Otherwise there's a `PermissionDeniedError` as you're taking an action on
                              // another account's behalf. So if you change the assignee then hit undo you
                              // become the new assigner.
                              //
                              // However, this is an unintuitive user experience. So do we sacrifice security
                              // or usability? Some thoughts on solutions:
                              //
                              // - Maybe we determine the attack vector of an attacker setting an arbitrary
                              //   account as `assignerId` isn't that bad and remove the
                              //   `PermissionDeniedError`. We'd have to thoroughly think through
                              //   all the implications before doing this.
                              //
                              // - We have a lease system (look around for `TaskActionTransactionLeaseId`)
                              //   that will let you commit actions that would have caused a
                              //   `PermissionDeniedError` when you're undoing a change you made recently.
                              //   Right now we only create leases if your change causes you to fully lose
                              //   access. Maybe we should extend the lease system to handle this case? So
                              //   a lease is created when you update the assignee allowing you to put the
                              //   old assigner back with an undo.
                              //
                              // TODO(calebmer): Related, currently if you undo an assignee update it resets
                              // the `AssigneePosition` instead of putting the task back into its old
                              // assignee position. Ideally we'd put the task back into its old assignee
                              // position. We can do this by either:
                              //
                              // - Extending the lease system (as described above) to allow resetting the
                              //   assignee position to its previous value.
                              //
                              // - Keep a map of assignee position by `AccountId` so if the task moves back
                              //   to an old assignee at any point then we'll maintain the task's position.
                              assignerId: currentAccountId,
                          }
                        : null,
                    assigneeStatus: task.rawData.assigneeStatus.value,
                },
            });
            break;
        }
        case "UpdateAssigneeStatus": {
            const task = getTask(action.taskId);
            if (!task) return {abort: true};

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
        case "UpdateAssigneePosition": {
            const task = getTask(action.taskId);
            if (!task) return {abort: true};

            const accountId =
                task.rawData.assigneePosition.value?.accountId ??
                task.rawData.assignee.value?.assignee.accountId;

            // If the task has neither `assigneePosition` or `assignee` then updating the
            // assignee position will fail since you may only update the assignee position
            // if your current user is assigned to a task.
            if (!accountId) return {abort: true};

            undoActions.push({
                type: "UpdateTask",
                time: action.time,
                taskId: action.taskId,
                taskAction: {
                    type: "UpdateAssigneePosition",
                    accountId,
                    position: task.rawData.assigneePosition.value?.position ?? {
                        orderTime: task.rawData.assignee.version,
                        orderKey: initialOrderKey,
                    },
                },
            });
            break;
        }
        case "UpdateTitle": {
            const {titleUpdate} = action.taskAction;

            undoActions.push({
                type: "UpdateTaskWithReconciliation",
                time: action.time,
                taskId: action.taskId,
                taskAction: {
                    type: "UpdateTitle",
                    withoutUndoMerge: action.taskAction.withoutUndoMerge ?? false,
                    getTitleUpdate: getTask => {
                        // The task must still exist in our store to be able to undo title changes!
                        // Since we need the latest title to figure out the right IDs.
                        const task = getTask(action.taskId);
                        if (!task) return emptyTaskTitleUpdateModel.get();

                        return (
                            titleUpdate.invert(task.getTitle()) ?? emptyTaskTitleUpdateModel.get()
                        );
                    },
                },
            });
            break;
        }
        case "UpdateDueDate": {
            const task = getTask(action.taskId);
            if (!task) return {abort: true};

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
            if (!task) return {abort: true};

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
        case "UpdateNotepadPagePosition":
        case "UpdateAssigneeActivePosition": {
            break;
        }
        default:
            throw exhaustive(action.taskAction);
    }
}
