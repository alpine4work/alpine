import {useState} from "react";
import {PaginatedPostList} from "~/client/posts/paginated_post_list";
import {PostsView} from "~/client/posts/posts_view";
import {useLoaderDataWithSchema} from "~/client/remix/use_loader_data_with_schema";
import {getPost} from "~/server/dynamo/posts_table";
import {jsonWithSchema} from "~/server/remix/json_with_schema";
import {LoaderArgs} from "~/server/remix/loader_context";
import {NotFoundError} from "~/shared/error/error";
import {PostId} from "~/shared/id/types/id_types";
import {PostModel} from "~/shared/models/post_model";
import {Schema} from "~/shared/schema/schema";
import {sprinkles} from "~/shared/styles/styles";
import {TracerEventData} from "~/shared/tracer/types/tracer_event_data";

const schema = Schema.object({
    post: PostModel.schema(),
});

export async function loader({params, context}: LoaderArgs) {
    const postId = Schema.id<PostId>().deserialize(params.post_id ?? null);

    const post = await getPost(await context.auth.authenticate(), postId);
    if (!post) throw new NotFoundError("Channel not found");

    const propagateEventData: TracerEventData = {
        context: {
            postId,
            channelId: post.channelId,
        },
    };

    return jsonWithSchema(schema, {post}, {propagateEventData});
}

export default function PostRoute() {
    const {post} = useLoaderDataWithSchema(schema);

    const [list, setList] = useState(() =>
        PaginatedPostList.empty.insertAtEnd(post, {arePostCommentsOpen: false}),
    );

    return (
        <main className={sprinkles({height: "full"})}>
            <PostsView
                list={list}
                onTogglePostComments={index => setList(list => list.togglePostComments(index))}
                onLoadPostCommentsFromStart={(index, options) =>
                    setList(list =>
                        list.updatePostComments(index, postComments =>
                            postComments.loadMessagesFromStart({
                                afterMessageId: options.afterCommentId,
                                beforeMessageId: options.beforeCommentId,
                                limit: options.limit,
                                hasMoreMessagesAfter: options.hasMoreCommentsAfter,
                                messages: options.comments,
                            }),
                        ),
                    )
                }
            />
        </main>
    );
}
