import {globalStyle, keyframes, style} from "@vanilla-extract/css";
import {
    colorSchemeVars,
    darkColorSchemeSelector,
    fontSizes,
    fontStyles,
} from "~/client/styles/core/styles_core.js";
import {
    playingClassName,
    waitingClassName,
} from "~/client/styles/other/internal/content_file_video_and_audio_player_controls.css.js";
import {borderRadius} from "~/shared/design/core/border_radius.js";
import {parseRemLength, spacing} from "~/shared/design/core/spacing.js";
import {delayLoadingIndicatorLimitMs} from "~/shared/design/core/timing.js";

export const containerClassName = style({
    width: "100%",
    height: "100%",
    display: "flex",
    flexDirection: "column",
    backgroundColor: colorSchemeVars["grey-0"],
});

export const visualizationClassName = style({
    zIndex: "0",
    position: "relative",
    flexGrow: "1",
    display: "flex",
    flexDirection: "column",
    justifyContent: "center",
    paddingTop: spacing["4"],
    paddingLeft: spacing["4"],
    paddingRight: spacing["4"],
    // Don't allow item to grow beyond flexbox bounds. By default flexbox items
    // have `min-width: auto` which extends with content.
    // https://stackoverflow.com/a/66689926/1568890
    minWidth: 0,
});

globalStyle(`${visualizationClassName} > svg`, {
    width: "fit-content",
    maxWidth: "100%",
    fill: colorSchemeVars["theme-40-const"],
});

globalStyle(`${darkColorSchemeSelector} ${visualizationClassName} > svg`, {
    width: "fit-content",
    maxWidth: "100%",
    fill: colorSchemeVars["theme-50-const"],
});

const loadingIndicatorSize = spacing["10"];
const loadingIndicatorIconSize = spacing["7"];

const loadingIndicatorAnimationKeyframesStartPercent = 0.99;

const loadingIndicatorAnimationKeyframes = keyframes({
    "0%": {opacity: 0},
    [`${loadingIndicatorAnimationKeyframesStartPercent * 100}%`]: {opacity: 0},
    "100%": {opacity: 1},
});

export const loadingIndicatorClassName = style({
    zIndex: "10",
    position: "absolute",
    top: `calc(50% - ${parseRemLength(loadingIndicatorSize) / 2 - parseRemLength("4") / 2}rem)`,
    left: `calc(50% - ${parseRemLength(loadingIndicatorSize) / 2}rem)`,
    width: loadingIndicatorSize,
    height: loadingIndicatorSize,
    color: colorSchemeVars["grey-90"],
    backgroundColor: colorSchemeVars["grey-0"],
    borderRadius: borderRadius["full"],
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
    selectors: {
        [`${containerClassName}:not(${playingClassName}) &`]: {
            display: "none",
        },
        [`${containerClassName}${playingClassName}:not(${waitingClassName}) &`]: {
            display: "none",
        },
        [`${containerClassName}${playingClassName}${waitingClassName} &`]: {
            // Use a CSS animation as a way to delay showing our loading indicator.
            animation: `${loadingIndicatorAnimationKeyframes} ${
                delayLoadingIndicatorLimitMs * (1 / loadingIndicatorAnimationKeyframesStartPercent)
            }ms linear forwards`,
        },
    },
});

globalStyle(`${loadingIndicatorClassName} > svg`, {
    width: loadingIndicatorIconSize,
    height: loadingIndicatorIconSize,
});

export const controlsContainerClassName = style({
    flexShrink: "0",
    width: "100%",
    padding: spacing["1"],
    paddingRight: spacing["2"],
    pointerEvents: "all",
    cursor: "default",
});

export const metadataClassName = style({
    flexShrink: "0",
    width: "100%",
    overflow: "hidden",
    paddingTop: spacing["1"],
    paddingBottom: spacing["1"],
    paddingLeft: spacing["4"],
    paddingRight: spacing["4"],
    display: "flex",
    alignItems: "center",
});

export const metadataIconClassName = style({
    flexShrink: "0",
    marginRight: spacing["3"],
    width: spacing["5"],
    height: spacing["5"],
    color: colorSchemeVars["grey-70"],
});

export const metadataContentClassName = style({
    // Don't allow item to grow beyond flexbox bounds. By default flexbox items
    // have `min-width: auto` which extends with content.
    // https://stackoverflow.com/a/66689926/1568890
    minWidth: 0,
});

export const metadataTitleClassName = style({
    ...fontSizes["300"],
    ...fontStyles["truncate-semi-bold"],
});

export const metadataArtistClassName = style({
    ...fontSizes["75"],
    ...fontStyles["truncate"],
    color: colorSchemeVars["grey-80"],
});
