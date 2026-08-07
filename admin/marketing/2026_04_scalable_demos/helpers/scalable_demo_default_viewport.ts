import {mobilePlatformMaxWindowWidth} from "~/shared/design/core/platform.open_source.js";
import {SpacingScale} from "~/shared/design/core/spacing_scale.open_source.js";
import {goldenRatio} from "~/shared/helpers/number/golden_ratio.js";

/**
 * The smallest possible viewport width that's still the `desktop` platform.
 */
export const scalableDemoDefaultViewportWidth = mobilePlatformMaxWindowWidth + 1;

export const scalableDemoDefaultViewport = {
    width: scalableDemoDefaultViewportWidth,
    height: Math.round(scalableDemoDefaultViewportWidth / goldenRatio),
};

export const scalableDemoNarrowViewportSpacingScale: SpacingScale = "small";
