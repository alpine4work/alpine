import {authorizeChatAccessForDurableObject} from "~/server/chat/realtime/authorize_chat_access_for_durable_object.js";
import {ChatRealtimeConnection} from "~/server/chat/realtime/chat_realtime_connection.js";
import {
    WorkerActionContext,
    WorkerSessionActionContext,
    WorkerSessionActionContextModules,
} from "~/server/cloudflare/context/worker_action_context.js";
import {
    WorkerProcessContext,
    WorkerProcessContextModules,
} from "~/server/cloudflare/context/worker_process_context.js";
import {createDurableObject} from "~/server/cloudflare/create_durable_object.js";
import {WebSocketServer} from "~/server/web_socket/web_socket_server.js";
import {ChatRealtimeEvent, ChatRealtimeProtocol} from "~/shared/chat/chat_realtime_protocol.js";
import {NotFoundError} from "~/shared/error/error.js";
import {ChatId, SpaceId} from "~/shared/id/types/id_types.js";
import {Schema} from "~/shared/schema/schema.js";

type ChatRealtimeDurableObjectRoute = "Main" | "NotFound";

class ChatRealtimeDurableObject {
    public static readonly serviceName = "ChatRealtimeService";

    private readonly _processContext: WorkerProcessContext;
    private readonly _spaceId: SpaceId;
    private readonly _chatId: ChatId;

    private readonly _webSocketServer: WebSocketServer<
        WorkerProcessContextModules,
        WorkerSessionActionContextModules,
        typeof ChatRealtimeProtocol,
        // TODO(calebmer, #content-references-privacy-fix): Implement a proper event stub.
        ChatRealtimeEvent,
        ChatRealtimeConnection
    >;

    public static async initialize({
        processContext,
        initializeActionContext,
        idName,
    }: {
        processContext: WorkerProcessContext;
        initializeActionContext: WorkerActionContext;
        idName: string;
    }): Promise<ChatRealtimeDurableObject> {
        const chatId = Schema.id<ChatId>().deserialize(idName);

        const {spaceId} = await authorizeChatAccessForDurableObject(
            initializeActionContext,
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
        processContext: WorkerProcessContext;
        spaceId: SpaceId;
        chatId: ChatId;
    }) {
        // Propagate the chat id to all logs for this durable object.
        processContext = processContext.tracer.withPropagatedData({context: {spaceId, chatId}});

        this._processContext = processContext;
        this._spaceId = spaceId;
        this._chatId = chatId;

        this._webSocketServer = new WebSocketServer<
            WorkerProcessContextModules,
            WorkerSessionActionContextModules,
            typeof ChatRealtimeProtocol,
            // TODO(calebmer, #content-references-privacy-fix): Implement a proper event stub.
            ChatRealtimeEvent,
            ChatRealtimeConnection
        >(
            this._processContext,
            ChatRealtimeProtocol,
            ({connectionId, sendEvent, sendEventToOthers, iterateOtherConnections}) => {
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

    public static parseRoute(url: URL): [string, ChatRealtimeDurableObjectRoute] {
        if (url.pathname !== "/") return ["/*", "NotFound"];
        return ["/", "Main"];
    }

    public async fetch(
        context: WorkerActionContext,
        request: Request,
        route: ChatRealtimeDurableObjectRoute,
    ): Promise<Response> {
        // Propagate the chat id to all logs for this durable object.
        context = context.tracer.withPropagatedData({
            context: {spaceId: this._spaceId, chatId: this._chatId},
        });

        if (route === "NotFound") throw new NotFoundError("Route not found");
        return this._webSocketServer.upgrade(context.actor.authorizeSession(), request);
    }

    public connectForTest(context: WorkerSessionActionContext) {
        return this._webSocketServer.connectForTest(context);
    }
}

const ChatRealtimeDurableObjectWrapper = createDurableObject(ChatRealtimeDurableObject);
export {ChatRealtimeDurableObjectWrapper as ChatRealtimeDurableObject};
