import {useSearchParams} from "react-router-dom";
import {getAccountShortNameWithoutFullNameTooltip} from "~/client/accounts/account_short_name.js";
import {PostView} from "~/client/forum/post_view.js";
import {getInitialLoadMessageCount} from "~/client/messaging/messaging_view.js";
import {createMetaFunction} from "~/client/remix/create_meta_function.js";
import {useLoaderDataWithSchema} from "~/client/remix/use_loader_data_with_schema.js";
import {metaTitlePostfix} from "~/client/remix/use_update_meta_title.js";
import {getPostAndInitialComments} from "~/server/dynamo/forum_table.js";
import {jsonWithSchema} from "~/server/remix/json_with_schema.js";
import {LoaderArgs} from "~/server/remix/loader_context.js";
import {PostCommentModel, PostModel} from "~/shared/forum/post_model.js";
import {PostId} from "~/shared/id/types/id_types.js";
import {Schema} from "~/shared/schema/schema.js";
import {TracerEventData} from "~/shared/tracer/types/tracer_event_data.js";

const LoaderSchema = Schema.object({
    post: PostModel.schema(),
    initialPostComments: Schema.array(PostCommentModel.schema()),
    initialOtherReferencedPostComments: Schema.array(PostCommentModel.schema()),
});

export async function loader({params, context}: LoaderArgs) {
    const postId = Schema.id<PostId>().deserialize(params.postId ?? null);

    const commentLimit = getInitialLoadMessageCount(context.loader.clientInfo);

    const {post, initialComments, initialOtherReferencedComments} = await getPostAndInitialComments(
        await context.actor.authenticate(),
        {
            postId,
            commentLimit,
        },
    );

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

export const meta = createMetaFunction(LoaderSchema, ({data: {post}}) => [
    {
        title: `Post by ${getAccountShortNameWithoutFullNameTooltip(post.author)} in ${
            post.channel.name
        }${metaTitlePostfix}`,
    },
]);

export default function PostRoute({withMobileLayout}: {withMobileLayout?: boolean}) {
    const [searchParams] = useSearchParams();
    const {post, initialPostComments, initialOtherReferencedPostComments} =
        useLoaderDataWithSchema(LoaderSchema);

    const postCommentIndexString = searchParams.get("comment");
    const postCommentIndex = postCommentIndexString ? parseInt(postCommentIndexString, 10) : null;

    return (
        <PostView
            // Remount when navigating to a different post.
            key={post.id}
            initialPost={post}
            initialPostComments={initialPostComments}
            initialOtherReferencedPostComments={initialOtherReferencedPostComments}
            initialScrollToPostCommentIndex={postCommentIndex}
            withMobileLayout={withMobileLayout}
        />
    );
}
