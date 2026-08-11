import type {Icon} from "phosphor-react";
import type {ComponentType, Ref} from "react";

import type {DatabaseGridViewField} from "~/client/web/databases/use_grid_view_fields.js";
import type {MenuActions} from "~/client/web/design/menu.js";
import {
    DatabaseFieldConfig,
    DatabaseFieldType,
    DatabaseFieldValue,
} from "~/shared/databases/fields/all_database_field_providers.js";
import type {DatabaseRowId, DatabaseTableId} from "~/shared/id/types/id_types.open_source.js";

// -- Grid view cell props -----------------------------------------------------

/**
 * Props passed by the grid view to a field type's cell content component.
 */
export type DatabaseGridViewCellContentProps<Type extends DatabaseFieldType> = {
    ref?: Ref<HTMLElement>;
    field: DatabaseGridViewField & {config: DatabaseFieldConfig<Type>};
    value: DatabaseFieldValue<Type>;
    commitValue: (value: DatabaseFieldValue<Type>) => void;
    onCellClick: () => void;
};

/**
 * Props passed by the grid view to a field type's editor overlay component.
 */
export type DatabaseGridViewCellEditorOverlayProps<Type extends DatabaseFieldType> = {
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
export type DatabaseFieldConfigMenuActionsArgs<Type extends DatabaseFieldType> = {
    config: DatabaseFieldConfig<Type>;
    onCommit: (config: DatabaseFieldConfig<Type>) => void;
};

// -- Base type ----------------------------------------------------------------

/**
 * Non-generic base type for dynamic contexts where the field type is not
 * statically known (e.g. the component provider registry, grid view cell
 * rendering). Component types use `any` so JSX elements are instantiable.
 *
 * For statically typed per-field-type usage, use `DatabaseFieldComponentProvider`
 * from `database_field_component_providers.ts` instead.
 */
export type DatabaseFieldComponentProviderBase = {
    readonly type: DatabaseFieldType;
    readonly label: string;
    readonly Icon: Icon;
    readonly GridViewCellContent: ComponentType<
        DatabaseGridViewCellContentProps<DatabaseFieldType>
    >;
    readonly GridViewCellEditorOverlay: ComponentType<
        DatabaseGridViewCellEditorOverlayProps<DatabaseFieldType>
    > | null;
    readonly getConfigMenuActions:
        | ((args: DatabaseFieldConfigMenuActionsArgs<DatabaseFieldType>) => MenuActions)
        | null;
};

// -- Factory ------------------------------------------------------------------

/**
 * Define a field component provider. `Type` is inferred from the field type
 * literal so `type` preserves the literal discriminant.
 */
export function defineDatabaseFieldComponentProvider<const Type extends DatabaseFieldType>(
    type: Type,
    options: {
        readonly label: string;
        readonly Icon: Icon;
        readonly GridViewCellContent: ComponentType<DatabaseGridViewCellContentProps<Type>>;
        readonly GridViewCellEditorOverlay: ComponentType<
            DatabaseGridViewCellEditorOverlayProps<Type>
        > | null;
        readonly getConfigMenuActions:
            | ((args: DatabaseFieldConfigMenuActionsArgs<Type>) => MenuActions)
            | null;
    },
) {
    return {
        type,
        label: options.label,
        Icon: options.Icon,
        GridViewCellContent: options.GridViewCellContent,
        GridViewCellEditorOverlay: options.GridViewCellEditorOverlay,
        getConfigMenuActions: options.getConfigMenuActions,
    };
}
