import type {DatabaseFieldConfigMenuActionsArgs} from "~/client/web/databases/fields/database_grid_view_cell_props.js";
import {getDatabaseNumberFieldConfigMenuActions} from "~/client/web/databases/fields/number/get_database_number_field_config_menu_actions.js";
import type {MenuActions} from "~/client/web/design/menu.js";
import type {DatabaseFieldType} from "~/shared/databases/fields/database_field_config.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.open_source.js";

/**
 * The config actions appended to a field's header editor menu. Empty for field
 * types without configurable options.
 */
export function getDatabaseFieldConfigMenuActions<Type extends DatabaseFieldType>(
    args: DatabaseFieldConfigMenuActionsArgs<Type>,
): MenuActions;
export function getDatabaseFieldConfigMenuActions(
    args: DatabaseFieldConfigMenuActionsArgs,
): MenuActions {
    switch (args.config.type) {
        case "plainText":
        case "checkbox":
        case "relation":
            return [];
        case "number":
            return getDatabaseNumberFieldConfigMenuActions(
                args as DatabaseFieldConfigMenuActionsArgs<"number">,
            );
        default:
            throw exhaustive(args.config);
    }
}
