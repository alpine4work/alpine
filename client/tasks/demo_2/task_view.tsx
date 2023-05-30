import {useMemo} from "react";
import {useLocalTasksState} from "~/client/tasks/demo_2/internal/local_tasks_state";
import {TaskDetailPresentationalView} from "~/client/tasks/demo_2/task_detail_presentational_view";
import {emptyArray} from "~/shared/helpers/array/empty_array";
import {LocalTaskId} from "~/shared/id/types/id_types";

export function TaskView({taskId}: {taskId: LocalTaskId}) {
    const [state, dispatch] = useLocalTasksState();
    const task = useMemo(() => state.database.getTask(taskId), [state.database, taskId]);

    return (
        <TaskDetailPresentationalView
            status={task.status}
            onStatusChange={status => dispatch({type: "UpdateTaskStatus", taskId, status})}
            title={task.title}
            onTitleChange={title => dispatch({type: "UpdateTaskTitle", taskId, title})}
            assignee={null} // NOCOMMIT
            dueDate={null} // NOCOMMIT
            onDueDateChange={() => {}} // NOCOMMIT
            collections={emptyArray} // NOCOMMIT
            notesContent={task.notesContent}
            onNotesContentChange={notesContent =>
                dispatch({type: "UpdateTaskNotesContent", taskId, notesContent})
            }
        />
    );
}
