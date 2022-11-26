import {Step} from "prosemirror-transform";
import {RequestContext} from "~/server/context/context";
import {
    DurableObjectProcessContext,
    DurableObjectRequestContext,
    DurableObjectUnauthenticatedRequestContext,
} from "~/server/context/durable_object_context";
import {DocumentCollaborationStepCache} from "~/server/documents/document_collaboration_step_cache";
import {getUpdateDocumentContentResult} from "~/server/documents/get_update_document_content_result";
import {
    getDocument,
    getDocumentPreview,
    updateDocumentContent,
} from "~/server/dynamo/documents_table";
import {WebSocketServer} from "~/server/helpers/web_socket_server";
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
import {AsyncSequentialQueue} from "~/shared/helpers/async/async_sequential_queue";
import {runPromiseWithoutAwaiting} from "~/shared/helpers/async/run_promise_without_awaiting";
import {assert} from "~/shared/helpers/control/assert";
import {exhaustive} from "~/shared/helpers/control/exhaustive";
import {filterMapIterable} from "~/shared/helpers/iterable/filter_map_iterable";
import {Id, generateId} from "~/shared/id/id";
import {ProsemirrorSelectionWrapper} from "~/shared/prosemirror/prosemirror_selection_schema";
import {Schema} from "~/shared/schema/schema";

/**
 * Wrapper for our actual durable object class. There's some initialization we
 * need to do on the first request. This wrapper allows us to initialize that
 * state in a type safe way.
 */
class DocumentCollaborationDurableObjectWrapper {
    private readonly _state: DurableObjectState;
    private readonly _context: DurableObjectProcessContext;
    private _objectPromise: Promise<DocumentCollaborationDurableObject> | null = null;

    constructor(state: DurableObjectState) {
        this._state = state;
        this._context = new DurableObjectProcessContext(state);
    }

    public fetch(request: Request): Promise<Response> {
        return DurableObjectUnauthenticatedRequestContext.run(
            this._context,
            request,
            async _context => {
                const context = await _context.authenticate();
                const id = Schema.id.deserialize(request.headers.get("x-document-id"));

                if (this._objectPromise === null) {
                    this._objectPromise = DocumentCollaborationDurableObject.initialize(context, {
                        id,
                        destroy: () => (this._objectPromise = null),
                    });
                }

                const object = await this._objectPromise;

                if (id !== object.id)
                    throw new FailedPreconditionError(
                        "Document id in HTTP header does not match durable object document id",
                    );

                return object.fetch(context, request);
            },
        );
    }
}

export {DocumentCollaborationDurableObjectWrapper as DocumentCollaborationDurableObject};

class DocumentCollaborationDurableObject {
    private readonly _context: DurableObjectProcessContext;
    public readonly id: Id;
    private readonly _contentManager: DocumentCollaborationContentManager;
    private readonly _destroyCallback: () => void;

    private readonly _webSocketServer: WebSocketServer<
        DocumentCollaborationMessageFromClient,
        DocumentCollaborationMessageFromServer,
        DocumentCollaborationDurableObjectConnection
    >;

    public static async initialize(
        context: DurableObjectRequestContext,
        {
            id,
            destroy,
        }: {
            id: Id;
            destroy: () => void;
        },
    ): Promise<DocumentCollaborationDurableObject> {
        const document = await getDocument(context, id);
        if (!document) throw new NotFoundError("Document not found");

        return new DocumentCollaborationDurableObject({
            context: context.getProcessContext(),
            id: document.id,
            initialVersion: document.version,
            initialContent: document.content,
            destroy,
        });
    }

    private constructor({
        context,
        id,
        initialVersion,
        initialContent,
        destroy,
    }: {
        context: DurableObjectProcessContext;
        id: Id;
        initialVersion: number;
        initialContent: DocumentContent;
        destroy: () => void;
    }) {
        this._context = context;
        this.id = id;
        this._contentManager = new DocumentCollaborationContentManager({
            id,
            initialVersion,
            initialContent,
            sendMessageToAll: message => this._webSocketServer.sendMessageToAll(message),
            destroyDurableObject: () => this._destroy(),
        });
        this._destroyCallback = destroy;

        this._webSocketServer = new WebSocketServer(
            DocumentCollaborationMessageFromClientSchema,
            DocumentCollaborationMessageFromServerSchema,
            ({sendMessage, sendMessageToOthers, iterateOtherConnections}) =>
                new DocumentCollaborationDurableObjectConnection({
                    contentManager: this._contentManager,
                    sendMessage,
                    sendMessageToOthers,
                    iterateOtherConnections,
                    destroyDurableObject: () => this._destroy(),
                }),
        );
    }

    public fetch(context: DurableObjectRequestContext, request: Request): Response {
        const url = new URL(request.url);
        if (url.pathname !== "/") throw new NotFoundError("Unexpected path");
        return this._webSocketServer.upgrade(context, request);
    }

    private _destroy() {
        this._webSocketServer.closeAll();
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
    private readonly _sendMessageToAll: (message: DocumentCollaborationMessageFromServer) => void;
    private readonly _destroyDurableObject: () => void;
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
        sendMessageToAll: (message: DocumentCollaborationMessageFromServer) => void;
        destroyDurableObject: () => void;
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

            this._sendMessageToAll({
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

                        try {
                            const {conflictingSteps} = await updateDocumentContent(context, {
                                id: this._id,
                                version: oldVersion,
                                steps: nextSteps,
                                clientId: update.clientId,
                            });

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

                            this._sendMessageToAll({
                                type: "PersistedContent",
                                newVersion: oldVersion + nextSteps.length,
                            });
                        } catch (_error) {
                            // TODO(calebmer): Report this error somewhere in addition to sending it to
                            // the client.

                            // If we failed to update, always classify it as an internal error since
                            // clients have seen the update.
                            const error = InternalError.from(_error);

                            this._sendMessageToAll({
                                type: "Error",
                                error,
                            });
                            this._destroyDurableObject();
                        }
                    })(),
                };

                // Make sure the durable object stays alive until we've finished persisting.
                context.waitUntil(this._persistenceState.promise);
            }

            return {presenceState, hasSentPresenceState: true};
        });
    }
}

class DocumentCollaborationDurableObjectConnection {
    public readonly id = generateId();

    private readonly _contentManager: DocumentCollaborationContentManager;
    private readonly _sendMessage: (message: DocumentCollaborationMessageFromServer) => void;
    private readonly _sendMessageToOthers: (
        message: DocumentCollaborationMessageFromServer,
    ) => void;
    private readonly _iterateOtherConnections: () => Iterable<DocumentCollaborationDurableObjectConnection>;
    private readonly _destroyDurableObject: () => void;

    private _presenceState: DocumentCollaborationPresenceState | null = null;
    private _sequentialQueue = new AsyncSequentialQueue();

    constructor({
        contentManager,
        sendMessage,
        sendMessageToOthers,
        iterateOtherConnections,
        destroyDurableObject,
    }: {
        contentManager: DocumentCollaborationContentManager;
        sendMessage: (message: DocumentCollaborationMessageFromServer) => void;
        sendMessageToOthers: (message: DocumentCollaborationMessageFromServer) => void;
        iterateOtherConnections: () => Iterable<DocumentCollaborationDurableObjectConnection>;
        destroyDurableObject: () => void;
    }) {
        this._contentManager = contentManager;
        this._sendMessage = sendMessage;
        this._sendMessageToOthers = sendMessageToOthers;
        this._iterateOtherConnections = iterateOtherConnections;
        this._destroyDurableObject = destroyDurableObject;
    }

    public getPresenceState() {
        return this._presenceState;
    }

    public handleMessage(context: RequestContext, message: DocumentCollaborationMessageFromClient) {
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
                            const documentPreview = await getDocumentPreview(context, this.id);
                            if (!documentPreview) {
                                this._sendFatalErrorMessageAndDestroyDurableObject(
                                    new NotFoundError(
                                        "Document was deleted since durable object started",
                                    ),
                                );
                                return;
                            }
                            if (documentPreview.version > version) {
                                this._sendFatalErrorMessageAndDestroyDurableObject(
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

                                return {connectionId: connection.id, state};
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
                        this._sendMessage({
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
                            await this._contentManager.update(context, this.id, message);
                        this._presenceState = presenceState;

                        if (!hasSentPresenceState) {
                            this._sendMessageToOthers({
                                type: "UpdateOtherPresenceState",
                                connectionId: this.id,
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

                        this._sendMessageToOthers({
                            type: "UpdateOtherPresenceState",
                            connectionId: this.id,
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
                this._sendMessage({
                    type: "Error",
                    error,
                });
            }
        });
    }

    public handleClose() {
        runPromiseWithoutAwaiting(
            // Make sure we run in the queue in case we're wrapping up message handling. We
            // want to send our null presence state after we send any other
            // presence states.
            this._sequentialQueue.run(async () => {
                // When the connection closes, clear the presence state in our other
                // connections.
                if (this._presenceState !== null) {
                    this._sendMessageToOthers({
                        type: "UpdateOtherPresenceState",
                        connectionId: this.id,
                        state: null,
                    });
                }
            }),
        );
    }

    private _sendFatalErrorMessageAndDestroyDurableObject(error: unknown) {
        // TODO(calebmer): Report this error somewhere in addition to sending it to
        // the client.
        this._sendMessage({
            type: "Error",
            error,
        });
        this._sendMessageToOthers({
            type: "Error",
            error,
        });
        this._destroyDurableObject();
    }
}
