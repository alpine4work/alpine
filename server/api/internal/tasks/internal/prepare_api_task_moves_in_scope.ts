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
 * A task move patch to resolve within a single scope: the tasks of one collection
 * or the subtasks of one parent task. Moves must be provided in patch order.
 */
export type ApiTaskMoveInScope = {
    readonly patchIndex: number;
    readonly taskId: TaskId;
    readonly position: ApiTaskMoveInQueryPatchPosition;
};

/** The resolved position updates to commit for one move patch. */
export type ApiTaskResolvedMove = {
    readonly position: ApiTaskResolvedMovePosition;

    /**
     * Position updates for other tasks that shared a `TaskPosition` with a move
     * destination, to commit directly after this move's action. They're attached to
     * the last move into the tied destination so the tied tasks are re-keyed exactly
     * once and the batch's action order lists every moved task first.
     */
    readonly followingUpdates: ReadonlyArray<{
        readonly taskId: TaskId;
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

/** The resolved moves for one scope. */
export type ApiTaskPreparedMoves = {
    readonly resolvedMoveByPatchIndex: ReadonlyMap<number, ApiTaskResolvedMove>;

    /**
     * The tasks re-keyed by `followingUpdates`. The caller must tick its action clock
     * past these tasks' times so the re-key updates win.
     */
    readonly tasksToUpdate: ReadonlyArray<TaskModel>;
};

/** A decoded `Between` move in the group sharing its `afterCursor` position. */
type ApiTaskBetweenMove = {
    readonly move: ApiTaskMoveInScope;
    readonly afterCursor: TaskQuerySortCursor;
    readonly beforePosition: TaskPosition;
};

/** All the `Between` moves whose `afterCursor` shares one snapshot position. */
type ApiTaskBetweenMoveGroup = {
    readonly position: TaskPosition;
    readonly moves: Array<ApiTaskBetweenMove>;
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
 * order key fits between two equal order keys. We load the whole run of tasks tied
 * with the destination and re-key the ones after each insertion point, preserving
 * their order, to make room. All moves into the same tied run resolve together so
 * the moved tasks and re-keyed tasks interleave into one ordered key sequence.
 */
export async function prepareApiTaskMovesInScope(
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
        moves: ReadonlyArray<ApiTaskMoveInScope>;
        filters: TaskQueryNormalizedFilters;
        sorts: ReadonlyArray<TaskQueryNormalizedSort>;
        getTaskPosition: (task: TaskModel) => TaskPosition;
        patchDisplayName: ErrorDisplayMessage;
        cursorDestinationDescription: ErrorDisplayMessage;
    },
): Promise<ApiTaskPreparedMoves> {
    const resolvedMoveByPatchIndex = new Map<number, ApiTaskResolvedMove>();
    const startMoves: Array<ApiTaskMoveInScope> = [];
    const betweenMoveGroupByPositionKey = new Map<string, ApiTaskBetweenMoveGroup>();

    for (const move of moves) {
        const {position} = move;

        switch (position.type) {
            case "End": {
                // A fresh `orderTime` with the initial `orderKey` sorts below every existing
                // position, so moving to the end never needs query data.
                resolvedMoveByPatchIndex.set(move.patchIndex, {
                    position: {type: "FreshOrderTime"},
                    followingUpdates: [],
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

                const betweenMoveGroup = getOrSetDefaultMapValue(
                    betweenMoveGroupByPositionKey,
                    JSON.stringify([
                        afterCursor.taskPosition.orderTime,
                        afterCursor.taskPosition.orderKey,
                    ]),
                    (): ApiTaskBetweenMoveGroup => ({
                        position: afterCursor.taskPosition,
                        moves: [],
                    }),
                );

                betweenMoveGroup.moves.push({
                    move,
                    afterCursor: afterCursor.cursor,
                    beforePosition: beforeCursor.taskPosition,
                });
                break;
            }
            default:
                throw exhaustive(position);
        }
    }

    // Tasks moved in this scope get their final position from their own move, so don't
    // also re-key them when they sit in a tied destination run.
    const movedTaskIds = new Set(moves.map(move => move.taskId));

    const resolvedGroups = await runAllPromises([
        startMoves.length > 0
            ? resolveApiTaskMovesAtStart(context, {
                  spaceId,
                  filters,
                  sorts,
                  getTaskPosition,
                  startMoves,
              })
            : null,
        ...Array.from(betweenMoveGroupByPositionKey.values(), betweenMoveGroup =>
            resolveApiTaskMovesBetween(context, {
                spaceId,
                filters,
                sorts,
                betweenMoveGroup,
                movedTaskIds,
            }),
        ),
    ]);

    const tasksToUpdate: Array<TaskModel> = [];

    for (const resolvedGroup of resolvedGroups) {
        if (resolvedGroup === null) continue;

        for (const [patchIndex, resolvedMove] of resolvedGroup.resolvedMoveByPatchIndex) {
            resolvedMoveByPatchIndex.set(patchIndex, resolvedMove);
        }

        for (const task of resolvedGroup.tasksToUpdate) tasksToUpdate.push(task);
    }

    return {resolvedMoveByPatchIndex, tasksToUpdate};
}

/**
 * Moves to `Start` insert above the first task in the scope, so load the first
 * task once and generate order keys below its position in patch order.
 */
async function resolveApiTaskMovesAtStart(
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
        startMoves: ReadonlyArray<ApiTaskMoveInScope>;
    },
): Promise<ApiTaskPreparedMoves> {
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
                followingUpdates: [],
            });
        }

        return {resolvedMoveByPatchIndex, tasksToUpdate: []};
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
            followingUpdates: [],
        });
    });

    return {resolvedMoveByPatchIndex, tasksToUpdate: []};
}

/**
 * Resolves every `Between` move whose `afterCursor` shares one snapshot position.
 *
 * The moved tasks all receive order keys above the shared position. When a
 * `beforeCursor` ties the shared position we also load the run of tasks at the
 * tied position and re-key the ones after each insertion point to make room. One
 * balanced key sequence covers the moved and re-keyed tasks together so every
 * insertion point in the run stays correctly ordered.
 */
async function resolveApiTaskMovesBetween(
    context: ApiServiceBotActionContext,
    {
        spaceId,
        filters,
        sorts,
        betweenMoveGroup,
        movedTaskIds,
    }: {
        spaceId: SpaceId;
        filters: TaskQueryNormalizedFilters;
        sorts: ReadonlyArray<TaskQueryNormalizedSort>;
        betweenMoveGroup: ApiTaskBetweenMoveGroup;
        movedTaskIds: ReadonlySet<TaskId>;
    },
): Promise<ApiTaskPreparedMoves> {
    const groupPosition = betweenMoveGroup.position;

    // Moves that share an `afterCursor` insert at the same anchor point in patch
    // order. Sort the anchors in cursor order so the moved tasks interleave with the
    // destination run the way the cursors describe.
    const anchors: Array<{
        cursor: TaskQuerySortCursor;
        moves: Array<ApiTaskBetweenMove>;
    }> = [];

    for (const betweenMove of betweenMoveGroup.moves) {
        const anchor = anchors.find(
            existingAnchor =>
                compareTaskQuerySortCursors(
                    sorts,
                    existingAnchor.cursor,
                    betweenMove.afterCursor,
                ) === 0,
        );

        if (anchor) {
            anchor.moves.push(betweenMove);
        } else {
            anchors.push({cursor: betweenMove.afterCursor, moves: [betweenMove]});
        }
    }

    anchors.sort((anchor1, anchor2) =>
        compareTaskQuerySortCursors(sorts, anchor1.cursor, anchor2.cursor),
    );

    // The generated order keys must stay below every `beforeCursor` order key sharing
    // the group's order time. A `beforeCursor` with a later order time sorts after any
    // key we could generate so it doesn't constrain us.
    let upperOrderKey: OrderKey | null = null;
    let hasTiedBeforeCursor = false;

    for (const betweenMove of betweenMoveGroup.moves) {
        if (compareTaskPosition(groupPosition, betweenMove.beforePosition) === 0) {
            hasTiedBeforeCursor = true;
            continue;
        }

        if (
            !areHybridLogicalTimesEqual(
                groupPosition.orderTime,
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

    // Equal order keys have no space between them, so when a move lands inside a tied
    // run the tasks after the insertion point must be re-keyed. Load the run once for
    // the whole group, starting at the earliest anchor: tied tasks before it keep
    // their position and keep sorting first.
    let tiedTasks: Array<{cursor: TaskQuerySortCursor; task: TaskModel}> = [];

    if (hasTiedBeforeCursor) {
        const tiedRun = await context.tracer.withSpan(
            "Prepare API task moves for tied positions",
            async context =>
                await loadApiTaskMoveTiedRun(context, {
                    spaceId,
                    filters,
                    sorts,
                    tiedPosition: groupPosition,
                    afterCursor: assertExists(anchors[0]).cursor,
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

    // Lay out the final order of every task that receives a new key at the
    // destination: walk the anchors in cursor order and keep tied tasks at or before
    // an anchor ahead of the anchor's moved tasks, since a move inserts directly after
    // its `afterCursor` task.
    const slots: Array<
        {type: "Move"; move: ApiTaskMoveInScope} | {type: "TiedTask"; task: TaskModel}
    > = [];

    let tiedTaskIndex = 0;

    for (const anchor of anchors) {
        while (
            tiedTaskIndex < tiedTasks.length &&
            compareTaskQuerySortCursors(
                sorts,
                assertExists(tiedTasks[tiedTaskIndex]).cursor,
                anchor.cursor,
            ) <= 0
        ) {
            slots.push({type: "TiedTask", task: assertExists(tiedTasks[tiedTaskIndex]).task});
            tiedTaskIndex++;
        }

        for (const {move} of anchor.moves) {
            slots.push({type: "Move", move});
        }
    }

    for (; tiedTaskIndex < tiedTasks.length; tiedTaskIndex++) {
        slots.push({type: "TiedTask", task: assertExists(tiedTasks[tiedTaskIndex]).task});
    }

    const orderKeys = generateOrderKeysBetween(groupPosition.orderKey, upperOrderKey, slots.length);

    const resolvedMoveByPatchIndex = new Map<number, ApiTaskResolvedMove>();
    const followingUpdates: Array<{taskId: TaskId; position: TaskPosition}> = [];

    slots.forEach((slot, index) => {
        const position: TaskPosition = {
            orderTime: groupPosition.orderTime,
            orderKey: assertExists(orderKeys[index]),
        };

        switch (slot.type) {
            case "Move": {
                resolvedMoveByPatchIndex.set(slot.move.patchIndex, {
                    position: {type: "Assigned", position},
                    followingUpdates: [],
                });
                break;
            }
            case "TiedTask": {
                followingUpdates.push({taskId: slot.task.id, position});
                break;
            }
            default:
                throw exhaustive(slot);
        }
    });

    // Commit the tied task re-keys after the group's last move so the batch's action
    // order lists every moved task before the re-keyed tasks.
    const lastMovePatchIndex = betweenMoveGroup.moves
        .map(({move}) => move.patchIndex)
        .reduce((a, b) => Math.max(a, b), 0);

    const lastResolvedMove = assertExists(resolvedMoveByPatchIndex.get(lastMovePatchIndex));
    resolvedMoveByPatchIndex.set(lastMovePatchIndex, {...lastResolvedMove, followingUpdates});

    return {resolvedMoveByPatchIndex, tasksToUpdate: tiedTasks.map(({task}) => task)};
}

/**
 * Loads every task sharing the tied position after `afterCursor`, in query order,
 * plus the next order key at the same order time (the exclusive upper bound for
 * the keys generated to fit the run).
 */
async function loadApiTaskMoveTiedRun(
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
