import {DocumentCollaborationContentManager} from "~/server/documents/document_collaboration_content_manager";
import {getAccountOrThrow} from "~/server/dynamo/accounts_table";
import {ProcessContext} from "~/server/dynamo/context/process_context";
import {RequestContext} from "~/server/dynamo/context/request_context";
import {
    backfillDocumentComments,
    createDocumentComment,
    deleteDocumentComment,
    getDocumentPreview,
    updateDocumentCommentContent,
} from "~/server/dynamo/documents_table";
import {
    getContentReferencesForNode,
    getContentReferencesForSteps,
} from "~/server/dynamo/helpers/get_content_references";
import {TestCheckpoint} from "~/server/helpers/test/test_checkpoint";
import {MessagingRealtimeConnection} from "~/server/messaging/messaging_realtime_connection";
import {
    DocumentCollaborationMessageFromClient,
    DocumentCollaborationMessageFromServer,
    DocumentCollaborationPresenceState,
} from "~/shared/documents/document_collaboration_schema";
import {FailedPreconditionError, InternalError, NotFoundError} from "~/shared/error/error";
import {AsyncMutex} from "~/shared/helpers/async/async_mutex";
import {runAllPromiseThunks, runAllPromises} from "~/shared/helpers/async/run_all_promises";
import {exhaustive} from "~/shared/helpers/control/exhaustive";
import {filterMapIterable} from "~/shared/helpers/iterable/filter_map_iterable";
import {mapIterable} from "~/shared/helpers/iterable/map_iterable";
import {DefaultMap} from "~/shared/helpers/map/default_map";
import {
    DocumentCommentThreadId,
    DocumentId,
    WebSocketConnectionId,
} from "~/shared/id/types/id_types";
import {
    DocumentCommentModel,
    DocumentCommentRoomKey,
    decodeDocumentCommentRoomKey,
    encodeDocumentCommentRoomKey,
} from "~/shared/models/document_model";
import {TracerSpan} from "~/shared/tracer/tracer_span";

export const documentCollaborationConnectionBeforeBackfillMessagesTestCheckpoint =
    new TestCheckpoint<{documentId: DocumentId; commentThreadId: DocumentCommentThreadId}>();

export class DocumentCollaborationConnection {
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
    private readonly _iterateOtherConnections: () => Iterable<DocumentCollaborationConnection>;
    private readonly _killProcess: (context: ProcessContext) => void;

    private _state = new AsyncMutex<{
        presenceState: DocumentCollaborationPresenceState | null;
    }>({
        presenceState: null,
    });

    constructor({
        connectionId,
        contentManager,
        sendMessage,
        sendMessageToOthers,
        iterateOtherConnections,
        killProcess,
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
        iterateOtherConnections: () => Iterable<DocumentCollaborationConnection>;
        killProcess: (context: ProcessContext) => void;
    }) {
        this.connectionId = connectionId;
        this._contentManager = contentManager;
        this._sendMessage = sendMessage;
        this._sendMessageToOthers = sendMessageToOthers;
        this._iterateOtherConnections = iterateOtherConnections;
        this._killProcess = killProcess;
    }

    public getPersistedVersion() {
        return this._contentManager.getPersistedVersion();
    }

    public getPresenceState() {
        return this._state.get().presenceState;
    }

    public async handleMessage(
        context: RequestContext,
        message: DocumentCollaborationMessageFromClient,
        span: TracerSpan,
    ) {
        // Handle comment messages without blocking other document content
        // related messages.
        if (message.type === "Comments") {
            // Wait for any pending messages related to document comments before handling
            // comment messages. This way if we are processing an `UpdateContent` that
            // creates the comment thread we are trying to access we will wait until it
            // is ready.
            //
            // However, we do not want to block other document content messages with our
            // comments processing! Which is why we don't put the `handleMessage()` call in
            // the body of our `run()` function.
            await this._state.run(async () => {});

            const commentThreadConnection = this._commentThreadConnectionById.getOrSetDefault(
                message.commentThreadId,
            );
            return commentThreadConnection.handleMessage(context, message.message);
        }

        // Handle all messages for this connection in sequence as a defense against
        // race conditions.
        //
        // Example race condition: Two `UpdateOurPresenceState` in fast succession. The
        // second finishes before the first because of some async race condition. A
        // `UpdateContent` then a `UpdateOurPresenceState` is perhaps a better example.
        //
        // The client mostly sends messages in sequence anyway.
        await this._state.run(async (state, setState) => {
            switch (message.type) {
                case "BackfillRequest": {
                    const version = this._contentManager.getCurrentVersion();

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

                    const clientVersion = message.version;

                    if (clientVersion > version) {
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
                            this._sendFatalErrorMessageAndKillProcess(
                                context,
                                span,
                                new NotFoundError(
                                    "Document was deleted since durable object started",
                                ),
                            );
                            return;
                        }
                        if (documentPreview.version > version) {
                            this._sendFatalErrorMessageAndKillProcess(
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

                    const [{steps, stepsContentReferences}, rememberSteps] =
                        await runAllPromiseThunks(
                            async () => {
                                const steps = await this._contentManager.stepCache.getSteps(
                                    context,
                                    clientVersion,
                                    version,
                                );

                                const [stepsContentReferences, commentThreadById] =
                                    await runAllPromises([
                                        getContentReferencesForSteps(
                                            context,
                                            this._contentManager.spaceId,
                                            steps.map(({step}) => step),
                                        ),
                                        this._contentManager.getCommentThreadByIdForSteps(
                                            context,
                                            steps.map(({step}) => step),
                                        ),
                                    ]);

                                return {
                                    steps,
                                    stepsContentReferences: {
                                        ...stepsContentReferences,
                                        commentThreadById,
                                    },
                                };
                            },
                            async () =>
                                smallestPresenceStateVersion &&
                                smallestPresenceStateVersion < clientVersion
                                    ? await this._contentManager.stepCache.getSteps(
                                          context,
                                          smallestPresenceStateVersion,
                                          clientVersion,
                                      )
                                    : [],
                        );

                    // Load steps from our store and send them to the client to catch
                    // the client up...
                    this._sendMessage(context, {
                        type: "BackfillResponse",
                        newVersion: version,
                        steps,
                        stepsContentReferences,
                        presenceStates,
                        rememberInvertedSteps: rememberSteps.map(({invertedStep}) => invertedStep),
                    });
                    return;
                }
                case "UpdateContent": {
                    const {presenceState, hasSentPresenceState} = await this._contentManager.update(
                        context,
                        this.connectionId,
                        message,
                    );

                    if (!hasSentPresenceState) {
                        this._sendMessageToOthers(context, {
                            type: "UpdateOtherPresenceState",
                            connectionId: this.connectionId,
                            state: presenceState,
                        });
                    }

                    setState({...state, presenceState});
                    return;
                }
                case "UpdateOurPresenceState": {
                    // Make sure the new presence state is valid before we broadcast it to our
                    // other clients.
                    let presenceState: DocumentCollaborationPresenceState | null;
                    if (!message.state) {
                        presenceState = null;
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

                        presenceState = message.state;
                    }

                    this._sendMessageToOthers(context, {
                        type: "UpdateOtherPresenceState",
                        connectionId: this.connectionId,
                        state: presenceState,
                    });

                    setState({...state, presenceState});
                    return;
                }
                default:
                    throw exhaustive(message);
            }
        });
    }

    public handleClose(context: ProcessContext) {
        context.process.waitUntil(
            // Make sure we run in the queue in case we're wrapping up message handling. We
            // want to send our null presence state after we send any other
            // presence states.
            this._state.run(async state => {
                // When the connection closes, clear the presence state in our other
                // connections.
                if (state.presenceState !== null) {
                    this._sendMessageToOthers(context, {
                        type: "UpdateOtherPresenceState",
                        connectionId: this.connectionId,
                        state: null,
                    });
                }
            }),
        );

        context.process.waitUntil(async () => {
            await runAllPromises(
                mapIterable(this._commentThreadConnectionById.values(), commentThreadConnection =>
                    commentThreadConnection.handleClose(context),
                ),
            );
        });
    }

    private _sendFatalErrorMessageAndKillProcess(
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
        this._killProcess(context);
    }

    private readonly _commentThreadConnectionById: DefaultMap<
        DocumentCommentThreadId,
        MessagingRealtimeConnection<DocumentCommentRoomKey, DocumentCommentModel>
    > = new DefaultMap(commentThreadId => {
        return new MessagingRealtimeConnection({
            connectionId: this.connectionId,
            spaceId: this._contentManager.spaceId,
            roomKey: encodeDocumentCommentRoomKey(this._contentManager.id, commentThreadId),
            sendMessage: (context, message) =>
                this._sendMessage(context, {type: "Comments", commentThreadId, message}),
            sendMessageToOthers: (context, message) =>
                this._sendMessageToOthers(context, {type: "Comments", commentThreadId, message}),
            iterateOtherConnections: () =>
                mapIterable(this._iterateOtherConnections(), connection =>
                    connection._commentThreadConnectionById.getOrSetDefault(commentThreadId),
                ),
            createMessageModel: ({roomKey, index, createdTime, author, payload}) => {
                const [documentId, commentThreadId] = decodeDocumentCommentRoomKey(roomKey);

                return new DocumentCommentModel({
                    documentId,
                    commentThreadId,
                    index,
                    createdTime,
                    author,
                    payload,
                });
            },
            createMessage: async (
                context,
                {roomKey, parentMessageIndex: parentCommentIndex, content},
            ) => {
                const [documentId, commentThreadId] = decodeDocumentCommentRoomKey(roomKey);

                // Wait for our optimistic comment thread to persist before talking to
                // the database.
                const optimisticCommentThread =
                    this._contentManager.getOptimisticCommentThread(commentThreadId);
                if (optimisticCommentThread) {
                    await context.tracer.withSpan(
                        "Waiting for comment thread to persist",
                        () => optimisticCommentThread.persistedPromise,
                    );
                }

                const comment = await createDocumentComment(context, {
                    documentId,
                    commentThreadId,
                    parentCommentIndex,
                    content,
                });

                return {
                    index: comment.index,
                    createdTime: comment.createdTime,
                };
            },
            updateMessageContent: async (
                context,
                {roomKey, messageIndex: commentIndex, content},
            ) => {
                const [documentId, commentThreadId] = decodeDocumentCommentRoomKey(roomKey);

                // Wait for our optimistic comment thread to persist before talking to
                // the database.
                const optimisticCommentThread =
                    this._contentManager.getOptimisticCommentThread(commentThreadId);
                if (optimisticCommentThread) {
                    await context.tracer.withSpan(
                        "Waiting for comment thread to persist",
                        () => optimisticCommentThread.persistedPromise,
                    );
                }

                return updateDocumentCommentContent(context, {
                    documentId,
                    commentThreadId,
                    commentIndex,
                    content,
                });
            },
            deleteMessage: async (context, {roomKey, messageIndex: commentIndex}) => {
                const [documentId, commentThreadId] = decodeDocumentCommentRoomKey(roomKey);

                // Wait for our optimistic comment thread to persist before talking to
                // the database.
                const optimisticCommentThread =
                    this._contentManager.getOptimisticCommentThread(commentThreadId);
                if (optimisticCommentThread) {
                    await context.tracer.withSpan(
                        "Waiting for comment thread to persist",
                        () => optimisticCommentThread.persistedPromise,
                    );
                }

                return deleteDocumentComment(context, {documentId, commentThreadId, commentIndex});
            },
            backfillMessages: async (
                context,
                {
                    roomKey,
                    clientMessageCount: clientCommentCount,
                    clientLastMessageChangeTime: clientLastCommentChangeTime,
                    newMessageLimit: newCommentLimit,
                },
            ) => {
                const [documentId, commentThreadId] = decodeDocumentCommentRoomKey(roomKey);

                // We manually implement `backfillMessages` when we have an optimistic comment
                // thread since going to the database would throw an error. That way the user
                // can immediately open a comment thread even if it's not persisted.
                const optimisticCommentThread =
                    this._contentManager.getOptimisticCommentThread(commentThreadId);
                if (optimisticCommentThread) {
                    return context.tracer.withSpan(
                        "Comment thread hasn't persisted so returning optimistic backfill",
                        async context => {
                            const [author, contentReferences] = await runAllPromises([
                                getAccountOrThrow(
                                    context,
                                    this._contentManager.spaceId,
                                    optimisticCommentThread.initialComment.authorId,
                                ),
                                getContentReferencesForNode(
                                    context,
                                    this._contentManager.spaceId,
                                    optimisticCommentThread.initialComment.content,
                                ),
                            ]);

                            return {
                                messageCount: 1,
                                lastMessageChangeTime: null,
                                newMessages:
                                    clientCommentCount < 1 && newCommentLimit > 0
                                        ? [
                                              new DocumentCommentModel({
                                                  documentId: this._contentManager.id,
                                                  commentThreadId,
                                                  index: 0,
                                                  author,
                                                  createdTime: optimisticCommentThread.createdTime,
                                                  payload: {
                                                      type: "Content",
                                                      parentMessageIndex: null,
                                                      content: {
                                                          doc: optimisticCommentThread
                                                              .initialComment.content,
                                                          references: contentReferences,
                                                      },
                                                      contentUpdatedTime: null,
                                                  },
                                              }),
                                          ]
                                        : [],
                                newOtherReferencedMessages: [],
                                messageChangesResult: {type: "Available", changes: []},
                            };
                        },
                    );
                }

                const {
                    commentCount,
                    lastCommentChangeTime,
                    newComments,
                    newOtherReferencedComments,
                    commentChangesResult,
                } = await backfillDocumentComments(context, {
                    documentId,
                    commentThreadId,
                    clientCommentCount,
                    clientLastCommentChangeTime,
                    newCommentLimit,
                });

                return {
                    messageCount: commentCount,
                    lastMessageChangeTime: lastCommentChangeTime,
                    newMessages: newComments,
                    newOtherReferencedMessages: newOtherReferencedComments,
                    messageChangesResult: commentChangesResult,
                };
            },
        });
    });
}
