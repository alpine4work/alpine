import {NativeMobileBridge} from "~/client/web/remix/native_mobile_bridge.js";
import {scheduleMicrotask} from "~/shared/helpers/async/schedule_microtask.js";
import {scheduleUncaughtError} from "~/shared/helpers/async/schedule_uncaught_error.js";
import {assert} from "~/shared/helpers/control/assert.js";

let navigationAnimationCount = 0;
let navigationAnimationCallbacks = new Set<() => void>();
let isNativeMobileNavigationAnimationCallbackScheduled = false;

/**
 * Start tracking a navigation animation driven by web code. Must call
 * `trackNavigationAnimationFinish()` when the animation completes.
 */
export function trackNavigationAnimationStart() {
    navigationAnimationCount += 1;
}

/**
 * Stop tracking a navigation animation. If there are any callbacks waiting for
 * navigation animations to complete they will be called immediately.
 */
export function trackNavigationAnimationFinish() {
    assert(navigationAnimationCount > 0);

    navigationAnimationCount -= 1;

    if (navigationAnimationCount === 0) {
        const callbacks = navigationAnimationCallbacks;
        navigationAnimationCallbacks = new Set();

        for (const callback of callbacks) {
            try {
                callback();
            } catch (error) {
                scheduleUncaughtError(error);
            }
        }
    }
}

/**
 * Schedule a callback to be run after any ongoing navigation animation completes.
 * For instance, we wait for navigation animations to complete before initially
 * focusing elements.
 *
 * In our native mobile app we'll wait for the native driven push/pop navigation
 * animations. Web code can also record navigation animations with
 * `trackNavigationAnimationStart()`. For instance, the peek open animation counts
 * as a navigation animation.
 */
export function scheduleAfterNavigationAnimation(callback: () => void): () => void {
    // In our native mobile app, we need to ask our native mobile wrapper if there's an
    // ongoing native navigation animation.
    if (NativeMobileBridge && !isNativeMobileNavigationAnimationCallbackScheduled) {
        isNativeMobileNavigationAnimationCallbackScheduled = true;
        trackNavigationAnimationStart();

        NativeMobileBridge.navigation.scheduleAfterAnimation(() => {
            isNativeMobileNavigationAnimationCallbackScheduled = false;
            trackNavigationAnimationFinish();
        });
    }

    let isCancelled = false;
    let shouldCleanup = false;

    // Waiting a microtask does two things:
    //
    // 1. If there are no navigation animations and we need to immediately call
    //    `callback()` we'd like to call `callback()` asynchronously.
    //
    // 2. If we're in a React layout effect, the layout effect of a parent component
    //    may call `trackNavigationAnimationStart()`. We want to let React call all of
    //    its layout effect handlers before checking to see if there's a navigation
    //    animation.
    //
    //     This happens for `<PeekStack>`. If we're auto-focusing something in a peek
    //     in a layout effect then the child layout effect runs before the parent
    //     layout effect which calls `trackNavigationAnimationStart()`. You can test
    //     this by creating a new channel from the create menu. The channel name should
    //     focus after the peek animation completes.
    scheduleMicrotask(() => {
        if (isCancelled) return;

        if (navigationAnimationCount === 0) {
            try {
                callback();
            } catch (error) {
                scheduleUncaughtError(error);
            }
        } else {
            shouldCleanup = true;
            navigationAnimationCallbacks.add(callback);
        }
    });

    return () => {
        isCancelled = true;
        if (shouldCleanup) navigationAnimationCallbacks.delete(callback);
    };
}
