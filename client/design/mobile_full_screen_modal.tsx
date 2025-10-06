import {animate} from "motion";
import {
    ReactNode,
    useCallback,
    useContext,
    useEffect,
    useInsertionEffect,
    useMemo,
    useRef,
    useState,
} from "react";
import {FocusScope} from "react-aria";
import {createPortal} from "react-dom";
import {BottomBarFrameContextProvider} from "~/client/design/bottom_bar_frame_context_provider.js";
import {Box} from "~/client/design/box.js";
import {MobileFullScreenModalContext} from "~/client/design/internal/mobile_full_screen_modal_context.js";
import {RootOverlayScopeContextProvider} from "~/client/design/overlay_scope_context_provider.js";
import {
    trackNavigationAnimationFinish,
    trackNavigationAnimationStart,
} from "~/client/design/schedule_after_navigation_animation.js";
import {useTextInputVisibilityMaintainer} from "~/client/design/use_text_input_visibility_maintainer.js";
import {disableMobileWebKitDefaultScroll} from "~/client/helpers/disable_mobile_web_kit_default_scroll.js";
import {
    isElementOwnedBy,
    setElementOwnedBy,
} from "~/client/helpers/elements/is_element_owned_by.js";
import {useEvents} from "~/client/helpers/lifecycle/use_event.js";
import {useIsMounted} from "~/client/helpers/lifecycle/use_is_mounted.js";
import {useLayoutEffectWithoutServerSideWarning} from "~/client/helpers/lifecycle/use_layout_effect_without_server_side_warning.js";
import {NativeMobileBridge} from "~/client/remix/native_mobile_bridge.js";
import {easeOutCubic, parseCubicBezier} from "~/shared/design/core/easing.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";

export const mobileFullScreenModalAnimationDurationMs = 250;
export const mobileFullScreenModalAnimationDurationLongMs = 250 * 1.5;
// eslint-disable-next-line react-refresh/only-export-components
export const mobileFullScreenModalAnimationEasingParsedCubicBezier = parseCubicBezier(
    easeOutCubic.cubicBezier,
);

type MobileFullScreenModalAnimation = "Presenting" | "Dismissing" | null;

/**
 * Context provider for `<MobileFullScreenModal>`. Lets all children know whether
 * or not they're behind a full screen modal.
 */
export function MobileFullScreenModalContextProvider({children}: {children?: ReactNode}) {
    const [presentedCount, setPresentedCount] = useState(0);

    const context: MobileFullScreenModalContext = useMemo(
        () => ({
            presentedCount,
            onAfterPresent: () => {
                setPresentedCount(presentedCount => {
                    return presentedCount + 1;
                });
            },
            onBeforeDismiss: () => {
                setPresentedCount(presentedCount => {
                    assert(presentedCount > 0);
                    return presentedCount - 1;
                });
            },
        }),
        [presentedCount],
    );

    return (
        <MobileFullScreenModalContext.Provider value={context}>
            {children}
        </MobileFullScreenModalContext.Provider>
    );
}

/**
 * A mobile modal covers the full screen (including the tab bar) and is
 * animated in from the bottom. It's not a part of URL navigation so if the
 * page reloads the modal state is lost. Useful for quick, single purpose,
 * focused interactions that depend on the current route's state. For example,
 * updating a link URL.
 *
 * In our native mobile apps, uses the native navigation for a fullscreen
 * modal.
 *
 * Generally we don't recommend navigating while a modal is opened. The modal
 * will become a part of the regular navigation stack and the animation may
 * look a little strange.
 *
 * Important: `onClose` must unmount this component! Otherwise the app will
 * appear frozen in our native mobile apps as they wait for the component to
 * unmount.
 */
export function MobileFullScreenModal({
    onClose: onCloseFromProps,
    children,
    "data-ownedby": dataOwnedBy,
    ownedByElement,
}: {
    onClose: () => void;
    children?:
        | ReactNode
        | ((props: {
              isAnimating: boolean;
              onCloseWithAnimation: (options?: {withoutFocus?: boolean}) => void;
          }) => ReactNode);
    "data-ownedby"?: string;
    ownedByElement?: Element | null;
}) {
    const modalContext = assertExists(
        useContext(MobileFullScreenModalContext),
        "Expected parent `<MobileFullScreenModalContextProvider>` component",
    );

    const isMounted = useIsMounted();
    const modalContainerRef = useRef<HTMLDivElement>(null);
    const modalRef = useRef<HTMLDivElement>(null);

    const [isInitialRender, setIsInitialRender] = useState(true);
    useEffect(() => setIsInitialRender(false), []);

    const [animation, actuallySetAnimation] =
        useState<MobileFullScreenModalAnimation>("Presenting");

    const hasCalledOnAfterPresentRef = useRef(false);
    const hasCalledOnBeforeDismissRef = useRef(false);

    const {onClose, setAnimation} = useEvents({
        onClose: onCloseFromProps,
        setAnimation: (animation: MobileFullScreenModalAnimation) => {
            if (
                animation === null &&
                !hasCalledOnAfterPresentRef.current &&
                !hasCalledOnBeforeDismissRef.current
            ) {
                hasCalledOnAfterPresentRef.current = true;
                modalContext.onAfterPresent();
            }

            if (
                animation === "Dismissing" &&
                hasCalledOnAfterPresentRef.current &&
                !hasCalledOnBeforeDismissRef.current
            ) {
                hasCalledOnBeforeDismissRef.current = true;
                modalContext.onBeforeDismiss();
            }

            actuallySetAnimation(animation);
        },
    });

    // Make sure we call `onBeforeDismiss()` when unmounting this component if
    // `setAnimation()` was not called.
    useEffect(() => {
        return () => {
            if (!isMounted()) {
                if (hasCalledOnAfterPresentRef.current && !hasCalledOnBeforeDismissRef.current) {
                    hasCalledOnBeforeDismissRef.current = true;
                    modalContext.onBeforeDismiss();
                }
            }
        };
    }, [isMounted, modalContext]);

    const lastAnimationForInsertionEffectRef = useRef<MobileFullScreenModalAnimation>(null);
    const lastAnimationForLayoutEffectRef = useRef<MobileFullScreenModalAnimation>(null);

    const onCloseWithAnimation = useCallback(
        ({withoutFocus = false}: {withoutFocus?: boolean} = {}) => {
            // Courtesy blur call if the focused element is in the overlay. Useful on
            // mobile Safari since if the focused element is removed from the DOM there
            // won't be a `focusout` event. So `useIsTextInputFocused()` won't update and
            // the "Done" button will continue to show in the navigation bar.
            //
            // Instead of calling `blur()` on the focused element, we call `focus()` on the
            // `<FocusScope contain>` container since otherwise `<FocusScope contain>` will
            // try to move focus back to the blurred element.
            if (
                !withoutFocus &&
                modalRef.current &&
                document.activeElement instanceof HTMLElement &&
                isElementOwnedBy(modalRef.current, document.activeElement)
            ) {
                const modalContainerElement = assertExists(modalContainerRef.current);
                modalContainerElement.focus();
            }

            if (!NativeMobileBridge) {
                setAnimation("Dismissing");
            } else {
                NativeMobileBridge.keyboard.scheduleAfterAnimation(() => {
                    setAnimation("Dismissing");
                });
            }
        },
        [setAnimation],
    );

    useInsertionEffect(() => {
        if (isInitialRender) return;

        if (lastAnimationForInsertionEffectRef.current === animation) return;
        lastAnimationForInsertionEffectRef.current = animation;

        switch (animation) {
            case null:
                break;
            case "Presenting":
                NativeMobileBridge?.navigation.preparePresentModal();
                break;
            case "Dismissing":
                NativeMobileBridge?.navigation.prepareDismissModal();
                break;
            default:
                throw exhaustive(animation);
        }
    }, [animation, isInitialRender]);

    useLayoutEffectWithoutServerSideWarning(() => {
        if (isInitialRender) return;

        if (lastAnimationForLayoutEffectRef.current === animation) return;
        lastAnimationForLayoutEffectRef.current = animation;

        if (!NativeMobileBridge) {
            const modalElement = assertExists(modalRef.current);

            switch (animation) {
                case null:
                    break;
                case "Presenting": {
                    const animation = animate(
                        modalElement,
                        {y: [modalElement.getBoundingClientRect().height, 0]},
                        {
                            duration: mobileFullScreenModalAnimationDurationLongMs / 1000,
                            ease: mobileFullScreenModalAnimationEasingParsedCubicBezier,
                        },
                    );

                    trackNavigationAnimationStart();

                    void animation.finished.finally(() => {
                        trackNavigationAnimationFinish();
                        setAnimation(null);
                    });
                    break;
                }
                case "Dismissing": {
                    const animation = animate(
                        modalElement,
                        {y: [0, modalElement.getBoundingClientRect().height]},
                        {
                            duration: mobileFullScreenModalAnimationDurationLongMs / 1000,
                            ease: mobileFullScreenModalAnimationEasingParsedCubicBezier,
                        },
                    );

                    trackNavigationAnimationStart();

                    void animation.finished.finally(() => {
                        trackNavigationAnimationFinish();
                        onClose();
                    });
                    break;
                }
                default:
                    throw exhaustive(animation);
            }
        } else {
            switch (animation) {
                case null:
                    break;
                case "Presenting": {
                    // Double request animation frame to make absolutely certain the browser
                    // has finished painting the modal.
                    requestAnimationFrame(() => {
                        requestAnimationFrame(() => {
                            assert(NativeMobileBridge);

                            NativeMobileBridge.navigation.scheduleAfterAnimation(() => {
                                setAnimation(null);
                            });

                            NativeMobileBridge.navigation.presentModal();
                        });
                    });
                    break;
                }
                case "Dismissing": {
                    onClose();
                    break;
                }
                default:
                    throw exhaustive(animation);
            }
        }
    }, [animation, isInitialRender, onClose, setAnimation]);

    useLayoutEffectWithoutServerSideWarning(() => {
        if (isInitialRender) return;

        return () => {
            if (NativeMobileBridge && !isMounted()) {
                lastAnimationForInsertionEffectRef.current = null;
                lastAnimationForLayoutEffectRef.current = null;

                // Double request animation frame to make absolutely certain the browser
                // has stopped painting the modal.
                //
                // Also to make sure if we're running after the above layout effect which calls
                // `presentModal()` that `dismissModal()` is called after `presentModal()`.
                // (Since `presentModal()` is called after double animation frames.)
                requestAnimationFrame(() => {
                    requestAnimationFrame(() => {
                        NativeMobileBridge!.navigation.dismissModal();
                    });
                });
            }
        };
    }, [isInitialRender, isMounted]);

    useEffect(() => {
        if (isInitialRender) return;

        // Disable default scroll while in a mobile modal. Otherwise scroll events will
        // fall through to the content we're rendering over which is strange since the
        // content is not visible.
        return disableMobileWebKitDefaultScroll();
    }, [isInitialRender]);

    useLayoutEffectWithoutServerSideWarning(() => {
        if (isInitialRender) return;

        const modalElement = assertExists(modalRef.current);

        if (!ownedByElement) return;

        setElementOwnedBy(modalElement, ownedByElement);
        return () => {
            setElementOwnedBy(modalElement, null);
        };
    }, [isInitialRender, ownedByElement]);

    return createPortal(
        <FocusScope contain>
            <Box
                ref={modalContainerRef}
                position="fixed"
                inset="0"
                // Render above everything on the page including keyboard substitute and
                // navigation bar.
                zIndex="90"
                // Focusable but not in tab order so `<FocusScope>` can put focus here if
                // nothing else is focused.
                tabIndex={-1}
            >
                <MobileFullScreenModalContextProvider>
                    <RootOverlayScopeContextProvider
                    // Make sure child overlays that need to render in the root overlay scope (e.g.
                    // keyboard toolbars) don't render behind our `z-index: 90` full screen
                    // element. The full screen modal should have the effect of fully replacing the
                    // screen.
                    //
                    // We have the `isInitialRender` state for our root overlay scope. Since if
                    // anything in `children` needs to render in our root overlay element (e.g.
                    // `<ContentEditorMobileKeyboardToolbar>` rendered by `<ContentEditor>` which
                    // is used by `<PostMobileEditorView>`) we need to wait for the root overlay
                    // ref (created by this component) to be populated before we can render or else
                    // `children` will throw errors.
                    >
                        <BottomBarFrameContextProvider
                        // Bottom bars in a fullscreen modal shouldn't effect the content underneath
                        // the modal.
                        >
                            {animation === null && <TextInputVisibilityMaintainer />}
                            {!isInitialRender && (
                                <Box
                                    ref={modalRef}
                                    position="absolute"
                                    inset="0"
                                    backgroundColor="grey-0"
                                    // Can set this so `isElementOwnedBy()` considers children of this modal to be
                                    // owned by some other element on the page.
                                    data-ownedby={
                                        typeof dataOwnedBy === "string" ? dataOwnedBy : undefined
                                    }
                                >
                                    {typeof children === "function"
                                        ? // eslint-disable-next-line react-compiler/react-compiler
                                          children({
                                              isAnimating: animation !== null,
                                              onCloseWithAnimation,
                                          })
                                        : children}
                                </Box>
                            )}
                        </BottomBarFrameContextProvider>
                    </RootOverlayScopeContextProvider>
                </MobileFullScreenModalContextProvider>
            </Box>
        </FocusScope>,
        // Render the mobile modal in `<body>`. So if it's a child of some native
        // bottom bar it doesn't get any weird positioning.
        document.body,
    );
}

function TextInputVisibilityMaintainer() {
    // We need a new text input visibility maintainer hook inside a full screen
    // modal's `<BottomBarFrameContextProvider>` so we can maintain visibility
    // considering the bottom bars within the modal.
    useTextInputVisibilityMaintainer();

    return null;
}
