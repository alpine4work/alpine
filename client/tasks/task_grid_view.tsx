import {CalendarDate} from "@internationalized/date";
import {Selection} from "prosemirror-state";
import {
    Key,
    PropsWithoutRef,
    ReactElement,
    ReactNode,
    Ref,
    RefAttributes,
    createRef,
    forwardRef,
    useCallback,
    useEffect,
    useImperativeHandle,
    useMemo,
    useRef,
    useState,
} from "react";
import {Box} from "~/client/design/box.js";
import {useOutsideInteraction} from "~/client/design/helpers/use_outside_interaction.js";
import {GlobalKeyDownEvent} from "~/client/helpers/global_key_down_event.js";
import {useConstant} from "~/client/helpers/lifecycle/use_constant.js";
import {runWithImmediatePriority} from "~/client/helpers/run_with_immediate_priority.js";
import {StoreMap} from "~/client/helpers/store/store_map.js";
import {TaskGridViewCapabilities} from "~/client/tasks/internal/task_grid_view_capabilities.js";
import {useTaskGridViewVirtualizedList} from "~/client/tasks/internal/task_grid_view_virtualized_list.js";
import {TaskGridViewVirtualizedTaskList} from "~/client/tasks/internal/task_grid_view_virtualized_task_list.js";
// NOCOMMIT:
// import {TaskGridViewCapabilities} from "~/client/tasks/demo_2/internal/task_grid_view_capabilities.js";
// import {TaskGridViewDndContext} from "~/client/tasks/demo_2/internal/task_grid_view_dnd_context.js";
// import {
//     taskRowViewCollectionsColumnWidth,
//     taskRowViewColumnPaddingX,
//     taskRowViewColumnWidth,
//     taskRowViewFirstColumnPaddingLeft,
//     taskRowViewFirstColumnWidth,
//     taskRowViewLastColumnPaddingRight,
//     taskRowViewMinHeight,
// } from "~/client/tasks/demo_2/internal/task_row_shared_styles.js";
// import {TaskRowViewDroppable} from "~/client/tasks/demo_2/internal/task_row_view_droppable.js";
// import {LocalTaskCollection} from "~/client/tasks/demo_2/local_tasks_state.js";
// import {
//     TaskRowPresentationalView,
//     TaskRowPresentationalViewRef,
// } from "~/client/tasks/demo_2/task_row_presentational_view.js";
// import {TaskAssignee, TaskStatus} from "~/client/tasks/demo_2/task_status_button.js";
import {useOutOfBoundsClickSelection} from "~/client/tasks/internal/use_out_of_bounds_click_selection.js";
import {TaskClientQuery} from "~/client/tasks/task_client_query.js";
import {TaskClientStore} from "~/client/tasks/task_client_store.js";
import {
    VirtualizedScrollView,
    VirtualizedScrollViewRef,
} from "~/client/virtualized/virtualized_scroll_view.js";
import {ThemeColor} from "~/shared/design/theme_colors.js";
import {UnimplementedError} from "~/shared/error/error.js";
import {emptyArray} from "~/shared/helpers/array/empty_array.js";
import {HybridLogicalTime} from "~/shared/helpers/clock/hybrid_logical_clock.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {LazyMap} from "~/shared/helpers/control/lazy_map.js";
import {noop} from "~/shared/helpers/control/noop.js";
import {generateId} from "~/shared/id/id.js";
import {LocalTaskCollectionId, TaskId} from "~/shared/id/types/id_types.js";
import {colorSchemeVars} from "~/shared/styles/styles.js";
import {TaskAction} from "~/shared/tasks/actions/task_action.js";
import {TaskGridViewExpansionState} from "~/shared/tasks/task_grid_view_expansion_state.js";
import {TaskGridViewTaskKey} from "~/client/tasks/internal/task_grid_view_task_key.js";
import {TaskPriority} from "~/shared/tasks/task_priority.js";
import {taskRowViewMinHeight} from "~/client/tasks/task_row_shared_styles.js";
import {spacing} from "~/shared/design/spacing.js";
// NOCOMMIT:
// import {TaskTitle, emptyTaskTitle} from "~/shared/tasks/task_title_schema_old.js";

const minTaskCountToShowTopGhostTask = 7;

// NOCOMMIT: Task grid view should probably be a collection of virtualized
// items not an actual component.
export function TaskGridView({
    capabilities,
    query,
    initialExpandedState,
    initialBottomGhostTaskId,
    getMoveTaskToQueryActions,
    getMaybeRemoveTaskFromQueryWhenNestingActions,
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
    const viewRef = useRef<VirtualizedScrollViewRef>(null);

    const {modals, itemCount, renderItem, onRenderedRangeChange} = useTaskGridViewVirtualizedList({
        capabilities,
        query,
        initialExpandedState,
        initialBottomGhostTaskId,
        viewRef,
        getMoveTaskToQueryActions,
        getMaybeRemoveTaskFromQueryWhenNestingActions,
    });

    return (
        <>
            {modals}
            <VirtualizedScrollView
                ref={viewRef}
                itemCount={itemCount}
                bufferedItemHeight={spacing[taskRowViewMinHeight]}
                renderItem={renderItem}
                onRenderedRangeChange={onRenderedRangeChange}
            />
        </>
    );
}

type OLD_TaskGridViewRef = {
    focusTaskRowTitleStart(index: number): void;
    focusTaskRowTitleEnd(index: number): void;
    focusTaskRowTitleSelection(index: number, selection: Selection): void;
    focusStart(): void;
    focusEnd(): void;
};

const OLD_TaskGridViewForwardRef = forwardRef(OLD_TaskGridView) as <TaskRow>(
    props: PropsWithoutRef<OLD_TaskGridViewProps<TaskRow>> & RefAttributes<OLD_TaskGridViewRef>,
) => ReactElement;

type OLD_TaskGridViewProps = {
    capabilities: TaskGridViewCapabilities;
    taskGhostRowPlaceholder?: string;
    taskRowCount: number;
    getTaskRow: (index: number) => TaskRow;
    topGhostTaskKey: Key | null;
    bottomGhostTaskKey: Key;
    getTaskKey: (taskRow: TaskRow) => Key;
    getTaskStatus: (taskRow: TaskRow) => TaskStatus;
    onTaskStatusChange: (taskRow: TaskRow, status: TaskStatus) => void;
    getTaskTitle: (taskRow: TaskRow) => TaskTitle;
    onTaskTitleChange: (taskRow: TaskRow, title: TaskTitle) => void;
    getTaskAssignee: (taskRow: TaskRow) => TaskAssignee | null;
    onTaskAssigneeChange: (taskRow: TaskRow, assignee: TaskAssignee | null) => void;
    getTaskPriority: (taskRow: TaskRow) => TaskPriority | null;
    onTaskPriorityChange: (taskRow: TaskRow, priority: TaskPriority | null) => void;
    getTaskDueDate: (taskRow: TaskRow) => CalendarDate | null;
    onTaskDueDateChange: (taskRow: TaskRow, dueDate: CalendarDate | null) => void;
    allCollections: ReadonlyArray<LocalTaskCollection>;
    getTaskCollections: (taskRow: TaskRow) => ReadonlyArray<LocalTaskCollection>;
    createCollectionAndAddToTask: (
        taskRow: TaskRow,
        collection: {
            id: LocalTaskCollectionId;
            name: string;
            color: ThemeColor;
        },
    ) => void;
    addCollectionToTask: (taskRow: TaskRow, collectionId: LocalTaskCollectionId) => void;
    removeCollectionFromTask: (taskRow: TaskRow, collectionId: LocalTaskCollectionId) => void;
    getTaskParentTaskTitle: (taskRow: TaskRow) => TaskTitle | null;
    getTaskChildTaskCount: (taskRow: TaskRow) => number;
    getTaskClosedChildTaskCount: (taskRow: TaskRow) => number;
    getTaskAreChildTasksCollapsed: (taskRow: TaskRow) => boolean;
    onTaskAreChildTasksCollapsedToggle: (taskRow: TaskRow) => void;
    onTaskExpand: ((taskRow: TaskRow) => Promise<void>) | null;
    getTaskRowIndentation: (taskRow: TaskRow) => number;
    createTaskAbove: (taskRow: TaskRow) => void;
    createTaskBelowAndFocus: (taskRow: TaskRow) => void;
    createTaskChildAtStartAndFocus: (taskRow: TaskRow) => void;
    createTaskAtEndFromBottomGhost: (options?: {
        title?: TaskTitle;
        assignee?: TaskAssignee;
        priority?: TaskPriority;
        dueDate?: CalendarDate;
    }) => void;
    createTaskAtEndFromBottomGhostAndFocusNewGhost: (title: TaskTitle) => void;
    createTaskAtStartFromTopGhostWithoutNewGhost: (options: {
        title?: TaskTitle;
        assignee?: TaskAssignee;
        priority?: TaskPriority;
        dueDate?: CalendarDate;
    }) => void;
    createTaskAtStartFromTopGhostAndFocus: (title: TaskTitle) => void;
    nestTaskAndExpandParentRow: (
        parentTaskRow: TaskRow,
        childTaskRow: TaskRow,
        titleSelection: Selection,
        newTaskRowIndentation: number,
    ) => void;
    unnestTaskIfNestedRow: (childTaskRow: TaskRow, titleSelection: Selection) => void;
    deleteTaskAndAllChildrenAndFocusPreviousRow: (taskRow: TaskRow) => void;
    deleteTaskAndAllChildrenMaybeWithConfirmation: (taskRow: TaskRow) => void;
    moveTaskBelow: (belowTaskRow: TaskRow | null, unnest: number, taskRow: TaskRow) => void;
    moveTaskToParentTop: (parentTaskRow: TaskRow, taskRow: TaskRow) => void;
};

function OLD_TaskGridView<TaskRow>(
    {
        capabilities,
        taskGhostRowPlaceholder = "Add a task…",
        taskRowCount,
        getTaskRow,
        topGhostTaskKey,
        bottomGhostTaskKey,
        getTaskKey,
        getTaskStatus,
        onTaskStatusChange,
        getTaskTitle,
        onTaskTitleChange,
        getTaskAssignee,
        onTaskAssigneeChange,
        getTaskPriority,
        onTaskPriorityChange,
        getTaskDueDate,
        onTaskDueDateChange,
        allCollections,
        getTaskCollections,
        createCollectionAndAddToTask,
        addCollectionToTask,
        removeCollectionFromTask,
        getTaskParentTaskTitle,
        getTaskChildTaskCount,
        getTaskClosedChildTaskCount,
        getTaskAreChildTasksCollapsed,
        onTaskAreChildTasksCollapsedToggle,
        onTaskExpand,
        getTaskRowIndentation,
        createTaskAbove,
        createTaskBelowAndFocus,
        createTaskChildAtStartAndFocus,
        createTaskAtEndFromBottomGhost,
        createTaskAtEndFromBottomGhostAndFocusNewGhost,
        createTaskAtStartFromTopGhostWithoutNewGhost,
        createTaskAtStartFromTopGhostAndFocus,
        nestTaskAndExpandParentRow,
        unnestTaskIfNestedRow,
        deleteTaskAndAllChildrenAndFocusPreviousRow,
        deleteTaskAndAllChildrenMaybeWithConfirmation,
        moveTaskBelow,
        moveTaskToParentTop,
    }: OLD_TaskGridViewProps<TaskRow>,
    ref: Ref<OLD_TaskGridViewRef>,
) {
    const topGhostTaskRowRef = useRef<TaskRowPresentationalViewRef>(null);
    const bottomGhostTaskRowRef = useRef<TaskRowPresentationalViewRef>(null);

    const taskRowRefByIndex = useConstant(
        new LazyMap(() => createRef<TaskRowPresentationalViewRef>()),
    );

    useImperativeHandle(
        ref,
        () => ({
            focusTaskRowTitleStart: index =>
                assertExists(taskRowRefByIndex.get(index).current).focusTitleStart(),
            focusTaskRowTitleEnd: index =>
                assertExists(taskRowRefByIndex.get(index).current).focusTitleEnd(),
            focusTaskRowTitleSelection: (index, selection) =>
                assertExists(taskRowRefByIndex.get(index).current).focusTitleSelection(selection),
            focusStart: () => {
                const taskRow =
                    topGhostTaskRowRef.current ??
                    taskRowRefByIndex.get(0).current ??
                    assertExists(bottomGhostTaskRowRef.current);

                taskRow.focusTitleStart();
            },
            focusEnd: () => {
                assertExists(bottomGhostTaskRowRef.current).focusTitleEnd();
            },
        }),
        [taskRowRefByIndex],
    );

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

    const [editingCollectionsOfTaskRowKey, setEditingCollectionsOfTaskRowKey] =
        useState<Key | null>(null);

    const editingTaskRowCollectionsContainerRef = useOutsideInteraction(() => {
        // When focus changes, focus rings are updated with immediate priority. Make
        // sure we unfocus our collection cell as well.
        runWithImmediatePriority(() => {
            setEditingCollectionsOfTaskRowKey(null);
        });
    });

    const taskRows: Array<ReactNode> = [];

    const hasTopGhostTaskRow = topGhostTaskKey !== null && taskRowCount >= 1;

    if (hasTopGhostTaskRow) {
        const taskRowKey = `${topGhostTaskKey}-0`;

        const isEditingCollections = editingCollectionsOfTaskRowKey === taskRowKey;

        taskRows.push(
            <TaskRowPresentationalView
                key={taskRowKey}
                ref={topGhostTaskRowRef}
                capabilities={capabilities}
                taskRow={null}
                status={null}
                onStatusChange={noop}
                title={emptyTaskTitle}
                onTitleChange={title => createTaskAtStartFromTopGhostWithoutNewGhost({title})}
                titlePlaceholder="Add a task…"
                assignee={null}
                onAssigneeChange={assignee => {
                    if (assignee) {
                        createTaskAtStartFromTopGhostWithoutNewGhost({assignee});
                    }
                }}
                priority={null}
                onPriorityChange={priority => {
                    if (priority) {
                        createTaskAtStartFromTopGhostWithoutNewGhost({priority});
                    }
                }}
                dueDate={null}
                onDueDateChange={dueDate => {
                    if (dueDate) {
                        createTaskAtStartFromTopGhostWithoutNewGhost({dueDate});
                    }
                }}
                allCollections={allCollections}
                collections={emptyArray}
                createCollectionAndAddToTask={() => {
                    // NOCOMMIT
                }}
                addCollectionToTask={() => {
                    // NOCOMMIT
                }}
                removeCollectionFromTask={() => {
                    // NOCOMMIT
                }}
                isEditingCollections={isEditingCollections}
                onEditingCollectionsChange={isEditingCollections => {
                    if (isEditingCollections) {
                        setEditingCollectionsOfTaskRowKey(taskRowKey);
                    } else if (editingCollectionsOfTaskRowKey === taskRowKey) {
                        setEditingCollectionsOfTaskRowKey(null);
                    }
                }}
                editingCollectionsContainerRef={
                    isEditingCollections ? editingTaskRowCollectionsContainerRef : null
                }
                parentTaskTitle={null}
                childTaskCount={0}
                closedChildTaskCount={0}
                areChildTasksCollapsed={false}
                onAreChildTasksCollapsedToggle={noop}
                onExpand={null}
                indentation={0}
                droppableIndentations={[0]}
                createTaskAbove={() => createTaskAtStartFromTopGhostAndFocus(emptyTaskTitle)}
                createTaskBelowAndFocus={() =>
                    createTaskAtStartFromTopGhostAndFocus(emptyTaskTitle)
                }
                createTaskChildAtStartAndFocus={() =>
                    createTaskAtStartFromTopGhostAndFocus(emptyTaskTitle)
                }
                nestWithPreviousTaskRowIfExistsAndExpand={noop}
                unnestTaskIfNestedRow={noop}
                deleteTaskAndAllChildrenAndFocusPreviousRow={noop}
                deleteTaskAndAllChildrenMaybeWithConfirmation={noop}
                focusNextTaskTitleCoord={coord => {
                    coord = lastArrowNavigationCoordRef.current?.coord ?? coord;

                    taskRowRefByIndex.get(0)?.current?.focusTitleCoord(coord, "top");

                    lastArrowNavigationCoordRef.current = {
                        setTime: new Date(),
                        coord,
                    };
                }}
                focusPreviousTaskTitleCoord={coord => {
                    coord = lastArrowNavigationCoordRef.current?.coord ?? coord;

                    // No previous task...

                    lastArrowNavigationCoordRef.current = {
                        setTime: new Date(),
                        coord,
                    };
                }}
                preserveLastTaskTitleArrowNavigationCoord={() => {
                    if (lastArrowNavigationCoordRef.current) {
                        lastArrowNavigationCoordRef.current = {
                            setTime: new Date(),
                            coord: lastArrowNavigationCoordRef.current.coord,
                        };
                    }
                }}
                focusFirstTaskTitleStart={() => {
                    topGhostTaskRowRef.current?.focusTitleStart();
                }}
                focusLastTaskTitleEnd={() => {
                    bottomGhostTaskRowRef.current?.focusTitleEnd();
                }}
            />,
        );
    }

    for (let index = 0; index < taskRowCount; index++) {
        const taskRow = getTaskRow(index);
        const taskRowIndentation = getTaskRowIndentation(taskRow);

        const droppableIndentations = [];

        if (!getTaskAreChildTasksCollapsed(taskRow) && getTaskChildTaskCount(taskRow) > 0) {
            droppableIndentations.push(taskRowIndentation + 1);
        } else {
            const nextTaskRowIndentation =
                index + 1 < taskRowCount ? getTaskRowIndentation(getTaskRow(index + 1)) : 0;

            droppableIndentations.push(taskRowIndentation);

            for (
                let droppableIndentation = taskRowIndentation - 1;
                droppableIndentation >= nextTaskRowIndentation;
                droppableIndentation--
            ) {
                droppableIndentations.push(droppableIndentation);
            }
        }

        // Tasks may appear at both the root level and as a nested subtask.
        // So disambiguate by adding the indentation level the task is at.
        const taskRowKey = `${getTaskKey(taskRow)}-${taskRowIndentation}`;

        const isEditingCollections = editingCollectionsOfTaskRowKey === taskRowKey;

        taskRows.push(
            <TaskRowPresentationalView
                key={taskRowKey}
                ref={taskRowRefByIndex.get(index)}
                capabilities={capabilities}
                taskRow={taskRow}
                status={getTaskStatus(taskRow)}
                onStatusChange={status => onTaskStatusChange(taskRow, status)}
                title={getTaskTitle(taskRow)}
                onTitleChange={title => onTaskTitleChange(taskRow, title)}
                assignee={getTaskAssignee(taskRow)}
                onAssigneeChange={assignee => onTaskAssigneeChange(taskRow, assignee)}
                priority={getTaskPriority(taskRow)}
                onPriorityChange={priority => onTaskPriorityChange(taskRow, priority)}
                dueDate={getTaskDueDate(taskRow)}
                onDueDateChange={dueDate => onTaskDueDateChange(taskRow, dueDate)}
                allCollections={allCollections}
                collections={getTaskCollections(taskRow)}
                createCollectionAndAddToTask={collection =>
                    createCollectionAndAddToTask(taskRow, collection)
                }
                addCollectionToTask={collectionId => addCollectionToTask(taskRow, collectionId)}
                removeCollectionFromTask={collectionId =>
                    removeCollectionFromTask(taskRow, collectionId)
                }
                isEditingCollections={isEditingCollections}
                onEditingCollectionsChange={isEditingCollections => {
                    if (isEditingCollections) {
                        setEditingCollectionsOfTaskRowKey(taskRowKey);
                    } else if (editingCollectionsOfTaskRowKey === taskRowKey) {
                        setEditingCollectionsOfTaskRowKey(null);
                    }
                }}
                editingCollectionsContainerRef={
                    isEditingCollections ? editingTaskRowCollectionsContainerRef : null
                }
                parentTaskTitle={getTaskParentTaskTitle(taskRow)}
                childTaskCount={getTaskChildTaskCount(taskRow)}
                closedChildTaskCount={getTaskClosedChildTaskCount(taskRow)}
                areChildTasksCollapsed={getTaskAreChildTasksCollapsed(taskRow)}
                onAreChildTasksCollapsedToggle={() => onTaskAreChildTasksCollapsedToggle(taskRow)}
                onExpand={onTaskExpand ? () => onTaskExpand(taskRow) : null}
                indentation={taskRowIndentation}
                droppableIndentations={droppableIndentations}
                createTaskAbove={() => createTaskAbove(taskRow)}
                createTaskBelowAndFocus={() => createTaskBelowAndFocus(taskRow)}
                createTaskChildAtStartAndFocus={() => createTaskChildAtStartAndFocus(taskRow)}
                nestWithPreviousTaskRowIfExistsAndExpand={titleSelection => {
                    for (let taskRowIndex = index - 1; taskRowIndex >= 0; taskRowIndex--) {
                        const parentTaskRow = getTaskRow(taskRowIndex);
                        if (getTaskRowIndentation(parentTaskRow) === taskRowIndentation) {
                            nestTaskAndExpandParentRow(
                                parentTaskRow,
                                taskRow,
                                titleSelection,
                                taskRowIndentation + 1,
                            );
                            break;
                        }
                    }
                }}
                unnestTaskIfNestedRow={titleSelection =>
                    unnestTaskIfNestedRow(taskRow, titleSelection)
                }
                deleteTaskAndAllChildrenAndFocusPreviousRow={() =>
                    deleteTaskAndAllChildrenAndFocusPreviousRow(taskRow)
                }
                deleteTaskAndAllChildrenMaybeWithConfirmation={() =>
                    deleteTaskAndAllChildrenMaybeWithConfirmation(taskRow)
                }
                focusNextTaskTitleCoord={coord => {
                    coord = lastArrowNavigationCoordRef.current?.coord ?? coord;

                    if (index >= taskRowCount - 1) {
                        bottomGhostTaskRowRef.current?.focusTitleCoord(coord, "top");
                    } else {
                        taskRowRefByIndex.get(index + 1)?.current?.focusTitleCoord(coord, "top");
                    }

                    lastArrowNavigationCoordRef.current = {
                        setTime: new Date(),
                        coord,
                    };
                }}
                focusPreviousTaskTitleCoord={coord => {
                    coord = lastArrowNavigationCoordRef.current?.coord ?? coord;

                    if (index === 0) {
                        topGhostTaskRowRef.current?.focusTitleCoord(coord, "bottom");
                    } else {
                        taskRowRefByIndex.get(index - 1)?.current?.focusTitleCoord(coord, "bottom");
                    }

                    lastArrowNavigationCoordRef.current = {
                        setTime: new Date(),
                        coord,
                    };
                }}
                preserveLastTaskTitleArrowNavigationCoord={() => {
                    if (lastArrowNavigationCoordRef.current) {
                        lastArrowNavigationCoordRef.current = {
                            setTime: new Date(),
                            coord: lastArrowNavigationCoordRef.current.coord,
                        };
                    }
                }}
                focusFirstTaskTitleStart={() => {
                    if (topGhostTaskRowRef.current) {
                        topGhostTaskRowRef.current.focusTitleStart();
                    } else if (taskRowCount === 0) {
                        bottomGhostTaskRowRef.current?.focusTitleStart();
                    } else {
                        taskRowRefByIndex.get(0).current?.focusTitleStart();
                    }
                }}
                focusLastTaskTitleEnd={() => {
                    bottomGhostTaskRowRef.current?.focusTitleEnd();
                }}
            />,
        );
    }

    {
        const taskRowKey = `${bottomGhostTaskKey}-0`;

        const isEditingCollections = editingCollectionsOfTaskRowKey === taskRowKey;

        taskRows.push(
            <TaskRowPresentationalView
                key={taskRowKey}
                ref={bottomGhostTaskRowRef}
                capabilities={capabilities}
                // If there are no task rows, the padding just makes our ghost row placeholder
                // look misaligned. So remove it.
                withoutPaddingLeft={taskRowCount === 0}
                taskRow={null}
                status={null}
                onStatusChange={noop}
                title={emptyTaskTitle}
                onTitleChange={title => createTaskAtEndFromBottomGhost({title})}
                titlePlaceholder={taskGhostRowPlaceholder}
                assignee={null}
                onAssigneeChange={assignee => {
                    if (assignee) {
                        createTaskAtEndFromBottomGhost({assignee});
                    }
                }}
                priority={null}
                onPriorityChange={priority => {
                    if (priority) {
                        createTaskAtEndFromBottomGhost({priority});
                    }
                }}
                dueDate={null}
                onDueDateChange={dueDate => {
                    if (dueDate) {
                        createTaskAtEndFromBottomGhost({dueDate});
                    }
                }}
                allCollections={allCollections}
                collections={emptyArray}
                createCollectionAndAddToTask={() => {
                    // NOCOMMIT
                }}
                addCollectionToTask={() => {
                    // NOCOMMIT
                }}
                removeCollectionFromTask={() => {
                    // NOCOMMIT
                }}
                isEditingCollections={isEditingCollections}
                onEditingCollectionsChange={isEditingCollections => {
                    if (isEditingCollections) {
                        setEditingCollectionsOfTaskRowKey(taskRowKey);
                    } else if (editingCollectionsOfTaskRowKey === taskRowKey) {
                        setEditingCollectionsOfTaskRowKey(null);
                    }
                }}
                editingCollectionsContainerRef={
                    isEditingCollections ? editingTaskRowCollectionsContainerRef : null
                }
                parentTaskTitle={null}
                childTaskCount={0}
                closedChildTaskCount={0}
                areChildTasksCollapsed={false}
                onAreChildTasksCollapsedToggle={noop}
                onExpand={null}
                indentation={0}
                droppableIndentations={[]}
                createTaskAbove={() =>
                    createTaskAtEndFromBottomGhostAndFocusNewGhost(emptyTaskTitle)
                }
                createTaskBelowAndFocus={() =>
                    createTaskAtEndFromBottomGhostAndFocusNewGhost(emptyTaskTitle)
                }
                createTaskChildAtStartAndFocus={() =>
                    createTaskAtEndFromBottomGhostAndFocusNewGhost(emptyTaskTitle)
                }
                nestWithPreviousTaskRowIfExistsAndExpand={noop}
                unnestTaskIfNestedRow={noop}
                deleteTaskAndAllChildrenAndFocusPreviousRow={() => {
                    taskRowRefByIndex.get(taskRowCount - 1)?.current?.focusTitleEnd();
                }}
                deleteTaskAndAllChildrenMaybeWithConfirmation={noop}
                focusNextTaskTitleCoord={coord => {
                    coord = lastArrowNavigationCoordRef.current?.coord ?? coord;

                    // No next task...

                    lastArrowNavigationCoordRef.current = {
                        setTime: new Date(),
                        coord,
                    };
                }}
                focusPreviousTaskTitleCoord={coord => {
                    coord = lastArrowNavigationCoordRef.current?.coord ?? coord;

                    taskRowRefByIndex
                        .get(taskRowCount - 1)
                        ?.current?.focusTitleCoord(coord, "bottom");

                    lastArrowNavigationCoordRef.current = {
                        setTime: new Date(),
                        coord,
                    };
                }}
                preserveLastTaskTitleArrowNavigationCoord={() => {
                    if (lastArrowNavigationCoordRef.current) {
                        lastArrowNavigationCoordRef.current = {
                            setTime: new Date(),
                            coord: lastArrowNavigationCoordRef.current.coord,
                        };
                    }
                }}
                focusFirstTaskTitleStart={() => {
                    if (topGhostTaskRowRef.current) {
                        topGhostTaskRowRef.current.focusTitleStart();
                    } else if (taskRowCount === 0) {
                        bottomGhostTaskRowRef.current?.focusTitleEnd();
                    } else {
                        taskRowRefByIndex.get(0).current?.focusTitleStart();
                    }
                }}
                focusLastTaskTitleEnd={() => {
                    bottomGhostTaskRowRef.current?.focusTitleEnd();
                }}
            />,
        );
    }

    const decorativeGhostTaskRow = (
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
            {...useOutOfBoundsClickSelection({
                onSelect: () => bottomGhostTaskRowRef.current?.focusTitleEnd(),
                onSelectAll: () => bottomGhostTaskRowRef.current?.focusTitleEnd(),
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
        </Box>
    );

    return (
        <TaskGridViewDndContext
            getTaskStatus={getTaskStatus}
            getTaskAssignee={getTaskAssignee}
            onTaskAssigneeChange={onTaskAssigneeChange}
            getTaskTitle={getTaskTitle}
            getTaskRowIndentation={getTaskRowIndentation}
            moveTaskBelow={moveTaskBelow}
            moveTaskToParentTop={moveTaskToParentTop}
        >
            <GlobalKeyDownEvent
                onGlobalKeyDown={event => {
                    if (editingCollectionsOfTaskRowKey && event.key === "Escape") {
                        event.preventDefault();
                        event.stopPropagation();
                        setEditingCollectionsOfTaskRowKey(null);
                        return;
                    }
                }}
            >
                <Box position="relative" zIndex="0">
                    {capabilities.hasColumns && (
                        <Box display="flex">
                            <Box
                                flexShrink="0"
                                width="32"
                                paddingLeft="5"
                                paddingBottom="1"
                                color="grey-50"
                                fontSize="50"
                            >
                                Name
                            </Box>
                            <Box flexGrow="1" />
                            <Box
                                flexShrink="0"
                                style={{
                                    width: taskRowViewFirstColumnWidth,
                                    paddingLeft: taskRowViewFirstColumnPaddingLeft,
                                }}
                                paddingX={taskRowViewColumnPaddingX}
                                paddingBottom="1"
                                color="grey-50"
                                fontSize="50"
                            >
                                Assignee
                            </Box>
                            <Box
                                flexShrink="0"
                                width={taskRowViewColumnWidth}
                                paddingX={taskRowViewColumnPaddingX}
                                paddingBottom="1"
                                color="grey-50"
                                fontSize="50"
                            >
                                Priority
                            </Box>
                            <Box
                                flexShrink="0"
                                width={taskRowViewColumnWidth}
                                paddingX={taskRowViewColumnPaddingX}
                                paddingBottom="1"
                                color="grey-50"
                                fontSize="50"
                            >
                                Due date
                            </Box>
                            <Box
                                flexShrink="0"
                                width={taskRowViewCollectionsColumnWidth}
                                paddingLeft={taskRowViewColumnPaddingX}
                                paddingRight={taskRowViewLastColumnPaddingRight}
                                paddingBottom="1"
                                color="grey-50"
                                fontSize="50"
                            >
                                Collections
                            </Box>
                            <Box flexShrink="0" width="5" />
                        </Box>
                    )}
                    {!hasTopGhostTaskRow && (
                        <Box position="relative" height="0">
                            <TaskRowViewDroppable
                                taskRow={null}
                                indentation={0}
                                nextAdjacentIndentation={null}
                                previousAdjacentIndentation={null}
                                isPositionedAbove={true}
                                isVerticallyFlipped={true}
                            />
                        </Box>
                    )}
                    {taskRows}
                    {taskRows.length <= 1 && decorativeGhostTaskRow}
                    {taskRows.length <= 2 && decorativeGhostTaskRow}
                </Box>
            </GlobalKeyDownEvent>
        </TaskGridViewDndContext>
    );
}
