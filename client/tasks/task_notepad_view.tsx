import {useCallback, useImperativeHandle, useMemo, useRef, useState} from "react";
import {Box} from "~/client/design/box.js";
import {useSpaceContext} from "~/client/spaces/space_context.js";
import {getNewTaskPositionForQuerySortedByPosition} from "~/client/tasks/internal/get_new_task_position_for_query_sorted_by_position.js";
import {TaskGridViewDndContext} from "~/client/tasks/internal/task_grid_view_dnd_context.js";
import {
    TaskGridViewVirtualizedListViewRef,
    useTaskGridViewVirtualizedList,
} from "~/client/tasks/internal/task_grid_view_virtualized_list.js";
import {useOutOfBoundsClickSelection} from "~/client/tasks/internal/use_out_of_bounds_click_selection.js";
import {TaskClientQuery} from "~/client/tasks/task_client_query.js";
import {TaskClientStore} from "~/client/tasks/task_client_store.js";
import {useTaskQueryState} from "~/client/tasks/use_task_query_state.js";
import {
    VirtualizedScrollView,
    VirtualizedScrollViewRef,
} from "~/client/virtualized/virtualized_scroll_view.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {TaskId} from "~/shared/id/types/id_types.js";
import {tasksStyles} from "~/shared/styles/styles.js";
import {TaskGridViewExpansionState} from "~/shared/tasks/task_grid_view_expansion_state.js";
import {TaskNotepadPageId} from "~/shared/tasks/task_notepad_page_id.js";

export function TaskNotepadView({
    store,
    initialQuery,
    initialNotepadPageId,
}: {
    store: TaskClientStore;
    initialQuery: {
        query: TaskClientQuery;
        initialGridViewExpansionState: TaskGridViewExpansionState;
        initialBottomGhostTaskId: TaskId;
    };
    initialNotepadPageId: TaskNotepadPageId;
}) {
    const {currentAccount} = useSpaceContext();

    const viewRef = useRef<VirtualizedScrollViewRef>(null);
    const gridViewRef = useRef<TaskGridViewVirtualizedListViewRef>(null);

    const [notepadPageId, setNotepadPageId] = useState(initialNotepadPageId);

    const queryState = useTaskQueryState({
        store,
        initialQuery,
        filters: useMemo(
            () => ({
                displayStatusFilter: {
                    ifOpenInactive: true,
                    ifOpenActive: true,
                    ifClosed: true,
                },
                notepadPageFilter: {
                    accountId: currentAccount.id,
                    notepadPageId,
                },
            }),
            [currentAccount.id, notepadPageId],
        ),
        sorts: useMemo(
            () => [
                {
                    type: "NotepadPagePosition",
                    accountId: currentAccount.id,
                    notepadPageId,
                    direction: "Ascending",
                    missing: "Last",
                },
                {
                    type: "CreatedTime",
                    direction: "Ascending",
                    missing: "Last",
                },
            ],
            [currentAccount.id, notepadPageId],
        ),
    });

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
        stateKey: gridViewStateKey,
        bufferedItemHeight: gridViewBufferedItemHeight,
        modals: gridViewModals,
        itemCount: gridViewItemCount,
        renderItem: renderGridViewItem,
        onRenderedRangeChange: onGridViewRenderedRangeChange,
        onRenderedRangeLayoutChange: onGridViewRenderedRangeLayoutChange,
        alwaysRenderAdditionalItemIndexes: alwaysRenderGridViewItemIndexes,
        insetScrollbarItemIndex: insetScrollbarGridViewItemIndex,
        focusEnd: focusGridViewEnd,
    } = useTaskGridViewVirtualizedList({
        capabilities: useMemo(
            () => ({
                isReadOnly: false,
                hasParentTaskTitle: true,
                hasMultilineTitle: false,
                hasColumns: true,
                hasDenseFields: false,
            }),
            [],
        ),
        query: queryState.activeQuery.query,
        viewRef: gridViewRef,
        getMoveTaskToQueryActions: (taskId, position) => {
            const time = store.clock.now();

            assert(queryState.activeQuery.isAvailable);
            const query = queryState.activeQuery.query.query;

            return [
                {
                    type: "UpdateTask",
                    time,
                    taskId,
                    taskAction: {
                        type: "UpdateNotepadPagePosition",
                        accountId: currentAccount.id,
                        notepadPageId,
                        position: getNewTaskPositionForQuerySortedByPosition(time, query, position),
                    },
                },
            ];
        },
        getMaybeRemoveTaskFromQueryActions: taskId => [
            {
                type: "UpdateTask",
                time: store.clock.now(),
                taskId,
                taskAction: {
                    type: "UpdateNotepadPagePosition",
                    accountId: currentAccount.id,
                    notepadPageId,
                    position: null,
                },
            },
        ],
        withColumnHeaderBorderTop: true,
    });

    return (
        <Box
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
                    stateKey={gridViewStateKey}
                    bufferedItemHeight={gridViewBufferedItemHeight}
                    itemCount={1 + gridViewItemCount}
                    alwaysRenderAdditionalItemIndexes={useMemo(
                        () => alwaysRenderGridViewItemIndexes.map(index => index + 1),
                        [alwaysRenderGridViewItemIndexes],
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
                                    key: "ActiveCards",
                                    // NOCOMMIT: Real height
                                    minHeight: 200,
                                    node: null,
                                };
                            }

                            return renderGridViewItem(index - 1);
                        },
                        [renderGridViewItem],
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
