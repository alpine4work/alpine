import {RefCallback, useCallback, useEffect, useRef} from "react";
import {useLayoutEffectWithoutServerSideWarning} from "~/client/helpers/lifecycle/use-layout-effect-without-server-side-warning";

/**
 * If the user pressed an element outside of the returned ref then we call the
 * provided callback.
 */
export function useOutsidePress(onOutsidePress: () => void): RefCallback<HTMLElement> {
    const ref = useRef<HTMLElement | null>(null);

    const onOutsidePressRef = useRef(onOutsidePress);
    useLayoutEffectWithoutServerSideWarning(() => {
        onOutsidePressRef.current = onOutsidePress;
    });

    useEffect(() => {
        const listener = (event: Event) => {
            // We don't want to call our listener if the component this is attached to
            // hasn't mounted.
            if (!ref.current) return;

            if (event.target instanceof Node && !ref.current.contains(event.target)) {
                onOutsidePressRef.current();
            }
        };

        // Use capture events so that our outside press handler runs before everyone
        // else. If it's being used to close an overlay then that will happen first.
        document.addEventListener("pointerup", listener, true);
        document.addEventListener("touchend", listener, true);
        return () => {
            document.removeEventListener("pointerup", listener, true);
            document.removeEventListener("touchend", listener, true);
        };
    }, []);

    return useCallback((element: HTMLElement | null) => {
        ref.current = element;
    }, []);
}
