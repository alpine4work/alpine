import {ApiServiceBotActionContext} from "~/server/api/internal/shared/api_service_context.js";
import {getTasksInRealtimeQueryLoadedRangeForApi} from "~/server/api/internal/tasks/internal/get_tasks_in_realtime_query_loaded_range_for_api.js";
import {ApiTaskMoveInCollectionPatch} from "~/shared/api/specification/types/api_specification_convenience_types.js";
import {InvalidArgumentError} from "~/shared/error/error.js";
import {errorDisplayMessage} from "~/shared/error/error_display_message.js";
import {ErrorDisplayMessage} from "~/shared/error/types/error_display_message_type.js";
import {compareHybridLogicalTimes} from "~/shared/helpers/clock/hybrid_logical_clock.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {isDeepEqual} from "~/shared/helpers/control/is_deep_equal.js";
import {OrderKey, assertOrderKey} from "~/shared/helpers/sort/order_key.js";
import {ApiTaskQueryCursor} from "~/shared/id/types/api_task_query_cursor.js";
import {SpaceId, TaskCollectionId, TaskId} from "~/shared/id/types/id_types.js";
import {decodeApiTaskQueryCursor} from "~/shared/tasks/model/api_task_query_cursor_encoder.js";
import {TaskModel} from "~/shared/tasks/model/task_model.js";
import {TaskPosition} from "~/shared/tasks/task_position.js";
import {
    TaskQueryNormalizedFilters,
    assertNonEmptyReadonlyMap,
} from "~/shared/tasks/task_query_normalized_filters.js";
import {TaskQueryNormalizedSort} from "~/shared/tasks/task_query_normalized_sort.js";
import {
    TaskQuerySortCursor,
    TaskQuerySortCursorValue,
    compareTaskQuerySortCursors,
    getTaskQuerySortCursorTaskId,
} from "~/shared/tasks/task_query_sort_cursor.js";

/**
 * The data an `updateTaskWithoutNotesFromApi()` `MoveInCollection` patch needs
 * that requires loading query data. We resolve this ahead of action generation so
 * that the async loading for the task itself and every move patch can all happen
 * in parallel.
 */
export type ApiTaskMoveInCollectionPreparedPosition =
    // Move the task to the end of the collection. Placing a task at the end never
    // needs query data: a fresh `orderTime` with the initial `orderKey` sorts below
    // every existing position.
    | {type: "End"}
    // Move the task above the first task in the collection (or to the end if the
    // collection has no visible tasks).
    | {type: "Start"; firstTaskPosition: TaskPosition | null}
    // Move the task between two tasks with different positions.
    | {type: "Between"; afterPosition: TaskPosition; beforeOrderKey: OrderKey | null}
    // Move the task between two tasks that share the exact same position. We can't
    // generate an order key between two equal order keys, so we also re-key every task
    // sharing that position after the `afterCursor` task. `tiedTasks` are those tasks
    // in collection order and `upperOrderKey` is the order key of the first task after
    // the shared group when it shares the group's `orderTime` (otherwise null, meaning
    // the end of that `orderTime`).
    | {
          type: "BetweenTied";
          tiedPosition: TaskPosition;
          tiedTasksToUpdate: ReadonlyArray<TaskModel>;
          upperOrderKey: OrderKey | null;
      };

/**
 * Resolves the query data needed to generate task actions for a `MoveInCollection`
 * API patch. See `ApiTaskMoveInCollectionPreparedPosition` for what we resolve for
 * each position type.
 */
export async function prepareApiTaskMoveInCollectionPatch(
    context: ApiServiceBotActionContext,
    spaceId: SpaceId,
    patch: ApiTaskMoveInCollectionPatch,
): Promise<ApiTaskMoveInCollectionPreparedPosition> {
    const {collectionId, position} = patch;

    switch (position.type) {
        case "End": {
            return {type: "End"};
        }
        case "Start": {
            // Load the first task in the collection with manual sorts so we can generate a
            // position above it.
            const queryInput = createCollectionPositionQueryInput(collectionId);

            const {queries, updateEvent} = await context.tasks.loadQueries(
                spaceId,
                {
                    queries: [
                        {
                            type: "Normalized",
                            limit: 1,
                            filters: queryInput.filters,
                            sorts: queryInput.sorts,
                        },
                    ],
                    taskIds: [],
                    collectionIds: [],
                },
                {consistency: "StrongWithinCache"},
            );

            const tasks = getTasksInRealtimeQueryLoadedRangeForApi({
                query: assertExists(queries[0]),
                updateEvent,
                afterCursor: null,
            });

            const firstTask = tasks[0]?.task;

            return {
                type: "Start",
                firstTaskPosition: firstTask
                    ? assertExists(firstTask.getCollectionPosition(collectionId))
                    : null,
            };
        }
        case "Between": {
            const queryInput = createCollectionPositionQueryInput(collectionId);

            const afterCursor = decodeApiTaskMoveInCollectionCursor(
                queryInput.sorts,
                errorDisplayMessage`\`afterCursor\``,
                position.afterCursor,
            );

            const beforeCursor = decodeApiTaskMoveInCollectionCursor(
                queryInput.sorts,
                errorDisplayMessage`\`beforeCursor\``,
                position.beforeCursor,
            );

            if (afterCursor.taskId === beforeCursor.taskId) {
                throw new InvalidArgumentError(
                    "`afterCursor` points to the same task as `beforeCursor`",
                    {
                        displayMessage: errorDisplayMessage`The \`MoveInCollection\` patch \`afterCursor\` is for the same task as \`beforeCursor\`. Try again but with two \`TaskQueryCursor\`s from different tasks.`,
                    },
                );
            }

            const cursorComparison = compareTaskQuerySortCursors(
                queryInput.sorts,
                afterCursor.cursor,
                beforeCursor.cursor,
            );

            if (cursorComparison > 0) {
                throw new InvalidArgumentError("`afterCursor` is positioned after `beforeCursor`", {
                    displayMessage: errorDisplayMessage`The \`MoveInCollection\` patch \`afterCursor\` is positioned after \`beforeCursor\`. Try again but swap the order of \`afterCursor\` and \`beforeCursor\`.`,
                });
            }

            if (cursorComparison < 0) {
                return {
                    type: "Between",
                    afterPosition: afterCursor.collectionPosition,
                    beforeOrderKey:
                        compareHybridLogicalTimes(
                            afterCursor.collectionPosition.orderTime,
                            beforeCursor.collectionPosition.orderTime,
                        ) === 0
                            ? beforeCursor.collectionPosition.orderKey
                            : null,
                };
            }

            return await context.tracer.withSpan(
                "Prepare move task in collection for tied positions",
                async context => {
                    return await prepareApiTaskMoveInCollectionPathForTiedPositions(context, {
                        spaceId,
                        filters: queryInput.filters,
                        sorts: queryInput.sorts,
                        tiedPosition: afterCursor.collectionPosition,
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
 * Two or more tasks can share the exact same position in a collection. We try our
 * best to never get in this state but some edge cases we can't avoid produce
 * shared positions (like task duplication). We can't generate an order key between
 * two equal order keys, so instead we load every task sharing the position after
 * the `afterCursor` task and the caller will re-key them to make room. Order is
 * preserved: the shared group keeps its order, the moved task goes first.
 *
 * We load from `afterCursor` to the first task that has a different position. The
 * collection listing cursor includes created time, so we can anchor the query
 * directly after the `afterCursor` task.
 */
async function prepareApiTaskMoveInCollectionPathForTiedPositions(
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
): Promise<ApiTaskMoveInCollectionPreparedPosition> {
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

            // We've found the first task that's not tied! Return with the tied tasks we need
            // to update and the `OrderKey` we'll use as the upper bound when we fix the task
            // positions.
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

        // If all tasks are tied up until the end of our collection then we need to update
        // all tasks to the end of the collection.
        if (query.loadedState.type === "Full") {
            return {
                type: "BetweenTied",
                tiedPosition,
                tiedTasksToUpdate,
                upperOrderKey: null,
            };
        }

        // We haven't found all the tied tasks. Loop again and load more tasks!
        afterCursor = assertExists(query.loadedState.endCursor);
    }
}

/**
 * The query for a collection's tasks sorted by their manual collection position.
 * Matches the default filters and sorts of a collection listing without defaults
 * (see `loadTaskRealtimeQueries()`) so that moves position tasks the same way the
 * `/task-collections/{id}/tasks` GET listing orders them.
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

/**
 * Decode an `ApiTaskQueryCursor`, wrapping decode failures with an error message
 * that tells the API caller which cursor was invalid.
 */
function decodeApiTaskMoveInCollectionCursor(
    sorts: ReadonlyArray<TaskQueryNormalizedSort>,
    cursorDisplayName: ErrorDisplayMessage,
    apiCursor: ApiTaskQueryCursor,
): {taskId: TaskId; collectionPosition: TaskPosition; cursor: TaskQuerySortCursor} {
    try {
        const cursor = decodeApiTaskQueryCursor(sorts, apiCursor);
        const collectionPositionValue = cursor[0];

        assert(
            Array.isArray(collectionPositionValue) &&
                collectionPositionValue.length === 3 &&
                typeof collectionPositionValue[0] === "number" &&
                typeof collectionPositionValue[1] === "number" &&
                typeof collectionPositionValue[2] === "string",
        );

        return {
            taskId: getTaskQuerySortCursorTaskId(cursor),
            collectionPosition: {
                orderTime: [collectionPositionValue[0], collectionPositionValue[1]],
                orderKey: assertOrderKey(collectionPositionValue[2]),
            },
            cursor,
        };
    } catch (error) {
        throw InvalidArgumentError.from(error, undefined, {
            displayMessage: errorDisplayMessage`Invalid \`MoveInCollection\` patch ${cursorDisplayName}. Try again with a \`TaskQueryCursor\` for a task in the collection you\u2019re moving this task within.`,
        });
    }
}
