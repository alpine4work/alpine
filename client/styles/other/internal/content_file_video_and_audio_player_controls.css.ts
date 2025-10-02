import {ComplexStyleRule, globalStyle, style} from "@vanilla-extract/css";
import {
    colorSchemeVars,
    darkColorSchemeSelector,
    elevationVars,
    fontSizes,
} from "~/client/styles/core/styles_core.js";
import {
    overlayAnimateFadeInFromTopAnimation,
    overlayAnimateFadeOutFromTopAnimation,
} from "~/client/styles/other/internal/overlay_animated.css.js";
import {borderRadius} from "~/shared/design/core/border_radius.js";
import {addRemLengths, parseRemLength, spacing} from "~/shared/design/core/spacing.js";

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

/**
 * Class added to `containerClassName` while we're dragging the volume scrubber thumb.
 */
export const draggingVolumeScrubberThumbClassName = style({});

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

const scrubberThumbIndicatorSize = spacing["2"];

export const durationScrubberClassName = style({
    width: `calc(100% + ${scrubberThumbIndicatorSize})`,
    // Larger height than our contents to provide a larger touch target for the
    // mouse cursor.
    height: spacing["3"],
    position: "relative",
    left: `-${parseRemLength(scrubberThumbIndicatorSize) / 2}rem`,
    zIndex: "0",
    // Make it clear that you can click on the scrubber to change the progress.
    cursor: "pointer",
});

const scrubberThumbIndicatorShared: ComplexStyleRule = {
    zIndex: "10",
    position: "absolute",
    width: scrubberThumbIndicatorSize,
    height: scrubberThumbIndicatorSize,
    borderRadius: borderRadius["full"],
    backgroundColor: colorSchemeVars["grey-90"],
    pointerEvents: "none",
    boxShadow: "0px 1px 2px 0px rgb(18 18 20 / 0.1)",
};

export const durationScrubberThumbIndicatorClassName = style({
    top: `calc(50% - ${spacing["1"]})`,
    left: `-${spacing["1"]}`,
    ...scrubberThumbIndicatorShared,
});

const scrubberThumbTargetShared: ComplexStyleRule = {
    zIndex: "-10",
    position: "absolute",
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
};

export const durationScrubberThumbTargetClassName = style({
    top: `calc(50% - ${spacing["3"]})`,
    left: `-${spacing["3"]}`,
    ...scrubberThumbTargetShared,
});

const scrubberTrackShared: ComplexStyleRule = {
    zIndex: "0",
    position: "absolute",
    backgroundColor: colorSchemeVars["grey-10"],
    borderRadius: borderRadius["full"],
    overflow: "hidden",
    // Don't interfere with thumb pointer events.
    pointerEvents: "none",
};

export const scrubberTrackClassName = style({
    top: "calc(50% - 2px)",
    left: "0",
    right: "0",
    height: "4px",
    ...scrubberTrackShared,
});

const scrubberTrackProgressShared: ComplexStyleRule = {
    zIndex: "20",
    position: "absolute",
    inset: "0",
    backgroundColor: colorSchemeVars["theme-40"],
};

export const durationScrubberTrackProgressClassName = style({
    transformOrigin: "left",
    ...scrubberTrackProgressShared,
});

export const durationScrubberTrackBufferedClassName = style({
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

/**
 * Class added to `containerClassName` that tells us if video volume is muted.
 */
export const volumeMutedClassName = style({});

/**
 * Class added to `containerClassName` that tells us if video volume is low.
 */
export const volumeLowClassName = style({});

/**
 * Class added to `containerClassName` that tells us if video volume is medium.
 */
export const volumeMediumClassName = style({});

/**
 * Class added to `containerClassName` that tells us if video volume is loud.
 */
export const volumeHighClassName = style({});

export const volumeButtonClassName = style({
    marginLeft: spacing["1"],
    padding: `0 ${spacing["1"]}`,
    width: spacing["6"],
    height: spacing["6"],
    borderRadius: borderRadius["0.5"],
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
});

globalStyle(`${containerClassName} ${volumeButtonClassName} > svg`, {
    display: "none",
});

// Matches volumeClassNameOrder
[volumeMutedClassName, volumeLowClassName, volumeMediumClassName, volumeHighClassName].forEach(
    (className, i) => {
        globalStyle(
            `${containerClassName}${className} ${volumeButtonClassName} > svg:nth-of-type(${
                i + 1
            })`,
            {display: "block"},
        );
    },
);

// On server render before our JavaScript code has set a volume class, display
// the volume high icon. This is only important for audio files since video
// files don't show the volume button until you press play.
globalStyle(
    `${containerClassName}:not(${volumeMutedClassName}):not(${volumeLowClassName}):not(${volumeMediumClassName}):not(${volumeHighClassName}) ${volumeButtonClassName} > svg:nth-of-type(4)`,
    {display: "block"},
);

export const volumeScrubberClassName = style({
    height: `calc(100% + ${scrubberThumbIndicatorSize})`,
    // Larger width than our contents to provide a larger touch target for the
    // mouse cursor.
    width: spacing["3"],
    position: "relative",
    top: "0",
    zIndex: "0",
    // Make it clear that you can click on the scrubber to change the progress.
    cursor: "pointer",
});

export const volumeSelectorClassName = style({
    position: "absolute",
    bottom: addRemLengths(spacing["8"], spacing["2.5"]),
    padding: `${spacing["5"]} 0`,
    width: spacing["8"],
    height: spacing["24"],
    backgroundColor: colorSchemeVars["grey-0"],
    borderRadius: borderRadius["full"],
    opacity: 0,
    pointerEvents: "none",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: "10",
    boxShadow: elevationVars["elevation-5"],
});

export const volumeSelectorVisibleClassName = style({
    pointerEvents: "auto",
    animation: overlayAnimateFadeInFromTopAnimation,
});

export const volumeSelectorWasVisibleClassName = style({
    selectors: {
        [`&:not(${volumeSelectorVisibleClassName})`]: {
            animation: overlayAnimateFadeOutFromTopAnimation,
        },
    },
});

export const volumeTrackClassName = style({
    left: "calc(50% - 2px)",
    top: "0",
    bottom: "0",
    width: "4px",
    ...scrubberTrackShared,
});

export const volumeScrubberThumbIndicatorClassName = style({
    left: `calc(50% - ${spacing["1"]})`,
    top: `-${spacing["1"]}`,
    ...scrubberThumbIndicatorShared,
});

export const volumeScrubberThumbTargetClassName = style({
    left: `calc(50% - ${spacing["3"]})`,
    top: `-${spacing["3"]}`,
    ...scrubberThumbTargetShared,
});

export const volumeScrubberTrackProgressClassName = style({
    transformOrigin: "bottom",
    ...scrubberTrackProgressShared,
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
