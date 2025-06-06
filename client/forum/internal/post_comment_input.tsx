import {ArrowUp, Plus} from "phosphor-react";
import {
    ComponentProps,
    Memo,
    Ref,
    RefObject,
    useCallback,
    useEffect,
    useId,
    useImperativeHandle,
    useMemo,
    useRef,
} from "react";
import {MessageInputRef} from "~/client/content/messaging/message_input_base.js";
import {useAppContext} from "~/client/context/app_context.js";
import {Box} from "~/client/design/box.js";
import {IconButton} from "~/client/design/icon_button.js";
import {useReporter} from "~/client/design/reporter.js";
import {PostListHeader} from "~/client/forum/post_list.js";
import {useMergedRefs} from "~/client/helpers/refs/use_merged_refs.js";
import {MessageEditing} from "~/client/messaging/message_editing.js";
import {MessageInput} from "~/client/messaging/message_input.js";
import {MessageList, MessageListItem} from "~/client/messaging/message_list.js";
import {useMessagingRealtime} from "~/client/messaging/use_messaging_realtime.js";
import {useScrollToNewMessages} from "~/client/messaging/use_scroll_to_new_messages.js";
import {useClientInfo} from "~/client/remix/client_info_context.js";
import {usePlatform} from "~/client/remix/platform_context.js";
import {useSpacingScale} from "~/client/remix/spacing_scale_context.js";
import {useSpaceContext} from "~/client/spaces/space_context.js";
import {
    messageInputBottomBarBackgroundSlopBottom,
    messageInputEditorBorderRadiusPx,
    messageInputEditorIconButtonNegativeMarginX,
    messageInputEditorIconButtonSize,
    messageInputEditorMinHeightPx,
    messageInputEditorPaddingX,
    messageInputEditorPaddingYPx,
    messageInputMinHeightPx,
    messageInputPaddingY,
} from "~/client/styles/messaging_shared_styles.js";
import {contentStyles, inputPlaceholderStyles, sprinkles} from "~/client/styles/styles.js";
import {VirtualizedScrollViewRef} from "~/client/virtualized/virtualized_scroll_view.js";
import {useWebSocket} from "~/client/web_socket/use_web_socket.js";
import {
    getAccountAccessLevelAssumingSpaceAccess,
    hasAccessLevel,
} from "~/shared/access/access_policy.js";
import {screenPaddingX, spacing} from "~/shared/design/core/spacing.js";
import {DynamoGeneralRealtimeEvent} from "~/shared/dynamo/dynamo_general_realtime_types.js";
import {FileAttachmentTarget} from "~/shared/files/file_attachment_target.js";
import {PostCommentModel, PostModel} from "~/shared/forum/post_model.js";
import {PostRealtimeEvent, PostRealtimeProtocol} from "~/shared/forum/post_realtime_protocol.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {pickObject} from "~/shared/helpers/object/pick_object.js";
import {PostId} from "~/shared/id/types/id_types.js";
import {MessageContent} from "~/shared/messaging/message_content_schema.js";
import {MessagingRealtimeEvent} from "~/shared/messaging/messaging_realtime_protocol.js";
import {getPostWithStrongReadConsistency} from "~/shared/rpc/forum_rpc_definitions.js";

export type PostRealtimeProcedures = {
    updateCommentContent: (input: {commentIndex: number; content: MessageContent}) => Promise<{}>;
    deleteComment: (input: {commentIndex: number}) => Promise<{}>;
};

export function PostCommentInput(props: {
    isStickyPositioned: boolean;
    inputRef?: Ref<MessageInputRef>;
    header: Memo<PostListHeader> | undefined;
    post: PostModel;
    viewRef: RefObject<VirtualizedScrollViewRef>;
    proceduresRef: Ref<PostRealtimeProcedures>;
    postComments: MessageList<PostCommentModel>;
    fileAttachmentTarget: Memo<FileAttachmentTarget>;
    onUpdatePostComments: (
        update: (postComments: MessageList<PostCommentModel>) => MessageList<PostCommentModel>,
    ) => void;
    postCommentEditing: MessageEditing<PostId>;
    replyingToPostComment: PostCommentModel | null;
    onClearReplyingToPostComment: () => void;
    onJumpToPostComment: (postComment: PostCommentModel) => void;
    onDeletePostComment: (postCommentIndex: number) => Promise<void>;
    shouldBeConnectedToChannelRealtime: boolean;
    onPostRealtimeEventTransaction: Memo<
        (event: {
            readTime: Date;
            eventTransaction: ReadonlyArray<DynamoGeneralRealtimeEvent<PostModel>>;
        }) => void
    >;
}) {
    const {currentAccount} = useSpaceContext();

    const hasCommentAccessLevel = useMemo(
        () =>
            hasAccessLevel(
                getAccountAccessLevelAssumingSpaceAccess(
                    // Use the `accessPolicy` from `header` if applicable. Because we update
                    // the `channel` in `header` in realtime. Whereas the `channel` preview
                    // in the `PostModel` might not update in realtime.
                    props.header?.type === "Channel" &&
                        props.header.channel.id === props.post.channel.id
                        ? props.header.channel.accessPolicy
                        : props.post.channel.accessPolicy,
                    currentAccount?.id,
                ),
                "Comment",
            ),
        [currentAccount?.id, props.header, props.post.channel.accessPolicy, props.post.channel.id],
    );

    if (!hasCommentAccessLevel) {
        return <PostCommentDisabledInput {...props} />;
    } else {
        return <PostCommentEnabledInput {...props} />;
    }
}

function usePostCommentInputRealtime({
    post,
    proceduresRef,
    postComments,
    onUpdatePostComments,
    shouldBeConnectedToChannelRealtime,
    onPostRealtimeEventTransaction,
}: ComponentProps<typeof PostCommentInput>) {
    // We connect to realtime in our `<PostCommentInput>` component. When comments
    // are open this component is always rendered and we only want to connect to
    // realtime when comments are open so works out.
    const {isConnected, procedures, subscribeToEvents} = useWebSocket(
        "PostRealtimeService",
        PostRealtimeProtocol,
        `/api/durable-objects/posts/${post.id}`,
    );

    useImperativeHandle(
        proceduresRef,
        () => pickObject(procedures, ["updateCommentContent", "deleteComment"]),
        [procedures],
    );

    useMessagingRealtime({
        messages: postComments,
        onUpdateMessages: onUpdatePostComments,
        isConnected,
        backfillMessages: useCallback(
            async ({
                clientMessageCount: clientCommentCount,
                clientLastMessageChangeTime: clientLastCommentChangeTime,
                newMessageLimit: newCommentLimit,
            }) => {
                const {
                    commentCount: messageCount,
                    lastCommentChangeTime: lastMessageChangeTime,
                    newComments: newMessages,
                    newOtherReferencedComments: newOtherReferencedMessages,
                    commentChangesResult: messageChangesResult,
                    typingStateByConnectionId,
                } = await procedures.backfillComments({
                    clientCommentCount,
                    clientLastCommentChangeTime,
                    newCommentLimit,
                });

                return {
                    messageCount,
                    lastMessageChangeTime,
                    newMessages,
                    newOtherReferencedMessages,
                    messageChangesResult,
                    typingStateByConnectionId,
                };
            },
            [procedures],
        ),
        subscribeToEvents: useCallback(
            (subscriber: (message: MessagingRealtimeEvent<PostCommentModel>) => void) => {
                const actualSubscriber = (event: PostRealtimeEvent) => {
                    switch (event.type) {
                        case "Comments": {
                            subscriber(event.event);
                            break;
                        }
                        case "RealtimeEventTransaction": {
                            // If we'll receive post update events from our channel realtime durable
                            // connection then don't handle them here.
                            if (!shouldBeConnectedToChannelRealtime) {
                                onPostRealtimeEventTransaction(event);
                            }
                            break;
                        }
                        default:
                            throw exhaustive(event);
                    }
                };

                return subscribeToEvents(actualSubscriber);
            },
            [onPostRealtimeEventTransaction, shouldBeConnectedToChannelRealtime, subscribeToEvents],
        ),
    });

    return {isConnected, procedures};
}

function PostCommentEnabledInput(props: ComponentProps<typeof PostCommentInput>) {
    const {
        isStickyPositioned,
        inputRef: inputRefProp,
        post,
        viewRef,
        postComments,
        fileAttachmentTarget,
        onUpdatePostComments,
        postCommentEditing,
        replyingToPostComment,
        onClearReplyingToPostComment,
        onJumpToPostComment,
        onDeletePostComment,
        shouldBeConnectedToChannelRealtime,
        onPostRealtimeEventTransaction,
    } = props;

    const context = useAppContext();
    const reporter = useReporter();

    const inputRef = useRef<MessageInputRef>(null);

    const {isConnected, procedures} = usePostCommentInputRealtime(props);

    // Whenever we connect to our WebSocket, we may need to reload our realtime
    // item in case we missed any realtime updates while we were disconnected.
    // Going forward we should receive realtime updates from `subscribeToEvents()`.
    //
    // This code was copied from `useDynamoGeneralRealtimeItem()`.
    const lastReloadedPostIdRef = useRef<PostId | null>(null);
    useEffect(() => {
        // If we're connected to channel realtime, we don't need to backfill realtime
        // updates on connection. Since we'll be backfilling at the channel realtime
        // level.
        if (shouldBeConnectedToChannelRealtime) return;

        if (!isConnected) {
            // Clear the last reloaded key when we go disconnect. That way when we
            // reconnect we will reload the item.
            lastReloadedPostIdRef.current = null;
            return;
        }

        if (lastReloadedPostIdRef.current === post.id) return;
        lastReloadedPostIdRef.current = post.id;

        getPostWithStrongReadConsistency(context, {postId: post.id}).then(
            ({readTime, post}) => {
                onPostRealtimeEventTransaction({
                    readTime,
                    eventTransaction: [
                        {
                            type: "PutItem",
                            item: post,
                            // NOTE(calebmer): Right now when `shouldBeConnectedToChannelRealtime` is false
                            // we're updating an individual post instead of posts backed by an index
                            // query. So we don't need `indexes` for now.
                            indexes: new Map(),
                        },
                    ],
                });
            },
            error => {
                reporter.logErrorWithoutDisplaying("Failed to reload realtime item", error);
            },
        );
    }, [
        isConnected,
        post.id,
        onPostRealtimeEventTransaction,
        shouldBeConnectedToChannelRealtime,
        context,
        reporter,
    ]);

    // We perform the scroll adjustment for new messages in the
    // `<PostCommentInput>` component which will always be mounted when the post's
    // comment section is open.
    useScrollToNewMessages({
        viewRef,
        inputRef,
        isInputStickyPositioned: isStickyPositioned,
        messages: postComments,
        getItemKey: useCallback(
            (item: MessageListItem<PostCommentModel>) => {
                switch (item.type) {
                    case "Loaded":
                    case "Optimistic":
                        return `PostComment:${post.id}:${item.messageIndex}`;
                    case "Unloaded":
                        return `UnloadedPostComment:${post.id}:${item.messageIndex}`;
                    case "TypingIndicators":
                        return `PostCommentsTypingIndicator:${post.id}`;
                    default:
                        throw exhaustive(item);
                }
            },
            [post.id],
        ),
    });

    return (
        <MessageInput
            ref={useMergedRefs(inputRef, inputRefProp ?? null)}
            data-testid={`PostCommentInput:${post.id}`}
            messageNoun="comment"
            isNotBottomBar={isStickyPositioned}
            messages={postComments}
            onUpdateMessages={onUpdatePostComments}
            createMessage={async input => {
                await procedures.createComment({
                    parentCommentIndex: input.parentMessageIndex,
                    content: input.content,
                    fileIds: input.fileIds,
                });
            }}
            fileAttachmentTarget={fileAttachmentTarget}
            messageEditing={postCommentEditing}
            replyingToMessage={replyingToPostComment}
            onClearReplyingToMessage={onClearReplyingToPostComment}
            onJumpToMessage={onJumpToPostComment}
            onDeleteMessage={onDeletePostComment}
            onShowTypingIndicator={() => {
                // Don't show an error updating typing indicators to the user. We will see an
                // error in our logs but the user won't see any weird behavior if the
                // request fails.
                procedures
                    .startTypingInCommentInput({})
                    .catch(error =>
                        reporter.logErrorWithoutDisplaying(
                            "Couldn't update typing indicator",
                            error,
                        ),
                    );
            }}
            onHideTypingIndicator={() => {
                // Don't show an error updating typing indicators to the user. We will see an
                // error in our logs but the user won't see any weird behavior if the
                // request fails.
                procedures
                    .stopTypingInCommentInput({})
                    .catch(error =>
                        reporter.logErrorWithoutDisplaying(
                            "Couldn't update typing indicator",
                            error,
                        ),
                    );
            }}
        />
    );
}

function PostCommentDisabledInput(props: ComponentProps<typeof PostCommentInput>) {
    const {isStickyPositioned, post} = props;

    const platform = usePlatform();
    const spacingScale = useSpacingScale();
    const clientInfo = useClientInfo();

    usePostCommentInputRealtime(props);

    const isBottomBar = !isStickyPositioned;

    const idBase = useId();
    const id = isBottomBar && clientInfo.isNativeMobile ? `nmbb-${idBase}` : idBase;

    return (
        <Box flexShrink="0">
            <Box
                id={id}
                position="relative"
                width="full"
                backgroundColor="grey-0"
                style={{
                    minHeight: !isBottomBar
                        ? messageInputMinHeightPx[platform][spacingScale]
                        : `calc(${
                              platform === "mobile"
                                  ? messageInputMinHeightPx[platform][spacingScale]
                                  : messageInputMinHeightPx[platform][spacingScale]
                          }px + var(--window-safe-area-inset-bottom, 0px))`,
                    paddingBottom: isBottomBar
                        ? clientInfo.isNativeMobile
                            ? `calc(${messageInputBottomBarBackgroundSlopBottom} + var(--window-safe-area-inset-bottom, 0px))`
                            : "var(--window-safe-area-inset-bottom, 0px)"
                        : undefined,
                    marginBottom:
                        isBottomBar && clientInfo.isNativeMobile
                            ? `-${messageInputBottomBarBackgroundSlopBottom}`
                            : undefined,
                    // Our native mobile wrapper looks for compositing layers created from an
                    // element with an ID that starts with `nmbb-` and ties their position to
                    // the tab bar and software keyboard. So we get smooth animations while the
                    // keyboard opens or the tab bar shifts offscreen. To create a compositing
                    // layer we need to set `will-change: transform`. It's not specified that
                    // `will-change: transform` MUST create a compositing layer, instead some
                    // browser engines implement this hint themselves as an optimization.
                    //
                    // It so happens that WebKit is one of those browsers. Here's the code in
                    // WebKit that does this: [part 1][1], [part 2][2].
                    //
                    // [1]: https://github.com/WebKit/WebKit/blob/b3b7144bd152111660f81e9aecb76b0a4a8642ab/Source/WebCore/rendering/RenderLayerCompositor.cpp#L2831
                    // [2]: https://github.com/WebKit/WebKit/blob/b3b7144bd152111660f81e9aecb76b0a4a8642ab/Source/WebCore/rendering/style/WillChangeData.cpp#L158
                    willChange: isBottomBar && clientInfo.isNativeMobile ? "transform" : undefined,
                    // Set `transform` to its initial value assuming the tab bar is up.
                    transform:
                        isBottomBar && clientInfo.isNativeMobile
                            ? "translateY(calc(var(--window-safe-area-inset-bottom, 0px) - var(--safe-area-inset-bottom, 0px)))"
                            : undefined,
                }}
                // Suppress React hydration warnings in our native mobile app. The native
                // mobile app sets the `transform` property on this element. Sometimes before
                // React finishes hydrating. This is expected, React can ignore the difference.
                suppressHydrationWarning={
                    isBottomBar && clientInfo.isNativeMobile ? true : undefined
                }
            >
                <Box width="full" maxWidth={contentStyles.contentMaxWidth} marginX="center">
                    <Box
                        paddingX={screenPaddingX}
                        paddingY={messageInputPaddingY}
                        marginX={messageInputEditorIconButtonNegativeMarginX}
                    >
                        <Box
                            position="relative"
                            zIndex="0"
                            style={{
                                minHeight: messageInputEditorMinHeightPx[platform][spacingScale],
                                borderRadius:
                                    messageInputEditorBorderRadiusPx[platform][spacingScale],
                            }}
                        >
                            <Box
                                pointerEvents="none"
                                position="absolute"
                                zIndex="10"
                                inset="0"
                                border="grey-10"
                                style={{
                                    borderRadius:
                                        messageInputEditorBorderRadiusPx[platform][spacingScale],
                                }}
                            />
                            <Box
                                fontStyle="truncate"
                                color="grey-40"
                                style={{
                                    ...contentStyles.paragraphFontSize,
                                    fontWeight: inputPlaceholderStyles.fontWeight,
                                    paddingTop:
                                        messageInputEditorPaddingYPx[platform][spacingScale],
                                    paddingBottom:
                                        messageInputEditorPaddingYPx[platform][spacingScale],
                                    paddingLeft: messageInputEditorPaddingX[platform],
                                    paddingRight: messageInputEditorPaddingX[platform],
                                }}
                            >
                                Can’t comment on posts in{" "}
                                {platform === "mobile" ? (
                                    // There isn't enough space on mobile to consistently render the channel name.
                                    // So on mobile only say "this channel". You should be able to see the channel
                                    // name in the header always anyway.
                                    "this channel"
                                ) : (
                                    <span
                                        className={sprinkles({color: "grey-50"})}
                                        style={{
                                            fontWeight: inputPlaceholderStyles.fontWeight + 100,
                                        }}
                                    >
                                        {post.channel.name}
                                    </span>
                                )}
                            </Box>
                            <Box
                                pointerEvents="none"
                                position="absolute"
                                left="0"
                                bottom="0"
                                zIndex="20"
                                display="flex"
                                justifyContent="center"
                                alignItems="center"
                                style={{
                                    width: messageInputEditorMinHeightPx[platform][spacingScale],
                                    height: messageInputEditorMinHeightPx[platform][spacingScale],
                                }}
                            >
                                <IconButton
                                    size={messageInputEditorIconButtonSize}
                                    description="Disabled"
                                    withoutTooltip={true}
                                    isDisabled={true}
                                    isFocusable={false}
                                >
                                    <Plus />
                                </IconButton>
                            </Box>
                            <Box
                                pointerEvents="none"
                                position="absolute"
                                right="0"
                                bottom="0"
                                zIndex="20"
                                display="flex"
                                justifyContent="center"
                                alignItems="center"
                                style={{
                                    width: messageInputEditorMinHeightPx[platform][spacingScale],
                                    height: messageInputEditorMinHeightPx[platform][spacingScale],
                                }}
                            >
                                <IconButton
                                    size={messageInputEditorIconButtonSize}
                                    variant="accent"
                                    description="Disabled"
                                    withoutTooltip={true}
                                    isDisabled={true}
                                    isFocusable={false}
                                >
                                    <ArrowUp
                                        size={spacing["4"]}
                                        style={{
                                            // Optically, this icon looks...off in our iOS native mobile app.
                                            // Presumably everywhere in Safari. If only we had a
                                            // `clientInfo.isWebKit` test.
                                            transform:
                                                clientInfo.isNativeMobile &&
                                                clientInfo.isAppleDevice
                                                    ? "translateY(0.5px)"
                                                    : undefined,
                                        }}
                                    />
                                </IconButton>
                            </Box>
                        </Box>
                    </Box>
                </Box>
            </Box>
        </Box>
    );
}
