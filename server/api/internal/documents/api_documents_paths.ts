import {fromApiContent} from "~/server/api/content/from_api_content.js";
import {getApiDocumentCommentParentMessageResponse} from "~/server/api/internal/documents/internal/get_api_document_comment_parent_message_response.js";
import {ApiPaths} from "~/server/api/internal/shared/api_paths_type.js";
import {fromApiMessageStreamPartPayload} from "~/server/api/internal/shared/from_api_message_stream_part_payload.js";
import {getApiAccount} from "~/server/api/internal/shared/get_api_account.js";
import {intoApiContentWithReferences} from "~/server/api/internal/shared/into_api_content_with_references.js";
import {intoApiMessage} from "~/server/api/internal/shared/into_api_message.js";
import {
    FileDocumentAuthorizer,
    completeDocumentCommentStream,
    createDocumentComment,
    getDocumentCommentPayload,
    getDocumentCommentPayloadsFromEnd,
    getDocumentCommentPayloadsFromStart,
    getDocumentCommentThreadContent,
    getDocumentContent,
    pingDocumentCommentStream,
    putDocumentCommentStreamPart,
} from "~/server/documents/data/documents_actions.js";
import {createDocumentCommentThreadSnippetCollector} from "~/shared/documents/create_document_comment_thread_snippet_collector.js";
import {getDocumentContentTitleWithoutFallback} from "~/shared/documents/document_model.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {serializeDateString} from "~/shared/helpers/date/date_string.js";
import {defaultTimeZone} from "~/shared/helpers/intl/time_zone.js";
import {emptyMap} from "~/shared/helpers/map/empty_map.js";
import {
    MessageContentProsemirrorSchema,
    assertMessageContent,
} from "~/shared/messaging/message_content_schema.js";
import {MessageContentPayload} from "~/shared/messaging/message_schema.js";
import {MessagingRealtimeBroadcastNewMessageRequestSchema} from "~/shared/messaging/messaging_realtime_protocol.js";
import {emptyReactionSet} from "~/shared/reactions/reaction_set.js";

export const apiDocumentsPaths: Pick<ApiPaths, keyof ApiPaths & `/documents/${string}`> = {
    "/documents/{id}": {
        get: async (context, {pathParameters}) => {
            const document = await getDocumentContent(context, pathParameters.id, {
                consistency: "StrongWithinCache",
            });

            return {
                content: {
                    spaceId: document.spaceId,
                    document: {
                        id: pathParameters.id,
                        title: getDocumentContentTitleWithoutFallback(document.content),
                        content: await intoApiContentWithReferences(
                            context,
                            document.spaceId,
                            FileDocumentAuthorizer.bind({
                                type: "Document",
                                documentId: pathParameters.id,
                            }),
                            document.content,
                        ),
                    },
                },
            };
        },
    },

    "/documents/{id}/threads/{threadId}": {
        get: async (context, {pathParameters}) => {
            const options = {consistency: "StrongWithinCache"} as const;

            const [commentThread, documentContent] = await runAllPromises([
                getDocumentCommentThreadContent(
                    context,
                    {
                        documentId: pathParameters.id,
                        commentThreadId: pathParameters.threadId,
                    },
                    options,
                ),
                getDocumentContent(context, pathParameters.id, options),
            ]);

            const firstCommentAuthor = commentThread.firstCommentAuthorId
                ? await getApiAccount(
                      context.dynamo.unexpectStrongReadConsistency(),
                      commentThread.spaceId,
                      commentThread.firstCommentAuthorId,
                  )
                : null;

            const contentSnippetByCommentThreadId = createDocumentCommentThreadSnippetCollector([
                pathParameters.threadId,
            ])(documentContent.content);

            const contentSnippetOrFallback =
                contentSnippetByCommentThreadId.get(pathParameters.threadId) ??
                commentThread.fallbackContentSnippet;

            const contentSnippet = contentSnippetOrFallback
                ? await intoApiContentWithReferences(
                      context,
                      commentThread.spaceId,
                      FileDocumentAuthorizer.bind({
                          type: "Document",
                          documentId: pathParameters.id,
                      }),
                      contentSnippetOrFallback,
                  )
                : null;

            return {
                content: {
                    spaceId: commentThread.spaceId,
                    commentThread: {
                        id: commentThread.id,
                        createdTime: serializeDateString(commentThread.createdTime),
                        isResolved: commentThread.isResolved,
                        commentCount: commentThread.commentCount,
                        firstCommentAuthor,
                        documentContentSnippet: contentSnippet ?? {elements: []},
                    },
                },
            };
        },
    },

    "/documents/{id}/threads/{threadId}/messages/{index}": {
        get: async (context, {pathParameters}) => {
            const message = await getDocumentCommentPayload(context, {
                documentId: pathParameters.id,
                commentThreadId: pathParameters.threadId,
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
                        getApiDocumentCommentParentMessageResponse(
                            context,
                            message.spaceId,
                            pathParameters.id,
                            pathParameters.threadId,
                        ),
                    ),
                },
            };
        },
    },

    "/documents/{id}/threads/{threadId}/messages": {
        get: async (context, {pathParameters, queryParameters}) => {
            const {spaceId, commentCount, comments} =
                queryParameters.from === "end"
                    ? await getDocumentCommentPayloadsFromEnd(context, {
                          documentId: pathParameters.id,
                          commentThreadId: pathParameters.threadId,
                          limit: queryParameters.limit ?? 10,
                          afterCommentIndex: null,
                          beforeCommentIndex: queryParameters.cursor ?? null,
                          consistency: "StrongWithinCache",
                      })
                    : await getDocumentCommentPayloadsFromStart(context, {
                          documentId: pathParameters.id,
                          commentThreadId: pathParameters.threadId,
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
                                getApiDocumentCommentParentMessageResponse(
                                    context,
                                    spaceId,
                                    pathParameters.id,
                                    pathParameters.threadId,
                                ),
                            ),
                        ),
                    ),
                },
            };
        },
        post: async (context, {pathParameters, requestBody}) => {
            const content = assertMessageContent(
                fromApiContent(MessageContentProsemirrorSchema, requestBody.content),
            );

            const createdTimeZone = requestBody.createdTimeZone ?? defaultTimeZone;

            const {spaceId, index, createdTime} = await createDocumentComment(context, {
                documentId: pathParameters.id,
                commentThreadId: pathParameters.threadId,
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
                filesReactions: emptyReactionSet,
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
                    `/api/durable-objects/documents/${pathParameters.id}/broadcast-new-message/${pathParameters.threadId}`,
                    {
                        serviceName: "DocumentCollaborationService",
                        route: "/api/durable-objects/documents/:documentId/broadcast-new-message/:commentThreadId",
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
                            payload: payload,
                            stream: requestBody.isStream
                                ? {createdTime, completedTime: null, parts: [], lastPingTime: null}
                                : null,
                        },
                        getApiDocumentCommentParentMessageResponse(
                            context,
                            spaceId,
                            pathParameters.id,
                            pathParameters.threadId,
                        ),
                    ),
                },
            };
        },
    },

    "/documents/{id}/threads/{threadId}/messages/{index}/stream/completion": {
        put: async (context, {pathParameters}) => {
            const {spaceId, completedTime} = await completeDocumentCommentStream(context, {
                documentId: pathParameters.id,
                commentThreadId: pathParameters.threadId,
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

    "/documents/{id}/threads/{threadId}/messages/{index}/stream/ping": {
        put: async (context, {pathParameters}) => {
            const {spaceId, lastPingTime} = await pingDocumentCommentStream(context, {
                documentId: pathParameters.id,
                commentThreadId: pathParameters.threadId,
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

    "/documents/{id}/threads/{threadId}/messages/{index}/stream/parts/{partIndex}": {
        put: async (context, {pathParameters, requestBody}) => {
            const payload = fromApiMessageStreamPartPayload(requestBody.payload);

            const {spaceId} = await putDocumentCommentStreamPart(context, {
                documentId: pathParameters.id,
                commentThreadId: pathParameters.threadId,
                commentIndex: pathParameters.index,
                partIndex: pathParameters.partIndex,
                payload,
                consistency: "StrongWithinCache",
            });

            return {content: {spaceId}};
        },
    },
};
