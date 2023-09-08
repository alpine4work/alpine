import {useCallback, useMemo} from "react";
import {Box} from "~/client/design/box.js";
import {useEvent} from "~/client/helpers/lifecycle/use_event.js";
import {StoreMap} from "~/client/helpers/store/store_map.js";
import {useStore} from "~/client/helpers/store/use_store.js";
import {TaskGridViewCapabilities} from "~/client/tasks/internal/task_grid_view_capabilities.js";
import {
    TaskGridViewTaskKey,
    TaskGridViewVirtualizedTaskList,
} from "~/client/tasks/internal/task_grid_view_virtualized_task_list.js";
import {taskRowViewMinHeight} from "~/client/tasks/internal/task_row_shared_styles.js";
import {TaskRowView} from "~/client/tasks/internal/task_row_view.js";
import {TaskClientQuery} from "~/client/tasks/task_client_query.js";
import {VirtualizedScrollViewItem} from "~/client/virtualized/virtualized_scroll_view.js";
import {spacing} from "~/shared/design/spacing.js";
import {HybridLogicalTime} from "~/shared/helpers/clock/hybrid_logical_clock.js";
import {TaskId} from "~/shared/id/types/id_types.js";
import {colorSchemeVars} from "~/shared/styles/styles.js";
import {TaskAction} from "~/shared/tasks/actions/task_action.js";

export function useTaskGridViewVirtualizedList({
    capabilities,
    query,
    isExpandedByTaskKey,
    bottomGhostTaskId,
    getAddNewTaskToQueryActions: _getAddNewTaskToQueryActions,
}: {
    capabilities: TaskGridViewCapabilities;
    query: TaskClientQuery;
    isExpandedByTaskKey: StoreMap<TaskGridViewTaskKey, boolean>;
    bottomGhostTaskId: TaskId;
    getAddNewTaskToQueryActions: (time: HybridLogicalTime, taskId: TaskId) => Array<TaskAction>;
}) {
    const listStore = useMemo(
        () => TaskGridViewVirtualizedTaskList.new(query, isExpandedByTaskKey),
        [isExpandedByTaskKey, query],
    );

    const list = useStore(listStore);

    const getAddNewTaskToQueryActions = useEvent(_getAddNewTaskToQueryActions);

    return {
        itemCount: Math.max(list.getItemCount() + 1, 3),

        renderItem: useCallback(
            (itemIndex: number): VirtualizedScrollViewItem => {
                const listItemCount = list.getItemCount();

                if (itemIndex < listItemCount) {
                    return list.renderItem(itemIndex, {
                        capabilities,
                        getAddNewTaskToQueryActions,
                    });
                }

                itemIndex -= listItemCount;

                if (itemIndex === 0) {
                    return {
                        // We want to use the same key and component as a regular task so we can turn a
                        // ghost task into a regular task without losing focus.
                        key: `Task:${bottomGhostTaskId}`,
                        minHeight: spacing[taskRowViewMinHeight],
                        node: (
                            <TaskRowView
                                query={query}
                                capabilities={capabilities}
                                taskId={null}
                                ghostTaskId={bottomGhostTaskId}
                                // NOCOMMIT: Ghost row placeholder sequence!
                                titlePlaceholder="Add a task…"
                                indentation={0}
                                // If there are no task rows, the padding just makes our ghost row placeholder
                                // look misaligned. So remove it.
                                withoutPaddingLeft={listItemCount === 0}
                                getAddNewTaskToQueryActions={getAddNewTaskToQueryActions}
                            />
                        ),
                    };
                }

                itemIndex -= 1;

                return {
                    key: `DecorativeGhostTask:${itemIndex}`,
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
                        </Box>
                    ),
                };
            },
            [bottomGhostTaskId, capabilities, getAddNewTaskToQueryActions, list, query],
        ),
    };
}
