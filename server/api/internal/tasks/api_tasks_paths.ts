import {today} from "@internationalized/date";
import {createAccessPolicyForContentCreatedByBot} from "~/server/access/create_access_policy_for_content_created_by_bot.js";
import {ApiPaths} from "~/server/api/internal/shared/api_paths_type.js";
import {fromApiMessageContentPayloadParent} from "~/server/api/internal/shared/from_api_message_content_payload_parent.js";
import {fromApiMessageStreamPartPayload} from "~/server/api/internal/shared/from_api_message_stream_part_payload.js";
import {getFileIdOrFileEntityIdFromApiMessageContentPayloadFile} from "~/server/api/internal/shared/get_file_id_or_file_entity_id_from_api_message_content_payload_file.js";
import {
    getApiMentionTitleWithStrongConsistency,
    getApiTaskMentionTitleWithStrongConsistency,
} from "~/server/api/internal/shared/into_api_content_with_references.js";
import {intoApiMessage} from "~/server/api/internal/shared/into_api_message.js";
import {intoApiMessageExperimentalApproval} from "~/server/api/internal/shared/into_api_message_stream_part_payload.js";
import {ApiTaskConverter} from "~/server/api/internal/tasks/internal/api_task_converter.js";
import {commitTaskPatchesFromApi} from "~/server/api/internal/tasks/internal/commit_task_patches_from_api.js";
import {createApiTaskActor} from "~/server/api/internal/tasks/internal/create_api_task_actor.js";
import {createIntoApiTaskCommentContentPayloadParent} from "~/server/api/internal/tasks/internal/create_into_api_task_comment_content_payload_parent.ts.js";
import {getApiTaskNotes} from "~/server/api/internal/tasks/internal/get_api_task_notes.js";
import {intoApiTaskCollection} from "~/server/api/internal/tasks/internal/into_api_task_collection.js";
import {loadTasksFromApiQuery} from "~/server/api/internal/tasks/internal/load_tasks_from_api_query.js";
import {updateTaskCollectionFromApi} from "~/server/api/internal/tasks/internal/update_task_collection_from_api.js";
import {updateTaskNotesFromApi} from "~/server/api/internal/tasks/internal/update_task_notes_from_api.js";
import {attachFileToTargetAsBot} from "~/server/files/data/attach_file_to_target_as_bot.js";
import {FileTaskAuthorizer} from "~/server/tasks/data/authorization/file_task_authorizer.js";
import {commitTaskActionTransaction} from "~/server/tasks/data/commit_task_action_transaction.js";
import {
    broadcastPutTaskCommentStreamPart,
    completeTaskCommentStream,
    createTaskComment,
    getTaskCommentMessageApprovals,
    getTaskCommentPayload,
    getTaskCommentPayloadsFromEnd,
    getTaskCommentPayloadsFromStart,
    pingTaskCommentStream,
    putTaskCommentMessageApprovalDecisions,
    putTaskCommentStreamPart,
} from "~/server/tasks/data/task_messaging.js";
import {fromApiContent} from "~/shared/api/content/closed_source/from_api_content.js";
import {fromApiThemeColor} from "~/shared/api/content/closed_source/from_api_theme_color.js";
import {fromApiTaskQueryFilter} from "~/shared/api/content/closed_source/into_api_task_query_filter.js";
import {fromApiTaskQuerySort} from "~/shared/api/content/closed_source/into_api_task_query_sort.js";
import {intoApiTaskStatus} from "~/shared/api/content/closed_source/into_api_task_status.js";
import {
    MessageContentProsemirrorSchema,
    assertMessageContent,
} from "~/shared/content/message_content_schema.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {HybridLogicalClock} from "~/shared/helpers/clock/hybrid_logical_clock.js";
import {unsynchronizedSystemClock} from "~/shared/helpers/clock/unsynchronized_system_clock.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {serializeDateString} from "~/shared/helpers/date/date_string.js";
import {defaultTimeZone} from "~/shared/helpers/intl/time_zone.js";
import {findMapIterable} from "~/shared/helpers/iterable/find_map_iterable.js";
import {emptyMap} from "~/shared/helpers/map/empty_map.js";
import {generateId, isId} from "~/shared/id/id.js";
import {FileId, TaskCollectionId} from "~/shared/id/types/id_types.js";
import {MessageContentPayload} from "~/shared/messaging/message_schema.js";
import {MessagingRealtimeBroadcastNewMessageRequestSchema} from "~/shared/messaging/messaging_realtime_protocol.js";
import {emptyReactionSet} from "~/shared/reactions/reaction_set.js";

export const apiTasksPaths: Pick<
    ApiPaths,
    keyof ApiPaths &
        ("/task-collections" | `/task-collections/${string}` | "/tasks" | `/tasks/${string}`)
> = {
    "/tasks": {
        patch: async (context, {requestBody}) => {
            const {spaceId, patches} = requestBody;

            const {tasks, updateEvent, results} = await commitTaskPatchesFromApi(context, {
                spaceId,
                patches,
            });

            const converter = new ApiTaskConverter(updateEvent);

            return {
                content: {
                    spaceId,
                    tasks: tasks.map(task => converter.into(task)),
                    results,
                },
            };
        },

        post: async (context, {requestBody}) => {
            const spaceId = context.actor.getSpaceId();

            const {tasks, updateEvent} = await commitTaskPatchesFromApi(context, {
                spaceId,
                patches: [{type: "Create", task: requestBody.task}],
            });

            const task = assertExists(tasks[0]);

            // Read the notes back so the response includes the initial notes content committed
            // with the task.
            const {notes} = await getApiTaskNotes(context, task.id, {
                consistency: "StrongWithinCache",
            });

            return {
                content: {
                    spaceId,
                    task: {
                        ...new ApiTaskConverter(updateEvent).into(task),
                        notes,
                    },
                },
            };
        },
    },

    "/tasks/{id}": {
        patch: async (context, {pathParameters, requestBody}) => {
            const spaceId = context.actor.getSpaceId();
            const taskId = pathParameters.id;

            const {tasks, updateEvent, results} = await commitTaskPatchesFromApi(context, {
                spaceId,
                actorId: requestBody.actor?.id,
                patches: requestBody.patches.map(patch => ({
                    type: "Update",
                    id: taskId,
                    patch,
                })),
            });

            return {
                content: {
                    spaceId,
                    task: new ApiTaskConverter(updateEvent).into(assertExists(tasks[0])),
                    results: results.map(result => {
                        assert(result.type === "Update");
                        return result.result;
                    }),
                },
            };
        },

        get: async (context, {pathParameters}) => {
            const spaceId = context.actor.getSpaceId();

            const result = await context.tasks.loadQueries(
                spaceId,
                {
                    queries: [],
                    taskIds: [pathParameters.id],
                    collectionIds: [],
                },
                {consistency: "StrongWithinCache"},
            );

            return {
                content: {
                    spaceId,
                    task: new ApiTaskConverter(result.updateEvent).into(pathParameters.id),
                },
            };
        },
    },

    "/tasks/{id}-with-notes": {
        get: async (context, {pathParameters}) => {
            const [result, {notes}] = await runAllPromises([
                // TODO(calebmer): An optimization that would be pretty nice here is if we move
                // notes loading into `TaskRealtimeService`. Currently we have to load the data for
                // bot authorization twice. Once here in `ApiService` and again in
                // `TaskRealtimeService`. If we pushed task notes loading into
                // `TaskRealtimeService` then we could leverage `ContextCache` to only load the bot
                // authorization data once.
                context.tasks.loadQueries(
                    // NOCOMMIT: What happens if task exists but in a different space? We should throw
                    // some kind of error.
                    context.actor.getSpaceId(),
                    {
                        queries: [],
                        taskIds: [pathParameters.id],
                        collectionIds: [],
                    },
                    {consistency: "StrongWithinCache"},
                ),
                getApiTaskNotes(context, pathParameters.id, {
                    consistency: "StrongWithinCache",
                }),
            ]);

            return {
                content: {
                    spaceId: context.actor.getSpaceId(),
                    task: {
                        ...new ApiTaskConverter(result.updateEvent).into(pathParameters.id),
                        notes,
                    },
                },
            };
        },
    },

    "/tasks/{id}/subtasks": {
        get: async (context, {pathParameters, queryParameters}) => {
            const taskId = pathParameters.id;

            const {spaceId, updateEvent, nextCursor, tasks} = await loadTasksFromApiQuery(context, {
                query: {
                    type: "Children",
                    taskId,
                    limit: queryParameters.limit ?? 10,
                    evaluationContext: {
                        currentAccountId: null,
                        currentDate: today(defaultTimeZone),
                    },
                    expensivelyAfterCursorForApi: queryParameters.cursor,
                },
                taskIds: [taskId],
                collectionIds: [],
            });

            return {
                content: {
                    spaceId,
                    task: new ApiTaskConverter(updateEvent).into(taskId),
                    nextCursor,
                    tasks,
                },
            };
        },
    },

    "/tasks/{id}/subtasks-query": {
        post: async (context, {pathParameters, requestBody}) => {
            const taskId = pathParameters.id;

            const {spaceId, updateEvent, nextCursor, tasks} = await loadTasksFromApiQuery(context, {
                query: {
                    type: "Children",
                    taskId,
                    limit: requestBody.limit ?? 10,
                    filters: requestBody.filters?.map(fromApiTaskQueryFilter),
                    sorts: requestBody.sorts?.map(fromApiTaskQuerySort),
                    evaluationContext: {
                        currentAccountId: null,
                        currentDate: today(defaultTimeZone),
                    },
                    expensivelyAfterCursorForApi: requestBody.cursor,
                },
                taskIds: [taskId],
                collectionIds: [],
            });

            return {
                content: {
                    spaceId,
                    task: new ApiTaskConverter(updateEvent).into(taskId),
                    nextCursor,
                    tasks,
                },
            };
        },
    },

    "/tasks/{id}-with-notes/subtasks": {
        get: async (context, {pathParameters, queryParameters}) => {
            const taskId = pathParameters.id;

            const [{spaceId, updateEvent, nextCursor, tasks}, {notes}] = await runAllPromises([
                loadTasksFromApiQuery(context, {
                    query: {
                        type: "Children",
                        taskId,
                        limit: queryParameters.limit ?? 10,
                        evaluationContext: {
                            currentAccountId: null,
                            currentDate: today(defaultTimeZone),
                        },
                        expensivelyAfterCursorForApi: queryParameters.cursor,
                    },
                    taskIds: [taskId],
                    collectionIds: [],
                }),
                getApiTaskNotes(context, taskId, {consistency: "StrongWithinCache"}),
            ]);

            return {
                content: {
                    spaceId,
                    task: {
                        ...new ApiTaskConverter(updateEvent).into(taskId),
                        notes,
                    },
                    nextCursor,
                    tasks,
                },
            };
        },
    },

    "/tasks/{id}-with-notes/subtasks-query": {
        post: async (context, {pathParameters, requestBody}) => {
            const taskId = pathParameters.id;

            const [{spaceId, updateEvent, nextCursor, tasks}, {notes}] = await runAllPromises([
                loadTasksFromApiQuery(context, {
                    query: {
                        type: "Children",
                        taskId,
                        limit: requestBody.limit ?? 10,
                        filters: requestBody.filters?.map(fromApiTaskQueryFilter),
                        sorts: requestBody.sorts?.map(fromApiTaskQuerySort),
                        evaluationContext: {
                            currentAccountId: null,
                            currentDate: today(defaultTimeZone),
                        },
                        expensivelyAfterCursorForApi: requestBody.cursor,
                    },
                    taskIds: [taskId],
                    collectionIds: [],
                }),
                getApiTaskNotes(context, taskId, {consistency: "StrongWithinCache"}),
            ]);

            return {
                content: {
                    spaceId,
                    task: {
                        ...new ApiTaskConverter(updateEvent).into(taskId),
                        notes,
                    },
                    nextCursor,
                    tasks,
                },
            };
        },
    },

    "/tasks/{id}/notes": {
        patch: async (context, {pathParameters, requestBody}) => {
            const taskId = pathParameters.id;

            const {spaceId, notes} = await updateTaskNotesFromApi(context, {
                taskId,
                patches: requestBody.patches,
            });

            return {
                content: {
                    spaceId,
                    notes,
                },
            };
        },

        get: async (context, {pathParameters}) => {
            const {spaceId, notes} = await getApiTaskNotes(context, pathParameters.id, {
                consistency: "StrongWithinCache",
            });

            return {
                content: {
                    spaceId,
                    notes,
                },
            };
        },
    },

    "/tasks/{id}-reference": {
        get: async (context, {pathParameters}) => {
            const spaceId = context.actor.getSpaceId();

            const {title, displayStatus} = await getApiTaskMentionTitleWithStrongConsistency(
                context,
                spaceId,
                `Task:${pathParameters.id}`,
            );

            return {
                content: {
                    spaceId,
                    reference: {
                        type: "Task",
                        id: pathParameters.id,
                        title,
                        status: intoApiTaskStatus(displayStatus),
                    },
                },
            };
        },
    },

    "/tasks/{id}/messages/{index}": {
        get: async (context, {pathParameters}) => {
            const message = await getTaskCommentPayload(context, {
                taskId: pathParameters.id,
                commentIndex: pathParameters.index,
                consistency: "StrongWithinCache",
            });

            return {
                content: {
                    spaceId: message.spaceId,
                    message: await intoApiMessage(context, {
                        spaceId: message.spaceId,
                        entityId: `TaskComment:${pathParameters.id}-${pathParameters.index}`,
                        fileAuthorizer: FileTaskAuthorizer.bind({
                            type: "TaskComments",
                            taskId: pathParameters.id,
                        }),
                        message,
                        intoContentPayloadParent: createIntoApiTaskCommentContentPayloadParent(
                            context,
                            message.spaceId,
                            pathParameters.id,
                        ),
                    }),
                },
            };
        },
    },

    "/tasks/{id}/messages": {
        get: async (context, {pathParameters, queryParameters}) => {
            const {spaceId, commentCount, comments} =
                queryParameters.from === "End"
                    ? await getTaskCommentPayloadsFromEnd(context, {
                          taskId: pathParameters.id,
                          limit: queryParameters.limit ?? 10,
                          afterCommentIndex: null,
                          beforeCommentIndex: queryParameters.cursor ?? null,
                          consistency: "StrongWithinCache",
                      })
                    : await getTaskCommentPayloadsFromStart(context, {
                          taskId: pathParameters.id,
                          limit: queryParameters.limit ?? 10,
                          afterCommentIndex: queryParameters.cursor ?? null,
                          beforeCommentIndex: null,
                          consistency: "StrongWithinCache",
                      });

            let nextCursor: number | null;

            if (comments.length === 0) {
                nextCursor = null;
            } else {
                if (queryParameters.from === "End") {
                    const firstComment = comments[0]!;
                    if (firstComment.index > 0) {
                        nextCursor = firstComment.index;
                    } else {
                        nextCursor = null;
                    }
                } else {
                    const lastComment = comments[comments.length - 1]!;
                    if (lastComment.index < commentCount - 1) {
                        nextCursor = lastComment.index;
                    } else {
                        nextCursor = null;
                    }
                }
            }

            return {
                content: {
                    spaceId,
                    totalMessageCount: commentCount,
                    nextCursor,
                    messages: await runAllPromises(
                        comments.map(message =>
                            intoApiMessage(context, {
                                spaceId,
                                entityId: `TaskComment:${pathParameters.id}-${message.index}`,
                                fileAuthorizer: FileTaskAuthorizer.bind({
                                    type: "TaskComments",
                                    taskId: pathParameters.id,
                                }),
                                message,
                                intoContentPayloadParent:
                                    createIntoApiTaskCommentContentPayloadParent(
                                        context,
                                        spaceId,
                                        pathParameters.id,
                                    ),
                            }),
                        ),
                    ),
                },
            };
        },
        post: async (context, {pathParameters, requestBody}) => {
            const parent = fromApiMessageContentPayloadParent(requestBody.parent);

            const content = assertMessageContent(
                fromApiContent(MessageContentProsemirrorSchema, requestBody.content),
            );

            const createdTimeZone = requestBody.createdTimeZone ?? defaultTimeZone;
            const fileIds = (requestBody.files ?? []).map(
                getFileIdOrFileEntityIdFromApiMessageContentPayloadFile,
            );
            const attachmentFileIds = fileIds.filter((id): id is FileId => isId(id));

            await runAllPromises(
                attachmentFileIds.map(fileId =>
                    attachFileToTargetAsBot(
                        context,
                        fileId,
                        FileTaskAuthorizer.bind({
                            type: "TaskComments",
                            taskId: pathParameters.id,
                        }),
                    ),
                ),
            );

            const {spaceId, index, createdTime} = await createTaskComment(context, {
                taskId: pathParameters.id,
                parent,
                content,
                createdTimeZone,
                fileIds,
                isStream: requestBody.isStream,
                consistency: "StrongWithinCache",
            });

            const payload: MessageContentPayload = {
                type: "Content",
                parent,
                content,
                contentUpdate: null,
                fileIds,
                reactionsByPos: emptyMap,
                filesReactions: emptyReactionSet,
            };

            // If this broadcast fails (or it's never sent, say if the process dies) then users
            // connected to this messaging room won't see this message appear in realtime. The
            // realtime connection will be "stuck". Any future messages will be placed in a
            // queue (since the connection is waiting on a previous message) and will never be
            // flushed to the client.
            //
            // To get out of this state, the user can reload the page. Or navigate to another
            // page then navigate back. We hope this won't be too big of an issue since the
            // user should still receive a realtime inbox update telling them they have a new
            // message.
            //
            // NOTE(calebmer): The best fix for this is probably to send the broadcast event in
            // a DynamoDB Streams listener that reacts to the update. We plan to move
            // `NotificationEvent`, `IndexSearchEntity`, and other processing that needs to
            // reliably run after an updates to DynamoDB Stream.
            context.process.waitUntil(
                context.edge.broadcastToDurableObject(
                    `/api/durable-objects/task-notes/${pathParameters.id}/broadcast-new-message`,
                    {
                        serviceName: "TaskNotesCollaborationService",
                        route: "/api/durable-objects/task-notes/:taskId/broadcast-new-message",
                        body: MessagingRealtimeBroadcastNewMessageRequestSchema.serialize({
                            index,
                            version: 0,
                            authorId: context.actor.getBotAccountId(),
                            createdTime,
                            createdTimeZone,
                            payload,
                            stream: requestBody.isStream
                                ? {createdTime, completedTime: null, parts: []}
                                : null,
                        }),
                    },
                ),
            );

            return {
                content: {
                    spaceId,
                    message: await intoApiMessage(context, {
                        spaceId,
                        entityId: `TaskComment:${pathParameters.id}-${index}`,
                        fileAuthorizer: FileTaskAuthorizer.bind({
                            type: "TaskComments",
                            taskId: pathParameters.id,
                        }),
                        message: {
                            index,
                            version: 0,
                            authorId: context.actor.getBotAccountId(),
                            createdTime,
                            createdTimeZone,
                            payload,
                            stream: requestBody.isStream
                                ? {createdTime, completedTime: null, parts: [], lastPingTime: null}
                                : null,
                        },
                        intoContentPayloadParent: createIntoApiTaskCommentContentPayloadParent(
                            context,
                            spaceId,
                            pathParameters.id,
                        ),
                    }),
                },
            };
        },
    },

    "/tasks/{id}/messages/{index}/stream/completion": {
        put: async (context, {pathParameters}) => {
            const {spaceId, completedTime} = await completeTaskCommentStream(context, {
                taskId: pathParameters.id,
                commentIndex: pathParameters.index,
                consistency: "StrongWithinCache",
            });

            return {
                content: {
                    spaceId,
                    completion: {completedTime: serializeDateString(completedTime)},
                },
            };
        },
    },

    "/tasks/{id}/messages/{index}/stream/ping": {
        put: async (context, {pathParameters}) => {
            const {spaceId, lastPingTime} = await pingTaskCommentStream(context, {
                taskId: pathParameters.id,
                commentIndex: pathParameters.index,
                consistency: "StrongWithinCache",
            });

            return {
                content: {
                    spaceId,
                    ping: {
                        lastUpdatedTime: serializeDateString(lastPingTime),
                    },
                },
            };
        },
    },

    "/tasks/{id}/messages/{index}/stream/parts": {
        post: async (context, {pathParameters, requestBody}) => {
            const payload = fromApiMessageStreamPartPayload(requestBody.payload);

            const {spaceId} = await putTaskCommentStreamPart(context, {
                taskId: pathParameters.id,
                commentIndex: pathParameters.index,
                partIndex: "Create",
                payload,
                consistency: "StrongWithinCache",
            });

            return {content: {spaceId}};
        },
    },

    "/tasks/{id}/messages/{index}/stream/parts/{partIndex}": {
        put: async (context, {pathParameters, requestBody}) => {
            const payload = fromApiMessageStreamPartPayload(requestBody.payload);

            const {spaceId} = await putTaskCommentStreamPart(context, {
                taskId: pathParameters.id,
                commentIndex: pathParameters.index,
                partIndex: pathParameters.partIndex,
                payload,
                consistency: "StrongWithinCache",
            });

            return {content: {spaceId}};
        },
    },

    "/task-collections": {
        post: async (context, {requestBody}) => {
            const spaceId = context.actor.getSpaceId();
            const {collection} = requestBody;
            const collectionId = generateId<TaskCollectionId>();
            const clock = new HybridLogicalClock(unsynchronizedSystemClock);
            const botAccountId = context.actor.getBotAccountId();
            const creatorId = collection.creator?.id ?? botAccountId;
            const actor = createApiTaskActor({actorId: creatorId, botAccountId});

            const accessPolicy = await createAccessPolicyForContentCreatedByBot(context, spaceId, {
                consistency: "StrongWithinCache",
            });

            await commitTaskActionTransaction(
                context,
                spaceId,
                [
                    {
                        type: "UpdateCollection",
                        time: clock.now(),
                        collectionId,
                        collectionAction: {
                            type: "Create",
                            creator: actor,
                            name: collection.name,
                            accessPolicy,
                        },
                    },
                    ...(collection.color !== undefined
                        ? [
                              {
                                  type: "UpdateCollection" as const,
                                  time: clock.now(),
                                  actor,
                                  collectionId,
                                  collectionAction: {
                                      type: "UpdateColor" as const,
                                      color: collection.color
                                          ? fromApiThemeColor(collection.color)
                                          : null,
                                  },
                              },
                          ]
                        : []),
                ],
                {waitForProcessing: true},
            );

            return {
                content: {
                    spaceId,
                    collection: {
                        id: collectionId,
                        creator: {
                            id: creatorId,
                        },
                        name: collection.name,
                        color: collection.color ?? undefined,
                        defaults: {filters: [], sorts: []},
                    },
                },
            };
        },
    },

    "/task-collections/{id}": {
        patch: async (context, {pathParameters, requestBody}) => {
            const spaceId = context.actor.getSpaceId();

            const collection = await updateTaskCollectionFromApi(context, {
                spaceId,
                collectionId: pathParameters.id,
                actorId: requestBody.actor?.id,
                patches: requestBody.patches,
            });

            return {
                content: {
                    spaceId,
                    collection: await intoApiTaskCollection(context, collection),
                },
            };
        },

        get: async (context, {pathParameters}) => {
            const collection = await context.tasks.getCollection(
                context.actor.getSpaceId(),
                pathParameters.id,
                {consistency: "StrongWithinCache"},
            );

            return {
                content: {
                    spaceId: context.actor.getSpaceId(),
                    collection: await intoApiTaskCollection(context, collection),
                },
            };
        },
    },

    "/task-collections/{id}-reference": {
        get: async (context, {pathParameters}) => {
            const spaceId = context.actor.getSpaceId();

            const {title} = await getApiMentionTitleWithStrongConsistency(
                context,
                spaceId,
                `TaskCollection:${pathParameters.id}`,
            );

            return {
                content: {
                    spaceId,
                    reference: {
                        type: "TaskCollection",
                        id: pathParameters.id,
                        title,
                    },
                },
            };
        },
    },

    "/task-collections/{id}-preview": {
        get: async (context, {pathParameters}) => {
            const spaceId = context.actor.getSpaceId();

            const collection = await context.tasks.getCollection(spaceId, pathParameters.id, {
                consistency: "StrongWithinCache",
            });

            return {
                content: {
                    spaceId,
                    collection: {
                        id: collection.id,
                        name: collection.getName(),
                    },
                },
            };
        },
    },

    "/task-collections/{id}/tasks": {
        get: async (context, {pathParameters, queryParameters}) => {
            const collectionId = pathParameters.id;

            const {spaceId, updateEvent, nextCursor, tasks} = await loadTasksFromApiQuery(context, {
                query: {
                    type: "Collection",
                    limit: queryParameters.limit ?? 10,
                    collectionId,
                    evaluationContext: {
                        currentAccountId: null,
                        currentDate: today(defaultTimeZone),
                    },
                    expensivelyAfterCursorForApi: queryParameters.cursor,
                },
                taskIds: [],
                collectionIds: [collectionId],
            });

            const collection = assertExists(
                findMapIterable(updateEvent.backfillCollections, backfillCollection =>
                    backfillCollection.type === "Authorized" &&
                    backfillCollection.collection.id === collectionId
                        ? backfillCollection.collection
                        : undefined,
                ),
            );

            return {
                content: {
                    spaceId,
                    collection: await intoApiTaskCollection(context, collection),
                    nextCursor,
                    tasks,
                },
            };
        },
    },

    "/task-collections/{id}/tasks-query": {
        post: async (context, {pathParameters, requestBody}) => {
            const collectionId = pathParameters.id;

            const {spaceId, updateEvent, nextCursor, tasks} = await loadTasksFromApiQuery(context, {
                query: {
                    type: "Collection",
                    limit: requestBody.limit ?? 10,
                    collectionId,
                    evaluationContext: {
                        currentAccountId: null,
                        currentDate: today(defaultTimeZone),
                    },
                    filters: requestBody.filters?.map(fromApiTaskQueryFilter),
                    sorts: requestBody.sorts?.map(fromApiTaskQuerySort),
                    expensivelyAfterCursorForApi: requestBody.cursor,
                },
                taskIds: [],
                collectionIds: [collectionId],
            });

            const collection = assertExists(
                findMapIterable(updateEvent.backfillCollections, backfillCollection =>
                    backfillCollection.type === "Authorized" &&
                    backfillCollection.collection.id === collectionId
                        ? backfillCollection.collection
                        : undefined,
                ),
            );

            return {
                content: {
                    spaceId,
                    collection: await intoApiTaskCollection(context, collection),
                    nextCursor,
                    tasks,
                },
            };
        },
    },

    "/tasks/{id}/messages/{index}/experimental-approvals": {
        get: async (context, {pathParameters}) => {
            const {spaceId, approvals} = await getTaskCommentMessageApprovals(context, {
                taskId: pathParameters.id,
                commentIndex: pathParameters.index,
                consistency: "StrongWithinCache",
            });

            const referenceContext = context.dynamo.unexpectStrongReadConsistency();
            return {
                content: {
                    spaceId,
                    approvals: await runAllPromises(
                        approvals.map(approval =>
                            intoApiMessageExperimentalApproval(referenceContext, {
                                spaceId,
                                approval,
                            }),
                        ),
                    ),
                },
            };
        },
        patch: async (context, {pathParameters, requestBody}) => {
            const {spaceId, approvals, partIndex, version, createdTime, completedTime} =
                await putTaskCommentMessageApprovalDecisions(context, {
                    taskId: pathParameters.id,
                    commentIndex: pathParameters.index,
                    payload: {
                        type: "ExperimentalDecisions",
                        decisions: requestBody.patches.map(patch => ({
                            index: patch.index,
                            value: patch.decision.value,
                        })),
                    },
                    consistency: "StrongWithinCache",
                });

            broadcastPutTaskCommentStreamPart(context, {
                taskId: pathParameters.id,
                commentIndex: pathParameters.index,
                partIndex,
                version,
                payload: {type: "ExperimentalApprovals", approvals},
                createdTime,
                completedTime,
            });

            const referenceContext = context.dynamo.unexpectStrongReadConsistency();
            return {
                content: {
                    spaceId,
                    approvals: await runAllPromises(
                        approvals.map(approval =>
                            intoApiMessageExperimentalApproval(referenceContext, {
                                spaceId,
                                approval,
                            }),
                        ),
                    ),
                },
            };
        },
    },
};
