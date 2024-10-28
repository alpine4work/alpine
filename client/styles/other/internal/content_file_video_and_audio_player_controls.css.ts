import {globalStyle, style} from "@vanilla-extract/css";
import {
    borderRadius,
    colorSchemeVars,
    darkColorSchemeSelector,
    fontSizes,
} from "~/client/styles/core/styles_core.js";
import {spacing} from "~/shared/design/core/spacing.js";

export const containerClassName = style({});

/**
 * Class added to `containerClassName` that tells us if the video has played at
 * least once.
 */
export const hasPlayedClassName = style({});

/**
 * Class added to `containerClassName` that tells us if the video is currently
 * playing.
 */
export const playingClassName = style({});

/**
 * Class added to `containerClassName` that tells us if video playback has stopped
 * due to a temporary lack of data.
 */
export const waitingClassName = style({});

/**
 * Class added to `containerClassName` while we're dragging the scrubber thumb.
 */
export const draggingScrubberThumbClassName = style({});

export const controlsClassName = style({
    width: "100%",
    height: spacing["8"],
    color: colorSchemeVars["grey-90"],
    display: "flex",
    alignItems: "center",
});

export const playButtonClassName = style({
    marginLeft: spacing["1"],
    width: spacing["6"],
    height: spacing["6"],
    borderRadius: borderRadius["0.5"],
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
});

globalStyle(`${playButtonClassName} > svg`, {
    width: spacing["3"],
    height: spacing["3"],
});

globalStyle(`${containerClassName}${playingClassName} ${playButtonClassName} > svg:first-child`, {
    display: "none",
});

globalStyle(
    `${containerClassName}:not(${playingClassName}) ${playButtonClassName} > svg:last-child`,
    {
        display: "none",
    },
);

export const durationProgressClassName = style({
    marginLeft: spacing["1.5"],
    display: "flex",
    gap: spacing["1"],
    ...fontSizes["50"],
    fontVariantNumeric: "tabular-nums",
});

export const durationProgressCurrentClassName = style({
    selectors: {
        "&::before": {
            content: "attr(data-time)",
        },
    },
});

export const scrubberContainerClassName = style({
    flexGrow: "1",
    paddingLeft: spacing["4"],
    paddingRight: spacing["3"],
});

export const scrubberClassName = style({
    width: "100%",
    // Larger height than our contents to provide a larger touch target for the
    // mouse cursor.
    height: spacing["3"],
    position: "relative",
    zIndex: "0",
});

export const scrubberThumbIndicatorClassName = style({
    zIndex: "10",
    position: "absolute",
    top: `calc(50% - ${spacing["1"]})`,
    left: `-${spacing["1"]}`,
    width: spacing["2"],
    height: spacing["2"],
    borderRadius: borderRadius["full"],
    backgroundColor: colorSchemeVars["grey-90"],
    pointerEvents: "none",
    boxShadow: "0px 1px 2px 0px rgb(18 18 20 / 0.1)",
});

export const scrubberThumbTargetClassName = style({
    zIndex: "-10",
    position: "absolute",
    top: `calc(50% - ${spacing["3"]})`,
    left: `-${spacing["3"]}`,
    width: spacing["6"],
    height: spacing["6"],
    borderRadius: borderRadius["full"],
    backgroundColor: "transparent",
    selectors: {
        "&:hover": {
            backgroundColor: colorSchemeVars["grey-5"],
        },
        [`${containerClassName}${draggingScrubberThumbClassName} &`]: {
            // Don't switch background color to `grey-10` while dragging since that's the
            // color of our track.
            backgroundColor: colorSchemeVars["grey-5"],
        },
    },
});

export const scrubberTrackClassName = style({
    zIndex: "0",
    position: "absolute",
    top: "calc(50% - 2px)",
    width: "100%",
    height: "4px",
    backgroundColor: colorSchemeVars["grey-10"],
    borderRadius: borderRadius["full"],
    overflow: "hidden",
    // Don't interfere with thumb pointer events.
    pointerEvents: "none",
});

export const scrubberTrackProgressClassName = style({
    zIndex: "20",
    position: "absolute",
    inset: "0",
    backgroundColor: colorSchemeVars["theme-40"],
    transformOrigin: "left",
});

export const scrubberTrackBufferedClassName = style({
    zIndex: "10",
    position: "absolute",
    inset: "0",
    backgroundColor: colorSchemeVars["grey-20"],
    transformOrigin: "left",
    selectors: {
        [`${darkColorSchemeSelector} &`]: {
            // In the dark elevated color scheme, `grey-20` doesn't look different enough
            // from `grey-10`.
            backgroundColor: colorSchemeVars["grey-30"],
        },
    },
});

export const playbackRateButtonClassName = style({
    width: spacing["7"],
    height: spacing["6"],
    borderRadius: borderRadius["0.5"],
    ...fontSizes["50"],
    fontVariantNumeric: "tabular-nums",
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
    color: colorSchemeVars["grey-70"],
    selectors: {
        "&::after": {
            content: "attr(data-rate)",
        },
    },
});
