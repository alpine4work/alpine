import {Check} from "phosphor-react";
import {
    TaskDisplayStatusCircleSize,
    getTaskDisplayStatusActiveHalfCircleMargin,
    taskDisplayStatusActiveHalfCircleClassName,
    taskDisplayStatusActiveHalfCircleContainerClassName,
    taskDisplayStatusActivePressedOverlayClassName,
    taskDisplayStatusClosedPressedOverlayClassName,
    taskDisplayStatusPressedCircleClassNameByDisplayStatus,
    taskDisplayStatusUnpressedCircleClassNameByDisplayStatus,
} from "~/client/design/task_display_status_circle_html.js";
import {buttonStyles, colorSchemeVars} from "~/client/styles/styles.js";
import {parseRemLength, spacing} from "~/shared/design/core/spacing.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";

// Since we can't import `shared/tasks` from `client/design`, manually inline
// the `TaskDisplayStatus` type. This component lives in `client/design` so we
// can use it anywhere in the product without needing to depend on all the
// `client/tasks` code.
type TaskDisplayStatus = "OpenInactive" | "OpenActive" | "Closed";

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

export function TaskDisplayStatusCircle({
    displayStatus,
    size,
    isPressed,
}: {
    displayStatus: TaskDisplayStatus;
    size: TaskDisplayStatusCircleSize;
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

    const sizeInt = parseInt(size, 10);
    const activeHalfCircleMargin = getTaskDisplayStatusActiveHalfCircleMargin(sizeInt) + 1;

    let ariaLabel;
    switch (displayStatus) {
        case "OpenInactive":
            ariaLabel = "Open";
            break;
        case "OpenActive":
            ariaLabel = "Open (active)";
            break;
        case "Closed":
            ariaLabel = "Closed";
            break;
        default:
            throw exhaustive(displayStatus);
    }

    return (
        <span
            role="img"
            aria-label={ariaLabel}
            className={
                isPressed
                    ? taskDisplayStatusPressedCircleClassNameByDisplayStatus.getOrSetDefault(
                          displayStatus,
                      )
                    : taskDisplayStatusUnpressedCircleClassNameByDisplayStatus.getOrSetDefault(
                          displayStatus,
                      )
            }
            style={{
                width: spacing[size],
                height: spacing[size],
                boxShadow:
                    displayStatus === "OpenInactive" || displayStatus === "OpenActive"
                        ? `inset 0 0 0 1px ${colorSchemeVars["grey-40"]}`
                        : undefined,
            }}
        >
            {isPressed && displayStatus === "Closed" && (
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
                    className={taskDisplayStatusClosedPressedOverlayClassName}
                    style={{opacity: buttonStyles.buttonPressedOverlayOpacity}}
                />
            )}
            {displayStatus === "Closed" && (
                <Check
                    weight="bold"
                    size={spacing["2.5"]}
                    // We need this to make sure we don't inherit the color from
                    // `<IconContext.Provider>` (e.g. when used as a menu item in
                    // `getTaskStatusMenuActions()`).
                    color="currentColor"
                    style={{transform: `scale(${sizeInt / 4})`}}
                />
            )}
            {displayStatus === "OpenActive" && (
                <span
                    className={taskDisplayStatusActiveHalfCircleContainerClassName}
                    style={{
                        width: `calc(${parseRemLength(size) / 2}rem - ${activeHalfCircleMargin}px)`,
                        height: `calc(${spacing[size]} - ${activeHalfCircleMargin * 2}px)`,
                        transform: `translateY(${activeHalfCircleMargin}px) translateX(${-activeHalfCircleMargin}px)`,
                        // NOTE(calebmer): Safari appears to have a bug where `overflow: hidden` is not
                        // actually clipping our circle? After some research it's a known bug that
                        // Safari with `overflow: hidden` and `border-radius` doesn't always work. A
                        // solution is to use `mask-image` instead. Curiously, I've found setting a
                        // mask image that doesn't do any actual masking gets Safari to clip the half
                        // circle properly. Going to...go with that for now I guess.
                        //
                        // This should probably be svg anyway.
                        //
                        // https://discourse.webflow.com/t/safari-not-hiding-overflow-on-rounded-corner-divs/55060
                        maskImage: "linear-gradient(white, white)",
                    }}
                >
                    <span
                        className={taskDisplayStatusActiveHalfCircleClassName}
                        style={{
                            width: `calc(${spacing[size]} - ${activeHalfCircleMargin * 2}px)`,
                            height: `calc(${spacing[size]} - ${activeHalfCircleMargin * 2}px)`,
                        }}
                    />
                    {isPressed && (
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
                            className={taskDisplayStatusActivePressedOverlayClassName}
                            style={{
                                opacity: buttonStyles.buttonPressedOverlayOpacity,
                                width: spacing[size],
                                height: spacing[size],
                            }}
                        />
                    )}
                </span>
            )}
        </span>
    );
}
