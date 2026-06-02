import {validateAccessPolicyUpdateForServer} from "~/server/access/validate_access_policy_update_for_server.js";
import {authorizeChatAccess} from "~/server/chat/data/authorize_chat_access.js";
import {ChatTable} from "~/server/chat/data/internal/chat_table.js";
import {createChatModelFromItem} from "~/server/chat/data/internal/create_chat_model_from_item.js";
import {getChatItemForAuthorization} from "~/server/chat/data/internal/get_chat_item_for_authorization.js";
import {
    ServerActionContext,
    ServerSessionActionContext,
} from "~/server/context/server_action_context.js";
import {isBotSpaceAccount} from "~/server/spaces/is_bot_space_account.js";
import {AccessPolicy} from "~/shared/access/access_policy.js";
import {ChatModel} from "~/shared/chat/chat_model.js";
import {FailedPreconditionError} from "~/shared/error/error.js";
import {errorDisplayMessage} from "~/shared/error/error_display_message.js";
import {emptyArray} from "~/shared/helpers/array/empty_array.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {isNonNullable} from "~/shared/helpers/control/is_non_nullable.js";
import {filterIterable} from "~/shared/helpers/iterable/filter_iterable.js";
import {mapIterable} from "~/shared/helpers/iterable/map_iterable.js";
import {ChatId} from "~/shared/id/types/id_types.js";
import {LabelStringSchema} from "~/shared/schema/helpers/label_string_schema.js";

/**
 * Convert a direct chat into a room chat.
 *
 * If you want to get the `ChatModel` after this update we return a `Lazy` and when
 * you call `get()` it builds the chat model.
 */
export function convertDirectChatToRoomChat(
    context: ServerSessionActionContext,
    {
        chatId,
        name,
    }: {
        chatId: ChatId;
        name: string;
    },
): Promise<{get(context: ServerActionContext): Promise<ChatModel>}> {
    LabelStringSchema.validate?.(name, {
        errorDisplayMessagePrefix: errorDisplayMessage`The name you typed`,
    });

    return context.dynamo.retryTransaction(async context => {
        const chatItem = await getChatItemForAuthorization(context, chatId);

        await authorizeChatAccess(context, chatId, "Manage");

        // Noop if the chat is already a room chat. That makes this function idempotent.
        if (chatItem.attributesItem.definition.type !== "Direct") {
            return {get: context => createChatModelFromItem(context, chatItem)};
        }

        if (chatItem.accountItems.length <= 2) {
            throw new FailedPreconditionError(
                "Can only turn direct chats with more than two accounts into room chats",
            );
        }

        const accountIdsForAccessPolicy = await runAllPromises(
            chatItem.accountItems.map(async chatAccountItem => {
                const isBot = await isBotSpaceAccount(
                    context,
                    chatItem.attributesItem.spaceId,
                    chatAccountItem.accountId,
                );

                if (isBot) return;
                return chatAccountItem.accountId;
            }),
        );

        // Everyone in the chat continues to have manage access, except bot accounts which
        // can't be granted access through room access policies.
        const accessPolicy: AccessPolicy = {
            type: "Local",
            accountGrantById: new Map(
                mapIterable(filterIterable(accountIdsForAccessPolicy, isNonNullable), accountId => [
                    accountId,
                    {level: "Manage", generation: 0},
                ]),
            ),
            defaultGrant: null,
            urlGrant: null,
        };

        await validateAccessPolicyUpdateForServer(
            context,
            chatItem.attributesItem.spaceId,
            `Chat:${chatId}`,
            null,
            accessPolicy,
        );

        // All accounts in the direct chat are automatically subscribed to the new chat.
        await runAllPromises(
            chatItem.accountItems.map(({accountId}) =>
                ChatTable.createOrReplaceItem(context, {
                    partitionType: "Chat",
                    sortRangeType: "Subscription",
                    chatId,
                    accountId,
                    isSubscribed: true,
                }),
            ),
        );

        const newAttributesItem = await ChatTable.directlyUpdateItem(context, {
            ...chatItem.attributesItem,
            definition: {
                type: "Room",
                name,
                accessPolicy,
                creatorId: context.actor.getAccountId(),
                hasAddedFeedCandidateEntry: false,
            },
            accountIdsForDirectOneOnOne: null,
        });

        // We don't add a feed entry when you convert from a direct chat to a chat room to
        // the creator's feed since the chat already existed.

        // Reindex the chat with the new name set after our conversion.
        context.jobs.send({
            type: "IndexSearchEntity",
            spaceId: chatItem.attributesItem.spaceId,
            update: {
                type: "Chat",
                chatId,
                updatedTraits: {type: "Some", traits: ["Definition"]},
            },
        });

        // Now that we've converted to a room, delete all the chat account items.
        await runAllPromises(
            chatItem.accountItems.map(chatAccountItem =>
                ChatTable.deleteItemWithKeyIfExists(context, {
                    partitionType: "Chat",
                    sortRangeType: "Account",
                    chatId,
                    accountId: chatAccountItem.accountId,
                }),
            ),
        );

        return {
            get: (context: ServerActionContext) =>
                createChatModelFromItem(context, {
                    attributesItem: newAttributesItem,
                    accountItems: emptyArray,
                }),
        };
    });
}
