import {useNavigate} from "react-router-dom";
import {ContentView} from "~/client/content/content_view";
import {Box} from "~/client/design/box";
import {PostEditorInline, postEditorInlineMinHeight} from "~/client/forum/post_editor_inline";
import {PostListChannelHeader} from "~/client/forum/post_list";
import {postListViewMargin} from "~/client/forum/post_list_view";
import {useIsMobile} from "~/client/helpers/use_is_mobile";
import {PostModel} from "~/shared/models/post_model";
import {sprinkles} from "~/shared/styles/styles";

export const channelViewHeaderMinHeight = postEditorInlineMinHeight;

export function ChannelViewHeader({
    channelHeader,
    onCreatePost,
}: {
    channelHeader: PostListChannelHeader;
    onCreatePost: (post: PostModel) => void;
}) {
    const navigate = useNavigate();
    const isMobile = useIsMobile();

    return (
        <>
            {isMobile && (
                <Box paddingBottom={postListViewMargin}>
                    <h3
                        className={sprinkles({
                            paddingLeft: "2",
                            paddingBottom: "1",
                            color: "grey-50",
                        })}
                    >
                        About
                    </h3>
                    <ContentView
                        content={channelHeader.channel.description}
                        onNavigate={navigate}
                    />
                </Box>
            )}
            <PostEditorInline channelId={channelHeader.channel.id} onCreatePost={onCreatePost} />
        </>
    );
}
