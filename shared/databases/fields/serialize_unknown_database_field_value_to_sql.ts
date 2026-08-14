import type {DatabaseFieldType} from "~/shared/databases/fields/database_field_config.js";
import {getDatabaseFieldValueSchema} from "~/shared/databases/fields/get_database_field_value_schema.js";
import {serializeDatabaseFieldValueToSql} from "~/shared/databases/fields/serialize_database_field_value_to_sql.js";
import type {SqlQuery} from "~/shared/databases/sql.js";
import type {SchemaSerializedValue} from "~/shared/schema/schema.js";

/**
 * Validates an untyped value against the field type's application schema, then
 * serializes it to SQL. This function provides a safe boundary for callers that do
 * not have a statically typed `DatabaseFieldValue`.
 */
export function serializeUnknownDatabaseFieldValueToSql(
    type: DatabaseFieldType,
    value: SchemaSerializedValue,
): SqlQuery {
    return serializeDatabaseFieldValueToSql(
        type,
        getDatabaseFieldValueSchema(type).deserialize(value),
    );
}
