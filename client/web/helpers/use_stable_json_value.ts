import {Memo, useMemo} from "react";
import {JsonStringifiableValue} from "~/shared/helpers/types/json_value.js";

/**
 * Returns the same value reference over time if the value is deeply equal to its
 * previous value. Only works for JSON values.
 *
 * Use this when you have a `useMemo()` or `useEffect()` that you'd only like to
 * re-run when a dependency changes but a dependency is an object that is
 * constantly being recreated.
 *
 * Uses `JSON.stringify()` under the hood to test equality.
 */
export function useStableJsonValue<Value extends JsonStringifiableValue>(
    value: Value,
): Memo<Value> {
    // NOTE(calebmer): `JSON.stringify()` preserves the order of keys. So if object key
    // order changes then we re-create the value. However if we checked `isDeepEqual()`
    // on two objects with different key orders then the key order wouldn't matter.
    // Given the browser heavily optimizes `JSON.stringify()` this is an acceptable
    // tradeoff. If we determine key order does matter we can use a package like
    // `json-stable-stringify`.
    const valueString = useMemo(() => JSON.stringify(value), [value]);

    // eslint-disable-next-line react-compiler/react-compiler
    // eslint-disable-next-line react-hooks/exhaustive-deps
    const stableValue = useMemo(() => value, [valueString]);

    return stableValue;
}
