import {compareDesc} from "date-fns";
import {Check} from "phosphor-react";
import {useRef} from "react";
import {useButton} from "react-aria";
import {Box} from "~/client/design/box";
import {buttonPressedOverlayOpacity} from "~/client/design/button";
import {FocusRing} from "~/client/design/focus_ring";
import {AccountModel} from "~/shared/accounts/account_model";
import {addRemLengths, parseRemLengthNumber, spacing} from "~/shared/design/spacing";
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
                    position: "relative",
                    zIndex: "0",
                    width: size,
                    height: size,
                    borderRadius: "full",
                    display: "flex",
                    justifyContent: "center",
                    alignItems: "center",
                    overflow: "hidden",
                    border: status === "Open" ? "grey-40" : undefined,
                    backgroundColor:
                        status === "Closed" ? "theme-50-const" : isPressed ? "grey-10" : "grey-0",
                    color: status === "Open" ? "grey-text" : "grey-0-const",
                })}
            >
                {isPressed && status === "Closed" && (
                    // For accent buttons, instead of choosing a darker background color shade when
                    // pressed we add a black overlay at a lowered opacity. We accomplish this with
                    // an overlay element since such a color is not in our color scheme.
                    //
                    // Darker shades in our color scheme are more saturated. We want the effect of a
                    // button being physically pressed down.
                    //
                    // When we added this there was a happy accident. The text color also got
                    // darker! This is more fitting for the physical analogy of a button being
                    // pressed down.
                    <Box
                        position="absolute"
                        zIndex="10"
                        inset="0"
                        backgroundColor="grey-dark"
                        pointerEvents="none"
                        style={{
                            opacity: buttonPressedOverlayOpacity,
                        }}
                    />
                )}
                {status === "Closed" && (
                    <Check
                        weight="bold"
                        size={
                            size === "5"
                                ? spacing["3"]
                                : addRemLengths(spacing["2"], spacing["0.5"])
                        }
                    />
                )}
                {status === "Open" && assignee?.status.type === "Active" && (
                    <Box
                        position="absolute"
                        top="0"
                        left="0"
                        height={size}
                        overflow="hidden"
                        style={{
                            width: `${parseRemLengthNumber(spacing[size]) / 2}rem`,
                            transform: `translate(-1px, -1px) translateX(${
                                parseRemLengthNumber(spacing[size]) / 2
                            }rem) scale(${(16 - 5) / 16})`,
                            transformOrigin: "center left",
                        }}
                    >
                        <Box
                            position="absolute"
                            top="0"
                            right="0"
                            width={size}
                            height={size}
                            borderRadius="full"
                            backgroundColor={{light: "theme-20-const", dark: "theme-30-const"}}
                        />
                        {isPressed && (
                            // For accent buttons, instead of choosing a darker background color shade when
                            // pressed we add a black overlay at a lowered opacity. We accomplish this with
                            // an overlay element since such a color is not in our color scheme.
                            //
                            // Darker shades in our color scheme are more saturated. We want the effect of a
                            // button being physically pressed down.
                            //
                            // When we added this there was a happy accident. The text color also got
                            // darker! This is more fitting for the physical analogy of a button being
                            // pressed down.
                            <Box
                                position="absolute"
                                zIndex="10"
                                top="0"
                                right="0"
                                width={size}
                                height={size}
                                borderRadius="full"
                                backgroundColor="grey-dark"
                                pointerEvents="none"
                                style={{
                                    opacity: buttonPressedOverlayOpacity,
                                }}
                            />
                        )}
                    </Box>
                )}
            </button>
        </FocusRing>
    );
}
