import {ReactNode} from "react";
import {usePress} from "react-aria";
import {AccountAvatar} from "~/client/accounts/account_avatar.js";
import {useAccountModel} from "~/client/accounts/account_client_store_context.js";
import {Box} from "~/client/design/box.js";
import {FocusRing} from "~/client/design/focus_ring.js";
import {PrettyAbsoluteDate} from "~/client/design/pretty_absolute_date.js";
import {usePlatform} from "~/client/remix/platform_context.js";
import {useNavigate} from "~/client/remix/use_navigate.js";
import {
    postContentViewHeaderAvatarSize,
    postContentViewHeaderHeight,
} from "~/client/styles/forum_shared_styles.js";
import {fontSizes, sprinkles} from "~/client/styles/styles.js";
import {ChannelPreviewModel} from "~/shared/forum/channel_model.js";
import {PostModel} from "~/shared/forum/post_model.js";
import {AccountModel} from "~/shared/spaces/account_model.js";

export function PostContentViewHeader({
    post,
    shouldShowChannel,
    stopNavigateToChannelPropagation,
    withNavigationBarLayout,
}: {
    post: PostModel;
    shouldShowChannel: boolean;
    stopNavigateToChannelPropagation?: boolean;
    withNavigationBarLayout?: boolean;
}) {
    return (
        <PostContentViewHeaderBase
            author={post.author}
            createdTime={post.createdTime}
            channel={shouldShowChannel ? post.channel : undefined}
            stopNavigateToChannelPropagation={stopNavigateToChannelPropagation}
            withNavigationBarLayout={withNavigationBarLayout}
        />
    );
}

export function PostContentViewHeaderBase({
    author,
    createdTime,
    shouldCreatedTimeExcludeTime,
    extraAfterCreatedTime,
    channel,
    channelSelector,
    stopNavigateToChannelPropagation = false,
    withNavigationBarLayout,
}: {
    author: AccountModel;
    createdTime: Date;
    shouldCreatedTimeExcludeTime?: boolean;
    extraAfterCreatedTime?: string;
    channel?: ChannelPreviewModel;
    channelSelector?: ReactNode;
    stopNavigateToChannelPropagation?: boolean;
    withNavigationBarLayout?: boolean;
}) {
    const platform = usePlatform();

    return (
        <Box height={postContentViewHeaderHeight} display="flex" alignItems="center">
            <AccountAvatar
                account={author}
                size={
                    withNavigationBarLayout && platform === "mobile"
                        ? "7"
                        : postContentViewHeaderAvatarSize
                }
            />
            <Box paddingLeft={{mobile: "2", desktop: "3"}} overflow="hidden">
                <Box fontSize="75" fontStyle="truncate" color="grey-70">
                    <span className={sprinkles({color: "grey-100", fontStyle: "semi-bold"})}>
                        {useAccountModel(author).name}
                    </span>
                    {channel && (
                        <PostContentViewHeaderChannelBase
                            channel={channel}
                            stopNavigateToChannelPropagation={stopNavigateToChannelPropagation}
                        />
                    )}
                </Box>
                <Box fontSize="50" fontStyle="truncate" color="grey-50">
                    <PrettyAbsoluteDate
                        tooltipPlacement="bottom"
                        date={createdTime}
                        withoutTime={shouldCreatedTimeExcludeTime}
                    />
                    {extraAfterCreatedTime}
                </Box>
            </Box>
            {channelSelector && (
                <Box
                    flexGrow={platform === "mobile" ? "1" : undefined}
                    flexShrink="0"
                    display="flex"
                    alignItems="center"
                    // On mobile devices, we'd like for the channel selector to be aligned with the
                    // right edge of the phone screen so increase the amount of space surrounding
                    // the text "in". This looks a little weird for short names.
                    justifyContent="flex-end"
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

function PostContentViewHeaderChannelBase({
    channel,
    stopNavigateToChannelPropagation,
}: {
    channel: ChannelPreviewModel;
    stopNavigateToChannelPropagation: boolean;
}) {
    const navigate = useNavigate();
    const {isPressed, pressProps} = usePress({
        onPress: () => {
            navigate(`/s/${channel.spaceId}/channels/${channel.id}`, {
                stopPropagation: stopNavigateToChannelPropagation,
            });
        },
    });

    return (
        <>
            {" "}
            in{" "}
            <FocusRing>
                <a
                    {...pressProps}
                    className={sprinkles({
                        color: "grey-100",
                        fontStyle: "semi-bold",
                        // This design has a weak link affordance so use a pointer cursor to make it
                        // clear this text is clickable.
                        cursor: "pointer",
                        opacity: isPressed ? "60" : undefined,
                    })}
                    href={`/s/${channel.spaceId}/channels/${channel.id}`}
                    onClick={event => {
                        // Custom link navigation handling...
                        event.preventDefault();

                        pressProps.onClick?.(event);
                    }}
                >
                    {channel.name}
                </a>
            </FocusRing>
        </>
    );
}
