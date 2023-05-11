import {MetaFunction} from "@remix-run/server-runtime";
import {useShowToast} from "~/client/design/toast";
import {
    DocumentCommentThreadListView,
    documentCommentThreadListViewMarginY,
} from "~/client/documents/document_comment_thread_list_view";
import {
    documentCommentInputMinHeight,
    documentCommentThreadPreviewHeightWithHeader,
} from "~/client/documents/document_shared_styles";
import {useDocumentContentEditorWebSocket} from "~/client/documents/use_document_content_editor_web_socket";
import {useEvent} from "~/client/helpers/lifecycle/use_event";
import {messageViewMinHeight} from "~/client/messaging/message_view";
import {getInitialLoadMessageCount} from "~/client/messaging/messaging_view";
import {useLoaderDataWithSchema} from "~/client/remix/use_loader_data_with_schema";
import {useRootNavigate} from "~/client/remix/use_navigate";
import {metaTitlePostfix} from "~/client/remix/use_update_meta_title";
import {getInboxDocumentNewCommentThreadsEntryCommentThreads} from "~/server/dynamo/notifications_table";
import {jsonWithSchema} from "~/server/remix/json_with_schema";
import {LoaderArgs} from "~/server/remix/loader_context";
import {addRemLengths, parseRemLengthNumber, spacing} from "~/shared/design/spacing";
import {InvalidArgumentError} from "~/shared/error/error";
import {assertExists} from "~/shared/helpers/control/assert_exists";
import {isId} from "~/shared/id/id";
import {DocumentCommentThreadId, DocumentId, SpaceId} from "~/shared/id/types/id_types";
import {
    DocumentCommentModel,
    DocumentCommentThreadModel,
    DocumentModel,
} from "~/shared/models/document_model";
import {Schema} from "~/shared/schema/schema";
import {TracerEventData} from "~/shared/tracer/types/tracer_event_data";

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
    const spaceId = Schema.id<SpaceId>().deserialize(params.space_id ?? null);
    const documentIdAndBucketGeneration = assertExists(params["document_id_and_bucket_generation"]);
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

    const commentThreadHeightWithoutComments = addRemLengths(
        documentCommentThreadPreviewHeightWithHeader,
        documentCommentInputMinHeight,
        spacing[documentCommentThreadListViewMarginY],
    );

    const commentThreadCountAgainstLimit =
        parseRemLengthNumber(commentThreadHeightWithoutComments) /
        parseRemLengthNumber(messageViewMinHeight);

    const {document, commentThreads, initialCommentsByCommentThreadId} =
        await getInboxDocumentNewCommentThreadsEntryCommentThreads(
            await context.actor.authenticate(),
            {
                spaceId,
                documentId,
                bucketGeneration,
                commentLimit: getInitialLoadMessageCount(context.loader.clientInfo),
                commentThreadCountAgainstLimit,
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

export const meta: MetaFunction = () => {
    return {
        title: `New document comment threads notification${metaTitlePostfix}`,
    };
};

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
            withPreviewHeaders={true}
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
                // TODO(calebmer): Some global loading indicator?
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
