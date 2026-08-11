import {Schema, type SchemaType} from "~/shared/schema/schema.open_source.js";

export const DatabaseNumberFieldConfigSchema = Schema.object({
    type: Schema.value("number"),
    decimalPlaces: Schema.integer.min(0).max(10).nullable(),
});
export type DatabaseNumberFieldConfig = SchemaType<typeof DatabaseNumberFieldConfigSchema>;

export const DatabaseNumberFieldValueSchema = Schema.float.nullable();
export type DatabaseNumberFieldValue = SchemaType<typeof DatabaseNumberFieldValueSchema>;
