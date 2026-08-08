import {ApiServiceBotActionContext} from "~/server/api/internal/shared/api_service_context.js";
import {
    ApiTaskResolvedMove,
    ApiTaskUnresolvedMove,
    resolveApiTaskMovesInScope,
} from "~/server/api/internal/tasks/internal/resolve_api_task_moves_in_scope.js";
import {errorDisplayMessage} from "~/shared/error/error_display_message.open_source.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.open_source.js";
import {SpaceId, TaskCollectionId} from "~/shared/id/types/id_types.open_source.js";
import {
    TaskQueryNormalizedFilters,
    assertNonEmptyReadonlyMap,
} from "~/shared/tasks/task_query_normalized_filters.js";
import {TaskQueryNormalizedSort} from "~/shared/tasks/task_query_normalized_sort.js";

/**
 * Resolves the destination positions for a batch's `MoveInCollection` patches.
 */
export async function resolveApiTaskMovesInCollection(
    context: ApiServiceBotActionContext,
    spaceId: SpaceId,
    collectionId: TaskCollectionId,
    moves: ReadonlyArray<ApiTaskUnresolvedMove>,
): Promise<ReadonlyMap<number, ApiTaskResolvedMove>> {
    const queryInput = createCollectionPositionQueryInput(collectionId);

    return await resolveApiTaskMovesInScope(context, {
        spaceId,
        moves,
        filters: queryInput.filters,
        sorts: queryInput.sorts,
        getTaskPosition: task => assertExists(task.getCollectionPosition(collectionId)),
        patchDisplayName: errorDisplayMessage`\`MoveInCollection\``,
        cursorDestinationDescription: errorDisplayMessage`a \`TaskQueryCursor\` for a task in the collection you\u2019re moving this task within`,
    });
}

/**
 * The query for a collection's tasks sorted by their manual collection position.
 * Matches the default filters and sorts of a collection listing without defaults
 * (see `loadTaskRealtimeQueries()`).
 */
function createCollectionPositionQueryInput(collectionId: TaskCollectionId): {
    filters: TaskQueryNormalizedFilters;
    sorts: ReadonlyArray<TaskQueryNormalizedSort>;
} {
    return {
        filters: {
            displayStatusFilter: {ifOpenActive: true, ifOpenInactive: true, ifClosed: true},
            collectionsFilter: [assertNonEmptyReadonlyMap(new Map([[collectionId, false]]))],
        },
        sorts: [
            {
                type: "CollectionPosition",
                direction: "Ascending",
                missing: "Last",
                collectionId,
            },
            {
                type: "CreatedTime",
                direction: "Ascending",
                missing: "Last",
            },
        ],
    };
}
