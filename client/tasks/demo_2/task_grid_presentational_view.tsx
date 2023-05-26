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
    focusTaskTitleStart(index: number): void;
};

const TaskGridPresentationalViewForwardRef = forwardRef(TaskGridPresentationalView) as <Task>(
    props: PropsWithoutRef<TaskGridPresentationalViewProps<Task>> &
        RefAttributes<TaskGridPresentationalViewRef>,
) => ReactElement;
export {TaskGridPresentationalViewForwardRef as TaskGridPresentationalView};

type TaskGridPresentationalViewProps<Task> = {
    taskCount: number;
    getTask: (index: number) => Task;
    getTaskKey: (task: Task) => Key;
    getTaskStatus: (task: Task) => TaskStatus;
    onTaskStatusChange: (task: Task, status: TaskStatus) => void;
    getTaskTitle: (task: Task) => TaskTitle;
    onTaskTitleChange: (task: Task, title: TaskTitle) => void;
    getTaskAssignee: (task: Task) => TaskAssignee | null;
    createTaskAbove: (task: Task) => void;
    createTaskBelowAndFocus: (task: Task) => void;
};

function TaskGridPresentationalView<Task>(
    {
        taskCount,
        getTask,
        getTaskKey,
        getTaskStatus,
        onTaskStatusChange,
        getTaskTitle,
        onTaskTitleChange,
        getTaskAssignee,
        createTaskAbove,
        createTaskBelowAndFocus,
    }: TaskGridPresentationalViewProps<Task>,
    ref: Ref<TaskGridPresentationalViewRef>,
) {
    const taskRefByIndex = useConstant(
        new LazyMap(() => createRef<TaskRowPresentationalViewRef>()),
    );

    useImperativeHandle(
        ref,
        () => ({
            focusTaskTitleStart: index => taskRefByIndex.get(index).current?.focusTitleStart(),
        }),
        [taskRefByIndex],
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
            {createArrayWithLength(taskCount, index => {
                const task = getTask(index);
                return (
                    <TaskRowPresentationalView
                        key={getTaskKey(task)}
                        ref={taskRefByIndex.get(index)}
                        status={getTaskStatus(task)}
                        onStatusChange={status => onTaskStatusChange(task, status)}
                        title={getTaskTitle(task)}
                        onTitleChange={title => onTaskTitleChange(task, title)}
                        assignee={getTaskAssignee(task)}
                        cells={emptyArray}
                        createTaskAbove={() => createTaskAbove(task)}
                        createTaskBelowAndFocus={() => createTaskBelowAndFocus(task)}
                        focusNextTaskTitleCoord={coord => {
                            coord = lastArrowNavigationCoordRef.current?.coord ?? coord;

                            taskRefByIndex.get(index + 1)?.current?.focusTitleCoord(coord);

                            lastArrowNavigationCoordRef.current = {
                                setTime: new Date(),
                                coord,
                            };
                        }}
                        focusPreviousTaskTitleCoord={coord => {
                            coord = lastArrowNavigationCoordRef.current?.coord ?? coord;

                            taskRefByIndex.get(index - 1)?.current?.focusTitleCoord(coord);

                            lastArrowNavigationCoordRef.current = {
                                setTime: new Date(),
                                coord,
                            };
                        }}
                        focusFirstTaskTitleStart={() => {
                            taskRefByIndex.get(0).current?.focusTitleStart();
                        }}
                        focusLastTaskTitleEnd={() => {
                            taskRefByIndex.get(taskCount - 1).current?.focusTitleEnd();
                        }}
                    />
                );
            })}
        </Box>
    );
}
