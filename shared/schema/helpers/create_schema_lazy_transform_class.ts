import {Schema} from "~/shared/schema/schema.js";

const uninitializedSymbol = Symbol("uninitialized");

/**
 * Creates a class that lazily serializes/deserializes data from a schema. We
 * don't actually deserialize when reading the data from another process until
 * `get()` is called. If `get()` is never called and the data is serialized
 * back we can reuse the data we were initialized with as-is.
 *
 * Useful if serialization/deserialization is potentially expensive and you
 * don't always need the deserialized data.
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
) {
    return class SchemaLazyTransform {
        public static schema = schema.transform<SchemaLazyTransform>({
            serialize: value => value.serialize(),
            deserialize: value => SchemaLazyTransform.fromSerialized(value),
        });

        private _serializedValue: SerializedValue | typeof uninitializedSymbol;
        private _deserializedValue: DeserializedValue | typeof uninitializedSymbol;

        private constructor(
            serializedValue: SerializedValue | typeof uninitializedSymbol,
            deserializedValue: DeserializedValue | typeof uninitializedSymbol,
        ) {
            this._serializedValue = serializedValue;
            this._deserializedValue = deserializedValue;
        }

        public static new(value: DeserializedValue): SchemaLazyTransform {
            return new SchemaLazyTransform(uninitializedSymbol, value);
        }

        public static fromSerialized(serializedValue: SerializedValue) {
            return new SchemaLazyTransform(serializedValue, uninitializedSymbol);
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
