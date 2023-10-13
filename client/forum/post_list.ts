import {MessageList} from "~/client/messaging/message_list.js";
import {VirtualizedTree} from "~/client/virtualized/virtualized_tree.js";
import {
    FailedPreconditionError,
    InternalError,
    InvalidArgumentError,
    NotFoundError,
    OutOfRangeError,
} from "~/shared/error/error.js";
import {ChannelModel} from "~/shared/forum/channel_model.js";
import {PostCommentModel, PostModel} from "~/shared/forum/post_model.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {ImmutableMap} from "~/shared/helpers/immutable/immutable_map.js";
import {PostId, WebSocketConnectionId} from "~/shared/id/types/id_types.js";
import {OptimisticMessageModel} from "~/shared/messaging/message_model.js";
import {MessagingTypingState} from "~/shared/messaging/messaging_realtime_protocol.js";

export type PostListChannelHeader = {
    readonly channel: ChannelModel;
};

export type PostCommentsState = PostCommentsOpenState | "Closed";
type PostCommentsOpenState = "Open" | "AlwaysOpen";

/**
 * An immutable representation of a list of posts to be rendered by our
 * `<PostListView>` component. Our `<PostListView>` component virtualizes our
 * list of posts since we may have too many to render on screen at once. Posts
 * may also expand their comments inline so if comments are expanded then we
 * also need to virtualize those!
 *
 * Keeping track of which posts are open/closed and how that affects comment
 * indexing is a little complex. This class manages that complexity.
 */
export class PostList {
    private readonly _channelHeader: PostListChannelHeader | null;
    private readonly _hasMorePosts: boolean;

    // NOTE(calebmer): The API of this class predates the introduction of
    // `VirtualizedTree`. There are probably methods we could clean up to
    // simplify things.
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
        channelHeader,
        hasMorePosts,
        posts,
    }: {
        channelHeader: PostListChannelHeader | null;
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
        this._channelHeader = channelHeader;
        this._hasMorePosts = hasMorePosts;
        this._posts = posts;
    }

    /**
     * An empty post list.
     */
    public static empty = new PostList({
        channelHeader: null,
        hasMorePosts: false,
        posts: VirtualizedTree.new({
            getNodeKey: ({post}) => post.id,
            getNodeItemCount: ({postComments, postCommentsState}) =>
                1 + (postCommentsState !== "Closed" ? postComments.getItemCount() + 1 : 0),
            getNodeItem: ({post, postComments, postCommentsState}, index, postContentItemIndex) => {
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
                    const postCommentInputItemIndex =
                        postContentItemIndex + postComments.getItemCount() + 1;

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
            },
        }),
    });

    /**
     * Get the total number of items in the list.
     */
    public getItemCount() {
        return (
            this._posts.getItemCount() +
            (this._channelHeader ? 1 : 0) +
            (this._hasMorePosts ? 1 : 0)
        );
    }

    /**
     * Get the number of posts in this list.
     */
    public getPostCount() {
        return this._posts.getNodeCount();
    }

    /**
     * Get a post by its `PostId`.
     */
    public getPostById(postId: PostId): {
        post: PostModel;
        postComments: MessageList<PostCommentModel>;
        postContentItemIndex: number;
        /**
         * Get the index of the post comment in our list. If comments are not open on
         * this post or if the comment index is out of bounds this will throw an error.
         */
        getPostCommentIndex: (postCommentIndex: number) => number;
    } {
        const nodeResult = this._posts.getNodeByKeyIfExists(postId);
        if (!nodeResult) throw new InternalError("Post not found");
        const {node, startItemIndex} = nodeResult;

        const postContentItemIndex = startItemIndex + (this._channelHeader ? 1 : 0);

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
     * Get the post content item for the provided index. If this index is pointing
     * at a comment then we will return the item for the post the comment is a part
     * of. Will return null if the index is out of bounds. Every index in this
     * list is associated to a post.
     */
    public getPostContentItemIfExists(index: number): PostListPostContentItem | null {
        const nodeResult = this._posts.getNodeByItemIndexIfExists(
            index - (this._channelHeader ? 1 : 0),
        );
        if (!nodeResult) return null;
        const {node, startItemIndex} = nodeResult;

        const postContentItemIndex = startItemIndex + (this._channelHeader ? 1 : 0);

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
     * Get the last post content item in the list. Null if there are no posts in
     * the list.
     */
    public getLastPostContentItemIfExists(): PostListPostContentItem | null {
        const index = this.getItemCount() - 1 - (this._hasMorePosts ? 1 : 0);
        if (index < 0) return null;
        return this.getPostContentItemIfExists(index);
    }

    /**
     * Get the item at the provided index. Throws if the index is out
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

        const item = this._posts.getItem(index - (this._channelHeader ? 1 : 0));
        if (!item) return item;

        // Adjust any item indexes to consider items that come before posts in
        // our `PostList`.
        switch (item.type) {
            case "PostContent": {
                return {
                    ...item,
                    postContentItemIndex: item.postContentItemIndex + (this._channelHeader ? 1 : 0),
                    postCommentInputItemIndex:
                        item.postCommentInputItemIndex !== null
                            ? item.postCommentInputItemIndex + (this._channelHeader ? 1 : 0)
                            : null,
                };
            }
            case "LoadedPostComment":
            case "UnloadedPostComment":
            case "OptimisticPostComment":
            case "PostCommentsTypingIndicator": {
                return {
                    ...item,
                    postCommentInputItemIndex:
                        item.postCommentInputItemIndex + (this._channelHeader ? 1 : 0),
                };
            }
            case "PostCommentInput": {
                return {
                    ...item,
                    postContentItemIndex: item.postContentItemIndex + (this._channelHeader ? 1 : 0),
                };
            }
            default:
                throw exhaustive(item);
        }
    }

    /**
     * Set the channel header item at the beginning of the post list.
     */
    public setChannelHeader(channelHeader: PostListChannelHeader | null): PostList {
        // Optimization: Don't update the post list if this property hasn't changed.
        if (channelHeader === this._channelHeader) return this;

        return new PostList({
            channelHeader,
            hasMorePosts: this._hasMorePosts,
            posts: this._posts,
        });
    }

    /**
     * Set that the post list should have a loading spinner once you reach the end.
     */
    public setHasMorePosts(hasMorePosts: boolean): PostList {
        // Optimization: Don't update the post list if this property hasn't changed.
        if (hasMorePosts === this._hasMorePosts) return this;

        return new PostList({
            channelHeader: this._channelHeader,
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
    ): PostList {
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

        return new PostList({
            channelHeader: this._channelHeader,
            hasMorePosts: this._hasMorePosts,
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
    ): PostList {
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

        return new PostList({
            channelHeader: this._channelHeader,
            hasMorePosts: this._hasMorePosts,
            posts,
        });
    }

    /**
     * Insert many posts into the start of the list. All of them will have their
     * comments closed.
     */
    public insertManyPostsAtStart(posts: ReadonlyArray<PostModel>) {
        return new PostList({
            channelHeader: this._channelHeader,
            hasMorePosts: this._hasMorePosts,
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
        return new PostList({
            channelHeader: this._channelHeader,
            hasMorePosts: this._hasMorePosts,
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
    public togglePostComments(postId: PostId): PostList {
        return new PostList({
            channelHeader: this._channelHeader,
            hasMorePosts: this._hasMorePosts,
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
    public updatePost(postId: PostId, update: (post: PostModel) => PostModel): PostList {
        const newPosts = this._posts.updateNode(postId, node => {
            const newPost = update(node.post);
            if (newPost === node.post) return node;
            return {...node, post: newPost};
        });

        if (newPosts === this._posts) return this;

        return new PostList({
            channelHeader: this._channelHeader,
            hasMorePosts: this._hasMorePosts,
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
    ): PostList {
        const newPosts = this._posts.updateNode(postId, node => {
            const newPostComments = update(node.postComments);
            if (newPostComments === node.postComments) return node;
            return {...node, postComments: newPostComments};
        });

        if (newPosts === this._posts) return this;

        return new PostList({
            channelHeader: this._channelHeader,
            hasMorePosts: this._hasMorePosts,
            posts: newPosts,
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
