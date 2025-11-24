import {Memo, RefObject, useCallback, useContext, useEffect} from "react";
import {
    BottomBarFrameContext,
    bottomBarFrameContextForTest,
} from "~/client/web/design/internal/bottom_bar_frame_context.js";
import {
    mobileBottomBarKeyboardToolbarHeight,
    mobileBottomBarKeyboardToolbarHeightRem,
} from "~/client/web/design/mobile_bottom_bar.js";
import {useIsBehindMobileFullScreenModal} from "~/client/web/design/use_is_behind_mobile_full_screen_modal.js";
import {throwIfRendering} from "~/client/web/helpers/lifecycle/throw_if_rendering.js";
import {useLayoutEffectWithoutServerSideWarning} from "~/client/web/helpers/lifecycle/use_layout_effect_without_server_side_warning.js";
import {
    addResizeListenerForElement,
    addSuppressResizeLoopErrorNotificationForElement,
    removeResizeListenerForElement,
    removeSuppressResizeLoopErrorNotificationForElement,
} from "~/client/web/helpers/use_resize_observer.js";
import {NativeMobileBridge} from "~/client/web/remix/native_mobile_bridge.js";
import {getRemPxWithoutListening} from "~/client/web/remix/spacing_scale_context.js";
import {useIsInertNativeMobileRoute} from "~/client/web/remix/use_is_inert_native_mobile_route.js";
import {spacing} from "~/shared/design/core/spacing.js";
import {InternalError} from "~/shared/error/error.js";
import {scheduleMicrotask} from "~/shared/helpers/async/schedule_microtask.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {EventEmitter} from "~/shared/helpers/control/event_emitter.js";

function useBottomBarFrameContext(): BottomBarFrameContext {
    const context = useContext(BottomBarFrameContext);

    if (context === null) {
        // In Jest tests, act like we are not in the initial render unless an
        // `<BottomBarFrameContextProvider>` is explicitly used.
        if (import.meta.jest) return assertExists(bottomBarFrameContextForTest);

        throw new InternalError("Must be rendered in an `<BottomBarFrameContextProvider>`");
    }

    return context;
}

const zeroBottomBarHeight = {visibleMobileKeyboard: 0, hiddenMobileKeyboard: 0};

/**
 * Get the current bottom bar height.
 *
 * The returned function reads mutable state so you may not call it
 * during React renders.
 */
export function useGetCurrentBottomBarHeight(): Memo<
    () => {
        readonly visibleMobileKeyboard: number;
        readonly hiddenMobileKeyboard: number;
    }
> {
    const context = useContext(BottomBarFrameContext);

    return useCallback(() => {
        // We read mutable state (`context.currentBottomBarHeight`) so this function
        // can't be called during a React render.
        throwIfRendering();

        if (context === null) return zeroBottomBarHeight;

        return (context.currentBottomBarHeight ??= zeroBottomBarHeight);
    }, [context]);
}

/**
 * Subscribe to changes in mobile bottom bar frame sizes.
 *
 * Does nothing outside of mobile environments.
 */
export function useSubscribeToBottomBarFrameChange(): Memo<
    (
        listener: (event: {
            readonly oldBottomBarHeight: {
                readonly visibleMobileKeyboard: number;
                readonly hiddenMobileKeyboard: number;
            };
            readonly newBottomBarHeight: {
                readonly visibleMobileKeyboard: number;
                readonly hiddenMobileKeyboard: number;
            };
            readonly wasBottomBarMounted: boolean;
            readonly wasBottomBarUnmounted: boolean;
        }) => void,
    ) => () => void
> {
    const context = useBottomBarFrameContext();

    return useCallback(
        listener => {
            return (context.bottomBarFrameChangeEmitter ??= new EventEmitter()).subscribe(listener);
        },
        [context],
    );
}

/**
 * Register a mobile bottom bar for the height calculations of
 * `subscribeToMobilBottomBarFrameChange()`.
 */
export function useRegisterBottomBarFrame<Element extends HTMLElement>(
    elementRef: RefObject<Element | null>,
    {
        isDisabled = false,
        withMobileKeyboardToolbar = false,
        isReplacingOtherBottomBar = false,
    }: {
        isDisabled?: boolean;
        withMobileKeyboardToolbar?: boolean;
        isReplacingOtherBottomBar?: boolean;
    } = {},
) {
    const context = useBottomBarFrameContext();
    const isInertNativeMobileRoute = useIsInertNativeMobileRoute();
    const isBehindMobileFullScreenModal = useIsBehindMobileFullScreenModal();
    const isInert = isInertNativeMobileRoute || isBehindMobileFullScreenModal;

    useLayoutEffectWithoutServerSideWarning(() => {
        if (isInert) return;
        if (isDisabled) return;

        const element = assertExists(elementRef.current);

        let isCancelled = false;
        let hasFinishedEffectSetup = false;
        let hasCalledHandleResizeDuringEffectSetup = false;
        let isMounting = !isReplacingOtherBottomBar;

        // Emit change after a microtask so it doesn't run as part of React's
        // mounting phase which may have not finished setting up refs that may be used
        // by event emitter listeners.
        scheduleMicrotask(() => {
            if (isCancelled) return;

            hasFinishedEffectSetup = true;
            if (!hasCalledHandleResizeDuringEffectSetup) {
                handleResize();
            }
        });

        let currentHeight: number | null = null;
        let unregister: ((options: {isUnmounting: boolean}) => void) | null = null;

        const handleResize = () => {
            if (!hasFinishedEffectSetup) {
                hasCalledHandleResizeDuringEffectSetup = true;
                return;
            }

            const {height} = element.getBoundingClientRect();

            if (currentHeight !== height) {
                currentHeight = height;

                const oldUnregister = unregister;
                unregister = registerBottomBarFrame(context, height, {
                    isMounting,
                    withMobileKeyboardToolbar,
                });
                isMounting = false;

                // Make sure to unregister AFTER registering the new height. That way if the
                // height didn't change there will be no update notifications.
                oldUnregister?.({isUnmounting: false});
            }
        };

        // We appear to have no visual issues when this resizes. Mainly adding a
        // resize element listener to this element causes a suppressed warning from
        // `<VirtualizedScrollView>` to be logged.
        addSuppressResizeLoopErrorNotificationForElement(element);

        addResizeListenerForElement(element, handleResize);

        return () => {
            isCancelled = true;

            removeResizeListenerForElement(element, handleResize);
            removeSuppressResizeLoopErrorNotificationForElement(element);

            // Emit change after a microtask so it doesn't run as part of React's
            // unmounting phase. If React immediately remounts and we re-register with the
            // same height it means we'll end up emitting no events. If React remounts with
            // a different height then we'll only end up emitting one event.
            //
            // Double microtask so microtasks scheduled by effect React mount handlers
            // (like the one in this effect) can run before we finish unmounting and we can
            // skip sending an event if a remount doesn't change the height.
            scheduleMicrotask(() => {
                scheduleMicrotask(() => {
                    unregister?.({isUnmounting: true});
                });
            });
        };
    }, [
        context,
        elementRef,
        isDisabled,
        isInert,
        isReplacingOtherBottomBar,
        withMobileKeyboardToolbar,
    ]);
}

/**
 * Register a mobile bottom bar that just provides a keyboard toolbar for the
 * height calculations of `subscribeToMobilBottomBarFrameChange()`.
 */
export function useRegisterBottomBarMobileKeyboardToolbarFrame({
    isDisabled = false,
}: {isDisabled?: boolean} = {}) {
    const context = useBottomBarFrameContext();
    const isInertNativeMobileRoute = useIsInertNativeMobileRoute();
    const isBehindMobileFullScreenModal = useIsBehindMobileFullScreenModal();
    const isInert = isInertNativeMobileRoute || isBehindMobileFullScreenModal;

    useLayoutEffectWithoutServerSideWarning(() => {
        if (isInert) return;
        if (isDisabled) return;

        let isCancelled = false;
        let unregister: ((options: {isUnmounting: boolean}) => void) | null = null;

        // Emit change after a microtask so it doesn't run as part of React's
        // unmounting phase. If React immediately remounts and we re-register with the
        // same height it means we'll end up emitting no events. If React remounts with
        // a different height then we'll only end up emitting one event.
        scheduleMicrotask(() => {
            if (isCancelled) return;

            unregister = registerBottomBarFrame(context, 0, {
                // Keyboard mobile toolbar frames don't resize. We only really
                // unregister/re-register if `isDisabled` changes.
                isMounting: true,
                withMobileKeyboardToolbar: true,
            });
        });

        return () => {
            isCancelled = true;

            // Emit change after a microtask so it doesn't run as part of React's
            // unmounting phase. If React immediately remounts and we re-register with the
            // same height it means we'll end up emitting no events. If React remounts with
            // a different height then we'll only end up emitting one event.
            //
            // Double microtask so microtasks scheduled by effect React mount handlers can
            // run before we finish unmounting and we can skip sending an event if a
            // remount doesn't change the height.
            scheduleMicrotask(() => {
                scheduleMicrotask(() => {
                    unregister?.({isUnmounting: true});
                });
            });
        };
    }, [context, isDisabled, isInert]);
}

let webMobileKeyboardToolbarSafeAreaInsetBottomCount = 0;

/**
 * If we're in the web mobile app, we want to add safe area inset bottom when
 * we've animated our mobile keyboard toolbar up so it doesn't cover content.
 *
 * If on mobile web you're animating a keyboard toolbar up/down then you must
 * call this hook in addition to
 * `useRegisterBottomBarMobileKeyboardToolbarFrame()` or
 * `useRegisterBottomBarFrame()` with the state boolean you use to tell if the
 * keyboard toolbar is visible or not.
 */
export function useWebMobileKeyboardToolbarSafeAreaInsetBottom({isVisible}: {isVisible: boolean}) {
    useEffect(() => {
        if (NativeMobileBridge) return;
        if (!isVisible) return;

        if (webMobileKeyboardToolbarSafeAreaInsetBottomCount === 0) {
            document.documentElement.style.setProperty(
                "--safe-area-inset-bottom",
                spacing[mobileBottomBarKeyboardToolbarHeight],
            );
        }

        webMobileKeyboardToolbarSafeAreaInsetBottomCount += 1;

        return () => {
            webMobileKeyboardToolbarSafeAreaInsetBottomCount -= 1;

            if (webMobileKeyboardToolbarSafeAreaInsetBottomCount === 0) {
                document.documentElement.style.removeProperty("--safe-area-inset-bottom");
            }
        };
    }, [isVisible]);
}

/**
 * Register a mobile bottom bar for the height calculations of
 * `subscribeToMobilBottomBarFrameChange()`.
 */
function registerBottomBarFrame(
    context: BottomBarFrameContext,
    height: number,
    {
        isMounting,
        withMobileKeyboardToolbar = false,
    }: {
        isMounting: boolean;
        withMobileKeyboardToolbar: boolean;
    },
): (options: {isUnmounting: boolean}) => void {
    const bottomBarFrame = {height, withMobileKeyboardToolbar};

    context.bottomBarFrames.add(bottomBarFrame);

    const oldBottomBarHeight = (context.currentBottomBarHeight ??= {
        visibleMobileKeyboard: 0,
        hiddenMobileKeyboard: 0,
    });
    const newBottomBarHeight = {
        visibleMobileKeyboard: getMobileBottomBarHeight(context, true),
        hiddenMobileKeyboard: getMobileBottomBarHeight(context, false),
    };
    if (
        oldBottomBarHeight.hiddenMobileKeyboard !== newBottomBarHeight.hiddenMobileKeyboard ||
        oldBottomBarHeight.visibleMobileKeyboard !== newBottomBarHeight.visibleMobileKeyboard
    ) {
        context.currentBottomBarHeight = newBottomBarHeight;
        context.bottomBarFrameChangeEmitter?.emit({
            oldBottomBarHeight,
            newBottomBarHeight: context.currentBottomBarHeight,
            wasBottomBarMounted: isMounting,
            wasBottomBarUnmounted: false,
        });
    }

    return ({isUnmounting}: {isUnmounting: boolean}) => {
        context.bottomBarFrames.delete(bottomBarFrame);

        const oldBottomBarHeight = (context.currentBottomBarHeight ??= {
            visibleMobileKeyboard: 0,
            hiddenMobileKeyboard: 0,
        });
        const newBottomBarHeight = {
            visibleMobileKeyboard: getMobileBottomBarHeight(context, true),
            hiddenMobileKeyboard: getMobileBottomBarHeight(context, false),
        };
        if (
            oldBottomBarHeight.hiddenMobileKeyboard !== newBottomBarHeight.hiddenMobileKeyboard ||
            oldBottomBarHeight.visibleMobileKeyboard !== newBottomBarHeight.visibleMobileKeyboard
        ) {
            context.currentBottomBarHeight = newBottomBarHeight;
            context.bottomBarFrameChangeEmitter?.emit({
                oldBottomBarHeight,
                newBottomBarHeight: context.currentBottomBarHeight,
                wasBottomBarMounted: false,
                wasBottomBarUnmounted: isUnmounting,
            });
        }
    };
}

function getMobileBottomBarHeight(
    context: BottomBarFrameContext,
    isMobileKeyboardVisible: boolean,
): number {
    const remPx = getRemPxWithoutListening();

    let bottomBarHeight = 0;

    for (const bottomBar of context.bottomBarFrames) {
        bottomBarHeight = Math.max(
            bottomBarHeight,
            bottomBar.height +
                (isMobileKeyboardVisible && bottomBar.withMobileKeyboardToolbar
                    ? mobileBottomBarKeyboardToolbarHeightRem * remPx
                    : 0),
        );
    }

    return bottomBarHeight;
}
