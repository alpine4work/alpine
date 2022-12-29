import {json} from "@remix-run/cloudflare";
import {assert} from "~/shared/helpers/control/assert";
import {isPlainObject} from "~/shared/helpers/object/is_plain_object";
import {BlockInference} from "~/shared/helpers/types/block_inference";
import {
    deserializedValueSymbol,
    propagatedEventDataKey as propagateEventDataKey,
} from "~/shared/remix/json_with_schema_shared";
import {Schema} from "~/shared/schema/schema";
import {TracerEventData} from "~/shared/tracer/types/tracer_event_data";

/**
 * Creates a JSON HTTP response using a schema for serialization.
 */
export function jsonWithSchema<Value>(
    schema: Schema<Value>,
    value: BlockInference<Value>,
    {
        propagateEventData,
        ...responseInit
    }: ResponseInit & {
        /**
         * Data to propagate in all tracer events while on this route. We collect all
         * propagated event data in the `<Root>` component and add it to our tracer.
         */
        propagateEventData?: TracerEventData;
    } = {},
): Response {
    const serializedValue = schema.serialize(value as Value);

    // The serialized value must be an object so we can add properties to it. Like
    // the original, deserialized, value and the propagated event data.
    assert(isPlainObject(serializedValue));

    // When we render our component on the server, it's wasteful of CPU time to
    // deserialize again. So as an optimization, put the deserialized value on a
    // non-enumerable property.
    (serializedValue as any)[deserializedValueSymbol] = value;

    // If we are propagating event data, stash it on the serialized result. Our
    // `<Root>` component will read this property and add it to the tracer.
    if (propagateEventData) {
        (serializedValue as any)[propagateEventDataKey] = propagateEventData;
    }

    return json(serializedValue, responseInit);
}
