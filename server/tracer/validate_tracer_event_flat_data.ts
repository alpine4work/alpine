import {TracerEventFlatDataSchema} from "~/server/tracer/tracer_event_data_schema.js";
import {InvalidArgumentError} from "~/shared/error/error.js";
import {isPlainObject} from "~/shared/helpers/object/is_plain_object.js";
import {
    SchemaSerializedValue,
    withSchemaDeserializationStackFrame,
} from "~/shared/schema/schema.js";
import {TracerEventFlatData} from "~/shared/tracer/helpers/build_tracer_event_flat_data.js";

/**
 * Validates that the provided data matches matches the expected shape of an
 * event. Checks that every attribute matches the declared schema for that
 * attribute.
 */
export function validateTracerEventFlatData(
    data: SchemaSerializedValue,
): asserts data is TracerEventFlatData {
    if (!isPlainObject(data)) throw new InvalidArgumentError("Expected event data to be an object");

    for (const [key, value] of Object.entries(data)) {
        if (value === undefined) continue;

        const schema = TracerEventFlatDataSchema.get(key);
        if (!schema) throw new InvalidArgumentError("Unrecognized event attribute");

        withSchemaDeserializationStackFrame({type: "ObjectProperty", key}, () => {
            const deserializedValue = schema.deserialize(value);

            // The event data is invalid if the deserializer transforms it. For example
            // trimming whitespace.
            if (value !== deserializedValue)
                throw new InvalidArgumentError(
                    "Original event attribute value does not match deserialized value",
                );
        });
    }
}

/**
 * Validates that it is ok to propagate the provided data object. We only allow
 * propagation of certain event attributes. This function makes sure a bad
 * client doesn't add more attributes than expected.
 */
export function validateTracerEventFlatDataForPropagation(
    data: SchemaSerializedValue,
): asserts data is TracerEventFlatData {
    validateTracerEventFlatData(data);

    for (const key of Object.keys(data)) {
        if (!key.startsWith("context."))
            throw new InvalidArgumentError(
                "Can only propagate event attributes in the `context.` attribute namespace",
            );
    }
}
