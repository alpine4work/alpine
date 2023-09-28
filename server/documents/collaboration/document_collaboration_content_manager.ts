import {Step} from "prosemirror-transform";
import {
    WorkerActionContext,
    WorkerSessionActionContext,
} from "~/server/cloudflare/context/worker_action_context.js";
import {WorkerProcessContext} from "~/server/cloudflare/context/worker_process_context.js";
import {DocumentCollaborationStepCache} from "~/server/documents/collaboration/document_collaboration_step_cache.js";
import {TestCheckpoint} from "~/server/helpers/test/test_checkpoint.js";
import {AccountModel} from "~/shared/accounts/account_model.js";
import {getCollaborativelyUpdateContentResult} from "~/shared/content/get_collaboratively_update_content_result.js";
import {
    DocumentCollaborationEvent,
    DocumentCollaborationPresenceState,
} from "~/shared/documents/document_collaboration_protocol.js";
import {
    getDocumentContentReferencedIdsForSteps,
    isEmptyDocumentContentReferencedIds,
} from "~/shared/documents/document_content_referenced_ids.js";
import {
    DocumentContentReferences,
    emptyDocumentContentReferences,
} from "~/shared/documents/document_content_references.js";
import {DocumentContent, isDocumentContent} from "~/shared/documents/document_content_schema.js";
import {
    FailedPreconditionError,
    InternalError,
    InvalidArgumentError,
} from "~/shared/error/error.js";
import {MutexValue} from "~/shared/helpers/async/mutex_value.js";
import {PromiseResolver, createPromiseResolver} from "~/shared/helpers/async/promise_resolver.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {concatIterables} from "~/shared/helpers/iterable/concat_iterables.js";
import {assertId} from "~/shared/id/id.js";
import {
    AccountId,
    ContentEditorClientId,
    DocumentCommentThreadId,
    DocumentId,
    SpaceId,
    WebSocketConnectionId,
} from "~/shared/id/types/id_types.js";
import {MessageContent} from "~/shared/messaging/message_content_schema.js";
import {ProsemirrorSelectionWrapper} from "~/shared/prosemirror/prosemirror_selection_schema.js";
import {
    ProsemirrorVisitor,
    visitProsemirrorStep,
} from "~/shared/prosemirror/prosemirror_visitor.js";
import {getAccounts} from "~/shared/rpc/accounts_rpc_definitions.js";
import {
    getDocumentContentReferences,
    updateDocumentContent,
} from "~/shared/rpc/documents_rpc_definitions.js";

export const documentCollaborationContentManagerBeforeUpdateTestCheckpoint =
    new TestCheckpoint<DocumentId>();

export const documentCollaborationContentManagerBeforePersistTestCheckpoint =
    new TestCheckpoint<DocumentId>();

export type DocumentCollaborationContentManagerOptimisticCommentThread = {
    readonly persistedPromise: Promise<void>;
    readonly createdTime: Date;
    readonly initialComment: {
        readonly authorId: AccountId;
        readonly content: MessageContent;
    };
};

/**
 * Class for managing writing to collaborative content in a concurrency
 * safe way.
 */
export class DocumentCollaborationContentManager {
    public readonly spaceId: SpaceId;
    public readonly id: DocumentId;
    public readonly stepCache: DocumentCollaborationStepCache;
    private readonly _sendEventToAll: (
        context: WorkerProcessContext,
        event: DocumentCollaborationEvent,
    ) => void;
    private readonly _killProcess: (context: WorkerProcessContext) => void;

    private _state: MutexValue<{
        readonly version: number;
        readonly content: DocumentContent;
    }>;

    private _persistenceState: {
        next: {
            readonly clientId: ContentEditorClientId;
            readonly steps: Array<Step>;
            readonly createCommentThreads: Array<{
                readonly commentThreadId: DocumentCommentThreadId;
                readonly initialCommentContent: MessageContent;
                readonly createdTime: Date;
            }>;
        } | null;
        promise: Promise<void>;
    } | null = null;

    /**
     * The current version that's persisted to the database. This version number
     * will lag behind the version number in state. Because state represents the
     * optimistic version.
     */
    private _persistedVersion: number;

    /**
     * Comment threads created during this durable object's lifetime. Comment
     * threads are actually created at the same time as an
     * `updateDocumentContent()` call. But document persistence in our durable
     * object lags behind what we report to clients! So we use this map to return
     * comment thread models to clients before we've finished persisting the
     * comment thread.
     */
    private readonly _optimisticCommentThreadById = new Map<
        DocumentCommentThreadId,
        {
            readonly persistedAfterVersion: number;
            readonly persistedPromiseResolver: PromiseResolver<void>;
            readonly createdTime: Date;
            readonly initialComment: {
                readonly authorId: AccountId;
                readonly content: MessageContent;
            };
        }
    >();

    constructor({
        spaceId,
        id,
        initialVersion,
        initialContent,
        sendEventToAll,
        killProcess,
    }: {
        spaceId: SpaceId;
        id: DocumentId;
        initialVersion: number;
        initialContent: DocumentContent;
        sendEventToAll: (context: WorkerProcessContext, event: DocumentCollaborationEvent) => void;
        killProcess: (context: WorkerProcessContext) => void;
    }) {
        this.spaceId = spaceId;
        this.id = id;
        this._state = new MutexValue({
            version: initialVersion,
            content: initialContent,
        });
        this._persistedVersion = initialVersion;
        this.stepCache = new DocumentCollaborationStepCache(id, initialVersion);
        this._sendEventToAll = sendEventToAll;
        this._killProcess = killProcess;
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
        return this._state.getWithoutLock().version;
    }

    /**
     * Get the version of the document persisted in the database.
     *
     * This is mutable and will change over time as users update the
     * document content!
     */
    public getPersistedVersion() {
        return this._persistedVersion;
    }

    /**
     * Get the current content.
     *
     * This is mutable and will change over time as users update the document
     * content!
     *
     * If you want to update content you should use the version and content
     * provided in the `update()` method.
     */
    public getCurrentContent() {
        return this._state.getWithoutLock().content;
    }

    /**
     * Gets the document content at the specified version number.
     */
    public async getContentAtVersion(
        context: WorkerActionContext,
        version: number,
    ): Promise<DocumentContent> {
        const state = this._state.getWithoutLock();

        if (version > state.version)
            throw new FailedPreconditionError("Can not get document content at a future version");

        let content = state.content;

        const steps = await this.stepCache.getSteps(context, version, state.version);

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
     */
    public async update(
        context: WorkerSessionActionContext,
        connectionId: WebSocketConnectionId,
        update: {
            version: number;
            steps: ReadonlyArray<Step>;
            clientId: ContentEditorClientId;
            createCommentThreads: ReadonlyArray<{
                commentThreadId: DocumentCommentThreadId;
                initialCommentContent: MessageContent;
            }>;
            updateOurPresenceState: {state: DocumentCollaborationPresenceState | null};
        },
    ): Promise<{
        presenceState: DocumentCollaborationPresenceState | null;
        hasSentPresenceState: boolean;
    }> {
        const {oldVersion, steps, presenceState} = await this._state.withLock(async stateRef => {
            await documentCollaborationContentManagerBeforeUpdateTestCheckpoint.waitForTest(
                this.id,
            );

            if (
                update.updateOurPresenceState.state &&
                update.updateOurPresenceState.state.version !== update.version
            ) {
                throw new InvalidArgumentError(
                    "Document version in new presence state should match the document version we are updating",
                );
            }

            // Make sure comment thread IDs are unique...
            for (const createCommentThread of update.createCommentThreads) {
                if (this._optimisticCommentThreadById.has(createCommentThread.commentThreadId))
                    throw new FailedPreconditionError(
                        "Document comment thread ID has already been used",
                    );
            }

            const oldVersion = stateRef.current.version;

            const {newContent, steps, invertedSteps, clientContent, mapping} =
                await getCollaborativelyUpdateContentResult({
                    currentVersion: stateRef.current.version,
                    currentContent: stateRef.current.content,
                    clientVersion: update.version,
                    clientSteps: update.steps,
                    getSteps: (startVersion, endVersion) =>
                        this.stepCache.getSteps(context, startVersion, endVersion),
                });

            assert(isDocumentContent(newContent));

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

            stateRef.current = {
                version: stateRef.current.version + steps.length,
                content: newContent,
            };

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

            const commentThreadCreatedTime = new Date();

            // Remember the comment threads we're in the process of creating so if a client
            // asks for them we don't error because the database hasn't received them yet.
            for (const createCommentThread of update.createCommentThreads) {
                const persistedPromiseResolver = createPromiseResolver();

                // Don't consider errors to be unhandled rejections in case no one awaits.
                persistedPromiseResolver.promise.catch(() => {});

                this._optimisticCommentThreadById.set(createCommentThread.commentThreadId, {
                    persistedAfterVersion: oldVersion + steps.length,
                    persistedPromiseResolver,
                    createdTime: commentThreadCreatedTime,
                    initialComment: {
                        authorId: context.actor.getAccountId(),
                        content: createCommentThread.initialCommentContent,
                    },
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
                for (const createCommentThread of update.createCommentThreads) {
                    this._persistenceState.next.createCommentThreads.push({
                        ...createCommentThread,
                        createdTime: commentThreadCreatedTime,
                    });
                }
            } else {
                const lastPersistenceStatePromise = this._persistenceState?.promise;
                const nextSteps = Array.from(steps);
                const nextCreateCommentThreads = Array.from(
                    update.createCommentThreads,
                    createCommentThread => ({
                        ...createCommentThread,
                        createdTime: commentThreadCreatedTime,
                    }),
                );

                this._persistenceState = {
                    next: {
                        clientId: update.clientId,
                        steps: nextSteps,
                        createCommentThreads: nextCreateCommentThreads,
                    },
                    // NOTE(calebmer): We're careful to spawn the promise which updates content from
                    // this `update()` method so the `AppService` network calls count against the
                    // Durable Object request limit for the WebSocket message that triggered the
                    // `update()`.
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
                                    await documentCollaborationContentManagerBeforePersistTestCheckpoint.waitForTest(
                                        this.id,
                                    );

                                    const {conflictingSteps} = await updateDocumentContent(
                                        context,
                                        {
                                            documentId: this.id,
                                            version: oldVersion,
                                            steps: nextSteps,
                                            clientId: update.clientId,
                                            createCommentThreads: nextCreateCommentThreads,
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

                                    this._persistedVersion = oldVersion + nextSteps.length;

                                    // Cleanup comment threads that have been persisted. We will be able to fetch
                                    // the latest value from the database from here on out.
                                    for (const [commentThreadId, optimisticCommentThread] of this
                                        ._optimisticCommentThreadById) {
                                        if (
                                            optimisticCommentThread.persistedAfterVersion >
                                            this._persistedVersion
                                        ) {
                                            continue;
                                        }
                                        this._optimisticCommentThreadById.delete(commentThreadId);
                                        optimisticCommentThread.persistedPromiseResolver.resolve();
                                    }

                                    this._sendEventToAll(context, {
                                        type: "PersistedContent",
                                        newVersion: oldVersion + nextSteps.length,
                                    });
                                } catch (unknownError) {
                                    // Upgrade the severity to internal since the client has already seen the update.
                                    //
                                    // The client will also attempt to reconnect on a system error.
                                    const error = InternalError.from(unknownError);

                                    span.addException(error);

                                    // Persistence failed, clear out our optimistic comment threads.
                                    for (const [commentThreadId, optimisticCommentThread] of this
                                        ._optimisticCommentThreadById) {
                                        this._optimisticCommentThreadById.delete(commentThreadId);
                                        optimisticCommentThread.persistedPromiseResolver.reject(
                                            error,
                                        );
                                    }

                                    this._sendEventToAll(context, {
                                        type: "Error",
                                        error,
                                    });
                                    this._killProcess(context);
                                }
                            },
                        );
                    })(),
                };

                // Make sure the durable object stays alive until we've finished persisting.
                context.process.waitUntil(this._persistenceState.promise);
            }

            return {oldVersion, steps, presenceState};
        });

        if (steps.length === 0) return {presenceState, hasSentPresenceState: false};

        const stepsContentReferences = await this.getContentReferencesForSteps(context, steps);

        // We have to wait for some async data dependencies to send
        // `UpdateContentWithoutPersistence`. We load our data without:
        //
        // - Blocking persistence
        // - Blocking the update queue
        //
        // However, this means you don't get ordering guarantees around
        // `UpdateContentWithoutPersistence`! You may receive these events in any order
        // because the timing of loading content references will vary.
        this._sendEventToAll(context, {
            type: "UpdateContentWithoutPersistence",
            newVersion: oldVersion + steps.length,
            steps,
            stepsContentReferences,
            clientId: update.clientId,
            updateOtherPresenceState: {
                connectionId,
                state: presenceState,
            },
        });

        return {presenceState, hasSentPresenceState: true};
    }

    /**
     * Get the comment thread models in the provided steps for
     * `DocumentContentReferences`.
     *
     * You shouldn't use the `getDocumentCommentReferences()` RPC directly for
     * this purpose because our durable object may have acknowledged the creation of
     * some comment threads but they haven't been persisted in the database yet.
     */
    public async getContentReferencesForSteps(
        context: WorkerActionContext,
        steps: ReadonlyArray<Step>,
    ): Promise<DocumentContentReferences> {
        const {optimisticCommentThreadIds, getOptimisticCommentThreadById} =
            this._getOptimisticCommentThreads(context, visitor => {
                for (const step of steps) {
                    visitProsemirrorStep(step, visitor);
                }
            });

        const referencedIds = getDocumentContentReferencedIdsForSteps(steps, {
            // Optimization: Don't send a network request to load comment threads that
            // haven't been persisted yet. We know they don't exist.
            ignoreCommentThreadIds: optimisticCommentThreadIds,
        });

        const [references, optimisticCommentThreadById] = await runAllPromises([
            (async () => {
                // Optimization: If we have no referenced IDs, then we don't need to send a
                // network request.
                if (isEmptyDocumentContentReferencedIds(referencedIds))
                    return emptyDocumentContentReferences;

                const {references} = await getDocumentContentReferences(context, {
                    documentId: this.id,
                    referencedIds,
                });
                return references;
            })(),
            getOptimisticCommentThreadById(),
        ]);

        return {
            ...references,
            commentThreadById: new Map(
                concatIterables(references.commentThreadById, optimisticCommentThreadById),
            ),
        };
    }

    private _getOptimisticCommentThreads(
        context: WorkerActionContext,
        visit: (visitor: ProsemirrorVisitor) => void,
    ): {
        optimisticCommentThreadIds: Set<DocumentCommentThreadId>;
        getOptimisticCommentThreadById: () => Promise<
            Map<
                DocumentCommentThreadId,
                {
                    readonly commentCount: number;
                    readonly commentAuthors: ReadonlyArray<AccountModel>;
                }
            >
        >;
    } {
        const commentThreadIds = new Set<DocumentCommentThreadId>();

        visit({
            visitMark: mark => {
                if (mark.type.name === "comment") {
                    commentThreadIds.add(
                        assertId<DocumentCommentThreadId>(mark.attrs.commentThreadId),
                    );
                }
            },
        });

        const optimisticCommentThreadIds = new Set<DocumentCommentThreadId>();
        const optimisticCommentThreadAuthorIds = new Set<AccountId>();
        const createOptimisticCommentThreads: Array<
            (accountById: Map<AccountId, AccountModel>) => [
                DocumentCommentThreadId,
                {
                    readonly commentCount: number;
                    readonly commentAuthors: ReadonlyArray<AccountModel>;
                },
            ]
        > = [];

        for (const commentThreadId of commentThreadIds) {
            const optimisticCommentThread = this._optimisticCommentThreadById.get(commentThreadId);
            if (!optimisticCommentThread) continue;

            // If we've optimistically accepted the update which created the referenced
            // comment thread and it hasn't persisted yet then we won't find it when we try
            // to load it from the database. So return an optimistic comment thread model
            // to the client.
            if (optimisticCommentThread.persistedAfterVersion > this._persistedVersion) {
                optimisticCommentThreadIds.add(commentThreadId);
                optimisticCommentThreadAuthorIds.add(
                    optimisticCommentThread.initialComment.authorId,
                );

                createOptimisticCommentThreads.push(accountById => [
                    commentThreadId,
                    {
                        commentCount: 1,
                        commentAuthors: [
                            assertExists(
                                accountById.get(optimisticCommentThread.initialComment.authorId),
                            ),
                        ],
                    },
                ]);
            }
        }

        return {
            optimisticCommentThreadIds,
            getOptimisticCommentThreadById: async () => {
                const {accounts} = await getAccounts(context, {
                    spaceId: this.spaceId,
                    accountIds: optimisticCommentThreadAuthorIds,
                });

                const accountById = new Map(accounts.map(account => [account.id, account]));

                return new Map(
                    createOptimisticCommentThreads.map(createOptimisticCommentThread =>
                        createOptimisticCommentThread(accountById),
                    ),
                );
            },
        };
    }

    /**
     * If we've optimistically created the provided comment thread and are waiting
     * for it to be persisted in the database then we will return the information
     * we optimistically know about this thread and a promise for when it resolves.
     */
    public getOptimisticCommentThreadIfExists(
        commentThreadId: DocumentCommentThreadId,
    ): DocumentCollaborationContentManagerOptimisticCommentThread | null {
        const optimisticCommentThread = this._optimisticCommentThreadById.get(commentThreadId);

        if (
            !optimisticCommentThread ||
            optimisticCommentThread.persistedAfterVersion <= this._persistedVersion
        ) {
            return null;
        }

        return {
            persistedPromise: optimisticCommentThread.persistedPromiseResolver.promise,
            createdTime: optimisticCommentThread.createdTime,
            initialComment: optimisticCommentThread.initialComment,
        };
    }
}
