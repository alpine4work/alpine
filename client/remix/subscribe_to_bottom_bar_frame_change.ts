import {getRemPxWithoutListening} from "~/client/design/helpers/use_rem_px.js";
import {mobileBottomBarKeyboardToolbarHeightRem} from "~/client/design/mobile_bottom_bar.js";
import {scheduleMicrotask} from "~/shared/helpers/async/schedule_microtask.js";
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
export function registerBottomBarFrame(
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
        // Emit change after a microtask so it doesn't run as part of React's
        // mounting phase which may have not finished setting up refs that may be used
        // by event emitter listeners.
        scheduleMicrotask(() => {
            const oldBottomBarHeight = (currentBottomBarHeight ??= {
                visibleMobileKeyboard: 0,
                hiddenMobileKeyboard: 0,
            });
            currentBottomBarHeight = {
                visibleMobileKeyboard: getMobileBottomBarHeight(true),
                hiddenMobileKeyboard: getMobileBottomBarHeight(false),
            };
            if (
                oldBottomBarHeight.hiddenMobileKeyboard !==
                    currentBottomBarHeight.hiddenMobileKeyboard ||
                oldBottomBarHeight.visibleMobileKeyboard !==
                    currentBottomBarHeight.visibleMobileKeyboard
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
            // Emit change after a microtask so it doesn't run as part of React's
            // unmounting phase. If React immediately remounts and we re-register with the
            // same height it means we'll end up emitting no events. If React remounts with
            // a different height then we'll only end up emitting one event.
            scheduleMicrotask(() => {
                const oldBottomBarHeight = (currentBottomBarHeight ??= {
                    visibleMobileKeyboard: 0,
                    hiddenMobileKeyboard: 0,
                });
                currentBottomBarHeight = {
                    visibleMobileKeyboard: getMobileBottomBarHeight(true),
                    hiddenMobileKeyboard: getMobileBottomBarHeight(false),
                };
                if (
                    oldBottomBarHeight.hiddenMobileKeyboard !==
                        currentBottomBarHeight.hiddenMobileKeyboard ||
                    oldBottomBarHeight.visibleMobileKeyboard !==
                        currentBottomBarHeight.visibleMobileKeyboard
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
export function registerBottomBarMobileKeyboardToolbarFrame() {
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
