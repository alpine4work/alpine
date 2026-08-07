import {Step} from "prosemirror-transform";
import {
    WorkerActionContext,
    WorkerSessionActionContext,
    WorkerSessionActionContextModules,
} from "~/server/cloudflare/context/worker_action_context.js";
import {WorkerProcessContext} from "~/server/cloudflare/context/worker_process_context.js";
import {
    BackfillMessagesFunction,
    CreateMessageFunction,
    CreateMessageModelFunction,
    DeleteMessageFunction,
    DeleteMessageReactionFunction,
    GetMessageAtVersionFunction,
    GetMessageReferencesFunction,
    MessagingRealtimeConnection,
    PutMessageApprovalDecisionsFunction,
    SetMessageReactionFunction,
    UpdateMessageContentFunction,
} from "~/server/messaging/realtime/messaging_realtime_connection.js";
import {MessagingRealtimeEventStub} from "~/server/messaging/realtime/messaging_realtime_event_stub.js";
import {TaskNotesCollaborationContentManager} from "~/server/tasks/notes_collaboration/task_notes_collaboration_content_manager.js";
import {WebSocketConnectionProcedures} from "~/server/web_socket/web_socket_server.js";
import {AccessLevel, hasAccessLevel} from "~/shared/access/access_policy.js";
import {
    ContentReferencedIds,
    getContentReferencedIdsForSteps,
    isEmptyContentReferencedIds,
} from "~/shared/content/content_referenced_ids.js";
import {emptyContentReferences} from "~/shared/content/content_references.js";
import {
    FailedPreconditionError,
    InternalError,
    PermissionDeniedError,
} from "~/shared/error/error.open_source.js";
import {Mutex} from "~/shared/helpers/async/mutex.open_source.js";
import {assert} from "~/shared/helpers/control/assert.open_source.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.open_source.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.open_source.js";
import {mapIterable} from "~/shared/helpers/iterable/map_iterable.open_source.js";
import {SafeFloatingPromise} from "~/shared/helpers/types/safe_floating_promise.js";
import {
    AccountId,
    ContentEditorClientId,
    TaskId,
    WebSocketConnectionId,
} from "~/shared/id/types/id_types.open_source.js";
import {
    MessagingRealtimeBroadcastCompleteMessageStreamRequest,
    MessagingRealtimeBroadcastNewMessageRequest,
    MessagingRealtimeBroadcastPutMessageStreamPartRequest,
} from "~/shared/messaging/messaging_realtime_protocol.js";
import {
    authorizeTaskAccess,
    backfillTaskComments,
    createTaskComment,
    deleteTaskComment,
    deleteTaskCommentReaction,
    getTaskCommentAtVersion,
    getTaskCommentReferences,
    getTaskNotesContent,
    getTaskNotesContentReferences,
    putTaskCommentMessageApprovalDecisions,
    setTaskCommentReaction,
    updateTaskCommentContent,
} from "~/shared/rpc/tasks_rpc_definitions.js";
import {TaskCommentModel} from "~/shared/tasks/model/task_comment_model.js";
import {
    taskNotesBackfillFutureVersionErrorMessage,
    taskPermissionDeniedErrorDisplayMessageByExpectedAccessLevel,
} from "~/shared/tasks/task_error_messages.js";
import {
    TaskNotesCollaborationEvent,
    TaskNotesCollaborationProtocol,
} from "~/shared/tasks/task_notes_collaboration_protocol.js";

export type TaskNotesCollaborationEventStub =
    | (TaskNotesCollaborationEvent & {readonly type: "PersistedContent"})
    | {
          readonly type: "UpdateNotesContentWithoutPersistence";
          readonly newVersion: number;
          readonly steps: ReadonlyArray<Step>;
          readonly stepsContentReferenceIds: ContentReferencedIds;
          readonly clientId: ContentEditorClientId;
      }
    | {
          readonly type: "Comments";
          readonly event: MessagingRealtimeEventStub;
      };

export class TaskNotesCollaborationConnection {
    public readonly accessLevel: AccessLevel;
    private readonly _contentManager: TaskNotesCollaborationContentManager;
    public readonly closeWithError: (context: WorkerProcessContext, error: unknown) => void;
    private readonly _killProcess: (context: WorkerProcessContext, error: unknown) => void;
    private readonly _mutex = new Mutex();
    private readonly _messagingConnection: MessagingRealtimeConnection<TaskId, TaskCommentModel>;

    constructor({
        accessLevel,
        connectionId,
        accountId,
        contentManager,
        closeWithError,
        killProcess,
        sendEvent,
        sendEventToOthers,
        iterateOtherConnections,
    }: {
        accessLevel: AccessLevel;
        contentManager: TaskNotesCollaborationContentManager;
        closeWithError: (context: WorkerProcessContext, error: unknown) => void;
        killProcess: (context: WorkerProcessContext, error: unknown) => void;
        connectionId: WebSocketConnectionId;
        accountId: AccountId;
        sendEvent: (
            context: WorkerProcessContext,
            event: TaskNotesCollaborationEventStub,
        ) => SafeFloatingPromise<void>;
        sendEventToOthers: (
            context: WorkerProcessContext,
            event: TaskNotesCollaborationEventStub,
        ) => void;
        iterateOtherConnections: () => Iterable<TaskNotesCollaborationConnection>;
    }) {
        this.accessLevel = accessLevel;
        this._contentManager = contentManager;
        this.closeWithError = closeWithError;
        this._killProcess = killProcess;

        this._messagingConnection = new MessagingRealtimeConnection({
            connectionId,
            spaceId: contentManager.spaceId,
            accountId,
            roomKey: contentManager.taskId,

            sendEvent: (context, event) => sendEvent(context, {type: "Comments", event}),
            sendEventToOthers: (context, event) =>
                sendEventToOthers(context, {type: "Comments", event}),
            iterateOtherConnections: () =>
                mapIterable(
                    iterateOtherConnections(),
                    connection => connection._messagingConnection,
                ),

            createMessage,
            updateMessageContent,
            deleteMessage,
            setMessageReaction,
            deleteMessageReaction,
            putMessageApprovalDecisions,
            backfillMessages,
            getMessageAtVersion,
            getMessageReferences,
            createMessageModel,
        });
    }

    /**
     * Must maintain view access to the task or else this connection is unauthorized.
     * Edit access is optional. We will throw an error if the connection tries to make
     * edits when they don't have edit access.
     */
    public async authorize(context: WorkerSessionActionContext) {
        await authorizeTaskAccess(context, {
            taskId: this._contentManager.taskId,
            expectedAccessLevel: this.accessLevel,
        });
    }

    public readonly procedures: WebSocketConnectionProcedures<
        WorkerSessionActionContextModules,
        typeof TaskNotesCollaborationProtocol
    > = {
        backfillNotes: (context, input) =>
            // Handle procedures for this connection in sequence as a defense against race
            // conditions.
            //
            // Though the client mostly sends messages in sequence anyway.
            this._mutex.withLock(async () => {
                const version = this._contentManager.getCurrentVersion();
                const persistedVersion = this._contentManager.getPersistedVersion();
                const clientVersion = input.version;

                // Sometimes the client tries to backfill from a version that appears to be in the
                // future. This happens when a previous durable object confirmed steps to the
                // client (via `UpdateNotesContentWithoutPersistence`) but crashed before
                // persisting them, so the new durable object loaded an older version from the
                // database.
                if (clientVersion > version) {
                    // Double check against the database. If the database is somehow ahead of our
                    // in-memory version then our durable object is out of sync (e.g. it loaded a stale
                    // version) and we must not tell the client to revert steps that are actually
                    // persisted. Destroy the durable object so it reloads from the database at the
                    // correct version.
                    const {version: databaseVersion} = await getTaskNotesContent(context, {
                        taskId: this._contentManager.taskId,
                    });
                    if (databaseVersion > version) {
                        const error = new InternalError(
                            "Task notes version in durable object is out of sync with the actual task notes version",
                        );

                        this._killProcess(context, error);
                        throw error;
                    }

                    // If the client detects this specific error message it will revert any confirmed
                    // but not persisted steps back to its persisted version and try backfilling again.
                    throw new FailedPreconditionError(taskNotesBackfillFutureVersionErrorMessage);
                }

                const steps = await this._contentManager.getSteps(context, clientVersion, version);

                const stepsContentReferenceIds = getContentReferencedIdsForSteps(
                    steps.map(({step}) => step),
                );

                // Optimization: If there's no referenced content then we don't need to make a
                // network request.
                const stepsContentReferences = isEmptyContentReferencedIds(stepsContentReferenceIds)
                    ? emptyContentReferences
                    : (
                          await getTaskNotesContentReferences(context, {
                              spaceId: this._contentManager.spaceId,
                              taskId: this._contentManager.taskId,
                              referenceIds: stepsContentReferenceIds,
                          })
                      ).references;

                return {
                    newVersion: version,
                    persistedVersion,
                    steps: steps.map(({step, clientId}) => ({step, clientId})),
                    stepsContentReferences,
                };
            }),

        backfillComments: async (
            context,
            {checkpoint, clientCommentCount: clientMessageCount, newCommentLimit: newMessageLimit},
        ) => {
            const {
                messageCount: commentCount,
                newMessages: newComments,
                newOtherReferencedMessages: newOtherReferencedComments,
                messageUpdatesResult: commentUpdatesResult,
                typingStateByConnectionId,
            } = await this._messagingConnection.backfillMessages(context, {
                checkpoint,
                clientMessageCount,
                newMessageLimit,
            });

            return {
                commentCount,
                newComments,
                newOtherReferencedComments,
                commentUpdatesResult,
                typingStateByConnectionId,
            };
        },

        createComment: (context, {parent, content, fileIds, createdTimeZone}) =>
            this._messagingConnection.createMessage(context, {
                parent,
                content,
                fileIds,
                createdTimeZone,
            }),

        updateCommentContent: (context, {commentIndex: messageIndex, steps, contentVersion}) =>
            this._messagingConnection.updateMessageContent(context, {
                messageIndex,
                steps,
                contentVersion,
            }),

        deleteComment: (context, {commentIndex: messageIndex}) =>
            this._messagingConnection.deleteMessage(context, {messageIndex}),

        setCommentReaction: (
            context,
            {commentIndex: messageIndex, contentVersion, pos, reaction},
        ) =>
            this._messagingConnection.setMessageReaction(context, {
                messageIndex,
                contentVersion,
                pos,
                reaction,
            }),

        deleteCommentReaction: (context, {commentIndex: messageIndex, contentVersion, pos}) =>
            this._messagingConnection.deleteMessageReaction(context, {
                messageIndex,
                contentVersion,
                pos,
            }),

        putCommentApprovalDecisions: (context, {commentIndex: messageIndex, payload}) =>
            this._messagingConnection.putMessageApprovalDecisions(context, {
                messageIndex,
                payload,
            }),

        startTypingInCommentInput: (context, input) =>
            this._messagingConnection.startTypingInMessageInput(context, input),

        stopTypingInCommentInput: (context, input) =>
            this._messagingConnection.stopTypingInMessageInput(context, input),

        updateNotesContent: (context, input) =>
            // Handle procedures for this connection in sequence as a defense against race
            // conditions.
            //
            // Though the client mostly sends messages in sequence anyway.
            this._mutex.withLock(async () => {
                // Make sure we have edit access to the task. If we don't have edit access and we
                // try to update then the content manager will optimistically accept the update and
                // when persistence fails it kills the whole durable object.
                if (!hasAccessLevel(this.accessLevel, "Edit")) {
                    throw new PermissionDeniedError("Can\u2019t update task notes", {
                        displayMessage:
                            taskPermissionDeniedErrorDisplayMessageByExpectedAccessLevel.Edit,
                    });
                }

                await this._contentManager.update(context, this, input);
                return {};
            }),
    };

    public getConnectionForTest() {
        assert(import.meta.jest);
        return this._messagingConnection;
    }

    public static broadcastNewMessage(
        context: WorkerActionContext,
        request: MessagingRealtimeBroadcastNewMessageRequest,
        iterateAllConnections: () => Iterable<TaskNotesCollaborationConnection>,
    ) {
        MessagingRealtimeConnection.broadcastNewMessage(context, request, () =>
            mapIterable(iterateAllConnections(), connection => connection._messagingConnection),
        );
    }

    public static broadcastPutMessageStreamPart(
        context: WorkerActionContext,
        request: MessagingRealtimeBroadcastPutMessageStreamPartRequest,
        iterateAllConnections: () => Iterable<TaskNotesCollaborationConnection>,
    ) {
        MessagingRealtimeConnection.broadcastPutMessageStreamPart(context, request, () =>
            mapIterable(iterateAllConnections(), connection => connection._messagingConnection),
        );
    }

    public static broadcastCompleteMessageStream(
        context: WorkerActionContext,
        request: MessagingRealtimeBroadcastCompleteMessageStreamRequest,
        iterateAllConnections: () => Iterable<TaskNotesCollaborationConnection>,
    ) {
        MessagingRealtimeConnection.broadcastCompleteMessageStream(context, request, () =>
            mapIterable(iterateAllConnections(), connection => connection._messagingConnection),
        );
    }

    public async transformEvent(
        context: WorkerSessionActionContext,
        eventStub: TaskNotesCollaborationEventStub,
    ): Promise<TaskNotesCollaborationEvent> {
        switch (eventStub.type) {
            case "UpdateNotesContentWithoutPersistence": {
                // Optimization: If there's no referenced content then we don't need to make a
                // network request.
                const stepsContentReferences = isEmptyContentReferencedIds(
                    eventStub.stepsContentReferenceIds,
                )
                    ? emptyContentReferences
                    : await getTaskNotesContentReferences(context, {
                          spaceId: this._contentManager.spaceId,
                          taskId: this._contentManager.taskId,
                          referenceIds: eventStub.stepsContentReferenceIds,
                      }).then(({references}) => references);

                return {
                    type: "UpdateNotesContentWithoutPersistence",
                    newVersion: eventStub.newVersion,
                    steps: eventStub.steps,
                    stepsContentReferences,
                    clientId: eventStub.clientId,
                };
            }
            case "Comments": {
                return {
                    type: "Comments",
                    event: await this._messagingConnection.transformEvent(context, eventStub.event),
                };
            }
            case "PersistedContent": {
                return eventStub;
            }
            default:
                throw exhaustive(eventStub);
        }
    }
}

const createMessage: CreateMessageFunction<TaskId> = (
    context,
    {roomKey: taskId, parent, content, fileIds, createdTimeZone},
) => {
    return createTaskComment(context, {
        taskId,
        parent,
        content,
        fileIds,
        createdTimeZone,
    });
};

const updateMessageContent: UpdateMessageContentFunction<TaskId> = (
    context,
    {roomKey: taskId, messageIndex: commentIndex, contentVersion, steps},
) => {
    return updateTaskCommentContent(context, {
        taskId,
        commentIndex,
        contentVersion,
        steps,
    });
};

const deleteMessage: DeleteMessageFunction<TaskId> = (
    context,
    {roomKey: taskId, messageIndex: commentIndex},
) => {
    return deleteTaskComment(context, {taskId, commentIndex});
};

const setMessageReaction: SetMessageReactionFunction<TaskId> = (
    context,
    {roomKey: taskId, messageIndex: commentIndex, contentVersion, pos, reaction},
) => {
    return setTaskCommentReaction(context, {taskId, commentIndex, contentVersion, pos, reaction});
};

const deleteMessageReaction: DeleteMessageReactionFunction<TaskId> = (
    context,
    {roomKey: taskId, messageIndex: commentIndex, contentVersion, pos},
) => {
    return deleteTaskCommentReaction(context, {taskId, commentIndex, contentVersion, pos});
};

const putMessageApprovalDecisions: PutMessageApprovalDecisionsFunction<TaskId> = (
    context,
    {roomKey: taskId, messageIndex: commentIndex, payload},
) => {
    return putTaskCommentMessageApprovalDecisions(context, {taskId, commentIndex, payload});
};

const backfillMessages: BackfillMessagesFunction<TaskId, TaskCommentModel> = async (
    context,
    {
        roomKey: taskId,
        checkpoint,
        clientMessageCount: clientCommentCount,
        newMessageLimit: newCommentLimit,
    },
) => {
    const {commentCount, newComments, newOtherReferencedComments, commentUpdatesResult} =
        await backfillTaskComments(context, {
            taskId,
            clientCommentCount,
            checkpoint,
            newCommentLimit,
        });

    return {
        messageCount: commentCount,
        newMessages: newComments,
        newOtherReferencedMessages: newOtherReferencedComments,
        messageUpdatesResult: commentUpdatesResult,
        extra: null,
    };
};

const getMessageAtVersion: GetMessageAtVersionFunction<TaskId, TaskCommentModel> = async (
    context,
    {roomKey: taskId, messageIndex: commentIndex, version},
) => {
    const {comment} = await getTaskCommentAtVersion(context, {taskId, commentIndex, version});
    return comment;
};

const getMessageReferences: GetMessageReferencesFunction<TaskId> = async (
    context,
    {spaceId, roomKey: taskId, referencedIds},
) => {
    const {references} = await getTaskCommentReferences(context, {spaceId, taskId, referencedIds});
    return references;
};

const createMessageModel: CreateMessageModelFunction<TaskId, TaskCommentModel> = ({
    roomKey: taskId,
    message,
    references,
}) => {
    return new TaskCommentModel({
        taskId,
        index: message.index,
        version: message.version,
        createdTime: message.createdTime,
        createdTimeZone: message.createdTimeZone,
        author: references.author,
        payload: {
            type: "Content",
            parent: message.payload.parent,
            content: {
                doc: message.payload.content,
                references: references.contentReferences,
            },
            contentUpdate: message.payload.contentUpdate,
            files: message.payload.fileIds.map(fileId =>
                assertExists(references.fileById.get(fileId)),
            ),
            reactionsByPos: message.payload.reactionsByPos,
            filesReactions: message.payload.filesReactions,
        },
        stream: message.stream,
    });
};
