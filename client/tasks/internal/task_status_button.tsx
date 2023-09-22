import {CalendarDate} from "@internationalized/date";
import {compareDesc} from "date-fns";
import {useRef} from "react";
import {useButton} from "react-aria";
import {useAppContext} from "~/client/context/app_context.js";
import {FocusRing} from "~/client/design/focus_ring.js";
import {useClientInfo} from "~/client/remix/client_info_context.js";
import {useSpaceContext} from "~/client/spaces/space_context.js";
import {TaskDisplayStatusCircle} from "~/client/tasks/internal/task_display_status_circle.js";
import {TaskClientStore} from "~/client/tasks/task_client_store.js";
import {AccountModel} from "~/shared/accounts/account_model.js";
import {TimeZone} from "~/shared/helpers/date/time_zone.js";
import {OrderKey} from "~/shared/helpers/sort/order_key.js";
import {defaultCompareStrings} from "~/shared/helpers/string/default_compare_strings.js";
import {AccountId} from "~/shared/id/types/id_types.js";
import {sprinkles} from "~/shared/styles/styles.js";
import {TaskModel} from "~/shared/tasks/model/task_model.js";
import {TaskFilterableTime} from "~/shared/tasks/task_filterable_time.js";
import {TaskSortableAccount} from "~/shared/tasks/task_sortable_account.js";

export type TaskStatus =
    | {readonly type: "Open"}
    | {
          readonly type: "Closed";
          readonly closerId: AccountId;
          readonly closedTime: Date;
          readonly closerTimeZone: TimeZone;
          readonly closedDate: CalendarDate;
      };

export type TaskAssigneeStatus = TaskAssigneeInactiveStatus | TaskAssigneeActiveStatus;

export type TaskAssigneeInactiveStatus = {
    readonly type: "Inactive";
};

export type TaskAssigneeActiveStatus = {
    readonly type: "Active";
    readonly orderTime: Date;
    readonly orderKey: OrderKey;
    readonly activatorId: AccountId;
    readonly activatedTime: Date;
    readonly activatorTimeZone: TimeZone;
    readonly activatedDate: CalendarDate;
};

export type TaskAssignee = {
    readonly account: AccountModel;
    readonly assignerId: AccountId;
    readonly assignedTime: Date;
    readonly assignerTimeZone: TimeZone;
    readonly assignedDate: CalendarDate;
    readonly status: TaskAssigneeStatus;
};

export function compareTaskAssigneeActiveStatus(
    status1: TaskAssigneeActiveStatus,
    status2: TaskAssigneeActiveStatus,
): number {
    return (
        compareDesc(status1.orderTime, status2.orderTime) ||
        defaultCompareStrings(status1.orderKey, status2.orderKey)
    );
}

export function TaskStatusButton({
    store,
    task,
    size = "4",
    isDisabled = false,
    isFocusable = true,
}: {
    store: TaskClientStore;
    task: TaskModel;
    size?: "4" | "5";
    isDisabled?: boolean;
    isFocusable?: boolean;
}) {
    const context = useAppContext();
    const {timeZone} = useClientInfo();
    const {currentAccount} = useSpaceContext();
    const buttonRef = useRef<HTMLElement | null>(null);

    const {isPressed, buttonProps} = useButton(
        {
            elementType: isFocusable ? "button" : "div",
            isDisabled,
            onPress: () => {
                const time = store.clock.now();
                const status = task.getStatus();

                if (status.type === "Closed") {
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
                } else {
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
                }
            },
        },
        buttonRef,
    );

    return (
        <FocusRing>
            {isFocusable ? (
                <button
                    {...buttonProps}
                    ref={element => (buttonRef.current = element)}
                    className={sprinkles({
                        display: "block",
                        width: size,
                        height: size,
                        borderRadius: "full",
                    })}
                >
                    <TaskDisplayStatusCircle
                        displayStatus={task.getDisplayStatus()}
                        size={size}
                        isPressed={isPressed}
                    />
                </button>
            ) : (
                <div
                    {...buttonProps}
                    ref={element => (buttonRef.current = element)}
                    // Remove `tabIndex` from button props if this button is not focusable.
                    tabIndex={undefined}
                    className={sprinkles({
                        display: "block",
                        width: size,
                        height: size,
                        borderRadius: "full",
                    })}
                >
                    <TaskDisplayStatusCircle
                        displayStatus={task.getDisplayStatus()}
                        size={size}
                        isPressed={isPressed}
                    />
                </div>
            )}
        </FocusRing>
    );
}
