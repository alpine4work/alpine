import {useHover} from "@react-aria/interactions";
import {type Icon as PhosphorIcon, Plus} from "phosphor-react";
import {
    type Dispatch,
    type Memo,
    type Ref,
    forwardRef,
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
import {DatabaseFieldVisibilityMenu} from "~/client/web/databases/database_field_visibility_menu.js";
import type {DatabaseQuery} from "~/client/web/databases/database_query.js";
import type {DatabaseQueryRow} from "~/client/web/databases/database_query_row.js";
import {
    databaseFieldComponentProviders,
    getDatabaseFieldComponentProvider,
} from "~/client/web/databases/fields/database_field_component_providers.js";
import {
    DatabaseRelationFieldCreationOptions,
    DatabaseRelationFieldCreationOptionsInitialDataProvider,
} from "~/client/web/databases/fields/database_relation_field_creation_options.js";
import {
    type DatabaseGridViewField,
    type DatabaseGridViewFieldEditing,
    type DatabaseGridViewFieldWithEditing,
    useGridViewFields,
} from "~/client/web/databases/use_grid_view_fields.js";
import {Box} from "~/client/web/design/box.js";
import {IconButton} from "~/client/web/design/icon_button.js";
import {MenuButton} from "~/client/web/design/menu_button.js";
import {Overlay} from "~/client/web/design/overlay.js";
import {OverlayTriggerButton} from "~/client/web/design/overlay_trigger_button.js";
import {TextInputWithoutLabel} from "~/client/web/design/text_input.js";
import {GlobalKeyDownEvent} from "~/client/web/helpers/global_key_down_event.js";
import {useEvent} from "~/client/web/helpers/lifecycle/use_event.js";
import {useMergedRefs} from "~/client/web/helpers/refs/use_merged_refs.js";
import {useStore} from "~/client/web/helpers/use_store.js";
import {sprinkles} from "~/client/web/styles/styles.js";
import {
    VirtualizedScrollView,
    VirtualizedScrollViewItem,
    type VirtualizedScrollViewRef,
} from "~/client/web/virtualized/virtualized_scroll_view.js";
import type {LoaderDatabaseActionResult} from "~/shared/databases/database_protocol_schemas.js";
import type {
    DatabaseCellValue,
    DatabaseFieldConfig,
    DatabaseFieldType,
} from "~/shared/databases/fields/database_field_providers.js";
import type {Spacing} from "~/shared/design/core/spacing.js";
import {spacing} from "~/shared/design/core/spacing.js";
import {remPxBySpacingScale} from "~/shared/design/core/spacing_scale.js";
import type {OrderKey} from "~/shared/helpers/sort/order_key.js";
import {generateChronologicalId} from "~/shared/id/chronological_id.js";
import type {
    DatabaseFieldId,
    DatabaseRowId,
    DatabaseTableId,
    DatabaseViewId,
} from "~/shared/id/types/id_types.js";
import {maxLabelStringLength} from "~/shared/schema/helpers/label_string_schema.js";
import type {SchemaSerializedValue} from "~/shared/schema/schema.js";

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
 * Renders database rows in an editable virtualized grid with a sticky header. Uses
 * view field metadata for column names, widths, and field IDs for cell editing.
 */
export function DatabaseGridView({
    tableId,
    viewId,
    fields,
    query,
    tablesInitialData,
}: {
    tableId: DatabaseTableId;
    viewId: DatabaseViewId;
    fields: ReadonlyArray<DatabaseGridViewField>;
    query: DatabaseQuery;
    tablesInitialData: LoaderDatabaseActionResult<"listTables"> | null;
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
                                                  pointerEvents: "none",
                                              }
                                    }
                                >
                                    <Box
                                        ref={ref}
                                        zIndex="30"
                                        style={{
                                            // 1px taller than `gridRowHeight` so the header item's measured size includes the
                                            // sibling border line below — that way row 1 starts after the border, mirroring
                                            // how inter-row borders live inside each row's measured height.
                                            minHeight: `calc(${spacing[gridRowHeight]} + 1px)`,
                                            position: shouldRenderWithRelativePositioning
                                                ? "relative"
                                                : "sticky",
                                            top: shouldRenderWithRelativePositioning
                                                ? undefined
                                                : 0,
                                            pointerEvents: "auto",
                                        }}
                                    >
                                        <DatabaseGridViewHeaderRow
                                            tableId={tableId}
                                            fields={gridFields.fields}
                                            hiddenFields={gridFields.hiddenFields}
                                            onStartAddingField={gridFields.startAddingField}
                                            startResizingField={gridFields.startResizingField}
                                            resizingState={gridFields.resizingState}
                                            onRenameField={gridFields.renameField}
                                            onUpdateFieldVisibility={
                                                gridFields.updateFieldVisibility
                                            }
                                            onUpdateFieldConfig={gridFields.updateFieldConfig}
                                        />
                                    </Box>
                                    <Box
                                        zIndex="10"
                                        borderTop="grey-5-translucent"
                                        pointerEvents="none"
                                        style={{
                                            position: shouldRenderWithRelativePositioning
                                                ? "relative"
                                                : "sticky",
                                            top: shouldRenderWithRelativePositioning
                                                ? undefined
                                                : spacing[gridRowHeight],
                                            // Pull the border up 1px so its natural flow position lands inside the header's
                                            // transparent bottom gap (avoiding a 1px jump when scrolling crosses the sticky
                                            // threshold).
                                            marginTop: -1,
                                        }}
                                    />
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
                                        zIndex="10"
                                        borderTop="grey-5"
                                        pointerEvents="none"
                                        style={{
                                            position: "sticky",
                                            bottom: spacing[gridRowHeight],
                                        }}
                                    />
                                    <Box
                                        ref={ref}
                                        minHeight={gridRowHeight}
                                        backgroundColor="grey-0"
                                        zIndex="30"
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
                            tableId={tableId}
                            fields={gridFields.fields}
                            row={row}
                            rowId={rowId}
                            isLastRow={index === rowCount}
                            selection={visibleSelection}
                            dispatch={dispatch}
                            moveSelection={moveSelection}
                            onCreateRow={createRow}
                        />
                    ),
                };
            },
        [
            tableId,
            gridFields.fields,
            gridFields.hiddenFields,
            gridFields.startAddingField,
            gridFields.startResizingField,
            gridFields.resizingState,
            gridFields.renameField,
            gridFields.updateFieldVisibility,
            gridFields.updateFieldConfig,
            tree,
            rowCount,
            needsMore,
            query,
            visibleSelection,
            moveSelection,
            createRow,
        ],
    );

    return (
        <DatabaseRelationFieldCreationOptionsInitialDataProvider initialData={tablesInitialData}>
            <GlobalKeyDownEvent onGlobalKeyDown={handleGlobalKeyDown}>
                <Box
                    flexGrow="1"
                    overflowY="hidden"
                    onFocus={() => dispatch({type: "focus"})}
                    onBlur={e => {
                        // Only deactivate if focus moved outside the grid entirely (not between children).
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
                        alwaysRenderAdditionalItemIndexes={alwaysRenderIndexes}
                        scrollbarInsetTopItemIndex={0}
                        scrollbarInsetBottomItemIndex={addRowIndex}
                        contentMinWidth={gridFields.contentMinWidth}
                        extraChildren={
                            <DatabaseGridViewSelectionOverlay
                                selection={visibleSelection}
                                fields={gridFields.fields}
                                fieldIndexById={gridFields.fieldIndexById}
                                rowCount={rowCount}
                                scrollViewRef={scrollViewRef}
                            />
                        }
                    />
                </Box>
            </GlobalKeyDownEvent>
        </DatabaseRelationFieldCreationOptionsInitialDataProvider>
    );
}

// -- Selection overlay --------------------------------------------------------

/**
 * Renders a floating border around the selected cell(s) using scroll-content
 * coordinates so it scrolls with rows and is occluded by the sticky header.
 */
function DatabaseGridViewSelectionOverlay({
    selection,
    fields,
    fieldIndexById,
    rowCount,
    scrollViewRef,
}: {
    selection: DatabaseGridViewSelection;
    fields: ReadonlyArray<DatabaseGridViewFieldWithEditing>;
    fieldIndexById: ReadonlyMap<DatabaseFieldId, number>;
    rowCount: number;
    scrollViewRef: React.RefObject<VirtualizedScrollViewRef | null>;
}) {
    // Cumulative left offset of each visible column. Stored as rem at the small
    // spacing scale so the value scales with the active scale, the same way each
    // column's CSS width does. Accounts for the `marginRight: -1` overlap between
    // adjacent cells.
    const columnLeftRems = useMemo(() => {
        const lefts: Array<number> = [];
        let left = 0;
        for (const field of fields) {
            lefts.push(left);
            left += field.width - 1;
        }
        return lefts.map(px => px / remPxBySpacingScale.small);
    }, [fields]);

    if (selection == null || selection.isEditing) return null;
    const rowPosition = scrollViewRef.current?.getPositionByKeyIfExists(selection.rowId);
    if (rowPosition == null) return null;
    const fieldIndex = fieldIndexById.get(selection.fieldId);
    if (fieldIndex == null) return null;
    const field = fields[fieldIndex];
    const leftRem = columnLeftRems[fieldIndex];
    if (field == null || leftRem == null) return null;
    // The last data row is shorter by 1px (it has no `borderBottom` slot since the
    // footer renders its own sticky separator). Extend the selection by an extra pixel
    // below so its bottom edge lands on the sticky footer border instead of stopping
    // 1px above it.
    const isLast = scrollViewRef.current?.getIndexByKeyIfExists(selection.rowId) === rowCount;
    const heightExtension = isLast ? 2 : 1;
    return (
        <Box
            position="absolute"
            border="theme-40-const"
            pointerEvents="none"
            zIndex="20"
            style={{
                top: rowPosition.offset - 1,
                height: rowPosition.height + heightExtension,
                left: `${leftRem}rem`,
                width: `${field.width / remPxBySpacingScale.small}rem`,
            }}
        />
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
    tableId,
    fields,
    hiddenFields,
    onStartAddingField,
    startResizingField,
    resizingState,
    onRenameField,
    onUpdateFieldVisibility,
    onUpdateFieldConfig,
}: {
    tableId: DatabaseTableId;
    fields: ReadonlyArray<DatabaseGridViewFieldWithEditing>;
    hiddenFields: ReadonlyArray<DatabaseGridViewField>;
    onStartAddingField: () => void;
    startResizingField: (
        fieldId: DatabaseFieldId,
        event: React.PointerEvent,
    ) => {
        onMove: (event: PointerEvent) => void;
        onRelease: (event: PointerEvent) => void;
        onCancel: () => void;
    };
    resizingState: {readonly fieldId: DatabaseFieldId} | null;
    onRenameField: (fieldId: DatabaseFieldId, name: string) => void;
    onUpdateFieldVisibility: (
        fieldId: DatabaseFieldId,
        position: OrderKey,
        isHidden: boolean,
    ) => void;
    onUpdateFieldConfig: (fieldId: DatabaseFieldId, config: DatabaseFieldConfig) => void;
}) {
    return (
        <Box display="flex" height={gridRowHeight}>
            {fields.map(field => (
                <DatabaseGridViewHeaderCell
                    key={field.id}
                    tableId={tableId}
                    field={field}
                    startResizingField={startResizingField}
                    isResizingThisField={resizingState?.fieldId === field.id}
                    onRenameField={onRenameField}
                    onUpdateFieldConfig={onUpdateFieldConfig}
                />
            ))}
            <Box
                display="flex"
                alignItems="center"
                flexShrink="0"
                backgroundColor="grey-0"
                paddingX="1"
                gap="0.5"
            >
                <IconButton
                    description="Add field"
                    size="sm"
                    variant="quiet-above-grey-5-background"
                    onPress={onStartAddingField}
                >
                    <Plus />
                </IconButton>
                <DatabaseFieldVisibilityMenu
                    shownFields={fields}
                    hiddenFields={hiddenFields}
                    onUpdateFieldVisibility={onUpdateFieldVisibility}
                />
            </Box>
            <Box backgroundColor="grey-0" flexGrow="1" />
        </Box>
    );
}

function DatabaseGridViewHeaderCell({
    tableId,
    field,
    startResizingField,
    isResizingThisField,
    onRenameField,
    onUpdateFieldConfig,
}: {
    tableId: DatabaseTableId;
    field: DatabaseGridViewFieldWithEditing;
    startResizingField: (
        fieldId: DatabaseFieldId,
        event: React.PointerEvent,
    ) => {
        onMove: (event: PointerEvent) => void;
        onRelease: (event: PointerEvent) => void;
        onCancel: () => void;
    };
    isResizingThisField: boolean;
    onRenameField: (fieldId: DatabaseFieldId, name: string) => void;
    onUpdateFieldConfig: (fieldId: DatabaseFieldId, config: DatabaseFieldConfig) => void;
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
        <Box backgroundColor="grey-0" position="relative" style={field.columnStyle}>
            {editing ? (
                <Overlay
                    isVisible={true}
                    placement="bottom-start"
                    fallbackPlacements={["bottom-end"]}
                    preventOverflow={false}
                    overlay={
                        <DatabaseGridViewFieldTypePicker
                            tableId={tableId}
                            editing={editing}
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
                <DatabaseGridViewHeaderEditor
                    field={field}
                    onRenameField={onRenameField}
                    onUpdateFieldConfig={onUpdateFieldConfig}
                />
            )}
            <DatabaseGridViewResizeHandle
                fieldId={field.id}
                startResizingField={startResizingField}
                isResizingThisField={isResizingThisField}
            />
        </Box>
    );
}

// -- Field header editor (rename + config menu) ------------------------------

function DatabaseGridViewHeaderEditor({
    field,
    onRenameField,
    onUpdateFieldConfig,
}: {
    field: DatabaseGridViewFieldWithEditing;
    onRenameField: (fieldId: DatabaseFieldId, name: string) => void;
    onUpdateFieldConfig: (fieldId: DatabaseFieldId, config: DatabaseFieldConfig) => void;
}) {
    const provider = getDatabaseFieldComponentProvider(field.config.type);
    const Icon = provider.Icon;
    const inputRef = useRef<HTMLInputElement>(null);
    const [draftName, setDraftName] = useState(field.name);

    useEffect(() => {
        setDraftName(field.name);
    }, [field.name]);

    const commitRename = useEvent(() => {
        const trimmed = (inputRef.current?.value ?? draftName).trim();
        if (trimmed === "" || trimmed === field.name) return;
        onRenameField(field.id, trimmed);
    });

    const configActions =
        provider.getConfigMenuActions?.({
            config: field.config,
            onCommit: config => onUpdateFieldConfig(field.id, config),
        }) ?? [];

    const renameInput = (
        <DatabaseGridViewHeaderRenameInput
            inputRef={inputRef}
            value={draftName}
            onChange={setDraftName}
            onEnter={commitRename}
            onEscape={() => setDraftName(field.name)}
            paddingBottom={configActions.length > 0 ? "1" : "1.5"}
        />
    );

    const trigger = (
        <Box
            role="button"
            tabIndex={0}
            cursor="pointer"
            display="flex"
            alignItems="center"
            color="grey-80"
            fontSize="75"
            fontStyle="truncate-semi-bold"
            padding="2"
            textAlign="left"
            gap="1"
            style={{userSelect: "none"}}
        >
            <Box color="grey-50" display="flex" alignItems="center">
                <Icon size={14} />
            </Box>
            <Box fontStyle="truncate-semi-bold">{field.name}</Box>
        </Box>
    );

    if (configActions.length === 0) {
        return (
            <OverlayTriggerButton
                withoutButtonElementRequirement
                placement="bottom-start"
                aria-haspopup="dialog"
                onClose={commitRename}
                overlay={<DatabaseGridViewHeaderEditorRenameOverlay renameInput={renameInput} />}
            >
                {trigger}
            </OverlayTriggerButton>
        );
    }

    return (
        <MenuButton
            withoutButtonElementRequirement
            placement="bottom-start"
            actions={configActions}
            onClose={commitRename}
            extraOverlayTop={renameInput}
        >
            {trigger}
        </MenuButton>
    );
}

const DatabaseGridViewHeaderEditorRenameOverlay = forwardRef(
    function DatabaseGridViewHeaderEditorRenameOverlay(
        {renameInput}: {renameInput: React.ReactNode},
        ref: Ref<HTMLDivElement>,
    ) {
        return (
            <Box
                ref={ref}
                backgroundColor="grey-0"
                borderRadius="1.5"
                boxShadow="elevation-20"
                style={{minWidth: 200}}
            >
                {renameInput}
            </Box>
        );
    },
);

function DatabaseGridViewHeaderRenameInput({
    inputRef,
    value,
    onChange,
    onEnter,
    onEscape,
    paddingBottom,
}: {
    inputRef: Ref<HTMLInputElement>;
    value: string;
    onChange: (value: string) => void;
    onEnter: () => void;
    onEscape: () => void;
    paddingBottom: "1" | "1.5";
}) {
    const internalRef = useRef<HTMLInputElement>(null);
    const mergedRef = useMergedRefs(inputRef, internalRef);

    useEffect(() => {
        const input = internalRef.current;
        if (input) {
            input.focus();
            input.select();
        }
    }, []);

    return (
        <Box paddingX="1.5" paddingTop="1.5" paddingBottom={paddingBottom}>
            <TextInputWithoutLabel
                ref={mergedRef}
                aria-label="Field name"
                value={value}
                maxLength={maxLabelStringLength}
                onChange={onChange}
                onEnter={onEnter}
                onEscape={onEscape}
            />
        </Box>
    );
}

// -- Field type picker --------------------------------------------------------

function DatabaseGridViewFieldTypePicker({
    ref,
    tableId,
    editing,
    onSelect,
}: {
    ref?: React.Ref<HTMLElement>;
    tableId: DatabaseTableId;
    editing: DatabaseGridViewFieldEditing;
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
                    Icon={provider.Icon}
                    isSelected={provider.type === editing.fieldType}
                    onSelect={type => {
                        if (type === "relation") {
                            editing.updateType(type);
                        } else {
                            onSelect(type);
                        }
                    }}
                />
            ))}
            {editing.fieldType === "relation" ? (
                <DatabaseRelationFieldCreationOptions tableId={tableId} editing={editing} />
            ) : null}
        </Box>
    );
}

function DatabaseGridViewFieldTypePickerOption({
    type,
    label,
    Icon,
    isSelected,
    onSelect,
}: {
    type: DatabaseFieldType;
    label: string;
    Icon: PhosphorIcon;
    isSelected: boolean;
    onSelect: (type: DatabaseFieldType) => void;
}) {
    const {hoverProps, isHovered} = useHover({});
    return (
        <Box
            {...hoverProps}
            display="flex"
            alignItems="center"
            gap="1.5"
            padding="1.5"
            borderRadius="1"
            fontSize="75"
            color="grey-100"
            cursor="pointer"
            backgroundColor={isSelected ? "theme-10" : isHovered ? "grey-5" : undefined}
            onMouseDown={e => {
                e.preventDefault();
                onSelect(type);
            }}
        >
            <Icon size={14} />
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
    tableId,
    fields,
    row,
    rowId,
    isLastRow,
    selection,
    dispatch,
    moveSelection,
    onCreateRow,
}: {
    tableId: DatabaseTableId;
    fields: ReadonlyArray<DatabaseGridViewFieldWithEditing>;
    row: DatabaseQueryRow;
    rowId: DatabaseRowId;
    isLastRow: boolean;
    selection: DatabaseGridViewSelection;
    dispatch: Dispatch<SelectionAction>;
    moveSelection: (deltaRow: number, deltaField: number) => void;
    onCreateRow: () => void;
}) {
    return (
        <Box
            display="flex"
            style={{
                height: isLastRow
                    ? spacing[gridRowHeight]
                    : `calc(${spacing[gridRowHeight]} + 1px)`,
            }}
            borderBottom={isLastRow ? "transparent" : "grey-5"}
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
                        tableId={tableId}
                        field={field}
                        value={row.getCellValue(field.id)}
                        rowId={rowId}
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
    tableId,
    field,
    value,
    rowId,
    isSelected,
    isEditing,
    initialEditValue,
    dispatch,
    moveSelection,
    onCreateRow,
}: {
    tableId: DatabaseTableId;
    field: DatabaseGridViewFieldWithEditing;
    value: unknown;
    rowId: DatabaseRowId;
    isSelected: boolean;
    isEditing: boolean;
    initialEditValue: string | null;
    dispatch: Dispatch<SelectionAction>;
    moveSelection: (deltaRow: number, deltaField: number) => void;
    onCreateRow: () => void;
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
                tableId,
                fieldId: field.id,
                rowId,
                value: newValue as SchemaSerializedValue,
            });
        });
    });

    const editorOverlay = EditorOverlay ? (
        <EditorOverlay
            tableId={tableId}
            fieldId={field.id}
            rowId={rowId}
            config={field.config}
            initialValue={optimisticValue as DatabaseCellValue}
            initialEditString={initialEditValue}
            commitValue={commitValue}
            onClose={() => dispatch({type: "blur"})}
            moveSelection={moveSelection}
            onCreateRow={onCreateRow}
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
                data-testid="DatabaseGridViewCell"
                data-field-name={field.name}
                border="transparent"
                style={{
                    ...field.columnStyle,
                    marginTop: -1,
                    marginBottom: -1,
                }}
                onFocus={() => dispatch({type: "select", rowId, fieldId: field.id})}
            >
                <provider.GridViewCellContent
                    ref={cellRef}
                    fieldName={field.name}
                    config={field.config}
                    value={optimisticValue as DatabaseCellValue}
                    commitValue={commitValue}
                    onCellClick={() => dispatch({type: "click", rowId, fieldId: field.id})}
                />
            </Box>
        </Overlay>
    );
}

// -- Add-row button -----------------------------------------------------------

function DatabaseGridViewAddRowButton({onCreateRow}: {onCreateRow: () => void}) {
    return (
        <Box display="flex" alignItems="center" cursor="pointer" onClick={onCreateRow}>
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
