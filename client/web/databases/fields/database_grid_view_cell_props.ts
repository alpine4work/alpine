import type {Ref} from "react";

import type {DatabaseGridViewField} from "~/client/web/databases/use_grid_view_fields.js";
import type {
    DatabaseFieldConfig,
    DatabaseFieldType,
} from "~/shared/databases/fields/database_field_config.js";
import type {DatabaseFieldValue} from "~/shared/databases/fields/database_field_value.js";
import type {DatabaseRowId, DatabaseTableId} from "~/shared/id/types/id_types.open_source.js";

/**
 * Props passed by the grid view to a field type's cell content component.
 */
export type DatabaseGridViewCellContentProps<Type extends DatabaseFieldType = DatabaseFieldType> = {
    ref?: Ref<HTMLElement>;
    field: DatabaseGridViewField & {config: DatabaseFieldConfig<Type>};
    value: DatabaseFieldValue<Type>;
    commitValue: (value: DatabaseFieldValue<Type>) => void;
    onCellClick: () => void;
};

/**
 * Props passed by the grid view to a field type's editor overlay component.
 */
export type DatabaseGridViewCellEditorOverlayProps<
    Type extends DatabaseFieldType = DatabaseFieldType,
> = {
    ref?: Ref<HTMLElement>;
    tableId: DatabaseTableId;
    field: DatabaseGridViewField & {config: DatabaseFieldConfig<Type>};
    rowId: DatabaseRowId;
    /** The current typed value of the cell. */
    initialValue: DatabaseFieldValue<Type>;
    /**
     * Optional string seed when the editor was opened by typing a character or
     * pressing delete/backspace. Takes precedence over `initialValue` for the editor's
     * initial content. The editor decides how (or whether) to use this — e.g. a number
     * editor may ignore non-numeric seeds.
     */
    initialEditString: string | null;
    commitValue: (value: DatabaseFieldValue<Type>) => void;
    onClose: () => void;
    moveSelection: (deltaRow: number, deltaField: number) => void;
    onCreateRow: () => void;
};

/**
 * Args passed by the grid view header to a field type's config menu action
 * builder. The returned actions are appended to the field's editor menu.
 */
export type DatabaseFieldConfigMenuActionsArgs<Type extends DatabaseFieldType = DatabaseFieldType> =
    {
        config: DatabaseFieldConfig<Type>;
        onCommit: (config: DatabaseFieldConfig<Type>) => void;
    };
