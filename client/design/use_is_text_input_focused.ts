import {useCallback, useEffect, useRef, useState} from "react";
import {useIsBehindMobileFullScreenModal} from "~/client/design/mobile_full_screen_modal.js";
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

    const getIsTextInputFocused = useCallback((focusedElement: Element | null) => {
        if (!(focusedElement instanceof Element)) return false;
        if (!isTextInputElement(focusedElement)) return false;

        // Don't show "Done" button if the focused text input has a popup
        // (`role="combobox"` [implicitly has `aria-haspopup="listbox"`][1]). These
        // inputs come with an overlay and so dismissing the input means clicking
        // outside of the overlay. Since the interaction for dismissing the keyboard
        // for the input is obvious we don't show a "Done" button. Also because often
        // autocomplete inputs have a blocking cover (they set `isBlocking={true}` on
        // their `<Overlay>`) you wouldn't be able to interact with the "Done" button
        // anyway.
        //
        // We added this for the assignee task filter on mobile (and the collection
        // task filter). It has a search input in a blocking overlay. We don't want to
        // show the "Done" button while the search input is focused. We also want this
        // to apply to inputs like `<TaskAssigneeInput>` in a detail view.
        //
        // TODO(calebmer): Maybe we should abstract this so this logic only applies to
        // the "Done" button. Through like a `shouldIgnore` function or something.
        //
        // [1]: https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Attributes/aria-haspopup
        const ariaHasPopup =
            focusedElement.ariaHasPopup ?? (focusedElement.role === "combobox" ? "listbox" : null);
        if (ariaHasPopup !== null) return false;

        return true;
    }, []);

    const [isTextInputFocusedFromState, setIsTextInputFocused] = useState(
        // If the component remounts after initial render, check the current active
        // element.
        () => !isInitialAppRender && !isDisabled && getIsTextInputFocused(document.activeElement),
    );
    let isTextInputFocused = isTextInputFocusedFromState;

    if (isTextInputFocusedFromState && isDisabled) {
        setIsTextInputFocused(false);
        isTextInputFocused = false;
    }

    const focusedTextInputRef = useRef<Element | null>(null);

    useEffect(() => {
        if (isDisabled) return;

        const handleFocusChange = (event?: FocusEvent) => {
            const focusedElement =
                !event || event.type === "focusin"
                    ? document.activeElement
                    : (event.relatedTarget as Element);

            const newIsTextInputFocused = getIsTextInputFocused(focusedElement);

            setIsTextInputFocused(newIsTextInputFocused);
            focusedTextInputRef.current = newIsTextInputFocused ? focusedElement : null;
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
