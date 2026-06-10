import {
    applyMentionCountByAccountIdDifferenceFromContentUpdate,
    getMentionedAccountIdsInContent,
} from "~/server/content/get_mentioned_account_ids_in_content.js";
import {ServerAccountActionContext} from "~/server/context/server_action_context.js";
import {DynamoCacheReadConsistency} from "~/server/dynamo/core/dynamo_read_consistency.js";
import {DynamoTableSchema} from "~/server/dynamo/core/dynamo_table_schema.js";
import {getFileFromAttachment} from "~/server/files/data/files_actions.js";
import {messageStreamIndexSearchEntityDelaySeconds} from "~/server/messaging/helpers/message_stream_index_search_entity_delay_seconds.js";
import {runCommentsQuery} from "~/server/messaging/helpers/run_comments_query.js";
import {validateMessageContentPayloadMessagesRangeParent} from "~/server/messaging/helpers/validate_message_content_payload_messages_range_parent.js";
import {getNotificationMessageContentSnippet} from "~/server/notifications/core/get_notification_content_snippet.js";
import {markSearchAffinityEntityInteraction} from "~/server/search/data/table/search_entity_actions.js";
import {isAccountMemberOfSpace} from "~/server/spaces/is_account_member_of_space.js";
import {FileTaskAuthorizer} from "~/server/tasks/data/authorization/file_task_authorizer.js";
import {authorizeTaskAccessAndGetCommentsSummaryItem} from "~/server/tasks/data/internal/authorize_task_item_access.js";
import {TaskCommentItemContextCache} from "~/server/tasks/data/internal/get_task_comment_item.js";
import {TaskTable} from "~/server/tasks/data/internal/task_table.js";
import {getSiteIdFromAccessPolicyIfExists} from "~/shared/access/get_site_id_from_access_policy_if_exists.js";
import {ApiBotWebhookNewMessageEventParent} from "~/shared/api/specification/types/api_specification_convenience_types.js";
import {isContentEmpty} from "~/shared/content/is_content_empty.js";
import {MessageContent} from "~/shared/content/message_content_schema.js";
import {InvalidArgumentError, PermissionDeniedError} from "~/shared/error/error.js";
import {FileEntityId} from "~/shared/files/file_entity_id.js";
import {runAllPromiseThunks, runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {TimeZone} from "~/shared/helpers/intl/time_zone.js";
import {arrayFromAsyncIterable} from "~/shared/helpers/iterable/array_from_async_iterable.js";
import {emptyMap} from "~/shared/helpers/map/empty_map.js";
import {isTestNodeEnvOrAdminScenariosScript} from "~/shared/helpers/test/is_test_node_env_or_admin_scenarios_script.js";
import {generateChronologicalId} from "~/shared/id/chronological_id.js";
import {isId} from "~/shared/id/id.js";
import {FileId, SpaceId, TaskId} from "~/shared/id/types/id_types.js";
import {MessageContentPayloadParent} from "~/shared/messaging/message_schema.js";
import {emptyReactionSet} from "~/shared/reactions/reaction_set.js";

export async function createTaskComment(
    context: ServerAccountActionContext,
    {
        taskId,
        parent,
        content,
        fileIds,
        createdTimeZone,
        overrideCreatedTimeForTest,
        isStream,
        consistency,
    }: {
        taskId: TaskId;
        parent: MessageContentPayloadParent | null;
        content: MessageContent;
        fileIds: ReadonlyArray<FileId | FileEntityId>;
        createdTimeZone: TimeZone;
        overrideCreatedTimeForTest?: Date;
        isStream?: boolean;
        consistency?: DynamoCacheReadConsistency;
    },
): Promise<{
    spaceId: SpaceId;
    index: number;
    createdTime: Date;
}> {
    if (overrideCreatedTimeForTest) {
        assert(isTestNodeEnvOrAdminScenariosScript);
    }

    return await context.dynamo.retryTransaction(async context => {
        const [{spaceId, commentsSummaryItem, taskAccessPolicy}, parentForEvent] =
            await runAllPromiseThunks(
                async () => {
                    const {item, commentsSummaryItem} =
                        await authorizeTaskAccessAndGetCommentsSummaryItem(
                            context,
                            taskId,
                            "Comment",
                            {
                                consistency,
                            },
                        );
                    const spaceId = item.spaceId;
                    const taskAccessPolicy = item.accessPolicy?.value ?? null;

                    // Make sure all the provided files exist.
                    await runAllPromises(
                        fileIds.map(fileId =>
                            isId<FileId>(fileId)
                                ? getFileFromAttachment(
                                      context,
                                      fileId,
                                      FileTaskAuthorizer.bind({type: "TaskComments", taskId}),
                                      {consistency},
                                  )
                                : null,
                        ),
                    );

                    return {spaceId, commentsSummaryItem, taskAccessPolicy};
                },
                async (): Promise<ApiBotWebhookNewMessageEventParent | null> => {
                    if (!parent) return null;

                    switch (parent.type) {
                        case "Message": {
                            const commentItem = await TaskTable.getItem(
                                context,
                                {
                                    partitionType: "Task",
                                    sortRangeType: "Comments",
                                    taskId,
                                    commentIndex: parent.index,
                                },
                                {consistency},
                            );
                            return {
                                type: "Message",
                                index: parent.index,
                                author: {id: commentItem.authorId},
                            };
                        }
                        case "MessagesRange": {
                            const commentItems = await arrayFromAsyncIterable(
                                runCommentsQuery(context, {
                                    cache: TaskCommentItemContextCache,
                                    cacheKeyPrefix: taskId,
                                    consistency,
                                    startIndex: parent.startIndex,
                                    endIndex: parent.endIndex,
                                    query: ({consistency, limit, startSortKey, endSortKey}) =>
                                        TaskTable.query(context, {
                                            consistency,
                                            limit,
                                            partitionKey: {partitionType: "Task", taskId},
                                            startSortKey,
                                            endSortKey,
                                        }),
                                }),
                            );

                            validateMessageContentPayloadMessagesRangeParent(parent, commentItems);

                            return {
                                type: "Message",
                                index: parent.startIndex,
                                author: {id: commentItems[0]!.authorId},
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
                },
            );

        // NOTE(calebmer): Using `Date.now()` allows our Jest tests to mock `Date.now()`
        // and override the time that is returned.
        const currentTime = new Date(Date.now());

        const createdTime = overrideCreatedTimeForTest ?? currentTime;

        // If this is a stream message and we have empty content then we only send a
        // notification event after the first content part has finished.
        const willSendNotificationEvent = !isStream || !isContentEmpty(content);

        const commentIndex = commentsSummaryItem?.nextCommentIndex ?? 0;
        const authorId = context.actor.getPossiblyBotAccountId();

        if (isStream && context.actor.type !== "Bot") {
            throw new PermissionDeniedError("Only bots can send `Stream` messages");
        }

        const newCommentCountByAuthorId = new Map(commentsSummaryItem?.commentCountByAuthorId);
        newCommentCountByAuthorId.set(authorId, (newCommentCountByAuthorId.get(authorId) ?? 0) + 1);

        const newMentionCountByAccountId = applyMentionCountByAccountIdDifferenceFromContentUpdate(
            commentsSummaryItem?.mentionCountByAccountId ?? new Map(),
            null,
            content,
        );

        await DynamoTableSchema.executeTransaction(context, [
            TaskTable.transactionCreateItem(
                {
                    partitionType: "Task",
                    sortRangeType: "Comments",
                    taskId,
                    commentIndex,
                    authorId,
                    createdTime,
                    createdTimeZone,
                    payload: {
                        type: "Content",
                        parent,
                        content,
                        contentUpdate: null,
                        fileIds,
                        clerical: isStream ? {type: "Stream"} : undefined,
                        reactionsByPos: emptyMap,
                        filesReactions: emptyReactionSet,
                    },
                },
                // Retry in case of a race condition where another process writes to this
                // `commentIndex` before us.
                {isConditionCheckErrorRetriable: true},
            ),
            commentsSummaryItem !== null
                ? TaskTable.transactionDirectlyUpdateItem({
                      ...commentsSummaryItem,
                      nextCommentIndex: commentsSummaryItem.nextCommentIndex + 1,
                      commentCountByAuthorId: newCommentCountByAuthorId,
                      mentionCountByAccountId: newMentionCountByAccountId,
                      updateLockVersion: commentsSummaryItem.updateLockVersion,
                  })
                : TaskTable.transactionCreateItem(
                      {
                          partitionType: "Task",
                          sortRangeType: "CommentsSummary",
                          taskId,
                          nextCommentIndex: commentIndex + 1,
                          commentCountByAuthorId: newCommentCountByAuthorId,
                          mentionCountByAccountId: newMentionCountByAccountId,
                      },
                      // Retry in case of a race condition where another process writes to this
                      // `commentIndex` before us.
                      {isConditionCheckErrorRetriable: true},
                  ),

            // If this is a stream comment then create the stream state item. Create-or-replace
            // is safe since we know the comment index doesn't exist from our other condition
            // checks.
            ...(isStream
                ? [
                      TaskTable.transactionCreateOrReplaceItem({
                          partitionType: "Task",
                          sortRangeType: "Comments#Stream",
                          taskId,
                          commentIndex,
                          authorId,
                          createdTime,
                          createdTimeZone,
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
        ]);

        const mentionedAccountIds = getMentionedAccountIdsInContent(content);
        const contentSnippet = getNotificationMessageContentSnippet(content);

        if (willSendNotificationEvent) {
            context.jobs.send({
                type: "NotificationEvent",
                event: {
                    type: "CreateTaskComment",
                    id: generateChronologicalId(),
                    spaceId: spaceId,
                    taskId,
                    commentIndex,
                    createdTime,
                    createdTimeZone,
                    authorId,
                    mentionedAccountIds,
                    parent: parentForEvent,
                    isContentSnippetComplete: contentSnippet.nodeSize === content.nodeSize,
                    contentSnippet,
                },
            });
        }

        context.jobs.send(
            {
                type: "IndexSearchEntity",
                spaceId: spaceId,
                update: {
                    type: "TaskComment",
                    taskId,
                    commentIndex,
                    updatedTraits: {type: "None"},
                },
            },
            {delaySeconds: isStream ? messageStreamIndexSearchEntityDelaySeconds : 0},
        );

        // Only increase affinity score if we have a session actor. Don't increase affinity
        // score if this is a system actor sending a message on behalf of an account.
        if (context.actor.type === "Session") {
            const sessionContext = context.actor.authorizeSession();

            context.process.waitUntil(
                markSearchAffinityEntityInteraction(sessionContext, {
                    spaceId: spaceId,
                    entityId: `Task:${taskId}`,
                    interaction:
                        content.nodeSize < 50
                            ? {type: "LowIntentUpdate"}
                            : {type: "MediumIntentUpdate"},
                    siteId: taskAccessPolicy
                        ? getSiteIdFromAccessPolicyIfExists(taskAccessPolicy)
                        : null,
                }),
            );

            for (const mentionedAccountId of mentionedAccountIds) {
                context.process.waitUntil(async () => {
                    if (await isAccountMemberOfSpace(context, spaceId, mentionedAccountId)) {
                        await markSearchAffinityEntityInteraction(sessionContext, {
                            spaceId: spaceId,
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
            spaceId,
            index: commentIndex,
            createdTime,
        };
    });
}
