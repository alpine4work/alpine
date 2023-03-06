import {ContentView} from "~/client/content/content_view";
import {Box} from "~/client/design/box";
import {PostEditorInline, postEditorInlineMinHeight} from "~/client/forum/post_editor_inline";
import {PostListChannelHeader} from "~/client/forum/post_list";
import {postListViewMarginX, postListViewMarginY} from "~/client/forum/post_list_view";
import {useIsMobile} from "~/client/remix/use_is_mobile";
import {PostModel} from "~/shared/models/post_model";
import {sprinkles} from "~/shared/styles/styles";

export const channelViewHeaderMinHeight = postEditorInlineMinHeight;

export function ChannelViewHeader({
    channelHeader,
    onCreatePost,
    parentHasMargin,
}: {
    channelHeader: PostListChannelHeader;
    onCreatePost: (post: PostModel) => void;
    parentHasMargin: boolean;
}) {
    const isMobile = useIsMobile();

    return (
        <>
            {isMobile && (
                <Box
                    paddingBottom={postListViewMarginY}
                    paddingX={!parentHasMargin ? postListViewMarginX : undefined}
                >
                    <h3
                        className={sprinkles({
                            paddingLeft: "2",
                            paddingBottom: "1",
                            color: "grey-50",
                        })}
                    >
                        About
                    </h3>
                    <ContentView content={channelHeader.channel.description} />
                </Box>
            )}
            <PostEditorInline
                channelId={channelHeader.channel.id}
                onCreatePost={onCreatePost}
                parentHasMargin={parentHasMargin}
            />
        </>
    );
}
