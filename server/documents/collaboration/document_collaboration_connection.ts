import {
    WorkerActionContext,
    WorkerSessionActionContext,
    WorkerSessionActionContextModules,
} from "~/server/cloudflare/context/worker_action_context.js";
import {WorkerProcessContext} from "~/server/cloudflare/context/worker_process_context.js";
import {
    DocumentCollaborationContentManager,
    DocumentCollaborationContentManagerOptimisticCommentThread,
} from "~/server/documents/collaboration/document_collaboration_content_manager.js";
import {TestCheckpoint} from "~/server/helpers/test/test_checkpoint.js";
import {MessagingRealtimeConnection} from "~/server/messaging/realtime/messaging_realtime_connection.js";
import {WebSocketConnectionProcedures} from "~/server/web_socket/web_socket_server.js";
import {getContentReferencedIdsForNode} from "~/shared/content/content_referenced_ids.js";
import {
    DocumentCollaborationEvent,
    DocumentCollaborationPresenceState,
    DocumentCollaborationProtocol,
} from "~/shared/documents/document_collaboration_protocol.js";
import {DocumentContentProsemirrorSchema} from "~/shared/documents/document_content_schema.js";
import {
    documentBackfillFutureVersionErrorMessage,
    documentPermissionDeniedErrorDisplayMessageByExpectedAccessLevel,
} from "~/shared/documents/document_error_messages.js";
import {
    DocumentCommentModel,
    DocumentCommentRoomKey,
    DocumentCommentThreadModel,
    decodeDocumentCommentRoomKey,
    encodeDocumentCommentRoomKey,
} from "~/shared/documents/document_model.js";
import {stripDocumentContentStepCommentMarks} from "~/shared/documents/strip_document_content_comment_marks.js";
import {
    FailedPreconditionError,
    InternalError,
    NotFoundError,
    PermissionDeniedError,
} from "~/shared/error/error.js";
import {emptyArray} from "~/shared/helpers/array/empty_array.js";
import {MutexValue} from "~/shared/helpers/async/mutex_value.js";
import {runAllPromiseThunks, runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {filterMapIterable} from "~/shared/helpers/iterable/filter_map_iterable.js";
import {mapIterable} from "~/shared/helpers/iterable/map_iterable.js";
import {DefaultMap} from "~/shared/helpers/map/default_map.js";
import {generateId} from "~/shared/id/id.js";
import {
    DocumentCommentThreadId,
    DocumentId,
    WebSocketConnectionId,
} from "~/shared/id/types/id_types.js";
import {
    AddMarksAfterRemoveAllStep,
    RemoveAllMarksStep,
} from "~/shared/prosemirror/remove_all_marks_step.js";
import {
    authorizeDocumentAccess,
    backfillDocumentComments,
    createDocumentComment,
    deleteDocumentComment,
    getDocumentCommentThreadAndInitialCommentsIfExists,
    getDocumentCommentsFromEnd,
    getDocumentCommentsFromStart,
    getDocumentPreviewIfExists,
    getOptimisticDocumentCommentReferences,
    getResolvedDocumentCommentThreadRanges,
    updateDocumentCommentContent,
} from "~/shared/rpc/documents_rpc_definitions.js";
import {TracerSpan} from "~/shared/tracer/tracer_span.js";

export const documentCollaborationConnectionBeforeBackfillMessagesTestCheckpoint =
    new TestCheckpoint<{documentId: DocumentId; commentThreadId: DocumentCommentThreadId}>();

export class DocumentCollaborationConnection {
    public readonly withoutComments: boolean;
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
    public readonly resetAuthorizationTimer: (context: WorkerProcessContext) => void;
    private readonly _killProcess: (context: WorkerProcessContext) => void;

    private _state = new MutexValue<{
        presenceState: DocumentCollaborationPresenceState | null;
    }>({
        presenceState: null,
    });

    constructor({
        withoutComments,
        connectionId,
        contentManager,
        sendEvent,
        sendEventToOthers,
        iterateOtherConnections,
        resetAuthorizationTimer,
        killProcess,
    }: {
        withoutComments: boolean;
        connectionId: WebSocketConnectionId;
        contentManager: DocumentCollaborationContentManager;
        sendEvent: (context: WorkerProcessContext, message: DocumentCollaborationEvent) => void;
        sendEventToOthers: (
            context: WorkerProcessContext,
            message: DocumentCollaborationEvent,
        ) => void;
        iterateOtherConnections: () => Iterable<DocumentCollaborationConnection>;
        resetAuthorizationTimer: (context: WorkerProcessContext) => void;
        killProcess: (context: WorkerProcessContext) => void;
    }) {
        this.withoutComments = withoutComments;
        this.connectionId = connectionId;
        this._contentManager = contentManager;
        this._sendEvent = sendEvent;
        this._sendEventToOthers = sendEventToOthers;
        this._iterateOtherConnections = iterateOtherConnections;
        this.resetAuthorizationTimer = resetAuthorizationTimer;
        this._killProcess = killProcess;
    }

    public async authorize(context: WorkerSessionActionContext) {
        await authorizeDocumentAccess(context, {
            documentId: this._contentManager.id,
            expectedAccessLevel: this.withoutComments ? "View" : "Comment",
            // You must have space access to receive document realtime events. We don't
            // currently allow anonymous users to see document updates in realtime.
            withSpaceAccess: true,
        });
    }

    private _authorizeCommentAccess() {
        if (this.withoutComments) {
            throw new PermissionDeniedError("Can’t see document comments", {
                displayMessage:
                    documentPermissionDeniedErrorDisplayMessageByExpectedAccessLevel.Comment,
            });
        }
    }

    public getPersistedVersion() {
        return this._contentManager.getPersistedVersion();
    }

    public getPresenceState() {
        return this._state.getWithoutLock().presenceState;
    }

    public readonly procedures: WebSocketConnectionProcedures<
        WorkerSessionActionContextModules,
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
            this._state.withLock(async () => {
                const version = this._contentManager.getCurrentVersion();
                const persistedVersion = this._contentManager.getPersistedVersion();

                let smallestPresenceStateVersion: number | null = null;

                const presenceStates = Array.from(
                    filterMapIterable(this._iterateOtherConnections(), connection => {
                        const state = connection.getPresenceState();
                        if (!state) return;

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

                    // If the client detects this specific error message it will revert any
                    // confirmed but not persisted steps and try backfilling again.
                    throw new FailedPreconditionError(documentBackfillFutureVersionErrorMessage);
                }

                const [{steps, stepsContentReferences}, rememberInvertedSteps] =
                    await runAllPromiseThunks(
                        async () => {
                            let steps = await this._contentManager.stepCache.getSteps(
                                context,
                                clientVersion,
                                version,
                            );

                            if (this.withoutComments) {
                                steps = steps.map(({step, invertedStep, clientId}) => ({
                                    step: stripDocumentContentStepCommentMarks(step),
                                    invertedStep:
                                        stripDocumentContentStepCommentMarks(invertedStep),
                                    clientId,
                                }));
                            }

                            const {references: stepsContentReferences} =
                                await this._contentManager.getContentReferencesForSteps(
                                    context,
                                    steps.map(({step}) => step),
                                );

                            return {
                                steps,
                                stepsContentReferences,
                            };
                        },
                        async () => {
                            const rememberVersion = Math.min(
                                clientVersion,
                                persistedVersion,
                                smallestPresenceStateVersion ?? Infinity,
                            );

                            if (rememberVersion >= clientVersion) return emptyArray;

                            let rememberInvertedSteps = (
                                await this._contentManager.stepCache.getSteps(
                                    context,
                                    rememberVersion,
                                    clientVersion,
                                )
                            ).map(({invertedStep}) => invertedStep);

                            if (this.withoutComments) {
                                rememberInvertedSteps = rememberInvertedSteps.map(
                                    stripDocumentContentStepCommentMarks,
                                );
                            }

                            return rememberInvertedSteps;
                        },
                    );

                // Safety check: By this point if the user doesn't have comment access we
                // shouldn't have any comment thread references because we stripped out all
                // comment marks. Double check before returning just to make sure.
                if (this.withoutComments) {
                    assert(stepsContentReferences.commentThreadById.size === 0);
                }

                return {
                    newVersion: version,
                    persistedVersion,
                    steps,
                    stepsContentReferences,
                    presenceStates,
                    rememberInvertedSteps,
                };
            }),

        updateContent: (context, input) => {
            if (this.withoutComments) {
                throw new PermissionDeniedError("Can’t update document", {
                    displayMessage:
                        documentPermissionDeniedErrorDisplayMessageByExpectedAccessLevel.Edit,
                });
            }

            // Handle procedures for this connection in sequence as a defense against
            // race conditions.
            //
            // Example race condition: Two `updateOurPresenceState` in fast succession. The
            // second finishes before the first because of some async race condition. A
            // `updateContent` then a `updateOurPresenceState` is perhaps a better example.
            //
            // The client mostly sends messages in sequence anyway.
            return this._state.withLock(async stateRef => {
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

                stateRef.current.presenceState = presenceState;
                return {};
            });
        },

        updateOurPresenceState: (context, input) =>
            // Handle procedures for this connection in sequence as a defense against
            // race conditions.
            //
            // Example race condition: Two `updateOurPresenceState` in fast succession. The
            // second finishes before the first because of some async race condition. A
            // `updateContent` then a `updateOurPresenceState` is perhaps a better example.
            //
            // The client mostly sends messages in sequence anyway.
            this._state.withLock(async stateRef => {
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
                            "Presence state version is outside the document’s version range",
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

                stateRef.current.presenceState = presenceState;
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
            this._authorizeCommentAccess();

            const connection = await this._getCommentThreadConnection(commentThreadId);

            const {
                messageCount: commentCount,
                lastMessageChangeTime: lastCommentChangeTime,
                newMessages: newComments,
                newOtherReferencedMessages: newOtherReferencedComments,
                messageChangesResult: commentChangesResult,
                typingStateByConnectionId,
                extra: {commentThread},
            } = await connection.backfillMessages(context, {
                clientMessageCount,
                clientLastMessageChangeTime,
                newMessageLimit,
            });

            return {
                commentThread,
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
            {commentThreadId, parentCommentIndex: parentMessageIndex, content, fileIds},
        ) => {
            this._authorizeCommentAccess();

            const connection = await this._getCommentThreadConnection(commentThreadId);
            return connection.createMessage(context, {parentMessageIndex, content, fileIds});
        },

        updateCommentContent: async (
            context,
            {commentThreadId, commentIndex: messageIndex, content},
        ) => {
            this._authorizeCommentAccess();

            const connection = await this._getCommentThreadConnection(commentThreadId);
            return connection.updateMessageContent(context, {messageIndex, content});
        },

        deleteComment: async (context, {commentThreadId, commentIndex: messageIndex}) => {
            this._authorizeCommentAccess();

            const connection = await this._getCommentThreadConnection(commentThreadId);
            return connection.deleteMessage(context, {messageIndex});
        },

        startTypingInCommentInput: async (context, input) => {
            this._authorizeCommentAccess();

            const connection = await this._getCommentThreadConnection(input.commentThreadId);
            return connection.startTypingInMessageInput(context, input);
        },

        stopTypingInCommentInput: async (context, input) => {
            this._authorizeCommentAccess();

            const connection = await this._getCommentThreadConnection(input.commentThreadId);
            return connection.stopTypingInMessageInput(context, input);
        },

        getCommentThreadAndInitialCommentsIfExists: async (context, input) => {
            this._authorizeCommentAccess();

            // Wait for any pending messages related to document comments before handling
            // comment messages. This way if we are processing an `UpdateContent` that
            // creates the comment thread we are trying to access we will wait until it
            // is ready.
            //
            // However, we do not want to block other document content messages with our
            // comments processing! Which is why we don't use `withLock()`.
            await this._state.waitForUnlock();

            const optimisticCommentThread = this._contentManager.getOptimisticCommentThreadIfExists(
                input.commentThreadId,
            );

            if (!optimisticCommentThread) {
                return getDocumentCommentThreadAndInitialCommentsIfExists(context, {
                    documentId: this._contentManager.id,
                    ...input,
                });
            }

            const {commentThread, comment} = await this._getOptimisticCommentThread(
                context,
                input.commentThreadId,
                optimisticCommentThread,
            );

            return {
                commentThread,
                initialComments: input.limit > 0 ? [comment] : [],
                initialOtherReferencedComments: [],
            };
        },

        getCommentsFromStart: async (context, input) => {
            this._authorizeCommentAccess();

            // Wait for any pending messages related to document comments before handling
            // comment messages. This way if we are processing an `UpdateContent` that
            // creates the comment thread we are trying to access we will wait until it
            // is ready.
            //
            // However, we do not want to block other document content messages with our
            // comments processing! Which is why we don't use `withLock()`.
            await this._state.waitForUnlock();

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
            this._authorizeCommentAccess();

            // Wait for any pending messages related to document comments before handling
            // comment messages. This way if we are processing an `UpdateContent` that
            // creates the comment thread we are trying to access we will wait until it
            // is ready.
            //
            // However, we do not want to block other document content messages with our
            // comments processing! Which is why we don't use `withLock()`.
            await this._state.waitForUnlock();

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

        resolveCommentThread: async (context, {commentThreadId}) => {
            this._authorizeCommentAccess();

            // Wait for any pending messages related to document comments before handling
            // comment messages. This way if we are processing an `UpdateContent` that
            // creates the comment thread we are trying to access we will wait until it
            // is ready.
            //
            // However, we do not want to block other document content messages with our
            // comments processing! Which is why we don't use `withLock()`.
            await this._state.waitForUnlock();

            // We use a `null` `connectionId` and generate a new `clientId` because the
            // client doesn't know about these update steps. It needs to apply the realtime
            // update for the `RemoveAllMarksStep` along with all other clients. We also
            // don't update the client's presence state along with these updates.
            await this._contentManager.update(context, null, {
                version: this._contentManager.getCurrentVersion(),
                steps: [
                    new RemoveAllMarksStep(
                        DocumentContentProsemirrorSchema.marks.comment.create({
                            commentThreadId,
                        }),
                    ),
                ],
                clientId: generateId(),
                createCommentThreads: [],
                intentionallyUpdateAccessPolicy: null,
                resolveCommentThreadIds: [commentThreadId],
                updateOurPresenceState: {state: null},
            });

            return {};
        },

        unresolveCommentThread: async (context, {commentThreadId}) => {
            this._authorizeCommentAccess();

            // Wait for any pending messages related to document comments before handling
            // comment messages. This way if we are processing an `UpdateContent` that
            // creates the comment thread we are trying to access we will wait until it
            // is ready.
            //
            // However, we do not want to block other document content messages with our
            // comments processing! Which is why we don't use `withLock()`.
            await this._state.waitForUnlock();

            // NOTE(calebmer): Warning! Calling an RPC here creates a network waterfall
            // which can be slow. The network flow is:
            //
            // 1. RPC `getResolvedDocumentCommentThreadRanges`
            //    - Cloudflare `DocumentCollaborationService` → AWS `AppService`
            //    - AWS `AppService` → Cloudflare `DocumentCollaborationService`
            // 2. RPC `updateDocumentContent`
            //    - Cloudflare `DocumentCollaborationService` → AWS `AppService`
            //    - AWS `AppService` → Cloudflare `DocumentCollaborationService`
            //
            // Given this Durable Object runs on the edge this doubles the network latency
            // penalty from Cloudflare to AWS. Ideally we'd only make one network request
            // to app service per procedure.
            //
            // Since this procedure is relatively uncommon and our document collaboration
            // service needs to know which steps to commit before calling back to app
            // service, we tolerate this.
            const {version, ranges} = await getResolvedDocumentCommentThreadRanges(context, {
                documentId: this._contentManager.id,
                commentThreadId,
            });

            // We use a `null` `connectionId` and generate a new `clientId` because the
            // client doesn't know about these update steps. It needs to apply the realtime
            // update for the `AddMarksAfterRemoveAllStep` along with all other clients. We
            // also don't update the client's presence state along with these updates.
            await this._contentManager.update(context, null, {
                // This update runs at an old version. The ranges will need to be rebased with
                // all updates that have happened since that old version.
                version,
                steps: [
                    new AddMarksAfterRemoveAllStep(
                        DocumentContentProsemirrorSchema.marks.comment.create({
                            commentThreadId,
                        }),
                        ranges,
                    ),
                ],
                clientId: generateId(),
                createCommentThreads: [],
                intentionallyUpdateAccessPolicy: null,
                unresolveCommentThreadIds: [commentThreadId],
                updateOurPresenceState: {state: null},
            });

            return {};
        },
    };

    public handleClose(context: WorkerProcessContext) {
        context.process.waitUntil(
            // Make sure we run in the queue in case we're wrapping up message handling. We
            // want to send our null presence state after we send any other
            // presence states.
            this._state.withLock(async stateRef => {
                // When the connection closes, clear the presence state in our other
                // connections.
                if (stateRef.current.presenceState !== null) {
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
        // comments processing! Which is why we don't wrap the `handleMessage()` call
        // with `withLock()`.
        await this._state.waitForUnlock();

        return this._commentThreadConnectionById.getOrSetDefault(commentThreadId);
    }

    private readonly _commentThreadConnectionById: DefaultMap<
        DocumentCommentThreadId,
        MessagingRealtimeConnection<
            DocumentCommentRoomKey,
            DocumentCommentModel,
            {commentThread: DocumentCommentThreadModel}
        >
    > = new DefaultMap(commentThreadId => {
        return new MessagingRealtimeConnection({
            connectionId: this.connectionId,
            spaceId: this._contentManager.spaceId,
            roomKey: encodeDocumentCommentRoomKey(this._contentManager.id, commentThreadId),
            sendEvent: (context, event) => {
                if (this.withoutComments) return;
                this._sendEvent(context, {type: "Comments", commentThreadId, event});
            },
            sendEventToOthers: (context, event) => {
                this._sendEventToOthers(context, {type: "Comments", commentThreadId, event});
            },
            iterateOtherConnections: () => {
                return mapIterable(this._iterateOtherConnections(), connection =>
                    connection._commentThreadConnectionById.getOrSetDefault(commentThreadId),
                );
            },
            createMessage: async (
                context,
                {roomKey, parentMessageIndex: parentCommentIndex, content, fileIds},
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

                const {comment} = await createDocumentComment(context, {
                    documentId,
                    commentThreadId,
                    parentCommentIndex,
                    content,
                    fileIds,
                });

                return comment;
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
                        "Comment thread hasn’t persisted so returning optimistic backfill",
                        async context => {
                            const {commentThread, comment} = await this._getOptimisticCommentThread(
                                context,
                                commentThreadId,
                                optimisticCommentThread,
                            );

                            return {
                                messageCount: 1,
                                lastMessageChangeTime: null,
                                newMessages:
                                    clientCommentCount < 1 && newCommentLimit > 0 ? [comment] : [],
                                newOtherReferencedMessages: [],
                                messageChangesResult: {type: "Available", changes: []},
                                extra: {commentThread},
                            };
                        },
                    );
                }

                const {
                    commentThread,
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
                    extra: {commentThread},
                };
            },
        });
    });

    private async _getOptimisticCommentThreadComment(
        context: WorkerActionContext,
        commentThreadId: DocumentCommentThreadId,
        optimisticCommentThread: DocumentCollaborationContentManagerOptimisticCommentThread,
    ) {
        const {author, contentReferences, files} = await getOptimisticDocumentCommentReferences(
            context,
            {
                spaceId: this._contentManager.spaceId,
                documentId: this._contentManager.id,
                authorId: optimisticCommentThread.initialComment.authorId,
                contentReferencedIds: getContentReferencedIdsForNode(
                    optimisticCommentThread.initialComment.content,
                ),
                fileIds: optimisticCommentThread.initialComment.fileIds,
            },
        );

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
                files,
            },
        });
    }

    private async _getOptimisticCommentThread(
        context: WorkerActionContext,
        commentThreadId: DocumentCommentThreadId,
        optimisticCommentThread: DocumentCollaborationContentManagerOptimisticCommentThread,
    ) {
        const comment = await this._getOptimisticCommentThreadComment(
            context,
            commentThreadId,
            optimisticCommentThread,
        );

        return {
            comment,
            commentThread: new DocumentCommentThreadModel({
                id: commentThreadId,
                documentId: this._contentManager.id,
                createdTime: optimisticCommentThread.createdTime,
                version: 0,
                fallbackContentSnippet: null,
                isResolved: false,
                commentCount: 1,
                lastCommentChangeTime: null,
                firstCommentAuthor: comment.author,
            }),
        };
    }
}
