import {CaretLeft, CaretRight} from "phosphor-react";
import {MutableRefObject, useEffect, useMemo, useRef, useState} from "react";
import {deserializeSpaceIdForLoader} from "~/app/helpers/deserialize_id_for_loader.js";
import {useAppContext} from "~/client/web/context/app_context.js";
import {Box} from "~/client/web/design/box.js";
import {IconButton} from "~/client/web/design/icon_button.js";
import {navigationBarHeight} from "~/client/web/design/navigation_bar_helpers.js";
import {useReporter} from "~/client/web/design/reporter.js";
import {
    DocumentCommentThreadListView,
    DocumentCommentThreadListViewRef,
} from "~/client/web/documents/document_comment_thread_list_view.js";
import {useDocumentContentEditorWebSocket} from "~/client/web/documents/use_document_content_editor_web_socket.js";
import {useEvent, useEvents} from "~/client/web/helpers/lifecycle/use_event.js";
import {useStateWithOptimisticUpdates} from "~/client/web/helpers/use_state_with_optimistic_updates.js";
import {useWaitForState} from "~/client/web/helpers/use_wait_for_state.js";
import {
    archiveInboxDocumentNewCommentThreadsEntryCommentThreadOptimistically,
    subscribeToArchiveInboxDocumentNewCommentThreadsEntryCommentThreadOptimistically,
} from "~/client/web/inbox/archive_inbox_document_new_comment_threads_entry_comment_thread_optimistically.js";
import {useInboxContext} from "~/client/web/inbox/inbox_context.js";
import {InboxContextNavigation} from "~/client/web/inbox/inbox_context_types.js";
import {useInboxBannerOutletContainer} from "~/client/web/inbox/use_inbox_banner_outlet_container.js";
import {getInitialLoadMessageCount} from "~/client/web/messaging/get_initial_load_message_count.js";
import {useNavigationBar} from "~/client/web/navigation/navigation_bar.js";
import {createMetaFunction} from "~/client/web/remix/create_meta_function.js";
import {
    getInitialAppRenderPlatform,
    getPlatformWithoutListening,
    usePlatform,
} from "~/client/web/remix/platform_context.js";
import {
    getInitialAppRenderSpacingScale,
    getSpacingScaleWithoutListening,
} from "~/client/web/remix/spacing_scale_context.js";
import {useLoaderDataWithSchema} from "~/client/web/remix/use_loader_data_with_schema.js";
import {useRootNavigate} from "~/client/web/remix/use_navigate.js";
import {useSearchAffinityViewEntityInteraction} from "~/client/web/search/use_search_affinity_view_entity_interaction.js";
import {useSpaceContext} from "~/client/web/spaces/space_context.js";
import {documentCommentThreadCountAgainstLimit} from "~/client/web/styles/document_shared_styles.js";
import {messageViewMinHeightPx} from "~/client/web/styles/messaging_shared_styles.js";
import {contentStyles} from "~/client/web/styles/styles.js";
import {getVirtualizationWindowHeight} from "~/client/web/virtualized/virtualized_scroll_view_state.js";
import {getInboxDocumentNewCommentThreadsEntryCommentThreads} from "~/server/notifications/data/get_inbox_document_new_comment_threads_entry_comment_threads.js";
import {jsonWithSchema} from "~/server/remix/json_with_schema.js";
import {LoaderArgs} from "~/server/remix/loader_context.js";
import {spacing} from "~/shared/design/core/spacing.js";
import {printPrettySmallNumberSummary} from "~/shared/design/print_pretty_small_number_summary.js";
import {
    DocumentCommentModel,
    DocumentCommentThreadModel,
    DocumentModel,
} from "~/shared/documents/document_model.js";
import {RynamoItem, createRynamoItemSchema} from "~/shared/dynamo/rynamo_types.js";
import {InvalidArgumentError} from "~/shared/error/error.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {isDeepEqual} from "~/shared/helpers/control/is_deep_equal.js";
import {filterIterable} from "~/shared/helpers/iterable/filter_iterable.js";
import {clamp} from "~/shared/helpers/number/clamp.js";
import {generateId, isId} from "~/shared/id/id.js";
import {DocumentCommentThreadId, DocumentId} from "~/shared/id/types/id_types.js";
import {
    InboxDocumentCommentThreadEntryModel,
    InboxDocumentNewCommentThreadsEntryModel,
    InboxEntryModelSchema,
} from "~/shared/notifications/inbox_model.js";
import {
    archiveInboxDocumentNewCommentThreadsEntryCommentThread,
    unarchiveInboxDocumentNewCommentThreadsEntryCommentThread,
} from "~/shared/rpc/notifications_rpc_definitions.js";
import {Schema} from "~/shared/schema/schema.js";
import {
    ServerSynchronizationCheckpoint,
    ServerSynchronizationCheckpointSchema,
    generateServerSynchronizationCheckpoint,
} from "~/shared/web_socket/server_synchronization_checkpoint.js";

const LoaderSchema = Schema.object({
    key: Schema.string,
    checkpoint: ServerSynchronizationCheckpointSchema,
    document: DocumentModel.schema(),
    bucketGeneration: Schema.integer,
    inboxEntry: createRynamoItemSchema(InboxEntryModelSchema),
    commentThreads: Schema.array(DocumentCommentThreadModel.schema()),
    initialCommentsByCommentThreadId: Schema.map(
        Schema.id<DocumentCommentThreadId>(),
        Schema.object({
            comments: Schema.array(DocumentCommentModel.schema()),
            otherReferencedComments: Schema.array(DocumentCommentModel.schema()),
        }),
    ),
});

export async function loader({params, context: unauthenticatedContext}: LoaderArgs) {
    const context = (await unauthenticatedContext.actor.authenticate()).actor.authorizeSession();

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

    // Generate checkpoint before we start loading data. So when we backfill we include
    // any realtime events that happened while loading data.
    const checkpoint = generateServerSynchronizationCheckpoint();

    const {inboxEntry, document, commentThreads, initialCommentsByCommentThreadId} =
        await getInboxDocumentNewCommentThreadsEntryCommentThreads(context, {
            spaceId,
            documentId,
            bucketGeneration,
            commentLimit: getInitialLoadMessageCount(clientInfo),
            commentThreadCountAgainstLimit:
                documentCommentThreadCountAgainstLimit[platform][spacingScale],
        });

    return jsonWithSchema(LoaderSchema, {
        key: generateId(),
        checkpoint,
        document,
        bucketGeneration,
        inboxEntry,
        commentThreads,
        initialCommentsByCommentThreadId,
    });
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
        <DocumentNewCommentThreadsRouteInner1
            // Completely re-mount the route when we get new data from the server.
            key={key}
        />
    );
}

function DocumentNewCommentThreadsRouteInner1() {
    const {inboxEntry, commentThreads} = useLoaderDataWithSchema(LoaderSchema);

    const initialIsArchived = inboxEntry.model.isArchived;

    const inboxContext = useInboxContext();

    return useInboxBannerOutletContainer(
        {
            initialEntry: inboxEntry,
            maxWidth: contentStyles.contentMaxWidth,
            withoutArchiveButton: !initialIsArchived && commentThreads.length >= 2,
        },
        <DocumentNewCommentThreadsRouteInner2
            parentNavigation={inboxContext?.navigation ?? null}
            initialIsArchived={initialIsArchived}
        />,
    );
}

function DocumentNewCommentThreadsRouteInner2({
    parentNavigation,
    initialIsArchived,
}: {
    parentNavigation: InboxContextNavigation | null;
    initialIsArchived: boolean;
}) {
    const context = useAppContext();
    const platform = usePlatform();
    const rootNavigate = useRootNavigate();
    const reporter = useReporter();
    const {space} = useSpaceContext();

    const inboxContext = assertExists(useInboxContext());
    const originalInboxEntry = assertExists(inboxContext.entry);

    assert(
        originalInboxEntry.model instanceof InboxDocumentNewCommentThreadsEntryModel ||
            originalInboxEntry.model instanceof InboxDocumentCommentThreadEntryModel,
        "This route should only render an `InboxDocumentNewCommentThreadsEntryModel` or `InboxDocumentCommentThreadEntryModel`",
    );

    const inboxEntry = originalInboxEntry as RynamoItem<
        InboxDocumentNewCommentThreadsEntryModel | InboxDocumentCommentThreadEntryModel
    >;

    const {
        checkpoint: initialCheckpoint,
        document: initialDocument,
        bucketGeneration,
        commentThreads: initialCommentThreads,
        initialCommentsByCommentThreadId,
    } = useLoaderDataWithSchema(LoaderSchema);

    const documentId = initialDocument.id;

    const {
        isConnected,
        content,
        procedures,
        subscribeToCommentThreadEvents,
        subscribeToPongs,
        unpersistedResolutionStateByCommentThreadId,
    } = useDocumentContentEditorWebSocket({
        documentId,
        initialDocument,
    });

    // Spending time with document comment threads contributes affinity points to the
    // document. Since the comment thread is discussing the document, the document is
    // likely an artifact you care about.
    useSearchAffinityViewEntityInteraction(`Document:${documentId}`);

    const listViewRef = useRef<DocumentCommentThreadListViewRef>(null);

    const commentThreadCount = initialCommentThreads.length;

    const commentThreadIds = useMemo(
        () => initialCommentThreads.map(commentThread => commentThread.id),
        [initialCommentThreads],
    );

    const [initialCommentThreadResults, setInitialCommentThreadResults] = useState<
        ReadonlyArray<{
            readonly checkpoint: ServerSynchronizationCheckpoint;
            readonly commentThread: DocumentCommentThreadModel;
            readonly comments: ReadonlyArray<DocumentCommentModel>;
            readonly otherReferencedComments: ReadonlyArray<DocumentCommentModel>;
            readonly optimisticComments: ReadonlyArray<never>;
            readonly loadMoreCommentsRef: MutableRefObject<Promise<void> | null>;
        }>
    >(() =>
        initialCommentThreads.map(commentThread => ({
            checkpoint: initialCheckpoint,
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

    // When we switch between comment threads on mobile we may not have loaded comments
    // for the comment thread! Our server `loader()` loads comments as if the comment
    // threads are in a list you scroll through. Which they are on desktop. But on
    // mobile the user paginates through comment threads. We want to make sure when the
    // user navigates to a thread it has data so we don't flash loading indicators at
    // them.
    //
    // The server will typically load comments for the first 2-4 comment threads and
    // after that mobile will need to fill in the blanks when the user switches comment
    // threads.
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
                const {commentCount, comments, otherReferencedComments} =
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
                        // Find the result we want to update. It must be the exact same object we had when
                        // we started loading data. If the object was removed or changed then we don't
                        // update anything.
                        if (otherInitialCommentThreadResult !== initialCommentThreadResult)
                            return otherInitialCommentThreadResult;

                        return {
                            checkpoint: initialCommentThreadResult.checkpoint,
                            commentThread: initialCommentThreadResult.commentThread.clone({
                                commentCount,
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
                        pressErrorTitle="Can&#x2019;t go to previous thread"
                        onPress={() => switchMobileCommentThreadIndex(mobileCommentThreadIndex - 1)}
                    >
                        <CaretLeft />
                    </IconButton>
                    <Box style={{fontVariantNumeric: "tabular-nums"}}>
                        {mobileCommentThreadIndex + 1} of {commentThreadCount} new{" "}
                        {
                            // We just call it "threads" and not "comment threads" here (we call this entity
                            // "comment threads" everywhere else) since "comment threads" visually looks too
                            // long.
                            "threads"
                        }
                    </Box>
                    <IconButton
                        size="md"
                        description="Next thread"
                        isDisabled={mobileCommentThreadIndex === commentThreadCount - 1}
                        pressErrorTitle="Can&#x2019;t go to next thread"
                        onPress={() => switchMobileCommentThreadIndex(mobileCommentThreadIndex + 1)}
                    >
                        <CaretRight />
                    </IconButton>
                </Box>
            ),
        withoutDisappearingTitle: true,
        defaultPreviousRoute: `/s/${inboxEntry.model.spaceId}/inbox`,
    });

    const [
        archivedCommentThreadIds,
        setArchivedCommentThreadIds,
        setArchivedCommentThreadIdsOptimistically,
        archivedCommentThreadIdsWithoutOptimisticUpdates,
    ] = useStateWithOptimisticUpdates<ReadonlySet<DocumentCommentThreadId>>(() => {
        const archivedCommentThreadIds = new Set<DocumentCommentThreadId>();

        if (inboxEntry.model instanceof InboxDocumentNewCommentThreadsEntryModel) {
            for (const commentThreadId of commentThreadIds) {
                if (!inboxEntry.model.commentThreadIds.has(commentThreadId)) {
                    archivedCommentThreadIds.add(commentThreadId);
                }
            }
        } else if (inboxEntry.model.isArchived) {
            archivedCommentThreadIds.add(inboxEntry.model.commentThreadId);
        }

        return archivedCommentThreadIds;
    });

    const expectedArchivedCommentThreadIds = useMemo<ReadonlySet<DocumentCommentThreadId>>(() => {
        return new Set(
            filterIterable(commentThreadIds, commentThreadId =>
                inboxEntry.model instanceof InboxDocumentNewCommentThreadsEntryModel
                    ? !inboxEntry.model.commentThreadIds.has(commentThreadId)
                    : commentThreadId === inboxEntry.model.commentThreadId &&
                      inboxEntry.model.isArchived,
            ),
        );
    }, [commentThreadIds, inboxEntry.model]);

    const waitForExpectedArchivedCommentThreadIds = useWaitForState(
        expectedArchivedCommentThreadIds,
    );

    // Make sure `archivedCommentThreadIdsWithoutOptimisticUpdates` is always equal to
    // `expectedArchivedCommentThreadIds`.
    if (
        !isDeepEqual(
            expectedArchivedCommentThreadIds,
            archivedCommentThreadIdsWithoutOptimisticUpdates,
        )
    ) {
        setArchivedCommentThreadIds(() => expectedArchivedCommentThreadIds);
    }

    useEffect(() => {
        return subscribeToArchiveInboxDocumentNewCommentThreadsEntryCommentThreadOptimistically(
            event => {
                if (event.entryKey !== inboxEntry.key) return;

                // Wait for our inbox entry to update in realtime. The realtime update event may
                // happen after `promise` resolves.
                const waitPromise = waitForExpectedArchivedCommentThreadIds(
                    archivedCommentThreadIds => archivedCommentThreadIds.has(event.commentThreadId),
                );

                // NOTE(calebmer): We don't optimistically update `inboxEntry` itself because if
                // there's a new `latestCommentThread` we don't know the new `contentTextSnippet`
                // on the client.
                setArchivedCommentThreadIdsOptimistically(
                    event.promise.then(() => waitPromise).then(() => true),
                    (archivedCommentThreadIds, promiseValue) => {
                        if (promiseValue) return archivedCommentThreadIds;
                        const newArchivedCommentThreadIds = new Set(archivedCommentThreadIds);
                        newArchivedCommentThreadIds.add(event.commentThreadId);
                        return newArchivedCommentThreadIds;
                    },
                );
            },
        );
    }, [
        inboxEntry.key,
        setArchivedCommentThreadIdsOptimistically,
        waitForExpectedArchivedCommentThreadIds,
    ]);

    const {handleArchiveCommentThread, handleUnarchiveCommentThread} = useEvents({
        handleArchiveCommentThread: async (commentThreadId: DocumentCommentThreadId) => {
            const promise = archiveInboxDocumentNewCommentThreadsEntryCommentThread(context, {
                spaceId: space.id,
                documentId,
                bucketGeneration,
                commentThreadId,
            });

            promise.catch(error => {
                reporter.displayError("Couldn\u2019t mark commentThread as done", error);
            });

            archiveInboxDocumentNewCommentThreadsEntryCommentThreadOptimistically({
                promise,
                entryKey: inboxEntry.key,
                commentThreadId,
            });

            // If we're viewing new entries and by archiving this `commentThreadId` we've
            // archived all commentThreads in the entry then navigate to the next entry.
            if (
                parentNavigation?.filter === "New" &&
                inboxEntry.model instanceof InboxDocumentNewCommentThreadsEntryModel &&
                inboxEntry.model.commentThreadIds.size === 1 &&
                inboxEntry.model.commentThreadIds.has(commentThreadId)
            ) {
                if (parentNavigation.nextEntry) {
                    await parentNavigation.selectEntry(parentNavigation.nextEntry);
                } else if (parentNavigation.previousEntry) {
                    await parentNavigation.selectEntry(parentNavigation.previousEntry);
                } else {
                    await parentNavigation.selectEntry(null);
                }
            }
        },
        handleUnarchiveCommentThread: async (commentThreadId: DocumentCommentThreadId) => {
            const promise = unarchiveInboxDocumentNewCommentThreadsEntryCommentThread(context, {
                spaceId: space.id,
                documentId,
                bucketGeneration,
                commentThreadId,
            });

            promise.catch(error => {
                reporter.displayError("Couldn\u2019t move notification to new", error);
            });

            // Wait for our inbox entry to update in realtime. The realtime update event may
            // happen after `promise` resolves.
            const waitPromise = waitForExpectedArchivedCommentThreadIds(
                archivedCommentThreadIds => !archivedCommentThreadIds.has(commentThreadId),
            );

            // NOTE(calebmer): We don't optimistically update `inboxEntry` itself because if
            // there's a new `latestCommentThread` we don't know the new `contentTextSnippet`
            // on the client.
            setArchivedCommentThreadIdsOptimistically(
                promise.then(() => waitPromise).then(() => true),
                (archivedCommentThreadIds, promiseValue) => {
                    if (promiseValue) return archivedCommentThreadIds;
                    const newArchivedCommentThreadIds = new Set(archivedCommentThreadIds);
                    newArchivedCommentThreadIds.delete(commentThreadId);
                    return newArchivedCommentThreadIds;
                },
            );
        },
    });

    return (
        <DocumentCommentThreadListView
            ref={listViewRef}
            // When rendering for mobile, we render one comment thread at a time. Instead of
            // rendering them all in a list. Since our sticky comment input UI pattern doesn't
            // work particularly well on mobile.
            key={platform === "mobile" ? `mobile-${mobileCommentThreadIndex}` : "desktop"}
            documentId={documentId}
            content={content}
            isConnected={isConnected}
            procedures={procedures}
            subscribeToCommentThreadEvents={subscribeToCommentThreadEvents}
            subscribeToPongs={subscribeToPongs}
            unpersistedResolutionStateByCommentThreadId={
                unpersistedResolutionStateByCommentThreadId
            }
            onCommentThreadSnippetPress={useEvent(commentThreadId => {
                // Navigate the root of our app so we don't:
                //
                // - Open in a peek; OR
                // - Navigate the peek we are rendered in
                rootNavigate(
                    `/s/${space.id}/documents/${documentId}?${
                        platform === "mobile"
                            ? // On mobile, only scroll to where the comment lives in the document. Don't open up
                              // the comment overlay.
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
            isCommentThreadArchived={useMemo(() => {
                if (commentThreadCount < 2) return;

                // If this route was initially archived, we only let you "unarchive" the entry as a
                // whole. You can't unarchive individual comment threads.
                if (initialIsArchived) return;

                return (commentThreadId: DocumentCommentThreadId) =>
                    archivedCommentThreadIds.has(commentThreadId);
            }, [archivedCommentThreadIds, commentThreadCount, initialIsArchived])}
            onArchiveCommentThread={
                commentThreadCount >= 2 ? handleArchiveCommentThread : undefined
            }
            onUnarchiveCommentThread={
                commentThreadCount >= 2 ? handleUnarchiveCommentThread : undefined
            }
        />
    );
}
