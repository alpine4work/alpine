import {useCallback, useEffect, useRef, useState} from "react";
import {NavigationBarRef, useNavigationBar} from "~/client/design/navigation_bar.js";
import {
    desktopPostContentViewMarginTopRemIfSingleLayoutWithPinnedCommentInputAndNavigationBar,
    getPostMoreActions,
    mobilePostContentViewMarginTopRemIfSingleLayoutWithPinnedCommentInputAndNavigationBar,
} from "~/client/forum/post_content_view.js";
import {PostContentViewHeader} from "~/client/forum/post_content_view_header.js";
import {PostBasicList} from "~/client/forum/post_list.js";
import {PostListView, PostListViewRef, postViewMaxWidth} from "~/client/forum/post_list_view.js";
import {useSpaceContext} from "~/client/spaces/space_context.js";
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

    const [{post, posts}, setPostState] = useState(() => ({
        post: initialPost,
        posts: PostBasicList.empty.insertPostAtEnd(initialPost.model, {
            postCommentsState: "AlwaysOpen",
            initialLoadPostComments: {
                comments: initialPostComments,
                otherReferencedComments: initialOtherReferencedPostComments,
            },
        }),
    }));

    const navigationBarRef = useRef<NavigationBarRef>(null);

    const navigationBar = useNavigationBar({
        ref: navigationBarRef,
        withMobileLayout,
        withoutDisappearingTitle: true,
        title: (
            <PostContentViewHeader
                post={post.model}
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
        mobileTitleJustifyContents: "flex-start",
        menuActions: getPostMoreActions(currentAccount, post.model),
    });

    return (
        <PostListView
            ref={postListRef}
            posts={posts}
            onTogglePostComments={useCallback(
                postId =>
                    setPostState(({post, posts}) => ({
                        post,
                        posts: posts.togglePostComments(postId),
                    })),
                [],
            )}
            onUpdatePostComments={useCallback(
                (postId, update) =>
                    setPostState(({post, posts}) => ({
                        post,
                        posts: posts.updatePostComments(postId, update),
                    })),
                [],
            )}
            shouldBeConnectedToChannelRealtime={false}
            onPostRealtimeEventTransaction={useCallback(({eventTransaction}) => {
                setPostState(({post, posts}) => {
                    for (const event of eventTransaction) {
                        if (post.key === event.item.key) {
                            // If our event transaction has a higher versioned item of the same key then
                            // update our state.
                            if (event.item.key === post.key && event.item.version > post.version) {
                                post = event.item;
                            }
                        }
                    }

                    posts = posts.updatePost(post.model.id, () => post.model);

                    return {post, posts};
                });
            }, [])}
            withMobileLayout={withMobileLayout}
            navigationBar={{...navigationBar, navigationBarRef}}
        />
    );
}
