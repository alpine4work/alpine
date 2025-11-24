import {useRef} from "react";
import {mergeProps, useButton, useHover} from "react-aria";
import {FocusRing} from "~/client/web/design/focus_ring.js";
import {MenuButton} from "~/client/web/design/menu_button.js";
import {usePlatform} from "~/client/web/remix/platform_context.js";
import {sprinkles} from "~/client/web/styles/styles.js";

export function TaskQueryFilterOperatorEditor({
    operatorLabel,
    allOperators,
}: {
    operatorLabel: string;
    allOperators:
        | ReadonlyArray<{label: string; isSelected: boolean; onPress: () => void}>
        | ReadonlyArray<ReadonlyArray<{label: string; isSelected: boolean; onPress: () => void}>>;
}) {
    const platform = usePlatform();

    const buttonRef = useRef<HTMLButtonElement>(null);
    const {buttonProps, isPressed} = useButton(
        {},
        // @ts-expect-error: NOTE(calebmer, #react-v19-upgrade): `react-aria` handles
        // the ref correctly but the type is wrong after upgrading to React v19.
        buttonRef,
    );
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
                                paddingX: platform === "mobile" ? "2" : "1",
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
