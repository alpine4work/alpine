import {
    Memo,
    MutableRefObject,
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
import {MessageInputRef} from "~/client/content/messaging/message_input_base.js";
import {useMessagingViewDropTarget} from "~/client/content/messaging/use_messaging_view_drop_target.js";
import {safeAreaOnlyScrollbarInsetTop} from "~/client/design/scrollbar.js";
import {useScrollToAvoidBottomBarsAndMobileKeyboard} from "~/client/design/use_scroll_to_avoid_bottom_bars_and_mobile_keyboard.js";
import {DocumentCommentInput} from "~/client/documents/internal/document_comment_input.js";
import {DocumentCommentThreadHeader} from "~/client/documents/internal/document_comment_thread_header.js";
import {DocumentContentEditorWebSocketClientProcedures} from "~/client/documents/internal/document_content_editor_web_socket_client.js";
import {SubscribeToCommentThreadEventsFunction} from "~/client/documents/use_document_content_editor_web_socket.js";
import {useConstant} from "~/client/helpers/lifecycle/use_constant.js";
import {useEvent} from "~/client/helpers/lifecycle/use_event.js";
import {useMergedRefs} from "~/client/helpers/refs/use_merged_refs.js";
import {MemoObject} from "~/client/helpers/types/memo_object.js";
import {useErrorState} from "~/client/helpers/use_error_state.js";
import {useStableJsonValue} from "~/client/helpers/use_stable_json_value.js";
import {useStableValue} from "~/client/helpers/use_stable_value.js";
import {useMessageEditing} from "~/client/messaging/message_editing.js";
import {MessageList, MessageListItem} from "~/client/messaging/message_list.js";
import {bufferedMessageViewHeight} from "~/client/messaging/message_view.js";
import {renderMessageListItem} from "~/client/messaging/render_message_list_item.js";
import {tryLoadingMessages} from "~/client/messaging/try_loading_messages.js";
import {NavigationBarResult} from "~/client/navigation/navigation_bar_types.js";
import {usePlatform} from "~/client/remix/platform_context.js";
import {useSpacingScale} from "~/client/remix/spacing_scale_context.js";
import {useSpaceContext} from "~/client/spaces/space_context.js";
import {
    documentCommentThreadActionsHeight,
    documentCommentThreadHeaderMinHeightWithoutPaddingTop,
    documentCommentThreadHeaderPaddingY,
} from "~/client/styles/document_shared_styles.js";
import {
    messageInputMinHeightPx,
    messagingViewMarginBottom,
    messagingViewMarginBottomCalcExpression,
} from "~/client/styles/messaging_shared_styles.js";
import {
    contentStyles,
    documentCommentThreadsStyles,
    inputPlaceholderStyles,
    sprinkles,
} from "~/client/styles/styles.js";
import {VirtualizedTree} from "~/client/virtualized/helpers/virtualized_tree.js";
import {
    VirtualizedScrollView,
    VirtualizedScrollViewRef,
    VirtualizedScrollViewRenderItem,
} from "~/client/virtualized/virtualized_scroll_view.js";
import {
    RemLength,
    Spacing,
    addRemLengths,
    screenPaddingX,
    spacing,
} from "~/shared/design/core/spacing.js";
import {delayLoadingIndicatorLimitMs} from "~/shared/design/core/timing.js";
import {createDocumentCommentThreadSnippetCollector} from "~/shared/documents/create_document_comment_thread_snippet_collector.js";
import {DocumentContentWithReferences} from "~/shared/documents/document_content_references.js";
import {UncheckedDocumentContentSchema} from "~/shared/documents/document_content_schema.js";
import {
    DocumentCommentModel,
    DocumentCommentRoomKey,
    DocumentCommentThreadModel,
    decodeDocumentCommentRoomKey,
} from "~/shared/documents/document_model.js";
import {OutOfRangeError} from "~/shared/error/error.js";
import {FileAttachmentTarget} from "~/shared/files/file_attachment_target.js";
import {wait} from "~/shared/helpers/async/wait.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {LazyMap} from "~/shared/helpers/control/lazy_map.js";
import {areRangesOverlapping} from "~/shared/helpers/geometry/are_ranges_overlapping.js";
import {mapIterable} from "~/shared/helpers/iterable/map_iterable.js";
import {DocumentCommentThreadId, DocumentId} from "~/shared/id/types/id_types.js";
import {OptimisticMessageModel} from "~/shared/messaging/message_model.js";
import {Schema} from "~/shared/schema/schema.js";

const documentCommentThreadListViewMarginY: Spacing = "24";

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
     * Jump to the provided comment. If the comment thread or comment do
     * not exist this will do nothing.
     */
    jumpToCommentIndex(commentThreadId: DocumentCommentThreadId, commentIndex: number): void;
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
    // The index of the `DocumentCommentThreadHeader` item in our `VirtualizedTree`.
    readonly headerItemIndex: number;
};

type DocumentCommentThreadTree = VirtualizedTree<
    DocumentCommentThreadId,
    {
        readonly commentThread: DocumentCommentThreadModel;
        readonly comments: MessageList<DocumentCommentModel>;
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
    }: {
        documentId: DocumentId;
        content: DocumentContentWithReferences;
        onCommentThreadSnippetPress: Memo<(commentThreadId: DocumentCommentThreadId) => void>;

        /**
         * The initial comment threads loaded to populate this view. We will use this
         * to construct a `DocumentCommentThreadTree` class.
         */
        initialCommentThreadResults: ReadonlyArray<{
            commentThread: DocumentCommentThreadModel;
            comments: ReadonlyArray<DocumentCommentModel>;
            otherReferencedComments: ReadonlyArray<DocumentCommentModel>;
            optimisticComments: ReadonlyArray<OptimisticMessageModel>;
        }>;

        // Realtime props that should come from `useDocumentContentEditorWebSocket()`.
        isConnected: boolean;
        procedures: MemoObject<DocumentContentEditorWebSocketClientProcedures>;
        subscribeToCommentThreadEvents: SubscribeToCommentThreadEventsFunction;
        unpersistedResolutionStateByCommentThreadId: ReadonlyMap<
            DocumentCommentThreadId,
            {readonly isResolved: boolean; readonly version: number}
        >;

        /**
         * If we should disable rendering of the comment thread preview. Used when
         * rendering a comment thread in document in mobile layouts since the document
         * text is displayed above.
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
         * If you want to include a navigation bar in this list view you may pass in
         * the result of `useNavigationBar()` here and the virtualized scroll view will
         * be properly configured.
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
         * If we're about to focus our pinned comment input in response to the user
         * asking to reply to a comment or edit a comment then we call this function.
         * You can stop focusing by returning `preventDefault: true`.
         *
         * Useful for `<DocumentContentEditor>` where we need to expand the comment
         * sidebar before we can allow the user to write a comment.
         */
        onBeforePinnedCommentInputFocusFromReplyOrEditingChange?: () => {
            preventDefault: boolean;
        } | void;

        /**
         * Have we called `NativeMobileBridge.tabBar.hide()`? If true then we need
         * to handle safe area a bit differently.
         */
        isNativeMobileTabBarHidden?: boolean;

        /**
         * Add some background slop if there's a pinned comment input.
         *
         * This background slop is used to implement full-screenable comment threads on
         * mobile. When you open a comment thread in a document we start by showing you
         * just a preview. If you tap the comment input then the thread should expand
         * to take the full screen. Since animating `height` is expensive, we instead
         * animate `translateY`. So the comment thread is actually always the
         * fullscreen size but when collapsed we have offscreen slop.
         */
        backgroundSlopBottomIfPinnedCommentInput?: RemLength;
    },
    ref: Ref<DocumentCommentThreadListViewRef>,
) {
    const platform = usePlatform();
    const spacingScale = useSpacingScale();

    const {space} = useSpaceContext();
    const viewRef = useRef<VirtualizedScrollViewRef>(null);

    const [tree, setTree] = useState(() => {
        let tree = createEmptyDocumentCommentThreadTree();

        for (const initialCommentThreadResult of initialCommentThreadResults) {
            let comments = MessageList.new<DocumentCommentModel>({
                messageCount: initialCommentThreadResult.commentThread.commentCount,
                lastMessageChangeTime:
                    initialCommentThreadResult.commentThread.lastCommentChangeTime,
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
                },
            ]);
        }

        return tree;
    });

    // Stable list of all the `DocumentCommentThreadId`s in this list. It's
    // important that this is stable so we can use it as a dependency for a
    // `useMemo()` on our snippet cache.
    const commentThreadIds = useStableJsonValue(
        useMemo(() => {
            return Array.from(
                new Set(mapIterable(tree.iterateNodes(), node => node.commentThread.id)),
            ).sort();
        }, [tree]),
    );

    const collectCommentThreadSnippets = useMemo(
        () =>
            // Optimization: If we aren't rendering comment thread previews, don't
            // collect snippets.
            !withoutCommentThreadPreview
                ? createDocumentCommentThreadSnippetCollector(commentThreadIds)
                : () => new Map(),
        [commentThreadIds, withoutCommentThreadPreview],
    );

    const contentSnippetByCommentThreadId = useStableValue(
        ContentSnippetByCommentThreadIdSchema,
        useMemo(
            () => collectCommentThreadSnippets(content.doc),
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

    // Always pin the comment input to the bottom of the list view of a single
    // comment thread.
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

                // Adjust rendered range if we have a header item so the indexes are relative
                // to our `tree` data structure.
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

    // Whenever our list data changes, try loading more comments. In case our
    // rendered range stayed the same but we see some some unloaded comments.
    //
    // This effect should also fire when `tryLoadingMoreData()` completes
    // in case it didn't fully load the list.
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
    // 1. If a message is scrolled out of the virtualization window we still want
    //    it to be editable so it shouldn't lose state.
    //
    // 2. We want only one message to be editable at a time.
    const {messageEditing, modals} = useMessageEditing<DocumentCommentRoomKey>({
        messageNoun: "comment",
        onUpdateMessageContent: async ({roomKey, messageIndex: commentIndex, version, steps}) => {
            const [, commentThreadId] = decodeDocumentCommentRoomKey(roomKey);

            await procedures.updateCommentContent({
                commentThreadId,
                commentIndex,
                version,
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
    const [replyingToCommentIndexByCommentThreadId, setReplyingToCommentIndexByCommentThreadId] =
        useState<ReadonlyMap<DocumentCommentThreadId, number>>(new Map());

    // A comment to highlight for the user. We currently highlight comments with a
    // little wiggle animation (see `wiggle_animation.css.ts` for more information).
    // We highlight comments when initially loading a page with a comment index in
    // the URL and when the user clicks on a reply preview to jump to it.
    const [highlightComment, setHighlightComment] = useState<{
        commentThreadId: DocumentCommentThreadId;
        commentIndex: number;
        shouldHighlightRef: MutableRefObject<boolean>;
    } | null>(null);

    const isJumpingToCommentRef = useRef(false);

    // Jumping to a comment entails:
    //
    // 1. We scroll to the comment
    // 2. We highlight the comment to the user
    const jumpToCommentIndex = useEvent(
        (commentThreadId: DocumentCommentThreadId, commentIndex: number) => {
            // If we are in the process of jumping, don't start another jump
            if (isJumpingToCommentRef.current) return;

            const view = assertExists(viewRef.current);

            const nodeResult = tree.getNodeByKeyIfExists(commentThreadId);
            if (!nodeResult) return;
            const {node, startItemIndex} = nodeResult;

            // Make sure the comment index is valid.
            if (
                commentIndex < 0 ||
                commentIndex >= node.comments.getMessageCountIncludingOptimisticMessages()
            ) {
                return;
            }

            const scrollToIndex = startItemIndex + 1 + commentIndex;

            const peekRenderedRange = view.peekRenderedRangeAfterScrollToIndex(scrollToIndex);
            const result = tryLoadingMoreData(peekRenderedRange);

            if (!result.isLoading) {
                view.scrollToIndex(scrollToIndex, {withAnchor: true});

                setHighlightComment({
                    commentThreadId,
                    commentIndex,
                    shouldHighlightRef: {current: true},
                });
            } else {
                isJumpingToCommentRef.current = true;

                void Promise.race([result.promise, wait(delayLoadingIndicatorLimitMs)]).finally(
                    () => {
                        isJumpingToCommentRef.current = false;

                        view.scrollToIndex(scrollToIndex, {withAnchor: true});

                        setHighlightComment({
                            commentThreadId,
                            commentIndex,
                            shouldHighlightRef: {current: true},
                        });
                    },
                );
            }
        },
    );

    const handleJumpToComment = useCallback(
        (comment: DocumentCommentModel) => {
            jumpToCommentIndex(comment.commentThreadId, comment.index);
        },
        [jumpToCommentIndex],
    );

    useImperativeHandle(
        ref,
        () => ({
            getHeight: () => assertExists(viewRef.current).getHeight(),
            getContentHeight: () => assertExists(viewRef.current).getContentHeight(),
            getScrollOffset: () => assertExists(viewRef.current).getScrollOffset(),
            setScrollOffset: (...args) => assertExists(viewRef.current).setScrollOffset(...args),
            jumpToCommentIndex,
        }),
        [jumpToCommentIndex],
    );

    // Make sure the bottom of the scroll view stays visible when the keyboard
    // opens and closes.
    //
    // Unless we are replying to a message or editing a message. Then we should
    // anchor to the message in question. Similar code also exists in
    // `post_list_view.tsx` and `messaging_view.tsx`. If we update the code here
    // we also probably need to update there.
    useScrollToAvoidBottomBarsAndMobileKeyboard(viewRef, {
        isPinned: true,
        getAnchorPosition: useEvent(oldVisibleRect => {
            // NOTE(calebmer, 2024-07-16): We used to anchor chat view scroll to the
            // message the user was replying to or editing. However, in practice this felt
            // janky to me. Scrolling wasn't predictable when swiping to reply to a
            // message! I think consistency is likely the better user experience here.
            //
            // To look at the old message anchoring code, git blame this comment to see the
            // commit where I remove it.

            return {top: oldVisibleRect.bottom, height: 0};
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
            new LazyMap<DocumentCommentThreadId, RefObject<MessageInputRef>>(() => ({
                current: null,
            })),
    );

    const mergedPinnedCommentInputRef = useMergedRefs(
        isSingleCommentThreadWithPinnedCommentInput
            ? inputRefByCommentThreadId.get(tree.getItem(tree.getItemCount() - 1).commentThread.id)
            : null,
        isSingleCommentThreadWithPinnedCommentInput ? pinnedCommentInputRef ?? null : null,
    );

    const {dragOverlay, dropTargetProps} = useMessagingViewDropTarget({
        isDisabled: messageEditing.state.isEditing,
        onDrop: event => {
            const view = assertExists(viewRef.current);
            const renderedRange = view.getRenderedRange();
            if (!renderedRange) return null;

            const offset =
                event.clientY -
                view.getElement().getBoundingClientRect().top +
                view.getScrollOffset();

            // Find the item that contains `offset`. Written so that if `offset` is above
            // the virtualized scroll view we'll return the first index and if it's below
            // the virtualized scroll view we'll return the last index.
            let aboveIndex: number | null = null;
            for (let index = renderedRange.startIndex; index <= renderedRange.endIndex; index++) {
                const position = view.getPositionByIndex(index);
                aboveIndex = index;
                if (offset < position.offset + position.height) break;
            }

            if (aboveIndex === null) return null;

            if (header) {
                if (aboveIndex === 0) {
                    // If we're above the header then we want to call `tree.getItem(0)`. However,
                    // first check if the tree is empty. If it's empty then return null.
                    if (tree.getItemCount() === 0) return null;
                } else {
                    // Adjust index so it's relative to `tree` data structure for the rest of
                    // this function.
                    aboveIndex -= 1;
                }
            }

            const item = tree.getItem(aboveIndex);

            return assertExists(inputRefByCommentThreadId.get(item.commentThread.id).current).drop(
                event.dataTransfer,
            );
        },
    });

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

                // Adjust index so it's relative to `tree` data structure for the rest of
                // this function.
                index -= 1;
            }

            const item = tree.getItem(index);
            switch (item.type) {
                case "DocumentCommentThreadHeader": {
                    // All comment threads should be in the same document.
                    assert(item.commentThread.documentId === documentId);

                    // If we have a navigation bar, then use less top padding since when the
                    // navigation bar isn't opaque it visually adds a lot of padding to the top of
                    // the screen already.
                    //
                    // The `paddingTop` of `2` also happens to align with the `<TaskStatusButton>`
                    // placement on mobile.
                    const paddingTop: Spacing = hasNavigationBar
                        ? "3"
                        : documentCommentThreadHeaderPaddingY;

                    const minHeight = addRemLengths(
                        index !== 0 ? documentCommentThreadListViewMarginY : paddingTop,
                        !withoutCommentThreadPreview
                            ? documentCommentThreadHeaderMinHeightWithoutPaddingTop
                            : documentCommentThreadActionsHeight,
                    );

                    const nodeIndex = assertExists(
                        tree.getNodeIndexByKeyIfExists(item.commentThread.id),
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
                                {index !== 0 && (
                                    <div
                                        className={sprinkles({
                                            position: "relative",
                                            width: "full",
                                            height: documentCommentThreadListViewMarginY,
                                            maxWidth: contentStyles.contentMaxWidth,
                                            paddingX: screenPaddingX,
                                            display: "flex",
                                            flexDirection: "column",
                                            justifyContent: "center",
                                        })}
                                    >
                                        <div style={{height: spacing["2"]}} />
                                        <div
                                            className={
                                                documentCommentThreadsStyles.sawtoothBorderClassName
                                            }
                                        />
                                        <div
                                            className={sprinkles({
                                                width: "full",
                                                paddingY: "0.5",
                                                color: "grey-30",
                                                fontSize: "50",
                                                display: "flex",
                                                justifyContent: "center",
                                                alignItems: "center",
                                                gap: "1",
                                            })}
                                            style={{
                                                ...inputPlaceholderStyles,
                                                fontVariantNumeric: "tabular-nums",
                                            }}
                                        >
                                            {nodeIndex + 1} of {tree.getNodeCount()}
                                        </div>
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
                        shouldHighlightRef:
                            highlightComment?.commentThreadId === item.commentThread.id &&
                            item.commentItem.message &&
                            !item.commentItem.message.isOptimistic &&
                            highlightComment?.commentIndex === item.commentItem.message.index
                                ? highlightComment.shouldHighlightRef
                                : null,
                        onJumpToMessage: handleJumpToComment,
                        onReplyToMessage: comment => {
                            setReplyingToCommentIndexByCommentThreadId(
                                replyingToCommentIndexByCommentThreadId => {
                                    const newReplyingToCommentIndexByCommentThreadId = new Map(
                                        replyingToCommentIndexByCommentThreadId,
                                    );
                                    newReplyingToCommentIndexByCommentThreadId.set(
                                        comment.commentThreadId,
                                        comment.index,
                                    );
                                    return newReplyingToCommentIndexByCommentThreadId;
                                },
                            );
                        },
                        onDeleteMessage: async message => {
                            await procedures.deleteComment({
                                commentThreadId: item.commentThread.id,
                                commentIndex: message.index,
                            });
                        },
                        getMessageUrl: commentIndex => {
                            return new URL(
                                `/s/${space.id}/documents/${documentId}?comments=${item.commentThread.id}&comment=${commentIndex}`,
                                window.location.href,
                            );
                        },
                        shouldAddMarginBottom:
                            isSingleCommentThreadWithPinnedCommentInput &&
                            // -2 instead of -1 since when
                            // `isSingleCommentThreadWithPinnedCommentInput` is true we don't
                            // actually render the final comment input item in `tree`.
                            //
                            // We intentionally use `--keyboard-safe-area-inset-bottom` here for comment
                            // threads rendered on top of a document since the native tab bar is hidden in
                            // this case.
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

                // The document comment thread input item sticks to the bottom of the screen
                // while the associated comment thread is visible. Whenever any item in the
                // comment thread is rendered we also additionally render this input
                // (`renderAdditionalItemIndexes`) so that virtualization doesn't remove it.
                //
                // We create a `<div>` that spans the bottom of the document preview to the end
                // of the entire thread. This is the range in which our comment input will be
                // sticky. We create a second `<div>` of the same range but rendering the full
                // thread width border. The comment input is shaped so that when we reach the
                // bottom of the page the full width border will slide underneath it. Creating
                // the effect of while scrolling the comment input is a layer on top of the thread
                // and when at the bottom of the thread the comment input is inline.
                //
                // IMPORTANT: This code is very similar to how we render `<PostCommentInput>`
                // in `<PostListView>`! If you are updating this code you also probably want to
                // update `<PostListView>`. We don't know what a good abstraction here is so
                // following the advice "no abstraction is better than the wrong abstraction".
                case "DocumentCommentInput": {
                    const replyingToCommentIndex = replyingToCommentIndexByCommentThreadId.get(
                        item.commentThread.id,
                    );
                    const replyingToComment =
                        replyingToCommentIndex !== undefined
                            ? item.comments.getLoadedMessageIfExists(replyingToCommentIndex)
                            : null;

                    // This is defined out here so that it doesn't re-rerender every time the
                    // `render()` function is called since it's referentially stable.
                    const inputNode = (
                        <DocumentCommentInput
                            isStickyPositioned={true}
                            inputRef={inputRefByCommentThreadId.get(item.commentThread.id)}
                            viewRef={viewRef}
                            commentThread={item.commentThread}
                            comments={item.comments}
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
                            replyingToComment={replyingToComment}
                            onClearReplyingToComment={() => {
                                setReplyingToCommentIndexByCommentThreadId(
                                    replyingToCommentIndexByCommentThreadId => {
                                        const newReplyingToCommentIndexByCommentThreadId = new Map(
                                            replyingToCommentIndexByCommentThreadId,
                                        );
                                        newReplyingToCommentIndexByCommentThreadId.delete(
                                            item.commentThread.id,
                                        );
                                        return newReplyingToCommentIndexByCommentThreadId;
                                    },
                                );
                            }}
                            onJumpToComment={handleJumpToComment}
                            onDeleteComment={async commentIndex => {
                                await procedures.deleteComment({
                                    commentThreadId: item.commentThread.id,
                                    commentIndex,
                                });
                            }}
                            isConnected={isConnected}
                            procedures={procedures}
                            subscribeToCommentThreadEvents={subscribeToCommentThreadEvents}
                            withMobileMaxHeight={withCommentInputMobileMaxHeight}
                        />
                    );

                    return {
                        key: `DocumentCommentInput:${item.commentThread.id}`,
                        minHeight: messageInputMinHeightPx[platform][spacingScale],
                        withManualLayout: true,
                        stayCompletelyVisibleAfterResize: true,
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
                                            overflow: "hidden",
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
            procedures,
            spacingScale,
            fileAttachmentTarget,
            messageEditing,
            highlightComment,
            handleJumpToComment,
            isNativeMobileTabBarHidden,
            backgroundSlopBottomIfPinnedCommentInput,
            space.id,
            replyingToCommentIndexByCommentThreadId,
            inputRefByCommentThreadId,
            isConnected,
            subscribeToCommentThreadEvents,
            withCommentInputMobileMaxHeight,
            platform,
        ],
    );

    return (
        <>
            {modals}
            <div
                {...dropTargetProps}
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
                {dragOverlay}
                {withSafeAreaInsetTop && !navigationBar?.navigationBar && (
                    // Only render a safe area cover if we don't have a navigation bar. Otherwise
                    // the navigation bar acts as our safe area cover.
                    <div
                        className={sprinkles({
                            position: "absolute",
                            top: "0",
                            left: "0",
                            right: "0",
                            zIndex: "10",
                            height: "safe-area-inset-top",
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
                        // Don't render the comment input (which should be the last item) if we are
                        // pinning the comment input to the bottom of the view.
                        (isSingleCommentThreadWithPinnedCommentInput ? 1 : 0)
                    }
                    renderItem={renderItem}
                    onRenderedRangeChange={tryLoadingMoreData}
                    extraChildren={navigationBar?.navigationBar}
                />
                {isSingleCommentThreadWithPinnedCommentInput &&
                    (() => {
                        const item = tree.getItem(tree.getItemCount() - 1);
                        assert(item.type === "DocumentCommentInput");

                        const replyingToCommentIndex =
                            replyingToCommentIndexByCommentThreadId.get(item.commentThread.id) ??
                            null;
                        const replyingToComment =
                            replyingToCommentIndex !== null
                                ? item.comments.getLoadedMessageIfExists(replyingToCommentIndex)
                                : null;

                        return (
                            <DocumentCommentInput
                                isStickyPositioned={false}
                                inputRef={mergedPinnedCommentInputRef}
                                viewRef={viewRef}
                                commentThread={item.commentThread}
                                comments={item.comments}
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
                                replyingToComment={replyingToComment}
                                onClearReplyingToComment={() => {
                                    setReplyingToCommentIndexByCommentThreadId(
                                        replyingToCommentIndexByCommentThreadId => {
                                            const newReplyingToCommentIndexByCommentThreadId =
                                                new Map(replyingToCommentIndexByCommentThreadId);
                                            newReplyingToCommentIndexByCommentThreadId.delete(
                                                item.commentThread.id,
                                            );
                                            return newReplyingToCommentIndexByCommentThreadId;
                                        },
                                    );
                                }}
                                onJumpToComment={handleJumpToComment}
                                onDeleteComment={async commentIndex => {
                                    await procedures.deleteComment({
                                        commentThreadId: item.commentThread.id,
                                        commentIndex,
                                    });
                                }}
                                isConnected={isConnected}
                                procedures={procedures}
                                subscribeToCommentThreadEvents={subscribeToCommentThreadEvents}
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
