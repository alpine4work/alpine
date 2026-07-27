import {createIntoApiDocumentCommentContentPayloadParent} from "~/server/api/internal/documents/internal/create_into_api_document_comment_content_payload_parent.js";
import {getApiAccount} from "~/server/api/internal/shared/get_api_account.js";
import {intoApiContentWithReferences} from "~/server/api/internal/shared/into_api_content_with_references.js";
import {intoApiMessage} from "~/server/api/internal/shared/into_api_message.js";
import {ServerBotActionContext} from "~/server/context/server_action_context.js";
import {FileDocumentAuthorizer} from "~/server/documents/data/documents_actions.js";
import {MessageItem} from "~/server/messaging/helpers/process_messages_query.js";
import {ApiContentKeyEncoder} from "~/shared/api/content/api_content_key.js";
import {
    ApiContentResponse,
    ApiDocumentCommentThreadResponse,
    ApiMessageResponse,
} from "~/shared/api/specification/types/api_specification_convenience_types.js";
import {
    DocumentCommentThreadSnippet,
    createDocumentCommentThreadSnippetCollector,
} from "~/shared/documents/create_document_comment_thread_snippet_collector.js";
import {
    DocumentContent,
    DocumentWithOptionalTitleContent,
} from "~/shared/documents/document_content_schema.js";
import {FileModel} from "~/shared/files/file_model.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {serializeDateString} from "~/shared/helpers/date/date_string.js";
import {
    AccountId,
    DocumentCommentThreadId,
    DocumentId,
    FileId,
    SpaceId,
} from "~/shared/id/types/id_types.js";

type ApiDocumentCommentThreadForResponse = {
    readonly spaceId: SpaceId;
    readonly id: DocumentCommentThreadId;
    readonly createdTime: Date;
    readonly isResolved: boolean;
    readonly commentCount: number;
    readonly firstCommentAuthorId: AccountId | null | undefined;
    readonly fallbackContentSnippet: {
        readonly version: number;
        readonly node: DocumentWithOptionalTitleContent;
    } | null;
};

export async function intoApiDocumentCommentThreadResponse(
    context: ServerBotActionContext,
    {
        documentId,
        commentThread,
        documentContent,
        documentVersion,
        message,
        fileById,
    }: {
        documentId: DocumentId;
        commentThread: ApiDocumentCommentThreadForResponse;
        documentContent:
            | {type: "Document"; content: DocumentContent}
            | {type: "Snippet"; snippet: DocumentCommentThreadSnippet | null};
        documentVersion: number;
        message?: MessageItem;
        fileById?: ReadonlyMap<FileId, FileModel>;
    },
): Promise<{
    thread: ApiDocumentCommentThreadResponse;
    message?: ApiMessageResponse;
}> {
    const apiMessagePromise = message
        ? intoApiMessage(context, {
              spaceId: commentThread.spaceId,
              message,
              intoContentPayloadParent: createIntoApiDocumentCommentContentPayloadParent(
                  context,
                  commentThread.spaceId,
                  documentId,
                  commentThread.id,
              ),
              entityId: `DocumentComment:${documentId}-${commentThread.id}-${message.index}`,
              fileById,
          })
        : null;

    const [documentContentSnippet, firstCommentAuthor, apiMessage] = await runAllPromises([
        intoApiDocumentCommentThreadSnippetResponse(context, {
            documentId,
            commentThread,
            documentContent,
            documentVersion,
        }),
        apiMessagePromise
            ? apiMessagePromise.then(convertedMessage => convertedMessage.author)
            : commentThread.firstCommentAuthorId
              ? getApiAccount(
                    context.dynamo.unexpectStrongReadConsistency(),
                    commentThread.spaceId,
                    commentThread.firstCommentAuthorId,
                )
              : null,
        apiMessagePromise,
    ]);

    return {
        thread: {
            id: commentThread.id,
            createdTime: serializeDateString(commentThread.createdTime),
            isResolved: commentThread.isResolved,
            commentCount: commentThread.commentCount,
            firstCommentAuthor,
            documentContentSnippet,
        },
        ...(apiMessage ? {message: apiMessage} : {}),
    };
}

async function intoApiDocumentCommentThreadSnippetResponse(
    context: ServerBotActionContext,
    {
        documentId,
        commentThread,
        documentContent,
        documentVersion,
    }: {
        documentId: DocumentId;
        commentThread: ApiDocumentCommentThreadForResponse;
        documentContent:
            | {type: "Document"; content: DocumentContent}
            | {type: "Snippet"; snippet: DocumentCommentThreadSnippet | null};
        documentVersion: number;
    },
): Promise<ApiContentResponse> {
    let commentThreadSnippet: DocumentCommentThreadSnippet | null;
    switch (documentContent.type) {
        case "Document": {
            const contentSnippetByCommentThreadId = createDocumentCommentThreadSnippetCollector(
                [commentThread.id],
                // Whole text blocks so every block in the snippet gets a content key that matches
                // the key for the same block in the full document content.
                {wholeTextBlocks: true},
            )(documentContent.content);
            commentThreadSnippet = contentSnippetByCommentThreadId.get(commentThread.id) ?? null;
            break;
        }
        case "Snippet":
            commentThreadSnippet = documentContent.snippet;
            break;
        default:
            throw exhaustive(documentContent);
    }

    if (commentThreadSnippet) {
        return await intoApiContentWithReferences(
            context,
            commentThread.spaceId,
            FileDocumentAuthorizer.bind({
                type: "Document",
                documentId,
            }),
            commentThreadSnippet.node,
            {
                encoder: new ApiContentKeyEncoder({
                    entityId: `Document:${documentId}`,
                    version: documentVersion,
                }),
                posOffset: commentThreadSnippet.posOffset,
            },
        );
    }

    if (commentThread.fallbackContentSnippet) {
        return await intoApiContentWithReferences(
            context,
            commentThread.spaceId,
            FileDocumentAuthorizer.bind({
                type: "Document",
                documentId,
            }),
            commentThread.fallbackContentSnippet.node,
            {
                // The fallback snippet was saved from an older version of the document, so encode
                // its keys with that version. The keys identify blocks within the snippet but
                // can't be resolved against the current document content.
                encoder: new ApiContentKeyEncoder({
                    entityId: `Document:${documentId}`,
                    version: commentThread.fallbackContentSnippet.version,
                }),
            },
        );
    }

    return {elements: []};
}
