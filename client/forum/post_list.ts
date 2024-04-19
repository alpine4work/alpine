import {Tree, Node as TreeNode} from "functional-red-black-tree";
import {DynamoGeneralRealtimeIndexQuery} from "~/client/dynamo/dynamo_general_realtime_index_query.js";
import {MessageList} from "~/client/messaging/message_list.js";
import {
    VirtualizedTree,
    VirtualizedTreeBase,
} from "~/client/virtualized/helpers/virtualized_tree.js";
import {
    DynamoGeneralRealtimeIndexQueryResult,
    DynamoGeneralRealtimeItem,
} from "~/shared/dynamo/dynamo_general_realtime_types.js";
import {DynamoIndexCursor, DynamoItemKey} from "~/shared/dynamo/dynamo_opaque_strings.js";
import {
    FailedPreconditionError,
    InternalError,
    InvalidArgumentError,
    NotFoundError,
    OutOfRangeError,
} from "~/shared/error/error.js";
import {ChannelModel} from "~/shared/forum/channel_model.js";
import {PostCommentModel, PostModel} from "~/shared/forum/post_model.js";
import {emptyObject} from "~/shared/helpers/array/empty_object.js";
import {encodeBase64} from "~/shared/helpers/binary/base64.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {ImmutableMap} from "~/shared/helpers/immutable/immutable_map.js";
import {DefaultWeakMap} from "~/shared/helpers/map/default_weak_map.js";
import {decodeIdInto} from "~/shared/id/id.js";
import {ChannelId, PostId, WebSocketConnectionId} from "~/shared/id/types/id_types.js";
import {MessageContent} from "~/shared/messaging/message_content_schema.js";
import {OptimisticMessageModel} from "~/shared/messaging/message_model.js";
import {MessagingTypingState} from "~/shared/messaging/messaging_realtime_protocol.js";

// All this post list code is the result of incremental evolution over time
// which means it's not as clean as it could be. It's gone through a couple
// refactors without fundamentally rethinking the structure. A brief history:
//
// 1. `PostList` was created.
// 2. `VirtualizedTree` was created by refactoring the relevant code out of
//    `PostList` so it could be used in other places.
// 3. `PostList` was split into `PostBasicList` and `PostQueryList` so we could
//    power a `<PostListView>` with a DynamoDB general realtime query.

export type PostListChannelHeader =
    | {
          readonly isOnlyNavigationBar: true;
          readonly shouldNotShowChannelId: ChannelId | null;
      }
    | {
          readonly isOnlyNavigationBar: false;
          readonly channel: ChannelModel;
          readonly isCreatingChannel: boolean;
          readonly isEditingDescription: boolean;
          readonly onCancelDescriptionEditing: () => void;
          readonly onSaveDescription: (description: MessageContent) => Promise<void>;
      };

export type PostCommentsState = PostCommentsOpenState | "Closed";
type PostCommentsOpenState = "Open" | "AlwaysOpen";

/**
 * The immutable interface for the backing state of a `<PostListView>`. We have
 * different implementations depending on the backing data. For example, when
 * viewing a channel, posts are backed by a `DynamoGeneralRealtimeIndexQuery`.
 * Whereas a channel post notification is backed by a static list of `PostId`s.
 *
 * Our `<PostListView>` component virtualizes our list of posts since we may
 * have too many to render on screen at once. Posts may also expand their
 * comments inline so if comments are expanded then we also need to virtualize
 * those!
 *
 * Keeping track of which posts are open/closed and how that affects comment
 * indexing is a little complex. This class manages that complexity.
 */
export interface PostListBase {
    /**
     * Get the number of posts in this list.
     */
    getPostCount(): number;

    /**
     * Get the post content item for the provided index. If this index is pointing
     * at a comment then we will return the item for the post the comment is a part
     * of. Will return null if the index is out of bounds. Every index in this
     * list is associated to a post.
     */
    getPostContentItemIfExists(index: number): PostListPostContentItem | null;

    /**
     * Get the total number of items in the list.
     */
    getItemCount(): number;

    /**
     * Get the item at the provided index. Throws if the index is out
     * of bounds.
     */
    getItem(index: number): PostListItem;

    /**
     * Get a post by its `PostId`.
     */
    getPostById(postId: PostId): {
        post: PostModel;
        postComments: MessageList<PostCommentModel>;
        postContentItemIndex: number;
        /**
         * Get the index of the post comment in our list. If comments are not open on
         * this post or if the comment index is out of bounds this will throw an error.
         */
        getPostCommentIndex: (postCommentIndex: number) => number;
    };
}

/**
 * Adds a channel header item to the beginning of a post list.
 */
export class PostListWithChannelHeader implements PostListBase {
    private readonly _channelHeader: PostListChannelHeader;
    private readonly _posts: PostListBase;

    constructor(channelHeader: PostListChannelHeader, posts: PostListBase) {
        this._channelHeader = channelHeader;
        this._posts = posts;
    }

    getPostCount(): number {
        return this._posts.getPostCount();
    }

    getPostContentItemIfExists(index: number): PostListPostContentItem | null {
        if (index === 0) return null;

        const item = this._posts.getPostContentItemIfExists(index - 1);
        if (!item) return null;

        return {
            ...item,
            postContentItemIndex: item.postContentItemIndex + 1,
            postCommentInputItemIndex:
                item.postCommentInputItemIndex !== null ? item.postCommentInputItemIndex + 1 : null,
        };
    }

    getItemCount(): number {
        return this._posts.getItemCount() + 1;
    }

    getItem(index: number): PostListItem {
        if (index === 0) {
            return {
                type: "ChannelHeader",
                channelHeader: this._channelHeader,
            };
        }

        const item = this._posts.getItem(index - 1);

        // Adjust any item indexes to consider items that come before posts in
        // our `PostList`.
        switch (item.type) {
            case "ChannelHeader":
            case "MoreUnloadedPosts":
                return item;
            case "PostContent": {
                return {
                    ...item,
                    postContentItemIndex: item.postContentItemIndex + 1,
                    postCommentInputItemIndex:
                        item.postCommentInputItemIndex !== null
                            ? item.postCommentInputItemIndex + 1
                            : null,
                };
            }
            case "LoadedPostComment":
            case "UnloadedPostComment":
            case "OptimisticPostComment":
            case "PostCommentsTypingIndicator": {
                return {
                    ...item,
                    postCommentInputItemIndex: item.postCommentInputItemIndex + 1,
                };
            }
            case "PostCommentInput": {
                return {
                    ...item,
                    postContentItemIndex: item.postContentItemIndex + 1,
                };
            }
            default:
                throw exhaustive(item);
        }
    }

    getPostById(postId: PostId): {
        post: PostModel;
        postComments: MessageList<PostCommentModel>;
        postContentItemIndex: number;
        getPostCommentIndex: (postCommentIndex: number) => number;
    } {
        const {post, postComments, postContentItemIndex, getPostCommentIndex} =
            this._posts.getPostById(postId);

        return {
            post,
            postComments,
            postContentItemIndex: postContentItemIndex + 1,
            getPostCommentIndex: postCommentIndex => getPostCommentIndex(postCommentIndex) + 1,
        };
    }
}

/**
 * A basic post list you can initialize with whatever posts you want wherever
 * you want. The class automatically maintains a simple backing list. Unlike
 * the realtime query post list which is backed, specifically, by the DynamoDB
 * general realtime query data structure.
 */
export class PostBasicList implements PostListBase {
    public readonly hasMorePosts: boolean;

    private readonly _posts: VirtualizedTree<
        PostId,
        {
            readonly post: PostModel;
            readonly postComments: MessageList<PostCommentModel>;
            readonly postCommentsState: PostCommentsState;
        },
        Exclude<PostListItem, PostListChannelHeaderItem | PostListMoreUnloadedPostsItem>
    >;

    private constructor({
        hasMorePosts,
        posts,
    }: {
        hasMorePosts: boolean;
        posts: VirtualizedTree<
            PostId,
            {
                readonly post: PostModel;
                readonly postComments: MessageList<PostCommentModel>;
                readonly postCommentsState: PostCommentsState;
            },
            Exclude<PostListItem, PostListChannelHeaderItem | PostListMoreUnloadedPostsItem>
        >;
    }) {
        this.hasMorePosts = hasMorePosts;
        this._posts = posts;
    }

    /**
     * An empty post list.
     */
    public static empty = new PostBasicList({
        hasMorePosts: false,
        posts: VirtualizedTree.new({
            getNodeKey: ({post}) => post.id,
            getNodeItemCount: ({postComments, postCommentsState}) =>
                1 + (postCommentsState !== "Closed" ? postComments.getItemCount() + 1 : 0),
            getNodeItem: ({post, postComments, postCommentsState}, index, postContentItemIndex) =>
                getPostNodeItem(post, postComments, postCommentsState, index, postContentItemIndex),
        }),
    });

    /**
     * Get the total number of items in the list.
     */
    public getItemCount() {
        return this._posts.getItemCount() + (this.hasMorePosts ? 1 : 0);
    }

    public getPostCount() {
        return this._posts.getNodeCount();
    }

    public getPostById(postId: PostId): {
        post: PostModel;
        postComments: MessageList<PostCommentModel>;
        postContentItemIndex: number;
        getPostCommentIndex: (postCommentIndex: number) => number;
    } {
        const post = this.getPostByIdIfExists(postId);
        if (!post) throw new NotFoundError("Post not found");
        return post;
    }

    public getPostByIdIfExists(postId: PostId): {
        post: PostModel;
        postComments: MessageList<PostCommentModel>;
        postContentItemIndex: number;
        getPostCommentIndex: (postCommentIndex: number) => number;
    } | null {
        const nodeResult = this._posts.getNodeByKeyIfExists(postId);
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
            postComments: node.postComments,
            postContentItemIndex,
            getPostCommentIndex,
        };
    }

    /**
     * Get the last post or return null if there are no posts.
     */
    public getLastPostIfExists(): {
        post: PostModel;
        postComments: MessageList<PostCommentModel>;
    } | null {
        return this._posts.getLastNodeIfExists();
    }

    /**
     * Get the post content item for the provided index. If this index is pointing
     * at a comment then we will return the item for the post the comment is a part
     * of. Will return null if the index is out of bounds. Every index in this
     * list is associated to a post.
     */
    public getPostContentItemIfExists(index: number): PostListPostContentItem | null {
        const nodeResult = this._posts.getNodeByItemIndexIfExists(index);
        if (!nodeResult) return null;
        const {node, startItemIndex} = nodeResult;

        const postContentItemIndex = startItemIndex;

        return {
            type: "PostContent",
            post: node.post,
            postComments: node.postComments,
            postCommentsState: node.postCommentsState,
            postContentItemIndex,
            postCommentInputItemIndex:
                node.postCommentsState !== "Closed"
                    ? postContentItemIndex + node.postComments.getItemCount() + 1
                    : null,
        };
    }

    /**
     * Get the item at the provided index. Throws if the index is out
     * of bounds.
     */
    public getItem(index: number): PostListItem {
        if (this.hasMorePosts && index === this.getItemCount() - 1) {
            return {
                type: "MoreUnloadedPosts",
            };
        }

        return this._posts.getItem(index);
    }

    /**
     * Set that the post list should have a loading spinner once you reach the end.
     */
    public setHasMorePosts(hasMorePosts: boolean): PostBasicList {
        // Optimization: Don't update the post list if this property hasn't changed.
        if (hasMorePosts === this.hasMorePosts) return this;

        return new PostBasicList({
            hasMorePosts,
            posts: this._posts,
        });
    }

    /**
     * Insert a post into the start of the list.
     */
    public insertPostAtStart(
        post: PostModel,
        {
            postCommentsState = "Closed",
            initialLoadPostComments,
        }: {
            postCommentsState?: PostCommentsState;
            initialLoadPostComments?: {
                comments: ReadonlyArray<PostCommentModel>;
                otherReferencedComments: ReadonlyArray<PostCommentModel>;
            };
        } = {},
    ): PostBasicList {
        let postComments = MessageList.new<PostCommentModel>({
            messageCount: post.commentCount,
            lastMessageChangeTime: post.lastCommentChangeTime,
        });
        if (initialLoadPostComments) {
            postComments = postComments.loadMessages({
                messageCount: post.commentCount,
                messages: initialLoadPostComments.comments,
                otherReferencedMessages: initialLoadPostComments.otherReferencedComments,
            });
        }

        const posts = this._posts.insertNodesAtStart([
            {
                post,
                postComments,
                postCommentsState,
            },
        ]);

        return new PostBasicList({
            hasMorePosts: this.hasMorePosts,
            posts,
        });
    }

    /**
     * Insert a post into the end of the list.
     */
    public insertPostAtEnd(
        post: PostModel,
        {
            postCommentsState = "Closed",
            initialLoadPostComments,
        }: {
            postCommentsState?: PostCommentsState;
            initialLoadPostComments?: {
                comments: ReadonlyArray<PostCommentModel>;
                otherReferencedComments: ReadonlyArray<PostCommentModel>;
            };
        } = {},
    ): PostBasicList {
        let postComments = MessageList.new<PostCommentModel>({
            messageCount: post.commentCount,
            lastMessageChangeTime: post.lastCommentChangeTime,
        });
        if (initialLoadPostComments) {
            postComments = postComments.loadMessages({
                messageCount: post.commentCount,
                messages: initialLoadPostComments.comments,
                otherReferencedMessages: initialLoadPostComments.otherReferencedComments,
            });
        }

        const posts = this._posts.insertNodesAtEnd([
            {
                post,
                postComments,
                postCommentsState,
            },
        ]);

        return new PostBasicList({
            hasMorePosts: this.hasMorePosts,
            posts,
        });
    }

    /**
     * Insert many posts into the start of the list. All of them will have their
     * comments closed.
     */
    public insertManyPostsAtStart(posts: ReadonlyArray<PostModel>) {
        return new PostBasicList({
            hasMorePosts: this.hasMorePosts,
            posts: this._posts.insertNodesAtStart(
                posts.map(post => ({
                    post,
                    postComments: MessageList.new({
                        messageCount: post.commentCount,
                        lastMessageChangeTime: post.lastCommentChangeTime,
                    }),
                    postCommentsState: "Closed",
                })),
            ),
        });
    }

    /**
     * Insert many posts into the end of the list. All of them will have their
     * comments closed.
     */
    public insertManyPostsAtEnd(posts: ReadonlyArray<PostModel>) {
        return new PostBasicList({
            hasMorePosts: this.hasMorePosts,
            posts: this._posts.insertNodesAtEnd(
                posts.map(post => ({
                    post,
                    postComments: MessageList.new({
                        messageCount: post.commentCount,
                        lastMessageChangeTime: post.lastCommentChangeTime,
                    }),
                    postCommentsState: "Closed",
                })),
            ),
        });
    }

    /**
     * Toggle the post's comment section as open or closed.
     */
    public togglePostComments(postId: PostId): PostBasicList {
        return new PostBasicList({
            hasMorePosts: this.hasMorePosts,
            posts: this._posts.updateNode(postId, node => {
                // Can not toggle post comments if it is always open.
                if (node.postCommentsState === "AlwaysOpen")
                    throw new FailedPreconditionError(
                        "Can not toggle post comments that are always open",
                    );

                return {
                    ...node,
                    postCommentsState: node.postCommentsState === "Closed" ? "Open" : "Closed",
                };
            }),
        });
    }

    /**
     * Update the post in our list. If the post is not in the list this is
     * a noop.
     */
    public updatePost(postId: PostId, update: (post: PostModel) => PostModel): PostBasicList {
        const newPosts = this._posts.updateNode(postId, node => {
            const newPost = update(node.post);
            if (newPost === node.post) return node;
            return {...node, post: newPost};
        });

        if (newPosts === this._posts) return this;

        return new PostBasicList({
            hasMorePosts: this.hasMorePosts,
            posts: newPosts,
        });
    }

    /**
     * Update the comments list for a post. If the post id is not in the list this
     * is a noop.
     */
    public updatePostComments(
        postId: PostId,
        update: (postComments: MessageList<PostCommentModel>) => MessageList<PostCommentModel>,
    ): PostBasicList {
        const newPosts = this._posts.updateNode(postId, node => {
            const newPostComments = update(node.postComments);
            if (newPostComments === node.postComments) return node;
            return {...node, postComments: newPostComments};
        });

        if (newPosts === this._posts) return this;

        return new PostBasicList({
            hasMorePosts: this.hasMorePosts,
            posts: newPosts,
        });
    }
}

export type PostQueryListDynamoGeneralRealtimeIndexQuery = DynamoGeneralRealtimeIndexQuery<
    PostModel,
    {
        readonly postComments: MessageList<PostCommentModel>;
        readonly postCommentsState: PostCommentsState;
    }
>;

/**
 * Post list backed by a DynamoDB general realtime query. The query is
 * presented in reverse order since it should be loaded from the end. Since the
 * end is where the latest channel posts are.
 */
export class PostQueryList implements PostListBase {
    public readonly query: PostQueryListDynamoGeneralRealtimeIndexQuery;
    private readonly _posts: PostQueryListVirtualizedTree;

    private constructor(posts: PostQueryListVirtualizedTree) {
        this.query = posts.query;
        this._posts = posts;
    }

    public static new(result: DynamoGeneralRealtimeIndexQueryResult<PostModel>): PostQueryList {
        const posts = PostQueryListVirtualizedTree.new(result);
        return new PostQueryList(posts);
    }

    public getPostCount(): number {
        return this._posts.getNodeCount();
    }

    public getPostContentItemIfExists(index: number): PostListPostContentItem | null {
        const nodeResult = this._posts.getPostByItemIndexIfExists(index);
        if (!nodeResult) return null;
        const {node, startItemIndex} = nodeResult;

        const postContentItemIndex = startItemIndex;

        return {
            type: "PostContent",
            post: node.post,
            postComments: node.postComments,
            postCommentsState: node.postCommentsState,
            postContentItemIndex,
            postCommentInputItemIndex:
                node.postCommentsState !== "Closed"
                    ? postContentItemIndex + node.postComments.getItemCount() + 1
                    : null,
        };
    }

    public getPostById(postId: PostId): {
        post: PostModel;
        postComments: MessageList<PostCommentModel>;
        postContentItemIndex: number;
        getPostCommentIndex: (postCommentIndex: number) => number;
    } {
        const nodeResult = this._posts.getPostByKeyIfExists(postId);
        if (!nodeResult) throw new InternalError("Post not found");
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
            postComments: node.postComments,
            postContentItemIndex,
            getPostCommentIndex,
        };
    }

    public getItemCount(): number {
        return this._posts.getItemCount() + (this.query.hasLoadingIndicatorAtStart() ? 1 : 0);
    }

    public getItem(index: number): PostListItem {
        if (this.query.hasLoadingIndicatorAtStart() && index === this.getItemCount() - 1) {
            return {
                type: "MoreUnloadedPosts",
            };
        }

        return this._posts.getItem(index);
    }

    public updateQuery(query: PostQueryListDynamoGeneralRealtimeIndexQuery): PostQueryList {
        const newPosts = this._posts.updateQuery(query);
        if (newPosts === this._posts) return this;
        return new PostQueryList(newPosts);
    }

    public togglePostComments(postId: PostId): PostQueryList {
        const newPosts = this._posts.togglePostComments(postId);
        if (newPosts === this._posts) return this;
        return new PostQueryList(newPosts);
    }

    public updatePostComments(
        postId: PostId,
        update: (postComments: MessageList<PostCommentModel>) => MessageList<PostCommentModel>,
    ): PostQueryList {
        const newPosts = this._posts.updatePostComments(postId, update);
        if (newPosts === this._posts) return this;
        return new PostQueryList(newPosts);
    }
}

class PostQueryListVirtualizedTree extends VirtualizedTreeBase<
    PostId,
    DynamoIndexCursor,
    DynamoGeneralRealtimeItem<PostModel> & {
        readonly extra: {
            readonly postComments: MessageList<PostCommentModel>;
            readonly postCommentsState: PostCommentsState;
        } | null;
    },
    Exclude<PostListItem, PostListChannelHeaderItem | PostListMoreUnloadedPostsItem>
> {
    /**
     * The backing realtime DynamoDB query for this `PostList`.
     */
    public readonly query: DynamoGeneralRealtimeIndexQuery<
        PostModel,
        {
            readonly postComments: MessageList<PostCommentModel>;
            readonly postCommentsState: PostCommentsState;
        }
    >;

    // Iterate through `nodeByOrderKey` in reverse order. The most recent posts are
    // at the end of the query but we want to display them at the top of our
    // channel.
    protected override readonly _isNodeByOrderKeyReversed = true;

    protected readonly _nodeByOrderKey: Tree<
        DynamoIndexCursor,
        DynamoGeneralRealtimeItem<PostModel> & {
            readonly extra: {
                readonly postComments: MessageList<PostCommentModel>;
                readonly postCommentsState: PostCommentsState;
            } | null;
        }
    >;

    private constructor({
        query,
        nodeByOrderKey,
        itemCountSubtreeCache,
    }: {
        query: DynamoGeneralRealtimeIndexQuery<
            PostModel,
            {
                readonly postComments: MessageList<PostCommentModel>;
                readonly postCommentsState: PostCommentsState;
            }
        >;
        nodeByOrderKey: Tree<
            DynamoIndexCursor,
            DynamoGeneralRealtimeItem<PostModel> & {
                readonly extra: {
                    readonly postComments: MessageList<PostCommentModel>;
                    readonly postCommentsState: PostCommentsState;
                } | null;
            }
        >;
        itemCountSubtreeCache: WeakMap<
            TreeNode<
                DynamoIndexCursor,
                DynamoGeneralRealtimeItem<PostModel> & {
                    readonly extra: {
                        readonly postComments: MessageList<PostCommentModel>;
                        readonly postCommentsState: PostCommentsState;
                    } | null;
                }
            >,
            number
        >;
    }) {
        super(itemCountSubtreeCache);
        this.query = query;
        this._nodeByOrderKey = nodeByOrderKey;
    }

    public static new(result: DynamoGeneralRealtimeIndexQueryResult<PostModel>) {
        const query = DynamoGeneralRealtimeIndexQuery.new<
            PostModel,
            {
                readonly postComments: MessageList<PostCommentModel>;
                readonly postCommentsState: PostCommentsState;
            }
        >(result);

        return new PostQueryListVirtualizedTree({
            query,
            nodeByOrderKey: query.getLoadedItemByCursor(),
            itemCountSubtreeCache: new WeakMap(),
        });
    }

    protected _getNodeKey(post: DynamoGeneralRealtimeItem<PostModel>): PostId {
        return post.model.id;
    }

    protected override _getNodeItemCount(
        node: DynamoGeneralRealtimeItem<PostModel> & {
            readonly extra: {
                readonly postComments: MessageList<PostCommentModel>;
                readonly postCommentsState: PostCommentsState;
            } | null;
        },
    ): number {
        const {
            postCommentsState = "Closed",
            postComments = initialPostModelCommentsCache.getOrSetDefault(node.model),
        } = node.extra ?? emptyObject;

        return 1 + (postCommentsState !== "Closed" ? postComments.getItemCount() + 1 : 0);
    }

    protected override _getNodeItem(
        node: DynamoGeneralRealtimeItem<PostModel> & {
            readonly extra: {
                readonly postComments: MessageList<PostCommentModel>;
                readonly postCommentsState: PostCommentsState;
            } | null;
        },
        index: number,
        postContentItemIndex: number,
    ): Exclude<PostListItem, PostListChannelHeaderItem | PostListMoreUnloadedPostsItem> {
        const {
            postCommentsState = "Closed",
            postComments = initialPostModelCommentsCache.getOrSetDefault(node.model),
        } = node.extra ?? emptyObject;

        return getPostNodeItem(
            node.model,
            postComments,
            postCommentsState,
            index,
            postContentItemIndex,
        );
    }

    public getPostByItemIndexIfExists(itemIndex: number): {
        node: {
            post: PostModel;
            postComments: MessageList<PostCommentModel>;
            postCommentsState: PostCommentsState;
        };
        startItemIndex: number;
    } | null {
        const nodeResult = this.getNodeByItemIndexIfExists(itemIndex);
        if (!nodeResult) return null;
        const {node, startItemIndex} = nodeResult;

        const {
            postCommentsState = "Closed",
            postComments = initialPostModelCommentsCache.getOrSetDefault(node.model),
        } = node.extra ?? emptyObject;

        return {
            node: {
                post: node.model,
                postComments,
                postCommentsState,
            },
            startItemIndex,
        };
    }

    public getPostByKeyIfExists(postId: PostId): {
        node: {
            post: PostModel;
            postComments: MessageList<PostCommentModel>;
            postCommentsState: PostCommentsState;
        };
        startItemIndex: number;
    } | null {
        const key = createDynamoItemKeyFromPostId(postId);

        const node = this.query.getItemByKeyIfExists(key);
        if (!node) return null;

        const iterator = this._nodeByOrderKey.find(node.cursor);
        assert(iterator.valid);

        const startItemIndex = this._getPreviousItemCount(iterator);

        const {
            postCommentsState = "Closed",
            postComments = initialPostModelCommentsCache.getOrSetDefault(node.item.model),
        } = node.item.extra ?? emptyObject;

        return {
            node: {
                post: node.item.model,
                postComments,
                postCommentsState,
            },
            startItemIndex,
        };
    }

    /**
     * Update the backing DynamoDB realtime query of this post list.
     */
    public updateQuery(
        query: DynamoGeneralRealtimeIndexQuery<
            PostModel,
            {
                readonly postComments: MessageList<PostCommentModel>;
                readonly postCommentsState: PostCommentsState;
            }
        >,
    ) {
        if (query === this.query) return this;

        return new PostQueryListVirtualizedTree({
            query,
            nodeByOrderKey: query.getLoadedItemByCursor(),
            itemCountSubtreeCache: this._itemCountSubtreeCache,
        });
    }

    /**
     * Toggle the post's comment section as open or closed.
     */
    public togglePostComments(postId: PostId): PostQueryListVirtualizedTree {
        const key = createDynamoItemKeyFromPostId(postId);

        const itemResult = this.query.getItemByKeyIfExists(key);
        if (!itemResult) return this;

        const newQuery = this.query.updateItemExtraIfExists(key, item => {
            const {
                postCommentsState = "Closed",
                postComments = initialPostModelCommentsCache.getOrSetDefault(item.model),
            } = item.extra ?? emptyObject;

            // Can not toggle post comments if it is always open.
            if (postCommentsState === "AlwaysOpen")
                throw new FailedPreconditionError(
                    "Can not toggle post comments that are always open",
                );

            return {
                postCommentsState: postCommentsState === "Closed" ? "Open" : "Closed",
                postComments,
            };
        });

        return this.updateQuery(newQuery);
    }

    /**
     * Update the comments list for a post. If the post id is not in the list this
     * is a noop.
     */
    public updatePostComments(
        postId: PostId,
        update: (comments: MessageList<PostCommentModel>) => MessageList<PostCommentModel>,
    ): PostQueryListVirtualizedTree {
        const key = createDynamoItemKeyFromPostId(postId);

        const itemResult = this.query.getItemByKeyIfExists(key);
        if (!itemResult) return this;

        const newQuery = this.query.updateItemExtraIfExists(key, item => {
            const {
                postCommentsState = "Closed",
                postComments = initialPostModelCommentsCache.getOrSetDefault(item.model),
            } = item.extra ?? emptyObject;

            const newPostComments = update(postComments);
            if (newPostComments === postComments) return item.extra;

            return {
                postCommentsState,
                postComments: newPostComments,
            };
        });

        return this.updateQuery(newQuery);
    }
}

const initialPostModelCommentsCache = new DefaultWeakMap(createInitialPostModelComments);

function createInitialPostModelComments(post: PostModel): MessageList<PostCommentModel> {
    return MessageList.new({
        messageCount: post.commentCount,
        lastMessageChangeTime: post.lastCommentChangeTime,
    });
}

/**
 * Manually build a `DynamoItemKey` from a `PostId` using the same process the
 * server uses. The data within `DynamoItemKey`s is not secure by design,
 * they're trivial to reverse engineer by clients. Like we do here.
 */
function createDynamoItemKeyFromPostId(postId: PostId): DynamoItemKey {
    const totalByteCount =
        1 + // Partition `id`
        16 + // `PostId` byte length
        3 + // Sort range `OrderKey`
        1; // Sort range `id`

    const bytes = new Uint8Array(totalByteCount);
    let byteIndex = 0;

    bytes[byteIndex++] = 1;
    decodeIdInto(postId, bytes, byteIndex);
    byteIndex += 16;
    bytes[byteIndex++] = 37;
    bytes[byteIndex++] = 1;
    bytes[byteIndex++] = 0;
    bytes[byteIndex++] = 0;

    return encodeBase64(bytes, "Rfc4648UrlWithOrderPreservation") as DynamoItemKey;
}

function getPostNodeItem(
    post: PostModel,
    postComments: MessageList<PostCommentModel>,
    postCommentsState: PostCommentsState,
    index: number,
    postContentItemIndex: number,
): Exclude<PostListItem, PostListChannelHeaderItem | PostListMoreUnloadedPostsItem> {
    if (index === 0) {
        return {
            type: "PostContent",
            post,
            postComments,
            postCommentsState,
            postContentItemIndex,
            postCommentInputItemIndex:
                postCommentsState !== "Closed"
                    ? postContentItemIndex + postComments.getItemCount() + 1
                    : null,
        };
    }

    if (postCommentsState !== "Closed") {
        const postCommentIndex = index - 1;
        const postCommentCount = postComments.getItemCount();
        const postCommentInputItemIndex = postContentItemIndex + postComments.getItemCount() + 1;

        if (0 <= postCommentIndex && postCommentIndex < postCommentCount) {
            const item = postComments.getItem(postCommentIndex);
            switch (item.type) {
                case "Loaded": {
                    return {
                        type: "LoadedPostComment",
                        post,
                        postComments,
                        postCommentIndex,
                        postComment: item.message,
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
                        postComment: item.message,
                        postCommentInputItemIndex,
                        optimisticPostCommentIndex: item.optimisticMessageIndex,
                    };
                }
                case "TypingIndicators": {
                    return {
                        type: "PostCommentsTypingIndicator",
                        post,
                        postComments,
                        typingStateByConnectionId: item.typingStateByConnectionId,
                        postCommentInputItemIndex,
                    };
                }
                default:
                    throw exhaustive(item);
            }
        }

        if (index === postCommentCount + 1) {
            return {
                type: "PostCommentInput",
                post,
                postComments,
                postContentItemIndex,
            };
        }
    }

    throw new OutOfRangeError("Index out of bounds");
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
    | PostListPostCommentsTypingIndicator
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
    readonly postCommentsState: PostCommentsState;
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
    readonly postComment: OptimisticMessageModel;
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
 * When users are actively typing new messages we show an indicator rendered in
 * this item's position.
 */
export type PostListPostCommentsTypingIndicator = {
    readonly type: "PostCommentsTypingIndicator";
    readonly post: PostModel;
    readonly postComments: MessageList<PostCommentModel>;
    readonly typingStateByConnectionId: ImmutableMap<WebSocketConnectionId, MessagingTypingState>;
    /**
     * If the comment section is open, this will be the index of the post comment
     * input in the full `PostList`.
     */
    readonly postCommentInputItemIndex: number;
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
