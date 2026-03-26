import {type Dispatch, type Memo, useCallback, useMemo, useReducer, useRef} from "react";
import {useDatabaseConnection} from "~/client/web/databases/database_connection_context.js";
import {Box} from "~/client/web/design/box.js";
import {GlobalKeyDownEvent} from "~/client/web/helpers/global_key_down_event.js";
import {useLayoutEffectWithoutServerSideWarning} from "~/client/web/helpers/lifecycle/use_layout_effect_without_server_side_warning.js";
import {
    VirtualizedScrollView,
    VirtualizedScrollViewItem,
} from "~/client/web/virtualized/virtualized_scroll_view.js";
import {assert} from "~/shared/helpers/control/assert.js";
import type {DatabaseFieldId, DatabaseRowId} from "~/shared/id/types/id_types.js";

type DatabaseResultTableField = {
    readonly id: DatabaseFieldId;
    readonly name: string;
    readonly columnName: string;
    readonly width: number;
};

const alwaysRenderHeader: ReadonlyArray<number> = [0];

// -- Selection state ----------------------------------------------------------

type DatabaseResultTableSelection = {
    rowId: DatabaseRowId;
    fieldId: DatabaseFieldId;
    isEditing: boolean;
    initialEditValue: string | null;
} | null;

type SelectionAction =
    | {type: "click"; rowId: DatabaseRowId; fieldId: DatabaseFieldId}
    | {type: "blur"}
    | {type: "enter"}
    | {type: "clear"}
    | {type: "type"; character: string}
    | {type: "deselect"};

function selectionReducer(
    state: DatabaseResultTableSelection,
    action: SelectionAction,
): DatabaseResultTableSelection {
    switch (action.type) {
        case "click":
            return {
                rowId: action.rowId,
                fieldId: action.fieldId,
                isEditing: true,
                initialEditValue: null,
            };
        case "blur":
            if (state == null) return null;
            return {...state, isEditing: false, initialEditValue: null};
        case "enter":
            if (state == null) return null;
            return {...state, isEditing: true, initialEditValue: null};
        case "clear":
            if (state == null) return null;
            return {...state, isEditing: true, initialEditValue: ""};
        case "type":
            if (state == null) return null;
            return {...state, isEditing: true, initialEditValue: action.character};
        case "deselect":
            return null;
    }
}

// -- Main component -----------------------------------------------------------

/**
 * Renders database rows in an editable virtualized grid
 * with a sticky header. Uses view field metadata for
 * column names, widths, and field IDs for cell editing.
 */
export function DatabaseResultTable({
    fields,
    rows: rawRows,
}: {
    fields: ReadonlyArray<DatabaseResultTableField>;
    rows: ReadonlyArray<unknown>;
}) {
    const rows = rawRows as ReadonlyArray<Record<string, unknown>>;
    const [selection, dispatch] = useReducer(selectionReducer, null);

    const handleGlobalKeyDown = useCallback(
        (e: KeyboardEvent) => {
            if (selection == null || selection.isEditing) return;

            if (e.key === "Enter") {
                e.preventDefault();
                e.stopPropagation();
                dispatch({type: "enter"});
            } else if (e.key === "Backspace" || e.key === "Delete") {
                e.preventDefault();
                e.stopPropagation();
                dispatch({type: "clear"});
            } else if (e.key === "Escape") {
                e.preventDefault();
                e.stopPropagation();
                dispatch({type: "deselect"});
            } else if (e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) {
                e.preventDefault();
                e.stopPropagation();
                dispatch({type: "type", character: e.key});
            }
        },
        [selection],
    );

    const renderItem: Memo<(index: number) => VirtualizedScrollViewItem> = useMemo(
        () =>
            function renderItem(index: number): VirtualizedScrollViewItem {
                if (index === 0) {
                    return {
                        key: "header",
                        minHeight: 32,
                        zIndex: "10",
                        withManualLayout: true,
                        render({ref, offset, shouldRenderWithRelativePositioning}) {
                            return (
                                <div
                                    style={
                                        shouldRenderWithRelativePositioning
                                            ? {position: "relative"}
                                            : {
                                                  position: "absolute",
                                                  top: offset,
                                                  left: 0,
                                                  right: 0,
                                                  bottom: 0,
                                              }
                                    }
                                >
                                    <div
                                        ref={ref}
                                        style={{
                                            position: shouldRenderWithRelativePositioning
                                                ? "relative"
                                                : "sticky",
                                            top: shouldRenderWithRelativePositioning
                                                ? undefined
                                                : 0,
                                            minHeight: 32,
                                        }}
                                    >
                                        <DatabaseResultTableHeaderRow fields={fields} />
                                    </div>
                                </div>
                            );
                        },
                    };
                }

                const row = rows[index - 1]!;
                assert(typeof row._id === "string", "expected row to have a string _id");
                const rowId = row._id as DatabaseRowId;
                return {
                    key: rowId,
                    minHeight: 32,
                    node: (
                        <DatabaseResultTableDataRow
                            fields={fields}
                            row={row}
                            rowId={rowId}
                            selection={selection}
                            dispatch={dispatch}
                        />
                    ),
                };
            },
        [fields, rows, selection],
    );

    if (rows.length === 0) {
        return (
            <Box fontSize="75" fontStyle="code" color="grey-50" padding="2">
                No rows returned.
            </Box>
        );
    }

    return (
        <GlobalKeyDownEvent onGlobalKeyDown={handleGlobalKeyDown}>
            <Box flexGrow="1" overflow="hidden">
                <VirtualizedScrollView
                    itemCount={rows.length + 1}
                    bufferedItemHeight={32}
                    renderItem={renderItem}
                    alwaysRenderAdditionalItemIndexes={alwaysRenderHeader}
                />
            </Box>
        </GlobalKeyDownEvent>
    );
}

// -- Header row ---------------------------------------------------------------

function DatabaseResultTableHeaderRow({fields}: {fields: ReadonlyArray<DatabaseResultTableField>}) {
    return (
        <Box display="flex">
            {fields.map(field => (
                <Box
                    key={field.columnName}
                    backgroundColor="grey-5"
                    color="grey-80"
                    fontSize="75"
                    fontStyle="truncate-semi-bold"
                    padding="2"
                    textAlign="left"
                    borderBottom="grey-10"
                    style={{
                        width: field.width,
                        minWidth: field.width,
                        maxWidth: field.width,
                    }}
                >
                    {field.name}
                </Box>
            ))}
        </Box>
    );
}

// -- Data row -----------------------------------------------------------------

function DatabaseResultTableDataRow({
    fields,
    row,
    rowId,
    selection,
    dispatch,
}: {
    fields: ReadonlyArray<DatabaseResultTableField>;
    row: Record<string, unknown>;
    rowId: DatabaseRowId;
    selection: DatabaseResultTableSelection;
    dispatch: Dispatch<SelectionAction>;
}) {
    return (
        <Box display="flex">
            {fields.map(field => {
                const isSelected =
                    selection != null &&
                    selection.rowId === rowId &&
                    selection.fieldId === field.id;
                const isEditing = isSelected && selection!.isEditing;
                const initialEditValue = isSelected ? selection!.initialEditValue : null;

                return (
                    <DatabaseResultTableCell
                        key={field.columnName}
                        field={field}
                        value={row[field.columnName]}
                        rowId={rowId}
                        isSelected={isSelected}
                        isEditing={isEditing}
                        initialEditValue={initialEditValue}
                        dispatch={dispatch}
                    />
                );
            })}
        </Box>
    );
}

// -- Cell ---------------------------------------------------------------------

function DatabaseResultTableCell({
    field,
    value,
    rowId,
    isSelected,
    isEditing,
    initialEditValue,
    dispatch,
}: {
    field: DatabaseResultTableField;
    value: unknown;
    rowId: DatabaseRowId;
    isSelected: boolean;
    isEditing: boolean;
    initialEditValue: string | null;
    dispatch: Dispatch<SelectionAction>;
}) {
    const conn = useDatabaseConnection();
    const committedValue = value == null ? "" : String(value);
    const inputRef = useRef<HTMLInputElement>(null);
    const originalValueRef = useRef(committedValue);

    useLayoutEffectWithoutServerSideWarning(() => {
        if (isEditing && inputRef.current != null) {
            inputRef.current.focus();
            inputRef.current.select();
        }
    }, [isEditing]);

    const commitValue = useCallback(
        (newValue: string) => {
            if (conn == null) return;
            if (newValue === committedValue) return;
            conn.call("executeAction", {
                action: {
                    name: "updateCellValue" as const,
                    input: {fieldId: field.id, rowId, value: newValue},
                },
            });
        },
        [conn, field.id, rowId, committedValue],
    );

    const cellStyle: React.CSSProperties = {
        width: field.width,
        minWidth: field.width,
        maxWidth: field.width,
        position: "relative",
        ...(isSelected && !isEditing
            ? {outline: "2px solid var(--color-blue-50)", outlineOffset: -2}
            : undefined),
    };

    if (isEditing) {
        const editValue = initialEditValue ?? committedValue;
        return (
            <div
                style={{
                    ...cellStyle,
                    padding: 0,
                }}
            >
                <input
                    ref={inputRef}
                    defaultValue={editValue}
                    style={{
                        width: "100%",
                        height: "100%",
                        minHeight: 32,
                        boxSizing: "border-box",
                        border: "2px solid var(--color-blue-50)",
                        borderRadius: 0,
                        outline: "none",
                        padding: "0 8px",
                        fontSize: "var(--font-size-75)",
                        fontFamily: "inherit",
                        background: "var(--color-white)",
                    }}
                    onBlur={e => {
                        commitValue(e.currentTarget.value);
                        dispatch({type: "blur"});
                    }}
                    onKeyDown={e => {
                        if (e.key === "Enter") {
                            e.preventDefault();
                            commitValue(e.currentTarget.value);
                            dispatch({type: "blur"});
                        } else if (e.key === "Escape") {
                            e.preventDefault();
                            e.currentTarget.value = originalValueRef.current;
                            dispatch({type: "blur"});
                        }
                        e.stopPropagation();
                    }}
                />
            </div>
        );
    }

    return (
        <Box
            fontSize="75"
            fontStyle="truncate"
            padding="2"
            color="grey-100"
            borderBottom="grey-10"
            style={cellStyle}
            onClick={() => dispatch({type: "click", rowId, fieldId: field.id})}
        >
            {value == null ? "NULL" : String(value)}
        </Box>
    );
}
