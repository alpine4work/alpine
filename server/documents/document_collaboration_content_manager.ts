import {Step} from "prosemirror-transform";
import {DocumentCollaborationStepCache} from "~/server/documents/document_collaboration_step_cache";
import {ProcessContext} from "~/server/dynamo/context/process_context";
import {RequestContext} from "~/server/dynamo/context/request_context";
import {
    getUpdateDocumentContentResult,
    updateDocumentContent,
} from "~/server/dynamo/documents_table";
import {getContentReferencesFromSteps} from "~/server/dynamo/helpers/get_content_references";
import {DocumentContent, isDocumentContent} from "~/shared/content/document_content_schema";
import {
    DocumentCollaborationMessageFromServer,
    DocumentCollaborationPresenceState,
} from "~/shared/documents/document_collaboration_schema";
import {FailedPreconditionError, InternalError, InvalidArgumentError} from "~/shared/error/error";
import {isSystemError} from "~/shared/error/is_system_error_code";
import {AsyncSequentialQueue} from "~/shared/helpers/async/async_sequential_queue";
import {assert} from "~/shared/helpers/control/assert";
import {
    ContentEditorClientId,
    DocumentId,
    SpaceId,
    WebSocketConnectionId,
} from "~/shared/id/types/id_types";
import {ProsemirrorSelectionWrapper} from "~/shared/prosemirror/prosemirror_selection_schema";

/**
 * Class for managing writing to collaborative content in a concurrency
 * safe way.
 */
export class DocumentCollaborationContentManager {
    public readonly spaceId: SpaceId;
    public readonly id: DocumentId;
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
            readonly clientId: ContentEditorClientId;
            readonly steps: Array<Step>;
        } | null;
        promise: Promise<void>;
    } | null = null;

    constructor({
        spaceId,
        id,
        initialVersion,
        initialContent,
        sendMessageToAll,
        destroyDurableObject,
    }: {
        spaceId: SpaceId;
        id: DocumentId;
        initialVersion: number;
        initialContent: DocumentContent;
        sendMessageToAll: (
            context: ProcessContext,
            message: DocumentCollaborationMessageFromServer,
        ) => void;
        destroyDurableObject: (context: ProcessContext) => void;
    }) {
        this.spaceId = spaceId;
        this.id = id;
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
    public async update(
        context: RequestContext,
        connectionId: WebSocketConnectionId,
        update: {
            version: number;
            steps: ReadonlyArray<Step>;
            clientId: ContentEditorClientId;
            updateOurPresenceState: {state: DocumentCollaborationPresenceState | null};
        },
    ): Promise<{
        presenceState: DocumentCollaborationPresenceState | null;
        hasSentPresenceState: boolean;
    }> {
        const {oldVersion, steps, presenceState} = await this._updateSequentialQueue.run(
            async () => {
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
                if (steps.length === 0) return {oldVersion, steps, presenceState};

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
                                                id: this.id,
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

                return {oldVersion, steps, presenceState};
            },
        );

        if (steps.length === 0) return {presenceState, hasSentPresenceState: false};

        // We have to wait for some async data dependencies to send
        // `UpdateContentWithoutPersistence`. We load our data without:
        //
        // - Blocking persistence
        // - Blocking the update queue
        //
        // However, this means you don't get ordering guarantees around
        // `UpdateContentWithoutPersistence`! You may receive these events in any order
        // because the timing of loading content references will vary.
        this._sendMessageToAll(context, {
            type: "UpdateContentWithoutPersistence",
            newVersion: oldVersion + steps.length,
            steps,
            stepsContentReferences: await getContentReferencesFromSteps(
                context,
                this.spaceId,
                steps,
            ),
            clientId: update.clientId,
            updateOtherPresenceState: {
                connectionId,
                state: presenceState,
            },
        });

        return {presenceState, hasSentPresenceState: true};
    }
}
