import {
    DndContext,
    DragOverlay,
    PointerSensor,
    useDndContext,
    useSensor,
    useSensors,
} from "@dnd-kit/core";
import {
    AnimateLayoutChanges,
    SortableContext,
    defaultAnimateLayoutChanges,
    useSortable,
    verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import {useSearchParams} from "@remix-run/react";
import {
    ArrowLineDown,
    ArrowLineUp,
    CaretDown,
    CaretRight,
    File,
    FolderPlus,
    Link as LinkIcon,
    MinusCircle,
    PencilSimple,
    Plus,
    SpinnerGap,
    Trash,
} from "phosphor-react";
import {CSSProperties, ReactNode, useCallback, useEffect, useMemo, useRef, useState} from "react";
import {createPortal, flushSync} from "react-dom";
import {Box} from "~/client/web/design/box.js";
import {ContextMenuActions} from "~/client/web/design/context_menu.js";
import {FocusRing} from "~/client/web/design/focus_ring.js";
import {MenuAction} from "~/client/web/design/menu.js";
import {MenuButton} from "~/client/web/design/menu_button.js";
import {useScrollbar} from "~/client/web/design/scrollbar.js";
import {useDelayLoadingIndicator} from "~/client/web/design/use_delay_loading_indicator.js";
import {useMergedRefs} from "~/client/web/helpers/refs/use_merged_refs.js";
import {writeTextToClipboard} from "~/client/web/helpers/write_text_to_clipboard.js";
import {useNavigationBar} from "~/client/web/navigation/navigation_bar.js";
import {usePeekStackContext} from "~/client/web/peek/peek_stack_context.js";
import {usePeekContext} from "~/client/web/remix/peek_context.js";
import {usePlatform} from "~/client/web/remix/platform_context.js";
import {useRouteLayout} from "~/client/web/remix/route_layout_context.js";
import {useNavigate, useRootNavigate} from "~/client/web/remix/use_navigate.js";
import {useSearchEntityModel} from "~/client/web/search/core/search_entity_registry_context.js";
import {AddExistingEntityToSiteModal} from "~/client/web/sites/add_existing_entity_to_site_modal.js";
import {
    useCanManageSite,
    useSite,
    useSiteActiveState,
    useSiteSideBarState,
    useSiteTree,
} from "~/client/web/sites/context/site_context.js";
import {
    CollapsedSectionsState,
    isSectionCollapsed,
} from "~/client/web/sites/helpers/site_side_bar_collapsed_section_state.js";
import {useSiteMutations} from "~/client/web/sites/internal/use_site_mutations.js";
import {SiteEntrySearchEntityViewTitle} from "~/client/web/sites/site_entry_search_entity_view_title.js";
import {useSiteMenuActions} from "~/client/web/sites/site_menu_actions.js";
import {SiteNameHeader} from "~/client/web/sites/site_name_header.js";
import {useAddEntityToSiteMenuActions} from "~/client/web/sites/use_add_entity_to_site_menu_actions.js";
import {
    SiteSideBarDndRow,
    SiteSideBarDragPreview,
    indentWidthPx,
    useSiteSideBarDnd,
} from "~/client/web/sites/use_site_side_bar_dnd.js";
import {useSpaceContext} from "~/client/web/spaces/space_context.js";
import {spinAnimationClassName, sprinkles} from "~/client/web/styles/styles.js";
import {
    getAccountAccessLevelAssumingSpaceAccess,
    hasAccessLevel,
} from "~/shared/access/access_policy.js";
import {scheduleMicrotask} from "~/shared/helpers/async/schedule_microtask.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {cast} from "~/shared/helpers/control/cast.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {OrderKey, generateOrderKeyBetween} from "~/shared/helpers/sort/order_key.js";
import {SiteId, SpaceId} from "~/shared/id/types/id_types.js";
import {convertSpacePathToPeekPath} from "~/shared/remix/peek_path_helpers.js";
import {getSearchEntityNoun} from "~/shared/search/get_search_entity_noun.js";
import {getSearchDynamicEntityPath} from "~/shared/search/path/get_search_entity_path.js";
import {
    SiteContainerId,
    SiteSideBarContainerId,
    SiteSideBarSectionContainerId,
} from "~/shared/sites/site_entry_id.js";
import {
    SiteEntityModel,
    SitePreviewModelData,
    SiteSideBarModel,
    SiteSideBarSectionModel,
} from "~/shared/sites/site_model.js";

type SearchModalState = {
    readonly parentId: SiteContainerId;
    readonly getNextOrderKey: (previousOrderKey: OrderKey | null) => OrderKey;
};

/**
 * Renders the navigation content inside a site sidebar.
 *
 * - `isFullWidth` makes the sidebar fill its container and drops the trailing
 *   divider — used by the narrow site-navigate route, where the tree is the entire
 *   view rather than a column beside the entity content.
 * - `withoutNameHeader` omits the inline site-name header (the navigate route
 *   shows the site name in its own navbar instead).
 */
export function SiteSideBarContent({
    item,
    isFullWidth = false,
    withoutNameHeader = false,
    withoutContextMenu = false,
}: {
    item: SiteSideBarModel;
    isFullWidth?: boolean;
    withoutNameHeader?: boolean;
    withoutContextMenu?: boolean;
}) {
    const canManage = useCanManageSite();
    const {createSidebarSection} = useSiteMutations();
    const [searchModalState, setSearchModalState] = useState<SearchModalState | null>(null);
    const site = useSite();
    const tree = useSiteTree();
    const {collapsedSections, expandSection} = useSiteSideBarState();

    const pointerSensor = useSensor(
        PointerSensor,
        // Needs to be `useMemo()`d to avoid unnecessary re-renders.
        // https://github.com/clauderic/dnd-kit/blob/00f749bc0cc3e6582f4f887f64c1f1de65ee0081/packages/core/src/sensors/useSensor.ts#L15
        useMemo(
            () => ({
                activationConstraint: {
                    // The pointer must move to activate dragging. That way a plain click can be used
                    // to open the favorite.
                    distance: 2,
                },
            }),
            [],
        ),
    );

    const sensors = useSensors(pointerSensor);

    // When a section expands during a drag, dnd-kit's sortable transition fires on the
    // rows below as they shift down to make room — they slide into place instead of
    // appearing in a single paint. dnd-kit calls `animateLayoutChanges` on every row
    // from its `useLayoutEffect` to decide whether to animate; we flip a ref to `true`
    // inside `expandSection` so that the very next dnd-kit measurement skips the
    // animation, then clear the ref in a post-paint `useEffect` (which runs after
    // dnd-kit's layout effect).
    const justExpandedRef = useRef(false);

    const animateLayoutChangesDuringDrag = useCallback<AnimateLayoutChanges>(args => {
        if (justExpandedRef.current) return false;
        return defaultAnimateLayoutChanges(args);
    }, []);

    const onExpandSection = useCallback(
        (row: SiteSideBarDndRow & {type: "SideBarSection"}) => {
            try {
                flushSync(() => {
                    justExpandedRef.current = true;
                    expandSection(row);
                });
            } finally {
                // NOTE(ifitzsimmons, 2026-05-22): We want to re-enable animation on the next paint
                // after expansion. Scheduling a microtask ensures that it is reset after any
                // calling code finishes.
                scheduleMicrotask(() => {
                    justExpandedRef.current = false;
                });
            }
        },
        [expandSection],
    );

    const {currentlyDraggingSubtreeRows, dndContextProps, dragPreview, sortableRows} =
        useSiteSideBarDnd({
            tree,
            rootId: item.id,
            collapsedSections,
            onExpandSection,
        });

    const rootChildren = tree.getChildrenForParent(item.id);
    const firstRootChildKey = rootChildren[0]?.orderKey ?? null;
    const lastRootChildKey = rootChildren[rootChildren.length - 1]?.orderKey ?? null;
    const getRootNextOrderKey = useCallback(
        (previousOrderKey: OrderKey | null) =>
            generateOrderKeyBetween(previousOrderKey ?? lastRootChildKey, null),
        [lastRootChildKey],
    );
    const rootAddEntityMenuActions = useAddEntityToSiteMenuActions({
        parentId: item.id,
        getOrderKey: () => getRootNextOrderKey(null),
        onSearchExisting: () =>
            setSearchModalState({parentId: item.id, getNextOrderKey: getRootNextOrderKey}),
    });

    // The ghost-row "Add" button at the top of the sidebar inserts the new entry
    // directly below itself — between the start of the list and the current first
    // child. Uses its own order-key generator so multi-inserts chain correctly even
    // when the caller passes a `previousOrderKey`.
    const getGhostRowOrderKey = useCallback(
        (previousOrderKey: OrderKey | null) =>
            generateOrderKeyBetween(previousOrderKey, firstRootChildKey),
        [firstRootChildKey],
    );
    const ghostRowAddEntityMenuActions = useAddEntityToSiteMenuActions({
        parentId: item.id,
        getOrderKey: () => getGhostRowOrderKey(null),
        onSearchExisting: () =>
            setSearchModalState({parentId: item.id, getNextOrderKey: getGhostRowOrderKey}),
    });

    const rootContextMenuActions = useMemo(
        () => [
            [
                {
                    label: "Add section",
                    icon: <FolderPlus size={16} />,
                    onPress: () => {
                        createSidebarSection({
                            parentId: item.id,
                            label: "New section",
                        });
                    },
                },
                {
                    hasChildren: true,
                    key: "add-entity",
                    label: "Add entity",
                    icon: <File size={16} />,
                    actions: rootAddEntityMenuActions,
                },
            ] satisfies ReadonlyArray<MenuAction>,
        ],
        [item.id, createSidebarSection, rootAddEntityMenuActions],
    );

    const sideBarBox = (
        <>
            {canManage && (
                <MenuButton
                    placement="bottom-start"
                    actions={ghostRowAddEntityMenuActions}
                    withoutButtonElementRequirement={true}
                >
                    <Box
                        display="flex"
                        alignItems="center"
                        gap="1"
                        paddingX="2"
                        paddingBottom="1"
                        fontSize="100"
                        color="grey-40"
                        borderRadius="1"
                        cursor="pointer"
                    >
                        <Box flexShrink="0" display="flex" alignItems="center">
                            <Plus size={14} />
                        </Box>
                        <Box>Add</Box>
                    </Box>
                </MenuButton>
            )}
            <SiteSideBarNavigationList
                animateLayoutChangesDuringDrag={animateLayoutChangesDuringDrag}
                dragPreview={dragPreview}
                rows={sortableRows}
            />

            {canManage && (
                // Scope the root context menu to the empty space below the entry list. Wrapping
                // the whole sidebar would cause the root actions to merge into every entry's
                // context menu, since `<ContextMenuActions>` intentionally appends parent actions
                // to nested children — see `client/web/design/context_menu.tsx`.
                <ContextMenuActions actions={rootContextMenuActions}>
                    <Box flexGrow="1" />
                </ContextMenuActions>
            )}
        </>
    );

    const innerContent = (
        <>
            {sideBarBox}
            {searchModalState && (
                <AddExistingEntityToSiteModal
                    parentId={searchModalState.parentId}
                    getNextOrderKey={searchModalState.getNextOrderKey}
                    onClose={() => setSearchModalState(null)}
                />
            )}
        </>
    );

    // With the name header, `SiteSideBarNavigationBar` owns the scrollable column so
    // its sticky navigation bar stays pinned at the top while the tree scrolls beneath
    // it — the tree can never scroll past the bar. Without the header this is a plain
    // column: when full-width (the navigate route) an outer navbar + scroll container
    // owns scrolling, otherwise it's the scrollable sidebar column beside the entity
    // content.
    const content =
        item.id === site?.rootContainerId && !withoutNameHeader ? (
            <SiteSideBarNavigationBar site={site} withoutContextMenu={withoutContextMenu}>
                {innerContent}
            </SiteSideBarNavigationBar>
        ) : (
            <Box
                position="relative"
                display="flex"
                flexDirection="column"
                gap="0.5"
                flexShrink="0"
                overflow={isFullWidth ? undefined : "auto"}
                height={isFullWidth ? undefined : "full"}
                width={isFullWidth ? "full" : "1/4"}
                borderRight={isFullWidth ? undefined : "grey-10"}
            >
                {innerContent}
            </Box>
        );

    // Without manage access there's nothing to drag, so skip the DndContext (the
    // per-row `useSortable` calls are already `disabled`). The wrapper Box and the
    // name-header navigation bar still render — viewers need to see which site they're
    // in, they just don't get the manage affordances.
    if (!canManage) return content;

    return (
        <DndContext sensors={sensors} {...dndContextProps}>
            {content}
            <SiteDragPortals currentlyDraggingSubtreeRows={currentlyDraggingSubtreeRows} />
        </DndContext>
    );
}

/**
 * Renders portals during a drag operation: a full-screen overlay to suppress hover
 * states on other elements, and a `DragOverlay` restricted to vertical movement.
 */
function SiteDragPortals({
    currentlyDraggingSubtreeRows,
}: {
    currentlyDraggingSubtreeRows: ReadonlyArray<SiteSideBarDndRow>;
}) {
    const {active, activatorEvent} = useDndContext();

    const isPointerDragging =
        active && (activatorEvent instanceof PointerEvent || activatorEvent instanceof MouseEvent);

    return (
        <>
            {isPointerDragging &&
                createPortal(
                    <Box position="absolute" inset="0" zIndex="70" cursor="grabbing" />,
                    document.body,
                )}
            {active &&
                createPortal(
                    <DragOverlay zIndex={60}>
                        <SiteDragOverlayContent rows={currentlyDraggingSubtreeRows} />
                    </DragOverlay>,
                    document.body,
                )}
        </>
    );
}

/**
 * Content rendered inside the DragOverlay. For entities, shows the title. For
 * sections, shows the section label + all nested children as a compact tree.
 */
function SiteDragOverlayContent({rows}: {rows: ReadonlyArray<SiteSideBarDndRow>}) {
    const rootEntry = rows[0]?.entry;
    if (!rootEntry) return null;

    if (rootEntry.type === "SideBarSection") {
        return <SectionDragOverlay rows={rows} />;
    }

    return (
        <Box
            backgroundColor="grey-0"
            borderRadius="1"
            boxShadow="elevation-30"
            opacity="80"
            paddingX="2"
            paddingY="1"
            fontSize="100"
        >
            <SiteEntrySearchEntityViewTitle entry={rootEntry} />
        </Box>
    );
}

/**
 * Drag overlay for a section — renders the section label and a compact list of its
 * children so the user sees the full block they're moving.
 */
function SectionDragOverlay({rows}: {rows: ReadonlyArray<SiteSideBarDndRow>}) {
    const rootRow = assertExists(rows[0]);
    assert(rootRow.type === "SideBarSection");
    const rootDepth = rootRow.depth;
    const childRows = rows.slice(1, 6);
    const {collapsedSections} = useSiteSideBarState();

    const isRootCollapsed = isSectionCollapsed(collapsedSections, rootRow);
    return (
        <Box
            backgroundColor="grey-0"
            borderRadius="1.5"
            boxShadow="elevation-30"
            opacity="80"
            paddingX="2"
            paddingY="1.5"
            display="flex"
            flexDirection="column"
            gap="0.5"
            style={{minWidth: 180, maxWidth: 280}}
        >
            <Box display="flex" alignItems="center" gap="0.5">
                {isRootCollapsed ? <CaretRight size={12} /> : <CaretDown size={12} />}
                <Box fontSize="75" fontStyle="semi-bold" color="grey-40">
                    {rootRow.entry.label}
                </Box>
            </Box>
            {childRows.length > 0 && (
                <Box display="flex" flexDirection="column" gap="0.5" paddingLeft="1">
                    {childRows.map(childRow => (
                        <Box
                            key={childRow.entry.id}
                            fontSize="75"
                            color="grey-60"
                            style={{paddingLeft: Math.max(0, childRow.depth - rootDepth) * 8}}
                        >
                            {childRow.entry.type === "Entity" ? (
                                <SiteEntrySearchEntityViewTitle entry={childRow.entry} />
                            ) : childRow.entry.type === "SideBarSection" ? (
                                childRow.entry.label
                            ) : null}
                        </Box>
                    ))}
                    {rows.length > 6 && (
                        <Box fontSize="75" color="grey-30">
                            +{rows.length - 6} more
                        </Box>
                    )}
                </Box>
            )}
        </Box>
    );
}

function SiteSideBarNavigationList({
    animateLayoutChangesDuringDrag,
    dragPreview,
    rows,
}: {
    animateLayoutChangesDuringDrag: AnimateLayoutChanges;
    dragPreview: SiteSideBarDragPreview | null;
    rows: ReadonlyArray<SiteSideBarDndRow>;
}) {
    const sortableIds = useMemo(() => rows.map(({entry}) => entry.id), [rows]);

    if (rows.length === 0) {
        return null;
    }

    return (
        <SortableContext items={sortableIds} strategy={verticalListSortingStrategy}>
            <Box display="flex" flexDirection="column">
                {rows.map((row, index) => (
                    <SiteSideBarNavigationItem
                        key={row.entry.id}
                        animateLayoutChangesDuringDrag={animateLayoutChangesDuringDrag}
                        dragPreview={dragPreview}
                        row={row}
                        rootGroupGap={getRootGroupGap(row, rows[index - 1] ?? null)}
                    />
                ))}
            </Box>
        </SortableContext>
    );
}

/**
 * Vertical gap above a row that sits at a root-level boundary — either a
 * root-level section header, or a root-level entity following the trailing end of
 * a section's subtree. Returns `0` for rows that don't sit on such a boundary so
 * consecutive root-level entities stay tight.
 */
function getRootGroupGap(row: SiteSideBarDndRow, previousRow: SiteSideBarDndRow | null): number {
    if (previousRow === null) return 0;
    if (row.depth !== 0) return 0;
    if (row.type === "SideBarSection") return 12;
    if (previousRow.depth > 0) return 12;
    if (previousRow.type === "SideBarSection") return 12;
    return 0;
}

function SiteSideBarNavigationItem({
    animateLayoutChangesDuringDrag,
    dragPreview,
    row,
    rootGroupGap,
}: {
    animateLayoutChangesDuringDrag: AnimateLayoutChanges;
    dragPreview: SiteSideBarDragPreview | null;
    row: SiteSideBarDndRow;
    rootGroupGap: number;
}) {
    const activeState = useSiteActiveState();
    const {space} = useSpaceContext();
    const [searchModalState, setSearchModalState] = useState<SearchModalState | null>(null);
    const tree = useSiteTree();
    const {
        initialScrollTargetEntityId,
        clearInitialScrollTarget,
        collapsedSections,
        toggleSection,
    } = useSiteSideBarState();

    const canManage = useCanManageSite();
    const item = row.entry;
    const siblings = tree.getChildrenForParent(row.parentId);
    const siblingIndex = siblings.findIndex(entry => entry.id === row.entry.id);
    const previousItem = siblingIndex > 0 ? (siblings[siblingIndex - 1] ?? null) : null;
    const nextItem = siblingIndex === -1 ? null : (siblings[siblingIndex + 1] ?? null);

    const {attributes, listeners, setNodeRef, transform, transition, isDragging, active} =
        useSortable({
            id: item.id,
            data: {
                entry: {...item, position: {orderKey: item.orderKey, parentId: row.parentId}},
            },
            disabled: !canManage,
            animateLayoutChanges: animateLayoutChangesDuringDrag,
        });
    const isDragActive = !!active;

    // Scroll into view on first paint after site activation. The provider arms a
    // one-shot target via `useSiteSideBarState`; the row whose id matches consumes it
    // and clears it so subsequent navigation doesn't re-trigger the scroll.
    const rowRef = useRef<HTMLDivElement | null>(null);
    const setRowRef = useCallback(
        (el: HTMLDivElement | null) => {
            rowRef.current = el;
            setNodeRef(el);
        },
        [setNodeRef],
    );

    // Scroll into view on first paint after site activation. The provider arms a
    // one-shot target via `useSiteSideBarState`; the row whose id matches consumes it
    // and clears it so subsequent navigation doesn't re-trigger the scroll.
    useEffect(() => {
        if (row.type !== "Entity") return;
        if (!initialScrollTargetEntityId) return;
        if (initialScrollTargetEntityId !== item.id) return;

        rowRef.current?.scrollIntoView({block: "nearest"});
        clearInitialScrollTarget();
    }, [row.type, item.id, initialScrollTargetEntityId, clearInitialScrollTarget]);

    const sortableStyle = getSortableStyle({
        collapsedSections,
        dragPreview,
        isDragging,
        isActive: isDragActive,
        transform,
        transition,
    });

    const entryNode = useMemo(() => {
        switch (row.type) {
            case "SideBarSection": {
                const isExpandPreviewActive =
                    dragPreview?.type === "expand" && isSectionCollapsed(collapsedSections, row);

                return (
                    <SiteNavigationSideBarSectionItem
                        item={row.entry}
                        isCollapsed={isSectionCollapsed(collapsedSections, row)}
                        isPendingExpandTarget={
                            isExpandPreviewActive &&
                            dragPreview?.type === "expand" &&
                            dragPreview.row.entry.id === item.id
                        }
                        onSearchExisting={setSearchModalState}
                        onToggleSectionCollapseState={() => {
                            toggleSection(row);
                        }}
                    />
                );
            }
            case "Entity": {
                return (
                    <SiteNavigationEntryItem
                        item={row.entry}
                        parentId={row.parentId}
                        onSearchExisting={setSearchModalState}
                        spaceId={space.id}
                        shouldHighlight={activeState.activeEntityId === item.id && !isDragActive}
                        previousSiblingOrderKey={previousItem?.orderKey ?? null}
                        nextSiblingOrderKey={nextItem?.orderKey ?? null}
                    />
                );
            }
            default:
                throw exhaustive(row);
        }
    }, [
        row,
        dragPreview,
        collapsedSections,
        item.id,
        toggleSection,
        space.id,
        activeState.activeEntityId,
        isDragActive,
        previousItem?.orderKey,
        nextItem?.orderKey,
    ]);

    if (!entryNode) return null;

    const effectiveDepth =
        isDragging && dragPreview?.type === "move" ? dragPreview.intent.depth : row.depth;

    return (
        <div
            ref={setRowRef}
            style={{...sortableStyle, marginTop: rootGroupGap || undefined}}
            {...attributes}
            {...listeners}
        >
            <Box display="flex" alignItems="stretch">
                {Array.from({length: effectiveDepth}).map((_, depthIndex) => {
                    // We render a "depth indicator" similar to a file explorer – we draw a vertical
                    // line from the section label down to the last item in the section (similar to
                    // your IDE). So for each entry, we must draw a vertical line for each depth level.
                    // E.g.
                    //
                    // ```
                    // SideBar
                    //   Task 1
                    //   Task 2
                    //   v Section 1
                    //   |  Document
                    //   |  Chat room
                    //   |  v Section 2
                    //   |  |  Document
                    //   |  Channel
                    //   Document
                    // ```
                    return (
                        <Box
                            key={depthIndex}
                            flexShrink="0"
                            position="relative"
                            style={{width: indentWidthPx}}
                        >
                            <Box
                                position="absolute"
                                backgroundColor="grey-5"
                                style={{
                                    top: 0,
                                    bottom: 0,
                                    left: 14,
                                    width: 1,
                                }}
                            />
                        </Box>
                    );
                })}
                <Box flexGrow="1" style={{minWidth: 0}}>
                    {entryNode}
                </Box>
            </Box>
            {searchModalState && (
                <AddExistingEntityToSiteModal
                    parentId={searchModalState.parentId}
                    getNextOrderKey={searchModalState.getNextOrderKey}
                    onClose={() => setSearchModalState(null)}
                />
            )}
        </div>
    );
}

function SiteNavigationSideBarSectionItem({
    isCollapsed,
    isPendingExpandTarget,
    item,
    onSearchExisting,
    onToggleSectionCollapseState,
}: {
    isCollapsed: boolean;
    isPendingExpandTarget: boolean;
    item: SiteSideBarSectionModel;
    onSearchExisting: (state: SearchModalState) => void;
    onToggleSectionCollapseState: () => void;
}) {
    const tree = useSiteTree();
    const sectionChildren = tree.getChildrenForParent(item.id);
    const {createSidebarSection, deleteContainer, renameContainer} = useSiteMutations();
    const canManage = useCanManageSite();

    const firstChildKey = sectionChildren[0]?.orderKey ?? null;
    const getSectionNextOrderKey = useCallback(
        (previousOrderKey: OrderKey | null) =>
            generateOrderKeyBetween(previousOrderKey, firstChildKey),
        [firstChildKey],
    );
    const sectionAddEntityMenuActions = useAddEntityToSiteMenuActions({
        parentId: item.id,
        getOrderKey: () => getSectionNextOrderKey(null),
        onSearchExisting: () =>
            onSearchExisting({parentId: item.id, getNextOrderKey: getSectionNextOrderKey}),
    });

    const [isEditing, setIsEditing] = useState(false);
    const [editValue, setEditValue] = useState(item.label);
    const editInputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (isEditing) {
            editInputRef.current?.focus();
            editInputRef.current?.select();
        }
    }, [isEditing]);

    const commitRename = useCallback(() => {
        setIsEditing(false);
        const trimmed = editValue.trim();
        if (trimmed.length > 0 && trimmed !== item.label) {
            renameContainer(item.id, trimmed);
        } else {
            setEditValue(item.label);
        }
    }, [editValue, item.label, item.id, renameContainer]);

    const contextMenuActions = useMemo(() => {
        if (!canManage) return [];

        return [
            // Rename
            [
                {
                    label: "Rename",
                    icon: <PencilSimple size={16} />,
                    onPress: () => {
                        setEditValue(item.label);
                        setIsEditing(true);
                    },
                },
            ] satisfies ReadonlyArray<MenuAction>,
            // Insert actions: add inside this section
            [
                {
                    label: "Add section",
                    icon: <FolderPlus size={16} />,
                    onPress: () => {
                        createSidebarSection({
                            parentId: item.id,
                            label: "New section",
                            orderKey: generateOrderKeyBetween(null, firstChildKey),
                        });
                    },
                },
                {
                    hasChildren: true,
                    key: "add-entity",
                    label: "Add entity",
                    icon: <File size={16} />,
                    actions: sectionAddEntityMenuActions,
                },
            ] satisfies ReadonlyArray<MenuAction>,
            // Delete action
            [
                {
                    label: "Delete section",
                    icon: <Trash size={16} />,
                    isDisabled: sectionChildren.length > 0,
                    onPress: () => deleteContainer(item.id),
                },
            ] satisfies ReadonlyArray<MenuAction>,
        ];
    }, [
        canManage,
        item.id,
        sectionChildren,
        firstChildKey,
        item.label,
        createSidebarSection,
        deleteContainer,
        sectionAddEntityMenuActions,
    ]);

    return (
        <Box>
            <Box display="flex" flexDirection="column">
                <FocusRing
                    offset="border"
                    isVisible={isPendingExpandTarget}
                    shouldIgnoreFocusEvents={true}
                >
                    <Box
                        paddingX="2"
                        paddingY="1"
                        fontSize="75"
                        fontStyle="semi-bold"
                        color="grey-40"
                        borderRadius="1"
                    >
                        <ContextMenuActions actions={contextMenuActions}>
                            {isEditing ? (
                                <input
                                    ref={editInputRef}
                                    value={editValue}
                                    onChange={e => setEditValue(e.target.value)}
                                    onBlur={commitRename}
                                    onKeyDown={e => {
                                        if (e.key === "Enter") commitRename();
                                        if (e.key === "Escape") {
                                            setEditValue(item.label);
                                            setIsEditing(false);
                                        }
                                    }}
                                    style={{
                                        border: "none",
                                        outline: "none",
                                        background: "transparent",
                                        font: "inherit",
                                        color: "inherit",
                                        padding: 0,
                                        margin: 0,
                                        width: "100%",
                                    }}
                                />
                            ) : (
                                <Box
                                    display="flex"
                                    alignItems="center"
                                    gap="0.5"
                                    onClick={onToggleSectionCollapseState}
                                    onDoubleClick={
                                        canManage
                                            ? () => {
                                                  setEditValue(item.label);
                                                  setIsEditing(true);
                                              }
                                            : undefined
                                    }
                                >
                                    <Box flexShrink="0" display="flex" alignItems="center">
                                        {isCollapsed ? (
                                            <CaretRight size={12} />
                                        ) : (
                                            <CaretDown size={12} />
                                        )}
                                    </Box>
                                    <Box
                                        flexGrow="1"
                                        overflow="hidden"
                                        style={{
                                            minWidth: 0,
                                            whiteSpace: "nowrap",
                                            textOverflow: "ellipsis",
                                        }}
                                    >
                                        {item.label}
                                    </Box>
                                </Box>
                            )}
                        </ContextMenuActions>
                    </Box>
                </FocusRing>
            </Box>
        </Box>
    );
}

function SiteNavigationEntryItem({
    item,
    parentId,
    onSearchExisting,
    spaceId,
    shouldHighlight,
    previousSiblingOrderKey,
    nextSiblingOrderKey,
}: {
    item: SiteEntityModel;
    parentId: SiteSideBarContainerId | SiteSideBarSectionContainerId;
    shouldHighlight: boolean;
    previousSiblingOrderKey: OrderKey | null;
    nextSiblingOrderKey: OrderKey | null;
    onSearchExisting: (state: SearchModalState) => void;
    spaceId: SpaceId;
}) {
    const {createSidebarSection, removeEntity} = useSiteMutations();
    const canManage = useCanManageSite();
    const site = useSite();
    const entityData = useSearchEntityModel(item.entity);
    const peekStackContext = usePeekStackContext();
    assert(entityData.type !== "Static");

    const getNextOrderKeyAbove = useCallback(
        (previousOrderKey: OrderKey | null) =>
            generateOrderKeyBetween(previousOrderKey ?? previousSiblingOrderKey, item.orderKey),
        [previousSiblingOrderKey, item.orderKey],
    );
    const getNextOrderKeyBelow = useCallback(
        (previousOrderKey: OrderKey | null) =>
            generateOrderKeyBetween(previousOrderKey ?? item.orderKey, nextSiblingOrderKey),
        [item.orderKey, nextSiblingOrderKey],
    );

    const insertAboveMenuActions = useAddEntityToSiteMenuActions({
        parentId,
        getOrderKey: () => getNextOrderKeyAbove(null),
        onSearchExisting: () => onSearchExisting({parentId, getNextOrderKey: getNextOrderKeyAbove}),
        onCreateSection: () => {
            createSidebarSection({
                parentId,
                label: "New section",
                orderKey: getNextOrderKeyAbove(null),
            });
        },
    });
    const insertBelowMenuActions = useAddEntityToSiteMenuActions({
        parentId,
        getOrderKey: () => getNextOrderKeyBelow(null),
        onSearchExisting: () => onSearchExisting({parentId, getNextOrderKey: getNextOrderKeyBelow}),
        onCreateSection: () => {
            createSidebarSection({
                parentId,
                label: "New section",
                orderKey: getNextOrderKeyBelow(null),
            });
        },
    });

    const contextMenuActions = useMemo(() => {
        if (!canManage) return [];

        return [
            [
                {
                    hasChildren: true,
                    key: "insert-above",
                    label: "Insert above",
                    icon: <ArrowLineUp size={16} />,
                    actions: insertAboveMenuActions,
                },
                {
                    hasChildren: true,
                    key: "insert-below",
                    label: "Insert below",
                    icon: <ArrowLineDown size={16} />,
                    actions: insertBelowMenuActions,
                },
            ] satisfies ReadonlyArray<MenuAction>,
            [
                {
                    label: "Copy link",
                    icon: <LinkIcon size={16} />,
                    pressErrorTitle: "Couldn\u2019t copy link",
                    onPress: async () => {
                        const url = new URL(
                            getSearchDynamicEntityPath(spaceId, entityData, "wide"),
                            window.location.href,
                        );
                        await writeTextToClipboard(url.toString());
                    },
                },
                {
                    label: "Open in peek",
                    pressErrorTitle: "Couldn\u2019t open in peek",
                    onPress: async () => {
                        const path = getSearchDynamicEntityPath(spaceId, entityData, "wide");
                        await peekStackContext.push(path);
                    },
                },
            ] satisfies ReadonlyArray<MenuAction>,
            [
                {
                    label: `Remove ${getSearchEntityNoun(entityData.type)} from site`,
                    icon: <MinusCircle size={16} />,
                    pressErrorTitle: "Couldn\u2019t remove entity from site",
                    onPress: async () => {
                        await removeEntity(item.id);
                    },
                },
            ] satisfies ReadonlyArray<MenuAction>,
        ];
    }, [
        canManage,
        item.id,
        entityData,
        removeEntity,
        insertAboveMenuActions,
        insertBelowMenuActions,
        spaceId,
        peekStackContext,
    ]);

    return (
        <ContextMenuActions actions={contextMenuActions}>
            <Box>
                <SiteNavLink
                    pathname={getSearchDynamicEntityPath(spaceId, entityData, "wide")}
                    activeSiteId={site.id}
                    isActive={shouldHighlight}
                >
                    <Box display="flex" alignItems="center" gap="1" width="full">
                        <Box
                            flexGrow="1"
                            overflow="hidden"
                            style={{
                                minWidth: 0,
                                whiteSpace: "nowrap",
                                textOverflow: "ellipsis",
                            }}
                        >
                            <SiteEntrySearchEntityViewTitle entry={item} />
                        </Box>
                    </Box>
                </SiteNavLink>
            </Box>
        </ContextMenuActions>
    );
}

/**
 * Sidebar navigation link.
 *
 * Rendered as a native `<a href>` rather than a `<Box>` + `usePress` because the
 * parent row is a dnd-kit draggable, and the two patterns conflict:
 *
 * - **`usePress` (react-aria, the pattern in `client/web/design/link.tsx`) breaks
 *   drag here.** Its `onPointerDown` handler calls `e.stopPropagation()` (see
 *   `@react-aria/interactions/src/usePress.ts`, ~line 462), so dnd-kit's
 *   `MouseSensor` attached to the row wrapper above this component never sees the
 *   pointerdown and can't evaluate its activation `delay` to start a drag.
 *   `setPointerCapture` is not the culprit; the `stopPropagation` call is.
 * - **Native `<a>` + manual handlers do not stop propagation.** The pointerdown
 *   bubbles to the row wrapper, the sensor's `delay` constraint distinguishes
 *   click (release < delay) from drag (hold ≥ delay), and a real anchor also gives
 *   us middle-click / cmd-click "open in new tab" and "Copy link address" for
 *   free.
 *
 * Press visual state is tracked manually via `onPointerDown` / `onPointerUp` /
 * `onPointerCancel` / `onPointerLeave` (the subset of what `usePress` does that we
 * actually need), so it works correctly alongside drag. Three layered background
 * states:
 *
 * - **Pressed** (`grey-10`): instant feedback while the pointer is down. Overrides
 *   everything; clears on release.
 * - **Pending navigation** (`grey-5`): the row was clicked and the route is
 *   resolving. Same color as the active state so the row "selects" instantly on
 *   click and stays selected when the route lands.
 * - **Active** (`grey-5`): the route resolved and this row matches the active
 *   entity. Driven by `isActive` from props.
 *
 * A `SpinnerGap` icon appears at the right edge of the row if the navigation is
 * still pending after the standard delay-loading-indicator threshold — kept off
 * the fast path so warm-cache navigations don't flash a spinner.
 *
 * `draggable={false}` suppresses the browser's native HTML5 link-drag (the "drag
 * this link onto another window" behavior), which would otherwise compete with
 * dnd-kit's drag.
 *
 * Modifier-clicks (cmd/ctrl/shift/alt) and non-primary buttons fall through to the
 * browser so "open in new tab" etc. keep working — at the cost of not carrying the
 * `cyberworlds-active-site-id` header, which is fine since a new tab boots a fresh
 * session anyway.
 */
function SiteNavLink({
    pathname,
    activeSiteId,
    isActive,
    children,
}: {
    pathname: string;
    activeSiteId: SiteId;
    isActive: boolean;
    children: ReactNode;
}) {
    const navigate = useNavigate();
    const rootNavigate = useRootNavigate();
    const routeLayout = useRouteLayout();
    const peekContext = usePeekContext();
    const site = useSite();

    const [isPressed, setIsPressed] = useState(false);
    const [isPendingNavigation, setIsPendingNavigation] = useState(false);
    // Debounce the spinner so fast warm-cache navigations don't flash it. Mirrors the
    // pattern in `add_existing_entity_to_site_modal.tsx`, `site_name_editor.tsx`, and
    // `switch.tsx`.
    const shouldShowPendingSpinner = useDelayLoadingIndicator(isPendingNavigation);

    const backgroundColor = isPressed
        ? "grey-10"
        : isPendingNavigation || isActive
          ? "grey-5"
          : undefined;

    const onNavigateToEntity = useCallback(() => {
        const path = {pathname, search: "", hash: ""};

        if (routeLayout === "narrow") {
            // Inside a peek, navigate to the matching peek path so the entity opens within the
            // same overlay rather than stacking a new peek or replacing the page. On mobile
            // there's no peek, so navigate the page directly.
            const to = peekContext ? (convertSpacePathToPeekPath(path) ?? path) : path;
            return navigate(to, {
                unstable_headers: {"cyberworlds-active-site-id": site.id},
            });
        }

        return rootNavigate(path, {
            unstable_headers: {
                "cyberworlds-active-site-id": activeSiteId,
            },
        });
    }, [pathname, routeLayout, rootNavigate, activeSiteId, peekContext, navigate, site.id]);

    return (
        <Box position="relative">
            <a
                href={pathname}
                draggable={false}
                onPointerDown={event => {
                    if (event.button !== 0) return;
                    setIsPressed(true);
                }}
                onPointerUp={() => setIsPressed(false)}
                onPointerCancel={() => setIsPressed(false)}
                onPointerLeave={() => setIsPressed(false)}
                onClick={event => {
                    if (event.defaultPrevented) return;
                    if (event.button !== 0) return;
                    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
                        return;
                    }
                    event.preventDefault();

                    // In narrow routes, we render the site side bar without the entity content. So
                    // when an entity is active in a narrow view, it simply means that the entry is
                    // highlighted in the navigation pane. Clicking on the "active" entry should open
                    // that entity in peek/mobile.
                    if (isActive && routeLayout !== "narrow") return;
                    if (isPendingNavigation) return;

                    setIsPendingNavigation(true);
                    // When an override is present (the narrow site route's sidebar) it owns navigation
                    // so activating an entry stays within the current peek. Otherwise navigate the
                    // root router, carrying the active-site header so the destination reuses the live
                    // realtime subscription.
                    void onNavigateToEntity().finally(() => {
                        setIsPendingNavigation(false);
                    });
                }}
                className={sprinkles({
                    display: "flex",
                    alignItems: "center",
                    paddingX: "2",
                    paddingY: "1",
                    borderRadius: "1",
                    fontSize: "100",
                    backgroundColor,
                    cursor: "default",
                })}
                style={{color: "inherit", textDecoration: "none"}}
            >
                {children}
                {shouldShowPendingSpinner && (
                    <Box
                        display="flex"
                        alignItems="center"
                        flexShrink="0"
                        marginLeft="1"
                        color="grey-50"
                    >
                        <SpinnerGap className={spinAnimationClassName} size={12} />
                    </Box>
                )}
            </a>
        </Box>
    );
}

function getSortableStyle({
    collapsedSections,
    dragPreview,
    isDragging,
    isActive,
    transform,
    transition,
}: {
    collapsedSections: CollapsedSectionsState;
    dragPreview: SiteSideBarDragPreview | null;
    isDragging: boolean;
    isActive: boolean;
    transform: {x: number; y: number} | null;
    transition: string | undefined;
}): CSSProperties {
    const styleBase: CSSProperties = {
        transform:
            isActive && transform ? `translate(${transform.x}px, ${transform.y}px)` : undefined,
        transition: isActive ? transition : undefined,
    };

    if (!isDragging || !dragPreview) {
        return styleBase;
    }

    if (dragPreview.type === "move") {
        return {...styleBase, opacity: 0.3};
    } else if (
        dragPreview?.type === "expand" &&
        isSectionCollapsed(collapsedSections, dragPreview.row)
    ) {
        return {
            ...styleBase,
            opacity: 0,
            pointerEvents: "none",
        };
    } else {
        return {...styleBase, opacity: 0.3};
    }
}

function SiteSideBarNavigationBar({
    site,
    withoutContextMenu,
    children,
}: {
    site: SitePreviewModelData;
    withoutContextMenu: boolean;
    children: ReactNode;
}) {
    const {currentAccount} = useSpaceContext();
    const platform = usePlatform();
    const canManage = useCanManageSite();
    const [searchParams, setSearchParams] = useSearchParams();

    const shouldFocusNameInput = searchParams.get("focus") === "name";

    const [isEditingNameInline, setIsEditingNameInline] = useState(
        canManage && platform !== "mobile" && shouldFocusNameInput,
    );
    if (isEditingNameInline && platform === "mobile") setIsEditingNameInline(false);

    const accessPolicy = site.accessPolicy;

    const accessLevel = useMemo(
        () => getAccountAccessLevelAssumingSpaceAccess(accessPolicy, currentAccount?.id),
        [accessPolicy, currentAccount?.id],
    );

    // Strip the consumed `?focus` param so a refresh doesn't replay it and it doesn't
    // end up in shared links.
    useEffect(() => {
        if (!searchParams.has("focus")) return;
        const newSearchParams = new URLSearchParams(searchParams);
        newSearchParams.delete("focus");
        setSearchParams(newSearchParams, {replace: true});
    }, [searchParams, setSearchParams]);

    const overflowMenuActions = useSiteMenuActions({
        editSiteNameAction:
            hasAccessLevel(accessLevel, "Manage") && platform !== "mobile"
                ? cast<MenuAction>({
                      label: "Edit name",
                      onPress: () => {
                          setIsEditingNameInline(true);
                      },
                  })
                : undefined,
    });

    const {navigationBar, scrollViewRef, effectiveNavigationBarHeight, scrollbarInsetTop} =
        useNavigationBar({
            title: (
                <SiteNameHeader
                    site={site}
                    setIsEditingNameInline={setIsEditingNameInline}
                    isEditingNameInline={isEditingNameInline}
                />
            ),
            withoutDisappearingTitle: true,
            menuActions: withoutContextMenu ? undefined : overflowMenuActions,
            desktopTitleFontSize: "400",
            desktopTitleFontWeight: "bold",
            desktopTitleLeftSlop: "1",
            titleJustifyContent: "flex-start",
        });
    return (
        <Box
            ref={useMergedRefs<HTMLDivElement>(
                scrollViewRef,
                useScrollbar({insetTop: scrollbarInsetTop}),
            )}
            flexShrink="0"
            overflow="auto"
            height="full"
            width="1/4"
            borderRight="grey-10"
            position="relative"
        >
            {/* The navigation bar must render inside a `position: relative` wrapper
            containing all of the scroll view's content (see `NavigationBarResult`) — that's
            what lets the bar stick to the top of the column while the tree scrolls beneath
            it. The spacer reserves the bar's height in the flow since the bar itself is
            absolutely positioned. */}
            <Box display="flex" flexDirection="column" gap="0.5" minHeight="full">
                {navigationBar}
                <Box flexShrink="0" style={{height: effectiveNavigationBarHeight}} />
                <Box paddingTop="1">{children}</Box>
            </Box>
        </Box>
    );
}
