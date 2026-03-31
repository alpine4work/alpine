import {useHover} from "@react-aria/interactions";
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
import {mergeProps} from "react-aria";

import {useDatabaseConnection} from "~/client/web/databases/database_connection_context.js";
import type {DatabaseQuery} from "~/client/web/databases/database_query.js";
import type {DatabaseQueryRow} from "~/client/web/databases/database_query_row.js";
import {
    type DatabaseGridViewField,
    type DatabaseGridViewFieldWithEditing,
    useGridViewFields,
} from "~/client/web/databases/use_grid_view_fields.js";
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
import type {Spacing} from "~/shared/design/core/spacing.js";
import {spacing} from "~/shared/design/core/spacing.js";
import {generateChronologicalId} from "~/shared/id/chronological_id.js";
import type {
    DatabaseFieldId,
    DatabaseRowId,
    DatabaseTableId,
    DatabaseViewId,
} from "~/shared/id/types/id_types.js";

const gridRowHeight: Spacing = "8"; // 2rem = 32px at desktop scale

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
    const tree = useStore(query.treeStore);
    const [selection, dispatch] = useReducer(selectionReducer, null);

    const scrollViewRef = useRef<VirtualizedScrollViewRef>(null);

    const gridFields = useGridViewFields({tableId, viewId, fields});
    const conn = useDatabaseConnection();

    const createRow = useEvent(() => {
        const firstFieldId = gridFields.fields[0]?.id;
        if (firstFieldId == null) return;
        const rowId = generateChronologicalId<DatabaseRowId>();
        dispatch({type: "click", rowId, fieldId: firstFieldId});
        startTransition(async () => {
            await conn.executeAction("createRow", {tableId, rowId});
        });
    });

    const rowCount = tree.getItemCount();
    const addRowIndex = rowCount + 1;
    const alwaysRenderIndexes = useMemo(() => [0, addRowIndex], [addRowIndex]);

    const moveSelection = useEvent((deltaRow: number, deltaField: number) => {
        if (selection == null) return;

        // Virtual index 0 is the header; data rows start at 1.
        const virtualIndex = scrollViewRef.current?.getIndexByKeyIfExists(selection.rowId);
        const fieldIndex = gridFields.fieldIndexById.get(selection.fieldId);
        if (virtualIndex == null || fieldIndex == null) return;

        const rowIndex = virtualIndex - 1;
        const nextRowIndex = Math.max(0, Math.min(rowCount - 1, rowIndex + deltaRow));
        const nextFieldIndex = Math.max(
            0,
            Math.min(gridFields.fields.length - 1, fieldIndex + deltaField),
        );

        if (nextRowIndex === rowIndex && nextFieldIndex === fieldIndex) {
            dispatch({type: "blur"});
            return;
        }

        const nextRow = tree.getItem(nextRowIndex);
        dispatch({
            type: "select",
            rowId: nextRow.getId(),
            fieldId: gridFields.fields[nextFieldIndex]!.id,
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
    const itemCount = rowCount + 2 + (needsMore ? 1 : 0);

    const renderItem: Memo<(index: number) => VirtualizedScrollViewItem> = useMemo(
        () =>
            function renderItem(index: number): VirtualizedScrollViewItem {
                if (index === 0) {
                    return {
                        key: "header",
                        minHeight: spacing[gridRowHeight],
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
                                    <Box
                                        ref={ref}
                                        minHeight={gridRowHeight}
                                        style={{
                                            position: shouldRenderWithRelativePositioning
                                                ? "relative"
                                                : "sticky",
                                            top: shouldRenderWithRelativePositioning
                                                ? undefined
                                                : 0,
                                            zIndex: 2,
                                        }}
                                    >
                                        <DatabaseGridViewHeaderRow
                                            fields={gridFields.fields}
                                            onStartAddingField={gridFields.startAddingField}
                                            onStartEditingField={gridFields.startEditingField}
                                            startResizingField={gridFields.startResizingField}
                                            resizingState={gridFields.resizingState}
                                        />
                                    </Box>
                                </div>
                            );
                        },
                    };
                }

                // Sticky add-row button after all data rows.
                if (index === rowCount + 1) {
                    return {
                        key: "add-row",
                        minHeight: spacing[gridRowHeight],
                        withManualLayout: true,
                        render({ref, offset}) {
                            return (
                                <>
                                    <div style={{height: offset}} />
                                    <Box
                                        ref={ref}
                                        minHeight={gridRowHeight}
                                        backgroundColor="grey-0"
                                        style={{
                                            position: "sticky",
                                            bottom: 0,
                                            pointerEvents: "auto",
                                        }}
                                    >
                                        <DatabaseGridViewAddRowButton onCreateRow={createRow} />
                                    </Box>
                                </>
                            );
                        },
                    };
                }

                // Load-more sentinel at the end.
                if (needsMore && index === rowCount + 2) {
                    return {
                        key: "load-more",
                        minHeight: spacing[gridRowHeight],
                        node: <DatabaseGridViewLoadMoreSentinel query={query} />,
                    };
                }

                const row = tree.getItem(index - 1);
                const rowId = row.getId();
                return {
                    key: rowId,
                    minHeight: spacing[gridRowHeight],
                    node: (
                        <DatabaseGridViewDataRow
                            fields={gridFields.fields}
                            row={row}
                            rowId={rowId}
                            isFirstRow={index === 1}
                            isLastRow={index === rowCount}
                            selection={selection}
                            dispatch={dispatch}
                            moveSelection={moveSelection}
                            onCreateRow={createRow}
                        />
                    ),
                };
            },
        [
            gridFields.fields,
            gridFields.startAddingField,
            gridFields.startEditingField,
            gridFields.startResizingField,
            gridFields.resizingState,
            tree,
            rowCount,
            needsMore,
            query,
            selection,
            moveSelection,
            createRow,
        ],
    );

    return (
        <GlobalKeyDownEvent onGlobalKeyDown={handleGlobalKeyDown}>
            <Box flexGrow="1" overflow="hidden">
                <VirtualizedScrollView
                    ref={scrollViewRef}
                    itemCount={itemCount}
                    bufferedItemHeight={spacing[gridRowHeight]}
                    renderItem={renderItem}
                    alwaysRenderAdditionalItemIndexes={alwaysRenderIndexes}
                    scrollbarInsetTopItemIndex={0}
                    scrollbarInsetBottomItemIndex={addRowIndex}
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
    onStartAddingField,
    onStartEditingField,
    startResizingField,
    resizingState,
}: {
    fields: ReadonlyArray<DatabaseGridViewFieldWithEditing>;
    onStartAddingField: () => void;
    onStartEditingField: (fieldId: DatabaseFieldId) => void;
    startResizingField: (
        fieldId: DatabaseFieldId,
        event: React.PointerEvent,
    ) => {
        onMove: (event: PointerEvent) => void;
        onRelease: (event: PointerEvent) => void;
        onCancel: () => void;
    };
    resizingState: {readonly fieldId: DatabaseFieldId} | null;
}) {
    return (
        <Box display="flex" borderBottom="grey-5-translucent">
            {fields.map(field => (
                <DatabaseGridViewHeaderCell
                    key={field.id}
                    field={field}
                    onStartEditingField={onStartEditingField}
                    startResizingField={startResizingField}
                    isResizingThisField={resizingState?.fieldId === field.id}
                />
            ))}
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
                    onPress={onStartAddingField}
                >
                    <Plus />
                </IconButton>
            </Box>
            <Box backgroundColor="grey-0" flexGrow="1" />
        </Box>
    );
}

function DatabaseGridViewHeaderCell({
    field,
    onStartEditingField,
    startResizingField,
    isResizingThisField,
}: {
    field: DatabaseGridViewFieldWithEditing;
    onStartEditingField: (fieldId: DatabaseFieldId) => void;
    startResizingField: (
        fieldId: DatabaseFieldId,
        event: React.PointerEvent,
    ) => {
        onMove: (event: PointerEvent) => void;
        onRelease: (event: PointerEvent) => void;
        onCancel: () => void;
    };
    isResizingThisField: boolean;
}) {
    const inputRef = useRef<HTMLInputElement>(null);
    const editing = field.editing;

    useEffect(() => {
        if (editing != null) {
            const input = inputRef.current;
            if (input) {
                input.focus();
                input.select();
            }
        }
    }, [editing != null]); // eslint-disable-line react-hooks/exhaustive-deps

    return (
        <Box
            backgroundColor="grey-0"
            position="relative"
            style={field.columnStyle}
            onDoubleClick={() => onStartEditingField(field.id)}
        >
            {editing ? (
                <input
                    ref={inputRef}
                    value={field.name}
                    onChange={e => editing.updateName(e.currentTarget.value)}
                    onBlur={() => editing.commit()}
                    onKeyDown={e => {
                        if (e.key === "Enter") {
                            e.preventDefault();
                            editing.commit();
                        } else if (e.key === "Escape") {
                            e.preventDefault();
                            editing.cancel();
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
            ) : (
                <Box
                    color="grey-80"
                    fontSize="75"
                    fontStyle="truncate-semi-bold"
                    padding="2"
                    textAlign="left"
                >
                    {field.name}
                </Box>
            )}
            <DatabaseGridViewResizeHandle
                fieldId={field.id}
                startResizingField={startResizingField}
                isResizingThisField={isResizingThisField}
            />
        </Box>
    );
}

// -- Resize handle ------------------------------------------------------------

function DatabaseGridViewResizeHandle({
    fieldId,
    startResizingField,
    isResizingThisField,
}: {
    fieldId: DatabaseFieldId;
    startResizingField: (
        fieldId: DatabaseFieldId,
        event: React.PointerEvent,
    ) => {
        onMove: (event: PointerEvent) => void;
        onRelease: (event: PointerEvent) => void;
        onCancel: () => void;
    };
    isResizingThisField: boolean;
}) {
    const {hoverProps, isHovered} = useHover({});

    const [resizeHandlers, setResizeHandlers] = useState<{
        onMove: (event: PointerEvent) => void;
        onRelease: (event: PointerEvent) => void;
        onCancel: () => void;
    } | null>(null);

    const isResizing = resizeHandlers != null;
    const showBar = isHovered || isResizing || isResizingThisField;

    return (
        <Box
            position="absolute"
            top="0"
            bottom="0"
            right="-2"
            width="4"
            cursor="col-resize"
            zIndex="10"
            touchAction="none"
            {...mergeProps(hoverProps, {
                onPointerDown(event: React.PointerEvent) {
                    const handlers = startResizingField(fieldId, event);
                    setResizeHandlers(handlers);
                    event.currentTarget.setPointerCapture(event.pointerId);
                },
                onPointerMove(event: React.PointerEvent) {
                    resizeHandlers?.onMove(event.nativeEvent);
                },
                onPointerUp(event: React.PointerEvent) {
                    resizeHandlers?.onRelease(event.nativeEvent);
                    setResizeHandlers(null);
                },
                onPointerCancel() {
                    resizeHandlers?.onCancel();
                    setResizeHandlers(null);
                },
                onLostPointerCapture() {
                    resizeHandlers?.onCancel();
                    setResizeHandlers(null);
                },
            })}
        >
            <Box
                position="absolute"
                top="0"
                bottom="0"
                backgroundColor={showBar ? "theme-40-const" : "transparent"}
                style={{
                    left: 7,
                    width: 2,
                }}
            />
        </Box>
    );
}

// -- Data row -----------------------------------------------------------------

function DatabaseGridViewDataRow({
    fields,
    row,
    rowId,
    isFirstRow,
    isLastRow,
    selection,
    dispatch,
    moveSelection,
    onCreateRow,
}: {
    fields: ReadonlyArray<DatabaseGridViewFieldWithEditing>;
    row: DatabaseQueryRow;
    rowId: DatabaseRowId;
    isFirstRow: boolean;
    isLastRow: boolean;
    selection: DatabaseGridViewSelection;
    dispatch: Dispatch<SelectionAction>;
    moveSelection: (deltaRow: number, deltaField: number) => void;
    onCreateRow: () => void;
}) {
    return (
        <Box
            display="flex"
            style={{height: `calc(${spacing[gridRowHeight]} + 1px)`}}
            borderBottom={isLastRow ? undefined : "grey-5"}
        >
            {fields.map(field => {
                const isSelected =
                    selection != null &&
                    selection.rowId === rowId &&
                    selection.fieldId === field.id;
                const isEditing = isSelected && selection!.isEditing;
                const initialEditValue = isSelected ? selection!.initialEditValue : null;

                return (
                    <DatabaseGridViewCell
                        key={field.id}
                        field={field}
                        value={row.getCellValue(field.id)}
                        rowId={rowId}
                        isFirstRow={isFirstRow}
                        isSelected={isSelected}
                        isEditing={isEditing}
                        initialEditValue={initialEditValue}
                        dispatch={dispatch}
                        moveSelection={moveSelection}
                        onCreateRow={onCreateRow}
                    />
                );
            })}
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
    onCreateRow,
}: {
    field: DatabaseGridViewFieldWithEditing;
    value: unknown;
    rowId: DatabaseRowId;
    isFirstRow: boolean;
    isSelected: boolean;
    isEditing: boolean;
    initialEditValue: string | null;
    dispatch: Dispatch<SelectionAction>;
    moveSelection: (deltaRow: number, deltaField: number) => void;
    onCreateRow: () => void;
}) {
    const conn = useDatabaseConnection();
    const [committedValue, setCommittedValue] = useOptimistic(value == null ? "" : String(value));

    const commitValue = useEvent((newValue: string) => {
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
                    onCreateRow={onCreateRow}
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
                    ...field.columnStyle,
                    marginTop: isFirstRow ? undefined : -1,
                    marginBottom: -1,
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
    onCreateRow,
}: {
    ref?: React.Ref<HTMLElement>;
    initialValue: string;
    commitValue: (value: string) => void;
    dispatch: Dispatch<SelectionAction>;
    moveSelection: (deltaRow: number, deltaField: number) => void;
    onCreateRow: () => void;
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
                })}
                onBlur={() => {
                    commitValue(editValue);
                    dispatch({type: "blur"});
                }}
                onKeyDown={e => {
                    if (e.key === "Enter" && e.shiftKey) {
                        e.preventDefault();
                        commitValue((e.currentTarget as HTMLTextAreaElement).value);
                        onCreateRow();
                    } else if (e.key === "Enter") {
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

// -- Add-row button -----------------------------------------------------------

function DatabaseGridViewAddRowButton({onCreateRow}: {onCreateRow: () => void}) {
    return (
        <Box
            display="flex"
            alignItems="center"
            borderTop="grey-5"
            cursor="pointer"
            onClick={onCreateRow}
        >
            <Box
                display="flex"
                alignItems="center"
                gap="1"
                padding="2"
                fontSize="75"
                color="grey-50"
            >
                <Plus size={14} />
                New row
            </Box>
        </Box>
    );
}
