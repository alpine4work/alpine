import {Memo, Ref, RefObject, useCallback, useEffect, useImperativeHandle, useRef} from "react";
import {MessageInputRef} from "~/client/content/messaging/message_input_base.js";
import {useAppContext} from "~/client/context/app_context.js";
import {MessageEditing} from "~/client/messaging/message_editing.js";
import {MessageInput} from "~/client/messaging/message_input.js";
import {MessageList, MessageListItem} from "~/client/messaging/message_list.js";
import {useMessagingRealtime} from "~/client/messaging/use_messaging_realtime.js";
import {useScrollToNewMessages} from "~/client/messaging/use_scroll_to_new_messages.js";
import {VirtualizedScrollViewRef} from "~/client/virtualized/virtualized_scroll_view.js";
import {useWebSocket} from "~/client/web_socket/use_web_socket.js";
import {DynamoGeneralRealtimeEvent} from "~/shared/dynamo/dynamo_general_realtime_types.js";
import {PostCommentModel, PostModel} from "~/shared/forum/post_model.js";
import {PostRealtimeEvent, PostRealtimeProtocol} from "~/shared/forum/post_realtime_protocol.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {pickObject} from "~/shared/helpers/object/pick_object.js";
import {PostId} from "~/shared/id/types/id_types.js";
import {MessageContent} from "~/shared/messaging/message_content_schema.js";
import {MessagingRealtimeEvent} from "~/shared/messaging/messaging_realtime_protocol.js";
import {messageInputMinHeight} from "~/shared/messaging/messaging_shared_styles.js";
import {getPostWithStrongReadConsistency} from "~/shared/rpc/forum_rpc_definitions.js";

export const postCommentInputMinHeight = messageInputMinHeight;

export type PostRealtimeProcedures = {
    updateCommentContent: (input: {commentIndex: number; content: MessageContent}) => Promise<{}>;
    deleteComment: (input: {commentIndex: number}) => Promise<{}>;
};

export function PostCommentInput({
    isStickyPositioned,
    post,
    viewRef,
    proceduresRef,
    postComments,
    onUpdatePostComments,
    postCommentEditing,
    replyingToPostComment,
    onClearReplyingToPostComment,
    onJumpToPostComment,
    onDeletePostComment,
    shouldBeConnectedToChannelRealtime,
    onPostRealtimeEventTransaction,
}: {
    isStickyPositioned: boolean;
    post: PostModel;
    viewRef: RefObject<VirtualizedScrollViewRef>;
    proceduresRef: Ref<PostRealtimeProcedures>;
    postComments: MessageList<PostCommentModel>;
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
    const context = useAppContext();

    const inputRef = useRef<MessageInputRef>(null);

    // We connect to realtime in our `<PostCommentInput>` component. When comments
    // are open this component is always rendered and we only want to connect to
    // realtime when comments are open so works out.
    const {isConnected, procedures, subscribeToEvents} = useWebSocket(
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
                            // query. So we don't need `cursorByIndexName` for now.
                            cursorByIndexName: new Map(),
                        },
                    ],
                });
            },
            error => {
                context.tracer
                    .getRoot()
                    .logUncaughtException("Failed to reload realtime item", error);
            },
        );
    }, [
        context.tracer,
        isConnected,
        post.id,
        onPostRealtimeEventTransaction,
        shouldBeConnectedToChannelRealtime,
        context,
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
            ref={inputRef}
            data-testid={`PostCommentInput:${post.id}`}
            messageNoun="comment"
            // NOCOMMIT: Sticky positioned message inputs on mobile? Probably should mount
            // a brand new input instead of trying to animate this one.
            isNotBottomBar={isStickyPositioned}
            messages={postComments}
            onUpdateMessages={onUpdatePostComments}
            createMessage={async input => {
                await procedures.createComment({
                    parentCommentIndex: input.parentMessageIndex,
                    content: input.content,
                });
            }}
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
                        context.tracer
                            .getRoot()
                            .logUncaughtException("Couldn't update typing indicator", error),
                    );
            }}
            onHideTypingIndicator={() => {
                // Don't show an error updating typing indicators to the user. We will see an
                // error in our logs but the user won't see any weird behavior if the
                // request fails.
                procedures
                    .stopTypingInCommentInput({})
                    .catch(error =>
                        context.tracer
                            .getRoot()
                            .logUncaughtException("Couldn't update typing indicator", error),
                    );
            }}
        />
    );
}
