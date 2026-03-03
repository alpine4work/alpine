import {createAccessPolicyForContentCreatedByBot} from "~/server/access/create_access_policy_for_content_created_by_bot.js";
import {fromApiContent} from "~/server/api/content/from_api_content.js";
import {createIntoApiDocumentCommentContentPayloadParent} from "~/server/api/internal/documents/internal/create_into_api_document_comment_content_payload_parent.js";
import {ApiPaths} from "~/server/api/internal/shared/api_paths_type.js";
import {fromApiMessageContentPayloadParent} from "~/server/api/internal/shared/from_api_message_content_payload_parent.js";
import {fromApiMessageStreamPartPayload} from "~/server/api/internal/shared/from_api_message_stream_part_payload.js";
import {getApiAccount} from "~/server/api/internal/shared/get_api_account.js";
import {
    getApiMentionTitleWithStrongConsistency,
    intoApiContentWithReferences,
} from "~/server/api/internal/shared/into_api_content_with_references.js";
import {intoApiMessage} from "~/server/api/internal/shared/into_api_message.js";
import {
    FileDocumentAuthorizer,
    completeDocumentCommentStream,
    createDocument,
    createDocumentComment,
    getDocumentCommentPayload,
    getDocumentCommentPayloadsFromEnd,
    getDocumentCommentPayloadsFromStart,
    getDocumentCommentThreadContent,
    getDocumentContent,
    pingDocumentCommentStream,
    putDocumentCommentStreamPart,
} from "~/server/documents/data/documents_actions.js";
import {
    MessageContentProsemirrorSchema,
    assertMessageContent,
} from "~/shared/content/message_content_schema.js";
import {createDocumentCommentThreadSnippetCollector} from "~/shared/documents/create_document_comment_thread_snippet_collector.js";
import {
    DocumentContentProsemirrorSchema,
    assertDocumentContent,
} from "~/shared/documents/document_content_schema.js";
import {getDocumentContentTitleWithoutFallback} from "~/shared/documents/document_model.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {serializeDateString} from "~/shared/helpers/date/date_string.js";
import {defaultTimeZone} from "~/shared/helpers/intl/time_zone.js";
import {emptyMap} from "~/shared/helpers/map/empty_map.js";
import {generateId} from "~/shared/id/id.js";
import {DocumentId} from "~/shared/id/types/id_types.js";
import {MessageContentPayload} from "~/shared/messaging/message_schema.js";
import {MessagingRealtimeBroadcastNewMessageRequestSchema} from "~/shared/messaging/messaging_realtime_protocol.js";
import {emptyReactionSet} from "~/shared/reactions/reaction_set.js";

export const apiDocumentsPaths: Pick<
    ApiPaths,
    (keyof ApiPaths & `/documents/${string}`) | "/documents"
> = {
    "/documents": {
        post: async (context, {requestBody}) => {
            const {
                spaceId,
                document: {creator, title, content: apiContent},
            } = requestBody;

            const documentId = generateId<DocumentId>();
            const consistency = "StrongWithinCache" as const;

            const accessPolicy = await createAccessPolicyForContentCreatedByBot(context, spaceId, {
                consistency,
            });

            const content = apiContent
                ? fromApiContent(DocumentContentProsemirrorSchema, apiContent)
                : undefined;

            const documentContent = assertDocumentContent(
                DocumentContentProsemirrorSchema.node("doc", {accessPolicy}, [
                    DocumentContentProsemirrorSchema.node("title", {}, [
                        DocumentContentProsemirrorSchema.text(title),
                    ]),
                    ...(content
                        ? [...content.children]
                        : [DocumentContentProsemirrorSchema.node("paragraph")]),
                ]),
            );

            const [document, apiContentResponse] = await runAllPromises([
                createDocument(context, {
                    spaceId,
                    id: documentId,
                    content: documentContent,
                    creatorId: creator?.id,
                    consistency,
                }),
                intoApiContentWithReferences(
                    context.dynamo.unexpectStrongReadConsistency(),
                    spaceId,
                    FileDocumentAuthorizer.bind({
                        type: "Document",
                        documentId,
                    }),
                    documentContent,
                ),
            ]);

            return {
                content: {
                    spaceId,
                    document: {
                        id: documentId,
                        creator: {id: document.creator.id},
                        title,
                        content: apiContentResponse,
                    },
                },
            };
        },
    },

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
                        creator: document.creator.id ? {id: document.creator.id} : undefined,
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

    "/documents/{id}/mention": {
        get: async (context, {pathParameters}) => {
            const spaceId = context.actor.getSpaceId();

            const {title} = await getApiMentionTitleWithStrongConsistency(
                context,
                spaceId,
                `Document:${pathParameters.id}`,
            );

            return {
                content: {
                    spaceId,
                    mention: {
                        target: {
                            type: "Document",
                            id: pathParameters.id,
                        },
                        title,
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
                        createIntoApiDocumentCommentContentPayloadParent(
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
                                createIntoApiDocumentCommentContentPayloadParent(
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
            const parent = fromApiMessageContentPayloadParent(requestBody.parent);

            const content = assertMessageContent(
                fromApiContent(MessageContentProsemirrorSchema, requestBody.content),
            );

            const createdTimeZone = requestBody.createdTimeZone ?? defaultTimeZone;

            const {spaceId, index, createdTime} = await createDocumentComment(context, {
                documentId: pathParameters.id,
                commentThreadId: pathParameters.threadId,
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
                            payload,
                            stream: requestBody.isStream
                                ? {createdTime, completedTime: null, parts: [], lastPingTime: null}
                                : null,
                        },
                        createIntoApiDocumentCommentContentPayloadParent(
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

    "/documents/{id}/threads/{threadId}/messages/{index}/stream/parts": {
        post: async (context, {pathParameters, requestBody}) => {
            const payload = fromApiMessageStreamPartPayload(requestBody.payload);

            const {spaceId} = await putDocumentCommentStreamPart(context, {
                documentId: pathParameters.id,
                commentThreadId: pathParameters.threadId,
                commentIndex: pathParameters.index,
                partIndex: "Create",
                payload,
                consistency: "StrongWithinCache",
            });

            return {content: {spaceId}};
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
