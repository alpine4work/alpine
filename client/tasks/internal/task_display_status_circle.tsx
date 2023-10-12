import {Check} from "phosphor-react";
import {buttonPressedOverlayOpacity} from "~/client/design/button.js";
import {addRemLengths, parseRemLengthNumber, spacing} from "~/shared/design/spacing.js";
import {colorSchemeVars, sprinkles} from "~/shared/styles/styles.js";
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

export function TaskDisplayStatusCircle({
    displayStatus,
    size,
    isPressed,
}: {
    displayStatus: TaskDisplayStatus;
    size: "3" | "4" | "5" | "6";
    isPressed?: boolean;
}) {
    const sizeInt = parseInt(size, 10);
    const activeHalfCircleMargin =
        sizeInt >= 6
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

    return (
        <div
            className={sprinkles({
                position: "relative",
                zIndex: "0",
                width: size,
                height: size,
                borderRadius: "full",
                display: "flex",
                justifyContent: "center",
                alignItems: "center",
                overflow: "hidden",
                border:
                    displayStatus === "OpenInactive" || displayStatus === "OpenActive"
                        ? "grey-40"
                        : undefined,
                backgroundColor:
                    displayStatus === "Closed" ? "theme-50" : isPressed ? "grey-10" : "grey-0",
            })}
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
                    className={sprinkles({
                        position: "absolute",
                        zIndex: "10",
                        inset: "0",
                        backgroundColor: "grey-dark",
                        pointerEvents: "none",
                    })}
                    style={{
                        opacity: buttonPressedOverlayOpacity,
                    }}
                />
            )}
            {displayStatus === "Closed" && (
                <Check
                    weight="bold"
                    size={addRemLengths(spacing["2"], spacing["0.5"])}
                    style={{transform: `scale(${sizeInt / 4})`}}
                    color={colorSchemeVars["grey-0-const"]}
                />
            )}
            {displayStatus === "OpenActive" && (
                <div
                    className={sprinkles({
                        position: "absolute",
                        top: "0",
                        left: "0",
                        height: size,
                        overflow: "hidden",
                    })}
                    style={{
                        width: `calc(${parseRemLengthNumber(spacing[size]) / 2}rem - ${
                            1 + activeHalfCircleMargin
                        }px)`,
                        height: `calc(${spacing[size]} - ${2 + activeHalfCircleMargin * 2}px)`,
                        transform: `translateY(${activeHalfCircleMargin}px) translateX(${
                            parseRemLengthNumber(spacing[size]) / 2
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
                        className={sprinkles({
                            position: "absolute",
                            top: "0",
                            right: "0",
                            borderRadius: "full",
                            backgroundColor: {light: "theme-20-const", dark: "theme-30-const"},
                        })}
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
                            className={sprinkles({
                                position: "absolute",
                                zIndex: "10",
                                top: "0",
                                right: "0",
                                width: size,
                                height: size,
                                borderRadius: "full",
                                backgroundColor: "grey-dark",
                                pointerEvents: "none",
                            })}
                            style={{
                                opacity: buttonPressedOverlayOpacity,
                            }}
                        />
                    )}
                </div>
            )}
        </div>
    );
}
