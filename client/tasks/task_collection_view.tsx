import {Memo, useCallback, useImperativeHandle, useMemo, useRef} from "react";
import {AccountClientStore} from "~/client/accounts/account_client_store.js";
import {Box} from "~/client/design/box.js";
import {ConstStore} from "~/client/helpers/store/const_store.js";
import {useStore} from "~/client/helpers/store/use_store.js";
import {useSpaceContext} from "~/client/spaces/space_context.js";
import {getNewTaskPositionForQuerySortedByPosition} from "~/client/tasks/get_new_task_position_for_query_sorted_by_position.js";
import {getTaskCollectionSubscriptionAccessStore} from "~/client/tasks/internal/get_task_subscription_access_store.js";
import {TaskCollectionViewHeader} from "~/client/tasks/internal/task_collection_view_header.js";
import {TaskGridViewDndContext} from "~/client/tasks/internal/task_grid_view_dnd_context.js";
import {
    TaskGridViewVirtualizedListViewRef,
    useTaskGridViewVirtualizedList,
} from "~/client/tasks/internal/task_grid_view_virtualized_list.js";
import {useOutOfBoundsClickSelection} from "~/client/tasks/internal/use_out_of_bounds_click_selection.js";
import {TaskClientCollectionSubscription} from "~/client/tasks/task_client_collection_subscription.js";
import {TaskClientQuery} from "~/client/tasks/task_client_query.js";
import {TaskClientStore} from "~/client/tasks/task_client_store.js";
import {taskRowViewMinHeight} from "~/client/tasks/task_row_shared_styles.js";
import {
    VirtualizedScrollView,
    VirtualizedScrollViewRef,
} from "~/client/virtualized/virtualized_scroll_view.js";
import {spacing} from "~/shared/design/spacing.js";
import {scheduleUncaughtError} from "~/shared/helpers/async/schedule_uncaught_error.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {generateOrderKeyBetween} from "~/shared/helpers/sort/order_key.js";
import {SpaceId, TaskCollectionId, TaskId} from "~/shared/id/types/id_types.js";
import {tasksStyles} from "~/shared/styles/styles.js";
import {TaskAction} from "~/shared/tasks/actions/task_action.js";
import {TaskGridViewExpansionState} from "~/shared/tasks/task_grid_view_expansion_state.js";
import {assertNonEmptyReadonlyMap} from "~/shared/tasks/task_query_normalized_filters.js";

export {newTaskCollectionNamePlaceholder} from "~/client/tasks/internal/task_collection_view_header.js";

export function TaskCollectionView({
    store,
    collectionId,
    collectionSubscription,
    query,
    initialGridViewExpansionState,
    initialBottomGhostTaskId,
    createCollection,
}: {
    store: TaskClientStore;
    collectionId: TaskCollectionId;
    // If `collectionSubscription` is null, that means we are creating a
    // new collection.
    collectionSubscription: TaskClientCollectionSubscription | null;
    query: TaskClientQuery | null;
    initialGridViewExpansionState: TaskGridViewExpansionState;
    initialBottomGhostTaskId: TaskId;
    createCollection: Memo<(name: string) => Promise<void>>;
}) {
    const {currentAccount} = useSpaceContext();

    const isReadOnly = useStore(
        useMemo(() => {
            // If we're creating a new collection, it should be editable.
            if (!collectionSubscription) return new ConstStore(false);

            return getTaskCollectionSubscriptionAccessStore(
                currentAccount.id,
                collectionSubscription,
            ).map(access => {
                switch (access.type) {
                    case "Deleted":
                    case "PermissionDenied":
                        return true;
                    case "PermissionGranted":
                        return false;
                    default:
                        throw exhaustive(access);
                }
            });
        }, [currentAccount.id, collectionSubscription]),
    );

    const viewRef = useRef<VirtualizedScrollViewRef>(null);
    const gridViewRef = useRef<TaskGridViewVirtualizedListViewRef>(null);

    const shiftRenderedRangeForGridView = useCallback(
        (range: {startIndex: number; endIndex: number} | null) => {
            if (!range) {
                return null;
            } else {
                const startIndex = range.startIndex - 1;
                const endIndex = range.endIndex - 1;
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
        [],
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
            getRenderedRange: () =>
                shiftRenderedRangeForGridView(assertExists(viewRef.current).getRenderedRange()),
            getKeyByIndexIfExists: index =>
                assertExists(viewRef.current).getKeyByIndexIfExists(index + 1),
            getIndexByKeyIfExists: key => {
                const index = assertExists(viewRef.current).getIndexByKeyIfExists(key);
                if (index === null) return index;
                return index - 1;
            },
            getPositionByIndex: index =>
                assertExists(viewRef.current).getPositionByIndex(index + 1),
            getPositionByKeyIfExists: key =>
                assertExists(viewRef.current).getPositionByKeyIfExists(key),
            peekRenderedRangeAfterSetScrollOffset: scrollOffset =>
                shiftRenderedRangeForGridView(
                    assertExists(viewRef.current).peekRenderedRangeAfterSetScrollOffset(
                        scrollOffset,
                    ),
                ),
            getContentElement: () => assertExists(viewRef.current).getContentElement(),
            getItemElementByKeyIfExists: key =>
                assertExists(viewRef.current).getItemElementByKeyIfExists(key),
        }),
        [shiftRenderedRangeForGridView],
    );

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
        withColumnHeaderBorderTop: true,
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
        query: useMemo(
            () =>
                query ??
                createEmptyTaskCollectionQuery({
                    accountStore: store.accountStore,
                    spaceId: store.spaceId,
                    collectionId,
                }),
            [collectionId, query, store.accountStore, store.spaceId],
        ),
        initialExpansionState: initialGridViewExpansionState,
        initialBottomGhostTaskId,
        viewRef: gridViewRef,
        getMoveTaskToQueryActions: (taskId, position): Array<TaskAction> => {
            assert(collectionSubscription && query);

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
        getMaybeRemoveTaskFromQueryActions: taskId => [
            {
                type: "UpdateTask",
                time: store.clock.now(),
                taskId,
                taskAction: {type: "RemoveCollection", collectionId},
            },
        ],
    });

    return (
        <Box
            flexGrow="1"
            width="full"
            overflow="hidden"
            backgroundColor="grey-0"
            className={tasksStyles.textCursorNotInherited2ClassName}
            {...useOutOfBoundsClickSelection({
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
                    bufferedItemHeight={spacing[taskRowViewMinHeight]}
                    itemCount={gridViewItemCount + 1}
                    alwaysRenderAdditionalItemIndexes={useMemo(
                        () => alwaysRenderAdditionalGridViewItemIndexes.map(index => index + 1),
                        [alwaysRenderAdditionalGridViewItemIndexes],
                    )}
                    insetScrollbarItemIndex={
                        insetScrollbarGridViewItemIndex !== undefined
                            ? insetScrollbarGridViewItemIndex + 1
                            : undefined
                    }
                    renderItem={useCallback(
                        index => {
                            if (index === 0) {
                                return {
                                    key: "TaskDetailViewMain",
                                    // Initial height of:
                                    //
                                    // - Collection name
                                    // - Filters and sorts
                                    //
                                    // NOCOMMIT: Check to make sure this value is accurate when all our UI is
                                    // in place!
                                    minHeight: "3.25rem",
                                    node: (
                                        <TaskCollectionViewHeader
                                            store={store}
                                            collectionId={collectionId}
                                            collectionSubscription={collectionSubscription}
                                            createCollection={createCollection}
                                        />
                                    ),
                                };
                            }

                            return renderGridViewItem(index - 1);
                        },
                        [
                            collectionId,
                            collectionSubscription,
                            createCollection,
                            renderGridViewItem,
                            store,
                        ],
                    )}
                    onRenderedRangeChange={range => {
                        onGridViewRenderedRangeChange(shiftRenderedRangeForGridView(range));
                    }}
                    onRenderedRangeLayoutChange={range => {
                        onGridViewRenderedRangeLayoutChange(shiftRenderedRangeForGridView(range));
                    }}
                />
            </TaskGridViewDndContext>
        </Box>
    );
}

/**
 * Create an empty query with its own empty store completely disconnected from
 * realtime. We use this to render an empty, read-only, `<TaskCollectionView>`
 * when creating a collection.
 *
 * Another strategy would be to create a `TaskClientQuery` on our existing
 * `TaskClientStore` but not connecting it to realtime until after the
 * collection is created.
 */
function createEmptyTaskCollectionQuery({
    accountStore,
    spaceId,
    collectionId,
}: {
    accountStore: AccountClientStore;
    spaceId: SpaceId;
    collectionId: TaskCollectionId;
}) {
    const store = new TaskClientStore({accountStore, spaceId, onError: scheduleUncaughtError});

    const query = store.createAndRetainQuery({
        filters: {
            displayStatusFilter: {
                ifOpenInactive: true,
                ifOpenActive: true,
                ifClosed: false,
            },
            collectionsFilter: [assertNonEmptyReadonlyMap(new Map([[collectionId, false]]))],
        },
        sorts: [
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
        ],
    });

    store.loadTasksIntoQuery(query, {
        limit: 100,
        loadedState: {type: "Full"},
        previouslyBackfilledTaskIds: [],
    });

    return query;
}
