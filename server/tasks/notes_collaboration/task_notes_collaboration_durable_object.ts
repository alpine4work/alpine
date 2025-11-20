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
import {
    TaskNotesCollaborationConnection,
    TaskNotesCollaborationEventStub,
} from "~/server/tasks/notes_collaboration/task_notes_collaboration_connection.js";
import {TaskNotesCollaborationContentManager} from "~/server/tasks/notes_collaboration/task_notes_collaboration_content_manager.js";
import {WebSocketServer} from "~/server/web_socket/web_socket_server.js";
import {NotFoundError} from "~/shared/error/error.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {SpaceId, TaskId} from "~/shared/id/types/id_types.js";
import {
    MessagingRealtimeBroadcastCompleteMessageStreamRequestSchema,
    MessagingRealtimeBroadcastNewMessageRequestSchema,
    MessagingRealtimeBroadcastPingMessageStreamRequestSchema,
    MessagingRealtimeBroadcastPutMessageStreamPartRequestSchema,
} from "~/shared/messaging/messaging_realtime_protocol.js";
import {getTaskNotesContent} from "~/shared/rpc/tasks_rpc_definitions.js";
import {Schema} from "~/shared/schema/schema.js";
import {TaskNotesCollaborationProtocol} from "~/shared/tasks/task_notes_collaboration_protocol.js";
import {TaskNotesContent} from "~/shared/tasks/task_notes_content_schema.js";

type TaskNotesCollaborationDurableObjectRoute =
    | "Main"
    | "BroadcastNewMessage"
    | "BroadcastPutMessageStreamPart"
    | "BroadcastCompleteMessageStream"
    | "BroadcastPingMessageStream"
    | "NotFound";

class TaskNotesCollaborationDurableObject {
    public static readonly serviceName = "TaskNotesCollaborationService";

    private readonly _processContext: WorkerProcessContext;
    public readonly spaceId: SpaceId;
    public readonly taskId: TaskId;
    private readonly _contentManager: TaskNotesCollaborationContentManager;
    private readonly _destroyCallback: () => void;

    private readonly _webSocketServer: WebSocketServer<
        WorkerProcessContextModules,
        WorkerSessionActionContextModules,
        typeof TaskNotesCollaborationProtocol,
        TaskNotesCollaborationEventStub,
        TaskNotesCollaborationConnection
    >;

    public static async initialize({
        processContext,
        initializeActionContext,
        idName,
        destroy,
    }: {
        processContext: WorkerProcessContext;
        initializeActionContext: WorkerActionContext;
        idName: string;
        destroy: () => void;
    }): Promise<TaskNotesCollaborationDurableObject> {
        const taskId = Schema.id<TaskId>().deserialize(idName);

        const {
            spaceId,
            version: initialVersion,
            content: initialContent,
        } = await getTaskNotesContent(initializeActionContext, {
            taskId,
        });

        return new TaskNotesCollaborationDurableObject({
            processContext,
            spaceId,
            taskId,
            initialVersion,
            initialContent,
            destroy,
        });
    }

    private constructor({
        processContext,
        spaceId,
        taskId,
        initialVersion,
        initialContent,
        destroy,
    }: {
        processContext: WorkerProcessContext;
        spaceId: SpaceId;
        taskId: TaskId;
        initialVersion: number;
        initialContent: TaskNotesContent;
        destroy: () => void;
    }) {
        // Propagate the `TaskId` to all logs for this durable object.
        processContext = processContext.tracer.withPropagatedData({
            context: {spaceId, taskId},
        });

        this._processContext = processContext;
        this.spaceId = spaceId;
        this.taskId = taskId;
        this._destroyCallback = destroy;

        this._contentManager = new TaskNotesCollaborationContentManager({
            spaceId,
            taskId,
            initialVersion,
            initialContent,
            sendEventToAllAndWait: (context, event) =>
                this._webSocketServer.sendEventToAllAndWait(context, event),
            killProcess: (context, error) => this._destroy(context, error),
        });

        this._webSocketServer = new WebSocketServer<
            WorkerProcessContextModules,
            WorkerSessionActionContextModules,
            typeof TaskNotesCollaborationProtocol,
            TaskNotesCollaborationEventStub,
            TaskNotesCollaborationConnection
        >(
            this._processContext,
            TaskNotesCollaborationProtocol,
            ({
                accountId,
                connectionId,
                closeWithError,
                sendEvent,
                sendEventToOthers,
                iterateOtherConnections,
            }) => {
                return new TaskNotesCollaborationConnection({
                    connectionId,
                    accountId,
                    contentManager: this._contentManager,
                    closeWithError,
                    sendEvent,
                    sendEventToOthers,
                    iterateOtherConnections,
                });
            },
        );
    }

    public static parseRoute(url: URL): [string, TaskNotesCollaborationDurableObjectRoute] {
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

        if (url.pathname === "/broadcast-ping-message-stream") {
            return [url.pathname, "BroadcastPingMessageStream"];
        }

        return ["/*", "NotFound"];
    }

    public async fetch(
        context: WorkerActionContext,
        request: Request,
        route: TaskNotesCollaborationDurableObjectRoute,
    ): Promise<Response> {
        // Propagate the `TaskId` to all logs for this durable object.
        context = context.tracer.withPropagatedData({
            context: {spaceId: this.spaceId, taskId: this.taskId},
        });

        switch (route) {
            case "NotFound": {
                throw new NotFoundError("Route not found");
            }
            case "Main": {
                return this._webSocketServer.upgrade(context.actor.authorizeSession(), request);
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

                TaskNotesCollaborationConnection.broadcastNewMessage(context, requestBody, () =>
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

                TaskNotesCollaborationConnection.broadcastPutMessageStreamPart(
                    context,
                    requestBody,
                    () => this._webSocketServer.iterateAllConnections(),
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

                TaskNotesCollaborationConnection.broadcastCompleteMessageStream(
                    context,
                    requestBody,
                    () => this._webSocketServer.iterateAllConnections(),
                );

                return new Response(null, {status: 200});
            }
            case "BroadcastPingMessageStream": {
                if (request.method !== "POST") {
                    return new Response("405 Method Not Allowed", {
                        status: 405,
                        headers: {"content-type": "text/plain"},
                    });
                }
                const requestBody =
                    MessagingRealtimeBroadcastPingMessageStreamRequestSchema.deserialize(
                        await request.json(),
                    );

                TaskNotesCollaborationConnection.broadcastPingMessageStream(
                    context,
                    requestBody,
                    () => this._webSocketServer.iterateAllConnections(),
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

    private _destroy(context: WorkerProcessContext, error: unknown) {
        this._webSocketServer.closeAllWithError(context, error);
        this._destroyCallback();
    }
}

const TaskNotesCollaborationDurableObjectWrapper = createDurableObject(
    TaskNotesCollaborationDurableObject,
);
export {TaskNotesCollaborationDurableObjectWrapper as TaskNotesCollaborationDurableObject};
