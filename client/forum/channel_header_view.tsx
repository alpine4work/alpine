import {Box} from "~/client/design/box";
import {Spacer} from "~/client/design/spacer";
import {PostCreator} from "~/client/forum/post_creator";
import {PostListChannelHeader} from "~/client/forum/post_list";
import {postListViewMargin} from "~/client/forum/post_list_view";
import {PostModel} from "~/shared/models/post_model";
import {sprinkles} from "~/shared/styles/styles";

export const channelHeaderViewMinHeight = "8.25rem";

export function ChannelHeaderView({
    channelHeader,
    onCreatePost,
}: {
    channelHeader: PostListChannelHeader;
    onCreatePost: (post: PostModel) => void;
}) {
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
                <PostCreator channelId={channelHeader.channel.id} onCreatePost={onCreatePost} />
                <Spacer space={postListViewMargin} />
            </Box>
        </Box>
    );
}
