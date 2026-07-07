import {AccountId} from "~/shared/id/types/id_types.js";
import {TaskActor} from "~/shared/tasks/task_creator.js";

/**
 * Creates the task actor shape used by API task actions.
 */
export function createApiTaskActor({
    actorId,
    botAccountId,
}: {
    actorId: AccountId | undefined;
    botAccountId: AccountId;
}): TaskActor {
    const accountId = actorId ?? botAccountId;

    return {
        accountId,
        from: accountId !== botAccountId ? {type: "Bot", accountId: botAccountId} : null,
    };
}
