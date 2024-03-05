import {useEffect, useId, useRef} from "react";
import {Box} from "~/client/design/box.js";
import {ModalWithButtons, ModalWithButtonsRef} from "~/client/design/modal_with_buttons.js";
import {useShowToast} from "~/client/design/toast.js";
import {useIsInitialAppRender} from "~/client/helpers/lifecycle/use_is_initial_app_render.js";
import {NativeMobileBridge} from "~/client/remix/native_mobile_bridge.js";
import {parseRemLengthNumber, spacing} from "~/shared/design/spacing.js";
import {InternalError} from "~/shared/error/error.js";
import {assert} from "~/shared/helpers/control/assert.js";
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
// In our native mobile app, we use the platform alert to render
// `<ModalDialog>`. It's ok to swap out component implementations this way
// since we should never server-side render `<ModalDialog>`.
const ActualModalDialog = NativeMobileBridge ? ModalDialogNativeMobile : ModalDialog;
export {ActualModalDialog as ModalDialog};

export type ModalDialogProps = {
    title: string;
    description: string;
    primaryButtonLabel: string;
    isPrimaryButtonDisabled?: boolean;
    primaryButtonPressErrorTitle?: string;
    onPrimaryButtonPress: () => MaybePromise<void>;
    cancelButtonLabel?: string;
    cancelButtonPressErrorTitle?: string;
    onCancelButtonPress?: () => MaybePromise<void>;
    shouldHideCancelButton?: boolean;
    onClose: () => void;
};

function ModalDialog({
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
}: ModalDialogProps) {
    // Can't server-render `<ModalDialog>` since in our native mobile app we'll
    // have a different implementation then on the server.
    const isInitialAppRender = useIsInitialAppRender();
    if (isInitialAppRender) throw new InternalError("Can't server render `<ModalDialog>`");

    const descriptionId = useId();
    const modalRef = useRef<ModalWithButtonsRef>(null);

    // Immediately focus the primary button.
    const hasInitiallyMountedRef = useRef(false);
    useEffect(() => {
        if (hasInitiallyMountedRef.current) return;
        hasInitiallyMountedRef.current = true;

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

function ModalDialogNativeMobile({
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
}: ModalDialogProps) {
    const showToast = useShowToast();

    const hasInitiallyMountedRef = useRef(false);
    useEffect(() => {
        if (hasInitiallyMountedRef.current) return;
        hasInitiallyMountedRef.current = true;

        // If we were rendering our custom `<ModalDialog>` (instead of the native one)
        // then our focus would move into the `<ModalDialog>` component. Make sure even
        // with our native modal dialog we still remove focus from whatever's presently
        // focused.
        if (document.activeElement instanceof HTMLElement) {
            document.activeElement.blur();
        }

        assert(NativeMobileBridge);
        NativeMobileBridge.modal.presentDialog({
            title,
            description,
            primaryButtonLabel,
            isPrimaryButtonDisabled,
            onPrimaryButtonPress: () => {
                const promise = onPrimaryButtonPress();

                // We can't show a pending indicator in our native mobile modal dialog so
                // close immediately.
                onClose();

                if (promise instanceof Promise) {
                    assert(
                        primaryButtonPressErrorTitle,
                        "If `onPrimaryButtonPress` returns a promise then the `primaryButtonPressErrorTitle` prop is required",
                    );

                    promise.catch(error => {
                        showToast({
                            type: "Error",
                            title: primaryButtonPressErrorTitle,
                            error,
                        });
                    });
                }
            },
            cancelButtonLabel,
            onCancelButtonPress: () => {
                const promise = onCancelButtonPress?.();

                // We can't show a pending indicator in our native mobile modal dialog so
                // close immediately.
                onClose();

                if (promise instanceof Promise) {
                    assert(
                        cancelButtonPressErrorTitle,
                        "If `onCancelButtonPress` returns a promise then the `cancelButtonPressErrorTitle` prop is required",
                    );

                    promise.catch(error => {
                        showToast({
                            type: "Error",
                            title: cancelButtonPressErrorTitle,
                            error,
                        });
                    });
                }
            },
            shouldHideCancelButton,
        });
    });

    return null;
}
