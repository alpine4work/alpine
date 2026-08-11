import type {DatabaseFieldType} from "~/shared/databases/fields/database_field_config.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.open_source.js";

/** Field types stored in a SQLite column of their table's data file. */
export type DatabaseColumnBackedFieldType = Exclude<DatabaseFieldType, "Relation">;

/**
 * Returns true when a field type has its own SQLite column. Schema code uses this
 * type guard to exclude virtual fields, such as relations, which queries calculate
 * at run time.
 */
export function isDatabaseFieldColumnBacked(
    type: DatabaseFieldType,
): type is DatabaseColumnBackedFieldType {
    switch (type) {
        case "PlainText":
        case "Checkbox":
        case "Number":
            return true;
        case "Relation":
            return false;
        default:
            throw exhaustive(type);
    }
}
