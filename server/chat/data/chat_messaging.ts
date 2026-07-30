import {addDays} from "date-fns";
import {Step} from "prosemirror-transform";
import {authorizeChatAccess} from "~/server/chat/data/authorize_chat_access.js";
import {FileChatAuthorizer} from "~/server/chat/data/file_chat_authorizer.js";
import {getChatMessageCount} from "~/server/chat/data/get_chat_message_count.js";
import {getChatSearchEntityContributorIds} from "~/server/chat/data/get_chat_search_entity_contributor_ids.js";
import {getSafeCurrentlyViewedEntityIfPossibleForServer} from "~/server/chat/data/get_safe_current_viewed_entity_if_possible_for_server.js";
import {actuallyGetOrCreateChatForAccounts} from "~/server/chat/data/internal/actually_get_or_create_chat_for_accounts.js";
import {
    authorizeChatAccessAndReturnItem,
    authorizeChatAccessForAccountAndReturnItem,
} from "~/server/chat/data/internal/authorize_chat_access_and_return_item.js";
import {ChatTable} from "~/server/chat/data/internal/chat_table.js";
import {
    applyMentionCountByAccountIdDifferenceFromContentUpdate,
    getMentionedAccountIdsInContent,
} from "~/server/content/get_mentioned_account_ids_in_content.js";
import {
    ServerAccountActionContext,
    ServerActionContext,
    ServerSessionActionContext,
    ServerSystemActionContext,
} from "~/server/context/server_action_context.js";
import {ServerSessionActionContextWithPush} from "~/server/context/server_session_action_context_with_push.js";
import {DynamoContext} from "~/server/dynamo/core/dynamo_context.js";
import {DynamoContextCache} from "~/server/dynamo/core/dynamo_context_cache.js";
import {dynamoClientRequestTokenMaxLength} from "~/server/dynamo/core/dynamo_max_client_request_token_length.js";
import {DynamoCacheReadConsistency} from "~/server/dynamo/core/dynamo_read_consistency.js";
import {DynamoTableSchema} from "~/server/dynamo/core/dynamo_table_schema.js";
import {isDynamoIdempotentParameterMismatchError} from "~/server/dynamo/core/is_dynamo_idempotent_parameter_mismatch_error.js";
import {getFileFromAttachment} from "~/server/files/data/files_actions.js";
import {computeUpdateMessageContent} from "~/server/messaging/helpers/compute_update_message_content.js";
import {createMessagePayloadModel} from "~/server/messaging/helpers/create_message_payload_model.js";
import {
    createCantCompleteStaleMessageStreamError,
    createCantPingCompletedMessageStreamError,
    createCantPingStaleMessageStreamError,
    createCantWriteToStaleMessageStreamError,
} from "~/server/messaging/helpers/create_message_stream_errors.js";
import {
    messageStreamIndexSearchEntityDelaySeconds,
    shouldScheduleMessageStreamIndexSearchEntityJob,
} from "~/server/messaging/helpers/message_stream_index_search_entity_delay_seconds.js";
import {MessageStreamAttributes} from "~/server/messaging/helpers/message_stream_schema.js";
import {hasMessageStreamDefinitelyTimedOut} from "~/server/messaging/helpers/message_stream_timeout_ms.js";
import {MessageItem} from "~/server/messaging/helpers/process_messages_query.js";
import {
    messagingEventExpirationDays,
    runBackfillMessageUpdates,
} from "~/server/messaging/helpers/run_backfill_message_updates.js";
import {runMessagesQuery} from "~/server/messaging/helpers/run_messages_query.js";
import {validateMessageContentPayloadMessagesRangeParent} from "~/server/messaging/helpers/validate_message_content_payload_messages_range_parent.js";
import {getNotificationMessageContentSnippet} from "~/server/notifications/core/get_notification_content_snippet.js";
import {NotificationEvent} from "~/server/notifications/core/notification_event.js";
import {markSearchAffinityEntityInteraction} from "~/server/search/data/table/search_entity_actions.js";
import {authorizeOwnSpaceAccountAccess} from "~/server/spaces/authorize_own_space_account_access.js";
import {getAccountOrDangerouslyGetStubWithoutAuthorization} from "~/server/spaces/get_account_or_dangerously_get_stub_without_authoriztion.js";
import {isAccountMemberOfSpace} from "~/server/spaces/is_account_member_of_space.js";
import {isBotSpaceAccount} from "~/server/spaces/is_bot_space_account.js";
import {getSiteIdFromAccessPolicyIfExists} from "~/shared/access/get_site_id_from_access_policy_if_exists.js";
import {ShareNotification} from "~/shared/access/share_notification.js";
import {ApiBotWebhookCreatedMessageEventParent} from "~/shared/api/specification/types/api_specification_convenience_types.js";
import {createChatMessageNotFoundError} from "~/shared/chat/chat_error_messages.js";
import {ChatMessageModel} from "~/shared/chat/chat_model.js";
import {isContentEmpty} from "~/shared/content/is_content_empty.js";
import {
    MessageContent,
    createSimpleMessageContent,
} from "~/shared/content/message_content_schema.js";
import {
    FailedPreconditionError,
    InternalError,
    InvalidArgumentError,
    NotFoundError,
    PermissionDeniedError,
} from "~/shared/error/error.js";
import {errorDisplayMessage} from "~/shared/error/error_display_message.js";
import {FileEntityId, parseFileEntityId} from "~/shared/files/file_entity_id.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {isDeepEqual} from "~/shared/helpers/control/is_deep_equal.js";
import {TimeZone} from "~/shared/helpers/intl/time_zone.js";
import {arrayFromAsyncIterable} from "~/shared/helpers/iterable/array_from_async_iterable.js";
import {emptyMap} from "~/shared/helpers/map/empty_map.js";
import {getOrSetDefaultMapValue} from "~/shared/helpers/map/get_or_set_default_map_value.js";
import {omitObject} from "~/shared/helpers/object/omit_object.js";
import {isTestNodeEnvOrAdminScenariosScript} from "~/shared/helpers/test/is_test_node_env_or_admin_scenarios_script.js";
import {generateChronologicalId} from "~/shared/id/chronological_id.js";
import {Id, isId} from "~/shared/id/id.js";
import {AccountId, ChatId, FileId, SpaceId} from "~/shared/id/types/id_types.js";
import {computeDeleteMessageReaction} from "~/shared/messaging/compute_delete_message_reaction.js";
import {computeSetMessageReaction} from "~/shared/messaging/compute_set_message_reaction.js";
import {cutMessageContentPayload} from "~/shared/messaging/cut_message_content_payload.js";
import {getTruncatedParentMessagesRangeContentWithoutReferences} from "~/shared/messaging/get_truncated_parent_message_range_content_with_references.js";
import {
    MessageContentPayloadClerical,
    MessageContentPayloadContentUpdate,
    MessageContentPayloadParent,
    MessageStreamPartPayload,
    iterateMessageContentPayloadParentIndexes,
} from "~/shared/messaging/message_schema.js";
import {
    MessageUpdatesBackfillResult,
    MessagingRealtimeBroadcastCompleteMessageStreamRequestSchema,
    MessagingRealtimeBroadcastPutMessageStreamPartRequestSchema,
} from "~/shared/messaging/messaging_realtime_protocol.js";
import {Reaction} from "~/shared/reactions/reaction.js";
import {emptyReactionSet} from "~/shared/reactions/reaction_set.js";
import {SearchAffinityEntityInteraction} from "~/shared/search/search_affinity_entity_interaction.js";
import {SearchMentionEntityId} from "~/shared/search/search_entity_id.js";
import {ServerSynchronizationCheckpoint} from "~/shared/web_socket/server_synchronization_checkpoint.js";

/**
 * Send a message to to the provided chat.
 */
export function sendChatMessage(
    context: ServerAccountActionContext,
    {
        chatId,
        parent,
        content,
        fileIds,
        createdTimeZone,
        overrideCreatedTimeForTest,
        isStream,
        consistency,
        dangerousCurrentlyViewingSearchEntityId,
    }: {
        chatId: ChatId;
        parent: MessageContentPayloadParent | null;
        content: MessageContent;
        fileIds: ReadonlyArray<FileId | FileEntityId>;
        createdTimeZone: TimeZone;
        overrideCreatedTimeForTest?: Date;
        isStream?: boolean;
        consistency?: DynamoCacheReadConsistency;
        dangerousCurrentlyViewingSearchEntityId?: SearchMentionEntityId;
    },
): Promise<{
    spaceId: SpaceId;
    chatId: ChatId;
    index: number;
    createdTime: Date;
}> {
    return sendChatMessageForAccount(context, {
        chatId,
        authorId: context.actor.getPossiblyBotAccountId(),
        parent,
        content,
        fileIds,
        createdTimeZone,
        overrideCreatedTimeForTest,
        clerical: isStream ? {type: "Stream"} : undefined,
        consistency,
        dangerousCurrentlyViewingSearchEntityId,
    });
}

// IMPORTANT: Don't export this function! It allows our system actor to impersonate
// a user and send a message on their behalf. Only write code to send chat messages
// on behalf of another account in this file.
function sendChatMessageForAccount(
    context: ServerActionContext,
    {
        chatId,
        authorId,
        parent,
        content,
        fileIds,
        createdTimeZone,
        overrideCreatedTimeForTest,
        clerical,
        consistency,
        clientRequestToken,
        dangerousCurrentlyViewingSearchEntityId,
    }: {
        chatId: ChatId;
        authorId: AccountId;
        parent: MessageContentPayloadParent | null;
        content: MessageContent;
        fileIds: ReadonlyArray<FileId | FileEntityId>;
        createdTimeZone: TimeZone;
        overrideCreatedTimeForTest?: Date;
        clerical?: MessageContentPayloadClerical;
        consistency?: DynamoCacheReadConsistency;
        clientRequestToken?: string;
        dangerousCurrentlyViewingSearchEntityId?: SearchMentionEntityId;
    },
): Promise<{
    spaceId: SpaceId;
    chatId: ChatId;
    index: number;
    createdTime: Date;
}> {
    if (overrideCreatedTimeForTest) {
        assert(isTestNodeEnvOrAdminScenariosScript);
    }

    return context.dynamo.retryTransaction(async context => {
        // Make sure we're either a system actor or a session actor for this account.
        await authorizeOwnSpaceAccountAccess(context, authorId);

        const [{attributesItem: chatAttributesItem, definition}, parentForEvent] =
            await runAllPromises([
                (async () => {
                    const item = await authorizeChatAccessForAccountAndReturnItem(
                        context,
                        chatId,
                        authorId,
                        "Comment",
                        {consistency},
                    );

                    // Make sure all the provided files exist.
                    await runAllPromises(
                        fileIds.map(fileId =>
                            isId<FileId>(fileId)
                                ? getFileFromAttachment(
                                      context,
                                      fileId,
                                      FileChatAuthorizer.bind({type: "ChatMessages", chatId}),
                                      {consistency},
                                  )
                                : null,
                        ),
                    );

                    return item;
                })(),
                (async (): Promise<ApiBotWebhookCreatedMessageEventParent | null> => {
                    if (!parent) return null;

                    switch (parent.type) {
                        case "Message": {
                            const messageItem = await ChatTable.getItem(
                                context,
                                {
                                    partitionType: "Chat",
                                    sortRangeType: "Messages",
                                    chatId,
                                    messageIndex: parent.index,
                                },
                                {consistency},
                            );
                            return {
                                type: "Message",
                                index: parent.index,
                                author: {id: messageItem.authorId},
                            };
                        }
                        case "MessagesRange": {
                            const messageItems = await arrayFromAsyncIterable(
                                runMessagesQuery(context, {
                                    cache: ChatMessageItemContextCache,
                                    cacheKeyPrefix: chatId,
                                    consistency,
                                    startIndex: parent.startIndex,
                                    endIndex: parent.endIndex,
                                    query: ({consistency, limit, startSortKey, endSortKey}) =>
                                        ChatTable.query(context, {
                                            consistency,
                                            limit,
                                            partitionKey: {partitionType: "Chat", chatId},
                                            startSortKey,
                                            endSortKey,
                                        }),
                                }),
                            );

                            validateMessageContentPayloadMessagesRangeParent(parent, messageItems);

                            return {
                                type: "Message",
                                index: parent.startIndex,
                                author: {id: messageItems[0]!.authorId},
                            };
                        }
                        case "PostRange": {
                            throw new InvalidArgumentError(
                                "Post range parent can only be used with post comments",
                            );
                        }
                        default:
                            throw exhaustive(parent);
                    }
                })(),
            ]);

        if (clerical) {
            switch (clerical.type) {
                case "ShareNotification": {
                    if (context.actor.type !== "System") {
                        throw new PermissionDeniedError(
                            "Only system actors can send `ShareNotification` messages",
                        );
                    }
                    break;
                }
                case "Stream": {
                    if (context.actor.type !== "Bot") {
                        throw new PermissionDeniedError("Only bots can send `Stream` messages");
                    }
                    break;
                }
                default:
                    throw exhaustive(clerical);
            }
        }

        const messageIndex = getChatMessageCount(chatAttributesItem.messagesSummary);

        // NOTE(calebmer): Using `Date.now()` allows our Jest tests to mock `Date.now()`
        // and override the time that is returned.
        const currentTime = new Date(Date.now());

        const createdTime = overrideCreatedTimeForTest ?? currentTime;

        // If this is a stream message and we have empty content then we only send a
        // notification event after the first content part has finished.
        const willSendNotificationEvent = clerical?.type !== "Stream" || !isContentEmpty(content);

        const newMessageCountByAuthorId = new Map(
            chatAttributesItem.messagesSummary.messageCountByAuthorId,
        );
        newMessageCountByAuthorId.set(authorId, (newMessageCountByAuthorId.get(authorId) ?? 0) + 1);

        const newMentionCountByAccountId = applyMentionCountByAccountIdDifferenceFromContentUpdate(
            chatAttributesItem.messagesSummary.mentionCountByAccountId,
            null,
            content,
        );

        const newMessagesSummary = {
            unknownAuthorMessageCount: chatAttributesItem.messagesSummary.unknownAuthorMessageCount,
            messageCountByAuthorId: newMessageCountByAuthorId,
            mentionCountByAccountId: newMentionCountByAccountId,
        };

        await DynamoTableSchema.executeTransaction(
            context,
            [
                ChatTable.transactionCreateItem(
                    {
                        partitionType: "Chat",
                        sortRangeType: "Messages",
                        chatId,
                        messageIndex,
                        authorId,
                        createdTime,
                        createdTimeZone,
                        payload: {
                            type: "Content",
                            parent,
                            content,
                            contentUpdate: null,
                            fileIds,
                            clerical,
                            reactionsByPos: emptyMap,
                            filesReactions: emptyReactionSet,
                        },
                    },
                    // Retry in case of a race condition where another process writes to this
                    // `messageIndex` before us.
                    {isConditionCheckErrorRetriable: true},
                ),
                ChatTable.transactionDirectlyUpdateItemAttribute(
                    {partitionType: "Chat", sortRangeType: "Attributes", chatId},
                    "messagesSummary",
                    newMessagesSummary,
                    {updateLockVersion: chatAttributesItem.updateLockVersion},
                ),

                // If this is a stream message then create the stream state item. Create-or-replace
                // is safe since we know the message index doesn't exist from our other condition
                // checks.
                ...(clerical?.type === "Stream"
                    ? [
                          ChatTable.transactionCreateOrReplaceItem({
                              partitionType: "Chat",
                              sortRangeType: "Messages#Stream",
                              chatId,
                              createdTime,
                              createdTimeZone,
                              messageIndex,
                              authorId,
                              completedTime: null,
                              partCount: 0,
                              lastPartUpdateLockVersion: null,
                              lastPartCreatedTime: null,
                              lastPingTime: null,
                              lastIndexSearchEntityJob: {
                                  sendTime: currentTime,
                                  delaySeconds: messageStreamIndexSearchEntityDelaySeconds,
                              },
                              pendingNotificationEvent: !willSendNotificationEvent
                                  ? {parent: parentForEvent}
                                  : null,
                          }),
                      ]
                    : []),
            ],
            {clientRequestToken},
        );

        const mentionedAccountIds = getMentionedAccountIdsInContent(content);
        const contentSnippet = getNotificationMessageContentSnippet(content);

        if (willSendNotificationEvent) {
            context.jobs.send({
                type: "NotificationEvent",
                event: {
                    type: "CreateChatMessage",
                    id: generateChronologicalId(),
                    spaceId: chatAttributesItem.spaceId,
                    chatId,
                    messageIndex,
                    createdTime,
                    createdTimeZone,
                    authorId,
                    mentionedAccountIds,
                    parent: parentForEvent,
                    isContentSnippetComplete: contentSnippet.nodeSize === content.nodeSize,
                    contentSnippet,
                    clerical,
                    currentlyViewedSearchEntityId:
                        await getSafeCurrentlyViewedEntityIfPossibleForServer(
                            context,
                            chatAttributesItem.spaceId,
                            {
                                // TODO(ifitzsimmons, share-entity-with-agents): This should support a chat with
                                // one human and multiple agents.
                                accountIdsInChat: chatAttributesItem.accountIdsForDirectOneOnOne,
                                dangerousCurrentlyViewingSearchEntityId,
                                authorId,
                            },
                        ),
                },
            });
        }

        context.jobs.send(
            {
                type: "IndexSearchEntity",
                spaceId: chatAttributesItem.spaceId,
                update: {
                    type: "ChatMessage",
                    chatId,
                    messageIndex,
                    // Nothing depends on this entity when it's created. Don't bother trying to reindex
                    // dependencies.
                    updatedTraits: {type: "None"},
                },
            },
            {
                delaySeconds:
                    clerical?.type === "Stream" ? messageStreamIndexSearchEntityDelaySeconds : 0,
            },
        );

        // We don't index a chat for search until the first message is sent to the chat. We
        // also index when the contributors map changes.
        if (
            (chatAttributesItem.definition.type === "Direct" && messageIndex === 0) ||
            !isDeepEqual(
                getChatSearchEntityContributorIds(
                    chatAttributesItem.definition,
                    chatAttributesItem.messagesSummary,
                ),
                getChatSearchEntityContributorIds(
                    chatAttributesItem.definition,
                    newMessagesSummary,
                ),
            )
        ) {
            context.jobs.send({
                type: "IndexSearchEntity",
                spaceId: chatAttributesItem.spaceId,
                update: {
                    type: "Chat",
                    chatId,
                    updatedTraits: {type: "Some", traits: []},
                },
            });
        }

        // Only increase affinity score if we have a session actor. Don't increase affinity
        // score if this is a system actor sending a message on behalf of an account.
        if (context.actor.type === "Session") {
            const sessionContext = context.actor.authorizeSession();

            // Add affinity points to chat. Unless this is a 1:1 chat. For 1:1 chats we want to
            // add affinity points to the account we're messaging. That way we build affinity
            // with the account directly.
            context.process.waitUntil(async () => {
                // Small messages are considered low intent updates. This defends against spamming
                // where a user is sending small one word messages to make a point.
                const interaction: SearchAffinityEntityInteraction =
                    content.nodeSize < 50
                        ? {type: "LowIntentUpdate"}
                        : {type: "MediumIntentUpdate"};

                if (chatAttributesItem.accountIdsForDirectOneOnOne) {
                    const otherChatAccountIds =
                        chatAttributesItem.accountIdsForDirectOneOnOne.filter(
                            chatAccountId => chatAccountId !== authorId,
                        );

                    assert(otherChatAccountIds.length === 1);

                    await markSearchAffinityEntityInteraction(sessionContext, {
                        spaceId: chatAttributesItem.spaceId,
                        entityId: `Account:${assertExists(otherChatAccountIds[0])}`,
                        interaction,
                        // Accounts cannot live in a site.
                        siteId: null,
                    });
                } else if (definition.type === "Direct" && definition.accountCount <= 2) {
                    // Noop. We don't index chats with less than two accounts. Instead you should be
                    // referencing the `Account:${AccountId}` entity. If this chat has only one account
                    // it's the user's personal chat. We don't currently give affinity points for the
                    // account's personal chat when you send a message.
                } else {
                    const chatDefinition = chatAttributesItem.definition;
                    await markSearchAffinityEntityInteraction(sessionContext, {
                        spaceId: chatAttributesItem.spaceId,
                        entityId: `Chat:${chatAttributesItem.chatId}`,
                        interaction,
                        siteId:
                            chatDefinition.type === "Room"
                                ? getSiteIdFromAccessPolicyIfExists(chatDefinition.accessPolicy)
                                : null,
                    });
                }
            });

            // Increase affinity points for all mentioned accounts with a high intent update
            // since the user clearly wants the attention of the mentioned accounts.
            //
            // (If a mentioned account doesn't have access to this message should that still be
            // a high intent update? For now we say yes since the user is explicitly choosing
            // to reference them.)
            for (const mentionedAccountId of mentionedAccountIds) {
                context.process.waitUntil(async () => {
                    if (
                        await isAccountMemberOfSpace(
                            context,
                            chatAttributesItem.spaceId,
                            mentionedAccountId,
                        )
                    ) {
                        await markSearchAffinityEntityInteraction(sessionContext, {
                            spaceId: chatAttributesItem.spaceId,
                            entityId: `Account:${mentionedAccountId}`,
                            interaction: {type: "HighIntentUpdate"},
                            // Accounts cannot live in a site.
                            siteId: null,
                        });
                    }
                });
            }
        }

        return {
            spaceId: chatAttributesItem.spaceId,
            chatId,
            index: messageIndex,
            createdTime,
        };
    });
}

/**
 * When the user shares an `AccessPolicy` with individual users and selects "Notify
 * people" then this job will be added to the queue.
 */
export async function processSendShareNotificationJob(
    context: ServerSystemActionContext,
    {
        jobId,
        spaceId,
        actorAccountId,
        entityId,
        notification,
    }: {
        jobId: Id;
        spaceId: SpaceId;
        actorAccountId: AccountId;
        entityId: FileEntityId;
        notification: ShareNotification;
    },
) {
    await runAllPromises(
        notification.accountIds.map(async otherAccountId => {
            if (otherAccountId === actorAccountId) return;

            // Don't send share notification to bot accounts.
            if (await isBotSpaceAccount(context, spaceId, otherAccountId)) return;

            const {chatId} = await actuallyGetOrCreateChatForAccounts(context, {
                spaceId,
                actorAccountId,
                otherAccountIds: [otherAccountId],
                initialSharedChatsPromise: null,
            });

            try {
                const clientRequestTokenIdLength = Math.floor(
                    (dynamoClientRequestTokenMaxLength - 1) / 2,
                );

                await sendChatMessageForAccount(context, {
                    chatId,
                    authorId: actorAccountId,
                    parent: null,
                    content: notification.content,
                    fileIds: [entityId],
                    clerical: {
                        type: "ShareNotification",
                        entityType: parseFileEntityId(entityId).type,
                    },
                    createdTimeZone: notification.createdTimeZone,
                    clientRequestToken: [
                        jobId.slice(0, clientRequestTokenIdLength),
                        otherAccountId.slice(0, clientRequestTokenIdLength),
                    ].join("-"),
                });
            } catch (error) {
                // SQS may retry this job. If so, don't send a message to the same account twice.
                if (isDynamoIdempotentParameterMismatchError(error)) return;

                throw error;
            }
        }),
    );
}

/**
 * Update a part of the message stream.
 *
 * Message streams are made up of multiple parts. Only the bot that created a
 * stream can update the stream. A bot can only create new parts or update the last
 * part of the stream.
 *
 * Currently, you completely replace a part when you update it. We may allow more
 * granular part updates in the future.
 */
export function putChatMessageStreamPart(
    context: ServerActionContext,
    {
        chatId,
        messageIndex,
        partIndex,
        payload,
        consistency,
        isTimeoutErrorCompletion = false,
        overrideCreatedTimeForTest,
    }: {
        chatId: ChatId;
        messageIndex: number;
        partIndex: number | "Create";
        payload: MessageStreamPartPayload;
        consistency?: DynamoCacheReadConsistency;
        isTimeoutErrorCompletion?: boolean;
        overrideCreatedTimeForTest?: Date;
    },
): Promise<{spaceId: SpaceId; createdTime: Date}> {
    if (isTimeoutErrorCompletion && context.actor.type !== "System") {
        throw new PermissionDeniedError(
            "Only system actors can complete a message stream after timeout",
        );
    }

    if (overrideCreatedTimeForTest) {
        assert(isTestNodeEnvOrAdminScenariosScript);
    }

    return context.dynamo.retryTransaction(async context => {
        const [{spaceId}, item] = await runAllPromises([
            // Make sure the bot has access (and wasn't removed from the space).
            authorizeChatAccess(context, chatId, "Comment", {consistency}),

            ChatTable.getItemIfExists(
                context,
                {
                    partitionType: "Chat",
                    sortRangeType: "Messages#Stream",
                    chatId,
                    messageIndex,
                },
                {consistency},
            ),
        ]);

        if (!item) {
            throw new FailedPreconditionError("Message isn\u2019t a stream", {
                displayMessage: errorDisplayMessage`Message isn\u2019t a stream.`,
            });
        }

        await authorizeOwnSpaceAccountAccess(context, item.authorId, {
            displayMessage: errorDisplayMessage`Only the bot who created the stream can update it.`,
        });

        if (item.completedTime !== null) {
            // If the stream is already completed then noop.
            if (isTimeoutErrorCompletion) return {spaceId, createdTime: new Date()};

            throw new FailedPreconditionError("The stream has already been completed", {
                displayMessage: errorDisplayMessage`The stream has already been completed.`,
            });
        }

        if (!isTimeoutErrorCompletion && hasMessageStreamDefinitelyTimedOut(item)) {
            throw createCantWriteToStaleMessageStreamError();
        }

        if (partIndex === "Create") {
            partIndex = item.partCount;
        }

        // Use `Date.now()` so tests can mock the `Date.now()` function.
        const currentTime = new Date(Date.now());

        const lastPingTime =
            item.lastPingTime && currentTime <= item.lastPingTime
                ? // NOTE(ifitzsimmons): This makes sure lastPingTime is always at least 1ms ahead of
                  // the previous ping time. This is important if we have two different instances
                  // processing pings with different clock skews.
                  new Date(item.lastPingTime.getTime() + 1)
                : currentTime;

        let nextIndexSearchEntityJob: {sendTime: Date; delaySeconds: number} | null = null;

        if (
            shouldScheduleMessageStreamIndexSearchEntityJob(
                item.lastIndexSearchEntityJob,
                lastPingTime,
            )
        ) {
            nextIndexSearchEntityJob = {
                sendTime: currentTime,
                delaySeconds: messageStreamIndexSearchEntityDelaySeconds,
            };
        }

        let version: number;

        let createdTime: Date;
        if (partIndex === item.partCount) {
            const notificationEvent = await getNotificationEventForPutChatMessageStreamPart(
                context,
                {
                    spaceId,
                    chatId,
                    messageIndex,
                    item,
                    payload,
                    partIndex,
                    isTimeoutErrorCompletion,
                },
            );

            createdTime = overrideCreatedTimeForTest ?? currentTime;

            const createPartTransactionEntry = ChatTable.transactionCreateOrReplaceItem({
                partitionType: "Chat",
                sortRangeType: "Messages#StreamPart",
                chatId,
                messageIndex,
                partIndex,
                payload,
                createdTime,
                // `updateLockVersion: 0` is always represented as `undefined`.
                updateLockVersion: undefined,
            });

            version = createPartTransactionEntry.newItem.updateLockVersion ?? 0;

            await DynamoTableSchema.executeTransaction(context, [
                ChatTable.transactionDirectlyUpdateItem({
                    ...item,
                    completedTime: isTimeoutErrorCompletion ? currentTime : null,
                    partCount: partIndex + 1,
                    lastPartUpdateLockVersion: 0,
                    lastPartCreatedTime: createdTime,
                    lastPingTime,
                    lastIndexSearchEntityJob:
                        nextIndexSearchEntityJob ?? item.lastIndexSearchEntityJob,
                    pendingNotificationEvent: notificationEvent
                        ? null
                        : item.pendingNotificationEvent,
                }),
                createPartTransactionEntry,
            ]);

            if (notificationEvent) {
                context.jobs.send({
                    type: "NotificationEvent",
                    event: notificationEvent,
                });
            }
        } else {
            if (isTimeoutErrorCompletion) {
                throw new InternalError(
                    "Must create a new part when setting `isTimeoutErrorCompletion` to true",
                );
            }

            if (partIndex !== item.partCount - 1) {
                throw new FailedPreconditionError(
                    "Only the last part of the stream or the next part can be updated",
                    {
                        displayMessage: errorDisplayMessage`Only the last part of the stream (index ${
                            item.partCount - 1
                        }) or the next part (index ${item.partCount}) can be updated.`,
                    },
                );
            }

            assert(item.lastPartUpdateLockVersion !== null);
            assert(item.lastPartCreatedTime !== null);
            createdTime = item.lastPartCreatedTime;

            const updatePartTransactionEntry = ChatTable.transactionCreateOrReplaceItem({
                partitionType: "Chat",
                sortRangeType: "Messages#StreamPart",
                chatId,
                messageIndex,
                partIndex,
                payload,
                createdTime,
                updateLockVersion: item.lastPartUpdateLockVersion + 1,
            });

            version = updatePartTransactionEntry.newItem.updateLockVersion ?? 0;

            await DynamoTableSchema.executeTransaction(context, [
                ChatTable.transactionDirectlyUpdateItem({
                    ...item,
                    lastPingTime,
                    lastPartUpdateLockVersion: item.lastPartUpdateLockVersion + 1,
                    lastIndexSearchEntityJob:
                        nextIndexSearchEntityJob ?? item.lastIndexSearchEntityJob,
                }),
                updatePartTransactionEntry,
            ]);
        }

        if (nextIndexSearchEntityJob) {
            context.jobs.send(
                {
                    type: "IndexSearchEntity",
                    spaceId,
                    update: {
                        type: "ChatMessage",
                        chatId,
                        messageIndex,
                        updatedTraits: {type: "Some", traits: []},
                    },
                },
                {delaySeconds: nextIndexSearchEntityJob.delaySeconds},
            );
        }

        // NOTE(calebmer): If the process dies after committing to DynamoDB but before
        // sending this realtime event the user might not see an update to their message in
        // realtime.
        //
        // Should we send this broadcast event in a DynamoDB Streams listener that reacts
        // to the update? We plan to move `NotificationEvent`, `IndexSearchEntity`, and
        // other processing that needs to reliably run after an updates to DynamoDB
        // Streams.
        context.process.waitUntil(
            context.edge.broadcastToDurableObject(
                `/api/durable-objects/chat/${chatId}/broadcast-put-message-stream-part`,
                {
                    serviceName: "ChatRealtimeService",
                    route: "/api/durable-objects/chat/:chatId/broadcast-put-message-stream-part",
                    body: MessagingRealtimeBroadcastPutMessageStreamPartRequestSchema.serialize({
                        index: messageIndex,
                        partIndex,
                        part: {version, payload, createdTime},
                    }),
                },
            ),
        );

        return {spaceId, createdTime};
    });
}

/**
 * We send a notification event for a message stream once the first content stream
 * part is finished. A stream part is considered finished when a new part is
 * created after. Only the last stream part can be updated, all other stream parts
 * are frozen.
 *
 * So practically this means for most streams the notification is sent once we put
 * the second part (`partIndex === 1`) not the first part.
 *
 * Unless this is a timeout error completion, in that case we send the notification
 * immediately since there will be no more parts.
 */
async function getNotificationEventForPutChatMessageStreamPart(
    context: DynamoContext,
    {
        spaceId,
        chatId,
        messageIndex,
        item,
        payload,
        partIndex,
        isTimeoutErrorCompletion,
    }: {
        spaceId: SpaceId;
        chatId: ChatId;
        messageIndex: number;
        item: MessageStreamAttributes;
        payload: MessageStreamPartPayload;
        partIndex: number;
        isTimeoutErrorCompletion: boolean;
    },
): Promise<NotificationEvent | null> {
    if (!item.pendingNotificationEvent) return null;

    let content: MessageContent;

    // Always send a notification event for timeout error completions if we haven't
    // sent one already.
    if (isTimeoutErrorCompletion) {
        content = payload.type === "Content" ? payload.content : createSimpleMessageContent();
    } else if (partIndex === 0) {
        return null;
    } else {
        // If we're creating a new part then read the previous part we're finishing. If the
        // previous part is a content part then send a notification using the content from
        // that part.

        const previousPartItem = await ChatTable.getItem(
            context,
            {
                partitionType: "Chat",
                sortRangeType: "Messages#StreamPart",
                chatId,
                messageIndex,
                partIndex: partIndex - 1,
            },
            // Part's will be added in rapid succession. Make sure we there's no eventual
            // consistency lag.
            {consistency: "Strong"},
        );

        if (previousPartItem.payload.type !== "Content") return null;

        content = previousPartItem.payload.content;
    }

    const contentSnippet = getNotificationMessageContentSnippet(content);

    return {
        type: "CreateChatMessage",
        id: generateChronologicalId(),
        spaceId,
        chatId,
        messageIndex,
        createdTime: item.createdTime,
        createdTimeZone: item.createdTimeZone,
        authorId: item.authorId,
        mentionedAccountIds: getMentionedAccountIdsInContent(content),
        parent: item.pendingNotificationEvent.parent,
        isContentSnippetComplete: contentSnippet.nodeSize === content.nodeSize,
        contentSnippet,
        clerical: {type: "Stream"},
    };
}

/**
 * Completes a message stream. After this parts can't be added or updated.
 *
 * This function is idempotent. If the stream is already completed this method does
 * nothing.
 */
export function completeChatMessageStream(
    context: ServerActionContext,
    {
        chatId,
        messageIndex,
        consistency,
    }: {
        chatId: ChatId;
        messageIndex: number;
        consistency?: DynamoCacheReadConsistency;
    },
): Promise<{
    spaceId: SpaceId;
    completedTime: Date;
}> {
    return context.dynamo.retryTransaction(async context => {
        const [{spaceId}, item] = await runAllPromises([
            // Make sure the bot has access (and wasn't removed from the space).
            authorizeChatAccess(context, chatId, "Comment", {consistency}),

            ChatTable.getItemIfExists(
                context,
                {
                    partitionType: "Chat",
                    sortRangeType: "Messages#Stream",
                    chatId,
                    messageIndex,
                },
                {consistency},
            ),
        ]);

        if (!item) {
            throw new FailedPreconditionError("Message isn\u2019t a stream", {
                displayMessage: errorDisplayMessage`Message isn\u2019t a stream.`,
            });
        }

        await authorizeOwnSpaceAccountAccess(context, item.authorId, {
            displayMessage: errorDisplayMessage`Only the bot who created the stream can update it.`,
        });

        // Already completed!
        if (item.completedTime !== null) {
            return {spaceId, completedTime: item.completedTime};
        }

        // NOTE(calebmer): Using `Date.now()` allows our Jest tests to mock `Date.now()`
        // and override the time that is returned.
        const completedTime = new Date(Date.now());

        if (hasMessageStreamDefinitelyTimedOut(item)) {
            throw createCantCompleteStaleMessageStreamError();
        }

        let notificationEvent: NotificationEvent | null = null;

        // If we haven't sent a notification event for this message stream yet then send
        // one now!
        if (item.pendingNotificationEvent) {
            const previousPartItem =
                item.partCount > 0
                    ? await ChatTable.getItem(
                          context,
                          {
                              partitionType: "Chat",
                              sortRangeType: "Messages#StreamPart",
                              chatId,
                              messageIndex,
                              partIndex: item.partCount - 1,
                          },
                          // Part's will be added in rapid succession. Make sure we there's no eventual
                          // consistency lag.
                          {consistency: "Strong"},
                      )
                    : null;

            const content =
                previousPartItem?.payload.type === "Content"
                    ? previousPartItem.payload.content
                    : createSimpleMessageContent();
            const contentSnippet = getNotificationMessageContentSnippet(content);

            notificationEvent = {
                type: "CreateChatMessage",
                id: generateChronologicalId(),
                spaceId,
                chatId,
                messageIndex,
                createdTime: item.createdTime,
                createdTimeZone: item.createdTimeZone,
                authorId: item.authorId,
                mentionedAccountIds: getMentionedAccountIdsInContent(content),
                parent: item.pendingNotificationEvent.parent,
                isContentSnippetComplete: contentSnippet.nodeSize === content.nodeSize,
                contentSnippet,
                clerical: {type: "Stream"},
            };
        }

        await ChatTable.directlyUpdateItem(context, {
            ...item,
            completedTime,
            pendingNotificationEvent: notificationEvent ? null : item.pendingNotificationEvent,
        });

        if (notificationEvent) {
            context.jobs.send({
                type: "NotificationEvent",
                event: notificationEvent,
            });
        }

        // NOTE(calebmer): If the process dies after committing to DynamoDB but before
        // sending this realtime event the user might not see an update to their message in
        // realtime.
        //
        // Should we send this broadcast event in a DynamoDB Streams listener that reacts
        // to the update? We plan to move `NotificationEvent`, `IndexSearchEntity`, and
        // other processing that needs to reliably run after an updates to DynamoDB
        // Streams.
        context.process.waitUntil(
            context.edge.broadcastToDurableObject(
                `/api/durable-objects/chat/${chatId}/broadcast-complete-message-stream`,
                {
                    serviceName: "ChatRealtimeService",
                    route: "/api/durable-objects/chat/:chatId/broadcast-complete-message-stream",
                    body: MessagingRealtimeBroadcastCompleteMessageStreamRequestSchema.serialize({
                        index: messageIndex,
                        completedTime,
                    }),
                },
            ),
        );

        return {spaceId, completedTime};
    });
}

/**
 * Pings a message stream and updates its `lastPingTime`.
 *
 * This function is idempotent. If the stream hasn't been pinged in a while this
 * method will update its `lastPingTime`.
 */
export function pingChatMessageStream(
    context: ServerActionContext,
    {
        chatId,
        messageIndex,
        consistency,
    }: {
        chatId: ChatId;
        messageIndex: number;
        consistency?: DynamoCacheReadConsistency;
    },
): Promise<{
    spaceId: SpaceId;
    lastPingTime: Date;
}> {
    return context.dynamo.retryTransaction(async context => {
        const [{spaceId}, item] = await runAllPromises([
            // Make sure the bot has access (and wasn't removed from the space).
            authorizeChatAccess(context, chatId, "Comment", {consistency}),

            ChatTable.getItemIfExists(
                context,
                {
                    partitionType: "Chat",
                    sortRangeType: "Messages#Stream",
                    chatId,
                    messageIndex,
                },
                {consistency},
            ),
        ]);

        if (!item) {
            throw new FailedPreconditionError("Message isn\u2019t a stream", {
                displayMessage: errorDisplayMessage`Message isn\u2019t a stream.`,
            });
        }

        await authorizeOwnSpaceAccountAccess(context, item.authorId, {
            displayMessage: errorDisplayMessage`Only the bot who created the stream can update it.`,
        });

        if (item.completedTime !== null) {
            throw createCantPingCompletedMessageStreamError();
        }

        if (hasMessageStreamDefinitelyTimedOut(item)) {
            throw createCantPingStaleMessageStreamError();
        }

        // NOTE(calebmer): Using `Date.now()` allows our Jest tests to mock `Date.now()`
        // and override the time that is returned.
        const currentTime = new Date(Date.now());

        const lastPingTime =
            item.lastPingTime && currentTime <= item.lastPingTime
                ? // NOTE(ifitzsimmons): This makes sure lastPingTime is always at least 1ms ahead of
                  // the previous ping time. This is important if we have two different instances
                  // processing pings with different clock skews.
                  new Date(item.lastPingTime.getTime() + 1)
                : currentTime;

        let nextIndexSearchEntityJob: {sendTime: Date; delaySeconds: number} | null = null;

        // Our `IndexSearchEntity` job also serves to expire streams that haven't been
        // updated in a while. So we need to re-schedule it when the stream is pinged.
        if (
            shouldScheduleMessageStreamIndexSearchEntityJob(
                item.lastIndexSearchEntityJob,
                lastPingTime,
            )
        ) {
            nextIndexSearchEntityJob = {
                sendTime: currentTime,
                delaySeconds: messageStreamIndexSearchEntityDelaySeconds,
            };
        }

        await ChatTable.directlyUpdateItem(context, {
            ...item,
            lastPingTime,
            lastIndexSearchEntityJob: nextIndexSearchEntityJob ?? item.lastIndexSearchEntityJob,
        });

        if (nextIndexSearchEntityJob) {
            context.jobs.send(
                {
                    type: "IndexSearchEntity",
                    spaceId,
                    update: {
                        type: "ChatMessage",
                        chatId,
                        messageIndex,
                        updatedTraits: {type: "Some", traits: []},
                    },
                },
                {delaySeconds: nextIndexSearchEntityJob.delaySeconds},
            );
        }

        return {spaceId, lastPingTime};
    });
}

const ChatMessageItemContextCache = new DynamoContextCache<
    `${ChatId}:${number}`,
    MessageItem | null
>({
    // Allow sharing this cache because the results do not depend on who the actor is.
    whenActorChanges: "DangerouslyShare",
});

async function getChatMessageItemIfExists(
    context: ServerActionContext,
    chatId: ChatId,
    messageIndex: number,
    {consistency}: {consistency?: DynamoCacheReadConsistency} = {},
): Promise<MessageItem | null> {
    const items = await arrayFromAsyncIterable(
        runMessagesQuery(context, {
            cache: ChatMessageItemContextCache,
            cacheKeyPrefix: chatId,
            consistency,
            startIndex: messageIndex,
            endIndex: messageIndex,
            query: ({consistency, limit, startSortKey, endSortKey}) =>
                ChatTable.query(context, {
                    consistency,
                    limit,
                    partitionKey: {partitionType: "Chat", chatId},
                    startSortKey,
                    endSortKey,
                }),
        }),
    );

    assert(items.length <= 1);

    return items[0] ?? null;
}

async function getChatMessageItem(
    context: ServerActionContext,
    chatId: ChatId,
    messageIndex: number,
    {consistency}: {consistency?: DynamoCacheReadConsistency} = {},
): Promise<MessageItem> {
    const item = await getChatMessageItemIfExists(context, chatId, messageIndex, {consistency});
    if (!item) throw createChatMessageNotFoundError(chatId, messageIndex);
    return item;
}

/**
 * Get a single chat message comment.
 */
export async function getChatMessage(
    context: ServerActionContext,
    {chatId, messageIndex}: {chatId: ChatId; messageIndex: number},
): Promise<ChatMessageModel> {
    const [{spaceId}, item] = await runAllPromises([
        authorizeChatAccess(context, chatId, "View"),
        getChatMessageItemIfExists(context, chatId, messageIndex),
    ]);

    if (!item) throw createChatMessageNotFoundError(chatId, messageIndex);

    return await createChatMessageModelFromItem(context, spaceId, chatId, item);
}

/**
 * Get a chat message with a version that's either equal to or greater than the
 * provided version.
 */
export async function getChatMessageAtVersion(
    context: ServerActionContext,
    {chatId, messageIndex, version}: {chatId: ChatId; messageIndex: number; version: number},
): Promise<ChatMessageModel> {
    const [{spaceId}, item] = await runAllPromises([
        authorizeChatAccess(context, chatId, "View"),
        (async () => {
            let item = await getChatMessageItemIfExists(context, chatId, messageIndex, {
                consistency: "Eventual",
            });

            if (!item || item.version < version) {
                item = await getChatMessageItemIfExists(context, chatId, messageIndex, {
                    consistency: "Strong",
                });
            }

            if (!item) {
                throw createChatMessageNotFoundError(chatId, messageIndex);
            }

            if (item.version < version) {
                throw new FailedPreconditionError("Can\u2019t get message at a future version");
            }

            return item;
        })(),
    ]);

    return await createChatMessageModelFromItem(context, spaceId, chatId, item);
}

/**
 * Get a single chat message comment's payload.
 */
export async function getChatMessagePayload(
    context: ServerActionContext,
    {
        chatId,
        messageIndex,
        consistency = "Eventual",
    }: {
        chatId: ChatId;
        messageIndex: number;
        consistency?: DynamoCacheReadConsistency;
    },
): Promise<MessageItem & {spaceId: SpaceId}> {
    const [{spaceId}, item] = await runAllPromises([
        authorizeChatAccess(context, chatId, "View", {consistency}),
        getChatMessageItemIfExists(context, chatId, messageIndex, {consistency}),
    ]);

    if (!item) throw createChatMessageNotFoundError(chatId, messageIndex);

    return {spaceId, ...item};
}

async function createChatMessageModelFromItem(
    context: ServerActionContext,
    spaceId: SpaceId,
    chatId: ChatId,
    item: MessageItem,
): Promise<ChatMessageModel> {
    const [author, payload] = await runAllPromises([
        getAccountOrDangerouslyGetStubWithoutAuthorization(context, spaceId, item.authorId),
        createMessagePayloadModel(
            context,
            spaceId,
            FileChatAuthorizer.bind({type: "ChatMessages", chatId}),
            item.payload,
            item.stream,
        ),
    ]);

    return new ChatMessageModel({
        chatId,
        index: item.index,
        version: item.version,
        author,
        createdTime: item.createdTime,
        createdTimeZone: item.createdTimeZone,
        payload,
        stream: item.stream,
    });
}

/**
 * Update the contents of a chat message.
 */
export function updateChatMessageContent(
    context: ServerAccountActionContext,
    {
        chatId,
        messageIndex,
        contentVersion,
        steps,
    }: {
        chatId: ChatId;
        messageIndex: number;
        contentVersion: number;
        steps: ReadonlyArray<Step>;
    },
): Promise<{
    spaceId: SpaceId;
    version: number;
    content: MessageContent;
    contentUpdate: MessageContentPayloadContentUpdate;
}> {
    return context.dynamo.retryTransaction(async context => {
        const [chatItem, chatMessageItem] = await runAllPromises([
            authorizeChatAccessAndReturnItem(context, chatId, "Comment"),
            ChatTable.getItem(context, {
                partitionType: "Chat",
                sortRangeType: "Messages",
                chatId,
                messageIndex,
            }),
        ]);

        if (chatMessageItem.authorId !== context.actor.getPossiblyBotAccountId())
            throw new PermissionDeniedError("Can only update chat messages you authored");

        const {newPayload} = computeUpdateMessageContent(chatMessageItem, contentVersion, steps);

        const oldPayloadContent =
            chatMessageItem.payload.type === "Content" ? chatMessageItem.payload.content : null;

        const newMentionCountByAccountId = applyMentionCountByAccountIdDifferenceFromContentUpdate(
            chatItem.messagesSummary.mentionCountByAccountId,
            oldPayloadContent,
            newPayload.content,
        );

        const transactionEntry = ChatTable.transactionDirectlyUpdateItem({
            ...chatMessageItem,
            payload: newPayload,
        });

        await DynamoTableSchema.executeTransaction(context, [
            transactionEntry,

            ChatTable.transactionDirectlyUpdateItemAttribute(
                {partitionType: "Chat", sortRangeType: "Attributes", chatId},
                "messagesSummary",
                {
                    unknownAuthorMessageCount: chatItem.messagesSummary.unknownAuthorMessageCount,
                    messageCountByAuthorId: chatItem.messagesSummary.messageCountByAuthorId,
                    mentionCountByAccountId: newMentionCountByAccountId,
                },
                {updateLockVersion: chatItem.updateLockVersion},
            ),

            // Create-or-replace is safe because `eventTime`, `messageIndex`, and `version` are
            // all in the item key. So we won't be replacing any existing update item.
            ChatTable.transactionCreateOrReplaceItem({
                partitionType: "Chat",
                sortRangeType: "MessageUpdates",
                chatId,
                eventTime: newPayload.contentUpdate.time,
                messageIndex: chatMessageItem.messageIndex,
                version: transactionEntry.newItem.updateLockVersion ?? 0,
                expirationTime: addDays(
                    newPayload.contentUpdate.time,
                    messagingEventExpirationDays,
                ),
            }),
        ]);

        context.jobs.send({
            type: "IndexSearchEntity",
            spaceId: chatItem.spaceId,
            update: {
                type: "ChatMessage",
                chatId,
                messageIndex,
                updatedTraits: {type: "Some", traits: []},
            },
        });

        return {
            spaceId: chatItem.spaceId,
            version: transactionEntry.newItem.updateLockVersion ?? 0,
            content: newPayload.content,
            contentUpdate: newPayload.contentUpdate,
        };
    });
}

/**
 * Delete a single chat message.
 */
export function deleteChatMessage(
    context: ServerAccountActionContext,
    {chatId, messageIndex}: {chatId: ChatId; messageIndex: number},
): Promise<{version: number; deletedTime: Date}> {
    return context.dynamo.retryTransaction(async context => {
        const [chatItem, chatMessageItem] = await runAllPromises([
            authorizeChatAccessAndReturnItem(context, chatId, "Comment"),
            ChatTable.getItemIfExists(context, {
                partitionType: "Chat",
                sortRangeType: "Messages",
                chatId,
                messageIndex,
            }),
        ]);

        if (!chatMessageItem) throw new NotFoundError("Chat message not found");

        if (chatMessageItem.authorId !== context.actor.getPossiblyBotAccountId())
            throw new PermissionDeniedError("Can only delete messages you authored");

        if (chatMessageItem.payload.type !== "Content")
            throw new FailedPreconditionError(
                "Can\u2019t delete messages with a non-content payload",
            );

        if (chatMessageItem.payload.clerical)
            throw new FailedPreconditionError("Can\u2019t delete clerical messages");

        const deletedTime = new Date();

        const newMentionCountByAccountId = applyMentionCountByAccountIdDifferenceFromContentUpdate(
            chatItem.messagesSummary.mentionCountByAccountId,
            chatMessageItem.payload.content,
            null,
        );

        const transactionEntry = ChatTable.transactionDirectlyUpdateItem({
            ...chatMessageItem,
            payload: {type: "Deleted", deletedTime},
        });

        await DynamoTableSchema.executeTransaction(context, [
            transactionEntry,

            ChatTable.transactionDirectlyUpdateItemAttribute(
                {partitionType: "Chat", sortRangeType: "Attributes", chatId},
                "messagesSummary",
                {
                    unknownAuthorMessageCount: chatItem.messagesSummary.unknownAuthorMessageCount,
                    messageCountByAuthorId: chatItem.messagesSummary.messageCountByAuthorId,
                    mentionCountByAccountId: newMentionCountByAccountId,
                },
                {updateLockVersion: chatItem.updateLockVersion},
            ),

            // Create-or-replace is safe because `eventTime`, `messageIndex`, and `version` are
            // all in the item key. So we won't be replacing any existing update item.
            ChatTable.transactionCreateOrReplaceItem({
                partitionType: "Chat",
                sortRangeType: "MessageUpdates",
                chatId,
                eventTime: deletedTime,
                messageIndex: chatMessageItem.messageIndex,
                version: transactionEntry.newItem.updateLockVersion ?? 0,
                expirationTime: addDays(deletedTime, messagingEventExpirationDays),
            }),
        ]);

        context.jobs.send({
            type: "IndexSearchEntity",
            spaceId: chatItem.spaceId,
            update: {
                type: "ChatMessage",
                chatId,
                messageIndex,
                updatedTraits: {type: "Some", traits: []},
            },
        });

        return {
            version: transactionEntry.newItem.updateLockVersion ?? 0,
            deletedTime,
        };
    });
}

export function setChatMessageReaction(
    context: ServerSessionActionContextWithPush,
    {
        chatId,
        messageIndex,
        contentVersion,
        pos,
        reaction,
    }: {
        chatId: ChatId;
        messageIndex: number;
        contentVersion: number;
        pos: number | "Files";
        reaction: Reaction | "GenericLike";
    },
) {
    return context.dynamo.retryTransaction(async context => {
        const [chatItem, messageItem] = await runAllPromises([
            authorizeChatAccessAndReturnItem(context, chatId, "Comment"),
            getChatMessageItemIfExists(context, chatId, messageIndex),
        ]);

        if (!messageItem) throw createChatMessageNotFoundError(chatId, messageIndex);

        const currentTime = new Date();

        const newPayload = computeSetMessageReaction({
            actorAccountId: context.actor.getPossiblyBotAccountId(),
            message: messageItem,
            contentVersion,
            pos,
            reaction,
        });

        const transactionEntry = ChatTable.transactionDirectlyUpdateItem({
            ...omitObject(messageItem, ["index", "version"]),
            partitionType: "Chat",
            sortRangeType: "Messages",
            chatId,
            messageIndex: messageItem.index,
            updateLockVersion: messageItem.version,
            payload: newPayload,
        });

        await DynamoTableSchema.executeTransaction(context, [
            transactionEntry,

            // Create-or-replace is safe because `eventTime`, `messageIndex`, and `version` are
            // all in the item key. So we won't be replacing any existing update item.
            ChatTable.transactionCreateOrReplaceItem({
                partitionType: "Chat",
                sortRangeType: "MessageUpdates",
                chatId,
                eventTime: currentTime,
                messageIndex: messageItem.index,
                version: transactionEntry.newItem.updateLockVersion ?? 0,
                expirationTime: addDays(currentTime, messagingEventExpirationDays),
            }),
        ]);

        context.process.waitUntil(
            context.notificationsInjection.archiveInboxChatEntryAfterSetChatMessageReaction({
                spaceId: chatItem.spaceId,
                chatId,
                messageCount: getChatMessageCount(chatItem.messagesSummary),
                messageIndex,
            }),
        );

        return {
            version: transactionEntry.newItem.updateLockVersion ?? 0,
        };
    });
}

export function deleteChatMessageReaction(
    context: ServerAccountActionContext,
    {
        chatId,
        messageIndex,
        contentVersion,
        pos,
    }: {
        chatId: ChatId;
        messageIndex: number;
        contentVersion: number;
        pos: number | "Files";
    },
) {
    return context.dynamo.retryTransaction(async context => {
        const [, messageItem] = await runAllPromises([
            authorizeChatAccessAndReturnItem(context, chatId, "Comment"),
            getChatMessageItemIfExists(context, chatId, messageIndex),
        ]);

        if (!messageItem) throw createChatMessageNotFoundError(chatId, messageIndex);

        const currentTime = new Date();

        const newPayload = computeDeleteMessageReaction({
            actorAccountId: context.actor.getPossiblyBotAccountId(),
            message: messageItem,
            contentVersion,
            pos,
        });

        const transactionEntry = ChatTable.transactionDirectlyUpdateItem({
            ...omitObject(messageItem, ["index", "version"]),
            partitionType: "Chat",
            sortRangeType: "Messages",
            chatId,
            messageIndex: messageItem.index,
            updateLockVersion: messageItem.version,
            payload: newPayload,
        });

        await DynamoTableSchema.executeTransaction(context, [
            transactionEntry,

            // Create-or-replace is safe because `eventTime`, `messageIndex`, and `version` are
            // all in the item key. So we won't be replacing any existing update item.
            ChatTable.transactionCreateOrReplaceItem({
                partitionType: "Chat",
                sortRangeType: "MessageUpdates",
                chatId,
                eventTime: currentTime,
                messageIndex: messageItem.index,
                version: transactionEntry.newItem.updateLockVersion ?? 0,
                expirationTime: addDays(currentTime, messagingEventExpirationDays),
            }),
        ]);

        return {
            version: transactionEntry.newItem.updateLockVersion ?? 0,
        };
    });
}

/**
 * Paginate through chat messages from start to finish.
 */
export async function getChatMessagesFromStart(
    context: ServerSessionActionContext,
    {
        chatId,
        limit,
        afterMessageIndex,
        beforeMessageIndex,
    }: {
        chatId: ChatId;
        limit: number;
        afterMessageIndex: number | null;
        beforeMessageIndex: number | null;
    },
): Promise<{
    messageCount: number;
    messages: Array<ChatMessageModel>;
    otherReferencedMessages: Array<ChatMessageModel>;
}> {
    const chatItemPromise = authorizeChatAccessAndReturnItem(context, chatId, "View");

    const [chatItem, {messages, otherReferencedMessages}] = await runAllPromises([
        chatItemPromise,
        getChatMessagesFromStartAssumingAuthorizedChat(context, {
            chatId,
            getSpaceId: () => chatItemPromise.then(({spaceId}) => spaceId),
            limit,
            afterMessageIndex,
            beforeMessageIndex,
        }),
    ]);

    const lastMessageIndex = messages.length > 0 ? messages[messages.length - 1]!.index : -1;

    return {
        messageCount: Math.max(
            getChatMessageCount(chatItem.messagesSummary),
            // Make sure `messageCount` is consistent with `messages` in case of eventual
            // consistency race conditions.
            lastMessageIndex + 1,
        ),
        messages,
        otherReferencedMessages,
    };
}

async function getChatMessagesFromStartAssumingAuthorizedChat(
    context: ServerActionContext,
    {
        chatId,
        getSpaceId,
        limit,
        afterMessageIndex,
        beforeMessageIndex,
        consistency = "Eventual",
    }: {
        chatId: ChatId;
        getSpaceId: () => Promise<SpaceId>;
        limit: number;
        afterMessageIndex: number | null;
        beforeMessageIndex: number | null;
        consistency?: DynamoCacheReadConsistency;
    },
): Promise<{
    messages: Array<ChatMessageModel>;
    otherReferencedMessages: Array<ChatMessageModel>;
}> {
    if (limit === 0) return {messages: [], otherReferencedMessages: []};

    const queryStartMessageIndex = Math.max(
        0,
        typeof afterMessageIndex === "number" ? afterMessageIndex + 1 : 0,
    );

    const queryEndMessageIndex = Math.min(
        queryStartMessageIndex + limit - 1,
        typeof beforeMessageIndex === "number" ? beforeMessageIndex - 1 : Number.MAX_SAFE_INTEGER,
    );

    const messageItems = await arrayFromAsyncIterable(
        runMessagesQuery(context, {
            cache: ChatMessageItemContextCache,
            cacheKeyPrefix: chatId,
            consistency,
            startIndex: queryStartMessageIndex,
            endIndex: queryEndMessageIndex,
            query: ({consistency, limit, startSortKey, endSortKey}) =>
                ChatTable.query(context, {
                    consistency,
                    limit,
                    partitionKey: {partitionType: "Chat", chatId},
                    startSortKey,
                    endSortKey,
                }),
        }),
    );

    if (messageItems.length === 0) return {messages: [], otherReferencedMessages: []};

    const startMessageIndex = messageItems[0]!.index;
    const endMessageIndex = messageItems[messageItems.length - 1]!.index;

    const spaceId = await getSpaceId();

    let otherReferencedMessagePromiseByIndex = new Map<number, Promise<void>>();
    const otherReferencedMessages: Array<ChatMessageModel> = [];

    const loadOtherReferencedMessageFromParent = (parent: MessageContentPayloadParent) => {
        for (const index of iterateMessageContentPayloadParentIndexes(parent)) {
            loadOtherReferencedMessage(index);
        }
    };

    const loadOtherReferencedMessage = (messageIndex: number) => {
        // If this message is already in our loaded messages range then we don't need to
        // load it again.
        if (startMessageIndex <= messageIndex && messageIndex <= endMessageIndex) return;

        const promise = getOrSetDefaultMapValue(
            otherReferencedMessagePromiseByIndex,
            messageIndex,
            async () => {
                const item = await getChatMessageItemIfExists(context, chatId, messageIndex, {
                    consistency,
                });
                if (!item) throw new InternalError("Parent message not found");

                // Recursively load any referenced parent messages...
                if (item.payload.type === "Content" && item.payload.parent !== null) {
                    loadOtherReferencedMessageFromParent(item.payload.parent);
                }

                otherReferencedMessages.push(
                    await createChatMessageModelFromItem(context, spaceId, chatId, item),
                );
            },
        );

        // We await this promise later.
        void promise;
    };

    const messages = await runAllPromises(
        messageItems.map(item => {
            if (item.payload.type === "Content" && item.payload.parent !== null) {
                loadOtherReferencedMessageFromParent(item.payload.parent);
            }

            // Don't propagate `consistency` when loading model references. We accept
            // references can have eventual consistency.
            return createChatMessageModelFromItem(context, spaceId, chatId, item);
        }),
    );

    // Keep loading other referenced messages until we have all of them. A referenced
    // message may itself reference more messages.
    while (otherReferencedMessagePromiseByIndex.size > 0) {
        const promises = Array.from(otherReferencedMessagePromiseByIndex.values());
        otherReferencedMessagePromiseByIndex = new Map();
        await runAllPromises(promises);
    }

    return {
        messages,
        otherReferencedMessages: otherReferencedMessages.sort(
            (message1, message2) => message1.index - message2.index,
        ),
    };
}

/**
 * Paginate through chat message payloads (doesn't load references) from start to
 * finish.
 */
export async function getChatMessagePayloadsFromStart(
    context: ServerActionContext,
    {
        chatId,
        limit,
        afterMessageIndex,
        beforeMessageIndex,
        consistency,
    }: {
        chatId: ChatId;
        limit: number;
        afterMessageIndex: number | null;
        beforeMessageIndex: number | null;
        consistency?: DynamoCacheReadConsistency;
    },
): Promise<{
    spaceId: SpaceId;
    messageCount: number;
    messages: Array<MessageItem>;
}> {
    const queryStartMessageIndex = Math.max(
        0,
        typeof afterMessageIndex === "number" ? afterMessageIndex + 1 : 0,
    );

    const queryEndMessageIndex = Math.min(
        queryStartMessageIndex + limit - 1,
        typeof beforeMessageIndex === "number" ? beforeMessageIndex - 1 : Number.MAX_SAFE_INTEGER,
    );

    const [chatItem, messageItems] = await runAllPromises([
        authorizeChatAccessAndReturnItem(context, chatId, "View", {consistency}),
        arrayFromAsyncIterable(
            runMessagesQuery(context, {
                cache: ChatMessageItemContextCache,
                cacheKeyPrefix: chatId,
                consistency,
                startIndex: queryStartMessageIndex,
                endIndex: queryEndMessageIndex,
                query: ({consistency, limit, startSortKey, endSortKey}) =>
                    ChatTable.query(context, {
                        consistency,
                        limit,
                        partitionKey: {partitionType: "Chat", chatId},
                        startSortKey,
                        endSortKey,
                    }),
            }),
        ),
    ]);

    const lastMessageIndex =
        messageItems.length > 0 ? messageItems[messageItems.length - 1]!.index : -1;

    return {
        spaceId: chatItem.spaceId,
        messageCount: Math.max(
            getChatMessageCount(chatItem.messagesSummary),
            // Make sure `messageCount` is consistent with `messages` in case of eventual
            // consistency race conditions.
            lastMessageIndex + 1,
        ),
        messages: messageItems,
    };
}

/**
 * Paginate through chat messages from finish to start.
 */
export async function getChatMessagesFromEnd(
    context: ServerSessionActionContext,
    {
        chatId,
        limit,
        afterMessageIndex,
        beforeMessageIndex,
    }: {
        chatId: ChatId;
        limit: number;
        afterMessageIndex: number | null;
        beforeMessageIndex: number | null;
    },
): Promise<{
    messageCount: number;
    messages: Array<ChatMessageModel>;
    otherReferencedMessages: Array<ChatMessageModel>;
}> {
    const chatItemPromise = authorizeChatAccessAndReturnItem(context, chatId, "View");

    const [chatItem, {messages, otherReferencedMessages}] = await runAllPromises([
        chatItemPromise,
        dangerouslyGetChatMessagesFromEndAssumingAuthorizedChat(context, {
            chatId,
            chatItemPromise: chatItemPromise.then(chatItem => ({
                spaceId: chatItem.spaceId,
                messageCount: getChatMessageCount(chatItem.messagesSummary),
            })),
            limit,
            afterMessageIndex,
            beforeMessageIndex,
        }),
    ]);

    const lastMessageIndex = messages.length > 0 ? messages[messages.length - 1]!.index : -1;

    return {
        messageCount: Math.max(
            getChatMessageCount(chatItem.messagesSummary),
            // Make sure `messageCount` is consistent with `messages` in case of eventual
            // consistency race conditions.
            lastMessageIndex + 1,
        ),
        messages,
        otherReferencedMessages,
    };
}

export async function dangerouslyGetChatMessagesFromEndAssumingAuthorizedChat(
    context: ServerActionContext,
    {
        chatId,
        chatItemPromise,
        limit,
        afterMessageIndex,
        beforeMessageIndex,
    }: {
        chatId: ChatId;
        chatItemPromise: Promise<{spaceId: SpaceId; messageCount: number}>;
        limit: number;
        afterMessageIndex: number | null;
        beforeMessageIndex: number | null;
    },
): Promise<{
    messages: Array<ChatMessageModel>;
    otherReferencedMessages: Array<ChatMessageModel>;
}> {
    if (limit === 0) return {messages: [], otherReferencedMessages: []};

    const queryEndMessageIndex = Math.min(
        (await chatItemPromise).messageCount - 1,
        typeof beforeMessageIndex === "number" ? beforeMessageIndex - 1 : Number.MAX_SAFE_INTEGER,
    );

    const queryStartMessageIndex = Math.max(
        queryEndMessageIndex - limit + 1,
        typeof afterMessageIndex === "number" ? afterMessageIndex + 1 : 0,
    );

    const messageItems = await arrayFromAsyncIterable(
        typeof beforeMessageIndex !== "number" || beforeMessageIndex > 0
            ? runMessagesQuery(context, {
                  cache: ChatMessageItemContextCache,
                  cacheKeyPrefix: chatId,
                  consistency: undefined,
                  startIndex: queryStartMessageIndex,
                  endIndex: queryEndMessageIndex,
                  query: ({consistency, limit, startSortKey, endSortKey}) =>
                      ChatTable.query(context, {
                          consistency,
                          limit,
                          partitionKey: {partitionType: "Chat", chatId},
                          startSortKey,
                          endSortKey,
                      }),
              })
            : (async function* () {})(),
    );

    if (messageItems.length === 0) return {messages: [], otherReferencedMessages: []};

    const startMessageIndex = messageItems[0]!.index;
    const endMessageIndex = messageItems[messageItems.length - 1]!.index;

    const {spaceId} = await chatItemPromise;

    let otherReferencedMessagePromiseByIndex = new Map<number, Promise<void>>();
    const otherReferencedMessages: Array<ChatMessageModel> = [];

    const loadOtherReferencedMessageFromParent = (parent: MessageContentPayloadParent) => {
        for (const index of iterateMessageContentPayloadParentIndexes(parent)) {
            loadOtherReferencedMessage(index);
        }
    };

    const loadOtherReferencedMessage = (messageIndex: number) => {
        // If this message is already in our loaded messages range then we don't need to
        // load it again.
        if (startMessageIndex <= messageIndex && messageIndex <= endMessageIndex) return;

        const promise = getOrSetDefaultMapValue(
            otherReferencedMessagePromiseByIndex,
            messageIndex,
            async () => {
                const item = await getChatMessageItemIfExists(context, chatId, messageIndex);
                if (!item) throw new InternalError("Parent message not found");

                // Recursively load any referenced parent messages...
                if (item.payload.type === "Content" && item.payload.parent !== null) {
                    loadOtherReferencedMessageFromParent(item.payload.parent);
                }

                otherReferencedMessages.push(
                    await createChatMessageModelFromItem(context, spaceId, chatId, item),
                );
            },
        );

        // We await this promise later.
        void promise;
    };

    const messages = await runAllPromises(
        messageItems.map(item => {
            if (item.payload.type === "Content" && item.payload.parent !== null) {
                loadOtherReferencedMessageFromParent(item.payload.parent);
            }
            return createChatMessageModelFromItem(context, spaceId, chatId, item);
        }),
    );

    // Keep loading other referenced messages until we have all of them. A referenced
    // message may itself reference more messages.
    while (otherReferencedMessagePromiseByIndex.size > 0) {
        const promises = Array.from(otherReferencedMessagePromiseByIndex.values());
        otherReferencedMessagePromiseByIndex = new Map();
        await runAllPromises(promises);
    }

    return {
        messages,
        otherReferencedMessages: otherReferencedMessages.sort(
            (message1, message2) => message1.index - message2.index,
        ),
    };
}

/**
 * Paginate through chat message payloads (doesn't load references) from finish to
 * start.
 */
export async function getChatMessagePayloadsFromEnd(
    context: ServerActionContext,
    {
        chatId,
        limit,
        afterMessageIndex,
        beforeMessageIndex,
        consistency,
    }: {
        chatId: ChatId;
        limit: number;
        afterMessageIndex: number | null;
        beforeMessageIndex: number | null;
        consistency?: DynamoCacheReadConsistency;
    },
): Promise<{
    spaceId: SpaceId;
    messageCount: number;
    messages: Array<MessageItem>;
}> {
    const chatItemPromise = authorizeChatAccessAndReturnItem(context, chatId, "View", {
        consistency,
    });

    const queryEndMessageIndex = Math.min(
        getChatMessageCount((await chatItemPromise).messagesSummary) - 1,
        typeof beforeMessageIndex === "number" ? beforeMessageIndex - 1 : Number.MAX_SAFE_INTEGER,
    );

    const queryStartMessageIndex = Math.max(
        queryEndMessageIndex - limit + 1,
        typeof afterMessageIndex === "number" ? afterMessageIndex + 1 : 0,
    );

    const [chatItem, messageItems] = await runAllPromises([
        chatItemPromise,
        arrayFromAsyncIterable(
            runMessagesQuery(context, {
                cache: ChatMessageItemContextCache,
                cacheKeyPrefix: chatId,
                consistency,
                startIndex: queryStartMessageIndex,
                endIndex: queryEndMessageIndex,
                query: ({consistency, limit, startSortKey, endSortKey}) =>
                    ChatTable.query(context, {
                        consistency,
                        limit,
                        partitionKey: {partitionType: "Chat", chatId},
                        startSortKey,
                        endSortKey,
                    }),
            }),
        ),
    ]);

    const lastMessageIndex =
        messageItems.length > 0 ? messageItems[messageItems.length - 1]!.index : -1;

    return {
        spaceId: chatItem.spaceId,
        messageCount: Math.max(
            getChatMessageCount(chatItem.messagesSummary),
            // Make sure `messageCount` is consistent with `messages` in case of eventual
            // consistency race conditions.
            lastMessageIndex + 1,
        ),
        messages: messageItems,
    };
}

/**
 * Backfills any missing messages or message updates for a client. The client
 * provides what it knows to be the message count and last change time then we
 * return any new messages or changes since then.
 *
 * We run this when the client establishes a new realtime connection to catch the
 * client up between their last data load and the time the realtime connection was
 * established.
 *
 * `newMessageLimit` allows you to load some new comments that the client may be
 * missing but only up to the limit.
 *
 * We do not keep a log of chat message changes around forever, so it's possible
 * that you get an `Unavailable` result for `messageChangesResult`. When this
 * happens you should throw away all data your client has loaded and try loading
 * the data again.
 */
export async function backfillChatMessages(
    context: ServerSessionActionContext,
    {
        chatId,
        checkpoint,
        clientMessageCount,
        newMessageLimit,
    }: {
        chatId: ChatId;
        checkpoint: ServerSynchronizationCheckpoint;
        clientMessageCount: number;
        newMessageLimit: number;
    },
): Promise<{
    messageCount: number;
    newMessages: Array<ChatMessageModel>;
    newOtherReferencedMessages: Array<ChatMessageModel>;
    messageUpdatesResult: MessageUpdatesBackfillResult<ChatMessageModel>;
}> {
    const chatItemPromise = authorizeChatAccessAndReturnItem(context, chatId, "View");

    const [chatItem, {messages, otherReferencedMessages}, messageUpdatesResult] =
        await runAllPromises([
            chatItemPromise,
            getChatMessagesFromStartAssumingAuthorizedChat(context, {
                chatId,
                getSpaceId: () => chatItemPromise.then(({spaceId}) => spaceId),
                limit: newMessageLimit,
                afterMessageIndex: clientMessageCount - 1,
                beforeMessageIndex: null,
                // Use a strong read consistency when backfilling. This guarantees the caller will
                // observe all realtime events before this function call. Realtime events that
                // happen during the function call may be missed. You should be subscribed to new
                // realtime events before starting to backfill.
                consistency: "Strong",
            }),
            runBackfillMessageUpdates(context, {
                checkpoint,
                queryMessageUpdates: (context, options) =>
                    ChatTable.query(context, {
                        partitionKey: {partitionType: "Chat", chatId},
                        ...options,
                    }),
                getMessageIfExists: (context, messageIndex, options) =>
                    getChatMessageItemIfExists(context, chatId, messageIndex, options),
                createMessageModelFromItem: async (context, item) => {
                    const {spaceId} = await chatItemPromise;
                    return await createChatMessageModelFromItem(context, spaceId, chatId, item);
                },
            }),
        ]);

    const lastMessageIndex = messages.length > 0 ? messages[messages.length - 1]!.index : -1;

    return {
        messageCount: Math.max(
            getChatMessageCount(chatItem.messagesSummary),
            // Make sure `messageCount` is consistent with `messages` in case of eventual
            // consistency race conditions.
            lastMessageIndex + 1,
        ),
        newMessages: messages,
        newOtherReferencedMessages: otherReferencedMessages,
        messageUpdatesResult,
    };
}

export async function getChatMessageParentContent(
    context: ServerActionContext,
    chatId: ChatId,
    {
        parent,
        consistency,
    }: {parent: MessageContentPayloadParent; consistency?: DynamoCacheReadConsistency},
): Promise<{content: MessageContent; authorId: AccountId}> {
    await authorizeChatAccess(context, chatId, "View", {consistency});

    const messageNoun = "message";

    switch (parent.type) {
        case "Message": {
            const message = await getChatMessageItem(context, chatId, parent.index, {consistency});

            return {
                authorId: message.authorId,
                content:
                    message.payload.type === "Content"
                        ? cutMessageContentPayload({
                              payload: message.payload,
                              stream: message.stream,
                          })
                        : createSimpleMessageContent(`Deleted ${messageNoun}`),
            };
        }
        case "MessagesRange": {
            const messageItems = await arrayFromAsyncIterable(
                runMessagesQuery(context, {
                    cache: ChatMessageItemContextCache,
                    cacheKeyPrefix: chatId,
                    consistency,
                    startIndex: parent.startIndex,
                    endIndex: parent.endIndex,
                    query: ({consistency, limit, startSortKey, endSortKey}) =>
                        ChatTable.query(context, {
                            consistency,
                            limit,
                            partitionKey: {partitionType: "Chat", chatId},
                            startSortKey,
                            endSortKey,
                        }),
                }),
            );

            validateMessageContentPayloadMessagesRangeParent(parent, messageItems, {
                allowDeletedMessagesForStartAndEndMessages: true,
            });

            return {
                // `validateMessageContentPayloadMessagesRangeParent()` guarantees that all
                // messages have the same author and the list is not empty.
                authorId: messageItems[0]!.authorId,
                content: getTruncatedParentMessagesRangeContentWithoutReferences({
                    messages: messageItems,
                    messageNoun,
                    startContentVersion: parent.startContentVersion,
                    startPos: parent.startPos,
                    endContentVersion: parent.endContentVersion,
                    endPos: parent.endPos,
                }),
            };
        }
        case "PostRange": {
            throw new InvalidArgumentError("Post range parent can only be used with post comments");
        }
        default:
            throw exhaustive(parent);
    }
}
