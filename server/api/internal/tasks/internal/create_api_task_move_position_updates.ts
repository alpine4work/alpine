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
    readonly index: number;
    readonly shared: ApiTaskMovePreparedPositionStateShared;
    readonly position: PreparedApiTaskMovePatch;
};

/** State shared by moves with the same destination and position. */
export type ApiTaskMovePreparedPositionStateShared = {
    count: number;
    orderKeys: ReadonlyArray<OrderKey> | null;
    hasUpdatedTiedTasks: boolean;
    readonly movedTaskIdsInScope: ReadonlySet<TaskId>;
};

/**
 * Converts a prepared move into position updates for the moved and tied tasks.
 */
export function createApiTaskMovePositionUpdates(
    taskId: TaskId,
    preparedPositionState: ApiTaskMovePreparedPositionState,
    clock: HybridLogicalClock,
): Array<{taskId: TaskId; time: HybridLogicalTime; position: TaskPosition}> {
    const {shared: sharedState} = preparedPositionState;

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
                sharedState.orderKeys ??= generateOrderKeysBetween(
                    null,
                    firstTaskPosition.orderKey,
                    sharedState.count,
                );

                position = {
                    orderTime: firstTaskPosition.orderTime,
                    orderKey: assertExists(sharedState.orderKeys[preparedPositionState.index]),
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

            sharedState.orderKeys ??= generateOrderKeysBetween(
                afterPosition.orderKey,
                beforeOrderKey,
                sharedState.count,
            );

            return [
                {
                    taskId,
                    time: clock.now(),
                    position: {
                        orderTime: afterPosition.orderTime,
                        orderKey: assertExists(sharedState.orderKeys[preparedPositionState.index]),
                    },
                },
            ];
        }
        case "BetweenTied": {
            const {tiedPosition, upperOrderKey} = preparedPositionState.position;

            // A task in this tied range may be explicitly moved elsewhere in the same batch.
            // Its move update owns its new key, so don't also re-key it here.
            const tiedTasksToUpdate = preparedPositionState.position.tiedTasksToUpdate.filter(
                tiedTask => !sharedState.movedTaskIdsInScope.has(tiedTask.id),
            );

            sharedState.orderKeys ??= generateOrderKeysBetween(
                tiedPosition.orderKey,
                upperOrderKey,
                sharedState.count + tiedTasksToUpdate.length,
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
                        orderKey: assertExists(sharedState.orderKeys[preparedPositionState.index]),
                    },
                },
            ];

            // Emit tied-task updates after the final moved task. This preserves request action
            // order while ensuring the tied range is re-keyed once.
            if (
                preparedPositionState.index === sharedState.count - 1 &&
                !sharedState.hasUpdatedTiedTasks
            ) {
                sharedState.hasUpdatedTiedTasks = true;

                for (let tiedIndex = 0; tiedIndex < tiedTasksToUpdate.length; tiedIndex++) {
                    const tiedTask = tiedTasksToUpdate[tiedIndex]!;

                    const orderKey = assertExists(
                        sharedState.orderKeys[sharedState.count + tiedIndex],
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
