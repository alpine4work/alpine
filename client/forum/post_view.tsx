import {Memo, useCallback, useEffect, useRef} from "react";
import {getPostMoreActions} from "~/client/forum/get_post_more_actions.js";
import {PostContentViewHeader} from "~/client/forum/internal/post_content_view_header.js";
import {PostContentViewInitialScroll} from "~/client/forum/post_content_view.js";
import {PostBasicList} from "~/client/forum/post_list.js";
import {PostListView, PostListViewRef} from "~/client/forum/post_list_view.js";
import {useStateWithOptimisticUpdates} from "~/client/helpers/use_state_with_optimistic_updates.js";
import {useNavigationBar} from "~/client/navigation/navigation_bar.js";
import {useSpaceContext} from "~/client/spaces/space_context.js";
import {contentStyles} from "~/client/styles/styles.js";
import {DynamoGeneralRealtimeItem} from "~/shared/dynamo/dynamo_general_realtime_types.js";
import {PostCommentModel, PostModel} from "~/shared/forum/post_model.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";

export type PostViewInitialScroll =
    | PostContentViewInitialScroll
    | {readonly type: "Comment"; readonly commentIndex: number};

export function PostView({
    initialPost,
    initialPostComments,
    initialOtherReferencedPostComments,
    initialScroll,
}: {
    initialPost: DynamoGeneralRealtimeItem<PostModel>;
    initialPostComments: ReadonlyArray<PostCommentModel>;
    initialOtherReferencedPostComments: ReadonlyArray<PostCommentModel>;
    initialScroll: Memo<PostViewInitialScroll> | null;
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

        if (initialScroll?.type === "Comment")
            postList.jumpToPostCommentIndex(initialPost.model.id, initialScroll.commentIndex);
    }, [initialPost.model.id, initialScroll]);

    const [postsFromState, setPosts, setPostsOptimistically] = useStateWithOptimisticUpdates(() =>
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

        setPosts(() => newPosts);
        posts = newPosts;

        postResult = newPosts.getPostById(initialPost.model.id);
    }

    const navigationBar = useNavigationBar({
        withoutDisappearingTitle: true,
        title: (
            <PostContentViewHeader
                post={postResult.post}
                shouldShowChannel={true}
                withNavigationBarLayout={true}
            />
        ),
        desktopMaxWidth: contentStyles.contentMaxWidth,
        titleJustifyContent: "flex-start",
        // eslint-disable-next-line react-compiler/react-compiler
        menuActions: getPostMoreActions({
            currentAccount,
            post: postResult.post,
            onStartEditingPost: () => {
                assertExists(postListRef.current).startEditingPost(
                    postResult.post.id,
                    postResult.post.content,
                );
            },
        }),
    });

    return (
        <PostListView
            ref={postListRef}
            posts={posts}
            onTogglePostComments={useCallback(
                postId => {
                    setPosts(posts => posts.togglePostComments(postId));
                },
                [setPosts],
            )}
            onUpdatePostComments={useCallback(
                (postId, update) => {
                    setPosts(posts => posts.updatePostComments(postId, update));
                },
                [setPosts],
            )}
            shouldBeConnectedToChannelRealtime={false}
            onPostRealtimeEventTransaction={useCallback(
                ({eventTransaction}) => {
                    setPosts(posts => posts.handleEventTransaction(eventTransaction));
                },
                [setPosts],
            )}
            onOptimisticPostRealtimeEventTransaction={useCallback(
                (promise, postId, update) => {
                    setPostsOptimistically(promise, (posts, promiseValue) => {
                        // Once `promise` resolves, use the event transaction from `promise` to update
                        // the posts instead of our optimistic updater.
                        if (promiseValue) {
                            return posts.handleEventTransaction(promiseValue.eventTransaction);
                        }

                        const oldPostItem = posts.getPostRealtimeItemIfExists(postId);
                        if (!oldPostItem) return posts;
                        const newPost = update(oldPostItem.model);

                        const newPostItem = {
                            ...oldPostItem,
                            // Always pretend like our optimistic update is one version higher than what's
                            // currently in state. Once `promise` resolves then we'll update the item with
                            // the real version.
                            version: oldPostItem.version + 1,
                            model: newPost,
                        };

                        return posts.handleEventTransaction([
                            {type: "PutItem", item: newPostItem, indexes: new Map()},
                        ]);
                    });
                },
                [setPostsOptimistically],
            )}
            navigationBar={navigationBar}
            initialScrollForFirstPost={initialScroll?.type === "Comment" ? null : initialScroll}
        />
    );
}
