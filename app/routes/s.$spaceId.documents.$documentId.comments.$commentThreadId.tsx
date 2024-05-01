import {useMemo} from "react";
import {Box} from "~/client/design/box.js";
import {navigationBarHeight, useNavigationBar} from "~/client/design/navigation_bar.js";
import {useShowToast} from "~/client/design/toast.js";
import {
    DocumentCommentThreadListView,
    documentCommentThreadListViewMaxWidth,
} from "~/client/documents/document_comment_thread_list_view.js";
import {documentCommentThreadCountAgainstLimit} from "~/client/documents/document_shared_styles.js";
import {useDocumentContentEditorWebSocket} from "~/client/documents/use_document_content_editor_web_socket.js";
import {useEvent} from "~/client/helpers/lifecycle/use_event.js";
import {getInitialLoadMessageCount} from "~/client/messaging/messaging_view.js";
import {createMetaFunction} from "~/client/remix/create_meta_function.js";
import {useIsMobile} from "~/client/remix/use_is_mobile.js";
import {useLoaderDataWithSchema} from "~/client/remix/use_loader_data_with_schema.js";
import {useRootNavigate} from "~/client/remix/use_navigate.js";
import {metaTitlePostfix} from "~/client/remix/use_update_meta_title.js";
import {useSearchAffinityViewInteraction} from "~/client/search/use_search_affinity_view_interaction.js";
import {getDocumentAndCommentThreadsWithInitialComments} from "~/server/documents/data/documents_table.js";
import {jsonWithSchema} from "~/server/remix/json_with_schema.js";
import {LoaderArgs} from "~/server/remix/loader_context.js";
import {getAccountShortNameWithoutFullNameTooltip} from "~/shared/accounts/get_account_short_name_without_full_name_tooltip.js";
import {spacing} from "~/shared/design/spacing.js";
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
    if (!commentThread.firstCommentAuthor) {
        return [{title: `Document comment thread${metaTitlePostfix}`}];
    }

    return [
        {
            // Account name in title won't update when account changes without reload
            // because we're using `initialData`.
            title: `Document comment thread by ${getAccountShortNameWithoutFullNameTooltip(
                commentThread.firstCommentAuthor.initialData,
            )}${metaTitlePostfix}`,
        },
    ];
});

export default function DocumentCommentThreadRoute({
    withMobileLayout = false,
}: {
    withMobileLayout?: boolean;
}) {
    const isMobile = useIsMobile();
    const rootNavigate = useRootNavigate();
    const showToast = useShowToast();

    const {
        document: initialDocument,
        commentThread,
        initialComments,
        initialOtherReferencedComments,
    } = useLoaderDataWithSchema(LoaderSchema);

    const {
        isConnected,
        editorState,
        procedures,
        subscribeToCommentThreadEvents,
        unpersistedResolutionStateByCommentThreadId,
    } = useDocumentContentEditorWebSocket(initialDocument);

    // Spending time with a document comment thread contributes affinity points
    // back to the document. Since the comment thread is discussing the document,
    // the document is likely an artifact you care about.
    useSearchAffinityViewInteraction(`Document:${initialDocument.id}`);

    const navigationBar = useNavigationBar({
        isDisabled: !isMobile,
        withMobileLayout,
        title: "New comments",
    });

    return (
        <DocumentCommentThreadListView
            documentId={initialDocument.id}
            content={editorState.getContent()}
            isConnected={isConnected}
            procedures={procedures}
            subscribeToCommentThreadEvents={subscribeToCommentThreadEvents}
            unpersistedResolutionStateByCommentThreadId={
                unpersistedResolutionStateByCommentThreadId
            }
            onCommentThreadSnippetPress={useEvent(commentThreadId => {
                // Navigate the root of our app so we don't:
                //
                // - Open in a peek; OR
                // - Navigate the peek we are rendered in
                //
                // TODO(calebmer, #global-loading-indicator): Some global loading indicator?
                rootNavigate(
                    `/s/${initialDocument.spaceId}/documents/${initialDocument.id}?${
                        isMobile
                            ? // On mobile, only scroll to where the comment lives in the document. Don't open
                              // up the comment overlay.
                              `scroll=comments-${commentThreadId}`
                            : `comments=${commentThreadId}`
                    }`,
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
            navigationBar={navigationBar}
            header={useMemo(() => {
                if (!isMobile) return undefined;

                return {
                    minHeight: spacing[navigationBarHeight[isMobile ? "mobile" : "desktop"]],
                    node: (
                        <Box
                            position="relative"
                            style={{paddingTop: "var(--safe-area-inset-top, 0px)"}}
                            width="full"
                            maxWidth={documentCommentThreadListViewMaxWidth}
                            marginX="center"
                        >
                            <Box height={navigationBarHeight} />
                        </Box>
                    ),
                };
            }, [isMobile])}
        />
    );
}
