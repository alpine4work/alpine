import {IconContext, Trash} from "phosphor-react";
import {
    Memo,
    ReactNode,
    useCallback,
    useEffect,
    useImperativeHandle,
    useMemo,
    useRef,
    useState,
} from "react";
import {Box} from "~/client/design/box.js";
import {navigationBarHeight, useNavigationBar} from "~/client/design/navigation_bar.js";
import {ScrollbarInsetDynamic} from "~/client/design/scrollbar.js";
import {GlobalKeyDownEvent} from "~/client/helpers/global_key_down_event.js";
import {markMemoIfNotRendering} from "~/client/helpers/lifecycle/mark_memo_if_not_rendering.js";
import {useEvents} from "~/client/helpers/lifecycle/use_event.js";
import {ConstStore} from "~/client/helpers/store/const_store.js";
import {Store} from "~/client/helpers/store/store.js";
import {useStore} from "~/client/helpers/store/use_store.js";
import {useCurrentDate} from "~/client/remix/use_current_time_rounded_to_hour.js";
import {useIsMobile} from "~/client/remix/use_is_mobile.js";
import {useSpaceContext} from "~/client/spaces/space_context.js";
import {getTaskCollectionEntryAccess} from "~/client/tasks/internal/create_task_entry_access_store.js";
import {getNewTaskPositionForQuerySortedByPosition} from "~/client/tasks/internal/get_new_task_position_for_query_sorted_by_position.js";
import {PencilSimpleSlash} from "~/client/tasks/internal/pencil_simple_slash.js";
import {TaskCollectionViewHeader} from "~/client/tasks/internal/task_collection_view_header.js";
import {
    TaskGridViewVirtualizedListViewRef,
    isTaskQueryManuallySorted,
    useTaskGridViewVirtualizedList,
} from "~/client/tasks/internal/task_grid_view_virtualized_list.js";
import {taskQueryFilterEditorHeight} from "~/client/tasks/internal/task_query_filter_editor.js";
import {
    TaskQueryViewCustomizationBar,
    TaskQueryViewCustomizationBarRef,
} from "~/client/tasks/internal/task_query_view_customization_bar.js";
import {
    TaskQueryViewCustomizationMobileSection,
    TaskQueryViewCustomizationMobileSectionRef,
} from "~/client/tasks/internal/task_query_view_customization_mobile_section.js";
import {useOutOfBoundsClickSelection} from "~/client/tasks/internal/use_out_of_bounds_click_selection.js";
import {TaskClientCollectionSubscription} from "~/client/tasks/task_client_collection_subscription.js";
import {TaskClientQuery} from "~/client/tasks/task_client_query.js";
import {
    TaskClientStore,
    TaskClientStoreSearchAffinityManager,
} from "~/client/tasks/task_client_store.js";
import {createTaskQueryViewReadOnlyReasonStore} from "~/client/tasks/task_query_view.js";
import {taskRowViewPaddingX} from "~/client/tasks/task_row_shared_styles.js";
import {useTaskQueryState} from "~/client/tasks/use_task_query_state.js";
import {
    VirtualizedScrollView,
    VirtualizedScrollViewRef,
} from "~/client/virtualized/virtualized_scroll_view.js";
import {addRemLengths, spacing} from "~/shared/design/spacing.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {generateOrderKeyBetween} from "~/shared/helpers/sort/order_key.js";
import {TaskCollectionId, TaskId} from "~/shared/id/types/id_types.js";
import {getTaskCollectionColor} from "~/shared/styles/get_task_collection_color.js";
import {invertSelectionColorsClassName, tasksStyles} from "~/shared/styles/styles.js";
import {TaskAction} from "~/shared/tasks/actions/task_action.js";
import {hasTaskCollectionAccessLevel} from "~/shared/tasks/task_collection_access_policy.js";
import {TaskGridViewExpansionState} from "~/shared/tasks/task_grid_view_expansion_state.js";
import {TaskQueryFilter} from "~/shared/tasks/task_query_filter.js";
import {
    TaskQueryFilterReferences,
    mergeTaskQueryFilterReferences,
} from "~/shared/tasks/task_query_filter_references.js";
import {normalizeTaskQueryFilters} from "~/shared/tasks/task_query_normalized_filters.js";
import {
    TaskQueryNormalizedSort,
    normalizeTaskQuerySorts,
} from "~/shared/tasks/task_query_normalized_sort.js";
import {TaskQuerySort} from "~/shared/tasks/task_query_sort.js";

export {newTaskCollectionNamePlaceholder} from "~/client/tasks/internal/task_collection_view_header_name.js";

const safeAreaOnlyScrollbarInsetTop: ScrollbarInsetDynamic = markMemoIfNotRendering([
    0,
    {withSafeArea: true},
]);

export function TaskCollectionView({
    withMobileLayout: withMobileLayoutProp,
    store,
    collectionId,
    collectionSubscription,
    affinityManager,
    initialQuery,
    initialFilters,
    initialFilterReferences,
    onFiltersChange,
    initialSorts,
    onSortsChange,
    createCollection,
}: {
    withMobileLayout: boolean;
    store: TaskClientStore;
    collectionId: TaskCollectionId;
    // If `collectionSubscription` is null, that means we are creating a
    // new collection.
    collectionSubscription: TaskClientCollectionSubscription | null;
    affinityManager: TaskClientStoreSearchAffinityManager;
    initialQuery: {
        query: TaskClientQuery;
        initialGridViewExpansionState: TaskGridViewExpansionState;
        initialBottomGhostTaskId: TaskId;
    } | null;
    initialFilters: ReadonlyArray<TaskQueryFilter>;
    initialFilterReferences: TaskQueryFilterReferences;
    onFiltersChange: (filters: ReadonlyArray<TaskQueryFilter>) => void;
    initialSorts: ReadonlyArray<TaskQuerySort>;
    onSortsChange: (sorts: ReadonlyArray<TaskQuerySort>) => void;
    createCollection: Memo<(name: string) => Promise<void>>;
}) {
    const isMobile = useIsMobile();
    const {currentAccount} = useSpaceContext();
    const currentDate = useCurrentDate();

    const withMobileLayout = isMobile || withMobileLayoutProp;

    const [{filters, filterReferences}, _setFiltersState] = useState({
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

    const defaultOrderSentence =
        filters.length > 0
            ? "When filtered, tasks are ordered by created date."
            : "You can order tasks by dragging them.";

    const [sorts, _setSorts] = useState(initialSorts);

    const {updateFilters, setSorts} = useEvents({
        updateFilters: (
            filters: ReadonlyArray<TaskQueryFilter>,
            {
                mergeFilterReferences,
            }: {
                mergeFilterReferences?: TaskQueryFilterReferences;
            } = {},
        ) => {
            _setFiltersState(({filterReferences}) => {
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
            _setSorts(sorts);
            onSortsChange(sorts);
        },
    });

    const normalizedFiltersResult = useMemo(() => {
        // Don't execute a query if our subscription hasn't been established yet.
        if (!collectionSubscription) return null;

        // Always include collection filter in our list of filters.
        return normalizeTaskQueryFilters(
            [
                {
                    type: "Collections",
                    operation: {type: "IncludesOneOf", collectionIds: new Set([collectionId])},
                },
                ...filters,
            ],
            {
                currentDate,
                currentAccountId: currentAccount.id,
            },
        );
    }, [collectionId, collectionSubscription, currentAccount.id, currentDate, filters]);

    // If no filters or sorts have been explicitly set then the user can manually
    // sort by collection position.
    //
    // If the collection view is filtered we automatically apply a sort since there
    // can be some weirdness creating a task and expecting it to be in one place
    // when there's no filter but instead it goes to another place.
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

    const readOnlyReason1 = useStore(
        useMemo((): Store<{icon: ReactNode; message: string | null} | null> => {
            // If we're creating a new collection, it shouldn't be editable. But we don't
            // want to show a message.
            if (!collectionSubscription) return new ConstStore({icon: null, message: null});
            if (!queryState.activeQuery) return new ConstStore({icon: null, message: null});

            return collectionSubscription.collectionEntryStore
                .map(collectionEntry =>
                    getTaskCollectionEntryAccess(currentAccount.id, collectionEntry),
                )
                .map(access => {
                    switch (access.type) {
                        case "Deleted": {
                            // TODO(calebmer): Add an "undelete" button when we support undo?
                            return {
                                icon: <Trash />,
                                message: "This collection was deleted. You can’t make changes",
                            };
                        }
                        case "PermissionDenied": {
                            // TODO(calebmer): If the user removed their own access by removing a
                            // collection or changing the assignee, we should hint to them that they're
                            // allowed to undo and give them an undo button.
                            return {
                                icon: <PencilSimpleSlash />,
                                message:
                                    "You’ve lost access to this collection. You can’t make changes",
                            };
                        }
                        case "PermissionGranted": {
                            if (hasTaskCollectionAccessLevel(access.level, "Edit")) return null;

                            // TODO(calebmer): If the user removed their own access by removing a
                            // collection or changing the assignee, we should hint to them that they're
                            // allowed to undo and give them an undo button.
                            return {
                                icon: <PencilSimpleSlash />,
                                message: "You’re aren’t allowed to make changes to this collection",
                            };
                        }
                        default:
                            throw exhaustive(access);
                    }
                });
        }, [collectionSubscription, currentAccount.id, queryState.activeQuery]),
    );

    const readOnlyReason2 = useStore(
        useMemo(
            () =>
                createTaskQueryViewReadOnlyReasonStore({
                    store,
                    filters,
                    filterReferences,
                    currentAccount,
                }),
            [currentAccount, filterReferences, filters, store],
        ),
    );

    const readOnlyReason = readOnlyReason1 ?? readOnlyReason2;
    const isReadOnly = readOnlyReason !== null;

    const viewRef = useRef<VirtualizedScrollViewRef>(null);
    const gridViewRef = useRef<TaskGridViewVirtualizedListViewRef>(null);

    const itemCountBeforeGridView = withMobileLayout ? 1 : 0;

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
    } = useTaskGridViewVirtualizedList({
        capabilities: useMemo(() => {
            if (!withMobileLayout) {
                return {
                    isReadOnly,
                    hasParentTaskTitle: true,
                    hasMultilineTitle: false,
                    hasDenseFields: false,
                    hasColumns: true,
                };
            } else {
                return {
                    isReadOnly,
                    hasParentTaskTitle: true,
                    hasMultilineTitle: true,
                    hasDenseFields: true,
                    hasColumns: false,
                };
            }
        }, [isReadOnly, withMobileLayout]),
        viewRef: itemCountBeforeGridView !== 0 ? gridViewRef : viewRef,
        store,
        query: queryState.activeQuery.query,
        affinityManager,
        getMoveTaskToQueryActions: (taskId, position): Array<TaskAction> => {
            assert(collectionSubscription && queryState.activeQuery.isAvailable);

            const query = queryState.activeQuery.query.query;

            // If the query is auto-sorted we disable features that allow moving tasks into
            // the query. Like hitting shift-tab to dedent or hitting enter to create a new
            // task. We may want to re-enable some of these someday in auto-sorted queries.
            // See the comment on `getMoveTaskToQueryActions` in `<TaskQueryView>` for more
            // discussion.
            if (!isTaskQueryManuallySorted(query.sorts)) return [];

            const time1 = store.clock.now();
            const time2 = store.clock.now();

            const taskCollections = store
                .getTaskEntryStoreIfExists(taskId)
                ?.getSnapshot()
                .task?.getCollections();

            return [
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
                        position: getNewTaskPositionForQuerySortedByPosition(
                            time2,
                            query,
                            position,
                        ),
                    },
                },
            ];
        },
        getMaybeRemoveTaskFromQueryActions: taskId => {
            assert(collectionSubscription && queryState.activeQuery.isAvailable);

            const query = queryState.activeQuery.query.query;

            // If the query is auto-sorted we disable features that remove tasks from the
            // grid view. Like tab to indent or drag and drop. Neither makes sense when you
            // don't have control over the order of tasks.
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
            // We don't have sticky column header controls when rendering in a mobile
            // layout. Instead we render a navigation bar and render filters/sorts at the
            // top of the view in a non-sticky manner.
            //
            // We do this for peeks too.
            if (withMobileLayout) return;

            return {
                minHeight:
                    spacing[isMobile ? navigationBarHeight.mobile : navigationBarHeight.desktop],
                node: (
                    <>
                        {readOnlyReason?.message && (
                            // NOCOMMIT: How do read-only messages work on mobile?
                            <Box
                                className={invertSelectionColorsClassName}
                                height="8"
                                paddingX="2"
                                color="grey-0"
                                backgroundColor={{light: "grey-80", dark: "grey-90"}}
                                display="flex"
                                alignItems="center"
                                gap="1.5"
                            >
                                <IconContext.Provider
                                    value={{color: "currentColor", size: spacing["4"]}}
                                >
                                    {readOnlyReason.icon}
                                </IconContext.Provider>
                                <Box userSelect="text">{readOnlyReason.message}</Box>
                            </Box>
                        )}
                        <TaskCollectionViewHeader
                            withMobileLayout={withMobileLayout}
                            store={store}
                            collectionId={collectionId}
                            collectionSubscription={collectionSubscription}
                            affinityManager={affinityManager}
                            createCollection={createCollection}
                            isReadOnly={isReadOnly}
                            defaultOrderSentence={defaultOrderSentence}
                            filters={filters}
                            filterReferences={filterReferences}
                            onFiltersChange={updateFilters}
                            sorts={sorts}
                            onSortsChange={setSorts}
                        />
                    </>
                ),
            };
        }, [
            affinityManager,
            collectionId,
            collectionSubscription,
            createCollection,
            defaultOrderSentence,
            filterReferences,
            filters,
            isMobile,
            isReadOnly,
            readOnlyReason,
            setSorts,
            sorts,
            store,
            updateFilters,
            withMobileLayout,
        ]),
    });

    const queryCustomizationMobileSectionRef =
        useRef<TaskQueryViewCustomizationMobileSectionRef>(null);
    const [queryCustomizationMobileSectionState, setQueryCustomizationMobileSectionState] =
        useState<{initiallyFocus: "AddFilter" | "AddSort" | null} | null>(
            filters.length > 0 || sorts.length > 0 ? {initiallyFocus: null} : null,
        );
    if (!queryCustomizationMobileSectionState && (filters.length > 0 || sorts.length > 0)) {
        setQueryCustomizationMobileSectionState({initiallyFocus: null});
    }

    // NOCOMMIT: Put undo/redo in more actions
    // NOCOMMIT: Menu actions like copy link and edit color
    const {scrollViewRef, navigationBar, scrollbarInsetTop} = useNavigationBar({
        isDisabled: !withMobileLayout,
        withMobileLayout,
        withoutDisappearingTitle: true,
        title: (
            <TaskCollectionViewMobileNavigationBarTitle
                collectionSubscription={collectionSubscription}
            />
        ),
        shareButton: {},
        menuActions: [
            [
                {
                    label: "Add filter",
                    onPress: () => {
                        // Make sure the filter/sort section is visible.
                        assertExists(viewRef.current).setScrollOffset(0);

                        if (!queryCustomizationMobileSectionState) {
                            setQueryCustomizationMobileSectionState({initiallyFocus: "AddFilter"});
                        } else {
                            assertExists(
                                queryCustomizationMobileSectionRef.current,
                            ).openAddFilterMenu();
                        }
                    },
                },
                {
                    label: "Add sort",
                    onPress: () => {
                        // Make sure the filter/sort section is visible.
                        assertExists(viewRef.current).setScrollOffset(0);

                        if (!queryCustomizationMobileSectionState) {
                            setQueryCustomizationMobileSectionState({initiallyFocus: "AddSort"});
                        } else {
                            assertExists(
                                queryCustomizationMobileSectionRef.current,
                            ).openAddSortsMenu();
                        }
                    },
                },
            ],
        ],
    });

    return (
        <Box
            flexGrow="1"
            width="full"
            overflow="hidden"
            backgroundColor="grey-0"
            className={!isReadOnly ? tasksStyles.textCursorNotInherited2ClassName : undefined}
            {...useOutOfBoundsClickSelection({
                isDisabled: isReadOnly,
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
                            withMobileLayout
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
                            withMobileLayout,
                        ],
                    )}
                    scrollbarInsetTop={
                        isMobile
                            ? scrollbarInsetTop
                            : withMobileLayout
                            ? safeAreaOnlyScrollbarInsetTop
                            : undefined
                    }
                    scrollbarInsetTopItemIndex={
                        !withMobileLayout && scrollbarInsetTopGridViewItemIndex !== undefined
                            ? scrollbarInsetTopGridViewItemIndex + itemCountBeforeGridView
                            : undefined
                    }
                    renderItem={useCallback(
                        index => {
                            if (withMobileLayout && index === 0) {
                                return {
                                    key: "CustomizationBar",
                                    minHeight:
                                        spacing[
                                            navigationBarHeight[isMobile ? "mobile" : "desktop"]
                                        ],
                                    node: (
                                        <Box
                                            style={{paddingTop: "var(--safe-area-inset-top, 0px)"}}
                                        >
                                            <Box height={navigationBarHeight} />
                                            {queryCustomizationMobileSectionState && (
                                                <TaskQueryViewCustomizationMobileSection
                                                    ref={queryCustomizationMobileSectionRef}
                                                    initiallyFocus={
                                                        queryCustomizationMobileSectionState.initiallyFocus
                                                    }
                                                    defaultOrderSentence={defaultOrderSentence}
                                                    filters={filters}
                                                    onFiltersChange={updateFilters}
                                                    sorts={sorts}
                                                    onSortsChange={setSorts}
                                                />
                                            )}
                                        </Box>
                                    ),
                                };
                            }

                            return renderGridViewItem(index - itemCountBeforeGridView);
                        },
                        [
                            defaultOrderSentence,
                            filters,
                            isMobile,
                            itemCountBeforeGridView,
                            queryCustomizationMobileSectionState,
                            renderGridViewItem,
                            setSorts,
                            sorts,
                            updateFilters,
                            withMobileLayout,
                        ],
                    )}
                    onRenderedRangeChange={range => {
                        onGridViewRenderedRangeChange(shiftRenderedRangeForGridView(range));
                    }}
                    onRenderedRangeLayoutChange={range => {
                        onGridViewRenderedRangeLayoutChange(shiftRenderedRangeForGridView(range));
                    }}
                    extraChildren={navigationBar}
                />
            </GlobalKeyDownEvent>
        </Box>
    );
}

function TaskCollectionViewMobileNavigationBarTitle({
    collectionSubscription,
}: {
    collectionSubscription: TaskClientCollectionSubscription | null;
}) {
    const collectionEntry = useStore(collectionSubscription?.collectionEntryStore ?? null);
    const collection = collectionEntry?.collection;
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
