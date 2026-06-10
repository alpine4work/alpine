import {authorizeChatAccess} from "~/server/chat/data/authorize_chat_access.js";
import {getChatItemWithSubscriptionsForAuthorization} from "~/server/chat/data/internal/get_chat_item_with_subscriptions_for_authorization.js";
import {ServerSystemActionContext} from "~/server/context/server_action_context.js";
import {DynamoCacheReadConsistency} from "~/server/dynamo/core/dynamo_read_consistency.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {concatIterables} from "~/shared/helpers/iterable/concat_iterables.js";
import {AccountId, ChatId, SpaceId} from "~/shared/id/types/id_types.js";

export type ChatDefinitionForNotificationEvent =
    | {
          readonly type: "Direct";
          readonly accountIds: ReadonlyArray<AccountId>;
      }
    | {
          readonly type: "Room";
          readonly name: string;
          readonly messageAuthorIds: ReadonlyArray<AccountId>;
      };

/**
 * Get accounts subscribed to notifications for the provided `ChatId`.
 */
export async function getChatNotificationSubscribers(
    context: ServerSystemActionContext,
    chatId: ChatId,
    {consistency = "Eventual"}: {consistency?: DynamoCacheReadConsistency} = {},
): Promise<{
    spaceId: SpaceId;
    chatCreatedTime: Date;
    accountIds: ReadonlyArray<AccountId>;
    definition: ChatDefinitionForNotificationEvent;
}> {
    const chatItem = await getChatItemWithSubscriptionsForAuthorization(context, chatId, {
        consistency,
    });

    await authorizeChatAccess(context, chatId, "View", {consistency});

    const {attributesItem} = chatItem;

    switch (attributesItem.definition.type) {
        case "Direct": {
            const accountIds = chatItem.accountItems.map(({accountId}) => accountId);

            return {
                spaceId: attributesItem.spaceId,
                chatCreatedTime: attributesItem.createdTime,
                accountIds,
                definition: {type: "Direct", accountIds},
            };
        }
        case "Room": {
            const accountIds = new Set(
                concatIterables(
                    attributesItem.messagesSummary.messageCountByAuthorId.keys(),
                    attributesItem.messagesSummary.mentionCountByAccountId.keys(),
                ),
            );

            for (const subscriptionItem of chatItem.subscriptionItems) {
                if (subscriptionItem.isSubscribed) {
                    accountIds.add(subscriptionItem.accountId);
                } else {
                    accountIds.delete(subscriptionItem.accountId);
                }
            }

            return {
                spaceId: attributesItem.spaceId,
                chatCreatedTime: attributesItem.createdTime,
                accountIds: Array.from(accountIds),
                definition: {
                    type: "Room",
                    name: attributesItem.definition.name,
                    // Only display accounts that have actually left messages in the chat.
                    messageAuthorIds: Array.from(
                        attributesItem.messagesSummary.messageCountByAuthorId.keys(),
                    ),
                },
            };
        }
        default:
            throw exhaustive(attributesItem.definition);
    }
}
