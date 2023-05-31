import {Box} from "~/client/design/box";
import {useSpacingPx} from "~/client/design/helpers/use_spacing_px";
import {Spacing, spacing} from "~/shared/design/spacing";

export function TaskChildTasksProgressWheel({
    childTaskCount,
    closedChildTaskCount,
    isHovered,
    isPressed,
}: {
    childTaskCount: number;
    closedChildTaskCount: number;
    isHovered?: boolean;
    isPressed?: boolean;
}) {
    const fraction = Math.max(closedChildTaskCount / childTaskCount, 0.1);

    const size: Spacing = "3";

    const radius = useSpacingPx(size) / 2;
    const strokeWidth = 2;
    const viewBoxSize = radius * 2 + strokeWidth;
    const circumference = 2 * Math.PI * radius;

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
                        strokeDasharray={`${fraction * circumference} ${circumference}`}
                        style={{transition: "stroke-dasharray 200ms ease"}}
                    />
                </svg>
            </Box>
        </Box>
    );
}
