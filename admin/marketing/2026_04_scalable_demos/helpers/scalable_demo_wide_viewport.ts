import {
    SpacingScale,
    mediumSpacingScaleMinWindowWidth,
} from "~/shared/design/core/spacing_scale.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {goldenRatio} from "~/shared/helpers/number/golden_ratio.js";

/**
 * Prefer the default viewport size which is better for viewing the demo on a
 * mobile device.
 */
export const scalableDemoWideViewportWidth = 1280;

/**
 * Prefer the default viewport size which is better for viewing the demo on a
 * mobile device.
 */
export const scalableDemoWideViewport = {
    width: scalableDemoWideViewportWidth,
    height: Math.round(scalableDemoWideViewportWidth / goldenRatio),
};

// Double check that we're using a medium spacing scale for our demo videos.
assert(scalableDemoWideViewportWidth >= mediumSpacingScaleMinWindowWidth);

/**
 * Prefer the default viewport size which is better for viewing the demo on a
 * mobile device.
 */
export const scalableDemoWideViewportSpacingScale: SpacingScale = "medium";
