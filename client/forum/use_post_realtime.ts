import {Ref, useEffect, useImperativeHandle, useMemo, useRef, useState} from "react";
import {useWebSocket} from "~/client/cloudflare/use_web_socket";
import {useLayoutEffectWithoutServerSideWarning} from "~/client/helpers/lifecycle/use_layout_effect_without_server_side_warning";
import {MessageList} from "~/client/messaging/message_list";
import {getInitialLoadMessageCount} from "~/client/messaging/messaging_view";
import {getClientInfoWithoutListening} from "~/client/remix/client_info_context";
import {MessageContent} from "~/shared/content/message_content_schema";
import {exhaustive} from "~/shared/helpers/control/exhaustive";
import {PostId} from "~/shared/id/types/id_types";
import {PostCommentModel} from "~/shared/models/post_model";
import {
    PostRealtimeMessageFromClientSchema,
    PostRealtimeMessageFromServerSchema,
} from "~/shared/posts/post_realtime_schema";

export type PostRealtimeActions = {
    createPostComment(input: {
        parentPostCommentIndex: number | null;
        content: MessageContent;
    }): Promise<void>;
    updatePostCommentContent(input: {
        postCommentIndex: number;
        content: MessageContent;
    }): Promise<void>;
    deletePostComment(input: {postCommentIndex: number}): Promise<void>;
};

/**
 * Sets up a realtime connection for the provided post. Making sure comments
 * are kept up-to-date in realtime.
 */
export function usePostRealtime({
    postId,
    actionsRef,
    postComments,
    onUpdatePostComments,
}: {
    postId: PostId;
    actionsRef: Ref<PostRealtimeActions>;
    postComments: MessageList<PostCommentModel>;
    onUpdatePostComments: (
        update: (postComments: MessageList<PostCommentModel>) => MessageList<PostCommentModel>,
    ) => void;
}) {
    const [errorState, setErrorState] = useState<
        {hasError: false} | {hasError: true; error: unknown}
    >({hasError: false});

    if (errorState.hasError) throw errorState.error;

    const {isConnected, sendMessage} = useWebSocket(
        PostRealtimeMessageFromClientSchema,
        PostRealtimeMessageFromServerSchema,
        `/durable-objects/posts/${postId}`,
        message => {
            switch (message.type) {
                case "BackfillPostCommentsResponse": {
                    onUpdatePostComments(postComments => {
                        switch (message.postCommentChangesResult.type) {
                            case "Available": {
                                postComments = postComments.loadMessages({
                                    messageCount: message.postCommentCount,
                                    messages: message.newPostComments,
                                    otherReferencedMessages: message.newOtherReferencedPostComments,
                                });

                                postComments = postComments.setLastMessageChangeTime(
                                    message.lastPostCommentChangeTime,
                                );

                                postComments = message.postCommentChangesResult.changes.reduce(
                                    (postComments, change) =>
                                        postComments.changeLoadedMessage(change),
                                    postComments,
                                );

                                return postComments;
                            }
                            // If comment changes are unavailable then fully reset the comment list since
                            // we don't know if any loaded comments are correct. `<PostListView>` should
                            // then be able to see we have rendered unloaded messages and kick off a new
                            // network request.
                            case "Unavailable": {
                                return MessageList.new({
                                    messageCount: message.postCommentCount,
                                    lastMessageChangeTime: message.lastPostCommentChangeTime,
                                });
                            }
                            default:
                                throw exhaustive(message.postCommentChangesResult);
                        }
                    });
                    break;
                }
                case "NewPostComment": {
                    onUpdatePostComments(postComments =>
                        postComments.addMessage(message.postComment),
                    );
                    break;
                }
                case "ChangePostComment": {
                    onUpdatePostComments(postComments =>
                        postComments.changeLoadedMessage(message.change),
                    );
                    break;
                }
                default:
                    throw exhaustive(message);
            }
        },
    );

    const postCommentsRef = useRef(postComments);
    useLayoutEffectWithoutServerSideWarning(() => {
        postCommentsRef.current = postComments;
    });

    // Whenever we connect to the WebSocket, request a comment backfill. If the
    // visits another browser tab this will disconnect the WebSocket then when the
    // user returns to this browser tab we will send another backfill.
    useEffect(() => {
        if (isConnected) {
            sendMessage({
                type: "BackfillPostCommentsRequest",
                clientPostCommentCount:
                    postCommentsRef.current.getMessageCountExcludingOptimisticMessages(),
                clientLastPostCommentChangeTime: postCommentsRef.current.getLastMessageChangeTime(),
                newPostCommentLimit: getInitialLoadMessageCount(getClientInfoWithoutListening()),
            }).catch(error => setErrorState({hasError: true, error}));
        }
    }, [isConnected, sendMessage]);

    const actions = useMemo((): PostRealtimeActions => {
        return {
            createPostComment: input =>
                sendMessage({
                    type: "CreatePostComment",
                    ...input,
                }),
            updatePostCommentContent: input =>
                sendMessage({
                    type: "UpdatePostCommentContent",
                    ...input,
                }),
            deletePostComment: input =>
                sendMessage({
                    type: "DeletePostComment",
                    ...input,
                }),
        };
    }, [sendMessage]);

    useImperativeHandle(actionsRef, () => actions, [actions]);

    return {
        actions,
    };
}
