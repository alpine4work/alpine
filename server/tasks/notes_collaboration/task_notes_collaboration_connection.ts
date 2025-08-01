import {
    WorkerSessionActionContext,
    WorkerSessionActionContextModules,
} from "~/server/cloudflare/context/worker_action_context.js";
import {WorkerProcessContext} from "~/server/cloudflare/context/worker_process_context.js";
import {
    BackfillMessagesFunction,
    CreateMessageFunction,
    CreateMessageModelFunction,
    DeleteMessageFunction,
    GetMessageReferencesFunction,
    MessagingRealtimeConnection,
    UpdateMessageContentFunction,
} from "~/server/messaging/realtime/messaging_realtime_connection.js";
import {MessagingRealtimeEventStub} from "~/server/messaging/realtime/messaging_realtime_event_stub.js";
import {TaskNotesCollaborationContentManager} from "~/server/tasks/notes_collaboration/task_notes_collaboration_content_manager.js";
import {WebSocketConnectionProcedures} from "~/server/web_socket/web_socket_server.js";
import {
    getContentReferencedIdsForNode,
    getContentReferencedIdsForSteps,
    isEmptyContentReferencedIds,
} from "~/shared/content/content_referenced_ids.js";
import {emptyContentReferences} from "~/shared/content/content_references.js";
import {Mutex} from "~/shared/helpers/async/mutex.js";
import {PromiseResolver, createPromiseResolver} from "~/shared/helpers/async/promise_resolver.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {mapIterable} from "~/shared/helpers/iterable/map_iterable.js";
import {SafeFloatingPromise} from "~/shared/helpers/types/safe_floating_promise.js";
import {AccountId, TaskId, WebSocketConnectionId} from "~/shared/id/types/id_types.js";
import {
    authorizeTaskAccess,
    backfillTaskComments,
    createTaskComment,
    deleteTaskComment,
    getTaskCommentReferences,
    getTaskNotesContentReferences,
    updateTaskCommentContent,
} from "~/shared/rpc/tasks_rpc_definitions.js";
import {TaskCommentModel} from "~/shared/tasks/model/task_comment_model.js";
import {
    TaskNotesCollaborationEvent,
    TaskNotesCollaborationProtocol,
} from "~/shared/tasks/task_notes_collaboration_protocol.js";

export type TaskNotesCollaborationEventStub =
    // TODO(calebmer, #content-references-privacy-fix): Implement a proper event stub.
    | (TaskNotesCollaborationEvent & {readonly type: "UpdateNotesContentWithoutPersistence"})
    | {readonly type: "Comments"; readonly event: MessagingRealtimeEventStub}
    | (TaskNotesCollaborationEvent & {readonly type: "PersistedContent"});

export class TaskNotesCollaborationConnection {
    private readonly _contentManager: TaskNotesCollaborationContentManager;
    public readonly closeWithError: (context: WorkerProcessContext, error: unknown) => void;
    private readonly _mutex = new Mutex();
    private _editAccessPromiseResolver: PromiseResolver<void>;
    private readonly _messagingConnection: MessagingRealtimeConnection<TaskId, TaskCommentModel>;

    constructor({
        connectionId,
        accountId,
        contentManager,
        closeWithError,
        sendEvent,
        sendEventToOthers,
        iterateOtherConnections,
    }: {
        contentManager: TaskNotesCollaborationContentManager;
        closeWithError: (context: WorkerProcessContext, error: unknown) => void;
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
        this._contentManager = contentManager;
        this.closeWithError = closeWithError;

        this._editAccessPromiseResolver = createPromiseResolver();

        // Can ignore uncaught exceptions. They'll be thrown if the user tries to
        // update notes content.
        this._editAccessPromiseResolver.promise.catch(() => {});

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
            backfillMessages,
            getMessageReferences,
            createMessageModel,
        });
    }

    /**
     * Must maintain view access to the task or else this connection is
     * unauthorized. Edit access is optional. We will throw an error if the
     * connection tries to make edits when they don't have edit access.
     */
    public async authorize(context: WorkerSessionActionContext) {
        const {editResult} = await authorizeTaskAccess(context, {
            taskId: this._contentManager.taskId,
        });

        // If the edit access promise resolver has not settled yet (e.g. when we
        // recently initialized this collection) then we want to resolve the existing
        // resolver instead of creating a new one.
        if (this._editAccessPromiseResolver.isSettled()) {
            this._editAccessPromiseResolver = createPromiseResolver();

            // Can ignore uncaught exceptions. They'll be thrown if the user tries to
            // update notes content.
            this._editAccessPromiseResolver.promise.catch(() => {});
        }

        if (editResult.ok) {
            this._editAccessPromiseResolver.resolve();
        } else {
            this._editAccessPromiseResolver.reject(editResult.error);
        }
    }

    public readonly procedures: WebSocketConnectionProcedures<
        WorkerSessionActionContextModules,
        typeof TaskNotesCollaborationProtocol
    > = {
        backfillNotes: (context, input) =>
            // Handle procedures for this connection in sequence as a defense against
            // race conditions.
            //
            // Though the client mostly sends messages in sequence anyway.
            this._mutex.withLock(async () => {
                const version = this._contentManager.getCurrentVersion();
                const persistedVersion = this._contentManager.getPersistedVersion();
                const clientVersion = input.version;

                // If the client has a future version it's trying to backfill then reset the
                // client's doc. Happens if the durable object previously crashed.
                const stepsResult =
                    clientVersion > version
                        ? {type: "Unavailable" as const}
                        : this._contentManager.getSteps(clientVersion, version);

                if (stepsResult.type === "Unavailable") {
                    const content = this._contentManager.getCurrentContent();

                    const contentReferenceIds = getContentReferencedIdsForNode(content);

                    // Optimization: If there's no referenced content then we don't need to make a
                    // network request.
                    const contentReferences = isEmptyContentReferencedIds(contentReferenceIds)
                        ? emptyContentReferences
                        : (
                              await getTaskNotesContentReferences(context, {
                                  spaceId: this._contentManager.spaceId,
                                  taskId: this._contentManager.taskId,
                                  referenceIds: contentReferenceIds,
                              })
                          ).references;

                    return {
                        result: {
                            type: "Unavailable",
                            newVersion: version,
                            content: {
                                doc: content,
                                references: contentReferences,
                            },
                        },
                    };
                } else {
                    const stepsContentReferenceIds = getContentReferencedIdsForSteps(
                        stepsResult.steps.map(({step}) => step),
                    );

                    // Optimization: If there's no referenced content then we don't need to make a
                    // network request.
                    const stepsContentReferences = isEmptyContentReferencedIds(
                        stepsContentReferenceIds,
                    )
                        ? emptyContentReferences
                        : (
                              await getTaskNotesContentReferences(context, {
                                  spaceId: this._contentManager.spaceId,
                                  taskId: this._contentManager.taskId,
                                  referenceIds: stepsContentReferenceIds,
                              })
                          ).references;

                    return {
                        result: {
                            type: "Available",
                            newVersion: version,
                            persistedVersion,
                            steps: stepsResult.steps.map(({step, clientId}) => ({step, clientId})),
                            stepsContentReferences,
                        },
                    };
                }
            }),

        backfillComments: async (
            context,
            {
                clientCommentCount: clientMessageCount,
                clientLastCommentChangeTime: clientLastMessageChangeTime,
                newCommentLimit: newMessageLimit,
            },
        ) => {
            const {
                messageCount: commentCount,
                lastMessageChangeTime: lastCommentChangeTime,
                newMessages: newComments,
                newOtherReferencedMessages: newOtherReferencedComments,
                messageChangesResult: commentChangesResult,
                typingStateByConnectionId,
            } = await this._messagingConnection.backfillMessages(context, {
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

        createComment: (context, {parentCommentIndex: parentMessageIndex, content, fileIds}) =>
            this._messagingConnection.createMessage(context, {
                parentMessageIndex,
                content,
                fileIds,
            }),

        updateCommentContent: (context, {commentIndex: messageIndex, content}) =>
            this._messagingConnection.updateMessageContent(context, {messageIndex, content}),

        deleteComment: (context, {commentIndex: messageIndex}) =>
            this._messagingConnection.deleteMessage(context, {messageIndex}),

        startTypingInCommentInput: (context, input) =>
            this._messagingConnection.startTypingInMessageInput(context, input),
        stopTypingInCommentInput: (context, input) =>
            this._messagingConnection.stopTypingInMessageInput(context, input),

        updateNotesContent: (context, input) =>
            // Handle procedures for this connection in sequence as a defense against
            // race conditions.
            //
            // Though the client mostly sends messages in sequence anyway.
            this._mutex.withLock(async () => {
                // Make sure we still have edit access to the task. If we don't have edit
                // access and we try to update then the content manager will optimistically
                // accept the update and when persistence fails it kills the whole durable
                // object.
                await this._editAccessPromiseResolver.promise;

                await this._contentManager.update(context, this, input);
                return {};
            }),
    };

    public async transformEvent(
        context: WorkerSessionActionContext,
        eventStub: TaskNotesCollaborationEventStub,
    ): Promise<TaskNotesCollaborationEvent> {
        switch (eventStub.type) {
            case "UpdateNotesContentWithoutPersistence": {
                // TODO(calebmer, #content-references-privacy-fix): Implement a proper event stub.
                return eventStub;
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

const createMessage: CreateMessageFunction<TaskId, TaskCommentModel> = async (
    context,
    {roomKey: taskId, parentMessageIndex: parentCommentIndex, content, fileIds},
) => {
    const {comment} = await createTaskComment(context, {
        taskId,
        parentCommentIndex,
        content,
        fileIds,
    });

    return comment;
};

const updateMessageContent: UpdateMessageContentFunction<TaskId> = async (
    context,
    {roomKey: taskId, messageIndex: commentIndex, content},
) => {
    return updateTaskCommentContent(context, {
        taskId,
        commentIndex,
        content,
    });
};

const deleteMessage: DeleteMessageFunction<TaskId> = async (
    context,
    {roomKey: taskId, messageIndex: commentIndex},
) => {
    return deleteTaskComment(context, {taskId, commentIndex});
};

const backfillMessages: BackfillMessagesFunction<TaskId, TaskCommentModel> = async (
    context,
    {
        roomKey: taskId,
        clientMessageCount: clientCommentCount,
        clientLastMessageChangeTime: clientLastCommentChangeTime,
        newMessageLimit: newCommentLimit,
    },
) => {
    const {
        commentCount,
        lastCommentChangeTime,
        newComments,
        newOtherReferencedComments,
        commentChangesResult,
    } = await backfillTaskComments(context, {
        taskId,
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
        extra: null,
    };
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
        createdTime: message.createdTime,
        author: references.author,
        payload: {
            type: "Content",
            parentMessageIndex: message.payload.parentMessageIndex,
            content: {
                doc: message.payload.content,
                references: references.contentReferences,
            },
            contentUpdatedTime: message.payload.contentUpdatedTime,
            files: message.payload.fileIds.map(fileId =>
                assertExists(references.fileById.get(fileId)),
            ),
        },
    });
};
