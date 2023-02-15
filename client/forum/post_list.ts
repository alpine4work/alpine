import createTree, {Tree} from "functional-red-black-tree";
import {MessageList} from "~/client/messaging/message_list";
import {InternalError, OutOfRangeError} from "~/shared/error/error";
import {assert} from "~/shared/helpers/control/assert";
import {assertExists} from "~/shared/helpers/control/assert_exists";
import {exhaustive} from "~/shared/helpers/control/exhaustive";
import {ImmutableMap} from "~/shared/helpers/immutable/immutable_map";
import {ImmutableSet} from "~/shared/helpers/immutable/immutable_set";
import {reduceIterable} from "~/shared/helpers/iterable/reduce_iterable";
import {
    OrderKey,
    generateOrderKeyBetween,
    generateOrderKeysBetween,
} from "~/shared/helpers/sort/order_key";
import {PostId} from "~/shared/id/types/id_types";
import {ChannelModel} from "~/shared/models/channel_model";
import {OptimisticMessageInterface} from "~/shared/models/message_interface";
import {PostCommentModel, PostModel} from "~/shared/models/post_model";

export type PostListChannelHeader = {
    readonly channel: ChannelModel;
};

/**
 * An immutable representation of a list of posts to be rendered by our
 * `<PostsView>` component. Our `<PostsView>` component virtualizes our list of
 * posts since we may have too many to render on screen at once. Posts may also
 * expand their comments inline so if comments are expanded then we also need
 * to virtualize those!
 *
 * Keeping track of which posts are open/closed and how that affects comment
 * indexing is a little complex. This class manages that complexity.
 */
export class PostList {
    private readonly _channelHeader: PostListChannelHeader | null;
    private readonly _hasMorePosts: boolean;

    /**
     * Our list of posts. But this is a map not a list you may say. Yes! It is a
     * map keyed by an `OrderKey`. This allows us to efficiently insert items at
     * any position in the map (beginning or end) without needing to increase
     * indexes of following items.
     *
     * Also, indexing into this list sometimes gives you a comment. Since we want
     * to virtualize comments along with posts. So the post index is not equal to
     * the list item index.
     *
     * In order to get an item by index we iterate through this map, jumping the
     * index forward when a post has open comments. Each post also has an extra
     * item rendered after comments for a comment input.
     */
    private readonly _postByOrderKey: ImmutableMap<
        OrderKey,
        {
            readonly post: PostModel;
            readonly postComments: MessageList<PostCommentModel>;
        }
    >;

    /**
     * A map of the order keys for posts.
     */
    private readonly _orderKeyByPostId: ImmutableMap<PostId, OrderKey>;

    /**
     * Posts with an open comment section. Keyed by `OrderKey` so that we can find
     * the post in `_postByOrderKey`.
     */
    private readonly _openPostCommentPostOrderKeys: ImmutableSet<OrderKey>;

    /**
     * Cache of index to post. So when we are trying to get an item in this list by
     * index we can find the post it lives in then index in further if the index is
     * a post comment index.
     *
     * This is a sparse cache. It starts as empty regardless of how many posts we
     * have. When we try to get a post by index we will initialize and populate
     * this cache so that in the future we can quickly respond to the same request
     * and quickly respond to requests for indexes nearby the previous one we
     * looked up.
     *
     * Mutable since we update this cache during reads. But it's a persistent
     * red-black tree so that we can partially reuse the tree on updates. For
     * example, when a comment section opens all indexes after are invalidated but
     * all indexes before we can keep.
     */
    private _postOrderKeyByPostContentItemIndex: Tree<number, OrderKey>;

    /**
     * The number of items in the list pre-computed ahead of time.
     */
    private readonly _itemCount: number;

    private constructor({
        channelHeader,
        hasMorePosts,
        postByOrderKey,
        orderKeyByPostId,
        openPostCommentPostOrderKeys,
        postOrderKeyByPostContentItemIndex,
    }: {
        channelHeader: PostListChannelHeader | null;
        hasMorePosts: boolean;
        postByOrderKey: ImmutableMap<
            OrderKey,
            {
                readonly post: PostModel;
                readonly postComments: MessageList<PostCommentModel>;
            }
        >;
        orderKeyByPostId: ImmutableMap<PostId, OrderKey>;
        openPostCommentPostOrderKeys: ImmutableSet<OrderKey>;
        postOrderKeyByPostContentItemIndex: Tree<number, OrderKey>;
    }) {
        this._channelHeader = channelHeader;
        this._hasMorePosts = hasMorePosts;
        this._postByOrderKey = postByOrderKey;
        this._orderKeyByPostId = orderKeyByPostId;
        this._openPostCommentPostOrderKeys = openPostCommentPostOrderKeys;
        this._postOrderKeyByPostContentItemIndex = postOrderKeyByPostContentItemIndex;

        this._itemCount =
            (this._channelHeader ? 1 : 0) +
            (this._hasMorePosts ? 1 : 0) +
            this._postByOrderKey.size +
            // For all posts with open comments, add the size of the comment sections plus
            // one for the comment input.
            reduceIterable(
                this._openPostCommentPostOrderKeys,
                (count, postOrderKey) =>
                    count +
                    assertExists(
                        this._postByOrderKey.get(postOrderKey),
                    ).postComments.getMessageCount() +
                    1,
                0,
            );
    }

    /**
     * An empty post list.
     */
    public static empty = new PostList({
        channelHeader: null,
        hasMorePosts: false,
        postByOrderKey: ImmutableMap.empty(),
        orderKeyByPostId: ImmutableMap.empty(),
        openPostCommentPostOrderKeys: ImmutableSet.empty(),
        postOrderKeyByPostContentItemIndex: createTree(),
    });

    /**
     * Get the total number of items in the list.
     */
    public getItemCount() {
        return this._itemCount;
    }

    /**
     * Get the post this index is referring to. Throws an error if the index is out
     * of range. Every item in this list is associated with a post.
     */
    private _getPost(index: number): {
        postContentItemIndex: number;
        postOrderKey: OrderKey;
        post: PostModel;
        postComments: MessageList<PostCommentModel>;
    } | null {
        if (index < 0 || !Number.isSafeInteger(index))
            throw new OutOfRangeError("Index should be a positive integer");

        // We are in the channel header, not a post.
        if (this._channelHeader && index === 0) return null;

        // We are in the has more posts loading item, not a post.
        if (this._hasMorePosts && index === this.getItemCount() - 1) return null;

        let startAfterOrderKey: OrderKey | null;
        let nextPostContentItemIndex: number;

        // Check if the cache for the first entry before the search index.
        //
        // - If there is no entry, we need to iterate through posts starting from
        //   the beginning.
        // - If there is an entry and the index falls inside that entry, hooray! We can
        //   immediately return an item.
        // - Otherwise we need to iterate through posts starting from the entry we
        //   found.
        {
            const iterator = this._postOrderKeyByPostContentItemIndex.le(index);
            if (!iterator.valid) {
                startAfterOrderKey = null;
                nextPostContentItemIndex = this._channelHeader ? 1 : 0;
            } else {
                const postNode = iterator.node!;

                const postContentItemIndex = postNode.key;
                const postOrderKey = postNode.value;
                const {post, postComments} = assertExists(
                    this._postByOrderKey.get(postOrderKey),
                    "Expected order key at index to exist",
                );

                startAfterOrderKey = postOrderKey;
                nextPostContentItemIndex =
                    postContentItemIndex +
                    // The next post index is past any comments if the comment section is open
                    (this._openPostCommentPostOrderKeys.has(postOrderKey)
                        ? postComments.getMessageCount() +
                          // Add one for the post comment input index
                          1
                        : 0) +
                    // Add one again to get the next post index
                    1;

                // If this index is before the next content item index then the index is inside
                // the post content item we found!
                if (index < nextPostContentItemIndex) {
                    return {
                        postContentItemIndex,
                        postOrderKey,
                        post,
                        postComments,
                    };
                }
            }
        }

        // If we are looking for an index before the start of posts, there is no post
        // for this index but we are still in range.
        if (index < nextPostContentItemIndex) {
            return null;
        }

        // Iterate through posts to find the post which contains our search index.
        // Cache the index of each post as we find it so that future calls to this
        // function don't need to iterate through posts.
        for (const [postOrderKey, {post, postComments}] of startAfterOrderKey !== null
            ? this._postByOrderKey.entriesAfter(startAfterOrderKey)
            : this._postByOrderKey.entries()) {
            const postContentItemIndex = nextPostContentItemIndex;

            // Update the cache with the index for this post so we don't need to iterate
            // through posts next time.
            {
                const iterator =
                    this._postOrderKeyByPostContentItemIndex.find(postContentItemIndex);
                this._postOrderKeyByPostContentItemIndex = iterator.valid
                    ? iterator.update(postOrderKey)
                    : this._postOrderKeyByPostContentItemIndex.insert(
                          postContentItemIndex,
                          postOrderKey,
                      );
            }

            nextPostContentItemIndex =
                postContentItemIndex +
                // The next post index is past any comments if the comment section is open
                (this._openPostCommentPostOrderKeys.has(postOrderKey)
                    ? postComments.getMessageCount() +
                      // Add one for the post comment input index
                      1
                    : 0) +
                // Add one again to get the next post index
                1;

            // If our index is in this range, yay! Return the specific item.
            if (postContentItemIndex <= index && index < nextPostContentItemIndex) {
                return {
                    postContentItemIndex,
                    postOrderKey,
                    post,
                    postComments,
                };
            }
        }

        throw new OutOfRangeError("Out of bounds index");
    }

    /**
     * Get the post content item for the provided index. If this index is pointing
     * at a comment then we will return the item for the post the comment is a part
     * of. Will throw an error if the index is out of bounds. Every index in this
     * list is associated to a post.
     */
    public getPostContentItem(index: number): PostListPostContentItem | null {
        const postResult = this._getPost(index);
        if (!postResult) return null;

        const {postContentItemIndex, postOrderKey, post, postComments} = postResult;
        const arePostCommentsOpen = this._openPostCommentPostOrderKeys.has(postOrderKey);

        return {
            type: "PostContent",
            post,
            postComments,
            arePostCommentsOpen,
            postContentItemIndex,
            postCommentInputItemIndex: arePostCommentsOpen
                ? postContentItemIndex + postComments.getMessageCount() + 1
                : null,
        };
    }

    /**
     * Get the last post content item in the list. Null if there are no posts in
     * the list.
     */
    public getLastPostContentItem(): PostListPostContentItem | null {
        const index = this.getItemCount() - 1 - (this._hasMorePosts ? 1 : 0);
        if (index < 0) return null;
        return this.getPostContentItem(index);
    }

    /**
     * Get the item at the provided index. Throws an error if the index is out
     * of bounds.
     */
    public getItem(index: number): PostListItem {
        if (this._channelHeader && index === 0) {
            return {
                type: "ChannelHeader",
                channelHeader: this._channelHeader,
            };
        }

        if (this._hasMorePosts && index === this.getItemCount() - 1) {
            return {
                type: "MoreUnloadedPosts",
            };
        }

        const {postContentItemIndex, postOrderKey, post, postComments} = assertExists(
            this._getPost(index),
            "Expected unsupported non-post indexes to be handled",
        );
        const arePostCommentsOpen = this._openPostCommentPostOrderKeys.has(postOrderKey);

        if (index === postContentItemIndex) {
            return {
                type: "PostContent",
                post,
                postComments,
                arePostCommentsOpen,
                postContentItemIndex,
                postCommentInputItemIndex: arePostCommentsOpen
                    ? postContentItemIndex + postComments.getMessageCount() + 1
                    : null,
            };
        }

        if (arePostCommentsOpen) {
            const postCommentIndex = index - (postContentItemIndex + 1);
            const postCommentCount = postComments.getMessageCount();
            const postCommentInputItemIndex =
                postContentItemIndex + postComments.getMessageCount() + 1;

            if (0 <= postCommentIndex && postCommentIndex < postCommentCount) {
                const postComment = postComments.getMessage(postCommentIndex);
                switch (postComment.type) {
                    case "Loaded": {
                        return {
                            type: "LoadedPostComment",
                            post,
                            postComments,
                            postCommentIndex,
                            postComment: postComment.message,
                            postCommentInputItemIndex,
                        };
                    }
                    case "Unloaded": {
                        return {
                            type: "UnloadedPostComment",
                            post,
                            postComments,
                            postCommentIndex,
                            postCommentInputItemIndex,
                        };
                    }
                    case "Optimistic": {
                        return {
                            type: "OptimisticPostComment",
                            post,
                            postComments,
                            postCommentIndex,
                            postComment: postComment.message,
                            postCommentInputItemIndex,
                            optimisticPostCommentIndex: postComment.optimisticMessageIndex,
                        };
                    }
                    default:
                        throw exhaustive(postComment);
                }
            }

            if (index === postContentItemIndex + postCommentCount + 1) {
                return {
                    type: "PostCommentInput",
                    post,
                    postComments,
                    postContentItemIndex,
                };
            }
        }

        throw new InternalError("Index is not actually in post");
    }

    /**
     * Set the channel header item at the beginning of the post list.
     */
    public setChannelHeader(channelHeader: PostListChannelHeader | null): PostList {
        return new PostList({
            channelHeader,
            hasMorePosts: this._hasMorePosts,
            postByOrderKey: this._postByOrderKey,
            orderKeyByPostId: this._orderKeyByPostId,
            openPostCommentPostOrderKeys: this._openPostCommentPostOrderKeys,
            // We have to throw away the entire cache for post content indexes because
            // the channel header offsets everything by one.
            postOrderKeyByPostContentItemIndex: createTree(),
        });
    }

    /**
     * Set that the post list should have a loading spinner once you reach the end.
     */
    public setHasMorePosts(hasMorePosts: boolean): PostList {
        return new PostList({
            channelHeader: this._channelHeader,
            hasMorePosts,
            postByOrderKey: this._postByOrderKey,
            orderKeyByPostId: this._orderKeyByPostId,
            openPostCommentPostOrderKeys: this._openPostCommentPostOrderKeys,
            // We get to keep the index cache because the more posts item is at the end.
            postOrderKeyByPostContentItemIndex: this._postOrderKeyByPostContentItemIndex,
        });
    }

    /**
     * Insert a post into the start of the list.
     */
    public insertPostAtStart(
        post: PostModel,
        {
            arePostCommentsOpen = false,
            initialLoadPostComments,
        }: {
            arePostCommentsOpen?: boolean;
            initialLoadPostComments?: {
                comments: ReadonlyArray<PostCommentModel>;
                otherReferencedComments: ReadonlyArray<PostCommentModel>;
            };
        } = {},
    ): PostList {
        const postOrderKey = generateOrderKeyBetween(
            null,
            this._postByOrderKey.getFirstEntry()?.[0] ?? null,
        );

        let postComments = MessageList.new<PostCommentModel>(post.commentCount);
        if (initialLoadPostComments) {
            postComments = postComments.loadMessages({
                messageCount: post.commentCount,
                messages: initialLoadPostComments.comments,
                otherReferencedMessages: initialLoadPostComments.otherReferencedComments,
            });
        }

        const postByOrderKey = this._postByOrderKey.set(postOrderKey, {
            post,
            postComments,
        });

        const orderKeyByPostId = this._orderKeyByPostId.update(post.id, lastOrderKey => {
            assert(!lastOrderKey, "Post already exists in the list");
            return postOrderKey;
        });

        const openPostCommentPostOrderKeys = arePostCommentsOpen
            ? this._openPostCommentPostOrderKeys.add(postOrderKey)
            : this._openPostCommentPostOrderKeys;

        return new PostList({
            channelHeader: this._channelHeader,
            hasMorePosts: this._hasMorePosts,
            postByOrderKey,
            orderKeyByPostId,
            openPostCommentPostOrderKeys,
            // We have to throw away the entire cache for post content indexes because
            // inserting at the beginning means all indexes after are different.
            postOrderKeyByPostContentItemIndex: createTree(),
        });
    }

    /**
     * Insert a post into the end of the list.
     */
    public insertPostAtEnd(
        post: PostModel,
        {
            arePostCommentsOpen = false,
            initialLoadPostComments,
        }: {
            arePostCommentsOpen?: boolean;
            initialLoadPostComments?: {
                comments: ReadonlyArray<PostCommentModel>;
                otherReferencedComments: ReadonlyArray<PostCommentModel>;
            };
        } = {},
    ): PostList {
        const postOrderKey = generateOrderKeyBetween(
            this._postByOrderKey.getLastEntry()?.[0] ?? null,
            null,
        );

        let postComments = MessageList.new<PostCommentModel>(post.commentCount);
        if (initialLoadPostComments) {
            postComments = postComments.loadMessages({
                messageCount: post.commentCount,
                messages: initialLoadPostComments.comments,
                otherReferencedMessages: initialLoadPostComments.otherReferencedComments,
            });
        }

        const postByOrderKey = this._postByOrderKey.set(postOrderKey, {
            post,
            postComments,
        });

        const orderKeyByPostId = this._orderKeyByPostId.update(post.id, lastOrderKey => {
            assert(!lastOrderKey, "Post already exists in the list");
            return postOrderKey;
        });

        const openPostCommentPostOrderKeys = arePostCommentsOpen
            ? this._openPostCommentPostOrderKeys.add(postOrderKey)
            : this._openPostCommentPostOrderKeys;

        return new PostList({
            channelHeader: this._channelHeader,
            hasMorePosts: this._hasMorePosts,
            postByOrderKey,
            orderKeyByPostId,
            openPostCommentPostOrderKeys,
            // We can keep the existing cache for post content indexes because inserting at
            // the end does not change the indexes of items that come before.
            postOrderKeyByPostContentItemIndex: this._postOrderKeyByPostContentItemIndex,
        });
    }

    /**
     * Insert many posts into the start of the list. All of them will have their
     * comments closed.
     */
    public insertManyPostsAtStart(posts: ReadonlyArray<PostModel>) {
        const postOrderKeys = generateOrderKeysBetween(
            null,
            this._postByOrderKey.getFirstEntry()?.[0] ?? null,
            posts.length,
        );

        let postByOrderKey = this._postByOrderKey;
        let orderKeyByPostId = this._orderKeyByPostId;

        for (let i = 0; i < posts.length; i++) {
            const post = posts[i]!;
            const postOrderKey = postOrderKeys[i]!;

            postByOrderKey = postByOrderKey.set(postOrderKey, {
                post,
                postComments: MessageList.new(post.commentCount),
            });

            orderKeyByPostId = orderKeyByPostId.update(post.id, lastOrderKey => {
                assert(!lastOrderKey, "Post already exists in the list");
                return postOrderKey;
            });
        }

        return new PostList({
            channelHeader: this._channelHeader,
            hasMorePosts: this._hasMorePosts,
            postByOrderKey,
            orderKeyByPostId,
            openPostCommentPostOrderKeys: this._openPostCommentPostOrderKeys,
            // We have to throw away the entire cache for post content indexes because
            // inserting at the beginning means all indexes after are different.
            postOrderKeyByPostContentItemIndex: createTree(),
        });
    }

    /**
     * Insert many posts into the end of the list. All of them will have their
     * comments closed.
     */
    public insertManyPostsAtEnd(posts: ReadonlyArray<PostModel>) {
        const postOrderKeys = generateOrderKeysBetween(
            this._postByOrderKey.getLastEntry()?.[0] ?? null,
            null,
            posts.length,
        );

        let postByOrderKey = this._postByOrderKey;
        let orderKeyByPostId = this._orderKeyByPostId;

        for (let i = 0; i < posts.length; i++) {
            const post = posts[i]!;
            const postOrderKey = postOrderKeys[i]!;

            postByOrderKey = postByOrderKey.set(postOrderKey, {
                post,
                postComments: MessageList.new(post.commentCount),
            });

            orderKeyByPostId = orderKeyByPostId.update(post.id, lastOrderKey => {
                assert(!lastOrderKey, "Post already exists in the list");
                return postOrderKey;
            });
        }

        return new PostList({
            channelHeader: this._channelHeader,
            hasMorePosts: this._hasMorePosts,
            postByOrderKey,
            orderKeyByPostId,
            openPostCommentPostOrderKeys: this._openPostCommentPostOrderKeys,
            // We can keep the existing cache for post content indexes because inserting at
            // the end does not change the indexes of items that come before.
            postOrderKeyByPostContentItemIndex: this._postOrderKeyByPostContentItemIndex,
        });
    }

    /**
     * Toggle the post's comment section as open or closed. The index must point to
     * the post's content. Otherwise we will throw.
     */
    // NOTE(calebmer): The current implementation needs this to be `index` instead
    // of `postId` (which it would be ideally). So we can find `index` in our tree
    // cache and clear everything after it. We should consider using an approach
    // like `VirtualizedScrollViewState` where we cache item counts on subtrees.
    // Then we could use `postId` here.
    public togglePostComments(index: number): PostList {
        const item = this.getItem(index);

        if (item.type !== "PostContent")
            throw new InternalError("Expected the index for post content");

        const iterator = this._postOrderKeyByPostContentItemIndex.find(index);
        if (!iterator.valid)
            throw new InternalError(
                "Expected finding the post content item to populate the post content index cache",
            );
        const postOrderKey = iterator.value!;

        const openPostCommentPostOrderKeys = this._openPostCommentPostOrderKeys.has(postOrderKey)
            ? this._openPostCommentPostOrderKeys.delete(postOrderKey)
            : this._openPostCommentPostOrderKeys.add(postOrderKey);

        // Keep the `left` side of the `postOrderKeyByPostContentItemIndex` cache and throw
        // away the `right` side which is now invalid.
        const postOrderKeyByPostContentItemIndex = (() => {
            // HACK(calebmer): Hackishly get the constructor for a
            // `functional-red-black-tree` tree and construct it with the left-hand-side
            // subtree since there's not an official API.
            const leftTree = new (this._postOrderKeyByPostContentItemIndex as any).constructor(
                (this._postOrderKeyByPostContentItemIndex as any)._compare,
                iterator.node!.left,
            );
            return leftTree.insert(index, postOrderKey);
        })();

        return new PostList({
            channelHeader: this._channelHeader,
            hasMorePosts: this._hasMorePosts,
            postByOrderKey: this._postByOrderKey,
            orderKeyByPostId: this._orderKeyByPostId,
            openPostCommentPostOrderKeys,
            postOrderKeyByPostContentItemIndex,
        });
    }

    /**
     * Update the post in our list. If the post is not in the list this is
     * a noop.
     */
    public updatePost(postId: PostId, update: (post: PostModel) => PostModel): PostList {
        const postOrderKey = this._orderKeyByPostId.get(postId);
        if (!postOrderKey) return this;

        const postByOrderKey = this._postByOrderKey.update(postOrderKey, post => {
            if (!post) throw new InternalError("Post not found for order key");

            const newPost = update(post.post);

            return {
                post: newPost,
                postComments: post.postComments,
            };
        });

        return new PostList({
            channelHeader: this._channelHeader,
            hasMorePosts: this._hasMorePosts,
            postByOrderKey,
            orderKeyByPostId: this._orderKeyByPostId,
            openPostCommentPostOrderKeys: this._openPostCommentPostOrderKeys,
            // We can keep the index cache because we are replacing an existing post which
            // should not add any new items.
            postOrderKeyByPostContentItemIndex: this._postOrderKeyByPostContentItemIndex,
        });
    }

    /**
     * Update the comments list for a post. If the post id is not in the list this
     * is a noop.
     */
    public updatePostComments(
        postId: PostId,
        update: (postComments: MessageList<PostCommentModel>) => MessageList<PostCommentModel>,
    ): PostList {
        const postOrderKey = this._orderKeyByPostId.get(postId);
        if (!postOrderKey) return this;

        const postByOrderKey = this._postByOrderKey.update(postOrderKey, post => {
            if (!post) throw new InternalError("Post not found for order key");

            const newPostComments = update(post.postComments);

            return {
                post: post.post,
                postComments: newPostComments,
            };
        });

        return new PostList({
            channelHeader: this._channelHeader,
            hasMorePosts: this._hasMorePosts,
            postByOrderKey,
            orderKeyByPostId: this._orderKeyByPostId,
            openPostCommentPostOrderKeys: this._openPostCommentPostOrderKeys,
            // We don't know what index our post was at so we have to clear the entire
            // index tree. Maybe we should build our index cache like
            // `VirtualizedScrollViewState` where we sum up the item count of subtrees?
            postOrderKeyByPostContentItemIndex: createTree(),
        });
    }
}

/**
 * An individual item in a paginated post list.
 */
export type PostListItem =
    | PostListChannelHeaderItem
    | PostListPostContentItem
    | PostListLoadedPostCommentItem
    | PostListUnloadedPostCommentItem
    | PostListOptimisticPostCommentItem
    | PostListPostCommentInputItem
    | PostListMoreUnloadedPostsItem;

export type PostListChannelHeaderItem = {
    readonly type: "ChannelHeader";
    readonly channelHeader: PostListChannelHeader;
};

/**
 * The first item in a post that renders content.
 */
export type PostListPostContentItem = {
    readonly type: "PostContent";
    readonly post: PostModel;
    readonly postComments: MessageList<PostCommentModel>;
    readonly arePostCommentsOpen: boolean;
    /**
     * The index of the `PostContent` item for this comment input in the full
     * `PostList`.
     */
    readonly postContentItemIndex: number;
    /**
     * If the comment section is open, this will be the index of the post comment
     * input in the full `PostList`.
     */
    readonly postCommentInputItemIndex: number | null;
};

/**
 * An item in a post that renders a loaded comment.
 */
export type PostListLoadedPostCommentItem = {
    readonly type: "LoadedPostComment";
    readonly post: PostModel;
    readonly postComments: MessageList<PostCommentModel>;
    /**
     * The index the loaded post comment is at in the `MessageList`. The
     * post index may move but this will stay stable.
     */
    readonly postCommentIndex: number;
    readonly postComment: PostCommentModel;
    /**
     * If the comment section is open, this will be the index of the post comment
     * input in the full `PostList`.
     */
    readonly postCommentInputItemIndex: number;
};

/**
 * An item in a post that renders an unloaded comment shimmer.
 */
export type PostListUnloadedPostCommentItem = {
    readonly type: "UnloadedPostComment";
    readonly post: PostModel;
    readonly postComments: MessageList<PostCommentModel>;
    /**
     * The index the unloaded post comment is at in the `MessageList`. The
     * post index may move but this will stay stable.
     */
    readonly postCommentIndex: number;
    /**
     * If the comment section is open, this will be the index of the post comment
     * input in the full `PostList`.
     */
    readonly postCommentInputItemIndex: number;
};

/**
 * A comment created on the client before it has been acknowledged by
 * the server.
 */
export type PostListOptimisticPostCommentItem = {
    readonly type: "OptimisticPostComment";
    readonly post: PostModel;
    readonly postComments: MessageList<PostCommentModel>;
    /**
     * The index the loaded post comment is at in the `MessageList`. The
     * post index may move but this will stay stable.
     */
    readonly postCommentIndex: number;
    readonly postComment: OptimisticMessageInterface;
    /**
     * If the comment section is open, this will be the index of the post comment
     * input in the full `PostList`.
     */
    readonly postCommentInputItemIndex: number;
    /**
     * What is the index of this optimistic post comment in the optimistic post
     * comment list?
     */
    readonly optimisticPostCommentIndex: number;
};

/**
 * The last item in a post that renders a comment input.
 */
export type PostListPostCommentInputItem = {
    readonly type: "PostCommentInput";
    readonly post: PostModel;
    readonly postComments: MessageList<PostCommentModel>;
    /**
     * The index of the `PostContent` item for this comment input in the full
     * `PostList`.
     */
    readonly postContentItemIndex: number;
};

/**
 * The last item in a post list when there are more posts to be loaded.
 */
export type PostListMoreUnloadedPostsItem = {
    readonly type: "MoreUnloadedPosts";
};
