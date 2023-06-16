import {parseAbsolute, toCalendarDate} from "@internationalized/date";
import {MenuAction} from "~/client/design/menu_button";
import {TaskStatusCircle} from "~/client/tasks/demo_2/internal/task_status_circle";
import {TaskAssignee, TaskStatus} from "~/client/tasks/demo_2/task_status_button";
import {AccountModel} from "~/shared/accounts/account_model";
import {TimeZone} from "~/shared/helpers/date/time_zone";
import {initialOrderKey} from "~/shared/helpers/sort/order_key";

export function getTaskStatusMenuActions({
    timeZone,
    currentAccount,
    status,
    onStatusChange,
    assignee,
    onAssigneeChange,
}: {
    timeZone: TimeZone;
    currentAccount: AccountModel;
    status: TaskStatus;
    onStatusChange: (status: TaskStatus) => void;
    assignee: TaskAssignee | null;
    onAssigneeChange: (assignee: TaskAssignee | null) => void;
}): ReadonlyArray<MenuAction> {
    if (status.type === "Closed") {
        return [
            {
                label: "Mark open",
                icon: <TaskStatusCircle status="OpenInactive" size="3" />,
                iconPlacement: "end",
                onPress: () => {
                    onStatusChange({type: "Open"});
                },
            },
            {
                label: "Mark active",
                icon: <TaskStatusCircle status="OpenActive" size="3" />,
                iconPlacement: "end",
                onPress: () => {
                    const assignedTime = new Date();
                    const assignedDate = toCalendarDate(
                        parseAbsolute(assignedTime.toISOString(), timeZone),
                    );

                    onStatusChange({type: "Open"});

                    onAssigneeChange({
                        account: currentAccount,
                        assignerId: currentAccount.id,
                        assignedTime,
                        assignerTimeZone: timeZone,
                        assignedDate,
                        ...assignee,
                        status: {
                            type: "Active",
                            orderTime: new Date(),
                            orderKey: initialOrderKey,
                            activatorId: currentAccount.id,
                            activatedTime: assignedTime,
                            activatorTimeZone: timeZone,
                            activatedDate: assignedDate,
                        },
                    });
                },
            },
        ];
    } else {
        if (assignee?.status.type === "Active") {
            return [
                {
                    label: "Mark inactive",
                    icon: <TaskStatusCircle status="OpenInactive" size="3" />,
                    iconPlacement: "end",
                    onPress: () => {
                        onAssigneeChange({
                            ...assignee,
                            status: {type: "Inactive"},
                        });
                    },
                },
                {
                    label: "Mark closed",
                    icon: <TaskStatusCircle status="Closed" size="3" />,
                    iconPlacement: "end",
                    onPress: () => {
                        const closedTime = new Date();
                        const closedDate = toCalendarDate(
                            parseAbsolute(closedTime.toISOString(), timeZone),
                        );

                        onStatusChange({
                            type: "Closed",
                            closerId: currentAccount.id,
                            closedTime,
                            closerTimeZone: timeZone,
                            closedDate,
                        });
                    },
                },
            ];
        } else {
            return [
                {
                    label: "Mark active",
                    icon: <TaskStatusCircle status="OpenActive" size="3" />,
                    iconPlacement: "end",
                    onPress: () => {
                        const assignedTime = new Date();
                        const assignedDate = toCalendarDate(
                            parseAbsolute(assignedTime.toISOString(), timeZone),
                        );

                        onAssigneeChange({
                            account: currentAccount,
                            assignerId: currentAccount.id,
                            assignedTime,
                            assignerTimeZone: timeZone,
                            assignedDate,
                            ...assignee,
                            status: {
                                type: "Active",
                                orderTime: new Date(),
                                orderKey: initialOrderKey,
                                activatorId: currentAccount.id,
                                activatedTime: assignedTime,
                                activatorTimeZone: timeZone,
                                activatedDate: assignedDate,
                            },
                        });
                    },
                },
                {
                    label: "Mark closed",
                    icon: <TaskStatusCircle status="Closed" size="3" />,
                    iconPlacement: "end",
                    onPress: () => {
                        const closedTime = new Date();
                        const closedDate = toCalendarDate(
                            parseAbsolute(closedTime.toISOString(), timeZone),
                        );

                        onStatusChange({
                            type: "Closed",
                            closerId: currentAccount.id,
                            closedTime,
                            closerTimeZone: timeZone,
                            closedDate,
                        });
                    },
                },
            ];
        }
    }
}
