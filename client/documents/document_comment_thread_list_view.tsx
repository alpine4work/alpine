import {
    MutableRefObject,
    Ref,
    forwardRef,
    useCallback,
    useEffect,
    useImperativeHandle,
    useRef,
    useState,
} from "react";
import {useAppContext} from "~/client/context/app_context";
import {delayLoadingIndicatorLimitMs} from "~/client/design/timing_constants";
import {useDocumentContentEditorWebSocket} from "~/client/documents/internal/use_document_content_editor_web_socket";
import {useEvent} from "~/client/helpers/lifecycle/use_event";
import {useMessageEditing} from "~/client/messaging/message_editing";
import {MessageInput} from "~/client/messaging/message_input";
import {MessageList, MessageListItem} from "~/client/messaging/message_list";
import {bufferedMessageViewHeight} from "~/client/messaging/message_view";
import {renderMessageListItem} from "~/client/messaging/messaging_view";
import {tryLoadingMessages} from "~/client/messaging/try_loading_messages";
import {useIsMobile} from "~/client/remix/use_is_mobile";
import {
    VirtualizedScrollView,
    VirtualizedScrollViewRef,
    VirtualizedScrollViewRenderItem,
} from "~/client/virtualized/virtualized_scroll_view";
import {VirtualizedTree} from "~/client/virtualized/virtualized_tree";
import {OutOfRangeError, UnimplementedError} from "~/shared/error/error";
import {wait} from "~/shared/helpers/async/wait";
import {assert} from "~/shared/helpers/control/assert";
import {assertExists} from "~/shared/helpers/control/assert_exists";
import {exhaustive} from "~/shared/helpers/control/exhaustive";
import {areRangesOverlapping} from "~/shared/helpers/geometry/are_ranges_overlapping";
import {DocumentCommentThreadId, DocumentId} from "~/shared/id/types/id_types";
import {
    DocumentCommentModel,
    DocumentCommentRoomKey,
    DocumentCommentThreadModel,
} from "~/shared/models/document_model";
import {
    getDocumentCommentsFromEnd,
    getDocumentCommentsFromStart,
} from "~/shared/rpc/documents_rpc_definitions";
import {sprinkles} from "~/shared/styles/styles";

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
};

type DocumentCommentThreadTreeCommentItem = {
    readonly type: "DocumentComment";
    readonly commentThread: DocumentCommentThreadModel;
    readonly comments: MessageList<DocumentCommentModel>;
    // The index of `commentItem` in `comments`.
    readonly commentItemIndex: number;
    readonly commentItem: MessageListItem<DocumentCommentModel>;
};

type DocumentCommentThreadTreeCommentInputItem = {
    readonly type: "DocumentCommentInput";
    readonly commentThread: DocumentCommentThreadModel;
    readonly comments: MessageList<DocumentCommentModel>;
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
        getNodeItem: (node, index): DocumentCommentThreadTreeItem => {
            if (index === 0) {
                return {
                    type: "DocumentCommentThreadPreview",
                    commentThread: node.commentThread,
                    comments: node.comments,
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
                };
            }

            index -= node.comments.getItemCount();

            if (index === 0) {
                return {
                    type: "DocumentCommentInput",
                    commentThread: node.commentThread,
                    comments: node.comments,
                };
            }

            throw new OutOfRangeError("Index out of bounds");
        },
    });
}

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
        initialCommentThreadsResult,
        withMobileLayout = false,
    }: {
        documentId: DocumentId;

        /**
         * The initial comment threads loaded to populate this view. We will use this
         * to construct a `DocumentCommentThreadTree` class.
         */
        initialCommentThreadsResult: {
            commentThread: DocumentCommentThreadModel;
            comments: ReadonlyArray<DocumentCommentModel>;
            otherReferencedComments: ReadonlyArray<DocumentCommentModel>;
        };

        /**
         * Use the mobile layout for a document comment thread list view even
         * on desktop.
         *
         * The mobile layout doesn't have margins and will pin the comment input for
         * single comment threads to the bottom of the screen.
         */
        withMobileLayout?: boolean;
    },
    ref: Ref<DocumentCommentThreadListViewRef>,
) {
    const {sendCommentThreadMessage} = useDocumentContentEditorWebSocket(
        documentId,
        // TODO(calebmer): Should load this when page is expanded
        null,
    );

    const isActuallyMobile = useIsMobile();
    const isMobile = isActuallyMobile || withMobileLayout;

    const context = useAppContext();
    const viewRef = useRef<VirtualizedScrollViewRef>(null);

    const [tree, setTree] = useState(() =>
        createEmptyDocumentCommentThreadTree().insertNodesAtEnd([
            {
                commentThread: initialCommentThreadsResult.commentThread,
                comments: MessageList.new<DocumentCommentModel>({
                    messageCount: initialCommentThreadsResult.commentThread.commentCount,
                    lastMessageChangeTime:
                        initialCommentThreadsResult.commentThread.lastCommentChangeTime,
                }).loadMessages({
                    messageCount: initialCommentThreadsResult.commentThread.commentCount,
                    messages: initialCommentThreadsResult.comments,
                    otherReferencedMessages: initialCommentThreadsResult.otherReferencedComments,
                }),
            },
        ]),
    );

    // Always pin the comment input to the bottom of the list view on mobile
    // layout of a single comment thread.
    const isSingleMobileCommentThreadWithPinnedCommentInput = isMobile && tree.getNodeCount() === 1;

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
                    const nodeResult = tree.getNodeByItemIndex(nextIndex);
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
                                await getDocumentCommentsFromStart(context, {
                                    documentId: node.commentThread.documentId,
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
                                await getDocumentCommentsFromEnd(context, {
                                    documentId: node.commentThread.documentId,
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
        onUpdateMessageContent: async ({roomKey, messageIndex, content}) => {
            // NOCOMMIT: Implement this!
            throw new UnimplementedError("TODO");
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

            const nodeResult = tree.getNodeByKey(commentThreadId);
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
            const item = assertExists(tree.getItem(index));
            switch (item.type) {
                case "DocumentCommentThreadPreview": {
                    // All comment threads should be in the same document.
                    assert(item.commentThread.documentId === documentId);

                    // NOCOMMIT
                    return {
                        key: `DocumentCommentThreadPreview:${item.commentThread.id}`,
                        minHeight: 50,
                        node: null,
                    };
                }
                case "DocumentComment": {
                    return renderMessageListItem<DocumentCommentRoomKey, DocumentCommentModel>({
                        messageNoun: "comment",
                        messages: item.comments,
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
                            await sendCommentThreadMessage(item.commentThread.id, {
                                type: "DeleteMessage",
                                messageIndex: message.index,
                            });
                        },
                        getMessageUrl: commentIndex => {
                            // NOCOMMIT
                            throw new UnimplementedError("TODO");
                        },
                    });
                }
                case "DocumentCommentInput": {
                    // NOCOMMIT
                    return {
                        key: `DocumentCommentInput:${item.commentThread.id}`,
                        minHeight: 50,
                        node: null,
                    };
                }
                default:
                    throw exhaustive(item);
            }
        },
        [
            tree,
            documentId,
            messageEditing,
            highlightComment,
            handleJumpToComment,
            sendCommentThreadMessage,
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
                    backgroundColor: isSingleMobileCommentThreadWithPinnedCommentInput
                        ? "grey-0"
                        : undefined,
                })}
            >
                <VirtualizedScrollView
                    ref={viewRef}
                    bufferedItemHeight={bufferedMessageViewHeight}
                    itemCount={
                        // Don't render the comment input (which should be the last item) if we are
                        // pinning the comment input to the bottom of the view.
                        tree.getItemCount() -
                        (isSingleMobileCommentThreadWithPinnedCommentInput ? 1 : 0)
                    }
                    renderItem={renderItem}
                    onRenderedRangeChange={tryLoadingMoreData}
                />
                {isSingleMobileCommentThreadWithPinnedCommentInput &&
                    (() => {
                        const item = tree.getItem(tree.getItemCount() - 1);
                        assert(item?.type === "DocumentCommentInput");

                        const replyingToCommentIndex =
                            replyingToCommentIndexByCommentThreadId.get(item.commentThread.id) ??
                            null;
                        const replyingToComment =
                            replyingToCommentIndex !== null
                                ? item.comments.getLoadedMessageIfExists(replyingToCommentIndex)
                                : null;

                        return (
                            <MessageInput
                                messages={item.comments}
                                onUpdateMessages={update =>
                                    setTree(tree =>
                                        tree.updateNode(item.commentThread.id, node => ({
                                            ...node,
                                            comments: update(node.comments),
                                        })),
                                    )
                                }
                                createMessage={async input => {
                                    await sendCommentThreadMessage(item.commentThread.id, {
                                        type: "CreateMessage",
                                        ...input,
                                    });
                                }}
                                messageEditing={messageEditing}
                                replyingToMessage={replyingToComment}
                                onClearReplyingToMessage={() => {
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
                                onJumpToMessage={handleJumpToComment}
                                onShowTypingIndicator={() => {
                                    sendCommentThreadMessage(item.commentThread.id, {
                                        type: "StartTyping",
                                    })
                                        // Don't show an error updating typing indicators to the user. We will see an
                                        // error in our logs but the user won't see any weird behavior if the
                                        // request fails.
                                        .catch(error =>
                                            context.tracer
                                                .getRoot()
                                                .logUncaughtException(
                                                    "Couldn't update typing indicator",
                                                    error,
                                                ),
                                        );
                                }}
                                onHideTypingIndicator={() => {
                                    sendCommentThreadMessage(item.commentThread.id, {
                                        type: "StopTyping",
                                    })
                                        // Don't show an error updating typing indicators to the user. We will see an
                                        // error in our logs but the user won't see any weird behavior if the
                                        // request fails.
                                        .catch(error =>
                                            context.tracer
                                                .getRoot()
                                                .logUncaughtException(
                                                    "Couldn't update typing indicator",
                                                    error,
                                                ),
                                        );
                                }}
                            />
                        );
                    })()}
            </div>
        </>
    );
}
