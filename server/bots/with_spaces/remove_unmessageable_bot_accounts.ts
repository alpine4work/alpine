import {getBotItemForAuthorizationIfExists} from "~/server/bots/internal/get_bot_item_for_authorization.js";
import {ServerAuthenticatedActionContext} from "~/server/context/server_action_context.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.open_source.js";
import {BotId} from "~/shared/id/types/id_types.open_source.js";

/**
 * Removes the account-list entries whose bot can't receive a message: a bot with
 * no webhook has nowhere for us to deliver the message, and a bot that was deleted
 * leaves a dangling account behind while asynchronous account cleanup catches up.
 *
 * Known catalog bots (e.g. ChatGPT) are backed by the agent service, which they
 * reach us through as a webhook like any other bot, so they need no special case
 * here.
 *
 * IMPORTANT: the caller is responsible for hydrating only accounts the actor may
 * view. This only drops accounts that can't be messaged.
 */
export async function removeUnmessageableBotAccounts<Account extends {botId?: BotId}>(
    context: ServerAuthenticatedActionContext,
    accounts: ReadonlyArray<Account>,
): Promise<Array<Account>> {
    const isMessageable = await runAllPromises(
        accounts.map(async account => {
            const {botId} = account;
            if (!botId) return true;

            const botItem = await getBotItemForAuthorizationIfExists(context, botId);
            return Boolean(botItem?.webhook?.url);
        }),
    );

    return accounts.filter((_, index) => isMessageable[index]);
}
