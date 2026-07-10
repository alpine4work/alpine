import {PreparedApiTaskMovePatch} from "~/server/api/internal/tasks/internal/prepare_api_task_move_patch.js";
import {
    HybridLogicalClock,
    HybridLogicalTime,
} from "~/shared/helpers/clock/hybrid_logical_clock.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {
    OrderKey,
    generateOrderKeysBetween,
    initialOrderKey,
} from "~/shared/helpers/sort/order_key.js";
import {TaskId} from "~/shared/id/types/id_types.js";
import {TaskPosition} from "~/shared/tasks/task_position.js";

export type ApiTaskMovePreparedPositionState = {
    readonly count: number;
    readonly index: number;
    orderKeys: ReadonlyArray<OrderKey> | null;
    hasUpdatedTiedTasks: boolean;
    readonly position: PreparedApiTaskMovePatch;
};

/**
 * Converts a prepared move into position updates for the moved and tied tasks.
 */
export function createApiTaskMovePositionUpdates(
    taskId: TaskId,
    preparedPositionState: ApiTaskMovePreparedPositionState,
    clock: HybridLogicalClock,
): Array<{taskId: TaskId; time: HybridLogicalTime; position: TaskPosition}> {
    switch (preparedPositionState.position.type) {
        case "End": {
            const time = clock.now();
            return [{taskId, time, position: {orderTime: time, orderKey: initialOrderKey}}];
        }
        case "Start": {
            const time = clock.now();
            const {firstTaskPosition} = preparedPositionState.position;

            let position: TaskPosition;
            if (firstTaskPosition === null) {
                position = {orderTime: time, orderKey: initialOrderKey};
            } else {
                preparedPositionState.orderKeys ??= generateOrderKeysBetween(
                    null,
                    firstTaskPosition.orderKey,
                    preparedPositionState.count,
                );

                position = {
                    orderTime: firstTaskPosition.orderTime,
                    orderKey: assertExists(
                        preparedPositionState.orderKeys[preparedPositionState.index],
                    ),
                };
            }

            return [
                {
                    taskId,
                    time,
                    position,
                },
            ];
        }
        case "Between": {
            const {afterPosition, beforeOrderKey} = preparedPositionState.position;

            preparedPositionState.orderKeys ??= generateOrderKeysBetween(
                afterPosition.orderKey,
                beforeOrderKey,
                preparedPositionState.count,
            );

            return [
                {
                    taskId,
                    time: clock.now(),
                    position: {
                        orderTime: afterPosition.orderTime,
                        orderKey: assertExists(
                            preparedPositionState.orderKeys[preparedPositionState.index],
                        ),
                    },
                },
            ];
        }
        case "BetweenTied": {
            const {tiedPosition, tiedTasksToUpdate, upperOrderKey} = preparedPositionState.position;

            preparedPositionState.orderKeys ??= generateOrderKeysBetween(
                tiedPosition.orderKey,
                upperOrderKey,
                preparedPositionState.count + tiedTasksToUpdate.length,
            );

            const updates: Array<{
                taskId: TaskId;
                time: HybridLogicalTime;
                position: TaskPosition;
            }> = [
                {
                    taskId,
                    time: clock.now(),
                    position: {
                        orderTime: tiedPosition.orderTime,
                        orderKey: assertExists(
                            preparedPositionState.orderKeys[preparedPositionState.index],
                        ),
                    },
                },
            ];

            if (!preparedPositionState.hasUpdatedTiedTasks) {
                preparedPositionState.hasUpdatedTiedTasks = true;

                for (let tiedIndex = 0; tiedIndex < tiedTasksToUpdate.length; tiedIndex++) {
                    const tiedTask = tiedTasksToUpdate[tiedIndex]!;

                    const orderKey = assertExists(
                        preparedPositionState.orderKeys[preparedPositionState.count + tiedIndex],
                    );

                    updates.push({
                        taskId: tiedTask.id,
                        time: clock.now(),
                        position: {
                            orderTime: tiedPosition.orderTime,
                            orderKey,
                        },
                    });
                }
            }

            return updates;
        }
        default:
            throw exhaustive(preparedPositionState.position);
    }
}
