import type {DatabaseColumnBackedFieldType} from "~/shared/databases/fields/is_database_field_column_backed.js";
import {type SqlQuery, sql} from "~/shared/databases/sql.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.open_source.js";

/** The SQL default value of a column-backed field type's column. */
export function getDatabaseFieldDefaultValue(type: DatabaseColumnBackedFieldType): SqlQuery {
    switch (type) {
        case "plainText":
            return sql`''`;
        case "checkbox":
            return sql`0`;
        case "number":
            return sql`NULL`;
        default:
            throw exhaustive(type);
    }
}
