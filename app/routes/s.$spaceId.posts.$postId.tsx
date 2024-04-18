import {useSearchParams} from "react-router-dom";
import {PostView} from "~/client/forum/post_view.js";
import {getInitialLoadMessageCount} from "~/client/messaging/messaging_view.js";
import {createMetaFunction} from "~/client/remix/create_meta_function.js";
import {useLoaderDataWithSchema} from "~/client/remix/use_loader_data_with_schema.js";
import {metaTitlePostfix} from "~/client/remix/use_update_meta_title.js";
import {useSearchAffinityViewInteraction} from "~/client/search/use_search_affinity_view_interaction.js";
import {getPostAndInitialComments} from "~/server/forum/data/forum_table.js";
import {jsonWithSchema} from "~/server/remix/json_with_schema.js";
import {LoaderArgs} from "~/server/remix/loader_context.js";
import {getAccountShortNameWithoutFullNameTooltip} from "~/shared/accounts/get_account_short_name_without_full_name_tooltip.js";
import {createDynamoGeneralRealtimeItemSchema} from "~/shared/dynamo/dynamo_general_realtime_types.js";
import {PostCommentModel, PostModel} from "~/shared/forum/post_model.js";
import {PostId} from "~/shared/id/types/id_types.js";
import {Schema} from "~/shared/schema/schema.js";
import {TracerEventData} from "~/shared/tracer/types/tracer_event_data.js";

const LoaderSchema = Schema.object({
    post: createDynamoGeneralRealtimeItemSchema(PostModel.schema()),
    initialPostComments: Schema.array(PostCommentModel.schema()),
    initialOtherReferencedPostComments: Schema.array(PostCommentModel.schema()),
});

export async function loader({params, context}: LoaderArgs) {
    const postId = Schema.id<PostId>().deserialize(params.postId ?? null);

    const commentLimit = getInitialLoadMessageCount(context.loader.getClientInfo());

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
            channelId: post.model.channel.id,
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
        // Account name in title won't update when account changes without reload
        // because we're using `initialData`.
        title: `Post by ${getAccountShortNameWithoutFullNameTooltip(
            post.model.author.initialData,
        )} in ${post.model.channel.name}${metaTitlePostfix}`,
    },
]);

export default function PostRoute({withMobileLayout}: {withMobileLayout?: boolean}) {
    const [searchParams] = useSearchParams();
    const {post, initialPostComments, initialOtherReferencedPostComments} =
        useLoaderDataWithSchema(LoaderSchema);

    const postCommentIndexString = searchParams.get("comment");
    const postCommentIndex = postCommentIndexString ? parseInt(postCommentIndexString, 10) : null;

    // Spending time with a post accrues affinity points to the channel the post
    // was made in. If you're reading a post and its comments this probably means
    // the topic of the post (the channel) is relevant to you as well.
    //
    // We don't give posts themselves affinity points. That's because posts are
    // fairly short lived (a couple days). However, we give channels affinity
    // points so you could quickly jump to a channel if you're looking for a
    // certain post inside the channel.
    useSearchAffinityViewInteraction(`Channel:${post.model.channel.id}`);

    return (
        <PostView
            // Remount when navigating to a different post.
            key={post.model.id}
            initialPost={post}
            initialPostComments={initialPostComments}
            initialOtherReferencedPostComments={initialOtherReferencedPostComments}
            initialScrollToPostCommentIndex={postCommentIndex}
            withMobileLayout={withMobileLayout}
        />
    );
}
