import {AddMarkStep, AddNodeMarkStep} from "prosemirror-transform";
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
import {ApiContentKeyDecoder} from "~/shared/api/content/closed_source/api_content_key_encoder.js";
import {getApiContentPositionPosWithDecodedKey} from "~/shared/api/content/closed_source/get_api_content_position_pos.js";
import {
    DocumentCollaborationCreateCommentThreadForApiRequestBodySchema,
    DocumentCollaborationCreateCommentThreadForApiResponseBodySchema,
    DocumentCollaborationProtocol,
    DocumentCollaborationSetCommentThreadResolvedRequestBodySchema,
    DocumentCollaborationSetCommentThreadResolvedResponseBodySchema,
    DocumentCollaborationUpdateContentWithDiffRequestBodySchema,
    DocumentCollaborationUpdateContentWithDiffResponseBodySchema,
} from "~/shared/documents/document_collaboration_protocol.js";
import {
    DocumentContent,
    DocumentContentProsemirrorSchema,
} from "~/shared/documents/document_content_schema.js";
import {stripDocumentContentStepCommentMarks} from "~/shared/documents/strip_document_content_comment_marks.js";
import {InvalidArgumentError, NotFoundError} from "~/shared/error/error.open_source.js";
import {errorDisplayMessage} from "~/shared/error/error_display_message.open_source.js";
import {isSystemError} from "~/shared/error/is_system_error_code.open_source.js";
import {emptyArray} from "~/shared/helpers/array/empty_array.open_source.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.open_source.js";
import {assert} from "~/shared/helpers/control/assert.open_source.js";
import {asyncNoop} from "~/shared/helpers/control/async_noop.open_source.js";
import {unwrapResult} from "~/shared/helpers/control/capture_result.open_source.js";
import {captureResultPromise} from "~/shared/helpers/control/capture_result_promise.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.open_source.js";
import {concatIterables} from "~/shared/helpers/iterable/concat_iterables.open_source.js";
import {flatMapIterable} from "~/shared/helpers/iterable/flat_map_iterable.open_source.js";
import {createObjectFromKeys} from "~/shared/helpers/object/create_object_from_keys.js";
import {generateId, isId} from "~/shared/id/id.open_source.js";
import {
    AccountId,
    DocumentCommentThreadId,
    DocumentId,
    SpaceId,
} from "~/shared/id/types/id_types.open_source.js";
import {
    MessagingRealtimeBroadcastCompleteMessageStreamRequestSchema,
    MessagingRealtimeBroadcastNewMessageRequestSchema,
    MessagingRealtimeBroadcastPutMessageStreamPartRequestSchema,
} from "~/shared/messaging/messaging_realtime_protocol.js";
import {diffProsemirrorNodes} from "~/shared/prosemirror/diff_prosemirror_nodes.js";
import {
    AddMarksAfterRemoveAllStep,
    RemoveAllMarksStep,
} from "~/shared/prosemirror/remove_all_marks_step.js";
import {
    authorizeDocumentAccess,
    getDocumentContentForCollaborationServiceInitialization,
    getResolvedDocumentCommentThreadRanges,
} from "~/shared/rpc/documents_rpc_definitions.js";
import {Schema} from "~/shared/schema/schema.js";
import {SpellCheckIgnoredLintRealtimeTransactionSchema} from "~/shared/spell_check/spell_check_model.js";
import {TracerSpan} from "~/shared/tracer/tracer_span.open_source.js";

type DocumentCollaborationDurableObjectRoute =
    | {type: "Main"; accessLevel: AccessLevel | null}
    | {type: "NotFound"}
    | {type: "BroadcastSpellCheckRealtimeEvents"}
    | {type: "BroadcastNewMessage"; commentThreadId: DocumentCommentThreadId}
    | {type: "BroadcastPutMessageStreamPart"; commentThreadId: DocumentCommentThreadId}
    | {type: "BroadcastCompleteMessageStream"; commentThreadId: DocumentCommentThreadId}
    | {type: "SetCommentThreadResolved"; commentThreadId: DocumentCommentThreadId}
    | {type: "UpdateContentWithDiff"}
    | {type: "UpdateContentWithoutOptimisticBroadcast"}
    | {type: "CreateCommentThreadForApi"}
    | {type: "ResetForTest"};

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

        const setCommentThreadResolvedPathPrefix = "/set-comment-thread-resolved/";
        if (url.pathname.startsWith(setCommentThreadResolvedPathPrefix)) {
            const commentThreadId = url.pathname.slice(setCommentThreadResolvedPathPrefix.length);
            if (isId<DocumentCommentThreadId>(commentThreadId)) {
                return [
                    "/set-comment-thread-resolved/:commentThreadId",
                    {type: "SetCommentThreadResolved", commentThreadId},
                ];
            }
        }

        if (url.pathname === "/update-content-with-diff") {
            return ["/update-content-with-diff", {type: "UpdateContentWithDiff"}];
        }

        if (url.pathname === "/update-content-without-optimistic-broadcast") {
            return [
                "/update-content-without-optimistic-broadcast",
                {type: "UpdateContentWithoutOptimisticBroadcast"},
            ];
        }

        if (url.pathname === "/create-comment-thread-for-api") {
            return ["/create-comment-thread-for-api", {type: "CreateCommentThreadForApi"}];
        }

        if (url.pathname === "/reset-for-test") {
            return ["/reset-for-test", {type: "ResetForTest"}];
        }

        if (url.pathname === "/broadcast-spell-check-realtime-event-transaction") {
            return [
                "/broadcast-spell-check-realtime-event-transaction",
                {type: "BroadcastSpellCheckRealtimeEvents"},
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

                return await this._webSocketServerByAccessLevel[route.accessLevel].upgrade(
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
            case "BroadcastSpellCheckRealtimeEvents": {
                const {events} = SpellCheckIgnoredLintRealtimeTransactionSchema.deserialize(
                    await request.json(),
                );

                for (const accessLevel of allAccessLevels) {
                    const webSocketServer = this._webSocketServerByAccessLevel[accessLevel];

                    webSocketServer.sendEventToAll(context, {
                        type: "SpellCheckRealtimeEvents",
                        events,
                    });
                }

                return new Response();
            }
            case "UpdateContentWithDiff": {
                if (request.method !== "POST") {
                    return new Response("405 Method Not Allowed", {
                        status: 405,
                        headers: {"content-type": "text/plain"},
                    });
                }

                try {
                    const accountContext = context.actor.authorizeAccount();

                    const requestBody =
                        DocumentCollaborationUpdateContentWithDiffRequestBodySchema.deserialize(
                            await request.json(),
                        );

                    if (requestBody.title === undefined && requestBody.content === undefined) {
                        throw new InvalidArgumentError(
                            "A document content update must update the title or body content",
                        );
                    }

                    // Authorizing document access is a round-trip to AWS. Run it in parallel with
                    // computing and applying the update to avoid an extra serial round-trip. The
                    // `update()` call awaits `authorizationPromise` before mutating any durable object
                    // state so an account without access can't put the durable object in a bad state.
                    const authorizationPromise = authorizeDocumentAccess(accountContext, {
                        documentId: this._contentManager.id,
                        expectedAccessLevel: "Edit",
                    });

                    const [, {newVersion, newContent, persistencePromise}] = await runAllPromises([
                        authorizationPromise,
                        (async () => {
                            const oldContent = await this._contentManager.getContentAtVersion(
                                accountContext,
                                requestBody.version,
                            );

                            const titleNode =
                                requestBody.title === undefined
                                    ? oldContent.child(0)
                                    : DocumentContentProsemirrorSchema.nodes.title.create(
                                          null,
                                          requestBody.title.length > 0
                                              ? DocumentContentProsemirrorSchema.text(
                                                    requestBody.title,
                                                )
                                              : null,
                                      );

                            const bodyNodes =
                                requestBody.content ?? oldContent.content.content.slice(1);

                            const requestContent =
                                DocumentContentProsemirrorSchema.nodes.doc.create(
                                    // This method isn't currently allowed to update document attributes like
                                    // `AccessPolicy`.
                                    oldContent.attrs,
                                    [titleNode, ...bodyNodes],
                                );

                            const steps = diffProsemirrorNodes(oldContent, requestContent);

                            return await this._contentManager.update(accountContext, null, {
                                version: requestBody.version,
                                steps,
                                clientId: generateId(),
                                createCommentThreads: [],
                                intentionallyUpdateAccessPolicy: null,
                                intentionallyUpdateDeletedTime: null,
                                updateOurPresenceState: {state: null},
                                validationPromise: authorizationPromise,
                            });
                        })(),
                    ]);

                    // Very important! Wait for our update to actually persist before responding. This
                    // endpoint is called by the API which provides read-after-write semantics to API
                    // clients.
                    await persistencePromise;

                    return new Response(
                        JSON.stringify(
                            DocumentCollaborationUpdateContentWithDiffResponseBodySchema.serialize({
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
                            DocumentCollaborationUpdateContentWithDiffResponseBodySchema.serialize({
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
            case "UpdateContentWithoutOptimisticBroadcast": {
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

                const {newVersion, getRynamoEventsForSite} =
                    await this._contentManager.updateAndWaitForPersistence(
                        accountContext,
                        null,
                        requestBody,
                    );

                const eventsForSite = await getRynamoEventsForSite();

                return new Response(
                    JSON.stringify(
                        DocumentCollaborationProtocol.procedureSchemas.updateContentWithoutOptimisticBroadcast.outputSchema.serialize(
                            {newVersion, eventsForSite},
                        ),
                    ),
                    {status: 200},
                );
            }
            case "SetCommentThreadResolved": {
                if (request.method !== "POST") {
                    return new Response("405 Method Not Allowed", {
                        status: 405,
                        headers: {"content-type": "text/plain"},
                    });
                }

                try {
                    const accountContext = context.actor.authorizeAccount();

                    const {resolved} =
                        DocumentCollaborationSetCommentThreadResolvedRequestBodySchema.deserialize(
                            await request.json(),
                        );

                    if (resolved) {
                        // We use a `null` `connectionId` and generate a new `clientId` because the client
                        // doesn't know about these update steps. It needs to apply the realtime update for
                        // the `RemoveAllMarksStep` along with all other clients. We also don't update the
                        // client's presence state along with these updates.
                        await this._contentManager.updateAndWaitForPersistence(
                            accountContext,
                            null,
                            {
                                version: this._contentManager.getCurrentVersion(),
                                steps: [
                                    new RemoveAllMarksStep(
                                        DocumentContentProsemirrorSchema.marks.comment.create({
                                            commentThreadId: route.commentThreadId,
                                        }),
                                    ),
                                ],
                                clientId: generateId(),
                                createCommentThreads: [],
                                intentionallyUpdateAccessPolicy: null,
                                intentionallyUpdateDeletedTime: null,
                                resolveCommentThreadIds: [route.commentThreadId],
                                updateOurPresenceState: {state: null},
                            },
                        );
                    } else {
                        // NOTE(calebmer): Warning! Calling an RPC here creates a network waterfall which
                        // can be slow. The network flow is:
                        //
                        // 1. RPC `getResolvedDocumentCommentThreadRanges`
                        //     - Cloudflare `DocumentCollaborationService` → AWS `AppService`
                        //     - AWS `AppService` → Cloudflare `DocumentCollaborationService`
                        // 2. RPC `updateDocumentContent`
                        //     - Cloudflare `DocumentCollaborationService` → AWS `AppService`
                        //     - AWS `AppService` → Cloudflare `DocumentCollaborationService`
                        //
                        // Given this Durable Object runs on the edge this doubles the network latency
                        // penalty from Cloudflare to AWS. Ideally we'd only make one network request to
                        // app service per procedure.
                        //
                        // Since this procedure is relatively uncommon and our document collaboration
                        // service needs to know which steps to commit before calling back to app service,
                        // we tolerate this.
                        const {version, ranges} = await getResolvedDocumentCommentThreadRanges(
                            accountContext,
                            {
                                documentId: this._contentManager.id,
                                commentThreadId: route.commentThreadId,
                            },
                        );

                        // We use a `null` `connectionId` and generate a new `clientId` because the client
                        // doesn't know about these update steps. It needs to apply the realtime update for
                        // the `AddMarksAfterRemoveAllStep` along with all other clients. We also don't
                        // update the client's presence state along with these updates.
                        await this._contentManager.updateAndWaitForPersistence(
                            accountContext,
                            null,
                            {
                                // This update runs at an old version. The ranges will need to be rebased with all
                                // updates that have happened since that old version.
                                version,
                                steps: [
                                    new AddMarksAfterRemoveAllStep(
                                        DocumentContentProsemirrorSchema.marks.comment.create({
                                            commentThreadId: route.commentThreadId,
                                        }),
                                        ranges,
                                    ),
                                ],
                                clientId: generateId(),
                                createCommentThreads: [],
                                intentionallyUpdateAccessPolicy: null,
                                intentionallyUpdateDeletedTime: null,
                                unresolveCommentThreadIds: [route.commentThreadId],
                                updateOurPresenceState: {state: null},
                            },
                        );
                    }

                    return new Response(
                        JSON.stringify(
                            DocumentCollaborationSetCommentThreadResolvedResponseBodySchema.serialize(
                                {ok: true},
                            ),
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
                            DocumentCollaborationSetCommentThreadResolvedResponseBodySchema.serialize(
                                {ok: false, error},
                            ),
                        ),
                        {
                            status: isSystemError(error) ? 500 : 400,
                            headers: {"content-type": "application/json"},
                        },
                    );
                }
            }
            case "CreateCommentThreadForApi": {
                if (request.method !== "POST") {
                    return new Response("405 Method Not Allowed", {
                        status: 405,
                        headers: {"content-type": "text/plain"},
                    });
                }

                try {
                    const accountContext = context.actor.authorizeAccount();

                    const requestBody =
                        DocumentCollaborationCreateCommentThreadForApiRequestBodySchema.deserialize(
                            await request.json(),
                        );

                    // Authorizing document access is a round-trip to AWS. Run it in parallel with
                    // computing and applying the update to avoid an extra serial round-trip. The
                    // `update()` call awaits `authorizationPromise` before mutating any durable object
                    // state so an account without access can't put the durable object in a bad state.
                    const authorizationPromise = authorizeDocumentAccess(accountContext, {
                        documentId: this._contentManager.id,
                        expectedAccessLevel: "Comment",
                    });

                    const [, responseResult] = await runAllPromises([
                        authorizationPromise,
                        captureResultPromise(
                            (async () => {
                                const decoder = new ApiContentKeyDecoder(`Document:${this.id}`);
                                const startDecodedKey = decoder.decode(requestBody.range.start.key);
                                const endDecodedKey = decoder.decode(requestBody.range.end.key);

                                if (startDecodedKey.version !== endDecodedKey.version) {
                                    throw new InvalidArgumentError(
                                        "Range content keys are for different document versions",
                                        {
                                            displayMessage: errorDisplayMessage`Range content keys are for different document versions. Try again with range start/end keys from the same document version.`,
                                        },
                                    );
                                }

                                const {version} = startDecodedKey;

                                if (version > this._contentManager.getCurrentVersion()) {
                                    throw new InvalidArgumentError(
                                        "Range content key document version is higher than the current document version",
                                        {
                                            displayMessage: errorDisplayMessage`Range content key document version is higher than the current document version. Try again with range start/end keys from the current document version.`,
                                        },
                                    );
                                }

                                const content = await this._contentManager.getContentAtVersion(
                                    accountContext,
                                    startDecodedKey.version,
                                );

                                const from = getApiContentPositionPosWithDecodedKey(
                                    startDecodedKey,
                                    requestBody.range.start,
                                );
                                const to = getApiContentPositionPosWithDecodedKey(
                                    endDecodedKey,
                                    requestBody.range.end,
                                );

                                if (from > to) {
                                    throw new InvalidArgumentError(
                                        "Range start position is greater than range end position",
                                        {
                                            displayMessage: errorDisplayMessage`Range start position is greater than range end position. Try again but swap the order of the start/end positions.`,
                                        },
                                    );
                                }

                                if (from === to) {
                                    throw new InvalidArgumentError(
                                        "Range start position is equal to range end position",
                                        {
                                            displayMessage: errorDisplayMessage`Range is empty because the start position is equal to the range end position. Try again but with a non-empty range.`,
                                        },
                                    );
                                }

                                const commentThreadId = generateId<DocumentCommentThreadId>();
                                const commentMark =
                                    DocumentContentProsemirrorSchema.marks.comment.create({
                                        commentThreadId,
                                    });

                                // A target range can contain both inline content and markable leaf nodes such as
                                // files. `AddMarkStep` marks all inline descendants, but ProseMirror requires a
                                // separate `AddNodeMarkStep` for each leaf node that is completely enclosed by the
                                // range.
                                const steps: Array<AddMarkStep | AddNodeMarkStep> = [];
                                let hasInlineContent = false;

                                content.nodesBetween(from, to, (node, pos) => {
                                    if (node.isInline) hasInlineContent = true;

                                    if (
                                        !node.isInline &&
                                        node.isLeaf &&
                                        node.type.allowsMarkType(commentMark.type) &&
                                        from <= pos &&
                                        pos + node.nodeSize <= to
                                    ) {
                                        steps.push(new AddNodeMarkStep(pos, commentMark));
                                    }
                                });

                                if (hasInlineContent) {
                                    // Mark steps do not move document positions, so the inline and node steps can all
                                    // use coordinates from the requested version.
                                    steps.unshift(new AddMarkStep(from, to, commentMark));
                                }

                                const {commentThreadCreatedTime, persistencePromise} =
                                    await this._contentManager.update(accountContext, null, {
                                        version,
                                        steps,
                                        clientId: generateId(),
                                        createCommentThreads: [
                                            {
                                                commentThreadId,
                                                createdTimeZone: requestBody.createdTimeZone,
                                                initialCommentContent: requestBody.content,
                                                initialCommentFileIds: requestBody.fileIds,
                                                attachInitialCommentFilesAsBot: true,
                                            },
                                        ],
                                        intentionallyUpdateAccessPolicy: null,
                                        intentionallyUpdateDeletedTime: null,
                                        updateOurPresenceState: {state: null},
                                        validationPromise: authorizationPromise,
                                    });

                                // Very important! Wait for our update to actually persist before responding. This
                                // endpoint is called by the API which provides read-after-write semantics to API
                                // clients.
                                await persistencePromise;

                                return new Response(
                                    JSON.stringify(
                                        DocumentCollaborationCreateCommentThreadForApiResponseBodySchema.serialize(
                                            {
                                                ok: true,
                                                spaceId: this.spaceId,
                                                commentThread: {
                                                    id: commentThreadId,
                                                    createdTime: commentThreadCreatedTime,
                                                },
                                            },
                                        ),
                                    ),
                                    {status: 200, headers: {"content-type": "application/json"}},
                                );
                            })(),
                        ),
                    ]);

                    return unwrapResult(responseResult);
                } catch (error) {
                    span.addException(error);

                    return new Response(
                        JSON.stringify(
                            DocumentCollaborationCreateCommentThreadForApiResponseBodySchema.serialize(
                                {ok: false, error},
                            ),
                        ),
                        {
                            status: isSystemError(error) ? 500 : 200,
                            headers: {"content-type": "application/json"},
                        },
                    );
                }
            }
            case "ResetForTest": {
                // Integration tests mutate document content directly in the database (e.g. adding
                // a document to a site), which desyncs this durable object's authoritative
                // in-memory version. Tests call this route to evict the durable object so the next
                // request reinitializes it fresh from the database. In production the durable
                // object is the sole writer, so this is never needed — gate it off there.
                // (`process.env.NODE_ENV` is baked into the edge bundle at build time, so this is
                // the standard non-production check in the edge service; it is never `"test"`
                // here.)
                //
                // The alternative to this test-only route would be to route `TestDocument`'s
                // content mutations through the durable object (like production does) so it never
                // goes stale, instead of writing them straight to the database. That's a broader
                // change to the test helpers, so we evict here instead.
                assert(
                    process.env.NODE_ENV !== "production",
                    "The `/reset-for-test` route is not available in production",
                );

                this._destroy(context);

                return new Response(JSON.stringify(null), {
                    status: 200,
                    headers: {"content-type": "application/json"},
                });
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
        case "SpellCheckRealtimeEvents": {
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
