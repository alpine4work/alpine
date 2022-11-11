import {useLoaderData} from "@remix-run/react";
import {useMemo} from "react";
import {Schema} from "~/shared/schema/schema";

/**
 * Returns the data from our loader after deserializing with a schema.
 */
export function useLoaderDataWithSchema<Value>(schema: Schema<Value>): Value {
    const serializedValue = useLoaderData();
    return useMemo(() => schema.deserialize(serializedValue), [schema, serializedValue]);
}
