import {ReactNode, Ref, forwardRef, useImperativeHandle, useRef, useState} from "react";
import {Box} from "~/client/web/design/box.js";
import {Button} from "~/client/web/design/button.js";
import {Modal} from "~/client/web/design/modal.js";
import {useReporter} from "~/client/web/design/reporter.js";
import {RemLength, Spacing} from "~/shared/design/core/spacing.js";
import {delayLoadingIndicatorLimitMs} from "~/shared/design/core/timing.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {MaybePromise} from "~/shared/helpers/types/maybe_promise.js";

export type ModalWithButtonsRef = {
    pressPrimaryButton(): void;
    focusPrimaryButton(): void;
    focusCancelButton(): void;
};

const ModalWithButtonsForwardRef = forwardRef(ModalWithButtons);
export {ModalWithButtonsForwardRef as ModalWithButtons};

/**
 * A modal with a primary button and cancel button. Used for implementing
 * `<ModalDialog>` or other more custom modals.
 */
function ModalWithButtons(
    {
        "aria-labelledby": ariaLabelledBy,
        children,
        primaryButtonLabel,
        primaryButtonVariant = "accent",
        isPrimaryButtonDisabled,
        primaryButtonPressErrorTitle,
        onPrimaryButtonPress,
        cancelButtonLabel = "Cancel",
        cancelButtonPressErrorTitle,
        onCancelButtonPress,
        shouldHideCancelButton,
        onClose,
        "aria-describedby": ariaDescribedBy,
        "data-ownedby": dataOwnedBy,
        maxWidth,
        withoutOpenAnimation,
        withoutCloseAnimation,
        withoutCloseButton,
        withoutCloseInteractions,
        withoutCloseAfterPrimaryButtonPress,
        buttonsPaddingX = "5",
        buttonsPaddingBottom = "4",
        additionalButtons,
    }: {
        "aria-labelledby": string;
        children?:
            | ReactNode
            | ((props: {isPending: boolean; pressPrimaryButton: () => void}) => ReactNode);
        primaryButtonLabel: string;
        primaryButtonVariant?: "accent" | "quiet";
        isPrimaryButtonDisabled?: boolean;
        primaryButtonPressErrorTitle?: string;
        onPrimaryButtonPress?: () => MaybePromise<void>;
        cancelButtonLabel?: string;
        cancelButtonPressErrorTitle?: string;
        onCancelButtonPress?: () => MaybePromise<void>;
        shouldHideCancelButton?: boolean;
        onClose: () => void;
        "aria-describedby"?: string;
        "data-ownedby"?: string;
        maxWidth?: Spacing | RemLength;
        withoutOpenAnimation?: boolean;
        withoutCloseAnimation?: boolean;
        withoutCloseButton?: boolean;
        withoutCloseInteractions?: boolean;
        withoutCloseAfterPrimaryButtonPress?: boolean;
        buttonsPaddingX?: Spacing;
        buttonsPaddingBottom?: Spacing;
        additionalButtons?: ReactNode;
    },
    ref: Ref<ModalWithButtonsRef>,
) {
    const reporter = useReporter();
    const primaryButtonRef = useRef<HTMLButtonElement & {press(): void}>(null);
    const cancelButtonRef = useRef<HTMLButtonElement>(null);
    const [isPrimaryButtonPending, setIsPrimaryButtonPending] = useState(false);

    useImperativeHandle(
        ref,
        () => ({
            pressPrimaryButton: () => {
                const primaryButtonElement = assertExists(primaryButtonRef.current);
                primaryButtonElement.press();
            },
            focusPrimaryButton: () => {
                const primaryButtonElement = assertExists(primaryButtonRef.current);
                primaryButtonElement.focus();
            },
            focusCancelButton: () => {
                if (!cancelButtonRef.current) return;
                const cancelButtonElement = cancelButtonRef.current;
                cancelButtonElement.focus();
            },
        }),
        [],
    );

    return (
        <Modal
            aria-labelledby={ariaLabelledBy}
            aria-describedby={ariaDescribedBy}
            data-ownedby={dataOwnedBy}
            onClose={onClose}
            maxWidth={maxWidth}
            withoutOpenAnimation={withoutOpenAnimation}
            withoutCloseAnimation={withoutCloseAnimation}
            withoutCloseButton={withoutCloseButton}
            withoutCloseInteractions={withoutCloseInteractions}
        >
            {({onCloseWithAnimation, onCloseWithoutAnimation}) => {
                const pressPrimaryButton = () => {
                    if (isPrimaryButtonDisabled) return;

                    const promise = onPrimaryButtonPress?.();

                    if (!(promise instanceof Promise)) {
                        if (!withoutCloseAfterPrimaryButtonPress) {
                            onCloseWithoutAnimation();
                        }
                    } else {
                        setIsPrimaryButtonPending(true);

                        assert(
                            primaryButtonPressErrorTitle,
                            "If `onPress` returns a promise then the `primaryButtonPressErrorTitle` prop is required",
                        );

                        const promiseStartTime = new Date();

                        promise.then(
                            () => {
                                setIsPrimaryButtonPending(false);

                                if (!withoutCloseAfterPrimaryButtonPress) {
                                    // Our animation principle is to respond to user input immediately without
                                    // animation.
                                    //
                                    // If the button had to go into a loading state we consider the click long enough
                                    // ago that it is no longer a direct action.
                                    if (
                                        new Date().getTime() - promiseStartTime.getTime() >
                                        delayLoadingIndicatorLimitMs
                                    ) {
                                        onCloseWithAnimation();
                                    } else {
                                        onCloseWithoutAnimation();
                                    }
                                }
                            },
                            error => {
                                setIsPrimaryButtonPending(false);
                                reporter.displayError(primaryButtonPressErrorTitle, error);
                            },
                        );
                    }
                };

                return (
                    <>
                        {typeof children === "function"
                            ? children({isPending: isPrimaryButtonPending, pressPrimaryButton})
                            : children}
                        <Box
                            paddingX={buttonsPaddingX}
                            paddingBottom={buttonsPaddingBottom}
                            display="flex"
                            alignItems="center"
                            justifyContent="flex-end"
                            gap="2"
                        >
                            {additionalButtons && (
                                <>
                                    {additionalButtons}
                                    <Box flexGrow="1" />
                                </>
                            )}
                            {!shouldHideCancelButton && (
                                <Button
                                    ref={cancelButtonRef}
                                    variant="quieter"
                                    pressErrorTitle={cancelButtonPressErrorTitle}
                                    onPress={() => {
                                        const promise = onCancelButtonPress?.();

                                        if (!(promise instanceof Promise)) {
                                            onCloseWithoutAnimation();
                                        } else {
                                            const promiseStartTime = new Date();

                                            return promise.then(() => {
                                                // Our animation principle is to respond to user input immediately without
                                                // animation.
                                                //
                                                // If the button had to go into a loading state we consider the click long enough
                                                // ago that it is no longer a direct action.
                                                if (
                                                    new Date().getTime() -
                                                        promiseStartTime.getTime() >
                                                    delayLoadingIndicatorLimitMs
                                                ) {
                                                    onCloseWithAnimation();
                                                } else {
                                                    onCloseWithoutAnimation();
                                                }
                                            });
                                        }
                                    }}
                                >
                                    {cancelButtonLabel}
                                </Button>
                            )}
                            <Button
                                ref={primaryButtonRef}
                                variant={
                                    primaryButtonVariant === "quiet"
                                        ? "quieter"
                                        : primaryButtonVariant
                                }
                                isDisabled={isPrimaryButtonDisabled}
                                isPending={isPrimaryButtonPending}
                                pressErrorTitle={primaryButtonPressErrorTitle}
                                onPress={pressPrimaryButton}
                            >
                                {primaryButtonLabel}
                            </Button>
                        </Box>
                    </>
                );
            }}
        </Modal>
    );
}
