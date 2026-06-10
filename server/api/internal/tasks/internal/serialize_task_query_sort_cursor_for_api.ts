import {InvalidArgumentError} from "~/shared/error/error.js";
import {decodeBase64, encodeBase64} from "~/shared/helpers/binary/base64.js";
import {isId} from "~/shared/id/id.js";
import {TaskId} from "~/shared/id/types/id_types.js";
import {TaskQuerySortCursor} from "~/shared/tasks/task_query_sort_cursor.js";

/**
 * Encode a TaskQuerySortCursor to a base64 string for use in the API.
 */
export function serializeTaskQuerySortCursorForApi(cursor: TaskQuerySortCursor): string {
    return encodeBase64(new TextEncoder().encode(JSON.stringify(cursor)), "Rfc4648Url");
}

/**
 * Decode a base64 string cursor back to a TaskQuerySortCursor. Throws
 * BadRequestError if the cursor is invalid.
 */
export function deserializeTaskQuerySortCursorForApi(cursorString: string): TaskQuerySortCursor {
    let cursor: TaskQuerySortCursor;
    try {
        cursor = JSON.parse(new TextDecoder().decode(decodeBase64(cursorString, "Rfc4648Url")));
    } catch (error) {
        throw new InvalidArgumentError("Invalid cursor", {cause: error});
    }

    // Basic validation: cursor should be an array
    if (!Array.isArray(cursor) || cursor.length === 0) {
        throw new InvalidArgumentError("Cursor must be a non-empty array");
    }

    const lastElement = cursor[cursor.length - 1] as string;
    if (!isId<TaskId>(lastElement)) {
        throw new InvalidArgumentError("Last element of cursor must be a TaskId");
    }

    return cursor;
}
