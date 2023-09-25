import {CrdtRegister, createCrdtRegister} from "~/shared/crdt/crdt_register.js";
import {AccountId} from "~/shared/id/types/id_types.js";
import {Schema, SchemaType} from "~/shared/schema/schema.js";
import {TaskFilterableTime} from "~/shared/tasks/task_filterable_time.js";

/**
 * The task status represents whether a task is open or closed. Additionally
 * when a task is closed we carry data like the account who closed it and the
 * time at which it closed.
 */
export type TaskStatus = SchemaType<typeof TaskStatusSchema>;

export const TaskStatusSchema = Schema.union({
    Open: Schema.object({
        type: Schema.value("Open"),
    }),
    Closed: Schema.object({
        type: Schema.value("Closed"),
        closerId: Schema.id<AccountId>(),
        closedTime: TaskFilterableTime.schema,
    }),
});

export const TaskStatusRegister = createCrdtRegister(TaskStatusSchema);
export type TaskStatusRegister = CrdtRegister<TaskStatus>;
