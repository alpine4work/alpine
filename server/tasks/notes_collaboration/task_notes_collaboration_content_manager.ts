import {Step} from "prosemirror-transform";
import {
    WorkerAccountActionContext,
    WorkerActionContext,
} from "~/server/cloudflare/context/worker_action_context.js";
import {WorkerProcessContext} from "~/server/cloudflare/context/worker_process_context.js";
import {CollaborativeContentStepCache} from "~/server/content/collaboration/collaborative_content_step_cache.js";
import {TaskNotesCollaborationEventStub} from "~/server/tasks/notes_collaboration/task_notes_collaboration_connection.js";
import {getContentReferencedIdsForSteps} from "~/shared/content/content_referenced_ids.js";
import {getCollaborativelyUpdateContentResult} from "~/shared/content/get_collaboratively_update_content_result.js";
import {
    DataLossError,
    FailedPreconditionError,
    InternalError,
} from "~/shared/error/error.open_source.js";
import {isSystemError} from "~/shared/error/is_system_error_code.open_source.js";
import {MutexValue} from "~/shared/helpers/async/mutex_value.js";
import {assert} from "~/shared/helpers/control/assert.open_source.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.open_source.js";
import {ContentEditorClientId} from "~/shared/id/types/id_types.js";
import {SpaceId, TaskId} from "~/shared/id/types/id_types.open_source.js";
import {
    getTaskNotesContentSteps,
    updateTaskNotesContent,
} from "~/shared/rpc/tasks_rpc_definitions.js";
import {TaskNotesContent, isTaskNotesContent} from "~/shared/tasks/task_notes_content_schema.js";

/**
 * Class for managing writing to collaborative content in a concurrency safe way.
 */
export class TaskNotesCollaborationContentManager {
    public readonly spaceId: SpaceId;
    public readonly taskId: TaskId;
    public readonly stepCache: CollaborativeContentStepCache<WorkerActionContext>;
    private readonly _sendEventToAllAndWait: (
        context: WorkerProcessContext,
        event: TaskNotesCollaborationEventStub,
    ) => Promise<void>;
    private readonly _killProcess: (context: WorkerProcessContext, error: unknown) => void;

    private _state: MutexValue<{
        version: number;
        content: TaskNotesContent;
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
        });
        this.stepCache = new CollaborativeContentStepCache({
            startVersion: initialVersion,
            loadSteps: (context, {startVersion, endVersion}) => {
                return getTaskNotesContentSteps(context, {
                    taskId,
                    startVersion,
                    endVersion,
                });
            },
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
     * Gets the task notes content at the specified version number.
     */
    public async getContentAtVersion(
        context: WorkerActionContext,
        version: number,
    ): Promise<TaskNotesContent> {
        const state = this._state.getWithoutLock();

        if (version > state.version)
            throw new FailedPreconditionError("Can not get task notes content at a future version");

        let content = state.content;

        const steps = await this.stepCache.getSteps(context, version, state.version);

        for (let i = steps.length - 1; i >= 0; i--) {
            const {invertedStep} = assertExists(steps[i]);
            const stepResult = invertedStep.apply(content);

            if (!stepResult.doc)
                throw new InternalError(
                    `Inverted step could not be applied: ${stepResult.failed!}`,
                );

            assert(isTaskNotesContent(stepResult.doc));
            content = stepResult.doc;
        }

        return content;
    }

    /**
     * Update our task's notes content. Holds a lock on the content while updating so
     * writes from two concurrent writers will be serialized.
     */
    public async update(
        context: WorkerAccountActionContext,
        connection: {
            closeWithError: (context: WorkerProcessContext, error: unknown) => void;
        } | null,
        update: {
            version: number;
            steps: ReadonlyArray<Step>;
            clientId: ContentEditorClientId;
            /**
             * An optional promise that must resolve before we mutate any durable object state.
             * If it rejects we throw before applying the update so the caller can run
             * expensive validation (e.g. an authorization round-trip) in parallel with
             * computing the update without risking putting the durable object in a bad state.
             */
            validationPromise?: Promise<unknown>;
        },
    ): Promise<{
        newVersion: number;
        newContent: TaskNotesContent;
        persistencePromise: Promise<void>;
    }> {
        const {oldVersion, steps, newContent, persistencePromise} = await this._state.withLock(
            async stateRef => {
                const oldVersion = stateRef.current.version;

                const {newContent, steps, invertedSteps} =
                    await getCollaborativelyUpdateContentResult(context, {
                        currentVersion: stateRef.current.version,
                        currentContent: stateRef.current.content,
                        clientVersion: update.version,
                        clientSteps: update.steps,
                        getSteps: (startVersion, endVersion) =>
                            this.stepCache.getSteps(context, startVersion, endVersion),
                    });

                assert(isTaskNotesContent(newContent));

                // Wait for any validation to pass before mutating state. We compute the update
                // above in parallel with the validation, but if validation fails we throw here
                // before applying the update.
                if (update.validationPromise) await update.validationPromise;

                stateRef.current.version = stateRef.current.version + steps.length;
                stateRef.current.content = newContent;

                for (let i = 0; i < steps.length; i++) {
                    const step = assertExists(steps[i]);
                    const invertedStep = assertExists(invertedSteps[i]);

                    this.stepCache.dangerouslyAddStepToEnd({
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
                    const clientId = update.clientId;

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
                                        const {newVersion} = await updateTaskNotesContent(context, {
                                            spaceId: this.spaceId,
                                            taskId: this.taskId,
                                            version: oldVersion,
                                            steps: nextSteps,
                                            clientId,
                                        }).catch(error => {
                                            // Upgrade any error to a data loss error. If `updateTaskNotesContent()` throws
                                            // we'll kill the process and throw away steps that weren't successfully persisted.
                                            throw DataLossError.from(error);
                                        });

                                        // The task notes durable object should be the only process writing to this task's
                                        // notes, so the database version should advance by exactly the number of steps we
                                        // persisted. If it advanced by more then some other process wrote to the notes and
                                        // our in-memory content has diverged from the database. Kill the process so
                                        // clients reconnect and reload the merged content from the database.
                                        if (newVersion !== oldVersion + nextSteps.length) {
                                            throw new InternalError(
                                                "Some process updated task notes content other than the task notes durable object. This may cause downstream issues as a core assumption about the task notes collaboration implementation has been violated",
                                            );
                                        }

                                        this._persistedVersion = newVersion;

                                        await this._sendEventToAllAndWait(context, {
                                            type: "PersistedContent",
                                            newVersion,
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
                                        connection?.closeWithError(context, unknownError);

                                        this._killProcess(context, error);
                                    }
                                },
                            );
                        })(),
                    };

                    // Make sure the durable object stays alive until we've finished persisting.
                    context.process.waitUntil(this._persistenceState.promise);
                }

                return {
                    oldVersion,
                    steps,
                    newContent,
                    persistencePromise: this._persistenceState.promise,
                };
            },
        );

        if (steps.length === 0) {
            return {
                newVersion: oldVersion,
                newContent,
                persistencePromise,
            };
        }

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

        return {
            newVersion: oldVersion + steps.length,
            newContent,
            persistencePromise,
        };
    }

    /**
     * Get the steps applied between `startVersion` (inclusive) and `endVersion`
     * (exclusive). Returns steps from our in-memory cache if we have them, otherwise
     * loads them from the database.
     */
    public getSteps(
        context: WorkerActionContext,
        startVersion: number,
        endVersion: number,
    ): Promise<
        ReadonlyArray<{
            readonly step: Step;
            readonly invertedStep: Step;
            readonly clientId: ContentEditorClientId;
        }>
    > {
        return this.stepCache.getSteps(context, startVersion, endVersion);
    }
}
