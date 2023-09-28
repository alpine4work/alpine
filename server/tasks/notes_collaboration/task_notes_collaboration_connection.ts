import {
    WorkerSessionActionContext,
    WorkerSessionActionContextModules,
} from "~/server/cloudflare/context/worker_action_context.js";
import {WorkerProcessContext} from "~/server/cloudflare/context/worker_process_context.js";
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
import {
    authorizeTaskAccess,
    getTaskNotesContentReferences,
} from "~/shared/rpc/tasks_rpc_definitions.js";
import {TaskNotesCollaborationProtocol} from "~/shared/tasks/task_notes_collaboration_protocol.js";

export class TaskNotesCollaborationConnection {
    private readonly _contentManager: TaskNotesCollaborationContentManager;
    public readonly closeWithError: (context: WorkerProcessContext, error: unknown) => void;
    private readonly _mutex = new Mutex();
    private _editAccessPromiseResolver: PromiseResolver<void>;

    constructor({
        contentManager,
        closeWithError,
    }: {
        contentManager: TaskNotesCollaborationContentManager;
        closeWithError: (context: WorkerProcessContext, error: unknown) => void;
    }) {
        this._contentManager = contentManager;
        this.closeWithError = closeWithError;

        this._editAccessPromiseResolver = createPromiseResolver();

        // Can ignore uncaught exceptions. They'll be thrown if the user tries to
        // update notes content.
        this._editAccessPromiseResolver.promise.catch(() => {});
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
        backfill: (context, input, span) =>
            // Handle procedures for this connection in sequence as a defense against
            // race conditions.
            //
            // Though the client mostly sends messages in sequence anyway.
            this._mutex.withLock(async () => {
                const version = this._contentManager.getCurrentVersion();
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
                                  referenceIds: stepsContentReferenceIds,
                              })
                          ).references;

                    return {
                        result: {
                            type: "Available",
                            newVersion: version,
                            steps: stepsResult.steps.map(({step, clientId}) => ({step, clientId})),
                            stepsContentReferences,
                        },
                    };
                }
            }),

        updateContent: (context, input) =>
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
}
