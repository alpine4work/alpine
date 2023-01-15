import {useNavigate} from "react-router-dom";
import {ContentView} from "~/client/content/content_view";
import {Box} from "~/client/design/box";
import {PostModel} from "~/shared/posts/post_model";
import {truncateClassName} from "~/shared/styles/styles";

// TODO(calebmer):
//
// - Change grey color scale to make elevation designs easier
// - Pretty rendering for time (relative rendering with tooltip)
// - Comment input
// - Load account information (global account cache??? context module
//   where data is included in handoff? maybe we don't bother normalizing
//   for now?)

export function PostView({post}: {post: PostModel}) {
    return (
        <Box
            maxWidth="160"
            width="full"
            alignSelf="flex-start"
            backgroundColor={{light: "grey-0", dark: "grey-5"}}
            borderRadius="md"
            boxShadow="elevation-5"
        >
            <Box paddingTop="5" paddingX="5" display="flex" alignItems="center">
                <Box
                    flexShrink="0"
                    width="10"
                    height="10"
                    backgroundColor="grey-30-const"
                    borderRadius="full"
                />
                <Box flexGrow="1" paddingLeft="3" paddingRight="4" overflow="hidden">
                    <Box fontSize="sm" fontStyle="semi-bold" className={truncateClassName}>
                        Caleb Meredith
                    </Box>
                    <Box fontSize="xs" color="grey-50" className={truncateClassName}>
                        {post.createdTime.toISOString()}
                    </Box>
                </Box>
            </Box>
            <Box paddingX="1" paddingTop="5" paddingBottom="5">
                <ContentView content={post.content} onNavigate={useNavigate()} />
            </Box>
        </Box>
    );
}
