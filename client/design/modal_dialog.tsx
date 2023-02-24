import {useEffect, useId, useRef} from "react";
import {Box} from "~/client/design/box";
import {ModalWithButtons, ModalWithButtonsRef} from "~/client/design/modal_with_buttons";
import {assertExists} from "~/shared/helpers/control/assert_exists";

/**
 * Present information to the user, blocking their experience, and ask them to
 * make a choice. The user may not interact with content under the modal
 * through mouse, keyboard, or touch.
 *
 * - A dialog is a component with a title, a message, and some action buttons.
 *   It can be rendered as in a popover or modal form factor.
 * - A modal is a view which takes over the entire screen. It renders an
 *   underlay so the user can't interact with content underneath and it
 *   captures focus. It forces the user to interact with the modal.
 *
 * Refer to [Adobe Spectrum][1] content guidelines for writing the message in
 * the modal dialog.
 *
 * [1]: https://spectrum.adobe.com/page/alert-dialog/#Content-standards
 */
export function ModalDialog({
    title,
    description,
    primaryButtonLabel,
    primaryButtonPressErrorTitle,
    onPrimaryButtonPress,
    cancelButtonLabel = "Cancel",
    onCancelButtonPress,
    onClose,
}: {
    title: string;
    description: string;
    primaryButtonLabel: string;
    primaryButtonPressErrorTitle?: string;
    onPrimaryButtonPress: () => void | Promise<void>;
    cancelButtonLabel?: string;
    onCancelButtonPress?: () => void;
    onClose: () => void;
}) {
    const descriptionId = useId();
    const modalRef = useRef<ModalWithButtonsRef>(null);

    // Immediately focus the primary button.
    useEffect(() => {
        const modal = assertExists(modalRef.current);
        modal.focusPrimaryButton();
    }, []);

    return (
        <ModalWithButtons
            ref={modalRef}
            title={title}
            aria-describedby={descriptionId}
            onClose={onClose}
            primaryButtonLabel={primaryButtonLabel}
            primaryButtonPressErrorTitle={primaryButtonPressErrorTitle}
            onPrimaryButtonPress={onPrimaryButtonPress}
            cancelButtonLabel={cancelButtonLabel}
            onCancelButtonPress={onCancelButtonPress}
        >
            <Box
                id={descriptionId}
                paddingX="5"
                paddingTop="4"
                paddingBottom="5"
                userSelect="text"
                fontSize="75"
                style={{lineHeight: 1.5}}
            >
                {description}
            </Box>
        </ModalWithButtons>
    );
}
