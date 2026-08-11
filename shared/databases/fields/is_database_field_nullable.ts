import type {DatabaseColumnBackedFieldType} from "~/shared/databases/fields/is_database_field_column_backed.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.open_source.js";

/**
 * Returns true when a column-backed field type permits SQL `NULL`. Schema creation
 * uses this mapping to apply the correct nullability rule to each physical column.
 */
export function isDatabaseFieldNullable(type: DatabaseColumnBackedFieldType): boolean {
    switch (type) {
        case "PlainText":
        case "Checkbox":
            return false;
        case "Number":
            return true;
        default:
            throw exhaustive(type);
    }
}
