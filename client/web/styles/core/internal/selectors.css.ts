import {SpacingScale} from "~/shared/design/core/spacing_scale.js";

export const mobilePlatformSelector = ":root[data-platform=mobile]";
export const desktopPlatformSelector = ":root:not([data-platform=mobile])";

export const smallSpacingScaleSelector =
    ":root:not([data-spacing=large]):not([data-spacing=medium])";
export const mediumSpacingScaleSelector = ":root[data-spacing=medium]";
export const largeSpacingScaleSelector = ":root[data-spacing=large]";

export const selectorBySpacingScale: Record<SpacingScale, string> = {
    small: smallSpacingScaleSelector,
    medium: mediumSpacingScaleSelector,
    large: largeSpacingScaleSelector,
};
