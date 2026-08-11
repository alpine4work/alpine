import type {DatabaseFieldModelOfType} from "~/shared/databases/model/database_field_model.js";
import {type SqlQuery, sql} from "~/shared/databases/sql.js";

/**
 * Returns a SQL expression that formats a checkbox column as `true` or `false`.
 * SQL-side formatting uses this expression to match in-memory display text.
 */
export function selectDatabaseCheckboxFieldColumnAsString(
    field: DatabaseFieldModelOfType<"Checkbox">,
    dataRow: SqlQuery,
): SqlQuery {
    return sql`
        CASE ${dataRow}.${field.column()}
            WHEN 1 THEN 'true'
            ELSE 'false'
        END
    `;
}
