import jsonStableStringify from "json-stable-stringify";
import {useMemo} from "react";
import {Schema} from "~/shared/schema/schema";

/**
 * Returns the same value reference over time if the value is deeply equal to
 * its previous value. Works for any schema value since under the hood we need
 * to convert to JSON to determine deep structural equality.
 *
 * Use this when you have a `useMemo()` or `useEffect()` that you'd only like
 * to re-run when a dependency changes but a dependency is an object that is
 * constantly being recreated.
 *
 * Uses `JSON.stringify()` under the hood to test equality.
 */
export function useStableValue<Value>(schema: Schema<Value>, value: Value): Value {
    const valueString = useMemo(
        () => jsonStableStringify(schema.serialize(value)),
        [schema, value],
    );

    // eslint-disable-next-line react-hooks/exhaustive-deps
    const stableValue = useMemo(() => value, [valueString]);

    return stableValue;
}
