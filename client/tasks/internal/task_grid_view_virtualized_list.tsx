import {SpinnerGap} from "phosphor-react";
import {Selection} from "prosemirror-state";
import {Key, Memo, ReactNode, RefObject, useEffect, useMemo, useRef, useState} from "react";
import {useAppContext} from "~/client/context/app_context.js";
import {Box} from "~/client/design/box.js";
import {getRemPxWithoutListening} from "~/client/design/helpers/use_rem_px.js";
import {useEvent, useEvents} from "~/client/helpers/lifecycle/use_event.js";
import {batchStoreUpdates} from "~/client/helpers/store/batch_store_updates.js";
import {ConstStore} from "~/client/helpers/store/const_store.js";
import {useStore} from "~/client/helpers/store/use_store.js";
import {getClientInfoWithoutListening} from "~/client/remix/client_info_context.js";
import {getNewTaskPositionForQuerySortedByPosition} from "~/client/tasks/get_new_task_position_for_query_sorted_by_position.js";
import {getTaskGridViewLoadQueryLimit} from "~/client/tasks/get_task_grid_view_load_query_limit.js";
import {TaskDeleteConfirmationModalDialog} from "~/client/tasks/internal/task_delete_confirmation_modal_dialog.js";
import {TaskGridViewCapabilities} from "~/client/tasks/internal/task_grid_view_capabilities.js";
import {TaskGridViewTaskKey} from "~/client/tasks/internal/task_grid_view_task_key.js";
import {TaskGridViewVirtualizedTaskList} from "~/client/tasks/internal/task_grid_view_virtualized_task_list.js";
import {TaskRowShimmer} from "~/client/tasks/internal/task_row_shimmer.js";
import {TaskRowView, TaskRowViewRef} from "~/client/tasks/internal/task_row_view.js";
import {useOutOfBoundsClickSelection} from "~/client/tasks/internal/use_out_of_bounds_click_selection.js";
import {useTaskGridViewExpansionState} from "~/client/tasks/internal/use_task_grid_view_expansion_state.js";
import {TaskClientQuery} from "~/client/tasks/task_client_query.js";
import {taskRowViewMinHeight} from "~/client/tasks/task_row_shared_styles.js";
import {
    VirtualizedScrollViewItem,
    VirtualizedScrollViewRef,
} from "~/client/virtualized/virtualized_scroll_view.js";
import {addRemLengths, convertRemLengthToPx, spacing} from "~/shared/design/spacing.js";
import {emptyArray} from "~/shared/helpers/array/empty_array.js";
import {scheduleMicrotask} from "~/shared/helpers/async/schedule_microtask.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertAssignableTypes} from "~/shared/helpers/control/assert_assignable_types.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {cast} from "~/shared/helpers/control/cast.js";
import {isDeepEqual} from "~/shared/helpers/control/is_deep_equal.js";
import {noop} from "~/shared/helpers/control/noop.js";
import {initialOrderKey} from "~/shared/helpers/sort/order_key.js";
import {generateId} from "~/shared/id/id.js";
import {TaskId} from "~/shared/id/types/id_types.js";
import {colorSchemeVars, spinAnimationClassName} from "~/shared/styles/styles.js";
import {TaskAction} from "~/shared/tasks/actions/task_action.js";
import {TaskGridViewExpansionState} from "~/shared/tasks/task_grid_view_expansion_state.js";
import {getTaskQuerySortCursorTaskId} from "~/shared/tasks/task_query_sort_cursor.js";

const undefinedConstStore = new ConstStore(undefined);

const taskGridViewMoreUnloadedTasksSpinnerHeight = addRemLengths(
    spacing[taskRowViewMinHeight],
    spacing[taskRowViewMinHeight],
    spacing[taskRowViewMinHeight],
    spacing["4"],
    spacing["6"],
    spacing["4"],
);

export type TaskGridViewVirtualizedListViewRef = {
    getHeight: () => number;
    getContentHeight: () => number;
    getScrollOffset: () => number;
    setScrollOffset: (scrollOffset: number) => void;
    getRenderedRange: () => {startIndex: number; endIndex: number} | null;
    getKeyByIndexIfExists: (index: number) => Key | null;
    getIndexByKeyIfExists: (key: Key) => number | null;
    getPositionByIndex: (index: number) => {offset: number; height: number};
    peekRenderedRangeAfterSetScrollOffset: (
        scrollOffset: number,
    ) => {startIndex: number; endIndex: number} | null;
};

// Should be able to pass `VirtualizedScrollViewRef` in for
// `TaskGridViewVirtualizedListViewRef`. Often our virtualized grid view will
// have other stuff besides tasks so a modified ref object may be passed in.
assertAssignableTypes<VirtualizedScrollViewRef, TaskGridViewVirtualizedListViewRef>();

export function useTaskGridViewVirtualizedList({
    capabilities,
    query,
    initialExpansionState,
    initialBottomGhostTaskId,
    viewRef,
    getMoveTaskToQueryActions: _getMoveTaskToQueryActions,
    getMaybeRemoveTaskFromQueryActions: _getMaybeRemoveTaskFromQueryActions,
}: {
    capabilities: TaskGridViewCapabilities;
    query: TaskClientQuery;
    initialExpansionState: TaskGridViewExpansionState;
    initialBottomGhostTaskId: TaskId;
    viewRef: RefObject<TaskGridViewVirtualizedListViewRef | null>;
    getMoveTaskToQueryActions: (
        taskId: TaskId,
        position: {type: "End"} | {type: "Above"; taskId: TaskId} | {type: "Below"; taskId: TaskId},
    ) => Array<TaskAction>;
    getMaybeRemoveTaskFromQueryActions: (taskId: TaskId) => Array<TaskAction>;
}): {
    itemCount: number;
    renderItem: Memo<(index: number) => VirtualizedScrollViewItem>;
    onRenderedRangeChange: (renderedRange: {startIndex: number; endIndex: number} | null) => void;
    modals: ReactNode;
    focusStart: Memo<() => void>;
} {
    const context = useAppContext();

    const [bottomGhostTaskId, setBottomGhostTaskId] = useState(initialBottomGhostTaskId);

    const {
        getAreChildTasksExpandedStore,
        toggleAreChildTasksExpanded,
        iterateExpandedTaskIdsUnderPath,
    } = useTaskGridViewExpansionState({
        query,
        initialState: initialExpansionState,
    });

    const listStore = useMemo(
        () => TaskGridViewVirtualizedTaskList.new(query, getAreChildTasksExpandedStore),
        [getAreChildTasksExpandedStore, query],
    );

    const list = useStore(listStore);
    const loadedState = useStore(query.loadedStateStore);

    const [taskDeleteConfirmationState, setTaskDeleteConfirmationState] = useState<{
        taskId: TaskId;
        onAfterDelete?: () => void;
    } | null>(null);

    const events = useEvents({
        getMoveTaskToQueryActions: _getMoveTaskToQueryActions,
        getMaybeRemoveTaskFromQueryActions: _getMaybeRemoveTaskFromQueryActions,

        focusStart: () => {
            for (let index = 0; index < itemCount; index++) {
                const taskRow = taskRowByItemIndexRef.current.get(index);
                if (!taskRow) continue;

                taskRow.focusTitleStart();
                break;
            }
        },
    });

    const taskRowByTaskKeyRef = useRef(new Map<TaskGridViewTaskKey, TaskRowViewRef>());
    const taskRowByItemIndexRef = useRef(new Map<number, TaskRowViewRef>());

    const onRenderedRangeChangeCallbacksRef = useRef<
        Array<(renderedRange: {startIndex: number; endIndex: number} | null) => void>
    >([]);
    const onTaskDeleteConfirmationModalDialogClosedCallbacksRef = useRef<Array<() => void>>([]);

    useEffect(() => {
        if (!taskDeleteConfirmationState) {
            const callbacks = onTaskDeleteConfirmationModalDialogClosedCallbacksRef.current;
            onTaskDeleteConfirmationModalDialogClosedCallbacksRef.current = [];

            for (const callback of callbacks) {
                callback();
            }
        }
    }, [taskDeleteConfirmationState]);

    const lastArrowNavigationCoordRef = useRef<{setTime: Date; coord: number} | null>(null);

    // Clear the last arrow navigation X position whenever the user's caret moves
    // somewhere else.
    useEffect(() => {
        const clearLastArrowNavigationCoord = () => {
            if (
                lastArrowNavigationCoordRef.current &&
                // If we just set this ref, don't clear it. We're processing browser events
                // that happened because of the arrow navigation.
                new Date().getTime() - lastArrowNavigationCoordRef.current.setTime.getTime() > 10
            ) {
                lastArrowNavigationCoordRef.current = null;
            }
        };

        document.addEventListener("focus", clearLastArrowNavigationCoord);
        document.addEventListener("blur", clearLastArrowNavigationCoord);
        document.addEventListener("selectionchange", clearLastArrowNavigationCoord);
        return () => {
            document.removeEventListener("focus", clearLastArrowNavigationCoord);
            document.removeEventListener("blur", clearLastArrowNavigationCoord);
            document.removeEventListener("selectionchange", clearLastArrowNavigationCoord);
        };
    }, []);

    const listItemCount = list.getItemCount();

    const itemCount =
        loadedState !== "FullyLoaded"
            ? listItemCount + 1
            : Math.max(listItemCount + (!capabilities.isReadOnly ? 1 : 0), 3);

    const tryLoadingMoreData = useEvent(
        (renderedRange: {startIndex: number; endIndex: number} | null) => {
            if (!renderedRange) return;

            batchStoreUpdates(() => {
                // If we are rendering the `MoreUnloadedTasks` item then load more tasks into
                // our query.
                if (loadedState !== "FullyLoaded") {
                    const moreUnloadedTasksIndex = list.getItemCount();

                    if (
                        renderedRange.startIndex <= moreUnloadedTasksIndex &&
                        moreUnloadedTasksIndex <= renderedRange.endIndex
                    ) {
                        query.loadMoreTasks(
                            getTaskGridViewLoadQueryLimit(getClientInfoWithoutListening()),
                        );
                    }
                }

                // Load more tasks for any tasks that are rendering `UnloadedChildTask`
                // child items.
                const parentTaskIdsToLoad = new Set<TaskId>();

                for (
                    let i = renderedRange.startIndex;
                    i < Math.min(renderedRange.endIndex, listItemCount);
                    i++
                ) {
                    const item = list.getItem(i);

                    if (item.type === "UnloadedChildTask") {
                        parentTaskIdsToLoad.add(
                            getTaskQuerySortCursorTaskId(
                                item.parents[item.parents.length - 1]!.cursor,
                            ),
                        );
                    }
                }

                if (parentTaskIdsToLoad.size > 0) {
                    const retainedChildrenQueries: Array<TaskClientQuery> = [];

                    // We want to immediately release the references to any queries we load after a
                    // microtask. When our expansion state hook sees there's a new query for an
                    // expanded task it will grab its own reference. So wait a microtask for that to
                    // happen and release our reference to let the expanded state hook manage the
                    // query's lifetime.
                    scheduleMicrotask(() => {
                        batchStoreUpdates(() => {
                            for (const query of retainedChildrenQueries) {
                                query.release();
                            }
                        });
                    });

                    for (const taskId of parentTaskIdsToLoad) {
                        const childrenQuery = query.store.ensureAndRetainTaskChildrenQuery(
                            taskId,
                            query.filters.deletedFilter,
                        );
                        retainedChildrenQueries.push(childrenQuery);

                        childrenQuery?.loadMoreTasks(
                            getTaskGridViewLoadQueryLimit(getClientInfoWithoutListening()),
                        );

                        // In addition to loading the root task query, children queries for any of its
                        // expanded child tasks so they all pop in at the same time.
                        for (const {taskId: expandedChildTaskId} of iterateExpandedTaskIdsUnderPath(
                            [taskId],
                        )) {
                            const childrenQuery = query.store.ensureAndRetainTaskChildrenQuery(
                                expandedChildTaskId,
                                query.filters.deletedFilter,
                            );
                            retainedChildrenQueries.push(childrenQuery);

                            childrenQuery?.loadMoreTasks(
                                getTaskGridViewLoadQueryLimit(getClientInfoWithoutListening()),
                            );
                        }
                    }
                }
            });
        },
    );

    // Whenever our list changes, try rendering more data. Maybe a task was
    // expanded and we haven't loaded the children of that task?
    useEffect(() => {
        // eslint-disable-next-line @typescript-eslint/no-unused-expressions
        list;

        const view = assertExists(viewRef.current);
        tryLoadingMoreData(view.getRenderedRange());
    }, [events, list, tryLoadingMoreData, viewRef]);

    const renderItem = useMemo(() => {
        const focusTaskTitleStart = (taskKey: TaskGridViewTaskKey) => {
            taskRowByTaskKeyRef.current.get(taskKey)?.focusTitleStart();
        };

        const focusTaskTitleSelection = (taskKey: TaskGridViewTaskKey, selection: Selection) => {
            taskRowByTaskKeyRef.current.get(taskKey)?.focusTitleSelection(selection);
        };

        const preserveLastTaskTitleArrowNavigationCoord = () => {
            if (lastArrowNavigationCoordRef.current) {
                lastArrowNavigationCoordRef.current = {
                    setTime: new Date(),
                    coord: lastArrowNavigationCoordRef.current.coord,
                };
            }
        };

        const getFirstVisibleTaskRowIfExists = (): TaskRowViewRef | null => {
            const view = assertExists(viewRef.current);

            const renderedRange = view.getRenderedRange();
            if (!renderedRange) return null;

            const height = view.getHeight();
            const scrollOffset = view.getScrollOffset();

            for (let index = renderedRange.startIndex; index <= renderedRange.endIndex; index++) {
                const position = view.getPositionByIndex(index);

                // Look for the first visible item in the scroll window...
                if (
                    position.offset < scrollOffset ||
                    position.offset + position.height > scrollOffset + height
                ) {
                    continue;
                }

                const key = view.getKeyByIndexIfExists(index);

                // We want the first visible task row. Ignore everything else.
                if (typeof key !== "string" || !key.startsWith("Task:")) continue;

                return assertExists(
                    taskRowByTaskKeyRef.current.get(
                        key.slice("Task:".length) as TaskGridViewTaskKey,
                    ),
                );
            }

            return null;
        };

        const focusFirstVisibleTaskTitleStart = () => {
            const firstVisibleTaskRow = getFirstVisibleTaskRowIfExists();
            if (!firstVisibleTaskRow) return;

            // If the first visible task title is already focused then we want to scroll
            // one page up and focus the first task after scrolling.
            if (firstVisibleTaskRow.isTitleFocused()) {
                focusFirstPageUpTaskTitleStart();
            } else {
                firstVisibleTaskRow.focusTitleStart();
            }
        };

        const focusFirstPageUpTaskTitleStart = () => {
            const view = assertExists(viewRef.current);

            const height = view.getHeight();
            const scrollOffset = view.getScrollOffset();

            const newScrollOffset = Math.max(
                0,
                scrollOffset -
                    (height -
                        // We want to keep some overlap between tasks when paging up/down so the user
                        // doesn't completely lose their context.
                        convertRemLengthToPx(
                            spacing[taskRowViewMinHeight],
                            getRemPxWithoutListening(),
                        ) *
                            2),
            );

            const renderedRange = view.getRenderedRange();
            const expectedRenderedRange =
                view.peekRenderedRangeAfterSetScrollOffset(newScrollOffset);

            view.setScrollOffset(newScrollOffset);

            if (!expectedRenderedRange) return;

            if (isDeepEqual(renderedRange, expectedRenderedRange)) {
                const firstVisibleTaskRow = getFirstVisibleTaskRowIfExists();
                firstVisibleTaskRow?.focusTitleStart();
            } else {
                onRenderedRangeChangeCallbacksRef.current.push(() => {
                    const firstVisibleTaskRow = getFirstVisibleTaskRowIfExists();
                    firstVisibleTaskRow?.focusTitleStart();
                });
            }
        };

        const getLastVisibleTaskRowIfExists = (): TaskRowViewRef | null => {
            const view = assertExists(viewRef.current);

            const renderedRange = view.getRenderedRange();
            if (!renderedRange) return null;

            const height = view.getHeight();
            const scrollOffset = view.getScrollOffset();

            for (let index = renderedRange.endIndex; index >= renderedRange.startIndex; index--) {
                const position = view.getPositionByIndex(index);

                // Look for the last visible item in the scroll window...
                if (
                    position.offset < scrollOffset ||
                    position.offset + position.height > scrollOffset + height
                ) {
                    continue;
                }

                const key = view.getKeyByIndexIfExists(index);

                // We want the first visible task row. Ignore everything else.
                if (typeof key !== "string" || !key.startsWith("Task:")) continue;

                return assertExists(
                    taskRowByTaskKeyRef.current.get(
                        key.slice("Task:".length) as TaskGridViewTaskKey,
                    ),
                );
            }

            return null;
        };

        const focusLastVisibleTaskTitleEnd = () => {
            const lastVisibleTaskRow = getLastVisibleTaskRowIfExists();
            if (!lastVisibleTaskRow) return;

            // If the last visible task title is already focused then we want to scroll
            // one page down and focus the last task after scrolling.
            if (lastVisibleTaskRow.isTitleFocused()) {
                focusLastPageDownTaskTitleEnd();
            } else {
                lastVisibleTaskRow.focusTitleEnd();
            }
        };

        const focusLastPageDownTaskTitleEnd = () => {
            const view = assertExists(viewRef.current);

            const height = view.getHeight();
            const contentHeight = view.getContentHeight();
            const scrollOffset = view.getScrollOffset();

            const newScrollOffset = Math.min(
                contentHeight - height,
                scrollOffset +
                    (height -
                        // We want to keep some overlap between tasks when paging up/down so the user
                        // doesn't completely lose their context.
                        convertRemLengthToPx(
                            spacing[taskRowViewMinHeight],
                            getRemPxWithoutListening(),
                        ) *
                            2),
            );

            const renderedRange = view.getRenderedRange();
            const expectedRenderedRange =
                view.peekRenderedRangeAfterSetScrollOffset(newScrollOffset);

            view.setScrollOffset(newScrollOffset);

            if (!expectedRenderedRange) return;

            if (isDeepEqual(renderedRange, expectedRenderedRange)) {
                const lastVisibleTaskRow = getLastVisibleTaskRowIfExists();
                lastVisibleTaskRow?.focusTitleEnd();
            } else {
                onRenderedRangeChangeCallbacksRef.current.push(() => {
                    const lastVisibleTaskRow = getLastVisibleTaskRowIfExists();
                    lastVisibleTaskRow?.focusTitleEnd();
                });
            }
        };

        return (_itemIndex: number): VirtualizedScrollViewItem => {
            const itemIndex = _itemIndex;

            const focusNextTaskTitleCoord = (coord: number) => {
                coord = lastArrowNavigationCoordRef.current?.coord ?? coord;

                for (let index = itemIndex + 1; index < itemCount; index++) {
                    const taskRow = taskRowByItemIndexRef.current.get(index);
                    if (!taskRow) continue;

                    taskRow.focusTitleCoord(coord, "top");
                    break;
                }

                lastArrowNavigationCoordRef.current = {
                    setTime: new Date(),
                    coord,
                };
            };

            const focusPreviousTaskTitleCoord = (coord: number) => {
                coord = lastArrowNavigationCoordRef.current?.coord ?? coord;

                for (let index = itemIndex - 1; index >= 0; index--) {
                    const taskRow = taskRowByItemIndexRef.current.get(index);
                    if (!taskRow) continue;

                    taskRow.focusTitleCoord(coord, "bottom");
                    break;
                }

                lastArrowNavigationCoordRef.current = {
                    setTime: new Date(),
                    coord,
                };
            };

            const focusPreviousTaskTitleEnd = () => {
                for (let index = itemIndex - 1; index >= 0; index--) {
                    const taskRow = taskRowByItemIndexRef.current.get(index);
                    if (!taskRow) continue;

                    taskRow.focusTitleEnd();
                    break;
                }
            };

            const focusPreviousTaskTitleAll = () => {
                for (let index = itemIndex - 1; index >= 0; index--) {
                    const taskRow = taskRowByItemIndexRef.current.get(index);
                    if (!taskRow) continue;

                    taskRow.focusTitleAll();
                    break;
                }
            };

            // If this item is below our task list then render either a ghost row or empty
            // decorative rows.
            if (itemIndex >= listItemCount) {
                let relativeItemIndex = itemIndex - listItemCount;

                if (loadedState !== "FullyLoaded") {
                    return {
                        key: "MoreUnloadedTasks",
                        minHeight: taskGridViewMoreUnloadedTasksSpinnerHeight,
                        node: (
                            <>
                                <TaskRowShimmer
                                    capabilities={capabilities}
                                    randomSeed="MoreUnloadedTasks"
                                    index={itemIndex}
                                    indentation={0}
                                    focusPreviousTaskTitleEnd={focusPreviousTaskTitleEnd}
                                    focusPreviousTaskTitleAll={focusPreviousTaskTitleAll}
                                />
                                <TaskRowShimmer
                                    capabilities={capabilities}
                                    randomSeed="MoreUnloadedTasks"
                                    index={itemIndex + 1}
                                    indentation={0}
                                    focusPreviousTaskTitleEnd={focusPreviousTaskTitleEnd}
                                    focusPreviousTaskTitleAll={focusPreviousTaskTitleAll}
                                />
                                <TaskRowShimmer
                                    capabilities={capabilities}
                                    randomSeed="MoreUnloadedTasks"
                                    index={itemIndex + 2}
                                    indentation={0}
                                    focusPreviousTaskTitleEnd={focusPreviousTaskTitleEnd}
                                    focusPreviousTaskTitleAll={focusPreviousTaskTitleAll}
                                />
                                <Box
                                    display="flex"
                                    justifyContent="center"
                                    color="grey-60"
                                    paddingY="4"
                                    pointerEvents="none"
                                >
                                    <SpinnerGap
                                        className={spinAnimationClassName}
                                        size={spacing["6"]}
                                        weight="light"
                                    />
                                </Box>
                            </>
                        ),
                    };
                }

                if (relativeItemIndex === 0) {
                    const focusPreviousTaskTitleEnd = () => {
                        for (let index = itemIndex - 1; index >= 0; index--) {
                            const taskRow = taskRowByItemIndexRef.current.get(index);
                            if (!taskRow) continue;

                            taskRow.focusTitleEnd();
                            break;
                        }
                    };

                    return {
                        // We want to use the same key and component as a regular task so we can turn a
                        // ghost task into a regular task without losing focus.
                        key: `Task:${bottomGhostTaskId}`,
                        minHeight: spacing[taskRowViewMinHeight],
                        node: (
                            <TaskRowView
                                ref={taskRow => {
                                    if (!taskRow) {
                                        taskRowByTaskKeyRef.current.delete(bottomGhostTaskId);
                                        taskRowByItemIndexRef.current.delete(itemIndex);
                                    } else {
                                        taskRowByTaskKeyRef.current.set(bottomGhostTaskId, taskRow);
                                        taskRowByItemIndexRef.current.set(itemIndex, taskRow);
                                    }
                                }}
                                capabilities={capabilities}
                                query={query}
                                cursor={null}
                                ghostTaskId={bottomGhostTaskId}
                                onGhostTaskCreated={() =>
                                    setBottomGhostTaskId(generateId<TaskId>())
                                }
                                parents={emptyArray}
                                // NOCOMMIT: Ghost row placeholder sequence!
                                titlePlaceholder={
                                    !capabilities.isReadOnly ? "Add a task…" : undefined
                                }
                                getNextIndentation={() => 0}
                                areChildTasksExpandedStore={undefinedConstStore}
                                onAreChildTasksExpandedToggle={noop}
                                // If there are no task rows, the padding just makes our ghost row placeholder
                                // look misaligned. So remove it.
                                withoutPaddingLeft={listItemCount === 0}
                                withPaddingBottom={itemIndex === itemCount - 1}
                                getMoveTaskToRootQueryActions={events.getMoveTaskToQueryActions}
                                getMoveTaskToQueryActions={events.getMoveTaskToQueryActions}
                                getMaybeRemoveTaskFromQueryActions={
                                    events.getMaybeRemoveTaskFromQueryActions
                                }
                                nestWithPreviousTaskRowIfExistsAndExpand={noop}
                                unnestTaskIfNestedRow={noop}
                                deleteTaskAndAllChildren={noop}
                                deleteTaskAndAllChildrenAndFocusPreviousRow={
                                    focusPreviousTaskTitleEnd
                                }
                                focusTaskTitleStart={focusTaskTitleStart}
                                focusNextTaskTitleCoord={focusNextTaskTitleCoord}
                                focusPreviousTaskTitleCoord={focusPreviousTaskTitleCoord}
                                preserveLastTaskTitleArrowNavigationCoord={
                                    preserveLastTaskTitleArrowNavigationCoord
                                }
                                focusFirstVisibleTaskTitleStart={focusFirstVisibleTaskTitleStart}
                                focusLastVisibleTaskTitleEnd={focusLastVisibleTaskTitleEnd}
                            />
                        ),
                    };
                }

                relativeItemIndex -= 1;

                return {
                    key: `DecorativeGhostTask:${relativeItemIndex}`,
                    minHeight: spacing[taskRowViewMinHeight],
                    node: (
                        <TaskGridViewDecorativeGhostTask
                            capabilities={capabilities}
                            itemIndex={itemIndex}
                            itemCount={itemCount}
                            focusPreviousTaskTitleEnd={focusPreviousTaskTitleEnd}
                            focusPreviousTaskTitleAll={focusPreviousTaskTitleAll}
                        />
                    ),
                };
            }

            const item = list.getItem(itemIndex);

            if (item.type === "Task") {
                const taskId = getTaskQuerySortCursorTaskId(item.cursor);

                const taskKey: TaskGridViewTaskKey =
                    item.parents.length > 0
                        ? `${getTaskQuerySortCursorTaskId(item.parents[0]!.cursor)}-${taskId}`
                        : taskId;

                const taskPath = [
                    ...item.parents.map(({cursor}) => getTaskQuerySortCursorTaskId(cursor)),
                    taskId,
                ];

                // If this is the root query then the new task needs to be added to that query.
                // Otherwise we want to add the new task at the same indentation level that our
                // task is currently at.
                const getMoveTaskToQueryActions: typeof _getMoveTaskToQueryActions =
                    item.query === query
                        ? events.getMoveTaskToQueryActions
                        : (newTaskId, position) => {
                              const time1 = query.store.clock.now();
                              const time2 = query.store.clock.now();

                              return [
                                  {
                                      type: "UpdateTask",
                                      time: time1,
                                      taskId: newTaskId,
                                      taskAction: {
                                          type: "UpdateParentTaskId",
                                          parentTaskId: getTaskQuerySortCursorTaskId(
                                              assertExists(item.parents[item.parents.length - 1])
                                                  .cursor,
                                          ),
                                      },
                                  },
                                  {
                                      type: "UpdateTask",
                                      time: time2,
                                      taskId: newTaskId,
                                      taskAction: {
                                          type: "UpdateParentPosition",
                                          parentPosition:
                                              getNewTaskPositionForQuerySortedByPosition(
                                                  time2,
                                                  item.query,
                                                  position,
                                              ),
                                      },
                                  },
                              ];
                          };

                const getMaybeRemoveTaskFromQueryActions: typeof _getMaybeRemoveTaskFromQueryActions =
                    item.query === query
                        ? events.getMaybeRemoveTaskFromQueryActions
                        : taskId => [
                              {
                                  type: "UpdateTask",
                                  time: query.store.clock.now(),
                                  taskId,
                                  taskAction: {
                                      type: "UpdateParentTaskId",
                                      parentTaskId: null,
                                  },
                              },
                          ];

                const nestWithPreviousTaskRowIfExistsAndExpand = (titleSelection: Selection) => {
                    for (
                        let previousItemIndex = itemIndex - 1;
                        previousItemIndex >= 0;
                        previousItemIndex--
                    ) {
                        const indentation = item.parents.length;

                        const previousItem = list.getItem(previousItemIndex);
                        const previousIndentation = previousItem.parents.length;

                        if (previousIndentation > indentation) continue;
                        if (previousIndentation < indentation) break;

                        if (previousItem.type !== "Task") break;

                        const taskId = getTaskQuerySortCursorTaskId(item.cursor);
                        const previousTaskId = getTaskQuerySortCursorTaskId(previousItem.cursor);

                        const nest = () => {
                            query.store.commitTaskActionTransaction(context, [
                                // If we are indenting at the root of our query then we want to remove the task
                                // from the query root since it lives in its parent task now.
                                //
                                // Must come first since if we're removing a task from its parent then our
                                // following action needs to set the parent again.
                                ...(item.query === query
                                    ? events.getMaybeRemoveTaskFromQueryActions(taskId)
                                    : []),

                                {
                                    type: "UpdateTask",
                                    time: query.store.clock.now(),
                                    taskId,
                                    taskAction: {
                                        type: "UpdateParentTaskId",
                                        parentTaskId: previousTaskId,
                                    },
                                },
                            ]);

                            // Store updates are rendered by React immediately. So focus our task before
                            // the next paint.
                            requestAnimationFrame(() => {
                                if (previousItem.parents.length === 0) {
                                    focusTaskTitleSelection(
                                        `${previousTaskId}-${taskId}`,
                                        titleSelection,
                                    );
                                } else {
                                    focusTaskTitleSelection(
                                        `${getTaskQuerySortCursorTaskId(
                                            previousItem.parents[0]!.cursor,
                                        )}-${taskId}`,
                                        titleSelection,
                                    );
                                }
                            });
                        };

                        const previousTaskPath = [
                            ...previousItem.parents.map(({cursor}) =>
                                getTaskQuerySortCursorTaskId(cursor),
                            ),
                            getTaskQuerySortCursorTaskId(previousItem.cursor),
                        ];

                        // Expand our new parent task if it's not already expanded.
                        if (getAreChildTasksExpandedStore(previousTaskPath).getSnapshot()) {
                            nest();
                        } else {
                            toggleAreChildTasksExpanded(previousTaskPath, {
                                onFinish: nest,
                            });
                        }
                        break;
                    }
                };

                const unnestTaskIfNestedRow = (titleSelection: Selection) => {
                    if (item.parents.length === 0) return;

                    const oldParentTaskId =
                        item.query.getLoadedTaskSnapshot(taskId).getParent()?.taskId ?? null;
                    if (!oldParentTaskId) return;

                    const newParentTaskId =
                        item.parents.length > 1
                            ? getTaskQuerySortCursorTaskId(
                                  item.parents[item.parents.length - 2]!.cursor,
                              )
                            : null;

                    // If our task no longer has any parent then move it into our root query.
                    if (!newParentTaskId) {
                        query.store.commitTaskActionTransaction(context, [
                            {
                                type: "UpdateTask",
                                time: query.store.clock.now(),
                                taskId,
                                taskAction: {
                                    type: "UpdateParentTaskId",
                                    parentTaskId: null,
                                },
                            },
                            ...events.getMoveTaskToQueryActions(taskId, {
                                type: "Below",
                                taskId: oldParentTaskId,
                            }),
                        ]);
                    }
                    // Move the task to our parent's parent. If we have access to the new parent's
                    // children query then we can pick a position below our old parent.
                    else {
                        const time1 = query.store.clock.now();
                        const time2 = query.store.clock.now();

                        const newChildrenQuery = query.store
                            .getTaskChildrenQueryStore(newParentTaskId, query.filters.deletedFilter)
                            .getSnapshot();

                        query.store.commitTaskActionTransaction(context, [
                            {
                                type: "UpdateTask",
                                time: time1,
                                taskId,
                                taskAction: {
                                    type: "UpdateParentTaskId",
                                    parentTaskId: newParentTaskId,
                                },
                            },
                            {
                                type: "UpdateTask",
                                time: time2,
                                taskId,
                                taskAction: {
                                    type: "UpdateParentPosition",
                                    parentPosition: newChildrenQuery
                                        ? getNewTaskPositionForQuerySortedByPosition(
                                              time2,
                                              newChildrenQuery,
                                              {type: "Below", taskId: oldParentTaskId},
                                          )
                                        : {
                                              orderTime: time2,
                                              orderKey: initialOrderKey,
                                          },
                                },
                            },
                        ]);
                    }

                    // Store updates are rendered by React immediately. So focus our task before
                    // the next paint.
                    requestAnimationFrame(() => {
                        if (item.parents.length <= 1) {
                            focusTaskTitleSelection(taskId, titleSelection);
                        } else {
                            focusTaskTitleSelection(
                                `${getTaskQuerySortCursorTaskId(
                                    item.parents[0]!.cursor,
                                )}-${taskId}`,
                                titleSelection,
                            );
                        }
                    });
                };

                const deleteTaskAndAllChildren = ({
                    withConfirmation,
                }: {
                    withConfirmation: boolean;
                }) => {
                    if (!withConfirmation) {
                        query.store.deleteTaskAndAllChildren(context, taskId);
                    } else {
                        setTaskDeleteConfirmationState({taskId});
                    }
                };

                const deleteTaskAndAllChildrenAndFocusPreviousRow = ({
                    withConfirmation,
                }: {
                    withConfirmation: boolean;
                }) => {
                    const focusPreviousRow = (itemIndex: number) => {
                        let hasFoundPreviousRow = false;

                        for (let index = itemIndex - 1; index >= 0; index--) {
                            const taskRow = taskRowByItemIndexRef.current.get(index);
                            if (!taskRow) continue;

                            taskRow.focusTitleEnd();
                            hasFoundPreviousRow = true;
                            break;
                        }

                        // If there is no previous row (we're the first row) then we want to focus the
                        // start of the next row instead.
                        if (!hasFoundPreviousRow) {
                            for (let index = itemIndex + 1; index < itemCount; index++) {
                                const taskRow = taskRowByItemIndexRef.current.get(index);
                                if (!taskRow) continue;

                                taskRow.focusTitleStart();
                                break;
                            }
                        }
                    };

                    if (!withConfirmation) {
                        query.store.deleteTaskAndAllChildren(context, taskId);
                        focusPreviousRow(itemIndex);
                    } else {
                        setTaskDeleteConfirmationState({
                            taskId,
                            onAfterDelete: () => {
                                const view = viewRef.current;
                                if (!view) return;

                                // The item may have moved since we opened the modal (e.g. it shifted down one
                                // place since a task was added above). Focus the title before the task's new
                                // position.
                                const itemIndex = view.getIndexByKeyIfExists(`Task:${taskKey}`);
                                if (itemIndex === null) return;

                                // Once React has closed the modal dialog, focus the previous task. Until the
                                // modal dialog is closed, focus is trapped inside it.
                                onTaskDeleteConfirmationModalDialogClosedCallbacksRef.current.push(
                                    () => focusPreviousRow(itemIndex),
                                );
                            },
                        });
                    }
                };

                const node = (
                    <TaskRowView
                        ref={taskRow => {
                            if (!taskRow) {
                                taskRowByTaskKeyRef.current.delete(taskKey);
                                taskRowByItemIndexRef.current.delete(itemIndex);
                            } else {
                                taskRowByTaskKeyRef.current.set(taskKey, taskRow);
                                taskRowByItemIndexRef.current.set(itemIndex, taskRow);
                            }
                        }}
                        capabilities={capabilities}
                        // It's important we use the `query` property from `item` since child tasks
                        // come from a different query than our root query.
                        query={item.query}
                        cursor={item.cursor}
                        parents={item.parents}
                        // Lazily computed with a function to not mess with the
                        // `list.getItem(index + 1)` iterator optimization.
                        getNextIndentation={() =>
                            itemIndex + 1 < listItemCount
                                ? list.getItem(itemIndex + 1).parents.length
                                : 0
                        }
                        areChildTasksExpandedStore={getAreChildTasksExpandedStore(taskPath)}
                        onAreChildTasksExpandedToggle={() => {
                            toggleAreChildTasksExpanded(taskPath);
                        }}
                        getMoveTaskToRootQueryActions={events.getMoveTaskToQueryActions}
                        getMoveTaskToQueryActions={getMoveTaskToQueryActions}
                        getMaybeRemoveTaskFromQueryActions={getMaybeRemoveTaskFromQueryActions}
                        nestWithPreviousTaskRowIfExistsAndExpand={
                            nestWithPreviousTaskRowIfExistsAndExpand
                        }
                        unnestTaskIfNestedRow={unnestTaskIfNestedRow}
                        deleteTaskAndAllChildren={deleteTaskAndAllChildren}
                        deleteTaskAndAllChildrenAndFocusPreviousRow={
                            deleteTaskAndAllChildrenAndFocusPreviousRow
                        }
                        focusTaskTitleStart={focusTaskTitleStart}
                        focusNextTaskTitleCoord={focusNextTaskTitleCoord}
                        focusPreviousTaskTitleCoord={focusPreviousTaskTitleCoord}
                        preserveLastTaskTitleArrowNavigationCoord={
                            preserveLastTaskTitleArrowNavigationCoord
                        }
                        focusFirstVisibleTaskTitleStart={focusFirstVisibleTaskTitleStart}
                        focusLastVisibleTaskTitleEnd={focusLastVisibleTaskTitleEnd}
                    />
                );

                return {
                    key: `Task:${taskKey}`,
                    minHeight: spacing[taskRowViewMinHeight],
                    node,
                };
            } else {
                cast<"UnloadedChildTask">(item.type);

                assert(item.parents.length > 0);

                const parentTaskId = getTaskQuerySortCursorTaskId(
                    item.parents[item.parents.length - 1]!.cursor,
                );

                const parentTaskKey: TaskGridViewTaskKey =
                    item.parents.length > 1
                        ? `${getTaskQuerySortCursorTaskId(item.parents[0]!.cursor)}-${parentTaskId}`
                        : parentTaskId;

                return {
                    key: `UnloadedChildTask:${parentTaskKey}-${item.unloadedChildTaskIndex}`,
                    minHeight: spacing[taskRowViewMinHeight],
                    node: (
                        <TaskRowShimmer
                            capabilities={capabilities}
                            randomSeed={parentTaskKey}
                            index={item.unloadedChildTaskIndex}
                            indentation={item.parents.length}
                            focusPreviousTaskTitleEnd={focusPreviousTaskTitleEnd}
                            focusPreviousTaskTitleAll={focusPreviousTaskTitleAll}
                        />
                    ),
                };
            }
        };
    }, [
        bottomGhostTaskId,
        capabilities,
        context,
        events,
        getAreChildTasksExpandedStore,
        itemCount,
        list,
        listItemCount,
        loadedState,
        query,
        toggleAreChildTasksExpanded,
        viewRef,
    ]);

    return {
        itemCount,
        renderItem,
        onRenderedRangeChange: (renderedRange: {startIndex: number; endIndex: number} | null) => {
            tryLoadingMoreData(renderedRange);

            const callbacks = onRenderedRangeChangeCallbacksRef.current;
            onRenderedRangeChangeCallbacksRef.current = [];

            for (const callback of callbacks) {
                callback(renderedRange);
            }
        },
        modals: taskDeleteConfirmationState && (
            <TaskDeleteConfirmationModalDialog
                store={query.store}
                taskId={taskDeleteConfirmationState.taskId}
                onClose={() => setTaskDeleteConfirmationState(null)}
                onAfterDelete={taskDeleteConfirmationState.onAfterDelete}
            />
        ),
        focusStart: events.focusStart,
    };
}

function TaskGridViewDecorativeGhostTask({
    capabilities,
    itemIndex,
    itemCount,
    focusPreviousTaskTitleEnd,
    focusPreviousTaskTitleAll,
}: {
    capabilities: TaskGridViewCapabilities;
    itemIndex: number;
    itemCount: number;
    focusPreviousTaskTitleEnd: () => void;
    focusPreviousTaskTitleAll: () => void;
}) {
    return (
        <Box
            paddingX="5"
            height={taskRowViewMinHeight}
            // Create an illusion that the text editor extends into the margins by giving
            // the margin a text cursor and making it clickable putting focus in the task.
            // A double click selects the task text.
            //
            // This is an affordance for mouse users, does not need to be usable
            // by keyboard.
            cursor={!capabilities.isReadOnly ? "text" : undefined}
            {...useOutOfBoundsClickSelection({
                isDisabled: capabilities.isReadOnly,
                onSelect: focusPreviousTaskTitleEnd,
                onSelectAll: focusPreviousTaskTitleAll,
            })}
        >
            <Box
                width="full"
                height="full"
                pointerEvents="none"
                style={{
                    // Draw the top and bottom border with a shadow so it:
                    //
                    // 1. Doesn't add 2px to layout
                    // 2. Adjacent borders share the same space so we don't get 2px dividers
                    boxShadow: `0 -1px 0 0 ${colorSchemeVars["grey-5"]}, inset 0 -1px 0 0 ${colorSchemeVars["grey-5"]}`,
                }}
            />
            {itemIndex === itemCount - 1 && <Box width="full" height="2" pointerEvents="none" />}
        </Box>
    );
}
