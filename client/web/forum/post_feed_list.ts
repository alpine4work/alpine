import createTree, {Tree, Node as TreeNode} from "functional-red-black-tree";
import {
    PostCommentsState,
    PostListHeaderItem,
    PostListInterface,
    PostListItem,
    PostListItemExtra,
    PostListMoreUnloadedPostsItem,
    PostListPostContentItem,
    getPostListItemExtra,
    getPostListVirtualizedTreeNodeItem,
} from "~/client/web/forum/post_list.js";
import {MessageList} from "~/client/web/messaging/message_list.js";
import {VirtualizedTreeBase} from "~/client/web/virtualized/helpers/virtualized_tree.js";
import {RynamoEvent, RynamoItem} from "~/shared/dynamo/rynamo_types.js";
import {
    FailedPreconditionError,
    InvalidArgumentError,
    NotFoundError,
    OutOfRangeError,
} from "~/shared/error/error.js";
import {FeedEntryCursor} from "~/shared/feed/feed_entry_cursor.js";
import {FeedEntryModel, FeedPostEntryModel} from "~/shared/feed/feed_entry_model.js";
import {PostCommentModel, PostModel} from "~/shared/forum/post_model.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {cast} from "~/shared/helpers/control/cast.js";
import {ImmutableMap} from "~/shared/helpers/immutable/immutable_map.js";
import {PostId} from "~/shared/id/types/id_types.js";

export class PostFeedList implements PostListInterface {
    public readonly endCursor: FeedEntryCursor | null;
    public readonly hasMoreEntries: boolean;
    private readonly _entries: PostFeedListVirtualizedTree;

    private constructor({
        endCursor,
        hasMoreEntries,
        entries,
    }: {
        endCursor: FeedEntryCursor | null;
        hasMoreEntries: boolean;
        entries: PostFeedListVirtualizedTree;
    }) {
        this.endCursor = endCursor;
        this.hasMoreEntries = hasMoreEntries;
        this._entries = entries;
    }

    public static new({
        endCursor,
        hasMoreEntries,
        entries,
    }: {
        endCursor: FeedEntryCursor | null;
        hasMoreEntries: boolean;
        entries: ReadonlyArray<FeedEntryModel>;
    }) {
        return new PostFeedList({
            endCursor,
            hasMoreEntries,
            entries: PostFeedListVirtualizedTree.new(entries),
        });
    }

    // Even if in reality there's only one post in the feed, we don't want to use
    // single post rendering for feed.
    public isSinglePost(): boolean {
        return false;
    }

    public getItemCount(): number {
        return this._entries.getItemCount() + (this.hasMoreEntries ? 1 : 0);
    }

    public getItem(index: number): PostListItem {
        if (this.hasMoreEntries && index === this.getItemCount() - 1) {
            return {
                type: "MoreUnloadedPosts",
            };
        }

        return this._entries.getItem(index);
    }

    public getPostContentItemIfExists(index: number): PostListPostContentItem | null {
        const nodeResult = this._entries.getNodeByItemIndexIfExists(index);
        if (!nodeResult) return null;
        const {node, startItemIndex} = nodeResult;
        if (node.type !== "Post") return null;

        const {postCommentsState, postComments} = getPostListItemExtra(node.post);

        return {
            type: "PostContent",
            post: node.post.model,
            postComments,
            postCommentsState,
            postContentItemIndex: startItemIndex,
            postCommentInputItemIndex:
                postCommentsState !== "Closed"
                    ? startItemIndex + postComments.getItemCount() + 1
                    : null,
        };
    }

    public getPostByIdIfExists(postId: PostId): {
        post: PostModel;
        postCommentsState: PostCommentsState;
        postComments: MessageList<PostCommentModel>;
        postContentItemIndex: number;
        getPostCommentIndex: (postCommentIndex: number) => number;
    } | null {
        const nodeResult = this._entries.getPostByKeyIfExists(postId);
        if (!nodeResult) return null;
        const {node, startItemIndex} = nodeResult;

        const postContentItemIndex = startItemIndex;

        const getPostCommentIndex = (postCommentIndex: number) => {
            const postIndex = postContentItemIndex;

            if (node.postCommentsState === "Closed")
                throw new FailedPreconditionError("Post comments are closed");

            if (postCommentIndex < 0 || !Number.isSafeInteger(postCommentIndex))
                throw new InvalidArgumentError("Post comment index must be a positive integer");

            if (postCommentIndex >= node.postComments.getItemCount())
                throw new NotFoundError("Post comment index out of bounds");

            return postIndex + 1 + postCommentIndex;
        };

        return {
            post: node.post,
            postCommentsState: node.postCommentsState,
            postComments: node.postComments,
            postContentItemIndex,
            getPostCommentIndex,
        };
    }

    public getPostRealtimeItemIfExists(postId: PostId): RynamoItem<PostModel> | null {
        return this._entries.getPostRealtimeItemIfExists(postId);
    }

    public hasMorePosts(): boolean {
        return this.hasMoreEntries;
    }

    public hasOpenPostComments(): boolean {
        return this._entries.openPostCommentsCount > 0;
    }

    public loadMoreEntries({
        endCursor,
        hasMoreEntries,
        entries,
    }: {
        endCursor: FeedEntryCursor | null;
        hasMoreEntries: boolean;
        entries: ReadonlyArray<FeedEntryModel>;
    }) {
        const newEntries = this._entries.addEntries(entries);

        if (
            newEntries === this._entries &&
            hasMoreEntries === this.hasMoreEntries &&
            endCursor === this.endCursor
        ) {
            return this;
        }

        return new PostFeedList({
            endCursor,
            hasMoreEntries,
            entries: newEntries,
        });
    }

    public handleEventTransaction(eventTransaction: ReadonlyArray<RynamoEvent<unknown>>) {
        const newEntries = this._entries.handleEventTransaction(eventTransaction);

        if (newEntries === this._entries) return this;

        return new PostFeedList({
            endCursor: this.endCursor,
            hasMoreEntries: this.hasMoreEntries,
            entries: newEntries,
        });
    }

    public togglePostComments(postId: PostId): PostFeedList {
        const newEntries = this._entries.togglePostComments(postId);

        if (newEntries === this._entries) return this;

        return new PostFeedList({
            endCursor: this.endCursor,
            hasMoreEntries: this.hasMoreEntries,
            entries: newEntries,
        });
    }

    public updatePostComments(
        postId: PostId,
        update: (postComments: MessageList<PostCommentModel>) => MessageList<PostCommentModel>,
    ): PostFeedList {
        const newEntries = this._entries.updatePostComments(postId, update);

        if (newEntries === this._entries) return this;

        return new PostFeedList({
            endCursor: this.endCursor,
            hasMoreEntries: this.hasMoreEntries,
            entries: newEntries,
        });
    }

    public closeAllPostComments(): PostFeedList {
        const newEntries = this._entries.closeAllPostComments();

        if (newEntries === this._entries) return this;

        return new PostFeedList({
            endCursor: this.endCursor,
            hasMoreEntries: this.hasMoreEntries,
            entries: newEntries,
        });
    }
}

type PostFeedListVirtualizedTreeNode =
    | Exclude<FeedEntryModel, FeedPostEntryModel>
    | {
          readonly type: "Post";
          readonly post: RynamoItem<PostModel> & {
              readonly extra: PostListItemExtra | null;
          };
      };

class PostFeedListVirtualizedTree extends VirtualizedTreeBase<
    number,
    PostFeedListVirtualizedTreeNode,
    Exclude<PostListItem, PostListHeaderItem | PostListMoreUnloadedPostsItem>
> {
    public readonly openPostCommentsCount: number;

    private readonly _postVisibilityById: ImmutableMap<
        PostId,
        | {isVisible: true; index: number}
        // We keep track of every post realtime tells us about in `postVisibilityById`
        // whether or not it's in our `posts` list. That's because in some race conditions
        // if we load more posts from the server we might load a stale version of the post
        // so we'll need to replace it with the newer version we got from realtime.
        //
        // TODO(calebmer): We could throw away unreferenced posts after a timeout when
        // we're confident the server won't return us stale data for the post (~3 minutes).
        // For now we don't think `postVisibilityById` will get unreasonably large.
        | {isVisible: false; item: RynamoItem<PostModel>}
    >;

    private constructor({
        openPostCommentsCount,
        postVisibilityById,
        nodeByOrderKey,
        itemCountSubtreeCache,
    }: {
        openPostCommentsCount: number;
        postVisibilityById: ImmutableMap<
            PostId,
            {isVisible: true; index: number} | {isVisible: false; item: RynamoItem<PostModel>}
        >;
        nodeByOrderKey: Tree<number, PostFeedListVirtualizedTreeNode>;
        itemCountSubtreeCache: WeakMap<TreeNode<number, PostFeedListVirtualizedTreeNode>, number>;
    }) {
        // In development, make sure `openPostCommentsCount` is the correct value every
        // time we change the virtualized tree. This is an O(n) check so it's expensive to
        // run in production.
        if (process.env.NODE_ENV !== "production") {
            let expectedOpenPostCommentsCount = 0;

            const iterator = nodeByOrderKey.begin;

            while (iterator.valid) {
                if (
                    iterator.value!.type === "Post" &&
                    getPostListItemExtra(iterator.value!.post).postCommentsState !== "Closed"
                ) {
                    expectedOpenPostCommentsCount++;
                }

                iterator.next();
            }

            assert(
                expectedOpenPostCommentsCount === openPostCommentsCount,
                "Expected open post comments count to equal the number of posts with open comment sections",
            );
        }

        super({nodeByOrderKey, itemCountSubtreeCache});
        this.openPostCommentsCount = openPostCommentsCount;
        this._postVisibilityById = postVisibilityById;
    }

    public static new(entries: ReadonlyArray<FeedEntryModel>) {
        return new PostFeedListVirtualizedTree({
            openPostCommentsCount: 0,
            postVisibilityById: ImmutableMap.empty(),
            nodeByOrderKey: createTree(),
            itemCountSubtreeCache: new WeakMap(),
        }).addEntries(entries);
    }

    protected override _getNodeItemCount(node: PostFeedListVirtualizedTreeNode): number {
        if (node.type !== "Post") {
            return 1;
        } else {
            const {postCommentsState, postComments} = getPostListItemExtra(node.post);
            return 1 + (postCommentsState !== "Closed" ? postComments.getItemCount() + 1 : 0);
        }
    }

    protected override _getNodeItem(
        node: PostFeedListVirtualizedTreeNode,
        index: number,
        postContentItemIndex: number,
    ): Exclude<PostListItem, PostListHeaderItem | PostListMoreUnloadedPostsItem> {
        if (node.type !== "Post") {
            if (index !== 0) throw new OutOfRangeError("Index out of bounds");
            return {type: "FeedEntry", entry: node};
        } else {
            return getPostListVirtualizedTreeNodeItem(node.post, index, postContentItemIndex);
        }
    }

    public getPostByKeyIfExists(postId: PostId): {
        node: {
            post: PostModel;
            postComments: MessageList<PostCommentModel>;
            postCommentsState: PostCommentsState;
        };
        startItemIndex: number;
    } | null {
        const nodeKey = this._postVisibilityById.get(postId);
        if (!nodeKey?.isVisible) return null;

        const iterator = this._nodeByOrderKey.find(nodeKey.index);
        assert(iterator.value?.type === "Post");

        const startItemIndex = this._getPreviousItemCount(iterator);

        const {postCommentsState, postComments} = getPostListItemExtra(iterator.value.post);

        return {
            node: {
                post: iterator.value.post.model,
                postComments,
                postCommentsState,
            },
            startItemIndex,
        };
    }

    public getPostRealtimeItemIfExists(postId: PostId): RynamoItem<PostModel> | null {
        const nodeKey = this._postVisibilityById.get(postId);
        if (!nodeKey?.isVisible) return null;

        const iterator = this._nodeByOrderKey.find(nodeKey.index);
        assert(iterator.value?.type === "Post");

        return iterator.value.post;
    }

    /**
     * Add entries to the end of the virtualized tree. Only one post may exist for each
     * `PostId`. We ignore any repeated `PostId`s.
     */
    public addEntries(entries: ReadonlyArray<FeedEntryModel>): PostFeedListVirtualizedTree {
        let postVisibilityById = this._postVisibilityById;
        let nodeByOrderKey = this._nodeByOrderKey;

        for (const entry of entries) {
            if (entry.type !== "Post") {
                nodeByOrderKey = nodeByOrderKey.insert(nodeByOrderKey.length, entry);
            } else {
                const {post} = entry;

                let oldPostVisibility:
                    | {isVisible: true; index: number}
                    | {isVisible: false; item: RynamoItem<PostModel>}
                    | undefined;

                postVisibilityById = postVisibilityById.update(
                    post.model.id,
                    _oldPostVisibility => {
                        oldPostVisibility = _oldPostVisibility;

                        if (oldPostVisibility?.isVisible) {
                            return oldPostVisibility;
                        } else {
                            return {isVisible: true, index: nodeByOrderKey.length};
                        }
                    },
                );

                if (oldPostVisibility === undefined) {
                    nodeByOrderKey = nodeByOrderKey.insert(nodeByOrderKey.length, {
                        type: "Post",
                        post: {
                            ...post,
                            extra: null,
                        },
                    });
                } else if (!oldPostVisibility.isVisible) {
                    nodeByOrderKey = nodeByOrderKey.insert(nodeByOrderKey.length, {
                        type: "Post",
                        // If the hidden item (received from realtime) has a higher version then use it
                        // instead of the loaded post.
                        post:
                            oldPostVisibility.item.version > post.version
                                ? {...oldPostVisibility.item, extra: null}
                                : {...post, extra: null},
                    });
                } else {
                    const iterator = nodeByOrderKey.find(oldPostVisibility.index);
                    assert(iterator.value?.type === "Post");
                    nodeByOrderKey =
                        // If the currently visible item has a higher version then don't update with the
                        // newly loaded post.
                        iterator.value.post.version > post.version
                            ? nodeByOrderKey
                            : iterator.update({
                                  type: "Post",
                                  post: {...post, extra: iterator.value.post.extra},
                              });
                }
            }
        }

        return new PostFeedListVirtualizedTree({
            openPostCommentsCount: this.openPostCommentsCount,
            postVisibilityById,
            nodeByOrderKey,
            itemCountSubtreeCache: this._itemCountSubtreeCache,
        });
    }

    /**
     * Handle a realtime update event transaction from our DynamoDB general realtime
     * system. Will update any visible posts and keep a record of any other posts
     * realtime tells us about. So if later that post is added (via `addEntries()`) but
     * with a stale version then we'll actually have the latest version.
     */
    public handleEventTransaction(
        eventTransaction: ReadonlyArray<RynamoEvent<unknown>>,
    ): PostFeedListVirtualizedTree {
        let postVisibilityById = this._postVisibilityById;
        let nodeByOrderKey = this._nodeByOrderKey;

        for (const event of eventTransaction) {
            // The `deleteItem()` operation is disabled for posts.
            //
            // NOTE(calebmer, 2024-11-01): We may enable `deleteItem()` on posts in the future.
            // But right now my idea for deleting posts is to leave the post in the database
            // but delete its content. Since we don't want to delete comments on the post. If
            // that's the case we should never receive a `DeleteItem` event for a post.
            if (event.type === "DeleteItem") continue;

            cast<"PutItem">(event.type);

            // We only care about posts...
            if (!(event.item.model instanceof PostModel)) continue;
            const item = event.item as RynamoItem<PostModel>;

            let postVisibility:
                | {isVisible: true; index: number}
                | {isVisible: false; item: RynamoItem<PostModel>}
                | undefined;

            postVisibilityById = postVisibilityById.update(item.model.id, _postVisibility => {
                postVisibility = _postVisibility;

                if (
                    postVisibility &&
                    (postVisibility.isVisible || postVisibility.item.version >= item.version)
                ) {
                    return postVisibility;
                } else if (!postVisibility) {
                    return {isVisible: false, item};
                }
            });

            if (postVisibility?.isVisible) {
                const iterator = nodeByOrderKey.find(postVisibility.index);
                assert(iterator.value?.type === "Post");

                nodeByOrderKey =
                    iterator.value.post.version >= item.version
                        ? nodeByOrderKey
                        : iterator.update({
                              type: "Post",
                              post: {...item, extra: iterator.value.post.extra},
                          });
            }
        }

        // Optimization: If nothing changed, don't construct a new object.
        if (
            postVisibilityById === this._postVisibilityById &&
            nodeByOrderKey === this._nodeByOrderKey
        ) {
            return this;
        }

        return new PostFeedListVirtualizedTree({
            openPostCommentsCount: this.openPostCommentsCount,
            postVisibilityById,
            nodeByOrderKey,
            itemCountSubtreeCache: this._itemCountSubtreeCache,
        });
    }

    /**
     * Toggle the post's comment section as open or closed.
     */
    public togglePostComments(postId: PostId): PostFeedListVirtualizedTree {
        const postVisibility = this._postVisibilityById.get(postId);
        if (!postVisibility?.isVisible) return this;

        let nodeByOrderKey = this._nodeByOrderKey;

        const iterator = nodeByOrderKey.find(postVisibility.index);
        assert(iterator.value?.type === "Post");

        const {postCommentsState, postComments} = getPostListItemExtra(iterator.value.post);

        // Can not toggle post comments if it is always open.
        if (postCommentsState === "AlwaysOpen")
            throw new FailedPreconditionError("Can not toggle post comments that are always open");

        nodeByOrderKey = iterator.update({
            type: "Post",
            post: {
                ...iterator.value.post,
                extra: {
                    postCommentsState: postCommentsState === "Closed" ? "Open" : "Closed",
                    postComments,
                },
            },
        });

        return new PostFeedListVirtualizedTree({
            openPostCommentsCount:
                postCommentsState === "Closed"
                    ? this.openPostCommentsCount + 1
                    : this.openPostCommentsCount - 1,
            postVisibilityById: this._postVisibilityById,
            nodeByOrderKey,
            itemCountSubtreeCache: this._itemCountSubtreeCache,
        });
    }

    /**
     * Update the comments list for a post. If the post id is not in the list this is a
     * noop.
     */
    public updatePostComments(
        postId: PostId,
        update: (comments: MessageList<PostCommentModel>) => MessageList<PostCommentModel>,
    ): PostFeedListVirtualizedTree {
        const postVisibility = this._postVisibilityById.get(postId);
        if (!postVisibility?.isVisible) return this;

        let nodeByOrderKey = this._nodeByOrderKey;

        const iterator = nodeByOrderKey.find(postVisibility.index);
        assert(iterator.value?.type === "Post");

        const {postCommentsState, postComments} = getPostListItemExtra(iterator.value.post);

        const newPostComments = update(postComments);
        if (newPostComments === postComments) return this;

        nodeByOrderKey = iterator.update({
            type: "Post",
            post: {
                ...iterator.value.post,
                extra: {
                    postCommentsState,
                    postComments: newPostComments,
                },
            },
        });

        return new PostFeedListVirtualizedTree({
            openPostCommentsCount: this.openPostCommentsCount,
            postVisibilityById: this._postVisibilityById,
            nodeByOrderKey,
            itemCountSubtreeCache: this._itemCountSubtreeCache,
        });
    }

    /**
     * Iterate through every post in our list updating each `PostCommentsState` to
     * `Closed`.
     */
    public closeAllPostComments(): PostFeedListVirtualizedTree {
        let nodeByOrderKey = this._nodeByOrderKey;

        let iterator = nodeByOrderKey.begin;
        while (iterator.node) {
            const node = iterator.node;

            if (
                node.value.type !== "Post" ||
                !node.value.post.extra ||
                node.value.post.extra.postCommentsState === "Closed"
            ) {
                iterator.next();
                continue;
            }

            nodeByOrderKey = iterator.update({
                type: "Post",
                post: {
                    ...node.value.post,
                    extra: {
                        postCommentsState: "Closed",
                        postComments: node.value.post.extra.postComments,
                    },
                },
            });
            iterator = nodeByOrderKey.find(node.key);
            iterator.next();
        }

        return new PostFeedListVirtualizedTree({
            openPostCommentsCount: 0,
            postVisibilityById: this._postVisibilityById,
            nodeByOrderKey,
            itemCountSubtreeCache: this._itemCountSubtreeCache,
        });
    }
}
