import {getRemPxWithoutListening} from "~/client/design/helpers/use_rem_px.js";
import {mobileBottomBarKeyboardToolbarHeightRem} from "~/client/design/mobile_bottom_bar.js";
import {getElementWindowSafeAreaInsetBottomPx} from "~/client/design/safe_area_inset.js";
import {isMobileWebKit} from "~/client/helpers/browser/is_mobile_web_kit.js";
import {NativeMobileBridge} from "~/client/remix/native_mobile_bridge.js";
import {
    MobileKeyboardFrameChangeEvent,
    subscribeToMobileKeyboardWithoutBottomBarsFrameChange,
} from "~/client/remix/subscribe_to_mobile_keyboard_without_bottom_bars_frame_change.js";
import {scheduleMicrotask} from "~/shared/helpers/async/schedule_microtask.js";
import {EventEmitter} from "~/shared/helpers/control/event_emitter.js";

let currentKeyboardHeight = 0;
let currentBottomBarHeight = 0;

// Keep track of the current keyboard height.
subscribeToMobileKeyboardWithoutBottomBarsFrameChange(({newKeyboardHeight}) => {
    currentKeyboardHeight = newKeyboardHeight;
    currentBottomBarHeight = getMobileBottomBarHeight(newKeyboardHeight > 0);
});

let bottomBarsChangeEmitter: EventEmitter<{
    oldBottomBarHeight: number;
    newBottomBarHeight: number;
}> | null = null;
let bottomBars: Set<{height: number; withKeyboardToolbar: boolean}> | null = null;

/**
 * Register a mobile bottom bar for the height calculations of
 * `subscribeToMobileKeyboardFrameChange()`.
 */
export function registerMobileBottomBar(
    height: number,
    {withKeyboardToolbar = false}: {withKeyboardToolbar?: boolean} = {},
): () => void {
    // If this isn't mobile WebKit (native app or otherwise) we don't have virtual
    // keyboard frame change events.
    //
    // TODO(calebmer): This should probably expand to mobile Android too. Platforms
    // with virtual keyboards.
    if (!isMobileWebKit) return () => {};

    const mobileBottomBarMeasurement = {height, withKeyboardToolbar};

    (bottomBars ??= new Set()).add(mobileBottomBarMeasurement);

    const oldBottomBarHeight = currentBottomBarHeight;
    const newBottomBarHeight = getMobileBottomBarHeight(currentKeyboardHeight > 0);
    if (oldBottomBarHeight !== newBottomBarHeight) {
        // Emit change after a microtask so it doesn't run as part of React's
        // mounting phase which will be setting up refs that may be used by event
        // emitter listeners.
        scheduleMicrotask(() => {
            const oldBottomBarHeight = currentBottomBarHeight;
            currentBottomBarHeight = getMobileBottomBarHeight(currentKeyboardHeight > 0);
            if (oldBottomBarHeight !== currentBottomBarHeight) {
                (bottomBarsChangeEmitter ??= new EventEmitter()).emit({
                    oldBottomBarHeight,
                    newBottomBarHeight: currentBottomBarHeight,
                });
            }
        });
    }

    return () => {
        (bottomBars ??= new Set()).delete(mobileBottomBarMeasurement);

        const oldBottomBarHeight = currentBottomBarHeight;
        const newBottomBarHeight = getMobileBottomBarHeight(currentKeyboardHeight > 0);
        if (oldBottomBarHeight !== newBottomBarHeight) {
            // Emit change after a microtask so it doesn't run as part of React's
            // unmounting phase which will be clearing out refs that may be used by event
            // emitter listeners.
            scheduleMicrotask(() => {
                const oldBottomBarHeight = currentBottomBarHeight;
                currentBottomBarHeight = getMobileBottomBarHeight(currentKeyboardHeight > 0);
                if (oldBottomBarHeight !== currentBottomBarHeight) {
                    (bottomBarsChangeEmitter ??= new EventEmitter()).emit({
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
 * height calculations of `subscribeToMobileKeyboardFrameChange()`.
 */
export function registerMobileBottomBarKeyboardToolbar() {
    return registerMobileBottomBar(0, {withKeyboardToolbar: true});
}

function getMobileBottomBarHeight(isKeyboardVisible: boolean): number {
    const remPx = getRemPxWithoutListening();

    let bottomBarHeight = 0;

    for (const bottomBar of bottomBars ?? []) {
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

let minKeyboardHeight: number | null;

function getFinalMobileKeyboardHeight(keyboardHeight: number, bottomBarHeight: number) {
    // The minimum keyboard height assumes the tab bar is fully visible on not
    // scrolled offscreen. This may give slightly off results in some cases.
    minKeyboardHeight ??=
        (NativeMobileBridge?.navigationBar.tabBarHeight ?? 0) +
        getElementWindowSafeAreaInsetBottomPx(document.documentElement);

    return Math.max(keyboardHeight, minKeyboardHeight) + bottomBarHeight;
}

/**
 * Subscribe to when the keyboard opens/closes and when bottom bars are
 * added/removed/resized. The listener may then scroll content to make sure
 * it's still in view now that the mobile software keyboard is open.
 *
 * In our native mobile app we get notifications from our native shell. So we
 * subscribe via `NativeMobileBridge.keyboard.subscribeToFrameChange()`.
 *
 * On the open web we have special keyboard support (see
 * `useMobileWebKitKeyboardSupport()`) and will get notifications from that
 * integration.
 *
 * Does nothing outside of mobile environments.
 */
// TODO(calebmer): The name "keyboard frame" may be a bit of a misnomer given
// when the keyboard is hidden the height contains safe area, bottom bars, and
// tab bars.
export function subscribeToMobileKeyboardFrameChange(
    listener: (
        event: MobileKeyboardFrameChangeEvent & {
            readonly oldBottomBarHeight: number;
            readonly newBottomBarHeight: number;
        },
    ) => void,
): () => void {
    // If this isn't mobile WebKit (native app or otherwise) we don't have virtual
    // keyboard frame change events.
    //
    // TODO(calebmer): This should probably expand to mobile Android too. Platforms
    // with virtual keyboards.
    if (!isMobileWebKit) return () => {};

    const unsubscribe1 = subscribeToMobileKeyboardWithoutBottomBarsFrameChange(
        ({oldKeyboardHeight, newKeyboardHeight, shouldScroll, isAnimated}) => {
            const oldBottomBarHeight = getMobileBottomBarHeight(oldKeyboardHeight > 0);
            const newBottomBarHeight = currentBottomBarHeight;

            listener({
                oldKeyboardHeight: getFinalMobileKeyboardHeight(
                    oldKeyboardHeight,
                    oldBottomBarHeight,
                ),
                newKeyboardHeight: getFinalMobileKeyboardHeight(
                    newKeyboardHeight,
                    newBottomBarHeight,
                ),
                oldBottomBarHeight,
                newBottomBarHeight,
                shouldScroll,
                isAnimated,
            });
        },
    );

    const unsubscribe2 = (bottomBarsChangeEmitter ??= new EventEmitter()).subscribe(
        ({oldBottomBarHeight, newBottomBarHeight}) => {
            listener({
                oldKeyboardHeight: getFinalMobileKeyboardHeight(
                    currentKeyboardHeight,
                    oldBottomBarHeight,
                ),
                newKeyboardHeight: getFinalMobileKeyboardHeight(
                    currentKeyboardHeight,
                    newBottomBarHeight,
                ),
                oldBottomBarHeight,
                newBottomBarHeight,
                shouldScroll: true,
                isAnimated: false,
            });
        },
    );

    return () => {
        unsubscribe1();
        unsubscribe2();
    };
}
