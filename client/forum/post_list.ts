import createTree, {Tree, Node as TreeNode} from "functional-red-black-tree";
import {SetStateAction} from "react";
import {DynamoGeneralRealtimeIndexQuery} from "~/client/dynamo/dynamo_general_realtime_index_query.js";
import {MessageList} from "~/client/messaging/message_list.js";
import {VirtualizedTreeBase} from "~/client/virtualized/helpers/virtualized_tree.js";
import {
    DynamoGeneralRealtimeEvent,
    DynamoGeneralRealtimeIndexQueryResult,
    DynamoGeneralRealtimeItem,
} from "~/shared/dynamo/dynamo_general_realtime_types.js";
import {DynamoIndexCursor, DynamoItemKey} from "~/shared/dynamo/dynamo_opaque_strings.js";
import {
    FailedPreconditionError,
    InvalidArgumentError,
    NotFoundError,
    OutOfRangeError,
} from "~/shared/error/error.js";
import {ChannelModel} from "~/shared/forum/channel_model.js";
import {PostCommentModel, PostModel} from "~/shared/forum/post_model.js";
import {emptyObject} from "~/shared/helpers/array/empty_object.js";
import {encodeBase64} from "~/shared/helpers/binary/base64.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {cast} from "~/shared/helpers/control/cast.js";
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
export interface PostListInterface {
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
export class PostListWithChannelHeader implements PostListInterface {
    private readonly _channelHeader: PostListChannelHeader;
    private readonly _posts: PostListInterface;

    constructor(channelHeader: PostListChannelHeader, posts: PostListInterface) {
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
 * The base of a post list where posts are held in a
 * `PostListVirtualizedTreeBase` subclass. The main contribution of this class
 * is providing a public interface that doesn't include `VirtualizedTree`
 * methods and returning a `MoreUnloadedPosts` item if data is still loading.
 */
abstract class PostListBase<NodeOrderKey> implements PostListInterface {
    protected abstract readonly _posts: PostListVirtualizedTreeBase<NodeOrderKey>;

    public getPostCount(): number {
        return this._posts.getNodeCount();
    }

    public getLastPostIdIfExists(): PostId | null {
        return this._posts.getLastNodeIfExists()?.model.id ?? null;
    }

    public hasPostId(postId: PostId): boolean {
        return this._posts.hasPostId(postId);
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
        const nodeResult = this._posts.getPostByKeyIfExists(postId);
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

    public abstract hasMorePosts(): boolean;

    public getItemCount(): number {
        return this._posts.getItemCount() + (this.hasMorePosts() ? 1 : 0);
    }

    public getItem(index: number): PostListItem {
        if (this.hasMorePosts() && index === this.getItemCount() - 1) {
            return {
                type: "MoreUnloadedPosts",
            };
        }

        return this._posts.getItem(index);
    }
}

abstract class PostListVirtualizedTreeBase<NodeOrderKey> extends VirtualizedTreeBase<
    PostId,
    NodeOrderKey,
    DynamoGeneralRealtimeItem<PostModel> & {
        readonly extra: {
            readonly postComments: MessageList<PostCommentModel>;
            readonly postCommentsState: PostCommentsState;
        } | null;
    },
    Exclude<PostListItem, PostListChannelHeaderItem | PostListMoreUnloadedPostsItem>
> {
    protected override _getNodeKey(post: DynamoGeneralRealtimeItem<PostModel>): PostId {
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

        if (index === 0) {
            return {
                type: "PostContent",
                post: node.model,
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
            const postCommentInputItemIndex =
                postContentItemIndex + postComments.getItemCount() + 1;

            if (0 <= postCommentIndex && postCommentIndex < postCommentCount) {
                const item = postComments.getItem(postCommentIndex);
                switch (item.type) {
                    case "Loaded": {
                        return {
                            type: "LoadedPostComment",
                            post: node.model,
                            postComments,
                            postCommentIndex,
                            postComment: item.message,
                            postCommentInputItemIndex,
                        };
                    }
                    case "Unloaded": {
                        return {
                            type: "UnloadedPostComment",
                            post: node.model,
                            postComments,
                            postCommentIndex,
                            postCommentInputItemIndex,
                        };
                    }
                    case "Optimistic": {
                        return {
                            type: "OptimisticPostComment",
                            post: node.model,
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
                            post: node.model,
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
                    post: node.model,
                    postComments,
                    postContentItemIndex,
                };
            }
        }

        throw new OutOfRangeError("Index out of bounds");
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

    protected abstract _getNodeOrderKeyByKeyIfExists(postId: PostId): NodeOrderKey | null;

    public hasPostId(postId: PostId): boolean {
        return this._getNodeOrderKeyByKeyIfExists(postId) !== null;
    }

    public getPostByKeyIfExists(postId: PostId): {
        node: {
            post: PostModel;
            postComments: MessageList<PostCommentModel>;
            postCommentsState: PostCommentsState;
        };
        startItemIndex: number;
    } | null {
        const nodeKey = this._getNodeOrderKeyByKeyIfExists(postId);
        if (nodeKey === null) return null;

        const iterator = this._nodeByOrderKey.find(nodeKey);
        assert(iterator.valid);
        const node = iterator.value!;

        const startItemIndex = this._getPreviousItemCount(iterator);

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
}

/**
 * A basic post list you can initialize with whatever posts you want wherever
 * you want. The class automatically maintains a simple backing list. Unlike
 * the realtime query post list which is backed, specifically, by the DynamoDB
 * general realtime query data structure.
 */
export class PostBasicList extends PostListBase<number> {
    private readonly _hasMorePosts: boolean;
    protected readonly _posts: PostBasicListVirtualizedTree;

    private constructor({
        hasMorePosts,
        posts,
    }: {
        hasMorePosts: boolean;
        posts: PostBasicListVirtualizedTree;
    }) {
        super();
        this._hasMorePosts = hasMorePosts;
        this._posts = posts;
    }

    public static new(
        result:
            | {
                  type: "Many";
                  hasMorePosts: boolean;
                  posts: ReadonlyArray<DynamoGeneralRealtimeItem<PostModel>>;
              }
            | {
                  type: "One";
                  post: DynamoGeneralRealtimeItem<PostModel>;
                  postCommentsState?: PostCommentsState;
                  postComments?: {
                      comments: ReadonlyArray<PostCommentModel>;
                      otherReferencedComments: ReadonlyArray<PostCommentModel>;
                  };
              },
    ) {
        return new PostBasicList({
            hasMorePosts: result.type === "Many" && result.hasMorePosts,
            posts: PostBasicListVirtualizedTree.new(
                result.type === "One"
                    ? [
                          {
                              ...result.post,
                              extra: {
                                  postCommentsState: result.postCommentsState ?? "Closed",
                                  postComments: !result.postComments
                                      ? MessageList.new<PostCommentModel>({
                                            messageCount: result.post.model.commentCount,
                                            lastMessageChangeTime:
                                                result.post.model.lastCommentChangeTime,
                                        })
                                      : MessageList.new<PostCommentModel>({
                                            messageCount: result.post.model.commentCount,
                                            lastMessageChangeTime:
                                                result.post.model.lastCommentChangeTime,
                                        }).loadMessages({
                                            messageCount: result.post.model.commentCount,
                                            messages: result.postComments.comments,
                                            otherReferencedMessages:
                                                result.postComments.otherReferencedComments,
                                        }),
                              },
                          },
                      ]
                    : result.posts.map(post => ({...post, extra: null})),
            ),
        });
    }

    public override hasMorePosts(): boolean {
        return this._hasMorePosts;
    }

    public loadMorePosts({
        hasMorePosts,
        posts,
    }: {
        hasMorePosts: boolean;
        posts: ReadonlyArray<DynamoGeneralRealtimeItem<PostModel>>;
    }) {
        const newPosts = this._posts.addPosts(posts.map(post => ({...post, extra: null})));

        if (newPosts === this._posts) return this;

        return new PostBasicList({
            hasMorePosts,
            posts: newPosts,
        });
    }

    public handleEventTransaction(
        eventTransaction: ReadonlyArray<DynamoGeneralRealtimeEvent<unknown>>,
    ) {
        const newPosts = this._posts.handleEventTransaction(eventTransaction);

        if (newPosts === this._posts) return this;

        return new PostBasicList({
            hasMorePosts: this._hasMorePosts,
            posts: newPosts,
        });
    }

    public togglePostComments(postId: PostId): PostBasicList {
        const newPosts = this._posts.togglePostComments(postId);

        if (newPosts === this._posts) return this;

        return new PostBasicList({
            hasMorePosts: this._hasMorePosts,
            posts: newPosts,
        });
    }

    public updatePostComments(
        postId: PostId,
        update: (postComments: MessageList<PostCommentModel>) => MessageList<PostCommentModel>,
    ): PostBasicList {
        const newPosts = this._posts.updatePostComments(postId, update);

        if (newPosts === this._posts) return this;

        return new PostBasicList({
            hasMorePosts: this._hasMorePosts,
            posts: newPosts,
        });
    }
}

class PostBasicListVirtualizedTree extends PostListVirtualizedTreeBase<number> {
    private readonly _postVisibilityById: ImmutableMap<
        PostId,
        | {isVisible: true; index: number}
        // We keep track of every post realtime tells us about in `postVisibilityById`
        // whether or not it's in our `posts` list. That's because in some race
        // conditions if we load more posts from the server we might load a stale
        // version of the post so we'll need to replace it with the newer version we
        // got from realtime.
        //
        // TODO(calebmer): We could throw away unreferenced posts after a timeout when
        // we're confident the server won't return us stale data for the post (~3
        // minutes). For now we don't think `postVisibilityById` will get unreasonably
        // large.
        | {isVisible: false; item: DynamoGeneralRealtimeItem<PostModel>}
    >;

    private constructor({
        postVisibilityById,
        nodeByOrderKey,
        itemCountSubtreeCache,
    }: {
        postVisibilityById: ImmutableMap<
            PostId,
            | {isVisible: true; index: number}
            | {isVisible: false; item: DynamoGeneralRealtimeItem<PostModel>}
        >;
        nodeByOrderKey: Tree<
            number,
            DynamoGeneralRealtimeItem<PostModel> & {
                readonly extra: {
                    readonly postComments: MessageList<PostCommentModel>;
                    readonly postCommentsState: PostCommentsState;
                } | null;
            }
        >;
        itemCountSubtreeCache: WeakMap<
            TreeNode<
                number,
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
        super({nodeByOrderKey, itemCountSubtreeCache});
        this._postVisibilityById = postVisibilityById;
    }

    public static new(
        posts: Array<
            DynamoGeneralRealtimeItem<PostModel> & {
                readonly extra: {
                    readonly postComments: MessageList<PostCommentModel>;
                    readonly postCommentsState: PostCommentsState;
                } | null;
            }
        >,
    ) {
        return new PostBasicListVirtualizedTree({
            postVisibilityById: ImmutableMap.empty(),
            nodeByOrderKey: createTree(),
            itemCountSubtreeCache: new WeakMap(),
        }).addPosts(posts);
    }

    protected _getNodeOrderKeyByKeyIfExists(postId: PostId): number | null {
        const postVisibility = this._postVisibilityById.get(postId);
        if (!postVisibility?.isVisible) return null;
        return postVisibility.index;
    }

    /**
     * Add posts to the end of the virtualized tree. Only one post may exist for
     * each `PostId`.
     */
    public addPosts(
        posts: ReadonlyArray<
            DynamoGeneralRealtimeItem<PostModel> & {
                readonly extra: {
                    readonly postComments: MessageList<PostCommentModel>;
                    readonly postCommentsState: PostCommentsState;
                } | null;
            }
        >,
    ): PostBasicListVirtualizedTree {
        let postVisibilityById = this._postVisibilityById;
        let nodeByOrderKey = this._nodeByOrderKey;

        for (const post of posts) {
            let oldPostVisibility:
                | {isVisible: true; index: number}
                | {isVisible: false; item: DynamoGeneralRealtimeItem<PostModel>}
                | undefined;

            postVisibilityById = postVisibilityById.update(post.model.id, _oldPostVisibility => {
                oldPostVisibility = _oldPostVisibility;

                if (oldPostVisibility?.isVisible) {
                    return oldPostVisibility;
                } else {
                    return {isVisible: true, index: nodeByOrderKey.length};
                }
            });

            if (oldPostVisibility === undefined) {
                nodeByOrderKey = nodeByOrderKey.insert(nodeByOrderKey.length, post);
            } else if (!oldPostVisibility.isVisible) {
                nodeByOrderKey = nodeByOrderKey.insert(
                    nodeByOrderKey.length,
                    // If the hidden item (received from realtime) has a higher version then use it
                    // instead of the loaded post.
                    oldPostVisibility.item.version > post.version
                        ? {...oldPostVisibility.item, extra: post.extra}
                        : post,
                );
            } else {
                const iterator = nodeByOrderKey.find(oldPostVisibility.index);
                assert(iterator.value);
                nodeByOrderKey =
                    // If the currently visible item has a higher version then don't update with
                    // the newly loaded post.
                    iterator.value.version > post.version ? nodeByOrderKey : iterator.update(post);
            }
        }

        return new PostBasicListVirtualizedTree({
            postVisibilityById,
            nodeByOrderKey,
            itemCountSubtreeCache: this._itemCountSubtreeCache,
        });
    }

    /**
     * Handle a realtime update event transaction from our DynamoDB general
     * realtime system. Will update any visible posts and keep a record of any
     * other posts realtime tells us about. So if later that post is added (via
     * `addPosts()`) but with a stale version then we'll actually have the latest
     * version.
     */
    public handleEventTransaction(
        eventTransaction: ReadonlyArray<DynamoGeneralRealtimeEvent<unknown>>,
    ): PostBasicListVirtualizedTree {
        let postVisibilityById = this._postVisibilityById;
        let nodeByOrderKey = this._nodeByOrderKey;

        for (const event of eventTransaction) {
            cast<"PutItem">(event.type);

            // We only care about posts...
            if (!(event.item.model instanceof PostModel)) continue;
            const item = event.item as DynamoGeneralRealtimeItem<PostModel>;

            let postVisibility:
                | {isVisible: true; index: number}
                | {isVisible: false; item: DynamoGeneralRealtimeItem<PostModel>}
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
                assert(iterator.value);

                nodeByOrderKey =
                    iterator.value.version >= item.version
                        ? nodeByOrderKey
                        : iterator.update({...item, extra: iterator.value.extra});
            }
        }

        // Optimization: If nothing changed, don't construct a new object.
        if (
            postVisibilityById === this._postVisibilityById &&
            nodeByOrderKey === this._nodeByOrderKey
        ) {
            return this;
        }

        return new PostBasicListVirtualizedTree({
            postVisibilityById,
            nodeByOrderKey,
            itemCountSubtreeCache: this._itemCountSubtreeCache,
        });
    }

    /**
     * Toggle the post's comment section as open or closed.
     */
    public togglePostComments(postId: PostId): PostBasicListVirtualizedTree {
        const postVisibility = this._postVisibilityById.get(postId);
        if (!postVisibility?.isVisible) return this;

        let nodeByOrderKey = this._nodeByOrderKey;

        const iterator = nodeByOrderKey.find(postVisibility.index);
        assert(iterator.value);

        const {
            postCommentsState = "Closed",
            postComments = initialPostModelCommentsCache.getOrSetDefault(iterator.value.model),
        } = iterator.value.extra ?? emptyObject;

        // Can not toggle post comments if it is always open.
        if (postCommentsState === "AlwaysOpen")
            throw new FailedPreconditionError("Can not toggle post comments that are always open");

        nodeByOrderKey = iterator.update({
            ...iterator.value,
            extra: {
                postCommentsState: postCommentsState === "Closed" ? "Open" : "Closed",
                postComments,
            },
        });

        return new PostBasicListVirtualizedTree({
            postVisibilityById: this._postVisibilityById,
            nodeByOrderKey,
            itemCountSubtreeCache: this._itemCountSubtreeCache,
        });
    }

    /**
     * Update the comments list for a post. If the post id is not in the list this
     * is a noop.
     */
    public updatePostComments(
        postId: PostId,
        update: (comments: MessageList<PostCommentModel>) => MessageList<PostCommentModel>,
    ): PostBasicListVirtualizedTree {
        const postVisibility = this._postVisibilityById.get(postId);
        if (!postVisibility?.isVisible) return this;

        let nodeByOrderKey = this._nodeByOrderKey;

        const iterator = nodeByOrderKey.find(postVisibility.index);
        assert(iterator.value);

        const {
            postCommentsState = "Closed",
            postComments = initialPostModelCommentsCache.getOrSetDefault(iterator.value.model),
        } = iterator.value.extra ?? emptyObject;

        const newPostComments = update(postComments);
        if (newPostComments === postComments) return this;

        nodeByOrderKey = iterator.update({
            ...iterator.value,
            extra: {
                postCommentsState,
                postComments: newPostComments,
            },
        });

        return new PostBasicListVirtualizedTree({
            postVisibilityById: this._postVisibilityById,
            nodeByOrderKey,
            itemCountSubtreeCache: this._itemCountSubtreeCache,
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
export class PostQueryList extends PostListBase<DynamoIndexCursor> {
    public readonly query: PostQueryListDynamoGeneralRealtimeIndexQuery;
    protected readonly _posts: PostQueryListVirtualizedTree;

    private constructor(posts: PostQueryListVirtualizedTree) {
        super();
        this.query = posts.query;
        this._posts = posts;
    }

    public static new(result: DynamoGeneralRealtimeIndexQueryResult<PostModel>): PostQueryList {
        const posts = PostQueryListVirtualizedTree.new(result);
        return new PostQueryList(posts);
    }

    public override hasMorePosts(): boolean {
        return this.query.hasLoadingIndicatorAtStart();
    }

    public updateQuery(
        query: SetStateAction<PostQueryListDynamoGeneralRealtimeIndexQuery>,
    ): PostQueryList {
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

class PostQueryListVirtualizedTree extends PostListVirtualizedTreeBase<DynamoIndexCursor> {
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
        super({nodeByOrderKey, itemCountSubtreeCache});
        this.query = query;
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

    protected _getNodeOrderKeyByKeyIfExists(postId: PostId): DynamoIndexCursor | null {
        const key = createDynamoItemKeyFromPostId(postId);
        return this.query.getCursorByKeyIfExists(key);
    }

    /**
     * Update the backing DynamoDB realtime query of this post list.
     */
    public updateQuery(
        query: SetStateAction<
            DynamoGeneralRealtimeIndexQuery<
                PostModel,
                {
                    readonly postComments: MessageList<PostCommentModel>;
                    readonly postCommentsState: PostCommentsState;
                }
            >
        >,
    ) {
        query = typeof query === "function" ? query(this.query) : query;

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

        const newQuery = this.query.updateItemExtraByKeyIfExists(key, item => {
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

        const newQuery = this.query.updateItemExtraByKeyIfExists(key, item => {
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
