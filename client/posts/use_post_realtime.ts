import {Ref, useEffect, useImperativeHandle, useMemo, useState} from "react";
import {useWebSocket} from "~/client/cloudflare/use_web_socket";
import {MessageList} from "~/client/messaging/message_list";
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
        parentCommentIndex: number | null;
        content: MessageContent;
    }): Promise<void>;
    updatePostCommentContent(input: {commentIndex: number; content: MessageContent}): Promise<void>;
    deletePostComment(input: {commentIndex: number}): Promise<void>;
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
            // TODO(calebmer): Message ordering?
            switch (message.type) {
                case "CreatedPostComment": {
                    onUpdatePostComments(postComments => postComments.setMessage(message.comment));
                    break;
                }
                case "UpdatedPostCommentContent": {
                    // TODO(calebmer): Implement!
                    break;
                }
                case "DeletedPostComment": {
                    // TODO(calebmer): Implement!
                    break;
                }
                default:
                    throw exhaustive(message);
            }
        },
    );

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
