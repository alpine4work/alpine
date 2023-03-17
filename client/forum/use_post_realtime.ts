import {Memo, Ref, useCallback, useImperativeHandle, useRef} from "react";
import {useWebSocket} from "~/client/cloudflare/use_web_socket";
import {MessageList} from "~/client/messaging/message_list";
import {
    MessagingRealtimeActions,
    useMessagingRealtime,
} from "~/client/messaging/use_messaging_realtime";
import {cast} from "~/shared/helpers/control/cast";
import {PostId} from "~/shared/id/types/id_types";
import {MessagingRealtimeMessageFromServer} from "~/shared/messaging/messaging_realtime_schema";
import {PostCommentModel} from "~/shared/models/post_model";
import {
    PostRealtimeMessageFromClientSchema,
    PostRealtimeMessageFromServerSchema,
} from "~/shared/posts/post_realtime_schema";

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
    actionsRef: Ref<MessagingRealtimeActions>;
    postComments: MessageList<PostCommentModel>;
    onUpdatePostComments: (
        update: (postComments: MessageList<PostCommentModel>) => MessageList<PostCommentModel>,
    ) => void;
}) {
    const subscribersRef = useRef(
        new Set<(message: MessagingRealtimeMessageFromServer<PostCommentModel>) => void>(),
    );

    const {isConnected, sendMessage} = useWebSocket(
        PostRealtimeMessageFromClientSchema,
        PostRealtimeMessageFromServerSchema,
        `/durable-objects/posts/${postId}`,
        message => {
            // TypeScript will error if we ever add other message types here. At that point
            // this code should turn into a switch.
            cast<"PostComments">(message.type);

            for (const subscriber of subscribersRef.current) {
                subscriber(message.message);
            }
        },
    );

    const {actions} = useMessagingRealtime({
        messages: postComments,
        onUpdateMessages: onUpdatePostComments,
        isRealtimeConnected: isConnected,
        sendRealtimeMessage: useCallback(
            message => sendMessage({type: "PostComments", message}),
            [sendMessage],
        ),
        subscribeToRealtimeMessages: useCallback(
            (
                subscriber: (message: MessagingRealtimeMessageFromServer<PostCommentModel>) => void,
            ) => {
                subscribersRef.current.add(subscriber);
                return () => {
                    subscribersRef.current.delete(subscriber);
                };
            },
            [],
        ),
    });

    useImperativeHandle(actionsRef, () => actions, [actions]);

    return {
        actions,
    };
}
