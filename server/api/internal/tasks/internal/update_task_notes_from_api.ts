import {ApiServiceBotActionContext} from "~/server/api/internal/shared/api_service_context.js";
import {intoApiContentWithReferences} from "~/server/api/internal/shared/into_api_content_with_references.js";
import {attachFileToTargetAsBot} from "~/server/files/data/attach_file_to_target_as_bot.js";
import {FileTaskAuthorizer} from "~/server/tasks/data/authorization/file_task_authorizer.js";
import {ApiContentKeyEncoder} from "~/shared/api/content/closed_source/api_content_key_encoder.js";
import {extractFileIdsFromApiContent} from "~/shared/api/content/closed_source/extract_file_ids_from_api_content.js";
import {fromApiContent} from "~/shared/api/content/closed_source/from_api_content.js";
import {unknownFileId} from "~/shared/api/content/closed_source/unknown_file_id.js";
import {
    ApiTaskNotes,
    ApiTaskNotesPatchRequest,
} from "~/shared/api/specification/types/api_specification_convenience_types.open_source.js";
import {InvalidArgumentError} from "~/shared/error/error.open_source.js";
import {errorDisplayMessage} from "~/shared/error/error_display_message.open_source.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.open_source.js";
import {mapIterable} from "~/shared/helpers/iterable/map_iterable.open_source.js";
import {SpaceId, TaskId} from "~/shared/id/types/id_types.open_source.js";
import {
    TaskNotesCollaborationUpdateContentWithDiffRequestBodySchema,
    TaskNotesCollaborationUpdateContentWithDiffResponseBodySchema,
} from "~/shared/tasks/task_notes_collaboration_protocol.js";
import {
    TaskNotesContentProsemirrorSchema,
    assertTaskNotesContent,
} from "~/shared/tasks/task_notes_content_schema.js";

/**
 * Updates the task notes content via the `TaskNotesCollaborationService` Durable
 * Object and returns the updated notes content.
 */
export async function updateTaskNotesFromApi(
    context: ApiServiceBotActionContext,
    {taskId, patches}: {taskId: TaskId; patches: ReadonlyArray<ApiTaskNotesPatchRequest>},
): Promise<{spaceId: SpaceId; notes: ApiTaskNotes}> {
    if (patches.length !== 1) {
        throw new InvalidArgumentError(
            "A task notes update must contain exactly one SetContent patch",
            {
                displayMessage: errorDisplayMessage`You can only include one \`SetContent\` patch when updating a task\u2019s notes. Try again with at most one \`SetContent\` patch.`,
            },
        );
    }

    const patch = patches[0]!;
    const requestContent = validateTaskNotesPatchContent(patch);

    // Attach any new files referenced in the updated content before applying the
    // update so there's no race where a reader sees the updated content before its
    // files are attached.
    const fileIds = extractFileIdsFromApiContent(patch.content);
    fileIds.delete(unknownFileId);

    await runAllPromises(
        mapIterable(fileIds, fileId =>
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

    const referencesContext = context.dynamo.unexpectStrongReadConsistency();
    return {
        spaceId: responseBody.spaceId,
        notes: {
            version: responseBody.newVersion,
            content: await intoApiContentWithReferences(referencesContext, {
                spaceId: responseBody.spaceId,
                fileAuthorizer: FileTaskAuthorizer.bind({type: "TaskNotes", taskId}),
                content: responseBody.newContent,
                contentKeyEncoder: new ApiContentKeyEncoder({
                    entityId: `Task:${taskId}`,
                    version: responseBody.newVersion,
                }),
            }),
        },
    };
}

// Wraps `fromApiContent()` and `assertTaskNotesContent()` in a try/catch block to
// translate any Prosemirror schema validation errors into an
// `InvalidArgumentError` instead of an `InternalError`. This could happen if a
// user submits structurally valid content that contains content types that aren't
// supported by the task notes content schema (e.g. a file float).
function validateTaskNotesPatchContent(patch: ApiTaskNotesPatchRequest) {
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
