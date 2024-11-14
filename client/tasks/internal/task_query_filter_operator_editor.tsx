import {useRef} from "react";
import {mergeProps, useButton, useHover} from "react-aria";
import {FocusRing} from "~/client/design/focus_ring.js";
import {MenuButton} from "~/client/design/menu_button.js";
import {useRouteLayout} from "~/client/remix/route_layout_context.js";
import {sprinkles} from "~/client/styles/styles.js";

export function TaskQueryFilterOperatorEditor({
    operatorLabel,
    allOperators,
}: {
    operatorLabel: string;
    allOperators:
        | ReadonlyArray<{label: string; isSelected: boolean; onPress: () => void}>
        | ReadonlyArray<ReadonlyArray<{label: string; isSelected: boolean; onPress: () => void}>>;
}) {
    const routeLayout = useRouteLayout();

    const buttonRef = useRef<HTMLButtonElement>(null);
    const {buttonProps, isPressed} = useButton({}, buttonRef);
    const {hoverProps, isHovered} = useHover({});

    return (
        <MenuButton actions={allOperators}>
            {({isVisible}) => (
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
                                // Add more padding on mobile to make it easier for users to touch small
                                // operation buttons.
                                paddingX: routeLayout === "narrow" ? "2" : "1",
                                display: "flex",
                                alignItems: "center",
                                // The hit radius for this button extends within the entire filter editor but
                                // the background color style has some inset.
                                backgroundColor: isPressed
                                    ? "grey-10"
                                    : isHovered || isVisible
                                    ? "grey-5"
                                    : undefined,
                                borderRadius: "0.5",
                                fontStyle: "truncate",
                                color: "grey-60",
                            })}
                        >
                            {operatorLabel}
                        </span>
                    </button>
                </FocusRing>
            )}
        </MenuButton>
    );
}
