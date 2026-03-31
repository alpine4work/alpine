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
import {
    databaseFieldComponentProviders,
    getDatabaseFieldComponentProvider,
} from "~/client/web/databases/fields/database_field_component_providers.js";
import {
    type DatabaseGridViewField,
    type DatabaseGridViewFieldWithEditing,
    useGridViewFields,
} from "~/client/web/databases/use_grid_view_fields.js";
import {Box} from "~/client/web/design/box.js";
import {IconButton} from "~/client/web/design/icon_button.js";
import {Overlay} from "~/client/web/design/overlay.js";
import {GlobalKeyDownEvent} from "~/client/web/helpers/global_key_down_event.js";
import {useEvent} from "~/client/web/helpers/lifecycle/use_event.js";
import {useStore} from "~/client/web/helpers/use_store.js";
import {sprinkles} from "~/client/web/styles/styles.js";
import {
    VirtualizedScrollView,
    VirtualizedScrollViewItem,
    type VirtualizedScrollViewRef,
} from "~/client/web/virtualized/virtualized_scroll_view.js";
import type {
    DatabaseCellValue,
    DatabaseFieldType,
} from "~/shared/databases/fields/database_field_providers.js";
import type {Spacing} from "~/shared/design/core/spacing.js";
import {spacing} from "~/shared/design/core/spacing.js";
import {assert} from "~/shared/helpers/control/assert.js";
import type {
    DatabaseFieldId,
    DatabaseRowId,
    DatabaseTableId,
    DatabaseViewId,
} from "~/shared/id/types/id_types.js";
import {maxLabelStringLength} from "~/shared/schema/helpers/label_string_schema.js";
import type {SchemaSerializedValue} from "~/shared/schema/schema.js";

const alwaysRenderHeader: ReadonlyArray<number> = [0];
const gridRowHeight: Spacing = "8"; // 2rem = 32px at desktop scale

// -- Selection state ----------------------------------------------------------

type DatabaseGridViewSelection = {
    rowId: DatabaseRowId;
    fieldId: DatabaseFieldId;
    isActive: boolean;
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
    | {type: "deselect"}
    | {type: "focus"}
    | {type: "focusout"};

function selectionReducer(
    state: DatabaseGridViewSelection,
    action: SelectionAction,
): DatabaseGridViewSelection {
    switch (action.type) {
        case "click":
            return {
                rowId: action.rowId,
                fieldId: action.fieldId,
                isActive: true,
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
                isActive: true,
                isEditing: false,
                initialEditValue: null,
            };
        case "deselect":
            return null;
        case "focus":
            if (state == null) return null;
            return {...state, isActive: true};
        case "focusout":
            if (state == null) return null;
            return {...state, isActive: false};
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

    const rowCount = tree.getItemCount();

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

        if (nextRowIndex === rowIndex && nextFieldIndex === fieldIndex) return;

        const nextRow = tree.getItem(nextRowIndex);
        dispatch({
            type: "select",
            rowId: nextRow._id as DatabaseRowId,
            fieldId: gridFields.fields[nextFieldIndex]!.id,
        });
    });

    const handleGlobalKeyDown = useEvent((e: KeyboardEvent) => {
        if (selection == null || !selection.isActive || selection.isEditing) return;

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

    const visibleSelection = selection?.isActive ? selection : null;

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

                // Load-more sentinel at the end.
                if (needsMore && index === rowCount + 1) {
                    return {
                        key: "load-more",
                        minHeight: spacing[gridRowHeight],
                        node: <DatabaseGridViewLoadMoreSentinel query={query} />,
                    };
                }

                const row = tree.getItem(index - 1);
                assert(typeof row._id === "string", "expected row to have a string _id");
                const rowId = row._id as DatabaseRowId;
                return {
                    key: rowId,
                    minHeight: spacing[gridRowHeight],
                    node: (
                        <DatabaseGridViewDataRow
                            fields={gridFields.fields}
                            row={row}
                            rowId={rowId}
                            isFirstRow={index === 1}
                            selection={visibleSelection}
                            dispatch={dispatch}
                            moveSelection={moveSelection}
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
            visibleSelection,
            moveSelection,
        ],
    );

    return (
        <GlobalKeyDownEvent onGlobalKeyDown={handleGlobalKeyDown}>
            <Box
                flexGrow="1"
                overflow="hidden"
                onFocus={() => dispatch({type: "focus"})}
                onBlur={e => {
                    // Only deactivate if focus moved outside
                    // the grid entirely (not between children).
                    if (!e.currentTarget.contains(e.relatedTarget)) {
                        dispatch({type: "focusout"});
                    }
                }}
            >
                <VirtualizedScrollView
                    ref={scrollViewRef}
                    itemCount={itemCount}
                    bufferedItemHeight={spacing[gridRowHeight]}
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
    const isAdding = field.columnName === "__pending__";

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
                <Overlay
                    isVisible={isAdding}
                    placement="bottom-start"
                    fallbackPlacements={["bottom-end"]}
                    preventOverflow={false}
                    overlay={
                        <DatabaseGridViewFieldTypePicker
                            onSelect={type => editing.commitWithType(type)}
                        />
                    }
                >
                    <input
                        ref={inputRef}
                        value={field.name}
                        maxLength={maxLabelStringLength}
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
                </Overlay>
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

// -- Field type picker --------------------------------------------------------

function DatabaseGridViewFieldTypePicker({
    ref,
    onSelect,
}: {
    ref?: React.Ref<HTMLElement>;
    onSelect: (type: DatabaseFieldType) => void;
}) {
    return (
        <Box
            ref={ref as React.Ref<HTMLDivElement>}
            backgroundColor="grey-0"
            borderRadius="1.5"
            boxShadow="elevation-20"
            padding="1"
            style={{minWidth: 120}}
        >
            {databaseFieldComponentProviders.map(provider => (
                <DatabaseGridViewFieldTypePickerOption
                    key={provider.type}
                    type={provider.type}
                    label={provider.label}
                    onSelect={onSelect}
                />
            ))}
        </Box>
    );
}

function DatabaseGridViewFieldTypePickerOption({
    type,
    label,
    onSelect,
}: {
    type: DatabaseFieldType;
    label: string;
    onSelect: (type: DatabaseFieldType) => void;
}) {
    const {hoverProps, isHovered} = useHover({});
    return (
        <Box
            {...hoverProps}
            padding="1.5"
            borderRadius="1"
            fontSize="75"
            color="grey-100"
            cursor="pointer"
            backgroundColor={isHovered ? "grey-5" : undefined}
            onMouseDown={e => {
                e.preventDefault();
                onSelect(type);
            }}
        >
            {label}
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
    selection,
    dispatch,
    moveSelection,
}: {
    fields: ReadonlyArray<DatabaseGridViewFieldWithEditing>;
    row: Record<string, unknown>;
    rowId: DatabaseRowId;
    isFirstRow: boolean;
    selection: DatabaseGridViewSelection;
    dispatch: Dispatch<SelectionAction>;
    moveSelection: (deltaRow: number, deltaField: number) => void;
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
                        key={field.id}
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
    field: DatabaseGridViewFieldWithEditing;
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
    const provider = getDatabaseFieldComponentProvider(field.config.type);
    const EditorOverlay = provider.GridViewCellEditorOverlay;
    const cellRef = useRef<HTMLDivElement>(null);
    const [optimisticValue, setOptimisticValue] = useOptimistic(value);

    useEffect(() => {
        if (isSelected && !isEditing) {
            cellRef.current?.focus();
        }
    }, [isSelected, isEditing]);

    const commitValue = useEvent((newValue: unknown) => {
        if (newValue === optimisticValue) return;
        startTransition(async () => {
            setOptimisticValue(newValue);
            await conn.executeAction("updateCellValue", {
                fieldId: field.id,
                rowId,
                value: newValue as SchemaSerializedValue,
            });
        });
    });

    const shouldShowBorder = isSelected && !isEditing;

    const editorOverlay = EditorOverlay ? (
        <EditorOverlay
            initialValue={initialEditValue ?? String(optimisticValue ?? "")}
            commitValue={commitValue}
            onClose={() => dispatch({type: "blur"})}
            moveSelection={moveSelection}
        />
    ) : (
        <></>
    );

    return (
        <Overlay
            isVisible={isEditing && EditorOverlay != null}
            placement="cover-top"
            fallbackPlacements={[]}
            preventOverflow={false}
            sameWidth
            overlay={editorOverlay}
        >
            <Box
                border={shouldShowBorder ? "theme-40-const" : "transparent"}
                style={{
                    ...field.columnStyle,
                    marginTop: isFirstRow ? undefined : -1,
                    marginBottom: -1,
                    ...(shouldShowBorder ? {zIndex: 1, position: "relative" as const} : undefined),
                }}
                onFocus={() => dispatch({type: "select", rowId, fieldId: field.id})}
            >
                <provider.GridViewCellContent
                    ref={cellRef}
                    value={optimisticValue as DatabaseCellValue}
                    commitValue={commitValue}
                    onCellClick={() => dispatch({type: "click", rowId, fieldId: field.id})}
                />
            </Box>
        </Overlay>
    );
}
