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
import {createAccessPolicyStoreFromReferences} from "~/client/web/access/create_access_policy_store.js";
import {useAppContext} from "~/client/web/context/app_context.js";
import {useDatabaseConnection} from "~/client/web/databases/database_connection_context.js";
import type {DatabaseQuery} from "~/client/web/databases/database_query.js";
import type {DatabaseQueryRow} from "~/client/web/databases/database_query_row.js";
import {DatabaseGridViewCellContent} from "~/client/web/databases/fields/database_grid_view_cell_content.js";
import {DatabaseGridViewCellEditorOverlay} from "~/client/web/databases/fields/database_grid_view_cell_editor_overlay.js";
import {hasDatabaseGridViewCellEditorOverlay} from "~/client/web/databases/fields/has_database_grid_view_cell_editor_overlay.js";
import {gridRowHeight} from "~/client/web/databases/grid_view/database_grid_view_constants.js";
import {DatabaseGridViewHeaderRow} from "~/client/web/databases/grid_view/database_grid_view_header_row.js";
import {
    type DatabaseGridViewColumn,
    type DatabaseGridViewField,
    useGridViewFields,
} from "~/client/web/databases/use_grid_view_fields.js";
import {Box} from "~/client/web/design/box.js";
import {Overlay} from "~/client/web/design/overlay.js";
import {GlobalKeyDownEvent} from "~/client/web/helpers/global_key_down_event.js";
import {useEvent} from "~/client/web/helpers/lifecycle/use_event.js";
import {useStore} from "~/client/web/helpers/use_store.js";
import {writeTextToClipboard} from "~/client/web/helpers/write_text_to_clipboard.js";
import {ShareButton} from "~/client/web/navigation/share_button.js";
import {useSiteContextIfExists} from "~/client/web/sites/context/site_context.js";
import {useSiteRegistry} from "~/client/web/sites/context/site_registry_context.js";
import {applySiteAccessPolicyChange} from "~/client/web/sites/helpers/apply_site_access_policy_change.js";
import {
    VirtualizedScrollView,
    VirtualizedScrollViewItem,
    type VirtualizedScrollViewRef,
} from "~/client/web/virtualized/virtualized_scroll_view.js";
import type {AccessPolicy} from "~/shared/access/access_policy.js";
import {DatabaseTableMetadataModel} from "~/shared/databases/database_table_metadata_model.js";
import type {DatabaseFieldValue} from "~/shared/databases/fields/database_field_value.js";
import {spacing} from "~/shared/design/core/spacing.js";
import {remPxBySpacingScale} from "~/shared/design/core/spacing_scale.open_source.js";
import type {RynamoEvent} from "~/shared/dynamo/rynamo_types.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.open_source.js";
import {generateChronologicalId} from "~/shared/id/chronological_id.open_source.js";
import type {
    DatabaseFieldId,
    DatabaseRowId,
    DatabaseTableId,
    DatabaseViewId,
    SiteId,
} from "~/shared/id/types/id_types.open_source.js";
import {updateDatabaseTableAccessPolicy} from "~/shared/rpc/database_tables_rpc_definitions.js";
import type {SchemaSerializedValue} from "~/shared/schema/schema.open_source.js";
import {SitePreviewModel} from "~/shared/sites/site_model.js";

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
    tableName,
    initialAccessPolicy,
    accessPolicySiteById,
    onTableMetadataEvents,
    fields,
    query,
}: {
    tableId: DatabaseTableId;
    viewId: DatabaseViewId;
    tableName: string;
    initialAccessPolicy: AccessPolicy;
    accessPolicySiteById: ReadonlyMap<SiteId, SitePreviewModel>;
    onTableMetadataEvents: (events: ReadonlyArray<RynamoEvent<DatabaseTableMetadataModel>>) => void;
    fields: ReadonlyArray<DatabaseGridViewField>;
    query: DatabaseQuery;
}) {
    const context = useAppContext();
    const siteRegistry = useSiteRegistry();
    const siteContext = useSiteContextIfExists();
    const [accessPolicyState, setAccessPolicyState] = useState({
        accessPolicy: initialAccessPolicy,
        initialAccessPolicy,
    });
    if (accessPolicyState.initialAccessPolicy !== initialAccessPolicy) {
        setAccessPolicyState({
            accessPolicy: initialAccessPolicy,
            initialAccessPolicy,
        });
    }
    const accessPolicy = accessPolicyState.accessPolicy;
    const resolvedAccessPolicy = useStore(
        useMemo(
            () =>
                createAccessPolicyStoreFromReferences(
                    accessPolicy,
                    accessPolicySiteById,
                    siteRegistry,
                ),
            [accessPolicy, accessPolicySiteById, siteRegistry],
        ),
    );
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
        const nextField = assertExists(gridFields.fields[nextFieldIndex]);
        dispatch({
            type: "select",
            rowId: nextRow.getId(),
            fieldId: nextField.id,
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
                                            fields={gridFields.fields}
                                            hiddenFields={gridFields.hiddenFields}
                                            addingFieldId={gridFields.addingFieldId}
                                            onStartAddingField={gridFields.startAddingField}
                                            onCommitAddingField={gridFields.commitAddingField}
                                            onCancelAddingField={gridFields.cancelAddingField}
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
            gridFields.addingFieldId,
            gridFields.startAddingField,
            gridFields.commitAddingField,
            gridFields.cancelAddingField,
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
        <GlobalKeyDownEvent onGlobalKeyDown={handleGlobalKeyDown}>
            <Box
                flexGrow="1"
                minHeight="0"
                overflowY="hidden"
                display="flex"
                flexDirection="column"
                gap="2"
                onFocus={() => dispatch({type: "focus"})}
                onBlur={e => {
                    // Only deactivate if focus moved outside the grid entirely (not between children).
                    if (!e.currentTarget.contains(e.relatedTarget)) {
                        dispatch({type: "focusout"});
                    }
                }}
            >
                <Box display="flex" alignItems="center" justifyContent="space-between" gap="3">
                    <Box
                        as="h1"
                        margin="0"
                        fontSize="200"
                        fontStyle="truncate-semi-bold"
                        color="grey-100"
                        overflow="hidden"
                    >
                        {tableName}
                    </Box>
                    <Box flexShrink="0">
                        <ShareButton
                            entityNoun="database table"
                            accessPolicy={resolvedAccessPolicy}
                            onAccessPolicyChange={async (_notification, accessPolicy) => {
                                if (accessPolicy.type === "Site") {
                                    await applySiteAccessPolicyChange({
                                        context,
                                        accessPolicy,
                                        handleEventForSite:
                                            assertExists(siteContext).handleEventForSite,
                                    });
                                    return;
                                }

                                const result = await updateDatabaseTableAccessPolicy(context, {
                                    tableId,
                                    accessPolicy,
                                });
                                onTableMetadataEvents(result.events);
                            }}
                            onCopyLink={async () => {
                                const url = new URL(`/database/${tableId}`, window.location.href);
                                await writeTextToClipboard(url.toString());
                            }}
                        />
                    </Box>
                </Box>
                <Box flexGrow="1" minHeight="0" overflowY="hidden">
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
            </Box>
        </GlobalKeyDownEvent>
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
    fields: ReadonlyArray<DatabaseGridViewColumn>;
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
    fields: ReadonlyArray<DatabaseGridViewColumn>;
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
                const selected = isSelected ? selection : null;
                const isEditing = selected?.isEditing ?? false;
                const initialEditValue = selected?.initialEditValue ?? null;

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
    field: DatabaseGridViewColumn;
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
    const hasEditorOverlay = hasDatabaseGridViewCellEditorOverlay(field.config.type);
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

    const editorOverlay = hasEditorOverlay ? (
        <DatabaseGridViewCellEditorOverlay
            tableId={tableId}
            field={field}
            rowId={rowId}
            initialValue={optimisticValue as DatabaseFieldValue}
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
            isVisible={isEditing && hasEditorOverlay}
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
                <DatabaseGridViewCellContent
                    ref={cellRef}
                    field={field}
                    value={optimisticValue as DatabaseFieldValue}
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
