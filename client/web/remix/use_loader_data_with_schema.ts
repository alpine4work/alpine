import {useLoaderData} from "@remix-run/react";
import {useMemo} from "react";
import {getLoaderDataWithSchema} from "~/client/web/remix/get_loader_data_with_schema.js";
import {Schema} from "~/shared/schema/schema.open_source.js";

/**
 * Returns the data from our loader after deserializing with a schema.
 */
export function useLoaderDataWithSchema<Value>(schema: Schema<Value>): Value {
    const serializedValue = useLoaderData<any>();
    return useMemo(
        () => getLoaderDataWithSchema(schema, serializedValue),
        [schema, serializedValue],
    );
}
