import {createCrdtRegister} from "~/shared/crdt/crdt_register.js";
import {Schema} from "~/shared/schema/schema.js";

export type TaskPriority = "Low" | "Medium" | "High" | "Urgent";

export const TaskPrioritySchema = Schema.enum<TaskPriority>(["Low", "Medium", "High", "Urgent"]);

export const TaskPriorityRegister = createCrdtRegister(TaskPrioritySchema);
