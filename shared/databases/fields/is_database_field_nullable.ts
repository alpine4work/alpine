import type {DatabaseColumnBackedFieldType} from "~/shared/databases/fields/is_database_field_column_backed.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.open_source.js";

/** Whether a column-backed field type's column allows SQL `NULL`. */
export function isDatabaseFieldNullable(type: DatabaseColumnBackedFieldType): boolean {
    switch (type) {
        case "plainText":
        case "checkbox":
            return false;
        case "number":
            return true;
        default:
            throw exhaustive(type);
    }
}
