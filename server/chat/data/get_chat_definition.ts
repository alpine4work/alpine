import {authorizeChatAccessIfPossible} from "~/server/chat/data/authorize_chat_access.js";
import {getChatItemIfExistsForAuthorization} from "~/server/chat/data/internal/get_chat_item_for_authorization.js";
import {ServerActionContext} from "~/server/context/server_action_context.js";
import {DynamoCacheReadConsistency} from "~/server/dynamo/core/dynamo_read_consistency.js";
import {AccessPolicy} from "~/shared/access/access_policy.js";
import {createChatNotFoundError} from "~/shared/chat/chat_error_messages.js";
import {unwrapResult} from "~/shared/helpers/control/capture_result.js";
import {Result} from "~/shared/helpers/control/result.js";
import {mapIterable} from "~/shared/helpers/iterable/map_iterable.js";
import {AccountId, ChatId, SpaceId} from "~/shared/id/types/id_types.js";

export type GetChatDefinitionResult = {
    spaceId: SpaceId;
    version: number;
    createdTime: Date;
    definition:
        | {type: "Direct"; accountIds: ReadonlySet<AccountId>}
        | {type: "Room"; name: string; accessPolicy: AccessPolicy; creatorId: AccountId};
    messagesSummary: {
        unknownAuthorMessageCount: number;
        messageCountByAuthorId: ReadonlyMap<AccountId, number>;
    };
};

export async function getChatDefinition(
    context: ServerActionContext,
    chatId: ChatId,
    options?: {consistency?: DynamoCacheReadConsistency},
): Promise<GetChatDefinitionResult> {
    const result = await getChatDefinitionIfExists(context, chatId, options);
    if (!result) throw createChatNotFoundError(chatId);
    return result;
}

export async function getChatDefinitionIfExists(
    context: ServerActionContext,
    chatId: ChatId,
    options?: {consistency?: DynamoCacheReadConsistency},
): Promise<GetChatDefinitionResult | null> {
    const chat = await getChatDefinitionIfPossible(context, chatId, options);
    if (!chat) return null;
    return unwrapResult(chat);
}

export async function getChatDefinitionIfPossible(
    context: ServerActionContext,
    chatId: ChatId,
    {consistency = "Eventual"}: {consistency?: DynamoCacheReadConsistency} = {},
): Promise<Result<GetChatDefinitionResult> | null> {
    const chatItem = await getChatItemIfExistsForAuthorization(context, chatId, {consistency});
    if (!chatItem) return null;

    // This call won't make any database calls since it's after the
    // `getChatItemForAuthorization()` call which will cache the data we need.
    const result = await authorizeChatAccessIfPossible(context, chatId, "View", {consistency});
    if (!result.ok) return result;

    const definition = chatItem.attributesItem.definition;

    return {
        ok: true,
        value: {
            spaceId: chatItem.attributesItem.spaceId,
            version: chatItem.attributesItem.updateLockVersion ?? 0,
            createdTime: chatItem.attributesItem.createdTime,
            definition:
                definition.type === "Direct"
                    ? {
                          type: "Direct",
                          accountIds: new Set(
                              mapIterable(chatItem.accountItems, ({accountId}) => accountId),
                          ),
                      }
                    : {
                          type: "Room",
                          name: definition.name,
                          accessPolicy: definition.accessPolicy,
                          creatorId: definition.creatorId,
                      },
            messagesSummary: chatItem.attributesItem.messagesSummary,
        },
    };
}
