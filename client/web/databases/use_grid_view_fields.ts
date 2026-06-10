import type React from "react";
import {startTransition, useMemo, useOptimistic, useState} from "react";

import {useDatabaseConnection} from "~/client/web/databases/database_connection_context.js";
import {useEvent, useEvents} from "~/client/web/helpers/lifecycle/use_event.js";
import {useSpacingScale} from "~/client/web/remix/spacing_scale_context.js";
import {
    type DatabaseFieldConfig,
    type DatabaseFieldType,
    getDatabaseFieldProvider,
} from "~/shared/databases/fields/database_field_providers.js";
import {databaseViewDefaultColumnWidth} from "~/shared/databases/sqlite_constants.js";
import {remPxBySpacingScale} from "~/shared/design/core/spacing_scale.js";
import {type OrderKey, generateOrderKeyBetween} from "~/shared/helpers/sort/order_key.js";
import {generateChronologicalId} from "~/shared/id/chronological_id.js";
import type {DatabaseFieldId, DatabaseTableId, DatabaseViewId} from "~/shared/id/types/id_types.js";

export type DatabaseGridViewField = {
    readonly id: DatabaseFieldId;
    readonly name: string;
    readonly config: DatabaseFieldConfig;
    readonly position: OrderKey;
    readonly width: number;
    readonly hidden: boolean;
};

export type DatabaseGridViewFieldEditing = {
    readonly updateName: (value: string) => void;
    readonly commit: () => void;
    readonly commitWithType: (type: DatabaseFieldType) => void;
    readonly cancel: () => void;
};

export type DatabaseGridViewFieldWithEditing = DatabaseGridViewField & {
    readonly columnStyle: React.CSSProperties;
    readonly editing: DatabaseGridViewFieldEditing | null;
    // `columnName` is set to "**pending**" for fields that are being added
    // optimistically and don't yet have a server-assigned SQL column name.
    readonly columnName: string;
};

type DatabaseGridViewFieldOptimisticAction =
    | {type: "create"; field: DatabaseGridViewField}
    | {type: "rename"; fieldId: DatabaseFieldId; name: string}
    | {type: "resize"; fieldId: DatabaseFieldId; width: number}
    | {type: "updateConfig"; fieldId: DatabaseFieldId; config: DatabaseFieldConfig}
    | {type: "updateVisibility"; fieldId: DatabaseFieldId; position: OrderKey; isHidden: boolean};

type ResizingState = {
    readonly fieldId: DatabaseFieldId;
    readonly startX: number;
    readonly startWidth: number;
    readonly currentWidth: number;
    readonly pointerId: number;
} | null;

type EditingState = {
    readonly type: "adding";
    readonly id: DatabaseFieldId;
    readonly value: string;
    readonly fieldType: DatabaseFieldType;
} | null;

/**
 * Manages the field array for a grid view, including optimistic updates and inline
 * editing state for both adding new fields and renaming existing ones. Operates on
 * a single `fields` array where each field carries a `hidden` flag; derives the
 * visible grid columns and the hidden-fields list from it.
 */
export function useGridViewFields({
    tableId,
    viewId,
    fields,
}: {
    tableId: DatabaseTableId;
    viewId: DatabaseViewId;
    fields: ReadonlyArray<DatabaseGridViewField>;
}): {
    fields: ReadonlyArray<DatabaseGridViewFieldWithEditing>;
    hiddenFields: ReadonlyArray<DatabaseGridViewField>;
    fieldIndexById: ReadonlyMap<DatabaseFieldId, number>;
    contentMinWidth: number;
    startAddingField: () => void;
    startResizingField: (
        fieldId: DatabaseFieldId,
        event: React.PointerEvent,
    ) => {
        onMove: (event: PointerEvent) => void;
        onRelease: (event: PointerEvent) => void;
        onCancel: () => void;
    };
    resizingState: ResizingState;
    renameField: (fieldId: DatabaseFieldId, name: string) => void;
    updateFieldVisibility: (
        fieldId: DatabaseFieldId,
        position: OrderKey,
        isHidden: boolean,
    ) => void;
    updateFieldConfig: (fieldId: DatabaseFieldId, config: DatabaseFieldConfig) => void;
} {
    const conn = useDatabaseConnection();
    const spacingScale = useSpacingScale();

    const [optimisticFields, applyOptimisticField] = useOptimistic(
        fields,
        (
            prev: ReadonlyArray<DatabaseGridViewField>,
            action: DatabaseGridViewFieldOptimisticAction,
        ) => {
            switch (action.type) {
                case "create":
                    return prev.some(f => f.id === action.field.id)
                        ? prev
                        : [...prev, action.field];
                case "rename":
                    return prev.map(f => (f.id === action.fieldId ? {...f, name: action.name} : f));
                case "resize":
                    return prev.map(f =>
                        f.id === action.fieldId ? {...f, width: action.width} : f,
                    );
                case "updateConfig":
                    return prev.map(f =>
                        f.id === action.fieldId ? {...f, config: action.config} : f,
                    );
                case "updateVisibility":
                    return prev
                        .map(f =>
                            f.id === action.fieldId
                                ? {...f, position: action.position, hidden: action.isHidden}
                                : f,
                        )
                        .sort((a, b) =>
                            a.position < b.position ? -1 : a.position > b.position ? 1 : 0,
                        );
            }
        },
    );

    // Derive visible and hidden lists from the single array.
    const visibleFields = useMemo(
        () => optimisticFields.filter(f => !f.hidden),
        [optimisticFields],
    );
    const hiddenFields = useMemo(() => optimisticFields.filter(f => f.hidden), [optimisticFields]);

    const [editingState, setEditingState] = useState<EditingState>(null);

    const commitEditing = useEvent(() => {
        if (editingState == null) return;
        const trimmed = editingState.value.trim();
        if (trimmed === "") {
            setEditingState(null);
            return;
        }
        const addingId = editingState.id;
        const addingFieldType = editingState.fieldType;
        setEditingState(null);
        const lastVisible = visibleFields[visibleFields.length - 1];
        const addPosition = generateOrderKeyBetween(lastVisible?.position ?? null, null);
        startTransition(async () => {
            applyOptimisticField({
                type: "create",
                field: {
                    id: addingId,
                    name: trimmed,
                    config: getDatabaseFieldProvider(addingFieldType).getDefaultConfig(),
                    position: addPosition,
                    width: databaseViewDefaultColumnWidth,
                    hidden: false,
                },
            });
            await conn.executeAction("createField", {
                fieldId: addingId,
                tableId,
                viewId,
                name: trimmed,
                type: addingFieldType,
            });
        });
    });

    const updateEditingName = useEvent((value: string) => {
        if (editingState == null) return;
        setEditingState({...editingState, value});
    });

    const commitWithType = useEvent((fieldType: DatabaseFieldType) => {
        if (editingState == null || editingState.type !== "adding") return;
        const trimmed = editingState.value.trim();
        if (trimmed === "") {
            setEditingState(null);
            return;
        }
        const addingId = editingState.id;
        const lastField = visibleFields[visibleFields.length - 1];
        const addPosition = generateOrderKeyBetween(lastField?.position ?? null, null);
        setEditingState(null);
        startTransition(async () => {
            applyOptimisticField({
                type: "create",
                field: {
                    id: addingId,
                    name: trimmed,
                    config: getDatabaseFieldProvider(fieldType).getDefaultConfig(),
                    position: addPosition,
                    width: databaseViewDefaultColumnWidth,
                    hidden: false,
                },
            });
            await conn.executeAction("createField", {
                fieldId: addingId,
                tableId,
                viewId,
                name: trimmed,
                type: fieldType,
            });
        });
    });

    const cancelEditing = useEvent(() => setEditingState(null));

    const editing: DatabaseGridViewFieldEditing = useEvents({
        updateName: updateEditingName,
        commit: commitEditing,
        commitWithType,
        cancel: cancelEditing,
    });

    const [resizingState, setResizingState] = useState<ResizingState>(null);

    const baseFields: ReadonlyArray<DatabaseGridViewFieldWithEditing> = useMemo(
        () =>
            visibleFields.map(field => {
                const widthRem = `${field.width / remPxBySpacingScale.small}rem`;
                const columnStyle: React.CSSProperties = {
                    width: widthRem,
                    minWidth: widthRem,
                    maxWidth: widthRem,
                    marginRight: -1,
                };
                return {...field, columnName: field.id, columnStyle, editing: null};
            }),
        [visibleFields],
    );

    const resizedFields: ReadonlyArray<DatabaseGridViewFieldWithEditing> = useMemo(() => {
        if (resizingState == null) return baseFields;
        return baseFields.map(field => {
            if (field.id !== resizingState.fieldId) return field;
            const widthRem = `${resizingState.currentWidth / remPxBySpacingScale.small}rem`;
            return {
                ...field,
                width: resizingState.currentWidth,
                columnStyle: {
                    width: widthRem,
                    minWidth: widthRem,
                    maxWidth: widthRem,
                    marginRight: -1,
                },
            };
        });
    }, [baseFields, resizingState]);

    const outputFields: ReadonlyArray<DatabaseGridViewFieldWithEditing> = useMemo(() => {
        if (editingState == null) return resizedFields;
        const widthRem = `${databaseViewDefaultColumnWidth / remPxBySpacingScale.small}rem`;
        const lastField = resizedFields[resizedFields.length - 1];
        return [
            ...resizedFields,
            {
                id: editingState.id,
                name: editingState.value,
                columnName: "__pending__",
                config: getDatabaseFieldProvider(editingState.fieldType).getDefaultConfig(),
                position: generateOrderKeyBetween(lastField?.position ?? null, null),
                width: databaseViewDefaultColumnWidth,
                hidden: false,
                columnStyle: {
                    width: widthRem,
                    minWidth: widthRem,
                    maxWidth: widthRem,
                    marginRight: -1,
                },
                editing,
            },
        ];
    }, [resizedFields, editingState, editing]);

    const fieldIndexById = useMemo(() => {
        const map = new Map<DatabaseFieldId, number>();
        for (let i = 0; i < outputFields.length; i++) {
            map.set(outputFields[i]!.id, i);
        }
        return map;
    }, [outputFields]);

    const startAddingField = useEvent(() => {
        setEditingState({
            type: "adding",
            id: generateChronologicalId<DatabaseFieldId>(),
            value: "",
            fieldType: "plainText",
        });
    });

    const startResizingField = useEvent((fieldId: DatabaseFieldId, event: React.PointerEvent) => {
        const field = visibleFields.find(f => f.id === fieldId);
        if (field == null) return {onMove() {}, onRelease() {}, onCancel() {}};

        const startX = event.clientX;
        const startWidth = field.width;
        const pointerId = event.pointerId;
        // Stored widths are in small-scale px. Convert CSS px deltas to small-scale px so
        // the column tracks the pointer 1:1 at any spacing scale.
        const pxToStored = remPxBySpacingScale.small / remPxBySpacingScale[spacingScale];

        setResizingState({fieldId, startX, startWidth, currentWidth: startWidth, pointerId});

        return {
            onMove(e: PointerEvent) {
                if (e.pointerId !== pointerId) return;
                const delta = (e.clientX - startX) * pxToStored;
                const newWidth = Math.max(60, Math.min(1200, Math.round(startWidth + delta)));
                setResizingState(prev =>
                    prev != null && prev.pointerId === pointerId
                        ? {...prev, currentWidth: newWidth}
                        : prev,
                );
            },
            onRelease(e: PointerEvent) {
                if (e.pointerId !== pointerId) return;
                const delta = (e.clientX - startX) * pxToStored;
                const finalWidth = Math.max(60, Math.min(1200, Math.round(startWidth + delta)));
                setResizingState(null);
                startTransition(async () => {
                    applyOptimisticField({type: "resize", fieldId, width: finalWidth});
                    await conn.executeAction("resizeField", {
                        tableId,
                        viewId,
                        fieldId,
                        width: finalWidth,
                    });
                });
            },
            onCancel() {
                setResizingState(null);
            },
        };
    });

    const renameField = useEvent((fieldId: DatabaseFieldId, name: string) => {
        const trimmed = name.trim();
        if (trimmed === "") return;
        startTransition(async () => {
            applyOptimisticField({type: "rename", fieldId, name: trimmed});
            await conn.executeAction("renameField", {tableId, fieldId, name: trimmed});
        });
    });

    const updateFieldVisibility = useEvent(
        (fieldId: DatabaseFieldId, position: OrderKey, isHidden: boolean) => {
            startTransition(async () => {
                applyOptimisticField({type: "updateVisibility", fieldId, position, isHidden});
                await conn.executeAction("updateFieldViewVisibility", {
                    tableId,
                    viewId,
                    fieldId,
                    position,
                    isHidden,
                });
            });
        },
    );

    const updateFieldConfig = useEvent((fieldId: DatabaseFieldId, config: DatabaseFieldConfig) => {
        startTransition(async () => {
            applyOptimisticField({type: "updateConfig", fieldId, config});
            await conn.executeAction("updateFieldConfig", {fieldId, config});
        });
    });

    // Total pixel width of all visible columns plus the header toolbar (add-field +
    // visibility buttons) at the current spacing scale. Used by the grid view to
    // enable horizontal scrolling when columns overflow.
    const contentMinWidth = useMemo(() => {
        const pxPerRem = remPxBySpacingScale[spacingScale];
        const scale = pxPerRem / remPxBySpacingScale.small;
        let total = 0;
        for (const field of outputFields) {
            total += field.width * scale;
        }
        // Account for the header toolbar: two sm icon buttons (1.25rem each) + paddingX
        // 0.25rem×2 + gap 0.125rem = 3.125rem.
        total += 3.125 * pxPerRem;
        return total;
    }, [outputFields, spacingScale]);

    return {
        fields: outputFields,
        hiddenFields,
        fieldIndexById,
        contentMinWidth,
        startAddingField,
        startResizingField,
        resizingState,
        renameField,
        updateFieldVisibility,
        updateFieldConfig,
    };
}
