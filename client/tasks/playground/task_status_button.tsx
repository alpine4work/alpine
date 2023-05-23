import {Check} from "phosphor-react";
import {useRef} from "react";
import {useButton} from "react-aria";
import {buttonPressedOverlayOpacity} from "~/client/design/button";
import {FocusRing} from "~/client/design/focus_ring";
import {addRemLengths, spacing} from "~/shared/design/spacing";
import {sprinkles} from "~/shared/styles/styles";

export type TaskStatus = "Open" | "Closed";

export function TaskStatusButton({
    status,
    onStatusChange,
    size = "4",
}: {
    status: TaskStatus;
    onStatusChange: (status: TaskStatus) => void;
    size?: "4" | "5";
}) {
    const buttonRef = useRef<HTMLButtonElement>(null);

    const {isPressed, buttonProps} = useButton(
        {
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
                    display: "flex",
                    justifyContent: "center",
                    alignItems: "center",
                    position: "relative",
                    overflow: "hidden",
                    border:
                        status === "Open"
                            ? isPressed
                                ? // Darken border on press regardless of whether we are in light or dark mode.
                                  {light: "grey-40", dark: "grey-20"}
                                : "grey-30"
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
                    <span
                        className={sprinkles({
                            position: "absolute",
                            inset: "0",
                            backgroundColor: "grey-dark",
                            pointerEvents: "none",
                        })}
                        style={{opacity: buttonPressedOverlayOpacity}}
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
            </button>
        </FocusRing>
    );
}
