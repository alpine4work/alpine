import {Schema, type SchemaType} from "~/shared/schema/schema.js";

/**
 * The type of a field in an Alpine database table.
 * Discriminated on `type`. Stored as JSON in the
 * `_alpine_fields.type` column.
 */
export const DatabaseFieldTypeSchema = Schema.union({
    plainText: Schema.object({type: Schema.value("plainText")}),
    number: Schema.object({type: Schema.value("number")}),
    boolean: Schema.object({type: Schema.value("boolean")}),
});

export type DatabaseFieldType = SchemaType<typeof DatabaseFieldTypeSchema>;

/**
 * Serialize a {@link DatabaseFieldType} to a JSON string
 * suitable for storage in `_alpine_fields.type`.
 */
export function serializeDatabaseFieldType(fieldType: DatabaseFieldType): string {
    return JSON.stringify(DatabaseFieldTypeSchema.serialize(fieldType));
}
