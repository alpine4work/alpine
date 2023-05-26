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
} from "~/client/tasks/demo_2/task_row_presentational_view";
import {TaskAssignee, TaskStatus} from "~/client/tasks/demo_2/task_status_button";
import {createArrayWithLength} from "~/shared/helpers/array/create_array_with_length";
import {emptyArray} from "~/shared/helpers/array/empty_array";
import {LazyMap} from "~/shared/helpers/control/lazy_map";
import {TaskTitle} from "~/shared/tasks/task_title_schema";

export type TaskGridPresentationalViewRef = {
    focusTaskRowTitleStart(index: number): void;
    focusTaskRowTitleEnd(index: number): void;
};

const TaskGridPresentationalViewForwardRef = forwardRef(TaskGridPresentationalView) as <Task>(
    props: PropsWithoutRef<TaskGridPresentationalViewProps<Task>> &
        RefAttributes<TaskGridPresentationalViewRef>,
) => ReactElement;
export {TaskGridPresentationalViewForwardRef as TaskGridPresentationalView};

type TaskGridPresentationalViewProps<TaskRow> = {
    taskRowCount: number;
    getTaskRow: (index: number) => TaskRow;
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
    createTaskChildAndFocus: (taskRow: TaskRow) => void;
    nestTaskAndExpandParentRow: (parentTaskRow: TaskRow, childTaskRow: TaskRow) => void;
    unnestTaskIfNestedRow: (childTaskRow: TaskRow) => void;
    deleteTaskAndAllChildrenAndFocusPreviousRow: (taskRow: TaskRow) => void;
};

function TaskGridPresentationalView<TaskRow>(
    {
        taskRowCount,
        getTaskRow,
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
        createTaskChildAndFocus,
        nestTaskAndExpandParentRow,
        unnestTaskIfNestedRow,
        deleteTaskAndAllChildrenAndFocusPreviousRow,
    }: TaskGridPresentationalViewProps<TaskRow>,
    ref: Ref<TaskGridPresentationalViewRef>,
) {
    const taskRowRefByIndex = useConstant(
        new LazyMap(() => createRef<TaskRowPresentationalViewRef>()),
    );

    useImperativeHandle(
        ref,
        () => ({
            focusTaskRowTitleStart: index =>
                taskRowRefByIndex.get(index).current?.focusTitleStart(),
            focusTaskRowTitleEnd: index => taskRowRefByIndex.get(index).current?.focusTitleEnd(),
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

    return (
        <Box>
            {createArrayWithLength(taskRowCount, index => {
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
                        onAreChildTasksCollapsedToggle={() =>
                            onAreChildTasksCollapsedToggle(taskRow)
                        }
                        indentation={taskRowIndentation}
                        cells={emptyArray}
                        createTaskAbove={() => createTaskAbove(taskRow)}
                        createTaskBelowAndFocus={() => createTaskBelowAndFocus(taskRow)}
                        createTaskChildAndFocus={() => createTaskChildAndFocus(taskRow)}
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

                            taskRowRefByIndex.get(index + 1)?.current?.focusTitleCoord(coord);

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
                            taskRowRefByIndex.get(0).current?.focusTitleStart();
                        }}
                        focusLastTaskTitleEnd={() => {
                            taskRowRefByIndex.get(taskRowCount - 1).current?.focusTitleEnd();
                        }}
                    />
                );
            })}
        </Box>
    );
}
