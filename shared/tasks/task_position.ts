import {CrdtRegister, createCrdtRegister} from "~/shared/crdt/crdt_register.js";
import {compareHybridLogicalTimes} from "~/shared/helpers/clock/hybrid_logical_clock.js";
import {defaultCompareStrings} from "~/shared/helpers/string/default_compare_strings.open_source.js";
import {HybridLogicalTimeSchema} from "~/shared/schema/helpers/hybrid_logical_time_schema.js";
import {OrderKeySchema} from "~/shared/schema/helpers/order_key_schema.js";
import {Schema, SchemaType} from "~/shared/schema/schema.js";

/**
 * The task position is an object that specifies where in a list of tasks a given
 * task should be placed. Task lists are sorted by:
 * `(task.position.orderTime, task.position.orderKey, task.id)`. `task.id` is
 * included as a tiebreaker, positions do not have to be unique.
 *
 * We include `orderTime` in addition to `orderKey` so that new tasks can be
 * inserted at the end of the list without needing to know what the current last
 * task in the list is. To push a task to a list, your position is
 * `{orderTime: new Date(), orderKey: initialOrderKey}`.
 *
 * Task positions are used for:
 *
 * - Ordering of subtasks
 * - Ordering of tasks in a collection
 * - Ordering of tasks in the "my tasks" screen
 * - Ordering of tasks in the active tasks section
 */
export type TaskPosition = SchemaType<typeof TaskPositionSchema>;

export const TaskPositionSchema = Schema.object({
    orderTime: HybridLogicalTimeSchema,
    orderKey: OrderKeySchema,
});

export const TaskPositionRegister = createCrdtRegister(TaskPositionSchema);
export type TaskPositionRegister = CrdtRegister<TaskPosition>;

/**
 * Compare two task positions.
 *
 * - If <0 then `position1 < position2`
 * - If >0 then `position1 > position2`
 * - If 0 then `position1 = position2`
 */
export function compareTaskPosition(position1: TaskPosition, position2: TaskPosition): number {
    return (
        compareHybridLogicalTimes(position1.orderTime, position2.orderTime) ||
        defaultCompareStrings(position1.orderKey, position2.orderKey)
    );
}
