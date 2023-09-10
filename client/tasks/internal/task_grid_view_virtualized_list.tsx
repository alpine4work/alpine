import {createRef, useEffect, useMemo, useRef, useState} from "react";
import {Box} from "~/client/design/box.js";
import {useConstant} from "~/client/helpers/lifecycle/use_constant.js";
import {useEvent} from "~/client/helpers/lifecycle/use_event.js";
import {StoreMap} from "~/client/helpers/store/store_map.js";
import {useStore} from "~/client/helpers/store/use_store.js";
import {TaskGridViewCapabilities} from "~/client/tasks/internal/task_grid_view_capabilities.js";
import {
    TaskGridViewTaskKey,
    TaskGridViewVirtualizedTaskList,
} from "~/client/tasks/internal/task_grid_view_virtualized_task_list.js";
import {taskRowViewMinHeight} from "~/client/tasks/internal/task_row_shared_styles.js";
import {TaskRowView, TaskRowViewRef} from "~/client/tasks/internal/task_row_view.js";
import {TaskClientQuery} from "~/client/tasks/task_client_query.js";
import {VirtualizedScrollViewItem} from "~/client/virtualized/virtualized_scroll_view.js";
import {spacing} from "~/shared/design/spacing.js";
import {HybridLogicalTime} from "~/shared/helpers/clock/hybrid_logical_clock.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {LazyMap} from "~/shared/helpers/control/lazy_map.js";
import {generateId} from "~/shared/id/id.js";
import {TaskId} from "~/shared/id/types/id_types.js";
import {colorSchemeVars} from "~/shared/styles/styles.js";
import {TaskAction} from "~/shared/tasks/actions/task_action.js";

export function useTaskGridViewVirtualizedList({
    capabilities,
    query,
    isExpandedByTaskKey,
    initialBottomGhostTaskId,
    getAddNewTaskToQueryActions: _getAddNewTaskToQueryActions,
}: {
    capabilities: TaskGridViewCapabilities;
    query: TaskClientQuery;
    isExpandedByTaskKey: StoreMap<TaskGridViewTaskKey, boolean>;
    initialBottomGhostTaskId: TaskId;
    getAddNewTaskToQueryActions: (
        time: HybridLogicalTime,
        taskId: TaskId,
        position: {type: "End"} | {type: "Above"; taskId: TaskId} | {type: "Below"; taskId: TaskId},
    ) => Array<TaskAction>;
}) {
    const [bottomGhostTaskId, setBottomGhostTaskId] = useState(initialBottomGhostTaskId);

    const listStore = useMemo(
        () => TaskGridViewVirtualizedTaskList.new(query, isExpandedByTaskKey),
        [isExpandedByTaskKey, query],
    );

    const list = useStore(listStore);

    const getAddNewTaskToQueryActions = useEvent(_getAddNewTaskToQueryActions);

    const taskRowByIdRef = useRef(new Map<TaskId, TaskRowViewRef>());
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
            const preserveLastTaskTitleArrowNavigationCoord = () => {
                if (lastArrowNavigationCoordRef.current) {
                    lastArrowNavigationCoordRef.current = {
                        setTime: new Date(),
                        coord: lastArrowNavigationCoordRef.current.coord,
                    };
                }
            };

            return (itemIndex: number): VirtualizedScrollViewItem => {
                const focusTaskTitleStart = (taskId: TaskId) => {
                    taskRowByIdRef.current.get(taskId)?.focusTitleStart();
                };

                const focusNextTaskTitleCoord = (coord: number) => {
                    coord = lastArrowNavigationCoordRef.current?.coord ?? coord;

                    taskRowByItemIndexRef.current.get(itemIndex + 1)?.focusTitleCoord(coord, "top");

                    lastArrowNavigationCoordRef.current = {
                        setTime: new Date(),
                        coord,
                    };
                };

                const focusPreviousTaskTitleCoord = (coord: number) => {
                    coord = lastArrowNavigationCoordRef.current?.coord ?? coord;

                    taskRowByItemIndexRef.current
                        .get(itemIndex - 1)
                        ?.focusTitleCoord(coord, "bottom");

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
                            const taskKey = item.rootTaskId
                                ? `${item.rootTaskId}-${item.taskId}`
                                : item.taskId;

                            return {
                                key: `Task:${taskKey}`,
                                minHeight: spacing[taskRowViewMinHeight],
                                node: (
                                    <TaskRowView
                                        ref={taskRow => {
                                            if (!taskRow) {
                                                taskRowByIdRef.current.delete(item.taskId);
                                                taskRowByItemIndexRef.current.delete(itemIndex);
                                            } else {
                                                taskRowByIdRef.current.set(item.taskId, taskRow);
                                                taskRowByItemIndexRef.current.set(
                                                    itemIndex,
                                                    taskRow,
                                                );
                                            }
                                        }}
                                        query={query}
                                        capabilities={capabilities}
                                        taskId={item.taskId}
                                        indentation={item.indentation}
                                        getAddNewTaskToQueryActions={getAddNewTaskToQueryActions}
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
                            const parentTaskKey = item.rootTaskId
                                ? `${item.rootTaskId}-${item.parentTaskId}`
                                : item.parentTaskId;

                            return {
                                key: `UnloadedChildTask:${parentTaskKey}-${item.childTaskIndex}`,
                                minHeight: spacing[taskRowViewMinHeight],
                                // NOCOMMIT: Implement!
                                node: <></>,
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
                                        taskRowByIdRef.current.delete(bottomGhostTaskId);
                                        taskRowByItemIndexRef.current.delete(itemIndex);
                                    } else {
                                        taskRowByIdRef.current.set(bottomGhostTaskId, taskRow);
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
                                // If there are no task rows, the padding just makes our ghost row placeholder
                                // look misaligned. So remove it.
                                withoutPaddingLeft={listItemCount === 0}
                                withPaddingBottom={itemIndex === itemCount - 1}
                                getAddNewTaskToQueryActions={getAddNewTaskToQueryActions}
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
        }, [bottomGhostTaskId, capabilities, getAddNewTaskToQueryActions, itemCount, list, query]),
    };
}
