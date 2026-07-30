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
import {intoApiMessageExperimentalApproval} from "~/server/api/internal/shared/into_api_message_stream_part_payload.js";
import {createApiTaskActor} from "~/server/api/internal/tasks/internal/create_api_task_actor.js";
import {ApiTaskConverter} from "~/server/api/internal/tasks/internal/api_task_converter.js";
import {createApiPatchTaskResponseCollections} from "~/server/api/internal/tasks/internal/create_api_patch_task_response_collections.js";
import {createIntoApiTaskCommentContentPayloadParent} from "~/server/api/internal/tasks/internal/create_into_api_task_comment_content_payload_parent.ts.js";
import {createTaskFromApi} from "~/server/api/internal/tasks/internal/create_task_from_api.js";
import {fromApiTaskLayout} from "~/server/api/internal/tasks/internal/from_api_task_layout.js";
import {getApiTaskNotes} from "~/server/api/internal/tasks/internal/get_api_task_notes.js";
import {intoApiTaskCollection} from "~/server/api/internal/tasks/internal/into_api_task_collection.js";
import {loadTasksFromApiQuery} from "~/server/api/internal/tasks/internal/load_tasks_from_api_query.js";
import {updateTaskCollectionFromApi} from "~/server/api/internal/tasks/internal/update_task_collection_from_api.js";
import {updateTaskNotesFromApi} from "~/server/api/internal/tasks/internal/update_task_notes_from_api.js";
import {
    updateTaskWithoutNotesFromApi,
    updateTasksWithoutNotesFromApi,
} from "~/server/api/internal/tasks/internal/update_task_without_notes_from_api.js";
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
import {LocalAccessPolicy} from "~/shared/access/access_policy.js";
import {ApiContentKeyEncoder} from "~/shared/api/content/closed_source/api_content_key_encoder.js";
import {extractFileIdsFromApiContent} from "~/shared/api/content/closed_source/extract_file_ids_from_api_content.js";
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
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {unwrapResult} from "~/shared/helpers/control/capture_result.js";
import {captureResultPromise} from "~/shared/helpers/control/capture_result_promise.js";
import {serializeDateString} from "~/shared/helpers/date/date_string.js";
import {defaultTimeZone} from "~/shared/helpers/intl/time_zone.js";
import {findMapIterable} from "~/shared/helpers/iterable/find_map_iterable.js";
import {emptyMap} from "~/shared/helpers/map/empty_map.js";
import {generateId} from "~/shared/id/id.js";
import {TaskCollectionId, TaskId} from "~/shared/id/types/id_types.js";
import {MessageContentPayload} from "~/shared/messaging/message_schema.js";
import {MessagingRealtimeBroadcastNewMessageRequestSchema} from "~/shared/messaging/messaging_realtime_protocol.js";
import {emptyReactionSet} from "~/shared/reactions/reaction_set.js";
import {
    TaskNotesContentProsemirrorSchema,
    assertTaskNotesContent,
    emptyTaskNotesContent,
} from "~/shared/tasks/task_notes_content_schema.js";

export const apiTasksPaths: Pick<
    ApiPaths,
    keyof ApiPaths &
        ("/task-collections" | `/task-collections/${string}` | "/tasks" | `/tasks/${string}`)
> = {
    "/tasks": {
        patch: async (context, {requestBody}) => {
            const {spaceId, patches} = requestBody;
            const consistency = "StrongWithinCache" as const;
            const taskIds = Array.from(new Set(patches.map(({id}) => id)));
            const movedCollectionIdsByTaskId = new Map<TaskId, Set<TaskCollectionId>>();

            for (const {id, patch} of patches) {
                if (patch.type !== "MoveInCollection") continue;

                let movedCollectionIds = movedCollectionIdsByTaskId.get(id);

                if (movedCollectionIds === undefined) {
                    movedCollectionIds = new Set();
                    movedCollectionIdsByTaskId.set(id, movedCollectionIds);
                }

                movedCollectionIds.add(patch.collectionId);
            }

            const [{updatedTasks, updateEvent}, taskNotesEntries] = await runAllPromises([
                updateTasksWithoutNotesFromApi(context, {spaceId, patches}),
                runAllPromises(
                    taskIds.map(async taskId => {
                        const {notes} = await getApiTaskNotes(context, taskId, {consistency});
                        return [taskId, notes] as const;
                    }),
                ),
            ]);

            const taskNotesById = new Map(taskNotesEntries);
            const converter = new ApiTaskConverter(updateEvent);

            return {
                content: {
                    spaceId,
                    tasks: updatedTasks.map(task => ({
                        task: {
                            ...converter.into(task),
                            notes: assertExists(taskNotesById.get(task.id)),
                        },
                        collections: createApiPatchTaskResponseCollections(
                            task,
                            movedCollectionIdsByTaskId.get(task.id) ?? [],
                        ),
                    })),
                },
            };
        },

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
            const movedCollectionIds = new Set<TaskCollectionId>();

            for (const patch of requestBody.patches) {
                if (patch.type === "MoveInCollection") {
                    movedCollectionIds.add(patch.collectionId);
                }
            }

            const [{updatedTask, updateEvent}, {notes}] = await runAllPromises([
                updateTaskWithoutNotesFromApi(context, {
                    spaceId,
                    taskId,
                    actorId: requestBody.actor?.id,
                    patches: requestBody.patches,
                }),
                getApiTaskNotes(context, taskId, {consistency}),
            ]);

            const collections = createApiPatchTaskResponseCollections(
                updatedTask,
                movedCollectionIds,
            );

            return {
                content: {
                    spaceId,
                    task: {
                        ...new ApiTaskConverter(updateEvent).into(updatedTask),
                        notes,
                    },
                    ...(collections.length > 0 ? {collections} : {}),
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

    "/tasks/{id}/subtasks": {
        get: async (context, {pathParameters, queryParameters}) => {
            const taskId = pathParameters.id;

            const [{spaceId, updateEvent, nextCursor, tasks}, {notes}] = await runAllPromises([
                loadTasksFromApiQuery(context, {
                    query: {
                        type: "Subtasks",
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

    "/tasks/{id}/subtasks/query": {
        post: async (context, {pathParameters, requestBody}) => {
            const taskId = pathParameters.id;

            const [{spaceId, updateEvent, nextCursor, tasks}, {notes}] = await runAllPromises([
                loadTasksFromApiQuery(context, {
                    query: {
                        type: "Subtasks",
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
                    collection: intoApiTaskCollection(collection),
                    nextCursor,
                    tasks,
                },
            };
        },
    },

    "/task-collections/{id}/tasks/query": {
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
                    collection: intoApiTaskCollection(collection),
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
