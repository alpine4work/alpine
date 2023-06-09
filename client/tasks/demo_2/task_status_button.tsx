import {compareDesc} from "date-fns";
import {useRef} from "react";
import {useButton} from "react-aria";
import {FocusRing} from "~/client/design/focus_ring";
import {TaskStatusCircle} from "~/client/tasks/demo_2/internal/task_status_circle";
import {AccountModel} from "~/shared/accounts/account_model";
import {OrderKey} from "~/shared/helpers/sort/order_key";
import {defaultCompareStrings} from "~/shared/helpers/string/default_compare_strings";
import {sprinkles} from "~/shared/styles/styles";

export type TaskStatus = "Open" | "Closed";

export type TaskAssigneeStatus = TaskAssigneeInactiveStatus | TaskAssigneeActiveStatus;

export type TaskAssigneeInactiveStatus = {
    readonly type: "Inactive";
};

export type TaskAssigneeActiveStatus = {
    readonly type: "Active";
    readonly orderTime: Date;
    readonly orderKey: OrderKey;
};

export type TaskAssignee = {
    readonly account: AccountModel;
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
    const buttonRef = useRef<HTMLButtonElement>(null);

    const {isPressed, buttonProps} = useButton(
        {
            isDisabled,
            onPress: () => {
                onStatusChange(status === "Open" ? "Closed" : "Open");
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
                    width: size,
                    height: size,
                    borderRadius: "full",
                })}
            >
                <TaskStatusCircle
                    status={
                        status === "Open" && assignee?.status.type === "Active" ? "Active" : status
                    }
                    size={size}
                    isPressed={isPressed}
                />
            </button>
        </FocusRing>
    );
}
