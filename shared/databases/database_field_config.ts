import {Schema, type SchemaType} from "~/shared/schema/schema.js";

/**
 * The configuration of a field in an Alpine database
 * table. Discriminated on `type`. Stored as JSON in
 * the `_alpine_fields.config` column.
 */
export const DatabaseFieldConfigSchema = Schema.union({
    plainText: Schema.object({type: Schema.value("plainText")}),
    number: Schema.object({type: Schema.value("number")}),
    boolean: Schema.object({type: Schema.value("boolean")}),
});

export type DatabaseFieldConfig = SchemaType<typeof DatabaseFieldConfigSchema>;

/**
 * Serialize a {@link DatabaseFieldConfig} to a JSON
 * string suitable for storage in
 * `_alpine_fields.config`.
 */
export function serializeDatabaseFieldConfig(fieldConfig: DatabaseFieldConfig): string {
    return JSON.stringify(DatabaseFieldConfigSchema.serialize(fieldConfig));
}
