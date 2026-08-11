import {CheckSquare, Hash, type Icon, LinkSimple, TextAa} from "phosphor-react";

import type {DatabaseFieldType} from "~/shared/databases/fields/database_field_config.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.open_source.js";

/** The icon of a field type, shown in the type picker and field headers. */
export function getDatabaseFieldIcon(type: DatabaseFieldType): Icon {
    switch (type) {
        case "plainText":
            return TextAa;
        case "checkbox":
            return CheckSquare;
        case "number":
            return Hash;
        case "relation":
            return LinkSimple;
        default:
            throw exhaustive(type);
    }
}
