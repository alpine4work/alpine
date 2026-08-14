import {Schema, SchemaSerializedValue} from "~/shared/schema/schema.js";

export const SqlBooleanSchema = Schema.boolean.migration({
    serialize: value => value,
    deserialize: value => (value === 1 ? true : value === 0 ? false : value),
});

export function SqlJsonSchema<T>(schema: Schema<T>) {
    return schema.migration({
        serialize: (serialized: SchemaSerializedValue) => JSON.stringify(serialized),
        deserialize: (raw: SchemaSerializedValue) => JSON.parse(raw as string),
    });
}
