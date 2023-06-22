import {Box} from "~/client/design/box";
import {TaskPriority} from "~/client/tasks/demo_2/local_tasks_state";
import {Spacing, spacing} from "~/shared/design/spacing";
import {exhaustive} from "~/shared/helpers/control/exhaustive";
import {colorSchemeVars, pingAnimationClassName} from "~/shared/styles/styles";

export function TaskPriorityIcon({
    size,
    priority,
    shouldHighlightUrgent,
}: {
    size: Spacing;
    priority: TaskPriority | null;
    shouldHighlightUrgent: boolean;
}) {
    const filledBarColor = colorSchemeVars["grey-70"];
    const notFilledBarColor = colorSchemeVars["grey-30"];

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
                <Box position="relative" zIndex="0">
                    {shouldHighlightUrgent && (
                        <Box
                            position="absolute"
                            inset="0"
                            zIndex="-10"
                            className={pingAnimationClassName}
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
                        </Box>
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
                            fill={
                                shouldHighlightUrgent
                                    ? colorSchemeVars["red-50-const"]
                                    : filledBarColor
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
                </Box>
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
            {fillBar3 ? (
                <rect x="22.5" y="5" width="4" height="22" rx="2" fill={filledBarColor} />
            ) : (
                <rect x="23.5" y="5" width="2" height="22" rx="1" fill={notFilledBarColor} />
            )}
            {fillBar2 ? (
                <rect x="14" y="10.5" width="4" height="16.5" rx="2" fill={filledBarColor} />
            ) : (
                <rect x="15" y="10.5" width="2" height="16.5" rx="1" fill={notFilledBarColor} />
            )}
            {fillBar1 ? (
                <rect x="5.5" y="16" width="4" height="11" rx="2" fill={filledBarColor} />
            ) : (
                <rect x="6.5" y="16" width="2" height="11" rx="1" fill={notFilledBarColor} />
            )}
        </svg>
    );
}
