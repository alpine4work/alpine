import {unwrapLoadingIndicatorLoaderData} from "~/client/web/remix/loading_indicator_loader_data.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {deserializedValueSymbol} from "~/shared/remix/json_with_schema_shared.js";
import {Schema, SchemaSerializedValue} from "~/shared/schema/schema.js";

/**
 * Gets data returned by a loader. Loader data is serialized with a schema so we
 * need to deserialize it back. On the server we keep a reference to the
 * deserialized value as an optimization so we don't need to pay deserialization
 * costs.
 */
export function getLoaderDataWithSchema<Value>(
    schema: Schema<Value>,
    serializedValue: SchemaSerializedValue & {[deserializedValueSymbol]?: Value},
): Value {
    serializedValue = unwrapLoadingIndicatorLoaderData(serializedValue);

    // Optimization: When on the server, use the original deserialized value instead of
    // wasting CPU time on deserialization.
    if (typeof window === "undefined") {
        assert(serializedValue[deserializedValueSymbol]);
        return serializedValue[deserializedValueSymbol];
    } else {
        if (!serializedValue[deserializedValueSymbol]) {
            const deserializedValue = schema.deserialize(serializedValue);
            serializedValue[deserializedValueSymbol] = deserializedValue;
        }
        return serializedValue[deserializedValueSymbol];
    }
}
