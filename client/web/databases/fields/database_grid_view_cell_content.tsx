import {DatabaseCheckboxGridViewCellContent} from "~/client/web/databases/fields/checkbox/database_checkbox_grid_view_cell_content.js";
import type {DatabaseGridViewCellContentProps} from "~/client/web/databases/fields/database_grid_view_cell_props.js";
import {DatabaseNumberGridViewCellContent} from "~/client/web/databases/fields/number/database_number_grid_view_cell_content.js";
import {DatabasePlainTextGridViewCellContent} from "~/client/web/databases/fields/plain_text/database_plain_text_grid_view_cell_content.js";
import {DatabaseRelationGridViewCellContent} from "~/client/web/databases/fields/relation/database_relation_grid_view_cell_content.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.open_source.js";

/** Renders the cell content component for the field type of `props.field`. */
export function DatabaseGridViewCellContent(props: DatabaseGridViewCellContentProps) {
    switch (props.field.config.type) {
        case "PlainText":
            return (
                <DatabasePlainTextGridViewCellContent
                    {...(props as DatabaseGridViewCellContentProps<"PlainText">)}
                />
            );
        case "Checkbox":
            return (
                <DatabaseCheckboxGridViewCellContent
                    {...(props as DatabaseGridViewCellContentProps<"Checkbox">)}
                />
            );
        case "Number":
            return (
                <DatabaseNumberGridViewCellContent
                    {...(props as DatabaseGridViewCellContentProps<"Number">)}
                />
            );
        case "Relation":
            return (
                <DatabaseRelationGridViewCellContent
                    {...(props as DatabaseGridViewCellContentProps<"Relation">)}
                />
            );
        default:
            throw exhaustive(props.field.config);
    }
}
