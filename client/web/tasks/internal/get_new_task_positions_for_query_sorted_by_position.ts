import {TaskClientQuery} from "~/client/web/tasks/core/task_client_query.js";
import {isReadonlyArray} from "~/shared/helpers/array/is_readonly_array.js";
import {
    HybridLogicalTime,
    compareHybridLogicalTimes,
} from "~/shared/helpers/clock/hybrid_logical_clock.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {OrderKey, generateOrderKeysBetween, isOrderKey} from "~/shared/helpers/sort/order_key.js";
import {TaskId} from "~/shared/id/types/id_types.js";
import {getTaskQueryNormalizedSortCursorForModel} from "~/shared/tasks/model/get_task_query_normalized_sort_cursor_for_model.js";
import {TaskPosition} from "~/shared/tasks/task_position.js";
import {getTaskQuerySortCursorTaskId} from "~/shared/tasks/task_query_sort_cursor.js";

/**
 * Get the `TaskPosition` for a new task in a query that's sorted by
 * `TaskPosition`s (e.g. the my tasks view or child task query).
 *
 * This function is to help implement the `getMoveTasksToQueryActions()` prop of
 * `useTaskGridViewVirtualizedList()`.
 */
export function getNewTaskPositionForQuerySortedByPosition(
    time: HybridLogicalTime,
    query: TaskClientQuery,
    position:
        | {type: "Start"}
        | {type: "End"}
        | {type: "Above"; taskId: TaskId}
        | {type: "Below"; taskId: TaskId},
): TaskPosition {
    const {orderTime, orderKeys} = getNewTaskPositionsForQuerySortedByPosition(
        time,
        query,
        position,
        1,
    );
    return {orderTime, orderKey: orderKeys[0]!};
}

/**
 * Get the `TaskPosition`s for new tasks in a query that's sorted by
 * `TaskPosition`s (e.g. the my tasks view or child task query).
 *
 * This function is to help implement the `getMoveTasksToQueryActions()` prop of
 * `useTaskGridViewVirtualizedList()`.
 */
export function getNewTaskPositionsForQuerySortedByPosition(
    time: HybridLogicalTime,
    query: TaskClientQuery,
    position:
        | {type: "Start"}
        | {type: "End"}
        | {type: "Above"; taskId: TaskId}
        | {type: "Below"; taskId: TaskId},
    count: number,
): {
    readonly orderTime: HybridLogicalTime;
    readonly orderKeys: ReadonlyArray<OrderKey>;
} {
    assert(query.sorts.length > 0);
    const firstQuerySort = query.sorts[0]!;
    assert(
        firstQuerySort.type === "ParentPosition" ||
            firstQuerySort.type === "CollectionPosition" ||
            firstQuerySort.type === "AssigneePosition",
        "Query is not sorted by `TaskPosition`",
    );

    switch (position.type) {
        case "Start": {
            if (firstQuerySort.direction === "Descending") {
                return {
                    orderTime: time,
                    orderKeys: generateOrderKeysBetween(null, null, count).reverse(),
                };
            }

            const firstCursor = query.taskOrderStore.getSnapshot().begin.key;

            if (!firstCursor) {
                return {
                    orderTime: time,
                    orderKeys: generateOrderKeysBetween(null, null, count),
                };
            }

            const firstTaskId = getTaskQuerySortCursorTaskId(firstCursor);

            return getNewTaskPositionsForQuerySortedByPosition(
                time,
                query,
                {type: "Above", taskId: firstTaskId},
                count,
            );
        }
        case "End": {
            if (firstQuerySort.direction === "Ascending") {
                return {
                    orderTime: time,
                    orderKeys: generateOrderKeysBetween(null, null, count),
                };
            }

            const lastCursor = query.taskOrderStore.getSnapshot().end.key;

            if (!lastCursor) {
                return {
                    orderTime: time,
                    orderKeys: generateOrderKeysBetween(null, null, count).reverse(),
                };
            }

            const lastTaskId = getTaskQuerySortCursorTaskId(lastCursor);

            return getNewTaskPositionsForQuerySortedByPosition(
                time,
                query,
                {type: "Below", taskId: lastTaskId},
                count,
            );
        }
        case "Above":
        case "Below": {
            const task1 = query.getLoadedTaskSnapshot(position.taskId);

            const cursor1 = getTaskQueryNormalizedSortCursorForModel(query.sorts, task1);

            const cursor2 =
                position.type === "Above"
                    ? query.taskOrderStore.getSnapshot().lt(cursor1).key
                    : query.taskOrderStore.getSnapshot().gt(cursor1).key;

            const cursor1PositionValue = cursor1[0]!;
            assert(isReadonlyArray(cursor1PositionValue));

            const cursor1PositionOrderTimeTime = cursor1PositionValue[0];
            assert(typeof cursor1PositionOrderTimeTime === "number");

            const cursor1PositionOrderTimeTicks = cursor1PositionValue[1];
            assert(typeof cursor1PositionOrderTimeTicks === "number");

            const cursor1PositionOrderKey = cursor1PositionValue[2];
            assert(
                typeof cursor1PositionOrderKey === "string" && isOrderKey(cursor1PositionOrderKey),
            );

            const position1: TaskPosition = {
                orderTime: [cursor1PositionOrderTimeTime, cursor1PositionOrderTimeTicks],
                orderKey: cursor1PositionOrderKey,
            };

            let position2: TaskPosition | null = null;
            if (cursor2) {
                const cursor2PositionValue = cursor2[0]!;
                assert(isReadonlyArray(cursor2PositionValue));

                const cursor2PositionOrderTimeTime = cursor2PositionValue[0];
                assert(typeof cursor2PositionOrderTimeTime === "number");

                const cursor2PositionOrderTimeTicks = cursor2PositionValue[1];
                assert(typeof cursor2PositionOrderTimeTicks === "number");

                const cursor2PositionOrderKey = cursor2PositionValue[2];
                assert(
                    typeof cursor2PositionOrderKey === "string" &&
                        isOrderKey(cursor2PositionOrderKey),
                );

                position2 = {
                    orderTime: [cursor2PositionOrderTimeTime, cursor2PositionOrderTimeTicks],
                    orderKey: cursor2PositionOrderKey,
                };
            }

            const orderKey2 =
                position2 &&
                compareHybridLogicalTimes(position1.orderTime, position2.orderTime) === 0
                    ? position2.orderKey
                    : null;

            const orderKeys =
                (position.type === "Above" && firstQuerySort.direction === "Ascending") ||
                (position.type === "Below" && firstQuerySort.direction === "Descending")
                    ? generateOrderKeysBetween(orderKey2, position1.orderKey, count)
                    : generateOrderKeysBetween(position1.orderKey, orderKey2, count);

            return {
                orderTime: position1.orderTime,
                orderKeys:
                    firstQuerySort.direction === "Descending" ? orderKeys.reverse() : orderKeys,
            };
        }
        default:
            throw exhaustive(position);
    }
}
