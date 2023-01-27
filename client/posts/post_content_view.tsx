import {useNavigate} from "react-router-dom";
import {ContentView} from "~/client/content/content_view";
import {Box} from "~/client/design/box";
import {PrettyAbsoluteDate} from "~/client/design/pretty_absolute_date";
import {PostModel} from "~/shared/models/post_model";
import {truncateClassName} from "~/shared/styles/styles";

export const postContentViewMinHeight = "7.75rem";

export function PostContentView({post}: {post: PostModel}) {
    return (
        <Box style={{minHeight: postContentViewMinHeight}}>
            <Box paddingTop="5" paddingX="5" display="flex" alignItems="center">
                <Box
                    flexShrink="0"
                    width="10"
                    height="10"
                    backgroundColor="grey-40-const"
                    borderRadius="full"
                />
                <Box flexGrow="1" paddingLeft="3" paddingRight="4" overflow="hidden">
                    <Box fontSize="sm" fontStyle="semi-bold" className={truncateClassName}>
                        {post.author.name}
                    </Box>
                    <Box fontSize="xs" color="grey-50" className={truncateClassName}>
                        <PrettyAbsoluteDate date={post.createdTime} />
                    </Box>
                </Box>
            </Box>
            <Box paddingX="3" paddingY="5">
                <ContentView content={post.content} onNavigate={useNavigate()} />
            </Box>
        </Box>
    );
}
