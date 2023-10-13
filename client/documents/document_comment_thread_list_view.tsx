import {
    Memo,
    MutableRefObject,
    Ref,
    forwardRef,
    useCallback,
    useEffect,
    useImperativeHandle,
    useMemo,
    useRef,
    useState,
} from "react";
import {delayLoadingIndicatorLimitMs} from "~/client/design/timing_constants.js";
import {
    documentCommentInputMinHeight,
    documentCommentThreadListViewMarginBottom,
    documentCommentThreadListViewMarginTop,
    documentCommentThreadListViewMarginY,
    documentCommentThreadPreviewHeight,
} from "~/client/documents/document_shared_styles.js";
import {createDocumentCommentThreadSnippetCollector} from "~/client/documents/internal/create_document_comment_thread_snippet_collector.js";
import {DocumentCommentInput} from "~/client/documents/internal/document_comment_input.js";
import {DocumentCommentThreadPreview} from "~/client/documents/internal/document_comment_thread_preview.js";
import {DocumentContentEditorWebSocketClientProcedures} from "~/client/documents/internal/document_content_editor_web_socket_client.js";
import {SubscribeToCommentThreadEventsFunction} from "~/client/documents/use_document_content_editor_web_socket.js";
import {useEvent} from "~/client/helpers/lifecycle/use_event.js";
import {MemoObject} from "~/client/helpers/types/memo_object.js";
import {useStableJsonValue} from "~/client/helpers/use_stable_json_value.js";
import {useStableValue} from "~/client/helpers/use_stable_value.js";
import {useMessageEditing} from "~/client/messaging/message_editing.js";
import {MessageList, MessageListItem} from "~/client/messaging/message_list.js";
import {bufferedMessageViewHeight} from "~/client/messaging/message_view.js";
import {renderMessageListItem} from "~/client/messaging/messaging_view.js";
import {tryLoadingMessages} from "~/client/messaging/try_loading_messages.js";
import {useIsMobile} from "~/client/remix/use_is_mobile.js";
import {useSpaceContext} from "~/client/spaces/space_context.js";
import {
    VirtualizedScrollView,
    VirtualizedScrollViewRef,
    VirtualizedScrollViewRenderItem,
} from "~/client/virtualized/virtualized_scroll_view.js";
import {VirtualizedTree} from "~/client/virtualized/helpers/virtualized_tree.js";
import {Spacing, addRemLengths, spacing} from "~/shared/design/spacing.js";
import {DocumentContentWithReferences} from "~/shared/documents/document_content_references.js";
import {UncheckedDocumentContentSchema} from "~/shared/documents/document_content_schema.js";
import {
    DocumentCommentModel,
    DocumentCommentRoomKey,
    DocumentCommentThreadModel,
    decodeDocumentCommentRoomKey,
} from "~/shared/documents/document_model.js";
import {OutOfRangeError} from "~/shared/error/error.js";
import {wait} from "~/shared/helpers/async/wait.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {areRangesOverlapping} from "~/shared/helpers/geometry/are_ranges_overlapping.js";
import {mapIterable} from "~/shared/helpers/iterable/map_iterable.js";
import {DocumentCommentThreadId, DocumentId} from "~/shared/id/types/id_types.js";
import {OptimisticMessageModel} from "~/shared/messaging/message_model.js";
import {Schema} from "~/shared/schema/schema.js";
import {sprinkles} from "~/shared/styles/styles.js";

const documentCommentThreadListViewMarginX: Spacing = "4";
const documentCommentThreadListViewMaxWidth: Spacing = "128";

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
    /**
     * Jump to the provided comment. If the comment thread or comment do
     * not exist this will do nothing.
     */
    jumpToCommentIndex(commentThreadId: DocumentCommentThreadId, commentIndex: number): void;
};

type DocumentCommentThreadTreeItem =
    | DocumentCommentThreadTreeCommentThreadPreviewItem
    | DocumentCommentThreadTreeCommentItem
    | DocumentCommentThreadTreeCommentInputItem;

type DocumentCommentThreadTreeCommentThreadPreviewItem = {
    readonly type: "DocumentCommentThreadPreview";
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
    // The index of the `DocumentCommentThreadPreview` item in our `VirtualizedTree`.
    readonly previewItemIndex: number;
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
                    type: "DocumentCommentThreadPreview",
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
                    previewItemIndex: startItemIndex,
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

/**
 * Renders a virtualized list of posts which can expand their comments inline.
 *
 * This component handles all rendering for a post unit. Including rendering an
 * individual post on a post route. Since even when rendering an individual
 * post you still need to virtualize the list of comments. This means there is
 * some confusing overloading because features like `channelHeader` and `aside`
 * which are important in the context of a channel are not important in the
 * context of rendering a single post.
 */
function DocumentCommentThreadListView(
    {
        documentId,
        content,
        onCommentThreadSnippetPress,
        initialCommentThreadsResult,
        isConnected,
        procedures,
        subscribeToCommentThreadEvents,
        withMobileLayout: _withMobileLayout = false,
        padding: _padding,
    }: {
        documentId: DocumentId;
        content: DocumentContentWithReferences;
        onCommentThreadSnippetPress: Memo<(commentThreadId: DocumentCommentThreadId) => void>;

        /**
         * The initial comment threads loaded to populate this view. We will use this
         * to construct a `DocumentCommentThreadTree` class.
         */
        initialCommentThreadsResult: ReadonlyArray<{
            commentThread: DocumentCommentThreadModel;
            comments: ReadonlyArray<DocumentCommentModel>;
            otherReferencedComments: ReadonlyArray<DocumentCommentModel>;
            optimisticComments: ReadonlyArray<OptimisticMessageModel>;
        }>;

        // Realtime props that should come from `useDocumentContentEditorWebSocket()`.
        isConnected: boolean;
        procedures: MemoObject<DocumentContentEditorWebSocketClientProcedures>;
        subscribeToCommentThreadEvents: SubscribeToCommentThreadEventsFunction;

        /**
         * Use the mobile layout for a document comment thread list view even
         * on desktop.
         *
         * The mobile layout doesn't have margins and will pin the comment input for
         * single comment threads to the bottom of the screen.
         */
        withMobileLayout?: boolean;

        /**
         * Customize the amount of margin on messages.
         */
        padding?: Spacing;
    },
    ref: Ref<DocumentCommentThreadListViewRef>,
) {
    const isMobile = useIsMobile();
    const withMobileLayout = isMobile || _withMobileLayout;

    const padding: Spacing = _padding ?? (isMobile ? "3" : "5");

    const {space} = useSpaceContext();
    const viewRef = useRef<VirtualizedScrollViewRef>(null);

    const [tree, setTree] = useState(() => {
        let tree = createEmptyDocumentCommentThreadTree();

        for (const initialCommentThreadResult of initialCommentThreadsResult) {
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
        () => createDocumentCommentThreadSnippetCollector(commentThreadIds),
        [commentThreadIds],
    );

    const contentSnippetByCommentThreadId = useStableValue(
        ContentSnippetByCommentThreadIdSchema,
        useMemo(
            () => collectCommentThreadSnippets(content.doc),
            [collectCommentThreadSnippets, content.doc],
        ),
    );

    // Always pin the comment input to the bottom of the list view on mobile
    // layout of a single comment thread.
    const isSingleMobileLayoutCommentThreadWithPinnedCommentInput =
        withMobileLayout && tree.getNodeCount() === 1;

    const isLoadingRef = useRef(false);
    const [errorState, setErrorState] = useState<
        {hasError: false} | {hasError: true; error: unknown}
    >({hasError: false});

    if (errorState.hasError) throw errorState.error;

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
                    setErrorState({hasError: true, error});
                },
            );
            return result;

            // Try to load more data without worrying about managing coordination with
            // `isLoadingRef` or error handling.
            function actuallyTryLoadingMoreData(
                renderedRange: {startIndex: number; endIndex: number} | null,
            ): {isLoading: false} | {isLoading: true; promise: Promise<void>} {
                if (!renderedRange) return {isLoading: false};

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
    const messageEditing = useMessageEditing<DocumentCommentRoomKey>({
        onUpdateMessageContent: async ({roomKey, messageIndex: commentIndex, content}) => {
            const [, commentThreadId] = decodeDocumentCommentRoomKey(roomKey);

            await procedures.updateCommentContent({
                commentThreadId,
                commentIndex,
                content,
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
                view.scrollToIndex(scrollToIndex);

                setHighlightComment({
                    commentThreadId,
                    commentIndex,
                    shouldHighlightRef: {current: true},
                });
            } else {
                isJumpingToCommentRef.current = true;

                Promise.race([result.promise, wait(delayLoadingIndicatorLimitMs)]).finally(() => {
                    isJumpingToCommentRef.current = false;

                    view.scrollToIndex(scrollToIndex);

                    setHighlightComment({
                        commentThreadId,
                        commentIndex,
                        shouldHighlightRef: {current: true},
                    });
                });
            }
        },
    );

    const handleJumpToComment = useCallback(
        (comment: DocumentCommentModel) => {
            jumpToCommentIndex(comment.commentThreadId, comment.index);
        },
        [jumpToCommentIndex],
    );

    useImperativeHandle(ref, () => ({jumpToCommentIndex}), [jumpToCommentIndex]);

    const renderItem: VirtualizedScrollViewRenderItem = useCallback(
        index => {
            const item = tree.getItem(index);
            switch (item.type) {
                case "DocumentCommentThreadPreview": {
                    // All comment threads should be in the same document.
                    assert(item.commentThread.documentId === documentId);

                    return {
                        key: `DocumentCommentThreadPreview:${item.commentThread.id}`,
                        minHeight: documentCommentThreadPreviewHeight,
                        renderAdditionalItemIndexes:
                            !isSingleMobileLayoutCommentThreadWithPinnedCommentInput
                                ? [item.commentInputItemIndex]
                                : [],
                        node: (
                            <div
                                className={sprinkles({
                                    display: "flex",
                                    justifyContent: "center",
                                    paddingX: !withMobileLayout
                                        ? documentCommentThreadListViewMarginX
                                        : undefined,
                                    paddingTop:
                                        index === 0
                                            ? !withMobileLayout
                                                ? documentCommentThreadListViewMarginY
                                                : "0"
                                            : documentCommentThreadListViewMarginTop,
                                })}
                            >
                                <div
                                    className={sprinkles({
                                        width: "full",
                                        maxWidth: documentCommentThreadListViewMaxWidth,
                                        backgroundColor: "grey-0",
                                        borderTopRadius: !withMobileLayout ? "md" : undefined,
                                        boxShadow: "elevation-5",
                                        overflow: "hidden",
                                    })}
                                >
                                    <DocumentCommentThreadPreview
                                        commentThread={item.commentThread}
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
                        messageNoun: "comment",
                        messages: item.comments,
                        groupKey: item.commentThread.id,
                        index: item.commentItemIndex,
                        item: item.commentItem,
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
                        marginX: padding,
                        render: node => (
                            <div
                                className={sprinkles({
                                    display: "flex",
                                    justifyContent: "center",
                                    overflow: "hidden",
                                    paddingX: !withMobileLayout
                                        ? documentCommentThreadListViewMarginX
                                        : undefined,
                                })}
                            >
                                <div
                                    className={sprinkles({
                                        width: "full",
                                        maxWidth: documentCommentThreadListViewMaxWidth,
                                        backgroundColor: "grey-0",
                                        boxShadow: "elevation-5",
                                    })}
                                >
                                    {node}
                                </div>
                            </div>
                        ),
                    });

                    return {
                        ...renderedItem,
                        renderAdditionalItemIndexes:
                            !isSingleMobileLayoutCommentThreadWithPinnedCommentInput
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
                            viewRef={viewRef}
                            commentThread={item.commentThread}
                            comments={item.comments}
                            onUpdateComments={update =>
                                setTree(tree =>
                                    tree.updateNode(item.commentThread.id, node => {
                                        const newComments = update(node.comments);
                                        if (newComments === node.comments) return node;
                                        return {...node, comments: newComments};
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
                            isConnected={isConnected}
                            procedures={procedures}
                            subscribeToCommentThreadEvents={subscribeToCommentThreadEvents}
                            marginX={padding}
                            isStickyPositioned={true}
                        />
                    );

                    const marginBottom =
                        index === tree.getItemCount() - 1
                            ? !withMobileLayout
                                ? documentCommentThreadListViewMarginY
                                : "0"
                            : documentCommentThreadListViewMarginBottom;

                    return {
                        key: `DocumentCommentInput:${item.commentThread.id}`,
                        minHeight: addRemLengths(
                            documentCommentInputMinHeight,
                            spacing[marginBottom],
                        ),
                        withManualLayout: true,
                        stayCompletelyVisibleAfterResize: true,
                        render: ({
                            ref,
                            offset,
                            height,
                            shouldRenderWithRelativePositioning,
                            getPositionByIndex,
                        }) => {
                            const previewPosition = getPositionByIndex(item.previewItemIndex);

                            const previewOffsetEnd =
                                previewPosition.offset + previewPosition.height - 1;

                            return (
                                <>
                                    {!shouldRenderWithRelativePositioning && (
                                        <div
                                            style={{
                                                position: "absolute",
                                                top: offset,
                                                left: 0,
                                                right: 0,
                                            }}
                                        >
                                            <div
                                                className={sprinkles({
                                                    display: "flex",
                                                    justifyContent: "center",
                                                    overflow: "hidden",
                                                    paddingX: !withMobileLayout
                                                        ? documentCommentThreadListViewMarginX
                                                        : undefined,
                                                    paddingBottom: marginBottom,
                                                })}
                                                style={{height}}
                                            >
                                                <div
                                                    className={sprinkles({
                                                        width: "full",
                                                        height: "full",
                                                        maxWidth:
                                                            documentCommentThreadListViewMaxWidth,
                                                        paddingX: padding,
                                                        backgroundColor: "grey-0",
                                                        borderBottomRadius: !withMobileLayout
                                                            ? "md"
                                                            : undefined,
                                                        boxShadow: "elevation-5",
                                                    })}
                                                >
                                                    <div
                                                        className={sprinkles({
                                                            width: "full",
                                                            borderTop: "grey-5",
                                                        })}
                                                    />
                                                </div>
                                            </div>
                                        </div>
                                    )}
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
                                                      top: previewOffsetEnd,
                                                      left: "0",
                                                      right: "0",
                                                      height: offset - previewOffsetEnd + height,
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
                                                    bottom: `-${spacing[marginBottom]}`,
                                                }),
                                            }}
                                            className={sprinkles({
                                                width: "full",
                                                display: "flex",
                                                justifyContent: "center",
                                                overflow: "hidden",
                                                paddingX: !withMobileLayout
                                                    ? documentCommentThreadListViewMarginX
                                                    : undefined,
                                                paddingBottom: marginBottom,
                                            })}
                                        >
                                            <div
                                                className={sprinkles({
                                                    width: "full",
                                                    maxWidth: documentCommentThreadListViewMaxWidth,
                                                    position: "relative",
                                                    display: "flex",
                                                    pointerEvents: "auto",
                                                    ...(shouldRenderWithRelativePositioning && {
                                                        // When absolutely positioned we render an element underneath this one at the
                                                        // end of the post so that while sticky scrolling we don't have double shadows.
                                                        backgroundColor: "grey-0",
                                                        borderBottomRadius: !withMobileLayout
                                                            ? "md"
                                                            : undefined,
                                                        boxShadow: "elevation-5",
                                                    }),
                                                })}
                                                style={{
                                                    // Allow full-width top border to be visible until it slides under.
                                                    paddingTop: 1,
                                                }}
                                            >
                                                {shouldRenderWithRelativePositioning && (
                                                    <div
                                                        className={sprinkles({
                                                            position: "absolute",
                                                            top: "0",
                                                            left: padding,
                                                            right: padding,
                                                            borderTop: "grey-5",
                                                        })}
                                                    />
                                                )}
                                                <div
                                                    className={sprinkles({
                                                        flexGrow: "1",
                                                        overflow: "hidden",
                                                        // Full-width border will be hidden under this background.
                                                        backgroundColor: "grey-0",
                                                        borderBottomRadius: !withMobileLayout
                                                            ? "md"
                                                            : undefined,
                                                    })}
                                                >
                                                    {inputNode}
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                    {!shouldRenderWithRelativePositioning && (
                                        <>
                                            <div
                                                // Render a white backdrop below the entire post so that when the user is jump
                                                // scrolling we don't have the pinned comment input and the wash
                                                // background color.
                                                className={sprinkles({
                                                    position: "absolute",
                                                    left: "0",
                                                    right: "0",
                                                    display: "flex",
                                                    justifyContent: "center",
                                                    zIndex: "-10",
                                                    paddingX: !withMobileLayout
                                                        ? documentCommentThreadListViewMarginX
                                                        : undefined,
                                                    overflow: "hidden",
                                                })}
                                                style={{
                                                    top: `calc(${
                                                        previewOffsetEnd -
                                                        previewPosition.height +
                                                        1
                                                    }px + ${
                                                        item.previewItemIndex === 0
                                                            ? spacing[
                                                                  documentCommentThreadListViewMarginY
                                                              ]
                                                            : spacing[
                                                                  documentCommentThreadListViewMarginTop
                                                              ]
                                                    })`,
                                                    height: `calc(${
                                                        offset -
                                                        previewOffsetEnd +
                                                        previewPosition.height
                                                    }px - ${
                                                        item.previewItemIndex === 0
                                                            ? spacing[
                                                                  documentCommentThreadListViewMarginY
                                                              ]
                                                            : spacing[
                                                                  documentCommentThreadListViewMarginTop
                                                              ]
                                                    })`,
                                                }}
                                            >
                                                <div
                                                    className={sprinkles({
                                                        width: "full",
                                                        height: "full",
                                                        maxWidth:
                                                            documentCommentThreadListViewMaxWidth,
                                                        backgroundColor: "grey-0",
                                                        borderTopRadius: !withMobileLayout
                                                            ? "md"
                                                            : undefined,
                                                    })}
                                                />
                                            </div>
                                            <div
                                                style={{
                                                    position: "absolute",
                                                    top: previewOffsetEnd,
                                                    left: "0",
                                                    right: "0",
                                                    height: offset - previewOffsetEnd + height + 1,
                                                    pointerEvents: "none",
                                                    display: "flex",
                                                    justifyContent: "center",
                                                    alignItems: "flex-end",
                                                    zIndex: "10",
                                                }}
                                            >
                                                <div
                                                    style={{
                                                        position: "sticky",
                                                        bottom: `-${spacing[marginBottom]}`,
                                                        height,
                                                    }}
                                                    className={sprinkles({
                                                        width: "full",
                                                        display: "flex",
                                                        justifyContent: "center",
                                                        paddingBottom: marginBottom,
                                                        paddingX: !withMobileLayout
                                                            ? documentCommentThreadListViewMarginX
                                                            : undefined,
                                                        overflow: "hidden",
                                                    })}
                                                >
                                                    <div
                                                        className={sprinkles({
                                                            width: "full",
                                                            maxWidth:
                                                                documentCommentThreadListViewMaxWidth,
                                                            borderTop: "grey-10",
                                                        })}
                                                    />
                                                </div>
                                            </div>
                                        </>
                                    )}
                                </>
                            );
                        },
                    };
                }
                default:
                    throw exhaustive(item);
            }
        },
        [
            tree,
            documentId,
            isSingleMobileLayoutCommentThreadWithPinnedCommentInput,
            withMobileLayout,
            contentSnippetByCommentThreadId,
            content.references,
            onCommentThreadSnippetPress,
            messageEditing,
            highlightComment,
            handleJumpToComment,
            padding,
            procedures,
            space.id,
            replyingToCommentIndexByCommentThreadId,
            isConnected,
            subscribeToCommentThreadEvents,
        ],
    );

    return (
        <>
            <div
                className={sprinkles({
                    flexGrow: "1",
                    width: "full",
                    height: "full",
                    overflow: "hidden",
                    position: "relative",
                    display: "flex",
                    flexDirection: "column",
                    backgroundColor: isSingleMobileLayoutCommentThreadWithPinnedCommentInput
                        ? "grey-0"
                        : "grey-wash",
                })}
            >
                <VirtualizedScrollView
                    ref={viewRef}
                    bufferedItemHeight={bufferedMessageViewHeight}
                    itemCount={
                        // Don't render the comment input (which should be the last item) if we are
                        // pinning the comment input to the bottom of the view.
                        tree.getItemCount() -
                        (isSingleMobileLayoutCommentThreadWithPinnedCommentInput ? 1 : 0)
                    }
                    renderItem={renderItem}
                    onRenderedRangeChange={tryLoadingMoreData}
                />
                {isSingleMobileLayoutCommentThreadWithPinnedCommentInput &&
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
                                viewRef={viewRef}
                                commentThread={item.commentThread}
                                comments={item.comments}
                                onUpdateComments={update =>
                                    setTree(tree =>
                                        tree.updateNode(item.commentThread.id, node => {
                                            const newComments = update(node.comments);
                                            if (newComments === node.comments) return node;
                                            return {...node, comments: newComments};
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
                                isConnected={isConnected}
                                procedures={procedures}
                                subscribeToCommentThreadEvents={subscribeToCommentThreadEvents}
                                marginX={padding}
                            />
                        );
                    })()}
            </div>
        </>
    );
}
