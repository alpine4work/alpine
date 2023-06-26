import {Fragment, Slice} from "prosemirror-model";
import {
    AddMarkStep,
    RemoveMarkStep,
    ReplaceAroundStep,
    ReplaceStep,
    Step,
} from "prosemirror-transform";
import {
    DocumentContentCacheForUpdate,
    backfillDocumentComments,
    batchGetDocumentCommentThreadsIfExists,
    createDocument,
    createDocumentComment,
    deleteDocumentComment,
    documentContentCacheEvictionTimeoutMs,
    getDocument,
    getDocumentComment,
    getDocumentCommentThreadItemAfterFirstGetItemTestCheckpoint,
    getDocumentCommentThreadNotificationSubscribers,
    getDocumentCommentsFromEnd,
    getDocumentCommentsFromStart,
    getDocumentContentSteps,
    getDocumentPreviewIfExists,
    getDocumentsTableForTest,
    getInternalDocumentTestCounter,
    updateDocumentCommentContent,
    updateDocumentContent,
    updateDocumentContentBeforeExecuteTransactionTestCheckpoint,
    updateDocumentSnapshotBeforeMovingCommentThreadTestCheckpoint,
    updateDocumentSnapshotForTest,
} from "~/server/dynamo/documents_table.js";
import {testMessagingImplementation} from "~/server/dynamo/test_helpers/jest/test_messaging_implementation.js";
import {createTestContext} from "~/server/dynamo/test_helpers/shared/create_test_context.js";
import {createTestSession} from "~/server/dynamo/test_helpers/shared/create_test_session.js";
import {createTestSpace} from "~/server/dynamo/test_helpers/shared/create_test_space.js";
import {
    emptyDocumentContent,
    isDocumentContent,
    DocumentContentProsemirrorSchema as schema,
} from "~/shared/documents/document_content_schema.js";
import {
    DocumentCommentRoomKey,
    DocumentModel,
    decodeDocumentCommentRoomKey,
    encodeDocumentCommentRoomKey,
} from "~/shared/documents/document_model.js";
import {
    DataLossError,
    FailedPreconditionError,
    InvalidArgumentError,
    NotFoundError,
    PermissionDeniedError,
} from "~/shared/error/error.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {reduceIterable} from "~/shared/helpers/iterable/reduce_iterable.js";
import {generateId} from "~/shared/id/id.js";
import {
    ContentEditorClientId,
    DocumentCommentThreadId,
    DocumentId,
} from "~/shared/id/types/id_types.js";
import {
    MessageContentProsemirrorSchema,
    assertMessageContent,
    createSimpleMessageContent,
} from "~/shared/messaging/message_content_schema.js";
import {RemoveAllMarksStep} from "~/shared/prosemirror/remove_all_marks_step.js";

jest.useFakeTimers();

const context = createTestContext();
const space = createTestSpace(context);
const session1 = createTestSession(context, space);
const session2 = createTestSession(context, space);
const session3 = createTestSession(context, space);
const session4 = createTestSession(context, space);
const session5 = createTestSession(context, space);
const session6 = createTestSession(context, space);
const session7 = createTestSession(context, space);
const otherSpace = createTestSpace(context);
const otherSession = createTestSession(context, otherSpace);

function textSlice(text: string) {
    if (text.length === 0) return Slice.empty;
    return new Slice(Fragment.from(schema.text(text)), 0, 0);
}

/**
 * Convert document into a form we can do a deep equality test on.
 */
function massageDocument(document: DocumentModel) {
    return {
        version: document.version,
        content: document.content.doc.toJSON(),
    };
}

const otherCache = new DocumentContentCacheForUpdate();

beforeEach(() => {
    jest.useFakeTimers();
});

afterEach(() => {
    const hadNoTimers = jest.getTimerCount() === 0;
    jest.clearAllTimers();
    jest.useRealTimers();
    assert(hadNoTimers, "Expected all timers to be cleaned up by the end of each test");
});

test("creates a document", async () => {
    await createDocument(context.action(session1), {
        spaceId: space.id,
        content: emptyDocumentContent,
    });
});

test("can not create a document with the same id twice", async () => {
    const id = generateId<DocumentId>();

    const content = schema.node("doc", {}, [
        schema.node("title", {}, [schema.text("Foo bar")]),
        schema.node("paragraph", {}, [schema.text("Hello, world!")]),
    ]);
    assert(isDocumentContent(content));

    await createDocument(context.action(session1), {
        id,
        spaceId: space.id,
        content: emptyDocumentContent,
    });

    await expect(async () => {
        await createDocument(context.action(session1), {
            id,
            spaceId: space.id,
            content,
        });
    }).rejects.toThrow(FailedPreconditionError);
});

test("can not create a document with invalid format", async () => {
    const content = schema.nodes.doc.create({}, [
        schema.nodes.title.create({}, [schema.text("Foo bar")]),
        schema.nodes.unorderedListItem.create({}, [schema.text("Hello, world!")]),
    ]);
    assert(isDocumentContent(content));

    await expect(
        createDocument(context.action(session1), {
            spaceId: space.id,
            content,
        }),
    ).rejects.toThrowError(InvalidArgumentError);
});

test("can idempotently create a document twice", async () => {
    const id = generateId<DocumentId>();

    await createDocument(context.action(session1), {
        id,
        spaceId: space.id,
        content: emptyDocumentContent,
    });

    await createDocument(context.action(session1), {
        id,
        spaceId: space.id,
        content: emptyDocumentContent,
    });
});

test("can not idempotently create a document twice if the content is different", async () => {
    const id = generateId<DocumentId>();

    await createDocument(context.action(session1), {
        id,
        spaceId: space.id,
        content: emptyDocumentContent,
    });

    const otherContent = schema.node("doc", {}, [
        schema.node("title", {}, [schema.text("Foo bar")]),
        schema.node("paragraph", {}, [schema.text("Hello, world!")]),
    ]);
    assert(isDocumentContent(otherContent));

    await expect(async () => {
        await createDocument(context.action(session1), {
            id,
            spaceId: space.id,
            content: otherContent,
        });
    }).rejects.toThrow(FailedPreconditionError);
});

test("can read a created document", async () => {
    const content = schema.node("doc", {}, [
        schema.node("title", {}, [schema.text("Foo bar")]),
        schema.node("paragraph", {}, [schema.text("Hello, world!")]),
    ]);
    assert(isDocumentContent(content));

    const {id: documentId} = await createDocument(context.action(session1), {
        spaceId: space.id,
        content,
    });

    expect(massageDocument(await getDocument(context.action(session1), documentId))).toEqual({
        version: 0,
        content: content.toJSON(),
    });
    expect(await getDocumentPreviewIfExists(context.action(session1), documentId)).toEqual({
        id: documentId,
        spaceId: space.id,
        createdTime: expect.any(Date),
        version: 0,
        titleWithoutFallback: "Foo bar",
    });
});

test("can update a document with a single step", async () => {
    const {id: documentId} = await createDocument(context.action(session1), {
        spaceId: space.id,
        content: emptyDocumentContent,
    });

    await updateDocumentContent(context.action(session1), {
        id: documentId,
        version: 0,
        steps: [new ReplaceStep(3, 3, textSlice("a"))],
        clientId: generateId(),
    });

    expect(massageDocument(await getDocument(context.action(session1), documentId))).toEqual({
        version: 1,
        content: schema
            .node("doc", {}, [
                schema.node("title", {}, []),
                schema.node("paragraph", {}, [schema.text("a")]),
            ])
            .toJSON(),
    });

    await updateDocumentContent(context.action(session1), {
        id: documentId,
        version: 1,
        steps: [new ReplaceStep(4, 4, textSlice("b"))],
        clientId: generateId(),
    });

    expect(massageDocument(await getDocument(context.action(session1), documentId))).toEqual({
        version: 2,
        content: schema
            .node("doc", {}, [
                schema.node("title", {}, []),
                schema.node("paragraph", {}, [schema.text("ab")]),
            ])
            .toJSON(),
    });

    await updateDocumentContent(context.action(session1), {
        id: documentId,
        version: 2,
        steps: [new ReplaceStep(5, 5, textSlice("c"))],
        clientId: generateId(),
    });

    expect(massageDocument(await getDocument(context.action(session1), documentId))).toEqual({
        version: 3,
        content: schema
            .node("doc", {}, [
                schema.node("title", {}, []),
                schema.node("paragraph", {}, [schema.text("abc")]),
            ])
            .toJSON(),
    });
});

test("can update a document with multiple steps", async () => {
    const {id: documentId} = await createDocument(context.action(session1), {
        spaceId: space.id,
        content: emptyDocumentContent,
    });

    await updateDocumentContent(context.action(session1), {
        id: documentId,
        version: 0,
        steps: [new ReplaceStep(3, 3, textSlice("a"))],
        clientId: generateId(),
    });

    expect(massageDocument(await getDocument(context.action(session1), documentId))).toEqual({
        version: 1,
        content: schema
            .node("doc", {}, [
                schema.node("title", {}, []),
                schema.node("paragraph", {}, [schema.text("a")]),
            ])
            .toJSON(),
    });

    await updateDocumentContent(context.action(session1), {
        id: documentId,
        version: 1,
        steps: [
            new ReplaceStep(4, 4, textSlice("b")),
            new ReplaceStep(5, 5, textSlice("c")),
            new ReplaceStep(6, 6, textSlice("d")),
        ],
        clientId: generateId(),
    });

    expect(massageDocument(await getDocument(context.action(session1), documentId))).toEqual({
        version: 4,
        content: schema
            .node("doc", {}, [
                schema.node("title", {}, []),
                schema.node("paragraph", {}, [schema.text("abcd")]),
            ])
            .toJSON(),
    });
});

test("can not update a document if the version is greater than the current version", async () => {
    const {id: documentId} = await createDocument(context.action(session1), {
        spaceId: space.id,
        content: emptyDocumentContent,
    });

    await updateDocumentContent(context.action(session1), {
        id: documentId,
        version: 0,
        steps: [new ReplaceStep(3, 3, textSlice("a"))],
        clientId: generateId(),
    });

    expect(massageDocument(await getDocument(context.action(session1), documentId))).toEqual({
        version: 1,
        content: schema
            .node("doc", {}, [
                schema.node("title", {}, []),
                schema.node("paragraph", {}, [schema.text("a")]),
            ])
            .toJSON(),
    });

    await expect(async () => {
        await updateDocumentContent(context.action(session1), {
            id: documentId,
            version: 2,
            steps: [new ReplaceStep(5, 5, textSlice("c"))],
            clientId: generateId(),
        });
    }).rejects.toThrow(FailedPreconditionError);

    expect(massageDocument(await getDocument(context.action(session1), documentId))).toEqual({
        version: 1,
        content: schema
            .node("doc", {}, [
                schema.node("title", {}, []),
                schema.node("paragraph", {}, [schema.text("a")]),
            ])
            .toJSON(),
    });
});

test("can update a document if the version is one less than the current version", async () => {
    const {id: documentId} = await createDocument(context.action(session1), {
        spaceId: space.id,
        content: emptyDocumentContent,
    });

    await updateDocumentContent(context.action(session1), {
        id: documentId,
        version: 0,
        steps: [new ReplaceStep(3, 3, textSlice("a"))],
        clientId: generateId(),
    });

    expect(massageDocument(await getDocument(context.action(session1), documentId))).toEqual({
        version: 1,
        content: schema
            .node("doc", {}, [
                schema.node("title", {}, []),
                schema.node("paragraph", {}, [schema.text("a")]),
            ])
            .toJSON(),
    });

    await updateDocumentContent(context.action(session1), {
        id: documentId,
        version: 1,
        steps: [new ReplaceStep(4, 4, textSlice("b"))],
        clientId: generateId(),
    });

    expect(massageDocument(await getDocument(context.action(session1), documentId))).toEqual({
        version: 2,
        content: schema
            .node("doc", {}, [
                schema.node("title", {}, []),
                schema.node("paragraph", {}, [schema.text("ab")]),
            ])
            .toJSON(),
    });

    await updateDocumentContent(context.action(session1), {
        id: documentId,
        version: 1,
        steps: [new ReplaceStep(4, 4, textSlice("c"))],
        clientId: generateId(),
    });

    expect(massageDocument(await getDocument(context.action(session1), documentId))).toEqual({
        version: 3,
        content: schema
            .node("doc", {}, [
                schema.node("title", {}, []),
                schema.node("paragraph", {}, [schema.text("abc")]),
            ])
            .toJSON(),
    });
});

test("can update a document if the version is many steps behind the current version", async () => {
    const {id: documentId} = await createDocument(context.action(session1), {
        spaceId: space.id,
        content: emptyDocumentContent,
    });

    await updateDocumentContent(context.action(session1), {
        id: documentId,
        version: 0,
        steps: [new ReplaceStep(3, 3, textSlice("a"))],
        clientId: generateId(),
    });

    expect(massageDocument(await getDocument(context.action(session1), documentId))).toEqual({
        version: 1,
        content: schema
            .node("doc", {}, [
                schema.node("title", {}, []),
                schema.node("paragraph", {}, [schema.text("a")]),
            ])
            .toJSON(),
    });

    await updateDocumentContent(context.action(session1), {
        id: documentId,
        version: 1,
        steps: [new ReplaceStep(4, 4, textSlice("b"))],
        clientId: generateId(),
    });

    await updateDocumentContent(context.action(session1), {
        id: documentId,
        version: 2,
        steps: [new ReplaceStep(5, 5, textSlice("c"))],
        clientId: generateId(),
    });

    await updateDocumentContent(context.action(session1), {
        id: documentId,
        version: 3,
        steps: [new ReplaceStep(6, 6, textSlice("d"))],
        clientId: generateId(),
    });

    await updateDocumentContent(context.action(session1), {
        id: documentId,
        version: 4,
        steps: [new ReplaceStep(7, 7, textSlice("e"))],
        clientId: generateId(),
    });

    expect(massageDocument(await getDocument(context.action(session1), documentId))).toEqual({
        version: 5,
        content: schema
            .node("doc", {}, [
                schema.node("title", {}, []),
                schema.node("paragraph", {}, [schema.text("abcde")]),
            ])
            .toJSON(),
    });

    await updateDocumentContent(context.action(session1), {
        id: documentId,
        version: 1,
        steps: [new ReplaceStep(4, 4, textSlice("f"))],
        clientId: generateId(),
    });

    expect(massageDocument(await getDocument(context.action(session1), documentId))).toEqual({
        version: 6,
        content: schema
            .node("doc", {}, [
                schema.node("title", {}, []),
                schema.node("paragraph", {}, [schema.text("abcdef")]),
            ])
            .toJSON(),
    });
});

test("can update a document with many steps if the version is one less than the current version", async () => {
    const {id: documentId} = await createDocument(context.action(session1), {
        spaceId: space.id,
        content: emptyDocumentContent,
    });

    await updateDocumentContent(context.action(session1), {
        id: documentId,
        version: 0,
        steps: [new ReplaceStep(3, 3, textSlice("a"))],
        clientId: generateId(),
    });

    expect(massageDocument(await getDocument(context.action(session1), documentId))).toEqual({
        version: 1,
        content: schema
            .node("doc", {}, [
                schema.node("title", {}, []),
                schema.node("paragraph", {}, [schema.text("a")]),
            ])
            .toJSON(),
    });

    await updateDocumentContent(context.action(session1), {
        id: documentId,
        version: 1,
        steps: [new ReplaceStep(4, 4, textSlice("b"))],
        clientId: generateId(),
    });

    expect(massageDocument(await getDocument(context.action(session1), documentId))).toEqual({
        version: 2,
        content: schema
            .node("doc", {}, [
                schema.node("title", {}, []),
                schema.node("paragraph", {}, [schema.text("ab")]),
            ])
            .toJSON(),
    });

    await updateDocumentContent(context.action(session1), {
        id: documentId,
        version: 1,
        steps: [
            new ReplaceStep(4, 4, textSlice("c")),
            new ReplaceStep(5, 5, textSlice("d")),
            new ReplaceStep(6, 6, textSlice("e")),
            new ReplaceStep(7, 7, textSlice("f")),
        ],
        clientId: generateId(),
    });

    expect(massageDocument(await getDocument(context.action(session1), documentId))).toEqual({
        version: 6,
        content: schema
            .node("doc", {}, [
                schema.node("title", {}, []),
                schema.node("paragraph", {}, [schema.text("abcdef")]),
            ])
            .toJSON(),
    });
});

test("can update a document with many steps if the version is many steps behind the current version", async () => {
    const {id: documentId} = await createDocument(context.action(session1), {
        spaceId: space.id,
        content: emptyDocumentContent,
    });

    await updateDocumentContent(context.action(session1), {
        id: documentId,
        version: 0,
        steps: [new ReplaceStep(3, 3, textSlice("a"))],
        clientId: generateId(),
    });

    expect(massageDocument(await getDocument(context.action(session1), documentId))).toEqual({
        version: 1,
        content: schema
            .node("doc", {}, [
                schema.node("title", {}, []),
                schema.node("paragraph", {}, [schema.text("a")]),
            ])
            .toJSON(),
    });

    await updateDocumentContent(context.action(session1), {
        id: documentId,
        version: 1,
        steps: [new ReplaceStep(4, 4, textSlice("b"))],
        clientId: generateId(),
    });

    await updateDocumentContent(context.action(session1), {
        id: documentId,
        version: 2,
        steps: [new ReplaceStep(5, 5, textSlice("c"))],
        clientId: generateId(),
    });

    await updateDocumentContent(context.action(session1), {
        id: documentId,
        version: 3,
        steps: [new ReplaceStep(6, 6, textSlice("d"))],
        clientId: generateId(),
    });

    await updateDocumentContent(context.action(session1), {
        id: documentId,
        version: 4,
        steps: [new ReplaceStep(7, 7, textSlice("e"))],
        clientId: generateId(),
    });

    expect(massageDocument(await getDocument(context.action(session1), documentId))).toEqual({
        version: 5,
        content: schema
            .node("doc", {}, [
                schema.node("title", {}, []),
                schema.node("paragraph", {}, [schema.text("abcde")]),
            ])
            .toJSON(),
    });

    await updateDocumentContent(context.action(session1), {
        id: documentId,
        version: 1,
        steps: [
            new ReplaceStep(4, 4, textSlice("f")),
            new ReplaceStep(5, 5, textSlice("g")),
            new ReplaceStep(6, 6, textSlice("h")),
            new ReplaceStep(7, 7, textSlice("i")),
        ],
        clientId: generateId(),
    });

    expect(massageDocument(await getDocument(context.action(session1), documentId))).toEqual({
        version: 9,
        content: schema
            .node("doc", {}, [
                schema.node("title", {}, []),
                schema.node("paragraph", {}, [schema.text("abcdefghi")]),
            ])
            .toJSON(),
    });
});

test("when two document updates race the loser will rebase", async () => {
    const {id: documentId} = await createDocument(context.action(session1), {
        spaceId: space.id,
        content: emptyDocumentContent,
    });

    await updateDocumentContent(context.action(session1), {
        id: documentId,
        version: 0,
        steps: [new ReplaceStep(3, 3, textSlice("a"))],
        clientId: generateId(),
    });

    expect(massageDocument(await getDocument(context.action(session1), documentId))).toEqual({
        version: 1,
        content: schema
            .node("doc", {}, [
                schema.node("title", {}, []),
                schema.node("paragraph", {}, [schema.text("a")]),
            ])
            .toJSON(),
    });

    const request2ClientId = generateId<ContentEditorClientId>();
    const request2PausePromise =
        updateDocumentContentBeforeExecuteTransactionTestCheckpoint.pauseForTest({
            id: documentId,
            clientId: request2ClientId,
        });
    const request2Promise = updateDocumentContent(context.action(session1), {
        id: documentId,
        version: 1,
        steps: [new ReplaceStep(4, 4, textSlice("b"))],
        clientId: request2ClientId,
    });

    const {unpause: unpauseRequest2} = await request2PausePromise;

    expect(massageDocument(await getDocument(context.action(session1), documentId))).toEqual({
        version: 1,
        content: schema
            .node("doc", {}, [
                schema.node("title", {}, []),
                schema.node("paragraph", {}, [schema.text("a")]),
            ])
            .toJSON(),
    });

    await updateDocumentContent(context.action(session1), {
        id: documentId,
        version: 1,
        steps: [new ReplaceStep(4, 4, textSlice("c"))],
        clientId: generateId(),
    });

    expect(massageDocument(await getDocument(context.action(session1), documentId))).toEqual({
        version: 2,
        content: schema
            .node("doc", {}, [
                schema.node("title", {}, []),
                schema.node("paragraph", {}, [schema.text("ac")]),
            ])
            .toJSON(),
    });

    unpauseRequest2();

    await request2Promise;

    expect(massageDocument(await getDocument(context.action(session1), documentId))).toEqual({
        version: 3,
        content: schema
            .node("doc", {}, [
                schema.node("title", {}, []),
                schema.node("paragraph", {}, [schema.text("acb")]),
            ])
            .toJSON(),
    });
});

test("can not apply an invalid step", async () => {
    const {id: documentId} = await createDocument(context.action(session1), {
        spaceId: space.id,
        content: emptyDocumentContent,
    });

    await updateDocumentContent(context.action(session1), {
        id: documentId,
        version: 0,
        steps: [new ReplaceStep(3, 3, textSlice("a"))],
        clientId: generateId(),
    });

    expect(massageDocument(await getDocument(context.action(session1), documentId))).toEqual({
        version: 1,
        content: schema
            .node("doc", {}, [
                schema.node("title", {}, []),
                schema.node("paragraph", {}, [schema.text("a")]),
            ])
            .toJSON(),
    });

    await expect(async () => {
        await updateDocumentContent(context.action(session1), {
            id: documentId,
            version: 1,
            steps: [new ReplaceStep(5, 5, textSlice("b"))],
            clientId: generateId(),
        });
    }).rejects.toThrow(FailedPreconditionError);

    expect(massageDocument(await getDocument(context.action(session1), documentId))).toEqual({
        version: 1,
        content: schema
            .node("doc", {}, [
                schema.node("title", {}, []),
                schema.node("paragraph", {}, [schema.text("a")]),
            ])
            .toJSON(),
    });
});

test("can not apply an invalid step even when rebasing", async () => {
    const {id: documentId} = await createDocument(context.action(session1), {
        spaceId: space.id,
        content: emptyDocumentContent,
    });

    await updateDocumentContent(context.action(session1), {
        id: documentId,
        version: 0,
        steps: [new ReplaceStep(3, 3, textSlice("a"))],
        clientId: generateId(),
    });

    expect(massageDocument(await getDocument(context.action(session1), documentId))).toEqual({
        version: 1,
        content: schema
            .node("doc", {}, [
                schema.node("title", {}, []),
                schema.node("paragraph", {}, [schema.text("a")]),
            ])
            .toJSON(),
    });

    await updateDocumentContent(context.action(session1), {
        id: documentId,
        version: 1,
        steps: [new ReplaceStep(4, 4, textSlice("b"))],
        clientId: generateId(),
    });

    expect(massageDocument(await getDocument(context.action(session1), documentId))).toEqual({
        version: 2,
        content: schema
            .node("doc", {}, [
                schema.node("title", {}, []),
                schema.node("paragraph", {}, [schema.text("ab")]),
            ])
            .toJSON(),
    });

    await expect(async () => {
        await updateDocumentContent(context.action(session1), {
            id: documentId,
            version: 1,
            steps: [new ReplaceStep(5, 5, textSlice("c"))],
            clientId: generateId(),
        });
    }).rejects.toThrow(FailedPreconditionError);

    expect(massageDocument(await getDocument(context.action(session1), documentId))).toEqual({
        version: 2,
        content: schema
            .node("doc", {}, [
                schema.node("title", {}, []),
                schema.node("paragraph", {}, [schema.text("ab")]),
            ])
            .toJSON(),
    });
});

test("a single rebased step may end up as a noop", async () => {
    const {id: documentId} = await createDocument(context.action(session1), {
        spaceId: space.id,
        content: emptyDocumentContent,
    });

    await updateDocumentContent(context.action(session1), {
        id: documentId,
        version: 0,
        steps: [new ReplaceStep(3, 3, textSlice("foobar"))],
        clientId: generateId(),
    });

    expect(massageDocument(await getDocument(context.action(session1), documentId))).toEqual({
        version: 1,
        content: schema
            .node("doc", {}, [
                schema.node("title", {}, []),
                schema.node("paragraph", {}, [schema.text("foobar")]),
            ])
            .toJSON(),
    });

    await updateDocumentContent(context.action(session1), {
        id: documentId,
        version: 1,
        steps: [new ReplaceStep(5, 7, Slice.empty)],
        clientId: generateId(),
    });

    expect(massageDocument(await getDocument(context.action(session1), documentId))).toEqual({
        version: 2,
        content: schema
            .node("doc", {}, [
                schema.node("title", {}, []),
                schema.node("paragraph", {}, [schema.text("foar")]),
            ])
            .toJSON(),
    });

    await updateDocumentContent(context.action(session1), {
        id: documentId,
        version: 1,
        steps: [new ReplaceStep(6, 6, textSlice("x"))],
        clientId: generateId(),
    });

    expect(massageDocument(await getDocument(context.action(session1), documentId))).toEqual({
        version: 2,
        content: schema
            .node("doc", {}, [
                schema.node("title", {}, []),
                schema.node("paragraph", {}, [schema.text("foar")]),
            ])
            .toJSON(),
    });
});

test("many rebased steps may end up as a noop", async () => {
    const {id: documentId} = await createDocument(context.action(session1), {
        spaceId: space.id,
        content: emptyDocumentContent,
    });

    await updateDocumentContent(context.action(session1), {
        id: documentId,
        version: 0,
        steps: [new ReplaceStep(3, 3, textSlice("foobur"))],
        clientId: generateId(),
    });

    expect(massageDocument(await getDocument(context.action(session1), documentId))).toEqual({
        version: 1,
        content: schema
            .node("doc", {}, [
                schema.node("title", {}, []),
                schema.node("paragraph", {}, [schema.text("foobur")]),
            ])
            .toJSON(),
    });

    await updateDocumentContent(context.action(session1), {
        id: documentId,
        version: 1,
        steps: [new ReplaceStep(5, 7, Slice.empty)],
        clientId: generateId(),
    });

    expect(massageDocument(await getDocument(context.action(session1), documentId))).toEqual({
        version: 2,
        content: schema
            .node("doc", {}, [
                schema.node("title", {}, []),
                schema.node("paragraph", {}, [schema.text("four")]),
            ])
            .toJSON(),
    });

    await updateDocumentContent(context.action(session1), {
        id: documentId,
        version: 1,
        steps: [
            new ReplaceStep(6, 6, textSlice("x")),
            new ReplaceStep(7, 7, textSlice("y")),
            new ReplaceStep(8, 8, textSlice("z")),
        ],
        clientId: generateId(),
    });

    expect(massageDocument(await getDocument(context.action(session1), documentId))).toEqual({
        version: 2,
        content: schema
            .node("doc", {}, [
                schema.node("title", {}, []),
                schema.node("paragraph", {}, [schema.text("four")]),
            ])
            .toJSON(),
    });
});

test("some rebased steps may end up as a noop", async () => {
    const {id: documentId} = await createDocument(context.action(session1), {
        spaceId: space.id,
        content: emptyDocumentContent,
    });

    await updateDocumentContent(context.action(session1), {
        id: documentId,
        version: 0,
        steps: [new ReplaceStep(3, 3, textSlice("foobur"))],
        clientId: generateId(),
    });

    expect(massageDocument(await getDocument(context.action(session1), documentId))).toEqual({
        version: 1,
        content: schema
            .node("doc", {}, [
                schema.node("title", {}, []),
                schema.node("paragraph", {}, [schema.text("foobur")]),
            ])
            .toJSON(),
    });

    await updateDocumentContent(context.action(session1), {
        id: documentId,
        version: 1,
        steps: [new ReplaceStep(5, 7, Slice.empty)],
        clientId: generateId(),
    });

    expect(massageDocument(await getDocument(context.action(session1), documentId))).toEqual({
        version: 2,
        content: schema
            .node("doc", {}, [
                schema.node("title", {}, []),
                schema.node("paragraph", {}, [schema.text("four")]),
            ])
            .toJSON(),
    });

    await updateDocumentContent(context.action(session1), {
        id: documentId,
        version: 1,
        steps: [
            new ReplaceStep(6, 6, textSlice("x")),
            new ReplaceStep(7, 7, textSlice("y")),
            new ReplaceStep(11, 11, textSlice("z")),
        ],
        clientId: generateId(),
    });

    expect(massageDocument(await getDocument(context.action(session1), documentId))).toEqual({
        version: 3,
        content: schema
            .node("doc", {}, [
                schema.node("title", {}, []),
                schema.node("paragraph", {}, [schema.text("fourz")]),
            ])
            .toJSON(),
    });
});

test("reads the document on first update but not on subsequent updates", async () => {
    const {id: documentId} = await createDocument(context.action(session1), {
        spaceId: space.id,
        content: emptyDocumentContent,
    });

    const {getCount} = getInternalDocumentTestCounter.recordForTest(documentId);
    expect(getCount()).toEqual(0);

    await updateDocumentContent(context.action(session1), {
        id: documentId,
        version: 0,
        steps: [new ReplaceStep(3, 3, textSlice("a"))],
        clientId: generateId(),
    });

    expect(getCount()).toEqual(1);

    expect(massageDocument(await getDocument(context.action(session1), documentId))).toEqual({
        version: 1,
        content: schema
            .node("doc", {}, [
                schema.node("title", {}, []),
                schema.node("paragraph", {}, [schema.text("a")]),
            ])
            .toJSON(),
    });

    expect(getCount()).toEqual(2);

    await updateDocumentContent(context.action(session1), {
        id: documentId,
        version: 1,
        steps: [new ReplaceStep(4, 4, textSlice("b"))],
        clientId: generateId(),
    });

    expect(getCount()).toEqual(2);

    expect(massageDocument(await getDocument(context.action(session1), documentId))).toEqual({
        version: 2,
        content: schema
            .node("doc", {}, [
                schema.node("title", {}, []),
                schema.node("paragraph", {}, [schema.text("ab")]),
            ])
            .toJSON(),
    });

    expect(getCount()).toEqual(3);

    await updateDocumentContent(context.action(session1), {
        id: documentId,
        version: 2,
        steps: [new ReplaceStep(5, 5, textSlice("c"))],
        clientId: generateId(),
    });

    expect(getCount()).toEqual(3);

    expect(massageDocument(await getDocument(context.action(session1), documentId))).toEqual({
        version: 3,
        content: schema
            .node("doc", {}, [
                schema.node("title", {}, []),
                schema.node("paragraph", {}, [schema.text("abc")]),
            ])
            .toJSON(),
    });

    expect(getCount()).toEqual(4);

    await updateDocumentContent(context.action(session1), {
        id: documentId,
        version: 3,
        steps: [new ReplaceStep(6, 6, textSlice("d"))],
        clientId: generateId(),
    });

    expect(getCount()).toEqual(4);

    expect(massageDocument(await getDocument(context.action(session1), documentId))).toEqual({
        version: 4,
        content: schema
            .node("doc", {}, [
                schema.node("title", {}, []),
                schema.node("paragraph", {}, [schema.text("abcd")]),
            ])
            .toJSON(),
    });

    expect(getCount()).toEqual(5);
});

test("can't update a document that doesn't exist", async () => {
    const documentId = generateId<DocumentId>();

    await expect(async () => {
        await updateDocumentContent(context.action(session1), {
            id: documentId,
            version: 0,
            steps: [new ReplaceStep(3, 3, textSlice("a"))],
            clientId: generateId(),
        });
    }).rejects.toThrow(NotFoundError);
});

test("won't cache a document that doesn't exist when updating", async () => {
    const documentId = generateId<DocumentId>();

    const {getCount} = getInternalDocumentTestCounter.recordForTest(documentId);
    expect(getCount()).toEqual(0);

    await expect(async () => {
        await updateDocumentContent(context.action(session1), {
            id: documentId,
            version: 0,
            steps: [new ReplaceStep(3, 3, textSlice("a"))],
            clientId: generateId(),
        });
    }).rejects.toThrow(NotFoundError);

    expect(getCount()).toEqual(1);

    await expect(async () => {
        await updateDocumentContent(context.action(session1), {
            id: documentId,
            version: 0,
            steps: [new ReplaceStep(3, 3, textSlice("a"))],
            clientId: generateId(),
        });
    }).rejects.toThrow(NotFoundError);

    expect(getCount()).toEqual(2);
});

test("can't read a corrupted document", async () => {
    const {id: documentId} = await createDocument(context.action(session1), {
        spaceId: space.id,
        content: emptyDocumentContent,
    });

    await getDocumentsTableForTest().deleteItemWithKey(context, {
        partitionType: "Document",
        documentId,
        sortRangeType: "Snapshot",
    });

    await expect(async () => {
        await getDocument(context.action(session1), documentId);
    }).rejects.toThrow(DataLossError);
});

test("can't update a corrupted document", async () => {
    const {id: documentId} = await createDocument(context.action(session1), {
        spaceId: space.id,
        content: emptyDocumentContent,
    });

    await getDocumentsTableForTest().deleteItemWithKey(context, {
        partitionType: "Document",
        documentId,
        sortRangeType: "Snapshot",
    });

    await expect(async () => {
        await updateDocumentContent(context.action(session1), {
            id: documentId,
            version: 0,
            steps: [new ReplaceStep(3, 3, textSlice("b"))],
            clientId: generateId(),
        });
    }).rejects.toThrow(DataLossError);
});

test("won't cache a corrupted document while updating", async () => {
    const {id: documentId} = await createDocument(context.action(session1), {
        spaceId: space.id,
        content: emptyDocumentContent,
    });

    await getDocumentsTableForTest().deleteItemWithKey(context, {
        partitionType: "Document",
        documentId,
        sortRangeType: "Snapshot",
    });

    const {getCount} = getInternalDocumentTestCounter.recordForTest(documentId);
    expect(getCount()).toEqual(0);

    await expect(async () => {
        await updateDocumentContent(context.action(session1), {
            id: documentId,
            version: 0,
            steps: [new ReplaceStep(3, 3, textSlice("b"))],
            clientId: generateId(),
        });
    }).rejects.toThrow(DataLossError);

    expect(getCount()).toEqual(1);

    await expect(async () => {
        await updateDocumentContent(context.action(session1), {
            id: documentId,
            version: 0,
            steps: [new ReplaceStep(3, 3, textSlice("b"))],
            clientId: generateId(),
        });
    }).rejects.toThrow(DataLossError);

    expect(getCount()).toEqual(2);
});

test("updates made in parallel will only read the document once", async () => {
    const {id: documentId} = await createDocument(context.action(session1), {
        spaceId: space.id,
        content: emptyDocumentContent,
    });

    const {getCount} = getInternalDocumentTestCounter.recordForTest(documentId);
    expect(getCount()).toEqual(0);

    const request1Promise = updateDocumentContent(context.action(session1), {
        id: documentId,
        version: 0,
        steps: [new ReplaceStep(3, 3, textSlice("a"))],
        clientId: generateId(),
    });

    const request2Promise = updateDocumentContent(context.action(session1), {
        id: documentId,
        version: 0,
        steps: [new ReplaceStep(3, 3, textSlice("b")), new ReplaceStep(4, 4, textSlice("c"))],
        clientId: generateId(),
    });

    const request3Promise = updateDocumentContent(context.action(session1), {
        id: documentId,
        version: 0,
        steps: [new ReplaceStep(3, 3, textSlice("d"))],
        clientId: generateId(),
    });

    const request4Promise = updateDocumentContent(context.action(session1), {
        id: documentId,
        version: 0,
        steps: [new ReplaceStep(3, 3, textSlice("e"))],
        clientId: generateId(),
    });

    const request5Promise = updateDocumentContent(context.action(session1), {
        id: documentId,
        version: 0,
        steps: [new ReplaceStep(3, 3, textSlice("f"))],
        clientId: generateId(),
    });

    await runAllPromises([
        request1Promise,
        request2Promise,
        request3Promise,
        request4Promise,
        request5Promise,
    ]);

    expect(getCount()).toEqual(1);

    {
        const document = await getDocument(context.action(session1), documentId);
        expect(document.version).toEqual(6);
        expect(document.content.doc.child(1).textContent.split("").sort().join("")).toEqual(
            "abcdef",
        );
    }
});

test("if a document was deleted in the database then the cache will pick that up", async () => {
    const {id: documentId} = await createDocument(context.action(session1), {
        spaceId: space.id,
        content: emptyDocumentContent,
    });

    const {getCount} = getInternalDocumentTestCounter.recordForTest(documentId);
    expect(getCount()).toEqual(0);

    await updateDocumentContent(context.action(session1), {
        id: documentId,
        version: 0,
        steps: [new ReplaceStep(3, 3, textSlice("a"))],
        clientId: generateId(),
    });

    expect(getCount()).toEqual(1);

    await getDocumentsTableForTest().deleteItemWithKey(context, {
        partitionType: "Document",
        documentId,
        sortRangeType: "Attributes",
    });

    expect(getCount()).toEqual(1);

    await expect(async () => {
        await updateDocumentContent(context.action(session1), {
            id: documentId,
            version: 1,
            steps: [new ReplaceStep(4, 4, textSlice("b"))],
            clientId: generateId(),
        });
    }).rejects.toThrowError(NotFoundError);

    expect(getCount()).toEqual(1);
});

test("updates may happen with different caches", async () => {
    const {id: documentId} = await createDocument(context.action(session1), {
        spaceId: space.id,
        content: emptyDocumentContent,
    });

    const {getCount} = getInternalDocumentTestCounter.recordForTest(documentId);
    expect(getCount()).toEqual(0);

    await updateDocumentContent(context.action(session1), {
        id: documentId,
        version: 0,
        steps: [new ReplaceStep(3, 3, textSlice("a"))],
        clientId: generateId(),
    });

    expect(getCount()).toEqual(1);

    expect(massageDocument(await getDocument(context.action(session1), documentId))).toEqual({
        version: 1,
        content: schema
            .node("doc", {}, [
                schema.node("title", {}, []),
                schema.node("paragraph", {}, [schema.text("a")]),
            ])
            .toJSON(),
    });

    expect(getCount()).toEqual(2);

    await updateDocumentContent(context.action(session1), {
        id: documentId,
        version: 1,
        steps: [new ReplaceStep(4, 4, textSlice("b"))],
        clientId: generateId(),
    });

    expect(getCount()).toEqual(2);

    expect(massageDocument(await getDocument(context.action(session1), documentId))).toEqual({
        version: 2,
        content: schema
            .node("doc", {}, [
                schema.node("title", {}, []),
                schema.node("paragraph", {}, [schema.text("ab")]),
            ])
            .toJSON(),
    });

    expect(getCount()).toEqual(3);

    await updateDocumentContent(context.action(session1), {
        id: documentId,
        version: 2,
        steps: [new ReplaceStep(5, 5, textSlice("c"))],
        clientId: generateId(),
        cacheOverrideForTest: otherCache,
    });

    expect(getCount()).toEqual(4);

    expect(massageDocument(await getDocument(context.action(session1), documentId))).toEqual({
        version: 3,
        content: schema
            .node("doc", {}, [
                schema.node("title", {}, []),
                schema.node("paragraph", {}, [schema.text("abc")]),
            ])
            .toJSON(),
    });

    expect(getCount()).toEqual(5);

    await updateDocumentContent(context.action(session1), {
        id: documentId,
        version: 3,
        steps: [new ReplaceStep(6, 6, textSlice("d"))],
        clientId: generateId(),
        cacheOverrideForTest: otherCache,
    });

    expect(getCount()).toEqual(5);

    expect(massageDocument(await getDocument(context.action(session1), documentId))).toEqual({
        version: 4,
        content: schema
            .node("doc", {}, [
                schema.node("title", {}, []),
                schema.node("paragraph", {}, [schema.text("abcd")]),
            ])
            .toJSON(),
    });

    expect(getCount()).toEqual(6);

    await updateDocumentContent(context.action(session1), {
        id: documentId,
        version: 4,
        steps: [new ReplaceStep(7, 7, textSlice("e"))],
        clientId: generateId(),
    });

    expect(getCount()).toEqual(6);

    expect(massageDocument(await getDocument(context.action(session1), documentId))).toEqual({
        version: 5,
        content: schema
            .node("doc", {}, [
                schema.node("title", {}, []),
                schema.node("paragraph", {}, [schema.text("abcde")]),
            ])
            .toJSON(),
    });

    expect(getCount()).toEqual(7);

    await updateDocumentContent(context.action(session1), {
        id: documentId,
        version: 5,
        steps: [new ReplaceStep(8, 8, textSlice("f"))],
        clientId: generateId(),
        cacheOverrideForTest: otherCache,
    });

    expect(getCount()).toEqual(7);

    expect(massageDocument(await getDocument(context.action(session1), documentId))).toEqual({
        version: 6,
        content: schema
            .node("doc", {}, [
                schema.node("title", {}, []),
                schema.node("paragraph", {}, [schema.text("abcdef")]),
            ])
            .toJSON(),
    });

    expect(getCount()).toEqual(8);
});

test("reads the document again after an expiration timer fires", async () => {
    const {id: documentId} = await createDocument(context.action(session1), {
        spaceId: space.id,
        content: emptyDocumentContent,
    });

    const {getCount} = getInternalDocumentTestCounter.recordForTest(documentId);
    expect(getCount()).toEqual(0);

    await updateDocumentContent(context.action(session1), {
        id: documentId,
        version: 0,
        steps: [new ReplaceStep(3, 3, textSlice("a"))],
        clientId: generateId(),
    });

    expect(getCount()).toEqual(1);

    expect(massageDocument(await getDocument(context.action(session1), documentId))).toEqual({
        version: 1,
        content: schema
            .node("doc", {}, [
                schema.node("title", {}, []),
                schema.node("paragraph", {}, [schema.text("a")]),
            ])
            .toJSON(),
    });

    expect(getCount()).toEqual(2);

    await updateDocumentContent(context.action(session1), {
        id: documentId,
        version: 1,
        steps: [new ReplaceStep(4, 4, textSlice("b"))],
        clientId: generateId(),
    });

    expect(getCount()).toEqual(2);

    expect(massageDocument(await getDocument(context.action(session1), documentId))).toEqual({
        version: 2,
        content: schema
            .node("doc", {}, [
                schema.node("title", {}, []),
                schema.node("paragraph", {}, [schema.text("ab")]),
            ])
            .toJSON(),
    });

    expect(getCount()).toEqual(3);

    jest.runAllTimers();

    await updateDocumentContent(context.action(session1), {
        id: documentId,
        version: 2,
        steps: [new ReplaceStep(5, 5, textSlice("c"))],
        clientId: generateId(),
    });

    expect(getCount()).toEqual(4);

    expect(massageDocument(await getDocument(context.action(session1), documentId))).toEqual({
        version: 3,
        content: schema
            .node("doc", {}, [
                schema.node("title", {}, []),
                schema.node("paragraph", {}, [schema.text("abc")]),
            ])
            .toJSON(),
    });

    expect(getCount()).toEqual(5);

    await updateDocumentContent(context.action(session1), {
        id: documentId,
        version: 3,
        steps: [new ReplaceStep(6, 6, textSlice("d"))],
        clientId: generateId(),
    });

    expect(getCount()).toEqual(5);

    expect(massageDocument(await getDocument(context.action(session1), documentId))).toEqual({
        version: 4,
        content: schema
            .node("doc", {}, [
                schema.node("title", {}, []),
                schema.node("paragraph", {}, [schema.text("abcd")]),
            ])
            .toJSON(),
    });

    expect(getCount()).toEqual(6);
});

test("resets the timer eviction timer on every update", async () => {
    const {id: documentId} = await createDocument(context.action(session1), {
        spaceId: space.id,
        content: emptyDocumentContent,
    });

    const {getCount} = getInternalDocumentTestCounter.recordForTest(documentId);
    expect(getCount()).toEqual(0);

    await updateDocumentContent(context.action(session1), {
        id: documentId,
        version: 0,
        steps: [new ReplaceStep(3, 3, textSlice("a"))],
        clientId: generateId(),
    });

    expect(getCount()).toEqual(1);

    expect(massageDocument(await getDocument(context.action(session1), documentId))).toEqual({
        version: 1,
        content: schema
            .node("doc", {}, [
                schema.node("title", {}, []),
                schema.node("paragraph", {}, [schema.text("a")]),
            ])
            .toJSON(),
    });

    expect(getCount()).toEqual(2);

    jest.advanceTimersByTime(documentContentCacheEvictionTimeoutMs);

    await updateDocumentContent(context.action(session1), {
        id: documentId,
        version: 1,
        steps: [new ReplaceStep(4, 4, textSlice("b"))],
        clientId: generateId(),
    });

    expect(getCount()).toEqual(3);

    expect(massageDocument(await getDocument(context.action(session1), documentId))).toEqual({
        version: 2,
        content: schema
            .node("doc", {}, [
                schema.node("title", {}, []),
                schema.node("paragraph", {}, [schema.text("ab")]),
            ])
            .toJSON(),
    });

    expect(getCount()).toEqual(4);

    jest.advanceTimersByTime(documentContentCacheEvictionTimeoutMs / 2);

    expect(getCount()).toEqual(4);

    await updateDocumentContent(context.action(session1), {
        id: documentId,
        version: 2,
        steps: [new ReplaceStep(5, 5, textSlice("c"))],
        clientId: generateId(),
    });

    expect(getCount()).toEqual(4);

    expect(massageDocument(await getDocument(context.action(session1), documentId))).toEqual({
        version: 3,
        content: schema
            .node("doc", {}, [
                schema.node("title", {}, []),
                schema.node("paragraph", {}, [schema.text("abc")]),
            ])
            .toJSON(),
    });

    expect(getCount()).toEqual(5);

    jest.advanceTimersByTime(documentContentCacheEvictionTimeoutMs / 2);

    expect(getCount()).toEqual(5);

    await updateDocumentContent(context.action(session1), {
        id: documentId,
        version: 3,
        steps: [new ReplaceStep(6, 6, textSlice("d"))],
        clientId: generateId(),
    });

    expect(getCount()).toEqual(5);

    expect(massageDocument(await getDocument(context.action(session1), documentId))).toEqual({
        version: 4,
        content: schema
            .node("doc", {}, [
                schema.node("title", {}, []),
                schema.node("paragraph", {}, [schema.text("abcd")]),
            ])
            .toJSON(),
    });

    expect(getCount()).toEqual(6);

    jest.advanceTimersByTime(documentContentCacheEvictionTimeoutMs / 2);

    expect(getCount()).toEqual(6);

    await updateDocumentContent(context.action(session1), {
        id: documentId,
        version: 4,
        steps: [new ReplaceStep(7, 7, textSlice("e"))],
        clientId: generateId(),
    });

    expect(getCount()).toEqual(6);

    expect(massageDocument(await getDocument(context.action(session1), documentId))).toEqual({
        version: 5,
        content: schema
            .node("doc", {}, [
                schema.node("title", {}, []),
                schema.node("paragraph", {}, [schema.text("abcde")]),
            ])
            .toJSON(),
    });

    expect(getCount()).toEqual(7);

    jest.advanceTimersByTime(documentContentCacheEvictionTimeoutMs);

    expect(getCount()).toEqual(7);

    await updateDocumentContent(context.action(session1), {
        id: documentId,
        version: 5,
        steps: [new ReplaceStep(8, 8, textSlice("f"))],
        clientId: generateId(),
    });

    expect(getCount()).toEqual(8);

    expect(massageDocument(await getDocument(context.action(session1), documentId))).toEqual({
        version: 6,
        content: schema
            .node("doc", {}, [
                schema.node("title", {}, []),
                schema.node("paragraph", {}, [schema.text("abcdef")]),
            ])
            .toJSON(),
    });

    expect(getCount()).toEqual(9);
});

test("updates the document title whenever it changes", async () => {
    const {id: documentId} = await createDocument(context.action(session1), {
        spaceId: space.id,
        content: emptyDocumentContent,
    });

    expect(massageDocument(await getDocument(context.action(session1), documentId))).toEqual({
        version: 0,
        content: schema
            .node("doc", {}, [schema.node("title", {}, []), schema.node("paragraph", {}, [])])
            .toJSON(),
    });
    expect(await getDocumentPreviewIfExists(context.action(session1), documentId)).toEqual({
        id: documentId,
        spaceId: space.id,
        createdTime: expect.any(Date),
        version: 0,
        titleWithoutFallback: "",
    });

    await updateDocumentContent(context.action(session1), {
        id: documentId,
        version: 0,
        steps: [new ReplaceStep(3, 3, textSlice("b"))],
        clientId: generateId(),
    });

    expect(massageDocument(await getDocument(context.action(session1), documentId))).toEqual({
        version: 1,
        content: schema
            .node("doc", {}, [
                schema.node("title", {}, []),
                schema.node("paragraph", {}, [schema.text("b")]),
            ])
            .toJSON(),
    });
    expect(await getDocumentPreviewIfExists(context.action(session1), documentId)).toEqual({
        id: documentId,
        spaceId: space.id,
        createdTime: expect.any(Date),
        version: 1,
        titleWithoutFallback: "",
    });

    await updateDocumentContent(context.action(session1), {
        id: documentId,
        version: 1,
        steps: [new ReplaceStep(1, 1, textSlice("f"))],
        clientId: generateId(),
    });

    expect(massageDocument(await getDocument(context.action(session1), documentId))).toEqual({
        version: 2,
        content: schema
            .node("doc", {}, [
                schema.node("title", {}, [schema.text("f")]),
                schema.node("paragraph", {}, [schema.text("b")]),
            ])
            .toJSON(),
    });
    expect(await getDocumentPreviewIfExists(context.action(session1), documentId)).toEqual({
        id: documentId,
        spaceId: space.id,
        createdTime: expect.any(Date),
        version: 2,
        titleWithoutFallback: "f",
    });

    await updateDocumentContent(context.action(session1), {
        id: documentId,
        version: 2,
        steps: [new ReplaceStep(5, 5, textSlice("a"))],
        clientId: generateId(),
    });

    expect(massageDocument(await getDocument(context.action(session1), documentId))).toEqual({
        version: 3,
        content: schema
            .node("doc", {}, [
                schema.node("title", {}, [schema.text("f")]),
                schema.node("paragraph", {}, [schema.text("ba")]),
            ])
            .toJSON(),
    });
    expect(await getDocumentPreviewIfExists(context.action(session1), documentId)).toEqual({
        id: documentId,
        spaceId: space.id,
        createdTime: expect.any(Date),
        version: 3,
        titleWithoutFallback: "f",
    });

    await updateDocumentContent(context.action(session1), {
        id: documentId,
        version: 3,
        steps: [new ReplaceStep(2, 2, textSlice("o")), new ReplaceStep(3, 3, textSlice("o"))],
        clientId: generateId(),
    });

    expect(massageDocument(await getDocument(context.action(session1), documentId))).toEqual({
        version: 5,
        content: schema
            .node("doc", {}, [
                schema.node("title", {}, [schema.text("foo")]),
                schema.node("paragraph", {}, [schema.text("ba")]),
            ])
            .toJSON(),
    });
    expect(await getDocumentPreviewIfExists(context.action(session1), documentId)).toEqual({
        id: documentId,
        spaceId: space.id,
        createdTime: expect.any(Date),
        version: 5,
        titleWithoutFallback: "foo",
    });

    await updateDocumentContent(context.action(session1), {
        id: documentId,
        version: 5,
        steps: [new ReplaceStep(8, 8, textSlice("r"))],
        clientId: generateId(),
    });

    expect(massageDocument(await getDocument(context.action(session1), documentId))).toEqual({
        version: 6,
        content: schema
            .node("doc", {}, [
                schema.node("title", {}, [schema.text("foo")]),
                schema.node("paragraph", {}, [schema.text("bar")]),
            ])
            .toJSON(),
    });
    expect(await getDocumentPreviewIfExists(context.action(session1), documentId)).toEqual({
        id: documentId,
        spaceId: space.id,
        createdTime: expect.any(Date),
        version: 6,
        titleWithoutFallback: "foo",
    });

    await updateDocumentContent(context.action(session1), {
        id: documentId,
        version: 6,
        steps: [
            new ReplaceStep(
                9,
                9,
                new Slice(
                    Fragment.from([schema.node("paragraph"), schema.node("paragraph")]),
                    1,
                    1,
                ),
                true,
            ),
        ],
        clientId: generateId(),
    });

    expect(massageDocument(await getDocument(context.action(session1), documentId))).toEqual({
        version: 7,
        content: schema
            .node("doc", {}, [
                schema.node("title", {}, [schema.text("foo")]),
                schema.node("paragraph", {}, [schema.text("bar")]),
                schema.node("paragraph", {}, []),
            ])
            .toJSON(),
    });
    expect(await getDocumentPreviewIfExists(context.action(session1), documentId)).toEqual({
        id: documentId,
        spaceId: space.id,
        createdTime: expect.any(Date),
        version: 7,
        titleWithoutFallback: "foo",
    });

    await updateDocumentContent(context.action(session1), {
        id: documentId,
        version: 7,
        steps: [new ReplaceStep(4, 6, Slice.empty, true)],
        clientId: generateId(),
    });

    expect(massageDocument(await getDocument(context.action(session1), documentId))).toEqual({
        version: 8,
        content: schema
            .node("doc", {}, [
                schema.node("title", {}, [schema.text("foobar")]),
                schema.node("paragraph", {}, []),
            ])
            .toJSON(),
    });
    expect(await getDocumentPreviewIfExists(context.action(session1), documentId)).toEqual({
        id: documentId,
        spaceId: space.id,
        createdTime: expect.any(Date),
        version: 8,
        titleWithoutFallback: "foobar",
    });
});

test("resolves a conflict when typing in deleted content", async () => {
    const {id: documentId} = await createDocument(context.action(session1), {
        spaceId: space.id,
        content: emptyDocumentContent,
    });

    await updateDocumentContent(context.action(session1), {
        id: documentId,
        version: 0,
        steps: [new ReplaceStep(3, 3, textSlice("foo")), new ReplaceStep(6, 6, textSlice("bar"))],
        clientId: generateId(),
    });

    expect(massageDocument(await getDocument(context.action(session1), documentId))).toEqual({
        version: 2,
        content: schema
            .node("doc", {}, [
                schema.node("title", {}, []),
                schema.node("paragraph", {}, [schema.text("foobar")]),
            ])
            .toJSON(),
    });

    await updateDocumentContent(context.action(session1), {
        id: documentId,
        version: 2,
        steps: [new ReplaceStep(3, 9, textSlice(""))],
        clientId: generateId(),
    });

    expect(massageDocument(await getDocument(context.action(session1), documentId))).toEqual({
        version: 3,
        content: schema
            .node("doc", {}, [schema.node("title", {}, []), schema.node("paragraph", {}, [])])
            .toJSON(),
    });

    await updateDocumentContent(context.action(session1), {
        id: documentId,
        version: 2,
        steps: [new ReplaceStep(6, 6, textSlice("x"))],
        clientId: generateId(),
    });

    expect(massageDocument(await getDocument(context.action(session1), documentId))).toEqual({
        version: 3,
        content: schema
            .node("doc", {}, [schema.node("title", {}, []), schema.node("paragraph", {}, [])])
            .toJSON(),
    });
});

test("resolves a conflict when typing in deleted content and the delete action itself was a conflict", async () => {
    const {id: documentId} = await createDocument(context.action(session1), {
        spaceId: space.id,
        content: emptyDocumentContent,
    });

    await updateDocumentContent(context.action(session1), {
        id: documentId,
        version: 0,
        steps: [new ReplaceStep(3, 3, textSlice("foo")), new ReplaceStep(6, 6, textSlice("bar"))],
        clientId: generateId(),
    });

    expect(massageDocument(await getDocument(context.action(session1), documentId))).toEqual({
        version: 2,
        content: schema
            .node("doc", {}, [
                schema.node("title", {}, []),
                schema.node("paragraph", {}, [schema.text("foobar")]),
            ])
            .toJSON(),
    });

    await updateDocumentContent(context.action(session1), {
        id: documentId,
        version: 2,
        steps: [new ReplaceStep(1, 1, textSlice("x"))],
        clientId: generateId(),
    });

    expect(massageDocument(await getDocument(context.action(session1), documentId))).toEqual({
        version: 3,
        content: schema
            .node("doc", {}, [
                schema.node("title", {}, [schema.text("x")]),
                schema.node("paragraph", {}, [schema.text("foobar")]),
            ])
            .toJSON(),
    });

    await updateDocumentContent(context.action(session1), {
        id: documentId,
        version: 2,
        steps: [new ReplaceStep(3, 9, textSlice(""))],
        clientId: generateId(),
    });

    expect(massageDocument(await getDocument(context.action(session1), documentId))).toEqual({
        version: 4,
        content: schema
            .node("doc", {}, [
                schema.node("title", {}, [schema.text("x")]),
                schema.node("paragraph", {}, []),
            ])
            .toJSON(),
    });

    await updateDocumentContent(context.action(session1), {
        id: documentId,
        version: 2,
        steps: [new ReplaceStep(6, 6, textSlice("x"))],
        clientId: generateId(),
    });

    expect(massageDocument(await getDocument(context.action(session1), documentId))).toEqual({
        version: 4,
        content: schema
            .node("doc", {}, [
                schema.node("title", {}, [schema.text("x")]),
                schema.node("paragraph", {}, []),
            ])
            .toJSON(),
    });
});

test("can read steps in a single transaction with many steps", async () => {
    const {id: documentId} = await createDocument(context.action(session1), {
        spaceId: space.id,
        content: emptyDocumentContent,
    });

    await updateDocumentContent(context.action(session1), {
        id: documentId,
        version: 0,
        steps: [
            new ReplaceStep(3, 3, textSlice("a")),
            new ReplaceStep(4, 4, textSlice("b")),
            new ReplaceStep(5, 5, textSlice("c")),
            new ReplaceStep(6, 6, textSlice("d")),
            new ReplaceStep(7, 7, textSlice("e")),
            new ReplaceStep(8, 8, textSlice("f")),
        ],
        clientId: generateId(),
    });

    const massageSteps = (steps: Array<{step: Step}>) => steps.map(({step}) => step.toJSON());

    expect(
        massageSteps(
            await getDocumentContentSteps(context.action(session1), {
                id: documentId,
                startVersion: 0,
                endVersion: 6,
            }),
        ),
    ).toEqual(
        [
            new ReplaceStep(3, 3, textSlice("a")),
            new ReplaceStep(4, 4, textSlice("b")),
            new ReplaceStep(5, 5, textSlice("c")),
            new ReplaceStep(6, 6, textSlice("d")),
            new ReplaceStep(7, 7, textSlice("e")),
            new ReplaceStep(8, 8, textSlice("f")),
        ].map(step => step.toJSON()),
    );

    expect(
        massageSteps(
            await getDocumentContentSteps(context.action(session1), {
                id: documentId,
                startVersion: 1,
                endVersion: 5,
            }),
        ),
    ).toEqual(
        [
            new ReplaceStep(4, 4, textSlice("b")),
            new ReplaceStep(5, 5, textSlice("c")),
            new ReplaceStep(6, 6, textSlice("d")),
            new ReplaceStep(7, 7, textSlice("e")),
        ].map(step => step.toJSON()),
    );

    expect(
        massageSteps(
            await getDocumentContentSteps(context.action(session1), {
                id: documentId,
                startVersion: 2,
                endVersion: 4,
            }),
        ),
    ).toEqual(
        [new ReplaceStep(5, 5, textSlice("c")), new ReplaceStep(6, 6, textSlice("d"))].map(step =>
            step.toJSON(),
        ),
    );

    expect(
        massageSteps(
            await getDocumentContentSteps(context.action(session1), {
                id: documentId,
                startVersion: 3,
                endVersion: 5,
            }),
        ),
    ).toEqual(
        [new ReplaceStep(6, 6, textSlice("d")), new ReplaceStep(7, 7, textSlice("e"))].map(step =>
            step.toJSON(),
        ),
    );

    expect(
        massageSteps(
            await getDocumentContentSteps(context.action(session1), {
                id: documentId,
                startVersion: 2,
                endVersion: 3,
            }),
        ),
    ).toEqual([new ReplaceStep(5, 5, textSlice("c"))].map(step => step.toJSON()));
});

test("can read steps in individual transactions of single steps", async () => {
    const {id: documentId} = await createDocument(context.action(session1), {
        spaceId: space.id,
        content: emptyDocumentContent,
    });

    await updateDocumentContent(context.action(session1), {
        id: documentId,
        version: 0,
        steps: [new ReplaceStep(3, 3, textSlice("a"))],
        clientId: generateId(),
    });
    await updateDocumentContent(context.action(session1), {
        id: documentId,
        version: 1,
        steps: [new ReplaceStep(4, 4, textSlice("b"))],
        clientId: generateId(),
    });
    await updateDocumentContent(context.action(session1), {
        id: documentId,
        version: 2,
        steps: [new ReplaceStep(5, 5, textSlice("c"))],
        clientId: generateId(),
    });
    await updateDocumentContent(context.action(session1), {
        id: documentId,
        version: 3,
        steps: [new ReplaceStep(6, 6, textSlice("d"))],
        clientId: generateId(),
    });
    await updateDocumentContent(context.action(session1), {
        id: documentId,
        version: 4,
        steps: [new ReplaceStep(7, 7, textSlice("e"))],
        clientId: generateId(),
    });
    await updateDocumentContent(context.action(session1), {
        id: documentId,
        version: 5,
        steps: [new ReplaceStep(8, 8, textSlice("f"))],
        clientId: generateId(),
    });

    const massageSteps = (steps: Array<{step: Step}>) => steps.map(({step}) => step.toJSON());

    expect(
        massageSteps(
            await getDocumentContentSteps(context.action(session1), {
                id: documentId,
                startVersion: 0,
                endVersion: 6,
            }),
        ),
    ).toEqual(
        [
            new ReplaceStep(3, 3, textSlice("a")),
            new ReplaceStep(4, 4, textSlice("b")),
            new ReplaceStep(5, 5, textSlice("c")),
            new ReplaceStep(6, 6, textSlice("d")),
            new ReplaceStep(7, 7, textSlice("e")),
            new ReplaceStep(8, 8, textSlice("f")),
        ].map(step => step.toJSON()),
    );

    expect(
        massageSteps(
            await getDocumentContentSteps(context.action(session1), {
                id: documentId,
                startVersion: 1,
                endVersion: 5,
            }),
        ),
    ).toEqual(
        [
            new ReplaceStep(4, 4, textSlice("b")),
            new ReplaceStep(5, 5, textSlice("c")),
            new ReplaceStep(6, 6, textSlice("d")),
            new ReplaceStep(7, 7, textSlice("e")),
        ].map(step => step.toJSON()),
    );

    expect(
        massageSteps(
            await getDocumentContentSteps(context.action(session1), {
                id: documentId,
                startVersion: 2,
                endVersion: 4,
            }),
        ),
    ).toEqual(
        [new ReplaceStep(5, 5, textSlice("c")), new ReplaceStep(6, 6, textSlice("d"))].map(step =>
            step.toJSON(),
        ),
    );

    expect(
        massageSteps(
            await getDocumentContentSteps(context.action(session1), {
                id: documentId,
                startVersion: 3,
                endVersion: 5,
            }),
        ),
    ).toEqual(
        [new ReplaceStep(6, 6, textSlice("d")), new ReplaceStep(7, 7, textSlice("e"))].map(step =>
            step.toJSON(),
        ),
    );

    expect(
        massageSteps(
            await getDocumentContentSteps(context.action(session1), {
                id: documentId,
                startVersion: 2,
                endVersion: 3,
            }),
        ),
    ).toEqual([new ReplaceStep(5, 5, textSlice("c"))].map(step => step.toJSON()));
});

test("can read steps in a couple multi-step transactions", async () => {
    const {id: documentId} = await createDocument(context.action(session1), {
        spaceId: space.id,
        content: emptyDocumentContent,
    });

    await updateDocumentContent(context.action(session1), {
        id: documentId,
        version: 0,
        steps: [new ReplaceStep(3, 3, textSlice("a")), new ReplaceStep(4, 4, textSlice("b"))],
        clientId: generateId(),
    });
    await updateDocumentContent(context.action(session1), {
        id: documentId,
        version: 2,
        steps: [new ReplaceStep(5, 5, textSlice("c")), new ReplaceStep(6, 6, textSlice("d"))],
        clientId: generateId(),
    });
    await updateDocumentContent(context.action(session1), {
        id: documentId,
        version: 4,
        steps: [new ReplaceStep(7, 7, textSlice("e")), new ReplaceStep(8, 8, textSlice("f"))],
        clientId: generateId(),
    });

    const massageSteps = (steps: Array<{step: Step}>) => steps.map(({step}) => step.toJSON());

    expect(
        massageSteps(
            await getDocumentContentSteps(context.action(session1), {
                id: documentId,
                startVersion: 0,
                endVersion: 6,
            }),
        ),
    ).toEqual(
        [
            new ReplaceStep(3, 3, textSlice("a")),
            new ReplaceStep(4, 4, textSlice("b")),
            new ReplaceStep(5, 5, textSlice("c")),
            new ReplaceStep(6, 6, textSlice("d")),
            new ReplaceStep(7, 7, textSlice("e")),
            new ReplaceStep(8, 8, textSlice("f")),
        ].map(step => step.toJSON()),
    );

    expect(
        massageSteps(
            await getDocumentContentSteps(context.action(session1), {
                id: documentId,
                startVersion: 1,
                endVersion: 5,
            }),
        ),
    ).toEqual(
        [
            new ReplaceStep(4, 4, textSlice("b")),
            new ReplaceStep(5, 5, textSlice("c")),
            new ReplaceStep(6, 6, textSlice("d")),
            new ReplaceStep(7, 7, textSlice("e")),
        ].map(step => step.toJSON()),
    );

    expect(
        massageSteps(
            await getDocumentContentSteps(context.action(session1), {
                id: documentId,
                startVersion: 2,
                endVersion: 4,
            }),
        ),
    ).toEqual(
        [new ReplaceStep(5, 5, textSlice("c")), new ReplaceStep(6, 6, textSlice("d"))].map(step =>
            step.toJSON(),
        ),
    );

    expect(
        massageSteps(
            await getDocumentContentSteps(context.action(session1), {
                id: documentId,
                startVersion: 3,
                endVersion: 5,
            }),
        ),
    ).toEqual(
        [new ReplaceStep(6, 6, textSlice("d")), new ReplaceStep(7, 7, textSlice("e"))].map(step =>
            step.toJSON(),
        ),
    );

    expect(
        massageSteps(
            await getDocumentContentSteps(context.action(session1), {
                id: documentId,
                startVersion: 2,
                endVersion: 3,
            }),
        ),
    ).toEqual([new ReplaceStep(5, 5, textSlice("c"))].map(step => step.toJSON()));
});

test("can not create a document in a different space", async () => {
    const content = schema.node("doc", {}, [
        schema.node("title", {}, [schema.text("Foo bar")]),
        schema.node("paragraph", {}, [schema.text("Hello, world!")]),
    ]);
    assert(isDocumentContent(content));

    await expect(
        createDocument(context.action(otherSession), {
            spaceId: space.id,
            content,
        }),
    ).rejects.toThrow(PermissionDeniedError);
});

test("can not read a created document in a different space", async () => {
    const content = schema.node("doc", {}, [
        schema.node("title", {}, [schema.text("Foo bar")]),
        schema.node("paragraph", {}, [schema.text("Hello, world!")]),
    ]);
    assert(isDocumentContent(content));

    const {id: documentId} = await createDocument(context.action(otherSession), {
        spaceId: otherSpace.id,
        content,
    });

    await expect(getDocument(context.action(session1), documentId)).rejects.toThrow(
        PermissionDeniedError,
    );
    await expect(getDocumentPreviewIfExists(context.action(session1), documentId)).rejects.toThrow(
        PermissionDeniedError,
    );
});

test("can not update a document in a different space", async () => {
    const {id: documentId} = await createDocument(context.action(otherSession), {
        spaceId: otherSpace.id,
        content: emptyDocumentContent,
    });

    await expect(
        updateDocumentContent(context.action(session1), {
            id: documentId,
            version: 0,
            steps: [new ReplaceStep(3, 3, textSlice("a"))],
            clientId: generateId(),
        }),
    ).rejects.toThrow(PermissionDeniedError);

    expect(massageDocument(await getDocument(context.action(otherSession), documentId))).toEqual({
        version: 0,
        content: schema
            .node("doc", {}, [schema.node("title", {}, []), schema.node("paragraph", {}, [])])
            .toJSON(),
    });
});

test("can not update a cached document in a different space", async () => {
    const {id: documentId} = await createDocument(context.action(otherSession), {
        spaceId: otherSpace.id,
        content: emptyDocumentContent,
    });

    await updateDocumentContent(context.action(otherSession), {
        id: documentId,
        version: 0,
        steps: [new ReplaceStep(3, 3, textSlice("a"))],
        clientId: generateId(),
    });

    expect(massageDocument(await getDocument(context.action(otherSession), documentId))).toEqual({
        version: 1,
        content: schema
            .node("doc", {}, [
                schema.node("title", {}, []),
                schema.node("paragraph", {}, [schema.text("a")]),
            ])
            .toJSON(),
    });

    await expect(
        updateDocumentContent(context.action(session1), {
            id: documentId,
            version: 1,
            steps: [new ReplaceStep(4, 4, textSlice("b"))],
            clientId: generateId(),
        }),
    ).rejects.toThrow(PermissionDeniedError);

    expect(massageDocument(await getDocument(context.action(otherSession), documentId))).toEqual({
        version: 1,
        content: schema
            .node("doc", {}, [
                schema.node("title", {}, []),
                schema.node("paragraph", {}, [schema.text("a")]),
            ])
            .toJSON(),
    });
});

test("can update a cached document after rejecting an update in a different space", async () => {
    const {id: documentId} = await createDocument(context.action(otherSession), {
        spaceId: otherSpace.id,
        content: emptyDocumentContent,
    });

    await expect(
        updateDocumentContent(context.action(session1), {
            id: documentId,
            version: 0,
            steps: [new ReplaceStep(3, 3, textSlice("a"))],
            clientId: generateId(),
        }),
    ).rejects.toThrow(PermissionDeniedError);

    expect(massageDocument(await getDocument(context.action(otherSession), documentId))).toEqual({
        version: 0,
        content: schema
            .node("doc", {}, [schema.node("title", {}, []), schema.node("paragraph", {}, [])])
            .toJSON(),
    });

    await updateDocumentContent(context.action(otherSession), {
        id: documentId,
        version: 0,
        steps: [new ReplaceStep(3, 3, textSlice("a"))],
        clientId: generateId(),
    });

    expect(massageDocument(await getDocument(context.action(otherSession), documentId))).toEqual({
        version: 1,
        content: schema
            .node("doc", {}, [
                schema.node("title", {}, []),
                schema.node("paragraph", {}, [schema.text("a")]),
            ])
            .toJSON(),
    });
});

test("can not update a document with an invalid step", async () => {
    {
        const {id} = await createDocument(context.action(session1), {
            spaceId: space.id,
            content: emptyDocumentContent,
        });

        await updateDocumentContent(context.action(session1), {
            id,
            version: 0,
            steps: [
                new ReplaceStep(
                    2,
                    4,
                    new Slice(
                        Fragment.from(
                            schema.node("unorderedListItem", {}, [
                                schema.node("paragraph", {}, [schema.text("test")]),
                            ]),
                        ),
                        0,
                        0,
                    ),
                ),
            ],
            clientId: generateId(),
        });

        expect(massageDocument(await getDocument(context.action(session1), id))).toEqual({
            version: 1,
            content: schema
                .node("doc", {}, [
                    schema.node("title", {}, []),
                    schema.node("unorderedListItem", {}, [
                        schema.node("paragraph", {}, [schema.text("test")]),
                    ]),
                ])
                .toJSON(),
        });
    }

    {
        const {id} = await createDocument(context.action(session1), {
            spaceId: space.id,
            content: emptyDocumentContent,
        });

        await expect(
            updateDocumentContent(context.action(session1), {
                id,
                version: 0,
                steps: [
                    new ReplaceStep(
                        2,
                        4,
                        new Slice(
                            Fragment.from(
                                schema.nodes.unorderedListItem.create({}, [schema.text("test")]),
                            ),
                            0,
                            0,
                        ),
                    ),
                ],
                clientId: generateId(),
            }),
        ).rejects.toThrow(
            new FailedPreconditionError(
                'Updated content for "unorderedListItem" node is not valid',
            ),
        );
    }
});

test("can not update a document such that it would have invalid content", async () => {
    {
        const {id} = await createDocument(context.action(session1), {
            spaceId: space.id,
            content: emptyDocumentContent,
        });

        await updateDocumentContent(context.action(session1), {
            id,
            version: 0,
            steps: [
                new ReplaceStep(
                    2,
                    4,
                    new Slice(
                        Fragment.from(
                            schema.node("unorderedListItem", {}, [
                                schema.node("paragraph", {}, [schema.text("test")]),
                            ]),
                        ),
                        0,
                        0,
                    ),
                ),
            ],
            clientId: generateId(),
        });

        await updateDocumentContent(context.action(session1), {
            id,
            version: 1,
            steps: [
                new ReplaceAroundStep(
                    2,
                    10,
                    3,
                    9,
                    new Slice(Fragment.from([schema.nodes.orderedListItem.create()]), 0, 0),
                    1,
                    true,
                ),
            ],
            clientId: generateId(),
        });

        expect(massageDocument(await getDocument(context.action(session1), id))).toEqual({
            version: 2,
            content: schema
                .node("doc", {}, [
                    schema.node("title", {}, []),
                    schema.node("orderedListItem", {}, [
                        schema.node("paragraph", {}, [schema.text("test")]),
                    ]),
                ])
                .toJSON(),
        });
    }

    {
        const {id} = await createDocument(context.action(session1), {
            spaceId: space.id,
            content: emptyDocumentContent,
        });

        await updateDocumentContent(context.action(session1), {
            id,
            version: 0,
            steps: [
                new ReplaceStep(
                    2,
                    4,
                    new Slice(
                        Fragment.from(
                            schema.node("quoteBlock", {}, [
                                schema.node("unorderedListItem", {}, [
                                    schema.node("paragraph", {}, [schema.text("test")]),
                                ]),
                            ]),
                        ),
                        0,
                        0,
                    ),
                ),
            ],
            clientId: generateId(),
        });

        await expect(
            updateDocumentContent(context.action(session1), {
                id,
                version: 1,
                steps: [
                    new ReplaceAroundStep(
                        2,
                        12,
                        3,
                        11,
                        new Slice(Fragment.from([schema.nodes.orderedListItem.create()]), 0, 0),
                        1,
                        true,
                    ),
                ],
                clientId: generateId(),
            }),
        ).rejects.toThrow(
            new FailedPreconditionError('Updated content for "orderedListItem" node is not valid'),
        );
    }
});

test("can not update a document with an invalid step even when there is a concurrent update", async () => {
    const {id} = await createDocument(context.action(session1), {
        spaceId: space.id,
        content: emptyDocumentContent,
    });

    await updateDocumentContent(context.action(session1), {
        id,
        version: 0,
        steps: [new ReplaceStep(3, 3, textSlice("test"))],
        clientId: generateId(),
    });

    await expect(
        updateDocumentContent(context.action(session1), {
            id,
            version: 0,
            steps: [
                new ReplaceStep(
                    2,
                    4,
                    new Slice(
                        Fragment.from(
                            schema.nodes.unorderedListItem.create({}, [schema.text("test")]),
                        ),
                        0,
                        0,
                    ),
                ),
            ],
            clientId: generateId(),
        }),
    ).rejects.toThrow(
        new FailedPreconditionError('Updated content for "unorderedListItem" node is not valid'),
    );
});

test("can not update a document such that it would have invalid content even when there is a concurrent update", async () => {
    const {id} = await createDocument(context.action(session1), {
        spaceId: space.id,
        content: emptyDocumentContent,
    });

    await updateDocumentContent(context.action(session1), {
        id,
        version: 0,
        steps: [
            new ReplaceStep(
                2,
                4,
                new Slice(
                    Fragment.from(
                        schema.node("quoteBlock", {}, [
                            schema.node("unorderedListItem", {}, [
                                schema.node("paragraph", {}, [schema.text("test")]),
                            ]),
                        ]),
                    ),
                    0,
                    0,
                ),
            ),
        ],
        clientId: generateId(),
    });

    await updateDocumentContent(context.action(session1), {
        id,
        version: 1,
        steps: [new ReplaceStep(7, 7, textSlice("eeeee"))],
        clientId: generateId(),
    });

    await expect(
        updateDocumentContent(context.action(session1), {
            id,
            version: 1,
            steps: [
                new ReplaceAroundStep(
                    2,
                    12,
                    3,
                    11,
                    new Slice(Fragment.from([schema.nodes.orderedListItem.create()]), 0, 0),
                    1,
                    true,
                ),
            ],
            clientId: generateId(),
        }),
    ).rejects.toThrow(
        new FailedPreconditionError('Updated content for "orderedListItem" node is not valid'),
    );
});

describe("Comments", () => {
    test("can create a comment thread while updating content", async () => {
        const DocumentsTable = getDocumentsTableForTest();

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

        await expect(() =>
            getDocumentComment(context.action(session1), {
                documentId: document.id,
                commentThreadId,
                commentIndex: 0,
            }),
        ).rejects.toThrow(NotFoundError);

        expect(
            await DocumentsTable.getItemIfExists(context, {
                partitionType: "Document",
                sortRangeType: "ReferencedCommentThread",
                documentId: document.id,
                commentThreadId,
            }),
        ).toBeNull();

        expect(
            await DocumentsTable.getItemIfExists(context, {
                partitionType: "Document",
                sortRangeType: "ArchivedCommentThread",
                documentId: document.id,
                commentThreadId,
            }),
        ).toBeNull();

        expect(massageDocument(await getDocument(context.action(session1), document.id))).toEqual({
            version: 1,
            content: schema
                .node("doc", {}, [
                    schema.node("title", {}, []),
                    schema.node("paragraph", {}, [schema.text("Hello, world!")]),
                ])
                .toJSON(),
        });

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

        expect(massageDocument(await getDocument(context.action(session1), document.id))).toEqual({
            version: 2,
            content: schema
                .node("doc", {}, [
                    schema.node("title", {}, []),
                    schema.node("paragraph", {}, [
                        schema.text("Hello, "),
                        schema.text("world", [schema.mark("comment", {commentThreadId})]),
                        schema.text("!"),
                    ]),
                ])
                .toJSON(),
        });

        expect(
            await getDocumentComment(context.action(session1), {
                documentId: document.id,
                commentThreadId,
                commentIndex: 0,
            }),
        ).not.toBeNull();

        expect(
            await DocumentsTable.getItemIfExists(context, {
                partitionType: "Document",
                sortRangeType: "ReferencedCommentThread",
                documentId: document.id,
                commentThreadId,
            }),
        ).not.toBeNull();

        expect(
            await DocumentsTable.getItemIfExists(context, {
                partitionType: "Document",
                sortRangeType: "ArchivedCommentThread",
                documentId: document.id,
                commentThreadId,
            }),
        ).toBeNull();
    });

    test("can not create a comment thread with the same id twice", async () => {
        const DocumentsTable = getDocumentsTableForTest();

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

        await expect(() =>
            getDocumentComment(context.action(session1), {
                documentId: document.id,
                commentThreadId,
                commentIndex: 0,
            }),
        ).rejects.toThrow(NotFoundError);

        expect(
            await DocumentsTable.getItemIfExists(context, {
                partitionType: "Document",
                sortRangeType: "ReferencedCommentThread",
                documentId: document.id,
                commentThreadId,
            }),
        ).toBeNull();

        expect(
            await DocumentsTable.getItemIfExists(context, {
                partitionType: "Document",
                sortRangeType: "ArchivedCommentThread",
                documentId: document.id,
                commentThreadId,
            }),
        ).toBeNull();

        expect(massageDocument(await getDocument(context.action(session1), document.id))).toEqual({
            version: 1,
            content: schema
                .node("doc", {}, [
                    schema.node("title", {}, []),
                    schema.node("paragraph", {}, [schema.text("Hello, world!")]),
                ])
                .toJSON(),
        });

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

        expect(massageDocument(await getDocument(context.action(session1), document.id))).toEqual({
            version: 2,
            content: schema
                .node("doc", {}, [
                    schema.node("title", {}, []),
                    schema.node("paragraph", {}, [
                        schema.text("Hello, "),
                        schema.text("world", [schema.mark("comment", {commentThreadId})]),
                        schema.text("!"),
                    ]),
                ])
                .toJSON(),
        });

        await expect(() =>
            updateDocumentContent(context.action(session1), {
                id: document.id,
                version: 2,
                steps: [new AddMarkStep(3, 8, schema.mark("comment", {commentThreadId}))],
                clientId: generateId(),
                createCommentThreads: [
                    {
                        commentThreadId,
                        initialCommentContent: createSimpleMessageContent("Test message content 2"),
                    },
                ],
            }),
        ).rejects.toThrow(
            new FailedPreconditionError(
                "DynamoDB TransactionCanceledException: Transaction cancelled, please refer cancellation reasons for specific reasons [None, None, ConditionalCheckFailed, None, None]",
            ),
        );
    });

    test("can not create a comment thread if the comment thread id is not in steps", async () => {
        const DocumentsTable = getDocumentsTableForTest();

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

        await expect(() =>
            getDocumentComment(context.action(session1), {
                documentId: document.id,
                commentThreadId,
                commentIndex: 0,
            }),
        ).rejects.toThrow(NotFoundError);

        expect(
            await DocumentsTable.getItemIfExists(context, {
                partitionType: "Document",
                sortRangeType: "ReferencedCommentThread",
                documentId: document.id,
                commentThreadId,
            }),
        ).toBeNull();

        expect(
            await DocumentsTable.getItemIfExists(context, {
                partitionType: "Document",
                sortRangeType: "ArchivedCommentThread",
                documentId: document.id,
                commentThreadId,
            }),
        ).toBeNull();

        expect(massageDocument(await getDocument(context.action(session1), document.id))).toEqual({
            version: 1,
            content: schema
                .node("doc", {}, [
                    schema.node("title", {}, []),
                    schema.node("paragraph", {}, [schema.text("Hello, world!")]),
                ])
                .toJSON(),
        });

        await expect(() =>
            updateDocumentContent(context.action(session1), {
                id: document.id,
                version: 1,
                steps: [new AddMarkStep(10, 15, schema.mark("bold"))],
                clientId: generateId(),
                createCommentThreads: [
                    {
                        commentThreadId,
                        initialCommentContent: createSimpleMessageContent("Test message content 1"),
                    },
                ],
            }),
        ).rejects.toThrow(InvalidArgumentError);

        expect(massageDocument(await getDocument(context.action(session1), document.id))).toEqual({
            version: 1,
            content: schema
                .node("doc", {}, [
                    schema.node("title", {}, []),
                    schema.node("paragraph", {}, [schema.text("Hello, world!")]),
                ])
                .toJSON(),
        });

        await expect(() =>
            getDocumentComment(context.action(session1), {
                documentId: document.id,
                commentThreadId,
                commentIndex: 0,
            }),
        ).rejects.toThrow(NotFoundError);

        expect(
            await DocumentsTable.getItemIfExists(context, {
                partitionType: "Document",
                sortRangeType: "ReferencedCommentThread",
                documentId: document.id,
                commentThreadId,
            }),
        ).toBeNull();

        expect(
            await DocumentsTable.getItemIfExists(context, {
                partitionType: "Document",
                sortRangeType: "ArchivedCommentThread",
                documentId: document.id,
                commentThreadId,
            }),
        ).toBeNull();
    });

    test("can mark text with a comment style even if there is no related thread", async () => {
        const DocumentsTable = getDocumentsTableForTest();

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

        await expect(() =>
            getDocumentComment(context.action(session1), {
                documentId: document.id,
                commentThreadId,
                commentIndex: 0,
            }),
        ).rejects.toThrow(NotFoundError);

        expect(
            await DocumentsTable.getItemIfExists(context, {
                partitionType: "Document",
                sortRangeType: "ReferencedCommentThread",
                documentId: document.id,
                commentThreadId,
            }),
        ).toBeNull();

        expect(
            await DocumentsTable.getItemIfExists(context, {
                partitionType: "Document",
                sortRangeType: "ArchivedCommentThread",
                documentId: document.id,
                commentThreadId,
            }),
        ).toBeNull();

        expect(massageDocument(await getDocument(context.action(session1), document.id))).toEqual({
            version: 1,
            content: schema
                .node("doc", {}, [
                    schema.node("title", {}, []),
                    schema.node("paragraph", {}, [schema.text("Hello, world!")]),
                ])
                .toJSON(),
        });

        await updateDocumentContent(context.action(session1), {
            id: document.id,
            version: 1,
            steps: [new AddMarkStep(10, 15, schema.mark("comment", {commentThreadId}))],
            clientId: generateId(),
        });

        expect(massageDocument(await getDocument(context.action(session1), document.id))).toEqual({
            version: 2,
            content: schema
                .node("doc", {}, [
                    schema.node("title", {}, []),
                    schema.node("paragraph", {}, [
                        schema.text("Hello, "),
                        schema.text("world", [schema.mark("comment", {commentThreadId})]),
                        schema.text("!"),
                    ]),
                ])
                .toJSON(),
        });

        await expect(() =>
            getDocumentComment(context.action(session1), {
                documentId: document.id,
                commentThreadId,
                commentIndex: 0,
            }),
        ).rejects.toThrow(NotFoundError);

        expect(
            await DocumentsTable.getItemIfExists(context, {
                partitionType: "Document",
                sortRangeType: "ReferencedCommentThread",
                documentId: document.id,
                commentThreadId,
            }),
        ).toBeNull();

        expect(
            await DocumentsTable.getItemIfExists(context, {
                partitionType: "Document",
                sortRangeType: "ArchivedCommentThread",
                documentId: document.id,
                commentThreadId,
            }),
        ).toBeNull();
    });

    test("comment threads that are no longer referenced will be archived after a snapshot update", async () => {
        const DocumentsTable = getDocumentsTableForTest();

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

        await expect(() =>
            getDocumentComment(context.action(session1), {
                documentId: document.id,
                commentThreadId,
                commentIndex: 0,
            }),
        ).rejects.toThrow(NotFoundError);

        expect(
            await DocumentsTable.getItemIfExists(context, {
                partitionType: "Document",
                sortRangeType: "ReferencedCommentThread",
                documentId: document.id,
                commentThreadId,
            }),
        ).toBeNull();

        expect(
            await DocumentsTable.getItemIfExists(context, {
                partitionType: "Document",
                sortRangeType: "ArchivedCommentThread",
                documentId: document.id,
                commentThreadId,
            }),
        ).toBeNull();

        expect(massageDocument(await getDocument(context.action(session1), document.id))).toEqual({
            version: 1,
            content: schema
                .node("doc", {}, [
                    schema.node("title", {}, []),
                    schema.node("paragraph", {}, [schema.text("Hello, world!")]),
                ])
                .toJSON(),
        });

        expect(
            (
                await getDocument(context.action(session1), document.id)
            ).content.references.commentThreadById.has(commentThreadId),
        ).toEqual(false);

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

        expect(massageDocument(await getDocument(context.action(session1), document.id))).toEqual({
            version: 2,
            content: schema
                .node("doc", {}, [
                    schema.node("title", {}, []),
                    schema.node("paragraph", {}, [
                        schema.text("Hello, "),
                        schema.text("world", [schema.mark("comment", {commentThreadId})]),
                        schema.text("!"),
                    ]),
                ])
                .toJSON(),
        });

        expect(
            (
                await getDocument(context.action(session1), document.id)
            ).content.references.commentThreadById.has(commentThreadId),
        ).toEqual(true);

        expect(
            await getDocumentComment(context.action(session1), {
                documentId: document.id,
                commentThreadId,
                commentIndex: 0,
            }),
        ).not.toBeNull();

        expect(
            await DocumentsTable.getItemIfExists(context, {
                partitionType: "Document",
                sortRangeType: "ReferencedCommentThread",
                documentId: document.id,
                commentThreadId,
            }),
        ).not.toBeNull();

        expect(
            await DocumentsTable.getItemIfExists(context, {
                partitionType: "Document",
                sortRangeType: "ArchivedCommentThread",
                documentId: document.id,
                commentThreadId,
            }),
        ).toBeNull();

        await updateDocumentContent(context.action(session1), {
            id: document.id,
            version: 2,
            steps: [new RemoveMarkStep(10, 15, schema.mark("comment", {commentThreadId}))],
            clientId: generateId(),
        });

        expect(massageDocument(await getDocument(context.action(session1), document.id))).toEqual({
            version: 3,
            content: schema
                .node("doc", {}, [
                    schema.node("title", {}, []),
                    schema.node("paragraph", {}, [schema.text("Hello, world!")]),
                ])
                .toJSON(),
        });

        expect(
            (
                await getDocument(context.action(session1), document.id)
            ).content.references.commentThreadById.has(commentThreadId),
        ).toEqual(false);

        expect(
            await getDocumentComment(context.action(session1), {
                documentId: document.id,
                commentThreadId,
                commentIndex: 0,
            }),
        ).not.toBeNull();

        expect(
            await DocumentsTable.getItemIfExists(context, {
                partitionType: "Document",
                sortRangeType: "ReferencedCommentThread",
                documentId: document.id,
                commentThreadId,
            }),
        ).not.toBeNull();

        expect(
            await DocumentsTable.getItemIfExists(context, {
                partitionType: "Document",
                sortRangeType: "ArchivedCommentThread",
                documentId: document.id,
                commentThreadId,
            }),
        ).toBeNull();

        await updateDocumentSnapshotForTest(context.action(session1), document.id);

        expect(massageDocument(await getDocument(context.action(session1), document.id))).toEqual({
            version: 3,
            content: schema
                .node("doc", {}, [
                    schema.node("title", {}, []),
                    schema.node("paragraph", {}, [schema.text("Hello, world!")]),
                ])
                .toJSON(),
        });

        expect(
            (
                await getDocument(context.action(session1), document.id)
            ).content.references.commentThreadById.has(commentThreadId),
        ).toEqual(false);

        expect(
            await getDocumentComment(context.action(session1), {
                documentId: document.id,
                commentThreadId,
                commentIndex: 0,
            }),
        ).not.toBeNull();

        expect(
            await DocumentsTable.getItemIfExists(context, {
                partitionType: "Document",
                sortRangeType: "ReferencedCommentThread",
                documentId: document.id,
                commentThreadId,
            }),
        ).toBeNull();

        expect(
            await DocumentsTable.getItemIfExists(context, {
                partitionType: "Document",
                sortRangeType: "ArchivedCommentThread",
                documentId: document.id,
                commentThreadId,
            }),
        ).not.toBeNull();
    });

    test("can not re-create a comment thread that has been archived", async () => {
        const DocumentsTable = getDocumentsTableForTest();

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

        await expect(() =>
            getDocumentComment(context.action(session1), {
                documentId: document.id,
                commentThreadId,
                commentIndex: 0,
            }),
        ).rejects.toThrow(NotFoundError);

        expect(
            await DocumentsTable.getItemIfExists(context, {
                partitionType: "Document",
                sortRangeType: "ReferencedCommentThread",
                documentId: document.id,
                commentThreadId,
            }),
        ).toBeNull();

        expect(
            await DocumentsTable.getItemIfExists(context, {
                partitionType: "Document",
                sortRangeType: "ArchivedCommentThread",
                documentId: document.id,
                commentThreadId,
            }),
        ).toBeNull();

        expect(massageDocument(await getDocument(context.action(session1), document.id))).toEqual({
            version: 1,
            content: schema
                .node("doc", {}, [
                    schema.node("title", {}, []),
                    schema.node("paragraph", {}, [schema.text("Hello, world!")]),
                ])
                .toJSON(),
        });

        expect(
            (
                await getDocument(context.action(session1), document.id)
            ).content.references.commentThreadById.has(commentThreadId),
        ).toEqual(false);

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

        expect(massageDocument(await getDocument(context.action(session1), document.id))).toEqual({
            version: 2,
            content: schema
                .node("doc", {}, [
                    schema.node("title", {}, []),
                    schema.node("paragraph", {}, [
                        schema.text("Hello, "),
                        schema.text("world", [schema.mark("comment", {commentThreadId})]),
                        schema.text("!"),
                    ]),
                ])
                .toJSON(),
        });

        expect(
            (
                await getDocument(context.action(session1), document.id)
            ).content.references.commentThreadById.has(commentThreadId),
        ).toEqual(true);

        expect(
            await getDocumentComment(context.action(session1), {
                documentId: document.id,
                commentThreadId,
                commentIndex: 0,
            }),
        ).not.toBeNull();

        expect(
            await DocumentsTable.getItemIfExists(context, {
                partitionType: "Document",
                sortRangeType: "ReferencedCommentThread",
                documentId: document.id,
                commentThreadId,
            }),
        ).not.toBeNull();

        expect(
            await DocumentsTable.getItemIfExists(context, {
                partitionType: "Document",
                sortRangeType: "ArchivedCommentThread",
                documentId: document.id,
                commentThreadId,
            }),
        ).toBeNull();

        await updateDocumentContent(context.action(session1), {
            id: document.id,
            version: 2,
            steps: [new RemoveMarkStep(10, 15, schema.mark("comment", {commentThreadId}))],
            clientId: generateId(),
        });

        expect(massageDocument(await getDocument(context.action(session1), document.id))).toEqual({
            version: 3,
            content: schema
                .node("doc", {}, [
                    schema.node("title", {}, []),
                    schema.node("paragraph", {}, [schema.text("Hello, world!")]),
                ])
                .toJSON(),
        });

        expect(
            (
                await getDocument(context.action(session1), document.id)
            ).content.references.commentThreadById.has(commentThreadId),
        ).toEqual(false);

        expect(
            await getDocumentComment(context.action(session1), {
                documentId: document.id,
                commentThreadId,
                commentIndex: 0,
            }),
        ).not.toBeNull();

        expect(
            await DocumentsTable.getItemIfExists(context, {
                partitionType: "Document",
                sortRangeType: "ReferencedCommentThread",
                documentId: document.id,
                commentThreadId,
            }),
        ).not.toBeNull();

        expect(
            await DocumentsTable.getItemIfExists(context, {
                partitionType: "Document",
                sortRangeType: "ArchivedCommentThread",
                documentId: document.id,
                commentThreadId,
            }),
        ).toBeNull();

        await updateDocumentSnapshotForTest(context.action(session1), document.id);

        expect(massageDocument(await getDocument(context.action(session1), document.id))).toEqual({
            version: 3,
            content: schema
                .node("doc", {}, [
                    schema.node("title", {}, []),
                    schema.node("paragraph", {}, [schema.text("Hello, world!")]),
                ])
                .toJSON(),
        });

        expect(
            (
                await getDocument(context.action(session1), document.id)
            ).content.references.commentThreadById.has(commentThreadId),
        ).toEqual(false);

        expect(
            await getDocumentComment(context.action(session1), {
                documentId: document.id,
                commentThreadId,
                commentIndex: 0,
            }),
        ).not.toBeNull();

        expect(
            await DocumentsTable.getItemIfExists(context, {
                partitionType: "Document",
                sortRangeType: "ReferencedCommentThread",
                documentId: document.id,
                commentThreadId,
            }),
        ).toBeNull();

        expect(
            await DocumentsTable.getItemIfExists(context, {
                partitionType: "Document",
                sortRangeType: "ArchivedCommentThread",
                documentId: document.id,
                commentThreadId,
            }),
        ).not.toBeNull();

        await expect(() =>
            updateDocumentContent(context.action(session1), {
                id: document.id,
                version: 3,
                steps: [new AddMarkStep(3, 8, schema.mark("comment", {commentThreadId}))],
                clientId: generateId(),
                createCommentThreads: [
                    {
                        commentThreadId,
                        initialCommentContent: createSimpleMessageContent("Test message content 2"),
                    },
                ],
            }),
        ).rejects.toThrow(
            new FailedPreconditionError(
                "DynamoDB TransactionCanceledException: Transaction cancelled, please refer cancellation reasons for specific reasons [None, None, None, ConditionalCheckFailed, None]",
            ),
        );

        expect(massageDocument(await getDocument(context.action(session1), document.id))).toEqual({
            version: 3,
            content: schema
                .node("doc", {}, [
                    schema.node("title", {}, []),
                    schema.node("paragraph", {}, [schema.text("Hello, world!")]),
                ])
                .toJSON(),
        });

        expect(
            (
                await getDocument(context.action(session1), document.id)
            ).content.references.commentThreadById.has(commentThreadId),
        ).toEqual(false);

        expect(
            await getDocumentComment(context.action(session1), {
                documentId: document.id,
                commentThreadId,
                commentIndex: 0,
            }),
        ).not.toBeNull();

        expect(
            await DocumentsTable.getItemIfExists(context, {
                partitionType: "Document",
                sortRangeType: "ReferencedCommentThread",
                documentId: document.id,
                commentThreadId,
            }),
        ).toBeNull();

        expect(
            await DocumentsTable.getItemIfExists(context, {
                partitionType: "Document",
                sortRangeType: "ArchivedCommentThread",
                documentId: document.id,
                commentThreadId,
            }),
        ).not.toBeNull();
    });

    test("comment threads that were unreferenced then re-referenced will be unarchived after a snapshot update", async () => {
        const DocumentsTable = getDocumentsTableForTest();

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

        await expect(() =>
            getDocumentComment(context.action(session1), {
                documentId: document.id,
                commentThreadId,
                commentIndex: 0,
            }),
        ).rejects.toThrow(NotFoundError);

        expect(
            await DocumentsTable.getItemIfExists(context, {
                partitionType: "Document",
                sortRangeType: "ReferencedCommentThread",
                documentId: document.id,
                commentThreadId,
            }),
        ).toBeNull();

        expect(
            await DocumentsTable.getItemIfExists(context, {
                partitionType: "Document",
                sortRangeType: "ArchivedCommentThread",
                documentId: document.id,
                commentThreadId,
            }),
        ).toBeNull();

        expect(massageDocument(await getDocument(context.action(session1), document.id))).toEqual({
            version: 1,
            content: schema
                .node("doc", {}, [
                    schema.node("title", {}, []),
                    schema.node("paragraph", {}, [schema.text("Hello, world!")]),
                ])
                .toJSON(),
        });

        expect(
            (
                await getDocument(context.action(session1), document.id)
            ).content.references.commentThreadById.has(commentThreadId),
        ).toEqual(false);

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

        expect(massageDocument(await getDocument(context.action(session1), document.id))).toEqual({
            version: 2,
            content: schema
                .node("doc", {}, [
                    schema.node("title", {}, []),
                    schema.node("paragraph", {}, [
                        schema.text("Hello, "),
                        schema.text("world", [schema.mark("comment", {commentThreadId})]),
                        schema.text("!"),
                    ]),
                ])
                .toJSON(),
        });

        expect(
            (
                await getDocument(context.action(session1), document.id)
            ).content.references.commentThreadById.has(commentThreadId),
        ).toEqual(true);

        expect(
            await getDocumentComment(context.action(session1), {
                documentId: document.id,
                commentThreadId,
                commentIndex: 0,
            }),
        ).not.toBeNull();

        expect(
            await DocumentsTable.getItemIfExists(context, {
                partitionType: "Document",
                sortRangeType: "ReferencedCommentThread",
                documentId: document.id,
                commentThreadId,
            }),
        ).not.toBeNull();

        expect(
            await DocumentsTable.getItemIfExists(context, {
                partitionType: "Document",
                sortRangeType: "ArchivedCommentThread",
                documentId: document.id,
                commentThreadId,
            }),
        ).toBeNull();

        await updateDocumentContent(context.action(session1), {
            id: document.id,
            version: 2,
            steps: [new RemoveMarkStep(10, 15, schema.mark("comment", {commentThreadId}))],
            clientId: generateId(),
        });

        expect(massageDocument(await getDocument(context.action(session1), document.id))).toEqual({
            version: 3,
            content: schema
                .node("doc", {}, [
                    schema.node("title", {}, []),
                    schema.node("paragraph", {}, [schema.text("Hello, world!")]),
                ])
                .toJSON(),
        });

        expect(
            (
                await getDocument(context.action(session1), document.id)
            ).content.references.commentThreadById.has(commentThreadId),
        ).toEqual(false);

        expect(
            await getDocumentComment(context.action(session1), {
                documentId: document.id,
                commentThreadId,
                commentIndex: 0,
            }),
        ).not.toBeNull();

        expect(
            await DocumentsTable.getItemIfExists(context, {
                partitionType: "Document",
                sortRangeType: "ReferencedCommentThread",
                documentId: document.id,
                commentThreadId,
            }),
        ).not.toBeNull();

        expect(
            await DocumentsTable.getItemIfExists(context, {
                partitionType: "Document",
                sortRangeType: "ArchivedCommentThread",
                documentId: document.id,
                commentThreadId,
            }),
        ).toBeNull();

        await updateDocumentSnapshotForTest(context.action(session1), document.id);

        expect(massageDocument(await getDocument(context.action(session1), document.id))).toEqual({
            version: 3,
            content: schema
                .node("doc", {}, [
                    schema.node("title", {}, []),
                    schema.node("paragraph", {}, [schema.text("Hello, world!")]),
                ])
                .toJSON(),
        });

        expect(
            (
                await getDocument(context.action(session1), document.id)
            ).content.references.commentThreadById.has(commentThreadId),
        ).toEqual(false);

        expect(
            await getDocumentComment(context.action(session1), {
                documentId: document.id,
                commentThreadId,
                commentIndex: 0,
            }),
        ).not.toBeNull();

        expect(
            await DocumentsTable.getItemIfExists(context, {
                partitionType: "Document",
                sortRangeType: "ReferencedCommentThread",
                documentId: document.id,
                commentThreadId,
            }),
        ).toBeNull();

        expect(
            await DocumentsTable.getItemIfExists(context, {
                partitionType: "Document",
                sortRangeType: "ArchivedCommentThread",
                documentId: document.id,
                commentThreadId,
            }),
        ).not.toBeNull();

        await updateDocumentContent(context.action(session1), {
            id: document.id,
            version: 3,
            steps: [new AddMarkStep(10, 15, schema.mark("comment", {commentThreadId}))],
            clientId: generateId(),
        });

        expect(massageDocument(await getDocument(context.action(session1), document.id))).toEqual({
            version: 4,
            content: schema
                .node("doc", {}, [
                    schema.node("title", {}, []),
                    schema.node("paragraph", {}, [
                        schema.text("Hello, "),
                        schema.text("world", [schema.mark("comment", {commentThreadId})]),
                        schema.text("!"),
                    ]),
                ])
                .toJSON(),
        });

        expect(
            (
                await getDocument(context.action(session1), document.id)
            ).content.references.commentThreadById.has(commentThreadId),
        ).toEqual(true);

        expect(
            await getDocumentComment(context.action(session1), {
                documentId: document.id,
                commentThreadId,
                commentIndex: 0,
            }),
        ).not.toBeNull();

        expect(
            await DocumentsTable.getItemIfExists(context, {
                partitionType: "Document",
                sortRangeType: "ReferencedCommentThread",
                documentId: document.id,
                commentThreadId,
            }),
        ).toBeNull();

        expect(
            await DocumentsTable.getItemIfExists(context, {
                partitionType: "Document",
                sortRangeType: "ArchivedCommentThread",
                documentId: document.id,
                commentThreadId,
            }),
        ).not.toBeNull();

        await updateDocumentSnapshotForTest(context.action(session1), document.id);

        expect(massageDocument(await getDocument(context.action(session1), document.id))).toEqual({
            version: 4,
            content: schema
                .node("doc", {}, [
                    schema.node("title", {}, []),
                    schema.node("paragraph", {}, [
                        schema.text("Hello, "),
                        schema.text("world", [schema.mark("comment", {commentThreadId})]),
                        schema.text("!"),
                    ]),
                ])
                .toJSON(),
        });

        expect(
            (
                await getDocument(context.action(session1), document.id)
            ).content.references.commentThreadById.has(commentThreadId),
        ).toEqual(true);

        expect(
            await getDocumentComment(context.action(session1), {
                documentId: document.id,
                commentThreadId,
                commentIndex: 0,
            }),
        ).not.toBeNull();

        expect(
            await DocumentsTable.getItemIfExists(context, {
                partitionType: "Document",
                sortRangeType: "ReferencedCommentThread",
                documentId: document.id,
                commentThreadId,
            }),
        ).not.toBeNull();

        expect(
            await DocumentsTable.getItemIfExists(context, {
                partitionType: "Document",
                sortRangeType: "ArchivedCommentThread",
                documentId: document.id,
                commentThreadId,
            }),
        ).toBeNull();
    });

    test("comment threads correctly archived or unarchived will be left alone after a snapshot update", async () => {
        const DocumentsTable = getDocumentsTableForTest();

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

        const commentThreadId1 = generateId<DocumentCommentThreadId>();
        const commentThreadId2 = generateId<DocumentCommentThreadId>();

        await updateDocumentContent(context.action(session1), {
            id: document.id,
            version: 1,
            steps: [
                new AddMarkStep(
                    10,
                    15,
                    schema.mark("comment", {commentThreadId: commentThreadId1}),
                ),
            ],
            clientId: generateId(),
            createCommentThreads: [
                {
                    commentThreadId: commentThreadId1,
                    initialCommentContent: createSimpleMessageContent("Test message content 1"),
                },
            ],
        });

        await updateDocumentContent(context.action(session1), {
            id: document.id,
            version: 2,
            steps: [
                new RemoveMarkStep(
                    10,
                    15,
                    schema.mark("comment", {commentThreadId: commentThreadId1}),
                ),
            ],
            clientId: generateId(),
        });

        await updateDocumentSnapshotForTest(context.action(session1), document.id);

        await updateDocumentContent(context.action(session1), {
            id: document.id,
            version: 3,
            steps: [
                new AddMarkStep(
                    10,
                    15,
                    schema.mark("comment", {commentThreadId: commentThreadId2}),
                ),
            ],
            clientId: generateId(),
            createCommentThreads: [
                {
                    commentThreadId: commentThreadId2,
                    initialCommentContent: createSimpleMessageContent("Test message content 2"),
                },
            ],
        });

        expect(massageDocument(await getDocument(context.action(session1), document.id))).toEqual({
            version: 4,
            content: schema
                .node("doc", {}, [
                    schema.node("title", {}, []),
                    schema.node("paragraph", {}, [
                        schema.text("Hello, "),
                        schema.text("world", [
                            schema.mark("comment", {commentThreadId: commentThreadId2}),
                        ]),
                        schema.text("!"),
                    ]),
                ])
                .toJSON(),
        });

        expect(
            await getDocumentComment(context.action(session1), {
                documentId: document.id,
                commentThreadId: commentThreadId1,
                commentIndex: 0,
            }),
        ).not.toBeNull();

        expect(
            await DocumentsTable.getItemIfExists(context, {
                partitionType: "Document",
                sortRangeType: "ReferencedCommentThread",
                documentId: document.id,
                commentThreadId: commentThreadId1,
            }),
        ).toBeNull();

        expect(
            await DocumentsTable.getItemIfExists(context, {
                partitionType: "Document",
                sortRangeType: "ArchivedCommentThread",
                documentId: document.id,
                commentThreadId: commentThreadId1,
            }),
        ).not.toBeNull();

        expect(
            await getDocumentComment(context.action(session1), {
                documentId: document.id,
                commentThreadId: commentThreadId2,
                commentIndex: 0,
            }),
        ).not.toBeNull();

        expect(
            await DocumentsTable.getItemIfExists(context, {
                partitionType: "Document",
                sortRangeType: "ReferencedCommentThread",
                documentId: document.id,
                commentThreadId: commentThreadId2,
            }),
        ).not.toBeNull();

        expect(
            await DocumentsTable.getItemIfExists(context, {
                partitionType: "Document",
                sortRangeType: "ArchivedCommentThread",
                documentId: document.id,
                commentThreadId: commentThreadId2,
            }),
        ).toBeNull();

        await updateDocumentSnapshotForTest(context.action(session1), document.id);

        expect(
            await getDocumentComment(context.action(session1), {
                documentId: document.id,
                commentThreadId: commentThreadId1,
                commentIndex: 0,
            }),
        ).not.toBeNull();

        expect(
            await DocumentsTable.getItemIfExists(context, {
                partitionType: "Document",
                sortRangeType: "ReferencedCommentThread",
                documentId: document.id,
                commentThreadId: commentThreadId1,
            }),
        ).toBeNull();

        expect(
            await DocumentsTable.getItemIfExists(context, {
                partitionType: "Document",
                sortRangeType: "ArchivedCommentThread",
                documentId: document.id,
                commentThreadId: commentThreadId1,
            }),
        ).not.toBeNull();

        expect(
            await getDocumentComment(context.action(session1), {
                documentId: document.id,
                commentThreadId: commentThreadId2,
                commentIndex: 0,
            }),
        ).not.toBeNull();

        expect(
            await DocumentsTable.getItemIfExists(context, {
                partitionType: "Document",
                sortRangeType: "ReferencedCommentThread",
                documentId: document.id,
                commentThreadId: commentThreadId2,
            }),
        ).not.toBeNull();

        expect(
            await DocumentsTable.getItemIfExists(context, {
                partitionType: "Document",
                sortRangeType: "ArchivedCommentThread",
                documentId: document.id,
                commentThreadId: commentThreadId2,
            }),
        ).toBeNull();
    });

    test("can archive a comment thread even when it is actively being updated", async () => {
        const DocumentsTable = getDocumentsTableForTest();

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

        await updateDocumentContent(context.action(session1), {
            id: document.id,
            version: 2,
            steps: [new RemoveMarkStep(10, 15, schema.mark("comment", {commentThreadId}))],
            clientId: generateId(),
        });

        expect(
            await DocumentsTable.getItemIfExists(context, {
                partitionType: "Document",
                sortRangeType: "ReferencedCommentThread",
                documentId: document.id,
                commentThreadId,
            }),
        ).toEqual({
            partitionType: "Document",
            sortRangeType: "ReferencedCommentThread",
            documentId: document.id,
            commentThreadId,
            createdTime: expect.any(Date),
            commentsSummary: {
                nextCommentIndex: 1,
                lastChangeTime: null,
                commentCountByAuthorId: new Map([[session1.account.id, 1]]),
                mentionCountByAccountId: new Map(),
            },
        });

        expect(
            await DocumentsTable.getItemIfExists(context, {
                partitionType: "Document",
                sortRangeType: "ArchivedCommentThread",
                documentId: document.id,
                commentThreadId,
            }),
        ).toEqual(null);

        const pausePromise =
            updateDocumentSnapshotBeforeMovingCommentThreadTestCheckpoint.pauseForTest(document.id);

        const updateSnapshotPromise = updateDocumentSnapshotForTest(
            context.action(session1),
            document.id,
        );

        const {unpause} = await pausePromise;

        expect(
            await DocumentsTable.getItemIfExists(context, {
                partitionType: "Document",
                sortRangeType: "ReferencedCommentThread",
                documentId: document.id,
                commentThreadId,
            }),
        ).toEqual({
            partitionType: "Document",
            sortRangeType: "ReferencedCommentThread",
            documentId: document.id,
            commentThreadId,
            createdTime: expect.any(Date),
            commentsSummary: {
                nextCommentIndex: 1,
                lastChangeTime: null,
                commentCountByAuthorId: new Map([[session1.account.id, 1]]),
                mentionCountByAccountId: new Map(),
            },
        });

        expect(
            await DocumentsTable.getItemIfExists(context, {
                partitionType: "Document",
                sortRangeType: "ArchivedCommentThread",
                documentId: document.id,
                commentThreadId,
            }),
        ).toEqual(null);

        await createDocumentComment(context.action(session1), {
            documentId: document.id,
            commentThreadId,
            parentCommentIndex: null,
            content: createSimpleMessageContent("Test message content 2"),
        });

        expect(
            await DocumentsTable.getItemIfExists(context, {
                partitionType: "Document",
                sortRangeType: "ReferencedCommentThread",
                documentId: document.id,
                commentThreadId,
            }),
        ).toEqual({
            partitionType: "Document",
            sortRangeType: "ReferencedCommentThread",
            documentId: document.id,
            commentThreadId,
            createdTime: expect.any(Date),
            commentsSummary: {
                nextCommentIndex: 2,
                lastChangeTime: null,
                commentCountByAuthorId: new Map([[session1.account.id, 2]]),
                mentionCountByAccountId: new Map(),
            },
            updateLockVersion: 1,
        });

        expect(
            await DocumentsTable.getItemIfExists(context, {
                partitionType: "Document",
                sortRangeType: "ArchivedCommentThread",
                documentId: document.id,
                commentThreadId,
            }),
        ).toEqual(null);

        unpause();

        await updateSnapshotPromise;

        expect(
            await DocumentsTable.getItemIfExists(context, {
                partitionType: "Document",
                sortRangeType: "ReferencedCommentThread",
                documentId: document.id,
                commentThreadId,
            }),
        ).toEqual(null);

        expect(
            await DocumentsTable.getItemIfExists(context, {
                partitionType: "Document",
                sortRangeType: "ArchivedCommentThread",
                documentId: document.id,
                commentThreadId,
            }),
        ).toEqual({
            partitionType: "Document",
            sortRangeType: "ArchivedCommentThread",
            documentId: document.id,
            commentThreadId,
            createdTime: expect.any(Date),
            commentsSummary: {
                nextCommentIndex: 2,
                lastChangeTime: null,
                commentCountByAuthorId: new Map([[session1.account.id, 2]]),
                mentionCountByAccountId: new Map(),
            },
            updateLockVersion: 1,
        });
    });

    test("can unarchive a comment thread even when it is actively being updated", async () => {
        const DocumentsTable = getDocumentsTableForTest();

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

        await updateDocumentContent(context.action(session1), {
            id: document.id,
            version: 2,
            steps: [new RemoveMarkStep(10, 15, schema.mark("comment", {commentThreadId}))],
            clientId: generateId(),
        });

        await updateDocumentSnapshotForTest(context.action(session1), document.id);

        await updateDocumentContent(context.action(session1), {
            id: document.id,
            version: 3,
            steps: [new AddMarkStep(10, 15, schema.mark("comment", {commentThreadId}))],
            clientId: generateId(),
        });

        expect(
            await DocumentsTable.getItemIfExists(context, {
                partitionType: "Document",
                sortRangeType: "ReferencedCommentThread",
                documentId: document.id,
                commentThreadId,
            }),
        ).toEqual(null);

        expect(
            await DocumentsTable.getItemIfExists(context, {
                partitionType: "Document",
                sortRangeType: "ArchivedCommentThread",
                documentId: document.id,
                commentThreadId,
            }),
        ).toEqual({
            partitionType: "Document",
            sortRangeType: "ArchivedCommentThread",
            documentId: document.id,
            commentThreadId,
            createdTime: expect.any(Date),
            commentsSummary: {
                nextCommentIndex: 1,
                lastChangeTime: null,
                commentCountByAuthorId: new Map([[session1.account.id, 1]]),
                mentionCountByAccountId: new Map(),
            },
        });

        const pausePromise =
            updateDocumentSnapshotBeforeMovingCommentThreadTestCheckpoint.pauseForTest(document.id);

        const updateSnapshotPromise = updateDocumentSnapshotForTest(
            context.action(session1),
            document.id,
        );

        const {unpause} = await pausePromise;

        expect(
            await DocumentsTable.getItemIfExists(context, {
                partitionType: "Document",
                sortRangeType: "ReferencedCommentThread",
                documentId: document.id,
                commentThreadId,
            }),
        ).toEqual(null);

        expect(
            await DocumentsTable.getItemIfExists(context, {
                partitionType: "Document",
                sortRangeType: "ArchivedCommentThread",
                documentId: document.id,
                commentThreadId,
            }),
        ).toEqual({
            partitionType: "Document",
            sortRangeType: "ArchivedCommentThread",
            documentId: document.id,
            commentThreadId,
            createdTime: expect.any(Date),
            commentsSummary: {
                nextCommentIndex: 1,
                lastChangeTime: null,
                commentCountByAuthorId: new Map([[session1.account.id, 1]]),
                mentionCountByAccountId: new Map(),
            },
        });

        await createDocumentComment(context.action(session1), {
            documentId: document.id,
            commentThreadId,
            parentCommentIndex: null,
            content: createSimpleMessageContent("Test message content 2"),
        });

        expect(
            await DocumentsTable.getItemIfExists(context, {
                partitionType: "Document",
                sortRangeType: "ReferencedCommentThread",
                documentId: document.id,
                commentThreadId,
            }),
        ).toEqual(null);

        expect(
            await DocumentsTable.getItemIfExists(context, {
                partitionType: "Document",
                sortRangeType: "ArchivedCommentThread",
                documentId: document.id,
                commentThreadId,
            }),
        ).toEqual({
            partitionType: "Document",
            sortRangeType: "ArchivedCommentThread",
            documentId: document.id,
            commentThreadId,
            createdTime: expect.any(Date),
            commentsSummary: {
                nextCommentIndex: 2,
                lastChangeTime: null,
                commentCountByAuthorId: new Map([[session1.account.id, 2]]),
                mentionCountByAccountId: new Map(),
            },
            updateLockVersion: 1,
        });

        unpause();

        await updateSnapshotPromise;

        expect(
            await DocumentsTable.getItemIfExists(context, {
                partitionType: "Document",
                sortRangeType: "ReferencedCommentThread",
                documentId: document.id,
                commentThreadId,
            }),
        ).toEqual({
            partitionType: "Document",
            sortRangeType: "ReferencedCommentThread",
            documentId: document.id,
            commentThreadId,
            createdTime: expect.any(Date),
            commentsSummary: {
                nextCommentIndex: 2,
                lastChangeTime: null,
                commentCountByAuthorId: new Map([[session1.account.id, 2]]),
                mentionCountByAccountId: new Map(),
            },
            updateLockVersion: 1,
        });

        expect(
            await DocumentsTable.getItemIfExists(context, {
                partitionType: "Document",
                sortRangeType: "ArchivedCommentThread",
                documentId: document.id,
                commentThreadId,
            }),
        ).toEqual(null);
    });

    test("reading a comment thread while unarchiving works", async () => {
        const DocumentsTable = getDocumentsTableForTest();

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

        await updateDocumentContent(context.action(session1), {
            id: document.id,
            version: 2,
            steps: [new RemoveMarkStep(10, 15, schema.mark("comment", {commentThreadId}))],
            clientId: generateId(),
        });

        await updateDocumentSnapshotForTest(context.action(session1), document.id);

        await updateDocumentContent(context.action(session1), {
            id: document.id,
            version: 3,
            steps: [new AddMarkStep(10, 15, schema.mark("comment", {commentThreadId}))],
            clientId: generateId(),
        });

        expect(
            await DocumentsTable.getItemIfExists(context, {
                partitionType: "Document",
                sortRangeType: "ReferencedCommentThread",
                documentId: document.id,
                commentThreadId,
            }),
        ).toBeNull();

        expect(
            await DocumentsTable.getItemIfExists(context, {
                partitionType: "Document",
                sortRangeType: "ArchivedCommentThread",
                documentId: document.id,
                commentThreadId,
            }),
        ).not.toBeNull();

        const pausePromise =
            getDocumentCommentThreadItemAfterFirstGetItemTestCheckpoint.pauseForTest(document.id);

        const commentPromise = getDocumentComment(context.action(session1), {
            documentId: document.id,
            commentThreadId,
            commentIndex: 0,
        });

        const {unpause} = await pausePromise;

        expect(
            await DocumentsTable.getItemIfExists(context, {
                partitionType: "Document",
                sortRangeType: "ReferencedCommentThread",
                documentId: document.id,
                commentThreadId,
            }),
        ).toBeNull();

        expect(
            await DocumentsTable.getItemIfExists(context, {
                partitionType: "Document",
                sortRangeType: "ArchivedCommentThread",
                documentId: document.id,
                commentThreadId,
            }),
        ).not.toBeNull();

        await updateDocumentSnapshotForTest(context.action(session1), document.id);

        expect(
            await DocumentsTable.getItemIfExists(context, {
                partitionType: "Document",
                sortRangeType: "ReferencedCommentThread",
                documentId: document.id,
                commentThreadId,
            }),
        ).not.toBeNull();

        expect(
            await DocumentsTable.getItemIfExists(context, {
                partitionType: "Document",
                sortRangeType: "ArchivedCommentThread",
                documentId: document.id,
                commentThreadId,
            }),
        ).toBeNull();

        unpause();

        expect(await commentPromise).not.toBeNull();
    });

    test("can get many comment threads at once", async () => {
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

        const commentThreadId1 = generateId<DocumentCommentThreadId>();
        const commentThreadId2 = generateId<DocumentCommentThreadId>();

        await updateDocumentContent(context.action(session1), {
            id: document.id,
            version: 1,
            steps: [
                new AddMarkStep(
                    10,
                    15,
                    schema.mark("comment", {commentThreadId: commentThreadId1}),
                ),
            ],
            clientId: generateId(),
            createCommentThreads: [
                {
                    commentThreadId: commentThreadId1,
                    initialCommentContent: createSimpleMessageContent("Test message content 1"),
                },
            ],
        });

        await updateDocumentContent(context.action(session1), {
            id: document.id,
            version: 2,
            steps: [
                new RemoveMarkStep(
                    10,
                    15,
                    schema.mark("comment", {commentThreadId: commentThreadId1}),
                ),
            ],
            clientId: generateId(),
        });

        await updateDocumentSnapshotForTest(context.action(session1), document.id);

        await updateDocumentContent(context.action(session1), {
            id: document.id,
            version: 3,
            steps: [
                new AddMarkStep(
                    10,
                    15,
                    schema.mark("comment", {commentThreadId: commentThreadId2}),
                ),
            ],
            clientId: generateId(),
            createCommentThreads: [
                {
                    commentThreadId: commentThreadId2,
                    initialCommentContent: createSimpleMessageContent("Test message content 2"),
                },
            ],
        });

        {
            const commentThreads = await batchGetDocumentCommentThreadsIfExists(
                context.action(session1),
                {
                    documentId: document.id,
                    commentThreadIds: [],
                },
            );

            expect(commentThreads.length).toEqual(0);
        }

        {
            const commentThreads = await batchGetDocumentCommentThreadsIfExists(
                context.action(session1),
                {
                    documentId: document.id,
                    commentThreadIds: [commentThreadId1],
                },
            );

            expect(commentThreads.length).toEqual(1);
            expect(commentThreads[0]).not.toBeNull();
        }

        {
            const commentThreads = await batchGetDocumentCommentThreadsIfExists(
                context.action(session1),
                {
                    documentId: document.id,
                    commentThreadIds: [generateId()],
                },
            );

            expect(commentThreads.length).toEqual(1);
            expect(commentThreads[0]).toBeNull();
        }

        {
            const commentThreads = await batchGetDocumentCommentThreadsIfExists(
                context.action(session1),
                {
                    documentId: document.id,
                    commentThreadIds: [commentThreadId1, commentThreadId2, generateId()],
                },
            );

            expect(commentThreads.length).toEqual(3);
            expect(commentThreads[0]).not.toBeNull();
            expect(commentThreads[1]).not.toBeNull();
            expect(commentThreads[2]).toBeNull();
        }

        {
            const commentThreads = await batchGetDocumentCommentThreadsIfExists(
                context.action(session1),
                {
                    documentId: document.id,
                    commentThreadIds: [commentThreadId1, commentThreadId2, generateId()],
                },
            );

            expect(commentThreads.length).toEqual(3);
            expect(commentThreads[0]).not.toBeNull();
            expect(commentThreads[1]).not.toBeNull();
            expect(commentThreads[2]).toBeNull();
        }
    });

    test("can not get comment threads for a document in another space", async () => {
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

        const commentThreadId1 = generateId<DocumentCommentThreadId>();
        const commentThreadId2 = generateId<DocumentCommentThreadId>();

        await updateDocumentContent(context.action(session1), {
            id: document.id,
            version: 1,
            steps: [
                new AddMarkStep(
                    10,
                    15,
                    schema.mark("comment", {commentThreadId: commentThreadId1}),
                ),
            ],
            clientId: generateId(),
            createCommentThreads: [
                {
                    commentThreadId: commentThreadId1,
                    initialCommentContent: createSimpleMessageContent("Test message content 1"),
                },
            ],
        });

        await updateDocumentContent(context.action(session1), {
            id: document.id,
            version: 2,
            steps: [
                new RemoveMarkStep(
                    10,
                    15,
                    schema.mark("comment", {commentThreadId: commentThreadId1}),
                ),
            ],
            clientId: generateId(),
        });

        await updateDocumentSnapshotForTest(context.action(session1), document.id);

        await updateDocumentContent(context.action(session1), {
            id: document.id,
            version: 3,
            steps: [
                new AddMarkStep(
                    10,
                    15,
                    schema.mark("comment", {commentThreadId: commentThreadId2}),
                ),
            ],
            clientId: generateId(),
            createCommentThreads: [
                {
                    commentThreadId: commentThreadId2,
                    initialCommentContent: createSimpleMessageContent("Test message content 2"),
                },
            ],
        });

        await expect(
            batchGetDocumentCommentThreadsIfExists(context.action(otherSession), {
                documentId: document.id,
                commentThreadIds: [],
            }),
        ).rejects.toThrow(PermissionDeniedError);

        await expect(
            batchGetDocumentCommentThreadsIfExists(context.action(otherSession), {
                documentId: document.id,
                commentThreadIds: [commentThreadId1],
            }),
        ).rejects.toThrow(PermissionDeniedError);

        await expect(
            batchGetDocumentCommentThreadsIfExists(context.action(otherSession), {
                documentId: document.id,
                commentThreadIds: [generateId()],
            }),
        ).rejects.toThrow(PermissionDeniedError);

        await expect(
            batchGetDocumentCommentThreadsIfExists(context.action(otherSession), {
                documentId: document.id,
                commentThreadIds: [commentThreadId1, commentThreadId2, generateId()],
            }),
        ).rejects.toThrow(PermissionDeniedError);
    });

    test("can not get comment threads for a document that doesn't exist", async () => {
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

        const commentThreadId1 = generateId<DocumentCommentThreadId>();
        const commentThreadId2 = generateId<DocumentCommentThreadId>();

        await updateDocumentContent(context.action(session1), {
            id: document.id,
            version: 1,
            steps: [
                new AddMarkStep(
                    10,
                    15,
                    schema.mark("comment", {commentThreadId: commentThreadId1}),
                ),
            ],
            clientId: generateId(),
            createCommentThreads: [
                {
                    commentThreadId: commentThreadId1,
                    initialCommentContent: createSimpleMessageContent("Test message content 1"),
                },
            ],
        });

        await updateDocumentContent(context.action(session1), {
            id: document.id,
            version: 2,
            steps: [
                new RemoveMarkStep(
                    10,
                    15,
                    schema.mark("comment", {commentThreadId: commentThreadId1}),
                ),
            ],
            clientId: generateId(),
        });

        await updateDocumentSnapshotForTest(context.action(session1), document.id);

        await updateDocumentContent(context.action(session1), {
            id: document.id,
            version: 3,
            steps: [
                new AddMarkStep(
                    10,
                    15,
                    schema.mark("comment", {commentThreadId: commentThreadId2}),
                ),
            ],
            clientId: generateId(),
            createCommentThreads: [
                {
                    commentThreadId: commentThreadId2,
                    initialCommentContent: createSimpleMessageContent("Test message content 2"),
                },
            ],
        });

        await expect(
            batchGetDocumentCommentThreadsIfExists(context.action(otherSession), {
                documentId: generateId(),
                commentThreadIds: [],
            }),
        ).rejects.toThrow(NotFoundError);

        await expect(
            batchGetDocumentCommentThreadsIfExists(context.action(otherSession), {
                documentId: generateId(),
                commentThreadIds: [commentThreadId1],
            }),
        ).rejects.toThrow(NotFoundError);

        await expect(
            batchGetDocumentCommentThreadsIfExists(context.action(otherSession), {
                documentId: generateId(),
                commentThreadIds: [generateId()],
            }),
        ).rejects.toThrow(NotFoundError);

        await expect(
            batchGetDocumentCommentThreadsIfExists(context.action(otherSession), {
                documentId: generateId(),
                commentThreadIds: [commentThreadId1, commentThreadId2, generateId()],
            }),
        ).rejects.toThrow(NotFoundError);
    });

    describe("Notification subscribers", () => {
        test("throws when trying to access a comment thread that doesn't exist", async () => {
            await expect(
                getDocumentCommentThreadNotificationSubscribers(context.action(session1), {
                    documentId: generateId(),
                    commentThreadId: generateId(),
                    isFirstComment: true,
                }),
            ).rejects.toThrow(NotFoundError);

            await expect(
                getDocumentCommentThreadNotificationSubscribers(context.action(session1), {
                    documentId: generateId(),
                    commentThreadId: generateId(),
                    isFirstComment: false,
                }),
            ).rejects.toThrow(NotFoundError);

            const document = await createDocument(context.action(session1), {
                spaceId: space.id,
                content: emptyDocumentContent,
            });

            await expect(
                getDocumentCommentThreadNotificationSubscribers(context.action(session1), {
                    documentId: document.id,
                    commentThreadId: generateId(),
                    isFirstComment: true,
                }),
            ).rejects.toThrow(NotFoundError);

            await expect(
                getDocumentCommentThreadNotificationSubscribers(context.action(session1), {
                    documentId: document.id,
                    commentThreadId: generateId(),
                    isFirstComment: false,
                }),
            ).rejects.toThrow(NotFoundError);
        });

        test("throws when trying to access a comment thread in a different space", async () => {
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

            await updateDocumentContent(context.action(session2), {
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

            await expect(
                getDocumentCommentThreadNotificationSubscribers(context.action(otherSession), {
                    documentId: document.id,
                    commentThreadId,
                    isFirstComment: true,
                }),
            ).rejects.toThrow(PermissionDeniedError);

            await expect(
                getDocumentCommentThreadNotificationSubscribers(context.action(otherSession), {
                    documentId: document.id,
                    commentThreadId,
                    isFirstComment: false,
                }),
            ).rejects.toThrow(PermissionDeniedError);
        });

        test("the document owner is a subscriber for the first comment on their document", async () => {
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

            await updateDocumentContent(context.action(session2), {
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

            expect(
                await getDocumentCommentThreadNotificationSubscribers(context.action(session1), {
                    documentId: document.id,
                    commentThreadId,
                    isFirstComment: true,
                }).then(({accounts}) => accounts),
            ).toEqual([session1.account, session2.account]);

            expect(
                await getDocumentCommentThreadNotificationSubscribers(context.action(session1), {
                    documentId: document.id,
                    commentThreadId,
                    isFirstComment: false,
                }).then(({accounts}) => accounts),
            ).toEqual([session2.account]);

            expect(
                await getDocumentCommentThreadNotificationSubscribers(context.action(session2), {
                    documentId: document.id,
                    commentThreadId,
                    isFirstComment: true,
                }).then(({accounts}) => accounts),
            ).toEqual([session1.account, session2.account]);

            expect(
                await getDocumentCommentThreadNotificationSubscribers(context.action(session2), {
                    documentId: document.id,
                    commentThreadId,
                    isFirstComment: false,
                }).then(({accounts}) => accounts),
            ).toEqual([session2.account]);
        });

        test("an account that comments on a comment thread is subscribed to notifications", async () => {
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

            await updateDocumentContent(context.action(session2), {
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

            expect(
                await getDocumentCommentThreadNotificationSubscribers(context.action(session1), {
                    documentId: document.id,
                    commentThreadId,
                    isFirstComment: true,
                }).then(({accounts}) => accounts),
            ).toEqual([session1.account, session2.account]);

            expect(
                await getDocumentCommentThreadNotificationSubscribers(context.action(session1), {
                    documentId: document.id,
                    commentThreadId,
                    isFirstComment: false,
                }).then(({accounts}) => accounts),
            ).toEqual([session2.account]);

            expect(
                await getDocumentCommentThreadNotificationSubscribers(context.action(session4), {
                    documentId: document.id,
                    commentThreadId,
                    isFirstComment: true,
                }).then(({accounts}) => accounts),
            ).toEqual([session1.account, session2.account]);

            expect(
                await getDocumentCommentThreadNotificationSubscribers(context.action(session4), {
                    documentId: document.id,
                    commentThreadId,
                    isFirstComment: false,
                }).then(({accounts}) => accounts),
            ).toEqual([session2.account]);

            await createDocumentComment(context.action(session3), {
                documentId: document.id,
                commentThreadId,
                parentCommentIndex: null,
                content: createSimpleMessageContent("Test message content 2"),
            });

            expect(
                await getDocumentCommentThreadNotificationSubscribers(context.action(session1), {
                    documentId: document.id,
                    commentThreadId,
                    isFirstComment: true,
                }).then(({accounts}) => accounts),
            ).toEqual([session1.account, session2.account, session3.account]);

            expect(
                await getDocumentCommentThreadNotificationSubscribers(context.action(session1), {
                    documentId: document.id,
                    commentThreadId,
                    isFirstComment: false,
                }).then(({accounts}) => accounts),
            ).toEqual([session2.account, session3.account]);

            expect(
                await getDocumentCommentThreadNotificationSubscribers(context.action(session4), {
                    documentId: document.id,
                    commentThreadId,
                    isFirstComment: true,
                }).then(({accounts}) => accounts),
            ).toEqual([session1.account, session2.account, session3.account]);

            expect(
                await getDocumentCommentThreadNotificationSubscribers(context.action(session4), {
                    documentId: document.id,
                    commentThreadId,
                    isFirstComment: false,
                }).then(({accounts}) => accounts),
            ).toEqual([session2.account, session3.account]);

            await createDocumentComment(context.action(session4), {
                documentId: document.id,
                commentThreadId,
                parentCommentIndex: null,
                content: createSimpleMessageContent("Test message content 3"),
            });

            expect(
                await getDocumentCommentThreadNotificationSubscribers(context.action(session1), {
                    documentId: document.id,
                    commentThreadId,
                    isFirstComment: true,
                }).then(({accounts}) => accounts),
            ).toEqual([session1.account, session2.account, session3.account, session4.account]);

            expect(
                await getDocumentCommentThreadNotificationSubscribers(context.action(session1), {
                    documentId: document.id,
                    commentThreadId,
                    isFirstComment: false,
                }).then(({accounts}) => accounts),
            ).toEqual([session2.account, session3.account, session4.account]);

            expect(
                await getDocumentCommentThreadNotificationSubscribers(context.action(session4), {
                    documentId: document.id,
                    commentThreadId,
                    isFirstComment: true,
                }).then(({accounts}) => accounts),
            ).toEqual([session1.account, session2.account, session3.account, session4.account]);

            expect(
                await getDocumentCommentThreadNotificationSubscribers(context.action(session4), {
                    documentId: document.id,
                    commentThreadId,
                    isFirstComment: false,
                }).then(({accounts}) => accounts),
            ).toEqual([session2.account, session3.account, session4.account]);

            await createDocumentComment(context.action(session2), {
                documentId: document.id,
                commentThreadId,
                parentCommentIndex: null,
                content: createSimpleMessageContent("Test message content 4"),
            });

            expect(
                await getDocumentCommentThreadNotificationSubscribers(context.action(session1), {
                    documentId: document.id,
                    commentThreadId,
                    isFirstComment: true,
                }).then(({accounts}) => accounts),
            ).toEqual([session1.account, session2.account, session3.account, session4.account]);

            expect(
                await getDocumentCommentThreadNotificationSubscribers(context.action(session1), {
                    documentId: document.id,
                    commentThreadId,
                    isFirstComment: false,
                }).then(({accounts}) => accounts),
            ).toEqual([session2.account, session3.account, session4.account]);

            expect(
                await getDocumentCommentThreadNotificationSubscribers(context.action(session4), {
                    documentId: document.id,
                    commentThreadId,
                    isFirstComment: true,
                }).then(({accounts}) => accounts),
            ).toEqual([session1.account, session2.account, session3.account, session4.account]);

            expect(
                await getDocumentCommentThreadNotificationSubscribers(context.action(session4), {
                    documentId: document.id,
                    commentThreadId,
                    isFirstComment: false,
                }).then(({accounts}) => accounts),
            ).toEqual([session2.account, session3.account, session4.account]);
        });

        test("an account that comments on a comment thread is subscribed to notifications even if the comment is deleted", async () => {
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

            await updateDocumentContent(context.action(session2), {
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

            expect(
                await getDocumentCommentThreadNotificationSubscribers(context.action(session1), {
                    documentId: document.id,
                    commentThreadId,
                    isFirstComment: true,
                }).then(({accounts}) => accounts),
            ).toEqual([session1.account, session2.account]);

            expect(
                await getDocumentCommentThreadNotificationSubscribers(context.action(session1), {
                    documentId: document.id,
                    commentThreadId,
                    isFirstComment: false,
                }).then(({accounts}) => accounts),
            ).toEqual([session2.account]);

            expect(
                await getDocumentCommentThreadNotificationSubscribers(context.action(session4), {
                    documentId: document.id,
                    commentThreadId,
                    isFirstComment: true,
                }).then(({accounts}) => accounts),
            ).toEqual([session1.account, session2.account]);

            expect(
                await getDocumentCommentThreadNotificationSubscribers(context.action(session4), {
                    documentId: document.id,
                    commentThreadId,
                    isFirstComment: false,
                }).then(({accounts}) => accounts),
            ).toEqual([session2.account]);

            await createDocumentComment(context.action(session3), {
                documentId: document.id,
                commentThreadId,
                parentCommentIndex: null,
                content: createSimpleMessageContent("Test message content 2"),
            });

            expect(
                await getDocumentCommentThreadNotificationSubscribers(context.action(session1), {
                    documentId: document.id,
                    commentThreadId,
                    isFirstComment: true,
                }).then(({accounts}) => accounts),
            ).toEqual([session1.account, session2.account, session3.account]);

            expect(
                await getDocumentCommentThreadNotificationSubscribers(context.action(session1), {
                    documentId: document.id,
                    commentThreadId,
                    isFirstComment: false,
                }).then(({accounts}) => accounts),
            ).toEqual([session2.account, session3.account]);

            expect(
                await getDocumentCommentThreadNotificationSubscribers(context.action(session4), {
                    documentId: document.id,
                    commentThreadId,
                    isFirstComment: true,
                }).then(({accounts}) => accounts),
            ).toEqual([session1.account, session2.account, session3.account]);

            expect(
                await getDocumentCommentThreadNotificationSubscribers(context.action(session4), {
                    documentId: document.id,
                    commentThreadId,
                    isFirstComment: false,
                }).then(({accounts}) => accounts),
            ).toEqual([session2.account, session3.account]);

            await deleteDocumentComment(context.action(session3), {
                documentId: document.id,
                commentThreadId,
                commentIndex: 1,
            });

            expect(
                await getDocumentCommentThreadNotificationSubscribers(context.action(session1), {
                    documentId: document.id,
                    commentThreadId,
                    isFirstComment: true,
                }).then(({accounts}) => accounts),
            ).toEqual([session1.account, session2.account, session3.account]);

            expect(
                await getDocumentCommentThreadNotificationSubscribers(context.action(session1), {
                    documentId: document.id,
                    commentThreadId,
                    isFirstComment: false,
                }).then(({accounts}) => accounts),
            ).toEqual([session2.account, session3.account]);

            expect(
                await getDocumentCommentThreadNotificationSubscribers(context.action(session4), {
                    documentId: document.id,
                    commentThreadId,
                    isFirstComment: true,
                }).then(({accounts}) => accounts),
            ).toEqual([session1.account, session2.account, session3.account]);

            expect(
                await getDocumentCommentThreadNotificationSubscribers(context.action(session4), {
                    documentId: document.id,
                    commentThreadId,
                    isFirstComment: false,
                }).then(({accounts}) => accounts),
            ).toEqual([session2.account, session3.account]);
        });

        test("an account that is mentioned in a comment thread is subscribed to notifications", async () => {
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

            expect(
                await getDocumentCommentThreadNotificationSubscribers(context.action(session1), {
                    documentId: document.id,
                    commentThreadId,
                    isFirstComment: true,
                }).then(({accounts}) => accounts),
            ).toEqual([session1.account]);

            expect(
                await getDocumentCommentThreadNotificationSubscribers(context.action(session1), {
                    documentId: document.id,
                    commentThreadId,
                    isFirstComment: false,
                }).then(({accounts}) => accounts),
            ).toEqual([session1.account]);

            expect(
                await getDocumentCommentThreadNotificationSubscribers(context.action(session4), {
                    documentId: document.id,
                    commentThreadId,
                    isFirstComment: true,
                }).then(({accounts}) => accounts),
            ).toEqual([session1.account]);

            expect(
                await getDocumentCommentThreadNotificationSubscribers(context.action(session4), {
                    documentId: document.id,
                    commentThreadId,
                    isFirstComment: false,
                }).then(({accounts}) => accounts),
            ).toEqual([session1.account]);

            await createDocumentComment(context.action(session3), {
                documentId: document.id,
                commentThreadId,
                parentCommentIndex: null,
                content: assertMessageContent(
                    MessageContentProsemirrorSchema.node("doc", {}, [
                        MessageContentProsemirrorSchema.node("paragraph", {}, [
                            MessageContentProsemirrorSchema.text("Hello, "),
                            MessageContentProsemirrorSchema.node("mention", {
                                mention: {accountId: session4.accountId},
                            }),
                            MessageContentProsemirrorSchema.text("!"),
                        ]),
                    ]),
                ),
            });

            expect(
                await getDocumentCommentThreadNotificationSubscribers(context.action(session1), {
                    documentId: document.id,
                    commentThreadId,
                    isFirstComment: false,
                }).then(({accounts}) => accounts),
            ).toEqual([session1.account, session3.account, session4.account]);

            expect(
                await getDocumentCommentThreadNotificationSubscribers(context.action(session2), {
                    documentId: document.id,
                    commentThreadId,
                    isFirstComment: false,
                }).then(({accounts}) => accounts),
            ).toEqual([session1.account, session3.account, session4.account]);

            expect(
                await getDocumentCommentThreadNotificationSubscribers(context.action(session3), {
                    documentId: document.id,
                    commentThreadId,
                    isFirstComment: false,
                }).then(({accounts}) => accounts),
            ).toEqual([session1.account, session3.account, session4.account]);
        });

        test("an unknown account that is mentioned in a comment thread is not subscribed to notifications", async () => {
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

            expect(
                await getDocumentCommentThreadNotificationSubscribers(context.action(session1), {
                    documentId: document.id,
                    commentThreadId,
                    isFirstComment: true,
                }).then(({accounts}) => accounts),
            ).toEqual([session1.account]);

            expect(
                await getDocumentCommentThreadNotificationSubscribers(context.action(session1), {
                    documentId: document.id,
                    commentThreadId,
                    isFirstComment: false,
                }).then(({accounts}) => accounts),
            ).toEqual([session1.account]);

            expect(
                await getDocumentCommentThreadNotificationSubscribers(context.action(session4), {
                    documentId: document.id,
                    commentThreadId,
                    isFirstComment: true,
                }).then(({accounts}) => accounts),
            ).toEqual([session1.account]);

            expect(
                await getDocumentCommentThreadNotificationSubscribers(context.action(session4), {
                    documentId: document.id,
                    commentThreadId,
                    isFirstComment: false,
                }).then(({accounts}) => accounts),
            ).toEqual([session1.account]);

            await createDocumentComment(context.action(session3), {
                documentId: document.id,
                commentThreadId,
                parentCommentIndex: null,
                content: assertMessageContent(
                    MessageContentProsemirrorSchema.node("doc", {}, [
                        MessageContentProsemirrorSchema.node("paragraph", {}, [
                            MessageContentProsemirrorSchema.text("Hello, "),
                            MessageContentProsemirrorSchema.node("mention", {
                                mention: {accountId: generateId()},
                            }),
                            MessageContentProsemirrorSchema.text("!"),
                        ]),
                    ]),
                ),
            });

            expect(
                await getDocumentCommentThreadNotificationSubscribers(context.action(session1), {
                    documentId: document.id,
                    commentThreadId,
                    isFirstComment: false,
                }).then(({accounts}) => accounts),
            ).toEqual([session1.account, session3.account]);

            expect(
                await getDocumentCommentThreadNotificationSubscribers(context.action(session2), {
                    documentId: document.id,
                    commentThreadId,
                    isFirstComment: false,
                }).then(({accounts}) => accounts),
            ).toEqual([session1.account, session3.account]);

            expect(
                await getDocumentCommentThreadNotificationSubscribers(context.action(session3), {
                    documentId: document.id,
                    commentThreadId,
                    isFirstComment: false,
                }).then(({accounts}) => accounts),
            ).toEqual([session1.account, session3.account]);
        });

        test("a mentioned account from another space in a comment thread is not subscribed to notifications", async () => {
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

            expect(
                await getDocumentCommentThreadNotificationSubscribers(context.action(session1), {
                    documentId: document.id,
                    commentThreadId,
                    isFirstComment: true,
                }).then(({accounts}) => accounts),
            ).toEqual([session1.account]);

            expect(
                await getDocumentCommentThreadNotificationSubscribers(context.action(session1), {
                    documentId: document.id,
                    commentThreadId,
                    isFirstComment: false,
                }).then(({accounts}) => accounts),
            ).toEqual([session1.account]);

            expect(
                await getDocumentCommentThreadNotificationSubscribers(context.action(session4), {
                    documentId: document.id,
                    commentThreadId,
                    isFirstComment: true,
                }).then(({accounts}) => accounts),
            ).toEqual([session1.account]);

            expect(
                await getDocumentCommentThreadNotificationSubscribers(context.action(session4), {
                    documentId: document.id,
                    commentThreadId,
                    isFirstComment: false,
                }).then(({accounts}) => accounts),
            ).toEqual([session1.account]);

            await createDocumentComment(context.action(session3), {
                documentId: document.id,
                commentThreadId,
                parentCommentIndex: null,
                content: assertMessageContent(
                    MessageContentProsemirrorSchema.node("doc", {}, [
                        MessageContentProsemirrorSchema.node("paragraph", {}, [
                            MessageContentProsemirrorSchema.text("Hello, "),
                            MessageContentProsemirrorSchema.node("mention", {
                                mention: {accountId: otherSession.accountId},
                            }),
                            MessageContentProsemirrorSchema.text("!"),
                        ]),
                    ]),
                ),
            });

            expect(
                await getDocumentCommentThreadNotificationSubscribers(context.action(session1), {
                    documentId: document.id,
                    commentThreadId,
                    isFirstComment: false,
                }).then(({accounts}) => accounts),
            ).toEqual([session1.account, session3.account]);

            expect(
                await getDocumentCommentThreadNotificationSubscribers(context.action(session2), {
                    documentId: document.id,
                    commentThreadId,
                    isFirstComment: false,
                }).then(({accounts}) => accounts),
            ).toEqual([session1.account, session3.account]);

            expect(
                await getDocumentCommentThreadNotificationSubscribers(context.action(session3), {
                    documentId: document.id,
                    commentThreadId,
                    isFirstComment: false,
                }).then(({accounts}) => accounts),
            ).toEqual([session1.account, session3.account]);
        });

        test("an account that is mentioned in a comment thread is subscribed to notifications even if the message is updated to remove the mention", async () => {
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

            expect(
                await getDocumentCommentThreadNotificationSubscribers(context.action(session1), {
                    documentId: document.id,
                    commentThreadId,
                    isFirstComment: true,
                }).then(({accounts}) => accounts),
            ).toEqual([session1.account]);

            expect(
                await getDocumentCommentThreadNotificationSubscribers(context.action(session1), {
                    documentId: document.id,
                    commentThreadId,
                    isFirstComment: false,
                }).then(({accounts}) => accounts),
            ).toEqual([session1.account]);

            expect(
                await getDocumentCommentThreadNotificationSubscribers(context.action(session4), {
                    documentId: document.id,
                    commentThreadId,
                    isFirstComment: true,
                }).then(({accounts}) => accounts),
            ).toEqual([session1.account]);

            expect(
                await getDocumentCommentThreadNotificationSubscribers(context.action(session4), {
                    documentId: document.id,
                    commentThreadId,
                    isFirstComment: false,
                }).then(({accounts}) => accounts),
            ).toEqual([session1.account]);

            await createDocumentComment(context.action(session3), {
                documentId: document.id,
                commentThreadId,
                parentCommentIndex: null,
                content: assertMessageContent(
                    MessageContentProsemirrorSchema.node("doc", {}, [
                        MessageContentProsemirrorSchema.node("paragraph", {}, [
                            MessageContentProsemirrorSchema.text("Hello, "),
                            MessageContentProsemirrorSchema.node("mention", {
                                mention: {accountId: session4.accountId},
                            }),
                            MessageContentProsemirrorSchema.text("!"),
                        ]),
                    ]),
                ),
            });

            expect(
                await getDocumentCommentThreadNotificationSubscribers(context.action(session1), {
                    documentId: document.id,
                    commentThreadId,
                    isFirstComment: false,
                }).then(({accounts}) => accounts),
            ).toEqual([session1.account, session3.account, session4.account]);

            expect(
                await getDocumentCommentThreadNotificationSubscribers(context.action(session2), {
                    documentId: document.id,
                    commentThreadId,
                    isFirstComment: false,
                }).then(({accounts}) => accounts),
            ).toEqual([session1.account, session3.account, session4.account]);

            expect(
                await getDocumentCommentThreadNotificationSubscribers(context.action(session3), {
                    documentId: document.id,
                    commentThreadId,
                    isFirstComment: false,
                }).then(({accounts}) => accounts),
            ).toEqual([session1.account, session3.account, session4.account]);

            await updateDocumentCommentContent(context.action(session3), {
                documentId: document.id,
                commentThreadId,
                commentIndex: 1,
                content: assertMessageContent(
                    MessageContentProsemirrorSchema.node("doc", {}, [
                        MessageContentProsemirrorSchema.node("paragraph", {}, [
                            MessageContentProsemirrorSchema.text("Hello, world!"),
                        ]),
                    ]),
                ),
            });

            expect(
                await getDocumentCommentThreadNotificationSubscribers(context.action(session1), {
                    documentId: document.id,
                    commentThreadId,
                    isFirstComment: false,
                }).then(({accounts}) => accounts),
            ).toEqual([session1.account, session3.account, session4.account]);

            expect(
                await getDocumentCommentThreadNotificationSubscribers(context.action(session2), {
                    documentId: document.id,
                    commentThreadId,
                    isFirstComment: false,
                }).then(({accounts}) => accounts),
            ).toEqual([session1.account, session3.account, session4.account]);

            expect(
                await getDocumentCommentThreadNotificationSubscribers(context.action(session3), {
                    documentId: document.id,
                    commentThreadId,
                    isFirstComment: false,
                }).then(({accounts}) => accounts),
            ).toEqual([session1.account, session3.account, session4.account]);
        });

        test("an account that is mentioned in a comment thread is subscribed to notifications even if the message is deleted", async () => {
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

            expect(
                await getDocumentCommentThreadNotificationSubscribers(context.action(session1), {
                    documentId: document.id,
                    commentThreadId,
                    isFirstComment: true,
                }).then(({accounts}) => accounts),
            ).toEqual([session1.account]);

            expect(
                await getDocumentCommentThreadNotificationSubscribers(context.action(session1), {
                    documentId: document.id,
                    commentThreadId,
                    isFirstComment: false,
                }).then(({accounts}) => accounts),
            ).toEqual([session1.account]);

            expect(
                await getDocumentCommentThreadNotificationSubscribers(context.action(session4), {
                    documentId: document.id,
                    commentThreadId,
                    isFirstComment: true,
                }).then(({accounts}) => accounts),
            ).toEqual([session1.account]);

            expect(
                await getDocumentCommentThreadNotificationSubscribers(context.action(session4), {
                    documentId: document.id,
                    commentThreadId,
                    isFirstComment: false,
                }).then(({accounts}) => accounts),
            ).toEqual([session1.account]);

            await createDocumentComment(context.action(session3), {
                documentId: document.id,
                commentThreadId,
                parentCommentIndex: null,
                content: assertMessageContent(
                    MessageContentProsemirrorSchema.node("doc", {}, [
                        MessageContentProsemirrorSchema.node("paragraph", {}, [
                            MessageContentProsemirrorSchema.text("Hello, "),
                            MessageContentProsemirrorSchema.node("mention", {
                                mention: {accountId: session4.accountId},
                            }),
                            MessageContentProsemirrorSchema.text("!"),
                        ]),
                    ]),
                ),
            });

            expect(
                await getDocumentCommentThreadNotificationSubscribers(context.action(session1), {
                    documentId: document.id,
                    commentThreadId,
                    isFirstComment: false,
                }).then(({accounts}) => accounts),
            ).toEqual([session1.account, session3.account, session4.account]);

            expect(
                await getDocumentCommentThreadNotificationSubscribers(context.action(session2), {
                    documentId: document.id,
                    commentThreadId,
                    isFirstComment: false,
                }).then(({accounts}) => accounts),
            ).toEqual([session1.account, session3.account, session4.account]);

            expect(
                await getDocumentCommentThreadNotificationSubscribers(context.action(session3), {
                    documentId: document.id,
                    commentThreadId,
                    isFirstComment: false,
                }).then(({accounts}) => accounts),
            ).toEqual([session1.account, session3.account, session4.account]);

            await deleteDocumentComment(context.action(session3), {
                documentId: document.id,
                commentThreadId,
                commentIndex: 1,
            });

            expect(
                await getDocumentCommentThreadNotificationSubscribers(context.action(session1), {
                    documentId: document.id,
                    commentThreadId,
                    isFirstComment: false,
                }).then(({accounts}) => accounts),
            ).toEqual([session1.account, session3.account, session4.account]);

            expect(
                await getDocumentCommentThreadNotificationSubscribers(context.action(session2), {
                    documentId: document.id,
                    commentThreadId,
                    isFirstComment: false,
                }).then(({accounts}) => accounts),
            ).toEqual([session1.account, session3.account, session4.account]);

            expect(
                await getDocumentCommentThreadNotificationSubscribers(context.action(session3), {
                    documentId: document.id,
                    commentThreadId,
                    isFirstComment: false,
                }).then(({accounts}) => accounts),
            ).toEqual([session1.account, session3.account, session4.account]);
        });

        test("an account that is mentioned in a comment thread after it is updated is subscribed to notifications", async () => {
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

            expect(
                await getDocumentCommentThreadNotificationSubscribers(context.action(session1), {
                    documentId: document.id,
                    commentThreadId,
                    isFirstComment: true,
                }).then(({accounts}) => accounts),
            ).toEqual([session1.account]);

            expect(
                await getDocumentCommentThreadNotificationSubscribers(context.action(session1), {
                    documentId: document.id,
                    commentThreadId,
                    isFirstComment: false,
                }).then(({accounts}) => accounts),
            ).toEqual([session1.account]);

            expect(
                await getDocumentCommentThreadNotificationSubscribers(context.action(session4), {
                    documentId: document.id,
                    commentThreadId,
                    isFirstComment: true,
                }).then(({accounts}) => accounts),
            ).toEqual([session1.account]);

            expect(
                await getDocumentCommentThreadNotificationSubscribers(context.action(session4), {
                    documentId: document.id,
                    commentThreadId,
                    isFirstComment: false,
                }).then(({accounts}) => accounts),
            ).toEqual([session1.account]);

            await createDocumentComment(context.action(session3), {
                documentId: document.id,
                commentThreadId,
                parentCommentIndex: null,
                content: assertMessageContent(
                    MessageContentProsemirrorSchema.node("doc", {}, [
                        MessageContentProsemirrorSchema.node("paragraph", {}, [
                            MessageContentProsemirrorSchema.text("Hello, world!"),
                        ]),
                    ]),
                ),
            });

            expect(
                await getDocumentCommentThreadNotificationSubscribers(context.action(session1), {
                    documentId: document.id,
                    commentThreadId,
                    isFirstComment: false,
                }).then(({accounts}) => accounts),
            ).toEqual([session1.account, session3.account]);

            expect(
                await getDocumentCommentThreadNotificationSubscribers(context.action(session2), {
                    documentId: document.id,
                    commentThreadId,
                    isFirstComment: false,
                }).then(({accounts}) => accounts),
            ).toEqual([session1.account, session3.account]);

            expect(
                await getDocumentCommentThreadNotificationSubscribers(context.action(session3), {
                    documentId: document.id,
                    commentThreadId,
                    isFirstComment: false,
                }).then(({accounts}) => accounts),
            ).toEqual([session1.account, session3.account]);

            await updateDocumentCommentContent(context.action(session3), {
                documentId: document.id,
                commentThreadId,
                commentIndex: 1,
                content: assertMessageContent(
                    MessageContentProsemirrorSchema.node("doc", {}, [
                        MessageContentProsemirrorSchema.node("paragraph", {}, [
                            MessageContentProsemirrorSchema.text("Hello, "),
                            MessageContentProsemirrorSchema.node("mention", {
                                mention: {accountId: session4.accountId},
                            }),
                            MessageContentProsemirrorSchema.text("!"),
                        ]),
                    ]),
                ),
            });

            expect(
                await getDocumentCommentThreadNotificationSubscribers(context.action(session1), {
                    documentId: document.id,
                    commentThreadId,
                    isFirstComment: false,
                }).then(({accounts}) => accounts),
            ).toEqual([session1.account, session3.account, session4.account]);

            expect(
                await getDocumentCommentThreadNotificationSubscribers(context.action(session2), {
                    documentId: document.id,
                    commentThreadId,
                    isFirstComment: false,
                }).then(({accounts}) => accounts),
            ).toEqual([session1.account, session3.account, session4.account]);

            expect(
                await getDocumentCommentThreadNotificationSubscribers(context.action(session3), {
                    documentId: document.id,
                    commentThreadId,
                    isFirstComment: false,
                }).then(({accounts}) => accounts),
            ).toEqual([session1.account, session3.account, session4.account]);
        });

        test("notification subscribers are not duplicated and can be added from many different sources", async () => {
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

            await updateDocumentContent(context.action(session5), {
                id: document.id,
                version: 1,
                steps: [new AddMarkStep(10, 15, schema.mark("comment", {commentThreadId}))],
                clientId: generateId(),
                createCommentThreads: [
                    {
                        commentThreadId,
                        initialCommentContent: assertMessageContent(
                            MessageContentProsemirrorSchema.node("doc", {}, [
                                MessageContentProsemirrorSchema.node("paragraph", {}, [
                                    MessageContentProsemirrorSchema.text("Hello, "),
                                    MessageContentProsemirrorSchema.node("mention", {
                                        mention: {accountId: session2.accountId},
                                    }),
                                    MessageContentProsemirrorSchema.text("!"),
                                ]),
                            ]),
                        ),
                    },
                ],
            });

            expect(
                await getDocumentCommentThreadNotificationSubscribers(context.action(session1), {
                    documentId: document.id,
                    commentThreadId,
                    isFirstComment: true,
                }).then(({accounts}) => accounts),
            ).toEqual([session1.account, session5.account, session2.account]);

            expect(
                await getDocumentCommentThreadNotificationSubscribers(context.action(session1), {
                    documentId: document.id,
                    commentThreadId,
                    isFirstComment: false,
                }).then(({accounts}) => accounts),
            ).toEqual([session5.account, session2.account]);

            expect(
                await getDocumentCommentThreadNotificationSubscribers(context.action(session7), {
                    documentId: document.id,
                    commentThreadId,
                    isFirstComment: true,
                }).then(({accounts}) => accounts),
            ).toEqual([session1.account, session5.account, session2.account]);

            expect(
                await getDocumentCommentThreadNotificationSubscribers(context.action(session7), {
                    documentId: document.id,
                    commentThreadId,
                    isFirstComment: false,
                }).then(({accounts}) => accounts),
            ).toEqual([session5.account, session2.account]);

            await createDocumentComment(context.action(session1), {
                documentId: document.id,
                commentThreadId,
                parentCommentIndex: null,
                content: assertMessageContent(
                    MessageContentProsemirrorSchema.node("doc", {}, [
                        MessageContentProsemirrorSchema.node("paragraph", {}, [
                            MessageContentProsemirrorSchema.text("Hello, world!"),
                        ]),
                    ]),
                ),
            });

            expect(
                await getDocumentCommentThreadNotificationSubscribers(context.action(session1), {
                    documentId: document.id,
                    commentThreadId,
                    isFirstComment: true,
                }).then(({accounts}) => accounts),
            ).toEqual([session1.account, session5.account, session2.account]);

            expect(
                await getDocumentCommentThreadNotificationSubscribers(context.action(session1), {
                    documentId: document.id,
                    commentThreadId,
                    isFirstComment: false,
                }).then(({accounts}) => accounts),
            ).toEqual([session5.account, session1.account, session2.account]);

            expect(
                await getDocumentCommentThreadNotificationSubscribers(context.action(session7), {
                    documentId: document.id,
                    commentThreadId,
                    isFirstComment: true,
                }).then(({accounts}) => accounts),
            ).toEqual([session1.account, session5.account, session2.account]);

            expect(
                await getDocumentCommentThreadNotificationSubscribers(context.action(session7), {
                    documentId: document.id,
                    commentThreadId,
                    isFirstComment: false,
                }).then(({accounts}) => accounts),
            ).toEqual([session5.account, session1.account, session2.account]);

            await createDocumentComment(context.action(session3), {
                documentId: document.id,
                commentThreadId,
                parentCommentIndex: null,
                content: assertMessageContent(
                    MessageContentProsemirrorSchema.node("doc", {}, [
                        MessageContentProsemirrorSchema.node("paragraph", {}, [
                            MessageContentProsemirrorSchema.text("Hello, "),
                            MessageContentProsemirrorSchema.node("mention", {
                                mention: {accountId: session1.accountId},
                            }),
                            MessageContentProsemirrorSchema.text("!"),
                        ]),
                    ]),
                ),
            });

            expect(
                await getDocumentCommentThreadNotificationSubscribers(context.action(session1), {
                    documentId: document.id,
                    commentThreadId,
                    isFirstComment: true,
                }).then(({accounts}) => accounts),
            ).toEqual([session1.account, session5.account, session3.account, session2.account]);

            expect(
                await getDocumentCommentThreadNotificationSubscribers(context.action(session1), {
                    documentId: document.id,
                    commentThreadId,
                    isFirstComment: false,
                }).then(({accounts}) => accounts),
            ).toEqual([session5.account, session1.account, session3.account, session2.account]);

            expect(
                await getDocumentCommentThreadNotificationSubscribers(context.action(session7), {
                    documentId: document.id,
                    commentThreadId,
                    isFirstComment: true,
                }).then(({accounts}) => accounts),
            ).toEqual([session1.account, session5.account, session3.account, session2.account]);

            expect(
                await getDocumentCommentThreadNotificationSubscribers(context.action(session7), {
                    documentId: document.id,
                    commentThreadId,
                    isFirstComment: false,
                }).then(({accounts}) => accounts),
            ).toEqual([session5.account, session1.account, session3.account, session2.account]);

            const comment = await createDocumentComment(context.action(session2), {
                documentId: document.id,
                commentThreadId,
                parentCommentIndex: null,
                content: assertMessageContent(
                    MessageContentProsemirrorSchema.node("doc", {}, [
                        MessageContentProsemirrorSchema.node("paragraph", {}, [
                            MessageContentProsemirrorSchema.text("Hello, "),
                            MessageContentProsemirrorSchema.node("mention", {
                                mention: {accountId: session4.accountId},
                            }),
                            MessageContentProsemirrorSchema.text("!"),
                        ]),
                    ]),
                ),
            });

            expect(
                await getDocumentCommentThreadNotificationSubscribers(context.action(session1), {
                    documentId: document.id,
                    commentThreadId,
                    isFirstComment: true,
                }).then(({accounts}) => accounts),
            ).toEqual([
                session1.account,
                session5.account,
                session3.account,
                session2.account,
                session4.account,
            ]);

            expect(
                await getDocumentCommentThreadNotificationSubscribers(context.action(session1), {
                    documentId: document.id,
                    commentThreadId,
                    isFirstComment: false,
                }).then(({accounts}) => accounts),
            ).toEqual([
                session5.account,
                session1.account,
                session3.account,
                session2.account,
                session4.account,
            ]);

            expect(
                await getDocumentCommentThreadNotificationSubscribers(context.action(session7), {
                    documentId: document.id,
                    commentThreadId,
                    isFirstComment: true,
                }).then(({accounts}) => accounts),
            ).toEqual([
                session1.account,
                session5.account,
                session3.account,
                session2.account,
                session4.account,
            ]);

            expect(
                await getDocumentCommentThreadNotificationSubscribers(context.action(session7), {
                    documentId: document.id,
                    commentThreadId,
                    isFirstComment: false,
                }).then(({accounts}) => accounts),
            ).toEqual([
                session5.account,
                session1.account,
                session3.account,
                session2.account,
                session4.account,
            ]);

            await updateDocumentCommentContent(context.action(session2), {
                documentId: document.id,
                commentThreadId,
                commentIndex: comment.index,
                content: assertMessageContent(
                    MessageContentProsemirrorSchema.node("doc", {}, [
                        MessageContentProsemirrorSchema.node("paragraph", {}, [
                            MessageContentProsemirrorSchema.text("Hello, "),
                            MessageContentProsemirrorSchema.node("mention", {
                                mention: {accountId: session6.accountId},
                            }),
                            MessageContentProsemirrorSchema.text("!"),
                        ]),
                    ]),
                ),
            });

            expect(
                await getDocumentCommentThreadNotificationSubscribers(context.action(session1), {
                    documentId: document.id,
                    commentThreadId,
                    isFirstComment: true,
                }).then(({accounts}) => accounts),
            ).toEqual([
                session1.account,
                session5.account,
                session3.account,
                session2.account,
                session4.account,
                session6.account,
            ]);

            expect(
                await getDocumentCommentThreadNotificationSubscribers(context.action(session1), {
                    documentId: document.id,
                    commentThreadId,
                    isFirstComment: false,
                }).then(({accounts}) => accounts),
            ).toEqual([
                session5.account,
                session1.account,
                session3.account,
                session2.account,
                session4.account,
                session6.account,
            ]);

            expect(
                await getDocumentCommentThreadNotificationSubscribers(context.action(session7), {
                    documentId: document.id,
                    commentThreadId,
                    isFirstComment: true,
                }).then(({accounts}) => accounts),
            ).toEqual([
                session1.account,
                session5.account,
                session3.account,
                session2.account,
                session4.account,
                session6.account,
            ]);

            expect(
                await getDocumentCommentThreadNotificationSubscribers(context.action(session7), {
                    documentId: document.id,
                    commentThreadId,
                    isFirstComment: false,
                }).then(({accounts}) => accounts),
            ).toEqual([
                session5.account,
                session1.account,
                session3.account,
                session2.account,
                session4.account,
                session6.account,
            ]);
        });
    });

    test("can resolve a comment thread", async () => {
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

        expect(massageDocument(await getDocument(context.action(session1), document.id))).toEqual({
            version: 1,
            content: schema
                .node("doc", {}, [
                    schema.node("title", {}, []),
                    schema.node("paragraph", {}, [schema.text("Hello, world!")]),
                ])
                .toJSON(),
        });

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

        expect(massageDocument(await getDocument(context.action(session1), document.id))).toEqual({
            version: 2,
            content: schema
                .node("doc", {}, [
                    schema.node("title", {}, []),
                    schema.node("paragraph", {}, [
                        schema.text("Hello, "),
                        schema.text("world", [schema.mark("comment", {commentThreadId})]),
                        schema.text("!"),
                    ]),
                ])
                .toJSON(),
        });

        await updateDocumentContent(context.action(session1), {
            id: document.id,
            version: 2,
            steps: [new RemoveAllMarksStep(schema.mark("comment", {commentThreadId}))],
            clientId: generateId(),
        });

        expect(massageDocument(await getDocument(context.action(session1), document.id))).toEqual({
            version: 3,
            content: schema
                .node("doc", {}, [
                    schema.node("title", {}, []),
                    schema.node("paragraph", {}, [schema.text("Hello, world!")]),
                ])
                .toJSON(),
        });
    });

    test("can resolve a comment thread with multiple references", async () => {
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

        expect(massageDocument(await getDocument(context.action(session1), document.id))).toEqual({
            version: 1,
            content: schema
                .node("doc", {}, [
                    schema.node("title", {}, []),
                    schema.node("paragraph", {}, [schema.text("Hello, world!")]),
                ])
                .toJSON(),
        });

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

        await updateDocumentContent(context.action(session1), {
            id: document.id,
            version: 2,
            steps: [new AddMarkStep(3, 8, schema.mark("comment", {commentThreadId}))],
            clientId: generateId(),
        });

        expect(massageDocument(await getDocument(context.action(session1), document.id))).toEqual({
            version: 3,
            content: schema
                .node("doc", {}, [
                    schema.node("title", {}, []),
                    schema.node("paragraph", {}, [
                        schema.text("Hello", [schema.mark("comment", {commentThreadId})]),
                        schema.text(", "),
                        schema.text("world", [schema.mark("comment", {commentThreadId})]),
                        schema.text("!"),
                    ]),
                ])
                .toJSON(),
        });

        await updateDocumentContent(context.action(session1), {
            id: document.id,
            version: 3,
            steps: [new RemoveAllMarksStep(schema.mark("comment", {commentThreadId}))],
            clientId: generateId(),
        });

        expect(massageDocument(await getDocument(context.action(session1), document.id))).toEqual({
            version: 4,
            content: schema
                .node("doc", {}, [
                    schema.node("title", {}, []),
                    schema.node("paragraph", {}, [schema.text("Hello, world!")]),
                ])
                .toJSON(),
        });
    });

    test("can invert comment thread resolution", async () => {
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

        expect(massageDocument(await getDocument(context.action(session1), document.id))).toEqual({
            version: 1,
            content: schema
                .node("doc", {}, [
                    schema.node("title", {}, []),
                    schema.node("paragraph", {}, [schema.text("Hello, world!")]),
                ])
                .toJSON(),
        });

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

        expect(massageDocument(await getDocument(context.action(session1), document.id))).toEqual({
            version: 2,
            content: schema
                .node("doc", {}, [
                    schema.node("title", {}, []),
                    schema.node("paragraph", {}, [
                        schema.text("Hello, "),
                        schema.text("world", [schema.mark("comment", {commentThreadId})]),
                        schema.text("!"),
                    ]),
                ])
                .toJSON(),
        });

        const {newInvertedSteps} = await updateDocumentContent(context.action(session1), {
            id: document.id,
            version: 2,
            steps: [new RemoveAllMarksStep(schema.mark("comment", {commentThreadId}))],
            clientId: generateId(),
        });

        expect(massageDocument(await getDocument(context.action(session1), document.id))).toEqual({
            version: 3,
            content: schema
                .node("doc", {}, [
                    schema.node("title", {}, []),
                    schema.node("paragraph", {}, [schema.text("Hello, world!")]),
                ])
                .toJSON(),
        });

        await updateDocumentContent(context.action(session1), {
            id: document.id,
            version: 3,
            steps: newInvertedSteps,
            clientId: generateId(),
        });

        expect(massageDocument(await getDocument(context.action(session1), document.id))).toEqual({
            version: 4,
            content: schema
                .node("doc", {}, [
                    schema.node("title", {}, []),
                    schema.node("paragraph", {}, [
                        schema.text("Hello, "),
                        schema.text("world", [schema.mark("comment", {commentThreadId})]),
                        schema.text("!"),
                    ]),
                ])
                .toJSON(),
        });
    });

    test("can invert comment thread resolution with multiple references", async () => {
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

        expect(massageDocument(await getDocument(context.action(session1), document.id))).toEqual({
            version: 1,
            content: schema
                .node("doc", {}, [
                    schema.node("title", {}, []),
                    schema.node("paragraph", {}, [schema.text("Hello, world!")]),
                ])
                .toJSON(),
        });

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

        await updateDocumentContent(context.action(session1), {
            id: document.id,
            version: 2,
            steps: [new AddMarkStep(3, 8, schema.mark("comment", {commentThreadId}))],
            clientId: generateId(),
        });

        expect(massageDocument(await getDocument(context.action(session1), document.id))).toEqual({
            version: 3,
            content: schema
                .node("doc", {}, [
                    schema.node("title", {}, []),
                    schema.node("paragraph", {}, [
                        schema.text("Hello", [schema.mark("comment", {commentThreadId})]),
                        schema.text(", "),
                        schema.text("world", [schema.mark("comment", {commentThreadId})]),
                        schema.text("!"),
                    ]),
                ])
                .toJSON(),
        });

        const {newInvertedSteps} = await updateDocumentContent(context.action(session1), {
            id: document.id,
            version: 3,
            steps: [new RemoveAllMarksStep(schema.mark("comment", {commentThreadId}))],
            clientId: generateId(),
        });

        expect(massageDocument(await getDocument(context.action(session1), document.id))).toEqual({
            version: 4,
            content: schema
                .node("doc", {}, [
                    schema.node("title", {}, []),
                    schema.node("paragraph", {}, [schema.text("Hello, world!")]),
                ])
                .toJSON(),
        });

        await updateDocumentContent(context.action(session1), {
            id: document.id,
            version: 4,
            steps: newInvertedSteps,
            clientId: generateId(),
        });

        expect(massageDocument(await getDocument(context.action(session1), document.id))).toEqual({
            version: 5,
            content: schema
                .node("doc", {}, [
                    schema.node("title", {}, []),
                    schema.node("paragraph", {}, [
                        schema.text("Hello", [schema.mark("comment", {commentThreadId})]),
                        schema.text(", "),
                        schema.text("world", [schema.mark("comment", {commentThreadId})]),
                        schema.text("!"),
                    ]),
                ])
                .toJSON(),
        });
    });

    testMessagingImplementation<DocumentCommentRoomKey>(context, {
        async createRoom(context, spaceId) {
            const DocumentsTable = getDocumentsTableForTest();

            const document = await createDocument(context, {
                spaceId,
                content: emptyDocumentContent,
            });

            const commentThreadId = generateId<DocumentCommentThreadId>();
            const createdTime = new Date(Date.now());

            await DocumentsTable.createItem(context, {
                partitionType: "Document",
                // NOTE(calebmer): Our messaging tests run against an archived comment thread
                // since it's less common than a referenced comment thread.
                sortRangeType: "ArchivedCommentThread",
                documentId: document.id,
                commentThreadId,
                createdTime,
                commentsSummary: {
                    nextCommentIndex: 0,
                    lastChangeTime: null,
                    commentCountByAuthorId: new Map(),
                    mentionCountByAccountId: new Map(),
                },
            });

            return {
                key: encodeDocumentCommentRoomKey(document.id, commentThreadId),
                spaceId,
                createdTime,
                messageCount: 0,
            };
        },

        // TODO(calebmer): Implement when we can have private documents!
        createPrivateRoom: "Unimplemented",

        async getRoom(context, roomKey) {
            const [documentId, commentThreadId] = decodeDocumentCommentRoomKey(roomKey);

            const DocumentsTable = getDocumentsTableForTest();

            const document = await getDocument(context, documentId);

            const commentThreadItem = await DocumentsTable.getItemIfExists(context, {
                partitionType: "Document",
                sortRangeType: "ArchivedCommentThread",
                documentId,
                commentThreadId,
            });
            if (!commentThreadItem) throw new NotFoundError("Document comment thread not found");

            return {
                key: roomKey,
                spaceId: document.spaceId,
                createdTime: commentThreadItem.createdTime,
                messageCount: reduceIterable(
                    commentThreadItem.commentsSummary.commentCountByAuthorId.values(),
                    (commentCount, authorCommentCount) => commentCount + authorCommentCount,
                    0,
                ),
            };
        },
        getMissingRoomKey() {
            return encodeDocumentCommentRoomKey(generateId(), generateId());
        },
        async createMessage(context, {roomKey, parentMessageIndex: parentCommentIndex, content}) {
            const [documentId, commentThreadId] = decodeDocumentCommentRoomKey(roomKey);

            const comment = await createDocumentComment(context, {
                documentId,
                commentThreadId,
                parentCommentIndex,
                content,
            });

            return {
                index: comment.index,
                createdTime: comment.createdTime,
            };
        },
        async getMessage(context, {roomKey, messageIndex: commentIndex}) {
            const [documentId, commentThreadId] = decodeDocumentCommentRoomKey(roomKey);

            return getDocumentComment(context, {documentId, commentThreadId, commentIndex});
        },
        async updateMessageContent(context, {roomKey, messageIndex: commentIndex, content}) {
            const [documentId, commentThreadId] = decodeDocumentCommentRoomKey(roomKey);

            return updateDocumentCommentContent(context, {
                documentId,
                commentThreadId,
                commentIndex,
                content,
            });
        },
        async deleteMessage(context, {roomKey, messageIndex: commentIndex}) {
            const [documentId, commentThreadId] = decodeDocumentCommentRoomKey(roomKey);

            return deleteDocumentComment(context, {documentId, commentThreadId, commentIndex});
        },
        async getMessagesFromStart(
            context,
            {
                roomKey,
                limit,
                afterMessageIndex: afterCommentIndex,
                beforeMessageIndex: beforeCommentIndex,
            },
        ) {
            const [documentId, commentThreadId] = decodeDocumentCommentRoomKey(roomKey);

            const {commentCount, comments, otherReferencedComments, lastCommentChangeTime} =
                await getDocumentCommentsFromStart(context, {
                    documentId,
                    commentThreadId,
                    limit,
                    afterCommentIndex,
                    beforeCommentIndex,
                });

            return {
                messageCount: commentCount,
                messages: comments,
                otherReferencedMessages: otherReferencedComments,
                lastMessageChangeTime: lastCommentChangeTime,
            };
        },
        async getMessagesFromEnd(
            context,
            {
                roomKey,
                limit,
                afterMessageIndex: afterCommentIndex,
                beforeMessageIndex: beforeCommentIndex,
            },
        ) {
            const [documentId, commentThreadId] = decodeDocumentCommentRoomKey(roomKey);

            const {commentCount, comments, otherReferencedComments, lastCommentChangeTime} =
                await getDocumentCommentsFromEnd(context, {
                    documentId,
                    commentThreadId,
                    limit,
                    afterCommentIndex,
                    beforeCommentIndex,
                });

            return {
                messageCount: commentCount,
                messages: comments,
                otherReferencedMessages: otherReferencedComments,
                lastMessageChangeTime: lastCommentChangeTime,
            };
        },
        async backfillMessages(
            context,
            {
                roomKey,
                clientMessageCount: clientCommentCount,
                clientLastMessageChangeTime: clientLastCommentChangeTime,
                newMessageLimit: newCommentLimit,
            },
        ) {
            const [documentId, commentThreadId] = decodeDocumentCommentRoomKey(roomKey);

            const {
                commentCount,
                lastCommentChangeTime,
                newComments,
                newOtherReferencedComments,
                commentChangesResult,
            } = await backfillDocumentComments(context, {
                documentId,
                commentThreadId,
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
            };
        },
    });
});
