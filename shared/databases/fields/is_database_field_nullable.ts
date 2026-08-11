import type {DatabaseColumnBackedFieldType} from "~/shared/databases/fields/is_database_field_column_backed.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.open_source.js";

/** Whether a column-backed field type's column allows SQL `NULL`. */
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
