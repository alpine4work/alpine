import {jwtVerify} from "jose";
import {Step} from "prosemirror-transform";
import {createAwsContextModulesFromEnv} from "~/server/aws/create_aws_context_modules_from_env";
import {DocumentCollaborationStepCache} from "~/server/documents/document_collaboration_step_cache";
import {Session} from "~/server/dynamo/accounts_table";
import {UnauthenticatedAuthContextModule} from "~/server/dynamo/context/auth_context_module";
import {ProcessContext, ProcessContextModules} from "~/server/dynamo/context/process_context";
import {
    RequestContext,
    UnauthenticatedRequestContextModules,
} from "~/server/dynamo/context/request_context";
import {
    getDocument,
    getDocumentPreview,
    getUpdateDocumentContentResult,
    updateDocumentContent,
} from "~/server/dynamo/documents_table";
import {createServerTracer} from "~/server/tracer/server_tracer";
import {traceFetchResponse} from "~/server/tracer/trace_fetch_response";
import {WebSocketServer} from "~/server/web_socket/web_socket_server";
import {Context} from "~/shared/context/context";
import {ProcessContextModule} from "~/shared/context/process_context_module";
import {TracerContextModule} from "~/shared/context/tracer_context_module";
import {
    DocumentCollaborationMessageFromClient,
    DocumentCollaborationMessageFromClientSchema,
    DocumentCollaborationMessageFromServer,
    DocumentCollaborationMessageFromServerSchema,
    DocumentCollaborationPresenceState,
} from "~/shared/documents/document_collaboration_schema";
import {DocumentContent, isDocumentContent} from "~/shared/documents/document_content_schema";
import {
    FailedPreconditionError,
    InternalError,
    InvalidArgumentError,
    NotFoundError,
} from "~/shared/error/error";
import {isSystemError} from "~/shared/error/is_system_error_code";
import {AsyncSequentialQueue} from "~/shared/helpers/async/async_sequential_queue";
import {assert} from "~/shared/helpers/control/assert";
import {exhaustive} from "~/shared/helpers/control/exhaustive";
import {filterMapIterable} from "~/shared/helpers/iterable/filter_map_iterable";
import {Id} from "~/shared/id/id";
import {ProsemirrorSelectionWrapper} from "~/shared/prosemirror/prosemirror_selection_schema";
import {Schema, SchemaSerializedValue} from "~/shared/schema/schema";
import {TracerRoot} from "~/shared/tracer/tracer_root";
import {TracerSpan} from "~/shared/tracer/tracer_span";

type DurableObjectEnv = {
    DEV_SERVER_PORT?: string;
    DYNAMO_LOCAL_PORT?: string;
    SESSION_COOKIE_SECRET?: string;
    AWS_ACCESS_KEY_ID?: string;
    AWS_SECRET_ACCESS_KEY?: string;
    HONEYCOMB_API_KEY?: string;
};

/**
 * Wrapper for our actual durable object class. There's some initialization we
 * need to do on the first request. This wrapper allows us to initialize that
 * state in a type safe way.
 */
class DocumentCollaborationDurableObjectWrapper {
    private readonly _state: DurableObjectState;
    private readonly _sessionCookieSecret: string;
    private readonly _tracer: TracerRoot;
    private readonly _context: ProcessContext;
    private _objectPromise: Promise<DocumentCollaborationDurableObject> | null = null;

    constructor(state: DurableObjectState, env: DurableObjectEnv) {
        this._state = state;

        const sessionCookieSecret = env.SESSION_COOKIE_SECRET;
        if (!sessionCookieSecret)
            throw new InternalError("Missing `SESSION_COOKIE_SECRET` environment variable");

        this._sessionCookieSecret = sessionCookieSecret;

        this._tracer = createServerTracer({
            serviceName: "DocumentCollaborationService",
            env,
            waitUntil: promise => state.waitUntil(promise),
        });

        const awsContextModules = createAwsContextModulesFromEnv(env);

        this._context = Context.new({
            ...awsContextModules,
            process: new ProcessContextModule({
                waitUntil: promise => this._state.waitUntil(promise),
            }),
            tracer: new TracerContextModule(this._tracer),
        });
    }

    public fetch(request: Request): Promise<Response> {
        const url = new URL(request.url);

        return traceFetchResponse(this._tracer, request, url, (span, request) => {
            return this._context.with<
                Omit<
                    UnauthenticatedRequestContextModules,
                    Exclude<keyof ProcessContextModules, "tracer">
                >,
                Response
            >(
                {
                    // Replace the tracer context module with one that uses our span for
                    // this request.
                    tracer: new TracerContextModule(span),

                    auth: new UnauthenticatedAuthContextModule(async context => {
                        const authorizationHeader = request.headers.get("authorization");
                        if (!authorizationHeader) return null;
                        const authorizationHeaderMatch =
                            authorizationHeader.match(/^bearer (.+)$/i);

                        if (!authorizationHeaderMatch)
                            throw new InvalidArgumentError(
                                'Expected "Authorization" header to have "Bearer" authentication scheme',
                            );

                        const authenticationToken = authorizationHeaderMatch[1] ?? "";

                        const {sessionId} = await this._verifyAuthenticationToken(
                            authenticationToken,
                        );

                        const session = await Session.get(context, sessionId);
                        if (!session)
                            throw new NotFoundError(
                                'Could not find session from "Authorization" header',
                            );

                        return session;
                    }),
                },
                async _requestContext => {
                    const requestContext: RequestContext =
                        await _requestContext.auth.authenticate();
                    const id = Schema.id.deserialize(
                        request.headers.get("cyberworlds-document-id"),
                    );

                    if (this._objectPromise === null) {
                        this._objectPromise = DocumentCollaborationDurableObject.initialize({
                            processContext: this._context,
                            requestContext,
                            id,
                            destroy: () => (this._objectPromise = null),
                        });
                    }

                    const object = await this._objectPromise;

                    if (id !== object.id)
                        throw new FailedPreconditionError(
                            "Document id in HTTP header does not match durable object document id",
                        );

                    return object.fetch(requestContext, request);
                },
            );
        });
    }

    private async _verifyAuthenticationToken(token: string): Promise<{sessionId: Id}> {
        const {payload} = await jwtVerify(
            token,
            new TextEncoder().encode(this._sessionCookieSecret),
        );
        const sessionId = Schema.id.deserialize(payload.sessionId as SchemaSerializedValue);

        return {sessionId};
    }
}

export {DocumentCollaborationDurableObjectWrapper as DocumentCollaborationDurableObject};

class DocumentCollaborationDurableObject {
    private readonly _context: ProcessContext;
    public readonly spaceId: Id;
    public readonly id: Id;
    private readonly _contentManager: DocumentCollaborationContentManager;
    private readonly _destroyCallback: () => void;

    private readonly _webSocketServer: WebSocketServer<
        DocumentCollaborationMessageFromClient,
        DocumentCollaborationMessageFromServer,
        DocumentCollaborationDurableObjectConnection
    >;

    public static async initialize({
        processContext,
        requestContext,
        id,
        destroy,
    }: {
        processContext: ProcessContext;
        requestContext: RequestContext;
        id: Id;
        destroy: () => void;
    }): Promise<DocumentCollaborationDurableObject> {
        const document = await getDocument(requestContext, id);
        if (!document) throw new NotFoundError("Document not found");

        return new DocumentCollaborationDurableObject({
            context: processContext,
            spaceId: document.spaceId,
            id: document.id,
            initialVersion: document.version,
            initialContent: document.content,
            destroy,
        });
    }

    private constructor({
        context,
        spaceId,
        id,
        initialVersion,
        initialContent,
        destroy,
    }: {
        context: ProcessContext;
        spaceId: Id;
        id: Id;
        initialVersion: number;
        initialContent: DocumentContent;
        destroy: () => void;
    }) {
        // Propagate the document id to all logs for this durable object.
        context = context.tracer.withPropagatedData({context: {spaceId, documentId: id}});

        this._context = context;
        this.spaceId = spaceId;
        this.id = id;
        this._contentManager = new DocumentCollaborationContentManager({
            id,
            initialVersion,
            initialContent,
            sendMessageToAll: (context, message) =>
                this._webSocketServer.sendMessageToAll(context, message),
            destroyDurableObject: context => this._destroy(context),
        });
        this._destroyCallback = destroy;

        this._webSocketServer = new WebSocketServer(
            this._context,
            DocumentCollaborationMessageFromClientSchema,
            DocumentCollaborationMessageFromServerSchema,
            ({connectionId, sendMessage, sendMessageToOthers, iterateOtherConnections}) =>
                new DocumentCollaborationDurableObjectConnection({
                    connectionId,
                    contentManager: this._contentManager,
                    sendMessage,
                    sendMessageToOthers,
                    iterateOtherConnections,
                    destroyDurableObject: context => this._destroy(context),
                }),
        );
    }

    public fetch(context: RequestContext, request: Request): Response {
        // Propagate the document id to all logs for this durable object.
        context = context.tracer.withPropagatedData({
            context: {spaceId: this.spaceId, documentId: this.id},
        });

        const url = new URL(request.url);
        if (url.pathname !== "/") throw new NotFoundError("Unexpected path");
        return this._webSocketServer.upgrade(context, request);
    }

    private _destroy(context: ProcessContext) {
        this._webSocketServer.closeAll(context);
        this._destroyCallback();
    }
}

/**
 * Class for managing writing to collaborative content in a concurrency
 * safe way.
 */
class DocumentCollaborationContentManager {
    private readonly _id: Id;
    private _version: number;
    private _content: DocumentContent;
    public readonly stepCache: DocumentCollaborationStepCache;
    private readonly _sendMessageToAll: (
        context: ProcessContext,
        message: DocumentCollaborationMessageFromServer,
    ) => void;
    private readonly _destroyDurableObject: (context: ProcessContext) => void;
    private _updateSequentialQueue = new AsyncSequentialQueue();

    private _persistenceState: {
        next: {
            readonly clientId: Id;
            readonly steps: Array<Step>;
        } | null;
        promise: Promise<void>;
    } | null = null;

    constructor({
        id,
        initialVersion,
        initialContent,
        sendMessageToAll,
        destroyDurableObject,
    }: {
        id: Id;
        initialVersion: number;
        initialContent: DocumentContent;
        sendMessageToAll: (
            context: ProcessContext,
            message: DocumentCollaborationMessageFromServer,
        ) => void;
        destroyDurableObject: (context: ProcessContext) => void;
    }) {
        this._id = id;
        this._version = initialVersion;
        this._content = initialContent;
        this.stepCache = new DocumentCollaborationStepCache(id, this._version);
        this._sendMessageToAll = sendMessageToAll;
        this._destroyDurableObject = destroyDurableObject;
    }

    /**
     * Get the current version of our content.
     *
     * This is mutable and will change over time as users update the document
     * content!
     *
     * If you want to update content you should use the version and content
     * provided in the `update()` method.
     */
    public getCurrentVersion() {
        return this._version;
    }

    /**
     * Gets the document content at the specified version number.
     */
    public async getContentAtVersion(
        context: RequestContext,
        version: number,
    ): Promise<DocumentContent> {
        if (version > this._version)
            throw new FailedPreconditionError("Can not get document content at a future version");

        let content = this._content;

        const steps = await this.stepCache.getSteps(context, version, this._version);

        for (let i = steps.length - 1; i >= 0; i--) {
            const {invertedStep} = steps[i]!;
            const stepResult = invertedStep.apply(content);

            if (!stepResult.doc)
                throw new InternalError(
                    `Inverted step could not be applied: ${stepResult.failed!}`,
                );

            assert(isDocumentContent(stepResult.doc));
            content = stepResult.doc;
        }

        return content;
    }

    /**
     * Update our document's content. Holds a lock on the document content while
     * updating so writes from two concurrent writers will be serialized.
     *
     * The action callback returns both `newContent` and `newSteps`. We assume that
     * `newSteps` applied to `content` produces `newContent`.
     */
    public update(
        context: RequestContext,
        connectionId: Id,
        update: {
            version: number;
            steps: ReadonlyArray<Step>;
            clientId: Id;
            messageId: Id;
            updateOurPresenceState: {state: DocumentCollaborationPresenceState | null};
        },
    ): Promise<{
        presenceState: DocumentCollaborationPresenceState | null;
        hasSentPresenceState: boolean;
    }> {
        return this._updateSequentialQueue.run(async () => {
            if (
                update.updateOurPresenceState.state &&
                update.updateOurPresenceState.state.version !== update.version
            ) {
                throw new InvalidArgumentError(
                    "Document version in new presence state should match the document version we are updating",
                );
            }

            const oldVersion = this._version;

            const {newContent, steps, invertedSteps, clientContent, mapping} =
                await getUpdateDocumentContentResult({
                    currentVersion: this._version,
                    currentContent: this._content,
                    clientVersion: update.version,
                    clientSteps: update.steps,
                    getSteps: (startVersion, endVersion) =>
                        this.stepCache.getSteps(context, startVersion, endVersion),
                });

            // Validate the presence state selection based on the document as the client
            // sees it, then map the selection to the correct position.
            const clientPresenceStateSelection =
                update.updateOurPresenceState.state?.selection.getAndMaybeDeserialize(
                    clientContent,
                );
            const newPresenceStateSelection = clientPresenceStateSelection?.map(
                newContent,
                mapping,
            );
            const presenceState: DocumentCollaborationPresenceState | null =
                newPresenceStateSelection
                    ? {
                          version: oldVersion + steps.length,
                          selection: ProsemirrorSelectionWrapper.new(newPresenceStateSelection),
                      }
                    : null;

            // If we had to rebase and all steps were removed, immediately return.
            if (steps.length === 0) return {presenceState, hasSentPresenceState: false};

            this._version += steps.length;
            this._content = newContent;

            // Populate our step cache with the new steps before telling other clients
            // about the new steps.
            for (let i = 0; i < steps.length; i++) {
                const step = steps[i]!;
                const invertedStep = invertedSteps[i];
                assert(invertedStep);
                this.stepCache.dangerouslyAddStepToEnd({
                    step,
                    invertedStep,
                    clientId: update.clientId,
                });
            }

            this._sendMessageToAll(context, {
                type: "UpdateContentBeforePersistence",
                newVersion: oldVersion + steps.length,
                steps,
                clientId: update.clientId,
                acknowledgeMessageId: update.messageId,
                updateOtherPresenceState: {
                    connectionId,
                    state: presenceState,
                },
            });

            // Persist our content by sending our steps to DynamoDB. We need to save our
            // steps in the same sequence we received them.
            //
            // We batch together steps from the same client id while we're waiting on a
            // persistence request to finish.
            if (this._persistenceState?.next?.clientId === update.clientId) {
                for (const step of steps) {
                    this._persistenceState.next.steps.push(step);
                }
            } else {
                const lastPersistenceStatePromise = this._persistenceState?.promise;
                const nextSteps = Array.from(steps);

                this._persistenceState = {
                    next: {
                        clientId: update.clientId,
                        steps: nextSteps,
                    },
                    // NOTE(calebmer): We're careful to spawn the promise which updates content from
                    // this `update()` method so the DynamoDB network calls count against the
                    // request limit for the WebSocket message that triggered the `update()`.
                    promise: (async () => {
                        // While we wait, steps may be added to `nextSteps` if it's from the same
                        // client so we can save in a single batch.
                        await lastPersistenceStatePromise;

                        // Do not allow the worker to batch more steps for this request! Instead the
                        // worker needs to schedule a new update promise.
                        if (this._persistenceState?.next?.steps === nextSteps)
                            this._persistenceState.next = null;

                        await context.tracer.withSpan(
                            "Persist document content",
                            async (context, span) => {
                                try {
                                    const {conflictingSteps} = await updateDocumentContent(
                                        context,
                                        {
                                            id: this._id,
                                            version: oldVersion,
                                            steps: nextSteps,
                                            clientId: update.clientId,
                                        },
                                    );

                                    // The document collaboration durable object should be the only process writing
                                    // to a document! If some other process is writing to a document, weird
                                    // things may start breaking in the durable object and on the client.
                                    //
                                    // We save steps anyway to preserve as much user data as we can.
                                    if (conflictingSteps.length > 0) {
                                        throw new InternalError(
                                            "Some process updated document content other than the document's durable object. This may cause many downstream issues as a core assumption about the document collaboration implementation has been violated",
                                        );
                                    }

                                    this._sendMessageToAll(context, {
                                        type: "PersistedContent",
                                        newVersion: oldVersion + nextSteps.length,
                                    });
                                } catch (_error) {
                                    // Upgrade the severity of non-internal errors to internal since the client has
                                    // already seen the update.
                                    const error = !isSystemError(_error)
                                        ? InternalError.from(_error)
                                        : _error;

                                    span.addException(error);

                                    this._sendMessageToAll(context, {
                                        type: "Error",
                                        error,
                                    });
                                    this._destroyDurableObject(context);
                                }
                            },
                        );
                    })(),
                };

                // Make sure the durable object stays alive until we've finished persisting.
                context.process.waitUntil(this._persistenceState.promise);
            }

            return {presenceState, hasSentPresenceState: true};
        });
    }
}

class DocumentCollaborationDurableObjectConnection {
    public readonly connectionId: Id;

    private readonly _contentManager: DocumentCollaborationContentManager;
    private readonly _sendMessage: (
        context: ProcessContext,
        message: DocumentCollaborationMessageFromServer,
    ) => void;
    private readonly _sendMessageToOthers: (
        context: ProcessContext,
        message: DocumentCollaborationMessageFromServer,
    ) => void;
    private readonly _iterateOtherConnections: () => Iterable<DocumentCollaborationDurableObjectConnection>;
    private readonly _destroyDurableObject: (context: ProcessContext) => void;

    private _presenceState: DocumentCollaborationPresenceState | null = null;
    private _sequentialQueue = new AsyncSequentialQueue();

    constructor({
        connectionId,
        contentManager,
        sendMessage,
        sendMessageToOthers,
        iterateOtherConnections,
        destroyDurableObject,
    }: {
        connectionId: Id;
        contentManager: DocumentCollaborationContentManager;
        sendMessage: (
            context: ProcessContext,
            message: DocumentCollaborationMessageFromServer,
        ) => void;
        sendMessageToOthers: (
            context: ProcessContext,
            message: DocumentCollaborationMessageFromServer,
        ) => void;
        iterateOtherConnections: () => Iterable<DocumentCollaborationDurableObjectConnection>;
        destroyDurableObject: (context: ProcessContext) => void;
    }) {
        this.connectionId = connectionId;
        this._contentManager = contentManager;
        this._sendMessage = sendMessage;
        this._sendMessageToOthers = sendMessageToOthers;
        this._iterateOtherConnections = iterateOtherConnections;
        this._destroyDurableObject = destroyDurableObject;
    }

    public getPresenceState() {
        return this._presenceState;
    }

    public handleMessage(
        context: RequestContext,
        message: DocumentCollaborationMessageFromClient,
        span: TracerSpan,
    ) {
        // Handle all messages for this connection in sequence as a defense against
        // race conditions.
        //
        // Example race condition: Two `UpdateOurPresenceState` in fast succession. The
        // second finishes before the first because of some async race condition. A
        // `UpdateContent` then a `UpdateOurPresenceState` is perhaps a better example.
        //
        // The client mostly sends messages in sequence anyway.
        return this._sequentialQueue.run(async () => {
            try {
                switch (message.type) {
                    case "BackfillRequest": {
                        const version = this._contentManager.getCurrentVersion();

                        if (message.version > version) {
                            // Sometimes, if the version in our backfill request appears to be in the
                            // future it's because the client loaded a version of the document from the
                            // database that is ahead of the version of the document in the durable object.
                            //
                            // So load the document from our database and if its version is ahead of the
                            // one in our durable object then we want to destroy the entire durable object.
                            const documentPreview = await getDocumentPreview(
                                context,
                                this.connectionId,
                            );
                            if (!documentPreview) {
                                this._sendFatalErrorMessageAndDestroyDurableObject(
                                    context,
                                    span,
                                    new NotFoundError(
                                        "Document was deleted since durable object started",
                                    ),
                                );
                                return;
                            }
                            if (documentPreview.version > version) {
                                this._sendFatalErrorMessageAndDestroyDurableObject(
                                    context,
                                    span,
                                    new InternalError(
                                        "Document version in durable object is out of sync with actual document version",
                                    ),
                                );
                                return;
                            }

                            throw new FailedPreconditionError(
                                "Tried to backfill a future document version",
                            );
                        }

                        let smallestPresenceStateVersion: number | null = null;

                        const presenceStates = Array.from(
                            filterMapIterable(this._iterateOtherConnections(), connection => {
                                const state = connection.getPresenceState();
                                if (!state) return null;

                                // Record the smallest presence state version. We will also send steps to the
                                // client from this version to the client's version so the client can map
                                // selections.
                                if (
                                    smallestPresenceStateVersion === null ||
                                    state.version < smallestPresenceStateVersion
                                ) {
                                    smallestPresenceStateVersion = state.version;
                                }

                                return {connectionId: connection.connectionId, state};
                            }),
                        );

                        const steps = await this._contentManager.stepCache.getSteps(
                            context,
                            message.version,
                            version,
                        );

                        const rememberSteps =
                            smallestPresenceStateVersion &&
                            smallestPresenceStateVersion < message.version
                                ? await this._contentManager.stepCache.getSteps(
                                      context,
                                      smallestPresenceStateVersion,
                                      message.version,
                                  )
                                : [];

                        // Load steps from our store and send them to the client to catch
                        // the client up...
                        this._sendMessage(context, {
                            type: "BackfillResponse",
                            newVersion: version,
                            steps,
                            presenceStates,
                            rememberInvertedSteps: rememberSteps.map(
                                ({invertedStep}) => invertedStep,
                            ),
                        });
                        return;
                    }
                    case "UpdateContent": {
                        const {presenceState, hasSentPresenceState} =
                            await this._contentManager.update(context, this.connectionId, message);
                        this._presenceState = presenceState;

                        if (!hasSentPresenceState) {
                            this._sendMessageToOthers(context, {
                                type: "UpdateOtherPresenceState",
                                connectionId: this.connectionId,
                                state: this._presenceState,
                            });
                        }
                        return;
                    }
                    case "UpdateOurPresenceState": {
                        // Make sure the new presence state is valid before we broadcast it to our
                        // other clients.
                        if (!message.state) {
                            this._presenceState = null;
                        } else {
                            const isVersionValid =
                                message.state.version >= 0 &&
                                message.state.version <= this._contentManager.getCurrentVersion();

                            if (!isVersionValid)
                                throw new FailedPreconditionError(
                                    "Presence state version is outside the document's version range",
                                );

                            const oldContent = await this._contentManager.getContentAtVersion(
                                context,
                                message.state.version,
                            );

                            // Call this function to deserialize the selection! If deserialization fails an
                            // error will be thrown.
                            message.state.selection.getAndMaybeDeserialize(oldContent);

                            this._presenceState = message.state;
                        }

                        this._sendMessageToOthers(context, {
                            type: "UpdateOtherPresenceState",
                            connectionId: this.connectionId,
                            state: this._presenceState,
                        });
                        return;
                    }
                    default:
                        throw exhaustive(message);
                }
            } catch (error) {
                // NOTE(calebmer): I wonder if error handling should be a part of the
                // `WebSocketServer` abstraction instead of doing one-off error handling like
                // this? There are not enough examples of `WebSocketServer` usage to know.
                this._sendMessage(context, {
                    type: "Error",
                    error,
                });
            }
        });
    }

    public handleClose(context: ProcessContext) {
        context.process.waitUntil(
            // Make sure we run in the queue in case we're wrapping up message handling. We
            // want to send our null presence state after we send any other
            // presence states.
            this._sequentialQueue.run(async () => {
                // When the connection closes, clear the presence state in our other
                // connections.
                if (this._presenceState !== null) {
                    this._sendMessageToOthers(context, {
                        type: "UpdateOtherPresenceState",
                        connectionId: this.connectionId,
                        state: null,
                    });
                }
            }),
        );
    }

    private _sendFatalErrorMessageAndDestroyDurableObject(
        context: ProcessContext,
        span: TracerSpan,
        error: unknown,
    ) {
        span.addException(error);

        this._sendMessage(context, {
            type: "Error",
            error,
        });
        this._sendMessageToOthers(context, {
            type: "Error",
            error,
        });
        this._destroyDurableObject(context);
    }
}
