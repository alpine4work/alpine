import {Check} from "phosphor-react";
import {useRef} from "react";
import {useButton} from "react-aria";
import {Box} from "~/client/design/box";
import {buttonPressedOverlayOpacity} from "~/client/design/button";
import {FocusRing} from "~/client/design/focus_ring";
import {MenuButton} from "~/client/design/menu_button";
import {AccountModel} from "~/shared/accounts/account_model";
import {addRemLengths, parseRemLengthNumber, spacing} from "~/shared/design/spacing";
import {colorSchemeVars, sprinkles} from "~/shared/styles/styles";

export type TaskStatus = "Open" | "Closed";

export type TaskAssigneeStatus = "Inactive" | "Active";

export type TaskAssignee = {
    readonly account: AccountModel;
    readonly status: TaskAssigneeStatus;
};

export function TaskStatusButton({
    status,
    onStatusChange,
    assignee,
    size = "4",
}: {
    status: TaskStatus;
    onStatusChange: (status: TaskStatus) => void;
    assignee: TaskAssignee | null;
    size?: "4" | "5";
}) {
    const buttonRef = useRef<HTMLButtonElement>(null);

    const {isPressed, buttonProps} = useButton({}, buttonRef);

    return (
        <MenuButton
            actions={[
                {
                    label: "Open",
                    isSelected: status === "Open" && assignee?.status !== "Active",
                    disabledReason:
                        assignee && assignee.status === "Active"
                            ? "Only the assignee can change which of their tasks are active"
                            : undefined,
                    icon: ({isDisabled}) => (
                        <Box
                            width="4"
                            height="4"
                            borderRadius="full"
                            border="grey-50"
                            backgroundColor={{light: "grey-0", dark: "grey-5"}}
                            style={{opacity: isDisabled ? 0.5 : undefined}}
                        />
                    ),
                    onPress: () => {
                        onStatusChange("Open");
                    },
                },
                {
                    label: "Active",
                    isSelected: status === "Open" && assignee?.status === "Active",
                    disabledReason:
                        assignee && assignee.status === "Inactive"
                            ? "Only the assignee can change which of their tasks are active"
                            : undefined,
                    icon: ({isDisabled}) => (
                        <Box
                            position="relative"
                            width="4"
                            height="4"
                            borderRadius="full"
                            border="grey-50"
                            backgroundColor={{light: "grey-0", dark: "grey-5"}}
                            style={{opacity: isDisabled ? 0.5 : undefined}}
                        >
                            <Box
                                position="absolute"
                                top="0"
                                left="0"
                                height="4"
                                width="2"
                                overflow="hidden"
                                style={{
                                    transform: `translate(-1px, -1px) translateX(${
                                        spacing["2"]
                                    }) scale(${(16 - 5) / 16})`,
                                    transformOrigin: "center left",
                                }}
                            >
                                <Box
                                    position="absolute"
                                    top="0"
                                    right="0"
                                    width="4"
                                    height="4"
                                    borderRadius="full"
                                    backgroundColor={{
                                        light: "theme-20-const",
                                        dark: "theme-30-const",
                                    }}
                                />
                            </Box>
                        </Box>
                    ),
                    onPress: () => {},
                },
                {
                    label: "Closed",
                    isSelected: status === "Closed",
                    icon: (
                        <Box
                            width="4"
                            height="4"
                            borderRadius="full"
                            backgroundColor="theme-50-const"
                            display="flex"
                            justifyContent="center"
                            alignItems="center"
                        >
                            <Check
                                weight="bold"
                                size={addRemLengths(spacing["2"], spacing["0.5"])}
                                color={colorSchemeVars["grey-0-const"]}
                            />
                        </Box>
                    ),
                    onPress: () => {
                        onStatusChange("Closed");
                    },
                },
            ]}
        >
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
                        border:
                            status === "Open"
                                ? isPressed
                                    ? // We want the border to get darker when pressed whether we are in light mode
                                      // or dark mode.
                                      {light: "grey-70", dark: "grey-40"}
                                    : "grey-50"
                                : undefined,
                        backgroundColor: status === "Closed" ? "theme-50-const" : undefined,
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
                    {status === "Open" && assignee?.status === "Active" && (
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
        </MenuButton>
    );
}
