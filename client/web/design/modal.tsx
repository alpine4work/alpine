import classNames from "classnames";
import {X} from "phosphor-react";
import {ReactNode, useEffect, useRef, useState} from "react";
import {FocusScope} from "react-aria";
import {createPortal} from "react-dom";
import {Box} from "~/client/web/design/box.js";
import {IconButton} from "~/client/web/design/icon_button.js";
import {useOverlayBlockingPortalElement} from "~/client/web/design/overlay_helpers.js";
import {
    OverlayScopeContextProvider,
    RootOverlayScopeContextProvider,
} from "~/client/web/design/overlay_scope_context_provider.js";
import {
    isElementOwnedBy,
    setElementOwnedBy,
} from "~/client/web/helpers/elements/is_element_owned_by.js";
import {
    GlobalKeyDownEvent,
    GlobalKeyDownEventModal,
} from "~/client/web/helpers/global_key_down_event.js";
import {useEvent} from "~/client/web/helpers/lifecycle/use_event.js";
import {useLayoutEffectWithoutServerSideWarning} from "~/client/web/helpers/lifecycle/use_layout_effect_without_server_side_warning.js";
import {Sprinkles, modalStyles, sprinkles} from "~/client/web/styles/styles.js";
import {greyElevated1ClassName} from "~/shared/design/core/constant_class_names.js";
import {RemLength, Spacing, isRemLength, spacing} from "~/shared/design/core/spacing.js";
import {Timeout, createTimeout} from "~/shared/helpers/async/timeout.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";

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
    onClose: onCloseWithoutAnimationFromProps,
    "aria-describedby": ariaDescribedBy,
    "data-ownedby": dataOwnedBy,
    ownedByElement,
    maxWidth = defaultModalMaxWidth,
    height = "auto",
    maxHeight = "full",
    margin = "5",
    borderRadius = "1.5",
    backgroundColor = "grey-0",
    withoutOpenAnimation,
    withoutCloseAnimation,
    withoutCloseButton,
    withoutCloseInteractions,
    withoutElevatedGrey,
    withBlurBackdropFilter,
    withoutRestoreFocus,
}: {
    /**
     * The contents of the modal. If the contents are too big for the screen then the
     * content area will scroll.
     */
    children?:
        | ReactNode
        | ((props: {
              onCloseWithAnimation: () => void;
              onCloseWithoutAnimation: () => void;
          }) => ReactNode);

    /**
     * Callback that will close and unmount the modal. The parent component is expected
     * to manage the modal lifecycle. May be called after a short delay if the modal is
     * animating out.
     */
    onClose: () => void;

    /**
     * The id for an element in the DOM that describes this modal for assistive
     * technology. See [`aria-describedby`][1].
     *
     * [1]:
     *     https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Attributes/aria-describedby
     */
    "aria-describedby"?: string;

    /**
     * Allows you to set an element that owns this modal. Then `isElementOwnedBy()`
     * will start reporting the modal as owned by the provided element which is useful
     * for utilities like `useOutsideInteraction()` to understand whether an
     * interaction is inside or outside some focused element.
     */
    "data-ownedby"?: string;

    /**
     * Allows you to set an element that owns this modal. Then `isElementOwnedBy()`
     * will start reporting the modal as owned by the provided element which is useful
     * for utilities like `useOutsideInteraction()` to understand whether an
     * interaction is inside or outside some focused element.
     */
    ownedByElement?: Element | null;

    /**
     * The maximum width for this modal. Defaults to `128`.
     */
    maxWidth?: Spacing | RemLength | "full";

    /**
     * How height is handled for this modal. Defaults to `auto` which means the modal
     * height will be as big as it's content height. If you want the modal's height to
     * stretch across all available space then use `full`.
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

    /**
     * How much margin is there around the modal when its width and height are `full`.
     * Default is `5`.
     */
    margin?: "5" | "6" | "7" | "8";

    /**
     * Border radius for the modal content.
     */
    borderRadius?: "1.5" | "2" | "2.5" | "none";

    /**
     * Background color for the modal content.
     */
    backgroundColor?: Sprinkles["backgroundColor"];

    /**
     * The modal will never animate when opening if set to true. Otherwise we fade in
     * the modal when opened.
     */
    withoutOpenAnimation?: boolean;

    /**
     * The modal will never animate when closing if set to true. Otherwise we fade out
     * the modal when closed indirectly.
     */
    withoutCloseAnimation?: boolean;

    /**
     * Don't include the close button in the top right corner. Useful if you want to
     * reduce decision overload. The user can still use the keyboard or click the
     * background to close the modal. We just won't have an explicit action.
     */
    withoutCloseButton?: boolean;

    /**
     * If true, disables all close interactions. Include the close button, clicking the
     * underlay to close, and pressing the escape key to close.
     *
     * Defaults to false. Automatically sets `withoutCloseButton` to true.
     */
    withoutCloseInteractions?: boolean;

    /**
     * Don't use an elevated grey color scheme for the modal. By default for elements
     * with a higher elevation we use a slightly lighter color scheme in dark mode to
     * make it appear closer to the user.
     */
    withoutElevatedGrey?: boolean;

    /**
     * Should we add a `backdrop-filter` style to the modal? Only useful if you set
     * `backgroundColor` to something semi-transparent.
     */
    withBlurBackdropFilter?: boolean;

    /**
     * Don't restore focus to the previously focused element when the modal closes.
     */
    withoutRestoreFocus?: boolean;
} & (
    | {
          /**
           * A label exposed to assistive technology (through `aria-label`) when there is no
           * visible label for the element.
           */
          "aria-label": string;
          "aria-labelledby"?: undefined;
      }
    | {
          /**
           * A reference to another element (through `aria-labelledby`) with a visible label
           * for this element. Usually a title element like an `<h2>` for modals.
           */
          "aria-labelledby": string;
          "aria-label"?: undefined;
      }
)) {
    const modalRef = useRef<HTMLDivElement>(null);
    const modalAlertRef = useRef<HTMLDivElement>(null);

    const portalElement = assertExists(
        useOverlayBlockingPortalElement(),
        "Can not render modal before portal element is available",
    );
    const [isFadingOut, setIsFadingOut] = useState(false);

    const onCloseWithoutAnimation = useEvent(onCloseWithoutAnimationFromProps);
    useEffect(() => {
        if (!isFadingOut) return;

        let resetTimeout: Timeout | null = null;

        const timeout = createTimeout(() => {
            onCloseWithoutAnimation();

            // If the `onClose()` callback doesn't actually close the modal after 1s, then the
            // modal component is still mounted so should be made visible again.
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

    useLayoutEffectWithoutServerSideWarning(() => {
        const modalElement = assertExists(modalRef.current);

        if (!ownedByElement) return;

        setElementOwnedBy(modalElement, ownedByElement);
        return () => {
            setElementOwnedBy(modalElement, null);
        };
    }, [ownedByElement]);

    // Immediately focus the modal on mount unless some component in the modal has
    // already been focused. (e.g. We focus the primary save button in `<ModalDialog>`
    // on mount.)
    const hasInitiallyMountedRef = useRef(false);
    useEffect(() => {
        if (hasInitiallyMountedRef.current) return;
        hasInitiallyMountedRef.current = true;

        const modalAlertElement = assertExists(modalAlertRef.current);
        if (
            !document.activeElement ||
            !isElementOwnedBy(modalAlertElement, document.activeElement)
        ) {
            modalAlertElement.focus();
        }
    }, []);

    return createPortal(
        <Box
            ref={modalRef}
            className={modalStyles.modalContainerClassName}
            position="fixed"
            // Render over other overlays.
            zIndex="80"
            inset="0"
            display="flex"
            justifyContent="center"
            alignItems="center"
            padding={margin}
            style={{
                animation: isFadingOut ? modalStyles.modalFadeOutAnimation : undefined,
            }}
            overflow="hidden"
            data-ownedby={dataOwnedBy}
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
                // If the underlay is clicked, we close the modal. This element is not focusable or
                // keyboard accessible. You can hit the "Escape" key as a shortcut to close the
                // modal.
                onPointerDown={!withoutCloseInteractions ? onCloseWithAnimation : undefined}
            />
            <FocusScope restoreFocus={!withoutRestoreFocus} contain>
                <RootOverlayScopeContextProvider>
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
                                ref={modalAlertRef}
                                role="alertdialog"
                                // It's important the modal is focusable for `<FocusScope contain>`. That way when
                                // you click out of a focusable element in the modal, focus goes to this element
                                // instead of `document.body`. If `<FocusScope contain>` sees focus on
                                // `document.body` then it will move focus right back to the element that was
                                // blurred which is not what the user wants.
                                tabIndex={-1}
                                aria-modal="true"
                                aria-label={ariaLabel}
                                aria-labelledby={ariaLabelledBy}
                                aria-describedby={ariaDescribedBy}
                                className={classNames(
                                    !withoutElevatedGrey && greyElevated1ClassName,
                                    sprinkles({
                                        position: "relative",
                                        zIndex: "0",
                                        width: "full",
                                        height,
                                        backgroundColor,
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
                                    backdropFilter: withBlurBackdropFilter
                                        ? "blur(15px)"
                                        : undefined,
                                    WebkitBackdropFilter: withBlurBackdropFilter
                                        ? "blur(15px)"
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
                                        {!withoutCloseInteractions && !withoutCloseButton && (
                                            <Box position="absolute" top="1.5" right="1.5">
                                                <IconButton
                                                    size="xs"
                                                    description="Close"
                                                    withoutTooltip={true}
                                                    // Our animation principle is to respond to user input immediately without
                                                    // animation.
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
                </RootOverlayScopeContextProvider>
            </FocusScope>
        </Box>,
        portalElement,
    );
}
