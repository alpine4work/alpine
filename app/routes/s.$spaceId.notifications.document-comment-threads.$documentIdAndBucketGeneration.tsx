import {CaretLeft, CaretRight} from "phosphor-react";
import {useMemo, useState} from "react";
import {usePress} from "react-aria";
import {Box} from "~/client/design/box.js";
import {IconButton} from "~/client/design/icon_button.js";
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
import {useIsMobile} from "~/client/remix/use_is_mobile.js";
import {useLoaderDataWithSchema} from "~/client/remix/use_loader_data_with_schema.js";
import {useNavigate, useRootNavigate} from "~/client/remix/use_navigate.js";
import {metaTitlePostfix} from "~/client/remix/use_update_meta_title.js";
import {useSearchAffinityViewInteraction} from "~/client/search/use_search_affinity_view_interaction.js";
import {getInboxDocumentNewCommentThreadsEntryCommentThreads} from "~/server/notifications/data/notifications_table.js";
import {jsonWithSchema} from "~/server/remix/json_with_schema.js";
import {LoaderArgs} from "~/server/remix/loader_context.js";
import {spacing} from "~/shared/design/spacing.js";
import {
    DocumentCommentModel,
    DocumentCommentThreadModel,
    DocumentModel,
    getDocumentContentTitle,
} from "~/shared/documents/document_model.js";
import {InvalidArgumentError} from "~/shared/error/error.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {clamp} from "~/shared/helpers/number/clamp.js";
import {isId} from "~/shared/id/id.js";
import {DocumentCommentThreadId, DocumentId, SpaceId} from "~/shared/id/types/id_types.js";
import {Schema} from "~/shared/schema/schema.js";
import {sprinkles} from "~/shared/styles/styles.js";
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
            (await context.actor.authenticate()).actor.authorizeSession(),
            {
                spaceId,
                documentId,
                bucketGeneration,
                commentLimit: getInitialLoadMessageCount(context.loader.getClientInfo()),
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
    withMobileLayout: withMobileLayoutProp = false,
}: {
    withMobileLayout?: boolean;
}) {
    const isMobile = useIsMobile();
    const rootNavigate = useRootNavigate();
    const showToast = useShowToast();
    const navigate = useNavigate();

    const withMobileLayout = isMobile || withMobileLayoutProp;

    const {
        document: initialDocument,
        commentThreads: initialCommentThreads,
        initialCommentsByCommentThreadId,
    } = useLoaderDataWithSchema(LoaderSchema);

    const {
        isConnected,
        editorState,
        procedures,
        subscribeToCommentThreadEvents,
        unpersistedResolutionStateByCommentThreadId,
    } = useDocumentContentEditorWebSocket(initialDocument);

    // Spending time with document comment threads contributes affinity points
    // to the document. Since the comment thread is discussing the document,
    // the document is likely an artifact you care about.
    useSearchAffinityViewInteraction(`Document:${initialDocument.id}`);

    const documentContent = editorState.getContent();
    const documentTitle = useMemo(
        () => getDocumentContentTitle(documentContent.doc),
        [documentContent],
    );

    const {isPressed: isTitlePressed, pressProps: titlePressProps} = usePress({
        onPress: () => {
            // TODO(calebmer, #global-loading-indicator): Some global loading indicator?
            void navigate(`/s/${initialDocument.spaceId}/documents/${initialDocument.id}`, {
                // Don't let the route open in `<PeekStack>`.
                stopPropagation: true,
            });
        },
    });

    const commentThreadCount = initialCommentThreads.length;

    const initialCommentThreadsResult = useMemo(
        () =>
            initialCommentThreads.map(commentThread => ({
                commentThread,
                comments: initialCommentsByCommentThreadId.get(commentThread.id)?.comments ?? [],
                otherReferencedComments:
                    initialCommentsByCommentThreadId.get(commentThread.id)
                        ?.otherReferencedComments ?? [],
                optimisticComments: [],
            })),
        [initialCommentThreads, initialCommentsByCommentThreadId],
    );

    const [mobileCurrentCommentThreadIndexFromState, setMobileCurrentCommentThreadIndex] =
        useState<number>(0);

    const mobileCurrentCommentThreadIndex = isMobile
        ? clamp(0, mobileCurrentCommentThreadIndexFromState, commentThreadCount - 1)
        : 0;
    if (mobileCurrentCommentThreadIndex !== mobileCurrentCommentThreadIndexFromState) {
        setMobileCurrentCommentThreadIndex(mobileCurrentCommentThreadIndex);
    }

    // NOCOMMIT: Load more comments when switching between comment threads
    const navigationBar = useNavigationBar({
        isDisabled: !withMobileLayout,
        withMobileLayout,
        title: isMobile ? (
            <Box display="flex" justifyContent="center" alignItems="center" gap="1">
                <IconButton
                    size="md"
                    description="Previous thread"
                    isDisabled={mobileCurrentCommentThreadIndex === 0}
                    onPress={() =>
                        setMobileCurrentCommentThreadIndex(mobileCurrentCommentThreadIndex - 1)
                    }
                >
                    <CaretLeft />
                </IconButton>
                <Box minWidth="12" paddingX="1.5" textAlign="center">
                    Thread {mobileCurrentCommentThreadIndex + 1} of {commentThreadCount}
                </Box>
                <IconButton
                    size="md"
                    description="Next thread"
                    isDisabled={mobileCurrentCommentThreadIndex === commentThreadCount - 1}
                    onPress={() =>
                        setMobileCurrentCommentThreadIndex(mobileCurrentCommentThreadIndex + 1)
                    }
                >
                    <CaretRight />
                </IconButton>
            </Box>
        ) : (
            <span
                {...titlePressProps}
                className={sprinkles({
                    cursor: "pointer",
                    opacity: isTitlePressed ? "60" : undefined,
                })}
            >
                {documentTitle}
            </span>
        ),
        subtitle: !isMobile ? "New comments" : undefined,
        withoutDisappearingTitle: true,
    });

    return (
        <DocumentCommentThreadListView
            // When rendering for mobile, we render one comment thread at a time. Instead of
            // rendering them all in a list. Since our sticky comment input UI pattern
            // doesn't work particularly well on mobile.
            key={isMobile ? `mobile-${mobileCurrentCommentThreadIndex}` : "desktop"}
            documentId={initialDocument.id}
            content={documentContent}
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
            initialCommentThreadsResult={useMemo(
                () =>
                    // Show one comment thread at a time on mobile.
                    isMobile
                        ? [initialCommentThreadsResult[mobileCurrentCommentThreadIndex]!]
                        : initialCommentThreadsResult,
                [initialCommentThreadsResult, isMobile, mobileCurrentCommentThreadIndex],
            )}
            navigationBar={navigationBar}
            header={useMemo(() => {
                if (!withMobileLayout) return undefined;

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
            }, [isMobile, withMobileLayout])}
        />
    );
}
