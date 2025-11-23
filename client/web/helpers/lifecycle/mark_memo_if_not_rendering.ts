import {Memo} from "react";
import {throwIfRendering} from "~/client/web/helpers/lifecycle/throw_if_rendering.js";

/**
 * Marks an arbitrary value as memoized. Throws an error if run while React is
 * rendering. While rendering you should `useMemo()` to memoize values.
 */
export function markMemoIfNotRendering<Value>(value: Value): Memo<Value> {
    throwIfRendering();
    return value as Memo<Value>;
}
