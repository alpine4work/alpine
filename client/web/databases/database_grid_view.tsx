import {Plus} from "phosphor-react";
import {
    type Dispatch,
    type Memo,
    startTransition,
    useEffect,
    useMemo,
    useOptimistic,
    useReducer,
    useRef,
    useState,
} from "react";
import {useDatabaseConnection} from "~/client/web/databases/database_connection_context.js";
import type {DatabaseQuery} from "~/client/web/databases/database_query.js";
import {Box} from "~/client/web/design/box.js";
import {IconButton} from "~/client/web/design/icon_button.js";
import {Overlay} from "~/client/web/design/overlay.js";
import {TextAreaWithAutoGrowingHeight} from "~/client/web/design/text_area_with_auto_growing_height.js";
import {GlobalKeyDownEvent} from "~/client/web/helpers/global_key_down_event.js";
import {useEvent} from "~/client/web/helpers/lifecycle/use_event.js";
import {useStore} from "~/client/web/helpers/use_store.js";
import {sprinkles} from "~/client/web/styles/styles.js";
import {
    VirtualizedScrollView,
    VirtualizedScrollViewItem,
    type VirtualizedScrollViewRef,
} from "~/client/web/virtualized/virtualized_scroll_view.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {generateChronologicalId} from "~/shared/id/chronological_id.js";
import type {
    DatabaseFieldId,
    DatabaseRowId,
    DatabaseTableId,
    DatabaseViewId,
} from "~/shared/id/types/id_types.js";

const alwaysRenderHeader: ReadonlyArray<number> = [0];

// -- Selection state ----------------------------------------------------------

type DatabaseGridViewSelection = {
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
    | {type: "select"; rowId: DatabaseRowId; fieldId: DatabaseFieldId}
    | {type: "deselect"};

function selectionReducer(
    state: DatabaseGridViewSelection,
    action: SelectionAction,
): DatabaseGridViewSelection {
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
        case "select":
            return {
                rowId: action.rowId,
                fieldId: action.fieldId,
                isEditing: false,
                initialEditValue: null,
            };
        case "deselect":
            return null;
    }
}

// -- Main component -----------------------------------------------------------

export type DatabaseGridViewField = {
    readonly id: DatabaseFieldId;
    readonly name: string;
    readonly columnName: string;
    readonly width: number;
};

/**
 * Renders database rows in an editable virtualized grid
 * with a sticky header. Uses view field metadata for
 * column names, widths, and field IDs for cell editing.
 */
export function DatabaseGridView({
    tableId,
    viewId,
    fields,
    query,
}: {
    tableId: DatabaseTableId;
    viewId: DatabaseViewId;
    fields: ReadonlyArray<DatabaseGridViewField>;
    query: DatabaseQuery;
}) {
    const conn = useDatabaseConnection();
    const tree = useStore(query.treeStore);
    const [selection, dispatch] = useReducer(selectionReducer, null);
    const [addingField, setAddingField] = useState<string | null>(null);

    const scrollViewRef = useRef<VirtualizedScrollViewRef>(null);

    const [optimisticFields, addOptimisticField] = useOptimistic(
        fields,
        (prev, newField: DatabaseGridViewField) =>
            prev.some(f => f.id === newField.id) ? prev : [...prev, newField],
    );

    const fieldIndexById = useMemo(() => {
        const map = new Map<DatabaseFieldId, number>();
        for (let i = 0; i < optimisticFields.length; i++) {
            map.set(optimisticFields[i]!.id, i);
        }
        return map;
    }, [optimisticFields]);

    const rowCount = tree.getItemCount();

    const moveSelection = useEvent((deltaRow: number, deltaField: number) => {
        if (selection == null) return;

        // Virtual index 0 is the header; data rows start at 1.
        const virtualIndex = scrollViewRef.current?.getIndexByKeyIfExists(selection.rowId);
        const fieldIndex = fieldIndexById.get(selection.fieldId);
        if (virtualIndex == null || fieldIndex == null) return;

        const rowIndex = virtualIndex - 1;
        const nextRowIndex = Math.max(0, Math.min(rowCount - 1, rowIndex + deltaRow));
        const nextFieldIndex = Math.max(
            0,
            Math.min(optimisticFields.length - 1, fieldIndex + deltaField),
        );

        if (nextRowIndex === rowIndex && nextFieldIndex === fieldIndex) return;

        const nextRow = tree.getItem(nextRowIndex);
        dispatch({
            type: "select",
            rowId: nextRow._id as DatabaseRowId,
            fieldId: optimisticFields[nextFieldIndex]!.id,
        });
    });

    const handleGlobalKeyDown = useEvent((e: KeyboardEvent) => {
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
        } else if (
            e.key === "ArrowUp" ||
            e.key === "ArrowDown" ||
            e.key === "ArrowLeft" ||
            e.key === "ArrowRight"
        ) {
            e.preventDefault();
            e.stopPropagation();
            const deltaRow = e.key === "ArrowUp" ? -1 : e.key === "ArrowDown" ? 1 : 0;
            const deltaField = e.key === "ArrowLeft" ? -1 : e.key === "ArrowRight" ? 1 : 0;
            moveSelection(deltaRow, deltaField);
        } else if (e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) {
            e.preventDefault();
            e.stopPropagation();
            dispatch({type: "type", character: e.key});
        }
    });

    const selectedRowId = selection?.rowId ?? null;
    useEffect(() => {
        if (selectedRowId == null) return;
        scrollViewRef.current?.scrollToKeyIfExists(selectedRowId, {withAnchor: false});
    }, [selectedRowId]);

    const needsMore = useStore(query.needsMoreStore);
    const itemCount = rowCount + 1 + (needsMore ? 1 : 0);

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
                                            zIndex: 2,
                                        }}
                                    >
                                        <DatabaseGridViewHeaderRow
                                            fields={optimisticFields}
                                            addingField={addingField}
                                            onAddingFieldChange={setAddingField}
                                            onCommitField={(fieldName: string) => {
                                                if (conn == null) return;
                                                setAddingField(null);
                                                startTransition(async () => {
                                                    const fieldId =
                                                        generateChronologicalId<DatabaseFieldId>();
                                                    addOptimisticField({
                                                        id: fieldId,
                                                        name: fieldName,
                                                        columnName: "__pending__",
                                                        width: 200,
                                                    });
                                                    await conn.executeAction("createField", {
                                                        fieldId,
                                                        tableId,
                                                        viewId,
                                                        name: fieldName,
                                                    });
                                                });
                                            }}
                                        />
                                    </div>
                                </div>
                            );
                        },
                    };
                }

                // Load-more sentinel at the end.
                if (needsMore && index === rowCount + 1) {
                    return {
                        key: "load-more",
                        minHeight: 32,
                        node: <DatabaseGridViewLoadMoreSentinel query={query} />,
                    };
                }

                const row = tree.getItem(index - 1);
                assert(typeof row._id === "string", "expected row to have a string _id");
                const rowId = row._id as DatabaseRowId;
                return {
                    key: rowId,
                    minHeight: 32,
                    node: (
                        <DatabaseGridViewDataRow
                            fields={optimisticFields}
                            row={row}
                            rowId={rowId}
                            isFirstRow={index === 1}
                            selection={selection}
                            dispatch={dispatch}
                            moveSelection={moveSelection}
                            showGhostCell={addingField !== null}
                        />
                    ),
                };
            },
        [
            optimisticFields,
            tree,
            rowCount,
            needsMore,
            query,
            selection,
            addingField,
            conn,
            tableId,
            viewId,
            addOptimisticField,
            moveSelection,
        ],
    );

    return (
        <GlobalKeyDownEvent onGlobalKeyDown={handleGlobalKeyDown}>
            <Box flexGrow="1" overflow="hidden">
                <VirtualizedScrollView
                    ref={scrollViewRef}
                    itemCount={itemCount}
                    bufferedItemHeight={32}
                    renderItem={renderItem}
                    alwaysRenderAdditionalItemIndexes={alwaysRenderHeader}
                />
            </Box>
        </GlobalKeyDownEvent>
    );
}

// -- Load-more sentinel -------------------------------------------------------

function DatabaseGridViewLoadMoreSentinel({query}: {query: DatabaseQuery}) {
    const isLoadingMore = useStore(query.isLoadingMoreStore);

    useEffect(() => {
        if (!isLoadingMore) {
            void query.loadMore();
        }
    }, [query, isLoadingMore]);

    return (
        <Box
            display="flex"
            alignItems="center"
            justifyContent="center"
            fontSize="75"
            color="grey-50"
            padding="2"
        >
            {isLoadingMore ? "Loading..." : null}
        </Box>
    );
}

// -- Header row ---------------------------------------------------------------

function DatabaseGridViewHeaderRow({
    fields,
    addingField,
    onAddingFieldChange,
    onCommitField,
}: {
    fields: ReadonlyArray<DatabaseGridViewField>;
    addingField: string | null;
    onAddingFieldChange: (value: string | null) => void;
    onCommitField: (name: string) => void;
}) {
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (addingField !== null) {
            inputRef.current?.focus();
        }
    }, [addingField !== null]); // eslint-disable-line react-hooks/exhaustive-deps

    return (
        <Box display="flex" borderBottom="grey-5-translucent">
            {fields.map(field => (
                <Box
                    key={field.columnName}
                    backgroundColor="grey-0"
                    color="grey-80"
                    fontSize="75"
                    fontStyle="truncate-semi-bold"
                    padding="2"
                    textAlign="left"
                    style={{
                        width: field.width,
                        minWidth: field.width,
                        maxWidth: field.width,
                    }}
                >
                    {field.name}
                </Box>
            ))}
            {addingField !== null && (
                <Box style={{width: 200, minWidth: 200, maxWidth: 200}} backgroundColor="grey-0">
                    <input
                        ref={inputRef}
                        value={addingField}
                        onChange={e => onAddingFieldChange(e.currentTarget.value)}
                        onBlur={() => {
                            if (addingField.trim() !== "") {
                                onCommitField(addingField.trim());
                            } else {
                                onAddingFieldChange(null);
                            }
                        }}
                        onKeyDown={e => {
                            if (e.key === "Enter") {
                                e.preventDefault();
                                if (addingField.trim() !== "") {
                                    onCommitField(addingField.trim());
                                } else {
                                    onAddingFieldChange(null);
                                }
                            } else if (e.key === "Escape") {
                                e.preventDefault();
                                onAddingFieldChange(null);
                            }
                            e.stopPropagation();
                        }}
                        className={sprinkles({
                            width: "full",
                            padding: "2",
                            fontSize: "75",
                            color: "grey-80",
                        })}
                    />
                </Box>
            )}
            <Box
                display="flex"
                alignItems="center"
                justifyContent="center"
                width="8"
                flexShrink="0"
                backgroundColor="grey-0"
            >
                <IconButton
                    description="Add field"
                    size="sm"
                    variant="quiet-above-grey-5-background"
                    onPress={() => onAddingFieldChange("")}
                >
                    <Plus />
                </IconButton>
            </Box>
            <Box backgroundColor="grey-0" flexGrow="1" />
        </Box>
    );
}

// -- Data row -----------------------------------------------------------------

function DatabaseGridViewDataRow({
    fields,
    row,
    rowId,
    isFirstRow,
    selection,
    dispatch,
    moveSelection,
    showGhostCell,
}: {
    fields: ReadonlyArray<DatabaseGridViewField>;
    row: Record<string, unknown>;
    rowId: DatabaseRowId;
    isFirstRow: boolean;
    selection: DatabaseGridViewSelection;
    dispatch: Dispatch<SelectionAction>;
    moveSelection: (deltaRow: number, deltaField: number) => void;
    showGhostCell: boolean;
}) {
    return (
        <Box display="flex" borderBottom="grey-5">
            {fields.map(field => {
                const isSelected =
                    selection != null &&
                    selection.rowId === rowId &&
                    selection.fieldId === field.id;
                const isEditing = isSelected && selection!.isEditing;
                const initialEditValue = isSelected ? selection!.initialEditValue : null;

                return (
                    <DatabaseGridViewCell
                        key={field.columnName}
                        field={field}
                        value={row[field.columnName]}
                        rowId={rowId}
                        isFirstRow={isFirstRow}
                        isSelected={isSelected}
                        isEditing={isEditing}
                        initialEditValue={initialEditValue}
                        dispatch={dispatch}
                        moveSelection={moveSelection}
                    />
                );
            })}
            {showGhostCell && (
                <Box fontSize="75" padding="2" style={{width: 200, minWidth: 200, maxWidth: 200}} />
            )}
        </Box>
    );
}

// -- Cell ---------------------------------------------------------------------

function DatabaseGridViewCell({
    field,
    value,
    rowId,
    isFirstRow,
    isSelected,
    isEditing,
    initialEditValue,
    dispatch,
    moveSelection,
}: {
    field: DatabaseGridViewField;
    value: unknown;
    rowId: DatabaseRowId;
    isFirstRow: boolean;
    isSelected: boolean;
    isEditing: boolean;
    initialEditValue: string | null;
    dispatch: Dispatch<SelectionAction>;
    moveSelection: (deltaRow: number, deltaField: number) => void;
}) {
    const conn = useDatabaseConnection();
    const [committedValue, setCommittedValue] = useOptimistic(value == null ? "" : String(value));

    const commitValue = useEvent((newValue: string) => {
        if (conn == null) return;
        if (newValue === committedValue) return;
        startTransition(async () => {
            setCommittedValue(newValue);
            await conn.executeAction("updateCellValue", {
                fieldId: field.id,
                rowId,
                value: newValue,
            });
        });
    });

    const shouldShowBorder = isSelected && !isEditing;

    return (
        <Overlay
            isVisible={isEditing}
            placement="cover-top"
            fallbackPlacements={[]}
            preventOverflow={false}
            sameWidth
            overlay={
                <DatabaseGridViewCellEditor
                    initialValue={initialEditValue ?? committedValue}
                    commitValue={commitValue}
                    dispatch={dispatch}
                    moveSelection={moveSelection}
                />
            }
        >
            <Box
                fontSize="75"
                fontStyle="truncate"
                padding="2"
                color="grey-100"
                border={shouldShowBorder ? "theme-40-const" : "transparent"}
                style={{
                    width: field.width,
                    minWidth: field.width,
                    maxWidth: field.width,
                    marginTop: isFirstRow ? undefined : -1,
                    marginBottom: -1,
                    marginRight: -1,
                    ...(shouldShowBorder ? {zIndex: 1, position: "relative" as const} : undefined),
                }}
                onClick={() => dispatch({type: "click", rowId, fieldId: field.id})}
            >
                {committedValue}
            </Box>
        </Overlay>
    );
}

function DatabaseGridViewCellEditor({
    ref,
    initialValue,
    commitValue,
    dispatch,
    moveSelection,
}: {
    ref?: React.Ref<HTMLElement>;
    initialValue: string;
    commitValue: (value: string) => void;
    dispatch: Dispatch<SelectionAction>;
    moveSelection: (deltaRow: number, deltaField: number) => void;
}) {
    const [editValue, setEditValue] = useState(initialValue);
    const localRef = useRef<HTMLTextAreaElement>(null);

    useEffect(() => {
        const textarea = localRef.current;
        if (textarea) {
            textarea.focus();
            textarea.selectionStart = textarea.value.length;
            textarea.selectionEnd = textarea.value.length;
        }
    }, []);

    return (
        <Box
            ref={ref as React.Ref<HTMLDivElement>}
            border="theme-40-const"
            backgroundColor="grey-0"
        >
            <TextAreaWithAutoGrowingHeight
                ref={localRef}
                value={editValue}
                onChange={e => setEditValue(e.currentTarget.value)}
                className={sprinkles({
                    width: "full",
                    padding: "2",
                    fontSize: "75",
                    color: "grey-100",
                    // border: "theme-40-const",
                    // backgroundColor: "grey-0",
                })}
                onBlur={() => {
                    commitValue(editValue);
                    dispatch({type: "blur"});
                }}
                onKeyDown={e => {
                    if (e.key === "Enter") {
                        e.preventDefault();
                        commitValue((e.currentTarget as HTMLTextAreaElement).value);
                        moveSelection(1, 0);
                    } else if (e.key === "Escape") {
                        e.preventDefault();
                        commitValue((e.currentTarget as HTMLTextAreaElement).value);
                        dispatch({type: "blur"});
                    }
                    e.stopPropagation();
                }}
            />
        </Box>
    );
}
