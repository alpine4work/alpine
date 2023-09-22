import {getAccountShortNameWithoutFullNameTooltip} from "~/client/accounts/account_short_name.js";
import {useShowToast} from "~/client/design/toast.js";
import {DocumentCommentThreadListView} from "~/client/documents/document_comment_thread_list_view.js";
import {documentCommentThreadCountAgainstLimit} from "~/client/documents/document_shared_styles.js";
import {useDocumentContentEditorWebSocket} from "~/client/documents/use_document_content_editor_web_socket.js";
import {useEvent} from "~/client/helpers/lifecycle/use_event.js";
import {getInitialLoadMessageCount} from "~/client/messaging/messaging_view.js";
import {createMetaFunction} from "~/client/remix/create_meta_function.js";
import {useLoaderDataWithSchema} from "~/client/remix/use_loader_data_with_schema.js";
import {useRootNavigate} from "~/client/remix/use_navigate.js";
import {metaTitlePostfix} from "~/client/remix/use_update_meta_title.js";
import {getDocumentAndCommentThreadsWithInitialComments} from "~/server/documents/data/documents_table.js";
import {jsonWithSchema} from "~/server/remix/json_with_schema.js";
import {LoaderArgs} from "~/server/remix/loader_context.js";
import {
    DocumentCommentModel,
    DocumentCommentThreadModel,
    DocumentModel,
} from "~/shared/documents/document_model.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {DocumentCommentThreadId, DocumentId} from "~/shared/id/types/id_types.js";
import {Schema} from "~/shared/schema/schema.js";

const LoaderSchema = Schema.object({
    document: DocumentModel.schema(),
    commentThread: DocumentCommentThreadModel.schema(),
    initialComments: Schema.array(DocumentCommentModel.schema()),
    initialOtherReferencedComments: Schema.array(DocumentCommentModel.schema()),
});

export async function loader({params, context}: LoaderArgs) {
    const documentId = Schema.id<DocumentId>().deserialize(params.documentId ?? null);
    const commentThreadId = Schema.id<DocumentCommentThreadId>().deserialize(
        params.commentThreadId ?? null,
    );

    const {document, commentThreads, initialCommentsByCommentThreadId} =
        await getDocumentAndCommentThreadsWithInitialComments(await context.actor.authenticate(), {
            documentId,
            commentThreadIds: [commentThreadId],
            commentLimit: getInitialLoadMessageCount(context.loader.getClientInfo()),
            commentThreadCountAgainstLimit: documentCommentThreadCountAgainstLimit,
        });

    const commentThread = assertExists(commentThreads[0]);

    const {comments, otherReferencedComments} = assertExists(
        initialCommentsByCommentThreadId.get(commentThreadId),
    );

    return jsonWithSchema(LoaderSchema, {
        document,
        commentThread,
        initialComments: comments,
        initialOtherReferencedComments: otherReferencedComments,
    });
}

export const meta = createMetaFunction(LoaderSchema, ({data: {commentThread}}) => {
    if (commentThread.commentAuthors.length === 0) {
        return [{title: `Document comment thread${metaTitlePostfix}`}];
    }

    return [
        {
            // Account name in title won't update when account changes without reload
            // because we're using `initialData`.
            title: `Document comment thread by ${getAccountShortNameWithoutFullNameTooltip(
                commentThread.commentAuthors[0]!.initialData,
            )}${metaTitlePostfix}`,
        },
    ];
});

export default function DocumentCommentThreadRoute({
    withMobileLayout,
}: {
    withMobileLayout?: boolean;
}) {
    const rootNavigate = useRootNavigate();
    const showToast = useShowToast();

    const {
        document: initialDocument,
        commentThread,
        initialComments,
        initialOtherReferencedComments,
    } = useLoaderDataWithSchema(LoaderSchema);

    const {isConnected, editorState, procedures, subscribeToCommentThreadEvents} =
        useDocumentContentEditorWebSocket(initialDocument);

    return (
        <DocumentCommentThreadListView
            documentId={initialDocument.id}
            content={editorState.getContent()}
            isConnected={isConnected}
            procedures={procedures}
            subscribeToCommentThreadEvents={subscribeToCommentThreadEvents}
            onCommentThreadSnippetPress={useEvent(commentThreadId => {
                // Navigate the root of our app so we don't:
                //
                // - Open in a peek; OR
                // - Navigate the peek we are rendered in
                //
                // TODO(calebmer, #global-loading-indicator): Some global loading indicator?
                rootNavigate(
                    `/s/${initialDocument.spaceId}/documents/${initialDocument.id}?comments=${commentThreadId}`,
                ).catch(error => {
                    showToast({
                        type: "Error",
                        title: "Can’t open document",
                        error,
                    });
                });
            })}
            initialCommentThreadsResult={[
                {
                    commentThread,
                    comments: initialComments,
                    otherReferencedComments: initialOtherReferencedComments,
                    optimisticComments: [],
                },
            ]}
            withMobileLayout={withMobileLayout}
        />
    );
}
