import {isMobileWebKit} from "~/client/helpers/browser/is_mobile_web_kit.js";
import {NativeMobileBridge} from "~/client/remix/native_mobile_bridge.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {EventEmitter} from "~/shared/helpers/control/event_emitter.js";

let mobileKeyboardFrameChangeEmitter: EventEmitter<
    [coveredHeightDelta: number, newHeight: number, oldHeight: number, shouldScroll: boolean]
> | null = null;

/**
 * Subscribe to when the keyboard opens/closes. The listener may then scroll
 * content to make sure it's still in view now that the mobile software
 * keyboard is open.
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
export function subscribeToMobileKeyboardFrameChange(
    listener: (
        coveredHeightDelta: number,
        newHeight: number,
        oldHeight: number,
        shouldScroll: boolean,
    ) => void,
): () => void {
    // If this isn't mobile WebKit (native app or otherwise) we don't have keyboard
    // frame change events.
    if (!isMobileWebKit) return () => {};

    return NativeMobileBridge
        ? NativeMobileBridge.keyboard.subscribeToFrameChange(listener)
        : (mobileKeyboardFrameChangeEmitter ??= new EventEmitter()).subscribe(
              ([coveredHeightDelta, newHeight, oldHeight, shouldScroll]) =>
                  listener(coveredHeightDelta, newHeight, oldHeight, shouldScroll),
          );
}

/**
 * Calls listeners to `subscribeToMobileKeyboardFrameChange()`.
 *
 * Throws an error if we're in our native mobile app. If we're in the native
 * mobile app events come from the native mobile shell.
 */
export function emitMobileKeyboardFrameChangeIfNotNativeMobile(
    coveredHeightDelta: number,
    newHeight: number,
    oldHeight: number,
    shouldScroll: boolean,
) {
    // If this isn't mobile WebKit (native app or otherwise) we don't have keyboard
    // frame change events.
    if (!isMobileWebKit) return;

    assert(!NativeMobileBridge);

    mobileKeyboardFrameChangeEmitter ??= new EventEmitter();
    mobileKeyboardFrameChangeEmitter.emit([coveredHeightDelta, newHeight, oldHeight, shouldScroll]);
}
