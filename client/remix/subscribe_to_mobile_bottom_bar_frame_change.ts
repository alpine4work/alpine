import {getRemPxWithoutListening} from "~/client/design/helpers/use_rem_px.js";
import {mobileBottomBarKeyboardToolbarHeightRem} from "~/client/design/mobile_bottom_bar.js";
import {isMobileKeyboardFrameChangeEnabled} from "~/client/remix/subscribe_to_mobile_keyboard_frame_change.js";
import {scheduleMicrotask} from "~/shared/helpers/async/schedule_microtask.js";
import {EventEmitter} from "~/shared/helpers/control/event_emitter.js";
import {noop} from "~/shared/helpers/control/noop.js";

/**
 * If this isn't mobile WebKit (native app or otherwise) we don't have mobile
 * bottom bar frame change events.
 */
export const isMobileBottomBarFrameChangeEnabled = isMobileKeyboardFrameChangeEnabled;

let currentBottomBarHeight: {visibleKeyboard: number; hiddenKeyboard: number} | null = null;

let bottomBarFrameChangeEmitter: EventEmitter<{
    oldBottomBarHeight: {visibleKeyboard: number; hiddenKeyboard: number};
    newBottomBarHeight: {visibleKeyboard: number; hiddenKeyboard: number};
}> | null = null;
let bottomBarFrames: Set<{height: number; withKeyboardToolbar: boolean}> | null = null;

/**
 * Get the current bottom bar height.
 */
export function getCurrentBottomBarHeight(): {
    readonly visibleKeyboard: number;
    readonly hiddenKeyboard: number;
} {
    return (currentBottomBarHeight ??= {visibleKeyboard: 0, hiddenKeyboard: 0});
}

/**
 * Register a mobile bottom bar for the height calculations of
 * `subscribeToMobilBottomBarFrameChange()`.
 */
export function registerMobileBottomBarFrame(
    height: number,
    {withKeyboardToolbar = false}: {withKeyboardToolbar?: boolean} = {},
): () => void {
    if (!isMobileBottomBarFrameChangeEnabled) return noop;

    const bottomBarFrame = {height, withKeyboardToolbar};

    (bottomBarFrames ??= new Set()).add(bottomBarFrame);

    const oldBottomBarHeight = (currentBottomBarHeight ??= {
        visibleKeyboard: 0,
        hiddenKeyboard: 0,
    });
    const newBottomBarHeight = {
        visibleKeyboard: getMobileBottomBarHeight(true),
        hiddenKeyboard: getMobileBottomBarHeight(false),
    };
    if (
        oldBottomBarHeight.hiddenKeyboard !== newBottomBarHeight.hiddenKeyboard ||
        oldBottomBarHeight.visibleKeyboard !== newBottomBarHeight.visibleKeyboard
    ) {
        // Emit change after a microtask so it doesn't run as part of React's
        // mounting phase which may have not finished setting up refs that may be used
        // by event emitter listeners.
        scheduleMicrotask(() => {
            const oldBottomBarHeight = (currentBottomBarHeight ??= {
                visibleKeyboard: 0,
                hiddenKeyboard: 0,
            });
            currentBottomBarHeight = {
                visibleKeyboard: getMobileBottomBarHeight(true),
                hiddenKeyboard: getMobileBottomBarHeight(false),
            };
            if (
                oldBottomBarHeight.hiddenKeyboard !== currentBottomBarHeight.hiddenKeyboard ||
                oldBottomBarHeight.visibleKeyboard !== currentBottomBarHeight.visibleKeyboard
            ) {
                (bottomBarFrameChangeEmitter ??= new EventEmitter()).emit({
                    oldBottomBarHeight,
                    newBottomBarHeight: currentBottomBarHeight,
                });
            }
        });
    }

    return () => {
        (bottomBarFrames ??= new Set()).delete(bottomBarFrame);

        const oldBottomBarHeight = (currentBottomBarHeight ??= {
            visibleKeyboard: 0,
            hiddenKeyboard: 0,
        });
        const newBottomBarHeight = {
            visibleKeyboard: getMobileBottomBarHeight(true),
            hiddenKeyboard: getMobileBottomBarHeight(false),
        };
        if (
            oldBottomBarHeight.hiddenKeyboard !== newBottomBarHeight.hiddenKeyboard ||
            oldBottomBarHeight.visibleKeyboard !== newBottomBarHeight.visibleKeyboard
        ) {
            // Emit change after a microtask so it doesn't run as part of React's
            // unmounting phase. If React immediately remounts and we re-register with the
            // same height it means we'll end up emitting no events. If React remounts with
            // a different height then we'll only end up emitting one event.
            scheduleMicrotask(() => {
                const oldBottomBarHeight = (currentBottomBarHeight ??= {
                    visibleKeyboard: 0,
                    hiddenKeyboard: 0,
                });
                currentBottomBarHeight = {
                    visibleKeyboard: getMobileBottomBarHeight(true),
                    hiddenKeyboard: getMobileBottomBarHeight(false),
                };
                if (
                    oldBottomBarHeight.hiddenKeyboard !== currentBottomBarHeight.hiddenKeyboard ||
                    oldBottomBarHeight.visibleKeyboard !== currentBottomBarHeight.visibleKeyboard
                ) {
                    (bottomBarFrameChangeEmitter ??= new EventEmitter()).emit({
                        oldBottomBarHeight,
                        newBottomBarHeight: currentBottomBarHeight,
                    });
                }
            });
        }
    };
}

/**
 * Register a mobile bottom bar that just provides a keyboard toolbar for the
 * height calculations of `subscribeToMobilBottomBarFrameChange()`.
 */
export function registerMobileBottomBarKeyboardToolbarFrame() {
    return registerMobileBottomBarFrame(0, {withKeyboardToolbar: true});
}

function getMobileBottomBarHeight(isKeyboardVisible: boolean): number {
    const remPx = getRemPxWithoutListening();

    let bottomBarHeight = 0;

    for (const bottomBar of bottomBarFrames ?? []) {
        bottomBarHeight = Math.max(
            bottomBarHeight,
            bottomBar.height +
                (isKeyboardVisible && bottomBar.withKeyboardToolbar
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
export function subscribeToMobileBottomBarFrameChange(
    listener: (event: {
        readonly oldBottomBarHeight: {
            readonly visibleKeyboard: number;
            readonly hiddenKeyboard: number;
        };
        readonly newBottomBarHeight: {
            readonly visibleKeyboard: number;
            readonly hiddenKeyboard: number;
        };
    }) => void,
): () => void {
    if (!isMobileBottomBarFrameChangeEnabled) return () => {};

    return (bottomBarFrameChangeEmitter ??= new EventEmitter()).subscribe(listener);
}
