import {ApiServiceBotActionContext} from "~/server/api/internal/shared/api_service_context.js";
import {getTasksInRealtimeQueryLoadedRangeForApi} from "~/server/api/internal/tasks/internal/get_tasks_in_realtime_query_loaded_range_for_api.js";
import {ApiTaskMoveInQueryPatchPosition} from "~/shared/api/specification/types/api_specification_convenience_types.js";
import {InternalError, InvalidArgumentError} from "~/shared/error/error.js";
import {errorDisplayMessage} from "~/shared/error/error_display_message.js";
import {ErrorDisplayMessage} from "~/shared/error/types/error_display_message_type.js";
import {retryWithExponentialBackoff} from "~/shared/helpers/async/retry_with_exponential_backoff.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {areHybridLogicalTimesEqual} from "~/shared/helpers/clock/hybrid_logical_clock.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {isDeepEqual} from "~/shared/helpers/control/is_deep_equal.js";
import {getOrSetDefaultMapValue} from "~/shared/helpers/map/get_or_set_default_map_value.js";
import {
    OrderKey,
    assertOrderKey,
    generateOrderKeysBetween,
} from "~/shared/helpers/sort/order_key.js";
import {defaultCompareStrings} from "~/shared/helpers/string/default_compare_strings.js";
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

/**
 * A move patch that hasn't been resolved to a destination `TaskPosition` yet,
 * within a single scope: the tasks of one collection or the subtasks of one parent
 * task. Moves must be provided in patch order.
 */
export type ApiTaskUnresolvedMove = {
    readonly patchIndex: number;
    readonly taskId: TaskId;
    readonly position: ApiTaskMoveInQueryPatchPosition;
};

/** The position updates to commit for one resolved move patch. */
export type ApiTaskResolvedMove = {
    readonly position: ApiTaskResolvedMovePosition;

    /**
     * New positions for tasks that were tied with a move destination, to commit
     * directly after this move's action. They're attached to the batch's last move
     * into the tied destination so the tied tasks are re-keyed exactly once and the
     * batch's action order lists every moved task first. The caller must tick its
     * action clock past these tasks' times so the updates win.
     */
    readonly tiedTaskUpdates: ReadonlyArray<{
        readonly task: TaskModel;
        readonly position: TaskPosition;
    }>;
};

export type ApiTaskResolvedMovePosition =
    // The caller assigns `{orderTime: clock.now(), orderKey: initialOrderKey}` when
    // generating the action. A fresh `orderTime` sorts below every existing position
    // and later moves in the same batch sort below earlier ones.
    | {type: "FreshOrderTime"}
    // A position computed from the move destination's query data.
    | {type: "Assigned"; position: TaskPosition};

/** A `Between` move with its cursors decoded, before it's resolved. */
type ApiTaskUnresolvedBetweenMove = {
    readonly move: ApiTaskUnresolvedMove;
    readonly afterCursor: TaskQuerySortCursor;
    readonly afterPosition: TaskPosition;
    readonly beforePosition: TaskPosition;
};

/**
 * Resolves the destination `TaskPosition` for every move patch targeting one
 * scope: a collection's tasks or a parent's subtasks, both manually ordered by a
 * `TaskPosition`.
 *
 * `Between` cursors are a snapshot of the destination tasks' positions from when
 * the caller listed the query, so each move lands relative to the snapshot
 * positions even when the batch moves the destination tasks themselves. Moves to
 * the same destination land in patch order.
 *
 * Moving between two tasks with an equal `TaskPosition` is the tricky case: no
 * order key fits between two equal order keys. We make room by also re-keying the
 * tasks tied with the destination that sort after the insertion point, preserving
 * their order. Since one shared position only has one range of open order keys
 * above it, all the moves after that position must be resolved together so the
 * moved and re-keyed tasks interleave into one ordered key sequence. That's why
 * `Between` moves are grouped by their `afterCursor` position below.
 */
export async function resolveApiTaskMovesInScope(
    context: ApiServiceBotActionContext,
    {
        spaceId,
        moves,
        filters,
        sorts,
        getTaskPosition,
        patchDisplayName,
        cursorDestinationDescription,
    }: {
        spaceId: SpaceId;
        moves: ReadonlyArray<ApiTaskUnresolvedMove>;
        filters: TaskQueryNormalizedFilters;
        sorts: ReadonlyArray<TaskQueryNormalizedSort>;
        getTaskPosition: (task: TaskModel) => TaskPosition;
        patchDisplayName: ErrorDisplayMessage;
        cursorDestinationDescription: ErrorDisplayMessage;
    },
): Promise<ReadonlyMap<number, ApiTaskResolvedMove>> {
    const resolvedMoveByPatchIndex = new Map<number, ApiTaskResolvedMove>();
    const startMoves: Array<ApiTaskUnresolvedMove> = [];
    const betweenMovesByAfterPositionKey = new Map<string, Array<ApiTaskUnresolvedBetweenMove>>();

    for (const move of moves) {
        const {position} = move;

        switch (position.type) {
            case "End": {
                // A fresh `orderTime` with the initial `orderKey` sorts below every existing
                // position, so moving to the end never needs query data.
                resolvedMoveByPatchIndex.set(move.patchIndex, {
                    position: {type: "FreshOrderTime"},
                    tiedTaskUpdates: [],
                });
                break;
            }
            case "Start": {
                startMoves.push(move);
                break;
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
                    throw new InvalidArgumentError(
                        "`afterCursor` is positioned after `beforeCursor`",
                        {
                            displayMessage: errorDisplayMessage`The ${patchDisplayName} patch \`afterCursor\` is positioned after \`beforeCursor\`. Try again but swap the order of \`afterCursor\` and \`beforeCursor\`.`,
                        },
                    );
                }

                const betweenMoves = getOrSetDefaultMapValue(
                    betweenMovesByAfterPositionKey,
                    JSON.stringify([
                        afterCursor.taskPosition.orderTime,
                        afterCursor.taskPosition.orderKey,
                    ]),
                    (): Array<ApiTaskUnresolvedBetweenMove> => [],
                );

                betweenMoves.push({
                    move,
                    afterCursor: afterCursor.cursor,
                    afterPosition: afterCursor.taskPosition,
                    beforePosition: beforeCursor.taskPosition,
                });
                break;
            }
            default:
                throw exhaustive(position);
        }
    }

    // Tasks moved in this scope get their final position from their own move, so don't
    // also re-key them when they were tied with a move destination.
    const movedTaskIds = new Set(moves.map(move => move.taskId));

    const resolvedMoveMaps = await runAllPromises([
        startMoves.length > 0
            ? resolveApiTaskStartMoves(context, {
                  spaceId,
                  filters,
                  sorts,
                  getTaskPosition,
                  startMoves,
              })
            : null,
        ...Array.from(betweenMovesByAfterPositionKey.values(), betweenMoves =>
            resolveApiTaskBetweenMoves(context, {
                spaceId,
                filters,
                sorts,
                betweenMoves,
                movedTaskIds,
            }),
        ),
    ]);

    for (const resolvedMoveMap of resolvedMoveMaps) {
        if (resolvedMoveMap === null) continue;

        for (const [patchIndex, resolvedMove] of resolvedMoveMap) {
            resolvedMoveByPatchIndex.set(patchIndex, resolvedMove);
        }
    }

    return resolvedMoveByPatchIndex;
}

/**
 * Moves to `Start` insert above the first task in the scope, so load the first
 * task once and generate order keys below its position in patch order.
 */
async function resolveApiTaskStartMoves(
    context: ApiServiceBotActionContext,
    {
        spaceId,
        filters,
        sorts,
        getTaskPosition,
        startMoves,
    }: {
        spaceId: SpaceId;
        filters: TaskQueryNormalizedFilters;
        sorts: ReadonlyArray<TaskQueryNormalizedSort>;
        getTaskPosition: (task: TaskModel) => TaskPosition;
        startMoves: ReadonlyArray<ApiTaskUnresolvedMove>;
    },
): Promise<Map<number, ApiTaskResolvedMove>> {
    const firstTaskPosition = await retryWithExponentialBackoff(async retry => {
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

        return tasks[0] ? getTaskPosition(tasks[0].task) : null;
    });

    const resolvedMoveByPatchIndex = new Map<number, ApiTaskResolvedMove>();

    if (firstTaskPosition === null) {
        // With no visible tasks the start is also the end: fresh order times keep the
        // moves in patch order.
        for (const startMove of startMoves) {
            resolvedMoveByPatchIndex.set(startMove.patchIndex, {
                position: {type: "FreshOrderTime"},
                tiedTaskUpdates: [],
            });
        }

        return resolvedMoveByPatchIndex;
    }

    const orderKeys = generateOrderKeysBetween(null, firstTaskPosition.orderKey, startMoves.length);

    startMoves.forEach((startMove, index) => {
        resolvedMoveByPatchIndex.set(startMove.patchIndex, {
            position: {
                type: "Assigned",
                position: {
                    orderTime: firstTaskPosition.orderTime,
                    orderKey: assertExists(orderKeys[index]),
                },
            },
            tiedTaskUpdates: [],
        });
    });

    return resolvedMoveByPatchIndex;
}

/**
 * Resolves every `Between` move whose `afterCursor` shares one snapshot
 * `TaskPosition`. The moved tasks all receive order keys above that shared
 * position and below the next occupied order key.
 *
 * When a `beforeCursor` also has the shared position, the move lands between tied
 * tasks and we must re-key the tied tasks after the insertion point to make room.
 * The moved and re-keyed tasks are laid out in their final relative order and
 * keyed with one balanced sequence.
 *
 * For example: take tied tasks A, B, C, D all at the shared position, one move of
 * X between A and B, and one move of Y between C and D. We load the tied tasks
 * after the earliest `afterCursor` (task A), giving [B, C, D], then lay out the
 * new order [X, B, C, Y, D]. A keeps its order key and everything in the new order
 * receives a fresh key above A's, so the scope reads A, X, B, C, Y, D.
 */
async function resolveApiTaskBetweenMoves(
    context: ApiServiceBotActionContext,
    {
        spaceId,
        filters,
        sorts,
        betweenMoves,
        movedTaskIds,
    }: {
        spaceId: SpaceId;
        filters: TaskQueryNormalizedFilters;
        sorts: ReadonlyArray<TaskQueryNormalizedSort>;
        betweenMoves: ReadonlyArray<ApiTaskUnresolvedBetweenMove>;
        movedTaskIds: ReadonlySet<TaskId>;
    },
): Promise<Map<number, ApiTaskResolvedMove>> {
    // Every move in this group shares its `afterCursor` position.
    const afterPosition = assertExists(betweenMoves[0]).afterPosition;

    // Each move inserts directly after its `afterCursor` task, so resolve the moves in
    // cursor order. Moves that share an `afterCursor` insert at the same place in
    // patch order.
    const sortedBetweenMoves = [...betweenMoves].sort(
        (betweenMove1, betweenMove2) =>
            compareTaskQuerySortCursors(
                sorts,
                betweenMove1.afterCursor,
                betweenMove2.afterCursor,
            ) || betweenMove1.move.patchIndex - betweenMove2.move.patchIndex,
    );

    // The generated order keys must stay below every `beforeCursor` order key sharing
    // the group's order time. A `beforeCursor` with a later order time sorts after any
    // key we could generate so it doesn't constrain us.
    let upperOrderKey: OrderKey | null = null;
    let hasTiedBeforeCursor = false;

    for (const betweenMove of betweenMoves) {
        if (compareTaskPosition(afterPosition, betweenMove.beforePosition) === 0) {
            hasTiedBeforeCursor = true;
            continue;
        }

        if (
            !areHybridLogicalTimesEqual(
                afterPosition.orderTime,
                betweenMove.beforePosition.orderTime,
            )
        ) {
            continue;
        }

        const beforeOrderKey = betweenMove.beforePosition.orderKey;

        if (upperOrderKey === null || defaultCompareStrings(beforeOrderKey, upperOrderKey) < 0) {
            upperOrderKey = beforeOrderKey;
        }
    }

    // When a move lands between tied tasks, the tied tasks after the insertion point
    // must be re-keyed since there's no room between two equal order keys. Load them
    // once for the whole group, starting after the earliest `afterCursor`. Tied tasks
    // at or before the earliest `afterCursor` keep their key and still sort first
    // because every key we generate is above the shared order key.
    let tiedTasks: Array<{cursor: TaskQuerySortCursor; task: TaskModel}> = [];

    if (hasTiedBeforeCursor) {
        const tiedRun = await context.tracer.withSpan(
            "Resolve API task moves between tied positions",
            async context =>
                await loadApiTaskMoveTiedTasks(context, {
                    spaceId,
                    filters,
                    sorts,
                    tiedPosition: afterPosition,
                    afterCursor: assertExists(sortedBetweenMoves[0]).afterCursor,
                }),
        );

        tiedTasks = tiedRun.tiedTasks.filter(({task}) => !movedTaskIds.has(task.id));

        if (
            tiedRun.upperOrderKey !== null &&
            (upperOrderKey === null ||
                defaultCompareStrings(tiedRun.upperOrderKey, upperOrderKey) < 0)
        ) {
            upperOrderKey = tiedRun.upperOrderKey;
        }
    }

    // Lay out the new relative order of every task that receives an order key at the
    // destination. A move inserts directly after its `afterCursor` task, so the tied
    // tasks up to and including that task stay ahead of the moved task. (A move's
    // `afterCursor` task is itself in `tiedTasks` when an earlier move in the group
    // inserts before it.) Tied tasks after the last insertion point follow at the end,
    // preserving their order.
    const newTaskOrder: Array<
        {type: "MovedTask"; move: ApiTaskUnresolvedMove} | {type: "TiedTask"; task: TaskModel}
    > = [];

    let tiedTaskIndex = 0;

    for (const betweenMove of sortedBetweenMoves) {
        while (
            tiedTaskIndex < tiedTasks.length &&
            compareTaskQuerySortCursors(
                sorts,
                assertExists(tiedTasks[tiedTaskIndex]).cursor,
                betweenMove.afterCursor,
            ) <= 0
        ) {
            newTaskOrder.push({
                type: "TiedTask",
                task: assertExists(tiedTasks[tiedTaskIndex]).task,
            });
            tiedTaskIndex++;
        }

        newTaskOrder.push({type: "MovedTask", move: betweenMove.move});
    }

    for (; tiedTaskIndex < tiedTasks.length; tiedTaskIndex++) {
        newTaskOrder.push({type: "TiedTask", task: assertExists(tiedTasks[tiedTaskIndex]).task});
    }

    const orderKeys = generateOrderKeysBetween(
        afterPosition.orderKey,
        upperOrderKey,
        newTaskOrder.length,
    );

    const resolvedMoveByPatchIndex = new Map<number, ApiTaskResolvedMove>();
    const tiedTaskUpdates: Array<{task: TaskModel; position: TaskPosition}> = [];

    newTaskOrder.forEach((newTaskOrderItem, index) => {
        const position: TaskPosition = {
            orderTime: afterPosition.orderTime,
            orderKey: assertExists(orderKeys[index]),
        };

        switch (newTaskOrderItem.type) {
            case "MovedTask": {
                resolvedMoveByPatchIndex.set(newTaskOrderItem.move.patchIndex, {
                    position: {type: "Assigned", position},
                    tiedTaskUpdates: [],
                });
                break;
            }
            case "TiedTask": {
                tiedTaskUpdates.push({task: newTaskOrderItem.task, position});
                break;
            }
            default:
                throw exhaustive(newTaskOrderItem);
        }
    });

    // Commit the tied task updates after the group's last move so the batch's action
    // order lists every moved task before the re-keyed tied tasks.
    const lastMovePatchIndex = Math.max(
        ...betweenMoves.map(betweenMove => betweenMove.move.patchIndex),
    );

    const lastResolvedMove = assertExists(resolvedMoveByPatchIndex.get(lastMovePatchIndex));
    resolvedMoveByPatchIndex.set(lastMovePatchIndex, {...lastResolvedMove, tiedTaskUpdates});

    return resolvedMoveByPatchIndex;
}

/**
 * Loads every task sharing the tied position after `afterCursor`, in query order,
 * plus the next order key at the same order time (the exclusive upper bound for
 * the keys generated to fit the tied tasks).
 */
async function loadApiTaskMoveTiedTasks(
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
): Promise<{
    tiedTasks: Array<{cursor: TaskQuerySortCursor; task: TaskModel}>;
    upperOrderKey: OrderKey | null;
}> {
    const tiedTasks: Array<{cursor: TaskQuerySortCursor; task: TaskModel}> = [];

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
            const actualFirstCursorValue = cursor[0] as TaskQuerySortCursorValue;

            if (!isDeepEqual(actualFirstCursorValue, expectedFirstCursorValue)) {
                return {
                    tiedTasks,
                    upperOrderKey:
                        Array.isArray(actualFirstCursorValue) &&
                        actualFirstCursorValue[0] === expectedFirstCursorValue[0] &&
                        actualFirstCursorValue[1] === expectedFirstCursorValue[1] &&
                        typeof actualFirstCursorValue[2] === "string"
                            ? assertOrderKey(actualFirstCursorValue[2])
                            : null,
                };
            }

            tiedTasks.push({cursor, task});
        }

        if (query.loadedState.type === "Full") {
            return {tiedTasks, upperOrderKey: null};
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
