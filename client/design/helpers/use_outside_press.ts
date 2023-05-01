import {RefCallback, useCallback, useEffect, useRef} from "react";
import {isElementOwnedBy} from "~/client/helpers/elements/is_element_owned_by";
import {useLayoutEffectWithoutServerSideWarning} from "~/client/helpers/lifecycle/use_layout_effect_without_server_side_warning";

/**
 * If the user pressed an element outside of the returned ref then we call the
 * provided callback.
 */
export function useOutsidePress(onOutsidePress: (event: Event) => void): RefCallback<HTMLElement> {
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

            if (event.target instanceof Element && !isElementOwnedBy(ref.current, event.target)) {
                onOutsidePressRef.current(event);
            }
        };

        // Use capture events so that our outside press handler runs before everyone
        // else. If it's being used to close an overlay then that will happen first.
        document.addEventListener("pointerdown", listener, true);
        document.addEventListener("touchstart", listener, true);
        return () => {
            document.removeEventListener("pointerdown", listener, true);
            document.removeEventListener("touchstart", listener, true);
        };
    }, []);

    return useCallback((element: HTMLElement | null) => {
        ref.current = element;
    }, []);
}
