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
import {getApiContentRange} from "~/shared/api/content/get_api_content_range.js";
import {
    DocumentCollaborationCreateCommentThreadForApiRequestBodySchema,
    DocumentCollaborationCreateCommentThreadForApiResponseBodySchema,
    DocumentCollaborationProtocol,
    DocumentCollaborationUpdateContentWithDiffRequestBodySchema,
    DocumentCollaborationUpdateContentWithDiffResponseBodySchema,
} from "~/shared/documents/document_collaboration_protocol.js";
import {
    DocumentContent,
    DocumentContentProsemirrorSchema,
} from "~/shared/documents/document_content_schema.js";
import {getDocumentCommentThreadSnippetAtPos} from "~/shared/documents/get_document_comment_thread_snippet_at_pos.js";
import {stripDocumentContentStepCommentMarks} from "~/shared/documents/strip_document_content_comment_marks.js";
import {InvalidArgumentError, NotFoundError} from "~/shared/error/error.js";
import {errorDisplayMessage} from "~/shared/error/error_display_message.js";
import {isSystemError} from "~/shared/error/is_system_error_code.js";
import {emptyArray} from "~/shared/helpers/array/empty_array.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {asyncNoop} from "~/shared/helpers/control/async_noop.js";
import {captureResultPromise} from "~/shared/helpers/control/capture_result_promise.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {concatIterables} from "~/shared/helpers/iterable/concat_iterables.js";
import {flatMapIterable} from "~/shared/helpers/iterable/flat_map_iterable.js";
import {emptyMap} from "~/shared/helpers/map/empty_map.js";
import {createObjectFromKeys} from "~/shared/helpers/object/create_object_from_keys.js";
import {generateId, isId} from "~/shared/id/id.js";
import {
    AccountId,
    DocumentCommentThreadId,
    DocumentId,
    FileId,
    SpaceId,
} from "~/shared/id/types/id_types.js";
import {
    MessagingRealtimeBroadcastCompleteMessageStreamRequestSchema,
    MessagingRealtimeBroadcastNewMessageRequestSchema,
    MessagingRealtimeBroadcastPutMessageStreamPartRequestSchema,
} from "~/shared/messaging/messaging_realtime_protocol.js";
import {diffProsemirrorNodes} from "~/shared/prosemirror/diff_prosemirror_nodes.js";
import {trimSpacesFromProsemirrorRange} from "~/shared/prosemirror/trim_spaces_from_prosemirror_range.js";
import {emptyReactionSet} from "~/shared/reactions/reaction_set.js";
import {
    authorizeDocumentAccess,
    getDocumentContentForCollaborationServiceInitialization,
} from "~/shared/rpc/documents_rpc_definitions.js";
import {getFileWithoutSignedUrlFromAttachment} from "~/shared/rpc/files_rpc_definitions.js";
import {Schema} from "~/shared/schema/schema.js";
import {SpellCheckIgnoredLintRealtimeTransactionSchema} from "~/shared/spell_check/spell_check_model.js";
import {TracerSpan} from "~/shared/tracer/tracer_span.js";

type DocumentCollaborationDurableObjectRoute =
    | {type: "Main"; accessLevel: AccessLevel | null}
    | {type: "NotFound"}
    | {type: "BroadcastSpellCheckRealtimeEvents"}
    | {type: "BroadcastNewMessage"; commentThreadId: DocumentCommentThreadId}
    | {type: "BroadcastPutMessageStreamPart"; commentThreadId: DocumentCommentThreadId}
    | {type: "BroadcastCompleteMessageStream"; commentThreadId: DocumentCommentThreadId}
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

                            const requestContent =
                                DocumentContentProsemirrorSchema.nodes.doc.create(
                                    // This method isn't currently allowed to update document attributes like
                                    // `AccessPolicy`.
                                    oldContent.attrs,
                                    requestBody.content,
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

                    // Wait for our update to actually persist before responding. This endpoint is
                    // called by the API which provides read-after-write semantics to API clients.
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

                    const authorizationPromise = authorizeDocumentAccess(accountContext, {
                        documentId: this._contentManager.id,
                        expectedAccessLevel: "Comment",
                    });

                    const [authorizationResult, apiContentRangeResult] = await runAllPromises([
                        captureResultPromise(authorizationPromise),
                        captureResultPromise(
                            getApiContentRange({
                                entityId: `Document:${this.id}`,
                                latestVersion: this._contentManager.getCurrentVersion(),
                                range: requestBody.range,
                                getContentAtVersion: version =>
                                    this._contentManager.getContentAtVersion(
                                        accountContext,
                                        version,
                                    ),
                            }),
                        ),
                    ]);
                    if (!authorizationResult.ok) throw authorizationResult.error;
                    if (!apiContentRangeResult.ok) throw apiContentRangeResult.error;
                    const apiContentRange = apiContentRangeResult.value;
                    const commentRange = trimSpacesFromProsemirrorRange(
                        apiContentRange.contentAtVersion,
                        apiContentRange,
                    );
                    const selectedContent = apiContentRange.contentAtVersion.textBetween(
                        commentRange.from,
                        commentRange.to,
                        "",
                        "\uFFFC",
                    );

                    if (
                        commentRange.from >= commentRange.to ||
                        (!selectedContent.includes("\uFFFC") && !/\S/u.test(selectedContent))
                    ) {
                        throw new InvalidArgumentError(
                            "Item target range must include at least one non-space character",
                            {
                                displayMessage: errorDisplayMessage`Item target range must include at least one non-space character.`,
                            },
                        );
                    }

                    const commentThreadId = generateId<DocumentCommentThreadId>();
                    const commentMark = DocumentContentProsemirrorSchema.marks.comment.create({
                        commentThreadId,
                    });

                    // A target range can contain both inline content and markable leaf nodes such as
                    // files. `AddMarkStep` marks all inline descendants, but ProseMirror requires a
                    // separate `AddNodeMarkStep` for each leaf node that is completely enclosed by the
                    // range.
                    const commentSteps: Array<AddMarkStep | AddNodeMarkStep> = [];
                    let hasInlineContent = false;

                    apiContentRange.contentAtVersion.nodesBetween(
                        commentRange.from,
                        commentRange.to,
                        (node, pos) => {
                            if (node.isInline) hasInlineContent = true;

                            if (
                                !node.isInline &&
                                node.isLeaf &&
                                node.type.allowsMarkType(commentMark.type) &&
                                commentRange.from <= pos &&
                                pos + node.nodeSize <= commentRange.to
                            ) {
                                commentSteps.push(new AddNodeMarkStep(pos, commentMark));
                            }
                        },
                    );

                    if (hasInlineContent) {
                        // Mark steps do not move document positions, so the inline and node steps can all
                        // use coordinates from the requested version.
                        commentSteps.unshift(
                            new AddMarkStep(commentRange.from, commentRange.to, commentMark),
                        );
                    }

                    const {
                        newVersion,
                        newContent: newDocumentContent,
                        steps,
                        createdCommentThreadTime,
                        persistencePromise,
                    } = await this._contentManager.update(accountContext, null, {
                        version: apiContentRange.version,
                        steps: commentSteps,
                        documentContent: apiContentRange.contentAtVersion,
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

                    await persistencePromise;
                    assert(createdCommentThreadTime !== null);

                    const fileIds = new Set(
                        requestBody.fileIds.filter((fileId): fileId is FileId => isId(fileId)),
                    );
                    const files = await runAllPromises(
                        Array.from(fileIds, async fileId => {
                            const {file} = await getFileWithoutSignedUrlFromAttachment(
                                accountContext,
                                {
                                    fileId,
                                    target: {
                                        type: "DocumentComments",
                                        documentId: this.id,
                                    },
                                },
                            );
                            return file;
                        }),
                    );

                    const authorId = accountContext.actor.getPossiblyBotAccountId();
                    const commentThread = {
                        spaceId: this.spaceId,
                        id: commentThreadId,
                        createdTime: createdCommentThreadTime,
                        isResolved: false,
                        commentCount: 1,
                        firstCommentAuthorId: authorId,
                        fallbackContentSnippet: null,
                    };
                    const message = {
                        index: 0,
                        version: 0,
                        createdTime: createdCommentThreadTime,
                        createdTimeZone: requestBody.createdTimeZone,
                        authorId,
                        payload: {
                            type: "Content" as const,
                            parent: null,
                            content: requestBody.content,
                            contentUpdate: null,
                            fileIds: requestBody.fileIds,
                            reactionsByPos: emptyMap,
                            filesReactions: emptyReactionSet,
                        },
                        stream: null,
                    };
                    const appliedCommentStep = steps[0];
                    assert(appliedCommentStep);
                    let appliedCommentPos: number;
                    if (appliedCommentStep instanceof AddNodeMarkStep) {
                        appliedCommentPos = appliedCommentStep.pos;
                    } else {
                        assert(appliedCommentStep instanceof AddMarkStep);
                        appliedCommentPos = appliedCommentStep.from;
                    }
                    const documentContentSnippet = getDocumentCommentThreadSnippetAtPos(
                        newDocumentContent,
                        appliedCommentPos,
                        {wholeTextBlocks: true},
                    );

                    return new Response(
                        JSON.stringify(
                            DocumentCollaborationCreateCommentThreadForApiResponseBodySchema.serialize(
                                {
                                    ok: true,
                                    newVersion,
                                    commentThreadId,
                                    commentThread,
                                    documentContentSnippet,
                                    files,
                                    message,
                                },
                            ),
                        ),
                        {status: 200, headers: {"content-type": "application/json"}},
                    );
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
