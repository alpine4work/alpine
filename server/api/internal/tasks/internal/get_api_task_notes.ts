import {ApiServiceBotActionContext} from "~/server/api/internal/shared/api_service_context.js";
import {intoApiContentWithReferences} from "~/server/api/internal/shared/into_api_content_with_references.js";
import {FileTaskAuthorizer} from "~/server/tasks/data/authorization/file_task_authorizer.js";
import {getTaskNotesContentWithCustomReferences} from "~/server/tasks/data/get_task_notes_content_with_custom_references.js";
import {ApiContentKeyEncoder} from "~/shared/api/content/closed_source/api_content_key_encoder.js";
import {ApiTaskNotesResponse} from "~/shared/api/specification/types/api_specification_convenience_types.open_source.js";
import {SpaceId, TaskId} from "~/shared/id/types/id_types.open_source.js";

/**
 * Reads a task's notes and returns them as an `ApiTaskNotesResponse`. The notes
 * content is converted into API content with references resolved through a
 * `FileTaskAuthorizer` scoped to the task's notes, so any referenced files are
 * only included when the actor is allowed to access them.
 */
export async function getApiTaskNotes(
    context: ApiServiceBotActionContext,
    taskId: TaskId,
    {consistency}: {consistency: "StrongWithinCache"},
): Promise<{spaceId: SpaceId; notes: ApiTaskNotesResponse}> {
    const {spaceId, version, content} = await getTaskNotesContentWithCustomReferences(
        context,
        taskId,
        async (context, spaceId, task) =>
            await intoApiContentWithReferences(context, {
                spaceId,
                fileAuthorizer: FileTaskAuthorizer.bind({type: "TaskNotes", taskId}),
                content: task.notesContent,
                contentKeyEncoder: new ApiContentKeyEncoder({
                    entityId: `Task:${taskId}`,
                    version: task.notesVersion,
                }),
            }),
        {consistency},
    );

    return {
        notes: {
            version,
            content,
        },
        spaceId,
    };
}
