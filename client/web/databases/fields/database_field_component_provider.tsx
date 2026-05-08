import type {ComponentType, Ref} from "react";
import {
    DatabaseCellValue,
    DatabaseFieldConfig,
    DatabaseFieldProvider,
    DatabaseFieldType,
} from "~/shared/databases/fields/database_field_providers.js";

// -- Grid view cell props -----------------------------------------------------

/**
 * Props passed by the grid view to a field type's
 * cell content component.
 */
export type DatabaseGridViewCellContentProps<Type extends DatabaseFieldType> = {
    ref?: Ref<HTMLElement>;
    config: DatabaseFieldConfig<Type>;
    value: DatabaseCellValue<Type>;
    commitValue: (value: DatabaseCellValue<Type>) => void;
    onCellClick: () => void;
};

/**
 * Props passed by the grid view to a field type's
 * editor overlay component.
 */
export type DatabaseGridViewCellEditorOverlayProps<Type extends DatabaseFieldType> = {
    ref?: Ref<HTMLElement>;
    config: DatabaseFieldConfig<Type>;
    /**
     * The initial text to render in the editor. Either a
     * raw value-as-string (when opened on a populated
     * cell) or a single-character seed (when opened by
     * pressing a key). The editor parses this back into
     * a typed value on commit.
     */
    initialString: string;
    commitValue: (value: DatabaseCellValue<Type>) => void;
    onClose: () => void;
    moveSelection: (deltaRow: number, deltaField: number) => void;
    onCreateRow: () => void;
};

/**
 * Props passed by the grid view header to a field type's
 * config editor popover. Rendered when the user clicks
 * the per-type indicator in the column header.
 */
export type DatabaseFieldConfigEditorPopoverProps<Type extends DatabaseFieldType> = {
    ref?: Ref<HTMLElement>;
    config: DatabaseFieldConfig<Type>;
    onCommit: (config: DatabaseFieldConfig<Type>) => void;
    onClose: () => void;
};

// -- Base type ----------------------------------------------------------------

/**
 * Non-generic base type for dynamic contexts where the
 * field type is not statically known (e.g. the component
 * provider registry, grid view cell rendering). Component
 * types use `any` so JSX elements are instantiable.
 *
 * For statically typed per-field-type usage, use
 * `DatabaseFieldComponentProvider` from
 * `database_field_component_providers.ts` instead.
 */
export type DatabaseFieldComponentProviderBase = {
    readonly type: DatabaseFieldType;
    readonly label: string;
    readonly GridViewCellContent: ComponentType<
        DatabaseGridViewCellContentProps<DatabaseFieldType>
    >;
    readonly GridViewCellEditorOverlay: ComponentType<
        DatabaseGridViewCellEditorOverlayProps<DatabaseFieldType>
    > | null;
    readonly ConfigEditorPopover: ComponentType<
        DatabaseFieldConfigEditorPopoverProps<DatabaseFieldType>
    > | null;
};

// -- Factory ------------------------------------------------------------------

/**
 * Define a field component provider. `Type` is inferred
 * from the shared field provider so `type` preserves the
 * literal discriminant.
 */
export function defineDatabaseFieldComponentProvider<const Type extends DatabaseFieldType>(
    provider: DatabaseFieldProvider<Type>,
    options: {
        readonly label: string;
        readonly GridViewCellContent: ComponentType<DatabaseGridViewCellContentProps<Type>>;
        readonly GridViewCellEditorOverlay: ComponentType<
            DatabaseGridViewCellEditorOverlayProps<Type>
        > | null;
        readonly ConfigEditorPopover: ComponentType<
            DatabaseFieldConfigEditorPopoverProps<Type>
        > | null;
    },
) {
    return {
        type: provider.type,
        label: options.label,
        GridViewCellContent: options.GridViewCellContent,
        GridViewCellEditorOverlay: options.GridViewCellEditorOverlay,
        ConfigEditorPopover: options.ConfigEditorPopover,
    };
}
