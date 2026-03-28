import {MaybePromise} from "~/shared/helpers/types/maybe_promise.js";

/**
 * If the value is a promise then we use `.then()` to map the result once the
 * promise resolves. Otherwise we call the map function immediately.
 */
export function mapMaybePromise<Value, NewValue>(
    value: MaybePromise<Value>,
    map: (value: Value) => NewValue,
): MaybePromise<NewValue> {
    return value instanceof Promise ? value.then(map) : map(value);
}
