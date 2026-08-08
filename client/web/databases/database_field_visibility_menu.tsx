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
import {DotsSixVertical, DotsThreeVertical, Eye, EyeSlash} from "phosphor-react";
import {useEffect, useMemo, useState} from "react";
import {createPortal} from "react-dom";

import {Box} from "~/client/web/design/box.js";
import {IconButton} from "~/client/web/design/icon_button.js";
import {Overlay} from "~/client/web/design/overlay.js";
import {sprinkles} from "~/client/web/styles/styles.js";
import {spacing} from "~/shared/design/core/spacing.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {generateOrderKeyBetween} from "~/shared/helpers/sort/order_key.js";
import type {OrderKey} from "~/shared/helpers/sort/order_key.js";
import type {DatabaseFieldId} from "~/shared/id/types/id_types.js";

type FieldWithPosition = {
    readonly id: DatabaseFieldId;
    readonly name: string;
    readonly position: OrderKey;
};

// Sentinel IDs for section headers so they participate in dnd-kit's sort layout
// and shift when items move between sections.
const shownSectionId = "__section_shown__";
const hiddenSectionId = "__section_hidden__";

/**
 * Uses `Overlay` directly (rather than `OverlayTriggerButton`) so we can pass
 * `withPreviousPosition` to freeze the panel in place after initial positioning.
 * Without this the panel jumps whenever columns are added, removed, or reordered
 * while open.
 */
export function DatabaseFieldVisibilityMenu({
    shownFields,
    hiddenFields,
    onUpdateFieldVisibility,
}: {
    shownFields: ReadonlyArray<FieldWithPosition>;
    hiddenFields: ReadonlyArray<FieldWithPosition>;
    onUpdateFieldVisibility: (
        fieldId: DatabaseFieldId,
        position: OrderKey,
        isHidden: boolean,
    ) => void;
}) {
    const [isOpen, setIsOpen] = useState(false);
    const [isPositionFrozen, setIsPositionFrozen] = useState(false);

    // After the overlay is initially positioned by Popper, freeze it so it doesn't
    // reposition when the trigger button moves due to column changes.
    useEffect(() => {
        if (isOpen) {
            const id = requestAnimationFrame(() => setIsPositionFrozen(true));
            return () => cancelAnimationFrame(id);
        }
        setIsPositionFrozen(false);
    }, [isOpen]);

    // Close on Escape key.
    useEffect(() => {
        if (!isOpen) return;
        function handleKeyDown(e: KeyboardEvent) {
            if (e.key === "Escape") {
                e.preventDefault();
                e.stopPropagation();
                setIsOpen(false);
            }
        }
        document.addEventListener("keydown", handleKeyDown, {capture: true});
        return () => document.removeEventListener("keydown", handleKeyDown, {capture: true});
    }, [isOpen]);

    return (
        <Overlay
            isVisible={isOpen}
            placement="bottom-end"
            withPreviousPosition={isPositionFrozen}
            isBlocking={true}
            withoutBlockingTarget={true}
            onBlockingCoverPointerDown={() => setIsOpen(false)}
            overlay={
                <DatabaseFieldVisibilityPanel
                    shownFields={shownFields}
                    hiddenFields={hiddenFields}
                    onUpdateFieldVisibility={onUpdateFieldVisibility}
                />
            }
        >
            <IconButton
                description="Manage fields"
                size="sm"
                variant="quiet-above-grey-5-background"
                onPress={() => setIsOpen(prev => !prev)}
            >
                <DotsThreeVertical />
            </IconButton>
        </Overlay>
    );
}

function DatabaseFieldVisibilityPanel({
    ref,
    shownFields,
    hiddenFields,
    onUpdateFieldVisibility,
}: {
    ref?: React.Ref<HTMLDivElement>;
    shownFields: ReadonlyArray<FieldWithPosition>;
    hiddenFields: ReadonlyArray<FieldWithPosition>;
    onUpdateFieldVisibility: (
        fieldId: DatabaseFieldId,
        position: OrderKey,
        isHidden: boolean,
    ) => void;
}) {
    const shownIds = useMemo(() => shownFields.map(f => f.id), [shownFields]);
    const shownIdSet = useMemo(() => new Set(shownIds), [shownIds]);
    const hiddenIds = useMemo(() => hiddenFields.map(f => f.id), [hiddenFields]);
    const allIds = useMemo(
        () => [...shownIds, ...(hiddenIds.length > 0 ? [hiddenSectionId, ...hiddenIds] : [])],
        [shownIds, hiddenIds],
    );

    const pointerSensor = useSensor(
        PointerSensor,
        useMemo(
            () => ({
                activationConstraint: {
                    distance: 2,
                },
            }),
            [],
        ),
    );
    const sensors = useSensors(pointerSensor);

    return (
        <Box
            ref={ref}
            backgroundColor="grey-0"
            borderRadius="1.5"
            boxShadow="elevation-20-with-grey-10-border"
            padding="2"
            style={{width: 260, maxHeight: 400, overflowY: "auto"}}
            tabIndex={-1}
        >
            <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragEnd={event => {
                    const {active, over} = event;
                    if (!over || active.id === over.id) return;
                    if (active.id === hiddenSectionId) return;

                    const activeId = active.id as DatabaseFieldId;
                    const activeIsShown = shownIdSet.has(activeId);

                    // The hidden section header sits at the boundary. Dropping on it toggles the
                    // active item's section.
                    let isHidden: boolean;
                    if (over.id === hiddenSectionId) {
                        isHidden = activeIsShown;
                    } else {
                        isHidden = !shownIdSet.has(over.id as DatabaseFieldId);
                    }
                    const targetFields = isHidden ? hiddenFields : shownFields;
                    const targetHeaderId = isHidden ? hiddenSectionId : shownSectionId;
                    const position = computeDropPosition(
                        active.id as string,
                        over.id as string,
                        allIds,
                        targetFields,
                        targetHeaderId,
                    );

                    onUpdateFieldVisibility(activeId, position, isHidden);
                }}
            >
                <SortableContext items={allIds}>
                    <DatabaseFieldVisibilityDragPortals
                        shownFields={shownFields}
                        hiddenFields={hiddenFields}
                    />
                    <Box
                        fontSize="50"
                        fontStyle="semi-bold"
                        color="grey-50"
                        paddingX="1"
                        paddingTop="1"
                        paddingBottom="1"
                    >
                        Shown in table
                    </Box>
                    {shownFields.map(field => (
                        <DatabaseFieldVisibilityRow
                            key={field.id}
                            id={field.id}
                            name={field.name}
                            isShown={true}
                            canToggle={shownFields.length > 1}
                            isDragOverlay={false}
                            onToggle={() => onUpdateFieldVisibility(field.id, field.position, true)}
                        />
                    ))}
                    {hiddenFields.length > 0 && (
                        <>
                            <SortableSectionHeader
                                id={hiddenSectionId}
                                withTopGap={shownFields.length > 0}
                            >
                                Hidden in table
                            </SortableSectionHeader>
                            {hiddenFields.map(field => (
                                <DatabaseFieldVisibilityRow
                                    key={field.id}
                                    id={field.id}
                                    name={field.name}
                                    isShown={false}
                                    canToggle={true}
                                    isDragOverlay={false}
                                    onToggle={() =>
                                        onUpdateFieldVisibility(field.id, field.position, false)
                                    }
                                />
                            ))}
                        </>
                    )}
                </SortableContext>
            </DndContext>
        </Box>
    );
}

/**
 * Computes the order key for a field being dropped at a position within a target
 * section. Uses the global `allIds` ordering to determine whether the item moved
 * up or down relative to the `over` item.
 */
function computeDropPosition(
    activeId: string,
    overId: string,
    allIds: ReadonlyArray<string>,
    targetFields: ReadonlyArray<FieldWithPosition>,
    sectionHeaderId: string,
): OrderKey {
    if (overId === sectionHeaderId) {
        const first = targetFields.at(0)?.position ?? null;
        return generateOrderKeyBetween(null, first);
    }

    const overIndex = targetFields.findIndex(f => f.id === overId);
    if (overIndex === -1) {
        // Fallback: place at end of target section.
        const last = targetFields.at(-1)?.position ?? null;
        return generateOrderKeyBetween(last, null);
    }

    const activeGlobalIndex = allIds.indexOf(activeId);
    const overGlobalIndex = allIds.indexOf(overId);
    const movingDown = activeGlobalIndex < overGlobalIndex;
    const overField = assertExists(targetFields[overIndex]);

    if (movingDown) {
        const next = targetFields[overIndex + 1]?.position ?? null;
        return generateOrderKeyBetween(overField.position, next);
    } else {
        const prev = targetFields[overIndex - 1]?.position ?? null;
        return generateOrderKeyBetween(prev, overField.position);
    }
}

function DatabaseFieldVisibilityDragPortals({
    shownFields,
    hiddenFields,
}: {
    shownFields: ReadonlyArray<FieldWithPosition>;
    hiddenFields: ReadonlyArray<FieldWithPosition>;
}) {
    const {active, activatorEvent} = useDndContext();

    const isPointerDragging =
        active && (activatorEvent instanceof PointerEvent || activatorEvent instanceof MouseEvent);

    const allFields = useMemo(
        () => [
            ...shownFields.map(f => ({...f, isShown: true})),
            ...hiddenFields.map(f => ({...f, isShown: false})),
        ],
        [shownFields, hiddenFields],
    );

    const activeField = useMemo(
        () => (active ? (allFields.find(f => f.id === active.id) ?? null) : null),
        [active, allFields],
    );

    return (
        <>
            {isPointerDragging &&
                createPortal(
                    <Box position="absolute" inset="0" zIndex="80" cursor="grabbing" />,
                    document.body,
                )}
            {activeField &&
                createPortal(
                    <DragOverlay zIndex={70}>
                        <DatabaseFieldVisibilityRow
                            id={activeField.id}
                            name={activeField.name}
                            isShown={activeField.isShown}
                            canToggle={false}
                            isDragOverlay={true}
                            onToggle={() => {}}
                        />
                    </DragOverlay>,
                    document.body,
                )}
        </>
    );
}

/**
 * A section header that participates in dnd-kit's sort layout so it shifts when
 * items move between sections. Non-draggable but acts as a drop target.
 */
function SortableSectionHeader({
    id,
    children,
    withTopGap,
}: {
    id: string;
    children: React.ReactNode;
    withTopGap?: boolean;
}) {
    const {setNodeRef, transform, transition} = useSortable({
        id,
        disabled: {draggable: true, droppable: false},
    });

    return (
        <Box
            ref={setNodeRef}
            fontSize="50"
            fontStyle="semi-bold"
            color="grey-50"
            paddingX="1"
            paddingTop={withTopGap ? "3" : "1"}
            paddingBottom="1"
            style={{
                transform: transform ? `translate(${transform.x}px, ${transform.y}px)` : undefined,
                transition,
            }}
        >
            {children}
        </Box>
    );
}

function DatabaseFieldVisibilityRow({
    id,
    name,
    isShown,
    canToggle,
    isDragOverlay,
    onToggle,
}: {
    id: DatabaseFieldId;
    name: string;
    isShown: boolean;
    canToggle: boolean;
    isDragOverlay: boolean;
    onToggle: () => void;
}) {
    const {
        attributes: sortableAttributes,
        listeners: sortableListeners,
        setNodeRef: setSortableNodeRef,
        transform: sortableTransform,
        transition: sortableTransition,
        isDragging,
    } = useSortable({id, disabled: isDragOverlay});

    return (
        <Box
            ref={setSortableNodeRef}
            display="flex"
            alignItems="center"
            paddingX="1"
            borderRadius="0.5"
            backgroundColor={isDragOverlay ? "grey-0" : undefined}
            boxShadow={isDragOverlay ? "elevation-30" : undefined}
            style={{
                height: spacing["7"],
                transform: sortableTransform
                    ? `translate(${sortableTransform.x}px, ${sortableTransform.y}px)`
                    : undefined,
                transition: sortableTransition,
                opacity: isDragging ? 0 : undefined,
            }}
        >
            <button
                {...sortableAttributes}
                {...sortableListeners}
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
                <DotsSixVertical size={spacing["3"]} />
            </button>
            <Box flexGrow="1" fontSize="75" fontStyle="truncate" color="grey-80" paddingLeft="1">
                {name}
            </Box>
            <Box flexShrink="0">
                <IconButton
                    description={isShown ? "Hide field" : "Show field"}
                    size="xs"
                    variant="quiet"
                    isDisabled={!canToggle}
                    onPress={onToggle}
                >
                    {isShown ? <Eye /> : <EyeSlash />}
                </IconButton>
            </Box>
        </Box>
    );
}
