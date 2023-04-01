import {
    backfillChatMessages,
    deleteChatMessage,
    sendChatMessage,
    updateChatMessageContent,
} from "~/server/dynamo/chat_table";
import {ProcessContext} from "~/server/dynamo/context/process_context";
import {RequestContext} from "~/server/dynamo/context/request_context";
import {
    BackfillMessagesFunction,
    CreateMessageFunction,
    CreateMessageModelFunction,
    DeleteMessageFunction,
    UpdateMessageContentFunction,
} from "~/server/messaging/messaging_implementation";
import {MessagingRealtimeConnection} from "~/server/messaging/messaging_realtime_connection";
import {
    ChatRealtimeMessageFromClient,
    ChatRealtimeMessageFromServer,
} from "~/shared/chat/chat_realtime_schema";
import {cast} from "~/shared/helpers/control/cast";
import {mapIterable} from "~/shared/helpers/iterable/map_iterable";
import {ChatId, SpaceId, WebSocketConnectionId} from "~/shared/id/types/id_types";
import {ChatMessageModel} from "~/shared/models/chat_model";

export class ChatRealtimeConnection {
    private readonly _connection: MessagingRealtimeConnection<ChatId, ChatMessageModel>;

    constructor({
        connectionId,
        spaceId,
        chatId,
        sendMessage,
        sendMessageToOthers,
        iterateOtherConnections,
    }: {
        connectionId: WebSocketConnectionId;
        spaceId: SpaceId;
        chatId: ChatId;
        sendMessage: (context: ProcessContext, message: ChatRealtimeMessageFromServer) => void;
        sendMessageToOthers: (
            context: ProcessContext,
            message: ChatRealtimeMessageFromServer,
        ) => void;
        iterateOtherConnections: () => Iterable<ChatRealtimeConnection>;
    }) {
        this._connection = new MessagingRealtimeConnection({
            connectionId,
            spaceId,
            roomKey: chatId,

            sendMessage: (context, message) =>
                sendMessage(context, {type: "ChatMessages", message}),
            sendMessageToOthers: (context, message) =>
                sendMessageToOthers(context, {type: "ChatMessages", message}),
            iterateOtherConnections: () =>
                mapIterable(iterateOtherConnections(), connection => connection._connection),

            createMessageModel,
            createMessage,
            updateMessageContent,
            deleteMessage,
            backfillMessages,
        });
    }

    public async handleMessage(
        context: RequestContext,
        message: ChatRealtimeMessageFromClient,
    ): Promise<void> {
        // TypeScript will error if we ever add other message types here. At that point
        // this code should turn into a switch.
        cast<"ChatMessages">(message.type);

        return this._connection.handleMessage(context, message.message);
    }

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
