import {animate} from "motion";
import {ReactNode, useCallback, useEffect, useInsertionEffect, useRef, useState} from "react";
import {Box} from "~/client/design/box.js";
import {disableMobileWebKitDefaultScroll} from "~/client/helpers/disable_mobile_web_kit_default_scroll.js";
import {useIsMounted} from "~/client/helpers/lifecycle/use_is_mounted.js";
import {useLayoutEffectWithoutServerSideWarning} from "~/client/helpers/lifecycle/use_layout_effect_without_server_side_warning.js";
import {NativeMobileBridge} from "~/client/remix/native_mobile_bridge.js";
import {easeOutCubic, parseCubicBezier} from "~/shared/design/easing.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";

export const mobileModalAnimationDurationMs = 250;
const mobileModalAnimationDurationLongMs = 250 * 1.5;
export const mobileModalAnimationEasingParsedCubicBezier = parseCubicBezier(
    easeOutCubic.cubicBezier,
);

type MobileModalAnimation = "Presenting" | "Dismissing" | null;

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
export function MobileModal({
    onClose,
    children,
}: {
    onClose: () => void;
    children?: ReactNode | ((props: {onCloseWithAnimation: () => void}) => ReactNode);
}) {
    const isMounted = useIsMounted();

    const modalRef = useRef<HTMLDivElement>(null);

    const [animation, setAnimation] = useState<MobileModalAnimation>("Presenting");

    const lastAnimationForInsertionEffectRef = useRef<MobileModalAnimation>(null);
    const lastAnimationForLayoutEffectRef = useRef<MobileModalAnimation>(null);

    const onCloseWithAnimation = useCallback(() => {
        setAnimation("Dismissing");
    }, []);

    useInsertionEffect(() => {
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
    }, [animation]);

    useLayoutEffectWithoutServerSideWarning(() => {
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
                            duration: mobileModalAnimationDurationLongMs / 1000,
                            easing: mobileModalAnimationEasingParsedCubicBezier,
                            // Make sure we use hardware acceleration for this animation in WebKit. By
                            // default `motion` turns it off.
                            // https://motion.dev/guides/performance#webkits-exceptions
                            allowWebkitAcceleration: true,
                        },
                    );

                    animation.finished.finally(() => {
                        setAnimation(null);
                    });
                    break;
                }
                case "Dismissing": {
                    const animation = animate(
                        modalElement,
                        {y: [0, modalElement.getBoundingClientRect().height]},
                        {
                            duration: mobileModalAnimationDurationLongMs / 1000,
                            easing: mobileModalAnimationEasingParsedCubicBezier,
                            // Make sure we use hardware acceleration for this animation in WebKit. By
                            // default `motion` turns it off.
                            // https://motion.dev/guides/performance#webkits-exceptions
                            allowWebkitAcceleration: true,
                        },
                    );

                    animation.finished.finally(() => {
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
    }, [animation, onClose]);

    useLayoutEffectWithoutServerSideWarning(() => {
        return () => {
            if (
                NativeMobileBridge &&
                !isMounted() &&
                lastAnimationForLayoutEffectRef.current === "Dismissing"
            ) {
                lastAnimationForInsertionEffectRef.current = null;
                lastAnimationForLayoutEffectRef.current = null;

                // Double request animation frame to make absolutely certain the browser
                // has stopped painting the modal.
                requestAnimationFrame(() => {
                    requestAnimationFrame(() => {
                        NativeMobileBridge!.navigation.dismissModal();
                    });
                });
            }
        };
    }, [isMounted]);

    useEffect(() => {
        // Disable default scroll while in a mobile modal. Otherwise scroll events will
        // fall through to the content we're rendering over which is strange since the
        // content is not visible.
        return disableMobileWebKitDefaultScroll();
    }, []);

    return (
        <Box
            ref={modalRef}
            position="fixed"
            inset="0"
            // Render above everything on the page including keyboard substitute and
            // navigation bar.
            zIndex="90"
            backgroundColor="grey-0"
        >
            {typeof children === "function" ? children({onCloseWithAnimation}) : children}
        </Box>
    );
}
