import type {DatabaseFieldType} from "~/shared/databases/fields/database_field_config.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.open_source.js";

/** Field types stored in a SQLite column of their table's data file. */
export type DatabaseColumnBackedFieldType = Exclude<DatabaseFieldType, "relation">;

/**
 * Whether a field type is stored in a SQLite column of its own. Virtual field
 * types (relation) have no column and are projected at query time instead.
 */
export function isDatabaseFieldColumnBacked(
    type: DatabaseFieldType,
): type is DatabaseColumnBackedFieldType {
    switch (type) {
        case "plainText":
        case "checkbox":
        case "number":
            return true;
        case "relation":
            return false;
        default:
            throw exhaustive(type);
    }
}
