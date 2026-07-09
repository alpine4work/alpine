import {ApiTaskMovePreparedPosition} from "~/server/api/internal/tasks/internal/prepare_api_task_move_patch.js";
import {
    HybridLogicalClock,
    HybridLogicalTime,
} from "~/shared/helpers/clock/hybrid_logical_clock.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {
    generateOrderKeyBetween,
    generateOrderKeysBetween,
    initialOrderKey,
} from "~/shared/helpers/sort/order_key.js";
import {TaskId} from "~/shared/id/types/id_types.js";
import {TaskPosition} from "~/shared/tasks/task_position.js";

/**
 * Converts a prepared move into position updates for the moved and tied tasks.
 */
export function createApiTaskMovePositionUpdates(
    taskId: TaskId,
    preparedPosition: ApiTaskMovePreparedPosition,
    clock: HybridLogicalClock,
): Array<{taskId: TaskId; time: HybridLogicalTime; position: TaskPosition}> {
    switch (preparedPosition.type) {
        case "End": {
            const time = clock.now();
            return [{taskId, time, position: {orderTime: time, orderKey: initialOrderKey}}];
        }
        case "Start": {
            const time = clock.now();
            const {firstTaskPosition} = preparedPosition;

            return [
                {
                    taskId,
                    time,
                    position:
                        firstTaskPosition === null
                            ? {orderTime: time, orderKey: initialOrderKey}
                            : {
                                  orderTime: firstTaskPosition.orderTime,
                                  orderKey: generateOrderKeyBetween(
                                      null,
                                      firstTaskPosition.orderKey,
                                  ),
                              },
                },
            ];
        }
        case "Between": {
            const {afterPosition, beforeOrderKey} = preparedPosition;

            return [
                {
                    taskId,
                    time: clock.now(),
                    position: {
                        orderTime: afterPosition.orderTime,
                        orderKey: generateOrderKeyBetween(afterPosition.orderKey, beforeOrderKey),
                    },
                },
            ];
        }
        case "BetweenTied": {
            const {tiedPosition, tiedTasksToUpdate, upperOrderKey} = preparedPosition;
            const orderKeys = generateOrderKeysBetween(
                tiedPosition.orderKey,
                upperOrderKey,
                tiedTasksToUpdate.length + 1,
            );

            return [
                {
                    taskId,
                    time: clock.now(),
                    position: {
                        orderTime: tiedPosition.orderTime,
                        orderKey: assertExists(orderKeys[0]),
                    },
                },
                ...tiedTasksToUpdate.map((tiedTask, tiedIndex) => ({
                    taskId: tiedTask.id,
                    time: clock.now(),
                    position: {
                        orderTime: tiedPosition.orderTime,
                        orderKey: assertExists(orderKeys[tiedIndex + 1]),
                    },
                })),
            ];
        }
        default:
            throw exhaustive(preparedPosition);
    }
}
