import {ApiServiceBotActionContext} from "~/server/api/internal/shared/api_service_context.js";
import {ApiTaskConverter} from "~/server/api/internal/tasks/internal/api_task_converter.js";
import {getTasksInRealtimeQueryLoadedRangeForApi} from "~/server/api/internal/tasks/internal/get_tasks_in_realtime_query_loaded_range_for_api.js";
import {InternalError} from "~/shared/error/error.open_source.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.open_source.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.open_source.js";
import {ApiTaskQueryCursor} from "~/shared/id/types/api_task_query_cursor.open_source.js";
import {TaskCollectionId, TaskId} from "~/shared/id/types/id_types.open_source.js";
import {
    decodeApiTaskQueryCursor,
    encodeApiTaskQueryCursor,
} from "~/shared/tasks/model/api_task_query_cursor_encoder.js";
import {TaskRealtimeLoadQueriesInputQuery} from "~/shared/tasks/task_realtime_service_procedure_schemas.js";

type ApiTaskRealtimeLoadQueriesInputQuery = Extract<
    TaskRealtimeLoadQueriesInputQuery,
    {type: "Collection" | "Children"}
>;

export async function loadTasksFromApiQuery(
    context: ApiServiceBotActionContext,
    {
        query: inputQuery,
        taskIds,
        collectionIds,
    }: {
        query: ApiTaskRealtimeLoadQueriesInputQuery;
        taskIds: ReadonlyArray<TaskId>;
        collectionIds: ReadonlyArray<TaskCollectionId>;
    },
) {
    const spaceId = context.actor.getSpaceId();

    const {queries, updateEvent} = await context.tasks.loadQueries(
        spaceId,
        {
            queries: [inputQuery],
            taskIds,
            collectionIds,
        },
        {consistency: "StrongWithinCache"},
    );

    const query = assertExists(queries[0]);
    const {loadedState, sorts} = query;

    const cursor = inputQuery.expensivelyAfterCursorForApi;
    const afterCursor = cursor !== undefined ? decodeApiTaskQueryCursor(sorts, cursor) : null;

    const tasks = getTasksInRealtimeQueryLoadedRangeForApi({
        query,
        updateEvent,
        afterCursor,
    });

    let nextCursor: ApiTaskQueryCursor | null;

    switch (loadedState.type) {
        case "Full": {
            nextCursor = null;
            break;
        }
        case "Partial": {
            // The API cannot represent a partial result without a cursor. This should only be
            // possible if recent task actions move every loaded task outside the requested
            // range.
            if (loadedState.endCursor === null) {
                throw new InternalError("Expected non-null `endCursor` for `Partial` loaded state");
            }

            nextCursor = encodeApiTaskQueryCursor(sorts, loadedState.endCursor);
            break;
        }
        default:
            throw exhaustive(loadedState);
    }

    const converter = new ApiTaskConverter(updateEvent);

    return {
        spaceId,
        updateEvent,
        nextCursor,
        tasks: tasks.map(({cursor: taskCursor, task}) => ({
            cursor: encodeApiTaskQueryCursor(sorts, taskCursor),
            task: converter.into(task),
        })),
    };
}
