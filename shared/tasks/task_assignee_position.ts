import {CrdtRegister, createCrdtRegister} from "~/shared/crdt/crdt_register.js";
import {AccountId} from "~/shared/id/types/id_types.open_source.js";
import {Schema, SchemaType} from "~/shared/schema/schema.open_source.js";
import {TaskPositionSchema} from "~/shared/tasks/task_position.js";

export type TaskAssigneePosition = SchemaType<typeof TaskAssigneePositionSchema>;

export const TaskAssigneePositionSchema = Schema.object({
    accountId: Schema.id<AccountId>(),
    position: TaskPositionSchema,
});

export const TaskAssigneePositionRegister = createCrdtRegister(
    TaskAssigneePositionSchema.nullable(),
);
export type TaskAssigneePositionRegister = CrdtRegister<TaskAssigneePosition | null>;
