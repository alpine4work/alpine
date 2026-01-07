import {useSpacingScale} from "~/client/web/remix/spacing_scale_context.js";
import {colorSchemeVars, sprinkles} from "~/client/web/styles/styles.js";
import {Spacing, convertRemLengthToPx, spacing} from "~/shared/design/core/spacing.js";

// NOTE(calebmer): You are not allowed to use the `<Box>` component in this
// file. It is critical for scroll performance that this component renders
// fast. Manually use the `sprinkles()` function instead. This reduces the
// number of fibers React needs to render. One day we'd like to introduce
// transformations that automatically inline `<Box>` components and
// `sprinkles()` functions at which point using `<Box>` would not make a
// performance difference.
//
// So we assign the `Box` variable to null here so you get a TypeScript error
// if you try to use `<Box>`.
//
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const Box = null;

const progressTrackClassName = sprinkles({
    position: "absolute",
    inset: "0",
});

const progressLineClassName = sprinkles({
    position: "absolute",
    inset: "0",
    color: {light: "theme-50-const", dark: "theme-40-const"},
});

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
    // NOTE(calebmer): You are not allowed to use the `sprinkles()` function in
    // this component. It is critical for scroll performance that this component
    // renders fast. Use the `sprinkles()` function in the module body instead.
    // We've observed while profiling the sprinkles function takes a meaningful
    // amount of time during render.
    //
    // One day we'd like to introduce transformations that automatically
    // pre-evaluates `sprinkles()` functions at which point lifting them to the
    // module scope wouldn't do anything.
    //
    // So we assign the `sprinkles` variable to null here so you get a TypeScript
    // error if you try to use `sprinkles()`.
    //
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const sprinkles = null;

    const spacingScale = useSpacingScale();

    const fraction = Math.max(closedChildTaskCount / childTaskCount, 0.1);

    const size: Spacing = "3";

    const viewBoxSize = convertRemLengthToPx(size, spacingScale);
    const strokeWidth = 2;
    const diameter = viewBoxSize - strokeWidth;
    const radius = diameter / 2;
    const circumference = 2 * Math.PI * radius;

    return (
        <div
            style={{
                position: "relative",
                width: spacing[size],
                height: spacing[size],
                // NOTE(calebmer, 2024-03-21): Without this, in mobile Safari for iOS when the
                // expand task button is clicked the progress wheel [icon shifts ever so
                // slightly][1]. Adding this fixes it. This feels like a Safari bug and adding
                // `transform` fixes it by creating a new composite layer for the progress
                // wheel. Maybe a future version of Safari will fix this bug.
                //
                // [1]: https://gist.github.com/calebmer/4cc8e53c111199f4ace763b6ebb7750a
                transform: "translate(0px, 0px)",
            }}
        >
            <svg
                xmlns="http://www.w3.org/2000/svg"
                className={progressTrackClassName}
                style={{
                    color: isPressed
                        ? colorSchemeVars["grey-40"]
                        : isHovered
                          ? colorSchemeVars["grey-30"]
                          : colorSchemeVars["grey-20"],
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
            <svg
                xmlns="http://www.w3.org/2000/svg"
                className={progressLineClassName}
                fill="currentColor"
                viewBox={`0 0 ${viewBoxSize} ${viewBoxSize}`}
            >
                <path
                    d={`\
M ${viewBoxSize / 2}, ${viewBoxSize / 2}
m 0, -${radius}
a ${radius},${radius} 0 1,1 0,${radius * 2}
a ${radius},${radius} 0 1,1 0,-${radius * 2}`}
                    fill="none"
                    stroke="currentColor"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={strokeWidth}
                    strokeDasharray={`${fraction * circumference} ${circumference}`}
                    style={{transition: "stroke-dasharray 200ms ease"}}
                />
            </svg>
        </div>
    );
}
