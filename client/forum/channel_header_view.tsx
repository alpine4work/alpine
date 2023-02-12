import {Box} from "~/client/design/box";
import {Spacer} from "~/client/design/spacer";
import {PostEditorInline} from "~/client/forum/post_editor_inline";
import {PostListChannelHeader} from "~/client/forum/post_list";
import {postListViewMargin, postMaxWidth} from "~/client/forum/post_list_view";
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
            <Box marginX="auto" width="full" maxWidth={postMaxWidth}>
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
                <PostEditorInline
                    channelId={channelHeader.channel.id}
                    onCreatePost={onCreatePost}
                />
                <Spacer space={postListViewMargin} />
            </Box>
        </Box>
    );
}
