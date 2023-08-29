import {CrdtRegister, createCrdtRegister} from "~/shared/crdt/crdt_register.js";
import {AccountId} from "~/shared/id/types/id_types.js";
import {Schema, SchemaType} from "~/shared/schema/schema.js";
import {TaskPositionSchema} from "~/shared/tasks/task_position.js";

export type TaskAssigneeActivePosition = SchemaType<typeof TaskAssigneeActivePositionSchema>;

export const TaskAssigneeActivePositionSchema = Schema.object({
    accountId: Schema.id<AccountId>(),
    position: TaskPositionSchema,
});

export const TaskAssigneeActivePositionRegister = createCrdtRegister(
    TaskAssigneeActivePositionSchema.nullable(),
);
export type TaskAssigneeActivePositionRegister = CrdtRegister<TaskAssigneeActivePosition | null>;
