import {unstable_ImmediatePriority, unstable_runWithPriority} from "scheduler";

/**
 * Run the provided action with immediate React priority. That means React
 * should render any state changes that happen within synchronously. Use
 * sparingly as this hurts performance since React can't be interrupted!
 *
 * Use this instead of manually calling `unstable_runWithPriority()` from
 * `scheduler` since it handles some React quirks.
 *
 * @deprecated Didn't realize React has a `flushSync()` function. Use that.
 * Can't replace existing calls until we confirm `flushSync()` has the same
 * behavior as this function.
 */
// TODO(calebmer, 2023-01-18): Wow, I just noticed React has a [`flushSync()`
// API][1]. This is probably an exact replacement for this function. Explore
// the implementation of `flushSync()` to make sure it does the same thing as
// `runWithImmediatePriority()` and replace `runWithImmediatePriority()`.
//
// [1]: https://react.dev/reference/react-dom/flushSync
export function runWithImmediatePriority<Value>(action: () => Value): Value {
    return unstable_runWithPriority(unstable_ImmediatePriority, () => {
        // HACK(calebmer): In order for React to respect the scheduler priority level
        // we need to be in a message event (since the scheduler callback uses a
        // message event). So trick React into thinking we are in a message event by
        // setting a message event object globally.
        //
        // See how the `requestUpdateLane()` function calls `getCurrentEventPriority()`
        // which calls `getEventPriority()` which then consults the scheduler for
        // `message` events.
        //
        // - https://github.com/facebook/react/blob/9e3b772b8cabbd8cadc7522ebe3dde3279e79d9e/packages/react-reconciler/src/ReactFiberWorkLoop.new.js#L498-L516
        // - https://github.com/facebook/react/blob/9e3b772b8cabbd8cadc7522ebe3dde3279e79d9e/packages/react-dom/src/events/ReactDOMEventListener.js#L493-L512
        const lastWindowEvent = window.event;
        window.event = new MessageEvent("message");
        try {
            return action();
        } finally {
            window.event = lastWindowEvent;
        }
    });
}
