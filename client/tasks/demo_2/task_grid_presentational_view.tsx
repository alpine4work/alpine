import {
    Key,
    PropsWithoutRef,
    ReactElement,
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
import {createArrayWithLength} from "~/shared/helpers/array/create_array_with_length";
import {emptyArray} from "~/shared/helpers/array/empty_array";
import {assertExists} from "~/shared/helpers/control/assert_exists";
import {LazyMap} from "~/shared/helpers/control/lazy_map";
import {noop} from "~/shared/helpers/control/noop";
import {colorSchemeVars} from "~/shared/styles/styles";
import {TaskTitle, emptyTaskTitle} from "~/shared/tasks/task_title_schema";

export type TaskGridPresentationalViewRef = {
    focusTaskRowTitleStart(index: number): void;
    focusTaskRowTitleEnd(index: number): void;
    focusGhostTaskRow(): void;
};

const TaskGridPresentationalViewForwardRef = forwardRef(TaskGridPresentationalView) as <Task>(
    props: PropsWithoutRef<TaskGridPresentationalViewProps<Task>> &
        RefAttributes<TaskGridPresentationalViewRef>,
) => ReactElement;
export {TaskGridPresentationalViewForwardRef as TaskGridPresentationalView};

type TaskGridPresentationalViewProps<TaskRow> = {
    taskGhostRowPlaceholder?: string;
    taskRowCount: number;
    getTaskRow: (index: number) => TaskRow;
    ghostTaskKey: Key;
    getTaskKey: (taskRow: TaskRow) => Key;
    getTaskStatus: (taskRow: TaskRow) => TaskStatus;
    onTaskStatusChange: (taskRow: TaskRow, status: TaskStatus) => void;
    getTaskTitle: (taskRow: TaskRow) => TaskTitle;
    onTaskTitleChange: (taskRow: TaskRow, title: TaskTitle) => void;
    getTaskAssignee: (taskRow: TaskRow) => TaskAssignee | null;
    getTaskChildTaskCount: (taskRow: TaskRow) => number;
    getTaskAreChildTasksCollapsed: (taskRow: TaskRow) => boolean;
    onAreChildTasksCollapsedToggle: (taskRow: TaskRow) => void;
    getTaskRowIndentation: (taskRow: TaskRow) => number;
    createTaskAbove: (taskRow: TaskRow) => void;
    createTaskBelowAndFocus: (taskRow: TaskRow) => void;
    createTaskChildAtStartAndFocus: (taskRow: TaskRow) => void;
    createTaskAtEndFromGhost: (title: TaskTitle) => void;
    createTaskAtEndFromGhostAndFocusNewGhost: (title: TaskTitle) => void;
    nestTaskAndExpandParentRow: (parentTaskRow: TaskRow, childTaskRow: TaskRow) => void;
    unnestTaskIfNestedRow: (childTaskRow: TaskRow) => void;
    deleteTaskAndAllChildrenAndFocusPreviousRow: (taskRow: TaskRow) => void;
};

function TaskGridPresentationalView<TaskRow>(
    {
        taskGhostRowPlaceholder = "Add a task…",
        taskRowCount,
        getTaskRow,
        ghostTaskKey,
        getTaskKey,
        getTaskStatus,
        onTaskStatusChange,
        getTaskTitle,
        onTaskTitleChange,
        getTaskAssignee,
        getTaskChildTaskCount,
        getTaskAreChildTasksCollapsed,
        onAreChildTasksCollapsedToggle,
        getTaskRowIndentation,
        createTaskAbove,
        createTaskBelowAndFocus,
        createTaskChildAtStartAndFocus,
        createTaskAtEndFromGhost,
        createTaskAtEndFromGhostAndFocusNewGhost,
        nestTaskAndExpandParentRow,
        unnestTaskIfNestedRow,
        deleteTaskAndAllChildrenAndFocusPreviousRow,
    }: TaskGridPresentationalViewProps<TaskRow>,
    ref: Ref<TaskGridPresentationalViewRef>,
) {
    const ghostTaskRowRef = useRef<TaskRowPresentationalViewRef>(null);

    const taskRowRefByIndex = useConstant(
        new LazyMap(() => createRef<TaskRowPresentationalViewRef>()),
    );

    useImperativeHandle(
        ref,
        () => ({
            focusTaskRowTitleStart: index =>
                taskRowRefByIndex.get(index).current?.focusTitleStart(),
            focusTaskRowTitleEnd: index => taskRowRefByIndex.get(index).current?.focusTitleEnd(),
            focusGhostTaskRow: () => assertExists(ghostTaskRowRef.current).focusTitleStart(),
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

    const taskRows = createArrayWithLength(taskRowCount, index => {
        const taskRow = getTaskRow(index);
        const taskRowIndentation = getTaskRowIndentation(taskRow);
        return (
            <TaskRowPresentationalView
                key={getTaskKey(taskRow)}
                ref={taskRowRefByIndex.get(index)}
                status={getTaskStatus(taskRow)}
                onStatusChange={status => onTaskStatusChange(taskRow, status)}
                title={getTaskTitle(taskRow)}
                onTitleChange={title => onTaskTitleChange(taskRow, title)}
                assignee={getTaskAssignee(taskRow)}
                childTaskCount={getTaskChildTaskCount(taskRow)}
                areChildTasksCollapsed={getTaskAreChildTasksCollapsed(taskRow)}
                onAreChildTasksCollapsedToggle={() => onAreChildTasksCollapsedToggle(taskRow)}
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
                        ghostTaskRowRef.current?.focusTitleCoord(coord);
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

                    taskRowRefByIndex.get(index - 1)?.current?.focusTitleCoord(coord);

                    lastArrowNavigationCoordRef.current = {
                        setTime: new Date(),
                        coord,
                    };
                }}
                focusFirstTaskTitleStart={() => {
                    if (taskRowCount === 0) {
                        ghostTaskRowRef.current?.focusTitleEnd();
                    } else {
                        taskRowRefByIndex.get(0).current?.focusTitleStart();
                    }
                }}
                focusLastTaskTitleEnd={() => {
                    ghostTaskRowRef.current?.focusTitleEnd();
                }}
            />
        );
    });

    taskRows.push(
        <TaskRowPresentationalView
            key={ghostTaskKey}
            ref={ghostTaskRowRef}
            // If there are no task rows, the padding just makes our ghost row placeholder
            // look misaligned. So remove it.
            withoutPaddingLeft={taskRowCount === 0}
            status={null}
            onStatusChange={noop}
            title={emptyTaskTitle}
            onTitleChange={title => createTaskAtEndFromGhost(title)}
            titlePlaceholder={taskGhostRowPlaceholder}
            assignee={null}
            childTaskCount={0}
            areChildTasksCollapsed={false}
            onAreChildTasksCollapsedToggle={noop}
            indentation={0}
            cells={emptyArray}
            createTaskAbove={() => createTaskAtEndFromGhostAndFocusNewGhost(emptyTaskTitle)}
            createTaskBelowAndFocus={() => createTaskAtEndFromGhostAndFocusNewGhost(emptyTaskTitle)}
            createTaskChildAtStartAndFocus={() =>
                createTaskAtEndFromGhostAndFocusNewGhost(emptyTaskTitle)
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
                if (taskRowCount === 0) {
                    ghostTaskRowRef.current?.focusTitleEnd();
                } else {
                    taskRowRefByIndex.get(0).current?.focusTitleStart();
                }
            }}
            focusLastTaskTitleEnd={() => {
                ghostTaskRowRef.current?.focusTitleEnd();
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
                onSelect: () => ghostTaskRowRef.current?.focusTitleEnd(),
                onSelectAll: () => ghostTaskRowRef.current?.focusTitleEnd(),
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
            {taskRowCount <= 0 && decorativeGhostTaskRow}
            {taskRowCount <= 1 && decorativeGhostTaskRow}
        </Box>
    );
}
