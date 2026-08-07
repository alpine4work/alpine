import {MaybeThunk} from "~/shared/helpers/types/maybe_thunk.open_source.js";

/**
 * If `value` is a function then we call the function.
 */
export function unwrapMaybeThunk<Value>(value: MaybeThunk<Value>): Value {
    return typeof value === "function" ? (value as () => Value)() : value;
}
