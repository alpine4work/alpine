import {Link as LinkIcon, Plus} from "phosphor-react";
import {useCallback, useImperativeHandle, useMemo, useRef, useState} from "react";
import {AccountAvatar} from "~/client/web/accounts/account_avatar.js";
import {Box} from "~/client/web/design/box.js";
import {Button} from "~/client/web/design/button.js";
import {MenuAction} from "~/client/web/design/menu.js";
import {MobileFullScreenModal} from "~/client/web/design/mobile_full_screen_modal.js";
import {navigationBarHeight} from "~/client/web/design/navigation_bar_helpers.js";
import {safeAreaOnlyScrollbarInsetTop} from "~/client/web/design/scrollbar.js";
import {Spacer} from "~/client/web/design/spacer.js";
import {GlobalKeyDownEvent} from "~/client/web/helpers/global_key_down_event.js";
import {useEvent, useEvents} from "~/client/web/helpers/lifecycle/use_event.js";
import {useLayoutEffectWithoutServerSideWarning} from "~/client/web/helpers/lifecycle/use_layout_effect_without_server_side_warning.js";
import {writeTextToClipboard} from "~/client/web/helpers/write_text_to_clipboard.js";
import {useNavigationBar} from "~/client/web/navigation/navigation_bar.js";
import {useClientInfo} from "~/client/web/remix/client_info_context.js";
import {NativeMobileBridge} from "~/client/web/remix/native_mobile_bridge.js";
import {usePlatform} from "~/client/web/remix/platform_context.js";
import {useRouteLayout} from "~/client/web/remix/route_layout_context.js";
import {useSpacingScale} from "~/client/web/remix/spacing_scale_context.js";
import {useCurrentDate} from "~/client/web/remix/use_current_time_rounded_to_hour.js";
import {useSpaceContext} from "~/client/web/spaces/space_context.js";
import {inputPlaceholderStyles, tasksStyles} from "~/client/web/styles/styles.js";
import {
    defaultTaskQueryViewName,
    taskQueryViewCustomizationMobileLayoutMarginTop,
    taskQueryViewCustomizationMobileSectionMarginBottom,
} from "~/client/web/styles/tasks_shared_styles.js";
import {TaskClientQuery} from "~/client/web/tasks/core/task_client_query.js";
import {
    TaskClientStore,
    TaskClientStoreSearchAffinityManager,
} from "~/client/web/tasks/core/task_client_store.js";
import {TaskFloatingCreateButton} from "~/client/web/tasks/internal/task_floating_create_button.js";
import {useTaskGridViewVirtualizedList} from "~/client/web/tasks/internal/task_grid_view_virtualized_list.js";
import {TaskGridViewVirtualizedListViewRef} from "~/client/web/tasks/internal/task_grid_view_virtualized_list_types.js";
import {TaskQueryMobileEditor} from "~/client/web/tasks/internal/task_query_mobile_editor.js";
import {useTaskQueryReferencesForUrlGrantFilterEditor} from "~/client/web/tasks/internal/task_query_references_for_url_grant_filter_editor.js";
import {
    TaskQueryViewCustomizationBar,
    TaskQueryViewCustomizationBarRef,
} from "~/client/web/tasks/internal/task_query_view_customization_bar.js";
import {
    TaskQueryViewCustomizationMobileSection,
    TaskQueryViewCustomizationMobileSectionRef,
} from "~/client/web/tasks/internal/task_query_view_customization_mobile_section.js";
import {
    TaskQueryViewDesktopHeader,
    TaskQueryViewDesktopHeaderRef,
} from "~/client/web/tasks/internal/task_query_view_desktop_header.js";
import {
    TaskQueryViewDesktopHeaderName,
    TaskQueryViewDesktopHeaderNameRef,
} from "~/client/web/tasks/internal/task_query_view_desktop_header_name.js";
import {useOutOfBoundsClickSelection} from "~/client/web/tasks/internal/use_out_of_bounds_click_selection.js";
import {useTaskQueryState} from "~/client/web/tasks/use_task_query_state.js";
import {
    VirtualizedScrollView,
    VirtualizedScrollViewRef,
    VirtualizedScrollViewRenderItem,
} from "~/client/web/virtualized/virtualized_scroll_view.js";
import {convertRemLengthToPx, screenPaddingX, spacing} from "~/shared/design/core/spacing.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {TaskGridViewExpansionState} from "~/shared/tasks/task_grid_view_expansion_state.js";
import {
    TaskQueryFilter,
    serializeTaskQueryFiltersSearchParam,
} from "~/shared/tasks/task_query_filter.js";
import {
    TaskQueryFilterReferences,
    mergeTaskQueryFilterReferences,
} from "~/shared/tasks/task_query_filter_references.js";
import {normalizeTaskQueryFilters} from "~/shared/tasks/task_query_normalized_filters.js";
import {normalizeTaskQuerySorts} from "~/shared/tasks/task_query_normalized_sort.js";
import {TaskQuerySort, serializeTaskQuerySortsSearchParam} from "~/shared/tasks/task_query_sort.js";

export function TaskQueryView({
    store,
    affinityManager,
    initialQuery,
    initialName,
    onNameChange,
    initialFilters,
    initialFilterReferences,
    onFiltersChange,
    initialSorts,
    onSortsChange,
}: {
    store: TaskClientStore;
    affinityManager: TaskClientStoreSearchAffinityManager;
    initialQuery: {
        query: TaskClientQuery;
        initialGridViewExpansionState: TaskGridViewExpansionState;
    } | null;
    initialName: string;
    onNameChange: (name: string) => void;
    initialFilters: ReadonlyArray<TaskQueryFilter>;
    initialFilterReferences: TaskQueryFilterReferences;
    onFiltersChange: (filters: ReadonlyArray<TaskQueryFilter>) => void;
    initialSorts: ReadonlyArray<TaskQuerySort>;
    onSortsChange: (sorts: ReadonlyArray<TaskQuerySort>) => void;
}) {
    const platform = usePlatform();
    const routeLayout = useRouteLayout();
    const spacingScale = useSpacingScale();
    const {isAppleDevice} = useClientInfo();
    const currentDate = useCurrentDate();
    const {space, currentAccount} = useSpaceContext();

    const desktopHeaderRef = useRef<TaskQueryViewDesktopHeaderRef>(null);
    const navigationBarDesktopNameRef = useRef<TaskQueryViewDesktopHeaderNameRef>(null);
    const mobileCustomizationSectionRef = useRef<TaskQueryViewCustomizationMobileSectionRef>(null);
    const desktopCustomizationSectionRef = useRef<TaskQueryViewCustomizationBarRef>(null);

    const [name, actuallySetName] = useState(initialName);

    const setName = useEvent((name: string) => {
        actuallySetName(name);
        onNameChange(name);
    });

    const [
        {filters, filterReferences, shouldOpenFirstCollectionsFilterOperationValueRef},
        actuallySetFiltersState,
    ] = useState({
        filters: initialFilters,
        filterReferences: initialFilterReferences,
        shouldOpenFirstCollectionsFilterOperationValueRef: {current: false},
    });

    // After a render that asks for the first collection filter to be opened, go
    // ahead and attempt to open.
    useLayoutEffectWithoutServerSideWarning(() => {
        if (!shouldOpenFirstCollectionsFilterOperationValueRef.current) return;
        // eslint-disable-next-line react-compiler/react-compiler
        shouldOpenFirstCollectionsFilterOperationValueRef.current = false;

        if (routeLayout !== "narrow") {
            assertExists(desktopHeaderRef.current).openFirstCollectionsFilterOperationValue();
        } else if (platform === "mobile") {
            assertExists(
                mobileCustomizationSectionRef.current,
            ).openFirstCollectionsFilterOperationValue();
        } else {
            assertExists(
                desktopCustomizationSectionRef.current,
            ).openFirstCollectionsFilterOperationValue();
        }
    }, [platform, routeLayout, shouldOpenFirstCollectionsFilterOperationValueRef]);

    const [sorts, actuallySetSorts] = useState(initialSorts);

    const {undoEvent, redoEvent, updateFilters, setSorts} = useEvents({
        undoEvent: () => undo(),
        redoEvent: () => redo(),

        updateFilters: (
            filters: ReadonlyArray<TaskQueryFilter>,
            {
                mergeFilterReferences,
                shouldOpenFirstCollectionsFilterOperationValue,
            }: {
                mergeFilterReferences?: TaskQueryFilterReferences;
                shouldOpenFirstCollectionsFilterOperationValue?: boolean;
            } = {},
        ) => {
            actuallySetFiltersState(({filterReferences}) => {
                const newFilterReferences = mergeFilterReferences
                    ? mergeTaskQueryFilterReferences(filterReferences, mergeFilterReferences)
                    : filterReferences;

                return {
                    filters,
                    filterReferences: newFilterReferences,
                    shouldOpenFirstCollectionsFilterOperationValueRef:
                        shouldOpenFirstCollectionsFilterOperationValue
                            ? {current: true}
                            : {current: false},
                };
            });

            onFiltersChange(filters);
        },
        setSorts: (sorts: ReadonlyArray<TaskQuerySort>) => {
            actuallySetSorts(sorts);
            onSortsChange(sorts);
        },
    });

    const normalizedFiltersResult = useMemo(
        () =>
            normalizeTaskQueryFilters(filters, {
                currentDate,
                currentAccountId: currentAccount?.id ?? null,
            }),
        [currentAccount?.id, currentDate, filters],
    );

    const normalizedSorts = useMemo(() => normalizeTaskQuerySorts(sorts), [sorts]);

    const queryState = useTaskQueryState({
        store,
        initialQuery,
        filters:
            normalizedFiltersResult.type === "Possible"
                ? normalizedFiltersResult.normalizedFilters
                : null,
        sorts: normalizedSorts,
    });

    // If the actor doesn't have space access then we need to keep track of any
    // accounts/collections referenced by the query. This is expensive (O(tasks))
    // so it's important to only run this when `currentAccount` is null.
    const queryReferencesForUrlGrant = useTaskQueryReferencesForUrlGrantFilterEditor(
        !currentAccount ? queryState.activeQuery.query?.query ?? null : null,
    );

    const [shouldShowEditNameMobileModal, setShouldShowEditNameMobileModal] = useState(false);

    const menuActions = useMemo(() => {
        const menuActions: Array<Array<MenuAction>> = [];

        menuActions.push([
            {
                label: "Copy link",
                icon: <LinkIcon />,
                iconPlacement: "end",
                pressErrorTitle: "Couldn’t copy view link",
                onPress: async () => {
                    const url = new URL(`/s/${space.id}/tasks/view`, window.location.href);

                    if (name !== defaultTaskQueryViewName) {
                        url.searchParams.set("name", name);
                    }

                    if (filters.length > 0) {
                        url.searchParams.set(
                            "filter",
                            serializeTaskQueryFiltersSearchParam(filters),
                        );
                    }

                    if (sorts.length > 0) {
                        url.searchParams.set("sort", serializeTaskQuerySortsSearchParam(sorts));
                    }

                    await writeTextToClipboard(url.toString());
                },
            },
        ]);

        menuActions.push([
            {
                label: "Edit name",
                onPress: () => {
                    if (routeLayout !== "narrow") {
                        assertExists(desktopHeaderRef.current).editName();
                    } else if (platform !== "mobile") {
                        assertExists(navigationBarDesktopNameRef.current).editName();
                    } else {
                        setShouldShowEditNameMobileModal(true);
                    }
                },
            },
        ]);

        menuActions.push([
            {
                label: "Undo",
                keyboardShortcutHint: isAppleDevice ? "⌘+Z" : "Ctrl+Z",
                onPress: undoEvent,
            },
            {
                label: "Redo",
                keyboardShortcutHint: isAppleDevice ? "⌘+Y" : "Ctrl+Y",
                onPress: redoEvent,
            },
        ]);

        return menuActions;
    }, [
        filters,
        isAppleDevice,
        name,
        platform,
        redoEvent,
        routeLayout,
        sorts,
        space.id,
        undoEvent,
    ]);

    const viewRef = useRef<VirtualizedScrollViewRef>(null);
    const gridViewRef = useRef<TaskGridViewVirtualizedListViewRef>(null);

    const itemCountBeforeGridView = routeLayout === "narrow" ? 1 : 0;

    const shiftRenderedRangeForGridView = useCallback(
        (range: {startIndex: number; endIndex: number} | null) => {
            if (!range) {
                return null;
            } else {
                const startIndex = range.startIndex - itemCountBeforeGridView;
                const endIndex = range.endIndex - itemCountBeforeGridView;
                if (endIndex < 0) {
                    return null;
                } else {
                    return {
                        startIndex: Math.max(0, startIndex),
                        endIndex,
                    };
                }
            }
        },
        [itemCountBeforeGridView],
    );

    // Offset all the methods on our `VirtualizedScrollViewRef` by the number of
    // items which precede our children grid view.
    useImperativeHandle(
        gridViewRef,
        () => ({
            getHeight: () => assertExists(viewRef.current).getHeight(),
            getContentHeight: () => assertExists(viewRef.current).getContentHeight(),
            getScrollOffset: () => assertExists(viewRef.current).getScrollOffset(),
            setScrollOffset: scrollOffset =>
                assertExists(viewRef.current).setScrollOffset(scrollOffset),
            scrollToIndex: (index, options) =>
                assertExists(viewRef.current).scrollToIndex(
                    index + itemCountBeforeGridView,
                    options,
                ),
            getRenderedRange: () =>
                shiftRenderedRangeForGridView(assertExists(viewRef.current).getRenderedRange()),
            getKeyByIndexIfExists: index =>
                assertExists(viewRef.current).getKeyByIndexIfExists(
                    index + itemCountBeforeGridView,
                ),
            getIndexByKeyIfExists: key => {
                const index = assertExists(viewRef.current).getIndexByKeyIfExists(key);
                if (index === null) return index;
                return index - itemCountBeforeGridView;
            },
            getPositionByIndex: index =>
                assertExists(viewRef.current).getPositionByIndex(index + itemCountBeforeGridView),
            getPositionByKeyIfExists: key =>
                assertExists(viewRef.current).getPositionByKeyIfExists(key),
            peekRenderedRangeAfterSetScrollOffset: scrollOffset =>
                shiftRenderedRangeForGridView(
                    assertExists(viewRef.current).peekRenderedRangeAfterSetScrollOffset(
                        scrollOffset,
                    ),
                ),
            getElement: () => assertExists(viewRef.current).getElement(),
            getContentElement: () => assertExists(viewRef.current).getContentElement(),
            getElementByKeyIfExists: key =>
                assertExists(viewRef.current).getElementByKeyIfExists(key),
        }),
        [itemCountBeforeGridView, shiftRenderedRangeForGridView],
    );

    const defaultOrderSentence = "Tasks are ordered by created date.";

    const {
        stateKey: gridViewStateKey,
        bufferedItemHeight: gridViewBufferedItemHeight,
        modals: gridViewModals,
        itemCount: gridViewItemCount,
        renderItem: renderGridViewItem,
        onRenderedRangeChange: onGridViewRenderedRangeChange,
        onRenderedRangeLayoutChange: onGridViewRenderedRangeLayoutChange,
        alwaysRenderAdditionalItemIndexes: alwaysRenderAdditionalGridViewItemIndexes,
        scrollbarInsetTopItemIndex: scrollbarInsetTopGridViewItemIndex,
        onGlobalKeyDown: onGridViewGlobalKeyDown,
        focusEnd: focusGridViewEnd,
        undo,
        redo,
    } = useTaskGridViewVirtualizedList({
        capabilities: useMemo(() => {
            if (routeLayout !== "narrow") {
                return {
                    isReadOnly: false,
                    hasParentTaskTitle: true,
                    hasMultilineTitle: false,
                    hasDenseFields: false,
                    hasColumns: true,
                    withoutAssigneeField: false,
                };
            } else {
                return {
                    isReadOnly: false,
                    hasParentTaskTitle: true,
                    hasMultilineTitle: true,
                    hasDenseFields: true,
                    hasColumns: false,
                    withoutAssigneeField: false,
                };
            }
        }, [routeLayout]),
        viewRef: itemCountBeforeGridView !== 0 ? gridViewRef : viewRef,
        store,
        affinityManager,
        query: queryState.activeQuery.query,
        withoutBorderTopIfFirstRow: routeLayout !== "narrow",
        // Don't render the three decorative ghost rows on mobile when we're rendering
        // the instructional view component. This allows us to visually center the new
        // view instructions.
        withoutDecorativeGhostRowsIfEmpty:
            routeLayout === "narrow" &&
            platform === "mobile" &&
            !queryState.activeQuery.isAvailable &&
            queryState.activeQuery.isMissingRequiredFilters,
        // NOTE(calebmer): Currently, all updates which use this are disabled in
        // auto-sorted views:
        //
        // - Shift-tab to unnest task
        // - Enter to create task
        // - Drag/drop to move task
        // - Type in ghost row to create task
        //
        // Some of these make sense to disable in auto-sorted views like drag/drop to
        // move task. However, it would be nice to get some behaviors like "Enter to
        // create task" working. Right now, you can't create tasks inline in an
        // auto-sorted view which is unfortunate.
        //
        // At Airtable, when you had focus in a row that was either filtered out of the
        // view or moved we gave it a "pinned" row treatment. Rendered an orange box
        // around it and maintained the row in its old position. This behavior...wasn't
        // universally loved so there's probably room for improvement. But something
        // similar where you hit enter and it gives you a pinned row you can fill out
        // before unfocusing seems nice. Though maybe creating a task through a detail
        // view is actually a better experience?
        //
        // Another thought is when adding a task to a query we need to make sure it has
        // values that match our filters. For some filters like `priority = High`,
        // that's easy. For other filters like `priority = High || priority = Low` we
        // could initially set a reasonable value like `Low` even though it's ambiguous.
        //
        // I'm not implementing a solution here, for now, because pinned rows are
        // tricky (though not impossible) to implement. (You need to setup a separate
        // task subscription for the pinned row.) And because it's not clear to me what
        // the best UX here is. Disabling a bunch of behavior doesn't feel right though.
        getMoveTaskToQueryActions: () => [],
        // Can't remove task from custom view query. That would require updating
        // filtered fields in potentially unexpected ways. For instance if it's filter
        // to `priority = null` then what do we do? Assign the `Low` priority? This
        // would be surprising to users.
        //
        // Features which depend on this should be disabled by
        // `isTaskQueryManuallySorted()` checks. Namely drag-and-drop at the root query
        // level (subtasks are fine) and tab/shift-tab to indent.
        getMaybeRemoveTaskFromQueryActions: () => [],
        columnHeaderControls: useMemo(() => {
            // We don't have sticky column header controls when rendering in a mobile
            // layout. Instead we render a navigation bar and render filters/sorts at the
            // top of the view in a non-sticky manner.
            //
            // We do this for peeks too.
            if (routeLayout === "narrow") return;

            return {
                minHeight: spacing[navigationBarHeight],
                node: (
                    <TaskQueryViewDesktopHeader
                        ref={desktopHeaderRef}
                        store={store}
                        queryReferencesForUrlGrant={queryReferencesForUrlGrant}
                        menuActions={menuActions}
                        defaultOrderSentence={defaultOrderSentence}
                        name={name}
                        onNameChange={setName}
                        filters={filters}
                        filterReferences={filterReferences}
                        onFiltersChange={updateFilters}
                        sorts={sorts}
                        onSortsChange={setSorts}
                    />
                ),
            };
        }, [
            filterReferences,
            filters,
            menuActions,
            name,
            queryReferencesForUrlGrant,
            routeLayout,
            setName,
            setSorts,
            sorts,
            store,
            updateFilters,
        ]),
    });

    const {scrollViewRef, navigationBar, scrollbarInsetTop} = useNavigationBar({
        isDisabled: routeLayout !== "narrow",
        withoutDisappearingTitle: true,
        title:
            platform === "mobile" ? (
                name
            ) : (
                <TaskQueryViewDesktopHeaderName
                    ref={navigationBarDesktopNameRef}
                    name={name}
                    onNameChange={setName}
                />
            ),
        menuActions,
    });

    const renderItem: VirtualizedScrollViewRenderItem = useCallback(
        index => {
            if (routeLayout === "narrow" && index === 0) {
                return {
                    key: "CustomizationBar",
                    minHeight: spacing[navigationBarHeight],
                    node: (
                        <Box paddingTop="safe-area-inset">
                            <Box height={navigationBarHeight} />
                            {platform === "mobile" ? (
                                <TaskQueryViewCustomizationMobileSection
                                    ref={mobileCustomizationSectionRef}
                                    store={store}
                                    queryReferencesForUrlGrant={queryReferencesForUrlGrant}
                                    // Filters and sorts are always visible in a query view.
                                    initialAreFiltersVisible={true}
                                    initialAreSortsVisible={true}
                                    defaultOrderSentence={defaultOrderSentence}
                                    filters={filters}
                                    filterReferences={filterReferences}
                                    onFiltersChange={updateFilters}
                                    sorts={sorts}
                                    onSortsChange={setSorts}
                                />
                            ) : (
                                <Box
                                    paddingX={screenPaddingX}
                                    paddingTop={taskQueryViewCustomizationMobileLayoutMarginTop}
                                    paddingBottom={
                                        taskQueryViewCustomizationMobileSectionMarginBottom
                                    }
                                >
                                    <TaskQueryViewCustomizationBar
                                        ref={desktopCustomizationSectionRef}
                                        store={store}
                                        queryReferencesForUrlGrant={queryReferencesForUrlGrant}
                                        shouldCollapseWhenFiltersAreEmpty={false}
                                        defaultOrderSentence={defaultOrderSentence}
                                        filters={filters}
                                        filterReferences={filterReferences}
                                        onFiltersChange={updateFilters}
                                        sorts={sorts}
                                        onSortsChange={setSorts}
                                    />
                                </Box>
                            )}
                        </Box>
                    ),
                };
            }

            return renderGridViewItem(index - itemCountBeforeGridView);
        },
        [
            filterReferences,
            filters,
            itemCountBeforeGridView,
            platform,
            queryReferencesForUrlGrant,
            renderGridViewItem,
            routeLayout,
            setSorts,
            sorts,
            store,
            updateFilters,
        ],
    );

    return (
        <Box
            position="relative"
            zIndex="0"
            flexGrow="1"
            width="full"
            overflow="hidden"
            backgroundColor="grey-0"
            className={
                queryState.activeQuery ? tasksStyles.textCursorNotInherited2ClassName : undefined
            }
            {...useOutOfBoundsClickSelection({
                isDisabled: !queryState.activeQuery,
                // Accept clicks on our `<VirtualizedScrollView>` child too.
                accept: event =>
                    event.target === event.currentTarget ||
                    (event.target instanceof Element &&
                        event.target.parentElement === event.currentTarget),
                onSelect: () => focusGridViewEnd(),
                onSelectAll: () => focusGridViewEnd(),
            })}
        >
            {gridViewModals}
            <GlobalKeyDownEvent onGlobalKeyDown={onGridViewGlobalKeyDown}>
                <VirtualizedScrollView
                    ref={viewRef}
                    elementRef={scrollViewRef}
                    stateKey={gridViewStateKey}
                    bufferedItemHeight={gridViewBufferedItemHeight}
                    itemCount={itemCountBeforeGridView + gridViewItemCount}
                    alwaysRenderAdditionalItemIndexes={useMemo(
                        () =>
                            routeLayout === "narrow"
                                ? [
                                      // Always render `<TaskQueryViewCustomizationMobileSection>`
                                      // regardless of where we've scrolled. We can return focus there at
                                      // any moment.
                                      0,
                                      ...alwaysRenderAdditionalGridViewItemIndexes.map(
                                          index => index + itemCountBeforeGridView,
                                      ),
                                  ]
                                : alwaysRenderAdditionalGridViewItemIndexes.map(
                                      index => index + itemCountBeforeGridView,
                                  ),
                        [
                            alwaysRenderAdditionalGridViewItemIndexes,
                            itemCountBeforeGridView,
                            routeLayout,
                        ],
                    )}
                    scrollbarInsetTop={
                        routeLayout === "narrow"
                            ? scrollbarInsetTop ?? safeAreaOnlyScrollbarInsetTop
                            : undefined
                    }
                    scrollbarInsetTopItemIndex={
                        routeLayout !== "narrow" && scrollbarInsetTopGridViewItemIndex !== undefined
                            ? scrollbarInsetTopGridViewItemIndex + itemCountBeforeGridView
                            : undefined
                    }
                    renderItem={renderItem}
                    onRenderedRangeChange={onGridViewRenderedRangeChange}
                    onRenderedRangeLayoutChange={onGridViewRenderedRangeLayoutChange}
                    extraChildren={({
                        contentHeight,
                        viewHeight,
                        shouldRenderWithRelativePositioning,
                    }) => (
                        <>
                            {navigationBar}
                            {!queryState.activeQuery.isAvailable &&
                                queryState.activeQuery.isMissingRequiredFilters &&
                                !shouldRenderWithRelativePositioning && (
                                    <Box
                                        position="absolute"
                                        left="0"
                                        right="0"
                                        paddingX={screenPaddingX}
                                        paddingTop="7"
                                        paddingBottom="24"
                                        pointerEvents="auto"
                                        display="flex"
                                        flexDirection="column"
                                        justifyContent="center"
                                        alignItems="center"
                                        style={{
                                            top: contentHeight,
                                            height:
                                                routeLayout !== "narrow"
                                                    ? convertRemLengthToPx("128", spacingScale)
                                                    : undefined,
                                            minHeight:
                                                routeLayout === "narrow"
                                                    ? Math.max(0, viewHeight - contentHeight)
                                                    : undefined,
                                        }}
                                    >
                                        <TaskQueryViewInstructionalPlaceholder
                                            filters={filters}
                                            onFiltersChange={updateFilters}
                                        />
                                    </Box>
                                )}
                        </>
                    )}
                />
            </GlobalKeyDownEvent>
            {(queryState.activeQuery.isAvailable ||
                !queryState.activeQuery.isMissingRequiredFilters) && (
                <TaskFloatingCreateButton filters={filters} />
            )}
            {shouldShowEditNameMobileModal && (
                <MobileFullScreenModal onClose={() => setShouldShowEditNameMobileModal(false)}>
                    {({onCloseWithAnimation}) => (
                        <TaskQueryMobileEditor
                            initialName={name}
                            onNameChange={setName}
                            onCloseWithAnimation={onCloseWithAnimation}
                        />
                    )}
                </MobileFullScreenModal>
            )}
        </Box>
    );
}

function TaskQueryViewInstructionalPlaceholder({
    filters,
    onFiltersChange,
}: {
    filters: ReadonlyArray<TaskQueryFilter>;
    onFiltersChange: (
        filters: ReadonlyArray<TaskQueryFilter>,
        options?: {shouldOpenFirstCollectionsFilterOperationValue?: boolean},
    ) => void;
}) {
    const platform = usePlatform();
    const {currentAccount} = useSpaceContext();

    return (
        <Box
            width="full"
            maxWidth="96"
            style={{
                paddingBottom: `calc(${
                    NativeMobileBridge?.tabBar.height ?? 0
                }px + var(--window-safe-area-inset-bottom, 0px))`,
            }}
        >
            <Box
                // TODO(calebmer): Eventually I'd like a real graphic designer to take a look
                // at this state. We could use a nice illustration here.
                fontSize="300"
                fontStyle="bold"
                userSelect="text"
            >
                Start building a view
            </Box>
            <Spacer space="1" />
            <Box fontSize="100" color="grey-50" userSelect="text">
                Views must include one of the following filters.
            </Box>
            <Spacer space="10" />
            <Box
                style={{
                    display: "grid",
                    gridTemplateColumns: "1fr auto",
                    gap: spacing["2"],
                    alignItems: "center",
                }}
            >
                {currentAccount && (
                    // TODO(calebmer): If we ever allow anonymous users to view this route we may
                    // want to consider updating the design of this. Just showing the collections
                    // filter might not look good?
                    <>
                        <Box display="flex">
                            <Box
                                display="flex"
                                height="6"
                                alignItems="center"
                                paddingX="2"
                                gap="2"
                                border="grey-10"
                                borderRadius="1"
                            >
                                <Box>Creator</Box>
                                <Box color="grey-60">is</Box>
                                <Box display="flex" gap="1" alignItems="center">
                                    <AccountAvatar size="3" account={currentAccount} />
                                    <Box>me</Box>
                                </Box>
                            </Box>
                        </Box>
                        <Button
                            variant="neutral"
                            icon={<Plus />}
                            // Consistent icon placement with mobile customization section filter/sort add
                            // buttons.
                            iconPlacement={platform === "mobile" ? "end" : "start"}
                            height="6"
                            paddingX="2"
                            isDisabled={filters.some(
                                filter =>
                                    filter.type === "Creator" &&
                                    filter.operation.type === "OneOf" &&
                                    filter.operation.accounts.length === 1 &&
                                    filter.operation.accounts[0]!.type === "CurrentAccount",
                            )}
                            onPress={() => {
                                onFiltersChange([
                                    ...filters,
                                    {
                                        type: "Creator",
                                        operation: {
                                            type: "OneOf",
                                            accounts: [{type: "CurrentAccount"}],
                                        },
                                    },
                                ]);
                            }}
                        >
                            Add
                        </Button>
                        <Box style={{gridColumn: "1 / span 2"}} borderTop="grey-5" />
                        <Box display="flex">
                            <Box
                                display="flex"
                                height="6"
                                alignItems="center"
                                paddingX="2"
                                gap="2"
                                border="grey-10"
                                borderRadius="1"
                            >
                                <Box>Assignee</Box>
                                <Box color="grey-60">is</Box>
                                <Box display="flex" gap="1" alignItems="center">
                                    <AccountAvatar size="3" account={currentAccount} />
                                    <Box>me</Box>
                                </Box>
                            </Box>
                        </Box>
                        <Button
                            variant="neutral"
                            icon={<Plus />}
                            // Consistent icon placement with mobile customization section filter/sort add
                            // buttons.
                            iconPlacement={platform === "mobile" ? "end" : "start"}
                            height="6"
                            paddingX="2"
                            isDisabled={filters.some(
                                filter =>
                                    filter.type === "Assignee" &&
                                    filter.operation.type === "OneOf" &&
                                    filter.operation.accounts.length === 1 &&
                                    filter.operation.accounts[0]!.type === "CurrentAccount",
                            )}
                            onPress={() => {
                                onFiltersChange([
                                    ...filters,
                                    {
                                        type: "Assignee",
                                        operation: {
                                            type: "OneOf",
                                            accounts: [{type: "CurrentAccount"}],
                                        },
                                    },
                                ]);
                            }}
                        >
                            Add
                        </Button>
                        <Box style={{gridColumn: "1 / span 2"}} borderTop="grey-5" />
                    </>
                )}
                <Box display="flex">
                    <Box
                        display="flex"
                        height="6"
                        alignItems="center"
                        paddingX="2"
                        gap="2"
                        border="grey-10"
                        borderRadius="1"
                    >
                        <Box>Collections</Box>
                        <Box color="grey-60">has</Box>
                        <Box style={inputPlaceholderStyles}>any collection</Box>
                    </Box>
                </Box>
                <Button
                    variant="neutral"
                    icon={<Plus />}
                    // Consistent icon placement with mobile customization section filter/sort add
                    // buttons.
                    iconPlacement={platform === "mobile" ? "end" : "start"}
                    height="6"
                    paddingX="2"
                    // The collection add button doesn't immediately give the user access to the
                    // view. So disable if we have an empty collection filter the user needs to
                    // configure.
                    isDisabled={filters.some(
                        filter =>
                            filter.type === "Collections" &&
                            (filter.operation.type === "IncludesOneOf" ||
                                filter.operation.type === "IncludesAllOf"),
                    )}
                    onPress={() => {
                        onFiltersChange(
                            [
                                ...filters,
                                {
                                    type: "Collections",
                                    operation: {
                                        type: "IncludesOneOf",
                                        collectionIds: new Set(),
                                    },
                                },
                            ],
                            {
                                // Open the collection combobox to let the user know they still need to pick
                                // a collection.
                                shouldOpenFirstCollectionsFilterOperationValue: true,
                            },
                        );
                    }}
                >
                    Add
                </Button>
            </Box>
        </Box>
    );
}
