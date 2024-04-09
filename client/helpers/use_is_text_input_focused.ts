import {useCallback, useEffect, useRef, useState} from "react";
import {useOverlayRootBlockingPortalElement} from "~/client/design/overlay.js";
import {isTextInputElement} from "~/client/helpers/elements/is_text_input_element.js";
import {useIsInitialAppRender} from "~/client/helpers/lifecycle/use_is_initial_app_render.js";

/**
 * Keep track of whether any text input on the web page is focused. Useful when
 * dealing with the mobile keyboard which will open if any text input is
 * focused.
 *
 * We've observed that mobile Safari won't dispatch a `focusout` event if the
 * focused element is removed from the DOM. In this case you may call
 * `reconcileFocusedTextInput()` to detect if the previously focused element
 * has been removed and update our state.
 */
export function useIsTextInputFocused({isDisabled = false}: {isDisabled?: boolean} = {}): {
    isTextInputFocused: boolean;
    reconcileFocusedTextInput: () => void;
} {
    const isInitialAppRender = useIsInitialAppRender();
    const rootBlockingPortalElement = useOverlayRootBlockingPortalElement();

    const getIsTextInputFocused = useCallback(
        () =>
            document.activeElement instanceof Element &&
            isTextInputElement(document.activeElement) &&
            // Don't show "Done" button if the focused text input is in the blocking
            // overlay container. Since any press outside the blocking overlay will unfocus
            // the element (by closing the overlay). Furthermore, if we showed the done
            // button it wouldn't be visible.
            //
            // The case we added this for is the assignee task filter. It has a search
            // input in a blocking overlay.
            //
            // TODO(calebmer): Maybe we should abstract this so this logic only applies to
            // the "Done" button. Through like a `shouldIgnore` function or something.
            !rootBlockingPortalElement?.contains(document.activeElement),
        [rootBlockingPortalElement],
    );

    const [isTextInputFocused, setIsTextInputFocused] = useState(
        // If the component remounts after initial render, check the current active
        // element.
        () => !isInitialAppRender && !isDisabled && getIsTextInputFocused(),
    );
    if (isTextInputFocused && isDisabled) setIsTextInputFocused(false);
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
