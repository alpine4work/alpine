import {Step} from "prosemirror-transform";
import {
    WorkerAccountActionContext,
    WorkerActionContext,
} from "~/server/cloudflare/context/worker_action_context.js";
import {WorkerProcessContext} from "~/server/cloudflare/context/worker_process_context.js";
import {DocumentCollaborationEventStub} from "~/server/documents/collaboration/document_collaboration_connection.js";
import {DocumentCollaborationStepCache} from "~/server/documents/collaboration/document_collaboration_step_cache.js";
import {LocalAccessPolicy} from "~/shared/access/access_policy.js";
import {CreateOrUpdateAccessPolicy} from "~/shared/access/model/create_or_update_access_policy_schema.js";
import {ShareNotification} from "~/shared/access/share_notification.js";
import {ContentSelectionWrapper} from "~/shared/content/content_selection_schema.js";
import {getCollaborativelyUpdateContentResult} from "~/shared/content/get_collaboratively_update_content_result.js";
import {MessageContent} from "~/shared/content/message_content_schema.js";
import {DocumentCollaborationPresenceState} from "~/shared/documents/document_collaboration_protocol.js";
import {
    DocumentContentReferencedIds,
    getDocumentContentReferencedIdsForSteps,
    isEmptyDocumentContentReferencedIds,
} from "~/shared/documents/document_content_referenced_ids.js";
import {
    DocumentContentReferences,
    emptyDocumentContentReferences,
} from "~/shared/documents/document_content_references.js";
import {
    DocumentContent,
    DocumentContentProsemirrorSchema,
    isDocumentContent,
} from "~/shared/documents/document_content_schema.js";
import {DynamoGeneralRealtimeEvent} from "~/shared/dynamo/dynamo_general_realtime_types.js";
import {
    DataLossError,
    FailedPreconditionError,
    InternalError,
    InvalidArgumentError,
} from "~/shared/error/error.js";
import {isSystemError} from "~/shared/error/is_system_error_code.js";
import {FileEntityId} from "~/shared/files/file_entity_id.js";
import {MutexValue} from "~/shared/helpers/async/mutex_value.js";
import {PromiseResolver, createPromiseResolver} from "~/shared/helpers/async/promise_resolver.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {TimeZone} from "~/shared/helpers/intl/time_zone.js";
import {concatIterables} from "~/shared/helpers/iterable/concat_iterables.js";
import {emptySet} from "~/shared/helpers/set/empty_set.js";
import {TestCheckpoint} from "~/shared/helpers/test/test_checkpoint.js";
import {assertId, generateId} from "~/shared/id/id.js";
import {
    AccountId,
    ContentEditorClientId,
    DocumentCommentThreadId,
    DocumentId,
    FileId,
    SpaceId,
    WebSocketConnectionId,
} from "~/shared/id/types/id_types.js";
import {
    ProsemirrorVisitor,
    visitProsemirrorStep,
} from "~/shared/prosemirror/prosemirror_visitor.js";
import {RemoveAllMarksStep} from "~/shared/prosemirror/remove_all_marks_step.js";
import {getAccounts} from "~/shared/rpc/accounts_rpc_definitions.js";
import {
    confirmDocumentResolvedCommentThreadIdsWithStrongReadConsistency,
    getDocumentContentReferences,
    updateDocumentContent,
} from "~/shared/rpc/documents_rpc_definitions.js";
import {SiteEntryModel, SitePreviewModel} from "~/shared/sites/site_model.js";
import {AccountModel} from "~/shared/spaces/account_model.js";

export const documentCollaborationContentManagerBeforeUpdateTestCheckpoint =
    new TestCheckpoint<DocumentId>();

export const documentCollaborationContentManagerBeforePersist1TestCheckpoint =
    new TestCheckpoint<DocumentId>();

export const documentCollaborationContentManagerBeforePersist2TestCheckpoint =
    new TestCheckpoint<DocumentId>();

/**
 * Fires inside `updateAndWaitForPersistence` immediately after the in-flight
 * optimistic-persistence promise (`_persistenceState.promise`) has resolved. Tests
 * use this to assert deterministically that the synchronous path is blocked on
 * optimistic persistence — pause this checkpoint, observe it doesn't fire while
 * the optimistic persistence is paused, then unpause optimistic persistence and
 * watch this checkpoint fire.
 */
export const documentCollaborationContentManagerAfterPersistenceWaitTestCheckpoint =
    new TestCheckpoint<DocumentId>();

export type DocumentCollaborationContentManagerOptimisticCommentThread = {
    readonly persistedPromise: Promise<void>;
    readonly createdTime: Date;
    readonly createdTimeZone: TimeZone;
    readonly initialComment: {
        readonly authorId: AccountId;
        readonly content: MessageContent;
        readonly fileIds: ReadonlyArray<FileId | FileEntityId>;
    };
};

/**
 * Class for managing writing to collaborative content in a concurrency safe way.
 */
export class DocumentCollaborationContentManager {
    public readonly spaceId: SpaceId;
    public readonly id: DocumentId;
    public readonly stepCache: DocumentCollaborationStepCache;
    private readonly _sendEventToAllAndWait: (
        context: WorkerProcessContext,
        event: DocumentCollaborationEventStub,
    ) => Promise<void>;
    private readonly _resetAllAuthorizationTimers: (context: WorkerProcessContext) => void;
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
                readonly createdTimeZone: TimeZone;
            }>;
            readonly intentionallyUpdateAccessPolicyRef: {
                current: {
                    readonly accessPolicy: LocalAccessPolicy;
                    readonly notification: ShareNotification | null;
                } | null;
            };
        } | null;
        promise: Promise<void>;
    } | null = null;

    /**
     * The current version that's persisted to the database. This version number will
     * lag behind the version number in state. Because state represents the optimistic
     * version.
     */
    private _persistedVersion: number;

    /**
     * Comment threads created during this durable object's lifetime. Comment threads
     * are actually created at the same time as an `updateDocumentContent()` call. But
     * document persistence in our durable object lags behind what we report to
     * clients! So we use this map to return comment thread models to clients before
     * we've finished persisting the comment thread.
     */
    private readonly _optimisticCommentThreadById = new Map<
        DocumentCommentThreadId,
        {
            readonly persistedAfterVersion: number;
            readonly persistedPromiseResolver: PromiseResolver<void>;
            readonly createdTime: Date;
            readonly createdTimeZone: TimeZone;
            readonly initialComment: {
                readonly authorId: AccountId;
                readonly content: MessageContent;
                readonly fileIds: ReadonlyArray<FileId | FileEntityId>;
            };
        }
    >();

    /**
     * Comment threads our content manager is currently persisting. Comment threads
     * will be removed from this set once we've finished persisting the update that
     * unresolves them.
     */
    private readonly _persistingUnresolveCommentThreadIds = new Map<
        DocumentCommentThreadId,
        number
    >();

    constructor({
        spaceId,
        id,
        initialVersion,
        initialContent,
        sendEventToAllAndWait,
        resetAllAuthorizationTimers,
        killProcess,
    }: {
        spaceId: SpaceId;
        id: DocumentId;
        initialVersion: number;
        initialContent: DocumentContent;
        sendEventToAllAndWait: (
            context: WorkerProcessContext,
            event: DocumentCollaborationEventStub,
        ) => Promise<void>;
        resetAllAuthorizationTimers: (context: WorkerProcessContext) => void;
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
        this._sendEventToAllAndWait = sendEventToAllAndWait;
        this._resetAllAuthorizationTimers = resetAllAuthorizationTimers;
        this._killProcess = killProcess;
    }

    /**
     * Get the current version of our content.
     *
     * This is mutable and will change over time as users update the document content!
     *
     * If you want to update content you should use the version and content provided in
     * the `update()` method.
     */
    public getCurrentVersion() {
        return this._state.getWithoutLock().version;
    }

    /**
     * Get the version of the document persisted in the database.
     *
     * This is mutable and will change over time as users update the document content!
     */
    public getPersistedVersion() {
        return this._persistedVersion;
    }

    /**
     * Get the current content.
     *
     * This is mutable and will change over time as users update the document content!
     *
     * If you want to update content you should use the version and content provided in
     * the `update()` method.
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
        context: WorkerAccountActionContext,
        connectionId: WebSocketConnectionId | null,
        update: {
            version: number;
            steps: ReadonlyArray<Step>;
            clientId: ContentEditorClientId;
            createCommentThreads: ReadonlyArray<{
                commentThreadId: DocumentCommentThreadId;
                createdTimeZone: TimeZone;
                initialCommentContent: MessageContent;
                initialCommentFileIds: ReadonlyArray<FileId | FileEntityId>;
            }>;
            intentionallyUpdateAccessPolicy: {
                accessPolicy: LocalAccessPolicy;
                notification: ShareNotification | null;
            } | null;
            resolveCommentThreadIds?: ReadonlyArray<DocumentCommentThreadId>;
            unresolveCommentThreadIds?: ReadonlyArray<DocumentCommentThreadId>;
            updateOurPresenceState: {state: DocumentCollaborationPresenceState | null};
        },
    ): Promise<{
        newVersion: number;
        newContent: DocumentContent;
        persistencePromise: Promise<void>;
        presenceState: DocumentCollaborationPresenceState | null;
        hasSentPresenceState: boolean;
    }> {
        const result = await this._state.withLock(async stateRef => {
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

            const hasSameClientIdAsNextPersistenceState =
                this._persistenceState?.next?.clientId === update.clientId;

            // Make sure if we're resolving comment threads the client ID is unique so we don't
            // end up batching the update.
            if (hasSameClientIdAsNextPersistenceState) {
                if ((update.resolveCommentThreadIds?.length ?? 0) > 0) {
                    throw new InternalError(
                        "Can\u2019t batch updates that resolve comment threads",
                    );
                }

                if ((update.unresolveCommentThreadIds?.length ?? 0) > 0) {
                    throw new InternalError(
                        "Can\u2019t batch updates that unresolve comment threads",
                    );
                }
            }

            const oldVersion = stateRef.current.version;

            const {newContent, steps, invertedSteps, clientContent, mapping} =
                await getCollaborativelyUpdateContentResult(context, {
                    currentVersion: stateRef.current.version,
                    currentContent: stateRef.current.content,
                    clientVersion: update.version,
                    clientSteps: update.steps,
                    getSteps: (startVersion, endVersion) =>
                        this.stepCache.getSteps(context, startVersion, endVersion),
                });

            assert(isDocumentContent(newContent));

            // Validate the presence state selection based on the document as the client sees
            // it, then map the selection to the correct position.
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
                          selection: ContentSelectionWrapper.new(newPresenceStateSelection),
                      }
                    : null;

            stateRef.current = {
                version: stateRef.current.version + steps.length,
                content: newContent,
            };

            // Populate our step cache with the new steps before telling other clients about
            // the new steps.
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
                    createdTimeZone: createCommentThread.createdTimeZone,
                    initialComment: {
                        authorId: context.actor.getPossiblyBotAccountId(),
                        content: createCommentThread.initialCommentContent,
                        fileIds: createCommentThread.initialCommentFileIds,
                    },
                });
            }

            if (update.unresolveCommentThreadIds) {
                for (const commentThreadId of update.unresolveCommentThreadIds) {
                    const count =
                        this._persistingUnresolveCommentThreadIds.get(commentThreadId) ?? 0;
                    this._persistingUnresolveCommentThreadIds.set(commentThreadId, count);
                }
            }

            // Persist our content by sending our steps to DynamoDB. We need to save our steps
            // in the same sequence we received them.
            //
            // We batch together steps from the same client id while we're waiting on a
            // persistence request to finish.
            if (this._persistenceState?.next && hasSameClientIdAsNextPersistenceState) {
                for (const step of steps) {
                    this._persistenceState.next.steps.push(step);
                }

                for (const createCommentThread of update.createCommentThreads) {
                    this._persistenceState.next.createCommentThreads.push({
                        ...createCommentThread,
                        createdTime: commentThreadCreatedTime,
                    });
                }

                this._persistenceState.next.intentionallyUpdateAccessPolicyRef.current =
                    update.intentionallyUpdateAccessPolicy ??
                    this._persistenceState.next.intentionallyUpdateAccessPolicyRef.current;

                // We should have already thrown an error if `update.resolveCommentThreadIds` or
                // `update.unresolveCommentThreadIds` are non-empty. Not allowed to batch updates
                // that resolve comment threads.
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
                const nextIntentionallyUpdateAccessPolicyRef = {
                    current: update.intentionallyUpdateAccessPolicy,
                };
                const nextResolveCommentThreadIds = update.resolveCommentThreadIds ?? [];
                const nextUnresolveCommentThreadIds = update.unresolveCommentThreadIds ?? [];

                const persistDocumentContent = async () => {
                    // While we wait, steps may be added to `nextSteps` if it's from the same client so
                    // we can save in a single batch.
                    await lastPersistenceStatePromise;

                    await documentCollaborationContentManagerBeforePersist1TestCheckpoint.waitForTest(
                        this.id,
                    );

                    // Do not allow the worker to batch more steps for this request! Instead the worker
                    // needs to schedule a new update promise.
                    if (this._persistenceState?.next?.steps === nextSteps)
                        this._persistenceState.next = null;

                    await context.tracer.withSpan(
                        "Persist document content",
                        async (context, span) => {
                            try {
                                await documentCollaborationContentManagerBeforePersist2TestCheckpoint.waitForTest(
                                    this.id,
                                );

                                const intentionallyUpdateAccessPolicy =
                                    nextIntentionallyUpdateAccessPolicyRef.current ?? undefined;

                                const {newVersion, updatedCommentThreads} =
                                    await updateDocumentContent(context, {
                                        documentId: this.id,
                                        version: oldVersion,
                                        steps: nextSteps,
                                        clientId: update.clientId,
                                        createCommentThreads: nextCreateCommentThreads,
                                        intentionallyUpdateAccessPolicy,
                                        resolveCommentThreadIds: nextResolveCommentThreadIds,
                                        unresolveCommentThreadIds: nextUnresolveCommentThreadIds,
                                    }).catch(error => {
                                        // Upgrade any error to a data loss error. If `updateDocumentContent()` throws
                                        // we'll kill the process and throw away steps that weren't successfully persisted.
                                        throw DataLossError.from(error);
                                    });

                                // The document collaboration durable object should be the only process writing to
                                // a document! If some other process is writing to a document, weird things may
                                // start breaking in the durable object and on the client.
                                //
                                // We save steps anyway to preserve as much user data as we can.
                                if (newVersion !== oldVersion + nextSteps.length) {
                                    throw new InternalError(
                                        "Some process updated document content other than the document\u2019s durable object. This may cause downstream issues as a core assumption about the document collaboration implementation has been violated",
                                    );
                                }

                                this._persistedVersion = oldVersion + nextSteps.length;

                                // Cleanup comment threads that have been persisted. We will be able to fetch the
                                // latest value from the database from here on out.
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

                                // Immediately reauthorize all connections after the access policy changes.
                                if (intentionallyUpdateAccessPolicy)
                                    this._resetAllAuthorizationTimers(context);

                                await this._sendEventToAllAndWait(context, {
                                    type: "PersistedContent",
                                    newVersion: oldVersion + nextSteps.length,
                                    updatedCommentThreads,
                                });
                            } catch (unknownError) {
                                // Upgrade the severity to internal since the client has already seen the update.
                                //
                                // The client will also attempt to reconnect on a system error.
                                const error = !isSystemError(unknownError)
                                    ? InternalError.from(unknownError)
                                    : unknownError;

                                span.addException(error);

                                // Persistence failed, clear out our optimistic comment threads.
                                for (const [commentThreadId, optimisticCommentThread] of this
                                    ._optimisticCommentThreadById) {
                                    this._optimisticCommentThreadById.delete(commentThreadId);
                                    optimisticCommentThread.persistedPromiseResolver.reject(error);
                                }

                                await this._sendEventToAllAndWait(context, {
                                    type: "Error",
                                    error,
                                });
                                this._killProcess(context);
                            } finally {
                                // We're done persisting these comment thread IDs...
                                //
                                // It's ok to clean this up here since `hasSameClientIdAsNextPersistenceState`
                                // should be false whenever we have some `update.unresolveCommentThreadIds`. When
                                // unresolving we won't merge persistence requests.
                                if (update.unresolveCommentThreadIds) {
                                    for (const commentThreadId of update.unresolveCommentThreadIds) {
                                        const count =
                                            this._persistingUnresolveCommentThreadIds.get(
                                                commentThreadId,
                                            ) ?? 0;
                                        if (count <= 1) {
                                            this._persistingUnresolveCommentThreadIds.delete(
                                                commentThreadId,
                                            );
                                        } else {
                                            this._persistingUnresolveCommentThreadIds.set(
                                                commentThreadId,
                                                count - 1,
                                            );
                                        }
                                    }
                                }
                            }
                        },
                    );
                };

                this._persistenceState = {
                    next: {
                        clientId: update.clientId,
                        steps: nextSteps,
                        createCommentThreads: nextCreateCommentThreads,
                        intentionallyUpdateAccessPolicyRef: nextIntentionallyUpdateAccessPolicyRef,
                    },
                    // NOTE(calebmer): We're careful to spawn the promise which updates content from
                    // this `update()` method so the `AppService` network calls count against the
                    // Durable Object request limit for the WebSocket message that triggered the
                    // `update()`.
                    promise: persistDocumentContent(),
                };

                // Make sure the durable object stays alive until we've finished persisting.
                context.process.waitUntil(this._persistenceState.promise);
            }

            return {
                oldVersion,
                steps,
                newContent,
                persistencePromise: this._persistenceState.promise,
                presenceState,
            };
        });

        const {oldVersion, steps, newContent, persistencePromise, presenceState} = result;

        if (steps.length === 0) {
            return {
                newVersion: oldVersion,
                newContent,
                persistencePromise,
                presenceState,
                hasSentPresenceState: false,
            };
        }

        let cleanupInvalidStepCommentThreadsPromise: Promise<void> | null = null;

        const cleanupInvalidStepCommentThreads = ({
            referencedIds,
            references,
            resolvedCommentThreadIds,
        }: {
            referencedIds: DocumentContentReferencedIds;
            references: DocumentContentReferences;
            resolvedCommentThreadIds: ReadonlySet<DocumentCommentThreadId>;
        }): Promise<void> => {
            cleanupInvalidStepCommentThreadsPromise ??= (async () => {
                // If the user tried to insert comment threads into the document we can't find or
                // that have already been resolved (e.g. through a copy/paste) then follow up by
                // removing those comment threads from the document.
                //
                // This happens if the user copies content from a document which has some comments
                // and pastes them in another document. Those comments don't exist in the new
                // document so we'd like to remove those comments from the document entirely.
                //
                // May also want to consider a client implementation of this. Maybe we add
                // `data-document` to comment `<mark>` elements so the clipboard DOM parser can
                // throwaway comment marks from other documents when a paste happens. Then this
                // server logic will serve as a fallback.

                const invalidCommentThreadIds = new Set<DocumentCommentThreadId>();
                const possiblyResolvedCommentThreadIds = new Set<DocumentCommentThreadId>();

                for (const commentThreadId of referencedIds.commentThreadIds) {
                    if (!references.commentThreadById.has(commentThreadId)) {
                        invalidCommentThreadIds.add(commentThreadId);
                    }

                    // If `getContentReferencesForSteps()` reports any comment thread as resolved (that
                    // we're not actively unresolving) then we want to remove that comment thread's
                    // marks from the document as well. However, since `getContentReferencesForSteps()`
                    // reads with eventual consistency we may be reading stale data, so before we clean
                    // the document we'll make another read against DynamoDB with strong consistency to
                    // confirm the comment threads are actually resolved.
                    //
                    // There is a chance of race conditions if a user unresolves while we're waiting on
                    // the network for `AppService` to return its data to
                    // `DocumentCollaborationService`. Such a race condition is pretty rare and the
                    // consequence is pretty minor (comment mark doesn't reappear in document after
                    // unresolved) so we tolerate the race condition.
                    if (
                        resolvedCommentThreadIds.has(commentThreadId) &&
                        !this._persistingUnresolveCommentThreadIds.has(commentThreadId)
                    ) {
                        possiblyResolvedCommentThreadIds.add(commentThreadId);
                    }
                }

                if (
                    invalidCommentThreadIds.size === 0 &&
                    possiblyResolvedCommentThreadIds.size === 0
                ) {
                    return;
                }

                if (possiblyResolvedCommentThreadIds.size > 0) {
                    const {confirmedCommentThreadIds: resolvedCommentThreadIds} =
                        await confirmDocumentResolvedCommentThreadIdsWithStrongReadConsistency(
                            context,
                            {
                                documentId: this.id,
                                commentThreadIds: Array.from(possiblyResolvedCommentThreadIds),
                            },
                        );

                    for (const commentThreadId of resolvedCommentThreadIds) {
                        invalidCommentThreadIds.add(commentThreadId);
                    }
                }

                if (invalidCommentThreadIds.size === 0) return;

                const removeInvalidCommentThreadSteps = Array.from(
                    invalidCommentThreadIds,
                    commentThreadId =>
                        new RemoveAllMarksStep(
                            DocumentContentProsemirrorSchema.marks.comment.create({
                                commentThreadId,
                            }),
                        ),
                );

                // Intentionally using the original `update()` function's `context` so that this
                // remove steps update uses the same `AccountId` as the original update.
                await this.update(context, null, {
                    version: oldVersion + steps.length,
                    steps: removeInvalidCommentThreadSteps,
                    // This update was not generated by the client which called `update()` but rather
                    // by our backend here.
                    clientId: generateId(),
                    createCommentThreads: [],
                    intentionallyUpdateAccessPolicy: null,
                    updateOurPresenceState: {state: null},
                });
            })();

            return cleanupInvalidStepCommentThreadsPromise;
        };

        const newVersion = oldVersion + steps.length;

        // You may receive these events in any order because the timing of loading content
        // references in `transformEvent()` will vary. The client must take care to apply
        // events in the correct order.
        await this._sendEventToAllAndWait(context, {
            type: "UpdateContentWithoutPersistence",
            newVersion,
            steps,
            clientId: update.clientId,
            updateOtherPresenceState: connectionId ? {connectionId, state: presenceState} : null,
            // Let the client know if this update also resolves or un-resolves comments.
            // Remember that if you receive this comment resolution hasn't been persisted yet!
            // So if you try to read a new `DocumentCommentThreadModel` it might not have been
            // updated. You'll get new `DocumentCommentThreadModel`s with the
            // `PersistedContent` event.
            resolveCommentThreadIds: update.resolveCommentThreadIds ?? [],
            unresolveCommentThreadIds: update.unresolveCommentThreadIds ?? [],
            cleanupInvalidStepCommentThreads,
        });

        return {
            newVersion,
            newContent,
            persistencePromise,
            presenceState,
            hasSentPresenceState: true,
        };
    }

    /**
     * Synchronous variant of `update()`: persists to DynamoDB _before_ broadcasting
     * steps to connected clients.
     *
     * The default optimistic path applies steps to in-memory state and broadcasts them
     * to clients before persistence finishes; on persist failure we throw
     * `DataLossError`, kill the durable object, and force all clients to reconnect
     * (losing any un-persisted steps). This synchronous variant is for callers that
     * can't tolerate that rollback.
     *
     * You shouldn't use this path unless you absolutely need to, read the tradeoffs
     * below.
     *
     * ### Tradeoffs
     *
     * - Duplicates a non-trivial amount of business logic from the optimistic path,
     *   violating the DRY principle. We accept this risk because
     *     - this logic is changed infrequently
     *     - merging the logic would dramatically increase the complexity of the update
     *       operation. For example, keeping track of optimistic state and knowing when
     *       to clear it, how to throw errors, etc. becomes really difficult and hard
     *       to follow
     * - Holds the `_state` lock through the DynamoDB round-trip, serializing all
     *   concurrent `update()` calls behind this one. The optimistic path only holds
     *   the lock long enough to _schedule_ persistence. We accept the latency cost
     *   because callers choosing this path are explicitly trading responsiveness for
     *   persistence guarantees, and the client keeps its own optimistic buffer locally
     *   so user input isn't blocked.
     * - Reuses `UpdateContentWithoutPersistence` + `PersistedContent` and sends them
     *   back-to-back. Clients already tolerate these two events arriving out-of-order
     *   (see the schema comment on `UpdateContentWithoutPersistence`). The event name
     *   `UpdateContentWithoutPersistence` is misleading in this path (content IS
     *   persisted when we send it). We accept that cost because the alternatives were
     *   worse: a dedicated `UpdateContentWithPersistence` event would be largely
     *   redundant with the existing pair, and extending `PersistedContent` to carry
     *   steps/clientId/presence would force every existing `PersistedContent` handler
     *   to grow. If the naming becomes confusing we can address in a follow-up change.
     * - No batching – same-client follow-up updates cannot be merged into this
     *   persistence request because the caller is awaiting a confirmed persist.
     */
    public async updateAndWaitForPersistence(
        context: WorkerAccountActionContext,
        connectionId: WebSocketConnectionId | null,
        update: {
            version: number | null;
            steps: ReadonlyArray<Step>;
            clientId: ContentEditorClientId;
            createCommentThreads: ReadonlyArray<{
                commentThreadId: DocumentCommentThreadId;
                createdTimeZone: TimeZone;
                initialCommentContent: MessageContent;
                initialCommentFileIds: ReadonlyArray<FileId | FileEntityId>;
            }>;
            intentionallyUpdateAccessPolicy: {
                accessPolicy: CreateOrUpdateAccessPolicy;
                notification: ShareNotification | null;
            } | null;
            resolveCommentThreadIds?: ReadonlyArray<DocumentCommentThreadId>;
            unresolveCommentThreadIds?: ReadonlyArray<DocumentCommentThreadId>;
            updateOurPresenceState: {state: DocumentCollaborationPresenceState | null};
        },
    ): Promise<{
        presenceState: DocumentCollaborationPresenceState | null;
        hasSentPresenceState: boolean;
        newVersion: number;
        getDynamoGeneralRealtimeEventTransactionForSite: () => Promise<
            ReadonlyArray<DynamoGeneralRealtimeEvent<SitePreviewModel | SiteEntryModel>>
        >;
    }> {
        const {
            oldVersion,
            newVersion,
            steps,
            presenceState,
            eventTransactionForSite,
            updatedCommentThreads,
        } = await this._state.withLock(async stateRef => {
            await documentCollaborationContentManagerBeforeUpdateTestCheckpoint.waitForTest(
                this.id,
            );

            // A null `update.version` means "apply on top of whatever the latest version is" —
            // used by callers like the move-into/out-of-site path that don't have a specific
            // client version to rebase against.
            const clientVersion = update.version ?? stateRef.current.version;

            if (
                update.updateOurPresenceState.state &&
                update.updateOurPresenceState.state.version !== clientVersion
            ) {
                throw new InvalidArgumentError(
                    "Document version in new presence state should match the document version we are updating",
                );
            }

            for (const createCommentThread of update.createCommentThreads) {
                if (this._optimisticCommentThreadById.has(createCommentThread.commentThreadId))
                    throw new FailedPreconditionError(
                        "Document comment thread ID has already been used",
                    );
            }

            // Wait for any in-flight optimistic persistence batch so DynamoDB's version
            // catches up to `stateRef.current.version` before we call
            // `updateDocumentContent()` with `version: oldVersion`.
            await this._persistenceState?.promise;

            await documentCollaborationContentManagerAfterPersistenceWaitTestCheckpoint.waitForTest(
                this.id,
            );

            const oldVersion = stateRef.current.version;

            const {newContent, steps, invertedSteps, clientContent, mapping} =
                await getCollaborativelyUpdateContentResult(context, {
                    currentVersion: stateRef.current.version,
                    currentContent: stateRef.current.content,
                    clientVersion,
                    clientSteps: update.steps,
                    getSteps: (startVersion, endVersion) =>
                        this.stepCache.getSteps(context, startVersion, endVersion),
                });

            assert(isDocumentContent(newContent));

            const clientPresenceStateSelection =
                update.updateOurPresenceState.state?.selection.getAndMaybeDeserialize(
                    clientContent,
                );
            const newPresenceStateSelection = clientPresenceStateSelection?.map(
                newContent,
                mapping,
            );
            const newVersion = oldVersion + steps.length;
            const presenceState: DocumentCollaborationPresenceState | null =
                newPresenceStateSelection
                    ? {
                          version: newVersion,
                          selection: ContentSelectionWrapper.new(newPresenceStateSelection),
                      }
                    : null;

            await documentCollaborationContentManagerBeforePersist1TestCheckpoint.waitForTest(
                this.id,
            );

            const intentionallyUpdateAccessPolicy =
                update.intentionallyUpdateAccessPolicy ?? undefined;
            const commentThreadCreatedTime = new Date();

            // Persist before mutating any in-memory state. If this throws we release the lock
            // with state untouched and propagate the error to the caller — no `DataLossError`
            // / process kill needed because nothing was applied optimistically.
            const {
                newVersion: persistedVersion,
                updatedCommentThreads,
                eventTransactionForSite,
            } = await updateDocumentContent(context, {
                documentId: this.id,
                version: oldVersion,
                steps,
                clientId: update.clientId,
                createCommentThreads: Array.from(
                    update.createCommentThreads,
                    createCommentThread => ({
                        ...createCommentThread,
                        createdTime: commentThreadCreatedTime,
                    }),
                ),
                intentionallyUpdateAccessPolicy,
                resolveCommentThreadIds: update.resolveCommentThreadIds ?? [],
                unresolveCommentThreadIds: update.unresolveCommentThreadIds ?? [],
            });

            if (persistedVersion !== newVersion) {
                throw new DataLossError(
                    "Some process updated document content other than the document\u2019s durable object. This may cause downstream issues as a core assumption about the document collaboration implementation has been violated",
                );
            }

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

            stateRef.current = {
                version: newVersion,
                content: newContent,
            };

            this._persistedVersion = newVersion;

            if (intentionallyUpdateAccessPolicy) {
                this._resetAllAuthorizationTimers(context);
            }

            return {
                oldVersion,
                newVersion,
                steps,
                presenceState,
                eventTransactionForSite,
                updatedCommentThreads,
            };
        });

        const getDynamoGeneralRealtimeEventTransactionForSite = async (): Promise<
            ReadonlyArray<DynamoGeneralRealtimeEvent<SitePreviewModel | SiteEntryModel>>
        > => eventTransactionForSite;

        if (steps.length === 0) {
            return {
                presenceState,
                hasSentPresenceState: false,
                newVersion: oldVersion,
                getDynamoGeneralRealtimeEventTransactionForSite,
            };
        }

        let cleanupInvalidStepCommentThreadsPromise: Promise<void> | null = null;

        const cleanupInvalidStepCommentThreads = ({
            referencedIds,
            references,
            resolvedCommentThreadIds,
        }: {
            referencedIds: DocumentContentReferencedIds;
            references: DocumentContentReferences;
            resolvedCommentThreadIds: ReadonlySet<DocumentCommentThreadId>;
        }): Promise<void> => {
            cleanupInvalidStepCommentThreadsPromise ??= (async () => {
                // If the user tried to insert comment threads into the document we can't find or
                // that have already been resolved (e.g. through a copy/paste) then follow up by
                // removing those comment threads from the document.
                //
                // This happens if the user copies content from a document which has some comments
                // and pastes them in another document. Those comments don't exist in the new
                // document so we'd like to remove those comments from the document entirely.
                //
                // May also want to consider a client implementation of this. Maybe we add
                // `data-document` to comment `<mark>` elements so the clipboard DOM parser can
                // throwaway comment marks from other documents when a paste happens. Then this
                // server logic will serve as a fallback.

                const invalidCommentThreadIds = new Set<DocumentCommentThreadId>();
                const possiblyResolvedCommentThreadIds = new Set<DocumentCommentThreadId>();

                for (const commentThreadId of referencedIds.commentThreadIds) {
                    if (!references.commentThreadById.has(commentThreadId)) {
                        invalidCommentThreadIds.add(commentThreadId);
                    }

                    // If `getContentReferencesForSteps()` reports any comment thread as resolved (that
                    // we're not actively unresolving) then we want to remove that comment thread's
                    // marks from the document as well. However, since `getContentReferencesForSteps()`
                    // reads with eventual consistency we may be reading stale data, so before we clean
                    // the document we'll make another read against DynamoDB with strong consistency to
                    // confirm the comment threads are actually resolved.
                    //
                    // There is a chance of race conditions if a user unresolves while we're waiting on
                    // the network for `AppService` to return its data to
                    // `DocumentCollaborationService`. Such a race condition is pretty rare and the
                    // consequence is pretty minor (comment mark doesn't reappear in document after
                    // unresolved) so we tolerate the race condition.
                    if (
                        resolvedCommentThreadIds.has(commentThreadId) &&
                        !this._persistingUnresolveCommentThreadIds.has(commentThreadId)
                    ) {
                        possiblyResolvedCommentThreadIds.add(commentThreadId);
                    }
                }

                if (
                    invalidCommentThreadIds.size === 0 &&
                    possiblyResolvedCommentThreadIds.size === 0
                ) {
                    return;
                }

                if (possiblyResolvedCommentThreadIds.size > 0) {
                    const {confirmedCommentThreadIds: resolvedCommentThreadIds} =
                        await confirmDocumentResolvedCommentThreadIdsWithStrongReadConsistency(
                            context,
                            {
                                documentId: this.id,
                                commentThreadIds: Array.from(possiblyResolvedCommentThreadIds),
                            },
                        );

                    for (const commentThreadId of resolvedCommentThreadIds) {
                        invalidCommentThreadIds.add(commentThreadId);
                    }
                }

                if (invalidCommentThreadIds.size === 0) return;

                const removeInvalidCommentThreadSteps = Array.from(
                    invalidCommentThreadIds,
                    commentThreadId =>
                        new RemoveAllMarksStep(
                            DocumentContentProsemirrorSchema.marks.comment.create({
                                commentThreadId,
                            }),
                        ),
                );

                // Intentionally using the original `update()` function's `context` so that this
                // remove steps update uses the same `AccountId` as the original update.
                await this.update(context, null, {
                    version: oldVersion + steps.length,
                    steps: removeInvalidCommentThreadSteps,
                    // This update was not generated by the client which called `update()` but rather
                    // by our backend here.
                    clientId: generateId(),
                    createCommentThreads: [],
                    intentionallyUpdateAccessPolicy: null,
                    updateOurPresenceState: {state: null},
                });
            })();

            return cleanupInvalidStepCommentThreadsPromise;
        };

        // Content is already persisted at this point. See the JSDoc on this method for why
        // we still reuse `UpdateContentWithoutPersistence` here instead of introducing a
        // dedicated "with persistence" event.
        //
        // We send `PersistedContent` _before_ `UpdateContentWithoutPersistence` (the
        // reverse of the optimistic path) so a client that processes them in order knows
        // the new version is already persisted by the time the steps land. In the
        // optimistic path the steps would arrive long before persistence completes, so
        // there's an unavoidable window where the client thinks the new version is
        // unpersisted; that window doesn't exist on this synchronous path and we shouldn't
        // fake it.
        await this._sendEventToAllAndWait(context, {
            type: "PersistedContent",
            newVersion,
            updatedCommentThreads,
        });

        await this._sendEventToAllAndWait(context, {
            type: "UpdateContentWithoutPersistence",
            newVersion,
            steps,
            clientId: update.clientId,
            updateOtherPresenceState: connectionId ? {connectionId, state: presenceState} : null,
            resolveCommentThreadIds: update.resolveCommentThreadIds ?? [],
            unresolveCommentThreadIds: update.unresolveCommentThreadIds ?? [],
            cleanupInvalidStepCommentThreads,
        });

        return {
            presenceState,
            hasSentPresenceState: true,
            newVersion,
            getDynamoGeneralRealtimeEventTransactionForSite,
        };
    }

    /**
     * Get the comment thread models in the provided steps for
     * `DocumentContentReferences`.
     *
     * You shouldn't use the `getDocumentCommentReferences()` RPC directly for this
     * purpose because our durable object may have acknowledged the creation of some
     * comment threads but they haven't been persisted in the database yet.
     */
    public async getContentReferencesForSteps(
        context: WorkerActionContext,
        steps: ReadonlyArray<Step>,
    ): Promise<{
        referencedIds: DocumentContentReferencedIds;
        references: DocumentContentReferences;
        resolvedCommentThreadIds: ReadonlySet<DocumentCommentThreadId>;
    }> {
        const {optimisticCommentThreadIds, getOptimisticCommentThreadById} =
            this._getOptimisticCommentThreads(context, visitor => {
                for (const step of steps) {
                    visitProsemirrorStep(step, visitor);
                }
            });

        const referencedIds = getDocumentContentReferencedIdsForSteps(steps, {
            // Optimization: Don't send a network request to load comment threads that haven't
            // been persisted yet. We know they don't exist.
            ignoreCommentThreadIds: optimisticCommentThreadIds,
        });

        const [{references, resolvedCommentThreadIds}, optimisticCommentThreadById] =
            await runAllPromises([
                (async () => {
                    // Optimization: If we have no referenced IDs, then we don't need to send a network
                    // request.
                    if (isEmptyDocumentContentReferencedIds(referencedIds)) {
                        return {
                            references: emptyDocumentContentReferences,
                            resolvedCommentThreadIds: emptySet,
                        };
                    }

                    return getDocumentContentReferences(context, {
                        documentId: this.id,
                        referencedIds,
                    });
                })(),
                getOptimisticCommentThreadById(),
            ]);

        return {
            referencedIds,
            references: {
                ...references,
                commentThreadById: new Map(
                    concatIterables(references.commentThreadById, optimisticCommentThreadById),
                ),
            },
            resolvedCommentThreadIds,
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

            // If we've optimistically accepted the update which created the referenced comment
            // thread and it hasn't persisted yet then we won't find it when we try to load it
            // from the database. So return an optimistic comment thread model to the client.
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
                // Optimization: Don't make a network request if there are no optimistic comment
                // threads.
                if (optimisticCommentThreadAuthorIds.size === 0) return new Map();

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
     * If we've optimistically created the provided comment thread and are waiting for
     * it to be persisted in the database then we will return the information we
     * optimistically know about this thread and a promise for when it resolves.
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
            createdTimeZone: optimisticCommentThread.createdTimeZone,
            initialComment: optimisticCommentThread.initialComment,
        };
    }
}
