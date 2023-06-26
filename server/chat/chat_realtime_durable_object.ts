import {ChatRealtimeConnection} from "~/server/chat/chat_realtime_connection.js";
import {createDurableObject} from "~/server/cloudflare/create_durable_object.js";
import {WebSocketServer} from "~/server/cloudflare/web_socket_server.js";
import {authorizeChatAccess} from "~/server/dynamo/chat_table.js";
import {ActionContext, SessionActionContext} from "~/server/dynamo/context/action_context.js";
import {ProcessContext} from "~/server/dynamo/context/process_context.js";
import {ChatRealtimeProtocol} from "~/shared/chat/chat_realtime_protocol.js";
import {NotFoundError} from "~/shared/error/error.js";
import {ChatId, SpaceId} from "~/shared/id/types/id_types.js";
import {Schema} from "~/shared/schema/schema.js";

class ChatRealtimeDurableObject {
    public static readonly serviceName = "ChatRealtimeService";

    private readonly _processContext: ProcessContext;
    private readonly _spaceId: SpaceId;
    private readonly _chatId: ChatId;

    private readonly _webSocketServer: WebSocketServer<
        typeof ChatRealtimeProtocol,
        ChatRealtimeConnection
    >;

    public static async initialize({
        processContext,
        initializeActionContext,
        idName,
    }: {
        processContext: ProcessContext;
        initializeActionContext: ActionContext;
        idName: string;
    }): Promise<ChatRealtimeDurableObject> {
        const chatId = Schema.id<ChatId>().deserialize(idName);
        const {spaceId} = await authorizeChatAccess(
            initializeActionContext.actor.authorizeSession(),
            chatId,
        );

        return new ChatRealtimeDurableObject({
            processContext,
            chatId,
            spaceId,
        });
    }

    private constructor({
        processContext,
        spaceId,
        chatId,
    }: {
        processContext: ProcessContext;
        spaceId: SpaceId;
        chatId: ChatId;
    }) {
        // Propagate the chat id to all logs for this durable object.
        processContext = processContext.tracer.withPropagatedData({context: {spaceId, chatId}});

        this._processContext = processContext;
        this._spaceId = spaceId;
        this._chatId = chatId;

        this._webSocketServer = new WebSocketServer(
            this._processContext,
            ChatRealtimeProtocol,
            async ({
                connectActionContext,
                connectionId,
                sendEvent,
                sendEventToOthers,
                iterateOtherConnections,
            }) => {
                await authorizeChatAccess(connectActionContext, chatId);

                return new ChatRealtimeConnection({
                    connectionId,
                    spaceId,
                    chatId,
                    sendEvent,
                    sendEventToOthers,
                    iterateOtherConnections,
                });
            },
        );
    }

    public async fetch(context: ActionContext, request: Request): Promise<Response> {
        // Propagate the chat id to all logs for this durable object.
        context = context.tracer.withPropagatedData({
            context: {spaceId: this._spaceId, chatId: this._chatId},
        });

        const url = new URL(request.url);
        if (url.pathname !== "/") throw new NotFoundError("Unexpected path");
        return this._webSocketServer.upgrade(context.actor.authorizeSession(), request);
    }

    public connectForTest(context: SessionActionContext) {
        return this._webSocketServer.connectForTest(context);
    }
}

const ChatRealtimeDurableObjectWrapper = createDurableObject(ChatRealtimeDurableObject);
export {ChatRealtimeDurableObjectWrapper as ChatRealtimeDurableObject};
