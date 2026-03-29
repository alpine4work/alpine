import {startTransition, useMemo, useOptimistic, useState} from "react";

import {useDatabaseConnection} from "~/client/web/databases/database_connection_context.js";
import {useEvent, useEvents} from "~/client/web/helpers/lifecycle/use_event.js";
import {generateChronologicalId} from "~/shared/id/chronological_id.js";
import type {DatabaseFieldId, DatabaseTableId, DatabaseViewId} from "~/shared/id/types/id_types.js";

export type DatabaseGridViewField = {
    readonly id: DatabaseFieldId;
    readonly name: string;
    readonly columnName: string;
    readonly width: number;
};

export type DatabaseGridViewFieldEditing = {
    readonly updateName: (value: string) => void;
    readonly commit: () => void;
    readonly cancel: () => void;
};

export type DatabaseGridViewFieldWithEditing = DatabaseGridViewField & {
    readonly editing: DatabaseGridViewFieldEditing | null;
};

type DatabaseGridViewFieldOptimisticAction =
    | {type: "create"; field: DatabaseGridViewField}
    | {type: "rename"; fieldId: DatabaseFieldId; name: string};

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
} {
    const conn = useDatabaseConnection();

    const [optimisticFields, applyOptimisticField] = useOptimistic(
        fields,
        (
            prev: ReadonlyArray<DatabaseGridViewField>,
            action: DatabaseGridViewFieldOptimisticAction,
        ) => {
            if (action.type === "create") {
                return prev.some(f => f.id === action.field.id) ? prev : [...prev, action.field];
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
        if (conn == null) return;
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
                        field: {id: addingId, name: trimmed, columnName: "__pending__", width: 200},
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

    const baseFields: ReadonlyArray<DatabaseGridViewFieldWithEditing> = useMemo(
        () => optimisticFields.map(field => ({...field, editing: null})),
        [optimisticFields],
    );

    const outputFields: ReadonlyArray<DatabaseGridViewFieldWithEditing> = useMemo(() => {
        if (editingState == null) return baseFields;

        switch (editingState.type) {
            case "renaming": {
                const fieldId = editingState.fieldId;
                return baseFields.map(field =>
                    field.id === fieldId ? {...field, name: editingState.value, editing} : field,
                );
            }
            case "adding":
                return [
                    ...baseFields,
                    {
                        id: editingState.id,
                        name: editingState.value,
                        columnName: "__pending__",
                        width: 200,
                        editing,
                    },
                ];
        }
    }, [baseFields, editingState, editing]);

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

    const startEditingField = useEvent((fieldId: DatabaseFieldId) => {
        const field = optimisticFields.find(f => f.id === fieldId);
        if (field == null) return;
        setEditingState({type: "renaming", fieldId, value: field.name});
    });

    return {fields: outputFields, fieldIndexById, startAddingField, startEditingField};
}
