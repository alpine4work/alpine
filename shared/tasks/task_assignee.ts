import {CrdtRegister, createCrdtRegister} from "~/shared/crdt/crdt_register.js";
import {Schema, SchemaType} from "~/shared/schema/schema.js";
import {TaskFilterableTime} from "~/shared/tasks/task_filterable_time.js";
import {TaskSortableAccount} from "~/shared/tasks/task_sortable_account.js";

/**
 * The account assigned to a task. Includes not just the task assignee, but
 * also who assigned the task and when. Useful when filtering to see updates on
 * tasks you care about.
 */
export type TaskAssignee = SchemaType<typeof TaskAssigneeSchema>;

export const TaskAssigneeSchema = Schema.object({
    assignee: TaskSortableAccount.schema,
    assigner: TaskSortableAccount.schema,
    assignedTime: TaskFilterableTime.schema,
});

export const TaskAssigneeRegister = createCrdtRegister(TaskAssigneeSchema.nullable());
export type TaskAssigneeRegister = CrdtRegister<TaskAssignee | null>;
