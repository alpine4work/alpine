import {ServerActionContext} from "~/server/context/server_action_context.js";
import {getTaskNotesContentIfExists} from "~/server/tasks/data/get_task_notes_content_if_exists.js";
import {SpaceId, TaskId} from "~/shared/id/types/id_types.js";
import {createTaskNotFoundError} from "~/shared/tasks/task_error_messages.js";
import {TaskNotesContentWithReferences} from "~/shared/tasks/task_notes_content_schema.js";

export async function getTaskNotesContent(
    context: ServerActionContext,
    taskId: TaskId,
): Promise<{
    spaceId: SpaceId;
    version: number;
    content: TaskNotesContentWithReferences;
}> {
    const taskNotes = await getTaskNotesContentIfExists(context, taskId);
    if (!taskNotes) throw createTaskNotFoundError(taskId);
    return taskNotes;
}
