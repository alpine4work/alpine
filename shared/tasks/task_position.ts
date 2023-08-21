import {CrdtRegister, createCrdtRegister} from "~/shared/crdt/crdt_register.js";
import {HybridLogicalTimeSchema} from "~/shared/schema/helpers/hybrid_logical_time_schema.js";
import {OrderKeySchema} from "~/shared/schema/helpers/order_key_schema.js";
import {Schema, SchemaType} from "~/shared/schema/schema.js";

/**
 * The task position is an object that specifies where in a list of tasks a
 * given task should be placed. Task lists are sorted by:
 * `(task.position.orderTime, task.position.orderKey, task.id)`. `task.id` is
 * included as a tiebreaker, positions do not have to be unique.
 *
 * We include `orderTime` in addition to `orderKey` so that new tasks can be
 * inserted at the end of the list without needing to know what the current
 * last task in the list is. To push a task to a list, your position is
 * `{orderTime: new Date(), orderKey: initialOrderKey}`.
 *
 * Task positions are used for:
 *
 * - Ordering of subtasks
 * - Ordering of tasks in a collection
 * - Ordering of tasks in a notepad
 * - Ordering of tasks in the active tasks section
 */
export type TaskPosition = SchemaType<typeof TaskPositionSchema>;

export const TaskPositionSchema = Schema.object({
    orderTime: HybridLogicalTimeSchema,
    orderKey: OrderKeySchema,
});

export const TaskPositionRegister = createCrdtRegister(TaskPositionSchema);
export type TaskPositionRegister = CrdtRegister<TaskPosition>;
