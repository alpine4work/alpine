import type React from "react";
import {startTransition, useMemo, useOptimistic, useState} from "react";

import {useDatabaseConnection} from "~/client/web/databases/database_connection_context.js";
import {useEvent} from "~/client/web/helpers/lifecycle/use_event.js";
import {useSpacingScale} from "~/client/web/remix/spacing_scale_context.js";
import {type DatabaseFieldConfig} from "~/shared/databases/fields/all_database_field_providers.js";
import {databaseViewDefaultColumnWidth} from "~/shared/databases/sqlite_constants.js";
import {remPxBySpacingScale} from "~/shared/design/core/spacing_scale.open_source.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.open_source.js";
import {
    type OrderKey,
    generateOrderKeyBetween,
} from "~/shared/helpers/sort/order_key.open_source.js";
import {generateChronologicalId} from "~/shared/id/chronological_id.open_source.js";
import type {
    DatabaseFieldId,
    DatabaseTableId,
    DatabaseViewId,
} from "~/shared/id/types/id_types.open_source.js";

export type DatabaseGridViewField = {
    readonly id: DatabaseFieldId;
    readonly name: string;
    readonly config: DatabaseFieldConfig;
    readonly position: OrderKey;
    readonly width: number;
    readonly hidden: boolean;
    readonly linkedTableReadAccess: boolean | null;
};

/**
 * A visible grid column: a field plus the CSS needed to render its cells at the
 * field's stored width.
 */
export type DatabaseGridViewColumn = DatabaseGridViewField & {
    readonly columnStyle: React.CSSProperties;
};

/**
 * The description of a new field committed from the field creation UI. For
 * relation fields the creation UI generates the `joinTableId` and always uses
 * `side: "source"` (the symmetric target field is created by the server).
 */
export type DatabaseGridViewNewField = {
    readonly name: string;
    readonly config: DatabaseFieldConfig;
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

/**
 * Manages the field array for a grid view, including optimistic updates. Operates
 * on a single `fields` array where each field carries a `hidden` flag; derives the
 * visible grid columns and the hidden-fields list from it.
 *
 * While a field is being added, `addingFieldId` identifies a placeholder column
 * appended after the last visible field. All the intermediate creation state
 * (draft name, picked type, relation options) lives in the field creation UI
 * component; it reports back here through `commitAddingField` which applies the
 * optimistic update and persists the new field.
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
    fields: ReadonlyArray<DatabaseGridViewColumn>;
    hiddenFields: ReadonlyArray<DatabaseGridViewField>;
    fieldIndexById: ReadonlyMap<DatabaseFieldId, number>;
    contentMinWidth: number;
    addingFieldId: DatabaseFieldId | null;
    startAddingField: () => void;
    commitAddingField: (newField: DatabaseGridViewNewField) => void;
    cancelAddingField: () => void;
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

    const [addingFieldId, setAddingFieldId] = useState<DatabaseFieldId | null>(null);

    const startAddingField = useEvent(() => {
        setAddingFieldId(generateChronologicalId<DatabaseFieldId>());
    });

    const cancelAddingField = useEvent(() => setAddingFieldId(null));

    const commitAddingField = useEvent(({name, config}: DatabaseGridViewNewField) => {
        if (addingFieldId == null) return;
        const fieldId = addingFieldId;
        setAddingFieldId(null);

        if (config.type === "relation") {
            startTransition(async () => {
                await conn.executeAction("createRelationField", {
                    joinTableId: config.joinTableId,
                    sourceTableId: tableId,
                    sourceFieldName: name,
                    targetTableId: config.linkedTableId,
                    cardinality: config.cardinality,
                });
            });
            return;
        }

        const lastVisible = visibleFields[visibleFields.length - 1];
        const addPosition = generateOrderKeyBetween(lastVisible?.position ?? null, null);
        startTransition(async () => {
            applyOptimisticField({
                type: "create",
                field: {
                    id: fieldId,
                    name,
                    config,
                    position: addPosition,
                    width: databaseViewDefaultColumnWidth,
                    hidden: false,
                    linkedTableReadAccess: null,
                },
            });
            await conn.executeAction("createField", {fieldId, tableId, name, config});
        });
    });

    const [resizingState, setResizingState] = useState<ResizingState>(null);

    const baseFields: ReadonlyArray<DatabaseGridViewColumn> = useMemo(
        () =>
            visibleFields.map(field => {
                const widthRem = `${field.width / remPxBySpacingScale.small}rem`;
                const columnStyle: React.CSSProperties = {
                    width: widthRem,
                    minWidth: widthRem,
                    maxWidth: widthRem,
                    marginRight: -1,
                };
                return {...field, columnStyle};
            }),
        [visibleFields],
    );

    const resizedFields: ReadonlyArray<DatabaseGridViewColumn> = useMemo(() => {
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

    // While a field is being added, append a placeholder column after the last visible
    // field. The placeholder renders empty plain text cells; the header cell for it
    // renders the field creation UI.
    const outputFields: ReadonlyArray<DatabaseGridViewColumn> = useMemo(() => {
        if (addingFieldId == null) return resizedFields;
        const widthRem = `${databaseViewDefaultColumnWidth / remPxBySpacingScale.small}rem`;
        const lastField = resizedFields[resizedFields.length - 1];
        return [
            ...resizedFields,
            {
                id: addingFieldId,
                name: "",
                config: {type: "plainText"},
                position: generateOrderKeyBetween(lastField?.position ?? null, null),
                width: databaseViewDefaultColumnWidth,
                hidden: false,
                linkedTableReadAccess: null,
                columnStyle: {
                    width: widthRem,
                    minWidth: widthRem,
                    maxWidth: widthRem,
                    marginRight: -1,
                },
            },
        ];
    }, [resizedFields, addingFieldId]);

    const fieldIndexById = useMemo(() => {
        const map = new Map<DatabaseFieldId, number>();
        for (let i = 0; i < outputFields.length; i++) {
            map.set(assertExists(outputFields[i]).id, i);
        }
        return map;
    }, [outputFields]);

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
                    isVisible: !isHidden,
                });
            });
        },
    );

    const updateFieldConfig = useEvent((fieldId: DatabaseFieldId, config: DatabaseFieldConfig) => {
        startTransition(async () => {
            applyOptimisticField({type: "updateConfig", fieldId, config});
            await conn.executeAction("updateFieldConfig", {tableId, fieldId, config});
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
        addingFieldId,
        startAddingField,
        commitAddingField,
        cancelAddingField,
        startResizingField,
        resizingState,
        renameField,
        updateFieldVisibility,
        updateFieldConfig,
    };
}
