import {today} from "@internationalized/date";
import {ApiServiceBotActionContext} from "~/server/api/internal/shared/api_service_context.js";
import {ApiTaskConverter} from "~/server/api/internal/tasks/internal/api_task_converter.js";
import {getTasksInRealtimeQueryLoadedRangeForApi} from "~/server/api/internal/tasks/internal/get_tasks_in_realtime_query_loaded_range_for_api.js";
import {intoApiTaskCollection} from "~/server/api/internal/tasks/internal/into_api_task_collection.js";
import {InternalError} from "~/shared/error/error.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {defaultTimeZone} from "~/shared/helpers/intl/time_zone.js";
import {findMapIterable} from "~/shared/helpers/iterable/find_map_iterable.js";
import {ApiTaskQueryCursor} from "~/shared/id/types/api_task_query_cursor.js";
import {TaskCollectionId} from "~/shared/id/types/id_types.js";
import {
    decodeApiTaskQueryCursor,
    encodeApiTaskQueryCursor,
} from "~/shared/tasks/model/api_task_query_cursor_encoder.js";
import {TaskQueryFilter} from "~/shared/tasks/task_query_filter.js";
import {TaskQuerySort} from "~/shared/tasks/task_query_sort.js";

export async function loadTaskCollectionTasksFromApi(
    context: ApiServiceBotActionContext,
    {
        collectionId,
        limit,
        cursor,
        filters: requestedFilters,
        sorts: requestedSorts,
    }: {
        collectionId: TaskCollectionId;
        limit: number;
        cursor?: ApiTaskQueryCursor;
        filters?: ReadonlyArray<TaskQueryFilter>;
        sorts?: ReadonlyArray<TaskQuerySort>;
    },
) {
    const spaceId = context.actor.getSpaceId();

    const {queries, updateEvent} = await context.tasks.loadQueries(
        spaceId,
        {
            queries: [
                {
                    type: "Collection",
                    limit,
                    collectionId,
                    evaluationContext: {
                        currentAccountId: null,
                        currentDate: today(defaultTimeZone),
                    },
                    filters: requestedFilters,
                    sorts: requestedSorts,
                    expensivelyAfterCursorForApi: cursor,
                },
            ],
            taskIds: [],
            collectionIds: [collectionId],
        },
        {consistency: "StrongWithinCache"},
    );

    const query = assertExists(queries[0]);

    const collection = assertExists(
        findMapIterable(updateEvent.backfillCollections, backfillCollection =>
            backfillCollection.type === "Authorized" &&
            backfillCollection.collection.id === collectionId
                ? backfillCollection.collection
                : undefined,
        ),
    );

    const {loadedState, sorts} = query;

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
            // NOTE(calebmer): I'll be honest, I don't think `endCursor` null should be
            // possible here but I'm not 100% sure. There may be a rare edge case in here where
            // we call `loadQuery()` which then queries OpenSearch which then returns `limit`
            // items but then when we apply the recent action history ALL `limit` tasks move so
            // they're out of the loaded range. But even in that case wouldn't then `endCursor`
            // be the end of the loaded range? Anyway, I'm not sure. ([This is the case I'm
            // thinking of.][1])
            //
            // What I do know is that the API doesn't support expressing "has next page but we
            // don't have a cursor". So throw for now. Let's see if this error actually happens
            // in practice. Another solution idea is to retry the query. If this is the result
            // of an edge case where tasks have recently moved then retrying the query on an
            // exponential backoff until we get data should work? _Shrug_
            //
            // [1]:
            //     https://github.com/cyberworlds/cyberworlds/blob/cb7c5fa0445a72db694b2a2973f8a20eb3fd9d23/server/tasks/realtime/task_realtime_query.ts#L470-L480
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
        content: {
            spaceId,
            collection: intoApiTaskCollection(collection),
            nextCursor,
            tasks: tasks.map(({cursor: taskCursor, task}) => ({
                cursor: encodeApiTaskQueryCursor(sorts, taskCursor),
                task: converter.into(task),
            })),
        },
    };
}
