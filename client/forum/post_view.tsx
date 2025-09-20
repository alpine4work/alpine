import {Memo, useCallback, useEffect, useRef, useState} from "react";
import {getPostMoreActions} from "~/client/forum/get_post_more_actions.js";
import {PostContentViewHeader} from "~/client/forum/internal/post_content_view_header.js";
import {PostContentViewInitialScroll} from "~/client/forum/post_content_view.js";
import {PostBasicList} from "~/client/forum/post_list.js";
import {PostListView, PostListViewRef} from "~/client/forum/post_list_view.js";
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
            navigationBar={navigationBar}
            initialScrollForFirstPost={initialScroll?.type === "Comment" ? null : initialScroll}
        />
    );
}
