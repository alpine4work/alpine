import {json} from "@remix-run/cloudflare";
import {deserializedValueSymbol} from "~/client/helpers/use_loader_data_with_schema";
import {BlockInference} from "~/shared/helpers/types/block_inference";
import {Schema} from "~/shared/schema/schema";

/**
 * Creates a JSON HTTP response using a schema for serialization.
 */
export function jsonWithSchema<Value>(
    schema: Schema<Value>,
    value: BlockInference<Value>,
    init?: number | ResponseInit,
): Response {
    const serializedValue = schema.serialize(value as Value);

    // When we render our component on the server, it's wasteful of CPU time to
    // deserialize again. So as an optimization, put the deserialized value on a
    // non-enumerable property.
    (serializedValue as any)[deserializedValueSymbol] = value;

    return json(serializedValue, init);
}
