import {flushSync} from "react-dom";

/**
 * Immediately synchronously flushes React updates if React isn't currently
 * rendering. If React is rendering (e.g. we're in a `useEffect()`) then this
 * is a noop.
 */
export function flushSyncIfNotRendering<Value>(action: () => Value): Value {
    // eslint-disable-next-line no-console
    const originalConsoleError = console.error;

    try {
        // eslint-disable-next-line no-console
        console.error = function consoleErrorWithoutFlushSyncWarning(...args) {
            // Ignore the "flushSync was called from inside a lifecycle method" warning
            // message. When calling this utility we accept the `flushSync()` within a
            // render won't immediately flush.
            if (typeof args[0] === "string" && args[0].startsWith("flushSync was called")) {
                return;
            }

            return originalConsoleError.call(this, ...args);
        };

        return flushSync(action);
    } finally {
        // eslint-disable-next-line no-console
        console.error = originalConsoleError;
    }
}
