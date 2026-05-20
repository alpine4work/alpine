import {Memo, useCallback, useEffect, useMemo, useRef} from "react";
import {getPostMoreActions} from "~/client/web/forum/get_post_more_actions.js";
import {PostContentViewHeader} from "~/client/web/forum/internal/post_content_view_header.js";
import {PostContentViewInitialScroll} from "~/client/web/forum/post_content_view.js";
import {PostBasicList} from "~/client/web/forum/post_list.js";
import {PostListView, PostListViewRef} from "~/client/web/forum/post_list_view.js";
import {useStateWithOptimisticUpdates} from "~/client/web/helpers/use_state_with_optimistic_updates.js";
import {useInboxContext} from "~/client/web/inbox/inbox_context.js";
import {useNavigationBar} from "~/client/web/navigation/navigation_bar.js";
import {useSpaceContext} from "~/client/web/spaces/space_context.js";
import {contentStyles} from "~/client/web/styles/styles.js";
import {RynamoItem} from "~/shared/dynamo/rynamo_types.js";
import {PostCommentModel, PostModel} from "~/shared/forum/post_model.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {MessageContentPayloadParent} from "~/shared/messaging/message_schema.js";
import {ServerSynchronizationCheckpoint} from "~/shared/web_socket/server_synchronization_checkpoint.js";

export type PostViewInitialScroll =
    | PostContentViewInitialScroll
    | {readonly type: "Comment"; readonly commentIndex: number};

export function PostView({
    initialCheckpoint,
    initialPost,
    initialPostComments,
    initialOtherReferencedPostComments,
    initialScroll,
    initialParent,
}: {
    initialCheckpoint: ServerSynchronizationCheckpoint;
    initialPost: RynamoItem<PostModel>;
    initialPostComments: ReadonlyArray<PostCommentModel>;
    initialOtherReferencedPostComments: ReadonlyArray<PostCommentModel>;
    initialScroll: Memo<PostViewInitialScroll> | null;
    initialParent?: MessageContentPayloadParent | null;
}) {
    const {currentAccount} = useSpaceContext();

    const postId = initialPost.model.id;

    const postListRef = useRef<PostListViewRef>(null);
    const hasInitializedRef = useRef(false);

    const inboxContext = useInboxContext();

    // TODO(calebmer): Support server-side rendering for immediately jumping to a
    // comment in the middle of a post. This will make transitions seamless when you
    // click on a link to a comment.
    useEffect(() => {
        if (hasInitializedRef.current) return;
        hasInitializedRef.current = true;

        const postList = assertExists(postListRef.current);

        if (initialScroll?.type === "Comment")
            postList.jumpToPostCommentRange({
                roomKey: postId,
                startIndex: initialScroll.commentIndex,
                endIndex: initialScroll.commentIndex,
                start: null,
                end: null,
            });
    }, [initialScroll, postId]);

    const [postsFromState, setPosts, setPostsOptimistically] = useStateWithOptimisticUpdates(() =>
        PostBasicList.new({
            type: "One",
            checkpoint: initialCheckpoint,
            post: initialPost,
            postCommentsState: "AlwaysOpen",
            postComments: {
                comments: initialPostComments,
                otherReferencedComments: initialOtherReferencedPostComments,
            },
        }),
    );

    let posts = postsFromState;
    let postResult = posts.getPostByIdIfExists(postId);

    if (!postResult) {
        const newPosts = PostBasicList.new({
            type: "One",
            checkpoint: initialCheckpoint,
            post: initialPost,
            postCommentsState: "AlwaysOpen",
            postComments: {
                comments: initialPostComments,
                otherReferencedComments: initialOtherReferencedPostComments,
            },
        });

        setPosts(() => newPosts);
        posts = newPosts;

        postResult = newPosts.getPostById(postId);
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
                assertExists(postListRef.current).startEditingPost(postResult.post);
            },
        }),
        defaultPreviousRoute: inboxContext?.entry
            ? `/s/${inboxContext.entry.model.spaceId}/inbox`
            : `/s/${initialPost.model.spaceId}/posts/${initialPost.model.id}`,
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
            onUpdatePostCommentsOptimistically={useCallback(
                (postId, promise, update) =>
                    setPostsOptimistically(promise, (posts, promiseValue) =>
                        posts.updatePostComments(postId, comments =>
                            update(comments, promiseValue),
                        ),
                    ),
                [setPostsOptimistically],
            )}
            shouldBeConnectedToChannelRealtime={false}
            onPostRealtimeEventTransaction={useCallback(
                eventTransaction => {
                    setPosts(posts => posts.handleEventTransaction(eventTransaction));
                },
                [setPosts],
            )}
            onOptimisticPostRealtimeEventTransaction={useCallback(
                (promise, postId, update) => {
                    setPostsOptimistically(promise, (posts, promiseValue) => {
                        // Once `promise` resolves, use the event transaction from `promise` to update the
                        // posts instead of our optimistic updater.
                        if (promiseValue) {
                            return posts.handleEventTransaction(promiseValue);
                        }

                        const oldPostItem = posts.getPostRealtimeItemIfExists(postId);
                        if (!oldPostItem) return posts;
                        const newPost = update(oldPostItem.model);

                        const newPostItem = {
                            ...oldPostItem,
                            // Always pretend like our optimistic update is one version higher than what's
                            // currently in state. Once `promise` resolves then we'll update the item with the
                            // real version.
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
            initialParentByPostId={useMemo(() => {
                if (!initialParent) return;
                return new Map([[postId, initialParent]]);
            }, [initialParent, postId])}
        />
    );
}
