import {IconContext, Trash} from "phosphor-react";
import {Memo, ReactNode, useEffect, useMemo, useRef, useState} from "react";
import {Box} from "~/client/design/box.js";
import {useEvents} from "~/client/helpers/lifecycle/use_event.js";
import {ConstStore} from "~/client/helpers/store/const_store.js";
import {Store} from "~/client/helpers/store/store.js";
import {useStore} from "~/client/helpers/store/use_store.js";
import {useCurrentDate} from "~/client/remix/use_current_time_rounded_to_hour.js";
import {useSpaceContext} from "~/client/spaces/space_context.js";
import {getNewTaskPositionForQuerySortedByPosition} from "~/client/tasks/internal/get_new_task_position_for_query_sorted_by_position.js";
import {getTaskCollectionSubscriptionAccess} from "~/client/tasks/internal/get_task_subscription_access_store.js";
import {PencilSimpleSlash} from "~/client/tasks/internal/pencil_simple_slash.js";
import {TaskCollectionViewHeader} from "~/client/tasks/internal/task_collection_view_header.js";
import {
    isTaskQueryManuallySorted,
    useTaskGridViewVirtualizedList,
} from "~/client/tasks/internal/task_grid_view_virtualized_list.js";
import {TaskQueryViewCustomizationBar} from "~/client/tasks/internal/task_query_view_customization_bar.js";
import {useOutOfBoundsClickSelection} from "~/client/tasks/internal/use_out_of_bounds_click_selection.js";
import {TaskClientCollectionSubscription} from "~/client/tasks/task_client_collection_subscription.js";
import {TaskClientQuery} from "~/client/tasks/task_client_query.js";
import {TaskClientStore} from "~/client/tasks/task_client_store.js";
import {getTaskQueryViewReadOnlyReasonStore} from "~/client/tasks/task_query_view.js";
import {taskRowViewPaddingX} from "~/client/tasks/task_row_shared_styles.js";
import {useTaskQueryState} from "~/client/tasks/use_task_query_state.js";
import {
    VirtualizedScrollView,
    VirtualizedScrollViewRef,
} from "~/client/virtualized/virtualized_scroll_view.js";
import {addRemLengths, spacing} from "~/shared/design/spacing.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {generateOrderKeyBetween} from "~/shared/helpers/sort/order_key.js";
import {TaskCollectionId, TaskId} from "~/shared/id/types/id_types.js";
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

export {newTaskCollectionNamePlaceholder} from "~/client/tasks/internal/task_collection_view_header.js";

export function TaskCollectionView({
    store,
    collectionId,
    collectionSubscription,
    initialQuery,
    initialFilters,
    initialFilterReferences,
    onFiltersChange,
    initialSorts,
    onSortsChange,
    createCollection,
}: {
    store: TaskClientStore;
    collectionId: TaskCollectionId;
    // If `collectionSubscription` is null, that means we are creating a
    // new collection.
    collectionSubscription: TaskClientCollectionSubscription | null;
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
    const {currentAccount} = useSpaceContext();
    const currentDate = useCurrentDate();

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
                    getTaskCollectionSubscriptionAccess(currentAccount.id, collectionEntry),
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
                getTaskQueryViewReadOnlyReasonStore({
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

    const {
        stateKey: gridViewStateKey,
        bufferedItemHeight: gridViewBufferedItemHeight,
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
                isReadOnly,
                hasParentTaskTitle: true,
                hasMultilineTitle: false,
                hasDenseFields: false,
                hasColumns: true,
            }),
            [isReadOnly],
        ),
        viewRef,
        query: queryState.activeQuery.query,
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
        withColumnHeaderBorderTop: true,
        // TODO(calebmer): I'd like to kill extra scroll space. Feels wrong. Looks
        // particularly wrong with `readOnlyReason`.
        withColumnHeaderExtraScrollSpace: "1.5",
        columnHeaderControls: useMemo(() => {
            return {
                minHeight: "2.875rem",
                node: (
                    <>
                        {readOnlyReason?.message && (
                            // TODO(calebmer): This should really be a sticky header. We should probably
                            // have a sticky header for the task title too.
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
                        <Box display="flex" paddingX={taskRowViewPaddingX}>
                            <Box paddingTop="1.5" paddingBottom="3" maxWidth="1/2">
                                <TaskCollectionViewHeader
                                    isReadOnly={isReadOnly}
                                    store={store}
                                    collectionId={collectionId}
                                    collectionSubscription={collectionSubscription}
                                    createCollection={createCollection}
                                />
                            </Box>
                            <Box
                                flexGrow="1"
                                paddingLeft="5"
                                paddingTop="2"
                                style={{paddingBottom: addRemLengths(spacing["3"], spacing["0.5"])}}
                            >
                                <Box borderLeft="grey-5" paddingLeft="5">
                                    <TaskQueryViewCustomizationBar
                                        store={store}
                                        shouldCollapseWhenFiltersAreEmpty={true}
                                        defaultOrderSentence={
                                            filters.length > 0
                                                ? "When filtered, tasks are ordered by created date."
                                                : "You can order tasks manually by dragging them."
                                        }
                                        filters={filters}
                                        filterReferences={filterReferences}
                                        onFiltersChange={updateFilters}
                                        sorts={sorts}
                                        onSortsChange={setSorts}
                                    />
                                </Box>
                            </Box>
                        </Box>
                    </>
                ),
            };
        }, [
            collectionId,
            collectionSubscription,
            createCollection,
            filterReferences,
            filters,
            isReadOnly,
            readOnlyReason,
            setSorts,
            sorts,
            store,
            updateFilters,
        ]),
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
            <VirtualizedScrollView
                ref={viewRef}
                stateKey={gridViewStateKey}
                bufferedItemHeight={gridViewBufferedItemHeight}
                itemCount={gridViewItemCount}
                alwaysRenderAdditionalItemIndexes={alwaysRenderAdditionalGridViewItemIndexes}
                insetScrollbarItemIndex={insetScrollbarGridViewItemIndex}
                renderItem={renderGridViewItem}
                onRenderedRangeChange={onGridViewRenderedRangeChange}
                onRenderedRangeLayoutChange={onGridViewRenderedRangeLayoutChange}
            />
        </Box>
    );
}
