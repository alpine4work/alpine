import {Schema, type SchemaType} from "~/shared/schema/schema.open_source.js";

export const DatabaseCheckboxFieldConfigSchema = Schema.object({type: Schema.value("checkbox")});
export type DatabaseCheckboxFieldConfig = SchemaType<typeof DatabaseCheckboxFieldConfigSchema>;

export const DatabaseCheckboxFieldValueSchema = Schema.boolean;
export type DatabaseCheckboxFieldValue = SchemaType<typeof DatabaseCheckboxFieldValueSchema>;
