import {useMemo} from "react";
import {
    deserializeDocumentIdForLoader,
    deserializeSpaceIdForLoader,
} from "~/app/helpers/deserialize_id_for_loader.js";
import {Box} from "~/client/design/box.js";
import {navigationBarHeight} from "~/client/design/navigation_bar_helpers.js";
import {DocumentCommentThreadListView} from "~/client/documents/document_comment_thread_list_view.js";
import {useDocumentContentEditorWebSocket} from "~/client/documents/use_document_content_editor_web_socket.js";
import {useEvent} from "~/client/helpers/lifecycle/use_event.js";
import {useInboxBannerOutletContainer} from "~/client/inbox/use_inbox_banner_outlet_container.js";
import {getInitialLoadMessageCount} from "~/client/messaging/get_initial_load_message_count.js";
import {useNavigationBar} from "~/client/navigation/navigation_bar.js";
import {createMetaFunction} from "~/client/remix/create_meta_function.js";
import {getInitialAppRenderPlatform, usePlatform} from "~/client/remix/platform_context.js";
import {getInitialAppRenderSpacingScale} from "~/client/remix/spacing_scale_context.js";
import {useLoaderDataWithSchema} from "~/client/remix/use_loader_data_with_schema.js";
import {useRootNavigate} from "~/client/remix/use_navigate.js";
import {useSearchAffinityViewEntityInteraction} from "~/client/search/use_search_affinity_view_entity_interaction.js";
import {documentCommentThreadCountAgainstLimit} from "~/client/styles/document_shared_styles.js";
import {contentStyles} from "~/client/styles/styles.js";
import {getDocumentAndCommentThreadsWithInitialComments} from "~/server/documents/data/documents_actions.js";
import {getInboxEntry} from "~/server/notifications/data/notifications_actions.js";
import {jsonWithSchema} from "~/server/remix/json_with_schema.js";
import {LoaderArgs} from "~/server/remix/loader_context.js";
import {getAccountShortNameWithoutFullNameTooltip} from "~/shared/accounts/get_account_short_name_without_full_name_tooltip.js";
import {spacing} from "~/shared/design/core/spacing.js";
import {
    DocumentCommentModel,
    DocumentCommentThreadModel,
    DocumentModel,
} from "~/shared/documents/document_model.js";
import {createDynamoGeneralRealtimeItemSchema} from "~/shared/dynamo/dynamo_general_realtime_types.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {DocumentCommentThreadId} from "~/shared/id/types/id_types.js";
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

    const spaceId = deserializeSpaceIdForLoader(params.spaceId);
    const documentId = deserializeDocumentIdForLoader(params.documentId);
    const commentThreadId = Schema.id<DocumentCommentThreadId>().deserialize(
        params.commentThreadId ?? null,
    );

    const url = new URL(request.url);

    const clientInfo = context.loader.getClientInfo();
    const platform = getInitialAppRenderPlatform(clientInfo);
    const spacingScale = getInitialAppRenderSpacingScale(clientInfo);

    const [{document, commentThreads, initialCommentsByCommentThreadId}, inboxEntry] =
        await runAllPromises([
            getDocumentAndCommentThreadsWithInitialComments(context, {
                documentId,
                commentThreadIds: [commentThreadId],
                commentLimit: getInitialLoadMessageCount(clientInfo),
                commentThreadCountAgainstLimit:
                    documentCommentThreadCountAgainstLimit[platform][spacingScale],
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
        return [{title: "Document comment thread"}];
    }

    return [
        {
            // Account name in title won't update when account changes without reload
            // because we're using `initialData`.
            title: `Document comment thread by ${getAccountShortNameWithoutFullNameTooltip(
                commentThread.firstCommentAuthor.initialData,
            )}`,
        },
    ];
});

export default function DocumentCommentThreadRoute() {
    const platform = usePlatform();
    const rootNavigate = useRootNavigate();

    const {
        document: initialDocument,
        commentThread,
        initialComments,
        initialOtherReferencedComments,
        inboxEntry,
    } = useLoaderDataWithSchema(LoaderSchema);

    const {
        isConnected,
        content,
        procedures,
        subscribeToCommentThreadEvents,
        unpersistedResolutionStateByCommentThreadId,
    } = useDocumentContentEditorWebSocket({
        documentId: initialDocument.id,
        initialDocument,
    });

    // Spending time with a document comment thread contributes affinity points
    // back to the document. Since the comment thread is discussing the document,
    // the document is likely an artifact you care about.
    useSearchAffinityViewEntityInteraction(`Document:${initialDocument.id}`);

    const navigationBar = useNavigationBar({
        isDisabled: platform !== "mobile",
        title: "Comment thread",
        withoutDisappearingTitle: true,
    });

    const node = (
        <DocumentCommentThreadListView
            documentId={initialDocument.id}
            content={content}
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
                        platform === "mobile"
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
            withSafeAreaInsetTop={platform !== "mobile"}
            header={useMemo(() => {
                if (platform !== "mobile") return undefined;

                return {
                    minHeight: spacing[navigationBarHeight],
                    node: (
                        <Box
                            position="relative"
                            width="full"
                            maxWidth={contentStyles.contentMaxWidth}
                            paddingTop="safe-area-inset"
                            marginX="center"
                        >
                            <Box height={navigationBarHeight} />
                        </Box>
                    ),
                };
            }, [platform])}
        />
    );

    return useInboxBannerOutletContainer(
        {
            initialEntry: inboxEntry,
            maxWidth: contentStyles.contentMaxWidth,
        },
        node,
    );
}
