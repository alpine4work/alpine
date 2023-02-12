import {useEffect, useId, useRef} from "react";
import {Box} from "~/client/design/box";
import {Button} from "~/client/design/button";
import {Modal} from "~/client/design/modal";
import {Spacer} from "~/client/design/spacer";
import {delayLoadingIndicatorLimitMs} from "~/client/design/timing_constants";
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
    onClose,
}: {
    title: string;
    description: string;
    primaryButtonLabel: string;
    primaryButtonPressErrorTitle?: string;
    onPrimaryButtonPress: () => void | Promise<void>;
    cancelButtonLabel?: string;
    onClose: () => void;
}) {
    const descriptionId = useId();
    const primaryButtonRef = useRef<HTMLButtonElement>(null);

    // Immediately focus the primary button.
    useEffect(() => {
        const primaryButtonElement = assertExists(primaryButtonRef.current);
        primaryButtonElement.focus();
    }, []);

    return (
        <Modal title={title} aria-describedby={descriptionId} onClose={onClose}>
            {({onCloseWithAnimation, onCloseWithoutAnimation}) => (
                <Box paddingX="5" paddingTop="4" paddingBottom="5">
                    <Box
                        id={descriptionId}
                        userSelect="text"
                        fontSize="75"
                        style={{lineHeight: 1.5}}
                    >
                        {description}
                    </Box>
                    <Spacer space="5" />
                    <Box display="flex" justifyContent="flex-end" gap="2">
                        <Button onPress={onCloseWithoutAnimation}>{cancelButtonLabel}</Button>
                        <Button
                            ref={primaryButtonRef}
                            variant="accent"
                            pressErrorTitle={primaryButtonPressErrorTitle}
                            onPress={() => {
                                const promise = onPrimaryButtonPress();
                                if (!(promise instanceof Promise)) {
                                    onCloseWithoutAnimation();
                                } else {
                                    const promiseStartTime = new Date();

                                    return promise.then(
                                        () => {
                                            // Our animation principle is to respond to user input immediately
                                            // without animation.
                                            //
                                            // If the button had to go into a loading state we consider the click long
                                            // enough ago that it is no longer a direct action.
                                            if (
                                                new Date().getTime() - promiseStartTime.getTime() >
                                                delayLoadingIndicatorLimitMs
                                            ) {
                                                onCloseWithAnimation();
                                            } else {
                                                onCloseWithoutAnimation();
                                            }
                                        },
                                        error => {
                                            throw error;
                                        },
                                    );
                                }
                            }}
                        >
                            {primaryButtonLabel}
                        </Button>
                    </Box>
                </Box>
            )}
        </Modal>
    );
}
