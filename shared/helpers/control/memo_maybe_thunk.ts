import {memoThunk} from "~/shared/helpers/control/memo_thunk.js";
import {MaybeThunk} from "~/shared/helpers/types/maybe_thunk.js";

/**
 * Memorizes the result of a thunk (with `memoThunk()`) so it only runs once. All
 * repeated calls will return the same value.
 *
 * If the `thunk()` throws then we throw the exact same error every subsequent
 * call.
 */
export function memoMaybeThunk<Value>(value: MaybeThunk<Value>): MaybeThunk<Value> {
    if (typeof value !== "function") return value;
    return memoThunk(value as () => Value);
}
