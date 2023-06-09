import {useRef} from "react";
import {mergeProps, useButton, useHover} from "react-aria";
import {FocusRing} from "~/client/design/focus_ring";
import {MenuButton} from "~/client/design/menu_button";
import {sprinkles} from "~/shared/styles/styles";

export function TaskQueryFilterOperatorEditor({
    operatorLabel,
    allOperators,
}: {
    operatorLabel: string;
    allOperators:
        | ReadonlyArray<{label: string; isSelected: boolean; onPress: () => void}>
        | ReadonlyArray<ReadonlyArray<{label: string; isSelected: boolean; onPress: () => void}>>;
}) {
    const buttonRef = useRef<HTMLButtonElement>(null);
    const {buttonProps, isPressed} = useButton({}, buttonRef);
    const {hoverProps, isHovered} = useHover({});

    return (
        <MenuButton actions={allOperators}>
            <FocusRing offset="0">
                <button
                    {...mergeProps(buttonProps, hoverProps)}
                    ref={buttonRef}
                    className={sprinkles({
                        height: "full",
                    })}
                    style={{
                        paddingTop: 1,
                        paddingBottom: 1,
                    }}
                >
                    <span
                        className={sprinkles({
                            height: "full",
                            minWidth: "4",
                            paddingX: "1",
                            display: "flex",
                            alignItems: "center",
                            // The hit radius for this button extends within the entire filter editor but
                            // the background color style has some inset.
                            backgroundColor: isPressed
                                ? "grey-10"
                                : isHovered
                                ? "grey-5"
                                : undefined,
                            borderRadius: "sm",
                            color: "grey-60",
                        })}
                    >
                        {operatorLabel}
                    </span>
                </button>
            </FocusRing>
        </MenuButton>
    );
}
