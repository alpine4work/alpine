import {authorizeChatAccessForDurableObject} from "~/server/chat/realtime/authorize_chat_access_for_durable_object.js";
import {
    ChatRealtimeConnection,
    ChatRealtimeConnectionEventStub,
} from "~/server/chat/realtime/chat_realtime_connection.js";
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
import {ChatRealtimeProtocol} from "~/shared/chat/chat_realtime_protocol.js";
import {NotFoundError} from "~/shared/error/error.open_source.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.open_source.js";
import {ChatId, SpaceId} from "~/shared/id/types/id_types.open_source.js";
import {
    MessagingRealtimeBroadcastCompleteMessageStreamRequestSchema,
    MessagingRealtimeBroadcastNewMessageRequestSchema,
    MessagingRealtimeBroadcastPutMessageStreamPartRequestSchema,
} from "~/shared/messaging/messaging_realtime_protocol.js";
import {Schema} from "~/shared/schema/schema.js";

type ChatRealtimeDurableObjectRoute =
    | "Main"
    | "BroadcastNewMessage"
    | "BroadcastPutMessageStreamPart"
    | "BroadcastCompleteMessageStream"
    | "NotFound";

class ChatRealtimeDurableObject {
    public static readonly serviceName = "ChatRealtimeService";

    private readonly _processContext: WorkerProcessContext;
    private readonly _spaceId: SpaceId;
    private readonly _chatId: ChatId;

    private readonly _webSocketServer: WebSocketServer<
        WorkerProcessContextModules,
        WorkerSessionActionContextModules,
        typeof ChatRealtimeProtocol,
        ChatRealtimeConnectionEventStub,
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
            ChatRealtimeConnectionEventStub,
            ChatRealtimeConnection
        >(
            this._processContext,
            ChatRealtimeProtocol,
            ({accountId, connectionId, sendEvent, sendEventToOthers, iterateOtherConnections}) => {
                return new ChatRealtimeConnection({
                    connectionId,
                    spaceId,
                    accountId,
                    chatId,
                    sendEvent,
                    sendEventToOthers,
                    iterateOtherConnections,
                });
            },
        );
    }

    public static parseRoute(url: URL): [string, ChatRealtimeDurableObjectRoute] {
        if (url.pathname === "/") return ["/", "Main"];

        if (url.pathname === "/broadcast-new-message") {
            return [url.pathname, "BroadcastNewMessage"];
        }

        if (url.pathname === "/broadcast-put-message-stream-part") {
            return [url.pathname, "BroadcastPutMessageStreamPart"];
        }

        if (url.pathname === "/broadcast-complete-message-stream") {
            return [url.pathname, "BroadcastCompleteMessageStream"];
        }

        return ["/*", "NotFound"];
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

        switch (route) {
            case "NotFound": {
                throw new NotFoundError("Route not found");
            }
            case "Main": {
                return await this._webSocketServer.upgrade(
                    context.actor.authorizeSession(),
                    request,
                );
            }
            case "BroadcastNewMessage": {
                if (request.method !== "POST") {
                    return new Response("405 Method Not Allowed", {
                        status: 405,
                        headers: {"content-type": "text/plain"},
                    });
                }

                const requestBody = MessagingRealtimeBroadcastNewMessageRequestSchema.deserialize(
                    await request.json(),
                );

                ChatRealtimeConnection.broadcastNewMessage(context, requestBody, () =>
                    this._webSocketServer.iterateAllConnections(),
                );

                return new Response(null, {status: 200});
            }
            case "BroadcastPutMessageStreamPart": {
                if (request.method !== "POST") {
                    return new Response("405 Method Not Allowed", {
                        status: 405,
                        headers: {"content-type": "text/plain"},
                    });
                }

                const requestBody =
                    MessagingRealtimeBroadcastPutMessageStreamPartRequestSchema.deserialize(
                        await request.json(),
                    );

                ChatRealtimeConnection.broadcastPutMessageStreamPart(context, requestBody, () =>
                    this._webSocketServer.iterateAllConnections(),
                );

                return new Response(null, {status: 200});
            }
            case "BroadcastCompleteMessageStream": {
                if (request.method !== "POST") {
                    return new Response("405 Method Not Allowed", {
                        status: 405,
                        headers: {"content-type": "text/plain"},
                    });
                }

                const requestBody =
                    MessagingRealtimeBroadcastCompleteMessageStreamRequestSchema.deserialize(
                        await request.json(),
                    );

                ChatRealtimeConnection.broadcastCompleteMessageStream(context, requestBody, () =>
                    this._webSocketServer.iterateAllConnections(),
                );

                return new Response(null, {status: 200});
            }
            default:
                throw exhaustive(route);
        }
    }

    public connectForTest(context: WorkerSessionActionContext) {
        return this._webSocketServer.connectForTest(context);
    }
}

const ChatRealtimeDurableObjectWrapper = createDurableObject(ChatRealtimeDurableObject);
export {ChatRealtimeDurableObjectWrapper as ChatRealtimeDurableObject};
