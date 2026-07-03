import {addDays} from "date-fns";
import {Step} from "prosemirror-transform";
import {getContentReferencesAssumingViewAccessWithOptionalSpaceAccess} from "~/server/content/get_content_references_assuming_view_access_with_optional_space_access.js";
import {
    applyMentionCountByAccountIdDifferenceFromContentUpdate,
    getMentionedAccountIdsInContent,
} from "~/server/content/get_mentioned_account_ids_in_content.js";
import {
    ServerAccountActionContext,
    ServerActionContext,
} from "~/server/context/server_action_context.js";
import {ServerSessionActionContextWithPush} from "~/server/context/server_session_action_context_with_push.js";
import {DynamoContext} from "~/server/dynamo/core/dynamo_context.js";
import {DynamoContextCache} from "~/server/dynamo/core/dynamo_context_cache.js";
import {
    DynamoCacheReadConsistency,
    DynamoReadConsistency,
} from "~/server/dynamo/core/dynamo_read_consistency.js";
import {DynamoTableSchema} from "~/server/dynamo/core/dynamo_table_schema.js";
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
import {runCommentsQuery} from "~/server/messaging/helpers/run_comments_query.js";
import {validateMessageContentPayloadMessagesRangeParent} from "~/server/messaging/helpers/validate_message_content_payload_messages_range_parent.js";
import {getNotificationMessageContentSnippet} from "~/server/notifications/core/get_notification_content_snippet.js";
import {NotificationEvent} from "~/server/notifications/core/notification_event.js";
import {markSearchAffinityEntityInteraction} from "~/server/search/data/table/search_entity_actions.js";
import {authorizeOwnSpaceAccountAccess} from "~/server/spaces/authorize_own_space_account_access.js";
import {getAccount} from "~/server/spaces/get_account.js";
import {isAccountMemberOfSpace} from "~/server/spaces/is_account_member_of_space.js";
import {authorizeTaskAccess} from "~/server/tasks/data/authorization/authorize_task_access.js";
import {FileTaskAuthorizer} from "~/server/tasks/data/authorization/file_task_authorizer.js";
import {
    authorizeTaskAccessAndGetCommentsSummaryAndNotesItemsIfExists,
    authorizeTaskAccessAndGetCommentsSummaryItem,
    authorizeTaskItemAccessIfPossible,
    getTaskCollectionItemForAuthorization,
    getTaskItemForAuthorization,
} from "~/server/tasks/data/internal/authorize_task_item_access.js";
import {
    TaskCommentsSummaryItem,
    TaskEssentialAttributesItemBase,
    TaskTable,
} from "~/server/tasks/data/internal/task_table.js";
import {getSiteIdFromAccessPolicyIfExists} from "~/shared/access/get_site_id_from_access_policy_if_exists.js";
import {ApiBotWebhookNewMessageEventParent} from "~/shared/api/specification/types/api_specification_convenience_types.js";
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
import {FileEntityId} from "~/shared/files/file_entity_id.js";
import {createPromiseResolver} from "~/shared/helpers/async/promise_resolver.js";
import {runAllPromiseThunks, runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {unwrapResult} from "~/shared/helpers/control/capture_result.js";
import {captureResultPromise} from "~/shared/helpers/control/capture_result_promise.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {mapResult} from "~/shared/helpers/control/map_result.js";
import {TimeZone} from "~/shared/helpers/intl/time_zone.js";
import {arrayFromAsyncIterable} from "~/shared/helpers/iterable/array_from_async_iterable.js";
import {sumIterable} from "~/shared/helpers/iterable/sum_iterable.js";
import {emptyMap} from "~/shared/helpers/map/empty_map.js";
import {getOrSetDefaultMapValue} from "~/shared/helpers/map/get_or_set_default_map_value.js";
import {omitObject} from "~/shared/helpers/object/omit_object.js";
import {isTestNodeEnvOrAdminScenariosScript} from "~/shared/helpers/test/is_test_node_env_or_admin_scenarios_script.js";
import {generateChronologicalId} from "~/shared/id/chronological_id.js";
import {isId} from "~/shared/id/id.js";
import {AccountId, FileId, SiteId, SpaceId, TaskId} from "~/shared/id/types/id_types.js";
import {computeDeleteMessageReaction} from "~/shared/messaging/compute_delete_message_reaction.js";
import {computeSetMessageReaction} from "~/shared/messaging/compute_set_message_reaction.js";
import {cutMessageContentPayload} from "~/shared/messaging/cut_message_content_payload.js";
import {getTruncatedParentMessagesRangeContentWithoutReferences} from "~/shared/messaging/get_truncated_parent_message_range_content_with_references.js";
import {
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
import {TaskCommentModel} from "~/shared/tasks/model/task_comment_model.js";
import {
    createTaskCommentNotFoundError,
    createTaskNotFoundError,
} from "~/shared/tasks/task_error_messages.js";
import {
    TaskNotesContentWithReferences,
    emptyTaskNotesContent,
} from "~/shared/tasks/task_notes_content_schema.js";
import {
    ServerSynchronizationCheckpoint,
    generateServerSynchronizationCheckpoint,
} from "~/shared/web_socket/server_synchronization_checkpoint.js";

export async function getTaskComment(
    context: ServerActionContext,
    {taskId, commentIndex}: {taskId: TaskId; commentIndex: number},
): Promise<TaskCommentModel> {
    const [{spaceId}, item] = await runAllPromises([
        authorizeTaskAccess(context, taskId, "Comment"),
        getTaskCommentItemIfExists(context, taskId, commentIndex),
    ]);

    if (!item) throw createTaskCommentNotFoundError(taskId, commentIndex);

    return await createTaskCommentModelFromItem(context, spaceId, taskId, item);
}

export async function getTaskCommentAtVersion(
    context: ServerActionContext,
    {taskId, commentIndex, version}: {taskId: TaskId; commentIndex: number; version: number},
): Promise<TaskCommentModel> {
    const [{spaceId}, item] = await runAllPromises([
        authorizeTaskAccess(context, taskId, "View"),
        (async () => {
            let item = await getTaskCommentItemIfExists(context, taskId, commentIndex, {
                consistency: "Eventual",
            });

            if (!item || item.version < version) {
                item = await getTaskCommentItemIfExists(context, taskId, commentIndex, {
                    consistency: "Strong",
                });
            }

            if (!item) {
                throw createTaskCommentNotFoundError(taskId, commentIndex);
            }

            if (item.version < version) {
                throw new FailedPreconditionError("Can\u2019t get message at a future version");
            }

            return item;
        })(),
    ]);

    return await createTaskCommentModelFromItem(context, spaceId, taskId, item);
}

export async function getTaskCommentPayload(
    context: ServerActionContext,
    {
        taskId,
        commentIndex,
        consistency = "Eventual",
    }: {
        taskId: TaskId;
        commentIndex: number;
        consistency?: DynamoCacheReadConsistency;
    },
): Promise<MessageItem & {spaceId: SpaceId}> {
    const [{spaceId}, item] = await runAllPromises([
        authorizeTaskAccess(context, taskId, "Comment", null, {consistency}),
        getTaskCommentItemIfExists(context, taskId, commentIndex, {consistency}),
    ]);

    if (!item) throw createTaskCommentNotFoundError(taskId, commentIndex);

    return {spaceId, ...item};
}

export async function backfillTaskComments(
    context: ServerActionContext,
    {
        taskId,
        checkpoint,
        clientCommentCount,
        newCommentLimit,
    }: {
        taskId: TaskId;
        checkpoint: ServerSynchronizationCheckpoint;
        clientCommentCount: number;
        newCommentLimit: number;
    },
): Promise<{
    commentCount: number;
    newComments: Array<TaskCommentModel>;
    newOtherReferencedComments: Array<TaskCommentModel>;
    commentUpdatesResult: MessageUpdatesBackfillResult<TaskCommentModel>;
}> {
    const authorizationPromise = authorizeTaskAccessAndGetCommentsSummaryItem(
        context,
        taskId,
        "Comment",
    );
    const [{commentsSummaryItem}, {comments, otherReferencedComments}, commentUpdatesResult] =
        await runAllPromises([
            authorizationPromise,
            getTaskCommentsFromStartAssumingAuthorizedTask(context, {
                taskId,
                getSpaceId: () => authorizationPromise.then(({item}) => item.spaceId),
                limit: newCommentLimit,
                afterCommentIndex: clientCommentCount - 1,
                beforeCommentIndex: null,
                // Use a strong read consistency when backfilling. This guarantees the caller will
                // observe all realtime events before this function call. Realtime events that
                // happen during the function call may be missed. You should be subscribed to new
                // realtime events before starting to backfill.
                consistency: "Strong",
            }),
            runBackfillMessageUpdates(context, {
                checkpoint,
                queryMessageUpdates: (context, options) =>
                    TaskTable.query(context, {
                        partitionKey: {partitionType: "Task", taskId},
                        ...options,
                    }),
                getMessageIfExists: (context, messageIndex, options) =>
                    getTaskCommentItemIfExists(context, taskId, messageIndex, options),
                createMessageModelFromItem: async (context, item) => {
                    const {
                        item: {spaceId},
                    } = await authorizationPromise;
                    return await createTaskCommentModelFromItem(context, spaceId, taskId, item);
                },
            }),
        ]);

    const lastCommentIndex = comments.length > 0 ? comments[comments.length - 1]!.index : -1;

    return {
        commentCount: Math.max(
            getTaskCommentCount(commentsSummaryItem),
            // Make sure `commentCount` is consistent with `comments` in case of eventual
            // consistency race conditions.
            lastCommentIndex + 1,
        ),
        newComments: comments,
        newOtherReferencedComments: otherReferencedComments,
        commentUpdatesResult,
    };
}

export async function getTaskCommentsFromStart(
    context: ServerActionContext,
    {
        taskId,
        limit,
        afterCommentIndex,
        beforeCommentIndex,
    }: {
        taskId: TaskId;
        limit: number;
        afterCommentIndex: number | null;
        beforeCommentIndex: number | null;
    },
): Promise<{
    commentCount: number;
    comments: Array<TaskCommentModel>;
    otherReferencedComments: Array<TaskCommentModel>;
}> {
    const authorizationPromise = authorizeTaskAccessAndGetCommentsSummaryItem(
        context,
        taskId,
        "Comment",
    );

    const [{commentsSummaryItem}, {comments, otherReferencedComments}] = await runAllPromises([
        authorizationPromise,
        getTaskCommentsFromStartAssumingAuthorizedTask(context, {
            taskId,
            getSpaceId: () => authorizationPromise.then(({item}) => item.spaceId),
            limit,
            afterCommentIndex,
            beforeCommentIndex,
        }),
    ]);
    const lastCommentIndex = comments.length > 0 ? comments[comments.length - 1]!.index : -1;

    return {
        commentCount: Math.max(
            getTaskCommentCount(commentsSummaryItem),
            // Make sure `commentCount` is consistent with `comments` in case of eventual
            // consistency race conditions.
            lastCommentIndex + 1,
        ),
        comments,
        otherReferencedComments,
    };
}

export async function getTaskCommentsFromEnd(
    context: ServerActionContext,
    {
        taskId,
        limit,
        afterCommentIndex,
        beforeCommentIndex,
    }: {
        taskId: TaskId;
        limit: number;
        afterCommentIndex: number | null;
        beforeCommentIndex: number | null;
    },
): Promise<{
    commentCount: number;
    comments: Array<TaskCommentModel>;
    otherReferencedComments: Array<TaskCommentModel>;
}> {
    const authorizationPromise = authorizeTaskAccessAndGetCommentsSummaryItem(
        context,
        taskId,
        "Comment",
    );

    const [{commentsSummaryItem}, {comments, otherReferencedComments}] = await runAllPromises([
        authorizationPromise,
        getTaskCommentsFromEndAssumingAuthorizedTask(context, {
            taskId,
            authorizationPromise,
            limit,
            afterCommentIndex,
            beforeCommentIndex,
        }),
    ]);

    const lastCommentIndex = comments.length > 0 ? comments[comments.length - 1]!.index : -1;

    return {
        commentCount: Math.max(
            getTaskCommentCount(commentsSummaryItem),
            // Make sure `commentCount` is consistent with `comments` in case of eventual
            // consistency race conditions.
            lastCommentIndex + 1,
        ),
        comments,
        otherReferencedComments,
    };
}

export async function getTaskCommentPayloadsFromStart(
    context: ServerActionContext,
    {
        taskId,
        limit,
        afterCommentIndex,
        beforeCommentIndex,
        consistency,
    }: {
        taskId: TaskId;
        limit: number;
        afterCommentIndex: number | null;
        beforeCommentIndex: number | null;
        consistency?: DynamoCacheReadConsistency;
    },
): Promise<{
    spaceId: SpaceId;
    commentCount: number;
    comments: Array<MessageItem>;
}> {
    const queryStartCommentIndex =
        typeof afterCommentIndex === "number" ? afterCommentIndex + 1 : 0;

    const queryEndCommentIndex = Math.min(
        queryStartCommentIndex + limit - 1,
        typeof beforeCommentIndex === "number" ? beforeCommentIndex - 1 : Number.MAX_SAFE_INTEGER,
    );

    const [{item: taskItem, commentsSummaryItem}, commentItems] = await runAllPromises([
        authorizeTaskAccessAndGetCommentsSummaryItem(context, taskId, "Comment", {consistency}),
        arrayFromAsyncIterable(
            runCommentsQuery(context, {
                cache: TaskCommentItemContextCache,
                cacheKeyPrefix: taskId,
                consistency,
                startIndex: queryStartCommentIndex,
                endIndex: queryEndCommentIndex,
                query: ({consistency, limit, startSortKey, endSortKey}) =>
                    TaskTable.query(context, {
                        consistency,
                        limit,
                        partitionKey: {partitionType: "Task", taskId},
                        startSortKey,
                        endSortKey,
                    }),
            }),
        ),
    ]);

    const lastCommentIndex =
        commentItems.length > 0 ? commentItems[commentItems.length - 1]!.index : -1;

    return {
        spaceId: taskItem.spaceId,
        commentCount: Math.max(
            getTaskCommentCount(commentsSummaryItem),
            // Make sure `commentCount` is consistent with `comments` in case of eventual
            // consistency race conditions.
            lastCommentIndex + 1,
        ),
        comments: commentItems,
    };
}

export async function getTaskCommentPayloadsFromEnd(
    context: ServerActionContext,
    {
        taskId,
        limit,
        afterCommentIndex,
        beforeCommentIndex,
        consistency,
    }: {
        taskId: TaskId;
        limit: number;
        afterCommentIndex: number | null;
        beforeCommentIndex: number | null;
        consistency?: DynamoCacheReadConsistency;
    },
): Promise<{
    spaceId: SpaceId;
    commentCount: number;
    comments: Array<MessageItem>;
}> {
    const authorizationPromise = authorizeTaskAccessAndGetCommentsSummaryItem(
        context,
        taskId,
        "Comment",
        {consistency},
    );

    const queryStartCommentIndex = Math.max(
        typeof beforeCommentIndex === "number"
            ? beforeCommentIndex - limit
            : // TODO(calebmer): An optimized version of this might query `limit` items and if
              // there was a message stream then query again with `limit: "All"` and a proper
              // query start index. Instead right now we wait for chat access to authorize before
              // starting our query which is slower than authorizing + querying in parallel.
              getTaskCommentCount((await authorizationPromise).commentsSummaryItem) - limit,
        typeof afterCommentIndex === "number" ? afterCommentIndex + 1 : 0,
    );

    const queryEndCommentIndex =
        typeof beforeCommentIndex === "number" ? beforeCommentIndex - 1 : Number.MAX_SAFE_INTEGER;

    const [{item: taskItem, commentsSummaryItem}, commentItems] = await runAllPromises([
        authorizationPromise,
        arrayFromAsyncIterable(
            runCommentsQuery(context, {
                cache: TaskCommentItemContextCache,
                cacheKeyPrefix: taskId,
                consistency,
                startIndex: queryStartCommentIndex,
                endIndex: queryEndCommentIndex,
                query: ({consistency, limit, startSortKey, endSortKey}) =>
                    TaskTable.query(context, {
                        consistency,
                        limit,
                        partitionKey: {partitionType: "Task", taskId},
                        startSortKey,
                        endSortKey,
                    }),
            }),
        ),
    ]);

    const lastCommentIndex =
        commentItems.length > 0 ? commentItems[commentItems.length - 1]!.index : -1;

    return {
        spaceId: taskItem.spaceId,
        commentCount: Math.max(
            getTaskCommentCount(commentsSummaryItem),
            // Make sure `commentCount` is consistent with `comments` in case of eventual
            // consistency race conditions.
            lastCommentIndex + 1,
        ),
        comments: commentItems,
    };
}

export async function getTaskCommentParentContent(
    context: ServerActionContext,
    taskId: TaskId,
    {
        parent,
        consistency,
    }: {parent: MessageContentPayloadParent; consistency?: DynamoCacheReadConsistency},
): Promise<{content: MessageContent; authorId: AccountId}> {
    await authorizeTaskAccess(context, taskId, "View", null, {consistency});

    const messageNoun = "comment";

    switch (parent.type) {
        case "Message": {
            const commentItem = await getTaskCommentItem(context, taskId, parent.index, {
                consistency,
            });

            return {
                authorId: commentItem.authorId,
                content:
                    commentItem.payload.type === "Content"
                        ? cutMessageContentPayload({
                              payload: commentItem.payload,
                              stream: commentItem.stream,
                          })
                        : createSimpleMessageContent(`Deleted ${messageNoun}`),
            };
        }
        case "MessagesRange": {
            const messageItems = await arrayFromAsyncIterable(
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

export async function getTaskNotesContentAndOptionalInitialCommentsIfExists(
    context: ServerActionContext,
    {
        taskId,
        commentsLimit,
        onSiteId,
    }: {
        taskId: TaskId;
        commentsLimit: number;
        onSiteId?: (siteId: SiteId) => void;
    },
): Promise<{
    notes: {
        version: number;
        content: TaskNotesContentWithReferences;
    };
    initialComments: {
        checkpoint: ServerSynchronizationCheckpoint;
        commentCount: number;
        comments: ReadonlyArray<TaskCommentModel>;
        otherReferencedComments: ReadonlyArray<TaskCommentModel>;
    } | null;
} | null> {
    const authorizationPromiseResolver = createPromiseResolver<{
        item: TaskEssentialAttributesItemBase;
        commentsSummaryItem: TaskCommentsSummaryItem | null;
    }>();

    // Don't report unhandled rejections to this promise resolver as unhandled errors.
    // Otherwise if we can't find the task and return null we'll get an "Uncaught
    // exception" log with this error.
    authorizationPromiseResolver.promise.catch(() => {});

    const commentAuthorizationResultPromise = authorizationPromiseResolver.promise.then(
        async ({item}) => {
            const result = await authorizeTaskItemAccessIfPossible(context, item, "Comment", {
                getTaskItem: taskId => getTaskItemForAuthorization(context, taskId, null),
                getCollectionItem: collectionId =>
                    getTaskCollectionItemForAuthorization(context, collectionId, null),
            });

            return mapResult(result, () => item.spaceId);
        },
    );

    // Generate checkpoint before we start loading data. So when we backfill we include
    // any realtime events that happened while loading data.
    const checkpoint = generateServerSynchronizationCheckpoint();

    const [task, commentAuthorizationResultResult, commentsResult] = await runAllPromises([
        authorizeTaskAccessAndGetCommentsSummaryAndNotesItemsIfExists(
            context,
            taskId,
            "View",
            async result => {
                authorizationPromiseResolver.resolve(result);

                const {item, notesItem, commentsSummaryItem} = result;

                return {
                    notes: {
                        version: notesItem?.version ?? 0,
                        content: {
                            doc: notesItem?.content ?? emptyTaskNotesContent,
                            references:
                                await getContentReferencesAssumingViewAccessWithOptionalSpaceAccess(
                                    context,
                                    item.spaceId,
                                    FileTaskAuthorizer.bind({type: "TaskNotes", taskId}),
                                    notesItem?.content ?? emptyTaskNotesContent,
                                    // Preload small files so we don't have to show a placeholder for them. This
                                    // improves UX at the cost slowing the initial load. Right now we preload <100kb
                                    // files up to 400kb. We'll have to tune this to find the right balance between UX
                                    // and the performance hit.
                                    {withPreloadedFiles: true},
                                ),
                        },
                    },
                    commentsSummaryItem,
                };
            },
            {onSiteId},
        ).finally(() => {
            // Make sure the promise resolver doesn't hang forever waiting for a `SpaceId` in
            // failure scenarios.
            if (!authorizationPromiseResolver.isSettled()) {
                authorizationPromiseResolver.reject(createTaskNotFoundError(taskId));
            }
        }),

        // This promise may throw if the task isn't found because it depends on
        // `authorizationPromiseResolver`. If the task isn't found we want to return null,
        // not throw here. So `captureResultPromise()` to catch not found errors so we
        // don't throw them until after we check that the task exists.
        //
        // This gives us a result of a result. The inner result is whether or not we have
        // comment access and controls whether we return `comments` from this function or
        // not.
        captureResultPromise(commentAuthorizationResultPromise),

        captureResultPromise(
            getTaskCommentsFromStartAssumingAuthorizedTask(context, {
                taskId,
                // If we don't have comment authorization then throw in `getSpaceId` so we don't
                // continue loading more referenced comments or `TaskCommentModel`s.
                getSpaceId: () => commentAuthorizationResultPromise.then(unwrapResult),
                limit: commentsLimit,
                afterCommentIndex: null,
                beforeCommentIndex: null,
            }),
        ),
    ]);

    if (!task) return null;

    const {notes, commentsSummaryItem} = task;
    const commentAuthorizationResult = unwrapResult(commentAuthorizationResultResult);

    return {
        notes,

        // Only return the comments we fetched if the session actor has access to comments.
        // Otherwise we return null. A little wasteful since we will have fetched all the
        // comments before deciding to return null. But we expect the code path where
        // `commentAuthorizationResult.ok` is false to be much less common than the code
        // path where we need comments so we're ok being a little wasteful.
        initialComments: commentAuthorizationResult.ok
            ? (() => {
                  const {comments, otherReferencedComments} = unwrapResult(commentsResult);

                  const lastCommentIndex =
                      comments.length > 0 ? comments[comments.length - 1]!.index : -1;

                  return {
                      checkpoint,
                      commentCount: Math.max(
                          getTaskCommentCount(commentsSummaryItem),
                          // Make sure `commentCount` is consistent with `comments` in case of eventual
                          // consistency race conditions.
                          lastCommentIndex + 1,
                      ),
                      comments,
                      otherReferencedComments,
                  };
              })()
            : null,
    };
}

export function getTaskCommentCount(
    commentSummaryItem: TaskCommentsSummaryItem | null | undefined,
) {
    if (!commentSummaryItem) return 0;
    return sumIterable(commentSummaryItem.commentCountByAuthorId.values());
}

export const TaskCommentItemContextCache = new DynamoContextCache<
    `${TaskId}:${number}`,
    MessageItem | null
>({
    // Allow sharing this cache because the results do not depend on who the actor is.
    whenActorChanges: "DangerouslyShare",
});

export async function getTaskCommentItem(
    context: ServerActionContext,
    taskId: TaskId,
    commentIndex: number,
    {consistency}: {consistency?: DynamoCacheReadConsistency} = {},
): Promise<MessageItem> {
    const item = await getTaskCommentItemIfExists(context, taskId, commentIndex, {consistency});
    if (!item) throw createTaskCommentNotFoundError(taskId, commentIndex);
    return item;
}

export async function getTaskCommentItemIfExists(
    context: ServerActionContext,
    taskId: TaskId,
    commentIndex: number,
    {consistency}: {consistency?: DynamoCacheReadConsistency} = {},
): Promise<MessageItem | null> {
    const items = await arrayFromAsyncIterable(
        runCommentsQuery(context, {
            cache: TaskCommentItemContextCache,
            cacheKeyPrefix: taskId,
            consistency,
            startIndex: commentIndex,
            endIndex: commentIndex,
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

    assert(items.length <= 1);

    return items[0] ?? null;
}

export async function getTaskCommentsFromStartAssumingAuthorizedTask(
    context: ServerActionContext,
    {
        taskId,
        getSpaceId,
        limit,
        afterCommentIndex,
        beforeCommentIndex,
        consistency = "Eventual",
    }: {
        taskId: TaskId;
        getSpaceId: () => Promise<SpaceId>;
        limit: number;
        afterCommentIndex: number | null;
        beforeCommentIndex: number | null;
        consistency?: DynamoReadConsistency;
    },
): Promise<{
    comments: Array<TaskCommentModel>;
    otherReferencedComments: Array<TaskCommentModel>;
}> {
    if (limit === 0) return {comments: [], otherReferencedComments: []};

    const queryStartCommentIndex =
        typeof afterCommentIndex === "number" ? afterCommentIndex + 1 : 0;

    const queryEndCommentIndex = Math.min(
        queryStartCommentIndex + limit - 1,
        typeof beforeCommentIndex === "number" ? beforeCommentIndex - 1 : Number.MAX_SAFE_INTEGER,
    );

    const commentItems = await arrayFromAsyncIterable(
        runCommentsQuery(context, {
            cache: TaskCommentItemContextCache,
            cacheKeyPrefix: taskId,
            consistency,
            startIndex: queryStartCommentIndex,
            endIndex: queryEndCommentIndex,
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

    if (commentItems.length === 0) return {comments: [], otherReferencedComments: []};

    const startCommentIndex = commentItems[0]!.index;
    const endCommentIndex = commentItems[commentItems.length - 1]!.index;

    const spaceId = await getSpaceId();

    let otherReferencedCommentPromiseByIndex = new Map<number, Promise<void>>();
    const otherReferencedComments: Array<TaskCommentModel> = [];

    const loadOtherReferencedCommentFromParent = (parent: MessageContentPayloadParent) => {
        for (const index of iterateMessageContentPayloadParentIndexes(parent)) {
            loadOtherReferencedComment(index);
        }
    };

    const loadOtherReferencedComment = (commentIndex: number) => {
        // If this message is already in our loaded messages range then we don't need to
        // load it again.
        if (startCommentIndex <= commentIndex && commentIndex <= endCommentIndex) return;

        const promise = getOrSetDefaultMapValue(
            otherReferencedCommentPromiseByIndex,
            commentIndex,
            async () => {
                const item = await getTaskCommentItemIfExists(context, taskId, commentIndex, {
                    consistency,
                });
                if (!item) throw new InternalError("Parent comment not found");

                // Recursively load any referenced parent messages...
                if (item.payload.type === "Content" && item.payload.parent !== null) {
                    loadOtherReferencedCommentFromParent(item.payload.parent);
                }

                otherReferencedComments.push(
                    await createTaskCommentModelFromItem(context, spaceId, taskId, item),
                );
            },
        );

        // We await this promise later.
        void promise;
    };

    const comments = await runAllPromises(
        commentItems.map(item => {
            if (item.payload.type === "Content" && item.payload.parent !== null) {
                loadOtherReferencedCommentFromParent(item.payload.parent);
            }

            // Don't propagate `consistency` when loading model references. We accept
            // references can have eventual consistency.
            return createTaskCommentModelFromItem(context, spaceId, taskId, item);
        }),
    );

    // Keep loading other referenced comments until we have all of them. A referenced
    // comment may itself reference more comments.
    while (otherReferencedCommentPromiseByIndex.size > 0) {
        const promises = Array.from(otherReferencedCommentPromiseByIndex.values());
        otherReferencedCommentPromiseByIndex = new Map();
        await runAllPromises(promises);
    }

    return {
        comments,
        otherReferencedComments: otherReferencedComments.sort(
            (comment1, comment2) => comment1.index - comment2.index,
        ),
    };
}

export async function getTaskCommentsFromEndAssumingAuthorizedTask(
    context: ServerActionContext,
    {
        taskId,
        authorizationPromise,
        limit,
        afterCommentIndex,
        beforeCommentIndex,
    }: {
        taskId: TaskId;
        authorizationPromise: Promise<{
            item: {spaceId: SpaceId};
            commentsSummaryItem: TaskCommentsSummaryItem | null;
        }>;
        limit: number;
        afterCommentIndex: number | null;
        beforeCommentIndex: number | null;
    },
): Promise<{
    comments: Array<TaskCommentModel>;
    otherReferencedComments: Array<TaskCommentModel>;
}> {
    if (limit === 0) return {comments: [], otherReferencedComments: []};

    const queryStartCommentIndex = Math.max(
        typeof beforeCommentIndex === "number"
            ? beforeCommentIndex - limit
            : // TODO(calebmer): An optimized version of this might query `limit` items and if
              // there was a message stream then query again with `limit: "All"` and a proper
              // query start index. Instead right now we wait for chat access to authorize before
              // starting our query which is slower than authorizing + querying in parallel.
              getTaskCommentCount((await authorizationPromise).commentsSummaryItem) - limit,
        typeof afterCommentIndex === "number" ? afterCommentIndex + 1 : 0,
    );

    const queryEndCommentIndex =
        typeof beforeCommentIndex === "number" ? beforeCommentIndex - 1 : Number.MAX_SAFE_INTEGER;

    const commentItems = await arrayFromAsyncIterable(
        typeof beforeCommentIndex !== "number" || beforeCommentIndex > 0
            ? runCommentsQuery(context, {
                  cache: TaskCommentItemContextCache,
                  cacheKeyPrefix: taskId,
                  consistency: undefined,
                  startIndex: queryStartCommentIndex,
                  endIndex: queryEndCommentIndex,
                  query: ({consistency, limit, startSortKey, endSortKey}) =>
                      TaskTable.query(context, {
                          consistency,
                          limit,
                          partitionKey: {partitionType: "Task", taskId},
                          startSortKey,
                          endSortKey,
                      }),
              })
            : (async function* () {})(),
    );

    if (commentItems.length === 0) return {comments: [], otherReferencedComments: []};

    const startCommentIndex = commentItems[0]!.index;
    const endCommentIndex = commentItems[commentItems.length - 1]!.index;

    const {spaceId} = (await authorizationPromise).item;

    let otherReferencedCommentPromiseByIndex = new Map<number, Promise<void>>();
    const otherReferencedComments: Array<TaskCommentModel> = [];

    const loadOtherReferencedCommentFromParent = (parent: MessageContentPayloadParent) => {
        for (const index of iterateMessageContentPayloadParentIndexes(parent)) {
            loadOtherReferencedComment(index);
        }
    };

    const loadOtherReferencedComment = (commentIndex: number) => {
        // If this message is already in our loaded messages range then we don't need to
        // load it again.
        if (startCommentIndex <= commentIndex && commentIndex <= endCommentIndex) return;

        const promise = getOrSetDefaultMapValue(
            otherReferencedCommentPromiseByIndex,
            commentIndex,
            async () => {
                const item = await getTaskCommentItemIfExists(context, taskId, commentIndex);
                if (!item) throw new InternalError("Parent comment not found");

                // Recursively load any referenced parent messages...
                if (item.payload.type === "Content" && item.payload.parent !== null) {
                    loadOtherReferencedCommentFromParent(item.payload.parent);
                }

                otherReferencedComments.push(
                    await createTaskCommentModelFromItem(context, spaceId, taskId, item),
                );
            },
        );

        // We await this promise later.
        void promise;
    };

    const comments = await runAllPromises(
        commentItems.map(item => {
            if (item.payload.type === "Content" && item.payload.parent !== null) {
                loadOtherReferencedCommentFromParent(item.payload.parent);
            }
            return createTaskCommentModelFromItem(context, spaceId, taskId, item);
        }),
    );

    // Keep loading other referenced comments until we have all of them. A referenced
    // comment may itself reference more comments.
    while (otherReferencedCommentPromiseByIndex.size > 0) {
        const promises = Array.from(otherReferencedCommentPromiseByIndex.values());
        otherReferencedCommentPromiseByIndex = new Map();
        await runAllPromises(promises);
    }

    return {
        comments,
        otherReferencedComments: otherReferencedComments.sort(
            (comment1, comment2) => comment1.index - comment2.index,
        ),
    };
}

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

export async function createTaskCommentModelFromItem(
    context: ServerActionContext,
    spaceId: SpaceId,
    taskId: TaskId,
    item: MessageItem,
): Promise<TaskCommentModel> {
    const [author, payload] = await runAllPromises([
        getAccount(context, spaceId, item.authorId),
        createMessagePayloadModel(
            context,
            spaceId,
            FileTaskAuthorizer.bind({type: "TaskComments", taskId}),
            item.payload,
            item.stream,
        ),
    ]);

    return new TaskCommentModel({
        taskId,
        index: item.index,
        version: item.version,
        author,
        createdTime: item.createdTime,
        createdTimeZone: item.createdTimeZone,
        payload,
        stream: item.stream,
    });
}

export function putTaskCommentStreamPart(
    context: ServerActionContext,
    {
        taskId,
        commentIndex,
        partIndex,
        payload,
        consistency,
        isTimeoutErrorCompletion = false,
    }: {
        taskId: TaskId;
        commentIndex: number;
        partIndex: number | "Create";
        payload: MessageStreamPartPayload;
        consistency?: DynamoCacheReadConsistency;
        isTimeoutErrorCompletion?: boolean;
    },
): Promise<{spaceId: SpaceId; createdTime: Date}> {
    if (isTimeoutErrorCompletion && context.actor.type !== "System") {
        throw new PermissionDeniedError(
            "Only system actors can complete a message stream after timeout",
        );
    }

    return context.dynamo.retryTransaction(async context => {
        const [{spaceId}, item] = await runAllPromises([
            // Make sure the bot has access (and wasn't removed from the space).
            authorizeTaskAccess(context, taskId, "Comment", null, {consistency}),

            TaskTable.getItemIfExists(
                context,
                {
                    partitionType: "Task",
                    sortRangeType: "Comments#Stream",
                    taskId,
                    commentIndex,
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
            const notificationEvent = await getNotificationEventForPutTaskCommentStreamPart(
                context,
                {
                    spaceId,
                    taskId,
                    commentIndex,
                    item,
                    payload,
                    partIndex,
                    isTimeoutErrorCompletion,
                },
            );

            createdTime = currentTime;

            const createPartTransactionEntry = TaskTable.transactionCreateOrReplaceItem({
                partitionType: "Task",
                sortRangeType: "Comments#StreamPart",
                taskId,
                commentIndex,
                partIndex,
                payload,
                createdTime,
                // `updateLockVersion: 0` is always represented as `undefined`.
                updateLockVersion: undefined,
            });

            version = createPartTransactionEntry.newItem.updateLockVersion ?? 0;

            await DynamoTableSchema.executeTransaction(context, [
                TaskTable.transactionDirectlyUpdateItem({
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

            const updatePartTransactionEntry = TaskTable.transactionCreateOrReplaceItem({
                partitionType: "Task",
                sortRangeType: "Comments#StreamPart",
                taskId,
                commentIndex,
                partIndex,
                payload,
                createdTime,
                updateLockVersion: item.lastPartUpdateLockVersion + 1,
            });

            version = updatePartTransactionEntry.newItem.updateLockVersion ?? 0;

            await DynamoTableSchema.executeTransaction(context, [
                TaskTable.transactionDirectlyUpdateItem({
                    ...item,
                    lastPartUpdateLockVersion: item.lastPartUpdateLockVersion + 1,
                    lastPingTime,
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
                        type: "TaskComment",
                        taskId,
                        commentIndex,
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
                `/api/durable-objects/task-notes/${taskId}/broadcast-put-message-stream-part`,
                {
                    serviceName: "TaskNotesCollaborationService",
                    route: "/api/durable-objects/task-notes/:taskId/broadcast-put-message-stream-part",
                    body: MessagingRealtimeBroadcastPutMessageStreamPartRequestSchema.serialize({
                        index: commentIndex,
                        partIndex,
                        part: {version, payload, createdTime},
                    }),
                },
            ),
        );

        return {spaceId, createdTime};
    });
}

export async function getNotificationEventForPutTaskCommentStreamPart(
    context: DynamoContext,
    {
        spaceId,
        taskId,
        commentIndex,
        item,
        payload,
        partIndex,
        isTimeoutErrorCompletion,
    }: {
        spaceId: SpaceId;
        taskId: TaskId;
        commentIndex: number;
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

        const previousPartItem = await TaskTable.getItem(
            context,
            {
                partitionType: "Task",
                sortRangeType: "Comments#StreamPart",
                taskId,
                commentIndex,
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
        type: "CreateTaskComment",
        id: generateChronologicalId(),
        spaceId,
        taskId,
        commentIndex,
        createdTime: item.createdTime,
        createdTimeZone: item.createdTimeZone,
        authorId: item.authorId,
        mentionedAccountIds: getMentionedAccountIdsInContent(content),
        parent: item.pendingNotificationEvent.parent,
        isContentSnippetComplete: contentSnippet.nodeSize === content.nodeSize,
        contentSnippet,
    };
}

export function completeTaskCommentStream(
    context: ServerActionContext,
    {
        taskId,
        commentIndex,
        consistency,
    }: {
        taskId: TaskId;
        commentIndex: number;
        consistency?: DynamoCacheReadConsistency;
    },
): Promise<{
    spaceId: SpaceId;
    completedTime: Date;
}> {
    return context.dynamo.retryTransaction(async context => {
        const [{spaceId}, item] = await runAllPromises([
            // Make sure the bot has access (and wasn't removed from the space).
            authorizeTaskAccess(context, taskId, "Comment", null, {consistency}),

            TaskTable.getItemIfExists(
                context,
                {
                    partitionType: "Task",
                    sortRangeType: "Comments#Stream",
                    taskId,
                    commentIndex,
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

        if (hasMessageStreamDefinitelyTimedOut(item)) {
            throw createCantCompleteStaleMessageStreamError();
        }

        let notificationEvent: NotificationEvent | null = null;

        // If we haven't sent a notification event for this message stream yet then send
        // one now!
        if (item.pendingNotificationEvent) {
            const previousPartItem =
                item.partCount > 0
                    ? await TaskTable.getItem(
                          context,
                          {
                              partitionType: "Task",
                              sortRangeType: "Comments#StreamPart",
                              taskId,
                              commentIndex,
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
                type: "CreateTaskComment",
                id: generateChronologicalId(),
                spaceId,
                taskId,
                commentIndex,
                createdTime: item.createdTime,
                createdTimeZone: item.createdTimeZone,
                authorId: item.authorId,
                mentionedAccountIds: getMentionedAccountIdsInContent(content),
                parent: item.pendingNotificationEvent.parent,
                isContentSnippetComplete: contentSnippet.nodeSize === content.nodeSize,
                contentSnippet,
            };
        }

        // NOTE(calebmer): Using `Date.now()` allows our Jest tests to mock `Date.now()`
        // and override the time that is returned.
        const completedTime = new Date(Date.now());

        await TaskTable.directlyUpdateItem(context, {
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
                `/api/durable-objects/task-notes/${taskId}/broadcast-complete-message-stream`,
                {
                    serviceName: "TaskNotesCollaborationService",
                    route: "/api/durable-objects/task-notes/:taskId/broadcast-complete-message-stream",
                    body: MessagingRealtimeBroadcastCompleteMessageStreamRequestSchema.serialize({
                        index: commentIndex,
                        completedTime,
                    }),
                },
            ),
        );

        return {spaceId, completedTime};
    });
}

export function pingTaskCommentStream(
    context: ServerActionContext,
    {
        taskId,
        commentIndex,
        consistency,
    }: {
        taskId: TaskId;
        commentIndex: number;
        consistency?: DynamoCacheReadConsistency;
    },
): Promise<{
    spaceId: SpaceId;
    lastPingTime: Date;
}> {
    return context.dynamo.retryTransaction(async context => {
        const [{spaceId}, item] = await runAllPromises([
            // Make sure the bot has access (and wasn't removed from the space).
            authorizeTaskAccess(context, taskId, "Comment", null, {consistency}),

            TaskTable.getItemIfExists(
                context,
                {
                    partitionType: "Task",
                    sortRangeType: "Comments#Stream",
                    taskId,
                    commentIndex,
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

        await TaskTable.directlyUpdateItem(context, {
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
                        type: "TaskComment",
                        taskId,
                        commentIndex,
                        updatedTraits: {type: "Some", traits: []},
                    },
                },
                {delaySeconds: nextIndexSearchEntityJob.delaySeconds},
            );
        }

        return {spaceId, lastPingTime};
    });
}

export function updateTaskCommentContent(
    context: ServerAccountActionContext,
    {
        taskId,
        commentIndex,
        contentVersion,
        steps,
    }: {
        taskId: TaskId;
        commentIndex: number;
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
        const [{item, commentsSummaryItem}, taskCommentItem] = await runAllPromises([
            authorizeTaskAccessAndGetCommentsSummaryItem(context, taskId, "Comment"),
            TaskTable.getItemIfExists(context, {
                partitionType: "Task",
                sortRangeType: "Comments",
                taskId,
                commentIndex,
            }),
        ]);
        if (!commentsSummaryItem) throw new NotFoundError("Task comments summary item not found");
        if (!taskCommentItem) throw new NotFoundError("Task comment not found");

        if (taskCommentItem.authorId !== context.actor.getPossiblyBotAccountId()) {
            throw new PermissionDeniedError("Can only update Task comments you authored");
        }

        const {oldPayload, newPayload} = computeUpdateMessageContent(
            taskCommentItem,
            contentVersion,
            steps,
        );

        const newMentionCountByAccountId = applyMentionCountByAccountIdDifferenceFromContentUpdate(
            commentsSummaryItem.mentionCountByAccountId,
            oldPayload.content,
            newPayload.content,
        );

        const transactionEntry = TaskTable.transactionDirectlyUpdateItem({
            ...taskCommentItem,
            payload: newPayload,
        });

        await DynamoTableSchema.executeTransaction(context, [
            transactionEntry,

            TaskTable.transactionDirectlyUpdateItem({
                ...commentsSummaryItem,
                taskId,
                nextCommentIndex: commentsSummaryItem.nextCommentIndex,
                commentCountByAuthorId: commentsSummaryItem.commentCountByAuthorId,
                mentionCountByAccountId: newMentionCountByAccountId,
                updateLockVersion: commentsSummaryItem.updateLockVersion,
            }),

            // Create-or-replace is safe because `eventTime`, `messageIndex`, and `version` are
            // all in the item key. So we won't be replacing any existing update item.
            TaskTable.transactionCreateOrReplaceItem({
                partitionType: "Task",
                sortRangeType: "MessageUpdates",
                taskId,
                eventTime: newPayload.contentUpdate.time,
                messageIndex: taskCommentItem.commentIndex,
                version: transactionEntry.newItem.updateLockVersion ?? 0,
                expirationTime: addDays(
                    newPayload.contentUpdate.time,
                    messagingEventExpirationDays,
                ),
            }),
        ]);

        context.jobs.send({
            type: "IndexSearchEntity",
            spaceId: item.spaceId,
            update: {
                type: "TaskComment",
                taskId,
                commentIndex,
                updatedTraits: {type: "Some", traits: []},
            },
        });

        return {
            spaceId: item.spaceId,
            version: transactionEntry.newItem.updateLockVersion ?? 0,
            content: newPayload.content,
            contentUpdate: newPayload.contentUpdate,
        };
    });
}

export function setTaskCommentReaction(
    context: ServerSessionActionContextWithPush,
    {
        taskId,
        commentIndex,
        contentVersion,
        pos,
        reaction,
    }: {
        taskId: TaskId;
        commentIndex: number;
        contentVersion: number;
        pos: number | "Files";
        reaction: Reaction | "GenericLike";
    },
) {
    return context.dynamo.retryTransaction(async context => {
        const [{item: taskItem, commentsSummaryItem}, commentItem] = await runAllPromises([
            authorizeTaskAccessAndGetCommentsSummaryItem(context, taskId, "Comment"),
            getTaskCommentItemIfExists(context, taskId, commentIndex),
        ]);
        if (!commentItem) throw new NotFoundError("Task comment not found");

        const currentTime = new Date();

        const newPayload = computeSetMessageReaction({
            actorAccountId: context.actor.getPossiblyBotAccountId(),
            message: commentItem,
            contentVersion,
            pos,
            reaction,
        });

        const transactionEntry = TaskTable.transactionDirectlyUpdateItem({
            ...omitObject(commentItem, ["index", "version"]),
            partitionType: "Task",
            sortRangeType: "Comments",
            taskId,
            commentIndex: commentItem.index,
            updateLockVersion: commentItem.version,
            payload: newPayload,
        });

        await DynamoTableSchema.executeTransaction(context, [
            transactionEntry,

            // Create-or-replace is safe because `eventTime`, `commentIndex`, and `version` are
            // all in the item key. So we won't be replacing any existing update item.
            TaskTable.transactionCreateOrReplaceItem({
                partitionType: "Task",
                sortRangeType: "MessageUpdates",
                taskId,
                eventTime: currentTime,
                messageIndex: commentItem.index,
                version: transactionEntry.newItem.updateLockVersion ?? 0,
                expirationTime: addDays(currentTime, messagingEventExpirationDays),
            }),
        ]);

        context.process.waitUntil(
            context.notificationsInjection.archiveInboxTaskEntryAfterSetTaskCommentReaction({
                spaceId: taskItem.spaceId,
                taskId,
                commentCount: getTaskCommentCount(commentsSummaryItem),
                commentIndex,
            }),
        );

        return {
            version: transactionEntry.newItem.updateLockVersion ?? 0,
        };
    });
}

export function deleteTaskComment(
    context: ServerAccountActionContext,
    {taskId, commentIndex}: {taskId: TaskId; commentIndex: number},
): Promise<{version: number; deletedTime: Date}> {
    return context.dynamo.retryTransaction(async context => {
        const [{item, commentsSummaryItem}, taskCommentItem] = await runAllPromises([
            authorizeTaskAccessAndGetCommentsSummaryItem(context, taskId, "Comment"),
            TaskTable.getItemIfExists(context, {
                partitionType: "Task",
                sortRangeType: "Comments",
                taskId,
                commentIndex,
            }),
        ]);
        if (!commentsSummaryItem) throw new NotFoundError("Task comments summary item not found");
        if (!taskCommentItem) throw new NotFoundError("Task comment not found");

        if (taskCommentItem.authorId !== context.actor.getPossiblyBotAccountId())
            throw new PermissionDeniedError("Can only delete task comments you authored");

        if (taskCommentItem.payload.type !== "Content")
            throw new FailedPreconditionError(
                "Can\u2019t delete comments with a non-content payload",
            );

        if (taskCommentItem.payload.clerical)
            throw new FailedPreconditionError("Can\u2019t delete clerical comments");

        const deletedTime = new Date();

        const newMentionCountByAccountId = applyMentionCountByAccountIdDifferenceFromContentUpdate(
            commentsSummaryItem.mentionCountByAccountId,
            taskCommentItem.payload.content,
            null,
        );

        const transactionEntry = TaskTable.transactionDirectlyUpdateItem({
            ...taskCommentItem,
            payload: {type: "Deleted", deletedTime},
        });

        await DynamoTableSchema.executeTransaction(context, [
            transactionEntry,

            TaskTable.transactionDirectlyUpdateItem({
                ...commentsSummaryItem,
                taskId,
                nextCommentIndex: commentsSummaryItem.nextCommentIndex,
                commentCountByAuthorId: commentsSummaryItem.commentCountByAuthorId,
                mentionCountByAccountId: newMentionCountByAccountId,
                updateLockVersion: commentsSummaryItem.updateLockVersion,
            }),

            // Create-or-replace is safe because `eventTime`, `messageIndex`, and `version` are
            // all in the item key. So we won't be replacing any existing update item.
            TaskTable.transactionCreateOrReplaceItem({
                partitionType: "Task",
                sortRangeType: "MessageUpdates",
                taskId,
                eventTime: deletedTime,
                messageIndex: taskCommentItem.commentIndex,
                version: transactionEntry.newItem.updateLockVersion ?? 0,
                expirationTime: addDays(deletedTime, messagingEventExpirationDays),
            }),
        ]);

        context.jobs.send({
            type: "IndexSearchEntity",
            spaceId: item.spaceId,
            update: {
                type: "TaskComment",
                taskId,
                commentIndex,
                updatedTraits: {type: "Some", traits: []},
            },
        });

        return {
            version: transactionEntry.newItem.updateLockVersion ?? 0,
            deletedTime,
        };
    });
}

export function deleteTaskCommentReaction(
    context: ServerAccountActionContext,
    {
        taskId,
        commentIndex,
        contentVersion,
        pos,
    }: {
        taskId: TaskId;
        commentIndex: number;
        contentVersion: number;
        pos: number | "Files";
    },
) {
    return context.dynamo.retryTransaction(async context => {
        const [, commentItem] = await runAllPromises([
            authorizeTaskAccess(context, taskId, "Comment"),
            getTaskCommentItemIfExists(context, taskId, commentIndex),
        ]);
        if (!commentItem) throw new NotFoundError("Task comment not found");

        const currentTime = new Date();

        const newPayload = computeDeleteMessageReaction({
            actorAccountId: context.actor.getPossiblyBotAccountId(),
            message: commentItem,
            contentVersion,
            pos,
        });

        const transactionEntry = TaskTable.transactionDirectlyUpdateItem({
            ...omitObject(commentItem, ["index", "version"]),
            partitionType: "Task",
            sortRangeType: "Comments",
            taskId,
            commentIndex: commentItem.index,
            updateLockVersion: commentItem.version,
            payload: newPayload,
        });

        await DynamoTableSchema.executeTransaction(context, [
            transactionEntry,

            // Create-or-replace is safe because `eventTime`, `commentIndex`, and `version` are
            // all in the item key. So we won't be replacing any existing update item.
            TaskTable.transactionCreateOrReplaceItem({
                partitionType: "Task",
                sortRangeType: "MessageUpdates",
                taskId,
                eventTime: currentTime,
                messageIndex: commentItem.index,
                version: transactionEntry.newItem.updateLockVersion ?? 0,
                expirationTime: addDays(currentTime, messagingEventExpirationDays),
            }),
        ]);

        return {
            version: transactionEntry.newItem.updateLockVersion ?? 0,
        };
    });
}
