import {useIsMobile} from "~/client/remix/use_is_mobile";
import {mobilePlatformMediaQuery, remPxByPlatform} from "~/shared/design/spacing";

/**
 * Get the number of pixels in 1rem.
 *
 * When server-side rendering we will use the screen width in our client info
 * cookie. If that screen width is inconsistent with the actual browser the
 * user may see a flash after server-side rendering so be careful. If the
 * screen width is unknown, we assume a desktop platform.
 */
export function useRemPx(): number {
    const isMobile = useIsMobile();
    return isMobile ? remPxByPlatform.mobile : remPxByPlatform.desktop;
}

/**
 * Get the current number of pixels in 1rem. Prefer `useRemPx()` so if the
 * screen size changes your component will re-render.
 */
export function getRemPxWithoutListening(): number {
    return window.matchMedia(mobilePlatformMediaQuery).matches
        ? remPxByPlatform.mobile
        : remPxByPlatform.desktop;
}
