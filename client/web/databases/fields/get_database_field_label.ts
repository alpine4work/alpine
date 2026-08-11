import type {DatabaseFieldType} from "~/shared/databases/fields/database_field_config.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.open_source.js";

/**
 * The display name of a field type, shown in the type picker and field menus.
 */
export function getDatabaseFieldLabel(type: DatabaseFieldType): string {
    switch (type) {
        case "plainText":
            return "Text";
        case "checkbox":
            return "Checkbox";
        case "number":
            return "Number";
        case "relation":
            return "Linked record";
        default:
            throw exhaustive(type);
    }
}
