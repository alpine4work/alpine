import {CrdtRegister, createCrdtRegister} from "~/shared/crdt/crdt_register.js";
import {createEnumIntegerMapping} from "~/shared/helpers/string/create_enum_integer_mapping.js";
import {Schema} from "~/shared/schema/schema.js";

export type TaskLayout = "Project";

export const TaskLayoutSchema = Schema.enum<TaskLayout>(["Project"]);

export const TaskLayoutRegister = createCrdtRegister(TaskLayoutSchema.nullable());
export type TaskLayoutRegister = CrdtRegister<TaskLayout | null>;

// Leave room between enum values for more enum values to be inserted in the
// future. We may add other layouts in the future. We do we don't yet know how
// we'll want these layouts to be ordered. So to start we take the max value
// for a byte (127) and divide by 2 so we can distribute our layouts with
// room at all positions to add new layouts.
export const TaskLayoutIntegerMapping = createEnumIntegerMapping({
    Project: 64,
});
