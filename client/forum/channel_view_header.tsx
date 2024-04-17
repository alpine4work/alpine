import {useMemo, useState} from "react";
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
import {getContentSnippet} from "~/shared/content/get_content_snippet.js";
import {isContentEmpty} from "~/shared/content/is_content_empty.js";
import {addRemLengths, spacing} from "~/shared/design/spacing.js";
import {MessageContentWithReferences} from "~/shared/messaging/message_content_schema.js";
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
                <Box paddingBottom="2" paddingX="3">
                    <h3
                        className={sprinkles({
                            paddingLeft: "2",
                            paddingBottom: "1",
                            color: "grey-50",
                        })}
                    >
                        About
                    </h3>
                    <ChannelViewHeaderMobileDescription
                        description={channelHeader.channel.description}
                    />
                </Box>
            )}
            <Box
                paddingTop={channelViewAsidePaddingY}
                paddingBottom={postContentViewOuterMarginY}
                paddingX={postContentViewPaddingX}
            >
                <PostFauxInputCreateButton
                    channel={channelHeader.channel}
                    isCreatingChannel={channelHeader.isCreatingChannel}
                />
            </Box>
        </>
    );
}

function ChannelViewHeaderMobileDescription({
    description,
}: {
    description: MessageContentWithReferences;
}) {
    const descriptionSnippet = useMemo(() => {
        return {
            doc: getContentSnippet(
                description.doc.resolve(0),
                {linesAbove: 0, linesBelow: 3},
                {
                    // 1.125x the number of "x"s we can fit in a single line in a peek (64). We
                    // want to be slightly more aggressive than the default grapheme count (which
                    // counts the "l" character which is narrower) since we render the entire
                    // snippet.
                    maxLineGraphemeCount: 72,
                },
            ),
            references: description.references,
        };
    }, [description.doc, description.references]);

    const isDescriptionSnippetTruncated =
        description.doc.nodeSize !== descriptionSnippet.doc.nodeSize;

    const [isShowingAllContent, setIsShowingAllContent] = useState(!isDescriptionSnippetTruncated);
    if (!isShowingAllContent && !isDescriptionSnippetTruncated) setIsShowingAllContent(true);

    return (
        <ContentView
            content={
                isDescriptionSnippetTruncated && !isShowingAllContent
                    ? descriptionSnippet
                    : description
            }
            onSeeMoreContent={
                isDescriptionSnippetTruncated && !isShowingAllContent
                    ? () => setIsShowingAllContent(true)
                    : undefined
            }
            onSeeLessContent={
                isDescriptionSnippetTruncated && isShowingAllContent
                    ? () => setIsShowingAllContent(false)
                    : undefined
            }
        />
    );
}
