import {isMobileWebKit} from "~/client/helpers/browser/is_mobile_web_kit.js";
import {NativeMobileBridge} from "~/client/remix/native_mobile_bridge.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {EventEmitter} from "~/shared/helpers/control/event_emitter.js";

export type MobileKeyboardFrameChangeEvent = {
    readonly oldKeyboardHeight: number;
    readonly newKeyboardHeight: number;
    readonly shouldScroll: boolean;
    readonly isAnimated: boolean;
};

let mobileKeyboardFrameChangeEmitter: EventEmitter<MobileKeyboardFrameChangeEvent> | null = null;

/**
 * If this isn't mobile WebKit (native app or otherwise) we don't have virtual
 * keyboard frame change events.
 */
// TODO(calebmer): This should probably expand to mobile Android too. Platforms
// with virtual keyboards.
export const isMobileKeyboardFrameChangeEnabled = isMobileWebKit;

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
 *
 * The reported keyboard height does not include the height of our bottom bars
 * which will end up covering content.
 */
export function subscribeToMobileKeyboardFrameChange(
    listener: (event: MobileKeyboardFrameChangeEvent) => void,
): () => void {
    if (!isMobileKeyboardFrameChangeEnabled) return () => {};

    return NativeMobileBridge
        ? NativeMobileBridge.keyboard.subscribeToFrameChange(listener)
        : (mobileKeyboardFrameChangeEmitter ??= new EventEmitter()).subscribe(listener);
}

/**
 * Calls listeners to `subscribeToMobileKeyboardFrameChange()`.
 *
 * Throws an error if we're in our native mobile app. If we're in the native
 * mobile app events come from the native mobile shell.
 */
export function emitMobileKeyboardFrameChangeIfNotNative(event: MobileKeyboardFrameChangeEvent) {
    if (!isMobileKeyboardFrameChangeEnabled) return;

    assert(!NativeMobileBridge);

    mobileKeyboardFrameChangeEmitter ??= new EventEmitter();
    mobileKeyboardFrameChangeEmitter.emit(event);
}
