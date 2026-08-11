import {DatabaseCheckboxGridViewCellContent} from "~/client/web/databases/fields/checkbox/database_checkbox_grid_view_cell_content.js";
import type {DatabaseGridViewCellContentProps} from "~/client/web/databases/fields/database_grid_view_cell_props.js";
import {DatabaseNumberGridViewCellContent} from "~/client/web/databases/fields/number/database_number_grid_view_cell_content.js";
import {DatabasePlainTextGridViewCellContent} from "~/client/web/databases/fields/plain_text/database_plain_text_grid_view_cell_content.js";
import {DatabaseRelationGridViewCellContent} from "~/client/web/databases/fields/relation/database_relation_grid_view_cell_content.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.open_source.js";

/** Renders the cell content component for the field type of `props.field`. */
export function DatabaseGridViewCellContent(props: DatabaseGridViewCellContentProps) {
    switch (props.field.config.type) {
        case "plainText":
            return (
                <DatabasePlainTextGridViewCellContent
                    {...(props as DatabaseGridViewCellContentProps<"plainText">)}
                />
            );
        case "checkbox":
            return (
                <DatabaseCheckboxGridViewCellContent
                    {...(props as DatabaseGridViewCellContentProps<"checkbox">)}
                />
            );
        case "number":
            return (
                <DatabaseNumberGridViewCellContent
                    {...(props as DatabaseGridViewCellContentProps<"number">)}
                />
            );
        case "relation":
            return (
                <DatabaseRelationGridViewCellContent
                    {...(props as DatabaseGridViewCellContentProps<"relation">)}
                />
            );
        default:
            throw exhaustive(props.field.config);
    }
}
