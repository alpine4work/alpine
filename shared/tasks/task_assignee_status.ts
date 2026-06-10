import {CrdtRegister, createCrdtRegister} from "~/shared/crdt/crdt_register.js";
import {Schema, SchemaType} from "~/shared/schema/schema.js";
import {TaskFilterableTime} from "~/shared/tasks/task_filterable_time.js";

/**
 * The task assignee status represents whether an account is actively working on a
 * task or not.
 *
 * `TaskAssigneeStatus` is dependent on `TaskStatus`. If `TaskStatus` is `Closed`
 * then `TaskAssigneeStatus` is always `Inactive`. If a user reopens a closed task
 * then `TaskAssigneeStatus` should be reset to `Inactive`.
 *
 * Also includes the position of the active task in the assignee's active task
 * list. The assignee's active task list is typically shown in reverse order with
 * the newest active tasks shown first.
 */
export type TaskAssigneeStatus = SchemaType<typeof TaskAssigneeStatusSchema>;

export const TaskAssigneeStatusSchema = Schema.union({
    Inactive: Schema.object({
        type: Schema.value("Inactive"),
    }),
    Active: Schema.object({
        type: Schema.value("Active"),
        activatedTime: TaskFilterableTime.schema,
    }),
});

export const TaskAssigneeStatusRegister = createCrdtRegister(TaskAssigneeStatusSchema);
export type TaskAssigneeStatusRegister = CrdtRegister<TaskAssigneeStatus>;
