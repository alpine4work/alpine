import {isMobileWebKit} from "~/client/web/helpers/browser/is_mobile_web_kit.js";
import {NativeMobileBridge} from "~/client/web/remix/native_mobile_bridge.js";
import {assert} from "~/shared/helpers/control/assert.open_source.js";
import {EventEmitter} from "~/shared/helpers/control/event_emitter.open_source.js";

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
 * content to make sure it's still in view now that the mobile software keyboard is
 * open.
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

    if (!NativeMobileBridge) {
        return (mobileKeyboardFrameChangeEmitter ??= new EventEmitter()).subscribe(listener);
    } else {
        return NativeMobileBridge.keyboard.subscribeToFrameChange(event => {
            // Wait an animation frame before calling keyboard frame change listeners. Our
            // native code emits this event BEFORE our web code processes the `focus` event.
            // The `focus` event may mount some native mobile bottom bars. By waiting for the
            // animation frame, we let the `focus` event run and let our native code process it
            // (which may include updating safe area inset CSS variables).
            //
            // This fixes a bug in task grid views where when you have many tasks, scroll to
            // the bottom, and tap the bottom ghost task we'd scroll up but the bottom ghost
            // task wouldn't be completely visible. Since scrolling was clipped because
            // `--safe-area-inset-bottom` hadn't been updated to account for the task keyboard
            // toolbar. [Video of the bug][1].
            //
            // We don't wait an animation frame if the frame change event is not animated AND
            // the keyboard is shrinking. This fixes a different bug where we need to run our
            // scroll event before keyboard safe area is removed. If we remove keyboard safe
            // area first and we've scrolled to the bottom of the view (e.g. in a chat) then
            // the browser will adjust the scroll. Then we also scroll in
            // `useScrollToAvoidBottomBarsAndMobileKeyboard()` causing us to have scrolled
            // further than we should have.
            //
            // You can observe this second bug when always calling double
            // `requestAnimationFrame()`s by going to chat, scrolling to the bottom, opening
            // the keyboard, closing the app, then reopening the app. There's a race condition
            // between whether safe area is removed first or the double
            // `requestAnimationFrame()` fires first so you may need to try a couple times
            // before seeing the bug. If the safe area is removed first you'll see the outcome
            // recorded in [this video][2].
            //
            // [1]: https://gist.github.com/calebmer/a3d65d71607114d6c5304536f7ac4fd3
            // [2]: https://gist.github.com/calebmer/d349791e01635bcadeb20e4b659b3401
            if (!event.isAnimated && event.newKeyboardHeight < event.oldKeyboardHeight) {
                listener(event);
            } else {
                requestAnimationFrame(() => {
                    requestAnimationFrame(() => {
                        listener(event);
                    });
                });
            }
        });
    }
}

/**
 * Calls listeners to `subscribeToMobileKeyboardFrameChange()`.
 *
 * Throws an error if we're in our native mobile app. If we're in the native mobile
 * app events come from the native mobile shell.
 */
export function emitMobileKeyboardFrameChangeIfNotNative(event: MobileKeyboardFrameChangeEvent) {
    if (!isMobileKeyboardFrameChangeEnabled) return;

    assert(!NativeMobileBridge);

    mobileKeyboardFrameChangeEmitter ??= new EventEmitter();
    mobileKeyboardFrameChangeEmitter.emit(event);
}
