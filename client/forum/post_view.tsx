import {useEffect, useRef} from "react";
import {PostListView, PostListViewRef} from "~/client/forum/post_list_view";
import {assertExists} from "~/shared/helpers/control/assert_exists";
import {PostCommentModel, PostModel} from "~/shared/models/post_model";

export function PostView({
    initialPost,
    initialPostComments,
    initialOtherReferencedPostComments,
    initialScrollToPostCommentIndex,
    withMobileLayout,
}: {
    initialPost: PostModel;
    initialPostComments: ReadonlyArray<PostCommentModel>;
    initialOtherReferencedPostComments: ReadonlyArray<PostCommentModel>;
    initialScrollToPostCommentIndex: number | null;
    withMobileLayout?: boolean;
}) {
    const postListRef = useRef<PostListViewRef>(null);
    const hasInitializedRef = useRef(false);

    // TODO(calebmer): Support server-side rendering for immediately jumping to a
    // comment in the middle of a post. This will make transitions seamless when
    // you click on a link to a comment.
    useEffect(() => {
        if (hasInitializedRef.current) return;
        hasInitializedRef.current = true;

        const postList = assertExists(postListRef.current);

        if (initialScrollToPostCommentIndex !== null)
            postList.jumpToPostCommentIndex(initialPost.id, initialScrollToPostCommentIndex);
    }, [initialPost.id, initialScrollToPostCommentIndex]);

    return (
        <PostListView
            ref={postListRef}
            initialPostsResult={{
                type: "One",
                post: initialPost,
                postCommentsState: "AlwaysOpen",
                initialLoadPostComments: {
                    comments: initialPostComments,
                    otherReferencedComments: initialOtherReferencedPostComments,
                },
            }}
            withMobileLayout={withMobileLayout}
        />
    );
}
