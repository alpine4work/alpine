import {ArrowArcLeft, ArrowUp, X} from "phosphor-react";
import {Ref, RefObject, useEffect, useMemo, useRef, useState} from "react";
import {useNavigate} from "react-router-dom";
import {AccountAvatar} from "~/client/accounts/account_avatar";
import {AccountShortName} from "~/client/accounts/account_short_name";
import {ContentEditor, ContentEditorRef} from "~/client/content/content_editor";
import {ContentEditorState} from "~/client/content/content_editor_state";
import {ContentView} from "~/client/content/content_view";
import {Box} from "~/client/design/box";
import {FocusRing} from "~/client/design/focus_ring";
import {getRemPxWithoutListening} from "~/client/design/helpers/use_rem_px";
import {IconButton} from "~/client/design/icon_button";
import {useShowToast} from "~/client/design/toast";
import {PostRealtimeActions, usePostRealtime} from "~/client/forum/use_post_realtime";
import {useLayoutEffectWithoutServerSideWarning} from "~/client/helpers/lifecycle/use_layout_effect_without_server_side_warning";
import {MessageList} from "~/client/messaging/message_list";
import {
    getTruncatedMessageContentForReplyPreview,
    messageBubbleMarginLeft,
    messageViewActionsWidth,
    messageViewBubbleBorderRadius,
    messageViewBubblePaddingX,
    messageViewBubblePaddingY,
    messageViewMargin,
    messageViewMergedMargin,
    messageViewPreviewScale,
    messageViewReplyPreviewBubbleOpacity,
    messageViewReplyPreviewOpacity,
    shouldMergeMessages,
} from "~/client/messaging/message_view";
import {useSpaceContext} from "~/client/spaces/space_context";
import {VirtualizedScrollViewRef} from "~/client/virtualized/virtualized_scroll_view";
import {isContentEmpty} from "~/shared/content/is_content_empty";
import {
    MessageContent,
    emptyMessageContentWithReferences,
} from "~/shared/content/message_content_schema";
import {
    RemLength,
    addRemLengths,
    convertRemLengthToPx,
    parseRemLengthNumber,
    spacing,
} from "~/shared/design/spacing";
import {runPromiseWithoutAwaiting} from "~/shared/helpers/async/run_promise_without_awaiting";
import {scheduleMicrotask} from "~/shared/helpers/async/schedule_microtask";
import {assertExists} from "~/shared/helpers/control/assert_exists";
import {areRangesOverlapping} from "~/shared/helpers/geometry/are_ranges_overlapping";
import {generateId} from "~/shared/id/id";
import {OptimisticMessageInterface} from "~/shared/models/message_interface";
import {PostCommentModel, PostModel} from "~/shared/models/post_model";
import {contentViewStyles, sprinkles} from "~/shared/styles/styles";

export const postCommentInputMinHeight: RemLength = "3.5rem";

export function PostCommentInput({
    post,
    viewRef,
    actionsRef,
    postComments,
    onUpdatePostComments,
    replyingToPostComment: _replyingToPostComment,
    onClearReplyingToPostComment,
    onJumpToPostComment,
}: {
    post: PostModel;
    viewRef: RefObject<VirtualizedScrollViewRef>;
    actionsRef: Ref<PostRealtimeActions>;
    postComments: MessageList<PostCommentModel>;
    onUpdatePostComments: (
        update: (postComments: MessageList<PostCommentModel>) => MessageList<PostCommentModel>,
    ) => void;
    replyingToPostComment: PostCommentModel | null;
    onClearReplyingToPostComment: () => void;
    onJumpToPostComment: (postCommentIndex: number) => void;
}) {
    const navigate = useNavigate();
    const showToast = useShowToast();
    const {currentAccount} = useSpaceContext();
    const editorRef = useRef<ContentEditorRef>(null);
    const [state, setState] = useState(() =>
        ContentEditorState.create<MessageContent>(emptyMessageContentWithReferences),
    );

    // We connect to realtime in our `<PostCommentInput>` component. When comments
    // are open this component is always rendered and we only want to connect to
    // realtime when comments are open so works out.
    const {actions} = usePostRealtime({
        postId: post.id,
        actionsRef,
        postComments,
        onUpdatePostComments,
    });

    const replyingToPostComment = useMemo(() => {
        if (!_replyingToPostComment) return null;

        return {
            comment: _replyingToPostComment,
            truncatedContent: getTruncatedMessageContentForReplyPreview({
                message: _replyingToPostComment,
                messageStartOfSentenceNoun: "Comment",
            }),
        };
    }, [_replyingToPostComment]);

    // Focus the comment input whenever the comment we're replying to changes.
    const replyingToPostCommentIndex = replyingToPostComment?.comment.index ?? null;
    useEffect(() => {
        if (replyingToPostCommentIndex === null) return;
        const editor = assertExists(editorRef.current);
        editor.focus();
    }, [replyingToPostCommentIndex]);

    const submitPostComment = () => {
        const content = state.getContent();
        if (isContentEmpty(content.doc)) return;

        const optimisticComment: OptimisticMessageInterface = {
            isOptimistic: true,
            optimisticId: generateId(),
            optimisticRequestErrorState: {hasError: false},
            author: currentAccount,
            createdTime: new Date(),
            payload: {
                type: "Content",
                parentMessageIndex: replyingToPostComment?.comment.index ?? null,
                content,
                contentUpdatedTime: null,
            },
            getRoomKey: () => post.id,
        };

        onUpdatePostComments(postComments => postComments.addOptimisticMessage(optimisticComment));

        setState(ContentEditorState.create(emptyMessageContentWithReferences));
        onClearReplyingToPostComment();

        const createPostComment = () => {
            runPromiseWithoutAwaiting(async () => {
                try {
                    await actions.createPostComment({
                        parentCommentIndex: replyingToPostComment?.comment.index ?? null,
                        content: content.doc,
                    });
                } catch (error) {
                    // TODO(calebmer): If you scroll away form the post and `usePostRealtime()`
                    // unmounts this will error even if the comment is successfully created in the
                    // background. Maybe we should keep our WebSocket alive while there are
                    // unacknowledged messages for some timeout?
                    showToast({
                        type: "Error",
                        title: "Couldn’t create comment",
                        error,
                    });

                    onUpdatePostComments(postComments =>
                        postComments.updateOptimisticMessage(
                            optimisticComment.optimisticId,
                            optimisticMessage => ({
                                ...optimisticMessage,
                                optimisticRequestErrorState: {
                                    hasError: true,
                                    retry: () => {
                                        // Clear the error when we are retrying then call this
                                        // function again.
                                        onUpdatePostComments(postComments =>
                                            postComments.updateOptimisticMessage(
                                                optimisticComment.optimisticId,
                                                optimisticMessage => ({
                                                    ...optimisticMessage,
                                                    optimisticRequestErrorState: {
                                                        hasError: false,
                                                    },
                                                }),
                                            ),
                                        );

                                        createPostComment();
                                    },
                                },
                            }),
                        ),
                    );
                }
            });
        };

        createPostComment();
    };

    // When new comments are added, we may want to scroll our view down so that the
    // user can see the new comments. This effect performs that adjustment. We
    // perform the adjustment in the `<PostCommentInput>` component which will
    // always be mounted when the post's comment section is open.
    const lastPostCommentCountRef = useRef(postComments.getMessageCount());
    useLayoutEffectWithoutServerSideWarning(() => {
        const lastPostCommentCount = lastPostCommentCountRef.current;
        const postCommentCount = postComments.getMessageCount();
        lastPostCommentCountRef.current = postCommentCount;

        // No new comments, don't perform a scroll adjustment.
        if (lastPostCommentCount === postCommentCount) return;

        const run = () => {
            const view = assertExists(viewRef.current);

            let newPostCommentsOffset: number | null = null;
            let newPostCommentsHeight = 0;
            for (
                let postCommentIndex = lastPostCommentCount;
                postCommentIndex < postCommentCount;
                postCommentIndex++
            ) {
                const position = view.getPositionByKeyIfExists(
                    `PostComment:${post.id}:${postCommentIndex}`,
                );

                // If any position doesn't exist, don't perform a scroll adjustment.
                if (!position) return;

                if (newPostCommentsOffset === null) newPostCommentsOffset = position.offset;
                newPostCommentsHeight += position.height;
            }

            // No new comments were found.
            if (newPostCommentsOffset === null) return;

            const previousPostComment =
                lastPostCommentCount > 0
                    ? postComments.getMessage(lastPostCommentCount - 1).message
                    : null;
            const firstNewPostComment = postComments.getMessage(lastPostCommentCount).message;

            const remPx = getRemPxWithoutListening();

            const maybeNewScrollOffset =
                view.getScrollOffset() +
                newPostCommentsHeight -
                // When a new message is added we also remove some margin from the previous
                // message. Adjust our new scroll height so we don't overshoot and consider the
                // fact that some margin is lost.
                (lastPostCommentCount > 0 &&
                previousPostComment &&
                firstNewPostComment &&
                shouldMergeMessages(previousPostComment, firstNewPostComment)
                    ? convertRemLengthToPx(spacing[messageViewMargin], remPx) -
                      convertRemLengthToPx(spacing[messageViewMergedMargin], remPx)
                    : 0);

            const viewHeightWithoutCommentInput =
                view.getHeight() - convertRemLengthToPx(postCommentInputMinHeight, remPx);
            if (
                // If the new comments are completely visible with our existing scroll offset
                // then don't perform an adjustment.
                !(
                    view.getScrollOffset() <= newPostCommentsOffset &&
                    newPostCommentsOffset + newPostCommentsHeight <=
                        view.getScrollOffset() + viewHeightWithoutCommentInput
                ) &&
                // Only set the new scroll offset if it would put the new messages onscreen.
                // Otherwise the messages you're looking at will jump in a way that doesn't
                // make sense.
                areRangesOverlapping(
                    maybeNewScrollOffset,
                    maybeNewScrollOffset + viewHeightWithoutCommentInput,
                    newPostCommentsOffset,
                    newPostCommentsOffset + newPostCommentsHeight,
                )
            ) {
                view.setScrollOffset(maybeNewScrollOffset);
            }
        };

        // Run our effect after a microtask so that refs from the parent component
        // are populated.
        let isCancelled = false;
        scheduleMicrotask(() => {
            if (isCancelled) return;
            run();
        });
        return () => {
            isCancelled = true;
        };
    }, [post.id, postComments, viewRef]);

    const isSendButtonDisabled = isContentEmpty(state.getDoc());

    return (
        <Box data-testid={`PostCommentInput:${post.id}`}>
            {replyingToPostComment &&
                (() => {
                    const height = addRemLengths(
                        spacing["1.5"],
                        contentViewStyles.truncatedHeight,
                        spacing["1.5"],
                    );

                    const scaledHeight = `${
                        Math.round(parseRemLengthNumber(height) * messageViewPreviewScale * 16) / 16
                    }rem`;

                    return (
                        <Box
                            position="relative"
                            paddingBottom="3"
                            style={{
                                paddingLeft: addRemLengths(messageBubbleMarginLeft, spacing["2"]),
                                paddingRight: addRemLengths(
                                    spacing["2"],
                                    spacing["3"],
                                    spacing[messageViewActionsWidth],
                                    spacing["3"],
                                ),
                            }}
                        >
                            <Box
                                paddingLeft="1.5"
                                paddingBottom="1"
                                display="flex"
                                alignItems="center"
                                gap="0.5"
                                fontSize="50"
                                fontStyle="truncate"
                            >
                                <ArrowArcLeft size={spacing["3"]} />
                                <span>
                                    Replying to{" "}
                                    <span className={sprinkles({fontStyle: "bold"})}>
                                        <AccountShortName
                                            account={replyingToPostComment.comment.author}
                                        />
                                    </span>
                                </span>
                            </Box>
                            <Box style={{height: scaledHeight}}>
                                <FocusRing>
                                    <Box
                                        // This is a simulated link. When the user clicks on it our code navigates us
                                        // to the right message instead of relying on browser URL navigation.
                                        //
                                        // See: https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Roles/link_role
                                        role="link"
                                        tabIndex={0}
                                        // We don't use a pointer cursor for buttons in our product because buttons
                                        // they clearly appear clickable. We call this a strong affordance. A reply
                                        // preview is clickable and gives some affordance (different color) but it's a
                                        // weak affordance. So we use a pointer to make this element unambiguously
                                        // clickable.
                                        //
                                        // Also, this element is semantically a link which the pointer cursor was
                                        // originally designed for.
                                        //
                                        // See: https://medium.com/simple-human/buttons-shouldnt-have-a-hand-cursor-b11e99ca374b
                                        cursor="pointer"
                                        position="relative"
                                        zIndex="0"
                                        display="inline-block"
                                        maxWidth="full"
                                        paddingX={messageViewBubblePaddingX}
                                        paddingY={messageViewBubblePaddingY}
                                        borderRadius={messageViewBubbleBorderRadius}
                                        style={{
                                            opacity: messageViewReplyPreviewOpacity,
                                            transform: `scale(${messageViewPreviewScale})`,
                                            transformOrigin: "0% 0% 0",
                                        }}
                                        onClick={() =>
                                            onJumpToPostComment(replyingToPostComment.comment.index)
                                        }
                                        onKeyDown={event => {
                                            if (event.key === "Enter") {
                                                event.preventDefault();
                                                onJumpToPostComment(
                                                    replyingToPostComment.comment.index,
                                                );
                                                return;
                                            }

                                            if (event.key === " ") {
                                                event.preventDefault();
                                                onJumpToPostComment(
                                                    replyingToPostComment.comment.index,
                                                );
                                                return;
                                            }
                                        }}
                                    >
                                        <Box
                                            position="absolute"
                                            inset="0"
                                            zIndex="-10"
                                            borderRadius={messageViewBubbleBorderRadius}
                                            backgroundColor="grey-5"
                                            style={{opacity: messageViewReplyPreviewBubbleOpacity}}
                                        />
                                        <Box overflow="hidden" pointerEvents="none">
                                            <ContentView
                                                isInert={true}
                                                isTruncated={true}
                                                content={replyingToPostComment.truncatedContent}
                                                onNavigate={navigate}
                                            />
                                        </Box>
                                    </Box>
                                </FocusRing>
                            </Box>
                            <Box position="absolute" top="0" right="5">
                                <IconButton
                                    size="xs"
                                    description="Cancel reply"
                                    withoutTooltip={true}
                                    onPress={onClearReplyingToPostComment}
                                >
                                    <X />
                                </IconButton>
                            </Box>
                        </Box>
                    );
                })()}
            <Box overflowX="hidden" display="flex" paddingX="5">
                <Box display="flex" alignItems="flex-end">
                    <Box paddingY="0.5">
                        <AccountAvatar account={currentAccount} size="7" />
                    </Box>
                </Box>
                <FocusRing isVisibleWhenFocusWithin={true}>
                    <Box
                        flexGrow="1"
                        overflowX="hidden"
                        marginX="2"
                        backgroundColor="grey-5"
                        borderRadius={messageViewBubbleBorderRadius}
                    >
                        <Box maxHeight="96" overflowX="hidden" overflowY="scroll">
                            <ContentEditor
                                ref={editorRef}
                                state={state}
                                onChange={setState}
                                onNavigate={navigate}
                                aria-label="New comment"
                                placeholder="Write a comment…"
                                className={sprinkles({
                                    paddingX: messageViewBubblePaddingX,
                                    paddingY: messageViewBubblePaddingY,
                                })}
                                onEnterFromPhysicalKeyboard={submitPostComment}
                            />
                        </Box>
                    </Box>
                </FocusRing>
                <Box display="flex" alignItems="flex-end">
                    <Box paddingY="0.5">
                        <IconButton
                            variant="accent"
                            description="Send comment"
                            isDisabled={isSendButtonDisabled}
                            onPress={submitPostComment}
                        >
                            <ArrowUp
                                size={spacing["4"]}
                                weight={!isSendButtonDisabled ? "bold" : undefined}
                            />
                        </IconButton>
                    </Box>
                </Box>
            </Box>
        </Box>
    );
}
