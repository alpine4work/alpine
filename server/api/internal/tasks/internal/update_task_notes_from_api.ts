import {ApiServiceBotActionContext} from "~/server/api/internal/shared/api_service_context.js";
import {intoApiContentWithReferences} from "~/server/api/internal/shared/into_api_content_with_references.js";
import {attachFileToTargetAsBot} from "~/server/files/data/attach_file_to_target_as_bot.js";
import {FileTaskAuthorizer} from "~/server/tasks/data/authorization/file_task_authorizer.js";
import {ApiContentKeyEncoder} from "~/shared/api/content/api_content_key.js";
import {extractFileIdsFromApiContent} from "~/shared/api/content/extract_file_ids_from_api_content.js";
import {fromApiContent} from "~/shared/api/content/from_api_content.js";
import {unknownFileId} from "~/shared/api/content/unknown_file_id.js";
import {ApiTaskNotesResponse} from "~/shared/api/specification/types/api_specification_convenience_types.js";
import {ApiSpecification} from "~/shared/api/specification/types/api_specification_types.js";
import {InvalidArgumentError} from "~/shared/error/error.js";
import {errorDisplayMessage} from "~/shared/error/error_display_message.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {SpaceId, TaskId} from "~/shared/id/types/id_types.js";
import {
    TaskNotesCollaborationUpdateContentWithDiffRequestBodySchema,
    TaskNotesCollaborationUpdateContentWithDiffResponseBodySchema,
} from "~/shared/tasks/task_notes_collaboration_protocol.js";
import {
    TaskNotesContentProsemirrorSchema,
    assertTaskNotesContent,
} from "~/shared/tasks/task_notes_content_schema.js";

type TaskNotesPatch =
    ApiSpecification.paths["/tasks/{id}/notes"]["patch"]["requestBody"]["content"]["application/json"]["notes"];

/**
 * Updates the task notes content via the `TaskNotesCollaborationService` Durable
 * Object and returns the updated notes content.
 */
export async function updateTaskNotesFromApi(
    context: ApiServiceBotActionContext,
    {taskId, patch}: {taskId: TaskId; patch: TaskNotesPatch},
): Promise<{spaceId: SpaceId; notes: ApiTaskNotesResponse}> {
    const requestContent = validateTaskNotesPatchContent(patch);

    // Attach any new files referenced in the updated content before applying the
    // update so there's no race where a reader sees the updated content before its
    // files are attached.
    const fileIds = extractFileIdsFromApiContent(patch.content);
    fileIds.delete(unknownFileId);

    await runAllPromises(
        [...fileIds].map(fileId =>
            attachFileToTargetAsBot(
                context,
                fileId,
                FileTaskAuthorizer.bind({type: "TaskNotes", taskId}),
            ),
        ),
    );

    // Send the update request to the TaskNotesCollaborationService Durable Object as
    // the single source of truth through which all updates are applied.
    const responseBody = TaskNotesCollaborationUpdateContentWithDiffResponseBodySchema.deserialize(
        await context.edge.sendRequestToDurableObject(
            `/api/durable-objects/task-notes/${taskId}/update-content-with-diff`,
            {
                serviceName: "TaskNotesCollaborationService",
                route: "/api/durable-objects/task-notes/:taskId/update-content-with-diff",
                body: TaskNotesCollaborationUpdateContentWithDiffRequestBodySchema.serialize({
                    version: patch.version,
                    content: [...requestContent.children],
                }),
            },
        ),
    );

    if (!responseBody.ok) throw responseBody.error;

    return {
        spaceId: responseBody.spaceId,
        notes: {
            version: responseBody.newVersion,
            content: await intoApiContentWithReferences(
                context,
                responseBody.spaceId,
                FileTaskAuthorizer.bind({type: "TaskNotes", taskId}),
                responseBody.newContent,
                {
                    encoder: new ApiContentKeyEncoder({
                        entityId: `Task:${taskId}`,
                        version: responseBody.newVersion,
                    }),
                },
            ),
        },
    };
}

// Wraps `fromApiContent()` and `assertTaskNotesContent()` in a try/catch block to
// translate any Prosemirror schema validation errors into an
// `InvalidArgumentError` instead of an `InternalError`. This could happen if a
// user submits structurally valid content that contains content types that aren't
// supported by the task notes content schema (e.g. a file float).
function validateTaskNotesPatchContent(patch: TaskNotesPatch) {
    try {
        return assertTaskNotesContent(
            fromApiContent(TaskNotesContentProsemirrorSchema, patch.content),
        );
    } catch (error) {
        // TODO(#public-api): Document the schema rules for task notes content and add a
        // link to the documentation in this error message.
        throw InvalidArgumentError.from(error, "Received invalid task notes content", {
            displayMessage: errorDisplayMessage`The task notes content you provided is invalid.`,
        });
    }
}
