import {CrdtRegister, createCrdtRegister} from "~/shared/crdt/crdt_register.js";
import {AccountId} from "~/shared/id/types/id_types.js";
import {Schema, SchemaType} from "~/shared/schema/schema.js";
import {TaskFilterableTime} from "~/shared/tasks/task_filterable_time.js";

/**
 * The account assigned to a task. Includes not just the task assignee, but
 * also who assigned the task and when. Useful when filtering to see updates on
 * tasks you care about.
 */
export type TaskAssignee = SchemaType<typeof TaskAssigneeSchema>;

export const TaskAssigneeSchema = Schema.object({
    assigneeId: Schema.id<AccountId>(),
    assignerId: Schema.id<AccountId>(),
    assignedTime: TaskFilterableTime.schema,
});

export const TaskAssigneeRegister = createCrdtRegister(TaskAssigneeSchema.nullable());
export type TaskAssigneeRegister = CrdtRegister<TaskAssignee | null>;
