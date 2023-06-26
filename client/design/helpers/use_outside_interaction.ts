import {RefCallback, useCallback, useEffect, useRef} from "react";
import {isElementOwnedBy} from "~/client/helpers/elements/is_element_owned_by.js";
import {useLayoutEffectWithoutServerSideWarning} from "~/client/helpers/lifecycle/use_layout_effect_without_server_side_warning.js";

/**
 * If the user pressed an element outside of the returned ref then we call the
 * provided callback.
 */
export function useOutsidePress(onOutsidePress: (event: Event) => void) {
    return useOutsideInteraction(onOutsidePress, {withoutFocus: true});
}

export function useOutsideInteraction(
    onOutsideInteraction: (event: Event) => void,
    {
        withoutPress = false,
        withoutFocus = false,
    }: {
        withoutPress?: boolean;
        withoutFocus?: boolean;
    } = {},
): RefCallback<HTMLElement> {
    const ref = useRef<HTMLElement | null>(null);

    const onOutsideInteractionRef = useRef(onOutsideInteraction);
    useLayoutEffectWithoutServerSideWarning(() => {
        onOutsideInteractionRef.current = onOutsideInteraction;
    });

    useEffect(() => {
        const listener = (event: Event) => {
            // We don't want to call our listener if the component this is attached to
            // hasn't mounted.
            if (!ref.current) return;

            if (event.target instanceof Element && !isElementOwnedBy(ref.current, event.target)) {
                onOutsideInteractionRef.current(event);
            }
        };

        // Use capture events so that our outside interaction handler runs before
        // everyone else. If it's being used to close an overlay then that will happen
        // first.

        if (!withoutPress) {
            window.addEventListener("pointerdown", listener, true);
            window.addEventListener("touchstart", listener, true);
        }

        if (!withoutFocus) {
            window.addEventListener("focus", listener, true);
        }

        return () => {
            if (!withoutPress) {
                window.removeEventListener("pointerdown", listener, true);
                window.removeEventListener("touchstart", listener, true);
            }

            if (!withoutFocus) {
                window.removeEventListener("focus", listener, true);
            }
        };
    }, [withoutFocus, withoutPress]);

    return useCallback((element: HTMLElement | null) => {
        ref.current = element;
    }, []);
}
