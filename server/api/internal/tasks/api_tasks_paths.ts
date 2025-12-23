import {fromApiContent} from "~/server/api/content/from_api_content.js";
import {ApiPaths} from "~/server/api/internal/shared/api_paths_type.js";
import {fromApiMessageStreamPartPayload} from "~/server/api/internal/shared/from_api_message_stream_part_payload.js";
import {getApiAccount} from "~/server/api/internal/shared/get_api_account.js";
import {intoApiContentWithReferences} from "~/server/api/internal/shared/into_api_content_with_references.js";
import {intoApiMessage} from "~/server/api/internal/shared/into_api_message.js";
import {getApiTasksWithoutContent} from "~/server/api/internal/tasks/internal/get_api_tasks_without_content.js";
import {
    FileTaskAuthorizer,
    completeTaskCommentStream,
    createTaskComment,
    getTaskCommentPayload,
    getTaskCommentPayloadsFromEnd,
    getTaskCommentPayloadsFromStart,
    getTaskNotesContentWithCustomReferences,
    pingTaskCommentStream,
    putTaskCommentStreamPart,
} from "~/server/tasks/data/task_table.js";
import {ApiTask} from "~/shared/api/types/api_specification_convenience_types.js";
import {assertNonEmptyReadonlyArray} from "~/shared/helpers/array/non_empty_readonly_array.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {serializeDateString} from "~/shared/helpers/date/date_string.js";
import {defaultTimeZone} from "~/shared/helpers/intl/time_zone.js";
import {emptyMap} from "~/shared/helpers/map/empty_map.js";
import {
    MessageContentProsemirrorSchema,
    assertMessageContent,
} from "~/shared/messaging/message_content_schema.js";
import {MessageContentPayload} from "~/shared/messaging/message_schema.js";
import {MessagingRealtimeBroadcastNewMessageRequestSchema} from "~/shared/messaging/messaging_realtime_protocol.js";
import {
    TaskQueryCollectionsNormalizedFilter,
    TaskQueryDisplayStatusNormalizedFilter,
    assertNonEmptyReadonlyMap,
} from "~/shared/tasks/task_query_normalized_filters.js";
import {TaskQueryNormalizedSort} from "~/shared/tasks/task_query_normalized_sort.js";

export const apiTasksPaths: Pick<
    ApiPaths,
    keyof ApiPaths & (`/task-collections/${string}` | `/tasks/${string}`)
> = {
    "/tasks/{id}": {
        get: async (context, {pathParameters}) => {
            const [
                task,
                {
                    spaceId,
                    content: {assignee, content},
                },
            ] = await runAllPromises([
                // TODO(calebmer): An optimization that would be pretty nice here is if we move
                // notes loading into `TaskRealtimeService`. Currently we have to load the data
                // for bot authorization twice. Once here in `ApiService` and again in
                // `TaskRealtimeService`. If we pushed task notes loading into
                // `TaskRealtimeService` then we could leverage `ContextCache` to only load the
                // bot authorization data once.
                context.tasks.getTaskWithoutDependencies(
                    context.actor.getSpaceId(),
                    pathParameters.id,
                    {consistency: "StrongWithinCache"},
                ),
                getTaskNotesContentWithCustomReferences(
                    context,
                    pathParameters.id,
                    async (context, spaceId, task) => {
                        const [assignee, content] = await runAllPromises([
                            task.assigneeId
                                ? getApiAccount(context, spaceId, task.assigneeId, {
                                      consistency: "StrongWithinCache",
                                  })
                                : null,
                            intoApiContentWithReferences(
                                context,
                                spaceId,
                                FileTaskAuthorizer.bind({
                                    type: "TaskNotes",
                                    taskId: pathParameters.id,
                                }),
                                task.content,
                            ),
                        ]);
                        return {assignee, content};
                    },
                    {consistency: "StrongWithinCache"},
                ),
            ]);

            const status = task.getStatus();
            const dueDate = task.getDueDate();

            let actualStatus: ApiTask["status"];
            switch (status.type) {
                case "Closed": {
                    actualStatus = {type: "Closed"};
                    break;
                }
                case "Open": {
                    actualStatus = {
                        type: "Open",
                        isActive: task.getAssigneeStatus().type === "Active",
                    };
                    break;
                }
                default:
                    throw exhaustive(status);
            }

            return {
                content: {
                    spaceId,
                    task: {
                        id: pathParameters.id,
                        status: actualStatus,
                        title: task.getTitle().getText(),
                        assignee: assignee ?? undefined,
                        due: dueDate ? {date: dueDate.toString()} : undefined,
                        priority: task.getPriority() ?? undefined,
                        content,
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
                    message: await intoApiMessage(context, message.spaceId, message),
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
                        comments.map(message => intoApiMessage(context, spaceId, message)),
                    ),
                },
            };
        },
        post: async (context, {pathParameters, requestBody}) => {
            const content = assertMessageContent(
                fromApiContent(MessageContentProsemirrorSchema, requestBody.content),
            );

            const createdTimeZone = requestBody.createdTimeZone ?? defaultTimeZone;

            const {spaceId, index, createdTime} = await createTaskComment(context, {
                taskId: pathParameters.id,
                parent: null,
                content,
                createdTimeZone,
                fileIds: [],
                isStream: requestBody.isStream,
                consistency: "StrongWithinCache",
            });

            const payload: MessageContentPayload = {
                type: "Content",
                parent: null,
                content,
                contentUpdate: null,
                fileIds: [],
                reactionsByPos: emptyMap,
            };

            // If this broadcast fails (or it's never sent, say if the process dies) then
            // users connected to this messaging room won't see this message appear in
            // realtime. The realtime connection will be "stuck". Any future messages will
            // be placed in a queue (since the connection is waiting on a previous message)
            // and will never be flushed to the client.
            //
            // To get out of this state, the user can reload the page. Or navigate to
            // another page then navigate back. We hope this won't be too big of an issue
            // since the user should still receive a realtime inbox update telling them
            // they have a new message.
            //
            // NOTE(calebmer): The best fix for this is probably to send the broadcast
            // event in a DynamoDB Streams listener that reacts to the update. We plan to
            // move `NotificationEvent`, `IndexSearchEntity`, and other processing that
            // needs to reliably run after an updates to DynamoDB Stream.
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
                    message: await intoApiMessage(context, spaceId, {
                        index,
                        version: 0,
                        authorId: context.actor.getBotAccountId(),
                        createdTime,
                        createdTimeZone,
                        payload,
                        stream: requestBody.isStream
                            ? {createdTime, completedTime: null, parts: [], lastPingTime: null}
                            : null,
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

    "/task-collections/{id}": {
        get: async (context, {pathParameters}) => {
            const collection = await context.tasks.getCollection(
                context.actor.getSpaceId(),
                pathParameters.id,
                {consistency: "StrongWithinCache"},
            );

            return {
                content: {
                    spaceId: context.actor.getSpaceId(),
                    taskCollection: {
                        id: collection.id,
                        name: collection.getName(),
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
                    : // NOTE(iftizsimmons, 2025-11-05): We'll only showing open tasks by default since that
                      // is the default behavior in the UI. One day, when users can set default filters for
                      // a task collection, we should use that filter instead.
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
