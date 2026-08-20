import {ApiClientMock} from "~/server/agents/api/test_helpers/api_client_mock.js";
import {
    ApiTask,
    ApiTaskCollection,
    ApiTaskCollectionColor,
    ApiTaskQueryDefaults,
} from "~/shared/api/specification/types/api_specification_convenience_types.open_source.js";
import {createArrayWithLength} from "~/shared/helpers/array/create_array_with_length.open_source.js";
import {assert} from "~/shared/helpers/control/assert.open_source.js";
import {generateId} from "~/shared/id/id.open_source.js";
import {ApiTaskQueryCursor} from "~/shared/id/types/api_task_query_cursor.open_source.js";
import {SpaceId, TaskCollectionId} from "~/shared/id/types/id_types.open_source.js";

export function mockGetApiTaskCollectionTasks(
    api: ApiClientMock,
    {
        spaceId,
        id = generateId<TaskCollectionId>(),
        name = "Test Task Collection",
        color,
        defaults = {filters: [], sorts: []},
        totalTaskCount,
        limit,
        cursor: actualCursor,
        createTask,
    }: {
        spaceId: SpaceId;
        id?: TaskCollectionId;
        name?: string;
        color?: ApiTaskCollectionColor;
        defaults?: ApiTaskQueryDefaults;
        totalTaskCount: number;
        limit: number;
        cursor?: ApiTaskQueryCursor;
        createTask: (index: number) => ApiTask;
    },
) {
    const cursor =
        typeof actualCursor === "string" ? parseApiTaskQueryCursorMock(actualCursor) : -1;

    assert(Number.isSafeInteger(limit));
    assert(Number.isSafeInteger(totalTaskCount));
    assert(Number.isSafeInteger(cursor));
    assert(limit >= 0);
    assert(totalTaskCount >= 0);
    assert(cursor >= -1);
    assert(cursor < totalTaskCount);

    const nextCursor = cursor + limit;

    const collection: ApiTaskCollection = {
        id,
        name,
        color,
        defaults,
    };

    api.mockGet("/task-collections/{id}/tasks", {
        params: {
            path: {id},
            query: {limit, cursor: actualCursor},
        },
        data: {
            spaceId,
            collection,
            nextCursor:
                nextCursor < totalTaskCount - 1 ? printApiTaskQueryCursorMock(nextCursor) : null,
            tasks: createArrayWithLength(Math.min(limit, totalTaskCount - (cursor + 1)), index => ({
                cursor: printApiTaskQueryCursorMock(cursor + 1 + index),
                task: createTask(cursor + 1 + index),
            })),
        },
    });

    return {collection};
}

export function printApiTaskQueryCursorMock(cursor: number): ApiTaskQueryCursor {
    assert(Number.isInteger(cursor));
    return `mock-cursor-${cursor}` as ApiTaskQueryCursor;
}

function parseApiTaskQueryCursorMock(cursor: ApiTaskQueryCursor): number {
    assert(/^mock-cursor-[0-9]+$/.test(cursor));
    return parseInt(cursor.slice("mock-cursor-".length), 10);
}
