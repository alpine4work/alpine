import {CaretDown} from "phosphor-react";
import {useAppContext} from "~/client/context/app_context";
import {Box} from "~/client/design/box";
import {Button} from "~/client/design/button";
import {MenuButton} from "~/client/design/menu_button";
import {PostList} from "~/client/forum/post_list";
import {PostListView, postListViewMargin, postMaxWidth} from "~/client/forum/post_list_view";
import {spacing} from "~/shared/design/spacing";
import {ChannelModel} from "~/shared/models/channel_model";
import {PostModel} from "~/shared/models/post_model";
import {getChannelPosts} from "~/shared/rpc/forum_rpc_definitions";
import {sprinkles} from "~/shared/styles/styles";

export function ChannelView({
    channel,
    initialChannelPostsResult,
}: {
    channel: ChannelModel;
    initialChannelPostsResult: {posts: ReadonlyArray<PostModel>; hasMorePosts: boolean};
}) {
    const context = useAppContext();

    return (
        <Box
            display="flex"
            flexDirection="column"
            height="full"
            overflow="hidden"
            position="relative"
            zIndex="0"
        >
            <Box
                flexShrink="0"
                backgroundColor="grey-0"
                borderBottom="grey-10"
                position="relative"
                zIndex="10"
                paddingX={postListViewMargin}
            >
                <Box
                    width="full"
                    maxWidth={postMaxWidth}
                    height="10"
                    marginX="auto"
                    display="flex"
                    alignItems="center"
                >
                    <MenuButton
                        offset="3"
                        offsetAlong="-1"
                        actions={[
                            {
                                label: "Copy link",
                                pressErrorTitle: "Couldn’t copy post link",
                                onPress: async () => {
                                    const url = new URL(
                                        `/s/${channel.spaceId}/channels/${channel.id}`,
                                        window.location.href,
                                    );
                                    await navigator.clipboard.writeText(url.toString());
                                },
                            },
                            {
                                label: "Edit name",
                                onPress: () => {
                                    // TODO(calebmer): Implement
                                },
                            },
                            {
                                label: "Edit description",
                                onPress: () => {
                                    // TODO(calebmer): Implement
                                },
                            },
                        ]}
                    >
                        <Button
                            icon={<CaretDown size={spacing["3"]} />}
                            iconPlacement="end"
                            paddingX="2"
                        >
                            <h1
                                className={sprinkles({
                                    fontStyle: "truncate-semi-bold",
                                    fontSize: "200",
                                })}
                            >
                                {channel.name}
                            </h1>
                        </Button>
                    </MenuButton>
                </Box>
            </Box>
            <Box flexGrow="1" overflow="hidden" position="relative" zIndex="0">
                <PostListView
                    initialPosts={() =>
                        PostList.empty
                            .setChannelHeader({channel})
                            .insertManyPostsAtStart(initialChannelPostsResult.posts)
                            .setHasMorePosts(initialChannelPostsResult.hasMorePosts)
                    }
                    onLoadMorePosts={({limit, afterCursor}) =>
                        getChannelPosts(context, {channelId: channel.id, limit, afterCursor})
                    }
                />
            </Box>
        </Box>
    );
}
