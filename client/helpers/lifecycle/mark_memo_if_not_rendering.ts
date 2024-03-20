import {Memo} from "react";
import {
    getCurrentReactDispatcherIfExists,
    reactDispatchersSeenDuringRender,
} from "~/client/helpers/lifecycle/internal/react_current_dispatcher.js";
import {InternalError} from "~/shared/error/error.js";

/**
 * Marks an arbitrary value as memoized. Throws an error if run while React is
 * rendering. While rendering you should `useMemo()` to memoize values.
 */
export function markMemoIfNotRendering<Value>(value: Value): Memo<Value> {
    if (reactDispatchersSeenDuringRender.has(getCurrentReactDispatcherIfExists())) {
        throw new InternalError("Can not mark value as memoized during React render");
    }

    return value as Memo<Value>;
}
