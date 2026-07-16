import {Fragment, Slice} from "prosemirror-model";
import {TextSelection} from "prosemirror-state";
import {AddMarkStep, DocAttrStep, RemoveMarkStep, ReplaceStep} from "prosemirror-transform";
import {WorkerSessionActionContextModules} from "~/server/cloudflare/context/worker_action_context.js";
import {WorkerProcessContextModules} from "~/server/cloudflare/context/worker_process_context.js";
import {createTestWorkerContext} from "~/server/cloudflare/test_helpers/create_test_worker_context.js";
import {
    DocumentCollaborationConnection,
    DocumentCollaborationEventStub,
} from "~/server/documents/collaboration/document_collaboration_connection.js";
import {
    documentCollaborationContentManagerAfterPersistenceWaitTestCheckpoint,
    documentCollaborationContentManagerBeforePersist1TestCheckpoint,
    documentCollaborationContentManagerBeforePersist2TestCheckpoint,
    documentCollaborationContentManagerBeforeUpdateTestCheckpoint,
} from "~/server/documents/collaboration/document_collaboration_content_manager.js";
import {DocumentCollaborationDurableObject} from "~/server/documents/collaboration/document_collaboration_durable_object.js";
import {
    FileDocumentAuthorizer,
    createDocumentComment,
    getDocumentComment,
    updateDocumentContent,
} from "~/server/documents/data/documents_actions.js";
import {documentsInjection} from "~/server/documents/data/documents_injection.js";
import {TestDocument} from "~/server/documents/test_helpers/test_document.js";
import {attachFileAsUploader} from "~/server/files/data/files_actions.js";
import {testFileAnalysis, uploadTestFile} from "~/server/files/test_helpers/test_file.js";
import {
    testMessagingRealtimeImplementation,
    testMessagingRealtimeImplementationSearchInjection,
} from "~/server/messaging/realtime/test_helpers/test_messaging_realtime_implementation.js";
import {createSite} from "~/server/sites/data/create_site.js";
import {getSite} from "~/server/sites/data/get_site.js";
import {getSitePreview} from "~/server/sites/data/get_site_preview.js";
import {sitesInjection} from "~/server/sites/data/sites_injection.js";
import {TestSite} from "~/server/sites/test_helpers/test_site.js";
import {getAccount} from "~/server/spaces/get_account.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {WebSocketServerTestConnection} from "~/server/web_socket/web_socket_server.js";
import {AccessPolicy} from "~/shared/access/access_policy.js";
import {emptyContentReferences} from "~/shared/content/content_references.js";
import {ContentSelectionWrapper} from "~/shared/content/content_selection_schema.js";
import {createSimpleMessageContent} from "~/shared/content/message_content_schema.js";
import {ProcessContextModule} from "~/shared/context/process_context_module.js";
import {
    DocumentCollaborationProtocol,
    DocumentCollaborationUpdateContentWithDiffRequestBodySchema,
    DocumentCollaborationUpdateContentWithDiffResponseBodySchema,
} from "~/shared/documents/document_collaboration_protocol.js";
import {emptyDocumentContentReferences} from "~/shared/documents/document_content_references.js";
import {DocumentContentProsemirrorSchema as schema} from "~/shared/documents/document_content_schema.js";
import {
    DocumentCommentModel,
    DocumentCommentRoomKey,
    DocumentCommentThreadModel,
    DocumentModel,
    decodeDocumentCommentRoomKey,
    encodeDocumentCommentRoomKey,
} from "~/shared/documents/document_model.js";
import {InternalError, NotFoundError, PermissionDeniedError} from "~/shared/error/error.js";
import {FileModel} from "~/shared/files/file_model.js";
import {emptyArray} from "~/shared/helpers/array/empty_array.js";
import {filterMapArray} from "~/shared/helpers/array/filter_map_array.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {wait} from "~/shared/helpers/async/wait.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {defaultTimeZone} from "~/shared/helpers/intl/time_zone.js";
import {emptyMap} from "~/shared/helpers/map/empty_map.js";
import {assertOrderKey} from "~/shared/helpers/sort/order_key.js";
import {defaultCompareStrings} from "~/shared/helpers/string/default_compare_strings.js";
import {generateId} from "~/shared/id/id.js";
import {
    ContentEditorClientId,
    DocumentCommentThreadId,
    SiteId,
    SiteSideBarId,
} from "~/shared/id/types/id_types.js";
import {
    AddMarksAfterRemoveAllStep,
    RemoveAllMarksStep,
} from "~/shared/prosemirror/remove_all_marks_step.js";
import {emptyReactionSet} from "~/shared/reactions/reaction_set.js";
import {
    createDocumentComment as createDocumentCommentRpc,
    deleteDocumentComment,
    updateDocumentCommentContent,
} from "~/shared/rpc/documents_rpc_definitions.js";
import {SiteItemSearchEntityId} from "~/shared/search/site_item_search_entity_id.js";
import {printSiteContainerId} from "~/shared/sites/site_entry_id.js";
import {SiteEntityModel} from "~/shared/sites/site_model.js";
import {generateServerSynchronizationCheckpoint} from "~/shared/web_socket/server_synchronization_checkpoint.js";

const context = createTestWorkerContext({
    documentsInjection,
    sitesInjection,
    searchInjection: testMessagingRealtimeImplementationSearchInjection,
});
const {connectForTest, fetchForTest} = DocumentCollaborationDurableObject.test(context);

function massageDocument(document: DocumentModel) {
    return {
        version: document.version,
        content: document.content.doc.toJSON(),
    };
}

function textSlice(text: string) {
    if (text.length === 0) return Slice.empty;
    return new Slice(Fragment.from(schema.text(text)), 0, 0);
}

function createUpdateContentWithDiffRequest({version, text}: {version: number; text: string}) {
    return new Request("https://cyberworlds.local/update-content-with-diff", {
        method: "POST",
        body: JSON.stringify(
            DocumentCollaborationUpdateContentWithDiffRequestBodySchema.serialize({
                version,
                content: [
                    schema.node("title", {}, []),
                    schema.node("paragraph", {}, text.length > 0 ? [schema.text(text)] : []),
                ],
            }),
        ),
    });
}

async function readUpdateContentWithDiffResponse(response: Response) {
    return DocumentCollaborationUpdateContentWithDiffResponseBodySchema.deserialize(
        await response.json(),
    );
}

function waitForPersistence(
    connection: WebSocketServerTestConnection<
        WorkerProcessContextModules,
        WorkerSessionActionContextModules,
        typeof DocumentCollaborationProtocol,
        DocumentCollaborationEventStub,
        DocumentCollaborationConnection
    >,
    version: number,
) {
    return new Promise<void>((resolve, reject) => {
        if (connection.connection.getPersistedVersion() >= version) {
            resolve();
            return;
        }

        const unsubscribe = connection.subscribeToEvents(event => {
            if (event.type === "PersistedContent" && event.newVersion >= version) {
                unsubscribe();
                resolve();
            } else if (event.type === "Error") {
                unsubscribe();
                reject(event.error);
            }
        });
    });
}

test("can not connect to a document that does not exist", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    await expect(connectForTest(context.action(session), generateId())).rejects.toThrow(
        NotFoundError,
    );
});

test("can not connect to a document in a different space", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();
    const otherSpace = await TestSpace.create(context);
    const otherSession = await otherSpace.createSession();

    const document = await TestDocument.create(session, {
        access: {
            type: "Local",
            accountGrantById: new Map([[session.account.id, {level: "Manage", generation: 0}]]),
            defaultGrant: {level: "Manage", generation: 1},
            urlGrant: null,
        },
    });

    await expect(connectForTest(context.action(otherSession), document.id)).rejects.toThrow(
        PermissionDeniedError,
    );
});

test("can not connect to an existing document durable object in a different space", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();
    const otherSpace = await TestSpace.create(context);
    const otherSession = await otherSpace.createSession();

    const document = await TestDocument.create(session, {
        access: {
            type: "Local",
            accountGrantById: new Map([[session.account.id, {level: "Manage", generation: 0}]]),
            defaultGrant: {level: "Manage", generation: 1},
            urlGrant: null,
        },
    });

    await connectForTest(context.action(session), document.id);

    await expect(connectForTest(context.action(otherSession), document.id)).rejects.toThrow(
        PermissionDeniedError,
    );
});

test("can update document content", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();
    const document = await TestDocument.create(session);

    const client1Id = generateId<ContentEditorClientId>();
    const connection1 = await connectForTest(context.action(session), document.id);

    await connection1.procedures.backfill({
        version: 0,
    });

    expect(massageDocument(await document.get())).toEqual({
        version: 0,
        content: schema
            .node("doc", {accessPolicy: document.initialAccessPolicy}, [
                schema.node("title", {}, []),
                schema.node("paragraph", {}, []),
            ])
            .toJSON(),
    });

    await connection1.procedures.updateContent({
        version: 0,
        steps: [new ReplaceStep(3, 3, textSlice("a"))],
        clientId: client1Id,
        createCommentThreads: [],
        intentionallyUpdateAccessPolicy: null,
        updateOurPresenceState: {state: null},
    });

    await waitForPersistence(connection1, 1);

    expect(massageDocument(await document.get())).toEqual({
        version: 1,
        content: schema
            .node("doc", {accessPolicy: document.initialAccessPolicy}, [
                schema.node("title", {}, []),
                schema.node("paragraph", {}, [schema.text("a")]),
            ])
            .toJSON(),
    });

    await connection1.procedures.updateContent({
        version: 1,
        steps: [new ReplaceStep(4, 4, textSlice("b"))],
        clientId: client1Id,
        createCommentThreads: [],
        intentionallyUpdateAccessPolicy: null,
        updateOurPresenceState: {state: null},
    });

    await waitForPersistence(connection1, 2);

    expect(massageDocument(await document.get())).toEqual({
        version: 2,
        content: schema
            .node("doc", {accessPolicy: document.initialAccessPolicy}, [
                schema.node("title", {}, []),
                schema.node("paragraph", {}, [schema.text("ab")]),
            ])
            .toJSON(),
    });

    await connection1.procedures.updateContent({
        version: 2,
        steps: [new ReplaceStep(5, 5, textSlice("c"))],
        clientId: client1Id,
        createCommentThreads: [],
        intentionallyUpdateAccessPolicy: null,
        updateOurPresenceState: {state: null},
    });

    await waitForPersistence(connection1, 3);

    expect(massageDocument(await document.get())).toEqual({
        version: 3,
        content: schema
            .node("doc", {accessPolicy: document.initialAccessPolicy}, [
                schema.node("title", {}, []),
                schema.node("paragraph", {}, [schema.text("abc")]),
            ])
            .toJSON(),
    });
});

test("will optimistically update the document and then persist later", async () => {
    const space = await TestSpace.create(context);
    const [session1, session2] = await space.createSessions(2);
    const document = await TestDocument.create(session1, {
        access: {
            type: "Local",
            accountGrantById: new Map([[session1.account.id, {level: "Manage", generation: 0}]]),
            defaultGrant: {level: "Manage", generation: 1},
            urlGrant: null,
        },
    });

    const client1Id = generateId<ContentEditorClientId>();
    const connection1 = await connectForTest(context.action(session1), document.id);
    const connection2 = await connectForTest(context.action(session2), document.id);

    await connection1.procedures.backfill({
        version: 0,
    });

    await connection2.procedures.backfill({
        version: 0,
    });

    const pausePromise =
        documentCollaborationContentManagerBeforePersist2TestCheckpoint.pauseForTest(document.id);

    await connection1.procedures.updateContent({
        version: 0,
        steps: [new ReplaceStep(3, 3, textSlice("a"))],
        clientId: client1Id,
        createCommentThreads: [],
        intentionallyUpdateAccessPolicy: null,
        updateOurPresenceState: {state: null},
    });

    await connection1.procedures.updateContent({
        version: 1,
        steps: [new ReplaceStep(4, 4, textSlice("b"))],
        clientId: client1Id,
        createCommentThreads: [],
        intentionallyUpdateAccessPolicy: null,
        updateOurPresenceState: {state: null},
    });

    await connection1.procedures.updateContent({
        version: 2,
        steps: [new ReplaceStep(5, 5, textSlice("c"))],
        clientId: client1Id,
        createCommentThreads: [],
        intentionallyUpdateAccessPolicy: null,
        updateOurPresenceState: {state: null},
    });

    const {unpause} = await pausePromise;

    expect(connection2.takeEvents()).toEqual([
        {
            type: "UpdateContentWithoutPersistence",
            newVersion: 1,
            steps: [new ReplaceStep(3, 3, textSlice("a"))],
            stepsContentReferences: emptyDocumentContentReferences,
            clientId: client1Id,
            updateOtherPresenceState: {connectionId: connection1.id, state: null},
            resolveCommentThreadIds: [],
            unresolveCommentThreadIds: [],
        },
        {
            type: "UpdateContentWithoutPersistence",
            newVersion: 2,
            steps: [new ReplaceStep(4, 4, textSlice("b"))],
            stepsContentReferences: emptyDocumentContentReferences,
            clientId: client1Id,
            updateOtherPresenceState: {connectionId: connection1.id, state: null},
            resolveCommentThreadIds: [],
            unresolveCommentThreadIds: [],
        },
        {
            type: "UpdateContentWithoutPersistence",
            newVersion: 3,
            steps: [new ReplaceStep(5, 5, textSlice("c"))],
            stepsContentReferences: emptyDocumentContentReferences,
            clientId: client1Id,
            updateOtherPresenceState: {connectionId: connection1.id, state: null},
            resolveCommentThreadIds: [],
            unresolveCommentThreadIds: [],
        },
    ]);

    expect(massageDocument(await document.get())).toEqual({
        version: 0,
        content: schema
            .node("doc", {accessPolicy: document.initialAccessPolicy}, [
                schema.node("title", {}, []),
                schema.node("paragraph", {}, []),
            ])
            .toJSON(),
    });

    unpause();
    await waitForPersistence(connection1, 3);

    expect(massageDocument(await document.get())).toEqual({
        version: 3,
        content: schema
            .node("doc", {accessPolicy: document.initialAccessPolicy}, [
                schema.node("title", {}, []),
                schema.node("paragraph", {}, [schema.text("abc")]),
            ])
            .toJSON(),
    });

    expect(connection2.takeEvents()).toEqual([
        {
            type: "PersistedContent",
            newVersion: 1,
            updatedCommentThreads: [],
        },
        {
            type: "PersistedContent",
            newVersion: 3,
            updatedCommentThreads: [],
        },
    ]);
});

test("updateContentWithoutOptimisticBroadcast persists before broadcasting", async () => {
    const space = await TestSpace.create(context);
    const [session1, session2] = await space.createSessions(2);
    const document = await TestDocument.create(session1, {
        access: {
            type: "Local",
            accountGrantById: new Map([[session1.account.id, {level: "Manage", generation: 0}]]),
            defaultGrant: {level: "Manage", generation: 1},
            urlGrant: null,
        },
    });

    const client1Id = generateId<ContentEditorClientId>();
    const connection1 = await connectForTest(context.action(session1), document.id);
    const connection2 = await connectForTest(context.action(session2), document.id);

    await connection1.procedures.backfill({version: 0});
    await connection2.procedures.backfill({version: 0});

    // Pause right before the synchronous path would call `updateDocumentContent`. In
    // the optimistic path the broadcast to other clients has already happened by this
    // point; the synchronous path must not have broadcast anything yet.
    const pausePromise =
        documentCollaborationContentManagerBeforePersist1TestCheckpoint.pauseForTest(document.id);

    const updatePromise = connection1.procedures.updateContentWithoutOptimisticBroadcast({
        version: 0,
        steps: [new ReplaceStep(3, 3, textSlice("a"))],
        clientId: client1Id,
        createCommentThreads: [],
        intentionallyUpdateAccessPolicy: null,
        updateOurPresenceState: {state: null},
    });

    const {unpause} = await pausePromise;

    // No events have been broadcast to other connections yet, and the document hasn't
    // been persisted. This is the inverse of the optimistic test above, which sees
    // `UpdateContentWithoutPersistence` already delivered at this checkpoint.
    expect(connection2.takeEvents()).toEqual([]);
    expect(massageDocument(await document.get())).toEqual({
        version: 0,
        content: schema
            .node("doc", {accessPolicy: document.initialAccessPolicy}, [
                schema.node("title", {}, []),
                schema.node("paragraph", {}, []),
            ])
            .toJSON(),
    });

    unpause();
    const result = await updatePromise;

    expect(result.newVersion).toBe(1);

    expect(connection2.takeEvents()).toEqual([
        // `PersistedContent` is sent before `UpdateContentWithoutPersistence` on the
        // synchronous path so a client that processes events in order knows the new
        // version is already persisted by the time the steps land.
        {
            type: "PersistedContent",
            newVersion: 1,
            updatedCommentThreads: [],
        },
        {
            type: "UpdateContentWithoutPersistence",
            newVersion: 1,
            steps: [new ReplaceStep(3, 3, textSlice("a"))],
            stepsContentReferences: emptyDocumentContentReferences,
            clientId: client1Id,
            updateOtherPresenceState: {connectionId: connection1.id, state: null},
            resolveCommentThreadIds: [],
            unresolveCommentThreadIds: [],
        },
    ]);

    expect(massageDocument(await document.get())).toEqual({
        version: 1,
        content: schema
            .node("doc", {accessPolicy: document.initialAccessPolicy}, [
                schema.node("title", {}, []),
                schema.node("paragraph", {}, [schema.text("a")]),
            ])
            .toJSON(),
    });
});

// Locks down the failure-recovery invariant in `updateAndWaitForPersistence`'s
// JSDoc: "Persist before mutating any in-memory state. If this throws we release
// the lock with state untouched and propagate the error to the caller". A failed
// synchronous update must leave both the durable object's in-memory state AND the
// step cache untouched, so a follow-up update can succeed and a backfill from an
// earlier version returns only the legitimately-persisted steps — not the failed
// steps from the doomed call.
test("updateContentWithoutOptimisticBroadcast failure leaves state untouched and another update can succeed", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();
    const document = await TestDocument.create(session, {
        access: {
            type: "Local",
            accountGrantById: new Map([[session.account.id, {level: "Manage", generation: 0}]]),
            defaultGrant: {level: "Manage", generation: 1},
            urlGrant: null,
        },
    });

    const clientId = generateId<ContentEditorClientId>();
    const connection = await connectForTest(context.action(session), document.id);

    await connection.procedures.backfill({version: 0});

    // First persist a legitimate update so we have a non-trivial version to backfill
    // from later. After this the durable object is at version 1 with content "a".
    await connection.procedures.updateContent({
        version: 0,
        steps: [new ReplaceStep(3, 3, textSlice("a"))],
        clientId,
        createCommentThreads: [],
        intentionallyUpdateAccessPolicy: null,
        updateOurPresenceState: {state: null},
    });
    await waitForPersistence(connection, 1);

    // Now drive a synchronous update that _will_ fail in `updateDocumentContent`.
    // `intentionallyUpdateAccessPolicy` for a non-existent `siteId` causes
    // `dangerouslyGetAddToSiteTransactionEntries` → `getSiteTreeForUpdate` to throw
    // because no site rows exist for that id. The throw propagates back through
    // `updateAndWaitForPersistence` after `withLock` is held.
    const fakeSiteId = generateId<SiteId>();

    await expect(
        connection.procedures.updateContentWithoutOptimisticBroadcast({
            version: 1,
            steps: [new ReplaceStep(4, 4, textSlice("X"))],
            clientId,
            createCommentThreads: [],
            intentionallyUpdateAccessPolicy: {
                accessPolicy: {
                    type: "Site",
                    siteId: fakeSiteId,
                    position: {
                        parentId: `SideBar:${generateId<SiteSideBarId>()}`,
                        orderKey: assertOrderKey("a0"),
                    },
                },
                notification: null,
            },
            updateOurPresenceState: {state: null},
        }),
    ).rejects.toThrow();

    // State invariant 1: persisted document is still at version 1 with the original
    // "a" — the failed update must NOT have written "X".
    expect(massageDocument(await document.get())).toEqual({
        version: 1,
        content: schema
            .node("doc", {accessPolicy: document.initialAccessPolicy}, [
                schema.node("title", {}, []),
                schema.node("paragraph", {}, [schema.text("a")]),
            ])
            .toJSON(),
    });

    // State invariant 2: a follow-up update succeeds. If the failed call had partially
    // mutated the lock state, the step cache, or `_persistenceState` we'd see version
    // conflicts or stale rebase results here.
    await connection.procedures.updateContent({
        version: 1,
        steps: [new ReplaceStep(4, 4, textSlice("b"))],
        clientId,
        createCommentThreads: [],
        intentionallyUpdateAccessPolicy: null,
        updateOurPresenceState: {state: null},
    });
    await waitForPersistence(connection, 2);

    expect(massageDocument(await document.get())).toEqual({
        version: 2,
        content: schema
            .node("doc", {accessPolicy: document.initialAccessPolicy}, [
                schema.node("title", {}, []),
                schema.node("paragraph", {}, [schema.text("ab")]),
            ])
            .toJSON(),
    });

    // State invariant 3: backfill from version 1 returns only the surviving v1→v2
    // step. The failed update's step ("X") must not appear in the step cache.
    const backfillResult = await connection.procedures.backfill({version: 1});
    expect(backfillResult.newVersion).toBe(2);
    expect(backfillResult.steps).toEqual([
        {
            step: new ReplaceStep(4, 4, textSlice("b")),
            invertedStep: expect.any(ReplaceStep),
            clientId,
        },
    ]);
});

// Locks down the `await this._persistenceState?.promise;` await inside
// `updateAndWaitForPersistence`. The synchronous path must not race ahead of
// in-flight optimistic persistence — otherwise the DynamoDB version would lag the
// in-memory `stateRef.current.version` and `updateDocumentContent` would be called
// with a stale `oldVersion`. Uses the `AfterPersistenceWaitTestCheckpoint` (added
// specifically for this test) to observe deterministically that the synchronous
// path is still blocked while optimistic persistence is paused.
test("updateContentWithoutOptimisticBroadcast waits for in-flight optimistic persistence", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();
    const document = await TestDocument.create(session, {
        access: {
            type: "Local",
            accountGrantById: new Map([[session.account.id, {level: "Manage", generation: 0}]]),
            defaultGrant: {level: "Manage", generation: 1},
            urlGrant: null,
        },
    });

    const clientId = generateId<ContentEditorClientId>();
    const connection = await connectForTest(context.action(session), document.id);

    await connection.procedures.backfill({version: 0});

    // Pause optimistic persistence at `BeforePersist1` so `_persistenceState.promise`
    // stays unresolved until we explicitly let it through.
    const beforePersist1Pause =
        documentCollaborationContentManagerBeforePersist1TestCheckpoint.pauseForTest(document.id);

    // Pause the new "after persistence wait" checkpoint. We use this to detect whether
    // the synchronous path got past `await this._persistenceState?.promise;`.
    const afterPersistenceWaitPause =
        documentCollaborationContentManagerAfterPersistenceWaitTestCheckpoint.pauseForTest(
            document.id,
        );

    // Optimistic update: applies in-memory at v1 and schedules persistence (paused at
    // BeforePersist1).
    await connection.procedures.updateContent({
        version: 0,
        steps: [new ReplaceStep(3, 3, textSlice("a"))],
        clientId,
        createCommentThreads: [],
        intentionallyUpdateAccessPolicy: null,
        updateOurPresenceState: {state: null},
    });

    // Confirm the optimistic persistence is in fact paused at BeforePersist1.
    const {unpause: unpauseBeforePersist1} = await beforePersist1Pause;

    // Kick off the synchronous update. It should acquire the state lock, validate, and
    // then block at `await this._persistenceState?.promise;` — never reaching the
    // AfterPersistenceWait checkpoint until we let the optimistic persistence through.
    const syncUpdatePromise = connection.procedures.updateContentWithoutOptimisticBroadcast({
        version: 1,
        steps: [new ReplaceStep(4, 4, textSlice("b"))],
        clientId,
        createCommentThreads: [],
        intentionallyUpdateAccessPolicy: null,
        updateOurPresenceState: {state: null},
    });

    // Race the AfterPersistenceWait pause against a wait. If the wait wins, the
    // synchronous update is still blocked on optimistic persistence — which is exactly
    // the invariant we want. If the pause wins (i.e., the synchronous update raced
    // ahead), this test fails.
    const afterPersistenceWaitFiredEarly = await Promise.race([
        afterPersistenceWaitPause.then(() => true),
        wait(500).then(() => false),
    ]);
    expect(afterPersistenceWaitFiredEarly).toBe(false);

    // Let the optimistic persistence complete. After `updateDocumentContent` finishes,
    // `_persistenceState.promise` resolves and the synchronous update proceeds past
    // its await — firing AfterPersistenceWait.
    unpauseBeforePersist1();

    const {unpause: unpauseAfterPersistenceWait} = await afterPersistenceWaitPause;
    unpauseAfterPersistenceWait();

    const result = await syncUpdatePromise;

    // Sync update committed at v2 — confirming it ran _after_ optimistic v1 persisted,
    // not in parallel with it.
    expect(result.newVersion).toBe(2);
});

test("will not batch updates from different accounts when persisting", async () => {
    const space = await TestSpace.create(context);
    const [session1, session2] = await space.createSessions(2);

    const document = await TestDocument.create(session1, {
        access: {
            type: "Local",
            accountGrantById: new Map([[session1.account.id, {level: "Manage", generation: 0}]]),
            defaultGrant: {level: "Manage", generation: 1},
            urlGrant: null,
        },
    });

    const client1Id = generateId<ContentEditorClientId>();
    const client3Id = generateId<ContentEditorClientId>();
    const connection1 = await connectForTest(context.action(session1), document.id);
    const connection2 = await connectForTest(context.action(session2), document.id);
    const connection3 = await connectForTest(context.action(session2), document.id);

    await connection1.procedures.backfill({
        version: 0,
    });

    await connection2.procedures.backfill({
        version: 0,
    });

    const pausePromise =
        documentCollaborationContentManagerBeforePersist2TestCheckpoint.pauseForTest(document.id);

    await connection1.procedures.updateContent({
        version: 0,
        steps: [new ReplaceStep(3, 3, textSlice("a"))],
        clientId: client1Id,
        createCommentThreads: [],
        intentionallyUpdateAccessPolicy: null,
        updateOurPresenceState: {state: null},
    });

    await connection1.procedures.updateContent({
        version: 1,
        steps: [new ReplaceStep(4, 4, textSlice("b"))],
        clientId: client1Id,
        createCommentThreads: [],
        intentionallyUpdateAccessPolicy: null,
        updateOurPresenceState: {state: null},
    });

    await connection3.procedures.updateContent({
        version: 2,
        steps: [new ReplaceStep(5, 5, textSlice("c"))],
        clientId: client3Id,
        createCommentThreads: [],
        intentionallyUpdateAccessPolicy: null,
        updateOurPresenceState: {state: null},
    });

    const {unpause} = await pausePromise;

    expect(connection2.takeEvents()).toEqual([
        {
            type: "UpdateContentWithoutPersistence",
            newVersion: 1,
            steps: [new ReplaceStep(3, 3, textSlice("a"))],
            stepsContentReferences: emptyDocumentContentReferences,
            clientId: client1Id,
            updateOtherPresenceState: {connectionId: connection1.id, state: null},
            resolveCommentThreadIds: [],
            unresolveCommentThreadIds: [],
        },
        {
            type: "UpdateContentWithoutPersistence",
            newVersion: 2,
            steps: [new ReplaceStep(4, 4, textSlice("b"))],
            stepsContentReferences: emptyDocumentContentReferences,
            clientId: client1Id,
            updateOtherPresenceState: {connectionId: connection1.id, state: null},
            resolveCommentThreadIds: [],
            unresolveCommentThreadIds: [],
        },
        {
            type: "UpdateContentWithoutPersistence",
            newVersion: 3,
            steps: [new ReplaceStep(5, 5, textSlice("c"))],
            stepsContentReferences: emptyDocumentContentReferences,
            clientId: client3Id,
            updateOtherPresenceState: {connectionId: connection3.id, state: null},
            resolveCommentThreadIds: [],
            unresolveCommentThreadIds: [],
        },
    ]);

    expect(massageDocument(await document.get())).toEqual({
        version: 0,
        content: schema
            .node("doc", {accessPolicy: document.initialAccessPolicy}, [
                schema.node("title", {}, []),
                schema.node("paragraph", {}, []),
            ])
            .toJSON(),
    });

    unpause();
    await waitForPersistence(connection1, 3);

    expect(massageDocument(await document.get())).toEqual({
        version: 3,
        content: schema
            .node("doc", {accessPolicy: document.initialAccessPolicy}, [
                schema.node("title", {}, []),
                schema.node("paragraph", {}, [schema.text("abc")]),
            ])
            .toJSON(),
    });

    expect(connection2.takeEvents()).toEqual([
        {
            type: "PersistedContent",
            newVersion: 1,
            updatedCommentThreads: [],
        },
        {
            type: "PersistedContent",
            newVersion: 2,
            updatedCommentThreads: [],
        },
        {
            type: "PersistedContent",
            newVersion: 3,
            updatedCommentThreads: [],
        },
    ]);
});

test("will respond optimistically with a comment thread even if it has not been persisted yet", async () => {
    const space = await TestSpace.create(context);
    const [session1, session2] = await space.createSessions(2);

    const document = await TestDocument.create(session1, {
        access: {
            type: "Local",
            accountGrantById: new Map([[session1.account.id, {level: "Manage", generation: 0}]]),
            defaultGrant: {level: "Manage", generation: 1},
            urlGrant: null,
        },
    });

    await updateDocumentContent(session1.action(), {
        id: document.id,
        version: 0,
        steps: [new ReplaceStep(3, 3, textSlice("Hello, world!"))],
        clientId: generateId(),
    });

    const commentThreadId = generateId<DocumentCommentThreadId>();

    const client1Id = generateId<ContentEditorClientId>();
    const connection1 = await connectForTest(context.action(session1), document.id);
    const connection2 = await connectForTest(context.action(session2), document.id);

    await connection1.procedures.backfill({
        version: 0,
    });

    await connection2.procedures.backfill({
        version: 0,
    });

    const pausePromise =
        documentCollaborationContentManagerBeforePersist2TestCheckpoint.pauseForTest(document.id);

    await connection1.procedures.updateContent({
        version: 1,
        steps: [new AddMarkStep(10, 15, schema.mark("comment", {commentThreadId}))],
        clientId: client1Id,
        createCommentThreads: [
            {
                commentThreadId,
                initialCommentContent: createSimpleMessageContent("Test message content 1"),
                initialCommentFileIds: [],
                createdTimeZone: defaultTimeZone,
            },
        ],
        intentionallyUpdateAccessPolicy: null,
        updateOurPresenceState: {state: null},
    });

    const {unpause} = await pausePromise;

    expect(connection1.takeEvents()).toEqual([
        {
            type: "UpdateContentWithoutPersistence",
            newVersion: 2,
            steps: [new AddMarkStep(10, 15, schema.mark("comment", {commentThreadId}))],
            stepsContentReferences: {
                ...emptyDocumentContentReferences,
                commentThreadById: new Map([
                    [
                        commentThreadId,
                        {
                            commentCount: 1,
                            commentAuthors: [
                                await getAccount(session1.action(), space.id, session1.account.id),
                            ],
                        },
                    ],
                ]),
            },
            clientId: client1Id,
            updateOtherPresenceState: {connectionId: connection1.id, state: null},
            resolveCommentThreadIds: [],
            unresolveCommentThreadIds: [],
        },
    ]);

    expect(connection2.takeEvents()).toEqual([
        {
            type: "UpdateContentWithoutPersistence",
            newVersion: 2,
            steps: [new AddMarkStep(10, 15, schema.mark("comment", {commentThreadId}))],
            stepsContentReferences: {
                ...emptyDocumentContentReferences,
                commentThreadById: new Map([
                    [
                        commentThreadId,
                        {
                            commentCount: 1,
                            commentAuthors: [
                                await getAccount(session1.action(), space.id, session1.account.id),
                            ],
                        },
                    ],
                ]),
            },
            clientId: client1Id,
            updateOtherPresenceState: {connectionId: connection1.id, state: null},
            resolveCommentThreadIds: [],
            unresolveCommentThreadIds: [],
        },
    ]);

    await expect(() =>
        getDocumentComment(session1.action(), {
            documentId: document.id,
            commentThreadId,
            commentIndex: 0,
        }),
    ).rejects.toThrow(NotFoundError);

    expect(
        await connection1.procedures.getCommentsFromStart({
            commentThreadId,
            limit: 10,
            afterCommentIndex: null,
            beforeCommentIndex: null,
        }),
    ).toEqual({
        commentCount: 1,
        otherReferencedComments: [],
        comments: [
            new DocumentCommentModel({
                documentId: document.id,
                commentThreadId,
                index: 0,
                version: 0,
                author: await getAccount(session1.action(), space.id, session1.account.id),
                createdTime: expect.any(Date),
                createdTimeZone: defaultTimeZone,
                payload: {
                    type: "Content",
                    parent: null,
                    content: {
                        doc: createSimpleMessageContent("Test message content 1"),
                        references: emptyContentReferences,
                    },
                    contentUpdate: null,
                    files: [],
                    reactionsByPos: emptyMap,
                    filesReactions: emptyReactionSet,
                },
                stream: null,
            }),
        ],
    });

    expect(
        await connection2.procedures.getCommentsFromStart({
            commentThreadId,
            limit: 10,
            afterCommentIndex: null,
            beforeCommentIndex: null,
        }),
    ).toEqual({
        commentCount: 1,
        otherReferencedComments: [],
        comments: [
            new DocumentCommentModel({
                documentId: document.id,
                commentThreadId,
                index: 0,
                version: 0,
                author: await getAccount(session1.action(), space.id, session1.account.id),
                createdTime: expect.any(Date),
                createdTimeZone: defaultTimeZone,
                payload: {
                    type: "Content",
                    parent: null,
                    content: {
                        doc: createSimpleMessageContent("Test message content 1"),
                        references: emptyContentReferences,
                    },
                    contentUpdate: null,
                    files: [],
                    reactionsByPos: emptyMap,
                    filesReactions: emptyReactionSet,
                },
                stream: null,
            }),
        ],
    });

    unpause();
    await waitForPersistence(connection1, 2);

    expect(
        await getDocumentComment(session1.action(), {
            documentId: document.id,
            commentThreadId,
            commentIndex: 0,
        }),
    ).not.toBeNull();

    expect(connection1.takeEvents()).toEqual([
        {
            type: "PersistedContent",
            newVersion: 2,
            updatedCommentThreads: [],
        },
    ]);

    expect(connection2.takeEvents()).toEqual([
        {
            type: "PersistedContent",
            newVersion: 2,
            updatedCommentThreads: [],
        },
    ]);

    expect(
        await connection1.procedures.getCommentsFromStart({
            commentThreadId,
            limit: 10,
            afterCommentIndex: null,
            beforeCommentIndex: null,
        }),
    ).toEqual({
        commentCount: 1,
        otherReferencedComments: [],
        comments: [
            new DocumentCommentModel({
                documentId: document.id,
                commentThreadId,
                index: 0,
                version: 0,
                author: await getAccount(session1.action(), space.id, session1.account.id),
                createdTime: expect.any(Date),
                createdTimeZone: defaultTimeZone,
                payload: {
                    type: "Content",
                    parent: null,
                    content: {
                        doc: createSimpleMessageContent("Test message content 1"),
                        references: emptyContentReferences,
                    },
                    contentUpdate: null,
                    files: [],
                    reactionsByPos: emptyMap,
                    filesReactions: emptyReactionSet,
                },
                stream: null,
            }),
        ],
    });

    expect(
        await connection2.procedures.getCommentsFromStart({
            commentThreadId,
            limit: 10,
            afterCommentIndex: null,
            beforeCommentIndex: null,
        }),
    ).toEqual({
        commentCount: 1,
        otherReferencedComments: [],
        comments: [
            new DocumentCommentModel({
                documentId: document.id,
                commentThreadId,
                index: 0,
                version: 0,
                author: await getAccount(session1.action(), space.id, session1.account.id),
                createdTime: expect.any(Date),
                createdTimeZone: defaultTimeZone,
                payload: {
                    type: "Content",
                    parent: null,
                    content: {
                        doc: createSimpleMessageContent("Test message content 1"),
                        references: emptyContentReferences,
                    },
                    contentUpdate: null,
                    files: [],
                    reactionsByPos: emptyMap,
                    filesReactions: emptyReactionSet,
                },
                stream: null,
            }),
        ],
    });
});

test("will respond optimistically to backfills with a comment thread even if it has not been persisted yet", async () => {
    const space = await TestSpace.create(context);
    const [session1, session2] = await space.createSessions(2);

    const document = await TestDocument.create(session1, {
        access: {
            type: "Local",
            accountGrantById: new Map([[session1.account.id, {level: "Manage", generation: 0}]]),
            defaultGrant: {level: "Manage", generation: 1},
            urlGrant: null,
        },
    });

    await updateDocumentContent(session1.action(), {
        id: document.id,
        version: 0,
        steps: [new ReplaceStep(3, 3, textSlice("Hello, world!"))],
        clientId: generateId(),
    });

    const commentThreadId = generateId<DocumentCommentThreadId>();

    const client1Id = generateId<ContentEditorClientId>();
    const connection1 = await connectForTest(context.action(session1), document.id);

    await connection1.procedures.backfill({
        version: 0,
    });

    const pausePromise =
        documentCollaborationContentManagerBeforePersist2TestCheckpoint.pauseForTest(document.id);

    await connection1.procedures.updateContent({
        version: 1,
        steps: [new AddMarkStep(10, 15, schema.mark("comment", {commentThreadId}))],
        clientId: client1Id,
        createCommentThreads: [
            {
                commentThreadId,
                initialCommentContent: createSimpleMessageContent("Test message content 1"),
                initialCommentFileIds: [],
                createdTimeZone: defaultTimeZone,
            },
        ],
        intentionallyUpdateAccessPolicy: null,
        updateOurPresenceState: {state: null},
    });

    const {unpause} = await pausePromise;

    expect(connection1.takeEvents()).toEqual([
        {
            type: "UpdateContentWithoutPersistence",
            newVersion: 2,
            steps: [new AddMarkStep(10, 15, schema.mark("comment", {commentThreadId}))],
            stepsContentReferences: {
                ...emptyDocumentContentReferences,
                commentThreadById: new Map([
                    [
                        commentThreadId,
                        {
                            commentCount: 1,
                            commentAuthors: [
                                await getAccount(session1.action(), space.id, session1.account.id),
                            ],
                        },
                    ],
                ]),
            },
            clientId: client1Id,
            updateOtherPresenceState: {connectionId: connection1.id, state: null},
            resolveCommentThreadIds: [],
            unresolveCommentThreadIds: [],
        },
    ]);

    const connection2 = await connectForTest(context.action(session2), document.id);

    expect(
        await connection2.procedures.backfill({
            version: 1,
        }),
    ).toEqual({
        newVersion: 2,
        persistedVersion: 1,
        steps: [
            {
                clientId: client1Id,
                step: new AddMarkStep(10, 15, schema.mark("comment", {commentThreadId})),
                invertedStep: new RemoveMarkStep(10, 15, schema.mark("comment", {commentThreadId})),
            },
        ],
        stepsContentReferences: {
            ...emptyDocumentContentReferences,
            commentThreadById: new Map([
                [
                    commentThreadId,
                    {
                        commentCount: 1,
                        commentAuthors: [
                            await getAccount(session1.action(), space.id, session1.account.id),
                        ],
                    },
                ],
            ]),
        },
        presenceStates: [],
        rememberInvertedSteps: [],
    });

    expect(connection2.takeEvents()).toEqual([]);

    await expect(() =>
        getDocumentComment(session1.action(), {
            documentId: document.id,
            commentThreadId,
            commentIndex: 0,
        }),
    ).rejects.toThrow(NotFoundError);

    unpause();
    await waitForPersistence(connection1, 2);

    expect(
        await getDocumentComment(session1.action(), {
            documentId: document.id,
            commentThreadId,
            commentIndex: 0,
        }),
    ).not.toBeNull();

    expect(connection1.takeEvents()).toEqual([
        {
            type: "PersistedContent",
            newVersion: 2,
            updatedCommentThreads: [],
        },
    ]);

    expect(connection2.takeEvents()).toEqual([
        {
            type: "PersistedContent",
            newVersion: 2,
            updatedCommentThreads: [],
        },
    ]);
});

test("will respond optimistically with a comment thread with files even if it has not been persisted yet", async () => {
    const space = await TestSpace.create(context);
    const [session1, session2] = await space.createSessions(2);

    const document = await TestDocument.create(session1, {
        access: {
            type: "Local",
            accountGrantById: new Map([[session1.account.id, {level: "Manage", generation: 0}]]),
            defaultGrant: {level: "Manage", generation: 1},
            urlGrant: null,
        },
    });

    await updateDocumentContent(session1.action(), {
        id: document.id,
        version: 0,
        steps: [new ReplaceStep(3, 3, textSlice("Hello, world!"))],
        clientId: generateId(),
    });

    const commentThreadId = generateId<DocumentCommentThreadId>();

    const client1Id = generateId<ContentEditorClientId>();
    const connection1 = await connectForTest(context.action(session1), document.id);
    const connection2 = await connectForTest(context.action(session2), document.id);

    await connection1.procedures.backfill({
        version: 0,
    });

    await connection2.procedures.backfill({
        version: 0,
    });

    const pausePromise =
        documentCollaborationContentManagerBeforePersist2TestCheckpoint.pauseForTest(document.id);

    const [{fileId: file1Id}, {fileId: file2Id}] = await runAllPromises([
        uploadTestFile(session1.action(), space.id),
        uploadTestFile(session1.action(), space.id),
    ]);

    await runAllPromises([
        attachFileAsUploader(
            session1.action(),
            file1Id,
            FileDocumentAuthorizer.bind({type: "DocumentComments", documentId: document.id}),
        ),
        attachFileAsUploader(
            session1.action(),
            file2Id,
            FileDocumentAuthorizer.bind({type: "DocumentComments", documentId: document.id}),
        ),
    ]);

    await connection1.procedures.updateContent({
        version: 1,
        steps: [new AddMarkStep(10, 15, schema.mark("comment", {commentThreadId}))],
        clientId: client1Id,
        createCommentThreads: [
            {
                commentThreadId,
                initialCommentContent: createSimpleMessageContent("Test message content 1"),
                initialCommentFileIds: [file1Id, file2Id],
                createdTimeZone: defaultTimeZone,
            },
        ],
        intentionallyUpdateAccessPolicy: null,
        updateOurPresenceState: {state: null},
    });

    const {unpause} = await pausePromise;

    expect(connection1.takeEvents()).toEqual([
        {
            type: "UpdateContentWithoutPersistence",
            newVersion: 2,
            steps: [new AddMarkStep(10, 15, schema.mark("comment", {commentThreadId}))],
            stepsContentReferences: {
                ...emptyDocumentContentReferences,
                commentThreadById: new Map([
                    [
                        commentThreadId,
                        {
                            commentCount: 1,
                            commentAuthors: [
                                await getAccount(session1.action(), space.id, session1.account.id),
                            ],
                        },
                    ],
                ]),
            },
            clientId: client1Id,
            updateOtherPresenceState: {connectionId: connection1.id, state: null},
            resolveCommentThreadIds: [],
            unresolveCommentThreadIds: [],
        },
    ]);

    expect(connection2.takeEvents()).toEqual([
        {
            type: "UpdateContentWithoutPersistence",
            newVersion: 2,
            steps: [new AddMarkStep(10, 15, schema.mark("comment", {commentThreadId}))],
            stepsContentReferences: {
                ...emptyDocumentContentReferences,
                commentThreadById: new Map([
                    [
                        commentThreadId,
                        {
                            commentCount: 1,
                            commentAuthors: [
                                await getAccount(session1.action(), space.id, session1.account.id),
                            ],
                        },
                    ],
                ]),
            },
            clientId: client1Id,
            updateOtherPresenceState: {connectionId: connection1.id, state: null},
            resolveCommentThreadIds: [],
            unresolveCommentThreadIds: [],
        },
    ]);

    await expect(() =>
        getDocumentComment(session1.action(), {
            documentId: document.id,
            commentThreadId,
            commentIndex: 0,
        }),
    ).rejects.toThrow(NotFoundError);

    expect(
        await connection1.procedures.getCommentsFromStart({
            commentThreadId,
            limit: 10,
            afterCommentIndex: null,
            beforeCommentIndex: null,
        }),
    ).toEqual({
        commentCount: 1,
        otherReferencedComments: [],
        comments: [
            new DocumentCommentModel({
                documentId: document.id,
                commentThreadId,
                index: 0,
                version: 0,
                author: await getAccount(session1.action(), space.id, session1.account.id),
                createdTime: expect.any(Date),
                createdTimeZone: defaultTimeZone,
                payload: {
                    type: "Content",
                    parent: null,
                    content: {
                        doc: createSimpleMessageContent("Test message content 1"),
                        references: emptyContentReferences,
                    },
                    contentUpdate: null,
                    files: [
                        {
                            type: "File",
                            signedUrlSearch: expect.any(String),
                            file: new FileModel({
                                id: file1Id,
                                spaceId: space.id,
                                contentType: "image/png",
                                contentLength: 5232,
                                isUploading: false,
                                alternative: null,
                                analysis: testFileAnalysis,
                                transcript: null,
                                preview: expect.any(Object),
                            }),
                        },
                        {
                            type: "File",
                            signedUrlSearch: expect.any(String),
                            file: new FileModel({
                                id: file2Id,
                                spaceId: space.id,
                                contentType: "image/png",
                                contentLength: 5232,
                                isUploading: false,
                                alternative: null,
                                analysis: testFileAnalysis,
                                transcript: null,
                                preview: expect.any(Object),
                            }),
                        },
                    ],
                    reactionsByPos: emptyMap,
                    filesReactions: emptyReactionSet,
                },
                stream: null,
            }),
        ],
    });

    expect(
        await connection2.procedures.getCommentsFromStart({
            commentThreadId,
            limit: 10,
            afterCommentIndex: null,
            beforeCommentIndex: null,
        }),
    ).toEqual({
        commentCount: 1,
        otherReferencedComments: [],
        comments: [
            new DocumentCommentModel({
                documentId: document.id,
                commentThreadId,
                index: 0,
                version: 0,
                author: await getAccount(session1.action(), space.id, session1.account.id),
                createdTime: expect.any(Date),
                createdTimeZone: defaultTimeZone,
                payload: {
                    type: "Content",
                    parent: null,
                    content: {
                        doc: createSimpleMessageContent("Test message content 1"),
                        references: emptyContentReferences,
                    },
                    contentUpdate: null,
                    files: [
                        {
                            type: "File",
                            signedUrlSearch: expect.any(String),
                            file: new FileModel({
                                id: file1Id,
                                spaceId: space.id,
                                contentType: "image/png",
                                contentLength: 5232,
                                isUploading: false,
                                alternative: null,
                                analysis: testFileAnalysis,
                                transcript: null,
                                preview: expect.any(Object),
                            }),
                        },
                        {
                            type: "File",
                            signedUrlSearch: expect.any(String),
                            file: new FileModel({
                                id: file2Id,
                                spaceId: space.id,
                                contentType: "image/png",
                                contentLength: 5232,
                                isUploading: false,
                                alternative: null,
                                analysis: testFileAnalysis,
                                transcript: null,
                                preview: expect.any(Object),
                            }),
                        },
                    ],
                    reactionsByPos: emptyMap,
                    filesReactions: emptyReactionSet,
                },
                stream: null,
            }),
        ],
    });

    unpause();
    await waitForPersistence(connection1, 2);

    expect(
        await getDocumentComment(session1.action(), {
            documentId: document.id,
            commentThreadId,
            commentIndex: 0,
        }),
    ).not.toBeNull();

    expect(connection1.takeEvents()).toEqual([
        {
            type: "PersistedContent",
            newVersion: 2,
            updatedCommentThreads: [],
        },
    ]);

    expect(connection2.takeEvents()).toEqual([
        {
            type: "PersistedContent",
            newVersion: 2,
            updatedCommentThreads: [],
        },
    ]);

    expect(
        await connection1.procedures.getCommentsFromStart({
            commentThreadId,
            limit: 10,
            afterCommentIndex: null,
            beforeCommentIndex: null,
        }),
    ).toEqual({
        commentCount: 1,
        otherReferencedComments: [],
        comments: [
            new DocumentCommentModel({
                documentId: document.id,
                commentThreadId,
                index: 0,
                version: 0,
                author: await getAccount(session1.action(), space.id, session1.account.id),
                createdTime: expect.any(Date),
                createdTimeZone: defaultTimeZone,
                payload: {
                    type: "Content",
                    parent: null,
                    content: {
                        doc: createSimpleMessageContent("Test message content 1"),
                        references: emptyContentReferences,
                    },
                    contentUpdate: null,
                    files: [
                        {
                            type: "File",
                            signedUrlSearch: expect.any(String),
                            file: new FileModel({
                                id: file1Id,
                                spaceId: space.id,
                                contentType: "image/png",
                                contentLength: 5232,
                                isUploading: false,
                                alternative: null,
                                analysis: testFileAnalysis,
                                transcript: null,
                                preview: expect.any(Object),
                            }),
                        },
                        {
                            type: "File",
                            signedUrlSearch: expect.any(String),
                            file: new FileModel({
                                id: file2Id,
                                spaceId: space.id,
                                contentType: "image/png",
                                contentLength: 5232,
                                isUploading: false,
                                alternative: null,
                                analysis: testFileAnalysis,
                                transcript: null,
                                preview: expect.any(Object),
                            }),
                        },
                    ],
                    reactionsByPos: emptyMap,
                    filesReactions: emptyReactionSet,
                },
                stream: null,
            }),
        ],
    });

    expect(
        await connection2.procedures.getCommentsFromStart({
            commentThreadId,
            limit: 10,
            afterCommentIndex: null,
            beforeCommentIndex: null,
        }),
    ).toEqual({
        commentCount: 1,
        otherReferencedComments: [],
        comments: [
            new DocumentCommentModel({
                documentId: document.id,
                commentThreadId,
                index: 0,
                version: 0,
                author: await getAccount(session1.action(), space.id, session1.account.id),
                createdTime: expect.any(Date),
                createdTimeZone: defaultTimeZone,
                payload: {
                    type: "Content",
                    parent: null,
                    content: {
                        doc: createSimpleMessageContent("Test message content 1"),
                        references: emptyContentReferences,
                    },
                    contentUpdate: null,
                    files: [
                        {
                            type: "File",
                            signedUrlSearch: expect.any(String),
                            file: new FileModel({
                                id: file1Id,
                                spaceId: space.id,
                                contentType: "image/png",
                                contentLength: 5232,
                                isUploading: false,
                                alternative: null,
                                analysis: testFileAnalysis,
                                transcript: null,
                                preview: expect.any(Object),
                            }),
                        },
                        {
                            type: "File",
                            signedUrlSearch: expect.any(String),
                            file: new FileModel({
                                id: file2Id,
                                spaceId: space.id,
                                contentType: "image/png",
                                contentLength: 5232,
                                isUploading: false,
                                alternative: null,
                                analysis: testFileAnalysis,
                                transcript: null,
                                preview: expect.any(Object),
                            }),
                        },
                    ],
                    reactionsByPos: emptyMap,
                    filesReactions: emptyReactionSet,
                },
                stream: null,
            }),
        ],
    });
});

test("when comment threads are added back to the document they will be loaded", async () => {
    const space = await TestSpace.create(context);
    const [session1, session2, session3] = await space.createSessions(3);

    const document = await TestDocument.create(session1, {
        access: {
            type: "Local",
            accountGrantById: new Map([[session1.account.id, {level: "Manage", generation: 0}]]),
            defaultGrant: {level: "Manage", generation: 1},
            urlGrant: null,
        },
    });

    await updateDocumentContent(session1.action(), {
        id: document.id,
        version: 0,
        steps: [new ReplaceStep(3, 3, textSlice("Hello, world!"))],
        clientId: generateId(),
    });

    const commentThreadId = generateId<DocumentCommentThreadId>();

    await updateDocumentContent(session1.action(), {
        id: document.id,
        version: 1,
        steps: [new AddMarkStep(10, 15, schema.mark("comment", {commentThreadId}))],
        clientId: generateId(),
        createCommentThreads: [
            {
                commentThreadId,
                initialCommentContent: createSimpleMessageContent("Test message content 1"),
                initialCommentFileIds: [],
                createdTimeZone: defaultTimeZone,
            },
        ],
    });

    await createDocumentComment(session3.action(), {
        documentId: document.id,
        commentThreadId,
        parent: null,
        content: createSimpleMessageContent("Test message content 2"),
        fileIds: [],
        createdTimeZone: defaultTimeZone,
    });

    await updateDocumentContent(session1.action(), {
        id: document.id,
        version: 2,
        steps: [new RemoveMarkStep(10, 15, schema.mark("comment", {commentThreadId}))],
        clientId: generateId(),
    });

    const client1Id = generateId<ContentEditorClientId>();
    const connection1 = await connectForTest(context.action(session1), document.id);
    const connection2 = await connectForTest(context.action(session2), document.id);

    await connection1.procedures.backfill({
        version: 0,
    });

    await connection2.procedures.backfill({
        version: 0,
    });

    await connection1.procedures.updateContent({
        version: 3,
        steps: [new AddMarkStep(10, 15, schema.mark("comment", {commentThreadId}))],
        clientId: client1Id,
        createCommentThreads: [],
        intentionallyUpdateAccessPolicy: null,
        updateOurPresenceState: {state: null},
    });

    await waitForPersistence(connection1, 4);

    expect(
        // Message order is not deterministic. We do not delay persistence on loading data
        // necessary from the database.
        connection1.takeEvents().sort((a, b) => defaultCompareStrings(a.type, b.type)),
    ).toEqual([
        {
            type: "PersistedContent",
            newVersion: 4,
            updatedCommentThreads: [],
        },
        {
            type: "UpdateContentWithoutPersistence",
            newVersion: 4,
            steps: [new AddMarkStep(10, 15, schema.mark("comment", {commentThreadId}))],
            stepsContentReferences: {
                ...emptyDocumentContentReferences,
                commentThreadById: new Map([
                    [
                        commentThreadId,
                        {
                            commentCount: 2,
                            commentAuthors: [
                                await getAccount(session1.action(), space.id, session1.account.id),
                                await getAccount(session3.action(), space.id, session3.account.id),
                            ],
                        },
                    ],
                ]),
            },
            clientId: client1Id,
            updateOtherPresenceState: {connectionId: connection1.id, state: null},
            resolveCommentThreadIds: [],
            unresolveCommentThreadIds: [],
        },
    ]);

    expect(
        // Message order is not deterministic. We do not delay persistence on loading data
        // necessary from the database.
        connection2.takeEvents().sort((a, b) => defaultCompareStrings(a.type, b.type)),
    ).toEqual([
        {
            type: "PersistedContent",
            newVersion: 4,
            updatedCommentThreads: [],
        },
        {
            type: "UpdateContentWithoutPersistence",
            newVersion: 4,
            steps: [new AddMarkStep(10, 15, schema.mark("comment", {commentThreadId}))],
            stepsContentReferences: {
                ...emptyDocumentContentReferences,
                commentThreadById: new Map([
                    [
                        commentThreadId,
                        {
                            commentCount: 2,
                            commentAuthors: [
                                await getAccount(session1.action(), space.id, session1.account.id),
                                await getAccount(session3.action(), space.id, session3.account.id),
                            ],
                        },
                    ],
                ]),
            },
            clientId: client1Id,
            updateOtherPresenceState: {connectionId: connection1.id, state: null},
            resolveCommentThreadIds: [],
            unresolveCommentThreadIds: [],
        },
    ]);
});

test("comment thread can be optimistic at first and then loaded from the database", async () => {
    const space = await TestSpace.create(context);
    const [session1, session2, session3] = await space.createSessions(3);

    const document = await TestDocument.create(session1, {
        access: {
            type: "Local",
            accountGrantById: new Map([[session1.account.id, {level: "Manage", generation: 0}]]),
            defaultGrant: {level: "Manage", generation: 1},
            urlGrant: null,
        },
    });

    await updateDocumentContent(session1.action(), {
        id: document.id,
        version: 0,
        steps: [new ReplaceStep(3, 3, textSlice("Hello, world!"))],
        clientId: generateId(),
    });

    const commentThreadId = generateId<DocumentCommentThreadId>();

    const client1Id = generateId<ContentEditorClientId>();
    const connection1 = await connectForTest(context.action(session1), document.id);
    const connection2 = await connectForTest(context.action(session2), document.id);

    await connection1.procedures.backfill({
        version: 0,
    });

    await connection2.procedures.backfill({
        version: 0,
    });

    await connection1.procedures.updateContent({
        version: 1,
        steps: [new AddMarkStep(10, 15, schema.mark("comment", {commentThreadId}))],
        clientId: client1Id,
        createCommentThreads: [
            {
                commentThreadId,
                initialCommentContent: createSimpleMessageContent("Test message content 1"),
                initialCommentFileIds: [],
                createdTimeZone: defaultTimeZone,
            },
        ],
        intentionallyUpdateAccessPolicy: null,
        updateOurPresenceState: {state: null},
    });

    await waitForPersistence(connection1, 2);

    await createDocumentComment(session3.action(), {
        documentId: document.id,
        commentThreadId,
        parent: null,
        content: createSimpleMessageContent("Test message content 2"),
        fileIds: [],
        createdTimeZone: defaultTimeZone,
    });

    await connection1.procedures.updateContent({
        version: 2,
        steps: [new RemoveMarkStep(10, 15, schema.mark("comment", {commentThreadId}))],
        clientId: client1Id,
        createCommentThreads: [],
        intentionallyUpdateAccessPolicy: null,
        updateOurPresenceState: {state: null},
    });

    await waitForPersistence(connection1, 3);

    await connection1.procedures.updateContent({
        version: 3,
        steps: [new AddMarkStep(10, 15, schema.mark("comment", {commentThreadId}))],
        clientId: client1Id,
        createCommentThreads: [],
        intentionallyUpdateAccessPolicy: null,
        updateOurPresenceState: {state: null},
    });

    await waitForPersistence(connection1, 4);

    expect(
        // Message order is not deterministic. We do not delay persistence on loading data
        // necessary from the database.
        connection1.takeEvents().sort((a, b) => defaultCompareStrings(a.type, b.type)),
    ).toEqual([
        {
            type: "PersistedContent",
            newVersion: 2,
            updatedCommentThreads: [],
        },
        {
            type: "PersistedContent",
            newVersion: 3,
            updatedCommentThreads: [],
        },
        {
            type: "PersistedContent",
            newVersion: 4,
            updatedCommentThreads: [],
        },
        {
            type: "UpdateContentWithoutPersistence",
            newVersion: 2,
            steps: [new AddMarkStep(10, 15, schema.mark("comment", {commentThreadId}))],
            stepsContentReferences: {
                ...emptyDocumentContentReferences,
                commentThreadById: new Map([
                    [
                        commentThreadId,
                        {
                            commentCount: 1,
                            commentAuthors: [
                                await getAccount(session1.action(), space.id, session1.account.id),
                            ],
                        },
                    ],
                ]),
            },
            clientId: client1Id,
            updateOtherPresenceState: {connectionId: connection1.id, state: null},
            resolveCommentThreadIds: [],
            unresolveCommentThreadIds: [],
        },
        {
            type: "UpdateContentWithoutPersistence",
            newVersion: 3,
            steps: [new RemoveMarkStep(10, 15, schema.mark("comment", {commentThreadId}))],
            stepsContentReferences: emptyDocumentContentReferences,
            clientId: client1Id,
            updateOtherPresenceState: {connectionId: connection1.id, state: null},
            resolveCommentThreadIds: [],
            unresolveCommentThreadIds: [],
        },
        {
            type: "UpdateContentWithoutPersistence",
            newVersion: 4,
            steps: [new AddMarkStep(10, 15, schema.mark("comment", {commentThreadId}))],
            stepsContentReferences: {
                ...emptyDocumentContentReferences,
                commentThreadById: new Map([
                    [
                        commentThreadId,
                        {
                            commentCount: 2,
                            commentAuthors: [
                                await getAccount(session1.action(), space.id, session1.account.id),
                                await getAccount(session3.action(), space.id, session3.account.id),
                            ],
                        },
                    ],
                ]),
            },
            clientId: client1Id,
            updateOtherPresenceState: {connectionId: connection1.id, state: null},
            resolveCommentThreadIds: [],
            unresolveCommentThreadIds: [],
        },
    ]);

    expect(
        // Message order is not deterministic. We do not delay persistence on loading data
        // necessary from the database.
        connection2.takeEvents().sort((a, b) => defaultCompareStrings(a.type, b.type)),
    ).toEqual([
        {
            type: "PersistedContent",
            newVersion: 2,
            updatedCommentThreads: [],
        },
        {
            type: "PersistedContent",
            newVersion: 3,
            updatedCommentThreads: [],
        },
        {
            type: "PersistedContent",
            newVersion: 4,
            updatedCommentThreads: [],
        },
        {
            type: "UpdateContentWithoutPersistence",
            newVersion: 2,
            steps: [new AddMarkStep(10, 15, schema.mark("comment", {commentThreadId}))],
            stepsContentReferences: {
                ...emptyDocumentContentReferences,
                commentThreadById: new Map([
                    [
                        commentThreadId,
                        {
                            commentCount: 1,
                            commentAuthors: [
                                await getAccount(session1.action(), space.id, session1.account.id),
                            ],
                        },
                    ],
                ]),
            },
            clientId: client1Id,
            updateOtherPresenceState: {connectionId: connection1.id, state: null},
            resolveCommentThreadIds: [],
            unresolveCommentThreadIds: [],
        },
        {
            type: "UpdateContentWithoutPersistence",
            newVersion: 3,
            steps: [new RemoveMarkStep(10, 15, schema.mark("comment", {commentThreadId}))],
            stepsContentReferences: emptyDocumentContentReferences,
            clientId: client1Id,
            updateOtherPresenceState: {connectionId: connection1.id, state: null},
            resolveCommentThreadIds: [],
            unresolveCommentThreadIds: [],
        },
        {
            type: "UpdateContentWithoutPersistence",
            newVersion: 4,
            steps: [new AddMarkStep(10, 15, schema.mark("comment", {commentThreadId}))],
            stepsContentReferences: {
                ...emptyDocumentContentReferences,
                commentThreadById: new Map([
                    [
                        commentThreadId,
                        {
                            commentCount: 2,
                            commentAuthors: [
                                await getAccount(session1.action(), space.id, session1.account.id),
                                await getAccount(session3.action(), space.id, session3.account.id),
                            ],
                        },
                    ],
                ]),
            },
            clientId: client1Id,
            updateOtherPresenceState: {connectionId: connection1.id, state: null},
            resolveCommentThreadIds: [],
            unresolveCommentThreadIds: [],
        },
    ]);
});

test("can create comments in comment threads", async () => {
    const space = await TestSpace.create(context);
    const [session1, session2] = await space.createSessions(2);

    const document = await TestDocument.create(session1, {
        access: {
            type: "Local",
            accountGrantById: new Map([[session1.account.id, {level: "Manage", generation: 0}]]),
            defaultGrant: {level: "Manage", generation: 1},
            urlGrant: null,
        },
    });

    await updateDocumentContent(session1.action(), {
        id: document.id,
        version: 0,
        steps: [new ReplaceStep(3, 3, textSlice("Hello, world!"))],
        clientId: generateId(),
    });

    const commentThreadId = generateId<DocumentCommentThreadId>();

    const client1Id = generateId<ContentEditorClientId>();
    const connection1 = await connectForTest(context.action(session1), document.id);
    const connection2 = await connectForTest(context.action(session2), document.id);

    await connection1.procedures.backfill({
        version: 0,
    });

    await connection2.procedures.backfill({
        version: 0,
    });

    await expect(
        connection1.procedures.createComment({
            commentThreadId,
            parent: null,
            content: createSimpleMessageContent("Test message content 2"),
            fileIds: [],
            createdTimeZone: defaultTimeZone,
        }),
    ).rejects.toThrow(NotFoundError);

    await connection1.procedures.updateContent({
        version: 1,
        steps: [new AddMarkStep(10, 15, schema.mark("comment", {commentThreadId}))],
        clientId: client1Id,
        createCommentThreads: [
            {
                commentThreadId,
                initialCommentContent: createSimpleMessageContent("Test message content 1"),
                initialCommentFileIds: [],
                createdTimeZone: defaultTimeZone,
            },
        ],
        intentionallyUpdateAccessPolicy: null,
        updateOurPresenceState: {state: null},
    });

    await waitForPersistence(connection1, 2);

    expect(
        // Message order is not deterministic. We do not delay persistence on loading data
        // necessary from the database.
        connection1.takeEvents().sort((a, b) => defaultCompareStrings(a.type, b.type)),
    ).toEqual([
        {
            type: "PersistedContent",
            newVersion: 2,
            updatedCommentThreads: [],
        },
        {
            type: "UpdateContentWithoutPersistence",
            newVersion: 2,
            steps: [new AddMarkStep(10, 15, schema.mark("comment", {commentThreadId}))],
            stepsContentReferences: {
                ...emptyDocumentContentReferences,
                commentThreadById: new Map([
                    [
                        commentThreadId,
                        {
                            commentCount: 1,
                            commentAuthors: [
                                await getAccount(session1.action(), space.id, session1.account.id),
                            ],
                        },
                    ],
                ]),
            },
            clientId: client1Id,
            updateOtherPresenceState: {connectionId: connection1.id, state: null},
            resolveCommentThreadIds: [],
            unresolveCommentThreadIds: [],
        },
    ]);

    expect(
        // Message order is not deterministic. We do not delay persistence on loading data
        // necessary from the database.
        connection2.takeEvents().sort((a, b) => defaultCompareStrings(a.type, b.type)),
    ).toEqual([
        {
            type: "PersistedContent",
            newVersion: 2,
            updatedCommentThreads: [],
        },
        {
            type: "UpdateContentWithoutPersistence",
            newVersion: 2,
            steps: [new AddMarkStep(10, 15, schema.mark("comment", {commentThreadId}))],
            stepsContentReferences: {
                ...emptyDocumentContentReferences,
                commentThreadById: new Map([
                    [
                        commentThreadId,
                        {
                            commentCount: 1,
                            commentAuthors: [
                                await getAccount(session1.action(), space.id, session1.account.id),
                            ],
                        },
                    ],
                ]),
            },
            clientId: client1Id,
            updateOtherPresenceState: {connectionId: connection1.id, state: null},
            resolveCommentThreadIds: [],
            unresolveCommentThreadIds: [],
        },
    ]);

    await connection1.procedures.backfillComments({
        commentThreadId,
        checkpoint: generateServerSynchronizationCheckpoint(),
        clientCommentCount: 0,
        newCommentLimit: 100,
    });

    await connection2.procedures.backfillComments({
        commentThreadId,
        checkpoint: generateServerSynchronizationCheckpoint(),
        clientCommentCount: 0,
        newCommentLimit: 100,
    });

    await ProcessContextModule.waitForTestTasks();

    expect(connection1.takeEvents()).toEqual([]);
    expect(connection2.takeEvents()).toEqual([]);

    await connection1.procedures.createComment({
        commentThreadId,
        parent: null,
        content: createSimpleMessageContent("Test message content 2"),
        fileIds: [],
        createdTimeZone: defaultTimeZone,
    });

    await ProcessContextModule.waitForTestTasks();

    expect(connection1.takeEvents()).toEqual([
        {
            type: "Comments",
            commentThreadId,
            event: {
                type: "NewMessage",
                message: new DocumentCommentModel({
                    documentId: document.id,
                    commentThreadId,
                    index: 1,
                    version: 0,
                    author: await getAccount(session1.action(), space.id, session1.account.id),
                    createdTime: expect.any(Date),
                    createdTimeZone: defaultTimeZone,
                    payload: {
                        type: "Content",
                        parent: null,
                        content: {
                            doc: createSimpleMessageContent("Test message content 2"),
                            references: emptyContentReferences,
                        },
                        contentUpdate: null,
                        files: [],
                        reactionsByPos: emptyMap,
                        filesReactions: emptyReactionSet,
                    },
                    stream: null,
                }),
                updateOtherTypingState: null,
            },
        },
    ]);

    expect(connection2.takeEvents()).toEqual([
        {
            type: "Comments",
            commentThreadId,
            event: {
                type: "NewMessage",
                message: new DocumentCommentModel({
                    documentId: document.id,
                    commentThreadId,
                    index: 1,
                    version: 0,
                    author: await getAccount(session1.action(), space.id, session1.account.id),
                    createdTime: expect.any(Date),
                    createdTimeZone: defaultTimeZone,
                    payload: {
                        type: "Content",
                        parent: null,
                        content: {
                            doc: createSimpleMessageContent("Test message content 2"),
                            references: emptyContentReferences,
                        },
                        contentUpdate: null,
                        files: [],
                        reactionsByPos: emptyMap,
                        filesReactions: emptyReactionSet,
                    },
                    stream: null,
                }),
                updateOtherTypingState: null,
            },
        },
    ]);

    expect(
        await connection1.procedures.backfillComments({
            commentThreadId,
            checkpoint: generateServerSynchronizationCheckpoint(),
            clientCommentCount: 1,
            newCommentLimit: 100,
        }),
    ).toEqual({
        commentThread: new DocumentCommentThreadModel({
            id: commentThreadId,
            documentId: document.id,
            createdTime: expect.any(Date),
            version: 1,
            fallbackContentSnippet: null,
            isResolved: false,
            commentCount: 2,
            firstCommentAuthor: await getAccount(session1.action(), space.id, session1.account.id),
        }),
        commentCount: 2,
        newComments: [
            new DocumentCommentModel({
                documentId: document.id,
                commentThreadId,
                index: 1,
                version: 0,
                author: await getAccount(session1.action(), space.id, session1.account.id),
                createdTime: expect.any(Date),
                createdTimeZone: defaultTimeZone,
                payload: {
                    type: "Content",
                    parent: null,
                    content: {
                        doc: createSimpleMessageContent("Test message content 2"),
                        references: emptyContentReferences,
                    },
                    contentUpdate: null,
                    files: [],
                    reactionsByPos: emptyMap,
                    filesReactions: emptyReactionSet,
                },
                stream: null,
            }),
        ],
        newOtherReferencedComments: [],
        commentUpdatesResult: {
            type: "Available",
            checkpoint: expect.any(Date),
            messages: [],
        },
        typingStateByConnectionId: new Map(),
    });

    expect(
        await connection2.procedures.backfillComments({
            commentThreadId,
            checkpoint: generateServerSynchronizationCheckpoint(),
            clientCommentCount: 0,
            newCommentLimit: 100,
        }),
    ).toEqual({
        commentThread: new DocumentCommentThreadModel({
            id: commentThreadId,
            documentId: document.id,
            createdTime: expect.any(Date),
            version: 1,
            fallbackContentSnippet: null,
            isResolved: false,
            commentCount: 2,
            firstCommentAuthor: await getAccount(session1.action(), space.id, session1.account.id),
        }),
        commentCount: 2,
        newComments: [
            new DocumentCommentModel({
                documentId: document.id,
                commentThreadId,
                index: 0,
                version: 0,
                author: await getAccount(session1.action(), space.id, session1.account.id),
                createdTime: expect.any(Date),
                createdTimeZone: defaultTimeZone,
                payload: {
                    type: "Content",
                    parent: null,
                    content: {
                        doc: createSimpleMessageContent("Test message content 1"),
                        references: emptyContentReferences,
                    },
                    contentUpdate: null,
                    files: [],
                    reactionsByPos: emptyMap,
                    filesReactions: emptyReactionSet,
                },
                stream: null,
            }),
            new DocumentCommentModel({
                documentId: document.id,
                commentThreadId,
                index: 1,
                version: 0,
                author: await getAccount(session1.action(), space.id, session1.account.id),
                createdTime: expect.any(Date),
                createdTimeZone: defaultTimeZone,
                payload: {
                    type: "Content",
                    parent: null,
                    content: {
                        doc: createSimpleMessageContent("Test message content 2"),
                        references: emptyContentReferences,
                    },
                    contentUpdate: null,
                    files: [],
                    reactionsByPos: emptyMap,
                    filesReactions: emptyReactionSet,
                },
                stream: null,
            }),
        ],
        newOtherReferencedComments: [],
        commentUpdatesResult: {
            type: "Available",
            checkpoint: expect.any(Date),
            messages: [],
        },
        typingStateByConnectionId: new Map(),
    });

    expect(connection1.takeEvents()).toEqual([]);

    expect(connection2.takeEvents()).toEqual([]);

    await connection1.procedures.createComment({
        commentThreadId,
        parent: null,
        content: createSimpleMessageContent("Test message content 3"),
        fileIds: [],
        createdTimeZone: defaultTimeZone,
    });

    await ProcessContextModule.waitForTestTasks();

    expect(connection1.takeEvents()).toEqual([
        {
            type: "Comments",
            commentThreadId,
            event: {
                type: "NewMessage",
                message: new DocumentCommentModel({
                    documentId: document.id,
                    commentThreadId,
                    index: 2,
                    version: 0,
                    author: await getAccount(session1.action(), space.id, session1.account.id),
                    createdTime: expect.any(Date),
                    createdTimeZone: defaultTimeZone,
                    payload: {
                        type: "Content",
                        parent: null,
                        content: {
                            doc: createSimpleMessageContent("Test message content 3"),
                            references: emptyContentReferences,
                        },
                        contentUpdate: null,
                        files: [],
                        reactionsByPos: emptyMap,
                        filesReactions: emptyReactionSet,
                    },
                    stream: null,
                }),
                updateOtherTypingState: null,
            },
        },
    ]);

    expect(connection2.takeEvents()).toEqual([
        {
            type: "Comments",
            commentThreadId,
            event: {
                type: "NewMessage",
                message: new DocumentCommentModel({
                    documentId: document.id,
                    commentThreadId,
                    index: 2,
                    version: 0,
                    author: await getAccount(session1.action(), space.id, session1.account.id),
                    createdTime: expect.any(Date),
                    createdTimeZone: defaultTimeZone,
                    payload: {
                        type: "Content",
                        parent: null,
                        content: {
                            doc: createSimpleMessageContent("Test message content 3"),
                            references: emptyContentReferences,
                        },
                        contentUpdate: null,
                        files: [],
                        reactionsByPos: emptyMap,
                        filesReactions: emptyReactionSet,
                    },
                    stream: null,
                }),
                updateOtherTypingState: null,
            },
        },
    ]);
});

test("if comment thread is persisting we will wait to create messages but respond to backfill requests", async () => {
    const space = await TestSpace.create(context);
    const [session1, session2] = await space.createSessions(2);

    const document = await TestDocument.create(session1, {
        access: {
            type: "Local",
            accountGrantById: new Map([[session1.account.id, {level: "Manage", generation: 0}]]),
            defaultGrant: {level: "Manage", generation: 1},
            urlGrant: null,
        },
    });

    await updateDocumentContent(session1.action(), {
        id: document.id,
        version: 0,
        steps: [new ReplaceStep(3, 3, textSlice("Hello, world!"))],
        clientId: generateId(),
    });

    const commentThreadId = generateId<DocumentCommentThreadId>();

    const client1Id = generateId<ContentEditorClientId>();
    const connection1 = await connectForTest(context.action(session1), document.id);
    const connection2 = await connectForTest(context.action(session2), document.id);

    await connection1.procedures.backfill({
        version: 0,
    });

    await connection2.procedures.backfill({
        version: 0,
    });

    await expect(
        connection1.procedures.createComment({
            commentThreadId,
            parent: null,
            content: createSimpleMessageContent("Test message content 2"),
            fileIds: [],
            createdTimeZone: defaultTimeZone,
        }),
    ).rejects.toThrow(NotFoundError);

    const pausePromise =
        documentCollaborationContentManagerBeforePersist2TestCheckpoint.pauseForTest(document.id);

    await connection1.procedures.updateContent({
        version: 1,
        steps: [new AddMarkStep(10, 15, schema.mark("comment", {commentThreadId}))],
        clientId: client1Id,
        createCommentThreads: [
            {
                commentThreadId,
                initialCommentContent: createSimpleMessageContent("Test message content 1"),
                initialCommentFileIds: [],
                createdTimeZone: defaultTimeZone,
            },
        ],
        intentionallyUpdateAccessPolicy: null,
        updateOurPresenceState: {state: null},
    });

    const {unpause} = await pausePromise;

    expect(connection1.takeEvents()).toEqual([
        {
            type: "UpdateContentWithoutPersistence",
            newVersion: 2,
            steps: [new AddMarkStep(10, 15, schema.mark("comment", {commentThreadId}))],
            stepsContentReferences: {
                ...emptyDocumentContentReferences,
                commentThreadById: new Map([
                    [
                        commentThreadId,
                        {
                            commentCount: 1,
                            commentAuthors: [
                                await getAccount(session1.action(), space.id, session1.account.id),
                            ],
                        },
                    ],
                ]),
            },
            clientId: client1Id,
            updateOtherPresenceState: {connectionId: connection1.id, state: null},
            resolveCommentThreadIds: [],
            unresolveCommentThreadIds: [],
        },
    ]);

    expect(connection2.takeEvents()).toEqual([
        {
            type: "UpdateContentWithoutPersistence",
            newVersion: 2,
            steps: [new AddMarkStep(10, 15, schema.mark("comment", {commentThreadId}))],
            stepsContentReferences: {
                ...emptyDocumentContentReferences,
                commentThreadById: new Map([
                    [
                        commentThreadId,
                        {
                            commentCount: 1,
                            commentAuthors: [
                                await getAccount(session1.action(), space.id, session1.account.id),
                            ],
                        },
                    ],
                ]),
            },
            clientId: client1Id,
            updateOtherPresenceState: {connectionId: connection1.id, state: null},
            resolveCommentThreadIds: [],
            unresolveCommentThreadIds: [],
        },
    ]);

    const createMessagePromise = connection2.procedures.createComment({
        commentThreadId,
        parent: null,
        content: createSimpleMessageContent("Test message content 2"),
        fileIds: [],
        createdTimeZone: defaultTimeZone,
    });

    expect(connection1.takeEvents()).toEqual([]);
    expect(connection2.takeEvents()).toEqual([]);

    expect(
        await connection1.procedures.backfillComments({
            commentThreadId,
            checkpoint: generateServerSynchronizationCheckpoint(),
            clientCommentCount: 1,
            newCommentLimit: 100,
        }),
    ).toEqual({
        commentThread: new DocumentCommentThreadModel({
            id: commentThreadId,
            documentId: document.id,
            createdTime: expect.any(Date),
            version: 0,
            fallbackContentSnippet: null,
            isResolved: false,
            commentCount: 1,
            firstCommentAuthor: await getAccount(session1.action(), space.id, session1.account.id),
        }),
        commentCount: 1,
        newComments: [],
        newOtherReferencedComments: [],
        commentUpdatesResult: {
            type: "Available",
            checkpoint: expect.any(Date),
            messages: [],
        },
        typingStateByConnectionId: new Map(),
    });

    expect(
        await connection2.procedures.backfillComments({
            commentThreadId,
            checkpoint: generateServerSynchronizationCheckpoint(),
            clientCommentCount: 0,
            newCommentLimit: 100,
        }),
    ).toEqual({
        commentThread: new DocumentCommentThreadModel({
            id: commentThreadId,
            documentId: document.id,
            createdTime: expect.any(Date),
            version: 0,
            fallbackContentSnippet: null,
            isResolved: false,
            commentCount: 1,
            firstCommentAuthor: await getAccount(session1.action(), space.id, session1.account.id),
        }),
        commentCount: 1,
        newComments: [
            new DocumentCommentModel({
                documentId: document.id,
                commentThreadId,
                index: 0,
                version: 0,
                author: await getAccount(session1.action(), space.id, session1.account.id),
                createdTime: expect.any(Date),
                createdTimeZone: defaultTimeZone,
                payload: {
                    type: "Content",
                    parent: null,
                    content: {
                        doc: createSimpleMessageContent("Test message content 1"),
                        references: emptyContentReferences,
                    },
                    contentUpdate: null,
                    files: [],
                    reactionsByPos: emptyMap,
                    filesReactions: emptyReactionSet,
                },
                stream: null,
            }),
        ],
        newOtherReferencedComments: [],
        commentUpdatesResult: {
            type: "Available",
            checkpoint: expect.any(Date),
            messages: [],
        },
        typingStateByConnectionId: new Map(),
    });

    expect(connection1.takeEvents()).toEqual([]);
    expect(connection2.takeEvents()).toEqual([]);

    unpause();
    await createMessagePromise;

    await ProcessContextModule.waitForTestTasks();

    expect(connection1.takeEvents()).toEqual([
        {
            type: "PersistedContent",
            newVersion: 2,
            updatedCommentThreads: [],
        },
        {
            type: "Comments",
            commentThreadId,
            event: {
                type: "NewMessage",
                message: new DocumentCommentModel({
                    documentId: document.id,
                    commentThreadId,
                    index: 1,
                    version: 0,
                    author: await getAccount(session2.action(), space.id, session2.account.id),
                    createdTime: expect.any(Date),
                    createdTimeZone: defaultTimeZone,
                    payload: {
                        type: "Content",
                        parent: null,
                        content: {
                            doc: createSimpleMessageContent("Test message content 2"),
                            references: emptyContentReferences,
                        },
                        contentUpdate: null,
                        files: [],
                        reactionsByPos: emptyMap,
                        filesReactions: emptyReactionSet,
                    },
                    stream: null,
                }),
                updateOtherTypingState: null,
            },
        },
    ]);

    expect(connection2.takeEvents()).toEqual([
        {
            type: "PersistedContent",
            newVersion: 2,
            updatedCommentThreads: [],
        },
        {
            type: "Comments",
            commentThreadId,
            event: {
                type: "NewMessage",
                message: new DocumentCommentModel({
                    documentId: document.id,
                    commentThreadId,
                    index: 1,
                    version: 0,
                    author: await getAccount(session2.action(), space.id, session2.account.id),
                    createdTime: expect.any(Date),
                    createdTimeZone: defaultTimeZone,
                    payload: {
                        type: "Content",
                        parent: null,
                        content: {
                            doc: createSimpleMessageContent("Test message content 2"),
                            references: emptyContentReferences,
                        },
                        contentUpdate: null,
                        files: [],
                        reactionsByPos: emptyMap,
                        filesReactions: emptyReactionSet,
                    },
                    stream: null,
                }),
                updateOtherTypingState: null,
            },
        },
    ]);
});

test("if comment thread update message hasn\u2019t been processed we will wait to respond to backfill requests", async () => {
    const space = await TestSpace.create(context);
    const [session1, session2] = await space.createSessions(2);

    const document = await TestDocument.create(session1, {
        access: {
            type: "Local",
            accountGrantById: new Map([[session1.account.id, {level: "Manage", generation: 0}]]),
            defaultGrant: {level: "Manage", generation: 1},
            urlGrant: null,
        },
    });

    await updateDocumentContent(session1.action(), {
        id: document.id,
        version: 0,
        steps: [new ReplaceStep(3, 3, textSlice("Hello, world!"))],
        clientId: generateId(),
    });

    const commentThreadId = generateId<DocumentCommentThreadId>();

    const client1Id = generateId<ContentEditorClientId>();
    const connection1 = await connectForTest(context.action(session1), document.id);
    const connection2 = await connectForTest(context.action(session2), document.id);

    await connection1.procedures.backfill({
        version: 0,
    });

    await connection2.procedures.backfill({
        version: 0,
    });

    await expect(
        connection1.procedures.createComment({
            commentThreadId,
            parent: null,
            content: createSimpleMessageContent("Test message content 2"),
            fileIds: [],
            createdTimeZone: defaultTimeZone,
        }),
    ).rejects.toThrow(NotFoundError);

    const pausePromise1 =
        documentCollaborationContentManagerBeforeUpdateTestCheckpoint.pauseForTest(document.id);
    const pausePromise2 =
        documentCollaborationContentManagerBeforePersist2TestCheckpoint.pauseForTest(document.id);

    const updateMessagePromise = connection1.procedures.updateContent({
        version: 1,
        steps: [new AddMarkStep(10, 15, schema.mark("comment", {commentThreadId}))],
        clientId: client1Id,
        createCommentThreads: [
            {
                commentThreadId,
                initialCommentContent: createSimpleMessageContent("Test message content 1"),
                initialCommentFileIds: [],
                createdTimeZone: defaultTimeZone,
            },
        ],
        intentionallyUpdateAccessPolicy: null,
        updateOurPresenceState: {state: null},
    });

    const {unpause: unpause1} = await pausePromise1;

    expect(connection1.takeEvents()).toEqual([]);
    expect(connection2.takeEvents()).toEqual([]);

    const backfillMessagePromise = connection1.procedures.backfillComments({
        commentThreadId,
        checkpoint: generateServerSynchronizationCheckpoint(),
        clientCommentCount: 1,
        newCommentLimit: 100,
    });

    // NOTE(calebmer): This is a little janky but what we want to test is that
    // `backfillMessagePromise` waits for `updateMessagePromise` before processing. If
    // there's no async gap here then we immediately unpause `updateMessagePromise` and
    // can't observe whether `backfillMessagePromise` waited. I can't find a good place
    // to put a test checkpoint in the code to test this behavior so a fine option is
    // putting a timeout here and checking that we got no new messages.
    await wait(1000);

    expect(connection1.takeEvents()).toEqual([]);
    expect(connection2.takeEvents()).toEqual([]);

    unpause1();
    await updateMessagePromise;

    expect(connection1.takeEvents()).toEqual([
        {
            type: "UpdateContentWithoutPersistence",
            newVersion: 2,
            steps: [new AddMarkStep(10, 15, schema.mark("comment", {commentThreadId}))],
            stepsContentReferences: {
                ...emptyDocumentContentReferences,
                commentThreadById: new Map([
                    [
                        commentThreadId,
                        {
                            commentCount: 1,
                            commentAuthors: [
                                await getAccount(session1.action(), space.id, session1.account.id),
                            ],
                        },
                    ],
                ]),
            },
            clientId: client1Id,
            updateOtherPresenceState: {connectionId: connection1.id, state: null},
            resolveCommentThreadIds: [],
            unresolveCommentThreadIds: [],
        },
    ]);

    expect(connection2.takeEvents()).toEqual([
        {
            type: "UpdateContentWithoutPersistence",
            newVersion: 2,
            steps: [new AddMarkStep(10, 15, schema.mark("comment", {commentThreadId}))],
            stepsContentReferences: {
                ...emptyDocumentContentReferences,
                commentThreadById: new Map([
                    [
                        commentThreadId,
                        {
                            commentCount: 1,
                            commentAuthors: [
                                await getAccount(session1.action(), space.id, session1.account.id),
                            ],
                        },
                    ],
                ]),
            },
            clientId: client1Id,
            updateOtherPresenceState: {connectionId: connection1.id, state: null},
            resolveCommentThreadIds: [],
            unresolveCommentThreadIds: [],
        },
    ]);

    expect(await backfillMessagePromise).toEqual({
        commentThread: new DocumentCommentThreadModel({
            id: commentThreadId,
            documentId: document.id,
            createdTime: expect.any(Date),
            version: 0,
            fallbackContentSnippet: null,
            isResolved: false,
            commentCount: 1,
            firstCommentAuthor: await getAccount(session1.action(), space.id, session1.account.id),
        }),
        commentCount: 1,
        newComments: [],
        newOtherReferencedComments: [],
        commentUpdatesResult: {
            type: "Available",
            checkpoint: expect.any(Date),
            messages: [],
        },
        typingStateByConnectionId: new Map(),
    });

    const {unpause: unpause2} = await pausePromise2;

    expect(connection1.takeEvents()).toEqual([]);
    expect(connection2.takeEvents()).toEqual([]);

    expect(
        await connection2.procedures.backfillComments({
            commentThreadId,
            checkpoint: generateServerSynchronizationCheckpoint(),
            clientCommentCount: 0,
            newCommentLimit: 100,
        }),
    ).toEqual({
        commentThread: new DocumentCommentThreadModel({
            id: commentThreadId,
            documentId: document.id,
            createdTime: expect.any(Date),
            version: 0,
            fallbackContentSnippet: null,
            isResolved: false,
            commentCount: 1,
            firstCommentAuthor: await getAccount(session1.action(), space.id, session1.account.id),
        }),
        commentCount: 1,
        newComments: [
            new DocumentCommentModel({
                documentId: document.id,
                commentThreadId,
                index: 0,
                version: 0,
                author: await getAccount(session1.action(), space.id, session1.account.id),
                createdTime: expect.any(Date),
                createdTimeZone: defaultTimeZone,
                payload: {
                    type: "Content",
                    parent: null,
                    content: {
                        doc: createSimpleMessageContent("Test message content 1"),
                        references: emptyContentReferences,
                    },
                    contentUpdate: null,
                    files: [],
                    reactionsByPos: emptyMap,
                    filesReactions: emptyReactionSet,
                },
                stream: null,
            }),
        ],
        newOtherReferencedComments: [],
        commentUpdatesResult: {
            type: "Available",
            checkpoint: expect.any(Date),
            messages: [],
        },
        typingStateByConnectionId: new Map(),
    });

    const createMessagePromise = connection2.procedures.createComment({
        commentThreadId,
        parent: null,
        content: createSimpleMessageContent("Test message content 2"),
        fileIds: [],
        createdTimeZone: defaultTimeZone,
    });

    expect(connection1.takeEvents()).toEqual([]);
    expect(connection2.takeEvents()).toEqual([]);

    unpause2();
    await createMessagePromise;

    await ProcessContextModule.waitForTestTasks();

    expect(connection1.takeEvents()).toEqual([
        {
            type: "PersistedContent",
            newVersion: 2,
            updatedCommentThreads: [],
        },
        {
            type: "Comments",
            commentThreadId,
            event: {
                type: "NewMessage",
                message: new DocumentCommentModel({
                    documentId: document.id,
                    commentThreadId,
                    index: 1,
                    version: 0,
                    author: await getAccount(session2.action(), space.id, session2.account.id),
                    createdTime: expect.any(Date),
                    createdTimeZone: defaultTimeZone,
                    payload: {
                        type: "Content",
                        parent: null,
                        content: {
                            doc: createSimpleMessageContent("Test message content 2"),
                            references: emptyContentReferences,
                        },
                        contentUpdate: null,
                        files: [],
                        reactionsByPos: emptyMap,
                        filesReactions: emptyReactionSet,
                    },
                    stream: null,
                }),
                updateOtherTypingState: null,
            },
        },
    ]);

    expect(connection2.takeEvents()).toEqual([
        {
            type: "PersistedContent",
            newVersion: 2,
            updatedCommentThreads: [],
        },
        {
            type: "Comments",
            commentThreadId,
            event: {
                type: "NewMessage",
                message: new DocumentCommentModel({
                    documentId: document.id,
                    commentThreadId,
                    index: 1,
                    version: 0,
                    author: await getAccount(session2.action(), space.id, session2.account.id),
                    createdTime: expect.any(Date),
                    createdTimeZone: defaultTimeZone,
                    payload: {
                        type: "Content",
                        parent: null,
                        content: {
                            doc: createSimpleMessageContent("Test message content 2"),
                            references: emptyContentReferences,
                        },
                        contentUpdate: null,
                        files: [],
                        reactionsByPos: emptyMap,
                        filesReactions: emptyReactionSet,
                    },
                    stream: null,
                }),
                updateOtherTypingState: null,
            },
        },
    ]);
});

test("while comment thread is persisting we will respond to comment load requests", async () => {
    const space = await TestSpace.create(context);
    const [session1, session2] = await space.createSessions(2);

    const document = await TestDocument.create(session1, {
        access: {
            type: "Local",
            accountGrantById: new Map([[session1.account.id, {level: "Manage", generation: 0}]]),
            defaultGrant: {level: "Manage", generation: 1},
            urlGrant: null,
        },
    });

    await updateDocumentContent(session1.action(), {
        id: document.id,
        version: 0,
        steps: [new ReplaceStep(3, 3, textSlice("Hello, world!"))],
        clientId: generateId(),
    });

    const commentThreadId = generateId<DocumentCommentThreadId>();

    const client1Id = generateId<ContentEditorClientId>();
    const connection1 = await connectForTest(context.action(session1), document.id);
    const connection2 = await connectForTest(context.action(session2), document.id);

    await connection1.procedures.backfill({
        version: 0,
    });

    await connection2.procedures.backfill({
        version: 0,
    });

    await expect(
        connection1.procedures.createComment({
            commentThreadId,
            parent: null,
            content: createSimpleMessageContent("Test message content 2"),
            fileIds: [],
            createdTimeZone: defaultTimeZone,
        }),
    ).rejects.toThrow(NotFoundError);

    const pausePromise =
        documentCollaborationContentManagerBeforePersist2TestCheckpoint.pauseForTest(document.id);

    await connection1.procedures.updateContent({
        version: 1,
        steps: [new AddMarkStep(10, 15, schema.mark("comment", {commentThreadId}))],
        clientId: client1Id,
        createCommentThreads: [
            {
                commentThreadId,
                initialCommentContent: createSimpleMessageContent("Test message content 1"),
                initialCommentFileIds: [],
                createdTimeZone: defaultTimeZone,
            },
        ],
        intentionallyUpdateAccessPolicy: null,
        updateOurPresenceState: {state: null},
    });

    const {unpause} = await pausePromise;

    expect(connection1.takeEvents()).toEqual([
        {
            type: "UpdateContentWithoutPersistence",
            newVersion: 2,
            steps: [new AddMarkStep(10, 15, schema.mark("comment", {commentThreadId}))],
            stepsContentReferences: {
                ...emptyDocumentContentReferences,
                commentThreadById: new Map([
                    [
                        commentThreadId,
                        {
                            commentCount: 1,
                            commentAuthors: [
                                await getAccount(session1.action(), space.id, session1.account.id),
                            ],
                        },
                    ],
                ]),
            },
            clientId: client1Id,
            updateOtherPresenceState: {connectionId: connection1.id, state: null},
            resolveCommentThreadIds: [],
            unresolveCommentThreadIds: [],
        },
    ]);

    expect(connection2.takeEvents()).toEqual([
        {
            type: "UpdateContentWithoutPersistence",
            newVersion: 2,
            steps: [new AddMarkStep(10, 15, schema.mark("comment", {commentThreadId}))],
            stepsContentReferences: {
                ...emptyDocumentContentReferences,
                commentThreadById: new Map([
                    [
                        commentThreadId,
                        {
                            commentCount: 1,
                            commentAuthors: [
                                await getAccount(session1.action(), space.id, session1.account.id),
                            ],
                        },
                    ],
                ]),
            },
            clientId: client1Id,
            updateOtherPresenceState: {connectionId: connection1.id, state: null},
            resolveCommentThreadIds: [],
            unresolveCommentThreadIds: [],
        },
    ]);

    const {commentThread} = await connection1.procedures.getCommentThreadAndInitialCommentsIfExists(
        {
            commentThreadId,
            limit: 100,
        },
    );

    const {createdTime} = assertExists(commentThread);

    expect(
        await connection1.procedures.getCommentThreadAndInitialCommentsIfExists({
            commentThreadId,
            limit: 100,
        }),
    ).toEqual({
        checkpoint: expect.any(Date),
        commentThread: new DocumentCommentThreadModel({
            id: commentThreadId,
            documentId: document.id,
            createdTime,
            version: 0,
            fallbackContentSnippet: null,
            isResolved: false,
            commentCount: 1,
            firstCommentAuthor: await getAccount(session1.action(), space.id, session1.account.id),
        }),
        initialComments: [
            new DocumentCommentModel({
                documentId: document.id,
                commentThreadId,
                index: 0,
                version: 0,
                author: await getAccount(session1.action(), space.id, session1.account.id),
                createdTime,
                createdTimeZone: defaultTimeZone,
                payload: {
                    type: "Content",
                    parent: null,
                    content: {
                        doc: createSimpleMessageContent("Test message content 1"),
                        references: emptyContentReferences,
                    },
                    contentUpdate: null,
                    files: [],
                    reactionsByPos: emptyMap,
                    filesReactions: emptyReactionSet,
                },
                stream: null,
            }),
        ],
        initialOtherReferencedComments: [],
    });

    expect(
        await connection2.procedures.getCommentThreadAndInitialCommentsIfExists({
            commentThreadId,
            limit: 100,
        }),
    ).toEqual({
        checkpoint: expect.any(Date),
        commentThread: new DocumentCommentThreadModel({
            id: commentThreadId,
            documentId: document.id,
            createdTime,
            version: 0,
            fallbackContentSnippet: null,
            isResolved: false,
            commentCount: 1,
            firstCommentAuthor: await getAccount(session1.action(), space.id, session1.account.id),
        }),
        initialComments: [
            new DocumentCommentModel({
                documentId: document.id,
                commentThreadId,
                index: 0,
                version: 0,
                author: await getAccount(session1.action(), space.id, session1.account.id),
                createdTime,
                createdTimeZone: defaultTimeZone,
                payload: {
                    type: "Content",
                    parent: null,
                    content: {
                        doc: createSimpleMessageContent("Test message content 1"),
                        references: emptyContentReferences,
                    },
                    contentUpdate: null,
                    files: [],
                    reactionsByPos: emptyMap,
                    filesReactions: emptyReactionSet,
                },
                stream: null,
            }),
        ],
        initialOtherReferencedComments: [],
    });

    expect(
        await connection1.procedures.getCommentThreadAndInitialCommentsIfExists({
            commentThreadId,
            limit: 0,
        }),
    ).toEqual({
        checkpoint: expect.any(Date),
        commentThread: new DocumentCommentThreadModel({
            id: commentThreadId,
            documentId: document.id,
            createdTime,
            version: 0,
            fallbackContentSnippet: null,
            isResolved: false,
            commentCount: 1,
            firstCommentAuthor: await getAccount(session1.action(), space.id, session1.account.id),
        }),
        initialComments: [],
        initialOtherReferencedComments: [],
    });

    expect(
        await connection2.procedures.getCommentThreadAndInitialCommentsIfExists({
            commentThreadId,
            limit: 0,
        }),
    ).toEqual({
        checkpoint: expect.any(Date),
        commentThread: new DocumentCommentThreadModel({
            id: commentThreadId,
            documentId: document.id,
            createdTime,
            version: 0,
            fallbackContentSnippet: null,
            isResolved: false,
            commentCount: 1,
            firstCommentAuthor: await getAccount(session1.action(), space.id, session1.account.id),
        }),
        initialComments: [],
        initialOtherReferencedComments: [],
    });

    expect(
        await connection1.procedures.getCommentsFromStart({
            commentThreadId,
            limit: 100,
            afterCommentIndex: null,
            beforeCommentIndex: null,
        }),
    ).toEqual({
        commentCount: 1,
        comments: [
            new DocumentCommentModel({
                documentId: document.id,
                commentThreadId,
                index: 0,
                version: 0,
                author: await getAccount(session1.action(), space.id, session1.account.id),
                createdTime,
                createdTimeZone: defaultTimeZone,
                payload: {
                    type: "Content",
                    parent: null,
                    content: {
                        doc: createSimpleMessageContent("Test message content 1"),
                        references: emptyContentReferences,
                    },
                    contentUpdate: null,
                    files: [],
                    reactionsByPos: emptyMap,
                    filesReactions: emptyReactionSet,
                },
                stream: null,
            }),
        ],
        otherReferencedComments: [],
    });

    expect(
        await connection2.procedures.getCommentsFromStart({
            commentThreadId,
            limit: 100,
            afterCommentIndex: null,
            beforeCommentIndex: null,
        }),
    ).toEqual({
        commentCount: 1,
        comments: [
            new DocumentCommentModel({
                documentId: document.id,
                commentThreadId,
                index: 0,
                version: 0,
                author: await getAccount(session1.action(), space.id, session1.account.id),
                createdTime,
                createdTimeZone: defaultTimeZone,
                payload: {
                    type: "Content",
                    parent: null,
                    content: {
                        doc: createSimpleMessageContent("Test message content 1"),
                        references: emptyContentReferences,
                    },
                    contentUpdate: null,
                    files: [],
                    reactionsByPos: emptyMap,
                    filesReactions: emptyReactionSet,
                },
                stream: null,
            }),
        ],
        otherReferencedComments: [],
    });

    expect(
        await connection1.procedures.getCommentsFromStart({
            commentThreadId,
            limit: 100,
            afterCommentIndex: 0,
            beforeCommentIndex: null,
        }),
    ).toEqual({
        commentCount: 1,
        comments: [],
        otherReferencedComments: [],
    });

    expect(
        await connection2.procedures.getCommentsFromStart({
            commentThreadId,
            limit: 100,
            afterCommentIndex: 0,
            beforeCommentIndex: null,
        }),
    ).toEqual({
        commentCount: 1,
        comments: [],
        otherReferencedComments: [],
    });

    expect(
        await connection1.procedures.getCommentsFromStart({
            commentThreadId,
            limit: 0,
            afterCommentIndex: null,
            beforeCommentIndex: null,
        }),
    ).toEqual({
        commentCount: 1,
        comments: [],
        otherReferencedComments: [],
    });

    expect(
        await connection2.procedures.getCommentsFromStart({
            commentThreadId,
            limit: 0,
            afterCommentIndex: null,
            beforeCommentIndex: null,
        }),
    ).toEqual({
        commentCount: 1,
        comments: [],
        otherReferencedComments: [],
    });

    expect(
        await connection1.procedures.getCommentsFromEnd({
            commentThreadId,
            limit: 100,
            afterCommentIndex: null,
            beforeCommentIndex: null,
        }),
    ).toEqual({
        commentCount: 1,
        comments: [
            new DocumentCommentModel({
                documentId: document.id,
                commentThreadId,
                index: 0,
                version: 0,
                author: await getAccount(session1.action(), space.id, session1.account.id),
                createdTime,
                createdTimeZone: defaultTimeZone,
                payload: {
                    type: "Content",
                    parent: null,
                    content: {
                        doc: createSimpleMessageContent("Test message content 1"),
                        references: emptyContentReferences,
                    },
                    contentUpdate: null,
                    files: [],
                    reactionsByPos: emptyMap,
                    filesReactions: emptyReactionSet,
                },
                stream: null,
            }),
        ],
        otherReferencedComments: [],
    });

    expect(
        await connection2.procedures.getCommentsFromEnd({
            commentThreadId,
            limit: 100,
            afterCommentIndex: null,
            beforeCommentIndex: null,
        }),
    ).toEqual({
        commentCount: 1,
        comments: [
            new DocumentCommentModel({
                documentId: document.id,
                commentThreadId,
                index: 0,
                version: 0,
                author: await getAccount(session1.action(), space.id, session1.account.id),
                createdTime,
                createdTimeZone: defaultTimeZone,
                payload: {
                    type: "Content",
                    parent: null,
                    content: {
                        doc: createSimpleMessageContent("Test message content 1"),
                        references: emptyContentReferences,
                    },
                    contentUpdate: null,
                    files: [],
                    reactionsByPos: emptyMap,
                    filesReactions: emptyReactionSet,
                },
                stream: null,
            }),
        ],
        otherReferencedComments: [],
    });

    expect(
        await connection1.procedures.getCommentsFromEnd({
            commentThreadId,
            limit: 100,
            afterCommentIndex: null,
            beforeCommentIndex: 0,
        }),
    ).toEqual({
        commentCount: 1,
        comments: [],
        otherReferencedComments: [],
    });

    expect(
        await connection2.procedures.getCommentsFromEnd({
            commentThreadId,
            limit: 100,
            afterCommentIndex: null,
            beforeCommentIndex: 0,
        }),
    ).toEqual({
        commentCount: 1,
        comments: [],
        otherReferencedComments: [],
    });

    expect(
        await connection1.procedures.getCommentsFromEnd({
            commentThreadId,
            limit: 0,
            afterCommentIndex: null,
            beforeCommentIndex: null,
        }),
    ).toEqual({
        commentCount: 1,
        comments: [],
        otherReferencedComments: [],
    });

    expect(
        await connection2.procedures.getCommentsFromEnd({
            commentThreadId,
            limit: 0,
            afterCommentIndex: null,
            beforeCommentIndex: null,
        }),
    ).toEqual({
        commentCount: 1,
        comments: [],
        otherReferencedComments: [],
    });

    expect(connection1.takeEvents()).toEqual([]);
    expect(connection2.takeEvents()).toEqual([]);

    unpause();
    await waitForPersistence(connection1, 2);

    expect(connection1.takeEvents()).toEqual([
        {
            type: "PersistedContent",
            newVersion: 2,
            updatedCommentThreads: [],
        },
    ]);

    expect(connection2.takeEvents()).toEqual([
        {
            type: "PersistedContent",
            newVersion: 2,
            updatedCommentThreads: [],
        },
    ]);

    expect(
        await connection1.procedures.getCommentThreadAndInitialCommentsIfExists({
            commentThreadId,
            limit: 100,
        }),
    ).toEqual({
        checkpoint: expect.any(Date),
        commentThread: new DocumentCommentThreadModel({
            id: commentThreadId,
            documentId: document.id,
            createdTime,
            version: 0,
            fallbackContentSnippet: null,
            isResolved: false,
            commentCount: 1,
            firstCommentAuthor: await getAccount(session1.action(), space.id, session1.account.id),
        }),
        initialComments: [
            new DocumentCommentModel({
                documentId: document.id,
                commentThreadId,
                index: 0,
                version: 0,
                author: await getAccount(session1.action(), space.id, session1.account.id),
                createdTime,
                createdTimeZone: defaultTimeZone,
                payload: {
                    type: "Content",
                    parent: null,
                    content: {
                        doc: createSimpleMessageContent("Test message content 1"),
                        references: emptyContentReferences,
                    },
                    contentUpdate: null,
                    files: [],
                    reactionsByPos: emptyMap,
                    filesReactions: emptyReactionSet,
                },
                stream: null,
            }),
        ],
        initialOtherReferencedComments: [],
    });

    expect(
        await connection2.procedures.getCommentThreadAndInitialCommentsIfExists({
            commentThreadId,
            limit: 100,
        }),
    ).toEqual({
        checkpoint: expect.any(Date),
        commentThread: new DocumentCommentThreadModel({
            id: commentThreadId,
            documentId: document.id,
            createdTime,
            version: 0,
            fallbackContentSnippet: null,
            isResolved: false,
            commentCount: 1,
            firstCommentAuthor: await getAccount(session1.action(), space.id, session1.account.id),
        }),
        initialComments: [
            new DocumentCommentModel({
                documentId: document.id,
                commentThreadId,
                index: 0,
                version: 0,
                author: await getAccount(session1.action(), space.id, session1.account.id),
                createdTime,
                createdTimeZone: defaultTimeZone,
                payload: {
                    type: "Content",
                    parent: null,
                    content: {
                        doc: createSimpleMessageContent("Test message content 1"),
                        references: emptyContentReferences,
                    },
                    contentUpdate: null,
                    files: [],
                    reactionsByPos: emptyMap,
                    filesReactions: emptyReactionSet,
                },
                stream: null,
            }),
        ],
        initialOtherReferencedComments: [],
    });

    expect(
        await connection1.procedures.getCommentThreadAndInitialCommentsIfExists({
            commentThreadId,
            limit: 0,
        }),
    ).toEqual({
        checkpoint: expect.any(Date),
        commentThread: new DocumentCommentThreadModel({
            id: commentThreadId,
            documentId: document.id,
            createdTime,
            version: 0,
            fallbackContentSnippet: null,
            isResolved: false,
            commentCount: 1,
            firstCommentAuthor: await getAccount(session1.action(), space.id, session1.account.id),
        }),
        initialComments: [],
        initialOtherReferencedComments: [],
    });

    expect(
        await connection2.procedures.getCommentThreadAndInitialCommentsIfExists({
            commentThreadId,
            limit: 0,
        }),
    ).toEqual({
        checkpoint: expect.any(Date),
        commentThread: new DocumentCommentThreadModel({
            id: commentThreadId,
            documentId: document.id,
            createdTime,
            version: 0,
            fallbackContentSnippet: null,
            isResolved: false,
            commentCount: 1,
            firstCommentAuthor: await getAccount(session1.action(), space.id, session1.account.id),
        }),
        initialComments: [],
        initialOtherReferencedComments: [],
    });

    expect(
        await connection1.procedures.getCommentsFromStart({
            commentThreadId,
            limit: 100,
            afterCommentIndex: null,
            beforeCommentIndex: null,
        }),
    ).toEqual({
        commentCount: 1,
        comments: [
            new DocumentCommentModel({
                documentId: document.id,
                commentThreadId,
                index: 0,
                version: 0,
                author: await getAccount(session1.action(), space.id, session1.account.id),
                createdTime,
                createdTimeZone: defaultTimeZone,
                payload: {
                    type: "Content",
                    parent: null,
                    content: {
                        doc: createSimpleMessageContent("Test message content 1"),
                        references: emptyContentReferences,
                    },
                    contentUpdate: null,
                    files: [],
                    reactionsByPos: emptyMap,
                    filesReactions: emptyReactionSet,
                },
                stream: null,
            }),
        ],
        otherReferencedComments: [],
    });

    expect(
        await connection2.procedures.getCommentsFromStart({
            commentThreadId,
            limit: 100,
            afterCommentIndex: null,
            beforeCommentIndex: null,
        }),
    ).toEqual({
        commentCount: 1,
        comments: [
            new DocumentCommentModel({
                documentId: document.id,
                commentThreadId,
                index: 0,
                version: 0,
                author: await getAccount(session1.action(), space.id, session1.account.id),
                createdTime,
                createdTimeZone: defaultTimeZone,
                payload: {
                    type: "Content",
                    parent: null,
                    content: {
                        doc: createSimpleMessageContent("Test message content 1"),
                        references: emptyContentReferences,
                    },
                    contentUpdate: null,
                    files: [],
                    reactionsByPos: emptyMap,
                    filesReactions: emptyReactionSet,
                },
                stream: null,
            }),
        ],
        otherReferencedComments: [],
    });

    expect(
        await connection1.procedures.getCommentsFromStart({
            commentThreadId,
            limit: 100,
            afterCommentIndex: 0,
            beforeCommentIndex: null,
        }),
    ).toEqual({
        commentCount: 1,
        comments: [],
        otherReferencedComments: [],
    });

    expect(
        await connection2.procedures.getCommentsFromStart({
            commentThreadId,
            limit: 100,
            afterCommentIndex: 0,
            beforeCommentIndex: null,
        }),
    ).toEqual({
        commentCount: 1,
        comments: [],
        otherReferencedComments: [],
    });

    expect(
        await connection1.procedures.getCommentsFromStart({
            commentThreadId,
            limit: 0,
            afterCommentIndex: null,
            beforeCommentIndex: null,
        }),
    ).toEqual({
        commentCount: 1,
        comments: [],
        otherReferencedComments: [],
    });

    expect(
        await connection2.procedures.getCommentsFromStart({
            commentThreadId,
            limit: 0,
            afterCommentIndex: null,
            beforeCommentIndex: null,
        }),
    ).toEqual({
        commentCount: 1,
        comments: [],
        otherReferencedComments: [],
    });

    expect(
        await connection1.procedures.getCommentsFromEnd({
            commentThreadId,
            limit: 100,
            afterCommentIndex: null,
            beforeCommentIndex: null,
        }),
    ).toEqual({
        commentCount: 1,
        comments: [
            new DocumentCommentModel({
                documentId: document.id,
                commentThreadId,
                index: 0,
                version: 0,
                author: await getAccount(session1.action(), space.id, session1.account.id),
                createdTime,
                createdTimeZone: defaultTimeZone,
                payload: {
                    type: "Content",
                    parent: null,
                    content: {
                        doc: createSimpleMessageContent("Test message content 1"),
                        references: emptyContentReferences,
                    },
                    contentUpdate: null,
                    files: [],
                    reactionsByPos: emptyMap,
                    filesReactions: emptyReactionSet,
                },
                stream: null,
            }),
        ],
        otherReferencedComments: [],
    });

    expect(
        await connection2.procedures.getCommentsFromEnd({
            commentThreadId,
            limit: 100,
            afterCommentIndex: null,
            beforeCommentIndex: null,
        }),
    ).toEqual({
        commentCount: 1,
        comments: [
            new DocumentCommentModel({
                documentId: document.id,
                commentThreadId,
                index: 0,
                version: 0,
                author: await getAccount(session1.action(), space.id, session1.account.id),
                createdTime,
                createdTimeZone: defaultTimeZone,
                payload: {
                    type: "Content",
                    parent: null,
                    content: {
                        doc: createSimpleMessageContent("Test message content 1"),
                        references: emptyContentReferences,
                    },
                    contentUpdate: null,
                    files: [],
                    reactionsByPos: emptyMap,
                    filesReactions: emptyReactionSet,
                },
                stream: null,
            }),
        ],
        otherReferencedComments: [],
    });

    expect(
        await connection1.procedures.getCommentsFromEnd({
            commentThreadId,
            limit: 100,
            afterCommentIndex: null,
            beforeCommentIndex: 0,
        }),
    ).toEqual({
        commentCount: 1,
        comments: [],
        otherReferencedComments: [],
    });

    expect(
        await connection2.procedures.getCommentsFromEnd({
            commentThreadId,
            limit: 100,
            afterCommentIndex: null,
            beforeCommentIndex: 0,
        }),
    ).toEqual({
        commentCount: 1,
        comments: [],
        otherReferencedComments: [],
    });

    expect(
        await connection1.procedures.getCommentsFromEnd({
            commentThreadId,
            limit: 0,
            afterCommentIndex: null,
            beforeCommentIndex: null,
        }),
    ).toEqual({
        commentCount: 1,
        comments: [],
        otherReferencedComments: [],
    });

    expect(
        await connection2.procedures.getCommentsFromEnd({
            commentThreadId,
            limit: 0,
            afterCommentIndex: null,
            beforeCommentIndex: null,
        }),
    ).toEqual({
        commentCount: 1,
        comments: [],
        otherReferencedComments: [],
    });
});

test("will cleanup comment thread marks if from a different document", async () => {
    const space = await TestSpace.create(context);
    const [session1, session2] = await space.createSessions(2);

    const document1 = await TestDocument.create(session1, {
        access: {
            type: "Local",
            accountGrantById: new Map([[session1.account.id, {level: "Manage", generation: 0}]]),
            defaultGrant: {level: "Manage", generation: 1},
            urlGrant: null,
        },
    });

    const document2 = await TestDocument.create(session1, {
        access: {
            type: "Local",
            accountGrantById: new Map([[session1.account.id, {level: "Manage", generation: 0}]]),
            defaultGrant: {level: "Manage", generation: 1},
            urlGrant: null,
        },
    });

    await updateDocumentContent(session1.action(), {
        id: document1.id,
        version: 0,
        steps: [new ReplaceStep(3, 3, textSlice("Hello, world!"))],
        clientId: generateId(),
    });

    const commentThreadId = generateId<DocumentCommentThreadId>();

    const client1Id = generateId<ContentEditorClientId>();
    const connection1 = await connectForTest(context.action(session1), document1.id);
    const connection2 = await connectForTest(context.action(session2), document1.id);
    const connection3 = await connectForTest(context.action(session1), document2.id);
    const connection4 = await connectForTest(context.action(session2), document2.id);

    await connection1.procedures.backfill({
        version: 0,
    });

    await connection2.procedures.backfill({
        version: 0,
    });

    await connection3.procedures.backfill({
        version: 0,
    });

    await connection4.procedures.backfill({
        version: 0,
    });

    await connection1.procedures.updateContent({
        version: 1,
        steps: [new AddMarkStep(10, 15, schema.mark("comment", {commentThreadId}))],
        clientId: client1Id,
        createCommentThreads: [
            {
                commentThreadId,
                initialCommentContent: createSimpleMessageContent("Test message content 1"),
                initialCommentFileIds: [],
                createdTimeZone: defaultTimeZone,
            },
        ],
        intentionallyUpdateAccessPolicy: null,
        updateOurPresenceState: {state: null},
    });

    await waitForPersistence(connection1, 2);

    expect(
        // Message order is not deterministic. We do not delay persistence on loading data
        // necessary from the database.
        connection1.takeEvents().sort((a, b) => defaultCompareStrings(a.type, b.type)),
    ).toEqual([
        {
            type: "PersistedContent",
            newVersion: 2,
            updatedCommentThreads: [],
        },
        {
            type: "UpdateContentWithoutPersistence",
            newVersion: 2,
            steps: [new AddMarkStep(10, 15, schema.mark("comment", {commentThreadId}))],
            stepsContentReferences: {
                ...emptyDocumentContentReferences,
                commentThreadById: new Map([
                    [
                        commentThreadId,
                        {
                            commentCount: 1,
                            commentAuthors: [
                                await getAccount(session1.action(), space.id, session1.account.id),
                            ],
                        },
                    ],
                ]),
            },
            clientId: client1Id,
            updateOtherPresenceState: {connectionId: connection1.id, state: null},
            resolveCommentThreadIds: [],
            unresolveCommentThreadIds: [],
        },
    ]);

    expect(
        // Message order is not deterministic. We do not delay persistence on loading data
        // necessary from the database.
        connection2.takeEvents().sort((a, b) => defaultCompareStrings(a.type, b.type)),
    ).toEqual([
        {
            type: "PersistedContent",
            newVersion: 2,
            updatedCommentThreads: [],
        },
        {
            type: "UpdateContentWithoutPersistence",
            newVersion: 2,
            steps: [new AddMarkStep(10, 15, schema.mark("comment", {commentThreadId}))],
            stepsContentReferences: {
                ...emptyDocumentContentReferences,
                commentThreadById: new Map([
                    [
                        commentThreadId,
                        {
                            commentCount: 1,
                            commentAuthors: [
                                await getAccount(session1.action(), space.id, session1.account.id),
                            ],
                        },
                    ],
                ]),
            },
            clientId: client1Id,
            updateOtherPresenceState: {connectionId: connection1.id, state: null},
            resolveCommentThreadIds: [],
            unresolveCommentThreadIds: [],
        },
    ]);

    await connection1.procedures.updateContent({
        version: 2,
        steps: [
            new ReplaceStep(
                16,
                16,
                new Slice(
                    Fragment.from([
                        schema.text(" "),
                        schema.text("Some new text", [schema.mark("comment", {commentThreadId})]),
                    ]),
                    0,
                    0,
                ),
            ),
        ],
        clientId: client1Id,
        createCommentThreads: [],
        intentionallyUpdateAccessPolicy: null,
        updateOurPresenceState: {state: null},
    });

    await waitForPersistence(connection1, 3);

    expect(
        // Message order is not deterministic. We do not delay persistence on loading data
        // necessary from the database.
        connection1.takeEvents().sort((a, b) => defaultCompareStrings(a.type, b.type)),
    ).toEqual([
        {
            type: "PersistedContent",
            newVersion: 3,
            updatedCommentThreads: [],
        },
        {
            type: "UpdateContentWithoutPersistence",
            newVersion: 3,
            steps: [
                new ReplaceStep(
                    16,
                    16,
                    new Slice(
                        Fragment.from([
                            schema.text(" "),
                            schema.text("Some new text", [
                                schema.mark("comment", {commentThreadId}),
                            ]),
                        ]),
                        0,
                        0,
                    ),
                ),
            ],
            stepsContentReferences: {
                ...emptyDocumentContentReferences,
                commentThreadById: new Map([
                    [
                        commentThreadId,
                        {
                            commentCount: 1,
                            commentAuthors: [
                                await getAccount(session1.action(), space.id, session1.account.id),
                            ],
                        },
                    ],
                ]),
            },
            clientId: client1Id,
            updateOtherPresenceState: {connectionId: connection1.id, state: null},
            resolveCommentThreadIds: [],
            unresolveCommentThreadIds: [],
        },
    ]);

    expect(
        // Message order is not deterministic. We do not delay persistence on loading data
        // necessary from the database.
        connection2.takeEvents().sort((a, b) => defaultCompareStrings(a.type, b.type)),
    ).toEqual([
        {
            type: "PersistedContent",
            newVersion: 3,
            updatedCommentThreads: [],
        },
        {
            type: "UpdateContentWithoutPersistence",
            newVersion: 3,
            steps: [
                new ReplaceStep(
                    16,
                    16,
                    new Slice(
                        Fragment.from([
                            schema.text(" "),
                            schema.text("Some new text", [
                                schema.mark("comment", {commentThreadId}),
                            ]),
                        ]),
                        0,
                        0,
                    ),
                ),
            ],
            stepsContentReferences: {
                ...emptyDocumentContentReferences,
                commentThreadById: new Map([
                    [
                        commentThreadId,
                        {
                            commentCount: 1,
                            commentAuthors: [
                                await getAccount(session1.action(), space.id, session1.account.id),
                            ],
                        },
                    ],
                ]),
            },
            clientId: client1Id,
            updateOtherPresenceState: {connectionId: connection1.id, state: null},
            resolveCommentThreadIds: [],
            unresolveCommentThreadIds: [],
        },
    ]);

    await connection3.procedures.updateContent({
        version: 0,
        steps: [
            new ReplaceStep(
                3,
                3,
                new Slice(
                    Fragment.from([
                        schema.text("Some new text", [schema.mark("comment", {commentThreadId})]),
                    ]),
                    0,
                    0,
                ),
            ),
        ],
        clientId: client1Id,
        createCommentThreads: [],
        intentionallyUpdateAccessPolicy: null,
        updateOurPresenceState: {state: null},
    });

    await waitForPersistence(connection3, 2);

    expect(
        // Message order is not deterministic. We do not delay persistence on loading data
        // necessary from the database.
        connection3.takeEvents().sort((a, b) =>
            // We don't compare `newVersion` since we do specifically want to test the ordering
            // of `UpdateContentWithoutPersistence` events here. The `RemoveAllMarksStep` event
            // should always come first despite being at a later version.
            defaultCompareStrings(a.type, b.type),
        ),
    ).toEqual([
        {
            type: "PersistedContent",
            newVersion: 1,
            updatedCommentThreads: [],
        },
        {
            type: "PersistedContent",
            newVersion: 2,
            updatedCommentThreads: [],
        },
        {
            type: "UpdateContentWithoutPersistence",
            newVersion: 2,
            steps: [new RemoveAllMarksStep(schema.mark("comment", {commentThreadId}))],
            stepsContentReferences: emptyDocumentContentReferences,
            clientId: expect.not.stringMatching(client1Id),
            updateOtherPresenceState: null,
            resolveCommentThreadIds: [],
            unresolveCommentThreadIds: [],
        },
        {
            type: "UpdateContentWithoutPersistence",
            newVersion: 1,
            steps: [
                new ReplaceStep(
                    3,
                    3,
                    new Slice(
                        Fragment.from([
                            schema.text("Some new text", [
                                schema.mark("comment", {commentThreadId}),
                            ]),
                        ]),
                        0,
                        0,
                    ),
                ),
            ],
            stepsContentReferences: emptyDocumentContentReferences,
            clientId: client1Id,
            updateOtherPresenceState: {connectionId: connection3.id, state: null},
            resolveCommentThreadIds: [],
            unresolveCommentThreadIds: [],
        },
    ]);

    expect(
        // Message order is not deterministic. We do not delay persistence on loading data
        // necessary from the database.
        connection4.takeEvents().sort((a, b) =>
            // We don't compare `newVersion` since we do specifically want to test the ordering
            // of `UpdateContentWithoutPersistence` events here. The `RemoveAllMarksStep` event
            // should always come first despite being at a later version.
            defaultCompareStrings(a.type, b.type),
        ),
    ).toEqual([
        {
            type: "PersistedContent",
            newVersion: 1,
            updatedCommentThreads: [],
        },
        {
            type: "PersistedContent",
            newVersion: 2,
            updatedCommentThreads: [],
        },
        {
            type: "UpdateContentWithoutPersistence",
            newVersion: 2,
            steps: [new RemoveAllMarksStep(schema.mark("comment", {commentThreadId}))],
            stepsContentReferences: emptyDocumentContentReferences,
            clientId: expect.not.stringMatching(client1Id),
            updateOtherPresenceState: null,
            resolveCommentThreadIds: [],
            unresolveCommentThreadIds: [],
        },
        {
            type: "UpdateContentWithoutPersistence",
            newVersion: 1,
            steps: [
                new ReplaceStep(
                    3,
                    3,
                    new Slice(
                        Fragment.from([
                            schema.text("Some new text", [
                                schema.mark("comment", {commentThreadId}),
                            ]),
                        ]),
                        0,
                        0,
                    ),
                ),
            ],
            stepsContentReferences: emptyDocumentContentReferences,
            clientId: client1Id,
            updateOtherPresenceState: {connectionId: connection3.id, state: null},
            resolveCommentThreadIds: [],
            unresolveCommentThreadIds: [],
        },
    ]);
});

test("can add comment thread marks back to document after they\u2019ve been removed", async () => {
    const space = await TestSpace.create(context);
    const [session1, session2] = await space.createSessions(2);

    const document = await TestDocument.create(session1, {
        access: {
            type: "Local",
            accountGrantById: new Map([[session1.account.id, {level: "Manage", generation: 0}]]),
            defaultGrant: {level: "Manage", generation: 1},
            urlGrant: null,
        },
    });

    await updateDocumentContent(session1.action(), {
        id: document.id,
        version: 0,
        steps: [new ReplaceStep(3, 3, textSlice("Hello, world!"))],
        clientId: generateId(),
    });

    const commentThreadId = generateId<DocumentCommentThreadId>();

    const client1Id = generateId<ContentEditorClientId>();
    const connection1 = await connectForTest(context.action(session1), document.id);
    const connection2 = await connectForTest(context.action(session2), document.id);

    await connection1.procedures.backfill({
        version: 0,
    });

    await connection2.procedures.backfill({
        version: 0,
    });

    await connection1.procedures.updateContent({
        version: 1,
        steps: [new AddMarkStep(10, 15, schema.mark("comment", {commentThreadId}))],
        clientId: client1Id,
        createCommentThreads: [
            {
                commentThreadId,
                initialCommentContent: createSimpleMessageContent("Test message content 1"),
                initialCommentFileIds: [],
                createdTimeZone: defaultTimeZone,
            },
        ],
        intentionallyUpdateAccessPolicy: null,
        updateOurPresenceState: {state: null},
    });

    await waitForPersistence(connection1, 2);

    expect(
        // Message order is not deterministic. We do not delay persistence on loading data
        // necessary from the database.
        connection1.takeEvents().sort((a, b) => defaultCompareStrings(a.type, b.type)),
    ).toEqual([
        {
            type: "PersistedContent",
            newVersion: 2,
            updatedCommentThreads: [],
        },
        {
            type: "UpdateContentWithoutPersistence",
            newVersion: 2,
            steps: [new AddMarkStep(10, 15, schema.mark("comment", {commentThreadId}))],
            stepsContentReferences: {
                ...emptyDocumentContentReferences,
                commentThreadById: new Map([
                    [
                        commentThreadId,
                        {
                            commentCount: 1,
                            commentAuthors: [
                                await getAccount(session1.action(), space.id, session1.account.id),
                            ],
                        },
                    ],
                ]),
            },
            clientId: client1Id,
            updateOtherPresenceState: {connectionId: connection1.id, state: null},
            resolveCommentThreadIds: [],
            unresolveCommentThreadIds: [],
        },
    ]);

    expect(
        // Message order is not deterministic. We do not delay persistence on loading data
        // necessary from the database.
        connection2.takeEvents().sort((a, b) => defaultCompareStrings(a.type, b.type)),
    ).toEqual([
        {
            type: "PersistedContent",
            newVersion: 2,
            updatedCommentThreads: [],
        },
        {
            type: "UpdateContentWithoutPersistence",
            newVersion: 2,
            steps: [new AddMarkStep(10, 15, schema.mark("comment", {commentThreadId}))],
            stepsContentReferences: {
                ...emptyDocumentContentReferences,
                commentThreadById: new Map([
                    [
                        commentThreadId,
                        {
                            commentCount: 1,
                            commentAuthors: [
                                await getAccount(session1.action(), space.id, session1.account.id),
                            ],
                        },
                    ],
                ]),
            },
            clientId: client1Id,
            updateOtherPresenceState: {connectionId: connection1.id, state: null},
            resolveCommentThreadIds: [],
            unresolveCommentThreadIds: [],
        },
    ]);

    await connection1.procedures.updateContent({
        version: 2,
        steps: [new ReplaceStep(3, 16, textSlice(""))],
        clientId: client1Id,
        createCommentThreads: [],
        intentionallyUpdateAccessPolicy: null,
        updateOurPresenceState: {state: null},
    });

    await waitForPersistence(connection1, 3);

    expect(
        // Message order is not deterministic. We do not delay persistence on loading data
        // necessary from the database.
        connection1.takeEvents().sort((a, b) => defaultCompareStrings(a.type, b.type)),
    ).toEqual([
        {
            type: "PersistedContent",
            newVersion: 3,
            updatedCommentThreads: [],
        },
        {
            type: "UpdateContentWithoutPersistence",
            newVersion: 3,
            steps: [new ReplaceStep(3, 16, textSlice(""))],
            stepsContentReferences: emptyDocumentContentReferences,
            clientId: client1Id,
            updateOtherPresenceState: {connectionId: connection1.id, state: null},
            resolveCommentThreadIds: [],
            unresolveCommentThreadIds: [],
        },
    ]);

    expect(
        // Message order is not deterministic. We do not delay persistence on loading data
        // necessary from the database.
        connection2.takeEvents().sort((a, b) => defaultCompareStrings(a.type, b.type)),
    ).toEqual([
        {
            type: "PersistedContent",
            newVersion: 3,
            updatedCommentThreads: [],
        },
        {
            type: "UpdateContentWithoutPersistence",
            newVersion: 3,
            steps: [new ReplaceStep(3, 16, textSlice(""))],
            stepsContentReferences: emptyDocumentContentReferences,
            clientId: client1Id,
            updateOtherPresenceState: {connectionId: connection1.id, state: null},
            resolveCommentThreadIds: [],
            unresolveCommentThreadIds: [],
        },
    ]);

    await connection1.procedures.updateContent({
        version: 3,
        steps: [
            new ReplaceStep(
                3,
                3,
                new Slice(
                    Fragment.from([
                        schema.text("Hello, "),
                        schema.text("world", [schema.mark("comment", {commentThreadId})]),
                        schema.text("!"),
                    ]),
                    0,
                    0,
                ),
            ),
        ],
        clientId: client1Id,
        createCommentThreads: [],
        intentionallyUpdateAccessPolicy: null,
        updateOurPresenceState: {state: null},
    });

    await waitForPersistence(connection1, 4);

    expect(
        // Message order is not deterministic. We do not delay persistence on loading data
        // necessary from the database.
        connection1.takeEvents().sort((a, b) => defaultCompareStrings(a.type, b.type)),
    ).toEqual([
        {
            type: "PersistedContent",
            newVersion: 4,
            updatedCommentThreads: [],
        },
        {
            type: "UpdateContentWithoutPersistence",
            newVersion: 4,
            steps: [
                new ReplaceStep(
                    3,
                    3,
                    new Slice(
                        Fragment.from([
                            schema.text("Hello, "),
                            schema.text("world", [schema.mark("comment", {commentThreadId})]),
                            schema.text("!"),
                        ]),
                        0,
                        0,
                    ),
                ),
            ],
            stepsContentReferences: {
                ...emptyDocumentContentReferences,
                commentThreadById: new Map([
                    [
                        commentThreadId,
                        {
                            commentCount: 1,
                            commentAuthors: [
                                await getAccount(session1.action(), space.id, session1.account.id),
                            ],
                        },
                    ],
                ]),
            },
            clientId: client1Id,
            updateOtherPresenceState: {connectionId: connection1.id, state: null},
            resolveCommentThreadIds: [],
            unresolveCommentThreadIds: [],
        },
    ]);

    expect(
        // Message order is not deterministic. We do not delay persistence on loading data
        // necessary from the database.
        connection2.takeEvents().sort((a, b) => defaultCompareStrings(a.type, b.type)),
    ).toEqual([
        {
            type: "PersistedContent",
            newVersion: 4,
            updatedCommentThreads: [],
        },
        {
            type: "UpdateContentWithoutPersistence",
            newVersion: 4,
            steps: [
                new ReplaceStep(
                    3,
                    3,
                    new Slice(
                        Fragment.from([
                            schema.text("Hello, "),
                            schema.text("world", [schema.mark("comment", {commentThreadId})]),
                            schema.text("!"),
                        ]),
                        0,
                        0,
                    ),
                ),
            ],
            stepsContentReferences: {
                ...emptyDocumentContentReferences,
                commentThreadById: new Map([
                    [
                        commentThreadId,
                        {
                            commentCount: 1,
                            commentAuthors: [
                                await getAccount(session1.action(), space.id, session1.account.id),
                            ],
                        },
                    ],
                ]),
            },
            clientId: client1Id,
            updateOtherPresenceState: {connectionId: connection1.id, state: null},
            resolveCommentThreadIds: [],
            unresolveCommentThreadIds: [],
        },
    ]);
});

test("can resolve a comment thread", async () => {
    const space = await TestSpace.create(context);
    const session1 = await space.createSession();
    const session2 = await space.createSession();

    const document = await TestDocument.create(session1, {
        access: {
            type: "Local",
            accountGrantById: new Map([[session1.account.id, {level: "Manage", generation: 0}]]),
            defaultGrant: {level: "Manage", generation: 1},
            urlGrant: null,
        },
    });

    const {range} = await document.type(session1, "Hello");
    await document.type(session1, ", world!");

    const commentThread = await document.createCommentThread(session1, range, "test1");

    const connection1 = await connectForTest(context.action(session1), document.id);
    const connection2 = await connectForTest(context.action(session2), document.id);

    await connection1.procedures.backfill({
        version: 0,
    });

    await connection2.procedures.backfill({
        version: 0,
    });

    await connection1.procedures.resolveCommentThread({commentThreadId: commentThread.id});

    await waitForPersistence(connection1, 4);

    expect(
        // Message order is not deterministic. We do not delay persistence on loading data
        // necessary from the database.
        connection1.takeEvents().sort((a, b) => defaultCompareStrings(a.type, b.type)),
    ).toEqual([
        {
            type: "PersistedContent",
            newVersion: 4,
            updatedCommentThreads: [
                new DocumentCommentThreadModel({
                    id: commentThread.id,
                    documentId: document.id,
                    createdTime: expect.any(Date),
                    version: 1,
                    fallbackContentSnippet: expect.any(Object),
                    isResolved: true,
                    commentCount: 1,
                    firstCommentAuthor: await session1.get(),
                }),
            ],
        },
        {
            type: "UpdateContentWithoutPersistence",
            newVersion: 4,
            steps: [
                new RemoveAllMarksStep(schema.mark("comment", {commentThreadId: commentThread.id})),
            ],
            stepsContentReferences: emptyDocumentContentReferences,
            clientId: expect.any(String),
            updateOtherPresenceState: null,
            resolveCommentThreadIds: [commentThread.id],
            unresolveCommentThreadIds: [],
        },
    ]);

    expect(
        // Message order is not deterministic. We do not delay persistence on loading data
        // necessary from the database.
        connection2.takeEvents().sort((a, b) => defaultCompareStrings(a.type, b.type)),
    ).toEqual([
        {
            type: "PersistedContent",
            newVersion: 4,
            updatedCommentThreads: [
                new DocumentCommentThreadModel({
                    id: commentThread.id,
                    documentId: document.id,
                    createdTime: expect.any(Date),
                    version: 1,
                    fallbackContentSnippet: expect.any(Object),
                    isResolved: true,
                    commentCount: 1,
                    firstCommentAuthor: await session1.get(),
                }),
            ],
        },
        {
            type: "UpdateContentWithoutPersistence",
            newVersion: 4,
            steps: [
                new RemoveAllMarksStep(schema.mark("comment", {commentThreadId: commentThread.id})),
            ],
            stepsContentReferences: emptyDocumentContentReferences,
            clientId: expect.any(String),
            updateOtherPresenceState: null,
            resolveCommentThreadIds: [commentThread.id],
            unresolveCommentThreadIds: [],
        },
    ]);
});

test("can unresolve a comment thread", async () => {
    const space = await TestSpace.create(context);
    const session1 = await space.createSession();
    const session2 = await space.createSession();

    const document = await TestDocument.create(session1, {
        access: {
            type: "Local",
            accountGrantById: new Map([[session1.account.id, {level: "Manage", generation: 0}]]),
            defaultGrant: {level: "Manage", generation: 1},
            urlGrant: null,
        },
    });

    const {range} = await document.type(session1, "Hello");
    await document.type(session1, ", world!");

    const commentThread = await document.createCommentThread(session1, range, "test1");

    await commentThread.resolve(session1);

    const connection1 = await connectForTest(context.action(session1), document.id);
    const connection2 = await connectForTest(context.action(session2), document.id);

    await connection1.procedures.backfill({
        version: 0,
    });

    await connection2.procedures.backfill({
        version: 0,
    });

    await connection1.procedures.unresolveCommentThread({commentThreadId: commentThread.id});

    await waitForPersistence(connection1, 5);

    expect(
        // Message order is not deterministic. We do not delay persistence on loading data
        // necessary from the database.
        connection1.takeEvents().sort((a, b) => defaultCompareStrings(a.type, b.type)),
    ).toEqual([
        {
            type: "PersistedContent",
            newVersion: 5,
            updatedCommentThreads: [
                new DocumentCommentThreadModel({
                    id: commentThread.id,
                    documentId: document.id,
                    createdTime: expect.any(Date),
                    version: 2,
                    fallbackContentSnippet: expect.any(Object),
                    isResolved: false,
                    commentCount: 1,
                    firstCommentAuthor: await session1.get(),
                }),
            ],
        },
        {
            type: "UpdateContentWithoutPersistence",
            newVersion: 5,
            steps: [
                new AddMarksAfterRemoveAllStep(
                    schema.mark("comment", {commentThreadId: commentThread.id}),
                    [{isNode: false, from: 3, to: 8}],
                ),
            ],
            stepsContentReferences: {
                ...emptyDocumentContentReferences,
                commentThreadById: new Map([
                    [commentThread.id, {commentCount: 1, commentAuthors: [await session1.get()]}],
                ]),
            },
            clientId: expect.any(String),
            updateOtherPresenceState: null,
            resolveCommentThreadIds: [],
            unresolveCommentThreadIds: [commentThread.id],
        },
    ]);

    expect(
        // Message order is not deterministic. We do not delay persistence on loading data
        // necessary from the database.
        connection2.takeEvents().sort((a, b) => defaultCompareStrings(a.type, b.type)),
    ).toEqual([
        {
            type: "PersistedContent",
            newVersion: 5,
            updatedCommentThreads: [
                new DocumentCommentThreadModel({
                    id: commentThread.id,
                    documentId: document.id,
                    createdTime: expect.any(Date),
                    version: 2,
                    fallbackContentSnippet: expect.any(Object),
                    isResolved: false,
                    commentCount: 1,
                    firstCommentAuthor: await session1.get(),
                }),
            ],
        },
        {
            type: "UpdateContentWithoutPersistence",
            newVersion: 5,
            steps: [
                new AddMarksAfterRemoveAllStep(
                    schema.mark("comment", {commentThreadId: commentThread.id}),
                    [{isNode: false, from: 3, to: 8}],
                ),
            ],
            stepsContentReferences: {
                ...emptyDocumentContentReferences,
                commentThreadById: new Map([
                    [commentThread.id, {commentCount: 1, commentAuthors: [await session1.get()]}],
                ]),
            },
            clientId: expect.any(String),
            updateOtherPresenceState: null,
            resolveCommentThreadIds: [],
            unresolveCommentThreadIds: [commentThread.id],
        },
    ]);
});

test("can connect and backfill as a viewer", async () => {
    const space = await TestSpace.create(context);
    const [session1, session2] = await space.createSessions(2);

    const document = await TestDocument.create(session1);
    await document.access.grant(session1, session2, "View");

    await document.type(session1, "Hello, ");
    const {range} = await document.type(session1, "world");
    await document.type(session1, "!");

    const commentThread = await document.createCommentThread(session1, range);

    const connection1 = await connectForTest(
        context.action(session1, {serviceName: "DocumentCollaborationService"}),
        document.id,
    );

    const connection2 = await connectForTest(
        context.action(session2, {serviceName: "DocumentCollaborationService"}),
        document.id,
        {accessLevel: "View"},
    );

    expect(
        await connection1.procedures.backfill({
            version: 1,
        }),
    ).toEqual({
        newVersion: 5,
        persistedVersion: 5,
        steps: [
            {
                clientId: expect.any(String),
                invertedStep: expect.any(ReplaceStep),
                step: new ReplaceStep(3, 3, textSlice("Hello, ")),
            },
            {
                clientId: expect.any(String),
                invertedStep: expect.any(ReplaceStep),
                step: new ReplaceStep(10, 10, textSlice("world")),
            },
            {
                clientId: expect.any(String),
                invertedStep: expect.any(ReplaceStep),
                step: new ReplaceStep(15, 15, textSlice("!")),
            },
            {
                clientId: expect.any(String),
                invertedStep: expect.any(RemoveMarkStep),
                step: new AddMarkStep(
                    10,
                    15,
                    schema.mark("comment", {commentThreadId: commentThread.id}),
                ),
            },
        ],
        stepsContentReferences: {
            ...emptyDocumentContentReferences,
            commentThreadById: new Map([
                [commentThread.id, {commentCount: 1, commentAuthors: [await session1.get()]}],
            ]),
        },
        presenceStates: [],
        rememberInvertedSteps: [],
    });

    expect(
        await connection2.procedures.backfill({
            version: 1,
        }),
    ).toEqual({
        newVersion: 5,
        persistedVersion: 5,
        steps: [
            {
                clientId: expect.any(String),
                invertedStep: expect.any(ReplaceStep),
                step: new ReplaceStep(3, 3, textSlice("Hello, ")),
            },
            {
                clientId: expect.any(String),
                invertedStep: expect.any(ReplaceStep),
                step: new ReplaceStep(10, 10, textSlice("world")),
            },
            {
                clientId: expect.any(String),
                invertedStep: expect.any(ReplaceStep),
                step: new ReplaceStep(15, 15, textSlice("!")),
            },
            {
                clientId: expect.any(String),
                invertedStep: expect.any(RemoveMarkStep),
                step: new RemoveMarkStep(0, 0, schema.mark("bold")),
            },
        ],
        stepsContentReferences: emptyDocumentContentReferences,
        presenceStates: [],
        rememberInvertedSteps: [],
    });
});

test("can\u2019t connect as a viewer and ask for comments", async () => {
    const space = await TestSpace.create(context);
    const [session1, session2] = await space.createSessions(2);

    const document = await TestDocument.create(session1);
    await document.access.grant(session1, session2, "View");

    await document.type(session1, "Hello, ");
    const {range} = await document.type(session1, "world");
    await document.type(session1, "!");

    const commentThread = await document.createCommentThread(session1, range);

    const connection1 = await connectForTest(
        context.action(session1, {serviceName: "DocumentCollaborationService"}),
        document.id,
        {accessLevel: "Comment"},
    );

    await expect(
        connectForTest(
            context.action(session2, {serviceName: "DocumentCollaborationService"}),
            document.id,
            {accessLevel: "Comment"},
        ),
    ).rejects.toThrow("Actor doesn\u2019t have `Comment` access level");

    expect(
        await connection1.procedures.backfill({
            version: 1,
        }),
    ).toEqual({
        newVersion: 5,
        persistedVersion: 5,
        steps: [
            {
                clientId: expect.any(String),
                invertedStep: expect.any(ReplaceStep),
                step: new ReplaceStep(3, 3, textSlice("Hello, ")),
            },
            {
                clientId: expect.any(String),
                invertedStep: expect.any(ReplaceStep),
                step: new ReplaceStep(10, 10, textSlice("world")),
            },
            {
                clientId: expect.any(String),
                invertedStep: expect.any(ReplaceStep),
                step: new ReplaceStep(15, 15, textSlice("!")),
            },
            {
                clientId: expect.any(String),
                invertedStep: expect.any(RemoveMarkStep),
                step: new AddMarkStep(
                    10,
                    15,
                    schema.mark("comment", {commentThreadId: commentThread.id}),
                ),
            },
        ],
        stepsContentReferences: {
            ...emptyDocumentContentReferences,
            commentThreadById: new Map([
                [commentThread.id, {commentCount: 1, commentAuthors: [await session1.get()]}],
            ]),
        },
        presenceStates: [],
        rememberInvertedSteps: [],
    });
});

test("can connect and backfill as a viewer when there are remembered steps", async () => {
    const space = await TestSpace.create(context);
    const [session1, session2] = await space.createSessions(2);

    const document = await TestDocument.create(session1);
    await document.access.grant(session1, session2, "View");

    await document.type(session1, "Hello, ");
    const {range} = await document.type(session1, "world");
    await document.type(session1, "!");

    const commentThread = await document.createCommentThread(session1, range);

    const connection1 = await connectForTest(
        context.action(session1, {serviceName: "DocumentCollaborationService"}),
        document.id,
    );

    expect(
        await connection1.procedures.backfill({
            version: 5,
        }),
    ).toEqual({
        newVersion: 5,
        persistedVersion: 5,
        steps: [],
        stepsContentReferences: emptyDocumentContentReferences,
        presenceStates: [],
        rememberInvertedSteps: [],
    });

    const pausePromise =
        documentCollaborationContentManagerBeforePersist1TestCheckpoint.pauseForTest(document.id);

    await connection1.procedures.resolveCommentThread({
        commentThreadId: commentThread.id,
    });

    const {unpause} = await pausePromise;

    const connection2 = await connectForTest(
        context.action(session2, {serviceName: "DocumentCollaborationService"}),
        document.id,
        {accessLevel: "View"},
    );

    expect(
        await connection2.procedures.backfill({
            version: 6,
        }),
    ).toEqual({
        newVersion: 6,
        persistedVersion: 5,
        steps: [],
        stepsContentReferences: emptyDocumentContentReferences,
        presenceStates: [],
        rememberInvertedSteps: [new RemoveMarkStep(0, 0, schema.mark("bold"))],
    });

    unpause();
});

test("can\u2019t update content as a viewer", async () => {
    const space = await TestSpace.create(context);
    const [session1, session2] = await space.createSessions(2);

    const document = await TestDocument.create(session1);
    await document.access.grant(session1, session2, "View");

    await document.type(session1, "Hello, ");
    const {range} = await document.type(session1, "world");
    await document.type(session1, "!");

    await document.createCommentThread(session1, range);

    const connection1 = await connectForTest(
        context.action(session1, {serviceName: "DocumentCollaborationService"}),
        document.id,
    );

    const connection2 = await connectForTest(
        context.action(session2, {serviceName: "DocumentCollaborationService"}),
        document.id,
        {accessLevel: "View"},
    );

    expect(
        await connection1.procedures.backfill({
            version: 5,
        }),
    ).toEqual({
        newVersion: 5,
        persistedVersion: 5,
        steps: [],
        stepsContentReferences: emptyDocumentContentReferences,
        presenceStates: [],
        rememberInvertedSteps: [],
    });

    expect(
        await connection2.procedures.backfill({
            version: 5,
        }),
    ).toEqual({
        newVersion: 5,
        persistedVersion: 5,
        steps: [],
        stepsContentReferences: emptyDocumentContentReferences,
        presenceStates: [],
        rememberInvertedSteps: [],
    });

    await expect(
        connection2.procedures.updateContent({
            version: 1,
            steps: [new ReplaceStep(3, 3, textSlice("a"))],
            clientId: generateId(),
            createCommentThreads: [],
            intentionallyUpdateAccessPolicy: null,
            updateOurPresenceState: {state: null},
        }),
    ).rejects.toThrow("Can\u2019t update document");

    await expect(
        connection2.procedures.updateContent({
            version: 5,
            steps: [new ReplaceStep(3, 3, textSlice("a"))],
            clientId: generateId(),
            createCommentThreads: [],
            intentionallyUpdateAccessPolicy: null,
            updateOurPresenceState: {state: null},
        }),
    ).rejects.toThrow("Can\u2019t update document");

    await ProcessContextModule.waitForTestTasks();

    expect(connection1.takeEvents()).toEqual([]);
    expect(connection2.takeEvents()).toEqual([]);
});

test("commenter can only update comment marks", async () => {
    const space = await TestSpace.create(context);
    const [session1, session2] = await space.createSessions(2);

    const document = await TestDocument.create(session1);
    await document.access.grant(session1, session2, "Comment");

    await document.type(session1, "Hello, world!");

    const connection = await connectForTest(
        context.action(session2, {serviceName: "DocumentCollaborationService"}),
        document.id,
        {accessLevel: "Comment"},
    );

    const {newVersion} = await connection.procedures.backfill({
        version: 2,
    });

    const commentThreadId = generateId<DocumentCommentThreadId>();

    await connection.procedures.updateContent({
        version: newVersion,
        steps: [new AddMarkStep(3, 8, schema.mark("comment", {commentThreadId}))],
        clientId: generateId<ContentEditorClientId>(),
        createCommentThreads: [
            {
                commentThreadId,
                initialCommentContent: createSimpleMessageContent("Test comment"),
                initialCommentFileIds: [],
                createdTimeZone: defaultTimeZone,
            },
        ],
        intentionallyUpdateAccessPolicy: null,
        updateOurPresenceState: {state: null},
    });

    await expect(
        connection.procedures.updateContent({
            version: newVersion + 1,
            steps: [new ReplaceStep(3, 3, textSlice("a"))],
            clientId: generateId<ContentEditorClientId>(),
            createCommentThreads: [],
            intentionallyUpdateAccessPolicy: null,
            updateOurPresenceState: {state: null},
        }),
    ).rejects.toThrow("Can\u2019t update document");
});

test("can\u2019t call comment procedures as viewer", async () => {
    const space = await TestSpace.create(context);
    const [session1, session2] = await space.createSessions(2);

    const document = await TestDocument.create(session1);
    await document.access.grant(session1, session2, "View");

    await document.type(session1, "Hello, ");
    const {range} = await document.type(session1, "world");
    await document.type(session1, "!");

    const commentThread = await document.createCommentThread(session1, range);

    const connection1 = await connectForTest(
        context.action(session1, {serviceName: "DocumentCollaborationService"}),
        document.id,
    );

    const connection2 = await connectForTest(
        context.action(session2, {serviceName: "DocumentCollaborationService"}),
        document.id,
        {accessLevel: "View"},
    );

    await expect(
        connection2.procedures.backfillComments({
            commentThreadId: commentThread.id,
            checkpoint: generateServerSynchronizationCheckpoint(),
            clientCommentCount: 0,
            newCommentLimit: 100,
        }),
    ).rejects.toThrow("Can\u2019t see document comments");

    await connection1.procedures.backfillComments({
        commentThreadId: commentThread.id,
        checkpoint: generateServerSynchronizationCheckpoint(),
        clientCommentCount: 0,
        newCommentLimit: 100,
    });

    await expect(
        connection2.procedures.createComment({
            commentThreadId: commentThread.id,
            parent: null,
            content: createSimpleMessageContent("foo"),
            fileIds: [],
            createdTimeZone: defaultTimeZone,
        }),
    ).rejects.toThrow("Can\u2019t see document comments");

    const oldContent = createSimpleMessageContent("bar");

    await connection1.procedures.createComment({
        commentThreadId: commentThread.id,
        parent: null,
        content: oldContent,
        fileIds: [],
        createdTimeZone: defaultTimeZone,
    });

    await expect(
        connection2.procedures.updateCommentContent({
            commentThreadId: commentThread.id,
            commentIndex: 1,
            contentVersion: 0,
            steps: [
                new ReplaceStep(
                    0,
                    oldContent.content.size,
                    new Slice(createSimpleMessageContent("foo2").content, 0, 0),
                ),
            ],
        }),
    ).rejects.toThrow("Can\u2019t see document comments");

    await connection1.procedures.updateCommentContent({
        commentThreadId: commentThread.id,
        commentIndex: 1,
        contentVersion: 0,
        steps: [
            new ReplaceStep(
                0,
                oldContent.content.size,
                new Slice(createSimpleMessageContent("bar2").content, 0, 0),
            ),
        ],
    });

    await expect(
        connection2.procedures.deleteComment({
            commentThreadId: commentThread.id,
            commentIndex: 0,
        }),
    ).rejects.toThrow("Can\u2019t see document comments");

    await connection1.procedures.deleteComment({
        commentThreadId: commentThread.id,
        commentIndex: 0,
    });

    await expect(
        connection2.procedures.startTypingInCommentInput({
            commentThreadId: commentThread.id,
        }),
    ).rejects.toThrow("Can\u2019t see document comments");

    await connection1.procedures.startTypingInCommentInput({
        commentThreadId: commentThread.id,
    });

    await expect(
        connection2.procedures.stopTypingInCommentInput({
            commentThreadId: commentThread.id,
        }),
    ).rejects.toThrow("Can\u2019t see document comments");

    await connection1.procedures.stopTypingInCommentInput({
        commentThreadId: commentThread.id,
    });

    await expect(
        connection2.procedures.getCommentThreadAndInitialCommentsIfExists({
            commentThreadId: commentThread.id,
            limit: 100,
        }),
    ).rejects.toThrow("Can\u2019t see document comments");

    await connection1.procedures.getCommentThreadAndInitialCommentsIfExists({
        commentThreadId: commentThread.id,
        limit: 100,
    });

    await expect(
        connection2.procedures.getCommentsFromStart({
            commentThreadId: commentThread.id,
            limit: 100,
            afterCommentIndex: null,
            beforeCommentIndex: null,
        }),
    ).rejects.toThrow("Can\u2019t see document comments");

    await connection1.procedures.getCommentsFromStart({
        commentThreadId: commentThread.id,
        limit: 100,
        afterCommentIndex: null,
        beforeCommentIndex: null,
    });

    await expect(
        connection2.procedures.getCommentsFromEnd({
            commentThreadId: commentThread.id,
            limit: 100,
            afterCommentIndex: null,
            beforeCommentIndex: null,
        }),
    ).rejects.toThrow("Can\u2019t see document comments");

    await connection1.procedures.getCommentsFromEnd({
        commentThreadId: commentThread.id,
        limit: 100,
        afterCommentIndex: null,
        beforeCommentIndex: null,
    });

    await expect(
        connection2.procedures.resolveCommentThread({
            commentThreadId: commentThread.id,
        }),
    ).rejects.toThrow("Can\u2019t see document comments");

    await connection1.procedures.resolveCommentThread({
        commentThreadId: commentThread.id,
    });

    await ProcessContextModule.waitForTestTasks();

    await expect(
        connection2.procedures.unresolveCommentThread({
            commentThreadId: commentThread.id,
        }),
    ).rejects.toThrow("Can\u2019t see document comments");

    await connection1.procedures.unresolveCommentThread({
        commentThreadId: commentThread.id,
    });
});

test("viewer receives update events without comment data", async () => {
    const space = await TestSpace.create(context);
    const [session1, session2, session3] = await space.createSessions(3);

    const document = await TestDocument.create(session1);
    await document.access.grant(session1, session2, "Comment");
    await document.access.grant(session1, session3, "View");

    const client1Id = generateId<ContentEditorClientId>();

    const connection1 = await connectForTest(
        context.action(session1, {serviceName: "DocumentCollaborationService"}),
        document.id,
    );

    const connection2 = await connectForTest(
        context.action(session2, {serviceName: "DocumentCollaborationService"}),
        document.id,
        {accessLevel: "Comment"},
    );

    const connection3 = await connectForTest(
        context.action(session2, {serviceName: "DocumentCollaborationService"}),
        document.id,
        {accessLevel: "View"},
    );

    expect(
        await connection1.procedures.backfill({
            version: 2,
        }),
    ).toEqual({
        newVersion: 2,
        persistedVersion: 2,
        steps: [],
        stepsContentReferences: emptyDocumentContentReferences,
        presenceStates: [],
        rememberInvertedSteps: [],
    });

    expect(
        await connection2.procedures.backfill({
            version: 2,
        }),
    ).toEqual({
        newVersion: 2,
        persistedVersion: 2,
        steps: [],
        stepsContentReferences: emptyDocumentContentReferences,
        presenceStates: [],
        rememberInvertedSteps: [],
    });

    expect(
        await connection3.procedures.backfill({
            version: 2,
        }),
    ).toEqual({
        newVersion: 2,
        persistedVersion: 2,
        steps: [],
        stepsContentReferences: emptyDocumentContentReferences,
        presenceStates: [],
        rememberInvertedSteps: [],
    });

    await ProcessContextModule.waitForTestTasks();

    expect(connection1.takeEvents()).toEqual([]);
    expect(connection2.takeEvents()).toEqual([]);
    expect(connection3.takeEvents()).toEqual([]);

    await connection1.procedures.updateContent({
        version: 2,
        steps: [new ReplaceStep(3, 3, textSlice("Hello, "))],
        clientId: client1Id,
        createCommentThreads: [],
        intentionallyUpdateAccessPolicy: null,
        updateOurPresenceState: {state: null},
    });

    await ProcessContextModule.waitForTestTasks();

    expect(
        // Message order is not deterministic. We do not delay persistence on loading data
        // necessary from the database.
        connection1.takeEvents().sort((a, b) => defaultCompareStrings(a.type, b.type)),
    ).toEqual([
        {
            type: "PersistedContent",
            newVersion: 3,
            updatedCommentThreads: emptyArray,
        },
        {
            type: "UpdateContentWithoutPersistence",
            newVersion: 3,
            steps: [new ReplaceStep(3, 3, textSlice("Hello, "))],
            stepsContentReferences: emptyDocumentContentReferences,
            clientId: client1Id,
            updateOtherPresenceState: {connectionId: connection1.id, state: null},
            resolveCommentThreadIds: [],
            unresolveCommentThreadIds: [],
        },
    ]);

    expect(
        // Message order is not deterministic. We do not delay persistence on loading data
        // necessary from the database.
        connection2.takeEvents().sort((a, b) => defaultCompareStrings(a.type, b.type)),
    ).toEqual([
        {
            type: "PersistedContent",
            newVersion: 3,
            updatedCommentThreads: emptyArray,
        },
        {
            type: "UpdateContentWithoutPersistence",
            newVersion: 3,
            steps: [new ReplaceStep(3, 3, textSlice("Hello, "))],
            stepsContentReferences: emptyDocumentContentReferences,
            clientId: client1Id,
            updateOtherPresenceState: {connectionId: connection1.id, state: null},
            resolveCommentThreadIds: [],
            unresolveCommentThreadIds: [],
        },
    ]);

    expect(
        // Message order is not deterministic. We do not delay persistence on loading data
        // necessary from the database.
        connection3.takeEvents().sort((a, b) => defaultCompareStrings(a.type, b.type)),
    ).toEqual([
        {
            type: "PersistedContent",
            newVersion: 3,
            updatedCommentThreads: emptyArray,
        },
        {
            type: "UpdateContentWithoutPersistence",
            newVersion: 3,
            steps: [new ReplaceStep(3, 3, textSlice("Hello, "))],
            stepsContentReferences: emptyDocumentContentReferences,
            clientId: client1Id,
            updateOtherPresenceState: {connectionId: connection1.id, state: null},
            resolveCommentThreadIds: [],
            unresolveCommentThreadIds: [],
        },
    ]);

    await connection1.procedures.updateContent({
        version: 3,
        steps: [new ReplaceStep(7, 7, textSlice("world!"))],
        clientId: client1Id,
        createCommentThreads: [],
        intentionallyUpdateAccessPolicy: null,
        updateOurPresenceState: {state: null},
    });

    await ProcessContextModule.waitForTestTasks();

    expect(
        // Message order is not deterministic. We do not delay persistence on loading data
        // necessary from the database.
        connection1.takeEvents().sort((a, b) => defaultCompareStrings(a.type, b.type)),
    ).toEqual([
        {
            type: "PersistedContent",
            newVersion: 4,
            updatedCommentThreads: emptyArray,
        },
        {
            type: "UpdateContentWithoutPersistence",
            newVersion: 4,
            steps: [new ReplaceStep(7, 7, textSlice("world!"))],
            stepsContentReferences: emptyDocumentContentReferences,
            clientId: client1Id,
            updateOtherPresenceState: {connectionId: connection1.id, state: null},
            resolveCommentThreadIds: [],
            unresolveCommentThreadIds: [],
        },
    ]);

    expect(
        // Message order is not deterministic. We do not delay persistence on loading data
        // necessary from the database.
        connection2.takeEvents().sort((a, b) => defaultCompareStrings(a.type, b.type)),
    ).toEqual([
        {
            type: "PersistedContent",
            newVersion: 4,
            updatedCommentThreads: emptyArray,
        },
        {
            type: "UpdateContentWithoutPersistence",
            newVersion: 4,
            steps: [new ReplaceStep(7, 7, textSlice("world!"))],
            stepsContentReferences: emptyDocumentContentReferences,
            clientId: client1Id,
            updateOtherPresenceState: {connectionId: connection1.id, state: null},
            resolveCommentThreadIds: [],
            unresolveCommentThreadIds: [],
        },
    ]);

    expect(
        // Message order is not deterministic. We do not delay persistence on loading data
        // necessary from the database.
        connection3.takeEvents().sort((a, b) => defaultCompareStrings(a.type, b.type)),
    ).toEqual([
        {
            type: "PersistedContent",
            newVersion: 4,
            updatedCommentThreads: emptyArray,
        },
        {
            type: "UpdateContentWithoutPersistence",
            newVersion: 4,
            steps: [new ReplaceStep(7, 7, textSlice("world!"))],
            stepsContentReferences: emptyDocumentContentReferences,
            clientId: client1Id,
            updateOtherPresenceState: {connectionId: connection1.id, state: null},
            resolveCommentThreadIds: [],
            unresolveCommentThreadIds: [],
        },
    ]);

    const commentThreadId = generateId<DocumentCommentThreadId>();

    await connection1.procedures.updateContent({
        version: 4,
        steps: [new AddMarkStep(7, 12, schema.mark("comment", {commentThreadId}))],
        clientId: client1Id,
        createCommentThreads: [
            {
                commentThreadId,
                initialCommentContent: createSimpleMessageContent("Test comment 1"),
                initialCommentFileIds: [],
                createdTimeZone: defaultTimeZone,
            },
        ],
        intentionallyUpdateAccessPolicy: null,
        updateOurPresenceState: {state: null},
    });

    await ProcessContextModule.waitForTestTasks();

    expect(
        // Message order is not deterministic. We do not delay persistence on loading data
        // necessary from the database.
        connection1.takeEvents().sort((a, b) => defaultCompareStrings(a.type, b.type)),
    ).toEqual([
        {
            type: "PersistedContent",
            newVersion: 5,
            updatedCommentThreads: emptyArray,
        },
        {
            type: "UpdateContentWithoutPersistence",
            newVersion: 5,
            steps: [new AddMarkStep(7, 12, schema.mark("comment", {commentThreadId}))],
            stepsContentReferences: {
                ...emptyDocumentContentReferences,
                commentThreadById: new Map([
                    [commentThreadId, {commentCount: 1, commentAuthors: [await session1.get()]}],
                ]),
            },
            clientId: client1Id,
            updateOtherPresenceState: {connectionId: connection1.id, state: null},
            resolveCommentThreadIds: [],
            unresolveCommentThreadIds: [],
        },
    ]);

    expect(
        // Message order is not deterministic. We do not delay persistence on loading data
        // necessary from the database.
        connection2.takeEvents().sort((a, b) => defaultCompareStrings(a.type, b.type)),
    ).toEqual([
        {
            type: "PersistedContent",
            newVersion: 5,
            updatedCommentThreads: emptyArray,
        },
        {
            type: "UpdateContentWithoutPersistence",
            newVersion: 5,
            steps: [new AddMarkStep(7, 12, schema.mark("comment", {commentThreadId}))],
            stepsContentReferences: {
                ...emptyDocumentContentReferences,
                commentThreadById: new Map([
                    [commentThreadId, {commentCount: 1, commentAuthors: [await session1.get()]}],
                ]),
            },
            clientId: client1Id,
            updateOtherPresenceState: {connectionId: connection1.id, state: null},
            resolveCommentThreadIds: [],
            unresolveCommentThreadIds: [],
        },
    ]);

    expect(
        // Message order is not deterministic. We do not delay persistence on loading data
        // necessary from the database.
        connection3.takeEvents().sort((a, b) => defaultCompareStrings(a.type, b.type)),
    ).toEqual([
        {
            type: "PersistedContent",
            newVersion: 5,
            updatedCommentThreads: emptyArray,
        },
        {
            type: "UpdateContentWithoutPersistence",
            newVersion: 5,
            steps: [new RemoveMarkStep(0, 0, schema.mark("bold"))],
            stepsContentReferences: emptyDocumentContentReferences,
            clientId: client1Id,
            updateOtherPresenceState: {connectionId: connection1.id, state: null},
            resolveCommentThreadIds: [],
            unresolveCommentThreadIds: [],
        },
    ]);

    await connection1.procedures.backfillComments({
        commentThreadId,
        checkpoint: generateServerSynchronizationCheckpoint(),
        clientCommentCount: 0,
        newCommentLimit: 100,
    });

    await connection2.procedures.backfillComments({
        commentThreadId,
        checkpoint: generateServerSynchronizationCheckpoint(),
        clientCommentCount: 0,
        newCommentLimit: 100,
    });

    await expect(
        connection3.procedures.backfillComments({
            commentThreadId,
            checkpoint: generateServerSynchronizationCheckpoint(),
            clientCommentCount: 0,
            newCommentLimit: 100,
        }),
    ).rejects.toThrow("Can\u2019t see document comments");

    await ProcessContextModule.waitForTestTasks();

    expect(connection1.takeEvents()).toEqual([]);
    expect(connection2.takeEvents()).toEqual([]);
    expect(connection3.takeEvents()).toEqual([]);

    await connection2.procedures.createComment({
        commentThreadId,
        parent: null,
        content: createSimpleMessageContent("Test comment 2"),
        fileIds: [],
        createdTimeZone: defaultTimeZone,
    });

    await ProcessContextModule.waitForTestTasks();

    expect(
        // Message order is not deterministic. We do not delay persistence on loading data
        // necessary from the database.
        connection1.takeEvents().sort((a, b) => defaultCompareStrings(a.type, b.type)),
    ).toEqual([
        {
            type: "Comments",
            commentThreadId,
            event: {
                type: "NewMessage",
                message: expect.any(DocumentCommentModel),
                updateOtherTypingState: null,
            },
        },
    ]);

    expect(
        // Message order is not deterministic. We do not delay persistence on loading data
        // necessary from the database.
        connection2.takeEvents().sort((a, b) => defaultCompareStrings(a.type, b.type)),
    ).toEqual([
        {
            type: "Comments",
            commentThreadId,
            event: {
                type: "NewMessage",
                message: expect.any(DocumentCommentModel),
                updateOtherTypingState: null,
            },
        },
    ]);

    expect(
        // Message order is not deterministic. We do not delay persistence on loading data
        // necessary from the database.
        connection3.takeEvents().sort((a, b) => defaultCompareStrings(a.type, b.type)),
    ).toEqual([]);

    await connection1.procedures.resolveCommentThread({
        commentThreadId,
    });

    await ProcessContextModule.waitForTestTasks();

    expect(
        // Message order is not deterministic. We do not delay persistence on loading data
        // necessary from the database.
        connection1.takeEvents().sort((a, b) => defaultCompareStrings(a.type, b.type)),
    ).toEqual([
        {
            type: "PersistedContent",
            newVersion: 6,
            updatedCommentThreads: [expect.any(DocumentCommentThreadModel)],
        },
        {
            type: "UpdateContentWithoutPersistence",
            newVersion: 6,
            steps: [new RemoveAllMarksStep(schema.mark("comment", {commentThreadId}))],
            stepsContentReferences: emptyDocumentContentReferences,
            clientId: expect.any(String),
            updateOtherPresenceState: null,
            resolveCommentThreadIds: [commentThreadId],
            unresolveCommentThreadIds: [],
        },
    ]);

    expect(
        // Message order is not deterministic. We do not delay persistence on loading data
        // necessary from the database.
        connection2.takeEvents().sort((a, b) => defaultCompareStrings(a.type, b.type)),
    ).toEqual([
        {
            type: "PersistedContent",
            newVersion: 6,
            updatedCommentThreads: [expect.any(DocumentCommentThreadModel)],
        },
        {
            type: "UpdateContentWithoutPersistence",
            newVersion: 6,
            steps: [new RemoveAllMarksStep(schema.mark("comment", {commentThreadId}))],
            stepsContentReferences: emptyDocumentContentReferences,
            clientId: expect.any(String),
            updateOtherPresenceState: null,
            resolveCommentThreadIds: [commentThreadId],
            unresolveCommentThreadIds: [],
        },
    ]);

    expect(
        // Message order is not deterministic. We do not delay persistence on loading data
        // necessary from the database.
        connection3.takeEvents().sort((a, b) => defaultCompareStrings(a.type, b.type)),
    ).toEqual([
        {
            type: "PersistedContent",
            newVersion: 6,
            updatedCommentThreads: [],
        },
        {
            type: "UpdateContentWithoutPersistence",
            newVersion: 6,
            steps: [new RemoveMarkStep(0, 0, schema.mark("bold"))],
            stepsContentReferences: emptyDocumentContentReferences,
            clientId: expect.any(String),
            updateOtherPresenceState: null,
            resolveCommentThreadIds: [],
            unresolveCommentThreadIds: [],
        },
    ]);

    await connection1.procedures.unresolveCommentThread({
        commentThreadId,
    });

    await ProcessContextModule.waitForTestTasks();

    expect(
        // Message order is not deterministic. We do not delay persistence on loading data
        // necessary from the database.
        connection1.takeEvents().sort((a, b) => defaultCompareStrings(a.type, b.type)),
    ).toEqual([
        {
            type: "PersistedContent",
            newVersion: 7,
            updatedCommentThreads: [expect.any(DocumentCommentThreadModel)],
        },
        {
            type: "UpdateContentWithoutPersistence",
            newVersion: 7,
            steps: [
                new AddMarksAfterRemoveAllStep(schema.mark("comment", {commentThreadId}), [
                    {from: 7, to: 12, isNode: false},
                ]),
            ],
            stepsContentReferences: {
                ...emptyDocumentContentReferences,
                commentThreadById: new Map([
                    [
                        commentThreadId,
                        {
                            commentCount: 2,
                            commentAuthors: await runAllPromises([session1.get(), session2.get()]),
                        },
                    ],
                ]),
            },
            clientId: expect.any(String),
            updateOtherPresenceState: null,
            resolveCommentThreadIds: [],
            unresolveCommentThreadIds: [commentThreadId],
        },
    ]);

    expect(
        // Message order is not deterministic. We do not delay persistence on loading data
        // necessary from the database.
        connection2.takeEvents().sort((a, b) => defaultCompareStrings(a.type, b.type)),
    ).toEqual([
        {
            type: "PersistedContent",
            newVersion: 7,
            updatedCommentThreads: [expect.any(DocumentCommentThreadModel)],
        },
        {
            type: "UpdateContentWithoutPersistence",
            newVersion: 7,
            steps: [
                new AddMarksAfterRemoveAllStep(schema.mark("comment", {commentThreadId}), [
                    {from: 7, to: 12, isNode: false},
                ]),
            ],
            stepsContentReferences: {
                ...emptyDocumentContentReferences,
                commentThreadById: new Map([
                    [
                        commentThreadId,
                        {
                            commentCount: 2,
                            commentAuthors: await runAllPromises([session1.get(), session2.get()]),
                        },
                    ],
                ]),
            },
            clientId: expect.any(String),
            updateOtherPresenceState: null,
            resolveCommentThreadIds: [],
            unresolveCommentThreadIds: [commentThreadId],
        },
    ]);

    expect(
        // Message order is not deterministic. We do not delay persistence on loading data
        // necessary from the database.
        connection3.takeEvents().sort((a, b) => defaultCompareStrings(a.type, b.type)),
    ).toEqual([
        {
            type: "PersistedContent",
            newVersion: 7,
            updatedCommentThreads: [],
        },
        {
            type: "UpdateContentWithoutPersistence",
            newVersion: 7,
            steps: [new RemoveMarkStep(0, 0, schema.mark("bold"))],
            stepsContentReferences: emptyDocumentContentReferences,
            clientId: expect.any(String),
            updateOtherPresenceState: null,
            resolveCommentThreadIds: [],
            unresolveCommentThreadIds: [],
        },
    ]);
});

test("can update access policy", async () => {
    const space = await TestSpace.create(context);
    const [session1, session2] = await space.createSessions(2);

    const document = await TestDocument.create(session1);

    await document.type(session1, "Hello, ");
    const {range} = await document.type(session1, "world");
    await document.type(session1, "!");

    await document.createCommentThread(session1, range);

    const client1Id = generateId<ContentEditorClientId>();

    const connection1 = await connectForTest(context.action(session1), document.id);

    await expect(connectForTest(context.action(session2), document.id)).rejects.toThrow(
        "Actor doesn\u2019t have `Manage` access level",
    );

    const accessPolicy1: AccessPolicy = {
        type: "Local",
        accountGrantById: new Map([[session1.account.id, {level: "Manage", generation: 0}]]),
        defaultGrant: null,
        urlGrant: null,
    };

    const accessPolicy2: AccessPolicy = {
        type: "Local",
        accountGrantById: new Map([[session1.account.id, {level: "Manage", generation: 0}]]),
        defaultGrant: {level: "Comment"},
        urlGrant: null,
    };

    await connection1.procedures.updateContent({
        version: 1,
        steps: [new DocAttrStep("accessPolicy", accessPolicy2)],
        clientId: client1Id,
        createCommentThreads: [],
        intentionallyUpdateAccessPolicy: {accessPolicy: accessPolicy2, notification: null},
        updateOurPresenceState: {state: null},
    });

    await ProcessContextModule.waitForTestTasks();

    const connection2a = await connectForTest(context.action(session2), document.id, {
        accessLevel: "Comment",
    });

    await connection1.procedures.updateContent({
        version: 2,
        steps: [new DocAttrStep("accessPolicy", accessPolicy1)],
        clientId: client1Id,
        createCommentThreads: [],
        intentionallyUpdateAccessPolicy: {accessPolicy: accessPolicy1, notification: null},
        updateOurPresenceState: {state: null},
    });

    await ProcessContextModule.waitForTestTasks();

    await expect(connection2a.authorize()).rejects.toThrow(
        "Actor doesn\u2019t have `Comment` access level",
    );

    expect(connection2a.getCloseError()).toBeInstanceOf(PermissionDeniedError);

    const pausePromise1 =
        documentCollaborationContentManagerBeforePersist1TestCheckpoint.pauseForTest(document.id);

    await connection1.procedures.updateContent({
        version: 3,
        steps: [new DocAttrStep("accessPolicy", accessPolicy2)],
        clientId: client1Id,
        createCommentThreads: [],
        intentionallyUpdateAccessPolicy: {accessPolicy: accessPolicy2, notification: null},
        updateOurPresenceState: {state: null},
    });

    const {unpause: unpause1} = await pausePromise1;

    await expect(connectForTest(context.action(session2), document.id)).rejects.toThrow(
        "Actor doesn\u2019t have `Manage` access level",
    );

    await connection1.procedures.updateContent({
        version: 4,
        steps: [new DocAttrStep("accessPolicy", accessPolicy1)],
        clientId: client1Id,
        createCommentThreads: [],
        intentionallyUpdateAccessPolicy: {accessPolicy: accessPolicy1, notification: null},
        updateOurPresenceState: {state: null},
    });

    unpause1();
    await ProcessContextModule.waitForTestTasks();

    await expect(connectForTest(context.action(session2), document.id)).rejects.toThrow(
        "Actor doesn\u2019t have `Manage` access level",
    );

    const pausePromise2 =
        documentCollaborationContentManagerBeforePersist1TestCheckpoint.pauseForTest(document.id);

    await connection1.procedures.updateContent({
        version: 5,
        steps: [new DocAttrStep("accessPolicy", accessPolicy2)],
        clientId: client1Id,
        createCommentThreads: [],
        intentionallyUpdateAccessPolicy: {accessPolicy: accessPolicy2, notification: null},
        updateOurPresenceState: {state: null},
    });

    const {unpause: unpause2} = await pausePromise2;

    await expect(connectForTest(context.action(session2), document.id)).rejects.toThrow(
        "Actor doesn\u2019t have `Manage` access level",
    );

    await connection1.procedures.updateContent({
        version: 6,
        steps: [new ReplaceStep(3, 3, textSlice("a"))],
        clientId: client1Id,
        createCommentThreads: [],
        intentionallyUpdateAccessPolicy: null,
        updateOurPresenceState: {state: null},
    });

    unpause2();
    await ProcessContextModule.waitForTestTasks();

    await connectForTest(context.action(session2), document.id, {accessLevel: "Comment"});
});

test("can\u2019t update access policy unintentionally", async () => {
    const space = await TestSpace.create(context);
    const [session1, session2] = await space.createSessions(2);

    const document = await TestDocument.create(session1);

    await document.type(session1, "Hello, ");
    const {range} = await document.type(session1, "world");
    await document.type(session1, "!");

    await document.createCommentThread(session1, range);

    const client1Id = generateId<ContentEditorClientId>();

    const connection1 = await connectForTest(context.action(session1), document.id);

    await expect(connectForTest(context.action(session2), document.id)).rejects.toThrow(
        "Actor doesn\u2019t have `Manage` access level",
    );

    const accessPolicy2: AccessPolicy = {
        type: "Local",
        accountGrantById: new Map([[session1.account.id, {level: "Manage", generation: 0}]]),
        defaultGrant: {level: "Comment"},
        urlGrant: null,
    };

    await connection1.procedures.updateContent({
        version: 4,
        steps: [new DocAttrStep("accessPolicy", accessPolicy2)],
        clientId: client1Id,
        createCommentThreads: [],
        intentionallyUpdateAccessPolicy: null,
        updateOurPresenceState: {state: null},
    });

    await ProcessContextModule.waitForTestTasks();

    expect(
        // Message order is not deterministic. We do not delay persistence on loading data
        // necessary from the database.
        connection1.takeEvents().sort((a, b) => defaultCompareStrings(a.type, b.type)),
    ).toEqual([
        {
            type: "Error",
            error: new InternalError(
                "Can\u2019t update the document\u2019s access policy unless `intentionallyUpdateAccessPolicy` is provided",
            ),
        },
        {
            type: "UpdateContentWithoutPersistence",
            newVersion: 5,
            steps: [new DocAttrStep("accessPolicy", accessPolicy2)],
            stepsContentReferences: emptyDocumentContentReferences,
            clientId: client1Id,
            updateOtherPresenceState: {connectionId: connection1.id, state: null},
            resolveCommentThreadIds: [],
            unresolveCommentThreadIds: [],
        },
    ]);

    expect(connection1.isClosed()).toEqual(true);

    await expect(connectForTest(context.action(session2), document.id)).rejects.toThrow(
        "Actor doesn\u2019t have `View` access level",
    );
});

test("can\u2019t update access policy with the wrong intentional policy", async () => {
    const space = await TestSpace.create(context);
    const [session1, session2] = await space.createSessions(2);

    const document = await TestDocument.create(session1);

    await document.type(session1, "Hello, ");
    const {range} = await document.type(session1, "world");
    await document.type(session1, "!");

    await document.createCommentThread(session1, range);

    const client1Id = generateId<ContentEditorClientId>();

    const connection1 = await connectForTest(context.action(session1), document.id);

    await expect(connectForTest(context.action(session2), document.id)).rejects.toThrow(
        "Actor doesn\u2019t have `Manage` access level",
    );

    const accessPolicy2a: AccessPolicy = {
        type: "Local",
        accountGrantById: new Map([[session1.account.id, {level: "Manage", generation: 0}]]),
        defaultGrant: {level: "Comment"},
        urlGrant: null,
    };

    const accessPolicy2b: AccessPolicy = {
        type: "Local",
        accountGrantById: new Map([[session1.account.id, {level: "Manage", generation: 0}]]),
        defaultGrant: {level: "Edit"},
        urlGrant: null,
    };

    await connection1.procedures.updateContent({
        version: 4,
        steps: [new DocAttrStep("accessPolicy", accessPolicy2a)],
        clientId: client1Id,
        createCommentThreads: [],
        intentionallyUpdateAccessPolicy: {accessPolicy: accessPolicy2b, notification: null},
        updateOurPresenceState: {state: null},
    });

    await ProcessContextModule.waitForTestTasks();

    expect(
        // Message order is not deterministic. We do not delay persistence on loading data
        // necessary from the database.
        connection1.takeEvents().sort((a, b) => defaultCompareStrings(a.type, b.type)),
    ).toEqual([
        {
            type: "Error",
            error: new InternalError(
                "The document\u2019s new access policy doesn\u2019t match `intentionallyUpdateAccessPolicy`",
            ),
        },
        {
            type: "UpdateContentWithoutPersistence",
            newVersion: 5,
            steps: [new DocAttrStep("accessPolicy", accessPolicy2a)],
            stepsContentReferences: emptyDocumentContentReferences,
            clientId: client1Id,
            updateOtherPresenceState: {connectionId: connection1.id, state: null},
            resolveCommentThreadIds: [],
            unresolveCommentThreadIds: [],
        },
    ]);

    expect(connection1.isClosed()).toEqual(true);

    await expect(connectForTest(context.action(session2), document.id)).rejects.toThrow(
        "Actor doesn\u2019t have `View` access level",
    );
});

test("can get presence updates across viewer/editor connections", async () => {
    const space = await TestSpace.create(context);
    const [session1, session2] = await space.createSessions(2);

    const document = await TestDocument.create(session1);
    await document.access.grant(session1, session2, "View");

    await document.type(session1, "Hello, ");
    const {range} = await document.type(session1, "world");
    await document.type(session1, "!");

    await document.createCommentThread(session1, range);

    const connection1 = await connectForTest(
        context.action(session1, {serviceName: "DocumentCollaborationService"}),
        document.id,
    );

    const connection2 = await connectForTest(
        context.action(session2, {serviceName: "DocumentCollaborationService"}),
        document.id,
        {accessLevel: "View"},
    );

    expect(
        await connection1.procedures.backfill({
            version: 5,
        }),
    ).toEqual({
        newVersion: 5,
        persistedVersion: 5,
        steps: [],
        stepsContentReferences: emptyDocumentContentReferences,
        presenceStates: [],
        rememberInvertedSteps: [],
    });

    expect(
        await connection2.procedures.backfill({
            version: 5,
        }),
    ).toEqual({
        newVersion: 5,
        persistedVersion: 5,
        steps: [],
        stepsContentReferences: emptyDocumentContentReferences,
        presenceStates: [],
        rememberInvertedSteps: [],
    });

    expect(connection1.takeEvents()).toEqual([]);
    expect(connection2.takeEvents()).toEqual([]);

    await connection1.procedures.updateOurPresenceState({
        state: {
            version: 5,
            selection: ContentSelectionWrapper.new(
                TextSelection.near((await document.get()).content.doc.resolve(5)),
            ),
        },
    });

    expect(connection1.takeEvents()).toEqual([]);

    expect(connection2.takeEvents()).toEqual([
        {
            type: "UpdateOtherPresenceState",
            connectionId: connection1.id,
            state: {
                version: 5,
                selection: ContentSelectionWrapper.new(
                    TextSelection.near((await document.get()).content.doc.resolve(5)),
                ),
            },
        },
    ]);

    await connection2.procedures.updateOurPresenceState({
        state: {
            version: 5,
            selection: ContentSelectionWrapper.new(
                TextSelection.near((await document.get()).content.doc.resolve(7)),
            ),
        },
    });

    expect(connection1.takeEvents()).toEqual([
        {
            type: "UpdateOtherPresenceState",
            connectionId: connection2.id,
            state: {
                version: 5,
                selection: ContentSelectionWrapper.new(
                    TextSelection.near((await document.get()).content.doc.resolve(7)),
                ),
            },
        },
    ]);

    expect(connection2.takeEvents()).toEqual([]);

    expect(
        await connection1.procedures.backfill({
            version: 5,
        }),
    ).toEqual({
        newVersion: 5,
        persistedVersion: 5,
        steps: [],
        stepsContentReferences: emptyDocumentContentReferences,
        presenceStates: [
            {
                connectionId: connection2.id,
                state: {
                    version: 5,
                    selection: ContentSelectionWrapper.new(
                        TextSelection.near((await document.get()).content.doc.resolve(7)),
                    ),
                },
            },
        ],
        rememberInvertedSteps: [],
    });

    expect(
        await connection2.procedures.backfill({
            version: 5,
        }),
    ).toEqual({
        newVersion: 5,
        persistedVersion: 5,
        steps: [],
        stepsContentReferences: emptyDocumentContentReferences,
        presenceStates: [
            {
                connectionId: connection1.id,
                state: {
                    version: 5,
                    selection: ContentSelectionWrapper.new(
                        TextSelection.near((await document.get()).content.doc.resolve(5)),
                    ),
                },
            },
        ],
        rememberInvertedSteps: [],
    });
});

describe("update-content-with-diff route", () => {
    test("updates document content", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();
        const document = await TestDocument.create(session);

        const response = await fetchForTest(
            context.action(session),
            document.id,
            createUpdateContentWithDiffRequest({version: 0, text: "New notes"}),
        );

        expect(await readUpdateContentWithDiffResponse(response)).toMatchObject({
            ok: true,
            spaceId: space.id,
            newVersion: 1,
            newContent: expect.objectContaining({
                textContent: "New notes",
            }),
        });
    });

    test("requires edit access", async () => {
        const space = await TestSpace.create(context);
        const session1 = await space.createSession();
        const session2 = await space.createSession();

        const document = await TestDocument.create(session1, {
            access: {
                type: "Local",
                accountGrantById: new Map([
                    [session1.account.id, {level: "Manage", generation: 0}],
                ]),
                defaultGrant: {level: "View"},
                urlGrant: null,
            },
        });

        await connectForTest(context.action(session1), document.id);

        const response = await fetchForTest(
            context.action(session2),
            document.id,
            createUpdateContentWithDiffRequest({version: 0, text: "New notes"}),
        );

        expect(await readUpdateContentWithDiffResponse(response)).toMatchObject({
            ok: false,
            error: expect.any(PermissionDeniedError),
        });
    });

    test("doesn\u2019t mutate document content when authorization fails", async () => {
        const space = await TestSpace.create(context);
        const session1 = await space.createSession();
        const session2 = await space.createSession();

        const document = await TestDocument.create(session1, {
            access: {
                type: "Local",
                accountGrantById: new Map([
                    [session1.account.id, {level: "Manage", generation: 0}],
                ]),
                defaultGrant: {level: "View"},
                urlGrant: null,
            },
        });

        const editorResponse = await fetchForTest(
            context.action(session1),
            document.id,
            createUpdateContentWithDiffRequest({version: 0, text: "Editor notes"}),
        );

        expect(await readUpdateContentWithDiffResponse(editorResponse)).toMatchObject({
            ok: true,
            newVersion: 1,
        });

        // A viewer without edit access tries to update the content. Authorization runs in
        // parallel with computing the update but rejects before we mutate state.
        const viewerResponse = await fetchForTest(
            context.action(session2),
            document.id,
            createUpdateContentWithDiffRequest({version: 1, text: "Viewer notes"}),
        );

        expect(await readUpdateContentWithDiffResponse(viewerResponse)).toMatchObject({
            ok: false,
            error: expect.any(PermissionDeniedError),
        });

        // The failed update didn't apply: the editor's next update still builds on top of
        // version 1 with the editor's content, advancing to exactly version 2.
        const nextEditorResponse = await fetchForTest(
            context.action(session1),
            document.id,
            createUpdateContentWithDiffRequest({version: 1, text: "Editor notes again"}),
        );

        expect(await readUpdateContentWithDiffResponse(nextEditorResponse)).toMatchObject({
            ok: true,
            newVersion: 2,
            newContent: expect.objectContaining({
                textContent: "Editor notes again",
            }),
        });
    });

    test("doesn\u2019t kill the durable object when authorization fails", async () => {
        const space = await TestSpace.create(context);
        const session1 = await space.createSession();
        const session2 = await space.createSession();

        const document = await TestDocument.create(session1, {
            access: {
                type: "Local",
                accountGrantById: new Map([
                    [session1.account.id, {level: "Manage", generation: 0}],
                ]),
                defaultGrant: {level: "View"},
                urlGrant: null,
            },
        });

        // Keep the durable object alive with an editor connection so we can observe
        // whether the failed update corrupts its state or kills it.
        const connection1 = await connectForTest(context.action(session1), document.id);
        connection1.takeEvents();

        const response = await fetchForTest(
            context.action(session2),
            document.id,
            createUpdateContentWithDiffRequest({version: 0, text: "Viewer notes"}),
        );

        expect(await readUpdateContentWithDiffResponse(response)).toMatchObject({
            ok: false,
            error: expect.any(PermissionDeniedError),
        });

        await ProcessContextModule.waitForTestTasks();

        // The failed update wasn't optimistically applied, so no content events were
        // broadcast and the durable object stays alive instead of being killed by a failed
        // persistence of an unauthorized update.
        expect(connection1.isClosed()).toEqual(false);
        expect(connection1.takeEvents()).toEqual([]);
    });
});

testMessagingRealtimeImplementation<DocumentCommentRoomKey>(context, {
    async createRoom(sessions) {
        const document = await TestDocument.create(sessions[0], {access: "Public"});
        const {range} = await document.type(sessions[0], "hi");
        const commentThread = await document.createCommentThread(
            sessions[0],
            range,
            "Initial comment",
        );

        return {
            key: encodeDocumentCommentRoomKey(document.id, commentThread.id),
            spaceId: document.space.id,
            createdTime: document.createdTime,
            messageCount: 1,
            messageNoun: "comment",
        };
    },
    async connectForTest(context, roomKey) {
        const [documentId, commentThreadId] = decodeDocumentCommentRoomKey(roomKey);

        const connection = await connectForTest(context, documentId);

        return {
            getConnection: () => connection.connection.getConnectionForTest(commentThreadId),
            procedures: {
                backfillMessages: async ({
                    checkpoint,
                    clientMessageCount: clientCommentCount,
                    newMessageLimit: newCommentLimit,
                }) => {
                    const {
                        commentCount: messageCount,
                        newComments: newMessages,
                        newOtherReferencedComments: newOtherReferencedMessages,
                        commentUpdatesResult: messageUpdatesResult,
                        typingStateByConnectionId,
                    } = await connection.procedures.backfillComments({
                        commentThreadId,
                        checkpoint,
                        clientCommentCount,
                        newCommentLimit,
                    });
                    return {
                        messageCount,
                        newMessages,
                        newOtherReferencedMessages,
                        messageUpdatesResult,
                        typingStateByConnectionId,
                    };
                },
                createMessage: ({parent, content, fileIds}) =>
                    connection.procedures.createComment({
                        commentThreadId,
                        parent,
                        content,
                        fileIds,
                        createdTimeZone: defaultTimeZone,
                    }),
                updateMessageContent: ({messageIndex: commentIndex, contentVersion, steps}) =>
                    connection.procedures.updateCommentContent({
                        commentThreadId,
                        commentIndex,
                        contentVersion,
                        steps,
                    }),
                deleteMessage: ({messageIndex: commentIndex}) =>
                    connection.procedures.deleteComment({commentThreadId, commentIndex}),
                setMessageReaction: ({messageIndex: commentIndex, contentVersion, pos, reaction}) =>
                    connection.procedures.setCommentReaction({
                        commentThreadId,
                        commentIndex,
                        contentVersion,
                        pos,
                        reaction,
                    }),
                deleteMessageReaction: ({messageIndex: commentIndex, contentVersion, pos}) =>
                    connection.procedures.deleteCommentReaction({
                        commentThreadId,
                        commentIndex,
                        contentVersion,
                        pos,
                    }),
                putMessageApprovalDecisions: ({messageIndex: commentIndex, payload}) =>
                    connection.procedures.putCommentApprovalDecisions({
                        commentThreadId,
                        commentIndex,
                        payload,
                    }),
                startTypingInMessageInput: ({}) =>
                    connection.procedures.startTypingInCommentInput({commentThreadId}),
                stopTypingInMessageInput: ({}) =>
                    connection.procedures.stopTypingInCommentInput({commentThreadId}),
            },
            takeEvents: () => {
                return filterMapArray(connection.takeEvents(), event => {
                    if (event.type !== "Comments") return;
                    if (event.commentThreadId !== commentThreadId) return;
                    return event.event;
                });
            },
        };
    },
    createMessageModel({roomKey, index, createdTime, author, payload}) {
        const [documentId, commentThreadId] = decodeDocumentCommentRoomKey(roomKey);

        return new DocumentCommentModel({
            documentId,
            commentThreadId,
            index,
            version: 0,
            createdTime,
            createdTimeZone: defaultTimeZone,
            author,
            payload,
            stream: null,
        });
    },
    createMessage(context, {roomKey, parent, content, fileIds}) {
        const [documentId, commentThreadId] = decodeDocumentCommentRoomKey(roomKey);

        return createDocumentCommentRpc(context, {
            documentId,
            commentThreadId,
            parent,
            content,
            fileIds,
            createdTimeZone: defaultTimeZone,
        });
    },
    updateMessageContent(context, {roomKey, messageIndex: commentIndex, contentVersion, steps}) {
        const [documentId, commentThreadId] = decodeDocumentCommentRoomKey(roomKey);

        return updateDocumentCommentContent(context, {
            documentId,
            commentThreadId,
            commentIndex,
            contentVersion,
            steps,
        });
    },
    deleteMessage(context, {roomKey, messageIndex: commentIndex}) {
        const [documentId, commentThreadId] = decodeDocumentCommentRoomKey(roomKey);

        return deleteDocumentComment(context, {
            documentId,
            commentThreadId,
            commentIndex,
        });
    },
});

// =============================================================================
// Site addition and removal via intentionallyUpdateAccessPolicy
// =============================================================================

// TODO(#sites-not-blocking): Create testing framework for adding/removing from
// sites similar to the way we have "messaging" tests
describe("adding and removing documents from sites", () => {
    test("adding a document to a site persists the site entity ref and updates the document\u2019s access policy", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();

        // Create a site
        const site = await TestSite.create(session, {access: "Private"});

        // Create a document and connect to the DO
        const document = await TestDocument.create(session, {title: "Site Doc"});
        const entityId: SiteItemSearchEntityId = `Document:${document.id}`;
        const clientId = generateId<ContentEditorClientId>();
        const connection = await connectForTest(context.action(session), document.id);

        const siteAccessPolicy = {
            type: "Site" as const,
            siteId: site.id,
            position: {
                parentId: site.initialRootContainerId,
                orderKey: assertOrderKey("a0"),
            },
        };

        // Update content with a DocAttrStep that changes the access policy to Site, plus
        // intentionallyUpdateAccessPolicy so the server commits the site entity ref in the
        // same transaction.
        const result = await connection.procedures.updateContentWithoutOptimisticBroadcast({
            version: 0,
            steps: [new DocAttrStep("accessPolicy", {type: "Site", siteId: site.id})],
            clientId,
            createCommentThreads: [],
            intentionallyUpdateAccessPolicy: {
                accessPolicy: siteAccessPolicy,
                notification: null,
            },
            updateOurPresenceState: {state: null},
        });

        await waitForPersistence(connection, result.newVersion);

        // Verify the document's access policy is now Site
        const documentAccessPolicy = await document.access.get();
        expect(documentAccessPolicy).toMatchObject({type: "Site", siteId: site.id});

        // Verify the site contains the entity ref
        const [siteItems, sitePreview] = await runAllPromises([
            getSite(session.action(), {siteId: site.id}),
            getSitePreview(session.action(), site.id),
        ]);

        expect(sitePreview.initialData).toEqual(
            expect.objectContaining({
                id: site.id,
                firstEntityId: entityId,
                rootContainerId: site.initialRootContainerId,
            }),
        );

        const entityModels = siteItems.items
            .map(item => item.model)
            .filter(model => model instanceof SiteEntityModel);
        expect(entityModels).toHaveLength(1);
        expect(entityModels[0]).toEqual(
            expect.objectContaining({
                id: entityId,
                parentId: site.initialRootContainerId,
                type: "Entity",
            }),
        );

        // Verify site events were returned in the response
        expect(result.eventsForSite.length).toBeGreaterThan(0);
    });

    test("removing a document from a site removes the entity ref and restores Local access policy", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();

        const siteId = generateId<SiteId>();
        const rootSideBarId = generateId<SiteSideBarId>();
        await createSite(session.action(), {
            spaceId: space.id,
            siteId,
            name: "Test Site",
            root: {type: "SideBar", id: rootSideBarId},
        });
        const rootContainerId = printSiteContainerId({type: "SideBar", id: rootSideBarId});

        const document = await TestDocument.create(session, {title: "Site Doc"});
        const clientId = generateId<ContentEditorClientId>();
        const connection = await connectForTest(context.action(session), document.id);

        const siteAccessPolicy = {
            type: "Site" as const,
            siteId,
            position: {
                parentId: rootContainerId,
                orderKey: assertOrderKey("a0"),
            },
        };

        // Add to site
        const addResult = await connection.procedures.updateContentWithoutOptimisticBroadcast({
            version: 0,
            steps: [new DocAttrStep("accessPolicy", {type: "Site", siteId})],
            clientId,
            createCommentThreads: [],
            intentionallyUpdateAccessPolicy: {
                accessPolicy: siteAccessPolicy,
                notification: null,
            },
            updateOurPresenceState: {state: null},
        });

        await waitForPersistence(connection, addResult.newVersion);

        // Verify entity was added
        const siteItemsAfterAdd = await getSite(session.action(), {siteId});
        const entitiesAfterAdd = siteItemsAfterAdd.items
            .map(item => item.model)
            .filter(model => model instanceof SiteEntityModel);
        expect(entitiesAfterAdd).toHaveLength(1);

        // Now remove from site \u2014 set access policy back to Local
        const sitePreview = await getSitePreview(session.action(), siteId);
        const localAccessPolicy = sitePreview.initialData.accessPolicy;

        const removeResult = await connection.procedures.updateContent({
            version: addResult.newVersion,
            steps: [new DocAttrStep("accessPolicy", localAccessPolicy)],
            clientId,
            createCommentThreads: [],
            intentionallyUpdateAccessPolicy: {
                accessPolicy: localAccessPolicy,
                notification: null,
            },
            updateOurPresenceState: {state: null},
        });

        await waitForPersistence(connection, removeResult.newVersion);

        // Verify the document's access policy is now Local
        const restoredAccessPolicy = await document.access.get();
        expect(restoredAccessPolicy.type).toBe("Local");

        // Verify the entity ref was removed from the site
        const siteItemsAfterRemove = await getSite(session.action(), {siteId});
        const entitiesAfterRemove = siteItemsAfterRemove.items
            .map(item => item.model)
            .filter(model => model instanceof SiteEntityModel);
        expect(entitiesAfterRemove).toHaveLength(0);

        // Verify firstEntityId was cleared
        const sitePreviewAfterRemove = await getSitePreview(session.action(), siteId);
        expect(sitePreviewAfterRemove.initialData.firstEntityId).toBeNull();
    });

    test("cannot add a document to a site when the actor lacks `Manage` on the site", async () => {
        const space = await TestSpace.create(context);
        const [session1, session2] = await space.createSessions(2);

        // session1 creates a site session2 only has `View` on.
        const siteId = generateId<SiteId>();
        const rootSideBarId = generateId<SiteSideBarId>();
        await createSite(session1.action(), {
            spaceId: space.id,
            siteId,
            name: "session1\u2019s site",
            accessPolicy: {
                type: "Local",
                accountGrantById: new Map([
                    [session1.account.id, {level: "Manage", generation: 0}],
                ]),
                defaultGrant: {level: "View"},
                urlGrant: null,
            },
            root: {type: "SideBar", id: rootSideBarId},
        });
        const rootContainerId = printSiteContainerId({type: "SideBar", id: rootSideBarId});

        // session2 creates a doc they manage.
        const document = await TestDocument.create(session2, {
            access: {
                type: "Local",
                accountGrantById: new Map([
                    [session2.account.id, {level: "Manage", generation: 0}],
                ]),
                defaultGrant: null,
                urlGrant: null,
            },
            title: "session2\u2019s doc",
        });
        const clientId = generateId<ContentEditorClientId>();
        const connection = await connectForTest(context.action(session2), document.id);

        const siteAccessPolicy = {
            type: "Site" as const,
            siteId,
            position: {parentId: rootContainerId, orderKey: assertOrderKey("a0")},
        };

        await expect(
            connection.procedures.updateContentWithoutOptimisticBroadcast({
                version: 0,
                steps: [new DocAttrStep("accessPolicy", {type: "Site", siteId})],
                clientId,
                createCommentThreads: [],
                intentionallyUpdateAccessPolicy: {
                    accessPolicy: siteAccessPolicy,
                    notification: null,
                },
                updateOurPresenceState: {state: null},
            }),
        ).rejects.toThrow("Actor doesn\u2019t have `Manage` access level");
    });

    test("cannot add a document to a site when the actor lacks `Manage` on the document", async () => {
        const space = await TestSpace.create(context);
        const [session1, session2] = await space.createSessions(2);

        // session1 creates a doc session2 can only `Edit` (connect + modify content, but
        // not change access policy).
        const document = await TestDocument.create(session1, {
            access: {
                type: "Local",
                accountGrantById: new Map([
                    [session1.account.id, {level: "Manage", generation: 0}],
                    [session2.account.id, {level: "Edit", generation: 0}],
                ]),
                defaultGrant: null,
                urlGrant: null,
            },
            title: "session1\u2019s doc",
        });

        // session2 creates their own site that they manage.
        const siteId = generateId<SiteId>();
        const rootSideBarId = generateId<SiteSideBarId>();
        await createSite(session2.action(), {
            spaceId: space.id,
            siteId,
            name: "session2\u2019s site",
            root: {type: "SideBar", id: rootSideBarId},
        });
        const rootContainerId = printSiteContainerId({type: "SideBar", id: rootSideBarId});

        const clientId = generateId<ContentEditorClientId>();
        const connection = await connectForTest(context.action(session2), document.id, {
            accessLevel: "Edit",
        });

        const siteAccessPolicy = {
            type: "Site" as const,
            siteId,
            position: {parentId: rootContainerId, orderKey: assertOrderKey("a0")},
        };

        await expect(
            connection.procedures.updateContentWithoutOptimisticBroadcast({
                version: 0,
                steps: [new DocAttrStep("accessPolicy", {type: "Site", siteId})],
                clientId,
                createCommentThreads: [],
                intentionallyUpdateAccessPolicy: {
                    accessPolicy: siteAccessPolicy,
                    notification: null,
                },
                updateOurPresenceState: {state: null},
            }),
        ).rejects.toThrow("Actor doesn\u2019t have `Manage` access level");
    });
});
