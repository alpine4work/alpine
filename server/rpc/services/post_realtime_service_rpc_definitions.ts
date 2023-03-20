import {defineServiceRpcs} from "~/server/rpc/services/internal/define_service_rpcs";
import {MessageChangeSchema} from "~/shared/messaging/message_change_schema";
import {PostCommentModel} from "~/shared/models/post_model";

export const PostRealtimeServiceRpcDefinitions = defineServiceRpcs("PostRealtimeService", {
    onCreatePostComment: {
        input: {
            postComment: PostCommentModel.schema(),
        },
        output: {},
    },
    onChangePostComment: {
        input: {
            postCommentChange: MessageChangeSchema,
        },
        output: {},
    },
});

export const {onCreatePostComment, onChangePostComment} = PostRealtimeServiceRpcDefinitions;
