import {AppContext} from "~/client/context/app_context.js";
import {MenuAction} from "~/client/design/menu_button.js";
import {TaskDisplayStatusCircle} from "~/client/tasks/internal/task_display_status_circle.js";
import {TaskClientStore} from "~/client/tasks/task_client_store.js";
import {AccountModel} from "~/shared/accounts/account_model.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {TimeZone} from "~/shared/helpers/date/time_zone.js";
import {TaskModel} from "~/shared/tasks/model/task_model.js";
import {TaskFilterableTime} from "~/shared/tasks/task_filterable_time.js";
import {TaskSortableAccount} from "~/shared/tasks/task_sortable_account.js";

export function getTaskStatusMenuActions({
    context,
    timeZone,
    currentAccount,
    store,
    task,
}: {
    context: AppContext;
    timeZone: TimeZone;
    currentAccount: AccountModel;
    store: TaskClientStore;
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
                        store.commitTaskActionTransaction(context, [
                            {
                                type: "UpdateTask",
                                time: time1,
                                taskId: task.id,
                                taskAction: {
                                    type: "UpdateAssignee",
                                    assignee: currentAssignee ?? {
                                        assignee: TaskSortableAccount.from(
                                            store.accountStore,
                                            currentAccount,
                                        ),
                                        assigner: TaskSortableAccount.from(
                                            store.accountStore,
                                            currentAccount,
                                        ),
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
                        ]);
                    },
                },
                {
                    label: "Mark closed",
                    icon: <TaskDisplayStatusCircle displayStatus="Closed" size="3" />,
                    iconPlacement: "end",
                    onPress: () => {
                        const time = store.clock.now();

                        store.commitTaskActionTransaction(context, [
                            {
                                type: "UpdateTask",
                                time,
                                taskId: task.id,
                                taskAction: {
                                    type: "UpdateStatus",
                                    status: {
                                        type: "Closed",
                                        closer: TaskSortableAccount.from(
                                            store.accountStore,
                                            currentAccount,
                                        ),
                                        closedTime: new TaskFilterableTime({
                                            absoluteTime: time,
                                            setterTimeZone: timeZone,
                                        }),
                                    },
                                },
                            },
                        ]);
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

                        store.commitTaskActionTransaction(context, [
                            {
                                type: "UpdateTask",
                                time,
                                taskId: task.id,
                                taskAction: {
                                    type: "UpdateStatus",
                                    status: {type: "Open"},
                                },
                            },
                        ]);
                    },
                },
                {
                    label: "Mark closed",
                    icon: <TaskDisplayStatusCircle displayStatus="Closed" size="3" />,
                    iconPlacement: "end",
                    onPress: () => {
                        const time = store.clock.now();

                        store.commitTaskActionTransaction(context, [
                            {
                                type: "UpdateTask",
                                time,
                                taskId: task.id,
                                taskAction: {
                                    type: "UpdateStatus",
                                    status: {
                                        type: "Closed",
                                        closer: TaskSortableAccount.from(
                                            store.accountStore,
                                            currentAccount,
                                        ),
                                        closedTime: new TaskFilterableTime({
                                            absoluteTime: time,
                                            setterTimeZone: timeZone,
                                        }),
                                    },
                                },
                            },
                        ]);
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

                        store.commitTaskActionTransaction(context, [
                            {
                                type: "UpdateTask",
                                time,
                                taskId: task.id,
                                taskAction: {
                                    type: "UpdateStatus",
                                    status: {type: "Open"},
                                },
                            },
                        ]);
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
                        store.commitTaskActionTransaction(context, [
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
                                    assignee: currentAssignee ?? {
                                        assignee: TaskSortableAccount.from(
                                            store.accountStore,
                                            currentAccount,
                                        ),
                                        assigner: TaskSortableAccount.from(
                                            store.accountStore,
                                            currentAccount,
                                        ),
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
                        ]);
                    },
                },
            ];
        }
        default:
            throw exhaustive(displayStatus);
    }
}
