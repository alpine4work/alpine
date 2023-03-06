import {ProcessContext} from "~/server/dynamo/context/process_context";
import {RequestContext} from "~/server/dynamo/context/request_context";
import {
    backfillPostComments,
    createPostComment,
    deletePostComment,
    updatePostCommentContent,
} from "~/server/dynamo/forum_table";
import {getContentReferencesFromNode} from "~/server/dynamo/helpers/get_content_references";
import {TestCheckpoint} from "~/server/helpers/test/test_checkpoint";
import {AsyncSequentialQueue} from "~/shared/helpers/async/async_sequential_queue";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises";
import {assert} from "~/shared/helpers/control/assert";
import {exhaustive} from "~/shared/helpers/control/exhaustive";
import {PostId, SessionId, SpaceId} from "~/shared/id/types/id_types";
import {MessageChange, getMessageChangeTime} from "~/shared/messaging/message_change_schema";
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
    private readonly _iterateOtherConnections: () => Iterable<PostRealtimeDurableObjectConnection>;

    /**
     * True while we are backfilling post comments.
     */
    private _isBackfilling = true;

    /**
     * The next comment index we will send to our client. We send comments to
     * clients in strict chronological order.
     */
    private _nextCommentIndexToSend: number | null = null;

    /**
     * Comments with indexes ahead of `_nextCommentIndexToSend` which we will
     * attempt to send after `_nextCommentIndexToSend` has been updated.
     */
    private _queuedNewComments: Array<PostCommentModel> = [];

    /**
     * Comment changes that have been queued while we were backfilling. If we are
     * not backfilling this should always be an empty array.
     */
    private _queuedCommentChanges: Array<MessageChange> = [];

    constructor({
        spaceId,
        postId,
        sendMessage,
        iterateOtherConnections,
    }: {
        spaceId: SpaceId;
        postId: PostId;
        sendMessage: (context: ProcessContext, message: PostRealtimeMessageFromServer) => void;
        iterateOtherConnections: () => Iterable<PostRealtimeDurableObjectConnection>;
    }) {
        this._spaceId = spaceId;
        this._postId = postId;
        this._sendMessage = sendMessage;
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
                this._queuedNewComments.push(comment);
            }
            return;
        }

        this._sendMessage(context, {
            type: "NewPostComment",
            postComment: comment,
        });
        this._nextCommentIndexToSend = comment.index + 1;

        // Flush any queued comments now that our next comment index has moved forward.
        this._flushQueuedComments(context);
    }

    private _flushQueuedComments(context: RequestContext) {
        // If this is null we won't be sending any comments.
        if (this._nextCommentIndexToSend === null) return;

        while (true) {
            const oldQueuedCommentLength = this._queuedNewComments.length;

            this._queuedNewComments = this._queuedNewComments.filter(comment => {
                assert(this._nextCommentIndexToSend !== null);

                // This is the next comment for our client! Send it.
                if (comment.index === this._nextCommentIndexToSend) {
                    this._sendMessage(context, {
                        type: "NewPostComment",
                        postComment: comment,
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
            if (oldQueuedCommentLength === this._queuedNewComments.length) break;
        }
    }

    public sendCommentChange(context: RequestContext, commentChange: MessageChange) {
        // Wait until we are done backfilling to send any comment changes...
        if (this._isBackfilling) {
            this._queuedCommentChanges.push(commentChange);
            return;
        }

        this._sendMessage(context, {
            type: "ChangePostComment",
            change: commentChange,
        });
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
                    this._isBackfilling = true;
                    this._nextCommentIndexToSend = null;
                    this._queuedNewComments = [];
                    this._queuedCommentChanges = [];

                    const {
                        postCommentCount,
                        lastPostCommentChangeTime,
                        newPostComments,
                        newOtherReferencedPostComments,
                        postCommentChangesResult,
                    } = await backfillPostComments(
                        // Use a strong read consistency here so our durable object doesn't miss a
                        // comment and stall (the connection queues new messages but never flushes
                        // because we missed an earlier comment).
                        context.dynamo.setDefaultReadConsistency("Strong"),
                        {
                            postId: this._postId,
                            clientPostCommentCount: message.clientPostCommentCount,
                            clientLastPostCommentChangeTime:
                                message.clientLastPostCommentChangeTime,
                            newPostCommentLimit: message.newPostCommentLimit,
                        },
                    );

                    await postRealtimeBackfillCommentsBeforeFlushTestCheckpoint.waitForTest(
                        context.auth.getSessionId(),
                    );

                    this._sendMessage(context, {
                        type: "BackfillPostCommentsResponse",
                        postCommentCount,
                        lastPostCommentChangeTime,
                        newPostComments,
                        newOtherReferencedPostComments,
                        postCommentChangesResult,
                    });

                    this._isBackfilling = false;

                    this._nextCommentIndexToSend = postCommentCount;
                    this._flushQueuedComments(context);

                    // Send only the queued changes that occur after our backfill.
                    for (const commentChange of this._queuedCommentChanges) {
                        if (
                            !lastPostCommentChangeTime ||
                            getMessageChangeTime(commentChange) > lastPostCommentChangeTime
                        ) {
                            this._sendMessage(context, {
                                type: "ChangePostComment",
                                change: commentChange,
                            });
                        }
                    }
                    this._queuedCommentChanges = [];
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
                        parentMessageIndex: message.parentPostCommentIndex,
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

                const commentChange: MessageChange = {
                    type: "UpdateContent",
                    index: message.postCommentIndex,
                    content: {
                        doc: message.content,
                        references: contentReferences,
                    },
                    contentUpdatedTime,
                };

                this.sendCommentChange(context, commentChange);

                for (const connection of this._iterateOtherConnections())
                    connection.sendCommentChange(context, commentChange);

                break;
            }
            case "DeletePostComment": {
                const {deletedTime} = await deletePostComment(context, {
                    ...message,
                    postId: this._postId,
                });

                const commentChange: MessageChange = {
                    type: "Delete",
                    index: message.postCommentIndex,
                    deletedTime,
                };

                this.sendCommentChange(context, commentChange);

                for (const connection of this._iterateOtherConnections())
                    connection.sendCommentChange(context, commentChange);

                break;
            }
            default:
                throw exhaustive(message);
        }
    }
}
