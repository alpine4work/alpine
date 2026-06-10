import createTree, {Tree, Node as TreeNode} from "functional-red-black-tree";
import {SetStateAction} from "react";
import {RynamoIndexQuery} from "~/client/web/dynamo/rynamo_index_query.js";
import {RynamoQuery} from "~/client/web/dynamo/rynamo_query.js";
import {MessageList} from "~/client/web/messaging/message_list.js";
import {VirtualizedTreeBase} from "~/client/web/virtualized/helpers/virtualized_tree.js";
import {AccessLevel} from "~/shared/access/access_policy.js";
import {ShareNotification} from "~/shared/access/share_notification.js";
import {MessageContent} from "~/shared/content/message_content_schema.js";
import {DynamoIndexCursor} from "~/shared/dynamo/dynamo_opaque_strings.js";
import {RynamoEvent, RynamoIndexQueryResult, RynamoItem} from "~/shared/dynamo/rynamo_types.js";
import {
    FailedPreconditionError,
    InvalidArgumentError,
    NotFoundError,
    OutOfRangeError,
} from "~/shared/error/error.js";
import {FeedEntryModel, FeedPostEntryModel} from "~/shared/feed/feed_entry_model.js";
import {ChannelModel, ChannelOrMetadataModel} from "~/shared/forum/channel_model.js";
import {createPostDynamoItemKey} from "~/shared/forum/create_post_dynamo_item_key.js";
import {PostCommentModel, PostModel} from "~/shared/forum/post_model.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {cast} from "~/shared/helpers/control/cast.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {ImmutableMap} from "~/shared/helpers/immutable/immutable_map.js";
import {mapIterable} from "~/shared/helpers/iterable/map_iterable.js";
import {DefaultWeakMap} from "~/shared/helpers/map/default_weak_map.js";
import {AccountId, ChannelId, PostId, WebSocketConnectionId} from "~/shared/id/types/id_types.js";
import {OptimisticMessageModel} from "~/shared/messaging/message_model.js";
import {MessagingTypingState} from "~/shared/messaging/messaging_realtime_protocol.js";
import {RpcDefinitionOutputType} from "~/shared/rpc/rpc_definition.js";
import {searchByAffinity} from "~/shared/rpc/search_rpc_definitions.js";
import {ServerSynchronizationCheckpoint} from "~/shared/web_socket/server_synchronization_checkpoint.js";

// All this post list code is the result of incremental evolution over time which
// means it's not as clean as it could be. It's gone through a couple refactors
// without fundamentally rethinking the structure. A brief history:
//
// 1. [2023-01-26] `PostList` was created.
//
// 2. [2023-03-31] `VirtualizedTree` was created by refactoring the relevant code
//    out of `PostList` so it could be used in other places.
//
// 3. [2024-04-15] `PostList` was split into `PostBasicList` and `PostQueryList` so
//    we could power a `<PostListView>` with a DynamoDB general realtime query.
//
// 4. [2025-05-20] `PostFeedList` was added (in `post_feed_list.ts`) since now we
//    want to render a `<PostListView>` with both posts and non-posts.

export type PostListHeader =
    | {
          readonly type: "NavigationBar";
          readonly shouldNotShowChannelId?: ChannelId;
      }
    | {
          readonly type: "Channel";
          readonly channel: ChannelModel;
          readonly channelAndMetadataQuery: RynamoQuery<ChannelOrMetadataModel> | null;
          readonly initialIsSubscribed: boolean;
          readonly isEditingDescription: boolean;
          readonly onCancelDescriptionEditing: () => void;
          readonly onSaveDescription: (description: MessageContent) => Promise<void>;
          readonly onAddAccountGrantsToAccessPolicy: (event: {
              accountGrantById: ReadonlyMap<AccountId, {level: AccessLevel}>;
              notification: ShareNotification | null;
          }) => Promise<void>;
      }
    | {
          readonly type: "FeedCreateSection";
          readonly initialAffinitySearch: RpcDefinitionOutputType<typeof searchByAffinity>;
      };

export type PostListFooter = {
    readonly type: "MarginBottom";
};

export type PostCommentsState = PostCommentsOpenState | "Closed";
type PostCommentsOpenState = "Open" | "AlwaysOpen";

/**
 * The immutable interface for the backing state of a `<PostListView>`. We have
 * different implementations depending on the backing data. For example, when
 * viewing a channel, posts are backed by a `RynamoIndexQuery`. Whereas a channel
 * post notification is backed by a static list of `PostId`s.
 *
 * Our `<PostListView>` component virtualizes our list of posts since we may have
 * too many to render on screen at once. Posts may also expand their comments
 * inline so if comments are expanded then we also need to virtualize those!
 *
 * Keeping track of which posts are open/closed and how that affects comment
 * indexing is a little complex. This class manages that complexity.
 */
export interface PostListInterface {
    /**
     * Is the post list exactly one post and that post's comments?
     *
     * If this is true then `getPostContentItemIfExists(0)` must be non-null.
     *
     * May return false even if there's only one post and the post's comments because
     * we don't want special single post treatment.
     */
    isSinglePost(): boolean;

    /**
     * Get the total number of items in the list.
     */
    getItemCount(): number;

    /**
     * Get the item at the provided index. Throws if the index is out of bounds.
     */
    getItem(index: number): PostListItem;

    /**
     * Get the post content item for the provided index. If this index is pointing at a
     * comment then we will return the item for the post the comment is a part of. Will
     * return null if the index is out of bounds or if the item is not associated with
     * a post (e.g. channel header or feed entry).
     */
    getPostContentItemIfExists(index: number): PostListPostContentItem | null;

    /**
     * Get a post by its `PostId`.
     */
    getPostByIdIfExists(postId: string): {
        post: PostModel;
        postCommentsState: PostCommentsState;
        postComments: MessageList<PostCommentModel>;
        postContentItemIndex: number;
        /**
         * Get the index of the post comment in our list. If comments are not open on this
         * post or if the comment index is out of bounds this will throw an error.
         */
        getPostCommentIndex: (postCommentIndex: number) => number;
    } | null;

    /**
     * Are there more posts we can load from this post list?
     */
    hasMorePosts(): boolean;

    /**
     * Does the post list have any posts with open comments? Used by mobile since in a
     * list of posts, no post should have open comments.
     */
    hasOpenPostComments(): boolean;
}

export type PostListItemExtra = {
    readonly postComments: MessageList<PostCommentModel>;
    readonly postCommentsState: PostCommentsState;
};

/**
 * Adds a header item to the beginning of a post list.
 */
export class PostListWithHeaderOrWithFooter implements PostListInterface {
    private readonly _header: PostListHeader | null;
    private readonly _footer: PostListFooter | null;
    private readonly _posts: PostListInterface;
    private readonly _postsItemCount: number;

    constructor(
        header: PostListHeader | null,
        footer: PostListFooter | null,
        posts: PostListInterface,
    ) {
        this._header = header;
        this._footer = footer;
        this._posts = posts;
        this._postsItemCount = posts.getItemCount();
    }

    // After adding a header, the post list is not a single post anymore.
    public isSinglePost(): boolean {
        return false;
    }

    public getItemCount(): number {
        return (
            this._postsItemCount +
            (this._header !== null ? 1 : 0) +
            (this._footer !== null && !this._posts.hasMorePosts() ? 1 : 0)
        );
    }

    public getItem(index: number): PostListItem {
        let offset = 0;

        if (this._header !== null) {
            if (index === 0) {
                return {
                    type: "Header",
                    header: this._header,
                };
            }

            index -= 1;
            offset += 1;
        }

        if (index < this._postsItemCount) {
            const item = this._posts.getItem(index);

            // Adjust any item indexes to consider items that come before posts in our
            // `PostList`.
            switch (item.type) {
                case "Header":
                case "Footer":
                case "MoreUnloadedPosts":
                case "FeedEntry": {
                    return item;
                }
                case "PostContent": {
                    return {
                        ...item,
                        postContentItemIndex: item.postContentItemIndex + offset,
                        postCommentInputItemIndex:
                            item.postCommentInputItemIndex !== null
                                ? item.postCommentInputItemIndex + offset
                                : null,
                    };
                }
                case "LoadedPostComment":
                case "UnloadedPostComment":
                case "OptimisticPostComment":
                case "PostCommentsTypingIndicator": {
                    return {
                        ...item,
                        postCommentInputItemIndex: item.postCommentInputItemIndex + offset,
                    };
                }
                case "PostCommentInput": {
                    return {
                        ...item,
                        postContentItemIndex: item.postContentItemIndex + offset,
                    };
                }
                default:
                    throw exhaustive(item);
            }
        }

        index -= this._postsItemCount;

        if (this._footer !== null && !this._posts.hasMorePosts()) {
            if (index === 0) {
                return {
                    type: "Footer",
                    footer: this._footer,
                };
            }
            index--;
        }

        throw new OutOfRangeError("Index out of bounds");
    }

    public getPostContentItemIfExists(index: number): PostListPostContentItem | null {
        let offset = 0;

        if (this._header !== null) {
            if (index === 0) return null;
            index--;
            offset++;
        }

        if (index >= this._postsItemCount) return null;

        const item = this._posts.getPostContentItemIfExists(index);
        if (!item) return null;

        return {
            ...item,
            postContentItemIndex: item.postContentItemIndex + offset,
            postCommentInputItemIndex:
                item.postCommentInputItemIndex !== null
                    ? item.postCommentInputItemIndex + offset
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
        const postResult = this._posts.getPostByIdIfExists(postId);
        if (!postResult) return null;

        const {post, postCommentsState, postComments, postContentItemIndex, getPostCommentIndex} =
            postResult;

        const offset = this._header !== null ? 1 : 0;

        return {
            post,
            postCommentsState,
            postComments,
            postContentItemIndex: postContentItemIndex + offset,
            getPostCommentIndex: postCommentIndex => getPostCommentIndex(postCommentIndex) + offset,
        };
    }

    public hasMorePosts() {
        return this._posts.hasMorePosts();
    }

    public hasOpenPostComments(): boolean {
        return this._posts.hasOpenPostComments();
    }
}

/**
 * The base of a post list where posts are held in a `PostListVirtualizedTreeBase`
 * subclass. The main contribution of this class is providing a public interface
 * that doesn't include `VirtualizedTree` methods and returning a
 * `MoreUnloadedPosts` item if data is still loading.
 */
abstract class PostListBase<NodeOrderKey> implements PostListInterface {
    protected abstract readonly _posts: PostListVirtualizedTreeBase<NodeOrderKey>;

    public isSinglePost(): boolean {
        return this._posts.getNodeCount() === 1;
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
        postCommentsState: PostCommentsState;
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
        postCommentsState: PostCommentsState;
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
            postCommentsState: node.postCommentsState,
            postComments: node.postComments,
            postContentItemIndex,
            getPostCommentIndex,
        };
    }

    public getPostRealtimeItemIfExists(postId: PostId): RynamoItem<PostModel> | null {
        return this._posts.getPostRealtimeItemIfExists(postId);
    }

    public abstract hasMorePosts(): boolean;

    public getPostCount(): number {
        return this._posts.getNodeCount();
    }

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

    public hasOpenPostComments(): boolean {
        // If all posts are closed then there will only be one item for each node.
        return this._posts.getItemCount() > this._posts.getNodeCount();
    }
}

abstract class PostListVirtualizedTreeBase<NodeOrderKey> extends VirtualizedTreeBase<
    NodeOrderKey,
    RynamoItem<PostModel> & {
        readonly extra: PostListItemExtra | null;
    },
    Exclude<
        PostListItem,
        PostListHeaderItem | PostListMoreUnloadedPostsItem | PostListFeedEntryItem
    >
> {
    protected override _getNodeItemCount(
        node: RynamoItem<PostModel> & {
            readonly extra: PostListItemExtra | null;
        },
    ): number {
        const {postCommentsState, postComments} = getPostListItemExtra(node);
        return 1 + (postCommentsState !== "Closed" ? postComments.getItemCount() + 1 : 0);
    }

    protected override _getNodeItem(
        node: RynamoItem<PostModel> & {
            readonly extra: PostListItemExtra | null;
        },
        index: number,
        postContentItemIndex: number,
    ): Exclude<
        PostListItem,
        PostListHeaderItem | PostListMoreUnloadedPostsItem | PostListFeedEntryItem
    > {
        return getPostListVirtualizedTreeNodeItem(node, index, postContentItemIndex);
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

        const {postCommentsState, postComments} = getPostListItemExtra(node);

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

        const {postCommentsState, postComments} = getPostListItemExtra(node);

        return {
            node: {
                post: node.model,
                postComments,
                postCommentsState,
            },
            startItemIndex,
        };
    }

    public getPostRealtimeItemIfExists(postId: PostId): RynamoItem<PostModel> | null {
        const nodeKey = this._getNodeOrderKeyByKeyIfExists(postId);
        if (nodeKey === null) return null;

        const iterator = this._nodeByOrderKey.find(nodeKey);
        assert(iterator.valid);
        const node = iterator.value!;

        return node;
    }
}

export function getPostListVirtualizedTreeNodeItem(
    node: RynamoItem<PostModel> & {
        readonly extra: PostListItemExtra | null;
    },
    index: number,
    postContentItemIndex: number,
): Exclude<
    PostListItem,
    PostListHeaderItem | PostListMoreUnloadedPostsItem | PostListFeedEntryItem
> {
    const {postCommentsState, postComments} = getPostListItemExtra(node);

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
        const postCommentInputItemIndex = postContentItemIndex + postComments.getItemCount() + 1;

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

/**
 * A basic post list you can initialize with whatever posts you want wherever you
 * want. The class automatically maintains a simple backing list. Unlike the
 * realtime query post list which is backed, specifically, by the DynamoDB general
 * realtime query data structure.
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
                  posts: ReadonlyArray<RynamoItem<PostModel>>;
              }
            | {
                  type: "One";
                  checkpoint: ServerSynchronizationCheckpoint;
                  post: RynamoItem<PostModel>;
                  postCommentsState?: PostCommentsState;
                  postComments?: {
                      comments: ReadonlyArray<PostCommentModel>;
                      otherReferencedComments: ReadonlyArray<PostCommentModel>;
                  };
              },
    ) {
        let hasMorePosts: boolean;
        let posts: PostBasicListVirtualizedTree;

        switch (result.type) {
            case "Many": {
                hasMorePosts = result.hasMorePosts;
                posts = PostBasicListVirtualizedTree.new(
                    result.posts.map(post => ({...post, extra: null})),
                );
                break;
            }
            case "One": {
                hasMorePosts = false;
                posts = PostBasicListVirtualizedTree.new([
                    {
                        ...result.post,
                        extra: {
                            postCommentsState: result.postCommentsState ?? "Closed",
                            postComments: !result.postComments
                                ? MessageList.new<PostCommentModel>({
                                      checkpoint: result.checkpoint,
                                      messageCount: result.post.model.commentCount,
                                  })
                                : MessageList.new<PostCommentModel>({
                                      checkpoint: result.checkpoint,
                                      messageCount: result.post.model.commentCount,
                                  }).loadMessages({
                                      messageCount: result.post.model.commentCount,
                                      messages: result.postComments.comments,
                                      otherReferencedMessages:
                                          result.postComments.otherReferencedComments,
                                  }),
                        },
                    },
                ]);
                break;
            }
            default:
                throw exhaustive(result);
        }

        return new PostBasicList({hasMorePosts, posts});
    }

    public override hasMorePosts(): boolean {
        return this._hasMorePosts;
    }

    public getLastPostIdIfExists(): PostId | null {
        return this._posts.getLastNodeIfExists()?.model.id ?? null;
    }

    public iteratePostIds(): Iterable<PostId> {
        return mapIterable(this._posts.iterateNodes(), node => node.model.id);
    }

    public loadMorePosts({
        hasMorePosts,
        posts,
    }: {
        hasMorePosts: boolean;
        posts: ReadonlyArray<RynamoItem<PostModel>>;
    }) {
        const newPosts = this._posts.addPosts(posts.map(post => ({...post, extra: null})));

        if (newPosts === this._posts && hasMorePosts === this._hasMorePosts) {
            return this;
        }

        return new PostBasicList({
            hasMorePosts,
            posts: newPosts,
        });
    }

    public handleEvents(events: ReadonlyArray<RynamoEvent<unknown>>) {
        const newPosts = this._posts.handleEvents(events);

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

    public closeAllPostComments(): PostBasicList {
        const newPosts = this._posts.closeAllPostComments();

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
        postVisibilityById,
        nodeByOrderKey,
        itemCountSubtreeCache,
    }: {
        postVisibilityById: ImmutableMap<
            PostId,
            {isVisible: true; index: number} | {isVisible: false; item: RynamoItem<PostModel>}
        >;
        nodeByOrderKey: Tree<
            number,
            RynamoItem<PostModel> & {
                readonly extra: PostListItemExtra | null;
            }
        >;
        itemCountSubtreeCache: WeakMap<
            TreeNode<
                number,
                RynamoItem<PostModel> & {
                    readonly extra: PostListItemExtra | null;
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
            RynamoItem<PostModel> & {
                readonly extra: PostListItemExtra | null;
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
     * Add posts to the end of the virtualized tree. Only one post may exist for each
     * `PostId`.
     */
    public addPosts(
        posts: ReadonlyArray<
            RynamoItem<PostModel> & {
                readonly extra: PostListItemExtra | null;
            }
        >,
    ): PostBasicListVirtualizedTree {
        let postVisibilityById = this._postVisibilityById;
        let nodeByOrderKey = this._nodeByOrderKey;

        for (const post of posts) {
            let oldPostVisibility:
                | {isVisible: true; index: number}
                | {isVisible: false; item: RynamoItem<PostModel>}
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
                    // If the currently visible item has a higher version then don't update with the
                    // newly loaded post.
                    iterator.value.version > post.version
                        ? nodeByOrderKey
                        : iterator.update({...post, extra: iterator.value.extra});
            }
        }

        return new PostBasicListVirtualizedTree({
            postVisibilityById,
            nodeByOrderKey,
            itemCountSubtreeCache: this._itemCountSubtreeCache,
        });
    }

    /**
     * Handle a realtime update event transaction from our DynamoDB general realtime
     * system. Will update any visible posts and keep a record of any other posts
     * realtime tells us about. So if later that post is added (via `addPosts()`) but
     * with a stale version then we'll actually have the latest version.
     */
    public handleEvents(events: ReadonlyArray<RynamoEvent<unknown>>): PostBasicListVirtualizedTree {
        let postVisibilityById = this._postVisibilityById;
        let nodeByOrderKey = this._nodeByOrderKey;

        for (const event of events) {
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

        const {postCommentsState, postComments} = getPostListItemExtra(iterator.value);

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
     * Update the comments list for a post. If the post id is not in the list this is a
     * noop.
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

        const {postCommentsState, postComments} = getPostListItemExtra(iterator.value);

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

    /**
     * Iterate through every post in our list updating each `PostCommentsState` to
     * `Closed`.
     */
    public closeAllPostComments(): PostBasicListVirtualizedTree {
        let nodeByOrderKey = this._nodeByOrderKey;

        let iterator = nodeByOrderKey.begin;
        while (iterator.node) {
            const node = iterator.node;

            if (!node.value.extra || node.value.extra.postCommentsState === "Closed") {
                iterator.next();
                continue;
            }

            nodeByOrderKey = iterator.update({
                ...node.value,
                extra: {
                    postCommentsState: "Closed",
                    postComments: node.value.extra.postComments,
                },
            });
            iterator = nodeByOrderKey.find(node.key);
            iterator.next();
        }

        return new PostBasicListVirtualizedTree({
            postVisibilityById: this._postVisibilityById,
            nodeByOrderKey,
            itemCountSubtreeCache: this._itemCountSubtreeCache,
        });
    }
}

export type PostQueryListRynamoIndexQuery = RynamoIndexQuery<PostModel, PostListItemExtra>;

/**
 * Post list backed by a DynamoDB general realtime query. The query is presented in
 * reverse order since it should be loaded from the end. Since the end is where the
 * latest channel posts are.
 */
export class PostQueryList extends PostListBase<DynamoIndexCursor> {
    public readonly query: PostQueryListRynamoIndexQuery;
    protected readonly _posts: PostQueryListVirtualizedTree;

    private constructor(posts: PostQueryListVirtualizedTree) {
        super();
        this.query = posts.query;
        this._posts = posts;
    }

    public static new(result: RynamoIndexQueryResult<PostModel>): PostQueryList {
        const posts = PostQueryListVirtualizedTree.new(result);
        return new PostQueryList(posts);
    }

    public override hasMorePosts(): boolean {
        return this.query.hasLoadingIndicatorAtStart();
    }

    public updateQuery(
        query: SetStateAction<RynamoIndexQuery<PostModel, PostListItemExtra>>,
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

    public closeAllPostComments(): PostQueryList {
        const newPosts = this._posts.closeAllPostComments();
        if (newPosts === this._posts) return this;
        return new PostQueryList(newPosts);
    }
}

class PostQueryListVirtualizedTree extends PostListVirtualizedTreeBase<DynamoIndexCursor> {
    /**
     * The backing realtime DynamoDB query for this `PostList`.
     */
    public readonly query: RynamoIndexQuery<PostModel, PostListItemExtra>;

    // Iterate through `nodeByOrderKey` in reverse order. The most recent posts are at
    // the end of the query but we want to display them at the top of our channel.
    protected override readonly _isNodeByOrderKeyReversed = true;

    private constructor({
        query,
        nodeByOrderKey,
        itemCountSubtreeCache,
    }: {
        query: RynamoIndexQuery<PostModel, PostListItemExtra>;
        nodeByOrderKey: Tree<
            DynamoIndexCursor,
            RynamoItem<PostModel> & {
                readonly extra: PostListItemExtra | null;
            }
        >;
        itemCountSubtreeCache: WeakMap<
            TreeNode<
                DynamoIndexCursor,
                RynamoItem<PostModel> & {
                    readonly extra: PostListItemExtra | null;
                }
            >,
            number
        >;
    }) {
        super({nodeByOrderKey, itemCountSubtreeCache});
        this.query = query;
    }

    public static new(result: RynamoIndexQueryResult<PostModel>) {
        const query = RynamoIndexQuery.new<PostModel, PostListItemExtra>(result);

        return new PostQueryListVirtualizedTree({
            query,
            nodeByOrderKey: query.getLoadedItemByCursor(),
            itemCountSubtreeCache: new WeakMap(),
        });
    }

    protected _getNodeOrderKeyByKeyIfExists(postId: PostId): DynamoIndexCursor | null {
        const key = createPostDynamoItemKey(postId);
        return this.query.getCursorByKeyIfExists(key);
    }

    /**
     * Update the backing DynamoDB realtime query of this post list.
     */
    public updateQuery(query: SetStateAction<RynamoIndexQuery<PostModel, PostListItemExtra>>) {
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
        const key = createPostDynamoItemKey(postId);

        const newQuery = this.query.updateItemExtraByKeyIfExists(key, item => {
            const {postCommentsState, postComments} = getPostListItemExtra(item);

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
     * Update the comments list for a post. If the post id is not in the list this is a
     * noop.
     */
    public updatePostComments(
        postId: PostId,
        update: (comments: MessageList<PostCommentModel>) => MessageList<PostCommentModel>,
    ): PostQueryListVirtualizedTree {
        const key = createPostDynamoItemKey(postId);

        const newQuery = this.query.updateItemExtraByKeyIfExists(key, item => {
            const {postCommentsState, postComments} = getPostListItemExtra(item);

            const newPostComments = update(postComments);
            if (newPostComments === postComments) return item.extra;

            return {
                postCommentsState,
                postComments: newPostComments,
            };
        });

        return this.updateQuery(newQuery);
    }

    /**
     * Iterate through every post in our list updating each `PostCommentsState` to
     * `Closed`.
     */
    public closeAllPostComments(): PostQueryListVirtualizedTree {
        const newQuery = this.query.updateAllItemExtras(item => {
            if (item.extra === null || item.extra.postCommentsState === "Closed") {
                return item.extra;
            }
            return {
                postCommentsState: "Closed",
                postComments: item.extra.postComments,
            };
        });

        return this.updateQuery(newQuery);
    }
}

const initialPostModelCommentsCache = new DefaultWeakMap(createInitialPostModelComments);

function createInitialPostModelComments(post: PostModel): MessageList<PostCommentModel> {
    return MessageList.new({
        checkpoint: null,
        messageCount: post.commentCount,
    });
}

export function getPostListItemExtra(
    post: RynamoItem<PostModel> & {
        readonly extra: PostListItemExtra | null;
    },
) {
    return (
        post.extra ?? {
            postCommentsState: "Closed",
            postComments: initialPostModelCommentsCache.getOrSetDefault(post.model),
        }
    );
}

/**
 * An individual item in a paginated post list.
 */
export type PostListItem =
    | PostListHeaderItem
    | PostListFooterItem
    | PostListPostContentItem
    | PostListLoadedPostCommentItem
    | PostListUnloadedPostCommentItem
    | PostListOptimisticPostCommentItem
    | PostListPostCommentsTypingIndicator
    | PostListPostCommentInputItem
    | PostListMoreUnloadedPostsItem
    | PostListFeedEntryItem;

export type PostListHeaderItem = {
    readonly type: "Header";
    readonly header: PostListHeader;
};

export type PostListFooterItem = {
    readonly type: "Footer";
    readonly footer: PostListFooter;
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
     * If the comment section is open, this will be the index of the post comment input
     * in the full `PostList`.
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
     * The index the loaded post comment is at in the `MessageList`. The post index may
     * move but this will stay stable.
     */
    readonly postCommentIndex: number;
    readonly postComment: PostCommentModel;

    /**
     * If the comment section is open, this will be the index of the post comment input
     * in the full `PostList`.
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
     * The index the unloaded post comment is at in the `MessageList`. The post index
     * may move but this will stay stable.
     */
    readonly postCommentIndex: number;

    /**
     * If the comment section is open, this will be the index of the post comment input
     * in the full `PostList`.
     */
    readonly postCommentInputItemIndex: number;
};

/**
 * A comment created on the client before it has been acknowledged by the server.
 */
export type PostListOptimisticPostCommentItem = {
    readonly type: "OptimisticPostComment";
    readonly post: PostModel;
    readonly postComments: MessageList<PostCommentModel>;

    /**
     * The index the loaded post comment is at in the `MessageList`. The post index may
     * move but this will stay stable.
     */
    readonly postCommentIndex: number;
    readonly postComment: OptimisticMessageModel;

    /**
     * If the comment section is open, this will be the index of the post comment input
     * in the full `PostList`.
     */
    readonly postCommentInputItemIndex: number;

    /**
     * What is the index of this optimistic post comment in the optimistic post comment
     * list?
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
     * If the comment section is open, this will be the index of the post comment input
     * in the full `PostList`.
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

/**
 * We use `<PostListView>` to render the home feed. In addition to posts we have
 * some other non-post feed entries. Non-post feed entries are expressed by this
 * item.
 */
export type PostListFeedEntryItem = {
    readonly type: "FeedEntry";
    readonly entry: Exclude<FeedEntryModel, FeedPostEntryModel>;
};
