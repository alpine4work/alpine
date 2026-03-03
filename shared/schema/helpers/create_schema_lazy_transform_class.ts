import {assert} from "~/shared/helpers/control/assert.js";
import {Schema} from "~/shared/schema/schema.js";

const uninitializedSymbol = Symbol("uninitialized");

export interface SchemaLazyTransformBase<SerializedValue, DeserializedValue> {
    get(): DeserializedValue;
    serialize(): SerializedValue;
    getAvailable(): SerializedValue | DeserializedValue;
}

/**
 * Creates a class that lazily serializes/deserializes data from a schema. We don't
 * actually deserialize when reading the data from another process until `get()` is
 * called. If `get()` is never called and the data is serialized back we can reuse
 * the data we were initialized with as-is.
 *
 * Useful if serialization/deserialization is potentially expensive and you don't
 * always need the deserialized data.
 */
export function createSchemaLazyTransformClass<SerializedValue, DeserializedValue>(
    schema: Schema<SerializedValue>,
    {
        serialize,
        deserialize,
    }: {
        serialize: (value: DeserializedValue) => SerializedValue;
        deserialize: (value: SerializedValue) => DeserializedValue;
    },
): {
    readonly schema: Schema<SchemaLazyTransformBase<SerializedValue, DeserializedValue>>;
    new (value: DeserializedValue): SchemaLazyTransformBase<SerializedValue, DeserializedValue>;
    fromSerialized(
        value: SerializedValue,
    ): SchemaLazyTransformBase<SerializedValue, DeserializedValue>;
} {
    return class SchemaLazyTransform implements SchemaLazyTransformBase<
        SerializedValue,
        DeserializedValue
    > {
        public static readonly schema = schema.transform<
            SchemaLazyTransformBase<SerializedValue, DeserializedValue>
        >({
            serialize: value => value.serialize(),
            deserialize: value => SchemaLazyTransform.fromSerialized(value),
        });

        private _serializedValue: SerializedValue | typeof uninitializedSymbol;
        private _deserializedValue: DeserializedValue | typeof uninitializedSymbol;

        constructor(
            deserializedValue: DeserializedValue | typeof uninitializedSymbol,
            serializedValue: SerializedValue | typeof uninitializedSymbol = uninitializedSymbol,
        ) {
            assert(
                (deserializedValue === uninitializedSymbol ? 1 : 0) +
                    (serializedValue === uninitializedSymbol ? 1 : 0) ===
                    1,
                "Only one of `deserializedValue` or `serializedValue` may be initialized",
            );

            this._serializedValue = serializedValue;
            this._deserializedValue = deserializedValue;

            // In Jest eagerly call `get()` and `serialize()` which caches the
            // serialized/deserialized data so `expect().toEqual()` never shows uncached data
            // as the reason why two objects don't match. Seeing the cached data can also help
            // determine the difference in a diff.
            //
            // We also normalize `_serializedValue` by recomputing it from the deserialized
            // value. This ensures consistent comparison in tests regardless of how the
            // instance was created (from deserialized value vs from serialized value that went
            // through JSON round-trip).
            if (import.meta.jest) {
                this.get();
                this._serializedValue = uninitializedSymbol;
                this.serialize();
            }
        }

        public static fromSerialized(serializedValue: SerializedValue) {
            return new SchemaLazyTransform(uninitializedSymbol, serializedValue);
        }

        public get(): DeserializedValue {
            if (this._deserializedValue === uninitializedSymbol) {
                this._deserializedValue = deserialize(this._serializedValue as SerializedValue);
            }
            return this._deserializedValue;
        }

        public serialize(): SerializedValue {
            if (this._serializedValue === uninitializedSymbol) {
                this._serializedValue = serialize(this._deserializedValue as DeserializedValue);
            }
            return this._serializedValue;
        }

        public getAvailable(): SerializedValue | DeserializedValue {
            if (this._serializedValue !== uninitializedSymbol) return this._serializedValue;
            return this._deserializedValue as DeserializedValue;
        }
    };
}
