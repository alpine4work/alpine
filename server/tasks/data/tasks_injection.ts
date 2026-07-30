import {TasksInjection} from "~/server/context/injection_context_module.js";
import {authorizeTaskAccessIfPossible} from "~/server/tasks/data/authorization/authorize_task_access_if_possible.js";
import {authorizeTaskCollectionAccessIfPossible} from "~/server/tasks/data/authorization/authorize_task_collection_access_if_possible.js";
import {FileTaskAuthorizer} from "~/server/tasks/data/authorization/file_task_authorizer.js";
import {getTaskAccessPolicyForBotScope} from "~/server/tasks/data/get_task_access_policy_for_bot_scope.js";
import {internalGetUpdateOurAccountNameTaskTransactionEntries} from "~/server/tasks/data/internal_get_update_our_account_name_task_transaction_entries.js";
import {indexTaskActionTransactionAssumingItsCommitted} from "~/server/tasks/data/task_index.js";

export const tasksInjection: TasksInjection = {
    indexTaskActionTransactionAssumingItsCommitted,
    authorizeTaskAccessIfPossible,
    authorizeTaskCollectionAccessIfPossible,
    internalGetUpdateOurAccountNameTaskTransactionEntries,
    getTaskAccessPolicyForBotScope,
    bindFileTaskAuthorizer: (_context, target) => FileTaskAuthorizer.bind(target),
};
