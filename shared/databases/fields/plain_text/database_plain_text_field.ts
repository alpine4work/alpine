import {Schema, type SchemaType} from "~/shared/schema/schema.open_source.js";

export const DatabasePlainTextFieldConfigSchema = Schema.object({type: Schema.value("PlainText")});
export type DatabasePlainTextFieldConfig = SchemaType<typeof DatabasePlainTextFieldConfigSchema>;

export const DatabasePlainTextFieldValueSchema = Schema.string;
export type DatabasePlainTextFieldValue = SchemaType<typeof DatabasePlainTextFieldValueSchema>;
