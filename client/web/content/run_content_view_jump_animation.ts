import Color from "color";
import {AnimationPlaybackControls, animate} from "motion";
import {getColorSchemeWithoutListeningIfBrowser} from "~/client/web/helpers/color_scheme.js";
import {contentStyles} from "~/client/web/styles/styles.js";
import {easeOutCubic} from "~/shared/design/core/easing.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";

export const jumpAnimationDurationMs = 3000;
export const jumpAnimationFadeInDurationMs = 70;
export const jumpAnimationFadeOutDurationMs = 500;
export const jumpAnimationSolidDurationMs =
    jumpAnimationDurationMs - jumpAnimationFadeInDurationMs - jumpAnimationFadeOutDurationMs;

export type JumpAnimationHighlightType = "Fill" | "Border";

/**
 * Run the jump highlight animation on an element. The animation fades in a color,
 * holds it, then fades out. The animation is synchronized based on the provided
 * `startTime` so multiple elements can animate together.
 *
 * - `"Fill"` (default): Animates the background color.
 * - `"Border"`: Animates the border color. Used for file-only messages where a
 *   background overlay would obscure the file previews.
 */
export function runContentViewJumpAnimation(
    element: HTMLElement,
    startTime: Date,
    {highlightType = "Fill"}: {highlightType?: JumpAnimationHighlightType} = {},
): AnimationPlaybackControls {
    const colorScheme = assertExists(getColorSchemeWithoutListeningIfBrowser());
    const baseColor = contentStyles.jumpAnimationBackgroundColor[colorScheme];
    const color = highlightType === "Border" ? Color(baseColor).alpha(1).hexa() : baseColor;
    const transparentColor = Color(baseColor).alpha(0).hexa();

    const property = highlightType === "Border" ? "borderColor" : "backgroundColor";

    const animation = animate([
        [element, {[property]: transparentColor}, {duration: 0}],
        [
            element,
            {[property]: color},
            {duration: jumpAnimationFadeInDurationMs / 1000, ease: "linear"},
        ],
        [element, {[property]: color}, {duration: jumpAnimationSolidDurationMs / 1000}],
        [
            element,
            {[property]: transparentColor},
            {duration: jumpAnimationFadeOutDurationMs / 1000, ease: easeOutCubic},
        ],
    ]);

    // Synchronize the animation based on the provided `startTime`.
    animation.time = (Date.now() - startTime.getTime()) / 1000;

    return animation;
}
