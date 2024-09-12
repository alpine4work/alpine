import {useMemo} from "react";
import {Box} from "~/client/design/box.js";
import {navigationBarHeight, useNavigationBar} from "~/client/design/navigation_bar.js";
import {DocumentCommentThreadListView} from "~/client/documents/document_comment_thread_list_view.js";
import {useDocumentContentEditorWebSocket} from "~/client/documents/use_document_content_editor_web_socket.js";
import {useEvent} from "~/client/helpers/lifecycle/use_event.js";
import {InboxBannerOutletContainer} from "~/client/inbox/inbox_banner_outlet_container.js";
import {getInitialLoadMessageCount} from "~/client/messaging/messaging_view.js";
import {createMetaFunction} from "~/client/remix/create_meta_function.js";
import {getInitialAppRenderIsMobile, useIsMobile} from "~/client/remix/use_is_mobile.js";
import {useLoaderDataWithSchema} from "~/client/remix/use_loader_data_with_schema.js";
import {useRootNavigate} from "~/client/remix/use_navigate.js";
import {metaTitlePostfix} from "~/client/remix/use_update_meta_title.js";
import {useSearchAffinityViewInteraction} from "~/client/search/use_search_affinity_view_interaction.js";
import {
    documentCommentThreadCountAgainstLimit,
    documentCommentThreadListViewMaxWidth,
} from "~/client/styles/document_shared_styles.js";
import {getDocumentAndCommentThreadsWithInitialComments} from "~/server/documents/data/documents_table.js";
import {getInboxEntry} from "~/server/notifications/data/notifications_table.js";
import {jsonWithSchema} from "~/server/remix/json_with_schema.js";
import {LoaderArgs} from "~/server/remix/loader_context.js";
import {getAccountShortNameWithoutFullNameTooltip} from "~/shared/accounts/get_account_short_name_without_full_name_tooltip.js";
import {spacing} from "~/shared/design/spacing.js";
import {
    DocumentCommentModel,
    DocumentCommentThreadModel,
    DocumentModel,
} from "~/shared/documents/document_model.js";
import {createDynamoGeneralRealtimeItemSchema} from "~/shared/dynamo/dynamo_general_realtime_types.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {DocumentCommentThreadId, DocumentId, SpaceId} from "~/shared/id/types/id_types.js";
import {InboxEntryModelSchema} from "~/shared/notifications/inbox_model.js";
import {Schema} from "~/shared/schema/schema.js";

const LoaderSchema = Schema.object({
    document: DocumentModel.schema(),
    commentThread: DocumentCommentThreadModel.schema(),
    initialComments: Schema.array(DocumentCommentModel.schema()),
    initialOtherReferencedComments: Schema.array(DocumentCommentModel.schema()),
    inboxEntry: createDynamoGeneralRealtimeItemSchema(InboxEntryModelSchema).nullable(),
});

export async function loader({params, context: unauthenticatedContext, request}: LoaderArgs) {
    const context = (await unauthenticatedContext.actor.authenticate()).actor.authorizeSession();

    const spaceId = Schema.id<SpaceId>().deserialize(params.spaceId ?? null);
    const documentId = Schema.id<DocumentId>().deserialize(params.documentId ?? null);
    const commentThreadId = Schema.id<DocumentCommentThreadId>().deserialize(
        params.commentThreadId ?? null,
    );

    const url = new URL(request.url);

    const [{document, commentThreads, initialCommentsByCommentThreadId}, inboxEntry] =
        await runAllPromises([
            getDocumentAndCommentThreadsWithInitialComments(context, {
                documentId,
                commentThreadIds: [commentThreadId],
                commentLimit: getInitialLoadMessageCount(context.loader.getClientInfo()),
                commentThreadCountAgainstLimit:
                    documentCommentThreadCountAgainstLimit[
                        getInitialAppRenderIsMobile(context.loader.getClientInfo())
                            ? "mobile"
                            : "desktop"
                    ],
            }),
            url.searchParams.get("inbox") === "show"
                ? getInboxEntry(context, {
                      spaceId,
                      key: {type: "DocumentCommentThread", documentId, commentThreadId},
                  })
                : null,
        ]);

    const commentThread = assertExists(commentThreads[0]);

    const {comments, otherReferencedComments} = assertExists(
        initialCommentsByCommentThreadId.get(commentThreadId),
    );

    return jsonWithSchema(LoaderSchema, {
        document,
        commentThread,
        initialComments: comments,
        initialOtherReferencedComments: otherReferencedComments,
        inboxEntry,
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
    withMobileLayout: withMobileLayoutProp = false,
}: {
    withMobileLayout?: boolean;
}) {
    const isMobile = useIsMobile();
    const rootNavigate = useRootNavigate();

    const withMobileLayout = isMobile || withMobileLayoutProp;

    const {
        document: initialDocument,
        commentThread,
        initialComments,
        initialOtherReferencedComments,
        inboxEntry,
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
        title: "Comment thread",
        withoutDisappearingTitle: true,
    });

    const node = (
        <DocumentCommentThreadListView
            withMobileLayout={withMobileLayout}
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
                rootNavigate(
                    `/s/${initialDocument.spaceId}/documents/${initialDocument.id}?${
                        isMobile
                            ? // On mobile, only scroll to where the comment lives in the document. Don't open
                              // up the comment overlay.
                              `scroll=comments-${commentThreadId}`
                            : `comments=${commentThreadId}`
                    }`,
                );
            })}
            initialCommentThreadResults={[
                {
                    commentThread,
                    comments: initialComments,
                    otherReferencedComments: initialOtherReferencedComments,
                    optimisticComments: [],
                },
            ]}
            navigationBar={navigationBar}
            // Safe area inset is already accounted for on mobile thanks to the
            // `navigationBar`.
            withSafeAreaInsetTop={!isMobile}
            header={useMemo(() => {
                if (!isMobile) return undefined;

                return {
                    minHeight: spacing[navigationBarHeight[isMobile ? "mobile" : "desktop"]],
                    node: (
                        <Box
                            position="relative"
                            width="full"
                            maxWidth={documentCommentThreadListViewMaxWidth}
                            paddingTop="safe-area-inset"
                            marginX="center"
                        >
                            <Box height={navigationBarHeight} />
                        </Box>
                    ),
                };
            }, [isMobile])}
        />
    );

    if (!inboxEntry) {
        return node;
    } else {
        return (
            <InboxBannerOutletContainer
                initialEntry={inboxEntry}
                withMobileLayout={withMobileLayout}
                maxWidth={documentCommentThreadListViewMaxWidth}
                borderBottom="grey-10"
            >
                {node}
            </InboxBannerOutletContainer>
        );
    }
}
