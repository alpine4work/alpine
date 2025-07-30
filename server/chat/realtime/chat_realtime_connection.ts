import {authorizeChatAccessForDurableObject} from "~/server/chat/realtime/authorize_chat_access_for_durable_object.js";
import {
    WorkerSessionActionContext,
    WorkerSessionActionContextModules,
} from "~/server/cloudflare/context/worker_action_context.js";
import {WorkerProcessContext} from "~/server/cloudflare/context/worker_process_context.js";
import {
    BackfillMessagesFunction,
    CreateMessageFunction,
    DeleteMessageFunction,
    MessagingRealtimeConnection,
    UpdateMessageContentFunction,
} from "~/server/messaging/realtime/messaging_realtime_connection.js";
import {WebSocketConnectionProcedures} from "~/server/web_socket/web_socket_server.js";
import {ChatMessageModel} from "~/shared/chat/chat_model.js";
import {ChatRealtimeEvent, ChatRealtimeProtocol} from "~/shared/chat/chat_realtime_protocol.js";
import {mapIterable} from "~/shared/helpers/iterable/map_iterable.js";
import {SafeFloatingPromise} from "~/shared/helpers/types/safe_floating_promise.js";
import {ChatId, SpaceId, WebSocketConnectionId} from "~/shared/id/types/id_types.js";
import {
    backfillChatMessages,
    deleteChatMessage,
    sendChatMessage,
    updateChatMessageContent,
} from "~/shared/rpc/chat_rpc_definitions.js";

export class ChatRealtimeConnection {
    private readonly _connection: MessagingRealtimeConnection<ChatId, ChatMessageModel>;

    constructor({
        connectionId,
        spaceId,
        chatId,
        sendEvent,
        sendEventToOthers,
        iterateOtherConnections,
    }: {
        connectionId: WebSocketConnectionId;
        spaceId: SpaceId;
        chatId: ChatId;
        sendEvent: (
            context: WorkerProcessContext,
            event: ChatRealtimeEvent,
        ) => SafeFloatingPromise<void>;
        sendEventToOthers: (context: WorkerProcessContext, event: ChatRealtimeEvent) => void;
        iterateOtherConnections: () => Iterable<ChatRealtimeConnection>;
    }) {
        this._connection = new MessagingRealtimeConnection({
            connectionId,
            spaceId,
            roomKey: chatId,

            sendEvent,
            sendEventToOthers,
            iterateOtherConnections: () =>
                mapIterable(iterateOtherConnections(), connection => connection._connection),

            createMessage,
            updateMessageContent,
            deleteMessage,
            backfillMessages,
        });
    }

    public async authorize(context: WorkerSessionActionContext) {
        await authorizeChatAccessForDurableObject(context, this._connection.roomKey);
    }

    public readonly procedures: WebSocketConnectionProcedures<
        WorkerSessionActionContextModules,
        typeof ChatRealtimeProtocol
    > = {
        backfillMessages: async (context, input) => {
            const {extra, ...result} = await this._connection.backfillMessages(context, input);
            return result;
        },
        createMessage: (context, input) => this._connection.createMessage(context, input),
        updateMessageContent: (context, input) =>
            this._connection.updateMessageContent(context, input),
        deleteMessage: (context, input) => this._connection.deleteMessage(context, input),
        startTypingInMessageInput: (context, input) =>
            this._connection.startTypingInMessageInput(context, input),
        stopTypingInMessageInput: (context, input) =>
            this._connection.stopTypingInMessageInput(context, input),
    };

    public async transformEvent(
        context: WorkerSessionActionContext,
        eventStub: ChatRealtimeEvent,
    ): Promise<ChatRealtimeEvent> {
        // TODO(calebmer, #content-references-privacy-fix): Implement a proper event stub.
        return eventStub;
    }

    public async handleClose(context: WorkerProcessContext) {
        return this._connection.handleClose(context);
    }
}

const createMessage: CreateMessageFunction<ChatId, ChatMessageModel> = async (
    context,
    {roomKey: chatId, parentMessageIndex, content, fileIds},
) => {
    const {message} = await sendChatMessage(context, {
        chatId,
        parentMessageIndex,
        content,
        fileIds,
    });
    return message;
};

const updateMessageContent: UpdateMessageContentFunction<ChatId> = async (
    context,
    {roomKey: chatId, messageIndex, content},
) => {
    return updateChatMessageContent(context, {
        chatId,
        messageIndex,
        content,
    });
};

const deleteMessage: DeleteMessageFunction<ChatId> = async (
    context,
    {roomKey: chatId, messageIndex},
) => {
    return deleteChatMessage(context, {chatId, messageIndex});
};

const backfillMessages: BackfillMessagesFunction<ChatId, ChatMessageModel> = async (
    context,
    {roomKey: chatId, clientMessageCount, clientLastMessageChangeTime, newMessageLimit},
) => {
    const result = await backfillChatMessages(context, {
        chatId,
        clientMessageCount,
        clientLastMessageChangeTime,
        newMessageLimit,
    });

    return {...result, extra: null};
};
