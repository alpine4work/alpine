import type {DatabaseFieldType} from "~/shared/databases/fields/database_field_config.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.open_source.js";

/**
 * Whether a field type opens an editor overlay when its cell is edited. Checkbox
 * cells toggle in place instead.
 */
export function hasDatabaseGridViewCellEditorOverlay(type: DatabaseFieldType): boolean {
    switch (type) {
        case "PlainText":
        case "Number":
        case "Relation":
            return true;
        case "Checkbox":
            return false;
        default:
            throw exhaustive(type);
    }
}
