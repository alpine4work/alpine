import {useEffect, useState} from "react";
import {useClientInfo} from "~/client/helpers/client_info_context";
import {useIsInitialAppRender} from "~/client/helpers/lifecycle/use_is_initial_app_render";
import {
    getRemPxFromScreenWidth,
    mobilePlatformMediaQuery,
    remPxByPlatform,
} from "~/shared/design/spacing";

/**
 * Get the number of pixels in 1rem.
 *
 * When server-side rendering we will use the screen width in our client info
 * cookie. If that screen width is inconsistent with the actual browser the
 * user may see a flash after server-side rendering so be careful. If the
 * screen width is unknown, we assume a desktop platform.
 */
export function useRemPx(): number {
    const {screenWidth} = useClientInfo();
    const isInitialAppRender = useIsInitialAppRender();

    const [remPx, setRemPx] = useState(() => {
        if (isInitialAppRender) {
            return getRemPxFromScreenWidth(screenWidth);
        } else {
            return getRemPxWithoutListening();
        }
    });

    useEffect(() => {
        const mediaQueryList = window.matchMedia(mobilePlatformMediaQuery);

        const update = () => {
            setRemPx(mediaQueryList.matches ? remPxByPlatform.mobile : remPxByPlatform.desktop);
        };

        // In case the value changed since the time component rendered.
        update();

        mediaQueryList.addEventListener("change", update);
        return () => {
            mediaQueryList.removeEventListener("change", update);
        };
    }, []);

    return remPx;
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
