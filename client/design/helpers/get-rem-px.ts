import {mobilePlatformMediaQuery, remPxByPlatform} from "~/shared/design/spacing";

/**
 * Get the current pixels in 1rem.
 */
export function getRemPx() {
    return window.matchMedia(mobilePlatformMediaQuery).matches
        ? remPxByPlatform.mobile
        : remPxByPlatform.desktop;
}
