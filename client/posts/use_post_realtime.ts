import {Ref, useImperativeHandle, useMemo} from "react";
import {useWebSocket} from "~/client/cloudflare/use_web_socket";
import {MessageContent} from "~/shared/content/message_content_schema";
import {PostId} from "~/shared/id/types/id_types";
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
}: {
    postId: PostId;
    actionsRef: Ref<PostRealtimeActions>;
}) {
    const {sendMessage} = useWebSocket(
        PostRealtimeMessageFromClientSchema,
        PostRealtimeMessageFromServerSchema,
        `/durable-objects/posts/${postId}`,
        message => {
            // TODO(calebmer): Implement
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
