import {Step} from "prosemirror-transform";
import {DocumentCollaborationStepCache} from "~/server/documents/document_collaboration_step_cache";
import {getUpdateDocumentContentResult} from "~/server/documents/get_update_document_content_result";
import {getDocument, updateDocumentContent} from "~/server/dynamo/documents_table";
import {WebSocketServer} from "~/server/helpers/web_socket_server";
import {
    DocumentCollaborationMessageFromClientSchema,
    DocumentCollaborationMessageFromServer,
    DocumentCollaborationMessageFromServerSchema,
} from "~/shared/documents/document_collaboration_schema";
import {DocumentContent} from "~/shared/documents/document_content_schema";
import {
    FailedPreconditionError,
    InternalError,
    InvalidArgumentError,
    NotFoundError,
} from "~/shared/error/error";
import {exhaustive} from "~/shared/helpers/control/exhaustive";
import {Id} from "~/shared/id/id";
import {Schema} from "~/shared/schema/schema";

/**
 * Wrapper for our actual durable object class. There's some initialization we
 * need to do on the first request. This wrapper allows us to initialize that
 * state in a type safe way.
 */
class DocumentCollaborationDurableObjectWrapper {
    private _objectPromise: Promise<DocumentCollaborationDurableObject> | null = null;

    constructor(private readonly _state: DurableObjectState) {}

    public async fetch(request: Request): Promise<Response> {
        const id = Schema.id.deserialize(request.headers.get("x-document-id"));

        if (this._objectPromise === null)
            this._objectPromise = DocumentCollaborationDurableObject.initialize(this._state, id);

        const object = await this._objectPromise;

        if (id !== object.id)
            throw new FailedPreconditionError(
                "Document id in HTTP header does not match durable object document id",
            );

        return object.fetch(request);
    }
}

export {DocumentCollaborationDurableObjectWrapper as DocumentCollaborationDurableObject};

class DocumentCollaborationDurableObject {
    private readonly _state: DurableObjectState;
    public readonly id: Id;
    private readonly _contentManager: DocumentCollaborationContentManager;

    public static async initialize(
        state: DurableObjectState,
        id: Id,
    ): Promise<DocumentCollaborationDurableObject> {
        const document = await getDocument(id);
        if (!document) throw new NotFoundError("Document not found");

        return new DocumentCollaborationDurableObject({
            state,
            id: document.id,
            initialVersion: document.version,
            initialContent: document.content,
        });
    }

    private constructor({
        state,
        id,
        initialVersion,
        initialContent,
    }: {
        state: DurableObjectState;
        id: Id;
        initialVersion: number;
        initialContent: DocumentContent;
    }) {
        this._state = state;
        this.id = id;
        this._contentManager = new DocumentCollaborationContentManager({
            state,
            id,
            initialVersion,
            initialContent,
            sendMessageToAll: message => {
                this._webSocketServer.sendMessageToAll(message);
            },
        });
    }

    public fetch(request: Request): Response {
        const url = new URL(request.url);
        if (url.pathname !== "/") throw new NotFoundError("Unexpected path");
        return this._webSocketServer.upgrade(request);
    }

    private readonly _webSocketServer = new WebSocketServer(
        DocumentCollaborationMessageFromClientSchema,
        DocumentCollaborationMessageFromServerSchema,
        async (message, {sendMessage}) => {
            try {
                switch (message.type) {
                    case "BackfillRequest": {
                        const version = this._contentManager.getCurrentVersion();

                        if (message.version > version)
                            throw new InvalidArgumentError(
                                "Tried to backfill a future document version",
                            );

                        // The client is up-to-date. We don't need to backfill. Yay!
                        if (message.version === version) return;

                        // Load steps from our store and send them to the client to catch
                        // the client up...
                        sendMessage({
                            type: "BackfillResponse",
                            newVersion: version,
                            steps: await this._contentManager.stepCache.getSteps(
                                message.version,
                                version,
                            ),
                        });
                        return;
                    }
                    case "UpdateContent": {
                        await this._contentManager.update(message);
                        return;
                    }
                    default:
                        throw exhaustive(message);
                }
            } catch (error) {
                // NOTE(calebmer): I wonder if error handling should be a part of the
                // `WebSocketServer` abstraction instead of doing one-off error handling like
                // this? There are not enough examples of `WebSocketServer` usage to know.
                sendMessage({
                    type: "Error",
                    error,
                });
            }
        },
    );
}

/**
 * Class for managing writing to collaborative content in a concurrency
 * safe way.
 */
class DocumentCollaborationContentManager {
    private readonly _state: DurableObjectState;
    private readonly _id: Id;
    private _version: number;
    private _content: DocumentContent;
    public readonly stepCache: DocumentCollaborationStepCache;

    private readonly _sendMessageToAll: (message: DocumentCollaborationMessageFromServer) => void;

    private _updateLockPromise: Promise<void> | null = null;

    private _persistenceQueue: Array<{version: number; steps: Array<Step>; clientId: Id}> = [];
    private _flushPersistenceQueuePromise: Promise<void> | null = null;

    constructor({
        state,
        id,
        initialVersion,
        initialContent,
        sendMessageToAll,
    }: {
        state: DurableObjectState;
        id: Id;
        initialVersion: number;
        initialContent: DocumentContent;
        sendMessageToAll: (message: DocumentCollaborationMessageFromServer) => void;
    }) {
        this._state = state;
        this._id = id;
        this._version = initialVersion;
        this._content = initialContent;
        this.stepCache = new DocumentCollaborationStepCache(id, this._version);
        this._sendMessageToAll = sendMessageToAll;
    }

    /**
     * Get the current version of our content.
     *
     * This is mutable and will change over time as users update the document
     * content!
     */
    public getCurrentVersion() {
        return this._version;
    }

    /**
     * Update our document's content. Holds a lock on the document content while
     * updating so writes from two concurrent writers will be serialized.
     *
     * The action callback returns both `newContent` and `newSteps`. We assume that
     * `newSteps` applied to `content` produces `newContent`.
     */
    public async update(update: {
        version: number;
        steps: ReadonlyArray<Step>;
        clientId: Id;
        messageId: Id;
    }): Promise<void> {
        // Wait for our turn to claim the update lock. If there are multiple concurrent writers
        while (this._updateLockPromise !== null) await this._updateLockPromise;

        const promise = (async () => {
            const {newContent, newSteps} = await getUpdateDocumentContentResult({
                currentVersion: this._version,
                currentContent: this._content,
                updateVersion: update.version,
                updateSteps: update.steps,
                getSteps: (startVersion, endVersion) =>
                    this.stepCache.getSteps(startVersion, endVersion),
            });

            // If we had to rebase and all steps were removed, immediately return.
            if (newSteps.length === 0) return;

            const oldVersion = this._version;
            this._version += newSteps.length;
            this._content = newContent;

            this._sendMessageToAll({
                type: "UpdateContentWithoutPersistence",
                newVersion: oldVersion + newSteps.length,
                steps: newSteps,
                clientId: update.clientId,
                acknowledgeMessageId: update.messageId,
            });

            // Add to the persistence queue.
            //
            // If the last entry in the persistence queue is from our client, then we will
            // add to the end of that entry. All steps in that entry will be saved as one
            // transaction.
            if (
                this._persistenceQueue.length > 0 &&
                this._persistenceQueue[this._persistenceQueue.length - 1]!.clientId ===
                    update.clientId
            ) {
                for (const step of newSteps) {
                    this._persistenceQueue[this._persistenceQueue.length - 1]!.steps.push(step);
                }
            } else {
                this._persistenceQueue.push({
                    version: oldVersion,
                    steps: Array.from(newSteps),
                    clientId: update.clientId,
                });
            }

            // Make sure the durable object stays alive until `this._persistenceQueue` is
            // empty and our content has been persisted.
            this._state.waitUntil(this._flushPersistenceQueue());
        })();

        // Make sure to reset `this._updateLockPromise` to null when the promise
        // resolves! Otherwise concurrent writers will loop forever.
        this._updateLockPromise = promise.then(
            () => {
                this._updateLockPromise = null;
            },
            // Ignore any errors in our lock promise. A thrown error should reject our
            // update` call but not other update calls which are locked and waiting.
            () => {
                this._updateLockPromise = null;
            },
        );

        return promise;
    }

    /**
     * Returns a promise that resolves when all entries in `this._persistenceQueue`
     * have been processed and saved to the database.
     */
    private _flushPersistenceQueue() {
        if (this._flushPersistenceQueuePromise === null) {
            const promise = (async () => {
                // Process all the persistence queue entries.
                while (this._persistenceQueue.length > 0) {
                    try {
                        const entry = this._persistenceQueue.shift()!;

                        const {conflictingSteps} = await updateDocumentContent({
                            id: this._id,
                            version: entry.version,
                            steps: entry.steps,
                            clientId: entry.clientId,
                        });

                        // The document collaboration durable object should be the only process writing
                        // to a document! If some other process is writing to a document, weird
                        // things may start breaking in the durable object and on the client.
                        //
                        // We save steps anyway to preserve as much user data as we can.
                        if (conflictingSteps.length > 0)
                            throw new InternalError(
                                "Some process updated document content other than the document's durable object. This may cause many downstream issues as a core assumption about the document collaboration implementation has been violated",
                            );

                        this._sendMessageToAll({
                            type: "PersistedContent",
                            newVersion: entry.version + entry.steps.length,
                        });
                    } catch (error) {
                        // TODO(calebmer): Report this error somewhere in addition to sending it to
                        // the client.

                        this._sendMessageToAll({
                            type: "Error",
                            error,
                        });
                    }
                }
            })();

            this._flushPersistenceQueuePromise = promise;

            promise.finally(() => {
                this._flushPersistenceQueuePromise = null;
            });
        }

        return this._flushPersistenceQueuePromise;
    }
}
