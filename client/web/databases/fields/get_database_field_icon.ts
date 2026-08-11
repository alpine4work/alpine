import {CheckSquare, Hash, type Icon, LinkSimple, TextAa} from "phosphor-react";

import type {DatabaseFieldType} from "~/shared/databases/fields/database_field_config.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.open_source.js";

/** The icon of a field type, shown in the type picker and field headers. */
export function getDatabaseFieldIcon(type: DatabaseFieldType): Icon {
    switch (type) {
        case "PlainText":
            return TextAa;
        case "Checkbox":
            return CheckSquare;
        case "Number":
            return Hash;
        case "Relation":
            return LinkSimple;
        default:
            throw exhaustive(type);
    }
}
