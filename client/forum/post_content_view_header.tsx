import {Link} from "@remix-run/react";
import {useHover} from "react-aria";
import {AccountAvatar} from "~/client/accounts/account_avatar";
import {Box} from "~/client/design/box";
import {PrettyAbsoluteDate} from "~/client/design/pretty_absolute_date";
import {PostModel} from "~/shared/models/post_model";
import {sprinkles} from "~/shared/styles/styles";

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
                        {post.author.name}
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
                    <PrettyAbsoluteDate placement="bottom" date={post.createdTime} />
                </Box>
            </Box>
        </Box>
    );
}
