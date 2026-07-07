/* eslint-disable react-refresh/only-export-components -- provider pattern */

import {
    DndContext,
    DragOverlay,
    PointerSensor,
    closestCenter,
    useDndContext,
    useSensor,
    useSensors,
} from "@dnd-kit/core";
import {SortableContext, useSortable} from "@dnd-kit/sortable";
import {DotsSixVertical, LinkSimple, MagnifyingGlass, Plus, X, XCircle} from "phosphor-react";
import {startTransition, useEffect, useMemo, useRef, useState} from "react";
import {createPortal} from "react-dom";

import {useDatabaseConnection} from "~/client/web/databases/database_connection_context.js";
import {
    type DatabaseGridViewCellContentProps,
    type DatabaseGridViewCellEditorOverlayProps,
    defineDatabaseFieldComponentProvider,
} from "~/client/web/databases/fields/database_field_component_provider.js";
import {useReactiveDatabaseAction} from "~/client/web/databases/use_reactive_database_action.js";
import {Box} from "~/client/web/design/box.js";
import {IconButton} from "~/client/web/design/icon_button.js";
import {useReporter} from "~/client/web/design/reporter.js";
import {TextInputWithoutLabel} from "~/client/web/design/text_input.js";
import {useEvent} from "~/client/web/helpers/lifecycle/use_event.js";
import {sprinkles} from "~/client/web/styles/styles.js";
import {databaseRelationFieldProvider} from "~/shared/databases/fields/database_relation_field.js";
import {type OrderKey, generateOrderKeyBetween} from "~/shared/helpers/sort/order_key.js";
import {generateChronologicalId} from "~/shared/id/chronological_id.js";
import type {DatabaseRowId} from "~/shared/id/types/id_types.js";

function DatabaseRelationGridViewCellContent({
    ref,
    value,
    onCellClick,
}: DatabaseGridViewCellContentProps<"relation">) {
    const links = Array.isArray(value) ? value : [];
    return (
        <Box
            ref={ref as React.Ref<HTMLDivElement>}
            tabIndex={-1}
            height="full"
            display="flex"
            alignItems="center"
            gap="1"
            padding="1"
            overflow="hidden"
            onClick={onCellClick}
        >
            {links.slice(0, 3).map(link => (
                <DatabaseRelationChip key={link.id} name={link.name} />
            ))}
            {links.length > 3 ? (
                <Box fontSize="75" color="grey-50" flexShrink="0">
                    +{links.length - 3}
                </Box>
            ) : null}
        </Box>
    );
}

/** An ordered linked record, as returned by the `listLinkedRows` action. */
type DatabaseRelationLinkedRow = {
    id: DatabaseRowId;
    name: string | null;
    position: OrderKey;
};

function DatabaseRelationGridViewCellEditorOverlay({
    ref,
    tableId,
    fieldId,
    rowId,
    initialEditString,
    onClose,
}: DatabaseGridViewCellEditorOverlayProps<"relation">) {
    const conn = useDatabaseConnection();
    const reporter = useReporter();

    // Seed the search box if the editor was opened by typing a character.
    const [search, setSearch] = useState(initialEditString ?? "");
    const trimmedSearch = search.trim();
    const isSearching = trimmedSearch !== "";

    const searchInputRef = useRef<HTMLInputElement>(null);
    useEffect(() => {
        searchInputRef.current?.focus();
    }, []);

    // The currently-linked records, ordered by position. Reactive so add / remove /
    // reorder update the list live while the editor stays open.
    const linkedRowsResult = useReactiveDatabaseAction({
        name: "listLinkedRows",
        input: useMemo(() => ({tableId, fieldId, rowId}), [tableId, fieldId, rowId]),
    });

    // The candidate records to link, filtered by the search text. Also carries the
    // linked table's name for the picker header.
    const linkableRowsResult = useReactiveDatabaseAction({
        name: "listLinkableRows",
        input: useMemo(
            () => ({tableId, fieldId, rowId, search: isSearching ? trimmedSearch : undefined}),
            [tableId, fieldId, rowId, isSearching, trimmedSearch],
        ),
    });

    useEffect(() => {
        if (linkedRowsResult != null && !linkedRowsResult.ok) {
            reporter.logErrorWithoutDisplaying(
                "Could not load linked records",
                linkedRowsResult.error,
            );
        }
        if (linkableRowsResult != null && !linkableRowsResult.ok) {
            reporter.logErrorWithoutDisplaying(
                "Could not load linked record options",
                linkableRowsResult.error,
            );
        }
    }, [linkedRowsResult, linkableRowsResult, reporter]);

    const linkedRows: ReadonlyArray<DatabaseRelationLinkedRow> =
        linkedRowsResult?.ok ? linkedRowsResult.value.rows : [];
    const candidateRows = linkableRowsResult?.ok ? linkableRowsResult.value.rows : [];
    const linkedTableName = linkableRowsResult?.ok ? linkableRowsResult.value.linkedTableName : "";

    const addLink = useEvent((linkedRowId: DatabaseRowId) => {
        setSearch("");
        startTransition(async () => {
            await conn.executeAction("addLink", {tableId, fieldId, rowId, linkedRowId});
        });
    });

    const removeLink = useEvent((linkedRowId: DatabaseRowId) => {
        startTransition(async () => {
            await conn.executeAction("removeLink", {tableId, fieldId, rowId, linkedRowId});
        });
    });

    const moveLink = useEvent((linkedRowId: DatabaseRowId, position: OrderKey) => {
        startTransition(async () => {
            await conn.executeAction("moveLink", {tableId, fieldId, rowId, linkedRowId, position});
        });
    });

    const createAndLink = useEvent((name: string) => {
        setSearch("");
        const linkedRowId = generateChronologicalId<DatabaseRowId>();
        startTransition(async () => {
            await conn.executeAction("createAndLinkRow", {
                tableId,
                fieldId,
                rowId,
                linkedRowId,
                name,
            });
        });
    });

    return (
        <Box
            ref={ref as React.Ref<HTMLDivElement>}
            border="theme-40-const"
            backgroundColor="grey-0"
            boxShadow="elevation-20"
            display="flex"
            flexDirection="column"
            onKeyDown={event => {
                if (event.key === "Escape") {
                    event.preventDefault();
                    // Escape clears the search first, then closes the editor.
                    if (isSearching) {
                        setSearch("");
                    } else {
                        onClose();
                    }
                }
                event.stopPropagation();
            }}
            style={{minWidth: 280, maxWidth: 360}}
        >
            <Box
                display="flex"
                alignItems="center"
                gap="1.5"
                paddingX="2"
                borderBottom="grey-5"
                flexShrink="0"
                style={{height: 40}}
            >
                <Box color="grey-40" display="flex" alignItems="center" flexShrink="0">
                    <MagnifyingGlass size={16} />
                </Box>
                <Box flexGrow="1" style={{minWidth: 0}}>
                    <TextInputWithoutLabel
                        ref={searchInputRef}
                        aria-label="Search records"
                        value={search}
                        onChange={setSearch}
                        placeholder="Search…"
                        withoutBorder
                        fontSize="75"
                    />
                </Box>
                {isSearching ? (
                    <Box flexShrink="0">
                        <IconButton
                            description="Clear search"
                            size="xs"
                            variant="quiet"
                            onPress={() => setSearch("")}
                        >
                            <XCircle />
                        </IconButton>
                    </Box>
                ) : null}
                {linkedTableName !== "" ? (
                    <Box
                        fontSize="75"
                        fontStyle="truncate-semi-bold"
                        color="grey-70"
                        flexShrink="0"
                        style={{maxWidth: 140}}
                    >
                        {linkedTableName}
                    </Box>
                ) : null}
            </Box>

            <Box paddingY="1" style={{maxHeight: 320, overflowY: "auto"}}>
                {!isSearching && linkedRows.length > 0 ? (
                    <DatabaseRelationLinkedList
                        linkedRows={linkedRows}
                        onRemove={removeLink}
                        onReorder={moveLink}
                    />
                ) : null}

                {!isSearching && linkedRows.length > 0 && candidateRows.length > 0 ? (
                    <Box
                        fontSize="50"
                        fontStyle="semi-bold"
                        color="grey-50"
                        paddingX="2"
                        paddingTop="2"
                        paddingBottom="1"
                    >
                        Add more
                    </Box>
                ) : null}

                {candidateRows.map(row => (
                    <DatabaseRelationRowOption
                        key={row.id}
                        name={row.name}
                        onPress={() => addLink(row.id)}
                    />
                ))}

                {isSearching && candidateRows.length === 0 ? (
                    <Box padding="2" fontSize="75" color="grey-50">
                        No matching records
                    </Box>
                ) : null}
            </Box>

            {isSearching ? (
                <DatabaseRelationCreateRow
                    query={trimmedSearch}
                    onPress={() => createAndLink(trimmedSearch)}
                />
            ) : null}
        </Box>
    );
}

function DatabaseRelationLinkedList({
    linkedRows,
    onRemove,
    onReorder,
}: {
    linkedRows: ReadonlyArray<DatabaseRelationLinkedRow>;
    onRemove: (linkedRowId: DatabaseRowId) => void;
    onReorder: (linkedRowId: DatabaseRowId, position: OrderKey) => void;
}) {
    const ids = useMemo(() => linkedRows.map(row => row.id), [linkedRows]);

    const pointerSensor = useSensor(
        PointerSensor,
        useMemo(() => ({activationConstraint: {distance: 2}}), []),
    );
    const sensors = useSensors(pointerSensor);

    return (
        <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={event => {
                const {active, over} = event;
                if (!over || active.id === over.id) return;
                const position = computeReorderPosition(
                    active.id as DatabaseRowId,
                    over.id as DatabaseRowId,
                    linkedRows,
                );
                onReorder(active.id as DatabaseRowId, position);
            }}
        >
            <SortableContext items={ids}>
                <DatabaseRelationLinkedDragOverlay linkedRows={linkedRows} />
                {linkedRows.map(row => (
                    <DatabaseRelationLinkedRow
                        key={row.id}
                        row={row}
                        isDragOverlay={false}
                        onRemove={() => onRemove(row.id)}
                    />
                ))}
            </SortableContext>
        </DndContext>
    );
}

/**
 * Computes the order key for a linked record dropped onto another one. Uses the
 * list's current ordering to decide whether the record moved up or down.
 */
function computeReorderPosition(
    activeId: DatabaseRowId,
    overId: DatabaseRowId,
    linkedRows: ReadonlyArray<DatabaseRelationLinkedRow>,
): OrderKey {
    const activeIndex = linkedRows.findIndex(row => row.id === activeId);
    const overIndex = linkedRows.findIndex(row => row.id === overId);
    const movingDown = activeIndex < overIndex;

    if (movingDown) {
        const next = overIndex < linkedRows.length - 1 ? linkedRows[overIndex + 1]!.position : null;
        return generateOrderKeyBetween(linkedRows[overIndex]!.position, next);
    } else {
        const prev = overIndex > 0 ? linkedRows[overIndex - 1]!.position : null;
        return generateOrderKeyBetween(prev, linkedRows[overIndex]!.position);
    }
}

function DatabaseRelationLinkedDragOverlay({
    linkedRows,
}: {
    linkedRows: ReadonlyArray<DatabaseRelationLinkedRow>;
}) {
    const {active, activatorEvent} = useDndContext();

    const isPointerDragging =
        active && (activatorEvent instanceof PointerEvent || activatorEvent instanceof MouseEvent);

    const activeRow = useMemo(
        () => (active ? (linkedRows.find(row => row.id === active.id) ?? null) : null),
        [active, linkedRows],
    );

    return (
        <>
            {isPointerDragging &&
                createPortal(
                    <Box position="absolute" inset="0" zIndex="80" cursor="grabbing" />,
                    document.body,
                )}
            {activeRow &&
                createPortal(
                    <DragOverlay zIndex={70}>
                        <DatabaseRelationLinkedRow
                            row={activeRow}
                            isDragOverlay={true}
                            onRemove={() => {}}
                        />
                    </DragOverlay>,
                    document.body,
                )}
        </>
    );
}

function DatabaseRelationLinkedRow({
    row,
    isDragOverlay,
    onRemove,
}: {
    row: DatabaseRelationLinkedRow;
    isDragOverlay: boolean;
    onRemove: () => void;
}) {
    const {attributes, listeners, setNodeRef, transform, transition, isDragging} = useSortable({
        id: row.id,
        disabled: isDragOverlay,
    });

    return (
        <Box
            ref={setNodeRef}
            display="flex"
            alignItems="center"
            gap="1"
            paddingX="1.5"
            paddingY="1"
            backgroundColor={isDragOverlay ? "grey-0" : undefined}
            boxShadow={isDragOverlay ? "elevation-30" : undefined}
            style={{
                transform: transform ? `translate(${transform.x}px, ${transform.y}px)` : undefined,
                transition,
                opacity: isDragging ? 0 : undefined,
            }}
        >
            <button
                {...attributes}
                {...listeners}
                aria-label={`Reorder ${row.name ?? "Untitled"}`}
                className={sprinkles({
                    width: "4",
                    height: "4",
                    display: "flex",
                    justifyContent: "center",
                    alignItems: "center",
                    cursor: "grab",
                    color: "grey-40",
                    flexShrink: "0",
                })}
                tabIndex={-1}
            >
                <DotsSixVertical size={14} />
            </button>
            <Box flexGrow="1" fontSize="75" fontStyle="truncate" color="grey-100">
                {row.name ?? "Untitled"}
            </Box>
            <Box flexShrink="0">
                <IconButton
                    description={`Remove ${row.name ?? "Untitled"}`}
                    size="xs"
                    variant="quiet"
                    onPress={onRemove}
                >
                    <X />
                </IconButton>
            </Box>
        </Box>
    );
}

function DatabaseRelationChip({name}: {name: string | null}) {
    return (
        <Box
            display="flex"
            alignItems="center"
            flexShrink="0"
            backgroundColor="grey-5"
            borderRadius="1"
            paddingX="1"
            fontSize="75"
            color="grey-100"
            style={{maxWidth: 120}}
        >
            <Box fontStyle="truncate">{name ?? "Untitled"}</Box>
        </Box>
    );
}

function DatabaseRelationRowOption({name, onPress}: {name: string | null; onPress: () => void}) {
    return (
        <Box
            role="button"
            aria-label={`Link ${name ?? "Untitled"}`}
            tabIndex={0}
            display="flex"
            alignItems="center"
            paddingX="2"
            paddingY="1.5"
            fontSize="75"
            fontStyle="truncate"
            color="grey-100"
            cursor="pointer"
            onMouseDown={event => event.preventDefault()}
            onClick={event => {
                event.stopPropagation();
                onPress();
            }}
        >
            {name ?? "Untitled"}
        </Box>
    );
}

function DatabaseRelationCreateRow({query, onPress}: {query: string; onPress: () => void}) {
    return (
        <Box
            role="button"
            aria-label={`Create ${query}`}
            tabIndex={0}
            display="flex"
            alignItems="center"
            gap="1.5"
            paddingX="2"
            borderTop="grey-5"
            flexShrink="0"
            fontSize="75"
            color="grey-100"
            cursor="pointer"
            style={{height: 40}}
            onMouseDown={event => event.preventDefault()}
            onClick={event => {
                event.stopPropagation();
                onPress();
            }}
        >
            <Box flexGrow="1" fontStyle="truncate">
                Create &#x201C;{query}&#x201D;
            </Box>
            <Box color="grey-50" display="flex" alignItems="center" flexShrink="0">
                <Plus size={16} />
            </Box>
        </Box>
    );
}

export const databaseRelationFieldComponentProvider = defineDatabaseFieldComponentProvider(
    databaseRelationFieldProvider,
    {
        label: "Linked record",
        Icon: LinkSimple,
        GridViewCellContent: DatabaseRelationGridViewCellContent,
        GridViewCellEditorOverlay: DatabaseRelationGridViewCellEditorOverlay,
        getConfigMenuActions: null,
    },
);
