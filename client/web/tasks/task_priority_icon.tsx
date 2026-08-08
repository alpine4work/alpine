import classNames from "classnames";
import {colorSchemeVars, pingAnimationWithDelayClassName} from "~/client/web/styles/styles.js";
import {
    taskPriorityIconClassName,
    taskPriorityIconUrgentCircleFillHighlightedClassName,
    taskPriorityIconUrgentCircleFillNotHighlightedClassName,
    taskPriorityIconUrgentContainerClassName,
    taskPriorityIconUrgentPingContainerClassName,
} from "~/client/web/tasks/task_priority_icon_html.js";
import {Spacing, spacing} from "~/shared/design/core/spacing.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.open_source.js";
import {TaskPriority} from "~/shared/tasks/task_priority.js";

// IMPORTANT: If you update the HTML in this component you should also update
// `renderTaskPriorityIcon()` for code that needs to render icons in
// `<ContentEditor>`.
export function TaskPriorityIcon({
    size,
    priority,
    shouldHighlightUrgent,
    withCurrentColorForUnfilledBars,
}: {
    size: Spacing;
    priority: TaskPriority | null;
    shouldHighlightUrgent: boolean;
    withCurrentColorForUnfilledBars?: boolean;
}) {
    const filledBarColor = colorSchemeVars["grey-80"];
    const unfilledBarColor = withCurrentColorForUnfilledBars
        ? "currentColor"
        : colorSchemeVars["grey-20"];

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
            // Derived from Phosphor's `<WarningCircle>` icon but we made the exclamation mark
            // bigger and duotone.
            return (
                <div className={taskPriorityIconUrgentContainerClassName}>
                    {shouldHighlightUrgent && (
                        <div
                            className={classNames(
                                pingAnimationWithDelayClassName,
                                taskPriorityIconUrgentPingContainerClassName,
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
                            className={
                                shouldHighlightUrgent
                                    ? taskPriorityIconUrgentCircleFillHighlightedClassName
                                    : taskPriorityIconUrgentCircleFillNotHighlightedClassName
                            }
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
            className={taskPriorityIconClassName}
            // Safari doesn't like `width` and `height` attributes being set to rem units so
            // use `style` instead.
            style={{
                width: spacing[size],
                height: spacing[size],
            }}
        >
            <rect
                x="23.5"
                y="5"
                width="2"
                height="22"
                rx="1"
                fill={fillBar3 ? filledBarColor : unfilledBarColor}
            />
            <rect
                x="15"
                y="10.5"
                width="2"
                height="16.5"
                rx="1"
                fill={fillBar2 ? filledBarColor : unfilledBarColor}
            />
            <rect
                x="6.5"
                y="16"
                width="2"
                height="11"
                rx="1"
                fill={fillBar1 ? filledBarColor : unfilledBarColor}
            />
        </svg>
    );
}
