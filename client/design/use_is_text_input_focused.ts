import {useCallback, useEffect, useRef, useState} from "react";
import {useIsBehindMobileFullScreenModal} from "~/client/design/mobile_full_screen_modal.js";
import {useOverlayRootBlockingPortalElement} from "~/client/design/overlay.js";
import {isTextInputElement} from "~/client/helpers/elements/is_text_input_element.js";
import {useIsInitialAppRender} from "~/client/helpers/lifecycle/use_is_initial_app_render.js";
import {useIsInertNativeMobileRoute} from "~/client/remix/use_is_inert_native_mobile_route.js";

/**
 * Keep track of whether any text input on the web page is focused. Useful when
 * dealing with the mobile keyboard which will open if any text input is
 * focused.
 *
 * We've observed that mobile Safari won't dispatch a `focusout` event if the
 * focused element is removed from the DOM. In this case you may call
 * `reconcileFocusedTextInput()` to detect if the previously focused element
 * has been removed and update our state.
 *
 * If there's a `<FocusScope contain>` on the page then this hook will only
 * return true if rendered inside of that focus scope. This is useful for
 * components like `<MobileFullScreenModal>` so focus within the modal (which
 * has `<FocusScope contain>`) does not change the inert UI underneath.
 */
export function useIsTextInputFocused({isDisabled = false}: {isDisabled?: boolean} = {}): {
    isTextInputFocused: boolean;
    reconcileFocusedTextInput: () => void;
} {
    // Set `isDisabled` to true if we're in an inert native mobile route.
    const isInertNativeMobileRoute = useIsInertNativeMobileRoute();
    const isBehindMobileFullScreenModal = useIsBehindMobileFullScreenModal();
    const isInert = isInertNativeMobileRoute || isBehindMobileFullScreenModal;
    isDisabled ||= isInert;

    const isInitialAppRender = useIsInitialAppRender();
    const rootBlockingPortalElement = useOverlayRootBlockingPortalElement();

    const getIsTextInputFocused = useCallback(() => {
        return (
            document.activeElement instanceof Element &&
            isTextInputElement(document.activeElement) &&
            // Don't show "Done" button if the focused text input is in the blocking
            // overlay container. Since any press outside the blocking overlay will unfocus
            // the element (by closing the overlay). Furthermore, if we showed the done
            // button it wouldn't be visible.
            //
            // We added this for the assignee task filter on mobile (and the collection
            // task filter). It has a search input in a blocking overlay. We don't want to
            // show the "Done" button while the search input is focused.
            //
            // TODO(calebmer): Maybe we should abstract this so this logic only applies to
            // the "Done" button. Through like a `shouldIgnore` function or something.
            !rootBlockingPortalElement?.contains(document.activeElement)
        );
    }, [rootBlockingPortalElement]);

    const [isTextInputFocusedFromState, setIsTextInputFocused] = useState(
        // If the component remounts after initial render, check the current active
        // element.
        () => !isInitialAppRender && !isDisabled && getIsTextInputFocused(),
    );
    let isTextInputFocused = isTextInputFocusedFromState;

    if (isTextInputFocusedFromState && isDisabled) {
        setIsTextInputFocused(false);
        isTextInputFocused = false;
    }

    const focusedTextInputRef = useRef<Element | null>(null);

    useEffect(() => {
        if (isDisabled) return;

        const handleFocusChange = () => {
            const newIsTextInputFocused = getIsTextInputFocused();

            setIsTextInputFocused(newIsTextInputFocused);
            focusedTextInputRef.current = newIsTextInputFocused ? document.activeElement : null;
        };

        // Initialize our state.
        handleFocusChange();

        document.addEventListener("focusin", handleFocusChange);
        document.addEventListener("focusout", handleFocusChange);
        return () => {
            document.removeEventListener("focusin", handleFocusChange);
            document.removeEventListener("focusout", handleFocusChange);
        };
    }, [isDisabled, getIsTextInputFocused]);

    const reconcileFocusedTextInput = useCallback(() => {
        if (
            focusedTextInputRef.current &&
            document.activeElement !== focusedTextInputRef.current &&
            !document.body.contains(focusedTextInputRef.current)
        ) {
            setIsTextInputFocused(false);
            focusedTextInputRef.current = null;
        }
    }, []);

    return {
        isTextInputFocused,
        reconcileFocusedTextInput,
    };
}
