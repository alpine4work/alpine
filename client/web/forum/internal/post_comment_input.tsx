import {Step} from "prosemirror-transform";
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
import {createAccessPolicyStore} from "~/client/web/access/create_access_policy_store.js";
import {MessageInputRef} from "~/client/web/content/messaging/message_input_base.js";
import {useAppContext} from "~/client/web/context/app_context.js";
import {Box} from "~/client/web/design/box.js";
import {useReporter} from "~/client/web/design/reporter.js";
import {PostListHeader} from "~/client/web/forum/post_list.js";
import {useMergedRefs} from "~/client/web/helpers/refs/use_merged_refs.js";
import {useStore} from "~/client/web/helpers/use_store.js";
import {DisabledMessageInput} from "~/client/web/messaging/disabled_message_input.js";
import {MessageEditing} from "~/client/web/messaging/message_editing.js";
import {MessageInput, MessageInputRestoreState} from "~/client/web/messaging/message_input.js";
import {MessageList, MessageListItem} from "~/client/web/messaging/message_list.js";
import {JumpToMessageRangeOptions} from "~/client/web/messaging/use_jump_to_message_range.js";
import {JumpToPostRangeOptions} from "~/client/web/messaging/use_jump_to_post_range.js";
import {useMessagingRealtime} from "~/client/web/messaging/use_messaging_realtime.js";
import {useScrollToNewMessages} from "~/client/web/messaging/use_scroll_to_new_messages.js";
import {getClientInfo, useClientInfo} from "~/client/web/remix/client_info_context.js";
import {usePlatform} from "~/client/web/remix/platform_context.js";
import {useSpacingScale} from "~/client/web/remix/spacing_scale_context.js";
import {useSiteRegistry} from "~/client/web/sites/context/site_registry_context.js";
import {useSpaceContext} from "~/client/web/spaces/context/space_context.js";
import {
    messageInputBottomBarBackgroundSlopBottom,
    messageInputMinHeightPx,
} from "~/client/web/styles/messaging_shared_styles.js";
import {inputPlaceholderStyles, sprinkles} from "~/client/web/styles/styles.js";
import {VirtualizedScrollViewRef} from "~/client/web/virtualized/virtualized_scroll_view.js";
import {useWebSocket} from "~/client/web/web_socket/use_web_socket.js";
import {
    getAccountAccessLevelAssumingSpaceAccess,
    hasAccessLevel,
} from "~/shared/access/access_policy.js";

import {RynamoEvent} from "~/shared/dynamo/rynamo_types.js";
import {FileAttachmentTarget} from "~/shared/files/file_attachment_target.js";
import {PostCommentModel, PostModel} from "~/shared/forum/post_model.js";
import {PostRealtimeEvent, PostRealtimeProtocol} from "~/shared/forum/post_realtime_protocol.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.open_source.js";
import {pickObject} from "~/shared/helpers/object/pick_object.js";
import {PostId} from "~/shared/id/types/id_types.open_source.js";
import {MessageDraft} from "~/shared/messaging/message_draft_schema.js";
import {MessageContentPayloadParent} from "~/shared/messaging/message_schema.js";
import {MessagingRealtimeEvent} from "~/shared/messaging/messaging_realtime_protocol.js";
import {PutMessageApprovalDecisionsPayload} from "~/shared/messaging/put_message_approval_decisions_payload_schema.js";
import {Reaction} from "~/shared/reactions/reaction.js";
import {getPostWithStrongReadConsistency} from "~/shared/rpc/forum_rpc_definitions.js";

export type PostRealtimeProcedures = {
    updateCommentContent: (input: {
        commentIndex: number;
        contentVersion: number;
        steps: ReadonlyArray<Step>;
    }) => Promise<{}>;
    deleteComment: (input: {commentIndex: number}) => Promise<{}>;
    setCommentReaction: (input: {
        commentIndex: number;
        contentVersion: number;
        pos: number | "Files";
        reaction: Reaction | "GenericLike";
    }) => Promise<{}>;
    deleteCommentReaction: (input: {
        commentIndex: number;
        contentVersion: number;
        pos: number | "Files";
    }) => Promise<{}>;
    putCommentApprovalDecisions: (input: {
        commentIndex: number;
        payload: PutMessageApprovalDecisionsPayload;
    }) => Promise<{}>;
};

export function PostCommentInput(props: {
    isStickyPositioned: boolean;
    inputRef?: Ref<MessageInputRef>;
    header: Memo<PostListHeader> | undefined;
    post: PostModel;
    viewRef: RefObject<VirtualizedScrollViewRef | null>;
    proceduresRef: Ref<PostRealtimeProcedures>;
    postComments: MessageList<PostCommentModel>;
    fileAttachmentTarget: Memo<FileAttachmentTarget>;
    onUpdatePostComments: (
        update: (postComments: MessageList<PostCommentModel>) => MessageList<PostCommentModel>,
    ) => void;
    postCommentEditing: MessageEditing<PostId>;
    parent: MessageContentPayloadParent | null;
    onParentClear: () => void;
    onParentChange: (parent: MessageContentPayloadParent | null) => void;
    onJumpToPostCommentRange: (options: JumpToMessageRangeOptions<PostId>) => void;
    onJumpToPostRange: (options: JumpToPostRangeOptions) => void;
    onDeletePostComment: (postCommentIndex: number) => Promise<void>;
    shouldBeConnectedToChannelRealtime: boolean;
    onPostRealtimeEvents: Memo<(events: ReadonlyArray<RynamoEvent<PostModel>>) => void>;
    restoreStateRef?: RefObject<MessageInputRestoreState | null>;
    messageDraft?: MessageDraft;
}) {
    const {currentAccount} = useSpaceContext();
    const siteRegistry = useSiteRegistry();
    const hasCommentAccessLevel = useStore(
        useMemo(() => {
            // Use the `accessPolicy` from `header` if applicable. Because we update the
            // `channel` in `header` in realtime. Whereas the `channel` preview in the
            // `PostModel` might not update in realtime.
            const accessPolicy =
                props.header?.type === "Channel" &&
                props.header.channel.id === props.post.channel.id
                    ? props.header.channel.accessPolicy
                    : props.post.channel.accessPolicy;

            return createAccessPolicyStore(accessPolicy, siteRegistry).map(accessPolicy =>
                hasAccessLevel(
                    getAccountAccessLevelAssumingSpaceAccess(accessPolicy, currentAccount?.id),
                    "Comment",
                ),
            );
        }, [props.header, props.post, siteRegistry, currentAccount?.id]),
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
    onPostRealtimeEvents,
}: ComponentProps<typeof PostCommentInput>) {
    const {currentAccount} = useSpaceContext();
    const shouldConnectToPostRealtime = currentAccount !== null;

    // We connect to realtime in our `<PostCommentInput>` component. When comments are
    // open this component is always rendered and we only want to connect to realtime
    // when comments are open so works out.
    const {isConnected, procedures, subscribeToEvents, subscribeToPongs} = useWebSocket(
        "PostRealtimeService",
        PostRealtimeProtocol,
        shouldConnectToPostRealtime ? `/api/durable-objects/posts/${post.id}` : null,
    );

    useImperativeHandle(
        proceduresRef,
        () =>
            pickObject(procedures, [
                "updateCommentContent",
                "deleteComment",
                "setCommentReaction",
                "deleteCommentReaction",
                "putCommentApprovalDecisions",
            ]),
        [procedures],
    );

    useMessagingRealtime({
        isConnected,
        messages: postComments,
        onUpdateMessages: onUpdatePostComments,
        backfillMessages: useCallback(
            async ({
                checkpoint,
                clientMessageCount: clientCommentCount,
                newMessageLimit: newCommentLimit,
            }) => {
                const {
                    commentCount: messageCount,
                    newComments: newMessages,
                    newOtherReferencedComments: newOtherReferencedMessages,
                    commentUpdatesResult: messageUpdatesResult,
                    typingStateByConnectionId,
                } = await procedures.backfillComments({
                    checkpoint,
                    clientCommentCount,
                    newCommentLimit,
                });

                return {
                    messageCount,
                    newMessages,
                    newOtherReferencedMessages,
                    messageUpdatesResult,
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
                        case "RealtimeEvents": {
                            // If we'll receive post update events from our channel realtime durable connection
                            // then don't handle them here.
                            if (!shouldBeConnectedToChannelRealtime) {
                                onPostRealtimeEvents(event.events);
                            }
                            break;
                        }
                        default:
                            throw exhaustive(event);
                    }
                };

                return subscribeToEvents(actualSubscriber);
            },
            [onPostRealtimeEvents, shouldBeConnectedToChannelRealtime, subscribeToEvents],
        ),
        subscribeToPongs,
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
        parent,
        onParentClear,
        onParentChange,
        onJumpToPostCommentRange,
        onJumpToPostRange,
        onDeletePostComment,
        shouldBeConnectedToChannelRealtime,
        onPostRealtimeEvents,
        restoreStateRef,
        messageDraft,
    } = props;

    const context = useAppContext();
    const reporter = useReporter();

    const inputRef = useRef<MessageInputRef>(null);

    const {isConnected, procedures} = usePostCommentInputRealtime(props);

    // Whenever we connect to our WebSocket, we may need to reload our realtime item in
    // case we missed any realtime updates while we were disconnected. Going forward we
    // should receive realtime updates from `subscribeToEvents()`.
    //
    // This code was copied from `useRynamoItem()`.
    const lastReloadedPostIdRef = useRef<PostId | null>(null);
    useEffect(() => {
        // If we're connected to channel realtime, we don't need to backfill realtime
        // updates on connection. Since we'll be backfilling at the channel realtime level.
        if (shouldBeConnectedToChannelRealtime) return;

        if (!isConnected) {
            // Clear the last reloaded key when we go disconnect. That way when we reconnect we
            // will reload the item.
            lastReloadedPostIdRef.current = null;
            return;
        }

        if (lastReloadedPostIdRef.current === post.id) return;
        lastReloadedPostIdRef.current = post.id;

        getPostWithStrongReadConsistency(context, {postId: post.id}).then(
            ({post}) => {
                onPostRealtimeEvents([
                    {
                        type: "PutItem",
                        item: post,
                        // NOTE(calebmer): Right now when `shouldBeConnectedToChannelRealtime` is false
                        // we're updating an individual post instead of posts backed by an index query. So
                        // we don't need `indexes` for now.
                        indexes: new Map(),
                    },
                ]);
            },
            error => {
                reporter.logErrorWithoutDisplaying("Failed to reload realtime item", error);
            },
        );
    }, [
        post.id,
        onPostRealtimeEvents,
        shouldBeConnectedToChannelRealtime,
        context,
        reporter,
        isConnected,
    ]);

    // We perform the scroll adjustment for new messages in the `<PostCommentInput>`
    // component which will always be mounted when the post's comment section is open.
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

    const draftSurface = useMemo(
        () => ({type: "PostComment" as const, postId: post.id}),
        [post.id],
    );

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
                    parent: input.parent,
                    content: input.content,
                    fileIds: input.fileIds,
                    createdTimeZone: getClientInfo().timeZone,
                });
            }}
            fileAttachmentTarget={fileAttachmentTarget}
            messageEditing={postCommentEditing}
            postRoom={post}
            parent={parent}
            onParentClear={onParentClear}
            onParentChange={onParentChange}
            onJumpToMessageRange={onJumpToPostCommentRange}
            onJumpToPostRange={onJumpToPostRange}
            onDeleteMessage={onDeletePostComment}
            onShowTypingIndicator={() => {
                // Don't show an error updating typing indicators to the user. We will see an error
                // in our logs but the user won't see any weird behavior if the request fails.
                procedures
                    .startTypingInCommentInput({})
                    .catch(error =>
                        reporter.logErrorWithoutDisplaying(
                            "Couldn\u2019t update typing indicator",
                            error,
                        ),
                    );
            }}
            onHideTypingIndicator={() => {
                // Don't show an error updating typing indicators to the user. We will see an error
                // in our logs but the user won't see any weird behavior if the request fails.
                procedures
                    .stopTypingInCommentInput({})
                    .catch(error =>
                        reporter.logErrorWithoutDisplaying(
                            "Couldn\u2019t update typing indicator",
                            error,
                        ),
                    );
            }}
            messageDraftSurface={draftSurface}
            messageDraft={messageDraft}
            shouldFlushDraftOnUnmount={true}
            restoreStateRef={restoreStateRef}
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
                    // Our native mobile wrapper looks for compositing layers created from an element
                    // with an ID that starts with `nmbb-` and ties their position to the tab bar and
                    // software keyboard. So we get smooth animations while the keyboard opens or the
                    // tab bar shifts offscreen. To create a compositing layer we need to set
                    // `will-change: transform`. It's not specified that `will-change: transform` MUST
                    // create a compositing layer, instead some browser engines implement this hint
                    // themselves as an optimization.
                    //
                    // It so happens that WebKit is one of those browsers. Here's the code in WebKit
                    // that does this: [part 1][1], [part 2][2].
                    //
                    // [1]:
                    //     https://github.com/WebKit/WebKit/blob/b3b7144bd152111660f81e9aecb76b0a4a8642ab/Source/WebCore/rendering/RenderLayerCompositor.cpp#L2831
                    // [2]:
                    //     https://github.com/WebKit/WebKit/blob/b3b7144bd152111660f81e9aecb76b0a4a8642ab/Source/WebCore/rendering/style/WillChangeData.cpp#L158
                    willChange: isBottomBar && clientInfo.isNativeMobile ? "transform" : undefined,
                    // Set `transform` to its initial value assuming the tab bar is up.
                    transform:
                        isBottomBar && clientInfo.isNativeMobile
                            ? "translateY(calc(var(--window-safe-area-inset-bottom, 0px) - var(--safe-area-inset-bottom, 0px)))"
                            : undefined,
                }}
                // Suppress React hydration warnings in our native mobile app. The native mobile
                // app sets the `transform` property on this element. Sometimes before React
                // finishes hydrating. This is expected, React can ignore the difference.
                suppressHydrationWarning={
                    isBottomBar && clientInfo.isNativeMobile ? true : undefined
                }
            >
                <DisabledMessageInput>
                    Can&#x2019;t comment on posts in{" "}
                    {platform === "mobile" ? (
                        "this channel"
                    ) : (
                        <span
                            className={sprinkles({color: "grey-50"})}
                            style={{fontWeight: inputPlaceholderStyles.fontWeight + 100}}
                        >
                            {post.channel.name}
                        </span>
                    )}
                </DisabledMessageInput>
            </Box>
        </Box>
    );
}
