import {PostListView} from "~/client/forum/post_list_view";
import {getInitialLoadMessageCount} from "~/client/messaging/messaging_view";
import {useLoaderDataWithSchema} from "~/client/remix/use_loader_data_with_schema";
import {getPostAndCommentsFromStart} from "~/server/dynamo/forum_table";
import {jsonWithSchema} from "~/server/remix/json_with_schema";
import {LoaderArgs} from "~/server/remix/loader_context";
import {NotFoundError} from "~/shared/error/error";
import {PostId} from "~/shared/id/types/id_types";
import {PostCommentModel, PostModel} from "~/shared/models/post_model";
import {Schema} from "~/shared/schema/schema";
import {sprinkles} from "~/shared/styles/styles";
import {TracerEventData} from "~/shared/tracer/types/tracer_event_data";

const schema = Schema.object({
    post: PostModel.schema(),
    postComments: Schema.array(PostCommentModel.schema()),
    otherReferencedPostComments: Schema.array(PostCommentModel.schema()),
});

export async function loader({params, context}: LoaderArgs) {
    const postId = Schema.id<PostId>().deserialize(params.post_id ?? null);

    const postCommentLimit = getInitialLoadMessageCount(context.loader.clientInfo);

    const postResult = await getPostAndCommentsFromStart(await context.auth.authenticate(), {
        postId,
        postCommentLimit,
    });
    if (!postResult) throw new NotFoundError("Post not found");

    const {post, postComments, otherReferencedPostComments} = postResult;

    const propagateEventData: TracerEventData = {
        context: {
            postId,
            channelId: post.channelId,
        },
    };

    return jsonWithSchema(
        schema,
        {post, postComments, otherReferencedPostComments},
        {propagateEventData},
    );
}

export default function PostRoute() {
    const {post, postComments, otherReferencedPostComments} = useLoaderDataWithSchema(schema);

    return (
        <main className={sprinkles({height: "full"})}>
            <PostListView
                initialPostsResult={{
                    type: "One",
                    post,
                    arePostCommentsOpen: true,
                    initialLoadPostComments: {
                        comments: postComments,
                        otherReferencedComments: otherReferencedPostComments,
                    },
                }}
            />
        </main>
    );
}
