import {useCallback, useEffect, useRef, useState} from "react";
import {NavigationBarRef, useNavigationBar} from "~/client/design/navigation_bar.js";
import {PostContentViewHeader} from "~/client/forum/internal/post_content_view_header.js";
import {getPostMoreActions} from "~/client/forum/post_content_view.js";
import {PostBasicList} from "~/client/forum/post_list.js";
import {PostListView, PostListViewRef} from "~/client/forum/post_list_view.js";
import {useSpaceContext} from "~/client/spaces/space_context.js";
import {DynamoGeneralRealtimeItem} from "~/shared/dynamo/dynamo_general_realtime_types.js";
import {PostCommentModel, PostModel} from "~/shared/forum/post_model.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {
    desktopPostContentViewMarginTopRemIfSingleLayoutWithPinnedCommentInputAndNavigationBar,
    mobilePostContentViewMarginTopRemIfSingleLayoutWithPinnedCommentInputAndNavigationBar,
    postViewMaxWidth,
} from "~/shared/styles/forum_shared_styles.js";

export function PostView({
    initialPost,
    initialPostComments,
    initialOtherReferencedPostComments,
    initialScrollToPostCommentIndex,
    withMobileLayout = false,
}: {
    initialPost: DynamoGeneralRealtimeItem<PostModel>;
    initialPostComments: ReadonlyArray<PostCommentModel>;
    initialOtherReferencedPostComments: ReadonlyArray<PostCommentModel>;
    initialScrollToPostCommentIndex: number | null;
    withMobileLayout?: boolean;
}) {
    const {currentAccount} = useSpaceContext();

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
            postList.jumpToPostCommentIndex(initialPost.model.id, initialScrollToPostCommentIndex);
    }, [initialPost.model.id, initialScrollToPostCommentIndex]);

    const [postsFromState, setPosts] = useState(() =>
        PostBasicList.new({
            type: "One",
            post: initialPost,
            postCommentsState: "AlwaysOpen",
            postComments: {
                comments: initialPostComments,
                otherReferencedComments: initialOtherReferencedPostComments,
            },
        }),
    );

    let posts = postsFromState;
    let postResult = posts.getPostByIdIfExists(initialPost.model.id);

    if (!postResult) {
        const newPosts = PostBasicList.new({
            type: "One",
            post: initialPost,
            postCommentsState: "AlwaysOpen",
            postComments: {
                comments: initialPostComments,
                otherReferencedComments: initialOtherReferencedPostComments,
            },
        });

        setPosts(newPosts);
        posts = newPosts;

        postResult = newPosts.getPostById(initialPost.model.id);
    }

    const navigationBarRef = useRef<NavigationBarRef>(null);

    const navigationBar = useNavigationBar({
        ref: navigationBarRef,
        withMobileLayout,
        withoutDisappearingTitle: true,
        title: (
            <PostContentViewHeader
                post={postResult.post}
                shouldShowChannel={true}
                withNavigationBarLayout={true}
            />
        ),
        desktopMaxWidth: postViewMaxWidth,
        // Add a bit of margin to the top so it looks like we have
        // `postContentViewOuterMarginY` worth of space above the post. This does
        // create a weird scroll effect where if you scroll to the top fast it looks
        // like the header kinda jumps? Don't love that.
        desktopMarginTop: !withMobileLayout
            ? `${desktopPostContentViewMarginTopRemIfSingleLayoutWithPinnedCommentInputAndNavigationBar}rem`
            : `${mobilePostContentViewMarginTopRemIfSingleLayoutWithPinnedCommentInputAndNavigationBar}rem`,
        // `<PostListView>` needs this prop to specifically be set to null so we can
        // replace it when in a post editing state.
        replaceActions: null,
        titleJustifyContents: "flex-start",
        menuActions: getPostMoreActions({
            currentAccount,
            post: postResult.post,
            onStartEditingPost: () => {
                assertExists(postListRef.current).startEditingPost(
                    postResult!.post.id,
                    postResult!.post.content,
                );
            },
        }),
    });

    return (
        <PostListView
            ref={postListRef}
            posts={posts}
            onTogglePostComments={useCallback(postId => {
                setPosts(posts => posts.togglePostComments(postId));
            }, [])}
            onUpdatePostComments={useCallback((postId, update) => {
                setPosts(posts => posts.updatePostComments(postId, update));
            }, [])}
            shouldBeConnectedToChannelRealtime={false}
            onPostRealtimeEventTransaction={useCallback(({eventTransaction}) => {
                setPosts(posts => posts.handleEventTransaction(eventTransaction));
            }, [])}
            withMobileLayout={withMobileLayout}
            navigationBar={{...navigationBar, navigationBarRef}}
        />
    );
}
