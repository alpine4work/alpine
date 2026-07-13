import {ApiServiceBotActionContext} from "~/server/api/internal/shared/api_service_context.js";
import {
    ApiTaskMoveInScope,
    ApiTaskPreparedMoves,
    prepareApiTaskMovesInScope,
} from "~/server/api/internal/tasks/internal/prepare_api_task_moves_in_scope.js";
import {errorDisplayMessage} from "~/shared/error/error_display_message.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {SpaceId, TaskId} from "~/shared/id/types/id_types.js";
import {TaskQueryNormalizedFilters} from "~/shared/tasks/task_query_normalized_filters.js";
import {TaskQueryNormalizedSort} from "~/shared/tasks/task_query_normalized_sort.js";

/** Resolves the destination positions for a batch's `MoveInParent` patches. */
export async function prepareApiTaskMovesInParent(
    context: ApiServiceBotActionContext,
    spaceId: SpaceId,
    parentTaskId: TaskId,
    moves: ReadonlyArray<ApiTaskMoveInScope>,
): Promise<ApiTaskPreparedMoves> {
    const queryInput = createParentPositionQueryInput(parentTaskId);

    return await prepareApiTaskMovesInScope(context, {
        spaceId,
        moves,
        filters: queryInput.filters,
        sorts: queryInput.sorts,
        getTaskPosition: task => assertExists(task.getParent()).position,
        patchDisplayName: errorDisplayMessage`\`MoveInParent\``,
        cursorDestinationDescription: errorDisplayMessage`a \`TaskQueryCursor\` for the subtasks list of the parent task you\u2019re moving this subtask within`,
    });
}

/** The parent's subtasks sorted by their manual parent position. */
function createParentPositionQueryInput(parentTaskId: TaskId): {
    filters: TaskQueryNormalizedFilters;
    sorts: ReadonlyArray<TaskQueryNormalizedSort>;
} {
    return {
        filters: {
            displayStatusFilter: {ifOpenActive: true, ifOpenInactive: true, ifClosed: true},
            parentFilter: {parentTaskId},
        },
        sorts: [
            {
                type: "ParentPosition",
                direction: "Ascending",
                missing: "Last",
            },
            {
                type: "CreatedTime",
                direction: "Ascending",
                missing: "Last",
            },
        ],
    };
}
