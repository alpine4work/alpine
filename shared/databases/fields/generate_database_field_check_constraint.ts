import type {DatabaseColumnBackedFieldType} from "~/shared/databases/fields/is_database_field_column_backed.js";
import {type SqlQuery, sql} from "~/shared/databases/sql.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.open_source.js";

/**
 * Returns the `CHECK` constraint for a column-backed field type. The constraint
 * prevents SQLite's dynamic typing from storing values that do not match the field
 * type.
 */
export function generateDatabaseFieldCheckConstraint(
    type: DatabaseColumnBackedFieldType,
    columnName: SqlQuery,
): SqlQuery {
    switch (type) {
        case "PlainText":
            return sql`
                CHECK (
                    TYPEOF(${columnName}) = 'text'
                )
            `;
        case "Checkbox":
            return sql`
                CHECK (
                    TYPEOF(${columnName}) = 'integer'
                )
            `;
        case "Number":
            return sql`
                CHECK (
                    TYPEOF(${columnName}) IN ('real', 'integer', 'null')
                )
            `;
        default:
            throw exhaustive(type);
    }
}
