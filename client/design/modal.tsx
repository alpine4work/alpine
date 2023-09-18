import classNames from "classnames";
import {X} from "phosphor-react";
import {ReactNode, useEffect, useState} from "react";
import {FocusScope} from "react-aria";
import {createPortal} from "react-dom";
import {Box} from "~/client/design/box.js";
import {IconButton} from "~/client/design/icon_button.js";
import {OverlayScopeContextProvider, useOverlayRootPortalElement} from "~/client/design/overlay.js";
import {GlobalKeyDownEvent} from "~/client/helpers/global_key_down_event.js";
import {useEvent} from "~/client/helpers/lifecycle/use_event.js";
import {RemLength, Spacing, isRemLength, spacing} from "~/shared/design/spacing.js";
import {createTimeout} from "~/shared/helpers/async/timeout.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {greyElevated1ClassName, modalStyles, sprinkles} from "~/shared/styles/styles.js";

export const defaultModalMaxWidth: Spacing = "128";

/**
 * A view which takes over the entire screen and blocks interaction with the
 * content underneath while it is open.
 *
 * Has an underlay which when clicked will close the modal.
 */
export function Modal({
    "aria-labelledby": ariaLabelledBy,
    children,
    onClose: _onCloseWithoutAnimation,
    "aria-describedby": ariaDescribedBy,
    maxWidth = defaultModalMaxWidth,
    withoutCloseAnimation,
    withoutCloseButton,
}: {
    /**
     * An ID to an element within the modal labeling the modal. Usually a title
     * element like an `<h2>`.
     */
    "aria-labelledby": string;

    /**
     * The contents of the modal. If the contents are too big for the screen then
     * the content area will scroll.
     */
    children?:
        | ReactNode
        | ((props: {
              onCloseWithAnimation: () => void;
              onCloseWithoutAnimation: () => void;
          }) => ReactNode);

    /**
     * Callback that will close and unmount the modal. The parent component is
     * expected to manage the modal lifecycle. May be called after a short delay if
     * the modal is animating out.
     */
    onClose: () => void;

    /**
     * The id for an element in the DOM that describes this modal for assistive
     * technology. See [`aria-describedby`][1].
     *
     * [1]: https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Attributes/aria-describedby
     */
    "aria-describedby"?: string;

    /**
     * The maximum width for this modal. Defaults to `128`.
     */
    maxWidth?: Spacing | RemLength;

    /**
     * The modal will never animate when closing if set to true. Otherwise we fade
     * out the modal when closed indirectly.
     */
    withoutCloseAnimation?: boolean;

    /**
     * Don't include the close button in the top right corner. Useful if you want
     * to reduce decision overload. The user can still use the keyboard or click
     * the background to close the modal. We just won't have an explicit action.
     */
    withoutCloseButton?: boolean;
}) {
    const portalElement = assertExists(
        useOverlayRootPortalElement(),
        "Can not render modal before portal element is available",
    );
    const [isFadingOut, setIsFadingOut] = useState(false);

    const onCloseWithoutAnimation = useEvent(_onCloseWithoutAnimation);
    useEffect(() => {
        if (!isFadingOut) return;
        const timeout = createTimeout(onCloseWithoutAnimation, modalStyles.modalFadeOutDuration);
        return () => timeout.clear();
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
            inset="0"
            display="flex"
            justifyContent="center"
            alignItems="center"
            padding="5"
            style={{animation: isFadingOut ? modalStyles.modalFadeOutAnimation : undefined}}
            overflow="hidden"
        >
            <OverlayScopeContextProvider>
                <Box
                    position="absolute"
                    inset="0"
                    zIndex="-10"
                    backgroundColor="grey-dark"
                    style={{
                        opacity: modalStyles.modalUnderlayOpacity,
                        animation: modalStyles.modalUnderlayFadeInAnimation,
                    }}
                    // If the underlay is clicked, we close the modal. This element is not
                    // focusable or keyboard accessible. You can hit the "Escape" key as a shortcut
                    // to close the modal.
                    onClick={onCloseWithAnimation}
                />
                <FocusScope restoreFocus contain>
                    <GlobalKeyDownEvent
                        onGlobalKeyDown={event => {
                            if (event.key === "Escape") {
                                event.stopPropagation();
                                event.preventDefault();
                                onCloseWithoutAnimation();
                            }
                        }}
                    >
                        <section
                            role="alertdialog"
                            aria-modal="true"
                            aria-labelledby={ariaLabelledBy}
                            aria-describedby={ariaDescribedBy}
                            className={classNames(
                                greyElevated1ClassName,
                                sprinkles({
                                    position: "relative",
                                    zIndex: "0",
                                    width: "full",
                                    maxHeight: "full",
                                    backgroundColor: "grey-0",
                                    boxShadow: "elevation-40-with-dark-color-scheme-lighter-border",
                                    borderRadius: "md",
                                    display: "flex",
                                    overflow: "hidden",
                                }),
                            )}
                            style={{
                                maxWidth: isRemLength(maxWidth) ? maxWidth : spacing[maxWidth],
                                animation: modalStyles.modalOverlayFadeInAnimation,
                            }}
                        >
                            <Box
                                width="full"
                                maxHeight="full"
                                overflow="hidden"
                                style={{
                                    animation: isFadingOut
                                        ? modalStyles.modalContentFadeOutAnimation
                                        : modalStyles.modalContentFadeInAnimation,
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
                                    {!withoutCloseButton && (
                                        <Box position="absolute" top="2" right="2">
                                            <IconButton
                                                size="xs"
                                                description="Close"
                                                withoutTooltip={true}
                                                // Our animation principle is to respond to user input immediately
                                                // without animation.
                                                onPress={onCloseWithoutAnimation}
                                            >
                                                <X />
                                            </IconButton>
                                        </Box>
                                    )}
                                </OverlayScopeContextProvider>
                            </Box>
                        </section>
                    </GlobalKeyDownEvent>
                </FocusScope>
            </OverlayScopeContextProvider>
        </Box>,
        portalElement,
    );
}
