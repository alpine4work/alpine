import {
    SpacingScale,
    mediumSpacingScaleMinWindowWidth,
} from "~/shared/design/core/spacing_scale.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {goldenRatio} from "~/shared/helpers/number/golden_ratio.js";

export const scalableDemoDefaultViewportWidth = 1280;

export const scalableDemoDefaultViewport = {
    width: 1280,
    height: Math.round(scalableDemoDefaultViewportWidth / goldenRatio),
};

// Double check that we're using a medium spacing scale for our demo videos.
assert(scalableDemoDefaultViewportWidth >= mediumSpacingScaleMinWindowWidth);

export const scalableDemoDefaultViewportSpacingScale: SpacingScale = "medium";
