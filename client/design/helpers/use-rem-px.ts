import {useEffect, useState} from "react";
import {useIsInitialAppRender} from "~/client/helpers/lifecycle/use-is-initial-app-render";
import {mobilePlatformMediaQuery, remPxByPlatform} from "~/shared/design/spacing";

/**
 * Get the number of pixels in 1rem.
 *
 * Returns null when the hook runs on the server since the server does not know
 * the browser window size.
 */
// TODO(calebmer): Put media queries we care about into browser cookies so we
// can server render using those values?
export function useRemPx(): number | null {
    const isInitialAppRender = useIsInitialAppRender();

    const [remPx, setRemPx] = useState(() =>
        isInitialAppRender ? null : getRemPxWithoutListening(),
    );

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
