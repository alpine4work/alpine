import {dangerouslyGetBotIfExistsWithoutAuthorization} from "~/server/bots/dangerously_get_bot_without_authorization.js";
import {settingsDefaultKnownBotAccountModelDataById} from "~/server/bots/settings_default_known_bot_account_model_data.js";
import {ServerSessionActionContext} from "~/server/context/server_action_context.js";
import {hasBotOperationAccess} from "~/server/spaces/authorize_bot_operation.js";
import {ChatMessagingDisabledReason} from "~/shared/chat/chat_messaging_disabled_reason.js";
import {ChatModel} from "~/shared/chat/chat_model.js";

/**
 * Computes why messaging should be disabled in a chat because of the bot it's
 * with, from the actor's perspective. Returns `null` when messaging is allowed.
 *
 * Only applies to 1:1 (`Direct`, two account) chats whose other participant is a
 * bot.
 */
export async function getDirectChatBotMessagingDisabledReason(
    context: ServerSessionActionContext,
    chat: ChatModel,
): Promise<ChatMessagingDisabledReason | null> {
    if (chat.definition.type !== "Direct") return null;
    if (chat.definition.accounts.length !== 2) return null;

    const otherAccount = chat.definition.accounts.find(
        account => account.id !== context.actor.getAccountId(),
    );
    if (!otherAccount?.botId) return null;

    // Use `getBotIfExists` so a chat with a since-deleted bot doesn't fail: the bot's
    // account can briefly outlive the bot while the `RemoveBotAccounts` cleanup runs.
    const bot = await dangerouslyGetBotIfExistsWithoutAuthorization(context, otherAccount.botId);
    if (!bot) return null;

    if (
        !(await hasBotOperationAccess(context, otherAccount.botId, {
            type: "Message",
            spaceId: chat.spaceId,
        }))
    ) {
        return {
            message:
                "You can\u2019t message this bot because it\u2019s someone else\u2019s personal bot.",
            link: null,
        };
    }

    const canManage = await hasBotOperationAccess(context, otherAccount.botId, {type: "Manage"});

    // A custom bot the actor manages with no webhook yet can't receive events. Known
    // catalog bots (e.g. ChatGPT) don't use webhooks, so they're always considered set
    // up.
    const isKnownBot = settingsDefaultKnownBotAccountModelDataById.get().has(otherAccount.botId);
    if (canManage && !isKnownBot && !bot.hasWebhookUrl) {
        return {
            message: "This bot isn\u2019t configured to receive events.",
            link: {
                label: "Set up a webhook",
                url: `/settings/${chat.spaceId}/bots/${otherAccount.botId}`,
            },
        };
    }

    return null;
}
