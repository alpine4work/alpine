import type React from "react";
import {startTransition, useMemo, useOptimistic, useState} from "react";

import {useDatabaseConnection} from "~/client/web/databases/database_connection_context.js";
import {useEvent, useEvents} from "~/client/web/helpers/lifecycle/use_event.js";
import {useSpacingScale} from "~/client/web/remix/spacing_scale_context.js";
import {remPxBySpacingScale} from "~/shared/design/core/spacing_scale.js";
import {generateChronologicalId} from "~/shared/id/chronological_id.js";
import type {DatabaseFieldId, DatabaseTableId, DatabaseViewId} from "~/shared/id/types/id_types.js";

export type DatabaseGridViewField = {
    readonly id: DatabaseFieldId;
    readonly name: string;
    readonly width: number;
};

export type DatabaseGridViewFieldEditing = {
    readonly updateName: (value: string) => void;
    readonly commit: () => void;
    readonly cancel: () => void;
};

export type DatabaseGridViewFieldWithEditing = DatabaseGridViewField & {
    readonly columnStyle: React.CSSProperties;
    readonly editing: DatabaseGridViewFieldEditing | null;
};

type DatabaseGridViewFieldOptimisticAction =
    | {type: "create"; field: DatabaseGridViewField}
    | {type: "rename"; fieldId: DatabaseFieldId; name: string}
    | {type: "resize"; fieldId: DatabaseFieldId; width: number};

type ResizingState = {
    readonly fieldId: DatabaseFieldId;
    readonly startX: number;
    readonly startWidth: number;
    readonly currentWidth: number;
    readonly pointerId: number;
} | null;

type EditingState =
    | {readonly type: "adding"; readonly id: DatabaseFieldId; readonly value: string}
    | {readonly type: "renaming"; readonly fieldId: DatabaseFieldId; readonly value: string}
    | null;

/**
 * Manages the field array for a grid view, including
 * optimistic updates and inline editing state for both
 * adding new fields and renaming existing ones.
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
    fieldIndexById: ReadonlyMap<DatabaseFieldId, number>;
    startAddingField: () => void;
    startEditingField: (fieldId: DatabaseFieldId) => void;
    startResizingField: (
        fieldId: DatabaseFieldId,
        event: React.PointerEvent,
    ) => {
        onMove: (event: PointerEvent) => void;
        onRelease: (event: PointerEvent) => void;
        onCancel: () => void;
    };
    resizingState: ResizingState;
} {
    const conn = useDatabaseConnection();
    const spacingScale = useSpacingScale();

    const [optimisticFields, applyOptimisticField] = useOptimistic(
        fields,
        (
            prev: ReadonlyArray<DatabaseGridViewField>,
            action: DatabaseGridViewFieldOptimisticAction,
        ) => {
            if (action.type === "create") {
                return prev.some(f => f.id === action.field.id) ? prev : [...prev, action.field];
            }
            if (action.type === "resize") {
                return prev.map(f => (f.id === action.fieldId ? {...f, width: action.width} : f));
            }
            return prev.map(f => (f.id === action.fieldId ? {...f, name: action.name} : f));
        },
    );

    const [editingState, setEditingState] = useState<EditingState>(null);

    const commitEditing = useEvent(() => {
        if (editingState == null) return;
        const trimmed = editingState.value.trim();
        if (trimmed === "") {
            setEditingState(null);
            return;
        }
        setEditingState(null);
        switch (editingState.type) {
            case "renaming": {
                const fieldId = editingState.fieldId;
                startTransition(async () => {
                    applyOptimisticField({type: "rename", fieldId, name: trimmed});
                    await conn.executeAction("renameField", {fieldId, name: trimmed});
                });
                break;
            }
            case "adding": {
                const addingId = editingState.id;
                startTransition(async () => {
                    applyOptimisticField({
                        type: "create",
                        field: {id: addingId, name: trimmed, width: 200},
                    });
                    await conn.executeAction("createField", {
                        fieldId: addingId,
                        tableId,
                        viewId,
                        name: trimmed,
                    });
                });
                break;
            }
        }
    });

    const updateEditingName = useEvent((value: string) => {
        if (editingState == null) return;
        setEditingState({...editingState, value});
    });

    const cancelEditing = useEvent(() => setEditingState(null));

    const editing: DatabaseGridViewFieldEditing = useEvents({
        updateName: updateEditingName,
        commit: commitEditing,
        cancel: cancelEditing,
    });

    const [resizingState, setResizingState] = useState<ResizingState>(null);

    const baseFields: ReadonlyArray<DatabaseGridViewFieldWithEditing> = useMemo(
        () =>
            optimisticFields.map(field => {
                const widthRem = `${field.width / remPxBySpacingScale.small}rem`;
                const columnStyle: React.CSSProperties = {
                    width: widthRem,
                    minWidth: widthRem,
                    maxWidth: widthRem,
                    marginRight: -1,
                };
                return {...field, columnStyle, editing: null};
            }),
        [optimisticFields],
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

        switch (editingState.type) {
            case "renaming": {
                const fieldId = editingState.fieldId;
                return resizedFields.map(field =>
                    field.id === fieldId ? {...field, name: editingState.value, editing} : field,
                );
            }
            case "adding": {
                const widthRem = `${200 / remPxBySpacingScale.small}rem`;
                return [
                    ...resizedFields,
                    {
                        id: editingState.id,
                        name: editingState.value,
                        width: 200,
                        columnStyle: {
                            width: widthRem,
                            minWidth: widthRem,
                            maxWidth: widthRem,
                            marginRight: -1,
                        },
                        editing,
                    },
                ];
            }
        }
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
        });
    });

    const startResizingField = useEvent((fieldId: DatabaseFieldId, event: React.PointerEvent) => {
        const field = optimisticFields.find(f => f.id === fieldId);
        if (field == null) return {onMove() {}, onRelease() {}, onCancel() {}};

        const startX = event.clientX;
        const startWidth = field.width;
        const pointerId = event.pointerId;
        // Stored widths are in small-scale px. Convert CSS px
        // deltas to small-scale px so the column tracks the
        // pointer 1:1 at any spacing scale.
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
                    await conn.executeAction("resizeField", {viewId, fieldId, width: finalWidth});
                });
            },
            onCancel() {
                setResizingState(null);
            },
        };
    });

    const startEditingField = useEvent((fieldId: DatabaseFieldId) => {
        const field = optimisticFields.find(f => f.id === fieldId);
        if (field == null) return;
        setEditingState({type: "renaming", fieldId, value: field.name});
    });

    return {
        fields: outputFields,
        fieldIndexById,
        startAddingField,
        startEditingField,
        startResizingField,
        resizingState,
    };
}
