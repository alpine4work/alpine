import {Link as LinkIcon} from "phosphor-react";
import {
    Memo,
    RefObject,
    useCallback,
    useEffect,
    useImperativeHandle,
    useMemo,
    useRef,
    useState,
} from "react";
import {useAppContext} from "~/client/web/context/app_context.js";
import {Box} from "~/client/web/design/box.js";
import {MenuAction} from "~/client/web/design/menu.js";
import {MobileFullScreenModal} from "~/client/web/design/mobile_full_screen_modal.js";
import {navigationBarHeight} from "~/client/web/design/navigation_bar_helpers.js";
import {renderKeyboardShortcutHint} from "~/client/web/design/render_keyboard_shortcut_hint.js";
import {useReporter} from "~/client/web/design/reporter.js";
import {safeAreaOnlyScrollbarInsetTop} from "~/client/web/design/scrollbar.js";
import {GlobalKeyDownEvent} from "~/client/web/helpers/global_key_down_event.js";
import {useEvents} from "~/client/web/helpers/lifecycle/use_event.js";
import {useStore} from "~/client/web/helpers/use_store.js";
import {writeTextToClipboard} from "~/client/web/helpers/write_text_to_clipboard.js";
import {useNavigationBar} from "~/client/web/navigation/navigation_bar.js";
import {useClientInfo} from "~/client/web/remix/client_info_context.js";
import {usePlatform} from "~/client/web/remix/platform_context.js";
import {useRouteLayout} from "~/client/web/remix/route_layout_context.js";
import {useCurrentDate} from "~/client/web/remix/use_current_time_rounded_to_hour.js";
import {useNavigate} from "~/client/web/remix/use_navigate.js";
import {useSearchFavoriteEntityMenuAction} from "~/client/web/search/core/use_search_favorite_affinity_entity_menu_action.js";
import {useSiteContextIfExists} from "~/client/web/sites/context/site_context.js";
import {applySiteAccessPolicyChange} from "~/client/web/sites/helpers/apply_site_access_policy_change.js";
import {useSpaceContext} from "~/client/web/spaces/space_context.js";
import {getTaskCollectionColor} from "~/client/web/styles/get_task_collection_color.js";
import {TaskClientCollectionSubscription} from "~/client/web/tasks/core/task_client_collection_subscription.js";
import {TaskClientQuery} from "~/client/web/tasks/core/task_client_query.js";
import {
    TaskClientStore,
    TaskClientStoreSearchAffinityManager,
} from "~/client/web/tasks/core/task_client_store.js";
import {getNewTaskPositionsForQuerySortedByPosition} from "~/client/web/tasks/internal/get_new_task_positions_for_query_sorted_by_position.js";
import {isTaskClientStoreCollectionEntryDeleted} from "~/client/web/tasks/internal/is_task_client_store_collection_entry_deleted.js";
import {
    TaskCollectionViewDesktopHeader,
    TaskCollectionViewDesktopHeaderRef,
} from "~/client/web/tasks/internal/task_collection_view_desktop_header.js";
import {
    TaskCollectionViewDesktopHeaderName,
    TaskCollectionViewDesktopHeaderNameRef,
} from "~/client/web/tasks/internal/task_collection_view_desktop_header_name.js";
import {TaskFloatingCreateButton} from "~/client/web/tasks/internal/task_floating_create_button.js";
import {
    isTaskQueryManuallySorted,
    useTaskGridViewVirtualizedList,
} from "~/client/web/tasks/internal/task_grid_view_virtualized_list.js";
import {TaskGridViewVirtualizedListViewRef} from "~/client/web/tasks/internal/task_grid_view_virtualized_list_types.js";
import {useTaskQueryReferencesForUrlGrantFilterEditor} from "~/client/web/tasks/internal/task_query_references_for_url_grant_filter_editor.js";
import {
    TaskQueryViewCustomizationBar,
    TaskQueryViewCustomizationBarRef,
} from "~/client/web/tasks/internal/task_query_view_customization_bar.js";
import {
    TaskQueryViewCustomizationMobileSection,
    TaskQueryViewCustomizationMobileSectionRef,
} from "~/client/web/tasks/internal/task_query_view_customization_mobile_section.js";
import {TaskCollectionMobileEditor} from "~/client/web/tasks/task_collection_mobile_editor.js";
import {useTaskQueryState} from "~/client/web/tasks/use_task_query_state.js";
import {
    VirtualizedScrollView,
    VirtualizedScrollViewRef,
    VirtualizedScrollViewRenderItem,
} from "~/client/web/virtualized/virtualized_scroll_view.js";
import {
    AccessLevel,
    ResolvedAccessPolicyWithGenerations,
    getAccountAccessLevelAssumingSpaceAccess,
    hasAccessLevel,
} from "~/shared/access/access_policy.js";
import {screenPaddingX, spacing} from "~/shared/design/core/spacing.js";
import {PermissionDeniedError} from "~/shared/error/error.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {cast} from "~/shared/helpers/control/cast.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {emptyMap} from "~/shared/helpers/map/empty_map.js";
import {generateOrderKeyBetween} from "~/shared/helpers/sort/order_key.js";
import {TaskCollectionId} from "~/shared/id/types/id_types.js";
import {ConstStore} from "~/shared/store/const_store.js";
import {Store} from "~/shared/store/store.js";
import {TaskActionModel} from "~/shared/tasks/actions/task_action_model.js";
import {
    taskCollectionDeletedErrorDisplayMessage,
    taskCollectionPermissionDeniedErrorDisplayMessageByExpectedAccessLevel,
} from "~/shared/tasks/task_error_messages.js";
import {TaskGridViewExpansionState} from "~/shared/tasks/task_grid_view_expansion_state.js";
import {TaskPosition} from "~/shared/tasks/task_position.js";
import {
    TaskQueryFilter,
    serializeTaskQueryFiltersSearchParam,
} from "~/shared/tasks/task_query_filter.js";
import {
    TaskQueryFilterReferences,
    mergeTaskQueryFilterReferences,
} from "~/shared/tasks/task_query_filter_references.js";
import {normalizeTaskQueryFilters} from "~/shared/tasks/task_query_normalized_filters.js";
import {
    TaskQueryNormalizedSort,
    normalizeTaskQuerySorts,
} from "~/shared/tasks/task_query_normalized_sort.js";
import {TaskQuerySort, serializeTaskQuerySortsSearchParam} from "~/shared/tasks/task_query_sort.js";

export function TaskCollectionView({
    store,
    collectionId,
    collectionSubscription,
    shouldInitiallyFocusEditableCollectionName,
    affinityManager,
    initialQuery,
    initialFilters,
    initialFilterReferences,
    onFiltersChange,
    initialSorts,
    onSortsChange,
    initialIsFavorite,
    createCollection,
}: {
    store: TaskClientStore;
    collectionId: TaskCollectionId;
    // If `collectionSubscription` is null, that means we are creating a new
    // collection.
    collectionSubscription: TaskClientCollectionSubscription | null;
    shouldInitiallyFocusEditableCollectionName: boolean;
    affinityManager: TaskClientStoreSearchAffinityManager;
    initialQuery: {
        query: TaskClientQuery;
        initialGridViewExpansionState: TaskGridViewExpansionState;
    } | null;
    initialFilters: ReadonlyArray<TaskQueryFilter>;
    initialFilterReferences: TaskQueryFilterReferences;
    onFiltersChange: (filters: ReadonlyArray<TaskQueryFilter>) => void;
    initialSorts: ReadonlyArray<TaskQuerySort>;
    onSortsChange: (sorts: ReadonlyArray<TaskQuerySort>) => void;
    initialIsFavorite: boolean;
    createCollection: Memo<(name: string) => Promise<void>>;
}) {
    const context = useAppContext();
    const navigate = useNavigate();
    const platform = usePlatform();
    const routeLayout = useRouteLayout();
    const clientInfo = useClientInfo();
    const reporter = useReporter();
    const {space, currentAccount} = useSpaceContext();
    const currentDate = useCurrentDate();
    const siteContext = useSiteContextIfExists();

    const accessPolicy = useStore(
        useMemo((): Store<ResolvedAccessPolicyWithGenerations> => {
            // If there's no `collectionSubscription` it means we're creating the collection.
            // When the user creates a collection they get the manage access level.
            if (!collectionSubscription) {
                return new ConstStore({
                    type: "Local",
                    accountGrantById: currentAccount
                        ? new Map([[currentAccount.id, {level: "Manage", generation: 0}]])
                        : emptyMap,
                    defaultGrant: null,
                    urlGrant: null,
                });
            }

            return collectionSubscription.collectionEntryStore
                .map(collectionEntry => {
                    if (isTaskClientStoreCollectionEntryDeleted(collectionEntry)) {
                        throw new PermissionDeniedError(
                            "Current account lost access to task collection (deleted)",
                            {displayMessage: taskCollectionDeletedErrorDisplayMessage},
                        );
                    }

                    if (!collectionEntry.collection) {
                        throw new PermissionDeniedError(
                            "Current account lost access to task collection (policy updated)",
                            {
                                displayMessage:
                                    taskCollectionPermissionDeniedErrorDisplayMessageByExpectedAccessLevel.View,
                            },
                        );
                    }

                    return collectionEntry.collection.getAccessPolicy();
                })
                .flatMap(accessPolicy => {
                    switch (accessPolicy.type) {
                        case "Local":
                            return new ConstStore(accessPolicy);
                        case "Site":
                            const siteStore =
                                collectionSubscription.store.getReferencedSiteStoreAndAssertExists(
                                    accessPolicy.siteId,
                                );

                            return siteStore.map(
                                (site): ResolvedAccessPolicyWithGenerations => ({
                                    ...site.accessPolicy,
                                    type: "Site",
                                    siteId: site.id,
                                }),
                            );
                        default:
                            throw exhaustive(accessPolicy);
                    }
                });
        }, [collectionSubscription, currentAccount]),
    );

    const accessLevel = useMemo(
        () => getAccountAccessLevelAssumingSpaceAccess(accessPolicy, currentAccount?.id),
        [accessPolicy, currentAccount?.id],
    );

    const [{filters, filterReferences}, actuallySetFiltersState] = useState({
        filters: initialFilters,
        filterReferences: initialFilterReferences,
    });

    const lastFiltersRef = useRef(filters);
    useEffect(() => {
        if (lastFiltersRef.current !== filters) {
            onFiltersChange(filters);
            lastFiltersRef.current = filters;
        }
    }, [filters, onFiltersChange]);

    const [sorts, actuallySetSorts] = useState(initialSorts);

    const {undoEvent, redoEvent, updateFilters, setSorts} = useEvents({
        undoEvent: () => undo(),
        redoEvent: () => redo(),
        updateFilters: (
            filters: ReadonlyArray<TaskQueryFilter>,
            {
                mergeFilterReferences,
            }: {
                mergeFilterReferences?: TaskQueryFilterReferences;
            } = {},
        ) => {
            actuallySetFiltersState(({filterReferences}) => {
                const newFilterReferences = mergeFilterReferences
                    ? mergeTaskQueryFilterReferences(filterReferences, mergeFilterReferences)
                    : filterReferences;

                return {
                    filters,
                    filterReferences: newFilterReferences,
                };
            });

            onFiltersChange(filters);
        },
        setSorts: (sorts: ReadonlyArray<TaskQuerySort>) => {
            actuallySetSorts(sorts);
            onSortsChange(sorts);
        },
    });

    const allFilters = useMemo(
        (): ReadonlyArray<TaskQueryFilter> => [
            {
                type: "Collections",
                operation: {type: "IncludesOneOf", collectionIds: new Set([collectionId])},
            },
            ...filters,
        ],
        [collectionId, filters],
    );

    const normalizedFiltersResult = useMemo(() => {
        // Don't execute a query if our subscription hasn't been established yet.
        if (!collectionSubscription) return null;

        // Always include collection filter in our list of filters.
        return normalizeTaskQueryFilters(allFilters, {
            currentDate,
            currentAccountId: currentAccount?.id ?? null,
        });
    }, [allFilters, collectionSubscription, currentAccount?.id, currentDate]);

    // If no filters or sorts have been explicitly set then the user can manually sort
    // by collection position.
    //
    // If the collection view is filtered we automatically apply a sort since there can
    // be some weirdness creating a task and expecting it to be in one place when
    // there's no filter but instead it goes to another place.
    const normalizedSorts: ReadonlyArray<TaskQueryNormalizedSort> = useMemo(() => {
        return filters.length === 0 && sorts.length === 0
            ? [
                  {
                      type: "CollectionPosition",
                      direction: "Ascending",
                      missing: "Last",
                      collectionId,
                  },
                  {
                      type: "CreatedTime",
                      direction: "Ascending",
                      missing: "Last",
                  },
              ]
            : normalizeTaskQuerySorts(sorts);
    }, [collectionId, filters.length, sorts]);

    const queryState = useTaskQueryState({
        store,
        initialQuery,
        filters:
            normalizedFiltersResult?.type === "Possible"
                ? normalizedFiltersResult.normalizedFilters
                : null,
        sorts: normalizedSorts,
    });

    const hasEditAccessLevel = useMemo(() => hasAccessLevel(accessLevel, "Edit"), [accessLevel]);

    const defaultOrderSentence =
        filters.length > 0
            ? "Tasks are ordered by created date."
            : hasEditAccessLevel
              ? "You can change the order of tasks by dragging them."
              : "Tasks are ordered manually.";

    const desktopHeaderRef = useRef<TaskCollectionViewDesktopHeaderRef>(null);
    const navigationBarDesktopNameRef = useRef<TaskCollectionViewDesktopHeaderNameRef>(null);

    const desktopCustomizationBarRef = useRef<TaskQueryViewCustomizationBarRef>(null);
    const mobileCustomizationSectionRef = useRef<TaskQueryViewCustomizationMobileSectionRef>(null);
    const [customizationState, setCustomizationState] = useState<{
        initiallyFocus: "AddFilter" | "AddSort" | null;
    } | null>(filters.length > 0 || sorts.length > 0 ? {initiallyFocus: null} : null);
    if (!customizationState && (filters.length > 0 || sorts.length > 0)) {
        setCustomizationState({initiallyFocus: null});
    }

    // If the actor doesn't have space access then we need to keep track of any
    // accounts/collections referenced by the query. This is expensive (O(tasks)) so
    // it's important to only run this when `currentAccount` is null.
    const queryReferencesForUrlGrant = useTaskQueryReferencesForUrlGrantFilterEditor(
        !currentAccount ? (queryState.activeQuery.query?.query ?? null) : null,
    );

    const [editNameMobileModalState, setEditNameMobileModalState] = useState<{
        initiallyFocusName: boolean;
    } | null>(null);

    const copyLink = useCallback(async () => {
        const url = new URL(
            `/s/${space.id}/tasks/collections/${collectionId}`,
            window.location.href,
        );

        if (filters.length > 0) {
            url.searchParams.set("filter", serializeTaskQueryFiltersSearchParam(filters));
        }

        if (sorts.length > 0) {
            url.searchParams.set("sort", serializeTaskQuerySortsSearchParam(sorts));
        }

        await writeTextToClipboard(url.toString());
    }, [collectionId, filters, sorts, space.id]);

    const favoriteMenuAction = useSearchFavoriteEntityMenuAction(
        `TaskCollection:${collectionId}`,
        initialIsFavorite,
    );

    const menuActions = useMemo(() => {
        const menuActions: Array<ReadonlyArray<MenuAction>> = [];

        menuActions.push([
            {
                label: "Copy link",
                icon: <LinkIcon />,
                iconPlacement: "end",
                pressErrorTitle: "Couldn\u2019t copy collection link",
                onPress: copyLink,
            },
            ...(favoriteMenuAction ? [favoriteMenuAction] : []),
        ]);

        if (collectionSubscription) {
            if (hasAccessLevel(accessLevel, "Manage")) {
                // Even though you can edit the collection name by double clicking and the
                // color by clicking on the dot, we still include menu items since these
                // interactions aren't necessarily obvious.
                //
                // Also, the color and name are not focusable. So the only way to edit
                // name/color via keyboard are these menu items.
                //
                // eslint-disable-next-line react-compiler/react-compiler
                menuActions.push([
                    {
                        label: "Edit name",
                        onPress: () => {
                            if (routeLayout !== "narrow") {
                                assertExists(desktopHeaderRef.current).editName();
                            } else if (platform !== "mobile") {
                                assertExists(navigationBarDesktopNameRef.current).editName();
                            } else {
                                setEditNameMobileModalState({initiallyFocusName: true});
                            }
                        },
                    },
                    {
                        label: "Edit color",
                        onPress: () => {
                            if (routeLayout !== "narrow") {
                                assertExists(desktopHeaderRef.current).editColor();
                            } else if (platform !== "mobile") {
                                assertExists(navigationBarDesktopNameRef.current).editColor();
                            } else {
                                setEditNameMobileModalState({initiallyFocusName: false});
                            }
                        },
                    },
                ]);
            }

            if (hasEditAccessLevel) {
                if (routeLayout === "narrow") {
                    // eslint-disable-next-line react-compiler/react-compiler
                    menuActions.push([
                        {
                            label: "Add filter",
                            onPress: () => {
                                // Make sure the filter/sort section is visible.
                                assertExists(viewRef.current).setScrollOffset(0);

                                if (!customizationState) {
                                    setCustomizationState({initiallyFocus: "AddFilter"});
                                } else {
                                    if (platform === "mobile") {
                                        assertExists(
                                            mobileCustomizationSectionRef.current,
                                        ).openAddFilterMenu();
                                    } else {
                                        assertExists(
                                            desktopCustomizationBarRef.current,
                                        ).openAddFilterMenu();
                                    }
                                }
                            },
                        },
                        {
                            label: "Add sort",
                            onPress: () => {
                                // Make sure the filter/sort section is visible.
                                assertExists(viewRef.current).setScrollOffset(0);

                                if (!customizationState) {
                                    setCustomizationState({initiallyFocus: "AddSort"});
                                } else {
                                    if (platform === "mobile") {
                                        assertExists(
                                            mobileCustomizationSectionRef.current,
                                        ).openAddSortMenu();
                                    } else {
                                        assertExists(
                                            desktopCustomizationBarRef.current,
                                        ).openAddSortMenu();
                                    }
                                }
                            },
                        },
                    ]);
                }

                if (hasEditAccessLevel) {
                    menuActions.push([
                        {
                            label: "Undo",
                            keyboardShortcutHint: renderKeyboardShortcutHint(
                                clientInfo,
                                "mod",
                                "z",
                            ),
                            onPress: undoEvent,
                        },
                        {
                            label: "Redo",
                            keyboardShortcutHint: renderKeyboardShortcutHint(
                                clientInfo,
                                "mod",
                                "y",
                            ),
                            onPress: redoEvent,
                        },
                    ]);
                }

                if (hasAccessLevel(accessLevel, "Manage")) {
                    menuActions.push([
                        {
                            label: "Delete",
                            onPress: () => {
                                reporter.showDialog({
                                    title: "Delete task collection?",
                                    description: "The tasks in the collection will not be deleted.",
                                    primaryButtonLabel: "Delete",
                                    primaryButtonPressErrorTitle:
                                        "Couldn\u2019t delete task collection",
                                    onPrimaryButtonPress: async () => {
                                        // Wait until navigation has finished to actually delete the collection.
                                        await navigate(-1);

                                        store.commitTaskActionTransaction(
                                            context,
                                            [
                                                {
                                                    type: "UpdateCollection",
                                                    time: store.clock.now(),
                                                    collectionId,
                                                    collectionAction: {type: "Delete"},
                                                },
                                            ],
                                            // Collection changes can't be undone.
                                            {undoManager: null, affinityManager},
                                        );
                                    },
                                });
                            },
                        },
                    ]);
                }
            }
        }

        return menuActions;
    }, [
        accessLevel,
        affinityManager,
        clientInfo,
        collectionId,
        collectionSubscription,
        context,
        copyLink,
        customizationState,
        favoriteMenuAction,
        hasEditAccessLevel,
        navigate,
        platform,
        redoEvent,
        reporter,
        routeLayout,
        store,
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

    // Offset all the methods on our `VirtualizedScrollViewRef` by the number of items
    // which precede our children grid view.
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

    const isCreatedCollectionFromGhostTaskPrivate = !accessPolicy.defaultGrant;

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
        undo,
        redo,
    } = useTaskGridViewVirtualizedList({
        capabilities: useMemo(() => {
            if (routeLayout !== "narrow") {
                return {
                    isReadOnly: !hasEditAccessLevel,
                    hasParentTaskTitle: true,
                    hasMultilineTitle: false,
                    hasDenseFields: false,
                    hasColumns: true,
                    withoutAssigneeField: false,
                    withoutDueDateField: false,
                    withoutCollectionsField: false,
                    isCreatedCollectionFromGhostTaskPrivate,
                };
            } else {
                return {
                    isReadOnly: !hasEditAccessLevel,
                    hasParentTaskTitle: true,
                    hasMultilineTitle: true,
                    hasDenseFields: true,
                    hasColumns: false,
                    withoutAssigneeField: false,
                    withoutDueDateField: false,
                    withoutCollectionsField: false,
                    isCreatedCollectionFromGhostTaskPrivate,
                };
            }
        }, [hasEditAccessLevel, isCreatedCollectionFromGhostTaskPrivate, routeLayout]),
        viewRef: itemCountBeforeGridView !== 0 ? gridViewRef : viewRef,
        store,
        query: queryState.activeQuery.query,
        affinityManager,
        withoutBorderTopIfFirstRow: routeLayout !== "narrow",
        getMoveTasksToQueryActions: (taskIds, actualPosition) => {
            assert(collectionSubscription && queryState.activeQuery.isAvailable);

            const query = queryState.activeQuery.query.query;

            // If the query is auto-sorted we disable features that allow moving tasks into the
            // query. Like hitting shift-tab to dedent or hitting enter to create a new task.
            // We may want to re-enable some of these someday in auto-sorted queries. See the
            // comment on `getMoveTasksToQueryActions` in `<TaskQueryView>` for more
            // discussion.
            if (!isTaskQueryManuallySorted(query.sorts)) return null;

            const time1 = store.clock.now();
            const time2 = store.clock.now();

            const positions: Array<TaskPosition> = [];

            const actualPositions = getNewTaskPositionsForQuerySortedByPosition(
                time2,
                query,
                actualPosition,
                taskIds.length,
            );

            for (const orderKey of actualPositions.orderKeys) {
                positions.push({
                    orderTime: actualPositions.orderTime,
                    orderKey,
                });
            }

            const actions: Array<TaskActionModel> = [];

            for (let index = 0; index < taskIds.length; index++) {
                const taskId = taskIds[index]!;
                const position = positions[index]!;
                const taskCollections = store.getTaskEntrySnapshot(taskId)?.task?.getCollections();

                actions.push(
                    {
                        type: "UpdateTask",
                        time: time1,
                        taskId,
                        taskAction: {
                            type: "AddCollection",
                            collectionId: collectionSubscription.collectionId,
                            orderKey: generateOrderKeyBetween(
                                taskCollections?.getLastOrderKey() ?? null,
                                null,
                            ),
                        },
                    },
                    {
                        type: "UpdateTask",
                        time: time2,
                        taskId,
                        taskAction: {
                            type: "UpdateCollectionPosition",
                            collectionId: collectionSubscription.collectionId,
                            position: position,
                        },
                    },
                );
            }

            return {
                actions,
                positions,
            };
        },
        getMaybeRemoveTaskFromQueryActions: taskId => {
            assert(collectionSubscription && queryState.activeQuery.isAvailable);

            const query = queryState.activeQuery.query.query;

            // If the query is auto-sorted we disable features that remove tasks from the grid
            // view. Like tab to indent or drag and drop. Neither makes sense when you don't
            // have control over the order of tasks.
            if (!isTaskQueryManuallySorted(query.sorts)) return [];

            return [
                {
                    type: "UpdateTask",
                    time: store.clock.now(),
                    taskId,
                    taskAction: {type: "RemoveCollection", collectionId},
                },
            ];
        },
        columnHeaderControls: useMemo(() => {
            // We don't have sticky column header controls when rendering in a mobile layout.
            // Instead we render a navigation bar and render filters/sorts at the top of the
            // view in a non-sticky manner.
            //
            // We do this for peeks too.
            if (routeLayout === "narrow") return;

            return {
                minHeight: spacing[navigationBarHeight],
                node: (
                    <TaskCollectionViewDesktopHeader
                        ref={desktopHeaderRef}
                        store={store}
                        queryReferencesForUrlGrant={queryReferencesForUrlGrant}
                        collectionId={collectionId}
                        collectionSubscription={collectionSubscription}
                        shouldInitiallyFocusEditableCollectionName={
                            shouldInitiallyFocusEditableCollectionName
                        }
                        affinityManager={affinityManager}
                        createCollection={createCollection}
                        accessLevel={accessLevel}
                        defaultOrderSentence={defaultOrderSentence}
                        menuActions={menuActions}
                        filters={filters}
                        filterReferences={filterReferences}
                        onFiltersChange={updateFilters}
                        sorts={sorts}
                        onSortsChange={setSorts}
                        onCopyLink={copyLink}
                    />
                ),
            };
        }, [
            accessLevel,
            affinityManager,
            collectionId,
            collectionSubscription,
            copyLink,
            createCollection,
            defaultOrderSentence,
            filterReferences,
            filters,
            menuActions,
            queryReferencesForUrlGrant,
            routeLayout,
            setSorts,
            shouldInitiallyFocusEditableCollectionName,
            sorts,
            store,
            updateFilters,
        ]),
    });

    const {scrollViewRef, navigationBar, scrollbarInsetTop} = useNavigationBar({
        isDisabled: routeLayout !== "narrow",
        withoutDisappearingTitle: true,
        title: (
            <TaskCollectionViewMobileNavigationBarTitle
                accessLevel={accessLevel}
                store={store}
                collectionId={collectionId}
                collectionSubscription={collectionSubscription}
                shouldInitiallyFocusEditableCollectionName={
                    shouldInitiallyFocusEditableCollectionName
                }
                createCollection={createCollection}
                affinityManager={affinityManager}
                desktopNameRef={navigationBarDesktopNameRef}
            />
        ),
        desktopTitleLeftSlop: platform !== "mobile" ? "2" : undefined,
        shareButton: accessPolicy
            ? {
                  isReadOnly: !collectionSubscription,
                  entityNoun: "task collection",
                  entityId: `TaskCollection:${collectionId}`,
                  accessPolicy,
                  onAccessPolicyChange: async (notification, accessPolicy) => {
                      if (accessPolicy.type === "Site") {
                          await applySiteAccessPolicyChange({
                              context,
                              accessPolicy,
                              handleEventForSite: assertExists(siteContext).handleEventForSite,
                          });
                          return;
                      }

                      store.commitTaskActionTransaction(
                          context,
                          [
                              {
                                  type: "UpdateCollection",
                                  time: store.clock.now(),
                                  collectionId,
                                  collectionAction: {
                                      type: "UpdateAccessPolicy",
                                      accessPolicy,
                                  },
                              },
                          ],
                          {
                              // Collection access policy changes can't be undone.
                              undoManager: null,
                              affinityManager,
                              // Include a notification if the user decided to configure one.
                              updateAccessPolicyShareNotification: notification ?? undefined,
                          },
                      );
                  },
                  onCopyLink: copyLink,
              }
            : undefined,
        menuActions,
        defaultPreviousRoute: `/s/${space.id}/tasks`,
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
                            {customizationState &&
                                (platform === "mobile" ? (
                                    <TaskQueryViewCustomizationMobileSection
                                        ref={mobileCustomizationSectionRef}
                                        store={store}
                                        queryReferencesForUrlGrant={queryReferencesForUrlGrant}
                                        initiallyFocus={customizationState.initiallyFocus}
                                        defaultOrderSentence={defaultOrderSentence}
                                        filters={filters}
                                        filterReferences={filterReferences}
                                        onFiltersChange={updateFilters}
                                        sorts={sorts}
                                        onSortsChange={setSorts}
                                    />
                                ) : (
                                    <Box paddingX={screenPaddingX} paddingTop="1" paddingBottom="5">
                                        <TaskQueryViewCustomizationBar
                                            ref={desktopCustomizationBarRef}
                                            store={store}
                                            queryReferencesForUrlGrant={queryReferencesForUrlGrant}
                                            shouldCollapseWhenFiltersAreEmpty={true}
                                            defaultOrderSentence={defaultOrderSentence}
                                            filters={filters}
                                            filterReferences={filterReferences}
                                            onFiltersChange={updateFilters}
                                            sorts={sorts}
                                            onSortsChange={setSorts}
                                            initiallyFocus={customizationState.initiallyFocus}
                                        />
                                    </Box>
                                ))}
                        </Box>
                    ),
                };
            }

            return renderGridViewItem(index - itemCountBeforeGridView);
        },
        [
            routeLayout,
            renderGridViewItem,
            itemCountBeforeGridView,
            customizationState,
            platform,
            store,
            queryReferencesForUrlGrant,
            defaultOrderSentence,
            filters,
            filterReferences,
            updateFilters,
            sorts,
            setSorts,
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
        >
            {gridViewModals}
            <GlobalKeyDownEvent onGlobalKeyDown={onGridViewGlobalKeyDown}>
                <VirtualizedScrollView
                    ref={viewRef}
                    data-testid="TaskCollectionScrollView"
                    elementRef={scrollViewRef}
                    stateKey={gridViewStateKey}
                    bufferedItemHeight={gridViewBufferedItemHeight}
                    itemCount={itemCountBeforeGridView + gridViewItemCount}
                    alwaysRenderAdditionalItemIndexes={useMemo(
                        () =>
                            routeLayout === "narrow"
                                ? [
                                      // Always render `<TaskQueryViewCustomizationMobileSection>` regardless of where
                                      // we've scrolled. We can return focus there at any moment.
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
                            ? (scrollbarInsetTop ?? safeAreaOnlyScrollbarInsetTop)
                            : undefined
                    }
                    scrollbarInsetTopItemIndex={
                        routeLayout !== "narrow" && scrollbarInsetTopGridViewItemIndex !== undefined
                            ? scrollbarInsetTopGridViewItemIndex + itemCountBeforeGridView
                            : undefined
                    }
                    renderItem={renderItem}
                    onRenderedRangeChange={range => {
                        onGridViewRenderedRangeChange(shiftRenderedRangeForGridView(range));
                    }}
                    onRenderedRangeLayoutChange={range => {
                        onGridViewRenderedRangeLayoutChange(shiftRenderedRangeForGridView(range));
                    }}
                    extraChildren={navigationBar}
                />
            </GlobalKeyDownEvent>
            <TaskFloatingCreateButton filters={allFilters} />
            {editNameMobileModalState && (
                <MobileFullScreenModal onClose={() => setEditNameMobileModalState(null)}>
                    {({onCloseWithAnimation}) => (
                        <TaskCollectionMobileEditor
                            title="Edit collection"
                            initiallyFocusName={editNameMobileModalState.initiallyFocusName}
                            getInitialName={() =>
                                collectionSubscription?.collectionEntryStore
                                    .getSnapshot()
                                    .collection?.getName() ?? ""
                            }
                            getInitialColor={() =>
                                collectionSubscription?.collectionEntryStore
                                    .getSnapshot()
                                    .collection?.getColor() ?? null
                            }
                            onSave={({name, hasNameChanged, color, hasColorChanged}) => {
                                store.commitTaskActionTransaction(
                                    context,
                                    [
                                        ...(hasNameChanged
                                            ? [
                                                  cast<TaskActionModel>({
                                                      type: "UpdateCollection",
                                                      time: store.clock.now(),
                                                      collectionId,
                                                      collectionAction: {
                                                          type: "UpdateName",
                                                          name,
                                                      },
                                                  }),
                                              ]
                                            : []),
                                        ...(hasColorChanged
                                            ? [
                                                  cast<TaskActionModel>({
                                                      type: "UpdateCollection",
                                                      time: store.clock.now(),
                                                      collectionId,
                                                      collectionAction: {
                                                          type: "UpdateColor",
                                                          color,
                                                      },
                                                  }),
                                              ]
                                            : []),
                                    ],
                                    // Collection changes can't be undone.
                                    {undoManager: null, affinityManager},
                                );
                            }}
                            onCloseWithAnimation={() => onCloseWithAnimation()}
                        />
                    )}
                </MobileFullScreenModal>
            )}
        </Box>
    );
}

function TaskCollectionViewMobileNavigationBarTitle({
    accessLevel,
    store,
    collectionId,
    collectionSubscription,
    shouldInitiallyFocusEditableCollectionName,
    createCollection,
    affinityManager,
    desktopNameRef,
}: {
    accessLevel: AccessLevel | null;
    store: TaskClientStore;
    collectionId: TaskCollectionId;
    collectionSubscription: TaskClientCollectionSubscription | null;
    shouldInitiallyFocusEditableCollectionName: boolean;
    createCollection: (name: string) => Promise<void>;
    affinityManager: TaskClientStoreSearchAffinityManager;
    desktopNameRef: RefObject<TaskCollectionViewDesktopHeaderNameRef | null>;
}) {
    const platform = usePlatform();

    const collectionEntry = useStore(collectionSubscription?.collectionEntryStore ?? null);
    const collection = collectionEntry?.collection ?? null;

    if (platform === "mobile") {
        return (
            <>
                <Box
                    display="inline-flex"
                    alignItems="center"
                    marginRight="1.5"
                    style={{height: "1lh", verticalAlign: "top"}}
                >
                    <Box
                        width="2"
                        height="2"
                        borderRadius="full"
                        backgroundColor={getTaskCollectionColor(collection?.getColor() ?? null)}
                    />
                </Box>
                {collection?.getName() ?? ""}
            </>
        );
    }

    return (
        <TaskCollectionViewDesktopHeaderName
            ref={desktopNameRef}
            accessLevel={accessLevel}
            store={store}
            collectionId={collectionId}
            isCreatingCollection={!collectionSubscription}
            shouldInitiallyFocusEditableName={shouldInitiallyFocusEditableCollectionName}
            collection={collection}
            createCollection={createCollection}
            affinityManager={affinityManager}
        />
    );
}
