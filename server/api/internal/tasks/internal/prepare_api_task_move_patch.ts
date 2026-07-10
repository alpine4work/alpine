import {ApiServiceBotActionContext} from "~/server/api/internal/shared/api_service_context.js";
import {getTasksInRealtimeQueryLoadedRangeForApi} from "~/server/api/internal/tasks/internal/get_tasks_in_realtime_query_loaded_range_for_api.js";
import {ApiTaskMoveInQueryPatchPosition} from "~/shared/api/specification/types/api_specification_convenience_types.js";
import {InternalError, InvalidArgumentError} from "~/shared/error/error.js";
import {errorDisplayMessage} from "~/shared/error/error_display_message.js";
import {ErrorDisplayMessage} from "~/shared/error/types/error_display_message_type.js";
import {retryWithExponentialBackoff} from "~/shared/helpers/async/retry_with_exponential_backoff.js";
import {compareHybridLogicalTimes} from "~/shared/helpers/clock/hybrid_logical_clock.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {isDeepEqual} from "~/shared/helpers/control/is_deep_equal.js";
import {OrderKey, assertOrderKey} from "~/shared/helpers/sort/order_key.js";
import {ApiTaskQueryCursor} from "~/shared/id/types/api_task_query_cursor.js";
import {SpaceId, TaskId} from "~/shared/id/types/id_types.js";
import {decodeApiTaskQueryCursor} from "~/shared/tasks/model/api_task_query_cursor_encoder.js";
import {TaskModel} from "~/shared/tasks/model/task_model.js";
import {TaskPosition, compareTaskPosition} from "~/shared/tasks/task_position.js";
import {TaskQueryNormalizedFilters} from "~/shared/tasks/task_query_normalized_filters.js";
import {TaskQueryNormalizedSort} from "~/shared/tasks/task_query_normalized_sort.js";
import {
    TaskQuerySortCursor,
    TaskQuerySortCursorValue,
    compareTaskQuerySortCursors,
    getTaskQuerySortCursorTaskId,
} from "~/shared/tasks/task_query_sort_cursor.js";

/** Query data needed to generate task actions for an API task move patch. */
export type PreparedApiTaskMovePatch =
    // A fresh `orderTime` with the initial `orderKey` sorts below every existing
    // position, so moving to the end never needs query data.
    | {type: "End"}
    // Move above the first task (or to the end if there are no visible tasks).
    | {type: "Start"; firstTaskPosition: TaskPosition | null}
    // Move between two tasks with different positions.
    | {type: "Between"; afterPosition: TaskPosition; beforeOrderKey: OrderKey | null}
    // Equal order keys have no space between them, so re-key the tasks sharing the
    // position after the `afterCursor` task to make room.
    | {
          type: "BetweenTied";
          tiedPosition: TaskPosition;
          tiedTasksToUpdate: ReadonlyArray<TaskModel>;
          upperOrderKey: OrderKey | null;
      };

/**
 * Resolves the query data needed to generate task actions for an API task move
 * patch. Collection and parent moves use this with queries scoped to their
 * respective destination.
 */
export async function prepareApiTaskMovePatch(
    context: ApiServiceBotActionContext,
    {
        spaceId,
        position,
        filters,
        sorts,
        getTaskPosition,
        patchDisplayName,
        cursorDestinationDescription,
    }: {
        spaceId: SpaceId;
        position: ApiTaskMoveInQueryPatchPosition;
        filters: TaskQueryNormalizedFilters;
        sorts: ReadonlyArray<TaskQueryNormalizedSort>;
        getTaskPosition: (task: TaskModel) => TaskPosition;
        patchDisplayName: ErrorDisplayMessage;
        cursorDestinationDescription: ErrorDisplayMessage;
    },
): Promise<PreparedApiTaskMovePatch> {
    switch (position.type) {
        case "End": {
            return {type: "End"};
        }
        case "Start": {
            return await retryWithExponentialBackoff(async retry => {
                const {queries, updateEvent} = await context.tasks.loadQueries(
                    spaceId,
                    {
                        queries: [{type: "Normalized", limit: 1, filters, sorts}],
                        taskIds: [],
                        collectionIds: [],
                    },
                    {consistency: "StrongWithinCache"},
                );

                const query = assertExists(queries[0]);

                const tasks = getTasksInRealtimeQueryLoadedRangeForApi({
                    query,
                    updateEvent,
                    afterCursor: null,
                });

                // There's a race condition edge case where you may get less than the `limit` you
                // requested from `loadQueries()`. In this edge case we try calling `loadQueries()`
                // again until we either get back `Full` with `tasks.length === 0` (meaning the
                // query is truly empty) or a task.
                if (query.loadedState.type === "Partial" && tasks.length === 0) {
                    retry(new InternalError("No tasks found in partial loaded state"));
                }

                return {
                    type: "Start",
                    firstTaskPosition: tasks[0] ? getTaskPosition(tasks[0].task) : null,
                };
            });
        }
        case "Between": {
            const afterCursor = decodeApiTaskMoveCursor({
                sorts,
                patchDisplayName,
                cursorDisplayName: errorDisplayMessage`\`afterCursor\``,
                cursorDestinationDescription,
                apiCursor: position.afterCursor,
            });

            const beforeCursor = decodeApiTaskMoveCursor({
                sorts,
                patchDisplayName,
                cursorDisplayName: errorDisplayMessage`\`beforeCursor\``,
                cursorDestinationDescription,
                apiCursor: position.beforeCursor,
            });

            if (afterCursor.taskId === beforeCursor.taskId) {
                throw new InvalidArgumentError(
                    "`afterCursor` points to the same task as `beforeCursor`",
                    {
                        displayMessage: errorDisplayMessage`The ${patchDisplayName} patch \`afterCursor\` is for the same task as \`beforeCursor\`. Try again but with two \`TaskQueryCursor\`s from different tasks.`,
                    },
                );
            }

            const cursorComparison = compareTaskQuerySortCursors(
                sorts,
                afterCursor.cursor,
                beforeCursor.cursor,
            );

            if (cursorComparison > 0) {
                throw new InvalidArgumentError("`afterCursor` is positioned after `beforeCursor`", {
                    displayMessage: errorDisplayMessage`The ${patchDisplayName} patch \`afterCursor\` is positioned after \`beforeCursor\`. Try again but swap the order of \`afterCursor\` and \`beforeCursor\`.`,
                });
            }

            const positionComparison = compareTaskPosition(
                afterCursor.taskPosition,
                beforeCursor.taskPosition,
            );

            if (positionComparison < 0) {
                return {
                    type: "Between",
                    afterPosition: afterCursor.taskPosition,
                    beforeOrderKey:
                        compareHybridLogicalTimes(
                            afterCursor.taskPosition.orderTime,
                            beforeCursor.taskPosition.orderTime,
                        ) === 0
                            ? beforeCursor.taskPosition.orderKey
                            : null,
                };
            }

            return await context.tracer.withSpan(
                "Prepare API task move for tied positions",
                async context => {
                    return await prepareApiTaskMovePatchForTiedPositions(context, {
                        spaceId,
                        filters,
                        sorts,
                        tiedPosition: afterCursor.taskPosition,
                        afterCursor: afterCursor.cursor,
                    });
                },
            );
        }
        default:
            throw exhaustive(position);
    }
}

/**
 * Loads every task sharing the cursor position after `afterCursor`. The caller
 * re-keys those tasks to make room while preserving their order.
 */
async function prepareApiTaskMovePatchForTiedPositions(
    context: ApiServiceBotActionContext,
    {
        spaceId,
        filters,
        sorts,
        tiedPosition,
        afterCursor,
    }: {
        spaceId: SpaceId;
        filters: TaskQueryNormalizedFilters;
        sorts: ReadonlyArray<TaskQueryNormalizedSort>;
        tiedPosition: TaskPosition;
        afterCursor: TaskQuerySortCursor;
    },
): Promise<PreparedApiTaskMovePatch> {
    const tiedTasksToUpdate: Array<TaskModel> = [];

    const expectedFirstCursorValue = [
        tiedPosition.orderTime[0],
        tiedPosition.orderTime[1],
        tiedPosition.orderKey,
    ] as const satisfies TaskQuerySortCursorValue;

    while (true) {
        const {queries, updateEvent} = await context.tasks.loadQueries(
            spaceId,
            {
                queries: [
                    {
                        type: "Normalized",
                        // Small since generally the number of tied tasks should be small.
                        limit: 20,
                        filters,
                        sorts,
                        expensivelyAfterCursor: afterCursor,
                    },
                ],
                taskIds: [],
                collectionIds: [],
            },
            {consistency: "StrongWithinCache"},
        );

        const query = assertExists(queries[0]);

        const tasks = getTasksInRealtimeQueryLoadedRangeForApi({
            query,
            updateEvent,
            afterCursor,
        });

        for (const {cursor, task} of tasks) {
            const actualFirstCursorValue = cursor[0] as typeof expectedFirstCursorValue;

            if (!isDeepEqual(actualFirstCursorValue, expectedFirstCursorValue)) {
                return {
                    type: "BetweenTied",
                    tiedPosition,
                    tiedTasksToUpdate,
                    upperOrderKey:
                        actualFirstCursorValue[0] === expectedFirstCursorValue[0] &&
                        actualFirstCursorValue[1] === expectedFirstCursorValue[1]
                            ? actualFirstCursorValue[2]
                            : null,
                };
            }

            tiedTasksToUpdate.push(task);
        }

        if (query.loadedState.type === "Full") {
            return {
                type: "BetweenTied",
                tiedPosition,
                tiedTasksToUpdate,
                upperOrderKey: null,
            };
        }

        afterCursor = assertExists(query.loadedState.endCursor);
    }
}

/** Decode a move cursor and extract its leading task position sort value. */
function decodeApiTaskMoveCursor({
    sorts,
    patchDisplayName,
    cursorDisplayName,
    cursorDestinationDescription,
    apiCursor,
}: {
    sorts: ReadonlyArray<TaskQueryNormalizedSort>;
    patchDisplayName: ErrorDisplayMessage;
    cursorDisplayName: ErrorDisplayMessage;
    cursorDestinationDescription: ErrorDisplayMessage;
    apiCursor: ApiTaskQueryCursor;
}): {taskId: TaskId; taskPosition: TaskPosition; cursor: TaskQuerySortCursor} {
    try {
        const cursor = decodeApiTaskQueryCursor(sorts, apiCursor);
        const taskPositionValue = cursor[0];

        assert(
            Array.isArray(taskPositionValue) &&
                taskPositionValue.length === 3 &&
                typeof taskPositionValue[0] === "number" &&
                typeof taskPositionValue[1] === "number" &&
                typeof taskPositionValue[2] === "string",
        );

        return {
            taskId: getTaskQuerySortCursorTaskId(cursor),
            taskPosition: {
                orderTime: [taskPositionValue[0], taskPositionValue[1]],
                orderKey: assertOrderKey(taskPositionValue[2]),
            },
            cursor,
        };
    } catch (error) {
        throw InvalidArgumentError.from(error, undefined, {
            displayMessage: errorDisplayMessage`Invalid ${patchDisplayName} patch ${cursorDisplayName}. Try again with ${cursorDestinationDescription}.`,
        });
    }
}
