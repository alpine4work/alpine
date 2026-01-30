import murmurhash from "murmurhash";
import {InvalidArgumentError} from "~/shared/error/error.js";
import {isReadonlyArray} from "~/shared/helpers/array/is_readonly_array.js";
import {cast} from "~/shared/helpers/control/cast.js";
import {isPlainObject} from "~/shared/helpers/object/is_plain_object.js";
import {quote} from "~/shared/helpers/string/quote.js";
import {JsonObjectValue, JsonValue} from "~/shared/helpers/types/json_value.js";
import {SchemaSerializedScalarValue} from "~/shared/schema/schema.js";
import {SchemaSerializedCompositeValueDescription} from "~/shared/schema/types/schema_description_types.js";

const schemaCompositeDescriptionTypes: {
    [K in SchemaSerializedCompositeValueDescription["type"] | "Enum"]: true;
} = {
    Nullable: true,
    Array: true,
    Object: true,
    Union: true,
    BooleanUnion: true,
    Set: true,
    Map: true,
    Tuple: true,
    Enum: true,
};

/**
 * Schema descriptions may be circular objects so they can not be safely
 * `JSON.stringify()`ied. Schema descriptions also end up frequently reusing
 * sub-descriptions when complex objects are reused multiple times throughout
 * the schema.
 *
 * This function takes a schema description and transforms it into a
 * representation that is smaller and JSON safe. If an identical composite
 * schema appears twice in the description, we will add a `referenceId` to the
 * first time the schema appears and then reference it later with
 * `type: "Reference"`. All references appear in the tree after the first
 * reference appeared when traversing depth first.
 */
export function serializeSchemaDescriptionToJsonSafeValue(value: JsonValue): JsonValue {
    const referenceByValue = new Map<
        JsonObjectValue,
        {referenceId: string; newValue: JsonObjectValue}
    >();

    const transform = (stack: Array<string | number>, value: JsonValue): JsonValue => {
        if (isPlainObject(value)) {
            const newValue: {[key: string]: JsonValue | undefined} = {};

            if (
                typeof value.type === "string" &&
                cast<{[key: string]: true}>(schemaCompositeDescriptionTypes)[value.type]
            ) {
                const reference = referenceByValue.get(value);
                if (reference === undefined) {
                    // Compute our reference ID from the stack so it's stable across function calls.
                    const newReferenceId = murmurhash
                        .v3(JSON.stringify(stack))
                        .toString(16)
                        .padStart(8, "0");

                    referenceByValue.set(value, {referenceId: newReferenceId, newValue});
                } else {
                    // Make sure the new value includes the reference id so we know what this
                    // reference object is pointing to.
                    (reference.newValue as any).referenceId = reference.referenceId;
                    return {type: "Reference", reuseReferenceId: reference.referenceId};
                }
            }

            for (const [key, keyValue] of Object.entries(value)) {
                newValue[key] =
                    keyValue !== undefined ? transform([...stack, key], keyValue) : undefined;
            }

            return newValue;
        } else if (isReadonlyArray(value)) {
            return value.map((itemValue, index) => transform([...stack, index], itemValue));
        } else {
            cast<SchemaSerializedScalarValue>(value);
            return value;
        }
    };

    return transform([], value);
}

/**
 * This function takes a JSON-safe schema description (serialized by
 * `serializeSchemaDescriptionToJsonSafeValue()`) and converts it back into a
 * schema description. Replacing all the `type: "Reference"` descriptions with
 * the actual schema description even when that creates a cycle.
 */
export function deserializeSchemaDescriptionFromJsonSafeValue(value: JsonValue): JsonValue {
    const newValueByReferenceId = new Map<string, JsonObjectValue>();

    const transform = (value: JsonValue): JsonValue => {
        if (isPlainObject(value)) {
            const newValue: {[key: string]: JsonValue | undefined} = {};
            let omitKey: string | undefined;

            if (
                typeof value.type === "string" &&
                cast<{[key: string]: true}>(schemaCompositeDescriptionTypes)[value.type] &&
                typeof value.referenceId === "string"
            ) {
                // Don't include `referenceId` in the final object.
                omitKey = "referenceId";

                if (newValueByReferenceId.has(value.referenceId))
                    throw new InvalidArgumentError("Two schemas have the same reference ID");

                newValueByReferenceId.set(value.referenceId, newValue);
            } else if (value.type === "Reference") {
                if (typeof value.reuseReferenceId !== "string")
                    throw new InvalidArgumentError(
                        "Expected reference schema to have a string `reuseReferenceId` property",
                    );

                const actualNewValue = newValueByReferenceId.get(value.reuseReferenceId);
                if (actualNewValue === undefined) {
                    throw new InvalidArgumentError(
                        quote`Reference schema\u2019s \`reuseReferenceId\` property (${value.reuseReferenceId}) should refer to a schema with a matching \`referenceId\` earlier in the tree (traversing depth first)`,
                    );
                }

                return actualNewValue;
            }

            for (const [key, keyValue] of Object.entries(value)) {
                if (key === omitKey) continue;
                newValue[key] = keyValue !== undefined ? transform(keyValue) : undefined;
            }

            return newValue;
        } else if (isReadonlyArray(value)) {
            return value.map(transform);
        } else {
            cast<SchemaSerializedScalarValue>(value);
            return value;
        }
    };

    return transform(value);
}
