import {TasksInjection} from "~/server/context/injection_context_module.js";
import {indexTaskActionTransactionAssumingItsCommitted} from "~/server/tasks/data/task_index.js";
import {
    authorizeTaskCollectionAccessIfPossible,
    getTaskAccessPolicyForBotScope,
    internalGetUpdateOurAccountNameTaskTransactionEntries,
} from "~/server/tasks/data/task_table.js";

export const tasksInjection: TasksInjection = {
    indexTaskActionTransactionAssumingItsCommitted,
    authorizeTaskCollectionAccessIfPossible,
    internalGetUpdateOurAccountNameTaskTransactionEntries,
    getTaskAccessPolicyForBotScope,
};
