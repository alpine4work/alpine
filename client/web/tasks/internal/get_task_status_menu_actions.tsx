import {MenuAction} from "~/client/web/design/menu.js";
import {TaskDisplayStatusCircle} from "~/client/web/design/task_display_status_circle.js";
import {NativeMobileBridge} from "~/client/web/remix/native_mobile_bridge.js";
import {TaskClientReadonlyStore} from "~/client/web/tasks/core/task_client_store.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {TimeZone} from "~/shared/helpers/intl/time_zone.js";
import {AccountId, TaskId} from "~/shared/id/types/id_types.js";
import {AccountModel} from "~/shared/spaces/account_model.js";
import {TaskActionModel} from "~/shared/tasks/actions/task_action_model.js";
import {TaskModel} from "~/shared/tasks/model/task_model.js";
import {TaskDisplayStatus} from "~/shared/tasks/task_display_status.js";
import {TaskFilterableTime} from "~/shared/tasks/task_filterable_time.js";

export function getTaskStatusMenuActions({
    timeZone,
    currentAccount,
    store,
    task,
    onCloseConfirmationDialogueOpen,
    commitActionTransaction,
}: {
    timeZone: TimeZone;
    currentAccount: AccountModel | null;
    store: TaskClientReadonlyStore;
    task: TaskModel;
    onCloseConfirmationDialogueOpen: (options: {onConfirm: () => void}) => void;
    commitActionTransaction: (
        getActions: (taskId: TaskId) => ReadonlyArray<TaskActionModel>,
    ) => void;
}): ReadonlyArray<MenuAction> {
    return getTaskStatusMenuActionsWithoutFullTask({
        timeZone,
        currentAccount,
        store,
        displayStatus: task.getDisplayStatus(),
        getAssigneeAccountIdSnapshot: () => task.getAssignee()?.assignee.accountId ?? null,
        getOpenChildCountSnapshot: () => task.getOpenChildTaskCount(),
        onCloseConfirmationDialogueOpen,
        commitActionTransaction,
    });
}

export function getTaskStatusMenuActionsWithoutFullTask({
    timeZone,
    currentAccount,
    store,
    displayStatus,
    getAssigneeAccountIdSnapshot,
    getOpenChildCountSnapshot,
    onCloseConfirmationDialogueOpen,
    commitActionTransaction,
}: {
    timeZone: TimeZone;
    currentAccount: AccountModel | null;
    store: TaskClientReadonlyStore;
    displayStatus: TaskDisplayStatus;
    getAssigneeAccountIdSnapshot: () => AccountId | null;
    getOpenChildCountSnapshot: () => number;
    onCloseConfirmationDialogueOpen: (options: {onConfirm: () => void}) => void;
    commitActionTransaction: (
        getActions: (taskId: TaskId) => ReadonlyArray<TaskActionModel>,
    ) => void;
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
                        // Currently, accounts without space access can't edit tasks. The max permission
                        // level of `urlGrant` is `View`.
                        assert(currentAccount);

                        const currentAssigneeAccountId = getAssigneeAccountIdSnapshot();

                        // If we are marking a task as active and there's not currently an assignee, then
                        // set ourselves as the assignee.
                        commitActionTransaction(taskId => {
                            const time1 = store.clock.now();
                            const time2 = store.clock.now();

                            const actions: Array<TaskActionModel> = [];

                            if (currentAssigneeAccountId === null) {
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

                            return actions;
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
                        // Currently, accounts without space access can't edit tasks. The max permission
                        // level of `urlGrant` is `View`.
                        assert(currentAccount);

                        const runCommitTaskActionTransaction = () => {
                            commitActionTransaction(taskId => {
                                const time = store.clock.now();

                                return [
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
                                ];
                            });
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
                        commitActionTransaction(taskId => [
                            {
                                type: "UpdateTask",
                                time: store.clock.now(),
                                taskId,
                                taskAction: {
                                    type: "UpdateStatus",
                                    status: {type: "Open"},
                                },
                            },
                        ]);

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
                        // Currently, accounts without space access can't edit tasks. The max permission
                        // level of `urlGrant` is `View`.
                        assert(currentAccount);

                        const runCommitTaskActionTransaction = () => {
                            commitActionTransaction(taskId => {
                                const time = store.clock.now();

                                return [
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
                                ];
                            });
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
                    icon: ({size}) => (
                        <TaskDisplayStatusCircle displayStatus="OpenInactive" size={size} />
                    ),
                    iconPlacement: "end",
                    onPress: () => {
                        commitActionTransaction(taskId => [
                            {
                                type: "UpdateTask",
                                time: store.clock.now(),
                                taskId,
                                taskAction: {
                                    type: "UpdateStatus",
                                    status: {type: "Open"},
                                },
                            },
                        ]);

                        // Reward the user with haptic feedback when they change task's status.
                        NativeMobileBridge?.haptic.playLightImpact();
                    },
                },
                {
                    label: "Mark active",
                    icon: ({size}) => (
                        <TaskDisplayStatusCircle displayStatus="OpenActive" size={size} />
                    ),
                    iconPlacement: "end",
                    onPress: () => {
                        // Currently, accounts without space access can't edit tasks. The max permission
                        // level of `urlGrant` is `View`.
                        assert(currentAccount);

                        const currentAssigneeAccountId = getAssigneeAccountIdSnapshot();

                        // If we are marking a task as active and there's not currently an assignee, then
                        // set ourselves as the assignee.
                        commitActionTransaction(taskId => {
                            const time1 = store.clock.now();
                            const time2 = store.clock.now();

                            const actions: Array<TaskActionModel> = [];

                            actions.push({
                                type: "UpdateTask",
                                time: time1,
                                taskId,
                                taskAction: {
                                    type: "UpdateStatus",
                                    status: {type: "Open"},
                                },
                            });

                            if (currentAssigneeAccountId === null) {
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

                            return actions;
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
