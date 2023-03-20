import {ChatRealtimeConnection} from "~/server/chat/chat_realtime_connection";
import {createDurableObject} from "~/server/cloudflare/create_durable_object";
import {WebSocketServer} from "~/server/cloudflare/web_socket_server";
import {authorizeChatAccess} from "~/server/dynamo/chat_table";
import {ProcessContext} from "~/server/dynamo/context/process_context";
import {RequestContext} from "~/server/dynamo/context/request_context";
import {
    ChatRealtimeMessageFromClient,
    ChatRealtimeMessageFromClientSchema,
    ChatRealtimeMessageFromServer,
    ChatRealtimeMessageFromServerSchema,
} from "~/shared/chat/chat_realtime_schema";
import {ChatId, SpaceId} from "~/shared/id/types/id_types";
import {Schema} from "~/shared/schema/schema";

class ChatRealtimeDurableObject {
    public static serviceName = "ChatRealtimeService" as const;

    private readonly _context: ProcessContext;
    private readonly _spaceId: SpaceId;
    private readonly _chatId: ChatId;

    private readonly _webSocketServer: WebSocketServer<
        ChatRealtimeMessageFromClient,
        ChatRealtimeMessageFromServer,
        ChatRealtimeConnection
    >;

    public static async initialize({
        processContext,
        initializeRequestContext,
        idName,
    }: {
        processContext: ProcessContext;
        initializeRequestContext: RequestContext;
        idName: string;
    }): Promise<ChatRealtimeDurableObject> {
        const chatId = Schema.id<ChatId>().deserialize(idName);
        const {spaceId} = await authorizeChatAccess(initializeRequestContext, chatId);

        return new ChatRealtimeDurableObject({
            context: processContext,
            chatId,
            spaceId,
        });
    }

    private constructor({
        context,
        spaceId,
        chatId,
    }: {
        context: ProcessContext;
        spaceId: SpaceId;
        chatId: ChatId;
    }) {
        // Propagate the chat id to all logs for this durable object.
        context = context.tracer.withPropagatedData({context: {spaceId, chatId}});

        this._context = context;
        this._spaceId = spaceId;
        this._chatId = chatId;

        this._webSocketServer = new WebSocketServer(
            this._context,
            ChatRealtimeMessageFromClientSchema,
            ChatRealtimeMessageFromServerSchema,
            ({sendMessage, iterateOtherConnections}) =>
                new ChatRealtimeConnection({
                    spaceId,
                    chatId,
                    sendMessage,
                    iterateOtherConnections,
                }),
        );
    }

    public async fetch(context: RequestContext, request: Request): Promise<Response> {
        // Propagate the chat id to all logs for this durable object.
        context = context.tracer.withPropagatedData({
            context: {spaceId: this._spaceId, chatId: this._chatId},
        });

        return this._webSocketServer.upgrade(context, request);
    }
}

const ChatRealtimeDurableObjectWrapper = createDurableObject(ChatRealtimeDurableObject);
export {ChatRealtimeDurableObjectWrapper as ChatRealtimeDurableObject};
