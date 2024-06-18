import {AppContext} from "~/client/context/app_context.js";
import {MenuAction} from "~/client/design/menu.js";
import {NativeMobileBridge} from "~/client/remix/native_mobile_bridge.js";
import {TaskDisplayStatusCircle} from "~/client/tasks/internal/task_display_status_circle.js";
import {
    TaskClientStore,
    TaskClientStoreSearchAffinityManager,
    TaskClientStoreUndoManager,
} from "~/client/tasks/task_client_store.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {TimeZone} from "~/shared/helpers/date/time_zone.js";
import {TaskId} from "~/shared/id/types/id_types.js";
import {AccountModel} from "~/shared/spaces/account_model.js";
import {TaskAction} from "~/shared/tasks/actions/task_action.js";
import {TaskModel} from "~/shared/tasks/model/task_model.js";
import {TaskAssigneeWithSortableAccount} from "~/shared/tasks/task_assignee.js";
import {TaskDisplayStatus} from "~/shared/tasks/task_display_status.js";
import {TaskFilterableTime} from "~/shared/tasks/task_filterable_time.js";

export function getTaskStatusMenuActions({
    context,
    timeZone,
    currentAccount,
    store,
    undoManager,
    affinityManager,
    task,
    onCloseConfirmationDialogueOpen,
}: {
    context: AppContext;
    timeZone: TimeZone;
    currentAccount: AccountModel;
    store: TaskClientStore;
    undoManager: TaskClientStoreUndoManager | null;
    affinityManager: TaskClientStoreSearchAffinityManager;
    task: TaskModel;
    onCloseConfirmationDialogueOpen: (options: {onConfirm: () => void}) => void;
}): ReadonlyArray<MenuAction> {
    return getTaskStatusMenuActionsWithoutFullTask({
        context,
        timeZone,
        currentAccount,
        store,
        undoManager,
        affinityManager,
        taskId: task.id,
        displayStatus: task.getDisplayStatus(),
        getAssigneeSnapshot: () => task.getAssignee(),
        getOpenChildCountSnapshot: () => task.getOpenChildTaskCount(),
        onCloseConfirmationDialogueOpen,
    });
}

export function getTaskStatusMenuActionsWithoutFullTask({
    context,
    timeZone,
    currentAccount,
    store,
    undoManager,
    affinityManager,
    taskId,
    displayStatus,
    getAssigneeSnapshot,
    getOpenChildCountSnapshot,
    onCloseConfirmationDialogueOpen,
}: {
    context: AppContext;
    timeZone: TimeZone;
    currentAccount: AccountModel;
    store: TaskClientStore;
    undoManager: TaskClientStoreUndoManager | null;
    affinityManager: TaskClientStoreSearchAffinityManager;
    taskId: TaskId;
    displayStatus: TaskDisplayStatus;
    getAssigneeSnapshot: () => TaskAssigneeWithSortableAccount | null;
    getOpenChildCountSnapshot: () => number;
    onCloseConfirmationDialogueOpen: (options: {onConfirm: () => void}) => void;
}): ReadonlyArray<MenuAction> {
    switch (displayStatus) {
        case "OpenInactive": {
            return [
                {
                    label: "Mark active",
                    icon: ({size}) => (
                        <TaskDisplayStatusCircle displayStatus="OpenActive" size={size} />
                    ),
                    iconPlacement: "end",
                    onPress: () => {
                        const time1 = store.clock.now();
                        const time2 = store.clock.now();
                        const currentAssignee = getAssigneeSnapshot();

                        const actions: Array<TaskAction> = [];

                        if (!currentAssignee) {
                            actions.push({
                                type: "UpdateTask",
                                time: time1,
                                taskId,
                                taskAction: {
                                    type: "UpdateAssignee",
                                    assignee: {
                                        assigneeId: currentAccount.id,
                                        assignerId: currentAccount.id,
                                        assignedTime: new TaskFilterableTime({
                                            absoluteTime: time1,
                                            setterTimeZone: timeZone,
                                        }),
                                    },
                                },
                            });
                        }

                        actions.push({
                            type: "UpdateTask",
                            time: time2,
                            taskId,
                            taskAction: {
                                type: "UpdateAssigneeStatus",
                                assigneeStatus: {
                                    type: "Active",
                                    activatedTime: new TaskFilterableTime({
                                        absoluteTime: time1,
                                        setterTimeZone: timeZone,
                                    }),
                                },
                            },
                        });

                        // If we are marking a task as active and there's not currently an assignee,
                        // then set ourselves as the assignee.
                        store.commitTaskActionTransaction(context, actions, {
                            undoManager,
                            affinityManager,
                        });

                        // Reward the user with haptic feedback when they change task's status.
                        NativeMobileBridge?.haptic.playLightImpact();
                    },
                },
                {
                    label: "Mark closed",
                    icon: ({size}) => (
                        <TaskDisplayStatusCircle displayStatus="Closed" size={size} />
                    ),
                    iconPlacement: "end",
                    onPress: () => {
                        const time = store.clock.now();

                        const runCommitTaskActionTransaction = () => {
                            store.commitTaskActionTransaction(
                                context,
                                [
                                    {
                                        type: "UpdateTask",
                                        time,
                                        taskId,
                                        taskAction: {
                                            type: "UpdateStatus",
                                            status: {
                                                type: "Closed",
                                                closerId: currentAccount.id,
                                                closedTime: new TaskFilterableTime({
                                                    absoluteTime: time,
                                                    setterTimeZone: timeZone,
                                                }),
                                            },
                                        },
                                    },
                                ],
                                {undoManager, affinityManager},
                            );
                        };

                        // Checks if there are any open subtasks
                        if (getOpenChildCountSnapshot() !== 0) {
                            // If there are open subtasks, then open warning dialogue
                            onCloseConfirmationDialogueOpen({
                                onConfirm: runCommitTaskActionTransaction,
                            });
                        } else {
                            // If there are no open subtasks, then just close the task
                            runCommitTaskActionTransaction();
                        }

                        // Reward the user with haptic feedback when they change task's status.
                        NativeMobileBridge?.haptic.playLightImpact();
                    },
                },
            ];
        }
        case "OpenActive": {
            return [
                {
                    label: "Mark inactive",
                    icon: ({size}) => (
                        <TaskDisplayStatusCircle displayStatus="OpenInactive" size={size} />
                    ),
                    iconPlacement: "end",
                    onPress: () => {
                        const time = store.clock.now();

                        store.commitTaskActionTransaction(
                            context,
                            [
                                {
                                    type: "UpdateTask",
                                    time,
                                    taskId,
                                    taskAction: {
                                        type: "UpdateStatus",
                                        status: {type: "Open"},
                                    },
                                },
                            ],
                            {undoManager, affinityManager},
                        );

                        // Reward the user with haptic feedback when they change task's status.
                        NativeMobileBridge?.haptic.playLightImpact();
                    },
                },
                {
                    label: "Mark closed",
                    icon: ({size}) => (
                        <TaskDisplayStatusCircle displayStatus="Closed" size={size} />
                    ),
                    iconPlacement: "end",
                    onPress: () => {
                        const time = store.clock.now();

                        const runCommitTaskActionTransaction = () => {
                            store.commitTaskActionTransaction(
                                context,
                                [
                                    {
                                        type: "UpdateTask",
                                        time,
                                        taskId,
                                        taskAction: {
                                            type: "UpdateStatus",
                                            status: {
                                                type: "Closed",
                                                closerId: currentAccount.id,
                                                closedTime: new TaskFilterableTime({
                                                    absoluteTime: time,
                                                    setterTimeZone: timeZone,
                                                }),
                                            },
                                        },
                                    },
                                ],
                                {undoManager, affinityManager},
                            );
                        };

                        // Checks if there are any open subtasks
                        if (getOpenChildCountSnapshot() !== 0) {
                            // If there are open subtasks, then open warning dialogue
                            onCloseConfirmationDialogueOpen({
                                onConfirm: runCommitTaskActionTransaction,
                            });
                        } else {
                            // If there are no open subtasks, then just close the task
                            runCommitTaskActionTransaction();
                        }

                        // Reward the user with haptic feedback when they change task's status.
                        NativeMobileBridge?.haptic.playLightImpact();
                    },
                },
            ];
        }
        case "Closed": {
            return [
                {
                    label: "Mark open",
                    icon: <TaskDisplayStatusCircle displayStatus="OpenInactive" size="3" />,
                    iconPlacement: "end",
                    onPress: () => {
                        const time = store.clock.now();

                        store.commitTaskActionTransaction(
                            context,
                            [
                                {
                                    type: "UpdateTask",
                                    time,
                                    taskId,
                                    taskAction: {
                                        type: "UpdateStatus",
                                        status: {type: "Open"},
                                    },
                                },
                            ],
                            {undoManager, affinityManager},
                        );

                        // Reward the user with haptic feedback when they change task's status.
                        NativeMobileBridge?.haptic.playLightImpact();
                    },
                },
                {
                    label: "Mark active",
                    icon: <TaskDisplayStatusCircle displayStatus="OpenActive" size="3" />,
                    iconPlacement: "end",
                    onPress: () => {
                        const time1 = store.clock.now();
                        const time2 = store.clock.now();
                        const currentAssignee = getAssigneeSnapshot();

                        const actions: Array<TaskAction> = [];

                        actions.push({
                            type: "UpdateTask",
                            time: time1,
                            taskId,
                            taskAction: {
                                type: "UpdateStatus",
                                status: {type: "Open"},
                            },
                        });

                        if (!currentAssignee) {
                            actions.push({
                                type: "UpdateTask",
                                time: time1,
                                taskId,
                                taskAction: {
                                    type: "UpdateAssignee",
                                    assignee: {
                                        assigneeId: currentAccount.id,
                                        assignerId: currentAccount.id,
                                        assignedTime: new TaskFilterableTime({
                                            absoluteTime: time1,
                                            setterTimeZone: timeZone,
                                        }),
                                    },
                                },
                            });
                        }

                        actions.push({
                            type: "UpdateTask",
                            time: time2,
                            taskId,
                            taskAction: {
                                type: "UpdateAssigneeStatus",
                                assigneeStatus: {
                                    type: "Active",
                                    activatedTime: new TaskFilterableTime({
                                        absoluteTime: time1,
                                        setterTimeZone: timeZone,
                                    }),
                                },
                            },
                        });

                        // If we are marking a task as active and there's not currently an assignee,
                        // then set ourselves as the assignee.
                        store.commitTaskActionTransaction(context, actions, {
                            undoManager,
                            affinityManager,
                        });

                        // Reward the user with haptic feedback when they change task's status.
                        NativeMobileBridge?.haptic.playLightImpact();
                    },
                },
            ];
        }
        default:
            throw exhaustive(displayStatus);
    }
}
