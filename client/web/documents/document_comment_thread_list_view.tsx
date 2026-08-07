import {
    Memo,
    ReactNode,
    Ref,
    RefObject,
    forwardRef,
    useCallback,
    useEffect,
    useImperativeHandle,
    useMemo,
    useRef,
    useState,
} from "react";
import {MessageInputRef} from "~/client/web/content/messaging/message_input_base.js";
import {safeAreaOnlyScrollbarInsetTop} from "~/client/web/design/scrollbar.js";
import {useScrollToAvoidBottomBarsAndMobileKeyboard} from "~/client/web/design/use_scroll_to_avoid_bottom_bars_and_mobile_keyboard.js";
import {DocumentCommentInput} from "~/client/web/documents/internal/document_comment_input.js";
import {DocumentCommentThreadHeader} from "~/client/web/documents/internal/document_comment_thread_header.js";
import {DocumentContentEditorWebSocketClientProcedures} from "~/client/web/documents/internal/document_content_editor_web_socket_client.js";
import {SubscribeToCommentThreadEventsFunction} from "~/client/web/documents/use_document_content_editor_web_socket.js";
import {useConstant} from "~/client/web/helpers/lifecycle/use_constant.js";
import {useEvent} from "~/client/web/helpers/lifecycle/use_event.js";
import {useMergedRefs} from "~/client/web/helpers/refs/use_merged_refs.js";
import {MemoObject} from "~/client/web/helpers/types/memo_object.js";
import {useErrorState} from "~/client/web/helpers/use_error_state.js";
import {useStableJsonValue} from "~/client/web/helpers/use_stable_json_value.js";
import {useStableValue} from "~/client/web/helpers/use_stable_value.js";
import {useStateWithOptimisticUpdates} from "~/client/web/helpers/use_state_with_optimistic_updates.js";
import {useMessageEditing} from "~/client/web/messaging/message_editing.js";
import {MessageList, MessageListItem} from "~/client/web/messaging/message_list.js";
import {bufferedMessageViewHeight} from "~/client/web/messaging/message_view.js";
import {MessagingViewPointerToolbar} from "~/client/web/messaging/messaging_view_pointer_toolbar.js";
import {OnPutMessageApprovalDecisionsFunction} from "~/client/web/messaging/on_put_message_approval_decisions_function.js";
import {renderMessageListItem} from "~/client/web/messaging/render_message_list_item.js";
import {
    OnDeleteMessageReactionFunction,
    OnSetMessageReactionFunction,
    OnUpdateMessagesOptimisticallyFunction,
} from "~/client/web/messaging/set_or_delete_message_reaction_with_optimistic_update.js";
import {tryLoadingMessages} from "~/client/web/messaging/try_loading_messages.js";
import {
    JumpToMessageRangeOptions,
    useJumpToMessageRange,
} from "~/client/web/messaging/use_jump_to_message_range.js";
import {NavigationBarResult} from "~/client/web/navigation/navigation_bar_types.js";
import {usePlatform} from "~/client/web/remix/platform_context.js";
import {useSpacingScale} from "~/client/web/remix/spacing_scale_context.js";
import {
    documentCommentThreadActionsHeight,
    documentCommentThreadHeaderMinHeightWithoutPaddingTop,
    documentCommentThreadHeaderPaddingY,
} from "~/client/web/styles/document_shared_styles.js";
import {
    messageInputMinHeightPx,
    messagingViewMarginBottom,
    messagingViewMarginBottomCalcExpression,
} from "~/client/web/styles/messaging_shared_styles.js";
import {contentStyles, sprinkles} from "~/client/web/styles/styles.js";
import {VirtualizedTree} from "~/client/web/virtualized/helpers/virtualized_tree.js";
import {
    VirtualizedScrollView,
    VirtualizedScrollViewRef,
    VirtualizedScrollViewRenderItem,
} from "~/client/web/virtualized/virtualized_scroll_view.js";
import {RemLength, Spacing, addRemLengths, screenPaddingX} from "~/shared/design/core/spacing.js";
import {createDocumentCommentThreadSnippetCollector} from "~/shared/documents/create_document_comment_thread_snippet_collector.js";
import {DocumentContentWithReferences} from "~/shared/documents/document_content_references.js";
import {UncheckedDocumentContentSchema} from "~/shared/documents/document_content_schema.js";
import {
    DocumentCommentModel,
    DocumentCommentRoomKey,
    DocumentCommentThreadModel,
    decodeDocumentCommentRoomKey,
    decodePossiblyDocumentCommentRoomKey,
} from "~/shared/documents/document_model.js";
import {OutOfRangeError} from "~/shared/error/error.open_source.js";
import {FileAttachmentTarget} from "~/shared/files/file_attachment_target.js";
import {assert} from "~/shared/helpers/control/assert.open_source.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.open_source.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.open_source.js";
import {LazyMap} from "~/shared/helpers/control/lazy_map.js";
import {areRangesOverlapping} from "~/shared/helpers/geometry/are_ranges_overlapping.open_source.js";
import {mapIterable} from "~/shared/helpers/iterable/map_iterable.open_source.js";
import {MaybePromise} from "~/shared/helpers/types/maybe_promise.open_source.js";
import {DocumentCommentThreadId, DocumentId} from "~/shared/id/types/id_types.open_source.js";
import {MessageDraft, MessageDraftWithFiles} from "~/shared/messaging/message_draft_schema.js";
import {OptimisticMessageModel} from "~/shared/messaging/message_model.js";
import {MessageContentPayloadParent} from "~/shared/messaging/message_schema.js";
import {Schema} from "~/shared/schema/schema.open_source.js";
import {ServerSynchronizationCheckpoint} from "~/shared/web_socket/server_synchronization_checkpoint.js";
import {WebSocketPongMessage} from "~/shared/web_socket/web_socket_schema.js";

// NOTE(calebmer): You are not allowed to use the `<Box>` component in this
// file. It is critical for scroll performance that this component renders
// fast. Manually use the `sprinkles()` function instead. This reduces the
// number of fibers React needs to render. One day we'd like to introduce
// transformations that automatically inline `<Box>` components and
// `sprinkles()` functions at which point using `<Box>` would not make a
// performance difference.
//
// Assign a variable to null so you get a TypeScript error if you try to
// use `<Box>`.
//
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const Box = null;

const DocumentCommentThreadListViewForwardRef = forwardRef(DocumentCommentThreadListView);
export {DocumentCommentThreadListViewForwardRef as DocumentCommentThreadListView};

export type DocumentCommentThreadListViewRef = {
    getHeight(): number;
    getContentHeight(): number;
    getScrollOffset(): number;
    setScrollOffset(scrollOffset: number, options?: {behavior?: "instant" | "smooth"}): void;

    /**
     * Jump to the provided comment. If the comment thread or comment do not exist this
     * will do nothing.
     */
    jumpToCommentRange(options: JumpToMessageRangeOptions<DocumentCommentRoomKey>): void;
};

type DocumentCommentThreadTreeItem =
    | DocumentCommentThreadTreeCommentThreadHeaderItem
    | DocumentCommentThreadTreeCommentItem
    | DocumentCommentThreadTreeCommentInputItem;

type DocumentCommentThreadTreeCommentThreadHeaderItem = {
    readonly type: "DocumentCommentThreadHeader";
    readonly commentThread: DocumentCommentThreadModel;
    readonly comments: MessageList<DocumentCommentModel>;
    // The index of the `DocumentCommentInput` item in our `VirtualizedTree`.
    readonly commentInputItemIndex: number;
};

type DocumentCommentThreadTreeCommentItem = {
    readonly type: "DocumentComment";
    readonly commentThread: DocumentCommentThreadModel;
    readonly comments: MessageList<DocumentCommentModel>;
    // The index of `commentItem` in `comments`.
    readonly commentItemIndex: number;
    readonly commentItem: MessageListItem<DocumentCommentModel>;
    // The index of the `DocumentCommentInput` item in our `VirtualizedTree`.
    readonly commentInputItemIndex: number;
};

type DocumentCommentThreadTreeCommentInputItem = {
    readonly type: "DocumentCommentInput";
    readonly commentThread: DocumentCommentThreadModel;
    readonly comments: MessageList<DocumentCommentModel>;
    readonly messageDraft: MessageDraft | MessageDraftWithFiles;
    // The index of the `DocumentCommentThreadHeader` item in our `VirtualizedTree`.
    readonly headerItemIndex: number;
};

type DocumentCommentThreadTree = VirtualizedTree<
    DocumentCommentThreadId,
    {
        readonly commentThread: DocumentCommentThreadModel;
        readonly comments: MessageList<DocumentCommentModel>;
        readonly messageDraft: MessageDraft | MessageDraftWithFiles;
    },
    DocumentCommentThreadTreeItem
>;

function createEmptyDocumentCommentThreadTree(): DocumentCommentThreadTree {
    return VirtualizedTree.new({
        getNodeKey: node => node.commentThread.id,
        getNodeItemCount: node => node.comments.getItemCount() + 2,
        getNodeItem: (node, index, startItemIndex): DocumentCommentThreadTreeItem => {
            if (index === 0) {
                return {
                    type: "DocumentCommentThreadHeader",
                    commentThread: node.commentThread,
                    comments: node.comments,
                    commentInputItemIndex: startItemIndex + node.comments.getItemCount() + 1,
                };
            }

            index -= 1;

            if (index >= 0 && index < node.comments.getItemCount()) {
                return {
                    type: "DocumentComment",
                    commentThread: node.commentThread,
                    comments: node.comments,
                    commentItemIndex: index,
                    commentItem: node.comments.getItem(index),
                    commentInputItemIndex: startItemIndex + node.comments.getItemCount() + 1,
                };
            }

            index -= node.comments.getItemCount();

            if (index === 0) {
                return {
                    type: "DocumentCommentInput",
                    commentThread: node.commentThread,
                    comments: node.comments,
                    messageDraft: node.messageDraft,
                    headerItemIndex: startItemIndex,
                };
            }

            throw new OutOfRangeError("Index out of bounds");
        },
    });
}

const ContentSnippetByCommentThreadIdSchema = Schema.map(
    Schema.id<DocumentCommentThreadId>(),
    UncheckedDocumentContentSchema,
);

const UnpersistedIsResolvedByCommentThreadIdSchema = Schema.map(
    Schema.id<DocumentCommentThreadId>(),
    Schema.boolean,
);

function DocumentCommentThreadListView(
    {
        documentId,
        content,
        onCommentThreadSnippetPress,
        initialCommentThreadResults,
        isConnected,
        procedures,
        subscribeToCommentThreadEvents,
        subscribeToPongs,
        unpersistedResolutionStateByCommentThreadId: allUnpersistedResolutionStateByCommentThreadId,
        withoutCommentThreadPreview = false,
        withCommentInputMobileMaxHeight = false,
        header,
        navigationBar,
        withSafeAreaInsetTop = false,
        pinnedCommentInputRef,
        onBeforePinnedCommentInputFocusFromReplyOrEditingChange,
        isNativeMobileTabBarHidden = false,
        backgroundSlopBottomIfPinnedCommentInput,
        isCommentThreadArchived,
        onArchiveCommentThread,
        onUnarchiveCommentThread,
    }: {
        documentId: DocumentId;
        content: DocumentContentWithReferences;
        onCommentThreadSnippetPress: Memo<(commentThreadId: DocumentCommentThreadId) => void>;

        /**
         * The initial comment threads loaded to populate this view. We will use this to
         * construct a `DocumentCommentThreadTree` class.
         */
        initialCommentThreadResults: ReadonlyArray<{
            checkpoint: ServerSynchronizationCheckpoint;
            commentThread: DocumentCommentThreadModel;
            comments: ReadonlyArray<DocumentCommentModel>;
            otherReferencedComments: ReadonlyArray<DocumentCommentModel>;
            optimisticComments: ReadonlyArray<OptimisticMessageModel>;
            messageDraft: MessageDraft | MessageDraftWithFiles;
        }>;

        // Realtime props that should come from `useDocumentContentEditorWebSocket()`.
        isConnected: boolean;
        procedures: MemoObject<DocumentContentEditorWebSocketClientProcedures>;
        subscribeToCommentThreadEvents: SubscribeToCommentThreadEventsFunction;
        subscribeToPongs: Memo<(subscriber: (message: WebSocketPongMessage) => void) => () => void>;
        unpersistedResolutionStateByCommentThreadId: ReadonlyMap<
            DocumentCommentThreadId,
            {readonly isResolved: boolean; readonly version: number}
        >;

        /**
         * If we should disable rendering of the comment thread preview. Used when
         * rendering a comment thread in document in mobile layouts since the document text
         * is displayed above.
         */
        withoutCommentThreadPreview?: boolean;

        /**
         * Whether we should use the mobile max height for comment inputs.
         */
        withCommentInputMobileMaxHeight?: boolean;

        /**
         * A header to render as the first item in the virtualized scroll view.
         */
        header?: Memo<{
            minHeight: RemLength | number;
            node: ReactNode;
        }>;

        /**
         * If you want to include a navigation bar in this list view you may pass in the
         * result of `useNavigationBar()` here and the virtualized scroll view will be
         * properly configured.
         */
        navigationBar?: NavigationBarResult;

        /**
         * Should we make room for top safe area? False by default. If you set the
         * `navigationBar` prop then it will mostly handle safe area for you.
         */
        withSafeAreaInsetTop?: boolean;

        /**
         * A ref to the pinned comment input if we have a pinned comment input.
         *
         * There's a pinned comment input when the comment thread list view is using a
         * mobile layout and there's only one comment thread.
         */
        pinnedCommentInputRef?: Ref<MessageInputRef>;

        /**
         * If we're about to focus our pinned comment input in response to the user asking
         * to reply to a comment or edit a comment then we call this function. You can stop
         * focusing by returning `preventDefault: true`.
         *
         * Useful for `<DocumentContentEditor>` where we need to expand the comment sidebar
         * before we can allow the user to write a comment.
         */
        onBeforePinnedCommentInputFocusFromReplyOrEditingChange?: () => {
            preventDefault: boolean;
        } | void;

        /**
         * Have we called `NativeMobileBridge.tabBar.hide()`? If true then we need to
         * handle safe area a bit differently.
         */
        isNativeMobileTabBarHidden?: boolean;

        /**
         * Add some background slop if there's a pinned comment input.
         *
         * This background slop is used to implement full-screenable comment threads on
         * mobile. When you open a comment thread in a document we start by showing you
         * just a preview. If you tap the comment input then the thread should expand to
         * take the full screen. Since animating `height` is expensive, we instead animate
         * `translateY`. So the comment thread is actually always the fullscreen size but
         * when collapsed we have offscreen slop.
         */
        backgroundSlopBottomIfPinnedCommentInput?: RemLength;

        /**
         * Is this comment thread archived?
         *
         * We should the inbox archival button if this property is provided (even if always
         * returns false).
         */
        isCommentThreadArchived?: Memo<(commentThreadId: DocumentCommentThreadId) => boolean>;

        /**
         * Archive an individual comment thread.
         */
        onArchiveCommentThread?: Memo<
            (commentThreadId: DocumentCommentThreadId) => MaybePromise<void>
        >;

        /**
         * Unarchive an individual comment thread.
         */
        onUnarchiveCommentThread?: Memo<
            (commentThreadId: DocumentCommentThreadId) => MaybePromise<void>
        >;
    },
    ref: Ref<DocumentCommentThreadListViewRef>,
) {
    const platform = usePlatform();
    const spacingScale = useSpacingScale();

    const viewRef = useRef<VirtualizedScrollViewRef>(null);

    const [tree, setTree, setTreeOptimistically] = useStateWithOptimisticUpdates(() => {
        let tree = createEmptyDocumentCommentThreadTree();

        for (const initialCommentThreadResult of initialCommentThreadResults) {
            let comments = MessageList.new<DocumentCommentModel>({
                checkpoint: initialCommentThreadResult.checkpoint,
                messageCount: initialCommentThreadResult.commentThread.commentCount,
            }).loadMessages({
                messageCount: initialCommentThreadResult.commentThread.commentCount,
                messages: initialCommentThreadResult.comments,
                otherReferencedMessages: initialCommentThreadResult.otherReferencedComments,
            });

            if (initialCommentThreadResult.optimisticComments.length > 0) {
                for (const optimisticComment of initialCommentThreadResult.optimisticComments) {
                    comments = comments.addOptimisticMessage(optimisticComment);
                }
            }

            tree = tree.insertNodesAtEnd([
                {
                    commentThread: initialCommentThreadResult.commentThread,
                    comments,
                    messageDraft: initialCommentThreadResult.messageDraft,
                },
            ]);
        }

        return tree;
    });

    // Stable list of all the `DocumentCommentThreadId`s in this list. It's important
    // that this is stable so we can use it as a dependency for a `useMemo()` on our
    // snippet cache.
    const commentThreadIds = useStableJsonValue(
        useMemo(() => {
            return Array.from(
                new Set(mapIterable(tree.iterateNodes(), node => node.commentThread.id)),
            ).sort();
        }, [tree]),
    );

    const collectCommentThreadSnippets = useMemo(
        () =>
            // Optimization: If we aren't rendering comment thread previews, don't collect
            // snippets.
            !withoutCommentThreadPreview
                ? createDocumentCommentThreadSnippetCollector(commentThreadIds)
                : () => new Map(),
        [commentThreadIds, withoutCommentThreadPreview],
    );

    const contentSnippetByCommentThreadId = useStableValue(
        ContentSnippetByCommentThreadIdSchema,
        useMemo(
            () => new Map(collectCommentThreadSnippets(content.doc)),
            [collectCommentThreadSnippets, content.doc],
        ),
    );

    const unpersistedIsResolvedByCommentThreadId = useStableValue(
        UnpersistedIsResolvedByCommentThreadIdSchema,
        useMemo(() => {
            const unpersistedIsResolvedByCommentThreadId = new Map<
                DocumentCommentThreadId,
                boolean
            >();

            for (const commentThreadId of commentThreadIds) {
                const resolutionState =
                    allUnpersistedResolutionStateByCommentThreadId.get(commentThreadId);
                if (!resolutionState) continue;
                unpersistedIsResolvedByCommentThreadId.set(
                    commentThreadId,
                    resolutionState.isResolved,
                );
            }

            return unpersistedIsResolvedByCommentThreadId;
        }, [allUnpersistedResolutionStateByCommentThreadId, commentThreadIds]),
    );

    // Always pin the comment input to the bottom of the list view of a single comment
    // thread.
    const isSingleCommentThreadWithPinnedCommentInput = tree.getNodeCount() === 1;
    const hasNavigationBar = !!navigationBar?.navigationBar;

    const isLoadingRef = useRef(false);
    const setErrorState = useErrorState();

    const tryLoadingMoreData = useEvent(
        (
            renderedRange: {startIndex: number; endIndex: number} | null,
        ): {isLoading: false} | {isLoading: true; promise: Promise<void>} => {
            // If we're already loading, don't try to load more comments.
            if (isLoadingRef.current) return {isLoading: false};

            const result = actuallyTryLoadingMoreData(renderedRange);
            if (!result.isLoading) return result;

            isLoadingRef.current = true;
            result.promise.then(
                () => {
                    isLoadingRef.current = false;
                },
                error => {
                    isLoadingRef.current = false;
                    setErrorState(error);
                },
            );
            return result;

            // Try to load more data without worrying about managing coordination with
            // `isLoadingRef` or error handling.
            function actuallyTryLoadingMoreData(
                renderedRange: {startIndex: number; endIndex: number} | null,
            ): {isLoading: false} | {isLoading: true; promise: Promise<void>} {
                if (!renderedRange) return {isLoading: false};

                // Adjust rendered range if we have a header item so the indexes are relative to
                // our `tree` data structure.
                if (header) {
                    renderedRange = {
                        startIndex: Math.max(0, renderedRange.startIndex - 1),
                        endIndex: Math.max(0, renderedRange.endIndex - 1),
                    };
                    if (
                        renderedRange.startIndex >= tree.getItemCount() ||
                        renderedRange.endIndex >= tree.getItemCount()
                    ) {
                        return {isLoading: false};
                    }
                }

                const view = assertExists(viewRef.current);

                let nextIndex = renderedRange.startIndex;
                while (nextIndex <= renderedRange.endIndex) {
                    const nodeResult = tree.getNodeByItemIndexIfExists(nextIndex);
                    if (!nodeResult) break;
                    const {node, startItemIndex} = nodeResult;
                    const endItemIndex = startItemIndex + tree.getNodeItemCount(node);
                    nextIndex = endItemIndex;

                    // There are no comments in this thread, nothing to load here.
                    if (node.comments.getItemCount() === 0) continue;

                    const commentsStartItemIndex = startItemIndex + 1;
                    const commentsEndItemIndex = endItemIndex - 2;

                    // We are rendering the thread but we are not rendering any of the threads
                    // comments. Don't load anything new.
                    if (
                        !areRangesOverlapping(
                            commentsStartItemIndex,
                            commentsEndItemIndex,
                            renderedRange.startIndex,
                            renderedRange.endIndex,
                        )
                    ) {
                        continue;
                    }

                    const renderedCommentsStartItemIndex =
                        Math.max(commentsStartItemIndex, renderedRange.startIndex) -
                        commentsStartItemIndex;
                    const renderedCommentsEndItemIndex =
                        Math.min(commentsEndItemIndex, renderedRange.endIndex) -
                        commentsStartItemIndex;

                    const result = tryLoadingMessages({
                        viewHeight: view.getHeight(),
                        messages: node.comments,
                        range: {
                            startIndex: renderedCommentsStartItemIndex,
                            endIndex: renderedCommentsEndItemIndex,
                        },
                        loadFromStart: async ({afterMessageIndex, beforeMessageIndex, limit}) => {
                            const {commentCount, comments, otherReferencedComments} =
                                await procedures.getCommentsFromStart({
                                    commentThreadId: node.commentThread.id,
                                    afterCommentIndex: afterMessageIndex,
                                    beforeCommentIndex: beforeMessageIndex,
                                    limit,
                                });
                            return {
                                messageCount: commentCount,
                                messages: comments,
                                otherReferencedMessages: otherReferencedComments,
                            };
                        },
                        loadFromEnd: async ({afterMessageIndex, beforeMessageIndex, limit}) => {
                            const {commentCount, comments, otherReferencedComments} =
                                await procedures.getCommentsFromStart({
                                    commentThreadId: node.commentThread.id,
                                    afterCommentIndex: afterMessageIndex,
                                    beforeCommentIndex: beforeMessageIndex,
                                    limit,
                                });
                            return {
                                messageCount: commentCount,
                                messages: comments,
                                otherReferencedMessages: otherReferencedComments,
                            };
                        },
                    });

                    if (result.isLoading) {
                        return {
                            isLoading: true,
                            promise: result.promise.then(result => {
                                setTree(tree =>
                                    tree.updateNode(node.commentThread.id, node => ({
                                        ...node,
                                        comments: node.comments.loadMessages(result),
                                    })),
                                );
                            }),
                        };
                    }
                }

                return {isLoading: false};
            }
        },
    );

    // Whenever our list data changes, try loading more comments. In case our rendered
    // range stayed the same but we see some some unloaded comments.
    //
    // This effect should also fire when `tryLoadingMoreData()` completes in case it
    // didn't fully load the list.
    useEffect(() => {
        // eslint-disable-next-line @typescript-eslint/no-unused-expressions
        tree;

        const view = assertExists(viewRef.current);
        tryLoadingMoreData(view.getRenderedRange());
    }, [tree, tryLoadingMoreData]);

    // Manages the editable message.
    //
    // This is at the list level because:
    //
    // 1. If a message is scrolled out of the virtualization window we still want it to
    //    be editable so it shouldn't lose state.
    //
    // 2. We want only one message to be editable at a time.
    const {messageEditing, modals} = useMessageEditing<DocumentCommentRoomKey>({
        messageNoun: "comment",
        onUpdateMessageContent: async ({
            roomKey,
            messageIndex: commentIndex,
            contentVersion,
            steps,
        }) => {
            const [, commentThreadId] = decodeDocumentCommentRoomKey(roomKey);

            await procedures.updateCommentContent({
                commentThreadId,
                commentIndex,
                contentVersion,
                steps,
            });
        },
        onDeleteMessage: async ({roomKey, messageIndex: commentIndex}) => {
            const [, commentThreadId] = decodeDocumentCommentRoomKey(roomKey);

            await procedures.deleteComment({
                commentThreadId,
                commentIndex,
            });
        },
    });

    // Manages which comment `<MessageInput>` is currently replying to.
    const [inputParentByCommentThreadId, setInputParentByCommentThreadId] = useState<
        ReadonlyMap<DocumentCommentThreadId, MessageContentPayloadParent>
    >(new Map());

    // Stable per-comment-thread callbacks so we don't hand a fresh closure to each
    // `<MessageInput>` on every render that rebuilds our items, which would re-run the
    // input's effects (re-applying the comment draft, for example).
    const onInputParentChangeByCommentThreadId = useConstant(
        () =>
            new LazyMap<
                DocumentCommentThreadId,
                (parent: MessageContentPayloadParent | null) => void
            >(commentThreadId => parent => {
                setInputParentByCommentThreadId(inputParentByCommentThreadId => {
                    const newInputParentByCommentThreadId = new Map(inputParentByCommentThreadId);

                    if (parent) {
                        newInputParentByCommentThreadId.set(commentThreadId, parent);
                    } else {
                        newInputParentByCommentThreadId.delete(commentThreadId);
                    }

                    return newInputParentByCommentThreadId;
                });
            }),
    );

    const onInputParentClearByCommentThreadId = useConstant(
        () =>
            new LazyMap<DocumentCommentThreadId, () => void>(commentThreadId => () => {
                onInputParentChangeByCommentThreadId.get(commentThreadId)(null);
            }),
    );

    const {jumpState, jumpToMessageRange} = useJumpToMessageRange<DocumentCommentRoomKey>({
        viewRef,
        tryLoadingMoreData,
        scrollToIndexForMessageIndex: (roomKey, index) => {
            const [, commentThreadId] = decodeDocumentCommentRoomKey(roomKey);

            const nodeResult = tree.getNodeByKeyIfExists(commentThreadId);
            if (!nodeResult) return null;
            const {node, startItemIndex} = nodeResult;

            // Make sure the comment index is valid.
            if (index < 0 || index >= node.comments.getMessageCountIncludingOptimisticMessages()) {
                return null;
            }

            return startItemIndex + 1 + index;
        },
    });

    useImperativeHandle(
        ref,
        () => ({
            getHeight: () => assertExists(viewRef.current).getHeight(),
            getContentHeight: () => assertExists(viewRef.current).getContentHeight(),
            getScrollOffset: () => assertExists(viewRef.current).getScrollOffset(),
            setScrollOffset: (...args) => assertExists(viewRef.current).setScrollOffset(...args),
            jumpToCommentRange: jumpToMessageRange,
        }),
        [jumpToMessageRange],
    );

    // Make sure the bottom of the scroll view stays visible when the keyboard opens
    // and closes.
    useScrollToAvoidBottomBarsAndMobileKeyboard(viewRef, {
        getAnchorPosition: useEvent(oldVisibleRect => {
            // NOTE(calebmer, 2024-07-16): We used to anchor chat view scroll to the message
            // the user was replying to or editing. However, in practice this felt janky to me.
            // Scrolling wasn't predictable when swiping to reply to a message! I think
            // consistency is likely the better user experience here.
            //
            // To look at the old message anchoring code, git blame this comment to see the
            // commit where I remove it.

            return {top: oldVisibleRect.bottom, height: 0, isPinned: true};
        }),
        // Don't consider the background slop as valid scrollable area...
        scrollableInsetBottom: isSingleCommentThreadWithPinnedCommentInput
            ? backgroundSlopBottomIfPinnedCommentInput
            : undefined,
    });

    const fileAttachmentTarget = useMemo(
        (): FileAttachmentTarget => ({
            type: "DocumentComments",
            documentId,
        }),
        [documentId],
    );

    const inputRefByCommentThreadId = useConstant(
        () =>
            new LazyMap<DocumentCommentThreadId, RefObject<MessageInputRef | null>>(() => ({
                current: null,
            })),
    );

    const mergedPinnedCommentInputRef = useMergedRefs(
        isSingleCommentThreadWithPinnedCommentInput
            ? inputRefByCommentThreadId.get(tree.getItem(tree.getItemCount() - 1).commentThread.id)
            : null,
        isSingleCommentThreadWithPinnedCommentInput ? (pinnedCommentInputRef ?? null) : null,
    );

    const handleSetMessageReaction: Memo<OnSetMessageReactionFunction<DocumentCommentRoomKey>> =
        useCallback(
            async (roomKey, {messageIndex, ...input}) => {
                const [, commentThreadId] = decodeDocumentCommentRoomKey(roomKey);

                await procedures.setCommentReaction({
                    commentThreadId,
                    commentIndex: messageIndex,
                    ...input,
                });
            },
            [procedures],
        );

    const handleDeleteMessageReaction: Memo<
        OnDeleteMessageReactionFunction<DocumentCommentRoomKey>
    > = useCallback(
        async (roomKey, {messageIndex, ...input}) => {
            const [, commentThreadId] = decodeDocumentCommentRoomKey(roomKey);

            await procedures.deleteCommentReaction({
                commentThreadId,
                commentIndex: messageIndex,
                ...input,
            });
        },
        [procedures],
    );

    const handleUpdateMessagesOptimistically: Memo<
        OnUpdateMessagesOptimisticallyFunction<DocumentCommentRoomKey, DocumentCommentModel>
    > = useCallback(
        (roomKey, promise, update) => {
            const [, commentThreadId] = decodeDocumentCommentRoomKey(roomKey);

            setTreeOptimistically(promise, (tree, promiseValue) => {
                return tree.updateNode(commentThreadId, node => {
                    const newComments = update(node.comments, promiseValue);
                    if (newComments === node.comments) return node;
                    return {...node, comments: newComments};
                });
            });
        },
        [setTreeOptimistically],
    );

    const handlePutMessageApprovalDecisions: Memo<
        OnPutMessageApprovalDecisionsFunction<DocumentCommentRoomKey>
    > = useCallback(
        async (roomKey, input) => {
            const [, commentThreadId] = decodeDocumentCommentRoomKey(roomKey);

            await procedures.putCommentApprovalDecisions({
                commentThreadId,
                commentIndex: input.messageIndex,
                payload: input.payload,
            });
        },
        [procedures],
    );

    const renderItem: VirtualizedScrollViewRenderItem = useCallback(
        index => {
            const actualIndex = index;

            if (header) {
                if (index === 0) {
                    return {
                        key: "Header",
                        minHeight: header.minHeight,
                        node: header.node,
                    };
                }

                // Adjust index so it's relative to `tree` data structure for the rest of this
                // function.
                index -= 1;
            }

            const item = tree.getItem(index);
            switch (item.type) {
                case "DocumentCommentThreadHeader": {
                    // All comment threads should be in the same document.
                    assert(item.commentThread.documentId === documentId);

                    // If we have a navigation bar, then use less top padding since when the navigation
                    // bar isn't opaque it visually adds a lot of padding to the top of the screen
                    // already.
                    //
                    // The `paddingTop` of `2` also happens to align with the `<TaskStatusButton>`
                    // placement on mobile.
                    const paddingTop: Spacing = hasNavigationBar
                        ? "3"
                        : documentCommentThreadHeaderPaddingY;

                    const minHeight = addRemLengths(
                        index !== 0 ? documentCommentThreadHeaderPaddingY : paddingTop,
                        !withoutCommentThreadPreview
                            ? documentCommentThreadHeaderMinHeightWithoutPaddingTop
                            : documentCommentThreadActionsHeight,
                    );

                    return {
                        key: `DocumentCommentThreadHeader:${item.commentThread.id}`,
                        minHeight,
                        renderAdditionalItemIndexes: !isSingleCommentThreadWithPinnedCommentInput
                            ? [item.commentInputItemIndex]
                            : [],
                        node: (
                            <div
                                className={sprinkles({
                                    position: "relative",
                                    display: "flex",
                                    flexDirection: "column",
                                    alignItems: "center",
                                    paddingTop:
                                        withSafeAreaInsetTop && actualIndex === 0
                                            ? "safe-area-inset"
                                            : undefined,
                                })}
                            >
                                {index === 0 && !isSingleCommentThreadWithPinnedCommentInput && (
                                    <div
                                        className={sprinkles({
                                            position: "relative",
                                            height: "0",
                                            width: "full",
                                            maxWidth: contentStyles.contentMaxWidth,
                                            paddingX: screenPaddingX,
                                        })}
                                    >
                                        <div
                                            className={sprinkles({
                                                position: "absolute",
                                                top: "0",
                                                left: screenPaddingX,
                                                right: screenPaddingX,
                                                height: "border",
                                                backgroundColor: "grey-5",
                                            })}
                                        />
                                    </div>
                                )}
                                {index !== 0 && (
                                    <div
                                        className={sprinkles({
                                            position: "relative",
                                            width: "full",
                                            height: documentCommentThreadHeaderPaddingY,
                                            maxWidth: contentStyles.contentMaxWidth,
                                            paddingX: screenPaddingX,
                                        })}
                                    >
                                        <div
                                            className={sprinkles({
                                                position: "absolute",
                                                left: screenPaddingX,
                                                right: screenPaddingX,
                                                top: "0",
                                                height: "border",
                                                backgroundColor: "grey-5",
                                            })}
                                        />
                                    </div>
                                )}
                                <div
                                    className={sprinkles({
                                        position: "relative",
                                        width: "full",
                                        maxWidth: contentStyles.contentMaxWidth,
                                        paddingX: screenPaddingX,
                                        paddingTop: index !== 0 ? "0" : paddingTop,
                                        paddingBottom: documentCommentThreadHeaderPaddingY,
                                        overflow: "hidden",
                                    })}
                                >
                                    <DocumentCommentThreadHeader
                                        commentThread={item.commentThread}
                                        unpersistedIsResolved={
                                            unpersistedIsResolvedByCommentThreadId.get(
                                                item.commentThread.id,
                                            ) ?? null
                                        }
                                        resolveCommentThread={async () => {
                                            await procedures.resolveCommentThread({
                                                commentThreadId: item.commentThread.id,
                                            });
                                        }}
                                        unresolveCommentThread={async () => {
                                            await procedures.unresolveCommentThread({
                                                commentThreadId: item.commentThread.id,
                                            });
                                        }}
                                        withoutCommentThreadPreview={withoutCommentThreadPreview}
                                        contentSnippet={
                                            contentSnippetByCommentThreadId.get(
                                                item.commentThread.id,
                                            ) ?? null
                                        }
                                        contentReferences={content.references}
                                        onCommentThreadSnippetPress={onCommentThreadSnippetPress}
                                        isCommentThreadArchived={isCommentThreadArchived}
                                        onArchiveCommentThread={onArchiveCommentThread}
                                        onUnarchiveCommentThread={onUnarchiveCommentThread}
                                    />
                                </div>
                            </div>
                        ),
                    };
                }

                case "DocumentComment": {
                    const renderedItem = renderMessageListItem<
                        DocumentCommentRoomKey,
                        DocumentCommentModel
                    >({
                        spacingScale,
                        messageNoun: "comment",
                        messages: item.comments,
                        groupKey: item.commentThread.id,
                        index: item.commentItemIndex,
                        item: item.commentItem,
                        fileAttachmentTarget,
                        randomSeedForShimmer: item.commentThread.id,
                        messageEditing,
                        jumpState:
                            item.commentItem.message &&
                            !item.commentItem.message.isOptimistic &&
                            jumpState &&
                            jumpState.options.startIndex <= item.commentItem.message.index &&
                            item.commentItem.message.index <= jumpState.options.endIndex
                                ? jumpState.messages[
                                      item.commentItem.message.index - jumpState.options.startIndex
                                  ]!
                                : null,
                        onJumpToMessageRange: jumpToMessageRange,
                        onReplyToMessage: comment => {
                            setInputParentByCommentThreadId(inputParentByCommentThreadId => {
                                const newInputParentByCommentThreadId = new Map(
                                    inputParentByCommentThreadId,
                                );
                                newInputParentByCommentThreadId.set(comment.commentThreadId, {
                                    type: "Message",
                                    index: comment.index,
                                });
                                return newInputParentByCommentThreadId;
                            });
                        },
                        onDeleteMessage: async message => {
                            await procedures.deleteComment({
                                commentThreadId: item.commentThread.id,
                                commentIndex: message.index,
                            });
                        },
                        getMessageUrl: commentIndex => {
                            return new URL(
                                `/doc/${documentId}?thread=${item.commentThread.id}&comment=${commentIndex}`,
                                window.location.href,
                            );
                        },
                        onSetMessageReaction: handleSetMessageReaction,
                        onDeleteMessageReaction: handleDeleteMessageReaction,
                        onUpdateMessagesOptimistically: handleUpdateMessagesOptimistically,
                        onPutMessageApprovalDecisions: handlePutMessageApprovalDecisions,
                        approvalSessionNoun: "thread",
                        shouldAddMarginBottom:
                            isSingleCommentThreadWithPinnedCommentInput &&
                            // -2 instead of -1 since when `isSingleCommentThreadWithPinnedCommentInput` is
                            // true we don't actually render the final comment input item in `tree`.
                            //
                            // We intentionally use `--keyboard-safe-area-inset-bottom` here for comment
                            // threads rendered on top of a document since the native tab bar is hidden in this
                            // case.
                            index === tree.getItemCount() - 2
                                ? isNativeMobileTabBarHidden
                                    ? backgroundSlopBottomIfPinnedCommentInput
                                        ? `calc(var(--keyboard-safe-area-inset-bottom, 0px) - var(--window-safe-area-inset-bottom, 0px) + ${backgroundSlopBottomIfPinnedCommentInput})`
                                        : "calc(var(--keyboard-safe-area-inset-bottom, 0px) - var(--window-safe-area-inset-bottom, 0px))"
                                    : backgroundSlopBottomIfPinnedCommentInput
                                      ? `calc(${messagingViewMarginBottomCalcExpression} + ${backgroundSlopBottomIfPinnedCommentInput})`
                                      : messagingViewMarginBottom
                                : undefined,
                        render: node => (
                            <div
                                className={sprinkles({
                                    display: "flex",
                                    justifyContent: "center",
                                })}
                            >
                                <div
                                    className={sprinkles({
                                        width: "full",
                                        maxWidth: contentStyles.contentMaxWidth,
                                    })}
                                >
                                    {node}
                                </div>
                            </div>
                        ),
                    });

                    return {
                        ...renderedItem,
                        renderAdditionalItemIndexes: !isSingleCommentThreadWithPinnedCommentInput
                            ? [
                                  ...(renderedItem.renderAdditionalItemIndexes ?? []),
                                  item.commentInputItemIndex,
                              ]
                            : renderedItem.renderAdditionalItemIndexes,
                    };
                }

                // The document comment thread input item sticks to the bottom of the screen while
                // the associated comment thread is visible. Whenever any item in the comment
                // thread is rendered we also additionally render this input
                // (`renderAdditionalItemIndexes`) so that virtualization doesn't remove it.
                //
                // We create a `<div>` that spans the bottom of the document preview to the end of
                // the entire thread. This is the range in which our comment input will be sticky.
                // We create a second `<div>` of the same range but rendering the full thread width
                // border. The comment input is shaped so that when we reach the bottom of the page
                // the full width border will slide underneath it. Creating the effect of while
                // scrolling the comment input is a layer on top of the thread and when at the
                // bottom of the thread the comment input is inline.
                //
                // IMPORTANT: This code is very similar to how we render `<PostCommentInput>` in
                // `<PostListView>`! If you are updating this code you also probably want to update
                // `<PostListView>`. We don't know what a good abstraction here is so following the
                // advice "no abstraction is better than the wrong abstraction".
                case "DocumentCommentInput": {
                    const inputParent =
                        inputParentByCommentThreadId.get(item.commentThread.id) ?? null;

                    // This is defined out here so that it doesn't re-rerender every time the
                    // `render()` function is called since it's referentially stable.
                    const inputNode = (
                        <DocumentCommentInput
                            isStickyPositioned={true}
                            inputRef={inputRefByCommentThreadId.get(item.commentThread.id)}
                            viewRef={viewRef}
                            commentThread={item.commentThread}
                            comments={item.comments}
                            messageDraft={item.messageDraft}
                            fileAttachmentTarget={fileAttachmentTarget}
                            onUpdateCommentThread={update =>
                                setTree(tree =>
                                    tree.updateNode(item.commentThread.id, node => {
                                        const {
                                            commentThread: newCommentThread,
                                            comments: newComments,
                                        } = update(node);

                                        if (
                                            newCommentThread === node.commentThread &&
                                            newComments === node.comments
                                        ) {
                                            return node;
                                        }

                                        return {
                                            ...node,
                                            commentThread: newCommentThread,
                                            comments: newComments,
                                        };
                                    }),
                                )
                            }
                            messageEditing={messageEditing}
                            parent={inputParent}
                            onParentClear={onInputParentClearByCommentThreadId.get(
                                item.commentThread.id,
                            )}
                            onParentChange={onInputParentChangeByCommentThreadId.get(
                                item.commentThread.id,
                            )}
                            onJumpToCommentRange={jumpToMessageRange}
                            onDeleteComment={async commentIndex => {
                                await procedures.deleteComment({
                                    commentThreadId: item.commentThread.id,
                                    commentIndex,
                                });
                            }}
                            isConnected={isConnected}
                            procedures={procedures}
                            subscribeToCommentThreadEvents={subscribeToCommentThreadEvents}
                            subscribeToPongs={subscribeToPongs}
                            withMobileMaxHeight={withCommentInputMobileMaxHeight}
                        />
                    );

                    return {
                        key: `DocumentCommentInput:${item.commentThread.id}`,
                        minHeight: messageInputMinHeightPx[platform][spacingScale],
                        withManualLayout: true,
                        render: ({
                            ref,
                            offset,
                            height,
                            shouldRenderWithRelativePositioning,
                            getPositionByIndex,
                        }) => {
                            const headerPosition = getPositionByIndex(
                                item.headerItemIndex + (header ? 1 : 0),
                            );

                            const headerOffsetEnd =
                                headerPosition.offset + headerPosition.height - 1;

                            return (
                                <div
                                    style={{
                                        pointerEvents: "none",
                                        display: "flex",
                                        justifyContent: "center",
                                        alignItems: "flex-end",
                                        zIndex: "20",
                                        ...(!shouldRenderWithRelativePositioning
                                            ? {
                                                  position: "absolute",
                                                  top: headerOffsetEnd,
                                                  left: "0",
                                                  right: "0",
                                                  height: offset - headerOffsetEnd + height,
                                              }
                                            : {
                                                  position: "relative",
                                              }),
                                    }}
                                >
                                    <div
                                        ref={ref}
                                        style={{
                                            ...(!shouldRenderWithRelativePositioning && {
                                                position: "sticky",
                                                bottom: "0",
                                            }),
                                        }}
                                        className={sprinkles({
                                            width: "full",
                                            display: "flex",
                                            justifyContent: "center",
                                        })}
                                    >
                                        <div
                                            className={sprinkles({
                                                width: "full",
                                                maxWidth: contentStyles.contentMaxWidth,
                                                position: "relative",
                                                pointerEvents: "auto",
                                            })}
                                        >
                                            {inputNode}
                                        </div>
                                    </div>
                                </div>
                            );
                        },
                    };
                }
                default:
                    throw exhaustive(item);
            }
        },
        [
            header,
            tree,
            documentId,
            hasNavigationBar,
            withoutCommentThreadPreview,
            isSingleCommentThreadWithPinnedCommentInput,
            withSafeAreaInsetTop,
            unpersistedIsResolvedByCommentThreadId,
            contentSnippetByCommentThreadId,
            content.references,
            onCommentThreadSnippetPress,
            isCommentThreadArchived,
            onArchiveCommentThread,
            onUnarchiveCommentThread,
            procedures,
            spacingScale,
            fileAttachmentTarget,
            messageEditing,
            jumpState,
            jumpToMessageRange,
            handleSetMessageReaction,
            handleDeleteMessageReaction,
            handleUpdateMessagesOptimistically,
            handlePutMessageApprovalDecisions,
            isNativeMobileTabBarHidden,
            backgroundSlopBottomIfPinnedCommentInput,
            inputParentByCommentThreadId,
            inputRefByCommentThreadId,
            isConnected,
            subscribeToCommentThreadEvents,
            subscribeToPongs,
            withCommentInputMobileMaxHeight,
            platform,
            setTree,
            onInputParentChangeByCommentThreadId,
            onInputParentClearByCommentThreadId,
        ],
    );

    return (
        <>
            {modals}
            <div
                data-testid="DocumentCommentThreadListView"
                className={sprinkles({
                    flexGrow: "1",
                    width: "full",
                    height: "full",
                    overflow: "hidden",
                    position: "relative",
                    zIndex: "0",
                    display: "flex",
                    flexDirection: "column",
                })}
            >
                {withSafeAreaInsetTop && !navigationBar?.navigationBar && (
                    // Only render a safe area cover if we don't have a navigation bar. Otherwise the
                    // navigation bar acts as our safe area cover.
                    <div
                        className={sprinkles({
                            position: "absolute",
                            top: "0",
                            left: "0",
                            right: "0",
                            height: "safe-area-inset-top",
                            zIndex: "10",
                            backgroundColor: "grey-0",
                        })}
                    />
                )}
                <VirtualizedScrollView
                    ref={viewRef}
                    elementRef={navigationBar?.scrollViewRef}
                    scrollbarInsetTop={
                        navigationBar?.scrollbarInsetTop ??
                        (withSafeAreaInsetTop ? safeAreaOnlyScrollbarInsetTop : undefined)
                    }
                    scrollbarInsetBottom={
                        isSingleCommentThreadWithPinnedCommentInput
                            ? backgroundSlopBottomIfPinnedCommentInput
                            : undefined
                    }
                    bufferedItemHeight={bufferedMessageViewHeight}
                    itemCount={
                        (header ? 1 : 0) +
                        tree.getItemCount() -
                        // Don't render the comment input (which should be the last item) if we are pinning
                        // the comment input to the bottom of the view.
                        (isSingleCommentThreadWithPinnedCommentInput ? 1 : 0)
                    }
                    renderItem={renderItem}
                    onRenderedRangeChange={tryLoadingMoreData}
                    extraChildren={
                        <>
                            {navigationBar?.navigationBar}
                            <MessagingViewPointerToolbar<
                                DocumentCommentRoomKey,
                                DocumentCommentModel
                            >
                                viewRef={viewRef}
                                messageNoun="comment"
                                getMessagesByRoomKey={useCallback(
                                    roomKey => {
                                        const [, commentThreadId] =
                                            decodePossiblyDocumentCommentRoomKey(roomKey);

                                        return (
                                            tree.getNodeByKeyIfExists(
                                                // @ts-expect-error: It's fine to call this getter with a
                                                // string type. If the string isn't a
                                                // `DocumentCommentThreadId` then we return null.
                                                commentThreadId,
                                            )?.node.comments ?? null
                                        );
                                    },
                                    [tree],
                                )}
                                onReplyToMessagesRange={(roomKey, parent) => {
                                    const [, commentThreadId] =
                                        decodeDocumentCommentRoomKey(roomKey);

                                    setInputParentByCommentThreadId(inputParentById => {
                                        const newInputParentById = new Map(inputParentById);
                                        newInputParentById.set(commentThreadId, parent);
                                        return newInputParentById;
                                    });
                                }}
                                onSetMessageReaction={handleSetMessageReaction}
                                onDeleteMessageReaction={handleDeleteMessageReaction}
                                onUpdateMessagesOptimistically={handleUpdateMessagesOptimistically}
                            />
                        </>
                    }
                />
                {isSingleCommentThreadWithPinnedCommentInput &&
                    (() => {
                        const item = tree.getItem(tree.getItemCount() - 1);
                        assert(item.type === "DocumentCommentInput");

                        const inputParent =
                            inputParentByCommentThreadId.get(item.commentThread.id) ?? null;

                        return (
                            <DocumentCommentInput
                                isStickyPositioned={false}
                                inputRef={mergedPinnedCommentInputRef}
                                viewRef={viewRef}
                                commentThread={item.commentThread}
                                comments={item.comments}
                                messageDraft={item.messageDraft}
                                fileAttachmentTarget={fileAttachmentTarget}
                                onUpdateCommentThread={update =>
                                    setTree(tree =>
                                        tree.updateNode(item.commentThread.id, node => {
                                            const {
                                                commentThread: newCommentThread,
                                                comments: newComments,
                                            } = update(node);

                                            if (
                                                newCommentThread === node.commentThread &&
                                                newComments === node.comments
                                            ) {
                                                return node;
                                            }

                                            return {
                                                ...node,
                                                commentThread: newCommentThread,
                                                comments: newComments,
                                            };
                                        }),
                                    )
                                }
                                messageEditing={messageEditing}
                                parent={inputParent}
                                onParentClear={onInputParentClearByCommentThreadId.get(
                                    item.commentThread.id,
                                )}
                                onParentChange={onInputParentChangeByCommentThreadId.get(
                                    item.commentThread.id,
                                )}
                                onJumpToCommentRange={jumpToMessageRange}
                                onDeleteComment={async commentIndex => {
                                    await procedures.deleteComment({
                                        commentThreadId: item.commentThread.id,
                                        commentIndex,
                                    });
                                }}
                                isConnected={isConnected}
                                procedures={procedures}
                                subscribeToCommentThreadEvents={subscribeToCommentThreadEvents}
                                subscribeToPongs={subscribeToPongs}
                                withMobileMaxHeight={withCommentInputMobileMaxHeight}
                                onBeforeFocusFromReplyOrEditingChange={
                                    onBeforePinnedCommentInputFocusFromReplyOrEditingChange
                                }
                            />
                        );
                    })()}
            </div>
        </>
    );
}
