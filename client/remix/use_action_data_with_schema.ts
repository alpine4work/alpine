import {useActionData} from "@remix-run/react";
import {useMemo} from "react";
import {Schema} from "~/shared/schema/schema.js";

/**
 * Returns the data from our action after deserializing with a schema.
 *
 * @deprecated In must cases, prefer `useFetcherWithSchema()` and
 * `<fetcher.Form>` to `useActionDataWithSchema()` and `<Form>`.
 */
export function useActionDataWithSchema<Value>(schema: Schema<Value>): Value | undefined {
    const serializedValue = useActionData();
    return useMemo(
        () => (serializedValue !== undefined ? schema.deserialize(serializedValue) : undefined),
        [schema, serializedValue],
    );
}
