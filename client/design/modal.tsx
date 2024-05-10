import classNames from "classnames";
import {X} from "phosphor-react";
import {ReactNode, useEffect, useState} from "react";
import {FocusScope} from "react-aria";
import {createPortal} from "react-dom";
import {Box} from "~/client/design/box.js";
import {IconButton} from "~/client/design/icon_button.js";
import {OverlayScopeContextProvider, useOverlayRootPortalElement} from "~/client/design/overlay.js";
import {
    GlobalKeyDownEvent,
    GlobalKeyDownEventModal,
} from "~/client/helpers/global_key_down_event.js";
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
    "aria-label": ariaLabel,
    "aria-labelledby": ariaLabelledBy,
    children,
    onClose: _onCloseWithoutAnimation,
    "aria-describedby": ariaDescribedBy,
    maxWidth = defaultModalMaxWidth,
    height = "auto",
    maxHeight = "full",
    borderRadius = "md",
    withoutOpenAnimation,
    withoutCloseAnimation,
    withoutCloseButton,
}: {
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
    maxWidth?: Spacing | RemLength | "full";

    /**
     * How height is handled for this modal. Defaults to `auto` which means the
     * modal height will be as big as it's content height. If you want the modal's
     * height to stretch across all available space then use `full`.
     *
     * `width` behaves as `full` but you can't configure it.
     */
    height?: "auto" | "full";

    /**
     * The maximum height of our modal. Defaults to `full`.
     *
     * Useful if you set `height="full"` to constrain the height of your modal.
     */
    maxHeight?: Spacing | RemLength | "full";

    borderRadius?: "md" | "lg";

    /**
     * The modal will never animate when opening if set to true. Otherwise we fade
     * in the modal when opened.
     */
    withoutOpenAnimation?: boolean;

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
} & (
    | {
          /**
           * A label exposed to assistive technology (through `aria-label`) when
           * there is no visible label for the element.
           */
          "aria-label": string;
          "aria-labelledby"?: undefined;
      }
    | {
          /**
           * A reference to another element (through `aria-labelledby`) with a
           * visible label for this element. Usually a title element like an `<h2>`
           * for modals.
           */
          "aria-labelledby": string;
          "aria-label"?: undefined;
      }
)) {
    const portalElement = assertExists(
        useOverlayRootPortalElement(),
        "Can not render modal before portal element is available",
    );
    const [isFadingOut, setIsFadingOut] = useState(false);

    const onCloseWithoutAnimation = useEvent(_onCloseWithoutAnimation);
    useEffect(() => {
        if (!isFadingOut) return;

        const timeout = createTimeout(() => {
            onCloseWithoutAnimation();

            // If the `onClose()` callback doesn't actually close the modal in the same
            // React render, the modal component is still mounted so should be made visible
            // again.
            setIsFadingOut(false);
        }, modalStyles.modalFadeOutDuration);

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
                style={{
                    opacity: modalStyles.modalUnderlayOpacityVar,
                    animation: !withoutOpenAnimation
                        ? modalStyles.modalUnderlayFadeInAnimation
                        : undefined,
                }}
                // If the underlay is clicked, we close the modal. This element is not
                // focusable or keyboard accessible. You can hit the "Escape" key as a shortcut
                // to close the modal.
                onClick={onCloseWithAnimation}
            />
            <FocusScope restoreFocus contain>
                <GlobalKeyDownEventModal>
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
                            className={classNames(
                                greyElevated1ClassName,
                                sprinkles({
                                    position: "relative",
                                    zIndex: "0",
                                    width: "full",
                                    height,
                                    backgroundColor: "grey-0",
                                    boxShadow: "elevation-40",
                                    borderRadius,
                                    display: "flex",
                                    overflow: "hidden",
                                }),
                            )}
                            style={{
                                maxWidth:
                                    maxWidth === "full"
                                        ? "100%"
                                        : isRemLength(maxWidth)
                                        ? maxWidth
                                        : spacing[maxWidth],
                                maxHeight:
                                    maxHeight === "full"
                                        ? "100%"
                                        : isRemLength(maxHeight)
                                        ? maxHeight
                                        : spacing[maxHeight],
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
                </GlobalKeyDownEventModal>
            </FocusScope>
        </Box>,
        portalElement,
    );
}
