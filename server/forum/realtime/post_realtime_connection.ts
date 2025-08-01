import {
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
import {PostCommentModel} from "~/shared/forum/post_model.js";
import {PostRealtimeEvent, PostRealtimeProtocol} from "~/shared/forum/post_realtime_protocol.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {mapIterable} from "~/shared/helpers/iterable/map_iterable.js";
import {SafeFloatingPromise} from "~/shared/helpers/types/safe_floating_promise.js";
import {AccountId, PostId, SpaceId, WebSocketConnectionId} from "~/shared/id/types/id_types.js";
import {
    backfillPostComments,
    createPostComment,
    deletePostComment,
    getPostCommentReferences,
    updatePostCommentContent,
} from "~/shared/rpc/forum_rpc_definitions.js";

export type PostRealtimeEventStub =
    | {readonly type: "Comments"; readonly event: MessagingRealtimeEventStub}
    // TODO(calebmer, #content-references-privacy-fix): Implement a proper event stub.
    | (PostRealtimeEvent & {readonly type: "RealtimeEventTransaction"});

export class PostRealtimeConnection {
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

    public async authorize(context: WorkerSessionActionContext) {
        await authorizePostAccessForDurableObject(context, this._connection.roomKey);
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

        createComment: async (
            context,
            {parentCommentIndex: parentMessageIndex, content, fileIds},
        ) => this._connection.createMessage(context, {parentMessageIndex, content, fileIds}),

        updateCommentContent: (context, {commentIndex: messageIndex, content}) =>
            this._connection.updateMessageContent(context, {messageIndex, content}),

        deleteComment: (context, {commentIndex: messageIndex}) =>
            this._connection.deleteMessage(context, {messageIndex}),

        startTypingInCommentInput: (context, input) =>
            this._connection.startTypingInMessageInput(context, input),
        stopTypingInCommentInput: (context, input) =>
            this._connection.stopTypingInMessageInput(context, input),
    };

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
            case "RealtimeEventTransaction":
                // TODO(calebmer, #content-references-privacy-fix): Implement a proper event stub.
                return eventStub;
            default:
                throw exhaustive(eventStub);
        }
    }

    public async handleClose(context: WorkerProcessContext) {
        return this._connection.handleClose(context);
    }
}

const createMessage: CreateMessageFunction<PostId, PostCommentModel> = async (
    context,
    {roomKey: postId, parentMessageIndex: parentCommentIndex, content, fileIds},
) => {
    const {comment} = await createPostComment(context, {
        postId,
        parentCommentIndex,
        content,
        fileIds,
    });

    return comment;
};

const updateMessageContent: UpdateMessageContentFunction<PostId> = async (
    context,
    {roomKey: postId, messageIndex: commentIndex, content},
) => {
    return updatePostCommentContent(context, {
        postId,
        commentIndex,
        content,
    });
};

const deleteMessage: DeleteMessageFunction<PostId> = async (
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
            parentMessageIndex: message.payload.parentMessageIndex,
            content: {
                doc: message.payload.content,
                references: references.contentReferences,
            },
            contentUpdatedTime: message.payload.contentUpdatedTime,
            files: message.payload.fileIds.map(fileId =>
                assertExists(references.fileById.get(fileId)),
            ),
        },
    });
};
