import {useCallback, useRef} from "react";
import {useLayoutEffectWithoutServerSideWarning} from "~/client/web/helpers/lifecycle/use_layout_effect_without_server_side_warning.js";

/**
 * Provides a function that returns true when the component is mounted and false
 * when the component is unmounted.
 */
export function useIsMounted(): () => boolean {
    const mountedRef = useRef(false);

    // Safe since this layout effect does not change the UI.
    useLayoutEffectWithoutServerSideWarning(() => {
        mountedRef.current = true;
        return () => {
            mountedRef.current = false;
        };
    }, []);

    return useCallback(() => mountedRef.current, []);
}
