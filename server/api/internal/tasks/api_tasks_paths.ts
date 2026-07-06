import {parseDate, today} from "@internationalized/date";
import {createAccessPolicyForContentCreatedByBot} from "~/server/access/create_access_policy_for_content_created_by_bot.js";
import {ApiPaths} from "~/server/api/internal/shared/api_paths_type.js";
import {fromApiMessageContentPayloadParent} from "~/server/api/internal/shared/from_api_message_content_payload_parent.js";
import {fromApiMessageStreamPartPayload} from "~/server/api/internal/shared/from_api_message_stream_part_payload.js";
import {
    getApiMentionTitleWithStrongConsistency,
    getApiTaskMentionTitleWithStrongConsistency,
    intoApiContentWithReferences,
} from "~/server/api/internal/shared/into_api_content_with_references.js";
import {intoApiMessage} from "~/server/api/internal/shared/into_api_message.js";
import {ApiTaskConverter} from "~/server/api/internal/tasks/internal/api_task_converter.js";
import {createIntoApiTaskCommentContentPayloadParent} from "~/server/api/internal/tasks/internal/create_into_api_task_comment_content_payload_parent.ts.js";
import {createTaskFromApi} from "~/server/api/internal/tasks/internal/create_task_from_api.js";
import {fromApiTaskLayout} from "~/server/api/internal/tasks/internal/from_api_task_layout.js";
import {getApiTaskNotes} from "~/server/api/internal/tasks/internal/get_api_task_notes.js";
import {intoApiTaskCollection} from "~/server/api/internal/tasks/internal/into_api_task_collection.js";
import {updateTaskCollectionFromApi} from "~/server/api/internal/tasks/internal/update_task_collection_from_api.js";
import {updateTaskNotesFromApi} from "~/server/api/internal/tasks/internal/update_task_notes_from_api.js";
import {updateTaskWithoutNotesFromApi} from "~/server/api/internal/tasks/internal/update_task_without_notes_from_api.js";
import {attachFileToTargetAsBot} from "~/server/files/data/attach_file_to_target_as_bot.js";
import {FileTaskAuthorizer} from "~/server/tasks/data/authorization/file_task_authorizer.js";
import {commitTaskActionTransaction} from "~/server/tasks/data/commit_task_action_transaction.js";
import {
    completeTaskCommentStream,
    createTaskComment,
    getTaskCommentPayload,
    getTaskCommentPayloadsFromEnd,
    getTaskCommentPayloadsFromStart,
    pingTaskCommentStream,
    putTaskCommentStreamPart,
} from "~/server/tasks/data/task_messaging.js";
import {LocalAccessPolicy} from "~/shared/access/access_policy.js";
import {ApiContentKeyEncoder} from "~/shared/api/content/closed_source/api_content_key_encoder.js";
import {extractFileIdsFromApiContent} from "~/shared/api/content/closed_source/extract_file_ids_from_api_content.js";
import {fromApiContent} from "~/shared/api/content/closed_source/from_api_content.js";
import {fromApiThemeColor} from "~/shared/api/content/closed_source/from_api_theme_color.js";
import {intoApiTaskStatus} from "~/shared/api/content/closed_source/into_api_task_status.js";
import {
    MessageContentProsemirrorSchema,
    assertMessageContent,
} from "~/shared/content/message_content_schema.js";
import {InternalError} from "~/shared/error/error.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {HybridLogicalClock} from "~/shared/helpers/clock/hybrid_logical_clock.js";
import {unsynchronizedSystemClock} from "~/shared/helpers/clock/unsynchronized_system_clock.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {unwrapResult} from "~/shared/helpers/control/capture_result.js";
import {captureResultPromise} from "~/shared/helpers/control/capture_result_promise.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {serializeDateString} from "~/shared/helpers/date/date_string.js";
import {defaultTimeZone} from "~/shared/helpers/intl/time_zone.js";
import {findMapIterable} from "~/shared/helpers/iterable/find_map_iterable.js";
import {emptyMap} from "~/shared/helpers/map/empty_map.js";
import {generateId} from "~/shared/id/id.js";
import {ApiTaskCursor} from "~/shared/id/types/api_task_cursor.js";
import {TaskCollectionId, TaskId} from "~/shared/id/types/id_types.js";
import {MessageContentPayload} from "~/shared/messaging/message_schema.js";
import {MessagingRealtimeBroadcastNewMessageRequestSchema} from "~/shared/messaging/messaging_realtime_protocol.js";
import {emptyReactionSet} from "~/shared/reactions/reaction_set.js";
import {
    decodeApiTaskCursor,
    encodeApiTaskCursor,
} from "~/shared/tasks/model/encode_api_task_cursor.js";
import {evaluateTaskQueryNormalizedFiltersForModel} from "~/shared/tasks/model/evaluate_task_query_normalized_filters_for_model.js";
import {getTaskQueryNormalizedSortCursorForModel} from "~/shared/tasks/model/get_task_query_normalized_sort_cursor_for_model.js";
import {TaskActor} from "~/shared/tasks/task_creator.js";
import {
    TaskNotesContentProsemirrorSchema,
    assertTaskNotesContent,
    emptyTaskNotesContent,
} from "~/shared/tasks/task_notes_content_schema.js";
import {compareTaskQuerySortCursors} from "~/shared/tasks/task_query_sort_cursor.js";

export const apiTasksPaths: Pick<
    ApiPaths,
    keyof ApiPaths &
        ("/task-collections" | `/task-collections/${string}` | "/tasks" | `/tasks/${string}`)
> = {
    "/tasks": {
        post: async (context, {requestBody}) => {
            const spaceId = context.actor.getSpaceId();
            const {task: taskInput} = requestBody;
            const consistency = "StrongWithinCache" as const;
            const title = taskInput.title ?? "";

            const notesContent = taskInput.content
                ? assertTaskNotesContent(
                      fromApiContent(TaskNotesContentProsemirrorSchema, taskInput.content),
                  )
                : undefined;

            const dueDate = taskInput.due ? parseDate(taskInput.due.date) : undefined;

            const taskId = generateId<TaskId>();
            const accessPolicyPromise = createAccessPolicyForContentCreatedByBot(context, spaceId, {
                consistency,
            });

            let accessPolicy: LocalAccessPolicy;

            // Attach files referenced in the content before creating the task so there's no
            // race where a reader sees the task before its files are attached.
            //
            // We intentionally keep file attachment in `api_*_paths.ts` instead of moving it
            // into `createTaskFromApi()`. Attaching files is adjacent to task creation, but it
            // is not part of the task write itself, and we've agreed this one-off pre-step
            // does not need to be atomic with the task transaction.
            if (taskInput.content) {
                const fileIds = extractFileIdsFromApiContent(taskInput.content);
                [accessPolicy] = await runAllPromises([
                    accessPolicyPromise,
                    runAllPromises(
                        [...fileIds].map(fileId =>
                            attachFileToTargetAsBot(
                                context,
                                fileId,
                                FileTaskAuthorizer.bind({type: "TaskNotes", taskId}),
                            ),
                        ),
                    ),
                ]);
            } else {
                accessPolicy = await accessPolicyPromise;
            }

            const [{task, referencedAccounts}, content, resultResult] = await runAllPromises([
                createTaskFromApi(context, {
                    taskId,
                    spaceId,
                    accessPolicy,
                    creatorId: taskInput.creator?.id,
                    title,
                    notesContent,
                    assigneeId: taskInput.assignee?.id,
                    status: taskInput.status,
                    dueDate,
                    priority: taskInput.priority?.type,
                    layout: taskInput.layout ? fromApiTaskLayout(taskInput.layout) : undefined,
                    parentTaskId: taskInput.parent?.task.id,
                    collectionIds: taskInput.collections?.map(item => item.collection.id),
                }),
                intoApiContentWithReferences(context, {
                    spaceId,
                    fileAuthorizer: FileTaskAuthorizer.bind({type: "TaskNotes", taskId}),
                    content: notesContent ?? emptyTaskNotesContent,
                    contentKeyEncoder: new ApiContentKeyEncoder({
                        entityId: `Task:${taskId}`,
                        version: 0,
                    }),
                }),
                // If you don't have access to the parent task or `collectionIds` then
                // `createTaskFromApi()` will throw and we want to use that error.
                captureResultPromise(
                    context.tasks.loadQueries(
                        // NOCOMMIT: What happens if task exists but in a different space? We should throw
                        // some kind of error.
                        context.actor.getSpaceId(),
                        {
                            queries: [],
                            taskIds: taskInput.parent?.task.id ? [taskInput.parent?.task.id] : [],
                            // NOCOMMIT: Test what happens if you don't have access to the parent task or
                            // collections?
                            collectionIds:
                                taskInput.collections?.map(item => item.collection.id) ?? [],
                        },
                        {consistency: "StrongWithinCache"},
                    ),
                ),
            ]);

            const result = unwrapResult(resultResult);

            return {
                content: {
                    spaceId,
                    task: {
                        ...new ApiTaskConverter(result.updateEvent).into(task, {
                            referencedAccounts,
                        }),
                        notes: {version: 0, content},
                    },
                },
            };
        },
    },

    "/tasks/{id}": {
        patch: async (context, {pathParameters, requestBody}) => {
            const spaceId = context.actor.getSpaceId();
            const consistency = "StrongWithinCache" as const;
            const taskId = pathParameters.id;

            const [{updatedTask, updateEvent}, {notes}] = await runAllPromises([
                updateTaskWithoutNotesFromApi(context, {
                    spaceId,
                    taskId,
                    actorId: requestBody.actor?.id,
                    patches: requestBody.patches,
                }),
                getApiTaskNotes(context, taskId, {consistency}),
            ]);

            return {
                content: {
                    spaceId,
                    task: {
                        ...new ApiTaskConverter(updateEvent).into(updatedTask),
                        notes,
                    },
                },
            };
        },

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

    "/tasks/{id}/notes": {
        patch: async (context, {pathParameters, requestBody}) => {
            const taskId = pathParameters.id;

            const {spaceId, notes} = await updateTaskNotesFromApi(context, {
                taskId,
                patch: requestBody.notes,
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

    "/tasks/{id}/reference": {
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

            const {spaceId, index, createdTime} = await createTaskComment(context, {
                taskId: pathParameters.id,
                parent,
                content,
                createdTimeZone,
                fileIds: [],
                isStream: requestBody.isStream,
                consistency: "StrongWithinCache",
            });

            const payload: MessageContentPayload = {
                type: "Content",
                parent,
                content,
                contentUpdate: null,
                fileIds: [],
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
            const actor: TaskActor = {
                accountId: creatorId,
                from: {type: "Bot", accountId: botAccountId},
            };

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
                            creator: {
                                accountId: creatorId,
                                from: {type: "Bot", accountId: botAccountId},
                            },
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
                    collection: intoApiTaskCollection(collection),
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
                    collection: intoApiTaskCollection(collection),
                },
            };
        },
    },

    "/task-collections/{id}/reference": {
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

    "/task-collections/{id}/tasks": {
        get: async (context, {pathParameters, queryParameters}) => {
            const limit = queryParameters.limit ?? 10;
            const collectionId = pathParameters.id;
            const spaceId = context.actor.getSpaceId();

            // NOCOMMIT: Bring filters back! How?

            const {queries, updateEvent} = await context.tasks.loadQueries(
                context.actor.getSpaceId(),
                {
                    queries: [
                        {
                            type: "Collection",
                            limit,
                            collectionId,
                            evaluationContext: {
                                currentAccountId: null,
                                currentDate: today(defaultTimeZone),
                            },
                            expensivelyAfterCursorForApi: queryParameters.cursor,
                        },
                    ],
                    taskIds: [],
                    collectionIds: [collectionId],
                },
                {consistency: "StrongWithinCache"},
            );

            const query = assertExists(queries[0]);

            const collection = assertExists(
                findMapIterable(updateEvent.backfillCollections, backfillCollection =>
                    backfillCollection.type === "Authorized" &&
                    backfillCollection.collection.id === collectionId
                        ? backfillCollection.collection
                        : undefined,
                ),
            );

            const tasks = [];

            const {loadedState, sorts, filtersResult} = query;

            const afterCursor =
                queryParameters.cursor !== undefined
                    ? decodeApiTaskCursor(sorts, queryParameters.cursor)
                    : null;

            if (filtersResult.type === "Possible") {
                const filters = filtersResult.normalizedFilters;

                for (const backfillTask of updateEvent.backfillTasks) {
                    if (backfillTask.type !== "Authorized") continue;
                    const {task} = backfillTask;

                    if (!evaluateTaskQueryNormalizedFiltersForModel(filters, task)) continue;

                    const cursor = getTaskQueryNormalizedSortCursorForModel(sorts, task);

                    // If the task is before or equal to `afterCursor` then it's outside the loaded
                    // range for this request.
                    if (
                        afterCursor !== null &&
                        compareTaskQuerySortCursors(sorts, afterCursor, cursor) >= 0
                    ) {
                        continue;
                    }

                    // If the task is after (though not equal to) `endCursor` then it's outside the
                    // loaded range for this request.
                    if (
                        loadedState.type === "Partial" &&
                        loadedState.endCursor !== null &&
                        compareTaskQuerySortCursors(sorts, loadedState.endCursor, cursor) < 0
                    ) {
                        continue;
                    }

                    tasks.push({cursor, task});
                }
            }

            tasks.sort((task1, task2) =>
                compareTaskQuerySortCursors(sorts, task1.cursor, task2.cursor),
            );

            let nextCursor: ApiTaskCursor | null;

            switch (loadedState.type) {
                case "Full": {
                    nextCursor = null;
                    break;
                }
                case "Partial": {
                    // NOTE(calebmer): I'll be honest, I don't think `endCursor` null should be
                    // possible here but I'm not 100% sure. There may be a rare edge case in here where
                    // we call `loadQuery()` which then queries OpenSearch which then returns `limit`
                    // items but then when we apply the recent action history ALL `limit` tasks move so
                    // they're out of the loaded range. But even in that case wouldn't then `endCursor`
                    // be the end of the loaded range? Anyway, I'm not sure. ([This is the case I'm
                    // thinking of.][1])
                    //
                    // What I do know is that the API doesn't support expressing "has next page but we
                    // don't have a cursor". So throw for now. Let's see if this error actually happens
                    // in practice. Another solution idea is to retry the query. If this is the result
                    // of an edge case where tasks have recently moved then retrying the query on an
                    // exponential backoff until we get data should work? _Shrug_
                    //
                    // [1]:
                    //     https://github.com/cyberworlds/cyberworlds/blob/cb7c5fa0445a72db694b2a2973f8a20eb3fd9d23/server/tasks/realtime/task_realtime_query.ts#L470-L480
                    if (loadedState.endCursor === null) {
                        throw new InternalError(
                            "Expected non-null `endCursor` for `Partial` loaded state",
                        );
                    }

                    nextCursor = encodeApiTaskCursor(sorts, loadedState.endCursor);
                    break;
                }
                default:
                    throw exhaustive(loadedState);
            }

            const converter = new ApiTaskConverter(updateEvent);

            return {
                content: {
                    spaceId,
                    collection: intoApiTaskCollection(collection),
                    nextCursor,
                    tasks: tasks.map(({cursor, task}) => ({
                        cursor: encodeApiTaskCursor(sorts, cursor),
                        task: converter.into(task),
                    })),
                },
            };
        },
    },
};
