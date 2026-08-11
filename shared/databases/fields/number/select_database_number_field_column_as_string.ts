import type {DatabaseFieldModelOfType} from "~/shared/databases/model/database_field_model.js";
import {type SqlQuery, sql} from "~/shared/databases/sql.js";

export function selectDatabaseNumberFieldColumnAsString(
    field: DatabaseFieldModelOfType<"Number">,
    dataRow: SqlQuery,
): SqlQuery {
    const column = sql`${dataRow}.${field.column()}`;
    if (field.config.decimalPlaces == null) {
        return sql`
            CASE
                WHEN ${column} IS NULL THEN ''
                ELSE CAST(${column} AS TEXT)
            END
        `;
    }
    return sql`
        CASE
            WHEN ${column} IS NULL THEN ''
            ELSE PRINTF(
                ${`%.${field.config.decimalPlaces}f`},
                ${column}
            )
        END
    `;
}
