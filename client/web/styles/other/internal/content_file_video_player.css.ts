import {globalStyle, keyframes, style} from "@vanilla-extract/css";
import {
    colorSchemeVars,
    darkColorSchemeSelector,
    elevation,
    fontSizes,
} from "~/client/web/styles/core/styles_core.js";
import {
    controlsClassName,
    draggingScrubberThumbClassName,
    draggingVolumeScrubberThumbClassName,
    hasPlayedClassName,
    playingClassName,
    waitingClassName,
} from "~/client/web/styles/other/internal/content_file_video_and_audio_player_controls.css.js";
import {borderRadius} from "~/shared/design/core/border_radius.js";
import {spacing} from "~/shared/design/core/spacing.js";
import {delayLoadingIndicatorLimitMs} from "~/shared/design/core/timing.js";

/**
 * Class added to `containerClassName` that tells us if our video container element
 * is currently fullscreen.
 */
export const fullscreenClassName = style({});

/**
 * Class added to `containerClassName` when the pointer is hovering over the
 * element.
 */
export const hoveredClassName = style({});

/**
 * Class added to `controlsContainerClassName` when the pointer is hovering over
 * the element.
 */
export const hoveredControlsClassName = style({});

/**
 * Class added to `containerClassName` when the pointer is hovering over the video
 * and hasn't moved for a while. When this class is added we should hide the video
 * controls.
 */
export const stillPointerClassName = style({});

export const containerClassName = style({
    position: "absolute",
    inset: "0",
    width: "100%",
    height: "100%",
    selectors: {
        // Beat the specificity of `${fileClassName} > *` setting `pointer-events: none`.
        "&&&": {
            // We need this to allow pointer events on the video element when full screened.
            // Clicking on the video when fullscreen-ed should cause the video to pause/play.
            //
            // This also allows our `controlsClassName` element to be clickable and lets us
            // receive `pointerenter`/`pointerleave` events.
            pointerEvents: "auto",
        },
        [`&${fullscreenClassName}`]: {
            // Override our parent's `cursor: pointer` style when fullscreen. Clicking on the
            // video won't select the file element in the document anymore.
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
    // Add elevation so we can easily see our floating elements on a white background.
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

export const smallPlayIndicatorClassName = style({
    width: spacing["10"],
    height: spacing["10"],
});

globalStyle(`${playIndicatorClassName}${smallPlayIndicatorClassName} > svg`, {
    width: spacing["5"],
    height: spacing["5"],
});

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
    // Add elevation so we can easily see our floating elements on a white background.
    boxShadow: elevation["elevation-5"].light,
    paddingLeft: spacing["1.5"],
    paddingRight: spacing["1.5"],
    paddingTop: spacing["1"],
    paddingBottom: spacing["1"],
    ...fontSizes["50"],
    fontVariantNumeric: "tabular-nums",
    selectors: {
        [`${containerClassName}${hasPlayedClassName} &`]: {
            display: "none",
        },
        [`${darkColorSchemeSelector} &`]: {
            boxShadow: elevation["elevation-5"].darkElevated1,
        },
    },
});

export const processingClassName = style({
    pointerEvents: "none",
    // Render above `videoClassName` and under `fileClassName`'s `::before` press
    // pseudo element.
    zIndex: "30",
    position: "absolute",
    inset: "0",
    width: "100%",
    height: "100%",
    display: "flex",
    flexDirection: "column",
    justifyContent: "center",
    alignItems: "center",
    textAlign: "center",
    gap: spacing["1.5"],
    color: colorSchemeVars["grey-40"],
    backgroundColor: colorSchemeVars["grey-0-opacity-80"],
    backdropFilter: "blur(10px)",
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
        // Hide the `<video>` until we know playback has started (`playing` adds
        // `hasPlayedClassName`). Do not use `display: none` here: Safari will often defer
        // decoding and never fire `playing` on the first load, so the video element stays
        // hidden. Keeping the video in the render tree with `opacity: 0` allows the
        // preview to show through and lets WebKit run its decoder.
        [`${containerClassName}:not(${hasPlayedClassName}) &`]: {
            opacity: 0,
            pointerEvents: "none",
        },
        [`${containerClassName}${fullscreenClassName} &`]: {
            // When full screened, make sure the user can see the entire video even if it
            // doesn't perfectly fit. We'll show a black box outside the video's bounds.
            objectPosition: "center",
            objectFit: "contain",
        },
        [`${containerClassName}:not(${fullscreenClassName}) &`]: {
            // Make sure the video has `pointer-events: none` when not fullscreened. This is
            // because we've observed `dragleave` events with an `event.relatedTarget` of a
            // pseudo element not in the DOM when hovering over video elements that breaks our
            // drag/drop handling.
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
        [`${containerClassName}${playingClassName}:not(${hoveredClassName}):not(${draggingScrubberThumbClassName}):not(${draggingVolumeScrubberThumbClassName}) &`]:
            {
                animation: `${controlsContainerHideKeyframes} 250ms 1000ms ease-out forwards`,
            },
        [`${containerClassName}${playingClassName}${stillPointerClassName}:not(${draggingScrubberThumbClassName}):not(${draggingVolumeScrubberThumbClassName}) &`]:
            {
                animation: `${controlsContainerHideKeyframes} 250ms ease-out forwards`,
            },
    },
});

globalStyle(`${controlsContainerClassName} > ${controlsClassName}`, {
    backgroundColor: colorSchemeVars["grey-0"],
    borderRadius: borderRadius["0.5"],
    // Add elevation so we can easily see our floating elements on a white background.
    boxShadow: elevation["elevation-5"].light,
});

globalStyle(`${darkColorSchemeSelector} ${controlsContainerClassName} > ${controlsClassName}`, {
    boxShadow: elevation["elevation-5"].darkElevated1,
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
