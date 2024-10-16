import {CSSProperties, ReactNode, useEffect, useState} from "react";
import {FocusScope} from "react-aria";
import {createPortal} from "react-dom";
import {Box} from "~/client/design/box.js";
import {OverlayScopeContextProvider, useOverlayRootPortalElement} from "~/client/design/overlay.js";
import {
    GlobalKeyDownEvent,
    GlobalKeyDownEventModal,
} from "~/client/helpers/global_key_down_event.js";
import {useEvent} from "~/client/helpers/lifecycle/use_event.js";
import {modalStyles} from "~/client/styles/styles.js";
import {Spacing} from "~/shared/design/spacing.js";
import {Timeout, createTimeout} from "~/shared/helpers/async/timeout.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";

export const defaultModalMaxWidth: Spacing = "128";

export function ModalContainer({
    "aria-label": ariaLabel,
    "aria-labelledby": ariaLabelledBy,
    onClose: onCloseWithoutAnimationFromProps,
    "aria-describedby": ariaDescribedBy,
    className,
    style,
    withDarkerUnderlay,
    withoutOpenAnimation,
    withoutCloseAnimation,
    withoutCloseInteractions,
    children,
}: {
    onClose: () => void;
    "aria-describedby"?: string;
    className?: string;
    style?: CSSProperties;
    // NOCOMMIT: Delete this if I'm not using it
    withDarkerUnderlay?: boolean;
    withoutOpenAnimation?: boolean;
    withoutCloseAnimation?: boolean;
    withoutCloseInteractions?: boolean;
    children?:
        | ReactNode
        | ((props: {
              onCloseWithAnimation: () => void;
              onCloseWithoutAnimation: () => void;
          }) => ReactNode);
} & (
    | {
          "aria-label": string;
          "aria-labelledby"?: undefined;
      }
    | {
          "aria-labelledby": string;
          "aria-label"?: undefined;
      }
)) {
    const portalElement = assertExists(
        useOverlayRootPortalElement(),
        "Can not render modal before portal element is available",
    );
    const [isFadingOut, setIsFadingOut] = useState(false);

    const onCloseWithoutAnimation = useEvent(onCloseWithoutAnimationFromProps);
    useEffect(() => {
        if (!isFadingOut) return;

        let resetTimeout: Timeout | null = null;

        const timeout = createTimeout(() => {
            onCloseWithoutAnimation();

            // If the `onClose()` callback doesn't actually close the modal after 1s, then
            // the modal component is still mounted so should be made visible again.
            //
            // We wait 1s since sometimes there's a small asynchronous delay between the
            // `onClose()` prop and the React render which actually closes the modal.
            resetTimeout = createTimeout(() => {
                setIsFadingOut(false);
            }, 1000);
        }, modalStyles.modalFadeOutDuration);

        return () => {
            timeout.clear();
            resetTimeout?.clear();
        };
    }, [isFadingOut, onCloseWithoutAnimation]);

    const onCloseWithAnimation = () => {
        if (!withoutCloseAnimation) {
            setIsFadingOut(true);
        } else {
            onCloseWithoutAnimation();
        }
    };

    return createPortal(
        <Box
            position="fixed"
            // Render over other overlays.
            zIndex="80"
            inset="0"
            display="flex"
            justifyContent="center"
            alignItems="center"
            padding="5"
            style={{animation: isFadingOut ? modalStyles.modalFadeOutAnimation : undefined}}
            overflow="hidden"
        >
            <Box
                position="absolute"
                inset="0"
                zIndex="-10"
                backgroundColor="grey-100-const"
                className={
                    withDarkerUnderlay ? modalStyles.modalDarkerUnderlayClassName : undefined
                }
                style={{
                    opacity: modalStyles.modalUnderlayOpacityVar,
                    animation: !withoutOpenAnimation
                        ? modalStyles.modalUnderlayFadeInAnimation
                        : undefined,
                }}
                // If the underlay is clicked, we close the modal. This element is not
                // focusable or keyboard accessible. You can hit the "Escape" key as a shortcut
                // to close the modal.
                onPointerDown={!withoutCloseInteractions ? onCloseWithAnimation : undefined}
            />
            <FocusScope restoreFocus contain>
                <GlobalKeyDownEventModal>
                    <GlobalKeyDownEvent
                        onGlobalKeyDown={event => {
                            if (!withoutCloseInteractions && event.key === "Escape") {
                                event.stopPropagation();
                                event.preventDefault();
                                onCloseWithoutAnimation();
                            }
                        }}
                    >
                        <section
                            role="alertdialog"
                            // It's important the modal is focusable for `<FocusScope contain>`. That way
                            // when you click out of a focusable element in the modal, focus goes to this
                            // element instead of `document.body`. If `<FocusScope contain>` sees focus on
                            // `document.body` then it will move focus right back to the element that was
                            // blurred which is not what the user wants.
                            tabIndex={-1}
                            aria-modal="true"
                            aria-label={ariaLabel}
                            aria-labelledby={ariaLabelledBy}
                            aria-describedby={ariaDescribedBy}
                            className={className}
                            style={{
                                ...style,
                                animation: !withoutOpenAnimation
                                    ? modalStyles.modalOverlayFadeInAnimation
                                    : undefined,
                            }}
                        >
                            <Box
                                width="full"
                                maxHeight="full"
                                overflow="hidden"
                                style={{
                                    animation: isFadingOut
                                        ? modalStyles.modalContentFadeOutAnimation
                                        : !withoutOpenAnimation
                                        ? modalStyles.modalContentFadeInAnimation
                                        : undefined,
                                }}
                            >
                                <OverlayScopeContextProvider
                                // Render an overlay scope so any initially mounted overlays get the same
                                // opacity/scale animations as the modal content.
                                //
                                // `<FocusRing>` is a common example of an initially mounted overlay when we
                                // auto-focus some content in the modal.
                                >
                                    {typeof children === "function"
                                        ? children({
                                              onCloseWithAnimation,
                                              onCloseWithoutAnimation,
                                          })
                                        : children}
                                </OverlayScopeContextProvider>
                            </Box>
                        </section>
                    </GlobalKeyDownEvent>
                </GlobalKeyDownEventModal>
            </FocusScope>
        </Box>,
        portalElement,
    );
}
