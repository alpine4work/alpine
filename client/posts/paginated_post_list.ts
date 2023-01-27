import createTree, {Tree} from "functional-red-black-tree";
import {PaginatedMessageList} from "~/client/messaging/paginated_message_list";
import {InternalError, OutOfRangeError} from "~/shared/error/error";
import {assertExists} from "~/shared/helpers/control/assert_exists";
import {ImmutableMap} from "~/shared/helpers/immutable/immutable_map";
import {ImmutableSet} from "~/shared/helpers/immutable/immutable_set";
import {reduceIterable} from "~/shared/helpers/iterable/reduce_iterable";
import {OrderKey, generateOrderKeyBetween} from "~/shared/helpers/sort/order_key";
import {PostCommentModel, PostModel} from "~/shared/models/post_model";

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
export class PaginatedPostList {
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
            readonly postComments: PaginatedMessageList<PostCommentModel>;
        }
    >;

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
    private _postOrderKeyByPostContentIndex: Tree<number, OrderKey>;

    private constructor({
        postByOrderKey,
        openPostCommentPostOrderKeys,
        postOrderKeyByPostContentIndex,
    }: {
        postByOrderKey: ImmutableMap<
            OrderKey,
            {
                readonly post: PostModel;
                readonly postComments: PaginatedMessageList<PostCommentModel>;
            }
        >;
        openPostCommentPostOrderKeys: ImmutableSet<OrderKey>;
        postOrderKeyByPostContentIndex: Tree<number, OrderKey>;
    }) {
        this._postByOrderKey = postByOrderKey;
        this._openPostCommentPostOrderKeys = openPostCommentPostOrderKeys;
        this._postOrderKeyByPostContentIndex = postOrderKeyByPostContentIndex;
    }

    /**
     * An empty post list.
     */
    public static empty = new PaginatedPostList({
        postByOrderKey: ImmutableMap.empty(),
        openPostCommentPostOrderKeys: ImmutableSet.empty(),
        postOrderKeyByPostContentIndex: createTree(),
    });

    /**
     * Get the total number of items in the list.
     */
    public getItemCount() {
        return (
            this._postByOrderKey.size +
            // For all posts with open comments, add the size of the comment sections plus
            // one for the comment input.
            reduceIterable(
                this._openPostCommentPostOrderKeys,
                (count, postOrderKey) =>
                    count +
                    assertExists(
                        this._postByOrderKey.get(postOrderKey),
                    ).postComments.getEstimatedMessageCount() +
                    1,
                0,
            )
        );
    }

    /**
     * Get the item at the provided index. Throws an error if the index is out
     * of bounds.
     */
    public getItem(index: number): PaginatedPostListItem {
        if (index < 0 || !Number.isSafeInteger(index))
            throw new OutOfRangeError("Index should be a positive integer");

        const getItemInNode = (
            postContentIndex: number,
            postOrderKey: OrderKey,
            post: PostModel,
            postComments: PaginatedMessageList<PostCommentModel>,
        ): PaginatedPostListItem | null => {
            const arePostCommentsOpen = this._openPostCommentPostOrderKeys.has(postOrderKey);

            if (index === postContentIndex) return {type: "PostContent", post, arePostCommentsOpen};

            if (arePostCommentsOpen) {
                const postCommentIndex = index - (postContentIndex + 1);
                const postCommentCount = postComments.getEstimatedMessageCount();

                if (0 <= postCommentIndex && postCommentIndex < postCommentCount) {
                    const postComment = postComments.getMessage(postCommentIndex);
                    if (postComment.isLoaded) {
                        return {type: "LoadedPostComment", post, postComment: postComment.message};
                    } else {
                        return {type: "UnloadedPostComment", post, postComments, postCommentIndex};
                    }
                }

                if (index === postContentIndex + postCommentCount + 1)
                    return {type: "PostCommentInput", post};
            }

            return null;
        };

        let startAfterOrderKey: OrderKey | null;
        let nextPostContentIndex: number;

        // Check if the cache for the first entry before the search index.
        //
        // - If there is no entry, we need to iterate through posts starting from
        //   the beginning.
        // - If there is an entry and the index falls inside that entry, hooray! We can
        //   immediately return an item.
        // - Otherwise we need to iterate through posts starting from the entry we
        //   found.
        {
            const iterator = this._postOrderKeyByPostContentIndex.le(index);
            if (!iterator.valid) {
                startAfterOrderKey = null;
                nextPostContentIndex = 0;
            } else {
                const postNode = iterator.node!;

                const postContentIndex = postNode.key;
                const postOrderKey = postNode.value;
                const {post, postComments} = assertExists(
                    this._postByOrderKey.get(postOrderKey),
                    "Expected order key at index to exist",
                );

                // Check if the item is somewhere in the post we found. If it is not then we
                // need to search for the item by iterating through our posts.
                const item = getItemInNode(postContentIndex, postOrderKey, post, postComments);
                if (item) return item;

                startAfterOrderKey = postOrderKey;
                nextPostContentIndex =
                    postContentIndex +
                    // The next post index is past any comments if the comment section is open
                    (this._openPostCommentPostOrderKeys.has(postOrderKey)
                        ? postComments.getEstimatedMessageCount() +
                          // Add one for the post comment input index
                          1
                        : 0) +
                    // Add one again to get the next post index
                    1;
            }
        }

        // Iterate through posts to find the post which contains our search index.
        // Cache the index of each post as we find it so that future calls to this
        // function don't need to iterate through posts.
        for (const [postOrderKey, {post, postComments}] of startAfterOrderKey !== null
            ? this._postByOrderKey.entriesAfter(startAfterOrderKey)
            : this._postByOrderKey.entries()) {
            const postContentIndex = nextPostContentIndex;

            // Update the cache with the index for this post so we don't need to iterate
            // through posts next time.
            {
                const iterator = this._postOrderKeyByPostContentIndex.find(postContentIndex);
                this._postOrderKeyByPostContentIndex = iterator.valid
                    ? iterator.update(postOrderKey)
                    : this._postOrderKeyByPostContentIndex.insert(postContentIndex, postOrderKey);
            }

            nextPostContentIndex =
                postContentIndex +
                // The next post index is past any comments if the comment section is open
                (this._openPostCommentPostOrderKeys.has(postOrderKey)
                    ? postComments.getEstimatedMessageCount() +
                      // Add one for the post comment input index
                      1
                    : 0) +
                // Add one again to get the next post index
                1;

            // If our index is in this range, yay! Return the specific item.
            if (postContentIndex <= index && index < nextPostContentIndex) {
                return assertExists(
                    getItemInNode(postContentIndex, postOrderKey, post, postComments),
                    "Could not find index in post, stopping iteration",
                );
            }
        }

        throw new OutOfRangeError("Out of bounds index");
    }

    /**
     * Insert a post into the start of the list.
     */
    public insertAtStart(
        post: PostModel,
        {arePostCommentsOpen = false}: {arePostCommentsOpen?: boolean} = {},
    ): PaginatedPostList {
        const postOrderKey = generateOrderKeyBetween(
            null,
            this._postByOrderKey.getFirstEntry()?.[0] ?? null,
        );

        const postByOrderKey = this._postByOrderKey.set(postOrderKey, {
            post,
            postComments: PaginatedMessageList.new(post.commentCount),
        });

        const openPostCommentPostOrderKeys = arePostCommentsOpen
            ? this._openPostCommentPostOrderKeys.add(postOrderKey)
            : this._openPostCommentPostOrderKeys;

        return new PaginatedPostList({
            postByOrderKey,
            openPostCommentPostOrderKeys,
            // We have to throw away the entire cache for post content indexes because
            // inserting at the beginning means all indexes after are different.
            postOrderKeyByPostContentIndex: createTree(),
        });
    }

    /**
     * Insert a post into the end of the list.
     */
    public insertAtEnd(
        post: PostModel,
        {arePostCommentsOpen = false}: {arePostCommentsOpen?: boolean} = {},
    ): PaginatedPostList {
        const postOrderKey = generateOrderKeyBetween(
            this._postByOrderKey.getLastEntry()?.[0] ?? null,
            null,
        );

        const postByOrderKey = this._postByOrderKey.set(postOrderKey, {
            post,
            postComments: PaginatedMessageList.new(post.commentCount),
        });

        const openPostCommentPostOrderKeys = arePostCommentsOpen
            ? this._openPostCommentPostOrderKeys.add(postOrderKey)
            : this._openPostCommentPostOrderKeys;

        return new PaginatedPostList({
            postByOrderKey,
            openPostCommentPostOrderKeys,
            // We can keep the existing cache for post content indexes because inserting at
            // the end does not change the indexes of items that come before.
            postOrderKeyByPostContentIndex: this._postOrderKeyByPostContentIndex,
        });
    }

    /**
     * Toggle the post's comment section as open or closed. The index must be the
     * index for the post's content. Otherwise we will throw.
     */
    public togglePostComments(index: number): PaginatedPostList {
        const item = this.getItem(index);

        if (item.type !== "PostContent")
            throw new InternalError("Expected the index for post content");

        const iterator = this._postOrderKeyByPostContentIndex.find(index);
        if (!iterator.valid)
            throw new InternalError(
                "Expected finding the post content item to populate the post content index cache",
            );
        const postOrderKey = iterator.value!;

        const openPostCommentPostOrderKeys = this._openPostCommentPostOrderKeys.has(postOrderKey)
            ? this._openPostCommentPostOrderKeys.delete(postOrderKey)
            : this._openPostCommentPostOrderKeys.add(postOrderKey);

        // Keep the `left` side of the `postOrderKeyByPostContentIndex` cache and throw
        // away the `right` side which is now invalid.
        const postOrderKeyByPostContentIndex = (() => {
            // HACK(calebmer): Hackishly get the constructor for a
            // `functional-red-black-tree` tree and construct it with the left-hand-side
            // subtree since there's not an official API.
            const leftTree = new (this._postOrderKeyByPostContentIndex as any).constructor(
                (this._postOrderKeyByPostContentIndex as any)._compare,
                iterator.node!.left,
            );
            return leftTree.insert(index, postOrderKey);
        })();

        return new PaginatedPostList({
            postByOrderKey: this._postByOrderKey,
            openPostCommentPostOrderKeys,
            postOrderKeyByPostContentIndex,
        });
    }
}

/**
 * An individual item in a paginated post list.
 */
export type PaginatedPostListItem =
    | PaginatedPostListPostContentItem
    | PaginatedPostListLoadedPostCommentItem
    | PaginatedPostListUnloadedPostCommentItem
    | PaginatedPostListPostCommentInputItem;

/**
 * The first item in a post that renders content.
 */
export type PaginatedPostListPostContentItem = {
    readonly type: "PostContent";
    readonly post: PostModel;
    readonly arePostCommentsOpen: boolean;
};

/**
 * An item in a post that renders a loaded comment.
 */
export type PaginatedPostListLoadedPostCommentItem = {
    readonly type: "LoadedPostComment";
    readonly post: PostModel;
    readonly postComment: PostCommentModel;
};

/**
 * An item in a post that renders an unloaded comment shimmer.
 */
export type PaginatedPostListUnloadedPostCommentItem = {
    readonly type: "UnloadedPostComment";
    readonly post: PostModel;
    readonly postComments: PaginatedMessageList<PostCommentModel>;
    /**
     * The index the unloaded post comment is at in the `PaginatedMessageList`. The
     * post index may move but this will stay stable.
     */
    readonly postCommentIndex: number;
};

/**
 * The last item in a post that renders a comment input.
 */
export type PaginatedPostListPostCommentInputItem = {
    readonly type: "PostCommentInput";
    readonly post: PostModel;
};
