import {ReactNode, useEffect, useId, useRef} from "react";
import {Box} from "~/client/design/box.js";
import {ModalWithButtons, ModalWithButtonsRef} from "~/client/design/modal_with_buttons.js";
import {parseRemLengthNumber, spacing} from "~/shared/design/spacing.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {lerp} from "~/shared/helpers/number/lerp.js";
import {MaybePromise} from "~/shared/helpers/types/maybe_promise.js";
import {sprinkles} from "~/shared/styles/styles.js";

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
    isPrimaryButtonDisabled,
    primaryButtonPressErrorTitle,
    onPrimaryButtonPress,
    cancelButtonLabel = "Cancel",
    cancelButtonPressErrorTitle,
    onCancelButtonPress,
    shouldHideCancelButton,
    onClose,
}: {
    title: string;
    description: ReactNode;
    primaryButtonLabel: string;
    isPrimaryButtonDisabled?: boolean;
    primaryButtonPressErrorTitle?: string;
    onPrimaryButtonPress: () => MaybePromise<void>;
    cancelButtonLabel?: string;
    cancelButtonPressErrorTitle?: string;
    onCancelButtonPress?: () => MaybePromise<void>;
    shouldHideCancelButton?: boolean;
    onClose: () => void;
}) {
    const descriptionId = useId();
    const modalRef = useRef<ModalWithButtonsRef>(null);

    // Immediately focus the primary button.
    useEffect(() => {
        const modal = assertExists(modalRef.current);
        modal.focusPrimaryButton();
    }, []);

    const titleId = useId();

    return (
        <ModalWithButtons
            ref={modalRef}
            aria-labelledby={titleId}
            aria-describedby={descriptionId}
            onClose={onClose}
            primaryButtonLabel={primaryButtonLabel}
            isPrimaryButtonDisabled={isPrimaryButtonDisabled}
            primaryButtonPressErrorTitle={primaryButtonPressErrorTitle}
            onPrimaryButtonPress={onPrimaryButtonPress}
            cancelButtonLabel={cancelButtonLabel}
            cancelButtonPressErrorTitle={cancelButtonPressErrorTitle}
            onCancelButtonPress={onCancelButtonPress}
            shouldHideCancelButton={shouldHideCancelButton}
            maxWidth={`${lerp(
                parseRemLengthNumber(spacing["96"]),
                parseRemLengthNumber(spacing["128"]),
                0.5,
            )}rem`}
            buttonsPaddingX="7"
            buttonsPaddingBottom="5"
            // Improve focus on the dialog's content by not showing a close button. A modal
            // dialog's two buttons will usually be the main actions you want to take.
            // Dismissing a modal by clicking the background should also feel natural.
            withoutCloseButton={true}
        >
            <Box userSelect="text">
                <h2
                    id={titleId}
                    className={sprinkles({
                        paddingX: "7",
                        paddingTop: "7",
                        fontStyle: "bold",
                        fontSize: "300",
                    })}
                >
                    {title}
                </h2>
                <Box
                    id={descriptionId}
                    paddingX="7"
                    paddingTop="2.5"
                    paddingBottom="9"
                    fontSize="75"
                    style={{lineHeight: 1.5}}
                >
                    {description}
                </Box>
            </Box>
        </ModalWithButtons>
    );
}
