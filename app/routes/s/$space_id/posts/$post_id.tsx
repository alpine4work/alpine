import {useSearchParams} from "react-router-dom";
import {getAccountShortNameWithoutFullNameTooltip} from "~/client/accounts/account_short_name";
import {Box} from "~/client/design/box";
import {PostView} from "~/client/forum/post_view";
import {getInitialLoadMessageCount} from "~/client/messaging/messaging_view";
import {createMetaFunction} from "~/client/remix/create_meta_function";
import {useLoaderDataWithSchema} from "~/client/remix/use_loader_data_with_schema";
import {metaTitlePostfix} from "~/client/remix/use_update_meta_title";
import {getPostAndInitialComments} from "~/server/dynamo/forum_table";
import {jsonWithSchema} from "~/server/remix/json_with_schema";
import {LoaderArgs} from "~/server/remix/loader_context";
import {NotFoundError} from "~/shared/error/error";
import {PostId} from "~/shared/id/types/id_types";
import {PostCommentModel, PostModel} from "~/shared/models/post_model";
import {Schema} from "~/shared/schema/schema";
import {TracerEventData} from "~/shared/tracer/types/tracer_event_data";

const LoaderSchema = Schema.object({
    post: PostModel.schema(),
    initialPostComments: Schema.array(PostCommentModel.schema()),
    initialOtherReferencedPostComments: Schema.array(PostCommentModel.schema()),
});

export async function loader({params, context}: LoaderArgs) {
    const postId = Schema.id<PostId>().deserialize(params.post_id ?? null);

    const commentLimit = getInitialLoadMessageCount(context.loader.clientInfo);

    const postResult = await getPostAndInitialComments(await context.auth.authenticate(), {
        postId,
        commentLimit,
    });
    if (!postResult) throw new NotFoundError("Post not found");

    const {post, initialComments, initialOtherReferencedComments} = postResult;

    const propagateEventData: TracerEventData = {
        context: {
            postId,
            channelId: post.channel.id,
        },
    };

    return jsonWithSchema(
        LoaderSchema,
        {
            post,
            initialPostComments: initialComments,
            initialOtherReferencedPostComments: initialOtherReferencedComments,
        },
        {propagateEventData},
    );
}

export const meta = createMetaFunction(LoaderSchema, ({data: {post}}) => ({
    title: `Post by ${getAccountShortNameWithoutFullNameTooltip(post.author)} in ${
        post.channel.name
    }${metaTitlePostfix}`,
}));

export default function PostRoute({isPeek}: {isPeek?: boolean}) {
    const [searchParams] = useSearchParams();
    const {post, initialPostComments, initialOtherReferencedPostComments} =
        useLoaderDataWithSchema(LoaderSchema);

    const postCommentIndexString = searchParams.get("comment");
    const postCommentIndex = postCommentIndexString ? parseInt(postCommentIndexString, 10) : null;

    return (
        <Box flexGrow="1" overflow="hidden">
            <PostView
                // Remount when navigating to a different post.
                key={post.id}
                initialPost={post}
                initialPostComments={initialPostComments}
                initialOtherReferencedPostComments={initialOtherReferencedPostComments}
                initialScrollToPostCommentIndex={postCommentIndex}
                withMobileLayout={isPeek}
            />
        </Box>
    );
}
