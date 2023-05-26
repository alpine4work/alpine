import {Key, createRef, useEffect, useRef} from "react";
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

export function TaskGridPresentationalView<Task>({
    taskCount,
    getTask,
    getKey,
    getStatus,
    onStatusChange,
    getTitle,
    onTitleChange,
    getAssignee,
}: {
    taskCount: number;
    getTask: (index: number) => Task;
    getKey: (task: Task) => Key;
    getStatus: (task: Task) => TaskStatus;
    onStatusChange: (task: Task, status: TaskStatus) => void;
    getTitle: (task: Task) => TaskTitle;
    onTitleChange: (task: Task, title: TaskTitle) => void;
    getAssignee: (task: Task) => TaskAssignee | null;
}) {
    const taskRefByIndex = useConstant(
        new LazyMap(() => createRef<TaskRowPresentationalViewRef>()),
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
                        key={getKey(task)}
                        ref={taskRefByIndex.get(index)}
                        status={getStatus(task)}
                        onStatusChange={status => onStatusChange(task, status)}
                        title={getTitle(task)}
                        onTitleChange={title => onTitleChange(task, title)}
                        assignee={getAssignee(task)}
                        cells={emptyArray}
                        onFocusNextTitleCoord={coord => {
                            coord = lastArrowNavigationCoordRef.current?.coord ?? coord;

                            taskRefByIndex.get(index + 1)?.current?.focusTitleCoord(coord);

                            lastArrowNavigationCoordRef.current = {
                                setTime: new Date(),
                                coord,
                            };
                        }}
                        onFocusPreviousTitleCoord={coord => {
                            coord = lastArrowNavigationCoordRef.current?.coord ?? coord;

                            taskRefByIndex.get(index - 1)?.current?.focusTitleCoord(coord);

                            lastArrowNavigationCoordRef.current = {
                                setTime: new Date(),
                                coord,
                            };
                        }}
                        onFocusFirstTitleStart={() => {
                            taskRefByIndex.get(0).current?.focusTitleStart();
                        }}
                        onFocusLastTitleEnd={() => {
                            taskRefByIndex.get(taskCount - 1).current?.focusTitleEnd();
                        }}
                    />
                );
            })}
        </Box>
    );
}
