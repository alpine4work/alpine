import {mobilePlatformMaxWindowWidth} from "~/shared/design/core/platform.js";
import {SpacingScale} from "~/shared/design/core/spacing_scale.js";

/**
 * The smallest possible viewport width that's still the `desktop` platform.
 */
export const scalableDemoNarrowViewportWidth = mobilePlatformMaxWindowWidth + 1;

export const scalableDemoNarrowViewportSpacingScale: SpacingScale = "small";
