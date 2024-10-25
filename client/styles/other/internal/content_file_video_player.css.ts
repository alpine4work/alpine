import {globalStyle, keyframes, style} from "@vanilla-extract/css";
import {
    borderRadius,
    colorSchemeVars,
    darkColorSchemeSelector,
    elevation,
    fontSizes,
} from "~/client/styles/core/styles_core.js";
import {spacing} from "~/shared/design/core/spacing.js";
import {delayLoadingIndicatorLimitMs} from "~/shared/design/core/timing.js";

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
 * Class added to `containerClassName` that tells us if our video container
 * element is currently fullscreen.
 */
export const fullscreenClassName = style({});

/**
 * Class added to `containerClassName` when the pointer is hovering over the
 * element.
 */
export const hoveredClassName = style({});

/**
 * Class added to `controlsContainerClassName` when the pointer is hovering
 * over the element.
 */
export const hoveredControlsClassName = style({});

/**
 * Class added to `containerClassName` when the pointer is hovering over the
 * video and hasn't moved for a while. When this class is added we should hide
 * the video controls.
 */
export const stillPointerClassName = style({});

/**
 * Class added to `containerClassName` while we're dragging the scrubber thumb.
 */
export const draggingScrubberThumbClassName = style({});

export const containerClassName = style({
    position: "absolute",
    inset: "0",
    width: "100%",
    height: "100%",
    // We need this to allow pointer events on the video element when full
    // screened. Clicking on the video when fullscreen-ed should cause the video
    // to pause/play.
    //
    // This also allows our `controlsClassName` element to be clickable and lets us
    // receive `pointerenter`/`pointerleave` events.
    pointerEvents: "auto",
    selectors: {
        [`&${fullscreenClassName}`]: {
            // Override our parent's `cursor: pointer` style when fullscreen. Clicking on
            // the video won't select the file element in the document anymore.
            cursor: "default",
            // Pure black background color for the container when fullscreened. In case the
            // video needs to be [letter-boxed][1].
            //
            // [1]: https://en.wikipedia.org/wiki/Letterboxing_(filming)
            backgroundColor: "black",
        },
        [`&${playingClassName}${stillPointerClassName}`]: {
            cursor: "none",
        },
    },
});

const playIndicatorWaitingAnimationKeyframesStartPercent = 0.99;

const playIndicatorWaitingAnimationKeyframes = keyframes({
    "0%": {opacity: 0},
    [`${playIndicatorWaitingAnimationKeyframesStartPercent * 100}%`]: {opacity: 0},
    "100%": {opacity: 1},
});

export const playIndicatorClassName = style({
    pointerEvents: "none",
    // Render above `videoClassName` and under `fileClassName`'s `::before` press
    // pseudo element.
    zIndex: "30",
    position: "absolute",
    top: "50%",
    left: "50%",
    transform: "translate(-50%, -50%)",
    width: spacing["14"],
    height: spacing["14"],
    borderRadius: borderRadius["full"],
    // Add elevation so we can easily see our floating elements on a white
    // background.
    boxShadow: elevation["elevation-5"].light,
    color: colorSchemeVars["grey-90"],
    backgroundColor: colorSchemeVars["grey-0"],
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
    selectors: {
        [`${containerClassName}${playingClassName}:not(${waitingClassName}) &`]: {
            display: "none",
        },
        [`${containerClassName}${playingClassName}${waitingClassName} &`]: {
            // Use a CSS animation as a way to delay showing our loading indicator.
            animation: `${playIndicatorWaitingAnimationKeyframes} ${
                delayLoadingIndicatorLimitMs *
                (1 / playIndicatorWaitingAnimationKeyframesStartPercent)
            }ms linear forwards`,
        },
        [`${darkColorSchemeSelector} &`]: {
            boxShadow: elevation["elevation-5"].darkElevated1,
        },
    },
});

globalStyle(`${playIndicatorClassName} > svg`, {
    width: spacing["7"],
    height: spacing["7"],
});

globalStyle(`${playIndicatorClassName} > svg:last-child`, {
    color: colorSchemeVars["grey-60"],
});

globalStyle(
    `${containerClassName}${waitingClassName} ${playIndicatorClassName} > svg:first-child`,
    {
        display: "none",
    },
);

globalStyle(
    `${containerClassName}:not(${waitingClassName}) ${playIndicatorClassName} > svg:last-child`,
    {
        display: "none",
    },
);

export const durationPreviewClassName = style({
    pointerEvents: "none",
    // Render above `videoClassName` and under `fileClassName`'s `::before` press
    // pseudo element.
    zIndex: "30",
    position: "absolute",
    right: spacing["1"],
    bottom: spacing["1"],
    color: colorSchemeVars["grey-90"],
    backgroundColor: colorSchemeVars["grey-0"],
    borderRadius: borderRadius["0.5"],
    // Add elevation so we can easily see our floating elements on a white
    // background.
    boxShadow: elevation["elevation-5"].light,
    paddingLeft: spacing["1"],
    paddingRight: spacing["1"],
    paddingTop: spacing["0.5"],
    paddingBottom: spacing["0.5"],
    fontVariantNumeric: "tabular-nums",
    display: "flex",
    alignItems: "center",
    selectors: {
        [`${containerClassName}${hasPlayedClassName} &`]: {
            display: "none",
        },
        [`${darkColorSchemeSelector} &`]: {
            boxShadow: elevation["elevation-5"].darkElevated1,
        },
    },
});

export const videoClassName = style({
    zIndex: "20",
    position: "absolute",
    inset: "0",
    width: "100%",
    height: "100%",
    objectPosition: "center top",
    objectFit: "cover",
    selectors: {
        [`${containerClassName}:not(${hasPlayedClassName}) &`]: {
            display: "none",
        },
        [`${containerClassName}${fullscreenClassName} &`]: {
            // When full screened, make sure the user can see the entire video even if it
            // doesn't perfectly fit. We'll show a black box outside the video's bounds.
            objectPosition: "center",
            objectFit: "contain",
        },
        [`${containerClassName}:not(${fullscreenClassName}) &`]: {
            // Make sure the video has `pointer-events: none` when not fullscreened. This
            // is because we've observed `dragleave` events with an `event.relatedTarget`
            // of a pseudo element not in the DOM when hovering over video elements that
            // breaks our drag/drop handling.
            //
            // When not fullscreened pressing on the preview will handle play/pause for the
            // video.
            pointerEvents: "none",
        },
    },
});

const controlsContainerHideKeyframes = keyframes({
    "0%": {opacity: 1},
    "100%": {opacity: 0, display: "none"},
});

export const controlsContainerClassName = style({
    // Render above `videoClassName` and above `fileClassName`'s `::before` press
    // pseudo element. But under `fileClassName`'s `::after` pseudo element.
    zIndex: "50",
    position: "absolute",
    left: "0",
    right: "0",
    bottom: "0",
    paddingLeft: spacing["1"],
    paddingRight: spacing["1"],
    paddingBottom: spacing["1"],
    cursor: "default",
    pointerEvents: "auto",
    selectors: {
        [`${containerClassName}:not(${hasPlayedClassName}) &`]: {
            display: "none",
        },
        [`${containerClassName}${playingClassName}:not(${hoveredClassName}):not(${draggingScrubberThumbClassName}) &`]:
            {
                animation: `${controlsContainerHideKeyframes} 250ms 1000ms ease-out forwards`,
            },
        [`${containerClassName}${playingClassName}${stillPointerClassName}:not(${draggingScrubberThumbClassName}) &`]:
            {
                animation: `${controlsContainerHideKeyframes} 250ms ease-out forwards`,
            },
    },
});

export const controlsClassName = style({
    width: "100%",
    height: spacing["8"],
    color: colorSchemeVars["grey-90"],
    backgroundColor: colorSchemeVars["grey-0"],
    borderRadius: borderRadius["0.5"],
    // Add elevation so we can easily see our floating elements on a white
    // background.
    boxShadow: elevation["elevation-5"].light,
    display: "flex",
    alignItems: "center",
    selectors: {
        [`${darkColorSchemeSelector} &`]: {
            boxShadow: elevation["elevation-5"].darkElevated1,
        },
    },
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
    paddingLeft: spacing["3"],
    paddingRight: spacing["2"],
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
    selectors: {
        "&::after": {
            content: "attr(data-rate)",
        },
    },
});

export const fullscreenButtonClassName = style({
    marginRight: spacing["1"],
    width: spacing["6"],
    height: spacing["6"],
    borderRadius: borderRadius["0.5"],
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
});

globalStyle(`${fullscreenButtonClassName} > svg`, {
    width: spacing["4"],
    height: spacing["4"],
});

globalStyle(
    `${containerClassName}${fullscreenClassName} ${fullscreenButtonClassName} > svg:first-child`,
    {
        display: "none",
    },
);

globalStyle(
    `${containerClassName}:not(${fullscreenClassName}) ${fullscreenButtonClassName} > svg:last-child`,
    {
        display: "none",
    },
);
