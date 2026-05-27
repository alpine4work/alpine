import {TasksInjection} from "~/server/context/injection_context_module.js";
import {indexTaskActionTransactionAssumingItsCommitted} from "~/server/tasks/data/task_index.js";
import {
    FileTaskAuthorizer,
    authorizeTaskAccessIfPossible,
    authorizeTaskCollectionAccessIfPossible,
    getTaskAccessPolicyForBotScope,
    internalGetUpdateOurAccountNameTaskTransactionEntries,
} from "~/server/tasks/data/task_table.js";

export const tasksInjection: TasksInjection = {
    indexTaskActionTransactionAssumingItsCommitted,
    authorizeTaskAccessIfPossible,
    authorizeTaskCollectionAccessIfPossible,
    internalGetUpdateOurAccountNameTaskTransactionEntries,
    getTaskAccessPolicyForBotScope,
    bindFileTaskAuthorizer: (_context, target) => FileTaskAuthorizer.bind(target),
};
