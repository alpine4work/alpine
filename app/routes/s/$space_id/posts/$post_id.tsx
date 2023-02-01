import {useState} from "react";
import {getInitialLoadMessageCount} from "~/client/messaging/messaging_view";
import {PaginatedPostList} from "~/client/posts/paginated_post_list";
import {PostsView} from "~/client/posts/posts_view";
import {useLoaderDataWithSchema} from "~/client/remix/use_loader_data_with_schema";
import {getPostAndCommentsFromStart} from "~/server/dynamo/posts_table";
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
    postCommentLimit: Schema.integer,
    hasMorePostCommentsAfter: Schema.boolean,
    postComments: Schema.array(PostCommentModel.schema()),
});

export async function loader({params, context}: LoaderArgs) {
    const postId = Schema.id<PostId>().deserialize(params.post_id ?? null);

    const postCommentLimit = getInitialLoadMessageCount(context.loader.clientInfo);

    const postResult = await getPostAndCommentsFromStart(await context.auth.authenticate(), {
        postId,
        postCommentLimit,
    });
    if (!postResult) throw new NotFoundError("Post not found");

    const {post, hasMorePostCommentsAfter, postComments} = postResult;

    const propagateEventData: TracerEventData = {
        context: {
            postId,
            channelId: post.channelId,
        },
    };

    return jsonWithSchema(
        schema,
        {post, postCommentLimit, hasMorePostCommentsAfter, postComments},
        {propagateEventData},
    );
}

export default function PostRoute() {
    const {post, postCommentLimit, hasMorePostCommentsAfter, postComments} =
        useLoaderDataWithSchema(schema);

    const [list, setList] = useState(() =>
        PaginatedPostList.empty.insertAtEnd(post, {
            arePostCommentsOpen: true,
            insertInitialPostComments: list =>
                list.loadMessagesFromStart({
                    afterMessageId: null,
                    beforeMessageId: null,
                    limit: postCommentLimit,
                    hasMoreMessagesAfter: hasMorePostCommentsAfter,
                    messages: postComments,
                }),
        }),
    );

    return (
        <main className={sprinkles({height: "full"})}>
            <PostsView
                list={list}
                onTogglePostComments={index => setList(list => list.togglePostComments(index))}
                onUpdatePostComments={(postOrderKey, update) =>
                    setList(list => list.updatePostComments(postOrderKey, update))
                }
            />
        </main>
    );
}
