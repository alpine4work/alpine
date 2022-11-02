import {json} from "@remix-run/cloudflare";
import {BlockInference} from "~/shared/helpers/types/block-inference";
import {Schema} from "~/shared/schema/schema";

/**
 * Creates a JSON HTTP response using a schema for serialization.
 */
export function jsonWithSchema<Value>(
    schema: Schema<Value>,
    value: BlockInference<Value>,
): Response {
    return json(schema.serialize(value as Value));
}
