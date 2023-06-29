import {MetaFunction} from "@remix-run/server-runtime";
import {useShowToast} from "~/client/design/toast.js";
import {DocumentCommentThreadListView} from "~/client/documents/document_comment_thread_list_view.js";
import {documentCommentThreadCountAgainstLimit} from "~/client/documents/document_shared_styles.js";
import {useDocumentContentEditorWebSocket} from "~/client/documents/use_document_content_editor_web_socket.js";
import {useEvent} from "~/client/helpers/lifecycle/use_event.js";
import {getInitialLoadMessageCount} from "~/client/messaging/messaging_view.js";
import {useLoaderDataWithSchema} from "~/client/remix/use_loader_data_with_schema.js";
import {useRootNavigate} from "~/client/remix/use_navigate.js";
import {metaTitlePostfix} from "~/client/remix/use_update_meta_title.js";
import {getInboxDocumentNewCommentThreadsEntryCommentThreads} from "~/server/dynamo/notifications_table.js";
import {jsonWithSchema} from "~/server/remix/json_with_schema.js";
import {LoaderArgs} from "~/server/remix/loader_context.js";
import {
    DocumentCommentModel,
    DocumentCommentThreadModel,
    DocumentModel,
} from "~/shared/documents/document_model.js";
import {InvalidArgumentError} from "~/shared/error/error.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {isId} from "~/shared/id/id.js";
import {DocumentCommentThreadId, DocumentId, SpaceId} from "~/shared/id/types/id_types.js";
import {Schema} from "~/shared/schema/schema.js";
import {TracerEventData} from "~/shared/tracer/types/tracer_event_data.js";

const LoaderSchema = Schema.object({
    document: DocumentModel.schema(),
    commentThreads: Schema.array(DocumentCommentThreadModel.schema()),
    initialCommentsByCommentThreadId: Schema.map(
        Schema.id<DocumentCommentThreadId>(),
        Schema.object({
            comments: Schema.array(DocumentCommentModel.schema()),
            otherReferencedComments: Schema.array(DocumentCommentModel.schema()),
        }),
    ),
});

export async function loader({params, context}: LoaderArgs) {
    const spaceId = Schema.id<SpaceId>().deserialize(params.spaceId ?? null);
    const documentIdAndBucketGeneration = assertExists(params.documentIdAndBucketGeneration);
    const [documentId, bucketGenerationString, ...otherParts] =
        documentIdAndBucketGeneration.split("-");

    if (otherParts.length !== 0)
        throw new InvalidArgumentError("Only expected two parts in the URL");

    if (!documentId || !isId<DocumentId>(documentId))
        throw new InvalidArgumentError("Expected `DocumentId`");

    const bucketGeneration =
        bucketGenerationString && /^\d+$/.test(bucketGenerationString)
            ? parseInt(bucketGenerationString, 10)
            : null;

    if (bucketGeneration === null || !Number.isInteger(bucketGeneration))
        throw new InvalidArgumentError("Expected bucket generation to be an integer");

    const {document, commentThreads, initialCommentsByCommentThreadId} =
        await getInboxDocumentNewCommentThreadsEntryCommentThreads(
            await context.actor.authenticate(),
            {
                spaceId,
                documentId,
                bucketGeneration,
                commentLimit: getInitialLoadMessageCount(context.loader.clientInfo),
                commentThreadCountAgainstLimit: documentCommentThreadCountAgainstLimit,
            },
        );

    const propagateEventData: TracerEventData = {
        context: {
            documentId,
        },
    };

    return jsonWithSchema(
        LoaderSchema,
        {document, commentThreads, initialCommentsByCommentThreadId},
        {propagateEventData},
    );
}

export const meta = () => [{title: `New document comment threads notification${metaTitlePostfix}`}];

export default function DocumentNewCommentThreadsRoute({
    withMobileLayout,
}: {
    withMobileLayout?: boolean;
}) {
    const rootNavigate = useRootNavigate();
    const showToast = useShowToast();

    const {
        document: initialDocument,
        commentThreads,
        initialCommentsByCommentThreadId,
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
            initialCommentThreadsResult={commentThreads.map(commentThread => ({
                commentThread,
                comments: initialCommentsByCommentThreadId.get(commentThread.id)?.comments ?? [],
                otherReferencedComments:
                    initialCommentsByCommentThreadId.get(commentThread.id)
                        ?.otherReferencedComments ?? [],
                optimisticComments: [],
            }))}
            withMobileLayout={withMobileLayout}
        />
    );
}
