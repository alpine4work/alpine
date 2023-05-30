import {useMemo} from "react";
import {useLocalTasksState} from "~/client/tasks/demo_2/internal/local_tasks_state";
import {TaskDetailPresentationalView} from "~/client/tasks/demo_2/task_detail_presentational_view";
import {emptyArray} from "~/shared/helpers/array/empty_array";
import {LocalTaskId} from "~/shared/id/types/id_types";
import {emptyTaskNotesContentWithReferences} from "~/shared/tasks/task_notes_content_schema";

export function TaskView({taskId}: {taskId: LocalTaskId}) {
    const [state, dispatch] = useLocalTasksState();
    const task = useMemo(() => state.database.getTask(taskId), [state.database, taskId]);

    return (
        <TaskDetailPresentationalView
            status={task.status}
            onStatusChange={() => {}} // NOCOMMIT
            title={task.title}
            onTitleChange={() => {}} // NOCOMMIT
            assignee={null} // NOCOMMIT
            dueDate={null} // NOCOMMIT
            onDueDateChange={() => {}} // NOCOMMIT
            collections={emptyArray} // NOCOMMIT
            notesContent={emptyTaskNotesContentWithReferences} // NOCOMMIT
            onNotesContentChange={() => {}} // NOCOMMIT
        />
    );
}
