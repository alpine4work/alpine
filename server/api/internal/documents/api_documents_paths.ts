import {Node} from "prosemirror-model";
import {createAccessPolicyForContentCreatedByBot} from "~/server/access/create_access_policy_for_content_created_by_bot.js";
import {createIntoApiDocumentCommentContentPayloadParent} from "~/server/api/internal/documents/internal/create_into_api_document_comment_content_payload_parent.js";
import {intoApiDocumentCommentThreadResponse} from "~/server/api/internal/documents/internal/into_api_document_comment_thread_response.js";
import {ApiPaths} from "~/server/api/internal/shared/api_paths_type.js";
import {fromApiMessageContentPayloadParent} from "~/server/api/internal/shared/from_api_message_content_payload_parent.js";
import {fromApiMessageStreamPartPayload} from "~/server/api/internal/shared/from_api_message_stream_part_payload.js";
import {
    getApiMentionTitleWithStrongConsistency,
    intoApiContentWithReferences,
} from "~/server/api/internal/shared/into_api_content_with_references.js";
import {intoApiMessage} from "~/server/api/internal/shared/into_api_message.js";
import {intoApiMessageExperimentalApproval} from "~/server/api/internal/shared/into_api_message_stream_part_payload.js";
import {parseFileIdFromApiFileElement} from "~/server/api/internal/shared/parse_file_id_or_file_entity_id.js";
import {
    FileDocumentAuthorizer,
    broadcastPutDocumentCommentStreamPart,
    completeDocumentCommentStream,
    createDocument,
    createDocumentComment,
    getDocumentCommentMessageApprovals,
    getDocumentCommentPayload,
    getDocumentCommentPayloadsFromEnd,
    getDocumentCommentPayloadsFromStart,
    getDocumentCommentThreadContent,
    getDocumentContent,
    pingDocumentCommentStream,
    putDocumentCommentMessageApprovalDecisions,
    putDocumentCommentStreamPartAndBroadcastEvent,
} from "~/server/documents/data/documents_actions.js";
import {attachFileToTargetAsBot} from "~/server/files/data/attach_file_to_target_as_bot.js";
import {LocalAccessPolicy} from "~/shared/access/access_policy.js";
import {ApiContentKeyEncoder} from "~/shared/api/content/api_content_key.js";
import {extractFileIdsFromApiContent} from "~/shared/api/content/extract_file_ids_from_api_content.js";
import {
    fromApiContent,
    fromApiContentToDocumentChildNodes,
} from "~/shared/api/content/from_api_content.js";
import {unknownFileId} from "~/shared/api/content/unknown_file_id.js";
import {ApiContent} from "~/shared/api/specification/types/api_specification_convenience_types.js";
import {
    MessageContentProsemirrorSchema,
    assertMessageContent,
} from "~/shared/content/message_content_schema.js";
import {
    DocumentCollaborationCreateCommentThreadForApiRequestBodySchema,
    DocumentCollaborationCreateCommentThreadForApiResponseBodySchema,
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
import {assert} from "~/shared/helpers/control/assert.js";
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
                intoApiContentWithReferences(
                    context.dynamo.unexpectStrongReadConsistency(),
                    spaceId,
                    FileDocumentAuthorizer.bind({
                        type: "Document",
                        documentId,
                    }),
                    documentContent,
                    {
                        encoder: new ApiContentKeyEncoder({
                            entityId: `Document:${documentId}`,
                            // All documents are created with version 0
                            version: 0,
                        }),
                    },
                ),
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
                        content: await intoApiContentWithReferences(
                            context,
                            document.spaceId,
                            FileDocumentAuthorizer.bind({
                                type: "Document",
                                documentId: pathParameters.id,
                            }),
                            document.content,
                            {
                                encoder: new ApiContentKeyEncoder({
                                    entityId: `Document:${pathParameters.id}`,
                                    version: document.version,
                                }),
                            },
                        ),
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
                        content: await intoApiContentWithReferences(
                            context,
                            responseBody.spaceId,
                            FileDocumentAuthorizer.bind({
                                type: "Document",
                                documentId: pathParameters.id,
                            }),
                            responseBody.newContent,
                            {
                                encoder: new ApiContentKeyEncoder({
                                    entityId: `Document:${pathParameters.id}`,
                                    version: responseBody.newVersion,
                                }),
                            },
                        ),
                    },
                },
            };
        },
    },

    "/documents/{id}/threads": {
        post: async (context, {pathParameters, requestBody}) => {
            const {firstMessage, range} = requestBody.thread;
            const content = assertMessageContent(
                fromApiContent(MessageContentProsemirrorSchema, firstMessage.content),
            );

            const createdTimeZone = firstMessage.createdTimeZone ?? defaultTimeZone;
            const fileIds = (firstMessage.files ?? []).map(parseFileIdFromApiFileElement);

            const responseBody =
                DocumentCollaborationCreateCommentThreadForApiResponseBodySchema.deserialize(
                    await context.edge.sendRequestToDurableObject(
                        `/api/durable-objects/documents/${pathParameters.id}/create-comment-thread-for-api`,
                        {
                            serviceName: "DocumentCollaborationService",
                            route: "/api/durable-objects/documents/:documentId/create-comment-thread-for-api",
                            body: DocumentCollaborationCreateCommentThreadForApiRequestBodySchema.serialize(
                                {range, content, fileIds, createdTimeZone},
                            ),
                        },
                    ),
                );

            if (!responseBody.ok) throw responseBody.error;

            const {newVersion, commentThread, documentContentSnippet, files, message} =
                responseBody;

            const spaceId = commentThread.spaceId;
            const {thread, message: apiMessage} = await intoApiDocumentCommentThreadResponse(
                context,
                {
                    documentId: pathParameters.id,
                    commentThread,
                    documentContent: {type: "Snippet", snippet: documentContentSnippet},
                    documentVersion: newVersion,
                    message,
                    fileById: new Map(files.map(file => [file.id, file])),
                },
            );
            assert(apiMessage !== undefined);

            return {
                content: {
                    spaceId,
                    document: {
                        id: pathParameters.id,
                        version: newVersion,
                    },
                    thread,
                    message: apiMessage,
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

            const {thread} = await intoApiDocumentCommentThreadResponse(context, {
                documentId: pathParameters.id,
                commentThread,
                documentContent: {type: "Document", content: documentContent.content},
                documentVersion: documentContent.version,
            });

            return {
                content: {
                    spaceId: commentThread.spaceId,
                    commentThread: thread,
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
                        message,
                        intoContentPayloadParent: createIntoApiDocumentCommentContentPayloadParent(
                            context,
                            message.spaceId,
                            pathParameters.id,
                            pathParameters.threadId,
                        ),
                        entityId: `DocumentComment:${pathParameters.id}-${pathParameters.threadId}-${pathParameters.index}`,
                    }),
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
                            intoApiMessage(context, {
                                spaceId,
                                message,
                                intoContentPayloadParent:
                                    createIntoApiDocumentCommentContentPayloadParent(
                                        context,
                                        spaceId,
                                        pathParameters.id,
                                        pathParameters.threadId,
                                    ),
                                entityId: `DocumentComment:${pathParameters.id}-${pathParameters.threadId}-${message.index}`,
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

            const fileIds = (requestBody.files ?? []).map(parseFileIdFromApiFileElement);
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
                        entityId: `DocumentComment:${pathParameters.id}-${pathParameters.threadId}-${index}`,
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

            const {spaceId} = await putDocumentCommentStreamPartAndBroadcastEvent(context, {
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

            const {spaceId} = await putDocumentCommentStreamPartAndBroadcastEvent(context, {
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

    "/documents/{id}/threads/{threadId}/messages/{index}/experimental-approvals": {
        get: async (context, {pathParameters}) => {
            const {spaceId, approvals} = await getDocumentCommentMessageApprovals(context, {
                documentId: pathParameters.id,
                commentThreadId: pathParameters.threadId,
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
                await putDocumentCommentMessageApprovalDecisions(context, {
                    documentId: pathParameters.id,
                    commentThreadId: pathParameters.threadId,
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

            broadcastPutDocumentCommentStreamPart(context, {
                documentId: pathParameters.id,
                commentThreadId: pathParameters.threadId,
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
