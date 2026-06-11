import {parseDate} from "@internationalized/date";
import {createAccessPolicyForContentCreatedByBot} from "~/server/access/create_access_policy_for_content_created_by_bot.js";
import {ApiPaths} from "~/server/api/internal/shared/api_paths_type.js";
import {fromApiMessageContentPayloadParent} from "~/server/api/internal/shared/from_api_message_content_payload_parent.js";
import {fromApiMessageStreamPartPayload} from "~/server/api/internal/shared/from_api_message_stream_part_payload.js";
import {getApiAccount} from "~/server/api/internal/shared/get_api_account.js";
import {
    getApiMentionTitleWithStrongConsistency,
    getApiTaskMentionTitleWithStrongConsistency,
    intoApiContentWithReferences,
} from "~/server/api/internal/shared/into_api_content_with_references.js";
import {intoApiMessage} from "~/server/api/internal/shared/into_api_message.js";
import {createIntoApiTaskCommentContentPayloadParent} from "~/server/api/internal/tasks/internal/create_into_api_task_comment_content_payload_parent.ts.js";
import {createTaskFromApi} from "~/server/api/internal/tasks/internal/create_task_from_api.js";
import {getApiTasksWithoutContent} from "~/server/api/internal/tasks/internal/get_api_tasks_without_content.js";
import {intoApiTask} from "~/server/api/internal/tasks/internal/into_api_task.js";
import {updateTaskCollectionFromApi} from "~/server/api/internal/tasks/internal/update_task_collection_from_api.js";
import {updateTaskFromApi} from "~/server/api/internal/tasks/internal/update_task_from_api.js";
import {attachFileToTargetAsBot} from "~/server/files/data/attach_file_to_target_as_bot.js";
import {FileTaskAuthorizer} from "~/server/tasks/data/authorization/file_task_authorizer.js";
import {commitTaskActionTransaction} from "~/server/tasks/data/commit_task_action_transaction.js";
import {getTaskNotesContentWithCustomReferences} from "~/server/tasks/data/get_task_notes_content_with_custom_references.js";
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
import {extractFileIdsFromApiContent} from "~/shared/api/content/extract_file_ids_from_api_content.js";
import {fromApiContent} from "~/shared/api/content/from_api_content.js";
import {fromApiThemeColor} from "~/shared/api/content/from_api_theme_color.js";
import {intoApiTaskStatus} from "~/shared/api/content/into_api_task_status.js";
import {intoApiThemeColor} from "~/shared/api/content/into_api_theme_color.js";
import {
    MessageContentProsemirrorSchema,
    assertMessageContent,
} from "~/shared/content/message_content_schema.js";
import {assertNonEmptyReadonlyArray} from "~/shared/helpers/array/non_empty_readonly_array.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {HybridLogicalClock} from "~/shared/helpers/clock/hybrid_logical_clock.js";
import {unsynchronizedSystemClock} from "~/shared/helpers/clock/unsynchronized_system_clock.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {serializeDateString} from "~/shared/helpers/date/date_string.js";
import {defaultTimeZone} from "~/shared/helpers/intl/time_zone.js";
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
import {
    TaskQueryCollectionsNormalizedFilter,
    TaskQueryDisplayStatusNormalizedFilter,
    assertNonEmptyReadonlyMap,
} from "~/shared/tasks/task_query_normalized_filters.js";
import {TaskQueryNormalizedSort} from "~/shared/tasks/task_query_normalized_sort.js";

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

            const [task, content] = await runAllPromises([
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
                    priority: taskInput.priority,
                }),
                intoApiContentWithReferences(
                    context,
                    spaceId,
                    FileTaskAuthorizer.bind({type: "TaskNotes", taskId}),
                    notesContent ?? emptyTaskNotesContent,
                ),
            ]);

            const assigneeId = task.assigneeId;
            const apiAssignee =
                assigneeId !== undefined
                    ? await getApiAccount(context, spaceId, assigneeId, {
                          consistency: "StrongWithinCache",
                      })
                    : undefined;

            return {
                content: {
                    spaceId,
                    task: {
                        id: task.id,
                        creator: {id: task.creatorId},
                        status: task.status,
                        title: task.title,
                        assignee: apiAssignee ?? undefined,
                        due: task.dueDate ? {date: task.dueDate.toString()} : undefined,
                        priority: task.priority,
                        content,
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
            const taskContentPromise = getTaskNotesContentWithCustomReferences(
                context,
                taskId,
                async (context, spaceId, task) =>
                    await intoApiContentWithReferences(
                        context,
                        spaceId,
                        FileTaskAuthorizer.bind({
                            type: "TaskNotes",
                            taskId,
                        }),
                        task.content,
                    ),
                {consistency},
            );

            const [task, {content}] = await runAllPromises([
                updateTaskFromApi(context, {
                    spaceId,
                    taskId,
                    patches: requestBody.patches,
                }),
                taskContentPromise,
            ]);

            return {
                content: {
                    spaceId,
                    task: await intoApiTask(context, task, content),
                },
            };
        },

        get: async (context, {pathParameters}) => {
            const [task, {spaceId, content}] = await runAllPromises([
                // TODO(calebmer): An optimization that would be pretty nice here is if we move
                // notes loading into `TaskRealtimeService`. Currently we have to load the data for
                // bot authorization twice. Once here in `ApiService` and again in
                // `TaskRealtimeService`. If we pushed task notes loading into
                // `TaskRealtimeService` then we could leverage `ContextCache` to only load the bot
                // authorization data once.
                context.tasks.getTaskWithoutDependencies(
                    context.actor.getSpaceId(),
                    pathParameters.id,
                    {consistency: "StrongWithinCache"},
                ),
                getTaskNotesContentWithCustomReferences(
                    context,
                    pathParameters.id,
                    (context, spaceId, task) =>
                        intoApiContentWithReferences(
                            context,
                            spaceId,
                            FileTaskAuthorizer.bind({
                                type: "TaskNotes",
                                taskId: pathParameters.id,
                            }),
                            task.content,
                        ),
                    {consistency: "StrongWithinCache"},
                ),
            ]);

            return {
                content: {
                    spaceId,
                    task: await intoApiTask(context, task, content),
                },
            };
        },
    },

    "/tasks/{id}/mention": {
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
                    mention: {
                        target: {
                            type: "Task",
                            id: pathParameters.id,
                            status: intoApiTaskStatus(displayStatus),
                        },
                        title,
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
                    message: await intoApiMessage(
                        context,
                        message.spaceId,
                        message,
                        createIntoApiTaskCommentContentPayloadParent(
                            context,
                            message.spaceId,
                            pathParameters.id,
                        ),
                    ),
                },
            };
        },
    },

    "/tasks/{id}/messages": {
        get: async (context, {pathParameters, queryParameters}) => {
            const {spaceId, commentCount, comments} =
                queryParameters.from === "end"
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
                if (queryParameters.from === "end") {
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
                            intoApiMessage(
                                context,
                                spaceId,
                                message,
                                createIntoApiTaskCommentContentPayloadParent(
                                    context,
                                    spaceId,
                                    pathParameters.id,
                                ),
                            ),
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
                    message: await intoApiMessage(
                        context,
                        spaceId,
                        {
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
                        createIntoApiTaskCommentContentPayloadParent(
                            context,
                            spaceId,
                            pathParameters.id,
                        ),
                    ),
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
                                accountId:
                                    collection.creator?.id ?? context.actor.getBotAccountId(),
                                from: {
                                    type: "Bot",
                                    accountId: context.actor.getBotAccountId(),
                                },
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
                            id: collection.creator?.id ?? context.actor.getBotAccountId(),
                        },
                        name: collection.name,
                        color: collection.color ?? undefined,
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
                patches: requestBody.patches,
            });

            return {
                content: {
                    spaceId,
                    collection: {
                        id: collection.id,
                        name: collection.getName(),
                        color: collection.getColor()
                            ? intoApiThemeColor(collection.getColor()!)
                            : undefined,
                    },
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
                    collection: {
                        id: collection.id,
                        creator: collection.rawData.creator?.accountId
                            ? {id: collection.rawData.creator.accountId}
                            : undefined,
                        name: collection.getName(),
                        color: collection.getColor()
                            ? intoApiThemeColor(collection.getColor()!)
                            : undefined,
                    },
                },
            };
        },
    },

    "/task-collections/{id}/mention": {
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
                    mention: {
                        target: {
                            type: "TaskCollection",
                            id: pathParameters.id,
                        },
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

            const statuses = new Set(
                queryParameters.status && queryParameters.status.length > 0
                    ? queryParameters.status
                    : // NOTE(iftizsimmons, 2025-11-05): We'll only showing open tasks by default since
                      // that is the default behavior in the UI. One day, when users can set default
                      // filters for a task collection, we should use that filter instead.
                      ["Open"],
            );

            const displayStatusFilter = {
                ifOpenInactive: statuses.has("Open"),
                ifOpenActive: statuses.has("Open"),
                ifClosed: statuses.has("Closed"),
            };
            assertValidTaskQueryDisplayStatusNormalizedFilter(displayStatusFilter);

            const collectionsFilter: TaskQueryCollectionsNormalizedFilter =
                assertNonEmptyReadonlyArray([
                    assertNonEmptyReadonlyMap(new Map([[collectionId, false]])),
                ]);

            const sort: TaskQueryNormalizedSort = {
                type: "CollectionPosition",
                collectionId,
                direction: "Ascending",
                missing: "Last",
            };

            const {tasks, nextCursor} = await getApiTasksWithoutContent(context, {
                collectionId,
                cursor: queryParameters.cursor ?? null,
                limit,
                filters: {displayStatusFilter, collectionsFilter},
                sorts: [sort],
            });

            return {
                content: {spaceId, nextCursor, tasks},
            };

            function assertValidTaskQueryDisplayStatusNormalizedFilter<
                T extends Record<string, boolean> = TaskQueryDisplayStatusNormalizedFilter,
            >(obj: Record<string, boolean>): asserts obj is T {
                assert(Object.values(obj).some(v => v));
            }
        },
    },
};
