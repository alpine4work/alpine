import {ContentView} from "~/client/content/content_view.js";
import {Box} from "~/client/design/box.js";
import {PostEditorInline, postEditorInlineMinHeight} from "~/client/forum/post_editor_inline.js";
import {PostListChannelHeader} from "~/client/forum/post_list.js";
import {postListViewMarginX, postListViewMarginY} from "~/client/forum/post_list_view.js";
import {useIsMobile} from "~/client/remix/use_is_mobile.js";
import {isContentEmpty} from "~/shared/content/is_content_empty.js";
import {PostModel} from "~/shared/forum/post_model.js";
import {sprinkles} from "~/shared/styles/styles.js";

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
            {isMobile && !isContentEmpty(channelHeader.channel.description.doc) && (
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
                channel={channelHeader.channel}
                onCreatePost={onCreatePost}
                parentHasMargin={parentHasMargin}
            />
        </>
    );
}
