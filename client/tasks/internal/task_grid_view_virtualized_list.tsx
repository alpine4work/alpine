import {Selection} from "prosemirror-state";
import {useEffect, useMemo, useRef, useState} from "react";
import {useAppContext} from "~/client/context/app_context.js";
import {Box} from "~/client/design/box.js";
import {useEvents} from "~/client/helpers/lifecycle/use_event.js";
import {ConstStore} from "~/client/helpers/store/const_store.js";
import {useStore} from "~/client/helpers/store/use_store.js";
import {getNewTaskPositionForQuerySortedByPosition} from "~/client/tasks/get_new_task_position_for_query_sorted_by_position.js";
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
import {emptyArray} from "~/shared/helpers/array/empty_array.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {cast} from "~/shared/helpers/control/cast.js";
import {noop} from "~/shared/helpers/control/noop.js";
import {initialOrderKey} from "~/shared/helpers/sort/order_key.js";
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
    getMoveTaskToQueryActions: _getMoveTaskToQueryActions,
    getMaybeRemoveTaskFromQueryWhenNestingActions: _getMaybeRemoveTaskFromQueryWhenNestingActions,
}: {
    capabilities: TaskGridViewCapabilities;
    query: TaskClientQuery;
    initialExpandedState: TaskGridViewExpansionState;
    initialBottomGhostTaskId: TaskId;
    getMoveTaskToQueryActions: (
        taskId: TaskId,
        position: {type: "End"} | {type: "Above"; taskId: TaskId} | {type: "Below"; taskId: TaskId},
    ) => Array<TaskAction>;
    getMaybeRemoveTaskFromQueryWhenNestingActions: (taskId: TaskId) => Array<TaskAction>;
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
        getMoveTaskToQueryActions: _getMoveTaskToQueryActions,
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

    const renderItem = useMemo(() => {
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

            // If this item is below our task list then render either a ghost row or empty
            // decorative rows.
            if (relativeItemIndex >= listItemCount) {
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
                                parentTaskCursors={emptyArray}
                                // NOCOMMIT: Ghost row placeholder sequence!
                                titlePlaceholder="Add a task…"
                                indentation={0}
                                areChildTasksExpandedStore={undefinedConstStore}
                                onAreChildTasksExpandedToggle={noop}
                                // If there are no task rows, the padding just makes our ghost row placeholder
                                // look misaligned. So remove it.
                                withoutPaddingLeft={listItemCount === 0}
                                withPaddingBottom={itemIndex === itemCount - 1}
                                getMoveTaskToQueryActions={events.getMoveTaskToQueryActions}
                                nestWithPreviousTaskRowIfExistsAndExpand={noop}
                                unnestTaskIfNestedRow={noop}
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
            }

            const item = list.getItem(relativeItemIndex);

            if (item.type === "Task") {
                const taskId = getTaskQuerySortCursorTaskId(item.cursor);

                const taskKey: TaskGridViewTaskKey =
                    item.parentTaskCursors.length > 0
                        ? `${getTaskQuerySortCursorTaskId(item.parentTaskCursors[0]!)}-${taskId}`
                        : taskId;

                const taskPath = [
                    ...item.parentTaskCursors.map(getTaskQuerySortCursorTaskId),
                    taskId,
                ];

                // NOCOMMIT: Preserve selection
                // NOCOMMIT: Preserve expansion state
                const nestWithPreviousTaskRowIfExistsAndExpand = (titleSelection: Selection) => {
                    for (
                        let previousItemIndex = relativeItemIndex - 1;
                        previousItemIndex >= 0;
                        previousItemIndex--
                    ) {
                        const indentation = item.parentTaskCursors.length;

                        const previousItem = list.getItem(previousItemIndex);
                        const previousIndentation = previousItem.parentTaskCursors.length;

                        if (previousIndentation > indentation) continue;
                        if (previousIndentation < indentation) break;

                        if (previousItem.type !== "Task") break;

                        const indent = () => {
                            const taskId = getTaskQuerySortCursorTaskId(item.cursor);
                            const previousTaskId = getTaskQuerySortCursorTaskId(
                                previousItem.cursor,
                            );

                            query.store.commitTaskActionTransaction(context, [
                                {
                                    type: "UpdateTask",
                                    time: query.store.clock.now(),
                                    taskId,
                                    taskAction: {
                                        type: "UpdateParentTaskId",
                                        parentTaskId: previousTaskId,
                                    },
                                },
                                // If we are indenting at the root of our query then we want to remove the task
                                // from the query root since it lives in its parent task now.
                                ...(item.query === query
                                    ? events.getMaybeRemoveTaskFromQueryWhenNestingActions(taskId)
                                    : []),
                            ]);
                        };

                        const previousTaskPath = [
                            ...previousItem.parentTaskCursors,
                            previousItem.cursor,
                        ].map(getTaskQuerySortCursorTaskId);

                        // Expand our new parent task if it's not already expanded.
                        if (getAreChildTasksExpandedStore(previousTaskPath).getSnapshot()) {
                            indent();
                        } else {
                            toggleAreChildTasksExpanded(previousTaskPath, {
                                onFinish: indent,
                            });
                        }
                        break;
                    }
                };

                // NOCOMMIT: Preserve selection
                // NOCOMMIT: Preserve expansion state
                const unnestTaskIfNestedRow = (titleSelection: Selection) => {
                    if (item.parentTaskCursors.length === 0) return;

                    const oldParentTaskId =
                        item.query.getLoadedTaskSnapshot(taskId).getParent()?.taskId ?? null;
                    if (!oldParentTaskId) return;

                    const newParentTaskId =
                        item.parentTaskCursors.length > 1
                            ? getTaskQuerySortCursorTaskId(
                                  item.parentTaskCursors[item.parentTaskCursors.length - 2]!,
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
                            .getTaskChildrenQueryStore(newParentTaskId)
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
                        // It's important we use the `query` property from `item` since child tasks
                        // come from a different query than our root query.
                        query={item.query}
                        capabilities={capabilities}
                        taskId={taskId}
                        parentTaskCursors={item.parentTaskCursors}
                        indentation={item.parentTaskCursors.length}
                        areChildTasksExpandedStore={getAreChildTasksExpandedStore(taskPath)}
                        onAreChildTasksExpandedToggle={() => {
                            toggleAreChildTasksExpanded(taskPath);
                        }}
                        getMoveTaskToQueryActions={
                            // If this is the root query then the new task needs to be added to that query.
                            // Otherwise we want to add the new task at the same indentation level that our
                            // task is currently at.
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
                                                      assertExists(
                                                          item.parentTaskCursors[
                                                              item.parentTaskCursors.length - 1
                                                          ],
                                                      ),
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
                                  }
                        }
                        nestWithPreviousTaskRowIfExistsAndExpand={
                            nestWithPreviousTaskRowIfExistsAndExpand
                        }
                        unnestTaskIfNestedRow={unnestTaskIfNestedRow}
                        focusTaskTitleStart={focusTaskTitleStart}
                        focusNextTaskTitleCoord={focusNextTaskTitleCoord}
                        focusPreviousTaskTitleCoord={focusPreviousTaskTitleCoord}
                        preserveLastTaskTitleArrowNavigationCoord={
                            preserveLastTaskTitleArrowNavigationCoord
                        }
                    />
                );

                return {
                    key: `Task:${taskKey}`,
                    minHeight: spacing[taskRowViewMinHeight],
                    node,
                };
            } else {
                cast<"UnloadedChildTask">(item.type);

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
    ]);

    return {
        itemCount,
        renderItem,
    };
}
