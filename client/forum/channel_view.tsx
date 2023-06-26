import {useMemo, useState} from "react";
import {useAppContext} from "~/client/context/app_context.js";
import {Box} from "~/client/design/box.js";
import {ChannelViewAside} from "~/client/forum/channel_view_aside.js";
import {ChannelViewTopBar} from "~/client/forum/channel_view_top_bar.js";
import {PostListView} from "~/client/forum/post_list_view.js";
import {isContentEmpty} from "~/shared/content/is_content_empty.js";
import {ChannelModel} from "~/shared/forum/channel_model.js";
import {PostModel} from "~/shared/forum/post_model.js";
import {getChannelPosts} from "~/shared/rpc/forum_rpc_definitions.js";

export function ChannelView({
    initialChannel,
    initialChannelPostsResult,
}: {
    initialChannel: ChannelModel;
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
                    channelHeader={useMemo(() => ({channel}), [channel])}
                    initialPostsResult={{type: "Many", ...initialChannelPostsResult}}
                    onLoadMorePosts={({limit, afterCursor}) => {
                        return getChannelPosts(context, {
                            channelId: channel.id,
                            limit,
                            afterCursor,
                        });
                    }}
                    aside={
                        !isContentEmpty(channel.description.doc) && (
                            <ChannelViewAside channel={channel} />
                        )
                    }
                />
            </Box>
        </Box>
    );
}
