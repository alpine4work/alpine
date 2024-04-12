import {useMemo, useRef, useState} from "react";
import {useAppContext} from "~/client/context/app_context.js";
import {NavigationBarRef, useNavigationBar} from "~/client/design/navigation_bar.js";
import {DynamoGeneralRealtimeIndexQuery} from "~/client/dynamo/dynamo_general_realtime_index_query.js";
import {ChannelViewAside} from "~/client/forum/channel_view_aside.js";
import {
    PostListView,
    postListViewAsideMaxWidth,
    postViewMaxWidth,
} from "~/client/forum/post_list_view.js";
import {isContentEmpty} from "~/shared/content/is_content_empty.js";
import {addRemLengths, spacing} from "~/shared/design/spacing.js";
import {DynamoGeneralRealtimeIndexQueryResult} from "~/shared/dynamo/dynamo_general_realtime_types.js";
import {ChannelModel} from "~/shared/forum/channel_model.js";
import {PostModel} from "~/shared/forum/post_model.js";
import {getChannelPosts} from "~/shared/rpc/forum_rpc_definitions.js";

export function ChannelView({
    withMobileLayout,
    initialChannel,
    initialPostsResult,
}: {
    withMobileLayout: boolean;
    initialChannel: ChannelModel;
    initialPostsResult: DynamoGeneralRealtimeIndexQueryResult<PostModel>;
}) {
    const context = useAppContext();
    const [channel, setChannel] = useState(initialChannel);

    const [postsQuery, setPostsQuery] = useState(() =>
        DynamoGeneralRealtimeIndexQuery.new(initialPostsResult),
    );

    // NOCOMMIT: Get rid of `<ChannelViewTopBar>`

    const hasAside = !isContentEmpty(channel.description.doc);

    const navigationBarRef = useRef<NavigationBarRef>(null);

    const navigationBar = useNavigationBar({
        ref: navigationBarRef,
        withMobileLayout,
        withoutDisappearingTitle: true,
        title: channel.name,
        desktopTitleMaxWidth: hasAside
            ? addRemLengths(spacing[postViewMaxWidth], spacing[postListViewAsideMaxWidth])
            : postViewMaxWidth,
        desktopTitleFontSize: "400",
        desktopTitleFontWeight: "bold",
    });

    return (
        <PostListView
            withMobileLayout={withMobileLayout}
            channelHeader={useMemo(() => ({channel}), [channel])}
            // NOCOMMIT: Implement
            initialPostsResult={{type: "Many", hasMorePosts: false, posts: []}}
            onLoadMorePosts={({limit, afterCursor}) => {
                return getChannelPosts(context, {
                    channelId: channel.id,
                    limit,
                    afterCursor,
                });
            }}
            aside={hasAside && <ChannelViewAside channel={channel} />}
            navigationBar={{...navigationBar, navigationBarRef}}
        />
    );
}
