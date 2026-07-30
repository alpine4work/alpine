import {
    CollisionDetection,
    DragEndEvent,
    DragMoveEvent,
    DragStartEvent,
    UniqueIdentifier,
    closestCenter,
    pointerWithin,
} from "@dnd-kit/core";
import {useCallback, useEffect, useMemo, useRef, useState} from "react";
import {flushSync} from "react-dom";
import {SiteTreeForClient} from "~/client/web/sites/context/site_context.js";
import {
    CollapsedSectionsState,
    isSectionCollapsed,
} from "~/client/web/sites/helpers/site_side_bar_collapsed_section_state.js";
import {useSiteMutations} from "~/client/web/sites/internal/use_site_mutations.js";
import {InternalError} from "~/shared/error/error.js";
import {emptyArray} from "~/shared/helpers/array/empty_array.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {OrderKey, generateOrderKeyBetween} from "~/shared/helpers/sort/order_key.js";
import {
    SiteItemSearchEntityId,
    isSiteItemSearchEntityId,
} from "~/shared/search/site_item_search_entity_id.js";
import {
    SiteSideBarContainerId,
    SiteSideBarSectionContainerId,
    isSiteSideBarSectionContainerId,
} from "~/shared/sites/site_entry_id.js";
import {
    SiteEntityModel,
    SiteEntryModel,
    SiteSideBarSectionModel,
} from "~/shared/sites/site_model.js";

export const indentWidthPx = 16;

// There's an interesting case while dragging that we need to solve for:
//
// ```
// Sidebar
//   Item 1
//   Section 1
//   | Item 2
//   | Item 3
//   Item 4
// ```
//
// What should happen when the user drags Item 1 between Item 3 and Item 4? Should
// it be added as the last item in Section 1, or should it be added below Section 1
// (at the root level)?
//
// The `depthChangeWidth` helps us answer this question! The user can drag the item
// _horizontally_ to indicate where they'd like the item to be placed. We multiply
// the indent width by an arbitrary factor (8). So if the user want to place Item 1
// as the last item in Section 1, they'd drag it 128px to the right!!
const depthChangeWidth = indentWidthPx * 8;

// Hover duration over a collapsed section before it auto-expands during a drag.
// Long enough that incidental hovers don't trigger, short enough to feel
// responsive.
const autoExpandDelayMs = 600;

type SiteSideBarDndEntry = SiteEntityModel | SiteSideBarSectionModel;
type SiteSideBarDndEntryId = SiteItemSearchEntityId | SiteSideBarSectionContainerId;

/**
 * A sidebar row in the flat DnD coordinate system.
 *
 * The backend tree is still parented by `parentId`; `depth` is only the visual
 * outline depth used by the drag layer to render indentation and infer nesting
 * intent from horizontal movement.
 */
export type SiteSideBarDndRow = {
    depth: number;
    parentId: SiteSideBarContainerId | SiteSideBarSectionContainerId;
} & (
    | {
          type: "SideBarSection";
          entry: SiteSideBarSectionModel;
      }
    | {
          type: "Entity";
          entry: SiteEntityModel;
      }
);

/**
 * The visible flattened list plus indexes scoped to that exact list.
 *
 * Collapsed sections remove their descendants from this DnD surface, because only
 * visible rows have measured droppable rectangles.
 */
type SiteSideBarDndRowList = {
    readonly rows: ReadonlyArray<SiteSideBarDndRow>;
    readonly rowIndexByEntryId: ReadonlyMap<SiteSideBarDndEntryId, number>;
};

/**
 * Data derived once for the current drag so drag-move events do not rebuild the
 * same temporary list on every pointer movement.
 */
type ActiveSiteSideBarDrag = {
    readonly currentlyDraggingRow: SiteSideBarDndRow;
    readonly currentlyDraggingRowIndex: number;
    readonly sortableRows: ReadonlyArray<SiteSideBarDndRow>;
    readonly currentlyDraggingSubtreeRows: ReadonlyArray<SiteSideBarDndRow>;
    readonly rowsWithoutCurrentlyDraggingSubtree: ReadonlyArray<SiteSideBarDndRow>;
    readonly rowIndexByEntryIdWithoutCurrentlyDraggingSubtree: ReadonlyMap<
        SiteSideBarDndEntryId,
        number
    >;
};

export type SiteSideBarDropIntent = {
    readonly currentlyDraggingEntryId: SiteSideBarDndEntryId;
    readonly type: "before" | "after" | "inside";
    readonly parentId: SiteSideBarContainerId | SiteSideBarSectionContainerId;
    readonly previousEntryId: SiteSideBarDndEntryId | null;
    readonly nextEntryId: SiteSideBarDndEntryId | null;
    readonly depth: number;
    readonly orderKey: OrderKey;
};

export type SiteSideBarDragPreview =
    | {
          readonly type: "move";
          readonly intent: SiteSideBarDropIntent;
      }
    | {
          readonly type: "expand";
          readonly row: SiteSideBarDndRow & {type: "SideBarSection"};
      };

/**
 * Output of one round of drag-state math. `intent` is what would commit on drop;
 * `pendingExpandSectionId` is a separate signal for the auto-expand timer, since
 * dropping into a collapsed section is disallowed even when the user's pointer
 * suggests that intent.
 */
type SiteSideBarDragComputation = {
    readonly intent: SiteSideBarDropIntent | null;
    readonly pendingExpandSectionRow: (SiteSideBarDndRow & {type: "SideBarSection"}) | null;
};

const emptyDragComputation: SiteSideBarDragComputation = {
    intent: null,
    pendingExpandSectionRow: null,
};

/**
 * Owns the sidebar's flat-tree DnD model.
 *
 * `sortableRows` is the single list rendered in `<SortableContext>`.
 * `currentlyDraggingSubtreeRows` comes from the real tree so the overlay can
 * represent hidden descendants when a collapsed section is dragged.
 */
export function useSiteSideBarDnd({
    tree,
    rootId,
    collapsedSections,
    onExpandSection,
}: {
    tree: SiteTreeForClient;
    rootId: SiteSideBarContainerId | SiteSideBarSectionContainerId;
    collapsedSections: CollapsedSectionsState;
    onExpandSection: (row: SiteSideBarDndRow & {type: "SideBarSection"}) => void;
}) {
    const {moveEntry} = useSiteMutations();

    const visibleRowList = useMemo(
        () =>
            createSiteSideBarDndRowList({
                tree,
                rootId,
                collapsedSections,
            }),
        [collapsedSections, rootId, tree],
    );

    const [currentlyDraggingEntryId, setCurrentlyDraggingEntryId] =
        useState<SiteSideBarDndEntryId | null>(null);
    const [dragPreview, setDragPreview] = useState<SiteSideBarDragPreview | null>(null);

    const activeDrag = useMemo(() => {
        if (!currentlyDraggingEntryId) return null;

        // dnd-kit reports IDs. Convert those IDs into indexes in the visible row list,
        // because only visible rows have measured droppable rectangles.
        const currentlyDraggingRowIndex = assertExists(
            visibleRowList.rowIndexByEntryId.get(currentlyDraggingEntryId),
            "Currently dragging row index not found",
        );

        return getActiveSiteSideBarDrag({
            currentlyDraggingRowIndex,
            collapsedSections,
            tree,
            visibleRows: visibleRowList.rows,
        });
    }, [currentlyDraggingEntryId, collapsedSections, tree, visibleRowList]);

    // Intent is recalculated on move and end from the same helper so the previewed
    // move and committed move cannot disagree.
    const computeDragState = useCallback(
        (event: DragEndEvent | DragMoveEvent): SiteSideBarDragComputation =>
            activeDrag === null
                ? emptyDragComputation
                : getSiteSideBarDropIntent({
                      activeDrag,
                      collapsedSections,
                      rootId,
                      tree,
                      visibleRowList,
                      dragEvent: event,
                  }),
        [activeDrag, collapsedSections, rootId, tree, visibleRowList],
    );

    // Pending auto-expand timer. Keyed by section ID so we can no-op when the drop
    // target stays on the same collapsed section across many drag-move events.
    const expandTimerRef = useRef<{
        timer: ReturnType<typeof setTimeout>;
        sectionId: SiteSideBarSectionContainerId;
    } | null>(null);

    const cancelExpandTimer = useCallback(() => {
        if (!expandTimerRef.current) return;
        clearTimeout(expandTimerRef.current.timer);
        expandTimerRef.current = null;
    }, []);

    // Make sure a half-elapsed timer can't fire after the hook unmounts.
    useEffect(() => cancelExpandTimer, [cancelExpandTimer]);

    const handleDragStart = useCallback(
        (event: DragStartEvent) => {
            setCurrentlyDraggingEntryId(assertSiteSideBarDndEntryId(event.active.id));
        },
        [setCurrentlyDraggingEntryId],
    );

    const handleDragMove = useCallback(
        (event: DragMoveEvent) => {
            const {intent, pendingExpandSectionRow} = computeDragState(event);
            setDragPreview(
                pendingExpandSectionRow
                    ? {type: "expand", row: pendingExpandSectionRow}
                    : intent
                      ? {type: "move", intent}
                      : null,
            );

            if (pendingExpandSectionRow === null) {
                cancelExpandTimer();
                return;
            }

            // Same section already pending — let the running timer finish.
            if (expandTimerRef.current?.sectionId === pendingExpandSectionRow?.entry.id) return;

            const expandedSectionIntent = getExpandedSectionDropIntent({
                activeDrag,
                row: pendingExpandSectionRow,
                tree,
                visibleRowList,
            });

            cancelExpandTimer();
            expandTimerRef.current = {
                sectionId: pendingExpandSectionRow?.entry.id,
                timer: setTimeout(() => {
                    // NOTE(ifitzsimmons, 2026-05-12): When we expand the section, we want to update
                    // the drag preview so that it appears directly underneath the expanded section and
                    // at the correct depth. We accomplish this by using React's `flushSync`, which
                    // makes sure that these updates are applied within the same render cycle.
                    flushSync(() => {
                        onExpandSection(pendingExpandSectionRow);
                        setDragPreview(
                            expandedSectionIntent
                                ? {type: "move", intent: expandedSectionIntent}
                                : null,
                        );
                    });
                    expandTimerRef.current = null;
                }, autoExpandDelayMs),
            };
        },
        [activeDrag, cancelExpandTimer, computeDragState, onExpandSection, tree, visibleRowList],
    );

    const handleDragEnd = useCallback(
        (event: DragEndEvent) => {
            const {intent, pendingExpandSectionRow} = computeDragState(event);
            cancelExpandTimer();
            setDragPreview(null);
            setCurrentlyDraggingEntryId(null);

            // Mouse-up while hovering a collapsed section, before the auto-expand timer fired:
            // drop the item as the section's next sibling so the release feels like a commit,
            // not a no-op.
            if (pendingExpandSectionRow) {
                const dropAfterIntent = getDropAfterSectionIntent({
                    activeDrag,
                    section: pendingExpandSectionRow,
                    tree,
                });

                if (!dropAfterIntent) return;

                if (dropAfterIntent) {
                    moveEntry({
                        id: dropAfterIntent.currentlyDraggingEntryId,
                        newPosition: {
                            parentId: dropAfterIntent.parentId,
                            orderKey: dropAfterIntent.orderKey,
                        },
                    });
                }
                return;
            }

            if (!intent) return;

            moveEntry({
                id: intent.currentlyDraggingEntryId,
                newPosition: {
                    parentId: intent.parentId,
                    orderKey: intent.orderKey,
                },
            });
        },
        [
            activeDrag,
            cancelExpandTimer,
            computeDragState,
            moveEntry,
            setCurrentlyDraggingEntryId,
            tree,
        ],
    );

    const handleDragCancel = useCallback(() => {
        cancelExpandTimer();
        setCurrentlyDraggingEntryId(null);
        setDragPreview(null);
    }, [cancelExpandTimer, setCurrentlyDraggingEntryId]);

    return {
        currentlyDraggingSubtreeRows: activeDrag?.currentlyDraggingSubtreeRows ?? emptyArray,
        sortableRows: activeDrag?.sortableRows ?? visibleRowList.rows,
        dragPreview,
        dndContextProps: {
            collisionDetection: siteSideBarCollisionDetection,
            onDragCancel: handleDragCancel,
            onDragEnd: handleDragEnd,
            onDragMove: handleDragMove,
            onDragStart: handleDragStart,
        },
    };
}

const siteSideBarCollisionDetection: CollisionDetection = args => {
    // Prefer pointer collisions for tree rows so the hovered row feels literal; fall
    // back to center distance for keyboard/sensor cases without a pointer.
    const pointerCollisions = pointerWithin(args);
    if (pointerCollisions.length > 0) return pointerCollisions;
    return closestCenter(args);
};

/**
 * Builds the visible DnD coordinate system in one DFS over the real tree.
 *
 * Collapsed sections are included, but their descendants are not, matching the
 * rows dnd-kit can measure.
 */
function createSiteSideBarDndRowList({
    tree,
    rootId,
    collapsedSections,
}: {
    tree: SiteTreeForClient;
    rootId: SiteSideBarContainerId | SiteSideBarSectionContainerId;
    collapsedSections: ReadonlyMap<SiteSideBarSectionContainerId, true | false | undefined>;
}): SiteSideBarDndRowList {
    const visibleRows: Array<SiteSideBarDndRow> = [];
    const indexByIdForVisibleRows: Map<SiteSideBarDndEntryId, number> = new Map();

    function pushRow(row: SiteSideBarDndRow) {
        indexByIdForVisibleRows.set(row.entry.id, visibleRows.length);
        visibleRows.push(row);
    }

    function walkTree(
        parentId: SiteSideBarContainerId | SiteSideBarSectionContainerId,
        depth: number,
    ) {
        for (const child of tree.getChildrenForParent(parentId)) {
            assertSiteSideBarDndEntry(child);

            const rowEntry =
                child.type === "SideBarSection"
                    ? ({type: "SideBarSection", entry: child} as const)
                    : ({type: "Entity", entry: child} as const);

            pushRow({
                depth,
                parentId,
                ...rowEntry,
            });

            if (child.type === "Entity") continue;
            if (isSectionCollapsed(collapsedSections, {depth, entry: child})) continue;

            walkTree(child.id, depth + 1);
        }
    }

    walkTree(rootId, 0);

    return {rows: visibleRows, rowIndexByEntryId: indexByIdForVisibleRows};
}

function assertSiteSideBarDndEntry(entry: SiteEntryModel): asserts entry is SiteSideBarDndEntry {
    switch (entry.type) {
        case "Entity":
        case "SideBarSection":
            return;
        case "SideBar":
        case "TopBar":
            throw new InternalError("Only sidebar entries can be dragged in the sidebar");
        default:
            throw exhaustive(entry);
    }
}

function getSiteSideBarDropIntent({
    activeDrag,
    collapsedSections,
    dragEvent,
    rootId,
    tree,
    visibleRowList,
}: {
    activeDrag: ActiveSiteSideBarDrag;
    collapsedSections: CollapsedSectionsState;
    dragEvent: DragEndEvent | DragMoveEvent;
    rootId: SiteSideBarContainerId | SiteSideBarSectionContainerId;
    tree: SiteTreeForClient;
    visibleRowList: SiteSideBarDndRowList;
}): SiteSideBarDragComputation {
    if (!dragEvent.over?.id || dragEvent.over.id === dragEvent.active.id) {
        return emptyDragComputation;
    }

    // The hot path works only in the visible coordinate system, because only rendered
    // rows can be targeted by dnd-kit.
    const currentlyDraggingRowId = assertSiteSideBarDndEntryId(dragEvent.active.id);
    const overRowId = assertSiteSideBarDndEntryId(dragEvent.over.id);
    const overIndex = visibleRowList.rowIndexByEntryId.get(overRowId);
    if (overIndex === undefined) return emptyDragComputation;

    const {
        currentlyDraggingRow,
        currentlyDraggingRowIndex,
        rowsWithoutCurrentlyDraggingSubtree,
        rowIndexByEntryIdWithoutCurrentlyDraggingSubtree,
    } = activeDrag;
    if (currentlyDraggingRow.entry.id !== currentlyDraggingRowId) return emptyDragComputation;

    const overIndexWithoutActive = rowIndexByEntryIdWithoutCurrentlyDraggingSubtree.get(overRowId);
    if (overIndexWithoutActive === undefined) return emptyDragComputation;

    const insertionIndex =
        currentlyDraggingRowIndex < overIndex ? overIndexWithoutActive + 1 : overIndexWithoutActive;

    // Horizontal movement requests a relative depth change. For example, dragging one
    // `depthChangeWidth` to the right asks to nest one level deeper before the
    // neighboring rows clamp that request to a valid tree position.
    const requestedDepth =
        currentlyDraggingRow.depth + Math.round(dragEvent.delta.x / depthChangeWidth);

    // Auto-expand intent is detected from the unclamped request — once collapsed
    // sections are made unenterable by depth math, the clamped intent no longer
    // carries any signal that the user was trying to nest into them.
    const pendingExpandSectionRow = getPendingExpandSectionRow({
        collapsedSections,
        currentlyDraggingEntryId: currentlyDraggingRow.entry.id,
        overRow: visibleRowList.rows[overIndex] ?? null,
        previousRow: rowsWithoutCurrentlyDraggingSubtree[insertionIndex - 1] ?? null,
    });

    // Horizontal movement requests a depth change, then neighbors clamp it to a valid
    // outline position. Collapsed sections clamp like leaves so the projection can
    // never resolve a collapsed section as the drop parent.
    const projectedDepth = getProjectedDepth({
        rows: rowsWithoutCurrentlyDraggingSubtree,
        insertionIndex,
        requestedDepth,
        collapsedSections,
    });

    const parentId = getParentIdForInsertion({
        rows: rowsWithoutCurrentlyDraggingSubtree,
        insertionIndex,
        depth: projectedDepth,
        rootId,
    });
    if (!parentId) return {intent: null, pendingExpandSectionRow};

    const previousSiblingRow = findPreviousSibling(
        rowsWithoutCurrentlyDraggingSubtree,
        insertionIndex,
        projectedDepth,
    );
    const nextSiblingRow = findNextSibling(
        rowsWithoutCurrentlyDraggingSubtree,
        insertionIndex,
        projectedDepth,
    );
    const orderKey = getOrderKeyForIntent({
        currentlyDraggingEntryId: currentlyDraggingRow.entry.id,
        nextSiblingRow,
        parentId,
        previousSiblingRow,
        tree,
    });

    return {
        intent: {
            currentlyDraggingEntryId: currentlyDraggingRow.entry.id,
            type: getIntentType({
                currentlyDraggingRow,
                nextSiblingRow,
                overRowId,
                parentId,
                previousSiblingRow,
            }),
            parentId,
            previousEntryId: previousSiblingRow?.entry.id ?? null,
            nextEntryId: nextSiblingRow?.entry.id ?? null,
            depth: projectedDepth,
            orderKey,
        },
        pendingExpandSectionRow,
    };
}

function getPendingExpandSectionRow({
    collapsedSections,
    currentlyDraggingEntryId,
    overRow,
    previousRow,
}: {
    collapsedSections: CollapsedSectionsState;
    currentlyDraggingEntryId: SiteSideBarDndEntryId;
    overRow: SiteSideBarDndRow | null;
    previousRow: SiteSideBarDndRow | null;
}): (SiteSideBarDndRow & {type: "SideBarSection"}) | null {
    // Hovering directly on a collapsed section's row.
    if (
        overRow?.type === "SideBarSection" &&
        overRow.entry.id !== currentlyDraggingEntryId &&
        isSectionCollapsed(collapsedSections, overRow)
    ) {
        return overRow;
    }

    // Indenting horizontally past a collapsed section header. The move preview is
    // clamped at the section's own depth, but the user's request signals "enter this
    // section" — so trigger expansion on it.
    if (
        previousRow?.type === "SideBarSection" &&
        previousRow.entry.id !== currentlyDraggingEntryId &&
        isSectionCollapsed(collapsedSections, previousRow)
    ) {
        return previousRow;
    }

    return null;
}

function getExpandedSectionDropIntent({
    activeDrag,
    row,
    tree,
    visibleRowList,
}: {
    activeDrag: ActiveSiteSideBarDrag | null;
    row: SiteSideBarDndRow & {type: "SideBarSection"};
    tree: SiteTreeForClient;
    visibleRowList: SiteSideBarDndRowList;
}): SiteSideBarDropIntent | null {
    if (!activeDrag) return null;

    const sectionIndex = visibleRowList.rowIndexByEntryId.get(row.entry.id);
    if (sectionIndex === undefined) return null;

    const sectionRow = visibleRowList.rows[sectionIndex];
    assert(sectionRow?.entry.type === "SideBarSection");

    const currentlyDraggingEntryId = activeDrag.currentlyDraggingRow.entry.id;

    const firstChildInSection = tree.getChildrenForParent(row.entry.id)[0];
    const firstChildId = firstChildInSection
        ? assertSiteSideBarDndEntryId(firstChildInSection.id)
        : null;
    assert(firstChildId !== currentlyDraggingEntryId);

    return {
        currentlyDraggingEntryId,
        type: "inside",
        parentId: row.entry.id,
        previousEntryId: null,
        nextEntryId: firstChildId,
        depth: sectionRow.depth + 1,
        orderKey: generateOrderKeyBetween(null, firstChildInSection?.orderKey ?? null),
    };
}

/**
 * Drop intent that lands the dragged item directly after `section` — its next
 * sibling in `section.parentId`. Used when the user releases over a collapsed
 * section before the auto-expand timer fires, so the release commits as a
 * sibling-adjacent move instead of a no-op.
 */
function getDropAfterSectionIntent({
    activeDrag,
    section,
    tree,
}: {
    activeDrag: ActiveSiteSideBarDrag | null;
    section: SiteSideBarDndRow & {type: "SideBarSection"};
    tree: SiteTreeForClient;
}): SiteSideBarDropIntent | null {
    if (!activeDrag) return null;

    const currentlyDraggingEntryId = activeDrag.currentlyDraggingRow.entry.id;
    const parentId = section.parentId;
    const siblings = tree.getChildrenForParent(parentId);
    const sectionIndex = siblings.findIndex(sibling => sibling.id === section.entry.id);
    if (sectionIndex === -1) return null;

    // Find the section's next sibling, skipping the dragging entry's row so the
    // generated order key doesn't sandwich the item between itself and the section.
    let nextSibling: SiteEntryModel | null = null;
    for (let i = sectionIndex + 1; i < siblings.length; i++) {
        const candidate = siblings[i];
        if (candidate && candidate.id !== currentlyDraggingEntryId) {
            nextSibling = candidate;
            break;
        }
    }

    return {
        currentlyDraggingEntryId,
        type: "after",
        parentId,
        previousEntryId: assertSiteSideBarDndEntryId(section.entry.id),
        nextEntryId: nextSibling ? assertSiteSideBarDndEntryId(nextSibling.id) : null,
        depth: section.depth,
        orderKey: generateOrderKeyBetween(section.entry.orderKey, nextSibling?.orderKey ?? null),
    };
}

function assertSiteSideBarDndEntryId(id: UniqueIdentifier): SiteSideBarDndEntryId {
    if (typeof id !== "string") throw new InternalError("Invalid entry ID");
    if (isSiteItemSearchEntityId(id)) return id;
    if (isSiteSideBarSectionContainerId(id)) return id;
    throw new InternalError("Invalid entry ID");
}

function getIntentType({
    currentlyDraggingRow,
    nextSiblingRow,
    overRowId,
    parentId,
    previousSiblingRow,
}: {
    currentlyDraggingRow: SiteSideBarDndRow;
    nextSiblingRow: SiteSideBarDndRow | null;
    overRowId: SiteItemSearchEntityId | SiteSideBarSectionContainerId;
    parentId: SiteSideBarContainerId | SiteSideBarSectionContainerId;
    previousSiblingRow: SiteSideBarDndRow | null;
}): SiteSideBarDropIntent["type"] {
    if (parentId === overRowId && previousSiblingRow === null && nextSiblingRow === null) {
        return "inside";
    }
    if (nextSiblingRow?.entry.id === overRowId && currentlyDraggingRow.entry.id !== overRowId) {
        return "before";
    }
    return "after";
}

function getOrderKeyForIntent({
    currentlyDraggingEntryId,
    nextSiblingRow,
    parentId,
    previousSiblingRow,
    tree,
}: {
    currentlyDraggingEntryId: SiteSideBarDndEntryId;
    nextSiblingRow: SiteSideBarDndRow | null;
    parentId: SiteSideBarContainerId | SiteSideBarSectionContainerId;
    previousSiblingRow: SiteSideBarDndRow | null;
    tree: SiteTreeForClient;
}): OrderKey {
    if (previousSiblingRow || nextSiblingRow) {
        return generateOrderKeyBetween(
            previousSiblingRow?.entry.orderKey ?? null,
            nextSiblingRow?.entry.orderKey ?? null,
        );
    }

    // The visible row list filters out descendants of collapsed sections, so the
    // absence of visible siblings does not prove `parentId` has no children. Consult
    // the tree directly — otherwise dropping into a parent with hidden children would
    // generate `initialOrderKey` and collide with an existing child whose key was also
    // produced by this fallback.
    const firstExistingChild = tree
        .getChildrenForParent(parentId)
        .find(entry => entry.id !== currentlyDraggingEntryId);
    return generateOrderKeyBetween(null, firstExistingChild?.orderKey ?? null);
}

/**
 * Derives the temporary row lists for a drag operation.
 *
 * Given a visible list shaped like:
 *
 * ```text
 * before...
 * dragged row
 *   dragged descendant...
 *   dragged descendant...
 * after...
 * ```
 *
 * `sortableRows` keeps the dragged row in the rendered sortable surface, but
 * removes its descendants:
 *
 * ```text
 * before...
 * dragged row
 * after...
 * ```
 *
 * `rowsWithoutCurrentlyDraggingSubtree` removes the whole dragged block. Drop
 * intent math uses this list as if the dragged subtree is floating outside the
 * tree:
 *
 * ```text
 * before...
 * after...
 * ```
 */
function getActiveSiteSideBarDrag({
    currentlyDraggingRowIndex,
    collapsedSections,
    tree,
    visibleRows,
}: {
    currentlyDraggingRowIndex: number;
    collapsedSections: CollapsedSectionsState;
    tree: SiteTreeForClient;
    visibleRows: ReadonlyArray<SiteSideBarDndRow>;
}): ActiveSiteSideBarDrag {
    const currentlyDraggingRow = visibleRows[currentlyDraggingRowIndex];
    assert(currentlyDraggingRow !== undefined);

    const subtreeEndIndex = getSubtreeEndIndex(visibleRows, currentlyDraggingRowIndex);

    const rowsWithoutCurrentlyDraggingSubtree: Array<SiteSideBarDndRow> = [];
    const rowIndexByEntryIdWithoutCurrentlyDraggingSubtree: Map<SiteSideBarDndEntryId, number> =
        new Map();

    const sortableRows: Array<SiteSideBarDndRow> = [];

    function pushRow(row: SiteSideBarDndRow) {
        rowIndexByEntryIdWithoutCurrentlyDraggingSubtree.set(
            row.entry.id,
            rowsWithoutCurrentlyDraggingSubtree.length,
        );
        rowsWithoutCurrentlyDraggingSubtree.push(row);
    }

    // Omit all rows that are part of the dragged subtree
    for (let i = 0; i <= currentlyDraggingRowIndex; i++) {
        const row = assertExists(visibleRows[i]);

        sortableRows.push(row);

        if (i !== currentlyDraggingRowIndex) {
            pushRow(row);
        }
    }

    for (let i = subtreeEndIndex; i < visibleRows.length; i++) {
        const row = assertExists(visibleRows[i]);
        sortableRows.push(row);
        pushRow(row);
    }

    return {
        currentlyDraggingRow,
        currentlyDraggingRowIndex,
        sortableRows,
        currentlyDraggingSubtreeRows: getCurrentlyDraggingSubtreeRows({
            currentlyDraggingRow,
            collapsedSections,
            tree,
        }),
        rowsWithoutCurrentlyDraggingSubtree,
        rowIndexByEntryIdWithoutCurrentlyDraggingSubtree,
    };
}

function getCurrentlyDraggingSubtreeRows({
    currentlyDraggingRow,
    tree,
    collapsedSections,
}: {
    currentlyDraggingRow: SiteSideBarDndRow;
    collapsedSections: CollapsedSectionsState;
    tree: SiteTreeForClient;
}): ReadonlyArray<SiteSideBarDndRow> {
    const subtreeRows: Array<SiteSideBarDndRow> = [currentlyDraggingRow];
    if (currentlyDraggingRow.type === "Entity") return subtreeRows;
    if (isSectionCollapsed(collapsedSections, currentlyDraggingRow)) return subtreeRows;

    function walkTree(parentId: SiteSideBarSectionContainerId, depth: number) {
        for (const child of tree.getChildrenForParent(parentId)) {
            assertSiteSideBarDndEntry(child);

            const rowEntry =
                child.type === "SideBarSection"
                    ? ({type: "SideBarSection", entry: child} as const)
                    : ({type: "Entity", entry: child} as const);

            subtreeRows.push({
                depth,
                parentId,
                ...rowEntry,
            });

            if (child.type === "SideBarSection") {
                walkTree(child.id, depth + 1);
            }
        }
    }

    walkTree(currentlyDraggingRow.entry.id, currentlyDraggingRow.depth + 1);
    return subtreeRows;
}

function getSubtreeEndIndex(
    rows: ReadonlyArray<SiteSideBarDndRow>,
    currentlyDraggingRowIndex: number,
): number {
    const currentlyDraggingRow = rows[currentlyDraggingRowIndex];
    assert(currentlyDraggingRow !== undefined);

    // In DFS order, descendants are exactly the following rows with greater depth. The
    // first row at the same or shallower depth ends the subtree.
    let endIndex = currentlyDraggingRowIndex + 1;
    while (endIndex < rows.length && rows[endIndex]!.depth > currentlyDraggingRow.depth) {
        endIndex++;
    }

    return endIndex;
}

function getProjectedDepth({
    rows,
    insertionIndex,
    requestedDepth,
    collapsedSections,
}: {
    rows: ReadonlyArray<SiteSideBarDndRow>;
    insertionIndex: number;
    requestedDepth: number;
    collapsedSections: CollapsedSectionsState;
}): number {
    const previousRow = rows[insertionIndex - 1] ?? null;
    const nextRow = rows[insertionIndex] ?? null;

    // You can only indent under a preceding section, and you cannot outdent past the
    // following row without changing that row's ancestry.
    const maxDepth = getMaxDepthAfterRow(previousRow, collapsedSections);
    const minDepth = nextRow?.depth ?? 0;

    return Math.max(minDepth, Math.min(requestedDepth, maxDepth));
}

function getMaxDepthAfterRow(
    row: SiteSideBarDndRow | null,
    collapsedSections: CollapsedSectionsState,
): number {
    if (!row) return 0;

    switch (row.type) {
        case "SideBarSection":
            // Collapsed sections cannot be entered via depth math. The user must hover them
            // long enough to trigger auto-expand before the projected depth is allowed to
            // descend into their children.
            return isSectionCollapsed(collapsedSections, row) ? row.depth : row.depth + 1;
        case "Entity":
            return row.depth;
        default:
            throw exhaustive(row);
    }
}

function getParentIdForInsertion({
    rows,
    insertionIndex,
    depth,
    rootId,
}: {
    rows: ReadonlyArray<SiteSideBarDndRow>;
    insertionIndex: number;
    depth: number;
    rootId: SiteSideBarContainerId | SiteSideBarSectionContainerId;
}): SiteSideBarContainerId | SiteSideBarSectionContainerId | null {
    if (depth === 0) {
        // At root depth, preserve the root container for this rendered list.
        const nearestRootRow = findNearestRowAtOrAboveDepth(rows, insertionIndex, 0);
        return nearestRootRow?.parentId ?? rootId;
    }

    // For nested depth N, the parent is the nearest preceding section at depth N - 1.
    // Entities cannot be parents.
    for (let i = insertionIndex - 1; i >= 0; i--) {
        const row = assertExists(rows[i]);
        if (row.depth < depth - 1) return null;
        if (row.depth !== depth - 1) continue;
        if (row.entry.type !== "SideBarSection") continue;
        return row.entry.id;
    }

    return null;
}

function findNearestRowAtOrAboveDepth(
    rows: ReadonlyArray<SiteSideBarDndRow>,
    insertionIndex: number,
    depth: number,
): SiteSideBarDndRow | null {
    for (let i = insertionIndex - 1; i >= 0; i--) {
        const row = assertExists(rows[i]);
        if (row.depth <= depth) return row;
    }

    return null;
}

function findPreviousSibling(
    rows: ReadonlyArray<SiteSideBarDndRow>,
    insertionIndex: number,
    depth: number,
): SiteSideBarDndRow | null {
    for (let i = insertionIndex - 1; i >= 0; i--) {
        const row = assertExists(rows[i]);
        if (row.depth < depth) return null;
        if (row.depth === depth) return row;
    }

    return null;
}

function findNextSibling(
    rows: ReadonlyArray<SiteSideBarDndRow>,
    insertionIndex: number,
    depth: number,
): SiteSideBarDndRow | null {
    for (let i = insertionIndex; i < rows.length; i++) {
        const row = assertExists(rows[i]);
        if (row.depth < depth) return null;
        if (row.depth === depth) return row;
    }

    return null;
}
