import {RefObject} from "react";
import {useIsInertNativeMobileRoute} from "~/app/router/native_mobile_outlet.js";
import {getRemPxWithoutListening} from "~/client/design/helpers/use_rem_px.js";
import {mobileBottomBarKeyboardToolbarHeightRem} from "~/client/design/mobile_bottom_bar.js";
import {useLayoutEffectWithoutServerSideWarning} from "~/client/helpers/lifecycle/use_layout_effect_without_server_side_warning.js";
import {
    addResizeListenerForElement,
    addSuppressResizeLoopErrorNotificationForElement,
    removeResizeListenerForElement,
    removeSuppressResizeLoopErrorNotificationForElement,
} from "~/client/helpers/use_resize_observer.js";
import {scheduleMicrotask} from "~/shared/helpers/async/schedule_microtask.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {EventEmitter} from "~/shared/helpers/control/event_emitter.js";

let currentBottomBarHeight: {visibleMobileKeyboard: number; hiddenMobileKeyboard: number} | null =
    null;

let bottomBarFrameChangeEmitter: EventEmitter<{
    oldBottomBarHeight: {visibleMobileKeyboard: number; hiddenMobileKeyboard: number};
    newBottomBarHeight: {visibleMobileKeyboard: number; hiddenMobileKeyboard: number};
}> | null = null;
let bottomBarFrames: Set<{height: number; withMobileKeyboardToolbar: boolean}> | null = null;

/**
 * Get the current bottom bar height.
 */
export function getCurrentBottomBarHeight(): {
    readonly visibleMobileKeyboard: number;
    readonly hiddenMobileKeyboard: number;
} {
    return (currentBottomBarHeight ??= {visibleMobileKeyboard: 0, hiddenMobileKeyboard: 0});
}

/**
 * Register a mobile bottom bar for the height calculations of
 * `subscribeToMobilBottomBarFrameChange()`.
 */
export function useRegisterBottomBarFrame<Element extends HTMLElement>(
    elementRef: RefObject<Element>,
    {withMobileKeyboardToolbar = false}: {withMobileKeyboardToolbar?: boolean} = {},
) {
    const isInertNativeMobileRoute = useIsInertNativeMobileRoute();

    useLayoutEffectWithoutServerSideWarning(() => {
        if (isInertNativeMobileRoute) return;

        const element = assertExists(elementRef.current);

        let isCancelled = false;
        let hasFinishedEffectSetup = false;
        let hasCalledHandleResizeDuringEffectSetup = false;

        // Emit change after a microtask so it doesn't run as part of React's
        // mounting phase which may have not finished setting up refs that may be used
        // by event emitter listeners.
        scheduleMicrotask(() => {
            if (isCancelled) return;

            hasFinishedEffectSetup = true;
            if (hasCalledHandleResizeDuringEffectSetup) {
                hasCalledHandleResizeDuringEffectSetup = false;
                handleResize();
            }
        });

        let currentHeight: number | null = null;
        let unregister: (() => void) | null = null;

        const handleResize = () => {
            if (!hasFinishedEffectSetup) {
                hasCalledHandleResizeDuringEffectSetup = true;
                return;
            }

            const {height} = element.getBoundingClientRect();

            if (currentHeight !== height) {
                currentHeight = height;

                const oldUnregister = unregister;
                unregister = registerBottomBarFrame(height, {withMobileKeyboardToolbar});

                // Make sure to unregister AFTER registering the new height. That way if the
                // height didn't change there will be no update notifications.
                oldUnregister?.();
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
            scheduleMicrotask(() => {
                unregister?.();
            });
        };
    }, [elementRef, isInertNativeMobileRoute, withMobileKeyboardToolbar]);
}

/**
 * Register a mobile bottom bar that just provides a keyboard toolbar for the
 * height calculations of `subscribeToMobilBottomBarFrameChange()`.
 */
export function useRegisterBottomBarMobileKeyboardToolbarFrame() {
    const isInertNativeMobileRoute = useIsInertNativeMobileRoute();

    useLayoutEffectWithoutServerSideWarning(() => {
        if (isInertNativeMobileRoute) return;

        let isCancelled = false;
        let unregister: (() => void) | null = null;

        // Emit change after a microtask so it doesn't run as part of React's
        // unmounting phase. If React immediately remounts and we re-register with the
        // same height it means we'll end up emitting no events. If React remounts with
        // a different height then we'll only end up emitting one event.
        scheduleMicrotask(() => {
            if (isCancelled) return;

            unregister = registerBottomBarMobileKeyboardToolbarFrame();
        });

        return () => {
            isCancelled = true;

            // Emit change after a microtask so it doesn't run as part of React's
            // unmounting phase. If React immediately remounts and we re-register with the
            // same height it means we'll end up emitting no events. If React remounts with
            // a different height then we'll only end up emitting one event.
            scheduleMicrotask(() => {
                unregister?.();
            });
        };
    }, [isInertNativeMobileRoute]);
}

/**
 * Register a mobile bottom bar for the height calculations of
 * `subscribeToMobilBottomBarFrameChange()`.
 */
function registerBottomBarFrame(
    height: number,
    {withMobileKeyboardToolbar = false}: {withMobileKeyboardToolbar?: boolean} = {},
): () => void {
    const bottomBarFrame = {height, withMobileKeyboardToolbar};

    (bottomBarFrames ??= new Set()).add(bottomBarFrame);

    const oldBottomBarHeight = (currentBottomBarHeight ??= {
        visibleMobileKeyboard: 0,
        hiddenMobileKeyboard: 0,
    });
    const newBottomBarHeight = {
        visibleMobileKeyboard: getMobileBottomBarHeight(true),
        hiddenMobileKeyboard: getMobileBottomBarHeight(false),
    };
    if (
        oldBottomBarHeight.hiddenMobileKeyboard !== newBottomBarHeight.hiddenMobileKeyboard ||
        oldBottomBarHeight.visibleMobileKeyboard !== newBottomBarHeight.visibleMobileKeyboard
    ) {
        currentBottomBarHeight = newBottomBarHeight;
        (bottomBarFrameChangeEmitter ??= new EventEmitter()).emit({
            oldBottomBarHeight,
            newBottomBarHeight: currentBottomBarHeight,
        });
    }

    return () => {
        (bottomBarFrames ??= new Set()).delete(bottomBarFrame);

        const oldBottomBarHeight = (currentBottomBarHeight ??= {
            visibleMobileKeyboard: 0,
            hiddenMobileKeyboard: 0,
        });
        const newBottomBarHeight = {
            visibleMobileKeyboard: getMobileBottomBarHeight(true),
            hiddenMobileKeyboard: getMobileBottomBarHeight(false),
        };
        if (
            oldBottomBarHeight.hiddenMobileKeyboard !== newBottomBarHeight.hiddenMobileKeyboard ||
            oldBottomBarHeight.visibleMobileKeyboard !== newBottomBarHeight.visibleMobileKeyboard
        ) {
            currentBottomBarHeight = newBottomBarHeight;
            (bottomBarFrameChangeEmitter ??= new EventEmitter()).emit({
                oldBottomBarHeight,
                newBottomBarHeight: currentBottomBarHeight,
            });
        }
    };
}

/**
 * Register a mobile bottom bar that just provides a keyboard toolbar for the
 * height calculations of `subscribeToMobilBottomBarFrameChange()`.
 */
function registerBottomBarMobileKeyboardToolbarFrame() {
    return registerBottomBarFrame(0, {withMobileKeyboardToolbar: true});
}

function getMobileBottomBarHeight(isMobileKeyboardVisible: boolean): number {
    const remPx = getRemPxWithoutListening();

    let bottomBarHeight = 0;

    for (const bottomBar of bottomBarFrames ?? []) {
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

/**
 * Subscribe to changes in mobile bottom bar frame sizes.
 *
 * Does nothing outside of mobile environments.
 */
export function subscribeToBottomBarFrameChange(
    listener: (event: {
        readonly oldBottomBarHeight: {
            readonly visibleMobileKeyboard: number;
            readonly hiddenMobileKeyboard: number;
        };
        readonly newBottomBarHeight: {
            readonly visibleMobileKeyboard: number;
            readonly hiddenMobileKeyboard: number;
        };
    }) => void,
): () => void {
    return (bottomBarFrameChangeEmitter ??= new EventEmitter()).subscribe(listener);
}
