import type {DatabaseFieldModelOfType} from "~/shared/databases/model/database_field_model.js";
import {type SqlQuery, sql} from "~/shared/databases/sql.js";

export function selectDatabaseCheckboxFieldColumnAsString(
    field: DatabaseFieldModelOfType<"checkbox">,
    dataRow: SqlQuery,
): SqlQuery {
    return sql`
        CASE ${dataRow}.${field.column()}
            WHEN 1 THEN 'true'
            ELSE 'false'
        END
    `;
}
