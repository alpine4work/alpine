import {MetaFunction} from "@remix-run/server-runtime";
import {useAppContext} from "~/client/context/app_context";
import {postContentViewMinHeight} from "~/client/forum/post_content_view";
import {PostListView} from "~/client/forum/post_list_view";
import {useLoaderDataWithSchema} from "~/client/remix/use_loader_data_with_schema";
import {metaTitlePostfix} from "~/client/remix/use_update_meta_title";
import {useSpaceContext} from "~/client/spaces/space_context";
import {getInitialVirtualizedScrollViewRenderedItemCount} from "~/client/virtualized/virtualized_scroll_view";
import {jsonWithSchema} from "~/server/remix/json_with_schema";
import {LoaderArgs} from "~/server/remix/loader_context";
import {InvalidArgumentError} from "~/shared/error/error";
import {PostModel} from "~/shared/forum/post_model";
import {assertExists} from "~/shared/helpers/control/assert_exists";
import {isId} from "~/shared/id/id";
import {ChannelId, SpaceId} from "~/shared/id/types/id_types";
import {getInboxChannelPostsEntryPosts} from "~/shared/rpc/notifications_rpc_definitions";
import {Schema} from "~/shared/schema/schema";
import {TracerEventData} from "~/shared/tracer/types/tracer_event_data";

const LoaderSchema = Schema.object({
    channelId: Schema.id<ChannelId>(),
    bucketGeneration: Schema.integer,
    postsResult: Schema.object({
        hasMorePosts: Schema.boolean,
        posts: Schema.array(PostModel.schema()),
    }),
});

export async function loader({params, context}: LoaderArgs) {
    const spaceId = Schema.id<SpaceId>().deserialize(params.space_id ?? null);
    const channelIdAndBucketGeneration = assertExists(params["channel_id_and_bucket_generation"]);
    const [channelId, bucketGenerationString, ...otherParts] =
        channelIdAndBucketGeneration.split("-");

    if (otherParts.length !== 0)
        throw new InvalidArgumentError("Only expected two parts in the URL");

    if (!channelId || !isId<ChannelId>(channelId))
        throw new InvalidArgumentError("Expected `ChannelId`");

    const bucketGeneration =
        bucketGenerationString && /^\d+$/.test(bucketGenerationString)
            ? parseInt(bucketGenerationString, 10)
            : null;

    if (bucketGeneration === null || !Number.isInteger(bucketGeneration))
        throw new InvalidArgumentError("Expected bucket generation to be an integer");

    const postsResult = await getInboxChannelPostsEntryPosts(await context.actor.authenticate(), {
        spaceId,
        channelId,
        bucketGeneration,
        limit: getInitialVirtualizedScrollViewRenderedItemCount(
            context.loader.clientInfo,
            postContentViewMinHeight,
        ),
        afterPostId: null,
    });

    const propagateEventData: TracerEventData = {
        context: {
            channelId,
        },
    };

    return jsonWithSchema(
        LoaderSchema,
        {channelId, bucketGeneration, postsResult},
        {propagateEventData},
    );
}

export const meta: MetaFunction = () => {
    return {
        title: `New posts notification${metaTitlePostfix}`,
    };
};

export default function ChannelPostsRoute({withMobileLayout}: {withMobileLayout?: boolean}) {
    const context = useAppContext();
    const {space} = useSpaceContext();
    const {channelId, bucketGeneration, postsResult} = useLoaderDataWithSchema(LoaderSchema);

    return (
        <PostListView
            withMobileLayout={withMobileLayout}
            initialPostsResult={{type: "Many", ...postsResult}}
            onLoadMorePosts={({limit, afterCursor}) => {
                return getInboxChannelPostsEntryPosts(context, {
                    spaceId: space.id,
                    channelId,
                    bucketGeneration,
                    limit,
                    afterPostId: afterCursor?.postId ?? null,
                });
            }}
        />
    );
}
