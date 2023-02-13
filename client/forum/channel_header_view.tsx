import {Box} from "~/client/design/box";
import {Spacer} from "~/client/design/spacer";
import {PostEditorInline} from "~/client/forum/post_editor_inline";
import {PostListChannelHeader} from "~/client/forum/post_list";
import {postListViewMargin, postMaxWidth} from "~/client/forum/post_list_view";
import {RemLength, parseRemLengthNumber, spacing} from "~/shared/design/spacing";
import {PostModel} from "~/shared/models/post_model";

export function getChannelHeaderViewMinHeight(): RemLength {
    return `${3.25 + parseRemLengthNumber(spacing[postListViewMargin]) * 2}rem`;
}

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
                <Spacer space={postListViewMargin} />
                <PostEditorInline
                    channelId={channelHeader.channel.id}
                    onCreatePost={onCreatePost}
                />
                <Spacer space={postListViewMargin} />
            </Box>
        </Box>
    );
}
