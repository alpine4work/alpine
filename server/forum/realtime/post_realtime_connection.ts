import {
    WorkerActionContext,
    WorkerSessionActionContext,
    WorkerSessionActionContextModules,
} from "~/server/cloudflare/context/worker_action_context.js";
import {WorkerProcessContext} from "~/server/cloudflare/context/worker_process_context.js";
import {authorizePostAccessForDurableObject} from "~/server/forum/realtime/authorize_post_access_for_durable_object.js";
import {
    BackfillMessagesFunction,
    CreateMessageFunction,
    CreateMessageModelFunction,
    DeleteMessageFunction,
    GetMessageReferencesFunction,
    MessagingRealtimeConnection,
    UpdateMessageContentFunction,
} from "~/server/messaging/realtime/messaging_realtime_connection.js";
import {MessagingRealtimeEventStub} from "~/server/messaging/realtime/messaging_realtime_event_stub.js";
import {WebSocketConnectionProcedures} from "~/server/web_socket/web_socket_server.js";
import {DynamoGeneralRealtimeEventStub} from "~/shared/dynamo/dynamo_general_realtime_types.js";
import {PostCommentModel} from "~/shared/forum/post_model.js";
import {PostRealtimeEvent, PostRealtimeProtocol} from "~/shared/forum/post_realtime_protocol.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {mapIterable} from "~/shared/helpers/iterable/map_iterable.js";
import {SafeFloatingPromise} from "~/shared/helpers/types/safe_floating_promise.js";
import {AccountId, PostId, SpaceId, WebSocketConnectionId} from "~/shared/id/types/id_types.js";
import {
    MessagingRealtimeBroadcastCompleteMessageStreamRequest,
    MessagingRealtimeBroadcastNewMessageRequest,
    MessagingRealtimeBroadcastPutMessageStreamPartRequest,
} from "~/shared/messaging/messaging_realtime_protocol.js";
import {
    backfillPostComments,
    createPostComment,
    deletePostComment,
    getPostCommentReferences,
    getPostRealtimeEvent,
    updatePostCommentContent,
} from "~/shared/rpc/forum_rpc_definitions.js";

export type PostRealtimeEventStub =
    | {
          readonly type: "Comments";
          readonly event: MessagingRealtimeEventStub;
      }
    | {
          readonly type: "RealtimeEventTransaction";
          readonly eventTransaction: ReadonlyArray<DynamoGeneralRealtimeEventStub>;
      };

export class PostRealtimeConnection {
    private readonly _postId: PostId;
    private readonly _connection: MessagingRealtimeConnection<PostId, PostCommentModel>;

    constructor({
        connectionId,
        spaceId,
        accountId,
        postId,
        sendEvent,
        sendEventToOthers,
        iterateOtherConnections,
    }: {
        connectionId: WebSocketConnectionId;
        spaceId: SpaceId;
        accountId: AccountId;
        postId: PostId;
        sendEvent: (
            context: WorkerProcessContext,
            event: PostRealtimeEventStub,
        ) => SafeFloatingPromise<void>;
        sendEventToOthers: (context: WorkerProcessContext, event: PostRealtimeEventStub) => void;
        iterateOtherConnections: () => Iterable<PostRealtimeConnection>;
    }) {
        this._postId = postId;

        this._connection = new MessagingRealtimeConnection({
            connectionId,
            spaceId,
            accountId,
            roomKey: postId,

            sendEvent: (context, event) => sendEvent(context, {type: "Comments", event}),
            sendEventToOthers: (context, event) =>
                sendEventToOthers(context, {type: "Comments", event}),
            iterateOtherConnections: () =>
                mapIterable(iterateOtherConnections(), connection => connection._connection),

            createMessage,
            updateMessageContent,
            deleteMessage,
            backfillMessages,
            getMessageReferences,
            createMessageModel,
        });
    }

    public getConnectionForTest() {
        assert(import.meta.jest);
        return this._connection;
    }

    public async authorize(context: WorkerSessionActionContext) {
        await authorizePostAccessForDurableObject(context, this._postId);
    }

    public readonly procedures: WebSocketConnectionProcedures<
        WorkerSessionActionContextModules,
        typeof PostRealtimeProtocol
    > = {
        backfillComments: async (
            context,
            {
                clientCommentCount: clientMessageCount,
                clientLastCommentChangeTime: clientLastMessageChangeTime,
                newCommentLimit: newMessageLimit,
            },
        ) => {
            const {
                messageCount: commentCount,
                lastMessageChangeTime: lastCommentChangeTime,
                newMessages: newComments,
                newOtherReferencedMessages: newOtherReferencedComments,
                messageChangesResult: commentChangesResult,
                typingStateByConnectionId,
            } = await this._connection.backfillMessages(context, {
                clientMessageCount,
                clientLastMessageChangeTime,
                newMessageLimit,
            });

            return {
                commentCount,
                lastCommentChangeTime,
                newComments,
                newOtherReferencedComments,
                commentChangesResult,
                typingStateByConnectionId,
            };
        },

        createComment: async (context, {parent, content, fileIds}) =>
            this._connection.createMessage(context, {parent, content, fileIds}),

        updateCommentContent: (context, {commentIndex: messageIndex, version, steps}) =>
            this._connection.updateMessageContent(context, {messageIndex, version, steps}),

        deleteComment: (context, {commentIndex: messageIndex}) =>
            this._connection.deleteMessage(context, {messageIndex}),

        startTypingInCommentInput: (context, input) =>
            this._connection.startTypingInMessageInput(context, input),
        stopTypingInCommentInput: (context, input) =>
            this._connection.stopTypingInMessageInput(context, input),
    };

    public static broadcastNewMessage(
        context: WorkerActionContext,
        request: MessagingRealtimeBroadcastNewMessageRequest,
        iterateAllConnections: () => Iterable<PostRealtimeConnection>,
    ) {
        MessagingRealtimeConnection.broadcastNewMessage(context, request, () =>
            mapIterable(iterateAllConnections(), connection => connection._connection),
        );
    }

    public static broadcastPutMessageStreamPart(
        context: WorkerActionContext,
        request: MessagingRealtimeBroadcastPutMessageStreamPartRequest,
        iterateAllConnections: () => Iterable<PostRealtimeConnection>,
    ) {
        MessagingRealtimeConnection.broadcastPutMessageStreamPart(context, request, () =>
            mapIterable(iterateAllConnections(), connection => connection._connection),
        );
    }

    public static broadcastCompleteMessageStream(
        context: WorkerActionContext,
        request: MessagingRealtimeBroadcastCompleteMessageStreamRequest,
        iterateAllConnections: () => Iterable<PostRealtimeConnection>,
    ) {
        MessagingRealtimeConnection.broadcastCompleteMessageStream(context, request, () =>
            mapIterable(iterateAllConnections(), connection => connection._connection),
        );
    }

    public async transformEvent(
        context: WorkerSessionActionContext,
        eventStub: PostRealtimeEventStub,
    ): Promise<PostRealtimeEvent> {
        switch (eventStub.type) {
            case "Comments": {
                return {
                    type: "Comments",
                    event: await this._connection.transformEvent(context, eventStub.event),
                };
            }
            case "RealtimeEventTransaction": {
                const {readTime, eventTransaction} = await getPostRealtimeEvent(context, {
                    postId: this._postId,
                    eventTransaction: eventStub.eventTransaction,
                });

                return {
                    type: "RealtimeEventTransaction",
                    readTime,
                    eventTransaction,
                };
            }
            default:
                throw exhaustive(eventStub);
        }
    }

    public async handleClose(context: WorkerProcessContext) {
        return this._connection.handleClose(context);
    }
}

const createMessage: CreateMessageFunction<PostId> = (
    context,
    {roomKey: postId, parent, content, fileIds},
) => {
    return createPostComment(context, {
        postId,
        parent,
        content,
        fileIds,
    });
};

const updateMessageContent: UpdateMessageContentFunction<PostId> = (
    context,
    {roomKey: postId, messageIndex: commentIndex, steps, version},
) => {
    return updatePostCommentContent(context, {
        postId,
        commentIndex,
        steps,
        version,
    });
};

const deleteMessage: DeleteMessageFunction<PostId> = (
    context,
    {roomKey: postId, messageIndex: commentIndex},
) => {
    return deletePostComment(context, {postId, commentIndex});
};

const backfillMessages: BackfillMessagesFunction<PostId, PostCommentModel> = async (
    context,
    {
        roomKey: postId,
        clientMessageCount: clientCommentCount,
        clientLastMessageChangeTime: clientLastCommentChangeTime,
        newMessageLimit: newCommentLimit,
    },
) => {
    const {
        commentCount,
        lastCommentChangeTime,
        newComments,
        newOtherReferencedComments,
        commentChangesResult,
    } = await backfillPostComments(context, {
        postId,
        clientCommentCount,
        clientLastCommentChangeTime,
        newCommentLimit,
    });

    return {
        messageCount: commentCount,
        lastMessageChangeTime: lastCommentChangeTime,
        newMessages: newComments,
        newOtherReferencedMessages: newOtherReferencedComments,
        messageChangesResult: commentChangesResult,
        extra: null,
    };
};

const getMessageReferences: GetMessageReferencesFunction<PostId> = async (
    context,
    {spaceId, roomKey: postId, referencedIds},
) => {
    const {references} = await getPostCommentReferences(context, {spaceId, postId, referencedIds});
    return references;
};

const createMessageModel: CreateMessageModelFunction<PostId, PostCommentModel> = ({
    roomKey: postId,
    message,
    references,
}) => {
    return new PostCommentModel({
        postId,
        index: message.index,
        createdTime: message.createdTime,
        author: references.author,
        payload: {
            type: "Content",
            parent: message.payload.parent,
            content: {
                doc: message.payload.content,
                references: references.contentReferences,
            },
            contentUpdate: message.payload.contentUpdate,
            files: message.payload.fileIds.map(fileId =>
                assertExists(references.fileById.get(fileId)),
            ),
        },
        stream: message.stream,
    });
};
