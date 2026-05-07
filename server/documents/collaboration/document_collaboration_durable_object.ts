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
import {
    AccessLevel,
    allAccessLevels,
    hasAccessLevel,
    isAccessLevel,
} from "~/shared/access/access_policy.js";
import {
    DocumentCollaborationProtocol,
    DocumentCollaborationPutContentRequestBodySchema,
    DocumentCollaborationPutContentResponseBodySchema,
} from "~/shared/documents/document_collaboration_protocol.js";
import {
    DocumentContent,
    DocumentContentProsemirrorSchema,
} from "~/shared/documents/document_content_schema.js";
import {stripDocumentContentStepCommentMarks} from "~/shared/documents/strip_document_content_comment_marks.js";
import {InvalidArgumentError, NotFoundError} from "~/shared/error/error.js";
import {isSystemError} from "~/shared/error/is_system_error_code.js";
import {emptyArray} from "~/shared/helpers/array/empty_array.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {asyncNoop} from "~/shared/helpers/control/async_noop.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {concatIterables} from "~/shared/helpers/iterable/concat_iterables.js";
import {flatMapIterable} from "~/shared/helpers/iterable/flat_map_iterable.js";
import {createObjectFromKeys} from "~/shared/helpers/object/create_object_from_keys.js";
import {generateId, isId} from "~/shared/id/id.js";
import {
    AccountId,
    DocumentCommentThreadId,
    DocumentId,
    SpaceId,
} from "~/shared/id/types/id_types.js";
import {
    MessagingRealtimeBroadcastCompleteMessageStreamRequestSchema,
    MessagingRealtimeBroadcastNewMessageRequestSchema,
    MessagingRealtimeBroadcastPutMessageStreamPartRequestSchema,
} from "~/shared/messaging/messaging_realtime_protocol.js";
import {diffProsemirrorNodes} from "~/shared/prosemirror/diff_prosemirror_nodes.js";
import {getDocumentContentForCollaborationServiceInitialization} from "~/shared/rpc/documents_rpc_definitions.js";
import {Schema} from "~/shared/schema/schema.js";
import {SpellCheckIgnoredLintRealtimeTransactionSchema} from "~/shared/spell_check/spell_check_model.js";
import {TracerSpan} from "~/shared/tracer/tracer_span.js";

type DocumentCollaborationDurableObjectRoute =
    | {type: "Main"; accessLevel: AccessLevel | null}
    | {type: "NotFound"}
    | {type: "BroadcastSpellCheckRealtimeEventTransaction"}
    | {type: "BroadcastNewMessage"; commentThreadId: DocumentCommentThreadId}
    | {type: "BroadcastPutMessageStreamPart"; commentThreadId: DocumentCommentThreadId}
    | {type: "BroadcastCompleteMessageStream"; commentThreadId: DocumentCommentThreadId}
    | {type: "PutContent"}
    | {type: "PutContentWithoutOptimisticBroadcast"};

class DocumentCollaborationDurableObject {
    public static readonly serviceName = "DocumentCollaborationService";

    private readonly _processContext: WorkerProcessContext;
    public readonly spaceId: SpaceId;
    public readonly id: DocumentId;
    public readonly _creatorId: AccountId | null;
    private readonly _contentManager: DocumentCollaborationContentManager;
    private readonly _destroyCallback: () => void;

    private readonly _webSocketServerByAccessLevel: Record<
        AccessLevel,
        WebSocketServer<
            WorkerProcessContextModules,
            WorkerSessionActionContextModules,
            typeof DocumentCollaborationProtocol,
            DocumentCollaborationEventStub,
            DocumentCollaborationConnection
        >
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

        const {spaceId, version, content, creatorId} =
            await getDocumentContentForCollaborationServiceInitialization(initializeActionContext, {
                documentId,
            });

        return new DocumentCollaborationDurableObject({
            processContext,
            spaceId: spaceId,
            id: documentId,
            creatorId,
            initialVersion: version,
            initialContent: content,
            destroy,
        });
    }

    private constructor({
        processContext,
        spaceId,
        id,
        creatorId,
        initialVersion,
        initialContent,
        destroy,
    }: {
        processContext: WorkerProcessContext;
        spaceId: SpaceId;
        id: DocumentId;
        creatorId: AccountId | null;
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
        this._creatorId = creatorId;
        this._contentManager = new DocumentCollaborationContentManager({
            spaceId,
            id,
            initialVersion,
            initialContent,
            killProcess: context => this._destroy(context),
            resetAllAuthorizationTimers: context => {
                for (const connection of flatMapIterable(allAccessLevels, accessLevel =>
                    this._webSocketServerByAccessLevel[accessLevel].iterateAllConnections(),
                )) {
                    connection.resetAuthorizationTimer(context);
                }
            },
            sendEventToAllAndWait: this._sendEventToAllAndWait.bind(this),
        });
        this._destroyCallback = destroy;

        this._webSocketServerByAccessLevel = createObjectFromKeys(allAccessLevels, accessLevel => {
            return new WebSocketServer<
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
                        accessLevel,
                        connectionId,
                        accountId,
                        contentManager: this._contentManager,
                        sendEvent,
                        sendEventToOthers: (context, event) => {
                            sendEventToOthers(context, event);

                            for (const otherAccessLevel of allAccessLevels) {
                                if (otherAccessLevel === accessLevel) continue;

                                const otherWebSocketServer =
                                    this._webSocketServerByAccessLevel[otherAccessLevel];

                                if (!otherWebSocketServer.hasConnections()) continue;

                                // If this WebSocket server has comment access but the other doesn't then strip any
                                // comments from the event before sending it to peer WebSockets of different access
                                // levels.
                                if (
                                    hasAccessLevel(accessLevel, "Comment") &&
                                    !hasAccessLevel(otherAccessLevel, "Comment")
                                ) {
                                    const eventWithoutComments =
                                        stripDocumentCollaborationEventComments(event);

                                    if (eventWithoutComments !== null) {
                                        otherWebSocketServer.sendEventToAll(
                                            context,
                                            eventWithoutComments,
                                        );
                                    }
                                } else {
                                    otherWebSocketServer.sendEventToAll(context, event);
                                }
                            }
                        },
                        iterateOtherConnections: () =>
                            concatIterables(
                                iterateOtherConnections(),
                                flatMapIterable(allAccessLevels, otherAccessLevel => {
                                    if (otherAccessLevel === accessLevel) return emptyArray;

                                    const otherWebSocketServer =
                                        this._webSocketServerByAccessLevel[otherAccessLevel];

                                    return otherWebSocketServer.iterateAllConnections();
                                }),
                            ),
                        resetAuthorizationTimer,
                        killProcess: context => this._destroy(context),
                    });
                },
            );
        });
    }

    public static parseRoute(url: URL): [string, DocumentCollaborationDurableObjectRoute] {
        if (url.pathname === "/") {
            const accessSearchParam = url.searchParams.get("access");
            const accessLevel =
                accessSearchParam && isAccessLevel(accessSearchParam) ? accessSearchParam : null;
            return ["/", {type: "Main", accessLevel}];
        }

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

        if (url.pathname === "/put-content") {
            return ["/put-content", {type: "PutContent"}];
        }

        if (url.pathname === "/put-content-without-optimistic-broadcast") {
            return [
                "/put-content-without-optimistic-broadcast",
                {type: "PutContentWithoutOptimisticBroadcast"},
            ];
        }

        if (url.pathname === "/broadcast-spell-check-realtime-event-transaction") {
            return [
                "/broadcast-spell-check-realtime-event-transaction",
                {type: "BroadcastSpellCheckRealtimeEventTransaction"},
            ];
        }

        return ["/*", {type: "NotFound"}];
    }

    public async fetch(
        context: WorkerActionContext,
        request: Request,
        route: DocumentCollaborationDurableObjectRoute,
        span: TracerSpan,
    ): Promise<Response> {
        // Propagate the document id to all logs for this durable object.
        context = context.tracer.withPropagatedData({
            context: {spaceId: this.spaceId, documentId: this.id},
        });

        switch (route.type) {
            case "NotFound": {
                throw new NotFoundError("Route not found");
            }
            case "Main": {
                if (!route.accessLevel)
                    throw new InvalidArgumentError("Invalid `access` search param");

                return this._webSocketServerByAccessLevel[route.accessLevel].upgrade(
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

                DocumentCollaborationConnection.broadcastNewMessage(
                    context,
                    route.commentThreadId,
                    requestBody,
                    () => {
                        return flatMapIterable(allAccessLevels, accessLevel => {
                            if (!hasAccessLevel(accessLevel, "Comment")) return emptyArray;

                            const webSocketServer = this._webSocketServerByAccessLevel[accessLevel];
                            return webSocketServer.iterateAllConnections();
                        });
                    },
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
                    () => {
                        return flatMapIterable(allAccessLevels, accessLevel => {
                            if (!hasAccessLevel(accessLevel, "Comment")) return emptyArray;

                            const webSocketServer = this._webSocketServerByAccessLevel[accessLevel];
                            return webSocketServer.iterateAllConnections();
                        });
                    },
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
                    () => {
                        return flatMapIterable(allAccessLevels, accessLevel => {
                            if (!hasAccessLevel(accessLevel, "Comment")) return emptyArray;

                            const webSocketServer = this._webSocketServerByAccessLevel[accessLevel];
                            return webSocketServer.iterateAllConnections();
                        });
                    },
                );

                return new Response(null, {status: 200});
            }
            case "BroadcastSpellCheckRealtimeEventTransaction": {
                const {eventTransaction} =
                    SpellCheckIgnoredLintRealtimeTransactionSchema.deserialize(
                        await request.json(),
                    );

                for (const accessLevel of allAccessLevels) {
                    const webSocketServer = this._webSocketServerByAccessLevel[accessLevel];

                    webSocketServer.sendEventToAll(context, {
                        type: "SpellCheckRealtimeEventTransaction",
                        eventTransaction,
                    });
                }

                return new Response();
            }
            case "PutContent": {
                if (request.method !== "POST") {
                    return new Response("405 Method Not Allowed", {
                        status: 405,
                        headers: {"content-type": "text/plain"},
                    });
                }

                try {
                    const accountContext = context.actor.authorizeAccount();

                    const requestBody =
                        DocumentCollaborationPutContentRequestBodySchema.deserialize(
                            await request.json(),
                        );

                    const oldContent = await this._contentManager.getContentAtVersion(
                        accountContext,
                        requestBody.version,
                    );

                    const requestContent = DocumentContentProsemirrorSchema.nodes.doc.create(
                        // This method isn't currently allowed to update document attributes like
                        // `AccessPolicy`.
                        oldContent.attrs,
                        requestBody.content,
                    );

                    const steps = diffProsemirrorNodes(oldContent, requestContent);

                    const {newVersion, newContent, persistencePromise} =
                        await this._contentManager.update(accountContext, null, {
                            version: requestBody.version,
                            steps,
                            clientId: generateId(),
                            createCommentThreads: [],
                            intentionallyUpdateAccessPolicy: null,
                            updateOurPresenceState: {state: null},
                        });

                    // Wait for our update to actually persist before responding. This endpoint is
                    // called by the API which provides read-after-write semantics to API clients.
                    await persistencePromise;

                    return new Response(
                        JSON.stringify(
                            DocumentCollaborationPutContentResponseBodySchema.serialize({
                                ok: true,
                                spaceId: this.spaceId,
                                creatorId: this._creatorId,
                                newVersion,
                                newContent,
                            }),
                        ),
                        {
                            status: 200,
                            headers: {"content-type": "application/json"},
                        },
                    );
                } catch (error) {
                    span.addException(error);

                    return new Response(
                        JSON.stringify(
                            DocumentCollaborationPutContentResponseBodySchema.serialize({
                                ok: false,
                                error,
                            }),
                        ),
                        {
                            status: isSystemError(error) ? 500 : 400,
                            headers: {"content-type": "application/json"},
                        },
                    );
                }
            }
            case "PutContentWithoutOptimisticBroadcast": {
                if (request.method !== "POST") {
                    return new Response("405 Method Not Allowed", {
                        status: 405,
                        headers: {"content-type": "text/plain"},
                    });
                }

                const accountContext = context.actor.authorizeAccount();

                const requestBody =
                    DocumentCollaborationProtocol.procedureSchemas.updateContentWithoutOptimisticBroadcast.inputSchema.deserialize(
                        await request.json(),
                    );

                const {newVersion, getDynamoGeneralRealtimeEventTransactionForSite} =
                    await this._contentManager.updateAndWaitForPersistence(
                        accountContext,
                        null,
                        requestBody,
                    );

                const eventTransactionForSite =
                    await getDynamoGeneralRealtimeEventTransactionForSite();

                return new Response(
                    JSON.stringify(
                        DocumentCollaborationProtocol.procedureSchemas.updateContentWithoutOptimisticBroadcast.outputSchema.serialize(
                            {newVersion, eventTransactionForSite},
                        ),
                    ),
                    {status: 200},
                );
            }
            default:
                throw exhaustive(route);
        }
    }

    public connectForTest(
        context: WorkerSessionActionContext,
        {accessLevel = "Manage"}: {accessLevel?: AccessLevel} = {},
    ) {
        return this._webSocketServerByAccessLevel[accessLevel].connectForTest(context);
    }

    private _destroy(context: WorkerProcessContext) {
        for (const accessLevel of allAccessLevels) {
            this._webSocketServerByAccessLevel[accessLevel].closeAll(context);
        }
        this._destroyCallback();
    }

    private async _sendEventToAllAndWait(
        context: WorkerProcessContext,
        event: DocumentCollaborationEventStub,
    ) {
        await runAllPromises(
            allAccessLevels.map(async accessLevel => {
                const webSocketServer = this._webSocketServerByAccessLevel[accessLevel];

                if (hasAccessLevel(accessLevel, "Comment")) {
                    await webSocketServer.sendEventToAllAndWait(context, event);
                } else if (webSocketServer.hasConnections()) {
                    const eventWithoutComments = stripDocumentCollaborationEventComments(event);

                    if (eventWithoutComments !== null) {
                        await webSocketServer.sendEventToAllAndWait(context, eventWithoutComments);
                    }
                }
            }),
        );
    }
}

function stripDocumentCollaborationEventComments(
    event: DocumentCollaborationEventStub,
): DocumentCollaborationEventStub | null {
    // Code style: Manually recreate the event objects so that we can be absolutely
    // sure comment data isn't slipping into `eventWithoutComments`. Especially when we
    // add new fields in the future, we want TypeScript to error and the developer to
    // consider whether comment information needs to be stripped.
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
