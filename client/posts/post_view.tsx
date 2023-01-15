import {useState} from "react";
import {useNavigate} from "react-router-dom";
import {ContentEditor} from "~/client/content/content_editor";
import {ContentEditorState} from "~/client/content/content_editor_state";
import {ContentView} from "~/client/content/content_view";
import {Box} from "~/client/design/box";
import {PrettyAbsoluteDate} from "~/client/helpers/date/pretty_absolute_date";
import {emptyPostCommentContent} from "~/shared/posts/post_comment_content_schema";
import {PostModel} from "~/shared/posts/post_model";
import {sprinkles, truncateClassName} from "~/shared/styles/styles";

// TODO(calebmer):
//
// - Change grey color scale to make elevation designs easier
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
            backgroundColor="grey-0"
            borderRadius="md"
            boxShadow="elevation-5"
        >
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
                        Caleb Meredith
                    </Box>
                    <Box fontSize="xs" color="grey-50" className={truncateClassName}>
                        <PrettyAbsoluteDate date={post.createdTime} />
                    </Box>
                </Box>
            </Box>
            <Box paddingX="3" paddingY="5">
                <ContentView content={post.content} onNavigate={useNavigate()} />
            </Box>
            <Box marginX="5" borderBottom="grey-5" />
            <Box paddingX="5" paddingY="3">
                <PostCommentInput />
            </Box>
        </Box>
    );
}

function PostCommentInput() {
    const [state, setState] = useState(ContentEditorState.create(emptyPostCommentContent));

    return (
        <Box display="flex">
            <Box marginY="1">
                <Box
                    flexShrink="0"
                    width="8"
                    height="8"
                    backgroundColor="grey-40-const"
                    borderRadius="full"
                />
            </Box>
            <Box flexGrow="1" marginLeft="2" backgroundColor="grey-5" borderRadius="bubble">
                <ContentEditor
                    state={state}
                    onChange={setState}
                    onNavigate={useNavigate()}
                    aria-label="Comment"
                    placeholder="Write a comment…"
                    className={sprinkles({paddingY: "2", paddingX: "1.5"})}
                    onEnter={() => {
                        console.log("YO");
                    }}
                />
            </Box>
        </Box>
    );
}
