import type {DatabaseFieldType} from "~/shared/databases/fields/database_field_config.js";
import type {DatabaseFieldValue} from "~/shared/databases/fields/database_field_value.js";
import {getDatabaseFieldSqlValueSchema} from "~/shared/databases/fields/get_database_field_sql_value_schema.js";
import {type SqlQuery, sql} from "~/shared/databases/sql.js";

export function serializeDatabaseFieldValueToSql<Type extends DatabaseFieldType>(
    type: Type,
    value: DatabaseFieldValue<Type>,
): SqlQuery {
    return sql`${getDatabaseFieldSqlValueSchema(type).serialize(value)}`;
}
