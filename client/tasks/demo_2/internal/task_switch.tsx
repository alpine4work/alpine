import {VisuallyHidden, usePress} from "react-aria";
import {Box} from "~/client/design/box";
import {FocusRing} from "~/client/design/focus_ring";
import {addRemLengths, parseRemLengthNumber, spacing} from "~/shared/design/spacing";
import {inputPlaceholderStyles, sprinkles} from "~/shared/styles/styles";

export function TaskSwitch({
    label,
    isSelected,
    onSelectionChange,
    isDisabled = false,
}: {
    label: string;
    isSelected: boolean;
    onSelectionChange: (isSelected: boolean) => void;
    isDisabled?: boolean;
}) {
    const {pressProps, isPressed} = usePress({isDisabled});

    return (
        <FocusRing isVisibleWhenFocusWithin>
            <label
                {...pressProps}
                className={sprinkles({display: "flex", alignItems: "center", gap: "1"})}
                style={isDisabled ? inputPlaceholderStyles : undefined}
            >
                <VisuallyHidden>
                    <input
                        type="checkbox"
                        role="switch"
                        disabled={isDisabled}
                        checked={isSelected}
                        onChange={event => onSelectionChange(event.currentTarget.checked)}
                    />
                </VisuallyHidden>
                <TaskSwitchWithoutLabel
                    isPressed={isPressed}
                    isSelected={isSelected}
                    isDisabled={isDisabled}
                />
                {label}
            </label>
        </FocusRing>
    );
}

function TaskSwitchWithoutLabel({
    isPressed,
    isSelected,
    isDisabled,
}: {
    isPressed: boolean;
    isSelected: boolean;
    isDisabled: boolean;
}) {
    return (
        <Box
            width="4"
            height="2.5"
            overflow="hidden"
            backgroundColor={isSelected ? "theme-40-const" : isDisabled ? "grey-10" : "grey-20"}
            borderRadius="full"
            style={{transition: "background-color 150ms ease"}}
        >
            <Box
                backgroundColor="grey-0-const"
                borderRadius="full"
                style={{
                    margin: 1,
                    width: isPressed
                        ? `calc(${addRemLengths(spacing["2.5"], spacing["0.5"])} - 2px)`
                        : `calc(${spacing["2.5"]} - 2px)`,
                    height: `calc(${spacing["2.5"]} - 2px)`,
                    transform: isSelected
                        ? `translateX(${
                              parseRemLengthNumber(spacing["4"]) -
                              parseRemLengthNumber(spacing["2.5"]) -
                              (isPressed ? parseRemLengthNumber(spacing["0.5"]) : 0)
                          }rem)`
                        : "translateX(0px)",
                    transformOrigin: "center",
                    transition: "width 100ms ease, transform 100ms ease",
                }}
            />
        </Box>
    );
}
