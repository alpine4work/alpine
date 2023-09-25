import {internalUpdateSessionActorAccountNameWithoutUpdatingTasks} from "~/server/accounts/accounts_table.js";
import {ServerSessionActionContextModules} from "~/server/context/server_action_context.js";
import {TaskContextModuleBase} from "~/server/tasks/data/task_context_module.js";
import {internalGetUpdateSessionActorAccountNameTaskTransactionEntries} from "~/server/tasks/data/task_table.js";
import {Context} from "~/shared/context/context.js";

/**
 * Update our currently authenticated session actor account's name.
 *
 * The implementation of this is a little more complicated than just updating
 * the account's name in the account table. The account name is inlined in the
 * OpenSearch task index so we also need to go update it there.
 */
export async function updateSessionActorAccountName(
    context: Context<ServerSessionActionContextModules & {tasks: TaskContextModuleBase}>,
    name: string,
) {
    await internalUpdateSessionActorAccountNameWithoutUpdatingTasks(context, name, {
        getTaskTransactionEntries: internalGetUpdateSessionActorAccountNameTaskTransactionEntries,
    });
}
