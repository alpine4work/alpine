import {ReactNode} from "react";
import {useHover} from "react-aria";
import {AccountAvatar} from "~/client/accounts/account_avatar.js";
import {useAccountModel} from "~/client/accounts/account_client_store_context_provider.js";
import {Box} from "~/client/design/box.js";
import {PrettyAbsoluteDate} from "~/client/design/pretty_absolute_date.js";
import {useIsMobile} from "~/client/remix/use_is_mobile.js";
import {useNavigate} from "~/client/remix/use_navigate.js";
import {AccountModel} from "~/shared/accounts/account_model.js";
import {ChannelPreviewModel} from "~/shared/forum/channel_model.js";
import {PostModel} from "~/shared/forum/post_model.js";
import {fontSizes, sprinkles} from "~/shared/styles/styles.js";

export const postContentViewHeaderAvatarSize = "8";
export const postContentViewHeaderHeight = "8";

export function PostContentViewHeader({
    post,
    shouldShowChannel,
    withNavigationBarLayout,
}: {
    post: PostModel;
    shouldShowChannel: boolean;
    withNavigationBarLayout?: boolean;
}) {
    return (
        <PostContentViewHeaderBase
            author={post.author}
            createdTime={post.createdTime}
            channel={shouldShowChannel ? post.channel : undefined}
            withNavigationBarLayout={withNavigationBarLayout}
        />
    );
}

export function PostContentViewHeaderBase({
    author,
    createdTime,
    shouldCreatedTimeExcludeTime,
    channel,
    channelSelector,
    withNavigationBarLayout,
}: {
    author: AccountModel;
    createdTime: Date;
    shouldCreatedTimeExcludeTime?: boolean;
    channel?: ChannelPreviewModel;
    channelSelector?: ReactNode;
    withNavigationBarLayout?: boolean;
}) {
    const isMobile = useIsMobile();

    return (
        <Box height={postContentViewHeaderHeight} display="flex" alignItems="center">
            <AccountAvatar
                account={author}
                size={withNavigationBarLayout && isMobile ? "7" : postContentViewHeaderAvatarSize}
            />
            <Box paddingLeft={withNavigationBarLayout && isMobile ? "2" : "3"} overflow="hidden">
                <Box fontSize="75" fontStyle="truncate" color="grey-70">
                    <span className={sprinkles({color: "grey-text", fontStyle: "semi-bold"})}>
                        {useAccountModel(author).name}
                    </span>
                    {channel && <PostContentViewHeaderChannelBase channel={channel} />}
                </Box>
                <Box fontSize="50" fontStyle="truncate" color="grey-50">
                    <PrettyAbsoluteDate
                        tooltipPlacement="bottom"
                        date={createdTime}
                        shouldExcludeTime={shouldCreatedTimeExcludeTime}
                    />
                </Box>
            </Box>
            {channelSelector && (
                <Box
                    flexShrink="0"
                    display="flex"
                    alignItems="center"
                    gap="1.5"
                    paddingLeft="1"
                    style={{paddingBottom: fontSizes["50"].lineHeight}}
                >
                    <Box fontSize="75" color="grey-70">
                        in
                    </Box>
                    {channelSelector}
                </Box>
            )}
        </Box>
    );
}

function PostContentViewHeaderChannelBase({channel}: {channel: ChannelPreviewModel}) {
    const navigate = useNavigate();
    const {isHovered: isChannelHovered, hoverProps: channelHoverProps} = useHover({});

    return (
        <>
            {" "}
            in{" "}
            <a
                {...channelHoverProps}
                className={sprinkles({
                    color: "grey-text",
                    fontStyle: "semi-bold",
                    // This design has a weak link affordance so use a pointer cursor to make it
                    // clear this text is clickable.
                    cursor: "pointer",
                })}
                style={{textDecoration: isChannelHovered ? "underline" : undefined}}
                href={`/s/${channel.spaceId}/channels/${channel.id}`}
                onClick={event => {
                    // Custom link navigation handling...
                    event.preventDefault();

                    // TODO(calebmer, #global-loading-indicator): Some global loading indicator?
                    void navigate(`/s/${channel.spaceId}/channels/${channel.id}`);
                }}
            >
                {channel.name}
            </a>
        </>
    );
}
