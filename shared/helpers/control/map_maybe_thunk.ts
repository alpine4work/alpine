import {MaybeThunk} from "~/shared/helpers/types/maybe_thunk.js";

/**
 * If the value is a thunk then we create a new thunk that runs the `map()`
 * function when the thunk is called. Otherwise we immediately run the `map()`
 * function.
 */
export function mapMaybeThunk<Value, NewValue>(
    value: MaybeThunk<Value>,
    map: (value: Value) => NewValue,
): MaybeThunk<NewValue> {
    return typeof value === "function" ? () => map((value as () => Value)()) : map(value);
}
