import {Ref, useRef} from "react";
import {useOutsideInteraction} from "~/client/design/helpers/use_outside_interaction.js";
import {useLayoutEffectWithoutServerSideWarning} from "~/client/helpers/lifecycle/use_layout_effect_without_server_side_warning.js";

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
    isDisabled,
    shouldConfirmSave,
    isConfirmingSave,
    onConfirmSave: _onConfirmSave,
    onCancelSave: _onCancelSave,
}: {
    isDisabled?: boolean;
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

    // Show a confirmation dialog if:
    //
    // - Someone clicks outside the element
    // - Someone focuses something outside the element
    return useOutsideInteraction(event => {
        if (isDisabled) return;

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
    });
}
