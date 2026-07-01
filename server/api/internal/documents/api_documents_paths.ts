import {Node} from "prosemirror-model";
import {createAccessPolicyForContentCreatedByBot} from "~/server/access/create_access_policy_for_content_created_by_bot.js";
import {createIntoApiDocumentCommentContentPayloadParent} from "~/server/api/internal/documents/internal/create_into_api_document_comment_content_payload_parent.js";
import {ApiPaths} from "~/server/api/internal/shared/api_paths_type.js";
import {fromApiMessageContentPayloadParent} from "~/server/api/internal/shared/from_api_message_content_payload_parent.js";
import {fromApiMessageStreamPartPayload} from "~/server/api/internal/shared/from_api_message_stream_part_payload.js";
import {getApiAccount} from "~/server/api/internal/shared/get_api_account.js";
import {getFileIdOrFileEntityIdFromApiMessageContentPayloadFile} from "~/server/api/internal/shared/get_file_id_or_file_entity_id_from_api_message_content_payload_file.js";
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
import {attachFileToTargetAsBot} from "~/server/files/data/attach_file_to_target_as_bot.js";
import {LocalAccessPolicy} from "~/shared/access/access_policy.js";
import {ApiContentKeyEncoder} from "~/shared/api/content/closed_source/api_content_key_encoder.js";
import {extractFileIdsFromApiContent} from "~/shared/api/content/closed_source/extract_file_ids_from_api_content.js";
import {
    fromApiContent,
    fromApiContentToDocumentChildNodes,
} from "~/shared/api/content/closed_source/from_api_content.js";
import {unknownFileId} from "~/shared/api/content/closed_source/unknown_file_id.js";
import {ApiContentResponseWithoutKeys} from "~/shared/api/specification/types/api_content_response_without_keys.js";
import {ApiContent} from "~/shared/api/specification/types/api_specification_convenience_types.js";
import {
    MessageContentProsemirrorSchema,
    assertMessageContent,
} from "~/shared/content/message_content_schema.js";
import {createDocumentCommentThreadSnippetCollector} from "~/shared/documents/create_document_comment_thread_snippet_collector.js";
import {
    DocumentCollaborationUpdateContentWithDiffRequestBodySchema,
    DocumentCollaborationUpdateContentWithDiffResponseBodySchema,
} from "~/shared/documents/document_collaboration_protocol.js";
import {
    DocumentContent,
    DocumentContentProsemirrorSchema,
    assertDocumentContent,
} from "~/shared/documents/document_content_schema.js";
import {getDocumentContentTitleWithoutFallback} from "~/shared/documents/document_model.js";
import {InvalidArgumentError} from "~/shared/error/error.js";
import {errorDisplayMessage} from "~/shared/error/error_display_message.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {serializeDateString} from "~/shared/helpers/date/date_string.js";
import {defaultTimeZone} from "~/shared/helpers/intl/time_zone.js";
import {emptyMap} from "~/shared/helpers/map/empty_map.js";
import {generateId, isId} from "~/shared/id/id.js";
import {DocumentId, FileId} from "~/shared/id/types/id_types.js";
import {MessageContentPayload} from "~/shared/messaging/message_schema.js";
import {MessagingRealtimeBroadcastNewMessageRequestSchema} from "~/shared/messaging/messaging_realtime_protocol.js";
import {emptyReactionSet} from "~/shared/reactions/reaction_set.js";

export const apiDocumentsPaths: Pick<
    ApiPaths,
    (keyof ApiPaths & `/documents/${string}`) | "/documents"
> = {
    "/documents": {
        post: async (context, {requestBody}) => {
            const consistency = "StrongWithinCache" as const;
            const {
                spaceId,
                document: {creator, title, content: apiContent},
            } = requestBody;

            const documentId = generateId<DocumentId>();

            const accessPolicy = await createAccessPolicyForContentCreatedByBot(context, spaceId, {
                consistency,
            });

            const documentContent = validateApiDocumentContentForCreate({
                title,
                accessPolicy,
                content: apiContent,
            });

            // Attach files referenced in the content to the document before creating the
            // document so there's no race where a reader sees the document before its files
            // are attached.
            if (apiContent) {
                const fileIds = extractFileIdsFromApiContent(apiContent);
                fileIds.delete(unknownFileId);
                await runAllPromises(
                    [...fileIds].map(fileId =>
                        attachFileToTargetAsBot(
                            context,
                            fileId,
                            FileDocumentAuthorizer.bind({
                                type: "Document",
                                documentId,
                            }),
                        ),
                    ),
                );
            }

            const [document, apiContentResponse] = await runAllPromises([
                createDocument(context, {
                    spaceId,
                    id: documentId,
                    content: documentContent,
                    creatorId: creator?.id,
                    consistency,
                }),
                intoApiContentWithReferences(context, {
                    spaceId,
                    fileAuthorizer: FileDocumentAuthorizer.bind({
                        type: "Document",
                        documentId,
                    }),
                    content: documentContent,
                    contentKeyEncoder: new ApiContentKeyEncoder({
                        entityId: `Document:${documentId}`,
                        // All documents are created with version 0
                        version: 0,
                    }),
                }),
            ]);

            return {
                content: {
                    spaceId,
                    document: {
                        id: documentId,
                        creator: {id: document.creator.id},
                        version: document.version,
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
                        creator: document.creator.id ? {id: document.creator.id} : undefined,
                        version: document.version,
                        title: getDocumentContentTitleWithoutFallback(document.content),
                        content: await intoApiContentWithReferences(context, {
                            spaceId: document.spaceId,
                            fileAuthorizer: FileDocumentAuthorizer.bind({
                                type: "Document",
                                documentId: pathParameters.id,
                            }),
                            content: document.content,
                            contentKeyEncoder: new ApiContentKeyEncoder({
                                entityId: `Document:${pathParameters.id}`,
                                version: document.version,
                            }),
                        }),
                    },
                },
            };
        },

        patch: async (context, {pathParameters, requestBody}) => {
            const requestContent = validateApiDocumentContentForUpdate({
                title: requestBody.document.title,
                content: requestBody.document.content,
            });

            // Attach any new files referenced in the updated content before applying the
            // update so there's no race where a reader sees the updated content before its
            // files are attached.
            if (requestBody.document.content) {
                const fileIds = extractFileIdsFromApiContent(requestBody.document.content);
                fileIds.delete(unknownFileId);
                await runAllPromises(
                    [...fileIds].map(fileId =>
                        attachFileToTargetAsBot(
                            context,
                            fileId,
                            FileDocumentAuthorizer.bind({
                                type: "Document",
                                documentId: pathParameters.id,
                            }),
                        ),
                    ),
                );
            }

            const responseBody =
                DocumentCollaborationUpdateContentWithDiffResponseBodySchema.deserialize(
                    await context.edge.sendRequestToDurableObject(
                        `/api/durable-objects/documents/${pathParameters.id}/update-content-with-diff`,
                        {
                            serviceName: "DocumentCollaborationService",
                            route: "/api/durable-objects/documents/:documentId/update-content-with-diff",
                            body: DocumentCollaborationUpdateContentWithDiffRequestBodySchema.serialize(
                                {
                                    version: requestBody.document.version,
                                    content: requestContent,
                                },
                            ),
                        },
                    ),
                );

            if (!responseBody.ok) throw responseBody.error;

            return {
                content: {
                    spaceId: responseBody.spaceId,
                    document: {
                        id: pathParameters.id,
                        creator: responseBody.creatorId ? {id: responseBody.creatorId} : undefined,
                        version: responseBody.newVersion,
                        title: getDocumentContentTitleWithoutFallback(responseBody.newContent),
                        content: await intoApiContentWithReferences(context, {
                            spaceId: responseBody.spaceId,
                            fileAuthorizer: FileDocumentAuthorizer.bind({
                                type: "Document",
                                documentId: pathParameters.id,
                            }),
                            content: responseBody.newContent,
                            contentKeyEncoder: new ApiContentKeyEncoder({
                                entityId: `Document:${pathParameters.id}`,
                                version: responseBody.newVersion,
                            }),
                        }),
                    },
                },
            };
        },
    },

    "/documents/{id}/reference": {
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
                    reference: {
                        type: "Document",
                        id: pathParameters.id,
                        title,
                    },
                },
            };
        },
    },

    "/documents/{id}/threads/{threadId}": {
        get: async (context, {pathParameters}) => {
            const [commentThread, document] = await runAllPromises([
                getDocumentCommentThreadContent(
                    context,
                    {documentId: pathParameters.id, commentThreadId: pathParameters.threadId},
                    {consistency: "StrongWithinCache"},
                ),
                getDocumentContent(context, pathParameters.id, {consistency: "StrongWithinCache"}),
            ]);

            const [firstCommentAuthor, markedPreview, documentContent] = await runAllPromises([
                getApiAccount(
                    context.dynamo.unexpectStrongReadConsistency(),
                    commentThread.spaceId,
                    commentThread.firstCommentAuthorId,
                ),
                (async () => {
                    const contentSnippetByCommentThreadId =
                        createDocumentCommentThreadSnippetCollector([pathParameters.threadId])(
                            document.content,
                        );

                    const commentThreadSnippet = contentSnippetByCommentThreadId.get(
                        pathParameters.threadId,
                    );

                    let markedPreview: {
                        version: number;
                        contentSnippet: ApiContentResponseWithoutKeys;
                    } | null = null;

                    if (commentThreadSnippet) {
                        const contentSnippet = await intoApiContentWithReferences(context, {
                            spaceId: commentThread.spaceId,
                            fileAuthorizer: FileDocumentAuthorizer.bind({
                                type: "Document",
                                documentId: pathParameters.id,
                            }),
                            // NOCOMMIT: Test that we see other comment marks in the content in this case.
                            content: commentThreadSnippet,
                            // Because this is a content snippet, we won't be able to encode keys that match
                            // the source content. So don't include any keys in the content type.
                            contentKeyEncoder: null,
                        });

                        markedPreview = {
                            version: document.version,
                            contentSnippet,
                        };
                    } else if (commentThread.fallbackContentSnippet) {
                        const contentSnippet = await intoApiContentWithReferences(context, {
                            spaceId: commentThread.spaceId,
                            fileAuthorizer: FileDocumentAuthorizer.bind({
                                type: "Document",
                                documentId: pathParameters.id,
                            }),
                            // NOCOMMIT: Test that we see other comment marks in the content in this case.
                            content: commentThread.fallbackContentSnippet.node,
                            // Because this is a content snippet, we won't be able to encode keys that match
                            // the source content. So don't include any keys in the content type.
                            contentKeyEncoder: null,
                        });

                        markedPreview = {
                            version: commentThread.fallbackContentSnippet.version,
                            contentSnippet,
                        };
                    }

                    return markedPreview;
                })(),
                intoApiContentWithReferences(context, {
                    spaceId: document.spaceId,
                    fileAuthorizer: FileDocumentAuthorizer.bind({
                        type: "Document",
                        documentId: pathParameters.id,
                    }),
                    content: document.content,
                    contentKeyEncoder: new ApiContentKeyEncoder({
                        entityId: `Document:${pathParameters.id}`,
                        version: document.version,
                    }),
                }),
            ]);

            return {
                content: {
                    spaceId: commentThread.spaceId,
                    thread: {
                        id: pathParameters.threadId,
                        isResolved: commentThread.isResolved,
                        totalMessageCount: commentThread.commentCount,
                        firstMessage: {
                            author: firstCommentAuthor,
                            createdTime: serializeDateString(commentThread.createdTime),
                            createdTimeZone: commentThread.createdTimeZone,
                        },
                        marked: {
                            preview: markedPreview ?? {version: 0, contentSnippet: {elements: []}},
                        },
                    },
                    document: {
                        id: pathParameters.id,
                        creator: document.creator.id ? {id: document.creator.id} : undefined,
                        version: document.version,
                        title: getDocumentContentTitleWithoutFallback(document.content),
                        content: documentContent,
                    },
                },
            };
        },
    },

    // NOCOMMIT: Tests for this endpoint
    "/documents/{id}/threads/{threadId}/preview": {
        get: async (context, {pathParameters}) => {
            const commentThread = await getDocumentCommentThreadContent(
                context,
                {documentId: pathParameters.id, commentThreadId: pathParameters.threadId},
                {consistency: "StrongWithinCache"},
            );

            const firstCommentAuthor = await getApiAccount(
                context.dynamo.unexpectStrongReadConsistency(),
                commentThread.spaceId,
                commentThread.firstCommentAuthorId,
            );

            return {
                content: {
                    spaceId: commentThread.spaceId,
                    thread: {
                        id: pathParameters.threadId,
                        isResolved: commentThread.isResolved,
                        totalMessageCount: commentThread.commentCount,
                        firstMessage: {
                            author: firstCommentAuthor,
                            createdTime: serializeDateString(commentThread.createdTime),
                            createdTimeZone: commentThread.createdTimeZone,
                        },
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
                    message: await intoApiMessage(context, {
                        spaceId: message.spaceId,
                        entityId: `DocumentComment:${pathParameters.id}-${pathParameters.threadId}-${pathParameters.index}`,
                        fileAuthorizer: FileDocumentAuthorizer.bind({
                            type: "DocumentComments",
                            documentId: pathParameters.id,
                        }),
                        message,
                        intoContentPayloadParent: createIntoApiDocumentCommentContentPayloadParent(
                            context,
                            message.spaceId,
                            pathParameters.id,
                            pathParameters.threadId,
                        ),
                    }),
                },
            };
        },
    },

    "/documents/{id}/threads/{threadId}/messages": {
        get: async (context, {pathParameters, queryParameters}) => {
            const {spaceId, commentCount, comments} =
                queryParameters.from === "End"
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
                                entityId: `DocumentComment:${pathParameters.id}-${pathParameters.threadId}-${message.index}`,
                                fileAuthorizer: FileDocumentAuthorizer.bind({
                                    type: "DocumentComments",
                                    documentId: pathParameters.id,
                                }),
                                message,
                                intoContentPayloadParent:
                                    createIntoApiDocumentCommentContentPayloadParent(
                                        context,
                                        spaceId,
                                        pathParameters.id,
                                        pathParameters.threadId,
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

            // Attach files before creating the message, matching the app client flow. The
            // service function validates attachments exist.
            await runAllPromises(
                attachmentFileIds.map(fileId =>
                    attachFileToTargetAsBot(
                        context,
                        fileId,
                        FileDocumentAuthorizer.bind({
                            type: "DocumentComments",
                            documentId: pathParameters.id,
                        }),
                    ),
                ),
            );

            const {spaceId, index, createdTime} = await createDocumentComment(context, {
                documentId: pathParameters.id,
                commentThreadId: pathParameters.threadId,
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
                    message: await intoApiMessage(context, {
                        spaceId,
                        entityId: `DocumentComment:${pathParameters.id}-${pathParameters.threadId}-${index}`,
                        fileAuthorizer: FileDocumentAuthorizer.bind({
                            type: "DocumentComments",
                            documentId: pathParameters.id,
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
                        intoContentPayloadParent: createIntoApiDocumentCommentContentPayloadParent(
                            context,
                            spaceId,
                            pathParameters.id,
                            pathParameters.threadId,
                        ),
                    }),
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

// Wraps `fromApiContentToDocumentChildNodes()` and the document node assembly in a
// try/catch block to translate any Prosemirror schema validation errors into an
// `InvalidArgumentError` instead of an `InternalError`. This could happen if a
// user submits structurally valid content that contains content types that aren't
// supported by the document content schema.
function validateApiDocumentContentForCreate({
    title,
    accessPolicy,
    content,
}: {
    title: string;
    accessPolicy: LocalAccessPolicy;
    content: ApiContent | undefined;
}): DocumentContent {
    try {
        return assertDocumentContent(
            DocumentContentProsemirrorSchema.node(
                "doc",
                {accessPolicy},
                fromApiContentToDocumentChildNodes(
                    DocumentContentProsemirrorSchema,
                    title,
                    content ?? {elements: []},
                ),
            ),
        );
    } catch (error) {
        // TODO(#public-api): Document the schema rules for document content and add a link
        // to the documentation in this error message.
        throw InvalidArgumentError.from(error, "Received invalid document content", {
            displayMessage: errorDisplayMessage`The document content you provided is invalid.`,
        });
    }
}

// Wraps `fromApiContentToDocumentChildNodes()` in a try/catch block to translate
// any Prosemirror schema validation errors into an `InvalidArgumentError` instead
// of an `InternalError`. This could happen if a user submits structurally valid
// content that contains content types that aren't supported by the document
// content schema.
function validateApiDocumentContentForUpdate({
    title,
    content,
}: {
    title: string;
    content: ApiContent;
}): ReadonlyArray<Node> {
    try {
        return fromApiContentToDocumentChildNodes(DocumentContentProsemirrorSchema, title, content);
    } catch (error) {
        // TODO(#public-api): Document the schema rules for document content and add a link
        // to the documentation in this error message.
        throw InvalidArgumentError.from(error, "Received invalid document content", {
            displayMessage: errorDisplayMessage`The document content you provided is invalid.`,
        });
    }
}
