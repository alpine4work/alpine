import {useMemo, useState} from "react";
import {useAppContext} from "~/client/context/app_context.js";
import {useNavigationBar} from "~/client/design/navigation_bar.js";
import {ChannelViewAside} from "~/client/forum/channel_view_aside.js";
import {
    PostListView,
    postListViewAsideMaxWidth,
    postViewMaxWidth,
} from "~/client/forum/post_list_view.js";
import {isContentEmpty} from "~/shared/content/is_content_empty.js";
import {addRemLengths, spacing} from "~/shared/design/spacing.js";
import {ChannelModel} from "~/shared/forum/channel_model.js";
import {PostModel} from "~/shared/forum/post_model.js";
import {getChannelPosts} from "~/shared/rpc/forum_rpc_definitions.js";

export function ChannelView({
    withMobileLayout,
    initialChannel,
    initialChannelPostsResult,
}: {
    withMobileLayout: boolean;
    initialChannel: ChannelModel;
    initialChannelPostsResult: {posts: ReadonlyArray<PostModel>; hasMorePosts: boolean};
}) {
    const context = useAppContext();
    const [channel, setChannel] = useState(initialChannel);

    // NOCOMMIT: Get rid of `<ChannelViewTopBar>`

    const hasAside = !isContentEmpty(channel.description.doc);

    const navigationBar = useNavigationBar({
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
            // If we're in a peek, we should have margins even when we have a mobile
            // layout. Having no X margin but having Y margin looks a little weird in a
            // peek rendered on top of other content.
            shouldAlwaysHaveMargin={withMobileLayout}
            channelHeader={useMemo(() => ({channel}), [channel])}
            initialPostsResult={{type: "Many", ...initialChannelPostsResult}}
            onLoadMorePosts={({limit, afterCursor}) => {
                return getChannelPosts(context, {
                    channelId: channel.id,
                    limit,
                    afterCursor,
                });
            }}
            aside={hasAside && <ChannelViewAside channel={channel} />}
            navigationBar={navigationBar}
        />
    );
}
