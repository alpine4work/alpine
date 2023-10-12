import classNames from "classnames";
import {Spacing, spacing} from "~/shared/design/spacing.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {colorSchemeVars, pingAnimationClassName, sprinkles} from "~/shared/styles/styles.js";
import {TaskPriority} from "~/shared/tasks/task_priority.js";

export function TaskPriorityIcon({
    size,
    priority,
    shouldHighlightUrgent,
}: {
    size: Spacing;
    priority: TaskPriority | null;
    shouldHighlightUrgent: boolean;
}) {
    const filledBarColor = colorSchemeVars["grey-80"];
    const notFilledBarColor = colorSchemeVars["grey-20"];

    let fillBar1: boolean;
    let fillBar2: boolean;
    let fillBar3: boolean;

    switch (priority) {
        case null: {
            fillBar1 = false;
            fillBar2 = false;
            fillBar3 = false;
            break;
        }
        case "Low": {
            fillBar1 = true;
            fillBar2 = false;
            fillBar3 = false;
            break;
        }
        case "Medium": {
            fillBar1 = true;
            fillBar2 = true;
            fillBar3 = false;
            break;
        }
        case "High": {
            fillBar1 = true;
            fillBar2 = true;
            fillBar3 = true;
            break;
        }
        case "Urgent": {
            // Derived from Phosphor's `<WarningCircle>` icon but we made the exclamation
            // mark bigger and duotone.
            return (
                <div className={sprinkles({position: "relative", zIndex: "0"})}>
                    {shouldHighlightUrgent && (
                        <div
                            className={classNames(
                                pingAnimationClassName,
                                sprinkles({
                                    position: "absolute",
                                    inset: "0",
                                    zIndex: "-10",
                                }),
                            )}
                        >
                            <svg
                                xmlns="http://www.w3.org/2000/svg"
                                viewBox="0 0 32 32"
                                style={{width: spacing[size], height: spacing[size]}}
                            >
                                <circle
                                    cx="16"
                                    cy="16"
                                    r="13"
                                    fill={colorSchemeVars["red-50-const"]}
                                />
                            </svg>
                        </div>
                    )}
                    <svg
                        xmlns="http://www.w3.org/2000/svg"
                        viewBox="0 0 32 32"
                        style={{width: spacing[size], height: spacing[size]}}
                    >
                        <circle
                            cx="16"
                            cy="16"
                            r="13"
                            className={sprinkles({
                                fill: shouldHighlightUrgent
                                    ? "red-50-const"
                                    : {light: "grey-70", dark: "grey-20"},
                            })}
                        />
                        <rect
                            x="15"
                            y="9"
                            width="2"
                            height="9"
                            rx="1"
                            fill={colorSchemeVars["grey-0-const"]}
                        />
                        <circle cx="16" cy="21.5" r="1.5" fill={colorSchemeVars["grey-0-const"]} />
                    </svg>
                </div>
            );
        }
        default:
            throw exhaustive(priority);
    }

    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 32 32"
            // Safari doesn't like `width` and `height` attributes being set to rem units
            // so use `style` instead.
            style={{
                width: spacing[size],
                height: spacing[size],
            }}
        >
            <rect
                x="22.5"
                y="5"
                width="4"
                height="22"
                fill={fillBar3 ? filledBarColor : notFilledBarColor}
            />
            <rect
                x="14"
                y="10.5"
                width="4"
                height="16.5"
                fill={fillBar2 ? filledBarColor : notFilledBarColor}
            />
            <rect
                x="5.5"
                y="16"
                width="4"
                height="11"
                fill={fillBar1 ? filledBarColor : notFilledBarColor}
            />
        </svg>
    );
}
