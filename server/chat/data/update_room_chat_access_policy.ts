import {validateAccessPolicyUpdateForServer} from "~/server/access/validate_access_policy_update_for_server.js";
import {authorizeChatAccessAndReturnItem} from "~/server/chat/data/internal/authorize_chat_access_and_return_item.js";
import {ChatTable} from "~/server/chat/data/internal/chat_table.js";
import {createChatModelFromItem} from "~/server/chat/data/internal/create_chat_model_from_item.js";
import {
    ServerActionContext,
    ServerSessionActionContext,
} from "~/server/context/server_action_context.js";
import {RynamoTableSchema} from "~/server/dynamo/core/rynamo/rynamo_table_schema.js";
import {addFeedCandidateEntry} from "~/server/feed/feed_actions.js";
import {CreateOrUpdateAccessPolicy} from "~/shared/access/model/create_or_update_access_policy_schema.js";
import {ShareNotification} from "~/shared/access/share_notification.js";
import {ChatModel} from "~/shared/chat/chat_model.js";
import {RynamoEvent} from "~/shared/dynamo/rynamo_types.js";
import {FailedPreconditionError} from "~/shared/error/error.js";
import {emptyArray} from "~/shared/helpers/array/empty_array.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {generateId} from "~/shared/id/id.js";
import {ChatId} from "~/shared/id/types/id_types.js";
import {SiteEntryModel, SitePreviewModel} from "~/shared/sites/site_model.js";

/**
 * Updates the access policy for a room chat.
 *
 * If you want to get the `ChatModel` after this update we return a `Lazy` and when
 * you call `get()` it builds the chat model.
 */
export async function updateRoomChatAccessPolicy(
    context: ServerSessionActionContext,
    {
        chatId,
        accessPolicy,
        notification,
    }: {
        chatId: ChatId;
        accessPolicy: CreateOrUpdateAccessPolicy;
        notification: ShareNotification | null;
    },
): Promise<{
    get(context: ServerActionContext): Promise<ChatModel>;
    /**
     * Realtime events for any site item / site preview writes that happened in the
     * same dynamo transaction as the chat update (i.e. when the new access policy
     * switched the chat into or out of a site). `ChatTable` itself is not a
     * general-realtime table so chat-side events flow through a separate mechanism —
     * only site events are surfaced here.
     */
    getRynamoEventsForSite: (
        context: ServerActionContext,
    ) => Promise<ReadonlyArray<RynamoEvent<SitePreviewModel | SiteEntryModel>>>;
}> {
    const currentTime = new Date();

    const {spaceId, creatorId, shouldAddFeedCandidateEntry, getChatModel, getRynamoEventsForSite} =
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

            const {resolvedAccessPolicy: newEffectiveAccessPolicy, transactionEntries} =
                await validateAccessPolicyUpdateForServer(
                    context,
                    attributesItem.spaceId,
                    `Chat:${chatId}`,
                    attributesItem.definition.accessPolicy,
                    accessPolicy,
                );

            const newHasAddedFeedCandidateEntry =
                oldHasAddedFeedCandidateEntry || !!newEffectiveAccessPolicy.defaultGrant;

            const updatedAttributesItem = {
                ...attributesItem,
                definition: {
                    ...attributesItem.definition,
                    accessPolicy,
                    hasAddedFeedCandidateEntry: newHasAddedFeedCandidateEntry,
                },
            };

            if (transactionEntries.length === 0) {
                const newAttributesItem = await ChatTable.directlyUpdateItem(
                    context,
                    updatedAttributesItem,
                );

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
                    getRynamoEventsForSite: async () => emptyArray,
                };
            } else {
                const updateAttrtibutesTransactionEntry =
                    ChatTable.transactionDirectlyUpdateItem(updatedAttributesItem);
                // Commit the chat update and the site item writes in a single transaction so the
                // chat's access policy and the site membership stay consistent.
                await RynamoTableSchema.executeTransaction(context, [
                    updateAttrtibutesTransactionEntry,
                    ...transactionEntries.map(entry => entry.transactionEntry),
                ]);

                return {
                    spaceId: attributesItem.spaceId,
                    creatorId,
                    shouldAddFeedCandidateEntry:
                        newHasAddedFeedCandidateEntry && !oldHasAddedFeedCandidateEntry,
                    getChatModel: (context: ServerActionContext) =>
                        createChatModelFromItem(context, {
                            attributesItem: updateAttrtibutesTransactionEntry.newItem,
                            accountItems: emptyArray,
                        }),
                    getRynamoEventsForSite: async (eventContext: ServerActionContext) =>
                        runAllPromises(
                            transactionEntries.map(entry => entry.getEvent(eventContext)),
                        ),
                };
            }
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

    return {get: getChatModel, getRynamoEventsForSite};
}
