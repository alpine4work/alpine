import {CaretUp} from "phosphor-react";
import {mergeProps, useHover, usePress} from "react-aria";
import {Box} from "~/client/design/box";
import {useSpacingPx} from "~/client/design/helpers/use_spacing_px";
import {Tooltip} from "~/client/design/tooltip";
import {Spacing, spacing} from "~/shared/design/spacing";

export function TaskRowTitleChildTasksButton({
    childTaskCount,
    closedChildTaskCount,
    areChildTasksCollapsed,
    onAreChildTasksCollapsedToggle,
}: {
    childTaskCount: number;
    closedChildTaskCount: number;
    areChildTasksCollapsed: boolean;
    onAreChildTasksCollapsedToggle: () => void;
}) {
    const {hoverProps, isHovered} = useHover({});
    const {pressProps, isPressed} = usePress({onPress: onAreChildTasksCollapsedToggle});

    return (
        <Tooltip content={areChildTasksCollapsed ? "Expand subtasks" : "Collapse subtasks"}>
            <Box
                // NOTE(calebmer): This is intentionally not focusable because keyboard
                // interactivity in task rows uses keyboard shortcuts other than tabbing. Such
                // as arrow keys.
                //
                // TODO(calebmer): We need a keyboard shortcut for toggling subtasks.
                {...mergeProps(hoverProps, pressProps)}
                display="flex"
                alignItems="center"
                paddingLeft="1"
                paddingRight="0.5"
                paddingY="0.5"
                gap="1"
                borderRadius="base"
                backgroundColor={isPressed ? "grey-10" : isHovered ? "grey-5" : undefined}
            >
                <TaskRowTitleChildTasksButtonProgress
                    childTaskCount={childTaskCount}
                    closedChildTaskCount={closedChildTaskCount}
                    isHovered={isHovered}
                    isPressed={isPressed}
                />
                <Box color="grey-70">
                    {closedChildTaskCount}/{childTaskCount}
                </Box>
                <CaretUp
                    size={spacing["3"]}
                    style={{
                        transform: areChildTasksCollapsed ? "rotate(0deg)" : "rotate(180deg)",
                        transition: "transform 200ms ease",
                    }}
                />
            </Box>
        </Tooltip>
    );
}

function TaskRowTitleChildTasksButtonProgress({
    childTaskCount,
    closedChildTaskCount,
    isHovered,
    isPressed,
}: {
    childTaskCount: number;
    closedChildTaskCount: number;
    isHovered: boolean;
    isPressed: boolean;
}) {
    const fraction = Math.max(closedChildTaskCount / childTaskCount, 0.1);

    const size: Spacing = "3";

    const radius = useSpacingPx(size) / 2;
    const strokeWidth = 2;
    const viewBoxSize = radius * 2 + strokeWidth;
    const dashes = Math.round(2 * Math.PI * radius);

    return (
        <Box position="relative" width={size} height={size}>
            <Box
                position="absolute"
                inset="0"
                color={isPressed ? "grey-40" : isHovered ? "grey-30" : "grey-20"}
            >
                <svg
                    xmlns="http://www.w3.org/2000/svg"
                    style={{
                        // Safari logs a warning when using `width` or `height` with rem units.
                        width: spacing[size],
                        height: spacing[size],
                    }}
                    fill="currentColor"
                    viewBox={`0 0 ${viewBoxSize} ${viewBoxSize}`}
                >
                    <circle
                        cx={viewBoxSize / 2}
                        cy={viewBoxSize / 2}
                        r={radius}
                        fill="none"
                        stroke="currentColor"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={1}
                    />
                </svg>
            </Box>
            <Box position="absolute" inset="0" color={{light: "theme-40", dark: "theme-60"}}>
                <svg
                    xmlns="http://www.w3.org/2000/svg"
                    style={{
                        // Safari logs a warning when using `width` or `height` with rem units.
                        width: spacing[size],
                        height: spacing[size],
                    }}
                    fill="currentColor"
                    viewBox={`0 0 ${viewBoxSize} ${viewBoxSize}`}
                >
                    <path
                        d={`
                            M ${viewBoxSize / 2}, ${viewBoxSize / 2}
                            m 0, -${radius}
                            a ${radius},${radius} 0 1,1 0,${radius * 2}
                            a ${radius},${radius} 0 1,1 0,-${radius * 2}
                        `}
                        fill="none"
                        stroke="currentColor"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={strokeWidth}
                        strokeDasharray={`${fraction * dashes} ${dashes}`}
                        style={{transition: "stroke-dasharray 200ms ease"}}
                    />
                </svg>
            </Box>
        </Box>
    );
}
