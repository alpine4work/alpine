import {TaskClientStoreTaskEntry} from "~/client/web/tasks/core/task_client_store.js";
import {ErrorCode} from "~/shared/error/error_code.js";

/**
 * Should we consider the provided task entry to be a deleted task? It's not as
 * simple as checking `isDeleted()` on `TaskModel`. For unauthorized tasks we need
 * to check the error code (since deleted tasks are unauthorized).
 */
export function isTaskClientStoreTaskEntryDeleted(taskEntry: TaskClientStoreTaskEntry): boolean {
    if (taskEntry.task) return taskEntry.task.isDeleted();

    // We use the `NotFound` error code for deleted tasks.
    return (
        taskEntry.authorizationState?.value.type !== "Authorized" &&
        taskEntry.authorizationState?.value.errorCode === ErrorCode.NotFound
    );
}
