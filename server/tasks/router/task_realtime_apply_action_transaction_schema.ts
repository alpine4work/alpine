import {Schema} from "~/shared/schema/schema.js";
import {TaskActionSchema} from "~/shared/tasks/actions/task_action.js";

export const TaskRealtimeApplyActionTransactionSchema = Schema.object({
    committedTime: Schema.date,
    actions: Schema.array(TaskActionSchema),
});
