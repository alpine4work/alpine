import {Box} from "~/client/design/box";
import {Spacer} from "~/client/design/spacer";
import {PostCreator} from "~/client/forum/post_creator";
import {PostListChannelHeader} from "~/client/forum/post_list";
import {postListViewMargin} from "~/client/forum/post_list_view";
import {sprinkles} from "~/shared/styles/styles";

// TODO(calebmer): Real value!
export const channelHeaderViewMinHeight = "4rem";

export function ChannelHeaderView({channelHeader}: {channelHeader: PostListChannelHeader}) {
    return (
        <Box paddingX={postListViewMargin}>
            <Box marginX="auto" width="full" maxWidth="160">
                <h1
                    className={sprinkles({
                        fontStyle: "truncate-bold",
                        fontSize: "600",
                        paddingTop: postListViewMargin,
                        paddingBottom: "2",
                    })}
                >
                    {channelHeader.channel.name}
                </h1>
                <Box backgroundColor="grey-0" borderRadius="md" boxShadow="elevation-5">
                    <PostCreator channelId={channelHeader.channel.id} />
                </Box>
                <Spacer space={postListViewMargin} />
            </Box>
        </Box>
    );
}
