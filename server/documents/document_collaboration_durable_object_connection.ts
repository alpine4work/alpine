import {DocumentCollaborationContentManager} from "~/server/documents/document_collaboration_content_manager";
import {ProcessContext} from "~/server/dynamo/context/process_context";
import {RequestContext} from "~/server/dynamo/context/request_context";
import {getDocumentPreview} from "~/server/dynamo/documents_table";
import {
    DocumentCollaborationMessageFromClient,
    DocumentCollaborationMessageFromServer,
    DocumentCollaborationPresenceState,
} from "~/shared/documents/document_collaboration_schema";
import {FailedPreconditionError, InternalError, NotFoundError} from "~/shared/error/error";
import {AsyncSequentialQueue} from "~/shared/helpers/async/async_sequential_queue";
import {exhaustive} from "~/shared/helpers/control/exhaustive";
import {filterMapIterable} from "~/shared/helpers/iterable/filter_map_iterable";
import {WebSocketConnectionId} from "~/shared/id/types/id_types";
import {TracerSpan} from "~/shared/tracer/tracer_span";

export class DocumentCollaborationDurableObjectConnection {
    public readonly connectionId: WebSocketConnectionId;

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
        connectionId: WebSocketConnectionId;
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
                                this._contentManager.id,
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
