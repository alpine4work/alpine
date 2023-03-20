import {MetaFunction} from "@remix-run/server-runtime";
import {useSearchParams} from "react-router-dom";
import {getAccountShortNameWithoutFullNameTooltip} from "~/client/accounts/account_short_name";
import {Box} from "~/client/design/box";
import {PostView} from "~/client/forum/post_view";
import {getInitialLoadMessageCount} from "~/client/messaging/messaging_view";
import {getLoaderDataWithSchema} from "~/client/remix/get_loader_data_with_schema";
import {useLoaderDataWithSchema} from "~/client/remix/use_loader_data_with_schema";
import {metaTitlePostfix} from "~/client/remix/use_update_meta_title";
import {getPostAndInitialCommentsFromStart} from "~/server/dynamo/forum_table";
import {jsonWithSchema} from "~/server/remix/json_with_schema";
import {LoaderArgs} from "~/server/remix/loader_context";
import {NotFoundError} from "~/shared/error/error";
import {PostId} from "~/shared/id/types/id_types";
import {PostCommentModel, PostModel} from "~/shared/models/post_model";
import {Schema} from "~/shared/schema/schema";
import {TracerEventData} from "~/shared/tracer/types/tracer_event_data";

const LoaderSchema = Schema.object({
    post: PostModel.schema(),
    postComments: Schema.array(PostCommentModel.schema()),
    otherReferencedPostComments: Schema.array(PostCommentModel.schema()),
});

export async function loader({params, context}: LoaderArgs) {
    const postId = Schema.id<PostId>().deserialize(params.post_id ?? null);

    const postCommentLimit = getInitialLoadMessageCount(context.loader.clientInfo);

    const postResult = await getPostAndInitialCommentsFromStart(await context.auth.authenticate(), {
        postId,
        postCommentLimit,
    });
    if (!postResult) throw new NotFoundError("Post not found");

    const {post, postComments, otherReferencedPostComments} = postResult;

    const propagateEventData: TracerEventData = {
        context: {
            postId,
            channelId: post.channel.id,
        },
    };

    return jsonWithSchema(
        LoaderSchema,
        {post, postComments, otherReferencedPostComments},
        {propagateEventData},
    );
}

export const meta: MetaFunction = ({data}) => {
    const {post} = getLoaderDataWithSchema(LoaderSchema, data);

    return {
        title: `Post by ${getAccountShortNameWithoutFullNameTooltip(post.author)} in ${
            post.channel.name
        }${metaTitlePostfix}`,
    };
};

export default function PostRoute({isPeek}: {isPeek?: boolean}) {
    const [searchParams] = useSearchParams();
    const {post, postComments, otherReferencedPostComments} = useLoaderDataWithSchema(LoaderSchema);

    const postCommentIndexString = searchParams.get("comment");
    const postCommentIndex = postCommentIndexString ? parseInt(postCommentIndexString, 10) : null;

    return (
        <Box flexGrow="1" overflow="hidden">
            <PostView
                // Remount when navigating to a different post.
                key={post.id}
                initialPost={post}
                initialPostComments={postComments}
                initialOtherReferencedPostComments={otherReferencedPostComments}
                initialScrollToPostCommentIndex={postCommentIndex}
                withMobileLayout={isPeek}
            />
        </Box>
    );
}
