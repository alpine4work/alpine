import {AccountAvatar} from "~/client/accounts/account_avatar";
import {Box} from "~/client/design/box";
import {PrettyAbsoluteDate} from "~/client/design/pretty_absolute_date";
import {PostModel} from "~/shared/models/post_model";

export function PostContentViewHeader({post}: {post: PostModel}) {
    return (
        <Box display="flex" alignItems="center">
            <AccountAvatar account={post.author} size="8" />
            <Box flexGrow="1" paddingX="3" overflow="hidden">
                <Box fontSize="75" fontStyle="truncate-semi-bold">
                    {post.author.name}
                </Box>
                <Box fontSize="50" fontStyle="truncate" color="grey-50">
                    <PrettyAbsoluteDate placement="bottom" date={post.createdTime} />
                </Box>
            </Box>
        </Box>
    );
}
