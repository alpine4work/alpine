import {AccessLevel} from "~/shared/access/access_policy.js";
import {NotFoundError} from "~/shared/error/error.js";
import {errorDisplayMessage} from "~/shared/error/error_display_message.js";
import {ErrorDisplayMessage} from "~/shared/error/types/error_display_message_type.js";
import {TaskCollectionId, TaskId} from "~/shared/id/types/id_types.js";

export const taskCollectionPermissionDeniedErrorDisplayMessageByExpectedAccessLevel: Record<
    AccessLevel,
    ErrorDisplayMessage
> = {
    View: errorDisplayMessage`You aren\u2019t allowed to access this collection. Ask someone with access to share it with you.`,
    Comment: errorDisplayMessage`You aren\u2019t allowed to see comments on this task. Ask someone who can share a collection the task is in to give you comment access.`,
    Edit: errorDisplayMessage`You aren\u2019t allowed to edit this task. Ask someone who can share a collection the task is in to give you edit access.`,
    Manage: errorDisplayMessage`You aren\u2019t allowed to share this collection. Ask someone who can share the collection to give you share access.`,
};

export const taskPermissionDeniedErrorDisplayMessageByExpectedAccessLevel: Record<
    AccessLevel,
    ErrorDisplayMessage
> = {
    View: errorDisplayMessage`You aren\u2019t allowed to access this task. Ask someone with access to share it with you.`,
    Comment: taskCollectionPermissionDeniedErrorDisplayMessageByExpectedAccessLevel.Comment,
    Edit: taskCollectionPermissionDeniedErrorDisplayMessageByExpectedAccessLevel.Edit,
    Manage: errorDisplayMessage`You aren\u2019t allowed to share this task. Ask someone who can share the task to give you share access.`,
};

// If the client detects this specific error message it will revert any confirmed
// but not persisted task notes steps and try backfilling again.
export const taskNotesBackfillFutureVersionErrorMessage =
    "Tried to backfill a future task notes version";

// TODO(calebmer): Someday we should have a "trash" feature and this error message
// should link the user to the trash and let them possible restore this entity from
// the trash.
export const taskDeletedErrorDisplayMessage = errorDisplayMessage`Task was deleted.`;

// TODO(calebmer): Someday we should have a "trash" feature and this error message
// should link the user to the trash and let them possible restore this entity from
// the trash.
export const taskCollectionDeletedErrorDisplayMessage = errorDisplayMessage`Task collection was deleted.`;

export function createTaskCollectionNotFoundError(collectionId: TaskCollectionId) {
    return new NotFoundError("Task collection not found", {
        aggregateDedupeKey: collectionId,
        displayMessage: errorDisplayMessage`This task collection doesn\u2019t exist. Try searching \u201Cmy task collections\u201D to see collections you\u2019ve created.`,
    });
}

export function createTaskNotFoundError(taskId: string | undefined) {
    return new NotFoundError("Task not found", {
        aggregateDedupeKey: taskId,
        displayMessage: errorDisplayMessage`This task doesn\u2019t exist. Try searching \u201Cmy tasks\u201D to see tasks you\u2019ve created.`,
    });
}

export function createTaskCommentNotFoundError(taskId: TaskId, messageIndex: number) {
    return new NotFoundError("Task comment not found", {
        aggregateDedupeKey: `${taskId}-${messageIndex}`,
        displayMessage: errorDisplayMessage`This comment doesn\u2019t exist. Try searching \u201Cmy task comments\u201D to see your recent task comments.`,
    });
}
