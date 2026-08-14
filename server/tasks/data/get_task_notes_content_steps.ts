import {Step} from "prosemirror-transform";
import {ServerActionContext} from "~/server/context/server_action_context.js";
import {authorizeTaskAccessAndGetCommentsSummaryAndNotesItems} from "~/server/tasks/data/internal/authorize_task_item_access.js";
import {getTaskNotesContentStepsBetweenValidatedVersionRange} from "~/server/tasks/data/internal/get_task_notes_content_steps_between_validated_version_range.js";
import {FailedPreconditionError, InvalidArgumentError} from "~/shared/error/error.open_source.js";
import {ContentEditorClientId} from "~/shared/id/types/id_types.js";
import {TaskId} from "~/shared/id/types/id_types.open_source.js";

/**
 * Reads the task notes steps applied between `startVersion` (inclusive) and
 * `endVersion` (exclusive).
 *
 * Used by the task notes collaboration durable object to backfill clients (or
 * rebase updates) made against a version older than the durable object's in-memory
 * step history. Requires `View` access to the task. Throws a `DataLossError` if a
 * step in the range hasn't been persisted (e.g. task notes that predate step
 * persistence).
 */
export async function getTaskNotesContentSteps(
    context: ServerActionContext,
    {
        taskId,
        startVersion,
        endVersion,
    }: {
        taskId: TaskId;
        startVersion: number;
        endVersion: number;
    },
): Promise<Array<{step: Step; invertedStep: Step; clientId: ContentEditorClientId}>> {
    if (startVersion < 0) throw new InvalidArgumentError("Start version is less than zero");
    if (startVersion > endVersion)
        throw new InvalidArgumentError("Start version is greater than end version");
    if (startVersion === endVersion)
        throw new InvalidArgumentError("Start version is equal to end version");

    const currentVersion = await authorizeTaskAccessAndGetCommentsSummaryAndNotesItems(
        context,
        taskId,
        "View",
        async ({notesItem}) => notesItem?.version ?? 0,
    );

    if (endVersion > currentVersion)
        throw new FailedPreconditionError(
            "End version is greater than the last version of the task notes",
        );

    return await getTaskNotesContentStepsBetweenValidatedVersionRange(context, {
        taskId,
        startVersion,
        endVersion,
    });
}
