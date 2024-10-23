import {useCallback, useEffect, useRef, useState} from "react";
import {useNavigationBar} from "~/client/design/navigation_bar.js";
import {getPostMoreActions} from "~/client/forum/get_post_more_actions.js";
import {PostContentViewHeader} from "~/client/forum/internal/post_content_view_header.js";
import {PostBasicList} from "~/client/forum/post_list.js";
import {PostListView, PostListViewRef} from "~/client/forum/post_list_view.js";
import {useSpaceContext} from "~/client/spaces/space_context.js";
import {
    desktopPostContentViewMarginTopRemIfSingleLayoutWithPinnedCommentInputAndNavigationBar,
    mobilePostContentViewMarginTopRemIfSingleLayoutWithPinnedCommentInputAndNavigationBar,
} from "~/client/styles/forum_shared_styles.js";
import {contentStyles} from "~/client/styles/styles.js";
import {DynamoGeneralRealtimeItem} from "~/shared/dynamo/dynamo_general_realtime_types.js";
import {PostCommentModel, PostModel} from "~/shared/forum/post_model.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";

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

    const navigationBar = useNavigationBar({
        withMobileLayout,
        withoutDisappearingTitle: true,
        title: (
            <PostContentViewHeader
                post={postResult.post}
                shouldShowChannel={true}
                withNavigationBarLayout={true}
            />
        ),
        desktopMaxWidth: contentStyles.contentMaxWidth,
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
        titleJustifyContent: "flex-start",
        // eslint-disable-next-line react-compiler/react-compiler
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
            navigationBar={navigationBar}
        />
    );
}
