import type {DatabaseFieldType} from "~/shared/databases/fields/database_field_config.js";
import type {DatabaseFieldValue} from "~/shared/databases/fields/database_field_value.js";
import {getDatabaseFieldSqlValueSchema} from "~/shared/databases/fields/get_database_field_sql_value_schema.js";
import {type SqlQuery, sql} from "~/shared/databases/sql.js";

/**
 * Serializes a typed field value as a SQL parameter. This function applies the
 * field type's SQL encoding before the value enters a query.
 */
export function serializeDatabaseFieldValueToSql<Type extends DatabaseFieldType>(
    type: Type,
    value: DatabaseFieldValue<Type>,
): SqlQuery {
    return sql`${getDatabaseFieldSqlValueSchema(type).serialize(value)}`;
}
