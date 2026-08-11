import {CrdtRegister, createCrdtRegister} from "~/shared/crdt/crdt_register.js";
import {createEnumIntegerMapping} from "~/shared/helpers/string/create_enum_integer_mapping.js";
import {Schema} from "~/shared/schema/schema.js";

export type TaskPriority = "Low" | "Medium" | "High" | "Urgent";

export const TaskPrioritySchema = Schema.enum<TaskPriority>(["Low", "Medium", "High", "Urgent"]);

export const TaskPriorityRegister = createCrdtRegister(TaskPrioritySchema.nullable());
export type TaskPriorityRegister = CrdtRegister<TaskPriority | null>;

// Leave room between enum values for more enum values to be inserted in the
// future. We may add other priorities in the future like "kind of low" or "super
// urgent". If we do we don't yet know how we'll want these priorities to be
// ordered. So to start we take the max value for a byte (127) and divide by 5 so
// we can distribute our priorities with room at all positions to add new
// priorities.
export const TaskPriorityIntegerMapping = createEnumIntegerMapping({
    Low: 25,
    Medium: 50,
    High: 75,
    Urgent: 100,
});
