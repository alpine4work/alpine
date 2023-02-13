import {useState} from "react";
import {useAppContext} from "~/client/context/app_context";
import {Box} from "~/client/design/box";
import {ChannelViewAside} from "~/client/forum/channel_view_aside";
import {ChannelViewTopBar} from "~/client/forum/channel_view_top_bar";
import {PostList} from "~/client/forum/post_list";
import {PostListView} from "~/client/forum/post_list_view";
import {isContentEmpty} from "~/shared/content/is_content_empty";
import {ChannelModel} from "~/shared/models/channel_model";
import {PostModel} from "~/shared/models/post_model";
import {getChannelPosts} from "~/shared/rpc/forum_rpc_definitions";

export function ChannelView({
    channel: initialChannel,
    initialChannelPostsResult,
}: {
    channel: ChannelModel;
    initialChannelPostsResult: {posts: ReadonlyArray<PostModel>; hasMorePosts: boolean};
}) {
    const context = useAppContext();
    const [channel, setChannel] = useState(initialChannel);

    return (
        <Box
            display="flex"
            flexDirection="column"
            height="full"
            overflow="hidden"
            position="relative"
            zIndex="0"
        >
            <ChannelViewTopBar channel={channel} onUpdateChannel={setChannel} />
            <Box flexGrow="1" overflow="hidden" position="relative" zIndex="0">
                <PostListView
                    initialPosts={() =>
                        PostList.empty
                            .setChannelHeader({channel})
                            .insertManyPostsAtStart(initialChannelPostsResult.posts)
                            .setHasMorePosts(initialChannelPostsResult.hasMorePosts)
                    }
                    onLoadMorePosts={({limit, afterCursor}) => {
                        return getChannelPosts(context, {
                            channelId: channel.id,
                            limit,
                            afterCursor,
                        });
                    }}
                    aside={
                        !isContentEmpty(channel.description) && (
                            <ChannelViewAside channel={channel} />
                        )
                    }
                />
            </Box>
        </Box>
    );
}
