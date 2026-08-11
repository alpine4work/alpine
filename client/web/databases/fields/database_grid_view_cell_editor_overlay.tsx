import type {DatabaseGridViewCellEditorOverlayProps} from "~/client/web/databases/fields/database_grid_view_cell_props.js";
import {DatabaseNumberGridViewCellEditorOverlay} from "~/client/web/databases/fields/number/database_number_grid_view_cell_editor_overlay.js";
import {DatabasePlainTextGridViewCellEditorOverlay} from "~/client/web/databases/fields/plain_text/database_plain_text_grid_view_cell_editor_overlay.js";
import {DatabaseRelationGridViewCellEditorOverlay} from "~/client/web/databases/fields/relation/database_relation_grid_view_cell_editor_overlay.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.open_source.js";

/**
 * Renders the cell editor overlay component for the field type of `props.field`.
 * Renders nothing for field types without an overlay (see
 * `hasDatabaseGridViewCellEditorOverlay`).
 */
export function DatabaseGridViewCellEditorOverlay(props: DatabaseGridViewCellEditorOverlayProps) {
    switch (props.field.config.type) {
        case "PlainText":
            return (
                <DatabasePlainTextGridViewCellEditorOverlay
                    {...(props as DatabaseGridViewCellEditorOverlayProps<"PlainText">)}
                />
            );
        case "Checkbox":
            return null;
        case "Number":
            return (
                <DatabaseNumberGridViewCellEditorOverlay
                    {...(props as DatabaseGridViewCellEditorOverlayProps<"Number">)}
                />
            );
        case "Relation":
            return (
                <DatabaseRelationGridViewCellEditorOverlay
                    {...(props as DatabaseGridViewCellEditorOverlayProps<"Relation">)}
                />
            );
        default:
            throw exhaustive(props.field.config);
    }
}
