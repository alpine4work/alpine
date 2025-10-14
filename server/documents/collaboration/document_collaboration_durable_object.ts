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
    DocumentCollaborationConnection,
    DocumentCollaborationEventStub,
} from "~/server/documents/collaboration/document_collaboration_connection.js";
import {DocumentCollaborationContentManager} from "~/server/documents/collaboration/document_collaboration_content_manager.js";
import {WebSocketServer} from "~/server/web_socket/web_socket_server.js";
import {DocumentCollaborationProtocol} from "~/shared/documents/document_collaboration_protocol.js";
import {DocumentContent} from "~/shared/documents/document_content_schema.js";
import {stripDocumentContentStepCommentMarks} from "~/shared/documents/strip_document_content_comment_marks.js";
import {NotFoundError} from "~/shared/error/error.js";
import {emptyArray} from "~/shared/helpers/array/empty_array.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {asyncNoop} from "~/shared/helpers/control/async_noop.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {concatIterables} from "~/shared/helpers/iterable/concat_iterables.js";
import {isId} from "~/shared/id/id.js";
import {DocumentCommentThreadId, DocumentId, SpaceId} from "~/shared/id/types/id_types.js";
import {
    MessagingRealtimeBroadcastCompleteMessageStreamRequestSchema,
    MessagingRealtimeBroadcastNewMessageRequestSchema,
    MessagingRealtimeBroadcastPutMessageStreamPartRequestSchema,
} from "~/shared/messaging/messaging_realtime_protocol.js";
import {getDocumentContentForCollaborationServiceInitialization} from "~/shared/rpc/documents_rpc_definitions.js";
import {Schema} from "~/shared/schema/schema.js";
import {SpellCheckIgnoredLintRealtimeTransactionSchema} from "~/shared/spell_check/spell_check_model.js";

type DocumentCollaborationDurableObjectRoute =
    | "Main"
    | "WithoutComments"
    | "NotFound"
    | "BroadcastSpellCheckRealtimeEventTransaction"
    | {type: "BroadcastNewMessage"; commentThreadId: DocumentCommentThreadId}
    | {type: "BroadcastPutMessageStreamPart"; commentThreadId: DocumentCommentThreadId}
    | {type: "BroadcastCompleteMessageStream"; commentThreadId: DocumentCommentThreadId};

class DocumentCollaborationDurableObject {
    public static readonly serviceName = "DocumentCollaborationService";

    private readonly _processContext: WorkerProcessContext;
    public readonly spaceId: SpaceId;
    public readonly id: DocumentId;
    private readonly _contentManager: DocumentCollaborationContentManager;
    private readonly _destroyCallback: () => void;

    private readonly _webSocketServer: WebSocketServer<
        WorkerProcessContextModules,
        WorkerSessionActionContextModules,
        typeof DocumentCollaborationProtocol,
        DocumentCollaborationEventStub,
        DocumentCollaborationConnection
    >;

    private readonly _webSocketServerWithoutComments: WebSocketServer<
        WorkerProcessContextModules,
        WorkerSessionActionContextModules,
        typeof DocumentCollaborationProtocol,
        DocumentCollaborationEventStub,
        DocumentCollaborationConnection
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
    }): Promise<DocumentCollaborationDurableObject> {
        const documentId = Schema.id<DocumentId>().deserialize(idName);

        const {spaceId, version, content} =
            await getDocumentContentForCollaborationServiceInitialization(initializeActionContext, {
                documentId,
            });

        return new DocumentCollaborationDurableObject({
            processContext,
            spaceId: spaceId,
            id: documentId,
            initialVersion: version,
            initialContent: content,
            destroy,
        });
    }

    private constructor({
        processContext,
        spaceId,
        id,
        initialVersion,
        initialContent,
        destroy,
    }: {
        processContext: WorkerProcessContext;
        spaceId: SpaceId;
        id: DocumentId;
        initialVersion: number;
        initialContent: DocumentContent;
        destroy: () => void;
    }) {
        // Propagate the document id to all logs for this durable object.
        processContext = processContext.tracer.withPropagatedData({
            context: {spaceId, documentId: id},
        });

        this._processContext = processContext;
        this.spaceId = spaceId;
        this.id = id;
        this._contentManager = new DocumentCollaborationContentManager({
            spaceId,
            id,
            initialVersion,
            initialContent,
            killProcess: context => this._destroy(context),
            resetAllAuthorizationTimers: context => {
                for (const connection of concatIterables(
                    this._webSocketServer.iterateAllConnections(),
                    this._webSocketServerWithoutComments.iterateAllConnections(),
                )) {
                    connection.resetAuthorizationTimer(context);
                }
            },
            sendEventToAllAndWait: this._sendEventToAllAndWait.bind(this),
        });
        this._destroyCallback = destroy;

        this._webSocketServer = new WebSocketServer<
            WorkerProcessContextModules,
            WorkerSessionActionContextModules,
            typeof DocumentCollaborationProtocol,
            DocumentCollaborationEventStub,
            DocumentCollaborationConnection
        >(
            this._processContext,
            DocumentCollaborationProtocol,
            ({
                accountId,
                connectionId,
                sendEvent,
                sendEventToOthers,
                iterateOtherConnections,
                resetAuthorizationTimer,
            }) => {
                return new DocumentCollaborationConnection({
                    withoutComments: false,
                    connectionId,
                    accountId,
                    contentManager: this._contentManager,
                    sendEvent,
                    sendEventToOthers: (context, event) => {
                        sendEventToOthers(context, event);

                        if (this._webSocketServerWithoutComments.hasConnections()) {
                            const eventWithoutComments =
                                stripDocumentCollaborationEventComments(event);

                            if (eventWithoutComments !== null) {
                                this._webSocketServerWithoutComments.sendEventToAll(
                                    context,
                                    eventWithoutComments,
                                );
                            }
                        }
                    },
                    iterateOtherConnections: () =>
                        concatIterables(
                            iterateOtherConnections(),
                            this._webSocketServerWithoutComments.iterateAllConnections(),
                        ),
                    resetAuthorizationTimer,
                    killProcess: context => this._destroy(context),
                });
            },
        );

        this._webSocketServerWithoutComments = new WebSocketServer<
            WorkerProcessContextModules,
            WorkerSessionActionContextModules,
            typeof DocumentCollaborationProtocol,
            DocumentCollaborationEventStub,
            DocumentCollaborationConnection
        >(
            this._processContext,
            DocumentCollaborationProtocol,
            ({
                accountId,
                connectionId,
                sendEvent,
                sendEventToOthers,
                iterateOtherConnections,
                resetAuthorizationTimer,
            }) => {
                return new DocumentCollaborationConnection({
                    withoutComments: true,
                    connectionId,
                    accountId,
                    contentManager: this._contentManager,
                    sendEvent,
                    sendEventToOthers: (context, event) => {
                        this._webSocketServer.sendEventToAll(context, event);
                        sendEventToOthers(context, event);
                    },
                    iterateOtherConnections: () =>
                        concatIterables(
                            this._webSocketServer.iterateAllConnections(),
                            iterateOtherConnections(),
                        ),
                    resetAuthorizationTimer,
                    killProcess: context => this._destroy(context),
                });
            },
        );
    }

    public static parseRoute(url: URL): [string, DocumentCollaborationDurableObjectRoute] {
        if (url.pathname === "/") return ["/", "Main"];
        if (url.pathname === "/view") return ["/view", "WithoutComments"];

        if (url.pathname.startsWith("/broadcast-new-message/")) {
            const commentThreadId = url.pathname.slice(23);
            if (isId<DocumentCommentThreadId>(commentThreadId)) {
                return [
                    "/broadcast-new-message/:commentThreadId",
                    {type: "BroadcastNewMessage", commentThreadId},
                ];
            }
        }

        if (url.pathname.startsWith("/broadcast-put-message-stream-part/")) {
            const commentThreadId = url.pathname.slice(35);
            if (isId<DocumentCommentThreadId>(commentThreadId)) {
                return [
                    "/broadcast-put-message-stream-part/:commentThreadId",
                    {type: "BroadcastPutMessageStreamPart", commentThreadId},
                ];
            }
        }

        if (url.pathname.startsWith("/broadcast-complete-message-stream/")) {
            const commentThreadId = url.pathname.slice(35);
            if (isId<DocumentCommentThreadId>(commentThreadId)) {
                return [
                    "/broadcast-complete-message-stream/:commentThreadId",
                    {type: "BroadcastCompleteMessageStream", commentThreadId},
                ];
            }
        }

        if (url.pathname === "/broadcast-spell-check-realtime-event-transaction") {
            return [
                "/broadcast-spell-check-realtime-event-transaction",
                "BroadcastSpellCheckRealtimeEventTransaction",
            ];
        }

        return ["/*", "NotFound"];
    }

    public async fetch(
        context: WorkerActionContext,
        request: Request,
        route: DocumentCollaborationDurableObjectRoute,
    ): Promise<Response> {
        // Propagate the document id to all logs for this durable object.
        context = context.tracer.withPropagatedData({
            context: {spaceId: this.spaceId, documentId: this.id},
        });

        switch (route) {
            case "NotFound": {
                throw new NotFoundError("Route not found");
            }
            case "Main": {
                return this._webSocketServer.upgrade(context.actor.authorizeSession(), request);
            }
            case "WithoutComments": {
                return this._webSocketServerWithoutComments.upgrade(
                    context.actor.authorizeSession(),
                    request,
                );
            }
            case "BroadcastSpellCheckRealtimeEventTransaction": {
                const {eventTransaction, readTime} =
                    SpellCheckIgnoredLintRealtimeTransactionSchema.deserialize(
                        await request.json(),
                    );

                this._webSocketServer.sendEventToAll(context, {
                    type: "SpellCheckRealtimeEventTransaction",
                    readTime,
                    eventTransaction,
                });
                return new Response();
            }
            default: {
                switch (route.type) {
                    case "BroadcastNewMessage": {
                        if (request.method !== "POST") {
                            return new Response("405 Method Not Allowed", {
                                status: 405,
                                headers: {"content-type": "text/plain"},
                            });
                        }

                        const requestBody =
                            MessagingRealtimeBroadcastNewMessageRequestSchema.deserialize(
                                await request.json(),
                            );

                        DocumentCollaborationConnection.broadcastNewMessage(
                            context,
                            route.commentThreadId,
                            requestBody,
                            () => this._webSocketServer.iterateAllConnections(),
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

                        DocumentCollaborationConnection.broadcastPutMessageStreamPart(
                            context,
                            route.commentThreadId,
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

                        DocumentCollaborationConnection.broadcastCompleteMessageStream(
                            context,
                            route.commentThreadId,
                            requestBody,
                            () => this._webSocketServer.iterateAllConnections(),
                        );

                        return new Response(null, {status: 200});
                    }
                    default:
                        throw exhaustive(route);
                }
            }
        }
    }

    public connectForTest(
        context: WorkerSessionActionContext,
        options?: {withoutComments?: boolean},
    ) {
        if (options?.withoutComments) {
            return this._webSocketServerWithoutComments.connectForTest(context);
        } else {
            return this._webSocketServer.connectForTest(context);
        }
    }

    private _destroy(context: WorkerProcessContext) {
        this._webSocketServer.closeAll(context);
        this._webSocketServerWithoutComments.closeAll(context);
        this._destroyCallback();
    }

    private async _sendEventToAllAndWait(
        context: WorkerProcessContext,
        event: DocumentCollaborationEventStub,
    ) {
        await runAllPromises([
            this._webSocketServer.sendEventToAllAndWait(context, event),
            (async () => {
                if (this._webSocketServerWithoutComments.hasConnections()) {
                    const eventWithoutComments = stripDocumentCollaborationEventComments(event);

                    if (eventWithoutComments !== null) {
                        await this._webSocketServerWithoutComments.sendEventToAllAndWait(
                            context,
                            eventWithoutComments,
                        );
                    }
                }
            })(),
        ]);
    }
}

function stripDocumentCollaborationEventComments(
    event: DocumentCollaborationEventStub,
): DocumentCollaborationEventStub | null {
    // Code style: Manually recreate the event objects so that we can be absolutely
    // sure comment data isn't slipping into `eventWithoutComments`. Especially
    // when we add new fields in the future, we want TypeScript to error and the
    // developer to consider whether comment information needs to be stripped.
    switch (event.type) {
        case "UpdateContentWithoutPersistence": {
            return {
                type: "UpdateContentWithoutPersistence",
                newVersion: event.newVersion,
                steps: event.steps.map(stripDocumentContentStepCommentMarks),
                clientId: event.clientId,
                updateOtherPresenceState: event.updateOtherPresenceState,
                resolveCommentThreadIds: emptyArray,
                unresolveCommentThreadIds: emptyArray,
                cleanupInvalidStepCommentThreads: asyncNoop,
            };
        }
        case "PersistedContent": {
            return {
                type: "PersistedContent",
                newVersion: event.newVersion,
                updatedCommentThreads: emptyArray,
            };
        }
        case "UpdateOtherPresenceState": {
            return {
                type: "UpdateOtherPresenceState",
                connectionId: event.connectionId,
                state: event.state,
            };
        }
        case "Error": {
            return {
                type: "Error",
                error: event.error,
            };
        }
        // Never send comment realtime events to view-only clients.
        case "Comments":
        // We don't show lints on view-only clients
        case "SpellCheckRealtimeEventTransaction": {
            return null;
        }
        default:
            throw exhaustive(event);
    }
}

const DocumentCollaborationDurableObjectWrapper = createDurableObject(
    DocumentCollaborationDurableObject,
);
export {DocumentCollaborationDurableObjectWrapper as DocumentCollaborationDurableObject};
