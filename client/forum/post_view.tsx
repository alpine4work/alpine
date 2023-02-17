import {Box} from "~/client/design/box";
import {PostListView} from "~/client/forum/post_list_view";
import {PostCommentModel, PostModel} from "~/shared/models/post_model";
import {mobileGrey0BackgroundColorClassName} from "~/shared/styles/styles";

export function PostView({
    initialPost,
    initialPostComments,
    initialOtherReferencedPostComments,
}: {
    initialPost: PostModel;
    initialPostComments: ReadonlyArray<PostCommentModel>;
    initialOtherReferencedPostComments: ReadonlyArray<PostCommentModel>;
}) {
    return (
        <Box height="full" className={mobileGrey0BackgroundColorClassName}>
            <PostListView
                initialPostsResult={{
                    type: "One",
                    post: initialPost,
                    postCommentsState: "AlwaysOpen",
                    initialLoadPostComments: {
                        comments: initialPostComments,
                        otherReferencedComments: initialOtherReferencedPostComments,
                    },
                }}
            />
        </Box>
    );
}
