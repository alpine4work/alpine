import {Check} from "phosphor-react";
import {
    accentThemeBackgroundColor,
    accentThemeForegroundColor,
    buttonStyles,
    sprinkles,
} from "~/client/styles/styles.js";
import {parseRemLength, spacing} from "~/shared/design/core/spacing.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {DefaultMap} from "~/shared/helpers/map/default_map.js";
import {TaskDisplayStatus} from "~/shared/tasks/task_display_status.js";

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

const computeCircleClassName = (displayStatus: TaskDisplayStatus, isPressed: boolean) =>
    sprinkles({
        // In case the circle is in a flexbox container, don't let it shrink.
        flexShrink: "0",
        position: "relative",
        zIndex: "0",
        borderRadius: "full",
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        overflow: "hidden",
        border:
            displayStatus === "OpenInactive" || displayStatus === "OpenActive"
                ? "grey-40"
                : undefined,
        color: displayStatus === "Closed" ? accentThemeForegroundColor : undefined,
        backgroundColor:
            displayStatus === "Closed"
                ? accentThemeBackgroundColor
                : isPressed
                ? "grey-10"
                : "grey-0",
    });

const unpressedCircleClassNameByDisplayStatus = new DefaultMap((displayStatus: TaskDisplayStatus) =>
    computeCircleClassName(displayStatus, false),
);

const pressedCircleClassNameByDisplayStatus = new DefaultMap((displayStatus: TaskDisplayStatus) =>
    computeCircleClassName(displayStatus, true),
);

const closedPressedOverlayClassName = sprinkles({
    position: "absolute",
    zIndex: "10",
    inset: "0",
    backgroundColor: "grey-100-const",
    pointerEvents: "none",
});

const activeHalfCircleContainerClassName = sprinkles({
    position: "absolute",
    top: "0",
    left: "0",
    overflow: "hidden",
});

const activeHalfCircleClassName = sprinkles({
    position: "absolute",
    top: "0",
    right: "0",
    borderRadius: "full",
    backgroundColor: {light: "theme-20-const", dark: "theme-30-const"},
});

const activePressedOverlayClassName = sprinkles({
    position: "absolute",
    zIndex: "10",
    top: "0",
    right: "0",
    borderRadius: "full",
    backgroundColor: "grey-100-const",
    pointerEvents: "none",
});

export function TaskDisplayStatusCircle({
    displayStatus,
    size,
    isPressed,
}: {
    displayStatus: TaskDisplayStatus;
    size: "3" | "4" | "5" | "6" | "7";
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
    const activeHalfCircleMargin =
        sizeInt >= 7
            ? // On high-pixel density devices round up to 2.5 and on low-pixel density devices round
              // down to 2.
              2.48
            : sizeInt >= 6
            ? 2
            : sizeInt >= 5
            ? // On high-pixel density devices round up to 1.5 and on low-pixel density devices round
              // down to 1.
              1.49
            : sizeInt >= 4
            ? // On high-pixel density devices round up to 1.5 and on low-pixel density devices round
              // down to 1.
              1.48
            : 1;

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
        <div
            role="img"
            aria-label={ariaLabel}
            className={
                isPressed
                    ? pressedCircleClassNameByDisplayStatus.getOrSetDefault(displayStatus)
                    : unpressedCircleClassNameByDisplayStatus.getOrSetDefault(displayStatus)
            }
            style={{width: spacing[size], height: spacing[size]}}
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
                <div
                    className={closedPressedOverlayClassName}
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
                <div
                    className={activeHalfCircleContainerClassName}
                    style={{
                        width: `calc(${parseRemLength(size) / 2}rem - ${
                            1 + activeHalfCircleMargin
                        }px)`,
                        height: `calc(${spacing[size]} - ${2 + activeHalfCircleMargin * 2}px)`,
                        transform: `translateY(${activeHalfCircleMargin}px) translateX(${
                            parseRemLength(size) / 2
                        }rem) translateX(-1px)`,
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
                    <div
                        className={activeHalfCircleClassName}
                        style={{
                            width: `calc(${spacing[size]} - ${2 + activeHalfCircleMargin * 2}px)`,
                            height: `calc(${spacing[size]} - ${2 + activeHalfCircleMargin * 2}px)`,
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
                        <div
                            className={activePressedOverlayClassName}
                            style={{
                                opacity: buttonStyles.buttonPressedOverlayOpacity,
                                width: spacing[size],
                                height: spacing[size],
                            }}
                        />
                    )}
                </div>
            )}
        </div>
    );
}
