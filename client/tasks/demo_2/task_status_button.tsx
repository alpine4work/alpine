import {CalendarDate, parseAbsolute, toCalendarDate} from "@internationalized/date";
import {compareDesc} from "date-fns";
import {useRef} from "react";
import {useButton} from "react-aria";
import {FocusRing} from "~/client/design/focus_ring.js";
import {useClientInfo} from "~/client/remix/client_info_context.js";
import {useSpaceContext} from "~/client/spaces/space_context.js";
import {TaskStatusCircle} from "~/client/tasks/demo_2/internal/task_status_circle.js";
import {AccountModel} from "~/shared/accounts/account_model.js";
import {TimeZone} from "~/shared/helpers/date/time_zone.js";
import {OrderKey} from "~/shared/helpers/sort/order_key.js";
import {defaultCompareStrings} from "~/shared/helpers/string/default_compare_strings.js";
import {AccountId} from "~/shared/id/types/id_types.js";
import {sprinkles} from "~/shared/styles/styles.js";

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
    status,
    onStatusChange,
    assignee,
    size = "4",
    isDisabled,
}: {
    status: TaskStatus;
    onStatusChange: (status: TaskStatus) => void;
    assignee: TaskAssignee | null;
    size?: "4" | "5";
    isDisabled?: boolean;
}) {
    const {timeZone} = useClientInfo();
    const {currentAccount} = useSpaceContext();
    const buttonRef = useRef<HTMLButtonElement>(null);

    const {isPressed, buttonProps} = useButton(
        {
            isDisabled,
            onPress: () => {
                const closedTime = new Date();
                const closedDate = toCalendarDate(
                    parseAbsolute(closedTime.toISOString(), timeZone),
                );

                onStatusChange(
                    status.type === "Open"
                        ? {
                              type: "Closed",
                              closerId: currentAccount.id,
                              closedTime,
                              closerTimeZone: timeZone,
                              closedDate,
                          }
                        : {type: "Open"},
                );
            },
        },
        buttonRef,
    );

    return (
        <FocusRing>
            <button
                {...buttonProps}
                ref={buttonRef}
                className={sprinkles({
                    display: "block",
                    width: size,
                    height: size,
                    borderRadius: "full",
                })}
            >
                <TaskStatusCircle
                    status={
                        status.type === "Open"
                            ? assignee?.status.type === "Active"
                                ? "OpenActive"
                                : "OpenInactive"
                            : "Closed"
                    }
                    size={size}
                    isPressed={isPressed}
                />
            </button>
        </FocusRing>
    );
}
