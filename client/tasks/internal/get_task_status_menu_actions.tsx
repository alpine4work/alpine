import {AppContext} from "~/client/context/app_context.js";
import {MenuAction} from "~/client/design/menu_button.js";
import {TaskDisplayStatusCircle} from "~/client/tasks/internal/task_display_status_circle.js";
import {TaskClientStore, TaskClientUndoManager} from "~/client/tasks/task_client_store.js";
import {AccountModel} from "~/shared/accounts/account_model.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {TimeZone} from "~/shared/helpers/date/time_zone.js";
import {TaskModel} from "~/shared/tasks/model/task_model.js";
import {TaskFilterableTime} from "~/shared/tasks/task_filterable_time.js";

export function getTaskStatusMenuActions({
    context,
    timeZone,
    currentAccount,
    store,
    undoManager,
    task,
}: {
    context: AppContext;
    timeZone: TimeZone;
    currentAccount: AccountModel;
    store: TaskClientStore;
    undoManager: TaskClientUndoManager | null;
    task: TaskModel;
}): ReadonlyArray<MenuAction> {
    const displayStatus = task.getDisplayStatus();

    switch (displayStatus) {
        case "OpenInactive": {
            return [
                {
                    label: "Mark active",
                    icon: <TaskDisplayStatusCircle displayStatus="OpenActive" size="3" />,
                    iconPlacement: "end",
                    onPress: () => {
                        const time1 = store.clock.now();
                        const time2 = store.clock.now();
                        const currentAssignee = task.getAssignee();

                        // If we are marking a task as active and there's not currently an assignee,
                        // then set ourselves as the assignee.
                        store.commitTaskActionTransaction(
                            context,
                            [
                                {
                                    type: "UpdateTask",
                                    time: time1,
                                    taskId: task.id,
                                    taskAction: {
                                        type: "UpdateAssignee",
                                        assignee: currentAssignee
                                            ? {
                                                  assigneeId: currentAssignee.assignee.accountId,
                                                  assignerId: currentAssignee.assigner.accountId,
                                                  assignedTime: currentAssignee.assignedTime,
                                              }
                                            : {
                                                  assigneeId: currentAccount.id,
                                                  assignerId: currentAccount.id,
                                                  assignedTime: new TaskFilterableTime({
                                                      absoluteTime: time1,
                                                      setterTimeZone: timeZone,
                                                  }),
                                              },
                                    },
                                },
                                {
                                    type: "UpdateTask",
                                    time: time2,
                                    taskId: task.id,
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
                                },
                            ],
                            {undoManager},
                        );
                    },
                },
                {
                    label: "Mark closed",
                    icon: <TaskDisplayStatusCircle displayStatus="Closed" size="3" />,
                    iconPlacement: "end",
                    onPress: () => {
                        const time = store.clock.now();

                        store.commitTaskActionTransaction(
                            context,
                            [
                                {
                                    type: "UpdateTask",
                                    time,
                                    taskId: task.id,
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
                            {undoManager},
                        );
                    },
                },
            ];
        }
        case "OpenActive": {
            return [
                {
                    label: "Mark inactive",
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
                                    taskId: task.id,
                                    taskAction: {
                                        type: "UpdateStatus",
                                        status: {type: "Open"},
                                    },
                                },
                            ],
                            {undoManager},
                        );
                    },
                },
                {
                    label: "Mark closed",
                    icon: <TaskDisplayStatusCircle displayStatus="Closed" size="3" />,
                    iconPlacement: "end",
                    onPress: () => {
                        const time = store.clock.now();

                        store.commitTaskActionTransaction(
                            context,
                            [
                                {
                                    type: "UpdateTask",
                                    time,
                                    taskId: task.id,
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
                            {undoManager},
                        );
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
                                    taskId: task.id,
                                    taskAction: {
                                        type: "UpdateStatus",
                                        status: {type: "Open"},
                                    },
                                },
                            ],
                            {undoManager},
                        );
                    },
                },
                {
                    label: "Mark active",
                    icon: <TaskDisplayStatusCircle displayStatus="OpenActive" size="3" />,
                    iconPlacement: "end",
                    onPress: () => {
                        const time1 = store.clock.now();
                        const time2 = store.clock.now();
                        const currentAssignee = task.getAssignee();

                        // If we are marking a task as active and there's not currently an assignee,
                        // then set ourselves as the assignee.
                        store.commitTaskActionTransaction(
                            context,
                            [
                                {
                                    type: "UpdateTask",
                                    time: time1,
                                    taskId: task.id,
                                    taskAction: {
                                        type: "UpdateStatus",
                                        status: {type: "Open"},
                                    },
                                },
                                {
                                    type: "UpdateTask",
                                    time: time1,
                                    taskId: task.id,
                                    taskAction: {
                                        type: "UpdateAssignee",
                                        assignee: currentAssignee
                                            ? {
                                                  assigneeId: currentAssignee.assignee.accountId,
                                                  assignerId: currentAssignee.assigner.accountId,
                                                  assignedTime: currentAssignee.assignedTime,
                                              }
                                            : {
                                                  assigneeId: currentAccount.id,
                                                  assignerId: currentAccount.id,
                                                  assignedTime: new TaskFilterableTime({
                                                      absoluteTime: time1,
                                                      setterTimeZone: timeZone,
                                                  }),
                                              },
                                    },
                                },
                                {
                                    type: "UpdateTask",
                                    time: time2,
                                    taskId: task.id,
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
                                },
                            ],
                            {undoManager},
                        );
                    },
                },
            ];
        }
        default:
            throw exhaustive(displayStatus);
    }
}
