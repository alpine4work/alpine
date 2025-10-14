import {CaretLeft, CaretRight} from "phosphor-react";
import {MutableRefObject, useMemo, useRef, useState} from "react";
import {deserializeSpaceIdForLoader} from "~/app/helpers/deserialize_id_for_loader.js";
import {Box} from "~/client/design/box.js";
import {IconButton} from "~/client/design/icon_button.js";
import {navigationBarHeight} from "~/client/design/navigation_bar_helpers.js";
import {
    DocumentCommentThreadListView,
    DocumentCommentThreadListViewRef,
} from "~/client/documents/document_comment_thread_list_view.js";
import {useDocumentContentEditorWebSocket} from "~/client/documents/use_document_content_editor_web_socket.js";
import {useEvent} from "~/client/helpers/lifecycle/use_event.js";
import {useInboxBannerOutletContainer} from "~/client/inbox/use_inbox_banner_outlet_container.js";
import {getInitialLoadMessageCount} from "~/client/messaging/get_initial_load_message_count.js";
import {useNavigationBar} from "~/client/navigation/navigation_bar.js";
import {createMetaFunction} from "~/client/remix/create_meta_function.js";
import {
    getInitialAppRenderPlatform,
    getPlatformWithoutListening,
    usePlatform,
} from "~/client/remix/platform_context.js";
import {
    getInitialAppRenderSpacingScale,
    getSpacingScaleWithoutListening,
} from "~/client/remix/spacing_scale_context.js";
import {useLoaderDataWithSchema} from "~/client/remix/use_loader_data_with_schema.js";
import {useRootNavigate} from "~/client/remix/use_navigate.js";
import {useSearchAffinityViewEntityInteraction} from "~/client/search/use_search_affinity_view_entity_interaction.js";
import {documentCommentThreadCountAgainstLimit} from "~/client/styles/document_shared_styles.js";
import {messageViewMinHeightPx} from "~/client/styles/messaging_shared_styles.js";
import {contentStyles} from "~/client/styles/styles.js";
import {getVirtualizationWindowHeight} from "~/client/virtualized/virtualized_scroll_view_state.js";
import {
    getInboxDocumentNewCommentThreadsEntryCommentThreads,
    getInboxEntry,
} from "~/server/notifications/data/notifications_actions.js";
import {jsonWithSchema} from "~/server/remix/json_with_schema.js";
import {LoaderArgs} from "~/server/remix/loader_context.js";
import {getSpellCheckIgnoredLints} from "~/server/spell_check/get_spell_check_ignored_lints.js";
import {spacing} from "~/shared/design/core/spacing.js";
import {printPrettySmallNumberSummary} from "~/shared/design/print_pretty_small_number_summary.js";
import {
    DocumentCommentModel,
    DocumentCommentThreadModel,
    DocumentModel,
} from "~/shared/documents/document_model.js";
import {
    createDynamoGeneralRealtimeItemSchema,
    createDynamoGeneralRealtimeQuerySchema,
} from "~/shared/dynamo/dynamo_general_realtime_types.js";
import {InvalidArgumentError} from "~/shared/error/error.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {clamp} from "~/shared/helpers/number/clamp.js";
import {generateId, isId} from "~/shared/id/id.js";
import {DocumentCommentThreadId, DocumentId} from "~/shared/id/types/id_types.js";
import {InboxEntryModelSchema} from "~/shared/notifications/inbox_model.js";
import {Schema} from "~/shared/schema/schema.js";
import {SpellCheckIgnoredLintModel} from "~/shared/spell_check/spell_check_model.js";
import {TracerEventData} from "~/shared/tracer/types/tracer_event_data.js";

const LoaderSchema = Schema.object({
    key: Schema.string,
    document: DocumentModel.schema(),
    commentThreads: Schema.array(DocumentCommentThreadModel.schema()),
    initialCommentsByCommentThreadId: Schema.map(
        Schema.id<DocumentCommentThreadId>(),
        Schema.object({
            comments: Schema.array(DocumentCommentModel.schema()),
            otherReferencedComments: Schema.array(DocumentCommentModel.schema()),
        }),
    ),
    inboxEntry: createDynamoGeneralRealtimeItemSchema(InboxEntryModelSchema).nullable(),
    spellCheckIgnoredLints: createDynamoGeneralRealtimeQuerySchema(
        SpellCheckIgnoredLintModel.schema(),
    ),
});

export async function loader({params, request, context: unauthenticatedContext}: LoaderArgs) {
    const context = (await unauthenticatedContext.actor.authenticate()).actor.authorizeSession();

    const url = new URL(request.url);

    const spaceId = deserializeSpaceIdForLoader(params.spaceId);
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

    const clientInfo = context.loader.getClientInfo();
    const platform = getInitialAppRenderPlatform(clientInfo);
    const spacingScale = getInitialAppRenderSpacingScale(clientInfo);

    const [
        {document, commentThreads, initialCommentsByCommentThreadId},
        inboxEntry,
        spellCheckIgnoredLints,
    ] = await runAllPromises([
        getInboxDocumentNewCommentThreadsEntryCommentThreads(context, {
            spaceId,
            documentId,
            bucketGeneration,
            commentLimit: getInitialLoadMessageCount(clientInfo),
            commentThreadCountAgainstLimit:
                documentCommentThreadCountAgainstLimit[platform][spacingScale],
        }),
        url.searchParams.get("inbox") === "show"
            ? getInboxEntry(context, {
                  spaceId,
                  key: {type: "DocumentNewCommentThreads", documentId, bucketGeneration},
              })
            : null,
        getSpellCheckIgnoredLints(context, `Document:${documentId}`),
    ]);

    const propagateEventData: TracerEventData = {
        context: {
            documentId,
        },
    };

    return jsonWithSchema(
        LoaderSchema,
        {
            key: generateId(),
            document,
            commentThreads,
            initialCommentsByCommentThreadId,
            inboxEntry,
            spellCheckIgnoredLints,
        },
        {propagateEventData},
    );
}

export const meta = createMetaFunction(LoaderSchema, ({data: {document, commentThreads}}) => [
    {
        title: `${printPrettySmallNumberSummary(
            commentThreads.length,
            "new comment thread",
        )} on ${document.getTitle()}`,
    },
]);

export default function DocumentNewCommentThreadsRoute() {
    const {key} = useLoaderDataWithSchema(LoaderSchema);

    return (
        <DocumentNewCommentThreadsRouteInner
            // Completely re-mount the route when we get new data from the server.
            key={key}
        />
    );
}

function DocumentNewCommentThreadsRouteInner() {
    const platform = usePlatform();
    const rootNavigate = useRootNavigate();

    const {
        document: initialDocument,
        commentThreads: initialCommentThreads,
        initialCommentsByCommentThreadId,
        inboxEntry,
        spellCheckIgnoredLints,
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
        initialSpellCheckIgnoredLints: spellCheckIgnoredLints,
    });

    // Spending time with document comment threads contributes affinity points
    // to the document. Since the comment thread is discussing the document,
    // the document is likely an artifact you care about.
    useSearchAffinityViewEntityInteraction(`Document:${initialDocument.id}`);

    const listViewRef = useRef<DocumentCommentThreadListViewRef>(null);

    const commentThreadCount = initialCommentThreads.length;

    const [initialCommentThreadResults, setInitialCommentThreadResults] = useState<
        ReadonlyArray<{
            readonly commentThread: DocumentCommentThreadModel;
            readonly comments: ReadonlyArray<DocumentCommentModel>;
            readonly otherReferencedComments: ReadonlyArray<DocumentCommentModel>;
            readonly optimisticComments: ReadonlyArray<never>;
            readonly loadMoreCommentsRef: MutableRefObject<Promise<void> | null>;
        }>
    >(() =>
        initialCommentThreads.map(commentThread => ({
            commentThread,
            comments: initialCommentsByCommentThreadId.get(commentThread.id)?.comments ?? [],
            otherReferencedComments:
                initialCommentsByCommentThreadId.get(commentThread.id)?.otherReferencedComments ??
                [],
            optimisticComments: [],
            loadMoreCommentsRef: {current: null},
        })),
    );

    const [mobileCommentThreadIndexFromState, setMobileCommentThreadIndex] = useState<number>(0);

    const mobileCommentThreadIndex =
        platform === "mobile"
            ? clamp(0, mobileCommentThreadIndexFromState, commentThreadCount - 1)
            : 0;
    if (mobileCommentThreadIndex !== mobileCommentThreadIndexFromState) {
        setMobileCommentThreadIndex(mobileCommentThreadIndex);
    }

    const switchMobileCommentThreadIndexAbortControllerRef = useRef<AbortController | null>(null);

    // When we switch between comment threads on mobile we may not have loaded
    // comments for the comment thread! Our server `loader()` loads comments as if
    // the comment threads are in a list you scroll through. Which they are on
    // desktop. But on mobile the user paginates through comment threads. We want
    // to make sure when the user navigates to a thread it has data so we don't
    // flash loading indicators at them.
    //
    // The server will typically load comments for the first 2-4 comment threads
    // and after that mobile will need to fill in the blanks when the user switches
    // comment threads.
    const switchMobileCommentThreadIndex = async (commentThreadIndex: number) => {
        const platform = getPlatformWithoutListening();
        if (platform !== "mobile") return;

        switchMobileCommentThreadIndexAbortControllerRef.current?.abort();
        switchMobileCommentThreadIndexAbortControllerRef.current = null;

        const abortController = new AbortController();
        switchMobileCommentThreadIndexAbortControllerRef.current = abortController;

        const listView = assertExists(listViewRef.current);

        commentThreadIndex = clamp(0, commentThreadIndex, commentThreadCount - 1);

        const initialCommentThreadResult = initialCommentThreadResults[commentThreadIndex]!;

        const spacingScale = getSpacingScaleWithoutListening();
        const virtualizationWindowHeightPx = getVirtualizationWindowHeight(listView.getHeight());

        const loadCommentCount =
            Math.max(
                20,
                Math.ceil(virtualizationWindowHeightPx / messageViewMinHeightPx[spacingScale]),
            ) - Math.floor(documentCommentThreadCountAgainstLimit[platform][spacingScale]);

        if (
            initialCommentThreadResult.comments.length <
                initialCommentThreadResult.commentThread.commentCount &&
            initialCommentThreadResult.comments.length < loadCommentCount
        ) {
            // We don't want to load more comments for the same comment thread twice. So we
            // have `loadMoreCommentsRef` to make sure there's only one promise per comment
            // thread at a time.
            initialCommentThreadResult.loadMoreCommentsRef.current ??= (async () => {
                const {commentCount, lastCommentChangeTime, comments, otherReferencedComments} =
                    await procedures.getCommentsFromStart({
                        commentThreadId: initialCommentThreadResult.commentThread.id,
                        limit: loadCommentCount - initialCommentThreadResult.comments.length,
                        afterCommentIndex:
                            initialCommentThreadResult.comments.length > 0
                                ? initialCommentThreadResult.comments.length - 1
                                : null,
                        beforeCommentIndex: null,
                    });

                setInitialCommentThreadResults(initialCommentThreadResults =>
                    initialCommentThreadResults.map(otherInitialCommentThreadResult => {
                        // Find the result we want to update. It must be the exact same object we had
                        // when we started loading data. If the object was removed or changed then we
                        // don't update anything.
                        if (otherInitialCommentThreadResult !== initialCommentThreadResult)
                            return otherInitialCommentThreadResult;

                        return {
                            commentThread: initialCommentThreadResult.commentThread.clone({
                                commentCount,
                                lastCommentChangeTime,
                            }),
                            comments: [...initialCommentThreadResult.comments, ...comments],
                            otherReferencedComments: [
                                ...initialCommentThreadResult.otherReferencedComments,
                                ...otherReferencedComments,
                            ],
                            optimisticComments: initialCommentThreadResult.optimisticComments,
                            loadMoreCommentsRef: {current: null},
                        };
                    }),
                );
            })();

            await initialCommentThreadResult.loadMoreCommentsRef.current;
        }

        // If our switch was aborted then don't update our comment thread index state.
        if (abortController.signal.aborted) return;

        setMobileCommentThreadIndex(commentThreadIndex);
    };

    const navigationBar = useNavigationBar({
        isDisabled: platform !== "mobile",
        title:
            commentThreadCount === 1 ? (
                "New comment thread"
            ) : (
                <Box display="flex" justifyContent="center" alignItems="center" gap="1.5">
                    <IconButton
                        size="md"
                        description="Previous thread"
                        isDisabled={mobileCommentThreadIndex === 0}
                        pressErrorTitle="Can’t go to previous thread"
                        onPress={() => switchMobileCommentThreadIndex(mobileCommentThreadIndex - 1)}
                    >
                        <CaretLeft />
                    </IconButton>
                    <Box style={{fontVariantNumeric: "tabular-nums"}}>
                        {mobileCommentThreadIndex + 1} of {commentThreadCount} new{" "}
                        {
                            // We just call it "threads" and not "comment threads" here (we call this
                            // entity "comment threads" everywhere else) since "comment threads" visually
                            // looks too long.
                            "threads"
                        }
                    </Box>
                    <IconButton
                        size="md"
                        description="Next thread"
                        isDisabled={mobileCommentThreadIndex === commentThreadCount - 1}
                        pressErrorTitle="Can’t go to next thread"
                        onPress={() => switchMobileCommentThreadIndex(mobileCommentThreadIndex + 1)}
                    >
                        <CaretRight />
                    </IconButton>
                </Box>
            ),
        withoutDisappearingTitle: true,
    });

    const node = (
        <DocumentCommentThreadListView
            ref={listViewRef}
            // When rendering for mobile, we render one comment thread at a time. Instead of
            // rendering them all in a list. Since our sticky comment input UI pattern
            // doesn't work particularly well on mobile.
            key={platform === "mobile" ? `mobile-${mobileCommentThreadIndex}` : "desktop"}
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
            initialCommentThreadResults={useMemo(
                () =>
                    // Show one comment thread at a time on mobile.
                    platform === "mobile"
                        ? [initialCommentThreadResults[mobileCommentThreadIndex]!]
                        : initialCommentThreadResults,
                [initialCommentThreadResults, mobileCommentThreadIndex, platform],
            )}
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
