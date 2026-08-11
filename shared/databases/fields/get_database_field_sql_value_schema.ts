import type {DatabaseFieldType} from "~/shared/databases/fields/database_field_config.js";
import type {DatabaseFieldValue} from "~/shared/databases/fields/database_field_value.js";
import {DatabaseNumberFieldValueSchema} from "~/shared/databases/fields/number/database_number_field.js";
import {DatabasePlainTextFieldValueSchema} from "~/shared/databases/fields/plain_text/database_plain_text_field.js";
import {DatabaseRelationFieldSqlValueSchema} from "~/shared/databases/fields/relation/database_relation_field.js";
import {SqlBooleanSchema} from "~/shared/databases/model/sqlite_schema.js";
import type {Schema} from "~/shared/schema/schema.open_source.js";

const databaseFieldSqlValueSchemas: {
    [Type in DatabaseFieldType]: Schema<DatabaseFieldValue<Type>>;
} = {
    plainText: DatabasePlainTextFieldValueSchema,
    checkbox: SqlBooleanSchema,
    number: DatabaseNumberFieldValueSchema,
    relation: DatabaseRelationFieldSqlValueSchema,
};

/**
 * The schema for a field type's values as stored in SQLite. Differs from {@link
 * getDatabaseFieldValueSchema} for types with a SQL-specific encoding (e.g.
 * booleans stored as integers).
 */
export function getDatabaseFieldSqlValueSchema<Type extends DatabaseFieldType>(
    type: Type,
): Schema<DatabaseFieldValue<Type>> {
    return databaseFieldSqlValueSchemas[type];
}
