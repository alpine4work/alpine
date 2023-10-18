import {Plus} from "phosphor-react";
import {useEffect, useMemo, useRef, useState} from "react";
import {AccountAvatar} from "~/client/accounts/account_avatar.js";
import {Box} from "~/client/design/box.js";
import {Button} from "~/client/design/button.js";
import {useRemPx} from "~/client/design/helpers/use_rem_px.js";
import {Spacer} from "~/client/design/spacer.js";
import {useLayoutEffectWithoutServerSideWarning} from "~/client/helpers/lifecycle/use_layout_effect_without_server_side_warning.js";
import {batchStoreUpdates} from "~/client/helpers/store/batch_store_updates.js";
import {getClientInfoWithoutListening, useBrowserId} from "~/client/remix/client_info_context.js";
import {useCurrentDate} from "~/client/remix/use_current_time_rounded_to_hour.js";
import {useSpaceContext} from "~/client/spaces/space_context.js";
import {getTaskGridViewLoadQueryLimit} from "~/client/tasks/get_task_grid_view_load_query_limit.js";
import {TaskGridViewDndContext} from "~/client/tasks/internal/task_grid_view_dnd_context.js";
import {useTaskGridViewVirtualizedList} from "~/client/tasks/internal/task_grid_view_virtualized_list.js";
import {
    TaskQueryViewCustomizationBar,
    TaskQueryViewCustomizationBarRef,
    taskQueryViewCustomizationBarMinHeight,
} from "~/client/tasks/internal/task_query_view_customization_bar.js";
import {useOutOfBoundsClickSelection} from "~/client/tasks/internal/use_out_of_bounds_click_selection.js";
import {TaskClientQuery} from "~/client/tasks/task_client_query.js";
import {
    getTaskRealtimeClientIfExistsForClient,
    useTaskClientStore,
} from "~/client/tasks/task_realtime_client_context_provider.js";
import {taskRowViewMinHeight, taskRowViewPaddingX} from "~/client/tasks/task_row_shared_styles.js";
import {
    VirtualizedScrollView,
    VirtualizedScrollViewRef,
} from "~/client/virtualized/virtualized_scroll_view.js";
import {Spacing, addRemLengths, convertRemLengthToPx, spacing} from "~/shared/design/spacing.js";
import {scheduleMicrotask} from "~/shared/helpers/async/schedule_microtask.js";
import {assertEqualTypes} from "~/shared/helpers/control/assert_equal_types.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {cast} from "~/shared/helpers/control/cast.js";
import {isDeepEqual} from "~/shared/helpers/control/is_deep_equal.js";
import {iterableEvery} from "~/shared/helpers/iterable/iterable_every.js";
import {getOrSetDefaultMapValue} from "~/shared/helpers/map/get_or_set_default_map_value.js";
import {Id, generateId} from "~/shared/id/id.js";
import {AccountId, TaskId} from "~/shared/id/types/id_types.js";
import {inputPlaceholderStyles, tasksStyles} from "~/shared/styles/styles.js";
import {TaskGridViewExpansionState} from "~/shared/tasks/task_grid_view_expansion_state.js";
import {TaskQueryFilter} from "~/shared/tasks/task_query_filter.js";
import {
    TaskQueryFilterReferences,
    mergeTaskQueryFilterReferences,
} from "~/shared/tasks/task_query_filter_references.js";
import {
    TaskQueryNormalizedFilters,
    normalizeTaskQueryFilters,
} from "~/shared/tasks/task_query_normalized_filters.js";
import {
    TaskQueryNormalizedSort,
    normalizeTaskQuerySorts,
} from "~/shared/tasks/task_query_normalized_sort.js";
import {TaskQuerySort} from "~/shared/tasks/task_query_sort.js";

export function isTaskQueryMissingRequiredFiltersForQueryView(
    currentAccountId: AccountId,
    filters: TaskQueryNormalizedFilters,
): boolean {
    if (
        filters.creatorFilter?.type === "OneOf" &&
        filters.creatorFilter.accountIds.size === 1 &&
        filters.creatorFilter.accountIds.has(currentAccountId)
    ) {
        return false;
    }

    if (
        filters.assigneeFilter?.type === "OneOf" &&
        filters.assigneeFilter.accountIds.size === 1 &&
        filters.assigneeFilter.accountIds.has(currentAccountId)
    ) {
        return false;
    }

    // Assume that if the user filtered on a collection that they have access to
    // the collection.
    if (
        filters.collectionsFilter?.some(clause =>
            iterableEvery(clause, ([term, not]) => term !== "IsEmpty" && !not),
        )
    ) {
        return false;
    }

    return true;
}

const virtualizedScrollViewStateKeyByActiveQuery = new WeakMap<TaskClientQuery, Id>();

export function TaskQueryView({
    initialQuery,
    initialGridViewExpansionState,
    initialBottomGhostTaskId,
    initialFilters,
    initialFilterReferences,
    onFiltersChange,
    initialSorts,
    onSortsChange,
}: {
    initialQuery: TaskClientQuery | null;
    initialGridViewExpansionState: TaskGridViewExpansionState;
    initialBottomGhostTaskId: TaskId;
    initialFilters: ReadonlyArray<TaskQueryFilter>;
    initialFilterReferences: TaskQueryFilterReferences;
    onFiltersChange: (filters: ReadonlyArray<TaskQueryFilter>) => void;
    initialSorts: ReadonlyArray<TaskQuerySort>;
    onSortsChange: (sorts: ReadonlyArray<TaskQuerySort>) => void;
}) {
    const browserId = useBrowserId();
    const remPx = useRemPx();
    const store = useTaskClientStore();
    const currentDate = useCurrentDate();
    const {space, currentAccount} = useSpaceContext();

    const customizationBarRef = useRef<TaskQueryViewCustomizationBarRef>(null);

    /* ========================================================================== *\
     *                                  Filters                                   *
    \* ========================================================================== */

    const [
        {filters, filterReferences, shouldOpenFirstCollectionsFilterOperationValueRef},
        setFiltersState,
    ] = useState({
        filters: initialFilters,
        filterReferences: initialFilterReferences,
        shouldOpenFirstCollectionsFilterOperationValueRef: {current: false},
    });

    const lastFiltersRef = useRef(filters);
    useEffect(() => {
        if (lastFiltersRef.current !== filters) {
            onFiltersChange(filters);
            lastFiltersRef.current = filters;
        }
    }, [filters, onFiltersChange]);

    // After a render that asks for the first collection filter to be opened, go
    // ahead and attempt to open.
    useLayoutEffectWithoutServerSideWarning(() => {
        if (!shouldOpenFirstCollectionsFilterOperationValueRef.current) return;
        shouldOpenFirstCollectionsFilterOperationValueRef.current = false;

        assertExists(customizationBarRef.current).openFirstCollectionsFilterOperationValue();
    }, [shouldOpenFirstCollectionsFilterOperationValueRef]);

    const updateFilters = (
        filters: ReadonlyArray<TaskQueryFilter>,
        {
            mergeFilterReferences,
            shouldOpenFirstCollectionsFilterOperationValue,
        }: {
            mergeFilterReferences?: TaskQueryFilterReferences;
            shouldOpenFirstCollectionsFilterOperationValue?: boolean;
        } = {},
    ) => {
        setFiltersState(({filterReferences}) => {
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
    };

    /* ========================================================================== *\
     *                                   Sorts                                    *
    \* ========================================================================== */

    const [sorts, setSorts] = useState(initialSorts);

    const lastSortsRef = useRef(sorts);
    useEffect(() => {
        if (lastSortsRef.current !== sorts) {
            onSortsChange(sorts);
            lastSortsRef.current = sorts;
        }
    }, [onSortsChange, sorts]);

    const normalizedFiltersResult = useMemo(
        () =>
            normalizeTaskQueryFilters(filters, {currentDate, currentAccountId: currentAccount.id}),
        [currentAccount.id, currentDate, filters],
    );

    const normalizedSorts: ReadonlyArray<TaskQueryNormalizedSort> = normalizeTaskQuerySorts(sorts);

    // Custom views must start with a filter we know the user has access to. We
    // don't yet support querying any set of tasks and dynamically filtering out
    // ones the user doesn't have access to.
    const isMissingRequiredFilters = useMemo(() => {
        if (normalizedFiltersResult.type !== "Possible") return false;
        const {normalizedFilters} = normalizedFiltersResult;
        return isTaskQueryMissingRequiredFiltersForQueryView(currentAccount.id, normalizedFilters);
    }, [currentAccount.id, normalizedFiltersResult]);

    /* ========================================================================== *\
     *                              Query Management                              *
    \* ========================================================================== */

    const [queryState, setQueryState] = useState<{
        readonly activeQuery:
            | {isAvailable: true; query: TaskClientQuery}
            | {isAvailable: false; isMissingRequiredFilters: boolean; query: null};
        readonly pendingQuery: TaskClientQuery | null;
        readonly initialGridViewExpansionState: TaskGridViewExpansionState;
        readonly initialBottomGhostTaskId: TaskId;
    }>({
        activeQuery: initialQuery
            ? {isAvailable: true, query: initialQuery}
            : {isAvailable: false, isMissingRequiredFilters, query: null},
        pendingQuery: null,
        initialGridViewExpansionState,
        // Should change whenever `activeQuery` changes.
        initialBottomGhostTaskId,
    });

    // Make sure the queries in `queryState` stay retained during this
    // component's lifetime.
    useEffect(() => {
        queryState.activeQuery.query?.retain();
        queryState.pendingQuery?.retain();

        return () => {
            // Release after a microtask in case the component is re-rendering which will
            // synchronously call `retain()` again.
            scheduleMicrotask(() => {
                batchStoreUpdates(() => {
                    queryState.activeQuery.query?.release();
                    queryState.pendingQuery?.release();
                });
            });
        };
    }, [queryState.pendingQuery, queryState.activeQuery]);

    // If the filters/sorts set by the user differ from the filters/sorts of the
    // active query we're presenting then we need to start a new pending query in the
    // background we'll swap out.
    useEffect(() => {
        const actualActiveQuery = queryState.activeQuery.isAvailable
            ? {
                  isAvailable: true as const,
                  query: {
                      filters: queryState.activeQuery.query.filters,
                      sorts: queryState.activeQuery.query.sorts,
                  },
              }
            : {
                  isAvailable: false as const,
                  isMissingRequiredFilters: queryState.activeQuery.isMissingRequiredFilters,
                  query: null,
              };

        const actualPendingQuery = queryState.pendingQuery
            ? {filters: queryState.pendingQuery.filters, sorts: queryState.pendingQuery.sorts}
            : null;

        const expectedQuery =
            normalizedFiltersResult.type === "Possible" && !isMissingRequiredFilters
                ? {
                      isAvailable: true as const,
                      query: {
                          filters: normalizedFiltersResult.normalizedFilters,
                          sorts: normalizedSorts,
                      },
                  }
                : {
                      isAvailable: false as const,
                      isMissingRequiredFilters: cast<boolean>(isMissingRequiredFilters),
                      query: null,
                  };

        // Make sure comparing with `isDeepEqual()` is ok by checking that the types
        // are equal.
        assertEqualTypes<typeof actualActiveQuery, typeof expectedQuery>();
        assertEqualTypes<typeof actualPendingQuery, (typeof expectedQuery)["query"]>();

        // If our filters/sorts do not equal the active query or the pending query then
        // we need to start a new pending query.
        if (isDeepEqual(actualActiveQuery, expectedQuery)) return;
        if (expectedQuery.isAvailable && isDeepEqual(actualPendingQuery, expectedQuery.query))
            return;

        if (!expectedQuery.isAvailable) {
            setQueryState({
                activeQuery: expectedQuery,
                pendingQuery: null,
                initialGridViewExpansionState: null,
                initialBottomGhostTaskId: generateId(),
            });
            return;
        }

        const newPendingQuery = batchStoreUpdates(() => {
            const newPendingQuery = store.createAndRetainQuery({
                filters: expectedQuery.query.filters,
                sorts: expectedQuery.query.sorts,
            });
            newPendingQuery.loadMoreTasks(
                getTaskGridViewLoadQueryLimit(getClientInfoWithoutListening()),
            );

            // This needs to be called in `batchStoreUpdates()` since it delays our
            // `TaskRealtimeClient` subscribing to the query.
            getTaskRealtimeClientIfExistsForClient(
                space.id,
            )?.setShouldLoadGridViewExpansionStateForQuery(newPendingQuery);

            return newPendingQuery;
        });

        setQueryState({
            activeQuery: queryState.activeQuery,
            pendingQuery: newPendingQuery,
            initialGridViewExpansionState: queryState.initialGridViewExpansionState,
            initialBottomGhostTaskId: queryState.initialBottomGhostTaskId,
        });

        return () => {
            // Release after a microtask since when the component re-renders we
            // synchronously call `retain()` in the above hook keeping the query alive.
            scheduleMicrotask(() => {
                newPendingQuery.release();
            });
        };
    }, [
        browserId,
        isMissingRequiredFilters,
        normalizedFiltersResult,
        normalizedSorts,
        queryState,
        space.id,
        store,
    ]);

    // Once the pending query has finished loading, swap it out as the new
    // active query.
    useEffect(() => {
        if (!queryState.pendingQuery) return;
        const {pendingQuery} = queryState;

        const pendingQueryPromise = pendingQuery.waitForLoaded();

        let isCancelled = false;

        // TODO(calebmer, #global-loading-indicator): Add a loading spinner while we
        // wait for the pending query to load.
        pendingQueryPromise.finally(() => {
            if (isCancelled) return;

            setQueryState({
                activeQuery: {isAvailable: true, query: pendingQuery},
                pendingQuery: null,
                initialGridViewExpansionState:
                    getTaskRealtimeClientIfExistsForClient(
                        space.id,
                    )?.takeInitialGridViewExpansionStateForQueryIfExists(pendingQuery) ?? null,
                initialBottomGhostTaskId: generateId(),
            });
        });

        return () => {
            isCancelled = true;
        };
    }, [queryState, space.id]);

    /* ========================================================================== *\
     *                                 Grid View                                  *
    \* ========================================================================== */

    const viewRef = useRef<VirtualizedScrollViewRef>(null);

    const {
        modals: gridViewModals,
        itemCount: gridViewItemCount,
        renderItem: renderGridViewItem,
        onRenderedRangeChange: onGridViewRenderedRangeChange,
        onRenderedRangeLayoutChange: onGridViewRenderedRangeLayoutChange,
        alwaysRenderAdditionalItemIndexes: alwaysRenderAdditionalGridViewItemIndexes,
        insetScrollbarItemIndex: insetScrollbarGridViewItemIndex,
        focusEnd: focusGridViewEnd,
    } = useTaskGridViewVirtualizedList({
        capabilities: useMemo(
            () => ({
                isReadOnly: false,
                hasParentTaskTitle: true,
                hasMultilineTitle: false,
                hasDenseFields: false,
                hasColumns: true,
            }),
            [],
        ),
        query: queryState.activeQuery.query,
        initialExpansionState: queryState.initialGridViewExpansionState,
        initialBottomGhostTaskId: queryState.initialBottomGhostTaskId,
        viewRef,
        // NOCOMMIT
        getMoveTaskToQueryActions: () => [],
        // NOCOMMIT
        getMaybeRemoveTaskFromQueryActions: () => [],
        withColumnHeaderBorderTop: true,
        withColumnHeaderExtraScrollSpace: "2",
        columnHeaderControls: useMemo(() => {
            const paddingTop: Spacing = "3";
            const paddingBottom: Spacing = "7";

            return {
                minHeight: addRemLengths(
                    spacing[paddingTop],
                    taskQueryViewCustomizationBarMinHeight,
                    spacing[paddingBottom],
                ),
                node: (
                    <Box
                        position="relative"
                        paddingX={taskRowViewPaddingX}
                        paddingTop={paddingTop}
                        paddingBottom={paddingBottom}
                    >
                        <TaskQueryViewCustomizationBar
                            ref={customizationBarRef}
                            store={store}
                            shouldCollapseWhenFiltersAreEmpty={false}
                            defaultOrderSentence="By default, tasks are ordered by created date."
                            filters={filters}
                            filterReferences={filterReferences}
                            onFiltersChange={updateFilters}
                            sorts={sorts}
                            onSortsChange={setSorts}
                        />
                    </Box>
                ),
            };
        }, [filterReferences, filters, sorts, store]),
    });

    return (
        <Box
            position="relative"
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
            <TaskGridViewDndContext store={store}>
                {gridViewModals}
                <VirtualizedScrollView
                    ref={viewRef}
                    stateKey={
                        // Whenever our `activeQuery` changes we reset the `<VirtualizedScrollView>`s
                        // internal state (which also scrolls the view to the top). We do this
                        // instead of:
                        //
                        // - Using a React `key` because that would remount all components which is
                        //   expensive and some components will be shared (e.g. the column header)
                        // - Calling `viewRef.current.setScrollOffset(0)` because there will be an
                        //   intermediate render where `<VirtualizedScrollView>` renders the new query
                        //   at the old scroll offset (potentially causing unnecessary data to load
                        //   because we're rendering the "load more" item)
                        queryState.activeQuery.isAvailable
                            ? getOrSetDefaultMapValue(
                                  virtualizedScrollViewStateKeyByActiveQuery,
                                  queryState.activeQuery.query,
                                  generateId,
                              )
                            : undefined
                    }
                    bufferedItemHeight={spacing[taskRowViewMinHeight]}
                    itemCount={gridViewItemCount}
                    alwaysRenderAdditionalItemIndexes={alwaysRenderAdditionalGridViewItemIndexes}
                    insetScrollbarItemIndex={insetScrollbarGridViewItemIndex}
                    renderItem={renderGridViewItem}
                    onRenderedRangeChange={onGridViewRenderedRangeChange}
                    onRenderedRangeLayoutChange={onGridViewRenderedRangeLayoutChange}
                    extraChildren={
                        !queryState.activeQuery.isAvailable &&
                        queryState.activeQuery.isMissingRequiredFilters
                            ? ({contentHeight, viewHeight, shouldRenderWithRelativePositioning}) =>
                                  !shouldRenderWithRelativePositioning && (
                                      <Box
                                          position="absolute"
                                          left="0"
                                          right="0"
                                          paddingX={taskRowViewPaddingX}
                                          pointerEvents="auto"
                                          style={{
                                              top: contentHeight,
                                              height: Math.min(
                                                  convertRemLengthToPx(spacing["128"], remPx),
                                                  viewHeight - contentHeight,
                                              ),
                                          }}
                                      >
                                          <Box
                                              height="full"
                                              display="flex"
                                              justifyContent="center"
                                              alignItems="center"
                                          >
                                              <TaskQueryViewInstructionalPlaceholder
                                                  filters={filters}
                                                  onFiltersChange={updateFilters}
                                              />
                                          </Box>
                                      </Box>
                                  )
                            : undefined
                    }
                />
            </TaskGridViewDndContext>
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
    const {currentAccount} = useSpaceContext();

    return (
        <Box maxWidth="96">
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
                Views must include one of the following filters so you don’t see other people’s
                private tasks.
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
                <Box display="flex">
                    <Box
                        display="flex"
                        height="6"
                        alignItems="center"
                        paddingX="2"
                        gap="2"
                        border="grey-10"
                        borderRadius="base"
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
                    height="6"
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
                                operation: {type: "OneOf", accounts: [{type: "CurrentAccount"}]},
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
                        borderRadius="base"
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
                    height="6"
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
                                operation: {type: "OneOf", accounts: [{type: "CurrentAccount"}]},
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
                        borderRadius="base"
                    >
                        <Box>Collections</Box>
                        <Box color="grey-60">has</Box>
                        <Box style={inputPlaceholderStyles}>any collection</Box>
                    </Box>
                </Box>
                <Button
                    variant="neutral"
                    icon={<Plus />}
                    height="6"
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
                                    operation: {type: "IncludesOneOf", collectionIds: new Set()},
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
