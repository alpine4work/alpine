import {
    Key,
    PropsWithoutRef,
    ReactElement,
    ReactNode,
    Ref,
    RefAttributes,
    createRef,
    forwardRef,
    useEffect,
    useImperativeHandle,
    useRef,
} from "react";
import {Box} from "~/client/design/box";
import {useConstant} from "~/client/helpers/lifecycle/use_constant";
import {
    TaskRowPresentationalView,
    TaskRowPresentationalViewRef,
    taskRowViewHeight,
} from "~/client/tasks/demo_2/task_row_presentational_view";
import {TaskAssignee, TaskStatus} from "~/client/tasks/demo_2/task_status_button";
import {useOutOfBoundsClickSelection} from "~/client/tasks/internal/use_out_of_bounds_click_selection";
import {emptyArray} from "~/shared/helpers/array/empty_array";
import {assertExists} from "~/shared/helpers/control/assert_exists";
import {LazyMap} from "~/shared/helpers/control/lazy_map";
import {noop} from "~/shared/helpers/control/noop";
import {colorSchemeVars} from "~/shared/styles/styles";
import {TaskTitle, emptyTaskTitle} from "~/shared/tasks/task_title_schema";

export type TaskGridPresentationalViewRef = {
    focusTaskRowTitleStart(index: number): void;
    focusTaskRowTitleEnd(index: number): void;
    focusStart(): void;
    focusEnd(): void;
};

const TaskGridPresentationalViewForwardRef = forwardRef(TaskGridPresentationalView) as <TaskRow>(
    props: PropsWithoutRef<TaskGridPresentationalViewProps<TaskRow>> &
        RefAttributes<TaskGridPresentationalViewRef>,
) => ReactElement;
export {TaskGridPresentationalViewForwardRef as TaskGridPresentationalView};

export type TaskGridPresentationalViewProps<TaskRow> = {
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
    getTaskChildTaskCount: (taskRow: TaskRow) => number;
    getTaskClosedChildTaskCount: (taskRow: TaskRow) => number;
    getTaskAreChildTasksCollapsed: (taskRow: TaskRow) => boolean;
    onTaskAreChildTasksCollapsedToggle: (taskRow: TaskRow) => void;
    onTaskExpand: ((taskRow: TaskRow) => Promise<void>) | null;
    getTaskRowIndentation: (taskRow: TaskRow) => number;
    createTaskAbove: (taskRow: TaskRow) => void;
    createTaskBelowAndFocus: (taskRow: TaskRow) => void;
    createTaskChildAtStartAndFocus: (taskRow: TaskRow) => void;
    createTaskAtEndFromBottomGhost: (title: TaskTitle) => void;
    createTaskAtEndFromBottomGhostAndFocusNewGhost: (title: TaskTitle) => void;
    createTaskAtStartFromTopGhostWithoutNewGhost: (title: TaskTitle) => void;
    createTaskAtStartFromTopGhostAndFocus: (title: TaskTitle) => void;
    nestTaskAndExpandParentRow: (parentTaskRow: TaskRow, childTaskRow: TaskRow) => void;
    unnestTaskIfNestedRow: (childTaskRow: TaskRow) => void;
    deleteTaskAndAllChildrenAndFocusPreviousRow: (taskRow: TaskRow) => void;
};

function TaskGridPresentationalView<TaskRow>(
    {
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
    }: TaskGridPresentationalViewProps<TaskRow>,
    ref: Ref<TaskGridPresentationalViewRef>,
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
                taskRowRefByIndex.get(index).current?.focusTitleStart(),
            focusTaskRowTitleEnd: index => taskRowRefByIndex.get(index).current?.focusTitleEnd(),
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

    const taskRows: Array<ReactNode> = [];

    if (topGhostTaskKey !== null && taskRowCount >= 1) {
        taskRows.push(
            <TaskRowPresentationalView
                key={topGhostTaskKey}
                ref={topGhostTaskRowRef}
                status={null}
                onStatusChange={noop}
                title={emptyTaskTitle}
                onTitleChange={title => createTaskAtStartFromTopGhostWithoutNewGhost(title)}
                titlePlaceholder="Add a task…"
                assignee={null}
                childTaskCount={0}
                closedChildTaskCount={0}
                areChildTasksCollapsed={false}
                onAreChildTasksCollapsedToggle={noop}
                onExpand={null}
                indentation={0}
                cells={emptyArray}
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
                focusNextTaskTitleCoord={coord => {
                    coord = lastArrowNavigationCoordRef.current?.coord ?? coord;

                    taskRowRefByIndex.get(0)?.current?.focusTitleCoord(coord);

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

        taskRows.push(
            <TaskRowPresentationalView
                key={getTaskKey(taskRow)}
                ref={taskRowRefByIndex.get(index)}
                status={getTaskStatus(taskRow)}
                onStatusChange={status => onTaskStatusChange(taskRow, status)}
                title={getTaskTitle(taskRow)}
                onTitleChange={title => onTaskTitleChange(taskRow, title)}
                assignee={getTaskAssignee(taskRow)}
                childTaskCount={getTaskChildTaskCount(taskRow)}
                closedChildTaskCount={getTaskClosedChildTaskCount(taskRow)}
                areChildTasksCollapsed={getTaskAreChildTasksCollapsed(taskRow)}
                onAreChildTasksCollapsedToggle={() => onTaskAreChildTasksCollapsedToggle(taskRow)}
                onExpand={onTaskExpand ? () => onTaskExpand(taskRow) : null}
                indentation={taskRowIndentation}
                cells={emptyArray}
                createTaskAbove={() => createTaskAbove(taskRow)}
                createTaskBelowAndFocus={() => createTaskBelowAndFocus(taskRow)}
                createTaskChildAtStartAndFocus={() => createTaskChildAtStartAndFocus(taskRow)}
                nestWithPreviousTaskRowIfExistsAndExpand={() => {
                    for (let taskRowIndex = index - 1; taskRowIndex >= 0; taskRowIndex--) {
                        const parentTaskRow = getTaskRow(taskRowIndex);
                        if (getTaskRowIndentation(parentTaskRow) === taskRowIndentation) {
                            nestTaskAndExpandParentRow(parentTaskRow, taskRow);
                            break;
                        }
                    }
                }}
                unnestTaskIfNestedRow={() => unnestTaskIfNestedRow(taskRow)}
                deleteTaskAndAllChildrenAndFocusPreviousRow={() =>
                    deleteTaskAndAllChildrenAndFocusPreviousRow(taskRow)
                }
                focusNextTaskTitleCoord={coord => {
                    coord = lastArrowNavigationCoordRef.current?.coord ?? coord;

                    if (index >= taskRowCount - 1) {
                        bottomGhostTaskRowRef.current?.focusTitleCoord(coord);
                    } else {
                        taskRowRefByIndex.get(index + 1)?.current?.focusTitleCoord(coord);
                    }

                    lastArrowNavigationCoordRef.current = {
                        setTime: new Date(),
                        coord,
                    };
                }}
                focusPreviousTaskTitleCoord={coord => {
                    coord = lastArrowNavigationCoordRef.current?.coord ?? coord;

                    if (index === 0) {
                        topGhostTaskRowRef.current?.focusTitleCoord(coord);
                    } else {
                        taskRowRefByIndex.get(index - 1)?.current?.focusTitleCoord(coord);
                    }

                    lastArrowNavigationCoordRef.current = {
                        setTime: new Date(),
                        coord,
                    };
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

    taskRows.push(
        <TaskRowPresentationalView
            key={bottomGhostTaskKey}
            ref={bottomGhostTaskRowRef}
            // If there are no task rows, the padding just makes our ghost row placeholder
            // look misaligned. So remove it.
            withoutPaddingLeft={taskRowCount === 0}
            status={null}
            onStatusChange={noop}
            title={emptyTaskTitle}
            onTitleChange={title => createTaskAtEndFromBottomGhost(title)}
            titlePlaceholder={taskGhostRowPlaceholder}
            assignee={null}
            childTaskCount={0}
            closedChildTaskCount={0}
            areChildTasksCollapsed={false}
            onAreChildTasksCollapsedToggle={noop}
            onExpand={null}
            indentation={0}
            cells={emptyArray}
            createTaskAbove={() => createTaskAtEndFromBottomGhostAndFocusNewGhost(emptyTaskTitle)}
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

                taskRowRefByIndex.get(taskRowCount - 1)?.current?.focusTitleCoord(coord);

                lastArrowNavigationCoordRef.current = {
                    setTime: new Date(),
                    coord,
                };
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

    const decorativeGhostTaskRow = (
        <Box
            paddingX="5"
            height={taskRowViewHeight}
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
        <Box>
            {taskRows}
            {taskRows.length <= 1 && decorativeGhostTaskRow}
            {taskRows.length <= 2 && decorativeGhostTaskRow}
        </Box>
    );
}
