import {ReactNode, Ref, forwardRef, useImperativeHandle, useRef, useState} from "react";
import {Box} from "~/client/design/box";
import {Button} from "~/client/design/button";
import {Modal} from "~/client/design/modal";
import {delayLoadingIndicatorLimitMs} from "~/client/design/timing_constants";
import {useShowToast} from "~/client/design/toast";
import {RemLength, Spacing} from "~/shared/design/spacing";
import {assert} from "~/shared/helpers/control/assert";
import {assertExists} from "~/shared/helpers/control/assert_exists";

export type ModalWithButtonsRef = {
    focusPrimaryButton(): void;
};

const ModalWithButtonsForwardRef = forwardRef(ModalWithButtons);
export {ModalWithButtonsForwardRef as ModalWithButtons};

/**
 * A modal with a primary button and cancel button. Used for implementing
 * `<ModalDialog>` or other more custom modals.
 */
function ModalWithButtons(
    {
        title,
        children,
        primaryButtonLabel,
        isPrimaryButtonDisabled,
        primaryButtonPressErrorTitle,
        onPrimaryButtonPress,
        cancelButtonLabel = "Cancel",
        onClose,
        disableCloseAnimation,
        "aria-describedby": ariaDescribedBy,
        maxWidth,
    }: {
        title: string;
        children?:
            | ReactNode
            | ((props: {isPending: boolean; pressPrimaryButton: () => void}) => ReactNode);
        primaryButtonLabel: string;
        isPrimaryButtonDisabled?: boolean;
        primaryButtonPressErrorTitle?: string;
        onPrimaryButtonPress: () => void | Promise<void>;
        cancelButtonLabel?: string;
        onClose: () => void;
        disableCloseAnimation?: boolean;
        "aria-describedby"?: string;
        maxWidth?: Spacing | RemLength;
    },
    ref: Ref<ModalWithButtonsRef>,
) {
    const showToast = useShowToast();
    const primaryButtonRef = useRef<HTMLButtonElement>(null);
    const [isPending, setIsPending] = useState(false);

    useImperativeHandle(
        ref,
        () => ({
            focusPrimaryButton: () => {
                const primaryButtonElement = assertExists(primaryButtonRef.current);
                primaryButtonElement.focus();
            },
        }),
        [],
    );

    return (
        <Modal
            title={title}
            aria-describedby={ariaDescribedBy}
            onClose={onClose}
            disableCloseAnimation={disableCloseAnimation}
            maxWidth={maxWidth}
        >
            {({onCloseWithAnimation, onCloseWithoutAnimation}) => {
                const pressPrimaryButton = () => {
                    if (isPrimaryButtonDisabled) return;

                    const promise = onPrimaryButtonPress();

                    if (!(promise instanceof Promise)) {
                        onCloseWithoutAnimation();
                    } else {
                        setIsPending(true);

                        assert(
                            primaryButtonPressErrorTitle,
                            "If `onPress` returns a promise then the `primaryButtonPressErrorTitle` prop is required",
                        );

                        const promiseStartTime = new Date();

                        promise.then(
                            () => {
                                setIsPending(false);

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
                                setIsPending(false);

                                showToast({
                                    type: "Error",
                                    title: primaryButtonPressErrorTitle,
                                    error,
                                });
                            },
                        );
                    }
                };

                return (
                    <>
                        {typeof children === "function"
                            ? children({isPending, pressPrimaryButton})
                            : children}
                        <Box
                            paddingX="5"
                            paddingBottom="4"
                            display="flex"
                            justifyContent="flex-end"
                            gap="2"
                        >
                            <Button onPress={onCloseWithoutAnimation}>{cancelButtonLabel}</Button>
                            <Button
                                ref={primaryButtonRef}
                                variant="accent"
                                isDisabled={isPrimaryButtonDisabled}
                                isPending={isPending}
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
