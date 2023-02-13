import {X} from "phosphor-react";
import {ReactNode, useEffect, useId, useState} from "react";
import {FocusScope} from "react-aria";
import {createPortal} from "react-dom";
import {Box} from "~/client/design/box";
import {IconButton} from "~/client/design/icon_button";
import {OverlayScopeContextProvider, useOverlayRootPortalElement} from "~/client/design/overlay";
import {useEvent} from "~/client/helpers/lifecycle/use_event";
import {RemLength, Spacing, isRemLength, spacing} from "~/shared/design/spacing";
import {createTimeout} from "~/shared/helpers/async/timeout";
import {assertExists} from "~/shared/helpers/control/assert_exists";
import {modalDialogStyles, sprinkles} from "~/shared/styles/styles";

export const defaultModalMaxWidth: Spacing = "128";

/**
 * A view which takes over the entire screen and blocks interaction with the
 * content underneath while it is open.
 *
 * Has an underlay which when clicked will close the modal.
 */
export function Modal({
    title,
    children,
    footer,
    onClose: _onCloseWithoutAnimation,
    disableCloseAnimation,
    "aria-describedby": ariaDescribedBy,
    maxWidth = defaultModalMaxWidth,
}: {
    /**
     * The title of the modal. This will be rendered in a header along with a
     * close button.
     */
    title: string;

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
     * If provided, we will render a sticky footer at the bottom of the modal. So
     * if `children` is scrolling the footer will stay in place.
     */
    footer?: ReactNode;

    /**
     * Callback that will close and unmount the modal. The parent component is
     * expected to manage the modal lifecycle. May be called after a short delay if
     * the modal is animating out.
     */
    onClose: () => void;

    /**
     * The modal will never animate when closing if set to true. Otherwise we fade
     * out the modal when closed indirectly.
     */
    disableCloseAnimation?: boolean;

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
}) {
    const portalElement = assertExists(
        useOverlayRootPortalElement(),
        "Can not render modal before portal element is available",
    );
    const titleId = useId();
    const [isFadingOut, setIsFadingOut] = useState(false);

    const onCloseWithoutAnimation = useEvent(_onCloseWithoutAnimation);
    useEffect(() => {
        if (!isFadingOut) return;
        const timeout = createTimeout(
            onCloseWithoutAnimation,
            modalDialogStyles.modalFadeOutDuration,
        );
        return () => timeout.clear();
    }, [isFadingOut, onCloseWithoutAnimation]);

    const onCloseWithAnimation = () => {
        if (!disableCloseAnimation) {
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
            style={{animation: isFadingOut ? modalDialogStyles.modalFadeOutAnimation : undefined}}
            overflow="hidden"
        >
            <OverlayScopeContextProvider>
                <Box
                    position="absolute"
                    inset="0"
                    zIndex="-10"
                    backgroundColor="grey-dark"
                    style={{
                        opacity: modalDialogStyles.modalUnderlayOpacity,
                        animation: modalDialogStyles.modalUnderlayFadeInAnimation,
                    }}
                    // If the underlay is clicked, we close the modal. This element is not
                    // focusable or keyboard accessible. You can hit the "Escape" key as a shortcut
                    // to close the modal.
                    onClick={onCloseWithAnimation}
                />
                <FocusScope restoreFocus contain>
                    <section
                        role="alertdialog"
                        aria-modal="true"
                        aria-labelledby={titleId}
                        aria-describedby={ariaDescribedBy}
                        onKeyDown={event => {
                            if (event.key === "Escape") {
                                event.stopPropagation();
                                event.preventDefault();
                                onCloseWithoutAnimation();
                            }
                        }}
                        className={sprinkles({
                            position: "relative",
                            zIndex: "0",
                            width: "full",
                            maxHeight: "full",
                            backgroundColor: "grey-0",
                            border: {dark: "grey-5"},
                            boxShadow: "elevation-40",
                            borderRadius: "md",
                            display: "flex",
                            overflow: "hidden",
                        })}
                        style={{
                            maxWidth: isRemLength(maxWidth) ? maxWidth : spacing[maxWidth],
                            animation: modalDialogStyles.modalOverlayFadeInAnimation,
                        }}
                    >
                        <Box
                            display="flex"
                            flexDirection="column"
                            width="full"
                            maxHeight="full"
                            overflow="hidden"
                            style={{
                                animation: isFadingOut
                                    ? modalDialogStyles.modalContentFadeOutAnimation
                                    : modalDialogStyles.modalContentFadeInAnimation,
                            }}
                        >
                            <Box flexShrink="0" paddingX="5" paddingTop="5" borderBottom="grey-5">
                                <h2
                                    id={titleId}
                                    className={sprinkles({
                                        fontStyle: "semi-bold",
                                        fontSize: "200",
                                        paddingBottom: "2",
                                        // Make sure our heading doesn't collide with the close button.
                                        paddingRight: "6",
                                    })}
                                >
                                    {title}
                                </h2>
                            </Box>
                            <Box flexGrow="1" overflowY="scroll">
                                <Box>
                                    {typeof children === "function"
                                        ? children({onCloseWithAnimation, onCloseWithoutAnimation})
                                        : children}
                                </Box>
                            </Box>
                            {footer && (
                                <Box flexShrink="0" borderTop="grey-5">
                                    {footer}
                                </Box>
                            )}
                            <Box position="absolute" top="2" right="2">
                                <IconButton
                                    size="xs"
                                    description="Close"
                                    // Our animation principle is to respond to user input immediately
                                    // without animation.
                                    onPress={onCloseWithoutAnimation}
                                    withoutTooltip={true}
                                >
                                    <X />
                                </IconButton>
                            </Box>
                        </Box>
                    </section>
                </FocusScope>
            </OverlayScopeContextProvider>
        </Box>,
        portalElement,
    );
}
