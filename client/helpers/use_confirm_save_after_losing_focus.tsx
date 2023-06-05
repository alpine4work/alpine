import {Ref, useCallback, useRef} from "react";
import {useOutsidePress} from "~/client/design/helpers/use_outside_press";
import {isElementOwnedBy} from "~/client/helpers/elements/is_element_owned_by";
import {useLayoutEffectWithoutServerSideWarning} from "~/client/helpers/lifecycle/use_layout_effect_without_server_side_warning";
import {useLifecycleRef} from "~/client/helpers/refs/use_lifecycle_ref";
import {useMergedRefs} from "~/client/helpers/refs/use_merged_refs";

/**
 * Helper for building editable elements that save inline. When the user
 * unfocuses the element they should be asked to confirm their changes.
 * Generally these elements also have an affordance that pressing enter will
 * also save.
 *
 * This hook detects when the editable element is unfocused thus we should
 * present the user with a confirmation dialog for their change.
 */
export function useConfirmSaveAfterLosingFocus<RefElement extends HTMLElement>({
    shouldConfirmSave,
    isConfirmingSave,
    onConfirmSave: _onConfirmSave,
    onCancelSave: _onCancelSave,
}: {
    shouldConfirmSave: boolean;
    isConfirmingSave: boolean;
    onConfirmSave: () => void;
    onCancelSave: () => void;
}): Ref<RefElement> {
    const onConfirmSaveRef = useRef(_onConfirmSave);
    const onCancelSaveRef = useRef(_onCancelSave);
    useLayoutEffectWithoutServerSideWarning(() => {
        onConfirmSaveRef.current = _onConfirmSave;
        onCancelSaveRef.current = _onCancelSave;
    });

    const lifecycleRef = useCallback(
        (element: RefElement) => {
            const handleFocusOut = (event: FocusEvent) => {
                // Ignore blur events where focus is moving within the element.
                //
                // We need to use element ownership instead of `document.body.contains()` to
                // handle modals.
                if (
                    event.relatedTarget instanceof Element &&
                    isElementOwnedBy(element, event.relatedTarget)
                ) {
                    return;
                }

                // If the user didn't type anything then close without asking
                // for confirmation.
                if (!shouldConfirmSave) {
                    onCancelSaveRef.current();
                    return;
                }

                onConfirmSaveRef.current();
            };

            element.addEventListener("focusout", handleFocusOut);
            return () => {
                element.removeEventListener("focusout", handleFocusOut);
            };
        },
        [shouldConfirmSave],
    );

    return useMergedRefs<RefElement>(
        useLifecycleRef(lifecycleRef),

        // Sometimes clicks outside an element do not move focus. So in addition to
        // `onBlur`, look for any clicks and show a confirmation dialog before closing
        // our input.
        useOutsidePress(event => {
            // The user may click within the close confirmation dialog.
            if (isConfirmingSave) return;

            // If the user didn't type anything then close without asking
            // for confirmation.
            if (!shouldConfirmSave) {
                onCancelSaveRef.current();
                return;
            }

            // Cancel the outside press and ask the user to confirm first.
            event.preventDefault();
            event.stopPropagation();
            onConfirmSaveRef.current();
        }),
    );
}
