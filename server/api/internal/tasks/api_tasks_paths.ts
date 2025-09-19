import {ApiPaths} from "~/server/api/internal/shared/api_paths_type.js";
import {fromApiContent} from "~/server/api/internal/shared/from_api_content.js";
import {intoApiMessage} from "~/server/api/internal/shared/into_api_message.js";
import {
    createTaskComment,
    getTaskCommentPayload,
    getTaskCommentPayloadsFromEnd,
    getTaskCommentPayloadsFromStart,
} from "~/server/tasks/data/task_table.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {
    MessageContentProsemirrorSchema,
    assertMessageContent,
} from "~/shared/messaging/message_content_schema.js";
import {MessageContentPayload} from "~/shared/messaging/message_model.js";
import {MessagingRealtimeBroadcastNewMessageRequestSchema} from "~/shared/messaging/messaging_realtime_protocol.js";

export const apiTasksPaths: Pick<ApiPaths, keyof ApiPaths & `/tasks/${string}`> = {
    "/tasks/{id}/messages/{index}": {
        get: async (context, {pathParameters}) => {
            const {spaceId, authorId, createdTime, payload} = await getTaskCommentPayload(context, {
                taskId: pathParameters.id,
                commentIndex: pathParameters.index,
                consistency: "StrongWithinCache",
            });

            return {
                content: {
                    spaceId,
                    message: await intoApiMessage(context, {
                        spaceId,
                        index: pathParameters.index,
                        authorId,
                        createdTime,
                        payload,
                    }),
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
                            intoApiMessage(context, {
                                spaceId,
                                index: message.index,
                                authorId: message.authorId,
                                createdTime: message.createdTime,
                                payload: message.payload,
                            }),
                        ),
                    ),
                },
            };
        },
        post: async (context, {pathParameters, requestBody}) => {
            const content = assertMessageContent(
                fromApiContent(MessageContentProsemirrorSchema, requestBody.content),
            );

            const {spaceId, index, createdTime} = await createTaskComment(context, {
                taskId: pathParameters.id,
                parentCommentIndex: null,
                content,
                fileIds: [],
                consistency: "StrongWithinCache",
            });

            const payload: MessageContentPayload = {
                type: "Content",
                parentMessageIndex: null,
                content,
                contentUpdatedTime: null,
                fileIds: [],
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
                            authorId: context.actor.getBotAccountId(),
                            createdTime,
                            payload,
                        }),
                    },
                ),
            );

            return {
                content: {
                    spaceId,
                    message: await intoApiMessage(context, {
                        spaceId,
                        index,
                        authorId: context.actor.getBotAccountId(),
                        createdTime,
                        payload: payload,
                    }),
                },
            };
        },
    },
};
