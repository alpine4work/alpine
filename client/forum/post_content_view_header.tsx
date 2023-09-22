import {Link} from "@remix-run/react";
import {useHover} from "react-aria";
import {AccountAvatar} from "~/client/accounts/account_avatar.js";
import {useAccountModel} from "~/client/accounts/account_client_store_context_provider.js";
import {Box} from "~/client/design/box.js";
import {PrettyAbsoluteDate} from "~/client/design/pretty_absolute_date.js";
import {PostModel} from "~/shared/forum/post_model.js";
import {sprinkles} from "~/shared/styles/styles.js";

export function PostContentViewHeader({
    post,
    shouldShowChannel,
}: {
    post: PostModel;
    shouldShowChannel: boolean;
}) {
    const {isHovered: isChannelHovered, hoverProps: channelHoverProps} = useHover({});

    return (
        <Box display="flex" alignItems="center">
            <AccountAvatar account={post.author} size="8" />
            <Box flexGrow="1" paddingX="3" overflow="hidden">
                <Box fontSize="75" fontStyle="truncate" color="grey-70">
                    <span className={sprinkles({color: "grey-text", fontStyle: "semi-bold"})}>
                        {useAccountModel(post.author).name}
                    </span>
                    {shouldShowChannel && (
                        <>
                            {" "}
                            in{" "}
                            <Link
                                {...channelHoverProps}
                                className={sprinkles({
                                    color: "grey-text",
                                    fontStyle: "semi-bold",
                                    // This design has a weak link affordance so use a pointer cursor to make it
                                    // clear this text is clickable.
                                    cursor: "pointer",
                                })}
                                style={{textDecoration: isChannelHovered ? "underline" : undefined}}
                                to={`/s/${post.spaceId}/channels/${post.channel.id}`}
                            >
                                {post.channel.name}
                            </Link>
                        </>
                    )}
                </Box>
                <Box fontSize="50" fontStyle="truncate" color="grey-50">
                    <PrettyAbsoluteDate tooltipPlacement="bottom" date={post.createdTime} />
                </Box>
            </Box>
        </Box>
    );
}
