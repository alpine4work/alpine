import {authorizeChatAccess} from "~/server/chat/data/authorize_chat_access.js";
import {getChatItemForAuthorization} from "~/server/chat/data/internal/get_chat_item_for_authorization.js";
import {ServerActionContext} from "~/server/context/server_action_context.js";
import {DynamoCacheReadConsistency} from "~/server/dynamo/core/dynamo_read_consistency.js";
import {AccountId, ChatId, SpaceId} from "~/shared/id/types/id_types.js";

/**
 * Get the provided `AccountId` members of a chat.
 */
export async function getChatAccountIds(
    context: ServerActionContext,
    chatId: ChatId,
    {consistency = "Eventual"}: {consistency?: DynamoCacheReadConsistency} = {},
): Promise<{
    createdTime: Date;
    spaceId: SpaceId;
    hasMessages: boolean;
    accountIds: ReadonlyArray<AccountId>;
}> {
    const chatItem = await getChatItemForAuthorization(context, chatId, {consistency});

    // This call won't make any database calls since it's after the
    // `getChatItemForAuthorization()` call which will cache the data we need.
    await authorizeChatAccess(context, chatId, {consistency});

    return {
        createdTime: chatItem.attributesItem.createdTime,
        spaceId: chatItem.attributesItem.spaceId,
        hasMessages: chatItem.attributesItem.messagesSummary.messageCount > 0,
        accountIds: chatItem.accountItems.map(({accountId}) => accountId),
    };
}
