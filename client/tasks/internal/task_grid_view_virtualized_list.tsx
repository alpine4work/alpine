import {useEffect, useMemo, useRef, useState} from "react";
import {useAppContext} from "~/client/context/app_context.js";
import {Box} from "~/client/design/box.js";
import {useEvents} from "~/client/helpers/lifecycle/use_event.js";
import {batchStoreUpdates} from "~/client/helpers/store/batch_store_updates.js";
import {ConstStore} from "~/client/helpers/store/const_store.js";
import {useStore} from "~/client/helpers/store/use_store.js";
import {TaskGridViewCapabilities} from "~/client/tasks/internal/task_grid_view_capabilities.js";
import {TaskGridViewTaskKey} from "~/client/tasks/internal/task_grid_view_task_key.js";
import {TaskGridViewVirtualizedTaskList} from "~/client/tasks/internal/task_grid_view_virtualized_task_list.js";
import {taskRowViewMinHeight} from "~/client/tasks/internal/task_row_shared_styles.js";
import {TaskRowShimmer} from "~/client/tasks/internal/task_row_shimmer.js";
import {TaskRowView, TaskRowViewRef} from "~/client/tasks/internal/task_row_view.js";
import {useTaskGridViewExpansionState} from "~/client/tasks/internal/use_task_grid_view_expansion_state.js";
import {TaskClientQuery} from "~/client/tasks/task_client_query.js";
import {VirtualizedScrollViewItem} from "~/client/virtualized/virtualized_scroll_view.js";
import {spacing} from "~/shared/design/spacing.js";
import {HybridLogicalTime} from "~/shared/helpers/clock/hybrid_logical_clock.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {noop} from "~/shared/helpers/control/noop.js";
import {generateId} from "~/shared/id/id.js";
import {TaskId} from "~/shared/id/types/id_types.js";
import {colorSchemeVars} from "~/shared/styles/styles.js";
import {TaskAction} from "~/shared/tasks/actions/task_action.js";
import {TaskGridViewExpansionState} from "~/shared/tasks/task_grid_view_expansion_state.js";
import {getTaskQuerySortCursorTaskId} from "~/shared/tasks/task_query_sort_cursor.js";

const undefinedConstStore = new ConstStore(undefined);

export function useTaskGridViewVirtualizedList({
    capabilities,
    query,
    initialExpandedState,
    initialBottomGhostTaskId,
    getAddNewTaskToQueryActions: _getAddNewTaskToQueryActions,
    getMaybeRemoveTaskFromQueryWhenNestingActions: _getMaybeRemoveTaskFromQueryWhenNestingActions,
}: {
    capabilities: TaskGridViewCapabilities;
    query: TaskClientQuery;
    initialExpandedState: TaskGridViewExpansionState;
    initialBottomGhostTaskId: TaskId;
    getAddNewTaskToQueryActions: (
        time: HybridLogicalTime,
        taskId: TaskId,
        position: {type: "End"} | {type: "Above"; taskId: TaskId} | {type: "Below"; taskId: TaskId},
    ) => Array<TaskAction>;
    getMaybeRemoveTaskFromQueryWhenNestingActions: (
        time: HybridLogicalTime,
        taskId: TaskId,
    ) => Array<TaskAction>;
}) {
    const context = useAppContext();

    const [bottomGhostTaskId, setBottomGhostTaskId] = useState(initialBottomGhostTaskId);

    const {getAreChildTasksExpandedStore, toggleAreChildTasksExpanded} =
        useTaskGridViewExpansionState({
            store: query.store,
            filters: query.filters,
            sorts: query.sorts,
            initialState: initialExpandedState,
        });

    const listStore = useMemo(
        () => TaskGridViewVirtualizedTaskList.new(query, getAreChildTasksExpandedStore),
        [getAreChildTasksExpandedStore, query],
    );

    const list = useStore(listStore);

    const events = useEvents({
        getAddNewTaskToQueryActions: _getAddNewTaskToQueryActions,
        getMaybeRemoveTaskFromQueryWhenNestingActions:
            _getMaybeRemoveTaskFromQueryWhenNestingActions,
    });

    const taskRowByTaskKeyRef = useRef(new Map<TaskGridViewTaskKey, TaskRowViewRef>());
    const taskRowByItemIndexRef = useRef(new Map<number, TaskRowViewRef>());

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

    const itemCount = Math.max(list.getItemCount() + 1, 3);

    return {
        itemCount,

        renderItem: useMemo(() => {
            const focusTaskTitleStart = (taskId: TaskGridViewTaskKey) => {
                taskRowByTaskKeyRef.current.get(taskId)?.focusTitleStart();
            };

            const preserveLastTaskTitleArrowNavigationCoord = () => {
                if (lastArrowNavigationCoordRef.current) {
                    lastArrowNavigationCoordRef.current = {
                        setTime: new Date(),
                        coord: lastArrowNavigationCoordRef.current.coord,
                    };
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

                const listItemCount = list.getItemCount();
                let relativeItemIndex = itemIndex;

                if (relativeItemIndex < listItemCount) {
                    const item = list.getItem(relativeItemIndex);

                    switch (item.type) {
                        case "Task": {
                            const taskId = getTaskQuerySortCursorTaskId(item.cursor);

                            const taskKey: TaskGridViewTaskKey =
                                item.parentTaskCursors.length > 0
                                    ? `${getTaskQuerySortCursorTaskId(
                                          item.parentTaskCursors[0]!,
                                      )}-${taskId}`
                                    : taskId;

                            const taskPath = [
                                ...item.parentTaskCursors.map(getTaskQuerySortCursorTaskId),
                                taskId,
                            ];

                            const nestWithPreviousTaskRowIfExistsAndExpand = () => {
                                for (
                                    let previousItemIndex = relativeItemIndex - 1;
                                    previousItemIndex >= 0;
                                    previousItemIndex--
                                ) {
                                    const previousItem = list.getItem(previousItemIndex);
                                    if (
                                        previousItem.parentTaskCursors.length ===
                                        item.parentTaskCursors.length
                                    ) {
                                        if (previousItem.type !== "Task") break;

                                        const indent = () => {
                                            const time = query.store.clock.now();

                                            const taskId = getTaskQuerySortCursorTaskId(
                                                item.cursor,
                                            );
                                            const previousTaskId = getTaskQuerySortCursorTaskId(
                                                previousItem.cursor,
                                            );

                                            query.store.commitTaskActionTransaction(context, [
                                                {
                                                    type: "UpdateTask",
                                                    time,
                                                    taskId,
                                                    taskAction: {
                                                        type: "UpdateParentTaskId",
                                                        parentTaskId: previousTaskId,
                                                    },
                                                },
                                                ...events.getMaybeRemoveTaskFromQueryWhenNestingActions(
                                                    time,
                                                    taskId,
                                                ),
                                            ]);
                                        };

                                        const previousTaskPath = [
                                            ...previousItem.parentTaskCursors,
                                            previousItem.cursor,
                                        ].map(getTaskQuerySortCursorTaskId);

                                        // Expand our new parent task if it's not already expanded.
                                        if (
                                            getAreChildTasksExpandedStore(
                                                previousTaskPath,
                                            ).getSnapshot()
                                        ) {
                                            indent();
                                        } else {
                                            toggleAreChildTasksExpanded(previousTaskPath, {
                                                onFinish: indent,
                                            });
                                        }
                                        break;
                                    }
                                }
                            };

                            return {
                                key: `Task:${taskKey}`,
                                minHeight: spacing[taskRowViewMinHeight],
                                node: (
                                    <TaskRowView
                                        ref={taskRow => {
                                            if (!taskRow) {
                                                taskRowByTaskKeyRef.current.delete(taskKey);
                                                taskRowByItemIndexRef.current.delete(itemIndex);
                                            } else {
                                                taskRowByTaskKeyRef.current.set(taskKey, taskRow);
                                                taskRowByItemIndexRef.current.set(
                                                    itemIndex,
                                                    taskRow,
                                                );
                                            }
                                        }}
                                        // It's important we use the `query` property from `item` since child tasks
                                        // come from a different query than our root query.
                                        query={item.query}
                                        capabilities={capabilities}
                                        taskId={taskId}
                                        indentation={item.parentTaskCursors.length}
                                        areChildTasksExpandedStore={getAreChildTasksExpandedStore(
                                            taskPath,
                                        )}
                                        onAreChildTasksExpandedToggle={() => {
                                            toggleAreChildTasksExpanded(taskPath);
                                        }}
                                        getAddNewTaskToQueryActions={
                                            events.getAddNewTaskToQueryActions
                                        }
                                        nestWithPreviousTaskRowIfExistsAndExpand={
                                            nestWithPreviousTaskRowIfExistsAndExpand
                                        }
                                        focusTaskTitleStart={focusTaskTitleStart}
                                        focusNextTaskTitleCoord={focusNextTaskTitleCoord}
                                        focusPreviousTaskTitleCoord={focusPreviousTaskTitleCoord}
                                        preserveLastTaskTitleArrowNavigationCoord={
                                            preserveLastTaskTitleArrowNavigationCoord
                                        }
                                    />
                                ),
                            };
                        }
                        case "UnloadedChildTask": {
                            assert(item.parentTaskCursors.length > 0);

                            const parentTaskId = getTaskQuerySortCursorTaskId(
                                item.parentTaskCursors[item.parentTaskCursors.length - 1]!,
                            );

                            const parentTaskKey: TaskGridViewTaskKey =
                                item.parentTaskCursors.length > 1
                                    ? `${getTaskQuerySortCursorTaskId(
                                          item.parentTaskCursors[0]!,
                                      )}-${parentTaskId}`
                                    : parentTaskId;

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

                            return {
                                key: `UnloadedChildTask:${parentTaskKey}-${item.childTaskIndex}`,
                                minHeight: spacing[taskRowViewMinHeight],
                                node: (
                                    <TaskRowShimmer
                                        randomSeed={parentTaskKey}
                                        index={item.childTaskIndex}
                                        indentation={item.parentTaskCursors.length}
                                        focusPreviousTaskTitleEnd={focusPreviousTaskTitleEnd}
                                        focusPreviousTaskTitleAll={focusPreviousTaskTitleAll}
                                    />
                                ),
                            };
                        }
                        default:
                            throw exhaustive(item);
                    }
                }

                relativeItemIndex -= listItemCount;

                if (relativeItemIndex === 0) {
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
                                query={query}
                                capabilities={capabilities}
                                taskId={null}
                                ghostTaskId={bottomGhostTaskId}
                                onGhostTaskCreated={() =>
                                    setBottomGhostTaskId(generateId<TaskId>())
                                }
                                // NOCOMMIT: Ghost row placeholder sequence!
                                titlePlaceholder="Add a task…"
                                indentation={0}
                                areChildTasksExpandedStore={undefinedConstStore}
                                onAreChildTasksExpandedToggle={noop}
                                // If there are no task rows, the padding just makes our ghost row placeholder
                                // look misaligned. So remove it.
                                withoutPaddingLeft={listItemCount === 0}
                                withPaddingBottom={itemIndex === itemCount - 1}
                                getAddNewTaskToQueryActions={events.getAddNewTaskToQueryActions}
                                nestWithPreviousTaskRowIfExistsAndExpand={noop}
                                focusTaskTitleStart={focusTaskTitleStart}
                                focusNextTaskTitleCoord={focusNextTaskTitleCoord}
                                focusPreviousTaskTitleCoord={focusPreviousTaskTitleCoord}
                                preserveLastTaskTitleArrowNavigationCoord={
                                    preserveLastTaskTitleArrowNavigationCoord
                                }
                            />
                        ),
                    };
                }

                relativeItemIndex -= 1;

                return {
                    key: `DecorativeGhostTask:${relativeItemIndex}`,
                    minHeight: spacing[taskRowViewMinHeight],
                    node: (
                        <Box
                            paddingX="5"
                            height={taskRowViewMinHeight}
                            // Create an illusion that the text editor extends into the margins by giving
                            // the margin a text cursor and making it clickable putting focus in the task.
                            // A double click selects the task text.
                            //
                            // This is an affordance for mouse users, does not need to be usable
                            // by keyboard.
                            cursor="text"
                            // NOCOMMIT:
                            // {...useOutOfBoundsClickSelection({
                            //     onSelect: () => bottomGhostTaskRowRef.current?.focusTitleEnd(),
                            //     onSelectAll: () => bottomGhostTaskRowRef.current?.focusTitleEnd(),
                            // })}
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
                            {itemIndex === itemCount - 1 && (
                                <Box width="full" height="2" pointerEvents="none" />
                            )}
                        </Box>
                    ),
                };
            };
        }, [
            bottomGhostTaskId,
            capabilities,
            context,
            events,
            getAreChildTasksExpandedStore,
            itemCount,
            list,
            query,
            toggleAreChildTasksExpanded,
        ]),
    };
}
