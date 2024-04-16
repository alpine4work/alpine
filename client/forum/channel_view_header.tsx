import {ContentView} from "~/client/content/content_view.js";
import {Box} from "~/client/design/box.js";
import {channelViewAsidePaddingY} from "~/client/forum/channel_view_aside.js";
import {
    postContentViewOuterMarginY,
    postContentViewPaddingX,
} from "~/client/forum/post_content_view.js";
import {
    PostFauxInputCreateButton,
    postFauxInputCreateButtonHeight,
} from "~/client/forum/post_faux_input_create_button.js";
import {PostListChannelHeader} from "~/client/forum/post_list.js";
import {isContentEmpty} from "~/shared/content/is_content_empty.js";
import {addRemLengths, spacing} from "~/shared/design/spacing.js";
import {sprinkles} from "~/shared/styles/styles.js";

export const channelViewHeaderMinHeight = addRemLengths(
    spacing[channelViewAsidePaddingY],
    spacing[postFauxInputCreateButtonHeight],
    spacing[postContentViewOuterMarginY],
);

export function ChannelViewHeader({
    channelHeader,
    withMobileLayout,
}: {
    channelHeader: PostListChannelHeader;
    withMobileLayout: boolean;
}) {
    return (
        <>
            {withMobileLayout && !isContentEmpty(channelHeader.channel.description.doc) && (
                <Box paddingBottom="4" paddingX="4">
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
            <Box
                paddingTop={channelViewAsidePaddingY}
                paddingBottom={postContentViewOuterMarginY}
                paddingX={postContentViewPaddingX}
            >
                <PostFauxInputCreateButton channel={channelHeader.channel} />
            </Box>
        </>
    );
}
