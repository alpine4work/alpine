import {Fragment, Slice} from "prosemirror-model";
import {AddMarkStep, RemoveMarkStep, ReplaceStep} from "prosemirror-transform";
import {WebSocketServerTestConnection} from "~/server/cloudflare/web_socket_server";
import {DocumentCollaborationConnection} from "~/server/documents/document_collaboration_connection";
import {
    documentCollaborationContentManagerBeforePersistTestCheckpoint,
    documentCollaborationContentManagerBeforeUpdateTestCheckpoint,
} from "~/server/documents/document_collaboration_content_manager";
import {DocumentCollaborationDurableObject} from "~/server/documents/document_collaboration_durable_object";
import {
    createDocument,
    createDocumentComment,
    getDocument,
    getDocumentComment,
    updateDocumentContent,
} from "~/server/dynamo/documents_table";
import {createTestContext} from "~/server/dynamo/test_helpers/shared/create_test_context";
import {createTestSession} from "~/server/dynamo/test_helpers/shared/create_test_session";
import {createTestSpace} from "~/server/dynamo/test_helpers/shared/create_test_space";
import {
    emptyDocumentContent,
    DocumentContentProsemirrorSchema as schema,
} from "~/shared/content/document_content_schema";
import {createSimpleMessageContent} from "~/shared/content/message_content_schema";
import {DocumentCollaborationProtocol} from "~/shared/documents/document_collaboration_protocol";
import {NotFoundError} from "~/shared/error/error";
import {wait} from "~/shared/helpers/async/wait";
import {defaultCompareStrings} from "~/shared/helpers/string/default_compare_strings";
import {generateId} from "~/shared/id/id";
import {ContentEditorClientId, DocumentCommentThreadId} from "~/shared/id/types/id_types";
import {emptyContentReferences} from "~/shared/models/content_references";
import {
    DocumentCommentModel,
    DocumentModel,
    emptyDocumentContentReferences,
} from "~/shared/models/document_model";

const context = createTestContext();
const {connectForTest} = DocumentCollaborationDurableObject.test(context);
const space = createTestSpace(context);
const session1 = createTestSession(context, space);
const session2 = createTestSession(context, space);
const session3 = createTestSession(context, space);

function massageDocument(document: DocumentModel | null) {
    if (!document) return null;
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

test("can update document content", async () => {
    const document = await createDocument(context.request(session1), {
        spaceId: space.id,
        content: emptyDocumentContent,
    });

    const client1Id = generateId<ContentEditorClientId>();
    const connection1 = await connectForTest(context.request(session1), document.id);

    await connection1.procedures.backfill({
        version: 0,
    });

    expect(massageDocument(await getDocument(context.request(session1), document.id))).toEqual({
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

    expect(massageDocument(await getDocument(context.request(session1), document.id))).toEqual({
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

    expect(massageDocument(await getDocument(context.request(session1), document.id))).toEqual({
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

    expect(massageDocument(await getDocument(context.request(session1), document.id))).toEqual({
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
    const document = await createDocument(context.request(session1), {
        spaceId: space.id,
        content: emptyDocumentContent,
    });

    const client1Id = generateId<ContentEditorClientId>();
    const connection1 = await connectForTest(context.request(session1), document.id);
    const connection2 = await connectForTest(context.request(session2), document.id);

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
        },
        {
            type: "UpdateContentWithoutPersistence",
            newVersion: 2,
            steps: [new ReplaceStep(4, 4, textSlice("b"))],
            stepsContentReferences: emptyDocumentContentReferences,
            clientId: client1Id,
            updateOtherPresenceState: {connectionId: connection1.id, state: null},
        },
        {
            type: "UpdateContentWithoutPersistence",
            newVersion: 3,
            steps: [new ReplaceStep(5, 5, textSlice("c"))],
            stepsContentReferences: emptyDocumentContentReferences,
            clientId: client1Id,
            updateOtherPresenceState: {connectionId: connection1.id, state: null},
        },
    ]);

    expect(massageDocument(await getDocument(context.request(session1), document.id))).toEqual({
        version: 0,
        content: schema
            .node("doc", {}, [schema.node("title", {}, []), schema.node("paragraph", {}, [])])
            .toJSON(),
    });

    unpause();
    await waitForPersistance(connection1, 3);

    expect(massageDocument(await getDocument(context.request(session1), document.id))).toEqual({
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
        },
        {
            type: "PersistedContent",
            newVersion: 3,
        },
    ]);
});

test("will not batch updates from different accounts when persisting", async () => {
    const document = await createDocument(context.request(session1), {
        spaceId: space.id,
        content: emptyDocumentContent,
    });

    const client1Id = generateId<ContentEditorClientId>();
    const client3Id = generateId<ContentEditorClientId>();
    const connection1 = await connectForTest(context.request(session1), document.id);
    const connection2 = await connectForTest(context.request(session2), document.id);
    const connection3 = await connectForTest(context.request(session2), document.id);

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
        },
        {
            type: "UpdateContentWithoutPersistence",
            newVersion: 2,
            steps: [new ReplaceStep(4, 4, textSlice("b"))],
            stepsContentReferences: emptyDocumentContentReferences,
            clientId: client1Id,
            updateOtherPresenceState: {connectionId: connection1.id, state: null},
        },
        {
            type: "UpdateContentWithoutPersistence",
            newVersion: 3,
            steps: [new ReplaceStep(5, 5, textSlice("c"))],
            stepsContentReferences: emptyDocumentContentReferences,
            clientId: client3Id,
            updateOtherPresenceState: {connectionId: connection3.id, state: null},
        },
    ]);

    expect(massageDocument(await getDocument(context.request(session1), document.id))).toEqual({
        version: 0,
        content: schema
            .node("doc", {}, [schema.node("title", {}, []), schema.node("paragraph", {}, [])])
            .toJSON(),
    });

    unpause();
    await waitForPersistance(connection1, 3);

    expect(massageDocument(await getDocument(context.request(session1), document.id))).toEqual({
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
        },
        {
            type: "PersistedContent",
            newVersion: 2,
        },
        {
            type: "PersistedContent",
            newVersion: 3,
        },
    ]);
});

test("will respond optimistically with a comment thread even if it has not been persisted yet", async () => {
    const document = await createDocument(context.request(session1), {
        spaceId: space.id,
        content: emptyDocumentContent,
    });

    await updateDocumentContent(context.request(session1), {
        id: document.id,
        version: 0,
        steps: [new ReplaceStep(3, 3, textSlice("Hello, world!"))],
        clientId: generateId(),
    });

    const commentThreadId = generateId<DocumentCommentThreadId>();

    const client1Id = generateId<ContentEditorClientId>();
    const connection1 = await connectForTest(context.request(session1), document.id);
    const connection2 = await connectForTest(context.request(session2), document.id);

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
                            commentAuthors: [session1.account],
                        },
                    ],
                ]),
            },
            clientId: client1Id,
            updateOtherPresenceState: {connectionId: connection1.id, state: null},
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
                            commentAuthors: [session1.account],
                        },
                    ],
                ]),
            },
            clientId: client1Id,
            updateOtherPresenceState: {connectionId: connection1.id, state: null},
        },
    ]);

    expect(
        await getDocumentComment(context.request(session1), {
            documentId: document.id,
            commentThreadId,
            commentIndex: 0,
        }),
    ).toBeNull();

    unpause();
    await waitForPersistance(connection1, 2);

    expect(
        await getDocumentComment(context.request(session1), {
            documentId: document.id,
            commentThreadId,
            commentIndex: 0,
        }),
    ).not.toBeNull();

    expect(connection1.takeEvents()).toEqual([
        {
            type: "PersistedContent",
            newVersion: 2,
        },
    ]);

    expect(connection2.takeEvents()).toEqual([
        {
            type: "PersistedContent",
            newVersion: 2,
        },
    ]);
});

test("will respond optimistically to backfills with a comment thread even if it has not been persisted yet", async () => {
    const document = await createDocument(context.request(session1), {
        spaceId: space.id,
        content: emptyDocumentContent,
    });

    await updateDocumentContent(context.request(session1), {
        id: document.id,
        version: 0,
        steps: [new ReplaceStep(3, 3, textSlice("Hello, world!"))],
        clientId: generateId(),
    });

    const commentThreadId = generateId<DocumentCommentThreadId>();

    const client1Id = generateId<ContentEditorClientId>();
    const connection1 = await connectForTest(context.request(session1), document.id);

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
                            commentAuthors: [session1.account],
                        },
                    ],
                ]),
            },
            clientId: client1Id,
            updateOtherPresenceState: {connectionId: connection1.id, state: null},
        },
    ]);

    const connection2 = await connectForTest(context.request(session2), document.id);

    expect(
        await connection2.procedures.backfill({
            version: 1,
        }),
    ).toEqual({
        newVersion: 2,
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
                        commentAuthors: [session1.account],
                    },
                ],
            ]),
        },
        presenceStates: [],
        rememberInvertedSteps: [],
    });

    expect(connection2.takeEvents()).toEqual([]);

    expect(
        await getDocumentComment(context.request(session1), {
            documentId: document.id,
            commentThreadId,
            commentIndex: 0,
        }),
    ).toBeNull();

    unpause();
    await waitForPersistance(connection1, 2);

    expect(
        await getDocumentComment(context.request(session1), {
            documentId: document.id,
            commentThreadId,
            commentIndex: 0,
        }),
    ).not.toBeNull();

    expect(connection1.takeEvents()).toEqual([
        {
            type: "PersistedContent",
            newVersion: 2,
        },
    ]);

    expect(connection2.takeEvents()).toEqual([
        {
            type: "PersistedContent",
            newVersion: 2,
        },
    ]);
});

test("when comment threads are added back to the document they will be loaded", async () => {
    const document = await createDocument(context.request(session1), {
        spaceId: space.id,
        content: emptyDocumentContent,
    });

    await updateDocumentContent(context.request(session1), {
        id: document.id,
        version: 0,
        steps: [new ReplaceStep(3, 3, textSlice("Hello, world!"))],
        clientId: generateId(),
    });

    const commentThreadId = generateId<DocumentCommentThreadId>();

    await updateDocumentContent(context.request(session1), {
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

    await createDocumentComment(context.request(session3), {
        documentId: document.id,
        commentThreadId,
        parentCommentIndex: null,
        content: createSimpleMessageContent("Test message content 2"),
    });

    await updateDocumentContent(context.request(session1), {
        id: document.id,
        version: 2,
        steps: [new RemoveMarkStep(10, 15, schema.mark("comment", {commentThreadId}))],
        clientId: generateId(),
    });

    const client1Id = generateId<ContentEditorClientId>();
    const connection1 = await connectForTest(context.request(session1), document.id);
    const connection2 = await connectForTest(context.request(session2), document.id);

    await connection1.procedures.backfill({
        version: 0,
    });

    await connection2.procedures.backfill({
        version: 0,
    });

    // Ignore backfill response message.
    connection1.takeEvents();
    connection2.takeEvents();

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
                            commentAuthors: [session1.account, session3.account],
                        },
                    ],
                ]),
            },
            clientId: client1Id,
            updateOtherPresenceState: {connectionId: connection1.id, state: null},
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
                            commentAuthors: [session1.account, session3.account],
                        },
                    ],
                ]),
            },
            clientId: client1Id,
            updateOtherPresenceState: {connectionId: connection1.id, state: null},
        },
    ]);
});

test("comment thread can be optimistic at first and then loaded from the database", async () => {
    const document = await createDocument(context.request(session1), {
        spaceId: space.id,
        content: emptyDocumentContent,
    });

    await updateDocumentContent(context.request(session1), {
        id: document.id,
        version: 0,
        steps: [new ReplaceStep(3, 3, textSlice("Hello, world!"))],
        clientId: generateId(),
    });

    const commentThreadId = generateId<DocumentCommentThreadId>();

    const client1Id = generateId<ContentEditorClientId>();
    const connection1 = await connectForTest(context.request(session1), document.id);
    const connection2 = await connectForTest(context.request(session2), document.id);

    await connection1.procedures.backfill({
        version: 0,
    });

    await connection2.procedures.backfill({
        version: 0,
    });

    // Ignore backfill response message.
    connection1.takeEvents();
    connection2.takeEvents();

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

    await createDocumentComment(context.request(session3), {
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
        },
        {
            type: "PersistedContent",
            newVersion: 3,
        },
        {
            type: "PersistedContent",
            newVersion: 4,
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
                            commentAuthors: [session1.account],
                        },
                    ],
                ]),
            },
            clientId: client1Id,
            updateOtherPresenceState: {connectionId: connection1.id, state: null},
        },
        {
            type: "UpdateContentWithoutPersistence",
            newVersion: 3,
            steps: [new RemoveMarkStep(10, 15, schema.mark("comment", {commentThreadId}))],
            stepsContentReferences: {
                ...emptyDocumentContentReferences,
                commentThreadById: new Map([
                    [
                        commentThreadId,
                        {
                            commentCount: 2,
                            commentAuthors: [session1.account, session3.account],
                        },
                    ],
                ]),
            },
            clientId: client1Id,
            updateOtherPresenceState: {connectionId: connection1.id, state: null},
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
                            commentAuthors: [session1.account, session3.account],
                        },
                    ],
                ]),
            },
            clientId: client1Id,
            updateOtherPresenceState: {connectionId: connection1.id, state: null},
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
        },
        {
            type: "PersistedContent",
            newVersion: 3,
        },
        {
            type: "PersistedContent",
            newVersion: 4,
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
                            commentAuthors: [session1.account],
                        },
                    ],
                ]),
            },
            clientId: client1Id,
            updateOtherPresenceState: {connectionId: connection1.id, state: null},
        },
        {
            type: "UpdateContentWithoutPersistence",
            newVersion: 3,
            steps: [new RemoveMarkStep(10, 15, schema.mark("comment", {commentThreadId}))],
            stepsContentReferences: {
                ...emptyDocumentContentReferences,
                commentThreadById: new Map([
                    [
                        commentThreadId,
                        {
                            commentCount: 2,
                            commentAuthors: [session1.account, session3.account],
                        },
                    ],
                ]),
            },
            clientId: client1Id,
            updateOtherPresenceState: {connectionId: connection1.id, state: null},
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
                            commentAuthors: [session1.account, session3.account],
                        },
                    ],
                ]),
            },
            clientId: client1Id,
            updateOtherPresenceState: {connectionId: connection1.id, state: null},
        },
    ]);
});

test("can create comments in comment threads", async () => {
    const document = await createDocument(context.request(session1), {
        spaceId: space.id,
        content: emptyDocumentContent,
    });

    await updateDocumentContent(context.request(session1), {
        id: document.id,
        version: 0,
        steps: [new ReplaceStep(3, 3, textSlice("Hello, world!"))],
        clientId: generateId(),
    });

    const commentThreadId = generateId<DocumentCommentThreadId>();

    const client1Id = generateId<ContentEditorClientId>();
    const connection1 = await connectForTest(context.request(session1), document.id);
    const connection2 = await connectForTest(context.request(session2), document.id);

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
                            commentAuthors: [session1.account],
                        },
                    ],
                ]),
            },
            clientId: client1Id,
            updateOtherPresenceState: {connectionId: connection1.id, state: null},
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
                            commentAuthors: [session1.account],
                        },
                    ],
                ]),
            },
            clientId: client1Id,
            updateOtherPresenceState: {connectionId: connection1.id, state: null},
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
                    author: session1.account,
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
                    author: session1.account,
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
        commentCount: 2,
        lastCommentChangeTime: null,
        newComments: [
            new DocumentCommentModel({
                documentId: document.id,
                commentThreadId,
                index: 1,
                author: session1.account,
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
        commentCount: 2,
        lastCommentChangeTime: null,
        newComments: [
            new DocumentCommentModel({
                documentId: document.id,
                commentThreadId,
                index: 0,
                author: session1.account,
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
                author: session1.account,
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
                    author: session1.account,
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
                    author: session1.account,
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
    const document = await createDocument(context.request(session1), {
        spaceId: space.id,
        content: emptyDocumentContent,
    });

    await updateDocumentContent(context.request(session1), {
        id: document.id,
        version: 0,
        steps: [new ReplaceStep(3, 3, textSlice("Hello, world!"))],
        clientId: generateId(),
    });

    const commentThreadId = generateId<DocumentCommentThreadId>();

    const client1Id = generateId<ContentEditorClientId>();
    const connection1 = await connectForTest(context.request(session1), document.id);
    const connection2 = await connectForTest(context.request(session2), document.id);

    await connection1.procedures.backfill({
        version: 0,
    });

    await connection2.procedures.backfill({
        version: 0,
    });

    // Ignore backfill response message.
    connection1.takeEvents();
    connection2.takeEvents();

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
                            commentAuthors: [session1.account],
                        },
                    ],
                ]),
            },
            clientId: client1Id,
            updateOtherPresenceState: {connectionId: connection1.id, state: null},
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
                            commentAuthors: [session1.account],
                        },
                    ],
                ]),
            },
            clientId: client1Id,
            updateOtherPresenceState: {connectionId: connection1.id, state: null},
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
        commentCount: 1,
        lastCommentChangeTime: null,
        newComments: [
            new DocumentCommentModel({
                documentId: document.id,
                commentThreadId,
                index: 0,
                author: session1.account,
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
                    author: session2.account,
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
                    author: session2.account,
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
    const document = await createDocument(context.request(session1), {
        spaceId: space.id,
        content: emptyDocumentContent,
    });

    await updateDocumentContent(context.request(session1), {
        id: document.id,
        version: 0,
        steps: [new ReplaceStep(3, 3, textSlice("Hello, world!"))],
        clientId: generateId(),
    });

    const commentThreadId = generateId<DocumentCommentThreadId>();

    const client1Id = generateId<ContentEditorClientId>();
    const connection1 = await connectForTest(context.request(session1), document.id);
    const connection2 = await connectForTest(context.request(session2), document.id);

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
                            commentAuthors: [session1.account],
                        },
                    ],
                ]),
            },
            clientId: client1Id,
            updateOtherPresenceState: {connectionId: connection1.id, state: null},
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
                            commentAuthors: [session1.account],
                        },
                    ],
                ]),
            },
            clientId: client1Id,
            updateOtherPresenceState: {connectionId: connection1.id, state: null},
        },
    ]);

    expect(await backfillMessagePromise).toEqual({
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
        commentCount: 1,
        lastCommentChangeTime: null,
        newComments: [
            new DocumentCommentModel({
                documentId: document.id,
                commentThreadId,
                index: 0,
                author: session1.account,
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
                    author: session2.account,
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
                    author: session2.account,
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
