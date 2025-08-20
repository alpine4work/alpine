import {AccessLevel} from "~/shared/access/access_policy.js";
import {NotFoundError} from "~/shared/error/error.js";
import {errorDisplayMessage} from "~/shared/error/error_display_message.js";
import {ErrorDisplayMessage} from "~/shared/error/types/error_display_message_type.js";
import {TaskCollectionId, TaskId} from "~/shared/id/types/id_types.js";

export const taskCollectionPermissionDeniedErrorDisplayMessageByExpectedAccessLevel: Record<
    AccessLevel,
    ErrorDisplayMessage
> = {
    View: errorDisplayMessage`You aren’t allowed to access this collection. Ask someone with access to share it with you.`,
    Comment: errorDisplayMessage`You aren’t allowed to see comments on this task. Ask someone who can share a collection the task is in to give you comment access.`,
    Edit: errorDisplayMessage`You aren’t allowed to edit this task. Ask someone who can share a collection the task is in to give you edit access.`,
    Manage: errorDisplayMessage`You aren’t allowed to share this collection. Ask someone who can share the collection to give you share access.`,
};

export const taskPermissionDeniedErrorDisplayMessageByExpectedAccessLevel: Record<
    AccessLevel,
    ErrorDisplayMessage
> = {
    View: errorDisplayMessage`You aren’t allowed to access this task. Ask someone with access to share it with you.`,
    Comment: taskCollectionPermissionDeniedErrorDisplayMessageByExpectedAccessLevel.Comment,
    Edit: taskCollectionPermissionDeniedErrorDisplayMessageByExpectedAccessLevel.Edit,
    Manage: errorDisplayMessage`You aren’t allowed to share this task. Ask someone who can share the task to give you share access.`,
};

export function createTaskCollectionNotFoundError(collectionId: TaskCollectionId) {
    return new NotFoundError("Task collection not found", {
        aggregateDedupeKey: collectionId,
        displayMessage: errorDisplayMessage`This task collection doesn’t exist. Try searching “my task collections” to see collections you’ve created.`,
    });
}

export function createTaskNotFoundError(taskId: TaskId) {
    return new NotFoundError("Task not found", {
        aggregateDedupeKey: taskId,
        displayMessage: errorDisplayMessage`This task doesn’t exist. Try searching “my tasks” to see tasks you’ve created.`,
    });
}
