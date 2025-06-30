import {internalUpdateOurAccountName} from "~/server/accounts/accounts_table.js";
import {ServerSessionActionContextModules} from "~/server/context/server_action_context.js";
import {getOurAccountSpaceIds} from "~/server/spaces/spaces_table.js";
import {TaskContextModuleBase} from "~/server/tasks/data/task_context_module.js";
import {internalGetUpdateOurAccountNameTaskTransactionEntries} from "~/server/tasks/data/task_table.js";
import {AccountModelWithoutSpace} from "~/shared/accounts/account_model_without_space.js";
import {Context} from "~/shared/context/context.js";

/**
 * Update our currently authenticated session actor account's name.
 *
 * Returns an `AccountModelWithoutSpace` with the new name.
 *
 * The implementation of this is a little more complicated than just updating
 * the account's name in the account table. The account name is inlined in the
 * OpenSearch task index so we also need to go update it there.
 */
export async function updateOurAccountName(
    context: Context<ServerSessionActionContextModules & {tasks: TaskContextModuleBase}>,
    name: string,
): Promise<AccountModelWithoutSpace> {
    const account = await internalUpdateOurAccountName(context, name, {
        getOurAccountSpaceIds,
        getTaskTransactionEntries: internalGetUpdateOurAccountNameTaskTransactionEntries,
    });

    return account;
}
