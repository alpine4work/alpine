import {WorkerActionContext} from "~/server/cloudflare/context/worker_action_context.js";
import {WorkerProcessContext} from "~/server/cloudflare/context/worker_process_context.js";
import {WebSocketConnectionProcedures} from "~/server/cloudflare/web_socket_server.js";
import {
    DocumentCollaborationContentManager,
    DocumentCollaborationContentManagerOptimisticCommentThread,
} from "~/server/documents/document_collaboration_content_manager.js";
import {TestCheckpoint} from "~/server/helpers/test/test_checkpoint.js";
import {MessagingRealtimeConnection} from "~/server/messaging/messaging_realtime_connection.js";
import {getContentReferencedIdsForNode} from "~/shared/content/content_referenced_ids.js";
import {
    DocumentCollaborationEvent,
    DocumentCollaborationPresenceState,
    DocumentCollaborationProtocol,
} from "~/shared/documents/document_collaboration_protocol.js";
import {
    DocumentCommentModel,
    DocumentCommentRoomKey,
    DocumentCommentThreadModel,
    decodeDocumentCommentRoomKey,
    encodeDocumentCommentRoomKey,
} from "~/shared/documents/document_model.js";
import {FailedPreconditionError, InternalError, NotFoundError} from "~/shared/error/error.js";
import {AsyncMutex} from "~/shared/helpers/async/async_mutex.js";
import {runAllPromiseThunks, runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {filterMapIterable} from "~/shared/helpers/iterable/filter_map_iterable.js";
import {mapIterable} from "~/shared/helpers/iterable/map_iterable.js";
import {DefaultMap} from "~/shared/helpers/map/default_map.js";
import {
    DocumentCommentThreadId,
    DocumentId,
    WebSocketConnectionId,
} from "~/shared/id/types/id_types.js";
import {
    backfillDocumentComments,
    createDocumentComment,
    deleteDocumentComment,
    getDocumentCommentThreadAndInitialComments,
    getDocumentCommentsFromEnd,
    getDocumentCommentsFromStart,
    getDocumentPreviewIfExists,
    getOptimisticDocumentCommentReferences,
    updateDocumentCommentContent,
} from "~/shared/rpc/documents_rpc_definitions.js";
import {TracerSpan} from "~/shared/tracer/tracer_span.js";

export const documentCollaborationConnectionBeforeBackfillMessagesTestCheckpoint =
    new TestCheckpoint<{documentId: DocumentId; commentThreadId: DocumentCommentThreadId}>();

export class DocumentCollaborationConnection {
    public readonly connectionId: WebSocketConnectionId;

    private readonly _contentManager: DocumentCollaborationContentManager;
    private readonly _sendEvent: (
        context: WorkerProcessContext,
        message: DocumentCollaborationEvent,
    ) => void;
    private readonly _sendEventToOthers: (
        context: WorkerProcessContext,
        message: DocumentCollaborationEvent,
    ) => void;
    private readonly _iterateOtherConnections: () => Iterable<DocumentCollaborationConnection>;
    private readonly _killProcess: (context: WorkerProcessContext) => void;

    private _state = new AsyncMutex<{
        presenceState: DocumentCollaborationPresenceState | null;
    }>({
        presenceState: null,
    });

    constructor({
        connectionId,
        contentManager,
        sendEvent,
        sendEventToOthers,
        iterateOtherConnections,
        killProcess,
    }: {
        connectionId: WebSocketConnectionId;
        contentManager: DocumentCollaborationContentManager;
        sendEvent: (context: WorkerProcessContext, message: DocumentCollaborationEvent) => void;
        sendEventToOthers: (
            context: WorkerProcessContext,
            message: DocumentCollaborationEvent,
        ) => void;
        iterateOtherConnections: () => Iterable<DocumentCollaborationConnection>;
        killProcess: (context: WorkerProcessContext) => void;
    }) {
        this.connectionId = connectionId;
        this._contentManager = contentManager;
        this._sendEvent = sendEvent;
        this._sendEventToOthers = sendEventToOthers;
        this._iterateOtherConnections = iterateOtherConnections;
        this._killProcess = killProcess;
    }

    public getPersistedVersion() {
        return this._contentManager.getPersistedVersion();
    }

    public getPresenceState() {
        return this._state.get().presenceState;
    }

    public readonly procedures: WebSocketConnectionProcedures<
        typeof DocumentCollaborationProtocol
    > = {
        backfill: (context, input, span) =>
            // Handle procedures for this connection in sequence as a defense against
            // race conditions.
            //
            // Example race condition: Two `updateOurPresenceState` in fast succession. The
            // second finishes before the first because of some async race condition. A
            // `updateContent` then a `updateOurPresenceState` is perhaps a better example.
            //
            // The client mostly sends messages in sequence anyway.
            this._state.run(async () => {
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

                const clientVersion = input.version;

                if (clientVersion > version) {
                    // Sometimes, if the version in our backfill request appears to be in the
                    // future it's because the client loaded a version of the document from the
                    // database that is ahead of the version of the document in the durable object.
                    //
                    // So load the document from our database and if its version is ahead of the
                    // one in our durable object then we want to destroy the entire durable object.
                    const {documentPreview} = await getDocumentPreviewIfExists(context, {
                        documentId: this._contentManager.id,
                    });
                    if (!documentPreview) {
                        const error = new NotFoundError(
                            "Document was deleted since durable object started",
                        );

                        this._sendFatalErrorMessageAndKillProcess(context, span, error);
                        throw error;
                    }
                    if (documentPreview.version > version) {
                        const error = new InternalError(
                            "Document version in durable object is out of sync with actual document version",
                        );

                        this._sendFatalErrorMessageAndKillProcess(context, span, error);
                        throw error;
                    }

                    throw new FailedPreconditionError(
                        "Tried to backfill a future document version",
                    );
                }

                const [{steps, stepsContentReferences}, rememberSteps] = await runAllPromiseThunks(
                    async () => {
                        const steps = await this._contentManager.stepCache.getSteps(
                            context,
                            clientVersion,
                            version,
                        );

                        const stepsContentReferences =
                            await this._contentManager.getContentReferencesForSteps(
                                context,
                                steps.map(({step}) => step),
                            );

                        return {
                            steps,
                            stepsContentReferences,
                        };
                    },
                    async () =>
                        smallestPresenceStateVersion && smallestPresenceStateVersion < clientVersion
                            ? await this._contentManager.stepCache.getSteps(
                                  context,
                                  smallestPresenceStateVersion,
                                  clientVersion,
                              )
                            : [],
                );

                return {
                    newVersion: version,
                    steps,
                    stepsContentReferences,
                    presenceStates,
                    rememberInvertedSteps: rememberSteps.map(({invertedStep}) => invertedStep),
                };
            }),

        updateContent: (context, input) =>
            // Handle procedures for this connection in sequence as a defense against
            // race conditions.
            //
            // Example race condition: Two `updateOurPresenceState` in fast succession. The
            // second finishes before the first because of some async race condition. A
            // `updateContent` then a `updateOurPresenceState` is perhaps a better example.
            //
            // The client mostly sends messages in sequence anyway.
            this._state.run(async (state, setState) => {
                const {presenceState, hasSentPresenceState} = await this._contentManager.update(
                    context,
                    this.connectionId,
                    input,
                );

                if (!hasSentPresenceState) {
                    this._sendEventToOthers(context, {
                        type: "UpdateOtherPresenceState",
                        connectionId: this.connectionId,
                        state: presenceState,
                    });
                }

                setState({...state, presenceState});
                return {};
            }),

        updateOurPresenceState: (context, input) =>
            // Handle procedures for this connection in sequence as a defense against
            // race conditions.
            //
            // Example race condition: Two `updateOurPresenceState` in fast succession. The
            // second finishes before the first because of some async race condition. A
            // `updateContent` then a `updateOurPresenceState` is perhaps a better example.
            //
            // The client mostly sends messages in sequence anyway.
            this._state.run(async (state, setState) => {
                // Make sure the new presence state is valid before we broadcast it to our
                // other clients.
                let presenceState: DocumentCollaborationPresenceState | null;
                if (!input.state) {
                    presenceState = null;
                } else {
                    const isVersionValid =
                        input.state.version >= 0 &&
                        input.state.version <= this._contentManager.getCurrentVersion();

                    if (!isVersionValid)
                        throw new FailedPreconditionError(
                            "Presence state version is outside the document's version range",
                        );

                    const oldContent = await this._contentManager.getContentAtVersion(
                        context,
                        input.state.version,
                    );

                    // Call this function to deserialize the selection! If deserialization fails an
                    // error will be thrown.
                    input.state.selection.getAndMaybeDeserialize(oldContent);

                    presenceState = input.state;
                }

                this._sendEventToOthers(context, {
                    type: "UpdateOtherPresenceState",
                    connectionId: this.connectionId,
                    state: presenceState,
                });

                setState({...state, presenceState});
                return {};
            }),

        backfillComments: async (
            context,
            {
                commentThreadId,
                clientCommentCount: clientMessageCount,
                clientLastCommentChangeTime: clientLastMessageChangeTime,
                newCommentLimit: newMessageLimit,
            },
        ) => {
            const connection = await this._getCommentThreadConnection(commentThreadId);

            const {
                messageCount: commentCount,
                lastMessageChangeTime: lastCommentChangeTime,
                newMessages: newComments,
                newOtherReferencedMessages: newOtherReferencedComments,
                messageChangesResult: commentChangesResult,
                typingStateByConnectionId,
            } = await connection.backfillMessages(context, {
                clientMessageCount,
                clientLastMessageChangeTime,
                newMessageLimit,
            });

            return {
                commentCount,
                lastCommentChangeTime,
                newComments,
                newOtherReferencedComments,
                commentChangesResult,
                typingStateByConnectionId,
            };
        },

        createComment: async (
            context,
            {commentThreadId, parentCommentIndex: parentMessageIndex, content},
        ) => {
            const connection = await this._getCommentThreadConnection(commentThreadId);
            return connection.createMessage(context, {parentMessageIndex, content});
        },

        updateCommentContent: async (
            context,
            {commentThreadId, commentIndex: messageIndex, content},
        ) => {
            const connection = await this._getCommentThreadConnection(commentThreadId);
            return connection.updateMessageContent(context, {messageIndex, content});
        },

        deleteComment: async (context, {commentThreadId, commentIndex: messageIndex}) => {
            const connection = await this._getCommentThreadConnection(commentThreadId);
            return connection.deleteMessage(context, {messageIndex});
        },

        startTypingInCommentInput: async (context, input) => {
            const connection = await this._getCommentThreadConnection(input.commentThreadId);
            return connection.startTypingInMessageInput(context, input);
        },

        stopTypingInCommentInput: async (context, input) => {
            const connection = await this._getCommentThreadConnection(input.commentThreadId);
            return connection.stopTypingInMessageInput(context, input);
        },

        getCommentThreadAndInitialComments: async (context, input) => {
            // Wait for any pending messages related to document comments before handling
            // comment messages. This way if we are processing an `UpdateContent` that
            // creates the comment thread we are trying to access we will wait until it
            // is ready.
            //
            // However, we do not want to block other document content messages with our
            // comments processing! Which is why we the body of our `run()` function is
            // a noop.
            await this._state.run(async () => {});

            const optimisticCommentThread = this._contentManager.getOptimisticCommentThreadIfExists(
                input.commentThreadId,
            );

            if (!optimisticCommentThread) {
                return getDocumentCommentThreadAndInitialComments(context, {
                    documentId: this._contentManager.id,
                    ...input,
                });
            }

            const comment = await this._getOptimisticCommentThreadComment(
                context,
                input.commentThreadId,
                optimisticCommentThread,
            );

            return {
                commentThread: new DocumentCommentThreadModel({
                    id: input.commentThreadId,
                    documentId: this._contentManager.id,
                    createdTime: optimisticCommentThread.createdTime,
                    commentCount: 1,
                    lastCommentChangeTime: null,
                    commentAuthors: [comment.author],
                }),
                initialComments: input.limit > 0 ? [comment] : [],
                initialOtherReferencedComments: [],
            };
        },

        getCommentsFromStart: async (context, input) => {
            // Wait for any pending messages related to document comments before handling
            // comment messages. This way if we are processing an `UpdateContent` that
            // creates the comment thread we are trying to access we will wait until it
            // is ready.
            //
            // However, we do not want to block other document content messages with our
            // comments processing! Which is why we the body of our `run()` function is
            // a noop.
            await this._state.run(async () => {});

            const optimisticCommentThread = this._contentManager.getOptimisticCommentThreadIfExists(
                input.commentThreadId,
            );

            if (!optimisticCommentThread) {
                return getDocumentCommentsFromStart(context, {
                    documentId: this._contentManager.id,
                    ...input,
                });
            }

            return {
                commentCount: 1,
                comments:
                    input.limit > 0 &&
                    (input.afterCommentIndex === null || input.afterCommentIndex < 0) &&
                    (input.beforeCommentIndex === null || input.beforeCommentIndex > 0)
                        ? [
                              await this._getOptimisticCommentThreadComment(
                                  context,
                                  input.commentThreadId,
                                  optimisticCommentThread,
                              ),
                          ]
                        : [],
                otherReferencedComments: [],
                lastCommentChangeTime: null,
            };
        },

        getCommentsFromEnd: async (context, input) => {
            // Wait for any pending messages related to document comments before handling
            // comment messages. This way if we are processing an `UpdateContent` that
            // creates the comment thread we are trying to access we will wait until it
            // is ready.
            //
            // However, we do not want to block other document content messages with our
            // comments processing! Which is why we the body of our `run()` function is
            // a noop.
            await this._state.run(async () => {});

            const optimisticCommentThread = this._contentManager.getOptimisticCommentThreadIfExists(
                input.commentThreadId,
            );

            if (!optimisticCommentThread) {
                return getDocumentCommentsFromEnd(context, {
                    documentId: this._contentManager.id,
                    ...input,
                });
            }

            return {
                commentCount: 1,
                comments:
                    input.limit > 0 &&
                    (input.afterCommentIndex === null || input.afterCommentIndex < 0) &&
                    (input.beforeCommentIndex === null || input.beforeCommentIndex > 0)
                        ? [
                              await this._getOptimisticCommentThreadComment(
                                  context,
                                  input.commentThreadId,
                                  optimisticCommentThread,
                              ),
                          ]
                        : [],
                otherReferencedComments: [],
                lastCommentChangeTime: null,
            };
        },
    };

    public handleClose(context: WorkerProcessContext) {
        context.process.waitUntil(
            // Make sure we run in the queue in case we're wrapping up message handling. We
            // want to send our null presence state after we send any other
            // presence states.
            this._state.run(async state => {
                // When the connection closes, clear the presence state in our other
                // connections.
                if (state.presenceState !== null) {
                    this._sendEventToOthers(context, {
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
        context: WorkerProcessContext,
        span: TracerSpan,
        error: unknown,
    ) {
        span.addException(error);

        this._sendEvent(context, {
            type: "Error",
            error,
        });
        this._sendEventToOthers(context, {
            type: "Error",
            error,
        });
        this._killProcess(context);
    }

    private async _getCommentThreadConnection(commentThreadId: DocumentCommentThreadId) {
        // Wait for any pending messages related to document comments before handling
        // comment messages. This way if we are processing an `UpdateContent` that
        // creates the comment thread we are trying to access we will wait until it
        // is ready.
        //
        // However, we do not want to block other document content messages with our
        // comments processing! Which is why we don't put the `handleMessage()` call in
        // the body of our `run()` function.
        await this._state.run(async () => {});

        return this._commentThreadConnectionById.getOrSetDefault(commentThreadId);
    }

    private readonly _commentThreadConnectionById: DefaultMap<
        DocumentCommentThreadId,
        MessagingRealtimeConnection<DocumentCommentRoomKey, DocumentCommentModel>
    > = new DefaultMap(commentThreadId => {
        return new MessagingRealtimeConnection({
            connectionId: this.connectionId,
            spaceId: this._contentManager.spaceId,
            roomKey: encodeDocumentCommentRoomKey(this._contentManager.id, commentThreadId),
            sendEvent: (context, event) =>
                this._sendEvent(context, {type: "Comments", commentThreadId, event}),
            sendEventToOthers: (context, event) =>
                this._sendEventToOthers(context, {type: "Comments", commentThreadId, event}),
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
                    this._contentManager.getOptimisticCommentThreadIfExists(commentThreadId);
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
                    this._contentManager.getOptimisticCommentThreadIfExists(commentThreadId);
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
                    this._contentManager.getOptimisticCommentThreadIfExists(commentThreadId);
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
                    this._contentManager.getOptimisticCommentThreadIfExists(commentThreadId);
                if (optimisticCommentThread) {
                    return context.tracer.withSpan(
                        "Comment thread hasn't persisted so returning optimistic backfill",
                        async context => {
                            return {
                                messageCount: 1,
                                lastMessageChangeTime: null,
                                newMessages:
                                    clientCommentCount < 1 && newCommentLimit > 0
                                        ? [
                                              await this._getOptimisticCommentThreadComment(
                                                  context,
                                                  commentThreadId,
                                                  optimisticCommentThread,
                                              ),
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

    private async _getOptimisticCommentThreadComment(
        context: WorkerActionContext,
        commentThreadId: DocumentCommentThreadId,
        optimisticCommentThread: DocumentCollaborationContentManagerOptimisticCommentThread,
    ) {
        const {author, contentReferences} = await getOptimisticDocumentCommentReferences(context, {
            spaceId: this._contentManager.spaceId,
            authorId: optimisticCommentThread.initialComment.authorId,
            contentReferencedIds: getContentReferencedIdsForNode(
                optimisticCommentThread.initialComment.content,
            ),
        });

        return new DocumentCommentModel({
            documentId: this._contentManager.id,
            commentThreadId,
            index: 0,
            author,
            createdTime: optimisticCommentThread.createdTime,
            payload: {
                type: "Content",
                parentMessageIndex: null,
                content: {
                    doc: optimisticCommentThread.initialComment.content,
                    references: contentReferences,
                },
                contentUpdatedTime: null,
            },
        });
    }
}
