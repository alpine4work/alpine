import {Step} from "prosemirror-transform";
import {WorkerSessionActionContext} from "~/server/cloudflare/context/worker_action_context.js";
import {WorkerProcessContext} from "~/server/cloudflare/context/worker_process_context.js";
import {TaskNotesCollaborationEventStub} from "~/server/tasks/notes_collaboration/task_notes_collaboration_connection.js";
import {getContentReferencedIdsForSteps} from "~/shared/content/content_referenced_ids.js";
import {getCollaborativelyUpdateContentResult} from "~/shared/content/get_collaboratively_update_content_result.js";
import {DataLossError, FailedPreconditionError, InternalError} from "~/shared/error/error.js";
import {isSystemError} from "~/shared/error/is_system_error_code.js";
import {MutexValue} from "~/shared/helpers/async/mutex_value.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {ContentEditorClientId, SpaceId, TaskId} from "~/shared/id/types/id_types.js";
import {updateTaskNotesContent} from "~/shared/rpc/tasks_rpc_definitions.js";
import {TaskNotesContent, isTaskNotesContent} from "~/shared/tasks/task_notes_content_schema.js";

/**
 * Class for managing writing to collaborative content in a concurrency safe way.
 */
export class TaskNotesCollaborationContentManager {
    public readonly spaceId: SpaceId;
    public readonly taskId: TaskId;
    private readonly _sendEventToAllAndWait: (
        context: WorkerProcessContext,
        event: TaskNotesCollaborationEventStub,
    ) => Promise<void>;
    private readonly _killProcess: (context: WorkerProcessContext, error: unknown) => void;

    private _state: MutexValue<{
        version: number;
        content: TaskNotesContent;
        readonly initialVersion: number;
        readonly steps: Array<{
            readonly step: Step;
            readonly invertedStep: Step;
            readonly clientId: ContentEditorClientId;
        }>;
    }>;

    private _persistenceState: {
        next: {
            readonly clientId: ContentEditorClientId;
            readonly steps: Array<Step>;
        } | null;
        promise: Promise<void>;
    } | null = null;

    /**
     * The current version that's persisted to the database. This version number will
     * lag behind the version number in state. Because state represents the optimistic
     * version.
     */
    private _persistedVersion: number;

    constructor({
        spaceId,
        taskId,
        initialVersion,
        initialContent,
        sendEventToAllAndWait,
        killProcess,
    }: {
        spaceId: SpaceId;
        taskId: TaskId;
        initialVersion: number;
        initialContent: TaskNotesContent;
        sendEventToAllAndWait: (
            context: WorkerProcessContext,
            event: TaskNotesCollaborationEventStub,
        ) => Promise<void>;
        killProcess: (context: WorkerProcessContext, error: unknown) => void;
    }) {
        this.spaceId = spaceId;
        this.taskId = taskId;
        this._state = new MutexValue({
            version: initialVersion,
            content: initialContent,
            initialVersion,
            steps: [],
        });
        this._persistedVersion = initialVersion;
        this._sendEventToAllAndWait = sendEventToAllAndWait;
        this._killProcess = killProcess;
    }

    /**
     * Get the current version of our content.
     *
     * This is mutable and will change over time as users update the task notes
     * content!
     *
     * If you want to update content you should use the version and content provided in
     * the `update()` method.
     */
    public getCurrentVersion() {
        return this._state.getWithoutLock().version;
    }

    /**
     * Get the version of task notes persisted in the database.
     *
     * This is mutable and will change over time as users update our task's notes!
     */
    public getPersistedVersion() {
        return this._persistedVersion;
    }

    /**
     * Get the current content.
     *
     * This is mutable and will change over time as users update the task notes
     * content!
     *
     * If you want to update content you should use the version and content provided in
     * the `update()` method.
     */
    public getCurrentContent() {
        return this._state.getWithoutLock().content;
    }

    /**
     * Update our task's notes content. Holds a lock on the content while updating so
     * writes from two concurrent writers will be serialized.
     */
    public async update(
        context: WorkerSessionActionContext,
        connection: {closeWithError: (context: WorkerProcessContext, error: unknown) => void},
        update: {
            version: number;
            steps: ReadonlyArray<Step>;
            clientId: ContentEditorClientId;
        },
    ): Promise<void> {
        const {oldVersion, steps} = await this._state.withLock(async stateRef => {
            const oldVersion = stateRef.current.version;

            const {newContent, steps, invertedSteps} = await getCollaborativelyUpdateContentResult(
                context,
                {
                    currentVersion: stateRef.current.version,
                    currentContent: stateRef.current.content,
                    clientVersion: update.version,
                    clientSteps: update.steps,
                    getSteps: async (startVersion, endVersion) => {
                        const result = this.getSteps(startVersion, endVersion);

                        if (result.type === "Unavailable")
                            throw new FailedPreconditionError(
                                "Client task notes version is too far behind",
                            );

                        return result.steps;
                    },
                },
            );

            assert(isTaskNotesContent(newContent));

            stateRef.current.version = stateRef.current.version + steps.length;
            stateRef.current.content = newContent;

            for (let i = 0; i < steps.length; i++) {
                const step = steps[i]!;
                const invertedStep = invertedSteps[i]!;

                stateRef.current.steps.push({
                    step,
                    invertedStep,
                    clientId: update.clientId,
                });
            }

            // Persist our content by sending our steps to DynamoDB. We need to save our steps
            // in the same sequence we received them.
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
                    // this `update()` method so the `AppService` network calls count against the
                    // Durable Object request limit for the WebSocket message that triggered the
                    // `update()`.
                    promise: (async () => {
                        // While we wait, steps may be added to `nextSteps` if it's from the same client so
                        // we can save in a single batch.
                        await lastPersistenceStatePromise;

                        // Do not allow the worker to batch more steps for this request! Instead the worker
                        // needs to schedule a new update promise.
                        if (this._persistenceState?.next?.steps === nextSteps)
                            this._persistenceState.next = null;

                        await context.tracer.withSpan(
                            "Persist task notes content",
                            async (context, span) => {
                                try {
                                    // Throws a `FailedPreconditionError` if the provided version is incompatible with
                                    // what's in the database.
                                    await updateTaskNotesContent(context, {
                                        spaceId: this.spaceId,
                                        taskId: this.taskId,
                                        version: oldVersion,
                                        steps: nextSteps,
                                    }).catch(error => {
                                        // Upgrade any error to a data loss error. If `updateDocumentContent()` throws
                                        // we'll kill the process and throw away steps that weren't successfully persisted.
                                        throw DataLossError.from(error);
                                    });

                                    this._persistedVersion = oldVersion + nextSteps.length;

                                    await this._sendEventToAllAndWait(context, {
                                        type: "PersistedContent",
                                        newVersion: oldVersion + nextSteps.length,
                                    });
                                } catch (unknownError) {
                                    // Upgrade the severity to internal since the client has already seen the update.
                                    //
                                    // The client will also attempt to reconnect on a system error.
                                    const error = !isSystemError(unknownError)
                                        ? InternalError.from(unknownError)
                                        : unknownError;

                                    span.addException(error);

                                    // Close the connection which tried to make this update with the original error,
                                    // not the modified `InternalError`.
                                    connection.closeWithError(context, unknownError);

                                    this._killProcess(context, error);
                                }
                            },
                        );
                    })(),
                };

                // Make sure the durable object stays alive until we've finished persisting.
                context.process.waitUntil(this._persistenceState.promise);
            }

            return {oldVersion, steps};
        });

        if (steps.length === 0) return;

        const stepsContentReferenceIds = getContentReferencedIdsForSteps(steps);

        // You may receive these events in any order because the timing of loading content
        // references in `transformEvent()` will vary. The client must take care to apply
        // events in the correct order.
        await this._sendEventToAllAndWait(context, {
            type: "UpdateNotesContentWithoutPersistence",
            newVersion: oldVersion + steps.length,
            steps,
            stepsContentReferenceIds,
            clientId: update.clientId,
        });
    }

    /**
     * Get the steps cached in our Durable Object from `startVersion` until
     * `endVersion`. Returns `Unavailable` if we don't have a step history record that
     * goes back far enough.
     */
    public getSteps(
        startVersion: number,
        endVersion: number,
    ):
        | {
              readonly type: "Unavailable";
          }
        | {
              readonly type: "Available";
              readonly steps: ReadonlyArray<{
                  readonly step: Step;
                  readonly invertedStep: Step;
                  readonly clientId: ContentEditorClientId;
              }>;
          } {
        const state = this._state.getWithoutLock();

        assert(startVersion <= endVersion);
        assert(endVersion <= state.version);

        // We don't save every step to update task notes in the database. We only save
        // steps in memory that our durable object has seen. So if the client is too far
        // behind, we reject its update. The client needs to reload.
        //
        // When the client connected to our durable object we should have backfilled them
        // to the correct version so we shouldn't see behind clients.
        if (startVersion < state.initialVersion) {
            return {type: "Unavailable"};
        }

        const stepStartIndex = state.steps.length - (state.version - startVersion);
        const stepEndIndex = state.steps.length - (state.version - endVersion);

        assert(0 <= stepStartIndex && stepStartIndex <= state.steps.length);
        assert(0 <= stepEndIndex && stepEndIndex <= state.steps.length);

        return {
            type: "Available",
            steps: state.steps.slice(stepStartIndex, stepEndIndex),
        };
    }
}
