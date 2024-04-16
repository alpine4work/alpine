import {useCallback, useEffect, useRef, useState} from "react";
import {PostBasicList} from "~/client/forum/post_list.js";
import {PostListView, PostListViewRef} from "~/client/forum/post_list_view.js";
import {PostCommentModel, PostModel} from "~/shared/forum/post_model.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";

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

    // NOCOMMIT: Post update realtime updates??
    const [posts, setPosts] = useState(() =>
        PostBasicList.empty.insertPostAtEnd(initialPost, {
            postCommentsState: "AlwaysOpen",
            initialLoadPostComments: {
                comments: initialPostComments,
                otherReferencedComments: initialOtherReferencedPostComments,
            },
        }),
    );

    return (
        <PostListView
            ref={postListRef}
            posts={posts}
            onTogglePostComments={useCallback(
                postId => setPosts(posts => posts.togglePostComments(postId)),
                [],
            )}
            onUpdatePostComments={useCallback(
                (postId, update) => setPosts(posts => posts.updatePostComments(postId, update)),
                [],
            )}
            onPostRealtimeEventTransaction={() => {
                // NOCOMMIT: Implement!!
            }}
            withMobileLayout={withMobileLayout}
        />
    );
}
