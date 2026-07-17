import {DocAttrStep} from "prosemirror-transform";
import {
    FileDocumentAuthorizer,
    authorizeDocumentAccess,
    backfillDocumentComments,
    completeDocumentCommentStream,
    createDocument,
    createDocumentComment,
    deleteDocumentComment,
    deleteDocumentCommentReaction,
    getDocument,
    getDocumentComment,
    getDocumentCommentParentContent,
    getDocumentCommentPayload,
    getDocumentCommentPayloadsFromEnd,
    getDocumentCommentPayloadsFromStart,
    getDocumentCommentsFromEnd,
    getDocumentCommentsFromStart,
    getDocumentWithOptionalComments,
    getDocumentsTableForTest,
    pingDocumentCommentStream,
    putDocumentCommentMessageApprovalDecisions,
    putDocumentCommentStreamPart,
    setDocumentCommentReaction,
    updateDocumentCommentContent,
    updateDocumentContent,
} from "~/server/documents/data/documents_actions.js";
import {documentsInjection} from "~/server/documents/data/documents_injection.js";
import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {testMessagingImplementation} from "~/server/messaging/test_helpers/suite/test_messaging_implementation.js";
import {
    AccessPolicy,
    AccessPolicyAccountGrant,
    LocalAccessPolicy,
} from "~/shared/access/access_policy.js";
import {
    assertDocumentContent,
    DocumentContentProsemirrorSchema as schema,
} from "~/shared/documents/document_content_schema.js";
import {
    DocumentCommentRoomKey,
    decodeDocumentCommentRoomKey,
    encodeDocumentCommentRoomKey,
} from "~/shared/documents/document_model.js";
import {NotFoundError} from "~/shared/error/error.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {cast} from "~/shared/helpers/control/cast.js";
import {defaultTimeZone} from "~/shared/helpers/intl/time_zone.js";
import {filterIterable} from "~/shared/helpers/iterable/filter_iterable.js";
import {sumIterable} from "~/shared/helpers/iterable/sum_iterable.js";
import {emptyMap} from "~/shared/helpers/map/empty_map.js";
import {generateId} from "~/shared/id/id.js";
import {AccountId, DocumentCommentThreadId} from "~/shared/id/types/id_types.js";

const context = createTestContext({
    documentsInjection,
    notificationsInjection: {
        archiveDocumentCommentThreadEntryAfterSetDocumentCommentReaction: async () => {},
    },
});

testMessagingImplementation<DocumentCommentRoomKey>(context, {
    async createRoom(context, spaceId) {
        const DocumentsTable = getDocumentsTableForTest();

        const document = await createDocument(context, {
            spaceId,
            content: assertDocumentContent(
                schema.node(
                    "doc",
                    {
                        accessPolicy: cast<AccessPolicy>({
                            type: "Local",
                            accountGrantById: emptyMap,
                            defaultGrant: {level: "Manage", generation: 0},
                            urlGrant: null,
                        }),
                    },
                    [schema.node("title"), schema.node("paragraph")],
                ),
            ),
        });

        const commentThreadId = generateId<DocumentCommentThreadId>();
        const createdTime = new Date(Date.now());

        await DocumentsTable.createItem(context, {
            partitionType: "Document",
            // NOTE(calebmer): Our messaging tests run against an archived comment thread since
            // it's less common than a referenced comment thread.
            sortRangeType: "ArchivedCommentThread",
            documentId: document.id,
            commentThreadId,
            createdTime,
            createdTimeZone: defaultTimeZone,
            fallbackContentSnippet: null,
            commentsSummary: {
                nextCommentIndex: 0,
                commentCountByAuthorId: new Map(),
                mentionCountByAccountId: new Map(),
            },
            resolutionState: {
                type: "Unresolved",
            },
        });

        return {
            key: encodeDocumentCommentRoomKey(document.id, commentThreadId),
            spaceId,
            createdTime,
            messageCount: 0,
            messageNoun: "comment",
        };
    },
    async createPrivateRoom(context, spaceId, {insideSessions, insideViewerSession}) {
        const DocumentsTable = getDocumentsTableForTest();

        let count = 0;

        const document = await createDocument(context, {
            spaceId,
            content: assertDocumentContent(
                schema.node(
                    "doc",
                    {
                        accessPolicy: cast<AccessPolicy>({
                            type: "Local",
                            accountGrantById: new Map<AccountId, AccessPolicyAccountGrant>([
                                ...insideSessions.map(
                                    (insideSession): [AccountId, AccessPolicyAccountGrant] => [
                                        insideSession.accountId,
                                        insideSession.accountId === context.actor.getAccountId()
                                            ? {level: "Manage", generation: 0}
                                            : {
                                                  level: (["Comment", "Edit"] as const)[
                                                      count++ % 2
                                                  ]!,
                                              },
                                    ],
                                ),
                                ...(insideViewerSession
                                    ? [[insideViewerSession.accountId, {level: "View"}] as const]
                                    : []),
                            ]),
                            defaultGrant: null,
                            urlGrant: null,
                        }),
                    },
                    [schema.node("title"), schema.node("paragraph")],
                ),
            ),
        });

        const commentThreadId = generateId<DocumentCommentThreadId>();
        const createdTime = new Date(Date.now());

        await DocumentsTable.createItem(context, {
            partitionType: "Document",
            // NOTE(calebmer): Our messaging tests run against an archived comment thread since
            // it's less common than a referenced comment thread.
            sortRangeType: "ArchivedCommentThread",
            documentId: document.id,
            commentThreadId,
            createdTime,
            createdTimeZone: defaultTimeZone,
            fallbackContentSnippet: null,
            commentsSummary: {
                nextCommentIndex: 0,
                commentCountByAuthorId: new Map(),
                mentionCountByAccountId: new Map(),
            },
            resolutionState: {
                type: "Unresolved",
            },
        });

        return {
            key: encodeDocumentCommentRoomKey(document.id, commentThreadId),
            spaceId,
            createdTime,
            messageCount: 0,
            messageNoun: "comment",
            doesInsideViewerSessionHaveRoomAccess: false,
            revokeInsideSession: async (context, session) => {
                const currentDocument = await getDocument(context, document.id);
                const accessPolicy: AccessPolicy = currentDocument.content.doc.attrs.accessPolicy;
                assert(accessPolicy.type === "Local", "Expected local access policy");

                const newAccessPolicy: LocalAccessPolicy = {
                    ...accessPolicy,
                    accountGrantById: new Map(
                        filterIterable(
                            accessPolicy.accountGrantById,
                            ([accountId]) => accountId !== session.account.id,
                        ),
                    ),
                };

                await updateDocumentContent(context, {
                    id: document.id,
                    version: currentDocument.version,
                    steps: [new DocAttrStep("accessPolicy", newAccessPolicy)],
                    clientId: generateId(),
                    intentionallyUpdateAccessPolicy: {
                        accessPolicy: newAccessPolicy,
                        notification: null,
                    },
                });
            },
        };
    },
    async getRoom(context, roomKey) {
        const [documentId, commentThreadId] = decodeDocumentCommentRoomKey(roomKey);

        const DocumentsTable = getDocumentsTableForTest();

        const document = await getDocumentWithOptionalComments(context, documentId);

        const commentThreadItem = await DocumentsTable.getItemIfExists(context, {
            partitionType: "Document",
            sortRangeType: "ArchivedCommentThread",
            documentId,
            commentThreadId,
        });
        if (!commentThreadItem) throw new NotFoundError("Document comment thread not found");

        await authorizeDocumentAccess(context, document.id, "Comment");

        return {
            key: roomKey,
            spaceId: document.spaceId,
            createdTime: commentThreadItem.createdTime,
            messageCount: sumIterable(
                commentThreadItem.commentsSummary.commentCountByAuthorId.values(),
            ),
            messageNoun: "comment",
        };
    },
    getMissingRoomKey() {
        return encodeDocumentCommentRoomKey(generateId(), generateId());
    },
    getRoomFileAuthorizer(roomKey) {
        const [documentId] = decodeDocumentCommentRoomKey(roomKey);

        return FileDocumentAuthorizer.bind({type: "DocumentComments", documentId});
    },
    getRoomBotScope(roomKey) {
        const [documentId] = decodeDocumentCommentRoomKey(roomKey);
        return {type: "Document", documentId};
    },
    async createMessage(context, {roomKey, parent, content, fileIds, isStream, createdTimeZone}) {
        const [documentId, commentThreadId] = decodeDocumentCommentRoomKey(roomKey);

        const comment = await createDocumentComment(context, {
            documentId,
            commentThreadId,
            parent,
            content,
            fileIds,
            isStream,
            createdTimeZone: createdTimeZone ?? defaultTimeZone,
        });

        return {
            index: comment.index,
            createdTime: comment.createdTime,
        };
    },
    async pingMessageStream(context, {roomKey, messageIndex}) {
        const [documentId, commentThreadId] = decodeDocumentCommentRoomKey(roomKey);
        return await pingDocumentCommentStream(context, {
            documentId,
            commentThreadId,
            commentIndex: messageIndex,
        });
    },
    async putMessageStreamPart(
        context,
        {roomKey, messageIndex: commentIndex, partIndex, payload, isTimeoutErrorCompletion},
    ) {
        const [documentId, commentThreadId] = decodeDocumentCommentRoomKey(roomKey);

        return await putDocumentCommentStreamPart(context, {
            documentId,
            commentThreadId,
            commentIndex,
            partIndex,
            payload,
            isTimeoutErrorCompletion,
        });
    },
    async putMessageApprovalDecisions(context, {roomKey, messageIndex: commentIndex, payload}) {
        const [documentId, commentThreadId] = decodeDocumentCommentRoomKey(roomKey);
        const {approvals} = await putDocumentCommentMessageApprovalDecisions(context, {
            documentId,
            commentThreadId,
            commentIndex,
            payload,
        });

        return {approvals};
    },
    async completeMessageStream(context, {roomKey, messageIndex: commentIndex}) {
        const [documentId, commentThreadId] = decodeDocumentCommentRoomKey(roomKey);

        return await completeDocumentCommentStream(context, {
            documentId,
            commentThreadId,
            commentIndex,
        });
    },
    async getMessage(context, {roomKey, messageIndex: commentIndex}) {
        const [documentId, commentThreadId] = decodeDocumentCommentRoomKey(roomKey);

        return await getDocumentComment(context, {documentId, commentThreadId, commentIndex});
    },
    async getMessagePayload(context, {roomKey, messageIndex: commentIndex}) {
        const [documentId, commentThreadId] = decodeDocumentCommentRoomKey(roomKey);

        return await getDocumentCommentPayload(context, {
            documentId,
            commentThreadId,
            commentIndex,
        });
    },
    async getMessageParentContent(context, {roomKey, parent}) {
        const [documentId, commentThreadId] = decodeDocumentCommentRoomKey(roomKey);

        return await getDocumentCommentParentContent(context, documentId, commentThreadId, {
            parent,
        });
    },
    async updateMessageContent(
        context,
        {roomKey, messageIndex: commentIndex, contentVersion, steps},
    ) {
        const [documentId, commentThreadId] = decodeDocumentCommentRoomKey(roomKey);

        return await updateDocumentCommentContent(context, {
            documentId,
            commentThreadId,
            commentIndex,
            contentVersion,
            steps,
        });
    },
    async deleteMessage(context, {roomKey, messageIndex: commentIndex}) {
        const [documentId, commentThreadId] = decodeDocumentCommentRoomKey(roomKey);

        return await deleteDocumentComment(context, {documentId, commentThreadId, commentIndex});
    },
    async setMessageReaction(
        context,
        {roomKey, messageIndex: commentIndex, contentVersion, pos, reaction},
    ) {
        const [documentId, commentThreadId] = decodeDocumentCommentRoomKey(roomKey);

        return await setDocumentCommentReaction(context, {
            documentId,
            commentThreadId,
            commentIndex,
            contentVersion,
            pos,
            reaction,
        });
    },
    async deleteMessageReaction(
        context,
        {roomKey, messageIndex: commentIndex, contentVersion, pos},
    ) {
        const [documentId, commentThreadId] = decodeDocumentCommentRoomKey(roomKey);

        return await deleteDocumentCommentReaction(context, {
            documentId,
            commentThreadId,
            commentIndex,
            contentVersion,
            pos,
        });
    },
    async getMessagesFromStart(
        context,
        {
            roomKey,
            limit,
            afterMessageIndex: afterCommentIndex,
            beforeMessageIndex: beforeCommentIndex,
        },
    ) {
        const [documentId, commentThreadId] = decodeDocumentCommentRoomKey(roomKey);

        const {commentCount, comments, otherReferencedComments} =
            await getDocumentCommentsFromStart(context, {
                documentId,
                commentThreadId,
                limit,
                afterCommentIndex,
                beforeCommentIndex,
            });

        return {
            messageCount: commentCount,
            messages: comments,
            otherReferencedMessages: otherReferencedComments,
        };
    },
    async getMessagesFromEnd(
        context,
        {
            roomKey,
            limit,
            afterMessageIndex: afterCommentIndex,
            beforeMessageIndex: beforeCommentIndex,
        },
    ) {
        const [documentId, commentThreadId] = decodeDocumentCommentRoomKey(roomKey);

        const {commentCount, comments, otherReferencedComments} = await getDocumentCommentsFromEnd(
            context,
            {
                documentId,
                commentThreadId,
                limit,
                afterCommentIndex,
                beforeCommentIndex,
            },
        );

        return {
            messageCount: commentCount,
            messages: comments,
            otherReferencedMessages: otherReferencedComments,
        };
    },
    async getMessagePayloadsFromStart(
        context,
        {roomKey, limit, afterMessageIndex, beforeMessageIndex},
    ) {
        const [documentId, commentThreadId] = decodeDocumentCommentRoomKey(roomKey);

        const {commentCount, comments} = await getDocumentCommentPayloadsFromStart(context, {
            documentId,
            commentThreadId,
            limit,
            afterCommentIndex: afterMessageIndex,
            beforeCommentIndex: beforeMessageIndex,
        });

        return {messageCount: commentCount, messages: comments};
    },
    async getMessagePayloadsFromEnd(
        context,
        {roomKey, limit, afterMessageIndex, beforeMessageIndex},
    ) {
        const [documentId, commentThreadId] = decodeDocumentCommentRoomKey(roomKey);

        const {commentCount, comments} = await getDocumentCommentPayloadsFromEnd(context, {
            documentId,
            commentThreadId,
            limit,
            afterCommentIndex: afterMessageIndex,
            beforeCommentIndex: beforeMessageIndex,
        });

        return {messageCount: commentCount, messages: comments};
    },
    async backfillMessages(
        context,
        {
            roomKey,
            checkpoint,
            clientMessageCount: clientCommentCount,
            newMessageLimit: newCommentLimit,
        },
    ) {
        const [documentId, commentThreadId] = decodeDocumentCommentRoomKey(roomKey);

        const {commentCount, newComments, newOtherReferencedComments, commentUpdatesResult} =
            await backfillDocumentComments(context, {
                documentId,
                commentThreadId,
                checkpoint,
                clientCommentCount,
                newCommentLimit,
            });

        return {
            messageCount: commentCount,
            newMessages: newComments,
            newOtherReferencedMessages: newOtherReferencedComments,
            messageUpdatesResult: commentUpdatesResult,
        };
    },
    spacePermissionDeniedErrorMessage: "Account doesn\u2019t have access to space",
});
