import {ApiServiceBotActionContext} from "~/server/api/internal/shared/api_service_context.js";
import {
    ApiTaskMovePreparedPosition,
    prepareApiTaskMovePatch,
} from "~/server/api/internal/tasks/internal/prepare_api_task_move_patch.js";
import {ApiTaskMoveInCollectionPatch} from "~/shared/api/specification/types/api_specification_convenience_types.js";
import {errorDisplayMessage} from "~/shared/error/error_display_message.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {SpaceId, TaskCollectionId} from "~/shared/id/types/id_types.js";
import {
    TaskQueryNormalizedFilters,
    assertNonEmptyReadonlyMap,
} from "~/shared/tasks/task_query_normalized_filters.js";
import {TaskQueryNormalizedSort} from "~/shared/tasks/task_query_normalized_sort.js";

/** Resolves query data needed to generate actions for `MoveInCollection`. */
export async function prepareApiTaskMoveInCollectionPatch(
    context: ApiServiceBotActionContext,
    spaceId: SpaceId,
    patch: ApiTaskMoveInCollectionPatch,
): Promise<ApiTaskMovePreparedPosition> {
    const {collectionId, position} = patch;
    const queryInput = createCollectionPositionQueryInput(collectionId);

    return await prepareApiTaskMovePatch(context, {
        spaceId,
        position,
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
