import {validateAccessPolicyUpdateForServer} from "~/server/access/validate_access_policy_update_for_server.js";
import {authorizeChatAccessAndReturnItem} from "~/server/chat/data/internal/authorize_chat_access_and_return_item.js";
import {ChatTable} from "~/server/chat/data/internal/chat_table.js";
import {createChatModelFromItem} from "~/server/chat/data/internal/create_chat_model_from_item.js";
import {
    ServerActionContext,
    ServerSessionActionContext,
} from "~/server/context/server_action_context.js";
import {addFeedCandidateEntry} from "~/server/feed/feed_actions.js";
import {AccessPolicy} from "~/shared/access/access_policy.js";
import {ShareNotification} from "~/shared/access/share_notification.js";
import {ChatModel} from "~/shared/chat/chat_model.js";
import {FailedPreconditionError} from "~/shared/error/error.js";
import {emptyArray} from "~/shared/helpers/array/empty_array.js";
import {generateId} from "~/shared/id/id.js";
import {ChatId} from "~/shared/id/types/id_types.js";

/**
 * Updates the access policy for a room chat.
 *
 * If you want to get the `ChatModel` after this update we return a `Lazy` and
 * when you call `get()` it builds the chat model.
 */
export async function updateRoomChatAccessPolicy(
    context: ServerSessionActionContext,
    {
        chatId,
        accessPolicy,
        notification,
    }: {
        chatId: ChatId;
        accessPolicy: AccessPolicy;
        notification: ShareNotification | null;
    },
): Promise<{get(context: ServerActionContext): Promise<ChatModel>}> {
    const currentTime = new Date();

    const {spaceId, creatorId, shouldAddFeedCandidateEntry, getChatModel} =
        await context.dynamo.retryTransaction(async context => {
            const attributesItem = await authorizeChatAccessAndReturnItem(
                context,
                chatId,
                "Manage",
            );

            if (attributesItem.definition.type !== "Room") {
                throw new FailedPreconditionError(
                    "Can only update a room chat\u2019s access policy",
                );
            }

            const {creatorId} = attributesItem.definition;

            const oldHasAddedFeedCandidateEntry =
                attributesItem.definition.hasAddedFeedCandidateEntry;
            const newHasAddedFeedCandidateEntry =
                oldHasAddedFeedCandidateEntry || !!accessPolicy.defaultGrant;

            await validateAccessPolicyUpdateForServer(
                context,
                attributesItem.spaceId,
                attributesItem.definition.accessPolicy,
                accessPolicy,
            );

            const newAttributesItem = await ChatTable.directlyUpdateItem(context, {
                ...attributesItem,
                definition: {
                    ...attributesItem.definition,
                    accessPolicy,
                    hasAddedFeedCandidateEntry: newHasAddedFeedCandidateEntry,
                },
            });

            return {
                spaceId: attributesItem.spaceId,
                creatorId,
                shouldAddFeedCandidateEntry:
                    newHasAddedFeedCandidateEntry && !oldHasAddedFeedCandidateEntry,
                getChatModel: (context: ServerActionContext) =>
                    createChatModelFromItem(context, {
                        attributesItem: newAttributesItem,
                        accountItems: emptyArray,
                    }),
            };
        });

    if (shouldAddFeedCandidateEntry) {
        context.process.waitUntil(async () => {
            await addFeedCandidateEntry(context, spaceId, {
                type: "RoomChat",
                chatId,
                sharedTime: currentTime,
                sharerId: context.actor.getAccountId(),
                creatorId,
                event: "SharedWithAccessPolicyDefaultGrant",
            });
        });
    }

    // Reindex the chat with the chat's new access policy. Will need to reindex all
    // messages in the chat.
    context.jobs.send({
        type: "IndexSearchEntity",
        spaceId,
        update: {
            type: "Chat",
            chatId,
            updatedTraits: {type: "Some", traits: ["Definition"]},
        },
    });

    if (notification) {
        context.jobs.send({
            type: "SendShareNotification",
            jobId: generateId(),
            spaceId,
            actorAccountId: context.actor.getAccountId(),
            entityId: `Chat:${chatId}`,
            notification,
        });
    }

    return {get: getChatModel};
}
