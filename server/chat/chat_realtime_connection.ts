import {WebSocketConnectionProcedures} from "~/server/cloudflare/web_socket_server.js";
import {
    backfillChatMessages,
    deleteChatMessage,
    sendChatMessage,
    updateChatMessageContent,
} from "~/server/dynamo/chat_table.js";
import {ProcessContext} from "~/server/dynamo/context/process_context.js";
import {
    BackfillMessagesFunction,
    CreateMessageFunction,
    CreateMessageModelFunction,
    DeleteMessageFunction,
    UpdateMessageContentFunction,
} from "~/server/messaging/messaging_implementation.js";
import {MessagingRealtimeConnection} from "~/server/messaging/messaging_realtime_connection.js";
import {ChatMessageModel} from "~/shared/chat/chat_model.js";
import {ChatRealtimeEvent, ChatRealtimeProtocol} from "~/shared/chat/chat_realtime_protocol.js";
import {mapIterable} from "~/shared/helpers/iterable/map_iterable.js";
import {ChatId, SpaceId, WebSocketConnectionId} from "~/shared/id/types/id_types.js";

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
        sendEvent: (context: ProcessContext, event: ChatRealtimeEvent) => void;
        sendEventToOthers: (context: ProcessContext, event: ChatRealtimeEvent) => void;
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

            createMessageModel,
            createMessage,
            updateMessageContent,
            deleteMessage,
            backfillMessages,
        });
    }

    public readonly procedures: WebSocketConnectionProcedures<typeof ChatRealtimeProtocol> = {
        backfillMessages: (context, input) => this._connection.backfillMessages(context, input),
        createMessage: (context, input) => this._connection.createMessage(context, input),
        updateMessageContent: (context, input) =>
            this._connection.updateMessageContent(context, input),
        deleteMessage: (context, input) => this._connection.deleteMessage(context, input),
        startTypingInMessageInput: (context, input) =>
            this._connection.startTypingInMessageInput(context, input),
        stopTypingInMessageInput: (context, input) =>
            this._connection.stopTypingInMessageInput(context, input),
    };

    public async handleClose(context: ProcessContext) {
        return this._connection.handleClose(context);
    }
}

const createMessageModel: CreateMessageModelFunction<ChatId, ChatMessageModel> = ({
    roomKey: chatId,
    index,
    createdTime,
    author,
    payload,
}) => {
    return new ChatMessageModel({
        chatId,
        index,
        createdTime,
        author,
        payload,
    });
};

const createMessage: CreateMessageFunction<ChatId> = async (
    context,
    {roomKey: chatId, parentMessageIndex, content},
) => {
    return sendChatMessage(context, {
        chatId,
        parentMessageIndex,
        content,
    });
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
    return backfillChatMessages(context, {
        chatId,
        clientMessageCount,
        clientLastMessageChangeTime,
        newMessageLimit,
    });
};
