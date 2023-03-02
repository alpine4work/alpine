import {ProcessContext} from "~/server/dynamo/context/process_context";
import {RequestContext} from "~/server/dynamo/context/request_context";
import {
    createPostComment,
    deletePostComment,
    getPostCommentsFromStart,
    updatePostCommentContent,
} from "~/server/dynamo/forum_table";
import {getContentReferencesFromNode} from "~/server/dynamo/helpers/get_content_references";
import {TestCheckpoint} from "~/server/helpers/test/test_checkpoint";
import {AsyncSequentialQueue} from "~/shared/helpers/async/async_sequential_queue";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises";
import {assert} from "~/shared/helpers/control/assert";
import {exhaustive} from "~/shared/helpers/control/exhaustive";
import {PostId, SessionId, SpaceId} from "~/shared/id/types/id_types";
import {PostCommentModel} from "~/shared/models/post_model";
import {
    PostRealtimeMessageFromClient,
    PostRealtimeMessageFromServer,
} from "~/shared/posts/post_realtime_schema";

export const postRealtimeBackfillCommentsBeforeFlushTestCheckpoint =
    new TestCheckpoint<SessionId>();

export const postRealtimeCreateCommentBeforeSendTestCheckpoint = new TestCheckpoint<SessionId>();

export class PostRealtimeDurableObjectConnection {
    private readonly _spaceId: SpaceId;
    private readonly _postId: PostId;
    private readonly _sendMessage: (
        context: ProcessContext,
        message: PostRealtimeMessageFromServer,
    ) => void;
    private readonly _sendMessageToAll: (
        context: ProcessContext,
        message: PostRealtimeMessageFromServer,
    ) => void;
    private readonly _iterateOtherConnections: () => Iterable<PostRealtimeDurableObjectConnection>;

    /**
     * The next comment index we will send to our client. We send comments to
     * clients in strict chronological order.
     */
    private _nextCommentIndexToSend: number | null = null;

    /**
     * Comments with indexes ahead of `_nextCommentIndexToSend` which we will
     * attempt to send after `_nextCommentIndexToSend` has been updated.
     */
    private _queuedComments: Array<PostCommentModel> = [];

    constructor({
        spaceId,
        postId,
        sendMessage,
        sendMessageToAll,
        iterateOtherConnections,
    }: {
        spaceId: SpaceId;
        postId: PostId;
        sendMessage: (context: ProcessContext, message: PostRealtimeMessageFromServer) => void;
        sendMessageToAll: (context: ProcessContext, message: PostRealtimeMessageFromServer) => void;
        iterateOtherConnections: () => Iterable<PostRealtimeDurableObjectConnection>;
    }) {
        this._spaceId = spaceId;
        this._postId = postId;
        this._sendMessage = sendMessage;
        this._sendMessageToAll = sendMessageToAll;
        this._iterateOtherConnections = iterateOtherConnections;
    }

    public sendNewComment(context: RequestContext, comment: PostCommentModel) {
        // If this is not the next comment for our client, either queue it for later or
        // ignore it if the comment is behind our client.
        if (comment.index !== this._nextCommentIndexToSend) {
            if (
                this._nextCommentIndexToSend === null ||
                comment.index > this._nextCommentIndexToSend
            ) {
                this._queuedComments.push(comment);
            }
            return;
        }

        this._sendMessage(context, {
            type: "NewPostComment",
            comment,
        });
        this._nextCommentIndexToSend = comment.index + 1;

        // Flush any queued comments now that our next comment index has moved forward.
        this._flushQueuedComments(context);
    }

    private _flushQueuedComments(context: RequestContext) {
        // If this is null we won't be sending any comments.
        if (this._nextCommentIndexToSend === null) return;

        while (true) {
            const oldQueuedCommentLength = this._queuedComments.length;

            this._queuedComments = this._queuedComments.filter(comment => {
                assert(this._nextCommentIndexToSend !== null);

                // This is the next comment for our client! Send it.
                if (comment.index === this._nextCommentIndexToSend) {
                    this._sendMessage(context, {
                        type: "NewPostComment",
                        comment,
                    });
                    this._nextCommentIndexToSend = comment.index + 1;
                    return false;
                }

                // If the comment is in the past, we will never flush it so throw it away.
                if (comment.index < this._nextCommentIndexToSend) {
                    return false;
                }

                return true;
            });

            // Exit the loop once we've processed all comments from our queue that can be
            // processed. We may have a queue that looks like this: `[3, 1, 2]`. In that
            // case 1 and 2 may be processed in the first iteration while 3 is processed in
            // the second iteration.
            if (oldQueuedCommentLength === this._queuedComments.length) break;
        }
    }

    private readonly _backfillSequentialQueue = new AsyncSequentialQueue();

    public async handleMessage(
        context: RequestContext,
        message: PostRealtimeMessageFromClient,
    ): Promise<void> {
        switch (message.type) {
            case "BackfillPostCommentsRequest": {
                // Execute our backfills sequentially so that our internal state is left in a
                // good state.
                await this._backfillSequentialQueue.run(async () => {
                    this._nextCommentIndexToSend = null;
                    this._queuedComments = [];

                    const {commentCount, comments, otherReferencedComments} =
                        await getPostCommentsFromStart(
                            // Use a strong read consistency here so our durable object doesn't miss a
                            // comment and stall (the connection queues new messages but never flushes
                            // because we missed an earlier comment).
                            context.dynamo.setDefaultReadConsistency("Strong"),
                            {
                                postId: this._postId,
                                afterCommentIndex: message.currentCommentCount - 1,
                                beforeCommentIndex: null,
                                limit: message.backfillCommentLimit,
                            },
                        );

                    await postRealtimeBackfillCommentsBeforeFlushTestCheckpoint.waitForTest(
                        context.auth.getSessionId(),
                    );

                    this._sendMessage(context, {
                        type: "BackfillPostCommentsResponse",
                        commentCount,
                        comments,
                        otherReferencedComments,
                    });

                    this._nextCommentIndexToSend = commentCount;
                    this._flushQueuedComments(context);
                });
                break;
            }
            case "CreatePostComment": {
                const [{index, createdTime}, author, contentReferences] = await runAllPromises([
                    createPostComment(context, {
                        ...message,
                        postId: this._postId,
                    }),
                    context.auth.getAccount(),
                    getContentReferencesFromNode(context, this._spaceId, message.content),
                ]);

                const comment = new PostCommentModel({
                    postId: this._postId,
                    index,
                    createdTime,
                    author,
                    payload: {
                        type: "Content",
                        parentMessageIndex: message.parentCommentIndex,
                        content: {
                            doc: message.content,
                            references: contentReferences,
                        },
                        contentUpdatedTime: null,
                    },
                });

                await postRealtimeCreateCommentBeforeSendTestCheckpoint.waitForTest(
                    context.auth.getSessionId(),
                );

                this.sendNewComment(context, comment);

                for (const connection of this._iterateOtherConnections())
                    connection.sendNewComment(context, comment);

                break;
            }
            case "UpdatePostCommentContent": {
                const [{contentUpdatedTime}, contentReferences] = await runAllPromises([
                    updatePostCommentContent(context, {
                        ...message,
                        postId: this._postId,
                    }),
                    getContentReferencesFromNode(context, this._spaceId, message.content),
                ]);

                this._sendMessageToAll(context, {
                    type: "UpdatedPostCommentContent",
                    commentIndex: message.commentIndex,
                    content: {
                        doc: message.content,
                        references: contentReferences,
                    },
                    contentUpdatedTime,
                });
                break;
            }
            case "DeletePostComment": {
                const {deletedTime} = await deletePostComment(context, {
                    ...message,
                    postId: this._postId,
                });

                this._sendMessageToAll(context, {
                    type: "DeletedPostComment",
                    commentIndex: message.commentIndex,
                    deletedTime,
                });
                break;
            }
            default:
                throw exhaustive(message);
        }
    }
}
