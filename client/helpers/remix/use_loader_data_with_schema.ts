import {useLoaderData} from "@remix-run/react";
import {useMemo} from "react";
import {assert} from "~/shared/helpers/control/assert";
import {Schema} from "~/shared/schema/schema";

export const deserializedValueSymbol = Symbol("deserializedValue");

/**
 * Returns the data from our loader after deserializing with a schema.
 */
export function useLoaderDataWithSchema<Value>(schema: Schema<Value>): Value {
    const serializedValue = useLoaderData();

    return useMemo(() => {
        // Optimization: When on the server, use the original deserialized value
        // instead wasting CPU time on deserialization.
        if (typeof window === "undefined") {
            assert(serializedValue[deserializedValueSymbol]);
            return serializedValue[deserializedValueSymbol];
        } else {
            return schema.deserialize(serializedValue);
        }
    }, [schema, serializedValue]);
}
