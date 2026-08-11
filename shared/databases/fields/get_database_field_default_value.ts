import type {DatabaseColumnBackedFieldType} from "~/shared/databases/fields/is_database_field_column_backed.js";
import {type SqlQuery, sql} from "~/shared/databases/sql.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.open_source.js";

/**
 * Returns the SQL default value for a column-backed field type. Schema creation
 * uses this mapping so new required columns always start with a valid value.
 */
export function getDatabaseFieldDefaultValue(type: DatabaseColumnBackedFieldType): SqlQuery {
    switch (type) {
        case "PlainText":
            return sql`''`;
        case "Checkbox":
            return sql`0`;
        case "Number":
            return sql`NULL`;
        default:
            throw exhaustive(type);
    }
}
