import {getAccountShortNameWithoutFullNameTooltip} from "~/client/accounts/account_short_name";
import {useShowToast} from "~/client/design/toast";
import {DocumentCommentThreadListView} from "~/client/documents/document_comment_thread_list_view";
import {useDocumentContentEditorWebSocket} from "~/client/documents/use_document_content_editor_web_socket";
import {useEvent} from "~/client/helpers/lifecycle/use_event";
import {getInitialLoadMessageCount} from "~/client/messaging/messaging_view";
import {createMetaFunction} from "~/client/remix/create_meta_function";
import {useLoaderDataWithSchema} from "~/client/remix/use_loader_data_with_schema";
import {useRootNavigate} from "~/client/remix/use_navigate";
import {metaTitlePostfix} from "~/client/remix/use_update_meta_title";
import {
    getDocument,
    getDocumentCommentThreadAndInitialComments,
} from "~/server/dynamo/documents_table";
import {jsonWithSchema} from "~/server/remix/json_with_schema";
import {LoaderArgs} from "~/server/remix/loader_context";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises";
import {DocumentCommentThreadId, DocumentId} from "~/shared/id/types/id_types";
import {
    DocumentCommentModel,
    DocumentCommentThreadModel,
    DocumentModel,
} from "~/shared/models/document_model";
import {Schema} from "~/shared/schema/schema";

const LoaderSchema = Schema.object({
    document: DocumentModel.schema(),
    commentThread: DocumentCommentThreadModel.schema(),
    initialComments: Schema.array(DocumentCommentModel.schema()),
    initialOtherReferencedComments: Schema.array(DocumentCommentModel.schema()),
});

export async function loader({params, context}: LoaderArgs) {
    const documentId = Schema.id<DocumentId>().deserialize(params.document_id ?? null);
    const commentThreadId = Schema.id<DocumentCommentThreadId>().deserialize(
        params.comment_thread_id ?? null,
    );

    const [document, commentThreadResult] = await runAllPromises([
        getDocument(await context.actor.authenticate(), documentId),
        getDocumentCommentThreadAndInitialComments(await context.actor.authenticate(), {
            documentId,
            commentThreadId,
            limit: getInitialLoadMessageCount(context.loader.clientInfo),
        }),
    ]);

    return jsonWithSchema(LoaderSchema, {document, ...commentThreadResult});
}

export const meta = createMetaFunction(LoaderSchema, ({data: {commentThread}}) => {
    if (commentThread.commentAuthors.length === 0) {
        return {title: `Document comment thread${metaTitlePostfix}`};
    }

    return {
        title: `Document comment thread by ${getAccountShortNameWithoutFullNameTooltip(
            commentThread.commentAuthors[0]!,
        )}${metaTitlePostfix}`,
    };
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
            onCommentThreadSnippetPress={useEvent(() => {
                // Navigate the root of our app so we don't:
                //
                // - Open in a peek; OR
                // - Navigate the peek we are rendered in
                //
                // TODO(calebmer): Some global loading indicator?
                rootNavigate(
                    `/s/${initialDocument.spaceId}/documents/${initialDocument.id}?comments=${commentThread.id}`,
                ).catch(error => {
                    showToast({
                        type: "Error",
                        title: "Can’t open document",
                        error,
                    });
                });
            })}
            initialCommentThreadsResult={{
                commentThread,
                comments: initialComments,
                otherReferencedComments: initialOtherReferencedComments,
                optimisticComments: [],
            }}
            withMobileLayout={withMobileLayout}
        />
    );
}
