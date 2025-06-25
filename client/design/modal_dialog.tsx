import {useEffect, useId, useRef} from "react";
import {useAppContext} from "~/client/context/app_context.js";
import {Box} from "~/client/design/box.js";
import {defaultErrorDisplayMessage} from "~/client/design/default_error_display_message.js";
import {ErrorDisplayMessageRenderer} from "~/client/design/error_display_message_renderer.js";
import {ModalDialogProps} from "~/client/design/modal_dialog_props.js";
import {ModalWithButtons, ModalWithButtonsRef} from "~/client/design/modal_with_buttons.js";
import {useReporter} from "~/client/design/reporter.js";
import {useIsInitialAppRender} from "~/client/helpers/lifecycle/initial_app_render.js";
import {NativeMobileBridge} from "~/client/remix/native_mobile_bridge.js";
import {sprinkles} from "~/client/styles/styles.js";
import {RemLength, parseRemLength} from "~/shared/design/core/spacing.js";
import {ErrorBase, InternalError} from "~/shared/error/error.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {lerp} from "~/shared/helpers/number/lerp.js";

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

export const modalDialogMaxWidth: RemLength = `${lerp(
    parseRemLength("96"),
    parseRemLength("128"),
    0.5,
)}rem`;

function ModalDialog({
    title,
    description,
    "data-ownedby": dataOwnedBy,
    primaryButtonLabel,
    isPrimaryButtonDisabled,
    primaryButtonPressErrorTitle,
    onPrimaryButtonPress,
    cancelButtonLabel = "Cancel",
    cancelButtonPressErrorTitle,
    onCancelButtonPress,
    shouldHideCancelButton,
    onClose,
    withoutCloseInteractions,
    initiallyFocus = "Primary",
}: ModalDialogProps) {
    // Can't server-render `<ModalDialog>` since in our native mobile app we'll
    // have a different implementation then on the server.
    const isInitialAppRender = useIsInitialAppRender();
    if (isInitialAppRender) throw new InternalError("Can’t server render `<ModalDialog>`");

    const descriptionId = useId();
    const modalRef = useRef<ModalWithButtonsRef>(null);

    // Focus the specified button.
    const hasInitiallyMountedRef = useRef(false);
    useEffect(() => {
        if (hasInitiallyMountedRef.current) return;
        hasInitiallyMountedRef.current = true;

        const modal = assertExists(modalRef.current);
        switch (initiallyFocus) {
            case "Primary":
                modal.focusPrimaryButton();
                break;
            case "Cancel":
                modal.focusCancelButton();
                break;
            default:
                throw exhaustive(initiallyFocus);
        }
    }, [initiallyFocus]);

    const titleId = useId();

    return (
        <ModalWithButtons
            ref={modalRef}
            aria-labelledby={titleId}
            aria-describedby={descriptionId}
            data-ownedby={dataOwnedBy}
            onClose={onClose}
            primaryButtonLabel={primaryButtonLabel}
            isPrimaryButtonDisabled={isPrimaryButtonDisabled}
            primaryButtonPressErrorTitle={primaryButtonPressErrorTitle}
            onPrimaryButtonPress={onPrimaryButtonPress}
            cancelButtonLabel={cancelButtonLabel}
            cancelButtonPressErrorTitle={cancelButtonPressErrorTitle}
            onCancelButtonPress={onCancelButtonPress}
            shouldHideCancelButton={shouldHideCancelButton}
            maxWidth={modalDialogMaxWidth}
            buttonsPaddingX="7"
            buttonsPaddingBottom="5"
            // Improve focus on the dialog's content by not showing a close button. A modal
            // dialog's two buttons will usually be the main actions you want to take.
            // Dismissing a modal by clicking the background should also feel natural.
            withoutCloseButton={true}
            withoutCloseInteractions={withoutCloseInteractions}
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
                    {typeof description === "string" ? (
                        description
                    ) : (
                        <ErrorDisplayMessageRenderer
                            isSingleLine={true}
                            error={description.error}
                            reportingContext={description.reportingContext}
                        />
                    )}
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
    const context = useAppContext();
    const reporter = useReporter();

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

        let descriptionString: string;

        if (typeof description === "string") {
            descriptionString = description;
        } else {
            descriptionString = "";

            // Since we aren't rendering `<ErrorDisplayMessageRenderer>` and instead are
            // opening a native dialog, report the error here before opening the dialog.
            (description.reportingContext ?? context).react.reportRenderedError(description.error);

            for (const displayMessageSegment of (description.error instanceof ErrorBase
                ? description.error.displayMessage
                : null) ?? defaultErrorDisplayMessage) {
                switch (displayMessageSegment.type) {
                    case "Text":
                    case "SensitiveText":
                    // TODO(calebmer): When showing an error in `<ModalDialog>` we strip all links
                    // since the modal content isn't interactive. Figure out if it's possible to put
                    // links in an iOS dialog and if it's not can we write some code to add the
                    // links as action buttons in the dialog?
                    case "Link":
                        descriptionString += displayMessageSegment.text;
                        break;
                    default:
                        throw exhaustive(displayMessageSegment);
                }
            }
        }

        assert(NativeMobileBridge);
        NativeMobileBridge.modal.presentDialog({
            title,
            description: descriptionString,
            primaryButtonLabel,
            isPrimaryButtonDisabled,
            onPrimaryButtonPress: () => {
                const promise = onPrimaryButtonPress?.();

                // We can't show a pending indicator in our native mobile modal dialog so
                // close immediately.
                onClose();

                if (promise instanceof Promise) {
                    assert(
                        primaryButtonPressErrorTitle,
                        "If `onPrimaryButtonPress` returns a promise then the `primaryButtonPressErrorTitle` prop is required",
                    );

                    promise.catch(error => {
                        reporter.displayError(primaryButtonPressErrorTitle, error);
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
                        reporter.displayError(cancelButtonPressErrorTitle, error);
                    });
                }
            },
            shouldHideCancelButton,
        });
    });

    return null;
}
