import {Fragment, Slice} from "prosemirror-model";
import {AddMarkStep, RemoveMarkStep, ReplaceStep} from "prosemirror-transform";
import {WorkerSessionActionContextModules} from "~/server/cloudflare/context/worker_action_context.js";
import {WorkerProcessContextModules} from "~/server/cloudflare/context/worker_process_context.js";
import {createTestWorkerContext} from "~/server/cloudflare/test_helpers/create_test_worker_context.js";
import {DocumentCollaborationConnection} from "~/server/documents/collaboration/document_collaboration_connection.js";
import {
    documentCollaborationContentManagerBeforePersistTestCheckpoint,
    documentCollaborationContentManagerBeforeUpdateTestCheckpoint,
} from "~/server/documents/collaboration/document_collaboration_content_manager.js";
import {DocumentCollaborationDurableObject} from "~/server/documents/collaboration/document_collaboration_durable_object.js";
import {
    createDocument,
    createDocumentComment,
    getDocument,
    getDocumentComment,
    updateDocumentContent,
} from "~/server/documents/data/documents_table.js";
import {TestDocument} from "~/server/documents/test_helpers/test_document.js";
import {createTestSession} from "~/server/dynamo/test_helpers/create_test_session.js";
import {createTestSpace} from "~/server/dynamo/test_helpers/create_test_space.js";
import {getAccount} from "~/server/spaces/spaces_table.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {WebSocketServerTestConnection} from "~/server/web_socket/web_socket_server.js";
import {emptyContentReferences} from "~/shared/content/content_references.js";
import {DocumentCollaborationProtocol} from "~/shared/documents/document_collaboration_protocol.js";
import {emptyDocumentContentReferences} from "~/shared/documents/document_content_references.js";
import {
    emptyDocumentContent,
    DocumentContentProsemirrorSchema as schema,
} from "~/shared/documents/document_content_schema.js";
import {
    DocumentCommentModel,
    DocumentCommentThreadModel,
    DocumentModel,
} from "~/shared/documents/document_model.js";
import {NotFoundError, PermissionDeniedError} from "~/shared/error/error.js";
import {wait} from "~/shared/helpers/async/wait.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {defaultCompareStrings} from "~/shared/helpers/string/default_compare_strings.js";
import {generateId} from "~/shared/id/id.js";
import {ContentEditorClientId, DocumentCommentThreadId} from "~/shared/id/types/id_types.js";
import {createSimpleMessageContent} from "~/shared/messaging/message_content_schema.js";
import {
    AddMarksAfterRemoveAllStep,
    RemoveAllMarksStep,
} from "~/shared/prosemirror/remove_all_marks_step.js";

const context = createTestWorkerContext();
const {connectForTest} = DocumentCollaborationDurableObject.test(context);
const space = createTestSpace(context);
const session1 = createTestSession(context, space);
const session2 = createTestSession(context, space);
const session3 = createTestSession(context, space);
const otherSpace = createTestSpace(context);
const otherSession = createTestSession(context, otherSpace);

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

function waitForPersistance(
    connection: WebSocketServerTestConnection<
        WorkerProcessContextModules,
        WorkerSessionActionContextModules,
        typeof DocumentCollaborationProtocol,
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
    await expect(connectForTest(context.action(session1), generateId())).rejects.toThrow(
        NotFoundError,
    );
});

test("can not connect to a document in a different space", async () => {
    const document = await createDocument(context.action(session1), {
        spaceId: space.id,
        content: emptyDocumentContent,
    });

    await expect(connectForTest(context.action(otherSession), document.id)).rejects.toThrow(
        PermissionDeniedError,
    );
});

test("can not connect to an existing document durable object in a different space", async () => {
    const document = await createDocument(context.action(session1), {
        spaceId: space.id,
        content: emptyDocumentContent,
    });

    await connectForTest(context.action(session1), document.id);

    await expect(connectForTest(context.action(otherSession), document.id)).rejects.toThrow(
        PermissionDeniedError,
    );
});

test("can update document content", async () => {
    const document = await createDocument(context.action(session1), {
        spaceId: space.id,
        content: emptyDocumentContent,
    });

    const client1Id = generateId<ContentEditorClientId>();
    const connection1 = await connectForTest(context.action(session1), document.id);

    await connection1.procedures.backfill({
        version: 0,
    });

    expect(massageDocument(await getDocument(context.action(session1), document.id))).toEqual({
        version: 0,
        content: schema
            .node("doc", {}, [schema.node("title", {}, []), schema.node("paragraph", {}, [])])
            .toJSON(),
    });

    await connection1.procedures.updateContent({
        version: 0,
        steps: [new ReplaceStep(3, 3, textSlice("a"))],
        clientId: client1Id,
        createCommentThreads: [],
        updateOurPresenceState: {state: null},
    });

    await waitForPersistance(connection1, 1);

    expect(massageDocument(await getDocument(context.action(session1), document.id))).toEqual({
        version: 1,
        content: schema
            .node("doc", {}, [
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
        updateOurPresenceState: {state: null},
    });

    await waitForPersistance(connection1, 2);

    expect(massageDocument(await getDocument(context.action(session1), document.id))).toEqual({
        version: 2,
        content: schema
            .node("doc", {}, [
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
        updateOurPresenceState: {state: null},
    });

    await waitForPersistance(connection1, 3);

    expect(massageDocument(await getDocument(context.action(session1), document.id))).toEqual({
        version: 3,
        content: schema
            .node("doc", {}, [
                schema.node("title", {}, []),
                schema.node("paragraph", {}, [schema.text("abc")]),
            ])
            .toJSON(),
    });
});

test("will optimistically update the document and then persist later", async () => {
    const document = await createDocument(context.action(session1), {
        spaceId: space.id,
        content: emptyDocumentContent,
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
        documentCollaborationContentManagerBeforePersistTestCheckpoint.pauseForTest(document.id);

    await connection1.procedures.updateContent({
        version: 0,
        steps: [new ReplaceStep(3, 3, textSlice("a"))],
        clientId: client1Id,
        createCommentThreads: [],
        updateOurPresenceState: {state: null},
    });

    await connection1.procedures.updateContent({
        version: 1,
        steps: [new ReplaceStep(4, 4, textSlice("b"))],
        clientId: client1Id,
        createCommentThreads: [],
        updateOurPresenceState: {state: null},
    });

    await connection1.procedures.updateContent({
        version: 2,
        steps: [new ReplaceStep(5, 5, textSlice("c"))],
        clientId: client1Id,
        createCommentThreads: [],
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

    expect(massageDocument(await getDocument(context.action(session1), document.id))).toEqual({
        version: 0,
        content: schema
            .node("doc", {}, [schema.node("title", {}, []), schema.node("paragraph", {}, [])])
            .toJSON(),
    });

    unpause();
    await waitForPersistance(connection1, 3);

    expect(massageDocument(await getDocument(context.action(session1), document.id))).toEqual({
        version: 3,
        content: schema
            .node("doc", {}, [
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

test("will not batch updates from different accounts when persisting", async () => {
    const document = await createDocument(context.action(session1), {
        spaceId: space.id,
        content: emptyDocumentContent,
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
        documentCollaborationContentManagerBeforePersistTestCheckpoint.pauseForTest(document.id);

    await connection1.procedures.updateContent({
        version: 0,
        steps: [new ReplaceStep(3, 3, textSlice("a"))],
        clientId: client1Id,
        createCommentThreads: [],
        updateOurPresenceState: {state: null},
    });

    await connection1.procedures.updateContent({
        version: 1,
        steps: [new ReplaceStep(4, 4, textSlice("b"))],
        clientId: client1Id,
        createCommentThreads: [],
        updateOurPresenceState: {state: null},
    });

    await connection3.procedures.updateContent({
        version: 2,
        steps: [new ReplaceStep(5, 5, textSlice("c"))],
        clientId: client3Id,
        createCommentThreads: [],
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

    expect(massageDocument(await getDocument(context.action(session1), document.id))).toEqual({
        version: 0,
        content: schema
            .node("doc", {}, [schema.node("title", {}, []), schema.node("paragraph", {}, [])])
            .toJSON(),
    });

    unpause();
    await waitForPersistance(connection1, 3);

    expect(massageDocument(await getDocument(context.action(session1), document.id))).toEqual({
        version: 3,
        content: schema
            .node("doc", {}, [
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
    const document = await createDocument(context.action(session1), {
        spaceId: space.id,
        content: emptyDocumentContent,
    });

    await updateDocumentContent(context.action(session1), {
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
        documentCollaborationContentManagerBeforePersistTestCheckpoint.pauseForTest(document.id);

    await connection1.procedures.updateContent({
        version: 1,
        steps: [new AddMarkStep(10, 15, schema.mark("comment", {commentThreadId}))],
        clientId: client1Id,
        createCommentThreads: [
            {
                commentThreadId,
                initialCommentContent: createSimpleMessageContent("Test message content 1"),
            },
        ],
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
                                await getAccount(
                                    context.action(session1),
                                    space.id,
                                    session1.accountId,
                                ),
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
                                await getAccount(
                                    context.action(session1),
                                    space.id,
                                    session1.accountId,
                                ),
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
        getDocumentComment(context.action(session1), {
            documentId: document.id,
            commentThreadId,
            commentIndex: 0,
        }),
    ).rejects.toThrow(NotFoundError);

    unpause();
    await waitForPersistance(connection1, 2);

    expect(
        await getDocumentComment(context.action(session1), {
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

test("will respond optimistically to backfills with a comment thread even if it has not been persisted yet", async () => {
    const document = await createDocument(context.action(session1), {
        spaceId: space.id,
        content: emptyDocumentContent,
    });

    await updateDocumentContent(context.action(session1), {
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
        documentCollaborationContentManagerBeforePersistTestCheckpoint.pauseForTest(document.id);

    await connection1.procedures.updateContent({
        version: 1,
        steps: [new AddMarkStep(10, 15, schema.mark("comment", {commentThreadId}))],
        clientId: client1Id,
        createCommentThreads: [
            {
                commentThreadId,
                initialCommentContent: createSimpleMessageContent("Test message content 1"),
            },
        ],
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
                                await getAccount(
                                    context.action(session1),
                                    space.id,
                                    session1.accountId,
                                ),
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
                            await getAccount(
                                context.action(session1),
                                space.id,
                                session1.accountId,
                            ),
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
        getDocumentComment(context.action(session1), {
            documentId: document.id,
            commentThreadId,
            commentIndex: 0,
        }),
    ).rejects.toThrow(NotFoundError);

    unpause();
    await waitForPersistance(connection1, 2);

    expect(
        await getDocumentComment(context.action(session1), {
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

test("when comment threads are added back to the document they will be loaded", async () => {
    const document = await createDocument(context.action(session1), {
        spaceId: space.id,
        content: emptyDocumentContent,
    });

    await updateDocumentContent(context.action(session1), {
        id: document.id,
        version: 0,
        steps: [new ReplaceStep(3, 3, textSlice("Hello, world!"))],
        clientId: generateId(),
    });

    const commentThreadId = generateId<DocumentCommentThreadId>();

    await updateDocumentContent(context.action(session1), {
        id: document.id,
        version: 1,
        steps: [new AddMarkStep(10, 15, schema.mark("comment", {commentThreadId}))],
        clientId: generateId(),
        createCommentThreads: [
            {
                commentThreadId,
                initialCommentContent: createSimpleMessageContent("Test message content 1"),
            },
        ],
    });

    await createDocumentComment(context.action(session3), {
        documentId: document.id,
        commentThreadId,
        parentCommentIndex: null,
        content: createSimpleMessageContent("Test message content 2"),
    });

    await updateDocumentContent(context.action(session1), {
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
        updateOurPresenceState: {state: null},
    });

    await waitForPersistance(connection1, 4);

    expect(
        // Message order is not deterministic. We do not delay persistence on loading
        // data necessary from the database.
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
                                await getAccount(
                                    context.action(session1),
                                    space.id,
                                    session1.accountId,
                                ),
                                await getAccount(
                                    context.action(session3),
                                    space.id,
                                    session3.accountId,
                                ),
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
        // Message order is not deterministic. We do not delay persistence on loading
        // data necessary from the database.
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
                                await getAccount(
                                    context.action(session1),
                                    space.id,
                                    session1.accountId,
                                ),
                                await getAccount(
                                    context.action(session3),
                                    space.id,
                                    session3.accountId,
                                ),
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
    const document = await createDocument(context.action(session1), {
        spaceId: space.id,
        content: emptyDocumentContent,
    });

    await updateDocumentContent(context.action(session1), {
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
            },
        ],
        updateOurPresenceState: {state: null},
    });

    await waitForPersistance(connection1, 2);

    await createDocumentComment(context.action(session3), {
        documentId: document.id,
        commentThreadId,
        parentCommentIndex: null,
        content: createSimpleMessageContent("Test message content 2"),
    });

    await connection1.procedures.updateContent({
        version: 2,
        steps: [new RemoveMarkStep(10, 15, schema.mark("comment", {commentThreadId}))],
        clientId: client1Id,
        createCommentThreads: [],
        updateOurPresenceState: {state: null},
    });

    await waitForPersistance(connection1, 3);

    await connection1.procedures.updateContent({
        version: 3,
        steps: [new AddMarkStep(10, 15, schema.mark("comment", {commentThreadId}))],
        clientId: client1Id,
        createCommentThreads: [],
        updateOurPresenceState: {state: null},
    });

    await waitForPersistance(connection1, 4);

    expect(
        // Message order is not deterministic. We do not delay persistence on loading
        // data necessary from the database.
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
                                await getAccount(
                                    context.action(session1),
                                    space.id,
                                    session1.accountId,
                                ),
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
                                await getAccount(
                                    context.action(session1),
                                    space.id,
                                    session1.accountId,
                                ),
                                await getAccount(
                                    context.action(session3),
                                    space.id,
                                    session3.accountId,
                                ),
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
        // Message order is not deterministic. We do not delay persistence on loading
        // data necessary from the database.
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
                                await getAccount(
                                    context.action(session1),
                                    space.id,
                                    session1.accountId,
                                ),
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
                                await getAccount(
                                    context.action(session1),
                                    space.id,
                                    session1.accountId,
                                ),
                                await getAccount(
                                    context.action(session3),
                                    space.id,
                                    session3.accountId,
                                ),
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
    const document = await createDocument(context.action(session1), {
        spaceId: space.id,
        content: emptyDocumentContent,
    });

    await updateDocumentContent(context.action(session1), {
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
            parentCommentIndex: null,
            content: createSimpleMessageContent("Test message content 2"),
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
            },
        ],
        updateOurPresenceState: {state: null},
    });

    await waitForPersistance(connection1, 2);

    expect(
        // Message order is not deterministic. We do not delay persistence on loading
        // data necessary from the database.
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
                                await getAccount(
                                    context.action(session1),
                                    space.id,
                                    session1.accountId,
                                ),
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
        // Message order is not deterministic. We do not delay persistence on loading
        // data necessary from the database.
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
                                await getAccount(
                                    context.action(session1),
                                    space.id,
                                    session1.accountId,
                                ),
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

    await connection1.procedures.createComment({
        commentThreadId,
        parentCommentIndex: null,
        content: createSimpleMessageContent("Test message content 2"),
    });

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
                    author: await getAccount(
                        context.action(session1),
                        space.id,
                        session1.accountId,
                    ),
                    createdTime: expect.any(Date),
                    payload: {
                        type: "Content",
                        parentMessageIndex: null,
                        content: {
                            doc: createSimpleMessageContent("Test message content 2"),
                            references: emptyContentReferences,
                        },
                        contentUpdatedTime: null,
                    },
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
                    author: await getAccount(
                        context.action(session1),
                        space.id,
                        session1.accountId,
                    ),
                    createdTime: expect.any(Date),
                    payload: {
                        type: "Content",
                        parentMessageIndex: null,
                        content: {
                            doc: createSimpleMessageContent("Test message content 2"),
                            references: emptyContentReferences,
                        },
                        contentUpdatedTime: null,
                    },
                }),
                updateOtherTypingState: null,
            },
        },
    ]);

    expect(
        await connection1.procedures.backfillComments({
            commentThreadId,
            clientCommentCount: 1,
            clientLastCommentChangeTime: null,
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
            lastCommentChangeTime: null,
            firstCommentAuthor: await getAccount(
                context.action(session1),
                space.id,
                session1.accountId,
            ),
        }),
        commentCount: 2,
        lastCommentChangeTime: null,
        newComments: [
            new DocumentCommentModel({
                documentId: document.id,
                commentThreadId,
                index: 1,
                author: await getAccount(context.action(session1), space.id, session1.accountId),
                createdTime: expect.any(Date),
                payload: {
                    type: "Content",
                    parentMessageIndex: null,
                    content: {
                        doc: createSimpleMessageContent("Test message content 2"),
                        references: emptyContentReferences,
                    },
                    contentUpdatedTime: null,
                },
            }),
        ],
        newOtherReferencedComments: [],
        commentChangesResult: {type: "Available", changes: []},
        typingStateByConnectionId: new Map(),
    });

    expect(
        await connection2.procedures.backfillComments({
            commentThreadId,
            clientCommentCount: 0,
            clientLastCommentChangeTime: null,
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
            lastCommentChangeTime: null,
            firstCommentAuthor: await getAccount(
                context.action(session1),
                space.id,
                session1.accountId,
            ),
        }),
        commentCount: 2,
        lastCommentChangeTime: null,
        newComments: [
            new DocumentCommentModel({
                documentId: document.id,
                commentThreadId,
                index: 0,
                author: await getAccount(context.action(session1), space.id, session1.accountId),
                createdTime: expect.any(Date),
                payload: {
                    type: "Content",
                    parentMessageIndex: null,
                    content: {
                        doc: createSimpleMessageContent("Test message content 1"),
                        references: emptyContentReferences,
                    },
                    contentUpdatedTime: null,
                },
            }),
            new DocumentCommentModel({
                documentId: document.id,
                commentThreadId,
                index: 1,
                author: await getAccount(context.action(session1), space.id, session1.accountId),
                createdTime: expect.any(Date),
                payload: {
                    type: "Content",
                    parentMessageIndex: null,
                    content: {
                        doc: createSimpleMessageContent("Test message content 2"),
                        references: emptyContentReferences,
                    },
                    contentUpdatedTime: null,
                },
            }),
        ],
        newOtherReferencedComments: [],
        commentChangesResult: {type: "Available", changes: []},
        typingStateByConnectionId: new Map(),
    });

    expect(connection1.takeEvents()).toEqual([]);

    expect(connection2.takeEvents()).toEqual([]);

    await connection1.procedures.createComment({
        commentThreadId,
        parentCommentIndex: null,
        content: createSimpleMessageContent("Test message content 3"),
    });

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
                    author: await getAccount(
                        context.action(session1),
                        space.id,
                        session1.accountId,
                    ),
                    createdTime: expect.any(Date),
                    payload: {
                        type: "Content",
                        parentMessageIndex: null,
                        content: {
                            doc: createSimpleMessageContent("Test message content 3"),
                            references: emptyContentReferences,
                        },
                        contentUpdatedTime: null,
                    },
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
                    author: await getAccount(
                        context.action(session1),
                        space.id,
                        session1.accountId,
                    ),
                    createdTime: expect.any(Date),
                    payload: {
                        type: "Content",
                        parentMessageIndex: null,
                        content: {
                            doc: createSimpleMessageContent("Test message content 3"),
                            references: emptyContentReferences,
                        },
                        contentUpdatedTime: null,
                    },
                }),
                updateOtherTypingState: null,
            },
        },
    ]);
});

test("if comment thread is persisting we will wait to create messages but respond to backfill requests", async () => {
    const document = await createDocument(context.action(session1), {
        spaceId: space.id,
        content: emptyDocumentContent,
    });

    await updateDocumentContent(context.action(session1), {
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
            parentCommentIndex: null,
            content: createSimpleMessageContent("Test message content 2"),
        }),
    ).rejects.toThrow(NotFoundError);

    const pausePromise =
        documentCollaborationContentManagerBeforePersistTestCheckpoint.pauseForTest(document.id);

    await connection1.procedures.updateContent({
        version: 1,
        steps: [new AddMarkStep(10, 15, schema.mark("comment", {commentThreadId}))],
        clientId: client1Id,
        createCommentThreads: [
            {
                commentThreadId,
                initialCommentContent: createSimpleMessageContent("Test message content 1"),
            },
        ],
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
                                await getAccount(
                                    context.action(session1),
                                    space.id,
                                    session1.accountId,
                                ),
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
                                await getAccount(
                                    context.action(session1),
                                    space.id,
                                    session1.accountId,
                                ),
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
        parentCommentIndex: null,
        content: createSimpleMessageContent("Test message content 2"),
    });

    expect(connection1.takeEvents()).toEqual([]);
    expect(connection2.takeEvents()).toEqual([]);

    expect(
        await connection1.procedures.backfillComments({
            commentThreadId,
            clientCommentCount: 1,
            clientLastCommentChangeTime: null,
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
            lastCommentChangeTime: null,
            firstCommentAuthor: await getAccount(
                context.action(session1),
                space.id,
                session1.accountId,
            ),
        }),
        commentCount: 1,
        lastCommentChangeTime: null,
        newComments: [],
        newOtherReferencedComments: [],
        commentChangesResult: {type: "Available", changes: []},
        typingStateByConnectionId: new Map(),
    });

    expect(
        await connection2.procedures.backfillComments({
            commentThreadId,
            clientCommentCount: 0,
            clientLastCommentChangeTime: null,
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
            lastCommentChangeTime: null,
            firstCommentAuthor: await getAccount(
                context.action(session1),
                space.id,
                session1.accountId,
            ),
        }),
        commentCount: 1,
        lastCommentChangeTime: null,
        newComments: [
            new DocumentCommentModel({
                documentId: document.id,
                commentThreadId,
                index: 0,
                author: await getAccount(context.action(session1), space.id, session1.accountId),
                createdTime: expect.any(Date),
                payload: {
                    type: "Content",
                    parentMessageIndex: null,
                    content: {
                        doc: createSimpleMessageContent("Test message content 1"),
                        references: emptyContentReferences,
                    },
                    contentUpdatedTime: null,
                },
            }),
        ],
        newOtherReferencedComments: [],
        commentChangesResult: {type: "Available", changes: []},
        typingStateByConnectionId: new Map(),
    });

    expect(connection1.takeEvents()).toEqual([]);
    expect(connection2.takeEvents()).toEqual([]);

    unpause();
    await createMessagePromise;

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
                    author: await getAccount(
                        context.action(session2),
                        space.id,
                        session2.accountId,
                    ),
                    createdTime: expect.any(Date),
                    payload: {
                        type: "Content",
                        parentMessageIndex: null,
                        content: {
                            doc: createSimpleMessageContent("Test message content 2"),
                            references: emptyContentReferences,
                        },
                        contentUpdatedTime: null,
                    },
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
                    author: await getAccount(
                        context.action(session2),
                        space.id,
                        session2.accountId,
                    ),
                    createdTime: expect.any(Date),
                    payload: {
                        type: "Content",
                        parentMessageIndex: null,
                        content: {
                            doc: createSimpleMessageContent("Test message content 2"),
                            references: emptyContentReferences,
                        },
                        contentUpdatedTime: null,
                    },
                }),
                updateOtherTypingState: null,
            },
        },
    ]);
});

test("if comment thread update message hasn't been processed we will wait to respond to backfill requests", async () => {
    const document = await createDocument(context.action(session1), {
        spaceId: space.id,
        content: emptyDocumentContent,
    });

    await updateDocumentContent(context.action(session1), {
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
            parentCommentIndex: null,
            content: createSimpleMessageContent("Test message content 2"),
        }),
    ).rejects.toThrow(NotFoundError);

    const pausePromise1 =
        documentCollaborationContentManagerBeforeUpdateTestCheckpoint.pauseForTest(document.id);
    const pausePromise2 =
        documentCollaborationContentManagerBeforePersistTestCheckpoint.pauseForTest(document.id);

    const updateMessagePromise = connection1.procedures.updateContent({
        version: 1,
        steps: [new AddMarkStep(10, 15, schema.mark("comment", {commentThreadId}))],
        clientId: client1Id,
        createCommentThreads: [
            {
                commentThreadId,
                initialCommentContent: createSimpleMessageContent("Test message content 1"),
            },
        ],
        updateOurPresenceState: {state: null},
    });

    const {unpause: unpause1} = await pausePromise1;

    expect(connection1.takeEvents()).toEqual([]);
    expect(connection2.takeEvents()).toEqual([]);

    const backfillMessagePromise = connection1.procedures.backfillComments({
        commentThreadId,
        clientCommentCount: 1,
        clientLastCommentChangeTime: null,
        newCommentLimit: 100,
    });

    // NOTE(calebmer): This is a little janky but what we want to test is that
    // `backfillMessagePromise` waits for `updateMessagePromise` before processing.
    // If there's no async gap here then we immediately unpause
    // `updateMessagePromise` and can't observe whether `backfillMessagePromise`
    // waited. I can't find a good place to put a test checkpoint in the code to
    // test this behavior so a fine option is putting a timeout here and checking
    // that we got no new messages.
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
                                await getAccount(
                                    context.action(session1),
                                    space.id,
                                    session1.accountId,
                                ),
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
                                await getAccount(
                                    context.action(session1),
                                    space.id,
                                    session1.accountId,
                                ),
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
            lastCommentChangeTime: null,
            firstCommentAuthor: await getAccount(
                context.action(session1),
                space.id,
                session1.accountId,
            ),
        }),
        commentCount: 1,
        lastCommentChangeTime: null,
        newComments: [],
        newOtherReferencedComments: [],
        commentChangesResult: {type: "Available", changes: []},
        typingStateByConnectionId: new Map(),
    });

    const {unpause: unpause2} = await pausePromise2;

    expect(connection1.takeEvents()).toEqual([]);
    expect(connection2.takeEvents()).toEqual([]);

    expect(
        await connection2.procedures.backfillComments({
            commentThreadId,
            clientCommentCount: 0,
            clientLastCommentChangeTime: null,
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
            lastCommentChangeTime: null,
            firstCommentAuthor: await getAccount(
                context.action(session1),
                space.id,
                session1.accountId,
            ),
        }),
        commentCount: 1,
        lastCommentChangeTime: null,
        newComments: [
            new DocumentCommentModel({
                documentId: document.id,
                commentThreadId,
                index: 0,
                author: await getAccount(context.action(session1), space.id, session1.accountId),
                createdTime: expect.any(Date),
                payload: {
                    type: "Content",
                    parentMessageIndex: null,
                    content: {
                        doc: createSimpleMessageContent("Test message content 1"),
                        references: emptyContentReferences,
                    },
                    contentUpdatedTime: null,
                },
            }),
        ],
        newOtherReferencedComments: [],
        commentChangesResult: {type: "Available", changes: []},
        typingStateByConnectionId: new Map(),
    });

    const createMessagePromise = connection2.procedures.createComment({
        commentThreadId,
        parentCommentIndex: null,
        content: createSimpleMessageContent("Test message content 2"),
    });

    expect(connection1.takeEvents()).toEqual([]);
    expect(connection2.takeEvents()).toEqual([]);

    unpause2();
    await createMessagePromise;

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
                    author: await getAccount(
                        context.action(session2),
                        space.id,
                        session2.accountId,
                    ),
                    createdTime: expect.any(Date),
                    payload: {
                        type: "Content",
                        parentMessageIndex: null,
                        content: {
                            doc: createSimpleMessageContent("Test message content 2"),
                            references: emptyContentReferences,
                        },
                        contentUpdatedTime: null,
                    },
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
                    author: await getAccount(
                        context.action(session2),
                        space.id,
                        session2.accountId,
                    ),
                    createdTime: expect.any(Date),
                    payload: {
                        type: "Content",
                        parentMessageIndex: null,
                        content: {
                            doc: createSimpleMessageContent("Test message content 2"),
                            references: emptyContentReferences,
                        },
                        contentUpdatedTime: null,
                    },
                }),
                updateOtherTypingState: null,
            },
        },
    ]);
});

test("while comment thread is persisting we will respond to comment load requests", async () => {
    const document = await createDocument(context.action(session1), {
        spaceId: space.id,
        content: emptyDocumentContent,
    });

    await updateDocumentContent(context.action(session1), {
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
            parentCommentIndex: null,
            content: createSimpleMessageContent("Test message content 2"),
        }),
    ).rejects.toThrow(NotFoundError);

    const pausePromise =
        documentCollaborationContentManagerBeforePersistTestCheckpoint.pauseForTest(document.id);

    await connection1.procedures.updateContent({
        version: 1,
        steps: [new AddMarkStep(10, 15, schema.mark("comment", {commentThreadId}))],
        clientId: client1Id,
        createCommentThreads: [
            {
                commentThreadId,
                initialCommentContent: createSimpleMessageContent("Test message content 1"),
            },
        ],
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
                                await getAccount(
                                    context.action(session1),
                                    space.id,
                                    session1.accountId,
                                ),
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
                                await getAccount(
                                    context.action(session1),
                                    space.id,
                                    session1.accountId,
                                ),
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
        commentThread: new DocumentCommentThreadModel({
            id: commentThreadId,
            documentId: document.id,
            createdTime,
            version: 0,
            fallbackContentSnippet: null,
            isResolved: false,
            commentCount: 1,
            lastCommentChangeTime: null,
            firstCommentAuthor: await getAccount(
                context.action(session1),
                space.id,
                session1.accountId,
            ),
        }),
        initialComments: [
            new DocumentCommentModel({
                documentId: document.id,
                commentThreadId,
                index: 0,
                author: await getAccount(context.action(session1), space.id, session1.accountId),
                createdTime,
                payload: {
                    type: "Content",
                    parentMessageIndex: null,
                    content: {
                        doc: createSimpleMessageContent("Test message content 1"),
                        references: emptyContentReferences,
                    },
                    contentUpdatedTime: null,
                },
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
        commentThread: new DocumentCommentThreadModel({
            id: commentThreadId,
            documentId: document.id,
            createdTime,
            version: 0,
            fallbackContentSnippet: null,
            isResolved: false,
            commentCount: 1,
            lastCommentChangeTime: null,
            firstCommentAuthor: await getAccount(
                context.action(session1),
                space.id,
                session1.accountId,
            ),
        }),
        initialComments: [
            new DocumentCommentModel({
                documentId: document.id,
                commentThreadId,
                index: 0,
                author: await getAccount(context.action(session1), space.id, session1.accountId),
                createdTime,
                payload: {
                    type: "Content",
                    parentMessageIndex: null,
                    content: {
                        doc: createSimpleMessageContent("Test message content 1"),
                        references: emptyContentReferences,
                    },
                    contentUpdatedTime: null,
                },
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
        commentThread: new DocumentCommentThreadModel({
            id: commentThreadId,
            documentId: document.id,
            createdTime,
            version: 0,
            fallbackContentSnippet: null,
            isResolved: false,
            commentCount: 1,
            lastCommentChangeTime: null,
            firstCommentAuthor: await getAccount(
                context.action(session1),
                space.id,
                session1.accountId,
            ),
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
        commentThread: new DocumentCommentThreadModel({
            id: commentThreadId,
            documentId: document.id,
            createdTime,
            version: 0,
            fallbackContentSnippet: null,
            isResolved: false,
            commentCount: 1,
            lastCommentChangeTime: null,
            firstCommentAuthor: await getAccount(
                context.action(session1),
                space.id,
                session1.accountId,
            ),
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
                author: await getAccount(context.action(session1), space.id, session1.accountId),
                createdTime,
                payload: {
                    type: "Content",
                    parentMessageIndex: null,
                    content: {
                        doc: createSimpleMessageContent("Test message content 1"),
                        references: emptyContentReferences,
                    },
                    contentUpdatedTime: null,
                },
            }),
        ],
        otherReferencedComments: [],
        lastCommentChangeTime: null,
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
                author: await getAccount(context.action(session1), space.id, session1.accountId),
                createdTime,
                payload: {
                    type: "Content",
                    parentMessageIndex: null,
                    content: {
                        doc: createSimpleMessageContent("Test message content 1"),
                        references: emptyContentReferences,
                    },
                    contentUpdatedTime: null,
                },
            }),
        ],
        otherReferencedComments: [],
        lastCommentChangeTime: null,
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
        lastCommentChangeTime: null,
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
        lastCommentChangeTime: null,
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
        lastCommentChangeTime: null,
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
        lastCommentChangeTime: null,
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
                author: await getAccount(context.action(session1), space.id, session1.accountId),
                createdTime,
                payload: {
                    type: "Content",
                    parentMessageIndex: null,
                    content: {
                        doc: createSimpleMessageContent("Test message content 1"),
                        references: emptyContentReferences,
                    },
                    contentUpdatedTime: null,
                },
            }),
        ],
        otherReferencedComments: [],
        lastCommentChangeTime: null,
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
                author: await getAccount(context.action(session1), space.id, session1.accountId),
                createdTime,
                payload: {
                    type: "Content",
                    parentMessageIndex: null,
                    content: {
                        doc: createSimpleMessageContent("Test message content 1"),
                        references: emptyContentReferences,
                    },
                    contentUpdatedTime: null,
                },
            }),
        ],
        otherReferencedComments: [],
        lastCommentChangeTime: null,
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
        lastCommentChangeTime: null,
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
        lastCommentChangeTime: null,
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
        lastCommentChangeTime: null,
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
        lastCommentChangeTime: null,
    });

    expect(connection1.takeEvents()).toEqual([]);
    expect(connection2.takeEvents()).toEqual([]);

    unpause();
    await waitForPersistance(connection1, 2);

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
        commentThread: new DocumentCommentThreadModel({
            id: commentThreadId,
            documentId: document.id,
            createdTime,
            version: 0,
            fallbackContentSnippet: null,
            isResolved: false,
            commentCount: 1,
            lastCommentChangeTime: null,
            firstCommentAuthor: await getAccount(
                context.action(session1),
                space.id,
                session1.accountId,
            ),
        }),
        initialComments: [
            new DocumentCommentModel({
                documentId: document.id,
                commentThreadId,
                index: 0,
                author: await getAccount(context.action(session1), space.id, session1.accountId),
                createdTime,
                payload: {
                    type: "Content",
                    parentMessageIndex: null,
                    content: {
                        doc: createSimpleMessageContent("Test message content 1"),
                        references: emptyContentReferences,
                    },
                    contentUpdatedTime: null,
                },
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
        commentThread: new DocumentCommentThreadModel({
            id: commentThreadId,
            documentId: document.id,
            createdTime,
            version: 0,
            fallbackContentSnippet: null,
            isResolved: false,
            commentCount: 1,
            lastCommentChangeTime: null,
            firstCommentAuthor: await getAccount(
                context.action(session1),
                space.id,
                session1.accountId,
            ),
        }),
        initialComments: [
            new DocumentCommentModel({
                documentId: document.id,
                commentThreadId,
                index: 0,
                author: await getAccount(context.action(session1), space.id, session1.accountId),
                createdTime,
                payload: {
                    type: "Content",
                    parentMessageIndex: null,
                    content: {
                        doc: createSimpleMessageContent("Test message content 1"),
                        references: emptyContentReferences,
                    },
                    contentUpdatedTime: null,
                },
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
        commentThread: new DocumentCommentThreadModel({
            id: commentThreadId,
            documentId: document.id,
            createdTime,
            version: 0,
            fallbackContentSnippet: null,
            isResolved: false,
            commentCount: 1,
            lastCommentChangeTime: null,
            firstCommentAuthor: await getAccount(
                context.action(session1),
                space.id,
                session1.accountId,
            ),
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
        commentThread: new DocumentCommentThreadModel({
            id: commentThreadId,
            documentId: document.id,
            createdTime,
            version: 0,
            fallbackContentSnippet: null,
            isResolved: false,
            commentCount: 1,
            lastCommentChangeTime: null,
            firstCommentAuthor: await getAccount(
                context.action(session1),
                space.id,
                session1.accountId,
            ),
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
                author: await getAccount(context.action(session1), space.id, session1.accountId),
                createdTime,
                payload: {
                    type: "Content",
                    parentMessageIndex: null,
                    content: {
                        doc: createSimpleMessageContent("Test message content 1"),
                        references: emptyContentReferences,
                    },
                    contentUpdatedTime: null,
                },
            }),
        ],
        otherReferencedComments: [],
        lastCommentChangeTime: null,
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
                author: await getAccount(context.action(session1), space.id, session1.accountId),
                createdTime,
                payload: {
                    type: "Content",
                    parentMessageIndex: null,
                    content: {
                        doc: createSimpleMessageContent("Test message content 1"),
                        references: emptyContentReferences,
                    },
                    contentUpdatedTime: null,
                },
            }),
        ],
        otherReferencedComments: [],
        lastCommentChangeTime: null,
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
        lastCommentChangeTime: null,
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
        lastCommentChangeTime: null,
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
        lastCommentChangeTime: null,
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
        lastCommentChangeTime: null,
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
                author: await getAccount(context.action(session1), space.id, session1.accountId),
                createdTime,
                payload: {
                    type: "Content",
                    parentMessageIndex: null,
                    content: {
                        doc: createSimpleMessageContent("Test message content 1"),
                        references: emptyContentReferences,
                    },
                    contentUpdatedTime: null,
                },
            }),
        ],
        otherReferencedComments: [],
        lastCommentChangeTime: null,
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
                author: await getAccount(context.action(session1), space.id, session1.accountId),
                createdTime,
                payload: {
                    type: "Content",
                    parentMessageIndex: null,
                    content: {
                        doc: createSimpleMessageContent("Test message content 1"),
                        references: emptyContentReferences,
                    },
                    contentUpdatedTime: null,
                },
            }),
        ],
        otherReferencedComments: [],
        lastCommentChangeTime: null,
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
        lastCommentChangeTime: null,
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
        lastCommentChangeTime: null,
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
        lastCommentChangeTime: null,
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
        lastCommentChangeTime: null,
    });
});

test("will cleanup comment thread marks if from a different document", async () => {
    const document1 = await createDocument(context.action(session1), {
        spaceId: space.id,
        content: emptyDocumentContent,
    });

    const document2 = await createDocument(context.action(session1), {
        spaceId: space.id,
        content: emptyDocumentContent,
    });

    await updateDocumentContent(context.action(session1), {
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
            },
        ],
        updateOurPresenceState: {state: null},
    });

    await waitForPersistance(connection1, 2);

    expect(
        // Message order is not deterministic. We do not delay persistence on loading
        // data necessary from the database.
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
                                await getAccount(
                                    context.action(session1),
                                    space.id,
                                    session1.accountId,
                                ),
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
        // Message order is not deterministic. We do not delay persistence on loading
        // data necessary from the database.
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
                                await getAccount(
                                    context.action(session1),
                                    space.id,
                                    session1.accountId,
                                ),
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
        updateOurPresenceState: {state: null},
    });

    await waitForPersistance(connection1, 3);

    expect(
        // Message order is not deterministic. We do not delay persistence on loading
        // data necessary from the database.
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
                                await getAccount(
                                    context.action(session1),
                                    space.id,
                                    session1.accountId,
                                ),
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
        // Message order is not deterministic. We do not delay persistence on loading
        // data necessary from the database.
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
                                await getAccount(
                                    context.action(session1),
                                    space.id,
                                    session1.accountId,
                                ),
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
        updateOurPresenceState: {state: null},
    });

    await waitForPersistance(connection3, 2);

    expect(
        // Message order is not deterministic. We do not delay persistence on loading
        // data necessary from the database.
        connection3.takeEvents().sort((a, b) =>
            // We don't compare `newVersion` since we do specifically want to test the
            // ordering of `UpdateContentWithoutPersistence` events here. The
            // `RemoveAllMarksStep` event should always come first despite being at a
            // later version.
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
        // Message order is not deterministic. We do not delay persistence on loading
        // data necessary from the database.
        connection4.takeEvents().sort((a, b) =>
            // We don't compare `newVersion` since we do specifically want to test the
            // ordering of `UpdateContentWithoutPersistence` events here. The
            // `RemoveAllMarksStep` event should always come first despite being at a
            // later version.
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

test("can add comment thread marks back to document after they've been removed", async () => {
    const document = await createDocument(context.action(session1), {
        spaceId: space.id,
        content: emptyDocumentContent,
    });

    await updateDocumentContent(context.action(session1), {
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
            },
        ],
        updateOurPresenceState: {state: null},
    });

    await waitForPersistance(connection1, 2);

    expect(
        // Message order is not deterministic. We do not delay persistence on loading
        // data necessary from the database.
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
                                await getAccount(
                                    context.action(session1),
                                    space.id,
                                    session1.accountId,
                                ),
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
        // Message order is not deterministic. We do not delay persistence on loading
        // data necessary from the database.
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
                                await getAccount(
                                    context.action(session1),
                                    space.id,
                                    session1.accountId,
                                ),
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
        updateOurPresenceState: {state: null},
    });

    await waitForPersistance(connection1, 3);

    expect(
        // Message order is not deterministic. We do not delay persistence on loading
        // data necessary from the database.
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
        // Message order is not deterministic. We do not delay persistence on loading
        // data necessary from the database.
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
        updateOurPresenceState: {state: null},
    });

    await waitForPersistance(connection1, 4);

    expect(
        // Message order is not deterministic. We do not delay persistence on loading
        // data necessary from the database.
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
                                await getAccount(
                                    context.action(session1),
                                    space.id,
                                    session1.accountId,
                                ),
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
        // Message order is not deterministic. We do not delay persistence on loading
        // data necessary from the database.
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
                                await getAccount(
                                    context.action(session1),
                                    space.id,
                                    session1.accountId,
                                ),
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

    const document = await TestDocument.create(session1);

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

    await waitForPersistance(connection1, 4);

    expect(
        // Message order is not deterministic. We do not delay persistence on loading
        // data necessary from the database.
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
                    lastCommentChangeTime: null,
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
        // Message order is not deterministic. We do not delay persistence on loading
        // data necessary from the database.
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
                    lastCommentChangeTime: null,
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

    const document = await TestDocument.create(session1);

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

    await waitForPersistance(connection1, 5);

    expect(
        // Message order is not deterministic. We do not delay persistence on loading
        // data necessary from the database.
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
                    lastCommentChangeTime: null,
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
                    [{from: 3, to: 8}],
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
        // Message order is not deterministic. We do not delay persistence on loading
        // data necessary from the database.
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
                    lastCommentChangeTime: null,
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
                    [{from: 3, to: 8}],
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
