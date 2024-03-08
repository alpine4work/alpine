import {Fragment, Mark, Slice} from "prosemirror-model";
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
    batchGetDocumentCommentThreadReferencesIfExists,
    createDocument,
    createDocumentComment,
    deleteDocumentComment,
    documentContentCacheEvictionTimeoutMs,
    getDocument,
    getDocumentComment,
    getDocumentCommentPayload,
    getDocumentCommentThread,
    getDocumentCommentThreadItemAfterFirstGetItemTestCheckpoint,
    getDocumentCommentThreadNotificationSubscribers,
    getDocumentCommentsFromEnd,
    getDocumentCommentsFromStart,
    getDocumentContent,
    getDocumentContentSteps,
    getDocumentPreviewIfExists,
    getDocumentTitle,
    getDocumentsTableForTest,
    getInternalDocumentTestCounter,
    getResolvedDocumentCommentThreadRanges,
    updateDocumentCommentContent,
    updateDocumentContent,
    updateDocumentContentBeforeExecuteTransactionTestCheckpoint,
    updateDocumentSnapshotBeforeMovingCommentThreadTestCheckpoint,
    updateDocumentSnapshotForTest,
} from "~/server/documents/data/documents_table.js";
import {TestDocument} from "~/server/documents/test_helpers/test_document.js";
import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {createTestSession} from "~/server/dynamo/test_helpers/create_test_session.js";
import {createTestSpace} from "~/server/dynamo/test_helpers/create_test_space.js";
import {testMessagingImplementation} from "~/server/messaging/test_helpers/test_messaging_implementation.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {emptyDocumentContentReferences} from "~/shared/documents/document_content_references.js";
import {
    emptyDocumentContent,
    isDocumentContent,
    DocumentContentProsemirrorSchema as schema,
} from "~/shared/documents/document_content_schema.js";
import {
    DocumentCommentRoomKey,
    DocumentCommentThreadModel,
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
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {reduceIterable} from "~/shared/helpers/iterable/reduce_iterable.js";
import {generateId} from "~/shared/id/id.js";
import {
    AccountId,
    ContentEditorClientId,
    DocumentCommentThreadId,
    DocumentId,
} from "~/shared/id/types/id_types.js";
import {
    MessageContentProsemirrorSchema,
    assertMessageContent,
    createSimpleMessageContent,
} from "~/shared/messaging/message_content_schema.js";
import {
    AddMarksAfterRemoveAllStep,
    RemoveAllMarksStep,
} from "~/shared/prosemirror/remove_all_marks_step.js";

import.meta.jest.useFakeTimers();

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

function textSlice(text: string, marks: ReadonlyArray<Mark> = []) {
    if (text.length === 0) return Slice.empty;
    return new Slice(Fragment.from(schema.text(text, marks)), 0, 0);
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
    import.meta.jest.useFakeTimers();
});

afterEach(() => {
    const hadNoTimers = import.meta.jest.getTimerCount() === 0;
    import.meta.jest.clearAllTimers();
    import.meta.jest.useRealTimers();
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
    expect(await getDocumentTitle(context.action(session1), documentId)).toEqual("Foo bar");
    expect(
        (await getDocumentContent(context.action(session1), documentId)).content.toJSON(),
    ).toEqual(content.toJSON());
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

    expect(getCount()).toEqual(1);

    await updateDocumentContent(context.action(session1), {
        id: documentId,
        version: 1,
        steps: [new ReplaceStep(4, 4, textSlice("b"))],
        clientId: generateId(),
    });

    expect(getCount()).toEqual(1);

    expect(massageDocument(await getDocument(context.action(session1), documentId))).toEqual({
        version: 2,
        content: schema
            .node("doc", {}, [
                schema.node("title", {}, []),
                schema.node("paragraph", {}, [schema.text("ab")]),
            ])
            .toJSON(),
    });

    expect(getCount()).toEqual(1);

    await updateDocumentContent(context.action(session1), {
        id: documentId,
        version: 2,
        steps: [new ReplaceStep(5, 5, textSlice("c"))],
        clientId: generateId(),
    });

    expect(getCount()).toEqual(1);

    expect(massageDocument(await getDocument(context.action(session1), documentId))).toEqual({
        version: 3,
        content: schema
            .node("doc", {}, [
                schema.node("title", {}, []),
                schema.node("paragraph", {}, [schema.text("abc")]),
            ])
            .toJSON(),
    });

    expect(getCount()).toEqual(1);

    await updateDocumentContent(context.action(session1), {
        id: documentId,
        version: 3,
        steps: [new ReplaceStep(6, 6, textSlice("d"))],
        clientId: generateId(),
    });

    expect(getCount()).toEqual(1);

    expect(massageDocument(await getDocument(context.action(session1), documentId))).toEqual({
        version: 4,
        content: schema
            .node("doc", {}, [
                schema.node("title", {}, []),
                schema.node("paragraph", {}, [schema.text("abcd")]),
            ])
            .toJSON(),
    });

    expect(getCount()).toEqual(1);
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

    expect(getCount()).toEqual(1);

    await updateDocumentContent(context.action(session1), {
        id: documentId,
        version: 1,
        steps: [new ReplaceStep(4, 4, textSlice("b"))],
        clientId: generateId(),
    });

    expect(getCount()).toEqual(1);

    expect(massageDocument(await getDocument(context.action(session1), documentId))).toEqual({
        version: 2,
        content: schema
            .node("doc", {}, [
                schema.node("title", {}, []),
                schema.node("paragraph", {}, [schema.text("ab")]),
            ])
            .toJSON(),
    });

    expect(getCount()).toEqual(1);

    await updateDocumentContent(context.action(session1), {
        id: documentId,
        version: 2,
        steps: [new ReplaceStep(5, 5, textSlice("c"))],
        clientId: generateId(),
        cacheOverrideForTest: otherCache,
    });

    expect(getCount()).toEqual(2);

    expect(massageDocument(await getDocument(context.action(session1), documentId))).toEqual({
        version: 3,
        content: schema
            .node("doc", {}, [
                schema.node("title", {}, []),
                schema.node("paragraph", {}, [schema.text("abc")]),
            ])
            .toJSON(),
    });

    expect(getCount()).toEqual(2);

    await updateDocumentContent(context.action(session1), {
        id: documentId,
        version: 3,
        steps: [new ReplaceStep(6, 6, textSlice("d"))],
        clientId: generateId(),
        cacheOverrideForTest: otherCache,
    });

    expect(getCount()).toEqual(2);

    expect(massageDocument(await getDocument(context.action(session1), documentId))).toEqual({
        version: 4,
        content: schema
            .node("doc", {}, [
                schema.node("title", {}, []),
                schema.node("paragraph", {}, [schema.text("abcd")]),
            ])
            .toJSON(),
    });

    expect(getCount()).toEqual(2);

    await updateDocumentContent(context.action(session1), {
        id: documentId,
        version: 4,
        steps: [new ReplaceStep(7, 7, textSlice("e"))],
        clientId: generateId(),
    });

    expect(getCount()).toEqual(2);

    expect(massageDocument(await getDocument(context.action(session1), documentId))).toEqual({
        version: 5,
        content: schema
            .node("doc", {}, [
                schema.node("title", {}, []),
                schema.node("paragraph", {}, [schema.text("abcde")]),
            ])
            .toJSON(),
    });

    expect(getCount()).toEqual(2);

    await updateDocumentContent(context.action(session1), {
        id: documentId,
        version: 5,
        steps: [new ReplaceStep(8, 8, textSlice("f"))],
        clientId: generateId(),
        cacheOverrideForTest: otherCache,
    });

    expect(getCount()).toEqual(2);

    expect(massageDocument(await getDocument(context.action(session1), documentId))).toEqual({
        version: 6,
        content: schema
            .node("doc", {}, [
                schema.node("title", {}, []),
                schema.node("paragraph", {}, [schema.text("abcdef")]),
            ])
            .toJSON(),
    });

    expect(getCount()).toEqual(2);
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

    expect(getCount()).toEqual(1);

    await updateDocumentContent(context.action(session1), {
        id: documentId,
        version: 1,
        steps: [new ReplaceStep(4, 4, textSlice("b"))],
        clientId: generateId(),
    });

    expect(getCount()).toEqual(1);

    expect(massageDocument(await getDocument(context.action(session1), documentId))).toEqual({
        version: 2,
        content: schema
            .node("doc", {}, [
                schema.node("title", {}, []),
                schema.node("paragraph", {}, [schema.text("ab")]),
            ])
            .toJSON(),
    });

    expect(getCount()).toEqual(1);

    import.meta.jest.runAllTimers();

    await updateDocumentContent(context.action(session1), {
        id: documentId,
        version: 2,
        steps: [new ReplaceStep(5, 5, textSlice("c"))],
        clientId: generateId(),
    });

    expect(getCount()).toEqual(2);

    expect(massageDocument(await getDocument(context.action(session1), documentId))).toEqual({
        version: 3,
        content: schema
            .node("doc", {}, [
                schema.node("title", {}, []),
                schema.node("paragraph", {}, [schema.text("abc")]),
            ])
            .toJSON(),
    });

    expect(getCount()).toEqual(2);

    await updateDocumentContent(context.action(session1), {
        id: documentId,
        version: 3,
        steps: [new ReplaceStep(6, 6, textSlice("d"))],
        clientId: generateId(),
    });

    expect(getCount()).toEqual(2);

    expect(massageDocument(await getDocument(context.action(session1), documentId))).toEqual({
        version: 4,
        content: schema
            .node("doc", {}, [
                schema.node("title", {}, []),
                schema.node("paragraph", {}, [schema.text("abcd")]),
            ])
            .toJSON(),
    });

    expect(getCount()).toEqual(2);
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

    expect(getCount()).toEqual(1);

    import.meta.jest.advanceTimersByTime(documentContentCacheEvictionTimeoutMs);

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

    expect(getCount()).toEqual(2);

    import.meta.jest.advanceTimersByTime(documentContentCacheEvictionTimeoutMs / 2);

    expect(getCount()).toEqual(2);

    await updateDocumentContent(context.action(session1), {
        id: documentId,
        version: 2,
        steps: [new ReplaceStep(5, 5, textSlice("c"))],
        clientId: generateId(),
    });

    expect(getCount()).toEqual(2);

    expect(massageDocument(await getDocument(context.action(session1), documentId))).toEqual({
        version: 3,
        content: schema
            .node("doc", {}, [
                schema.node("title", {}, []),
                schema.node("paragraph", {}, [schema.text("abc")]),
            ])
            .toJSON(),
    });

    expect(getCount()).toEqual(2);

    import.meta.jest.advanceTimersByTime(documentContentCacheEvictionTimeoutMs / 2);

    expect(getCount()).toEqual(2);

    await updateDocumentContent(context.action(session1), {
        id: documentId,
        version: 3,
        steps: [new ReplaceStep(6, 6, textSlice("d"))],
        clientId: generateId(),
    });

    expect(getCount()).toEqual(2);

    expect(massageDocument(await getDocument(context.action(session1), documentId))).toEqual({
        version: 4,
        content: schema
            .node("doc", {}, [
                schema.node("title", {}, []),
                schema.node("paragraph", {}, [schema.text("abcd")]),
            ])
            .toJSON(),
    });

    expect(getCount()).toEqual(2);

    import.meta.jest.advanceTimersByTime(documentContentCacheEvictionTimeoutMs / 2);

    expect(getCount()).toEqual(2);

    await updateDocumentContent(context.action(session1), {
        id: documentId,
        version: 4,
        steps: [new ReplaceStep(7, 7, textSlice("e"))],
        clientId: generateId(),
    });

    expect(getCount()).toEqual(2);

    expect(massageDocument(await getDocument(context.action(session1), documentId))).toEqual({
        version: 5,
        content: schema
            .node("doc", {}, [
                schema.node("title", {}, []),
                schema.node("paragraph", {}, [schema.text("abcde")]),
            ])
            .toJSON(),
    });

    expect(getCount()).toEqual(2);

    import.meta.jest.advanceTimersByTime(documentContentCacheEvictionTimeoutMs);

    expect(getCount()).toEqual(2);

    await updateDocumentContent(context.action(session1), {
        id: documentId,
        version: 5,
        steps: [new ReplaceStep(8, 8, textSlice("f"))],
        clientId: generateId(),
    });

    expect(getCount()).toEqual(3);

    expect(massageDocument(await getDocument(context.action(session1), documentId))).toEqual({
        version: 6,
        content: schema
            .node("doc", {}, [
                schema.node("title", {}, []),
                schema.node("paragraph", {}, [schema.text("abcdef")]),
            ])
            .toJSON(),
    });

    expect(getCount()).toEqual(3);
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
    await expect(getDocumentTitle(context.action(session1), documentId)).rejects.toThrow(
        PermissionDeniedError,
    );
    await expect(getDocumentContent(context.action(session1), documentId)).rejects.toThrow(
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

test("counts step count contributions for each account", async () => {
    const DocumentsTable = getDocumentsTableForTest();

    const space = await TestSpace.create(context);
    const session1 = await space.createSession();
    const session2 = await space.createSession();
    const session3 = await space.createSession();

    const document = await TestDocument.create(session1, {body: "Starts with some content."});

    expect(
        await DocumentsTable.getItem(context, {
            partitionType: "Document",
            sortRangeType: "Attributes",
            documentId: document.id,
        }).then(item => item.stepCountByAccountId.get()),
    ).toEqual(new Map());

    await document.type(session1, " Adding another sentence.");

    expect(
        await DocumentsTable.getItem(context, {
            partitionType: "Document",
            sortRangeType: "Attributes",
            documentId: document.id,
        }).then(item => item.stepCountByAccountId.get()),
    ).toEqual(new Map());

    await document.type(session2, " Yet another sentence.");

    expect(
        await DocumentsTable.getItem(context, {
            partitionType: "Document",
            sortRangeType: "Attributes",
            documentId: document.id,
        }).then(item => item.stepCountByAccountId.get()),
    ).toEqual(new Map([[session2.account.id, 1]]));

    await document.type(session3, " A third sentence.");

    expect(
        await DocumentsTable.getItem(context, {
            partitionType: "Document",
            sortRangeType: "Attributes",
            documentId: document.id,
        }).then(item => item.stepCountByAccountId.get()),
    ).toEqual(
        new Map([
            [session2.account.id, 1],
            [session3.account.id, 1],
        ]),
    );

    await document.type(session2, " I'm going to need to get more creative with test data.");

    expect(
        await DocumentsTable.getItem(context, {
            partitionType: "Document",
            sortRangeType: "Attributes",
            documentId: document.id,
        }).then(item => item.stepCountByAccountId.get()),
    ).toEqual(
        new Map([
            [session2.account.id, 2],
            [session3.account.id, 1],
        ]),
    );

    await document.type(session2, " How", {secondText: " much wood"});

    expect(
        await DocumentsTable.getItem(context, {
            partitionType: "Document",
            sortRangeType: "Attributes",
            documentId: document.id,
        }).then(item => item.stepCountByAccountId.get()),
    ).toEqual(
        new Map([
            [session2.account.id, 4],
            [session3.account.id, 1],
        ]),
    );

    await document.type(session1, " could a wood", {secondText: " chuck chuck"});

    expect(
        await DocumentsTable.getItem(context, {
            partitionType: "Document",
            sortRangeType: "Attributes",
            documentId: document.id,
        }).then(item => item.stepCountByAccountId.get()),
    ).toEqual(
        new Map([
            [session2.account.id, 4],
            [session3.account.id, 1],
        ]),
    );

    await document.type(session2, " if a wood chunk could chunk wood?");

    expect(
        await DocumentsTable.getItem(context, {
            partitionType: "Document",
            sortRangeType: "Attributes",
            documentId: document.id,
        }).then(item => item.stepCountByAccountId.get()),
    ).toEqual(
        new Map([
            [session2.account.id, 5],
            [session3.account.id, 1],
        ]),
    );

    await document.type(session3, " Nice.");

    expect(
        await DocumentsTable.getItem(context, {
            partitionType: "Document",
            sortRangeType: "Attributes",
            documentId: document.id,
        }).then(item => item.stepCountByAccountId.get()),
    ).toEqual(
        new Map([
            [session2.account.id, 5],
            [session3.account.id, 2],
        ]),
    );
});

test("counts step count contributions for each account with alternating cache", async () => {
    const DocumentsTable = getDocumentsTableForTest();

    const space = await TestSpace.create(context);
    const session1 = await space.createSession();
    const session2 = await space.createSession();
    const session3 = await space.createSession();

    const document = await TestDocument.create(session1, {body: "Starts with some content."});

    expect(
        await DocumentsTable.getItem(context, {
            partitionType: "Document",
            sortRangeType: "Attributes",
            documentId: document.id,
        }).then(item => item.stepCountByAccountId.get()),
    ).toEqual(new Map());

    await document.type(session1, " Adding another sentence.");

    expect(
        await DocumentsTable.getItem(context, {
            partitionType: "Document",
            sortRangeType: "Attributes",
            documentId: document.id,
        }).then(item => item.stepCountByAccountId.get()),
    ).toEqual(new Map());

    await document.type(session2, " Yet another sentence.");

    expect(
        await DocumentsTable.getItem(context, {
            partitionType: "Document",
            sortRangeType: "Attributes",
            documentId: document.id,
        }).then(item => item.stepCountByAccountId.get()),
    ).toEqual(new Map([[session2.account.id, 1]]));

    await document.type(session3, " A third sentence.", {cacheOverrideForTest: otherCache});

    expect(
        await DocumentsTable.getItem(context, {
            partitionType: "Document",
            sortRangeType: "Attributes",
            documentId: document.id,
        }).then(item => item.stepCountByAccountId.get()),
    ).toEqual(
        new Map([
            [session2.account.id, 1],
            [session3.account.id, 1],
        ]),
    );

    await document.type(session2, " I'm going to need to get more creative with test data.");

    expect(
        await DocumentsTable.getItem(context, {
            partitionType: "Document",
            sortRangeType: "Attributes",
            documentId: document.id,
        }).then(item => item.stepCountByAccountId.get()),
    ).toEqual(
        new Map([
            [session2.account.id, 2],
            [session3.account.id, 1],
        ]),
    );

    await document.type(session2, " How", {
        secondText: " much wood",
        cacheOverrideForTest: otherCache,
    });

    expect(
        await DocumentsTable.getItem(context, {
            partitionType: "Document",
            sortRangeType: "Attributes",
            documentId: document.id,
        }).then(item => item.stepCountByAccountId.get()),
    ).toEqual(
        new Map([
            [session2.account.id, 4],
            [session3.account.id, 1],
        ]),
    );

    await document.type(session1, " could a wood", {secondText: " chuck chuck"});

    expect(
        await DocumentsTable.getItem(context, {
            partitionType: "Document",
            sortRangeType: "Attributes",
            documentId: document.id,
        }).then(item => item.stepCountByAccountId.get()),
    ).toEqual(
        new Map([
            [session2.account.id, 4],
            [session3.account.id, 1],
        ]),
    );

    await document.type(session2, " if a wood chunk could chunk wood?");

    expect(
        await DocumentsTable.getItem(context, {
            partitionType: "Document",
            sortRangeType: "Attributes",
            documentId: document.id,
        }).then(item => item.stepCountByAccountId.get()),
    ).toEqual(
        new Map([
            [session2.account.id, 5],
            [session3.account.id, 1],
        ]),
    );

    await document.type(session3, " Nice.", {cacheOverrideForTest: otherCache});

    expect(
        await DocumentsTable.getItem(context, {
            partitionType: "Document",
            sortRangeType: "Attributes",
            documentId: document.id,
        }).then(item => item.stepCountByAccountId.get()),
    ).toEqual(
        new Map([
            [session2.account.id, 5],
            [session3.account.id, 2],
        ]),
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
            fallbackContentSnippet: expect.any(Object),
            commentsSummary: {
                nextCommentIndex: 1,
                lastChangeTime: null,
                commentCountByAuthorId: new Map([[session1.account.id, 1]]),
                mentionCountByAccountId: new Map(),
            },
            resolutionState: {type: "Unresolved"},
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
            fallbackContentSnippet: expect.any(Object),
            commentsSummary: {
                nextCommentIndex: 1,
                lastChangeTime: null,
                commentCountByAuthorId: new Map([[session1.account.id, 1]]),
                mentionCountByAccountId: new Map(),
            },
            resolutionState: {type: "Unresolved"},
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
            fallbackContentSnippet: expect.any(Object),
            commentsSummary: {
                nextCommentIndex: 2,
                lastChangeTime: null,
                commentCountByAuthorId: new Map([[session1.account.id, 2]]),
                mentionCountByAccountId: new Map(),
            },
            resolutionState: {type: "Unresolved"},
            updateLockVersion: 2,
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
            fallbackContentSnippet: expect.any(Object),
            commentsSummary: {
                nextCommentIndex: 2,
                lastChangeTime: null,
                commentCountByAuthorId: new Map([[session1.account.id, 2]]),
                mentionCountByAccountId: new Map(),
            },
            resolutionState: {type: "Unresolved"},
            updateLockVersion: 2,
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
            fallbackContentSnippet: expect.any(Object),
            commentsSummary: {
                nextCommentIndex: 1,
                lastChangeTime: null,
                commentCountByAuthorId: new Map([[session1.account.id, 1]]),
                mentionCountByAccountId: new Map(),
            },
            resolutionState: {type: "Unresolved"},
            updateLockVersion: 1,
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
            fallbackContentSnippet: expect.any(Object),
            commentsSummary: {
                nextCommentIndex: 1,
                lastChangeTime: null,
                commentCountByAuthorId: new Map([[session1.account.id, 1]]),
                mentionCountByAccountId: new Map(),
            },
            resolutionState: {type: "Unresolved"},
            updateLockVersion: 1,
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
            fallbackContentSnippet: expect.any(Object),
            commentsSummary: {
                nextCommentIndex: 2,
                lastChangeTime: null,
                commentCountByAuthorId: new Map([[session1.account.id, 2]]),
                mentionCountByAccountId: new Map(),
            },
            resolutionState: {type: "Unresolved"},
            updateLockVersion: 2,
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
            fallbackContentSnippet: expect.any(Object),
            commentsSummary: {
                nextCommentIndex: 2,
                lastChangeTime: null,
                commentCountByAuthorId: new Map([[session1.account.id, 2]]),
                mentionCountByAccountId: new Map(),
            },
            resolutionState: {type: "Unresolved"},
            updateLockVersion: 2,
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
            const commentThreads = await batchGetDocumentCommentThreadReferencesIfExists(
                context.action(session1),
                {
                    documentId: document.id,
                    commentThreadIds: [],
                },
            );

            expect(commentThreads.size).toEqual(0);
        }

        {
            const commentThreads = await batchGetDocumentCommentThreadReferencesIfExists(
                context.action(session1),
                {
                    documentId: document.id,
                    commentThreadIds: [commentThreadId1],
                },
            );

            expect(commentThreads.size).toEqual(1);
            expect(commentThreads.has(commentThreadId1)).toBe(true);
        }

        {
            const fakeCommentThreadId = generateId<DocumentCommentThreadId>();

            const commentThreads = await batchGetDocumentCommentThreadReferencesIfExists(
                context.action(session1),
                {
                    documentId: document.id,
                    commentThreadIds: [fakeCommentThreadId],
                },
            );

            expect(commentThreads.size).toEqual(0);
            expect(commentThreads.has(fakeCommentThreadId)).toBe(false);
        }

        {
            const fakeCommentThreadId = generateId<DocumentCommentThreadId>();

            const commentThreads = await batchGetDocumentCommentThreadReferencesIfExists(
                context.action(session1),
                {
                    documentId: document.id,
                    commentThreadIds: [commentThreadId1, commentThreadId2, fakeCommentThreadId],
                },
            );

            expect(commentThreads.size).toEqual(2);
            expect(commentThreads.has(commentThreadId1)).toBe(true);
            expect(commentThreads.has(commentThreadId2)).toBe(true);
            expect(commentThreads.has(fakeCommentThreadId)).toBe(false);
        }

        {
            const fakeCommentThreadId = generateId<DocumentCommentThreadId>();

            const commentThreads = await batchGetDocumentCommentThreadReferencesIfExists(
                context.action(session1),
                {
                    documentId: document.id,
                    commentThreadIds: [commentThreadId1, commentThreadId2, fakeCommentThreadId],
                },
            );

            expect(commentThreads.size).toEqual(2);
            expect(commentThreads.has(commentThreadId1)).toBe(true);
            expect(commentThreads.has(commentThreadId2)).toBe(true);
            expect(commentThreads.has(fakeCommentThreadId)).toBe(false);
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
            batchGetDocumentCommentThreadReferencesIfExists(context.action(otherSession), {
                documentId: document.id,
                commentThreadIds: [],
            }),
        ).rejects.toThrow(PermissionDeniedError);

        await expect(
            batchGetDocumentCommentThreadReferencesIfExists(context.action(otherSession), {
                documentId: document.id,
                commentThreadIds: [commentThreadId1],
            }),
        ).rejects.toThrow(PermissionDeniedError);

        await expect(
            batchGetDocumentCommentThreadReferencesIfExists(context.action(otherSession), {
                documentId: document.id,
                commentThreadIds: [generateId()],
            }),
        ).rejects.toThrow(PermissionDeniedError);

        await expect(
            batchGetDocumentCommentThreadReferencesIfExists(context.action(otherSession), {
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
            batchGetDocumentCommentThreadReferencesIfExists(context.action(otherSession), {
                documentId: generateId(),
                commentThreadIds: [],
            }),
        ).rejects.toThrow(NotFoundError);

        await expect(
            batchGetDocumentCommentThreadReferencesIfExists(context.action(otherSession), {
                documentId: generateId(),
                commentThreadIds: [commentThreadId1],
            }),
        ).rejects.toThrow(NotFoundError);

        await expect(
            batchGetDocumentCommentThreadReferencesIfExists(context.action(otherSession), {
                documentId: generateId(),
                commentThreadIds: [generateId()],
            }),
        ).rejects.toThrow(NotFoundError);

        await expect(
            batchGetDocumentCommentThreadReferencesIfExists(context.action(otherSession), {
                documentId: generateId(),
                commentThreadIds: [commentThreadId1, commentThreadId2, generateId()],
            }),
        ).rejects.toThrow(NotFoundError);
    });

    test("comment thread update lock version stays the same when moving across referenced and archived items", async () => {
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

        expect(
            assertExists(
                await DocumentsTable.getItemIfExists(context, {
                    partitionType: "Document",
                    sortRangeType: "ReferencedCommentThread",
                    documentId: document.id,
                    commentThreadId,
                }),
            ).updateLockVersion,
        ).toBe(undefined);

        expect(
            await DocumentsTable.getItemIfExists(context, {
                partitionType: "Document",
                sortRangeType: "ArchivedCommentThread",
                documentId: document.id,
                commentThreadId,
            }),
        ).toBeNull();

        await createDocumentComment(context.action(session1), {
            documentId: document.id,
            commentThreadId,
            parentCommentIndex: 0,
            content: createSimpleMessageContent("Test message content 2"),
        });

        expect(
            assertExists(
                await DocumentsTable.getItemIfExists(context, {
                    partitionType: "Document",
                    sortRangeType: "ReferencedCommentThread",
                    documentId: document.id,
                    commentThreadId,
                }),
            ).updateLockVersion,
        ).toBe(1);

        expect(
            await DocumentsTable.getItemIfExists(context, {
                partitionType: "Document",
                sortRangeType: "ArchivedCommentThread",
                documentId: document.id,
                commentThreadId,
            }),
        ).toBeNull();

        await createDocumentComment(context.action(session1), {
            documentId: document.id,
            commentThreadId,
            parentCommentIndex: 0,
            content: createSimpleMessageContent("Test message content 3"),
        });

        expect(
            assertExists(
                await DocumentsTable.getItemIfExists(context, {
                    partitionType: "Document",
                    sortRangeType: "ReferencedCommentThread",
                    documentId: document.id,
                    commentThreadId,
                }),
            ).updateLockVersion,
        ).toBe(2);

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

        expect(
            assertExists(
                await DocumentsTable.getItemIfExists(context, {
                    partitionType: "Document",
                    sortRangeType: "ReferencedCommentThread",
                    documentId: document.id,
                    commentThreadId,
                }),
            ).updateLockVersion,
        ).toBe(3);

        expect(
            await DocumentsTable.getItemIfExists(context, {
                partitionType: "Document",
                sortRangeType: "ArchivedCommentThread",
                documentId: document.id,
                commentThreadId,
            }),
        ).toBeNull();

        await updateDocumentSnapshotForTest(context.action(session1), document.id);

        expect(
            await DocumentsTable.getItemIfExists(context, {
                partitionType: "Document",
                sortRangeType: "ReferencedCommentThread",
                documentId: document.id,
                commentThreadId,
            }),
        ).toBeNull();

        expect(
            assertExists(
                await DocumentsTable.getItemIfExists(context, {
                    partitionType: "Document",
                    sortRangeType: "ArchivedCommentThread",
                    documentId: document.id,
                    commentThreadId,
                }),
            ).updateLockVersion,
        ).toBe(3);

        await createDocumentComment(context.action(session1), {
            documentId: document.id,
            commentThreadId,
            parentCommentIndex: 0,
            content: createSimpleMessageContent("Test message content 4"),
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
            assertExists(
                await DocumentsTable.getItemIfExists(context, {
                    partitionType: "Document",
                    sortRangeType: "ArchivedCommentThread",
                    documentId: document.id,
                    commentThreadId,
                }),
            ).updateLockVersion,
        ).toBe(4);

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
            assertExists(
                await DocumentsTable.getItemIfExists(context, {
                    partitionType: "Document",
                    sortRangeType: "ArchivedCommentThread",
                    documentId: document.id,
                    commentThreadId,
                }),
            ).updateLockVersion,
        ).toBe(4);

        await updateDocumentSnapshotForTest(context.action(session1), document.id);

        expect(
            assertExists(
                await DocumentsTable.getItemIfExists(context, {
                    partitionType: "Document",
                    sortRangeType: "ReferencedCommentThread",
                    documentId: document.id,
                    commentThreadId,
                }),
            ).updateLockVersion,
        ).toBe(4);

        expect(
            await DocumentsTable.getItemIfExists(context, {
                partitionType: "Document",
                sortRangeType: "ArchivedCommentThread",
                documentId: document.id,
                commentThreadId,
            }),
        ).toBeNull();

        await createDocumentComment(context.action(session1), {
            documentId: document.id,
            commentThreadId,
            parentCommentIndex: 0,
            content: createSimpleMessageContent("Test message content 5"),
        });

        expect(
            assertExists(
                await DocumentsTable.getItemIfExists(context, {
                    partitionType: "Document",
                    sortRangeType: "ReferencedCommentThread",
                    documentId: document.id,
                    commentThreadId,
                }),
            ).updateLockVersion,
        ).toBe(5);

        expect(
            await DocumentsTable.getItemIfExists(context, {
                partitionType: "Document",
                sortRangeType: "ArchivedCommentThread",
                documentId: document.id,
                commentThreadId,
            }),
        ).toBeNull();
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
                }),
            ).toEqual({accountIds: new Set([session1.account.id, session2.account.id])});

            expect(
                await getDocumentCommentThreadNotificationSubscribers(context.action(session1), {
                    documentId: document.id,
                    commentThreadId,
                    isFirstComment: false,
                }),
            ).toEqual({accountIds: new Set([session2.account.id])});

            expect(
                await getDocumentCommentThreadNotificationSubscribers(context.action(session2), {
                    documentId: document.id,
                    commentThreadId,
                    isFirstComment: true,
                }),
            ).toEqual({accountIds: new Set([session1.account.id, session2.account.id])});

            expect(
                await getDocumentCommentThreadNotificationSubscribers(context.action(session2), {
                    documentId: document.id,
                    commentThreadId,
                    isFirstComment: false,
                }),
            ).toEqual({accountIds: new Set([session2.account.id])});
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
                }),
            ).toEqual({accountIds: new Set([session1.account.id, session2.account.id])});

            expect(
                await getDocumentCommentThreadNotificationSubscribers(context.action(session1), {
                    documentId: document.id,
                    commentThreadId,
                    isFirstComment: false,
                }),
            ).toEqual({accountIds: new Set([session2.account.id])});

            expect(
                await getDocumentCommentThreadNotificationSubscribers(context.action(session4), {
                    documentId: document.id,
                    commentThreadId,
                    isFirstComment: true,
                }),
            ).toEqual({accountIds: new Set([session1.account.id, session2.account.id])});

            expect(
                await getDocumentCommentThreadNotificationSubscribers(context.action(session4), {
                    documentId: document.id,
                    commentThreadId,
                    isFirstComment: false,
                }),
            ).toEqual({accountIds: new Set([session2.account.id])});

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
                }),
            ).toEqual({
                accountIds: new Set([
                    session1.account.id,
                    session2.account.id,
                    session3.account.id,
                ]),
            });

            expect(
                await getDocumentCommentThreadNotificationSubscribers(context.action(session1), {
                    documentId: document.id,
                    commentThreadId,
                    isFirstComment: false,
                }),
            ).toEqual({accountIds: new Set([session2.account.id, session3.account.id])});

            expect(
                await getDocumentCommentThreadNotificationSubscribers(context.action(session4), {
                    documentId: document.id,
                    commentThreadId,
                    isFirstComment: true,
                }),
            ).toEqual({
                accountIds: new Set([
                    session1.account.id,
                    session2.account.id,
                    session3.account.id,
                ]),
            });

            expect(
                await getDocumentCommentThreadNotificationSubscribers(context.action(session4), {
                    documentId: document.id,
                    commentThreadId,
                    isFirstComment: false,
                }),
            ).toEqual({accountIds: new Set([session2.account.id, session3.account.id])});

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
                }),
            ).toEqual({
                accountIds: new Set([
                    session1.account.id,
                    session2.account.id,
                    session3.account.id,
                    session4.account.id,
                ]),
            });

            expect(
                await getDocumentCommentThreadNotificationSubscribers(context.action(session1), {
                    documentId: document.id,
                    commentThreadId,
                    isFirstComment: false,
                }),
            ).toEqual({
                accountIds: new Set([
                    session2.account.id,
                    session3.account.id,
                    session4.account.id,
                ]),
            });

            expect(
                await getDocumentCommentThreadNotificationSubscribers(context.action(session4), {
                    documentId: document.id,
                    commentThreadId,
                    isFirstComment: true,
                }),
            ).toEqual({
                accountIds: new Set([
                    session1.account.id,
                    session2.account.id,
                    session3.account.id,
                    session4.account.id,
                ]),
            });

            expect(
                await getDocumentCommentThreadNotificationSubscribers(context.action(session4), {
                    documentId: document.id,
                    commentThreadId,
                    isFirstComment: false,
                }),
            ).toEqual({
                accountIds: new Set([
                    session2.account.id,
                    session3.account.id,
                    session4.account.id,
                ]),
            });

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
                }),
            ).toEqual({
                accountIds: new Set([
                    session1.account.id,
                    session2.account.id,
                    session3.account.id,
                    session4.account.id,
                ]),
            });

            expect(
                await getDocumentCommentThreadNotificationSubscribers(context.action(session1), {
                    documentId: document.id,
                    commentThreadId,
                    isFirstComment: false,
                }),
            ).toEqual({
                accountIds: new Set([
                    session2.account.id,
                    session3.account.id,
                    session4.account.id,
                ]),
            });

            expect(
                await getDocumentCommentThreadNotificationSubscribers(context.action(session4), {
                    documentId: document.id,
                    commentThreadId,
                    isFirstComment: true,
                }),
            ).toEqual({
                accountIds: new Set([
                    session1.account.id,
                    session2.account.id,
                    session3.account.id,
                    session4.account.id,
                ]),
            });

            expect(
                await getDocumentCommentThreadNotificationSubscribers(context.action(session4), {
                    documentId: document.id,
                    commentThreadId,
                    isFirstComment: false,
                }),
            ).toEqual({
                accountIds: new Set([
                    session2.account.id,
                    session3.account.id,
                    session4.account.id,
                ]),
            });
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
                }),
            ).toEqual({accountIds: new Set([session1.account.id, session2.account.id])});

            expect(
                await getDocumentCommentThreadNotificationSubscribers(context.action(session1), {
                    documentId: document.id,
                    commentThreadId,
                    isFirstComment: false,
                }),
            ).toEqual({accountIds: new Set([session2.account.id])});

            expect(
                await getDocumentCommentThreadNotificationSubscribers(context.action(session4), {
                    documentId: document.id,
                    commentThreadId,
                    isFirstComment: true,
                }),
            ).toEqual({accountIds: new Set([session1.account.id, session2.account.id])});

            expect(
                await getDocumentCommentThreadNotificationSubscribers(context.action(session4), {
                    documentId: document.id,
                    commentThreadId,
                    isFirstComment: false,
                }),
            ).toEqual({accountIds: new Set([session2.account.id])});

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
                }),
            ).toEqual({
                accountIds: new Set([
                    session1.account.id,
                    session2.account.id,
                    session3.account.id,
                ]),
            });

            expect(
                await getDocumentCommentThreadNotificationSubscribers(context.action(session1), {
                    documentId: document.id,
                    commentThreadId,
                    isFirstComment: false,
                }),
            ).toEqual({accountIds: new Set([session2.account.id, session3.account.id])});

            expect(
                await getDocumentCommentThreadNotificationSubscribers(context.action(session4), {
                    documentId: document.id,
                    commentThreadId,
                    isFirstComment: true,
                }),
            ).toEqual({
                accountIds: new Set([
                    session1.account.id,
                    session2.account.id,
                    session3.account.id,
                ]),
            });

            expect(
                await getDocumentCommentThreadNotificationSubscribers(context.action(session4), {
                    documentId: document.id,
                    commentThreadId,
                    isFirstComment: false,
                }),
            ).toEqual({accountIds: new Set([session2.account.id, session3.account.id])});

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
                }),
            ).toEqual({
                accountIds: new Set([
                    session1.account.id,
                    session2.account.id,
                    session3.account.id,
                ]),
            });

            expect(
                await getDocumentCommentThreadNotificationSubscribers(context.action(session1), {
                    documentId: document.id,
                    commentThreadId,
                    isFirstComment: false,
                }),
            ).toEqual({accountIds: new Set([session2.account.id, session3.account.id])});

            expect(
                await getDocumentCommentThreadNotificationSubscribers(context.action(session4), {
                    documentId: document.id,
                    commentThreadId,
                    isFirstComment: true,
                }),
            ).toEqual({
                accountIds: new Set([
                    session1.account.id,
                    session2.account.id,
                    session3.account.id,
                ]),
            });

            expect(
                await getDocumentCommentThreadNotificationSubscribers(context.action(session4), {
                    documentId: document.id,
                    commentThreadId,
                    isFirstComment: false,
                }),
            ).toEqual({accountIds: new Set([session2.account.id, session3.account.id])});
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
                }),
            ).toEqual({accountIds: new Set([session1.account.id])});

            expect(
                await getDocumentCommentThreadNotificationSubscribers(context.action(session1), {
                    documentId: document.id,
                    commentThreadId,
                    isFirstComment: false,
                }),
            ).toEqual({accountIds: new Set([session1.account.id])});

            expect(
                await getDocumentCommentThreadNotificationSubscribers(context.action(session4), {
                    documentId: document.id,
                    commentThreadId,
                    isFirstComment: true,
                }),
            ).toEqual({accountIds: new Set([session1.account.id])});

            expect(
                await getDocumentCommentThreadNotificationSubscribers(context.action(session4), {
                    documentId: document.id,
                    commentThreadId,
                    isFirstComment: false,
                }),
            ).toEqual({accountIds: new Set([session1.account.id])});

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
                }),
            ).toEqual({
                accountIds: new Set([
                    session1.account.id,
                    session3.account.id,
                    session4.account.id,
                ]),
            });

            expect(
                await getDocumentCommentThreadNotificationSubscribers(context.action(session2), {
                    documentId: document.id,
                    commentThreadId,
                    isFirstComment: false,
                }),
            ).toEqual({
                accountIds: new Set([
                    session1.account.id,
                    session3.account.id,
                    session4.account.id,
                ]),
            });

            expect(
                await getDocumentCommentThreadNotificationSubscribers(context.action(session3), {
                    documentId: document.id,
                    commentThreadId,
                    isFirstComment: false,
                }),
            ).toEqual({
                accountIds: new Set([
                    session1.account.id,
                    session3.account.id,
                    session4.account.id,
                ]),
            });
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
                }),
            ).toEqual({accountIds: new Set([session1.account.id])});

            expect(
                await getDocumentCommentThreadNotificationSubscribers(context.action(session1), {
                    documentId: document.id,
                    commentThreadId,
                    isFirstComment: false,
                }),
            ).toEqual({accountIds: new Set([session1.account.id])});

            expect(
                await getDocumentCommentThreadNotificationSubscribers(context.action(session4), {
                    documentId: document.id,
                    commentThreadId,
                    isFirstComment: true,
                }),
            ).toEqual({accountIds: new Set([session1.account.id])});

            expect(
                await getDocumentCommentThreadNotificationSubscribers(context.action(session4), {
                    documentId: document.id,
                    commentThreadId,
                    isFirstComment: false,
                }),
            ).toEqual({accountIds: new Set([session1.account.id])});

            const unknownAccountId = generateId<AccountId>();

            await createDocumentComment(context.action(session3), {
                documentId: document.id,
                commentThreadId,
                parentCommentIndex: null,
                content: assertMessageContent(
                    MessageContentProsemirrorSchema.node("doc", {}, [
                        MessageContentProsemirrorSchema.node("paragraph", {}, [
                            MessageContentProsemirrorSchema.text("Hello, "),
                            MessageContentProsemirrorSchema.node("mention", {
                                mention: {accountId: unknownAccountId},
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
                }),
            ).toEqual({
                accountIds: new Set([session1.account.id, session3.account.id, unknownAccountId]),
            });

            expect(
                await getDocumentCommentThreadNotificationSubscribers(context.action(session2), {
                    documentId: document.id,
                    commentThreadId,
                    isFirstComment: false,
                }),
            ).toEqual({
                accountIds: new Set([session1.account.id, session3.account.id, unknownAccountId]),
            });

            expect(
                await getDocumentCommentThreadNotificationSubscribers(context.action(session3), {
                    documentId: document.id,
                    commentThreadId,
                    isFirstComment: false,
                }),
            ).toEqual({
                accountIds: new Set([session1.account.id, session3.account.id, unknownAccountId]),
            });
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
                }),
            ).toEqual({accountIds: new Set([session1.account.id])});

            expect(
                await getDocumentCommentThreadNotificationSubscribers(context.action(session1), {
                    documentId: document.id,
                    commentThreadId,
                    isFirstComment: false,
                }),
            ).toEqual({accountIds: new Set([session1.account.id])});

            expect(
                await getDocumentCommentThreadNotificationSubscribers(context.action(session4), {
                    documentId: document.id,
                    commentThreadId,
                    isFirstComment: true,
                }),
            ).toEqual({accountIds: new Set([session1.account.id])});

            expect(
                await getDocumentCommentThreadNotificationSubscribers(context.action(session4), {
                    documentId: document.id,
                    commentThreadId,
                    isFirstComment: false,
                }),
            ).toEqual({accountIds: new Set([session1.account.id])});

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
                }),
            ).toEqual({
                accountIds: new Set([
                    session1.account.id,
                    session3.account.id,
                    otherSession.accountId,
                ]),
            });

            expect(
                await getDocumentCommentThreadNotificationSubscribers(context.action(session2), {
                    documentId: document.id,
                    commentThreadId,
                    isFirstComment: false,
                }),
            ).toEqual({
                accountIds: new Set([
                    session1.account.id,
                    session3.account.id,
                    otherSession.accountId,
                ]),
            });

            expect(
                await getDocumentCommentThreadNotificationSubscribers(context.action(session3), {
                    documentId: document.id,
                    commentThreadId,
                    isFirstComment: false,
                }),
            ).toEqual({
                accountIds: new Set([
                    session1.account.id,
                    session3.account.id,
                    otherSession.accountId,
                ]),
            });
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
                }),
            ).toEqual({accountIds: new Set([session1.account.id])});

            expect(
                await getDocumentCommentThreadNotificationSubscribers(context.action(session1), {
                    documentId: document.id,
                    commentThreadId,
                    isFirstComment: false,
                }),
            ).toEqual({accountIds: new Set([session1.account.id])});

            expect(
                await getDocumentCommentThreadNotificationSubscribers(context.action(session4), {
                    documentId: document.id,
                    commentThreadId,
                    isFirstComment: true,
                }),
            ).toEqual({accountIds: new Set([session1.account.id])});

            expect(
                await getDocumentCommentThreadNotificationSubscribers(context.action(session4), {
                    documentId: document.id,
                    commentThreadId,
                    isFirstComment: false,
                }),
            ).toEqual({accountIds: new Set([session1.account.id])});

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
                }),
            ).toEqual({
                accountIds: new Set([
                    session1.account.id,
                    session3.account.id,
                    session4.account.id,
                ]),
            });

            expect(
                await getDocumentCommentThreadNotificationSubscribers(context.action(session2), {
                    documentId: document.id,
                    commentThreadId,
                    isFirstComment: false,
                }),
            ).toEqual({
                accountIds: new Set([
                    session1.account.id,
                    session3.account.id,
                    session4.account.id,
                ]),
            });

            expect(
                await getDocumentCommentThreadNotificationSubscribers(context.action(session3), {
                    documentId: document.id,
                    commentThreadId,
                    isFirstComment: false,
                }),
            ).toEqual({
                accountIds: new Set([
                    session1.account.id,
                    session3.account.id,
                    session4.account.id,
                ]),
            });

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
                }),
            ).toEqual({
                accountIds: new Set([
                    session1.account.id,
                    session3.account.id,
                    session4.account.id,
                ]),
            });

            expect(
                await getDocumentCommentThreadNotificationSubscribers(context.action(session2), {
                    documentId: document.id,
                    commentThreadId,
                    isFirstComment: false,
                }),
            ).toEqual({
                accountIds: new Set([
                    session1.account.id,
                    session3.account.id,
                    session4.account.id,
                ]),
            });

            expect(
                await getDocumentCommentThreadNotificationSubscribers(context.action(session3), {
                    documentId: document.id,
                    commentThreadId,
                    isFirstComment: false,
                }),
            ).toEqual({
                accountIds: new Set([
                    session1.account.id,
                    session3.account.id,
                    session4.account.id,
                ]),
            });
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
                }),
            ).toEqual({accountIds: new Set([session1.account.id])});

            expect(
                await getDocumentCommentThreadNotificationSubscribers(context.action(session1), {
                    documentId: document.id,
                    commentThreadId,
                    isFirstComment: false,
                }),
            ).toEqual({accountIds: new Set([session1.account.id])});

            expect(
                await getDocumentCommentThreadNotificationSubscribers(context.action(session4), {
                    documentId: document.id,
                    commentThreadId,
                    isFirstComment: true,
                }),
            ).toEqual({accountIds: new Set([session1.account.id])});

            expect(
                await getDocumentCommentThreadNotificationSubscribers(context.action(session4), {
                    documentId: document.id,
                    commentThreadId,
                    isFirstComment: false,
                }),
            ).toEqual({accountIds: new Set([session1.account.id])});

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
                }),
            ).toEqual({
                accountIds: new Set([
                    session1.account.id,
                    session3.account.id,
                    session4.account.id,
                ]),
            });

            expect(
                await getDocumentCommentThreadNotificationSubscribers(context.action(session2), {
                    documentId: document.id,
                    commentThreadId,
                    isFirstComment: false,
                }),
            ).toEqual({
                accountIds: new Set([
                    session1.account.id,
                    session3.account.id,
                    session4.account.id,
                ]),
            });

            expect(
                await getDocumentCommentThreadNotificationSubscribers(context.action(session3), {
                    documentId: document.id,
                    commentThreadId,
                    isFirstComment: false,
                }),
            ).toEqual({
                accountIds: new Set([
                    session1.account.id,
                    session3.account.id,
                    session4.account.id,
                ]),
            });

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
                }),
            ).toEqual({
                accountIds: new Set([
                    session1.account.id,
                    session3.account.id,
                    session4.account.id,
                ]),
            });

            expect(
                await getDocumentCommentThreadNotificationSubscribers(context.action(session2), {
                    documentId: document.id,
                    commentThreadId,
                    isFirstComment: false,
                }),
            ).toEqual({
                accountIds: new Set([
                    session1.account.id,
                    session3.account.id,
                    session4.account.id,
                ]),
            });

            expect(
                await getDocumentCommentThreadNotificationSubscribers(context.action(session3), {
                    documentId: document.id,
                    commentThreadId,
                    isFirstComment: false,
                }),
            ).toEqual({
                accountIds: new Set([
                    session1.account.id,
                    session3.account.id,
                    session4.account.id,
                ]),
            });
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
                }),
            ).toEqual({accountIds: new Set([session1.account.id])});

            expect(
                await getDocumentCommentThreadNotificationSubscribers(context.action(session1), {
                    documentId: document.id,
                    commentThreadId,
                    isFirstComment: false,
                }),
            ).toEqual({accountIds: new Set([session1.account.id])});

            expect(
                await getDocumentCommentThreadNotificationSubscribers(context.action(session4), {
                    documentId: document.id,
                    commentThreadId,
                    isFirstComment: true,
                }),
            ).toEqual({accountIds: new Set([session1.account.id])});

            expect(
                await getDocumentCommentThreadNotificationSubscribers(context.action(session4), {
                    documentId: document.id,
                    commentThreadId,
                    isFirstComment: false,
                }),
            ).toEqual({accountIds: new Set([session1.account.id])});

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
                }),
            ).toEqual({accountIds: new Set([session1.account.id, session3.account.id])});

            expect(
                await getDocumentCommentThreadNotificationSubscribers(context.action(session2), {
                    documentId: document.id,
                    commentThreadId,
                    isFirstComment: false,
                }),
            ).toEqual({accountIds: new Set([session1.account.id, session3.account.id])});

            expect(
                await getDocumentCommentThreadNotificationSubscribers(context.action(session3), {
                    documentId: document.id,
                    commentThreadId,
                    isFirstComment: false,
                }),
            ).toEqual({accountIds: new Set([session1.account.id, session3.account.id])});

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
                }),
            ).toEqual({
                accountIds: new Set([
                    session1.account.id,
                    session3.account.id,
                    session4.account.id,
                ]),
            });

            expect(
                await getDocumentCommentThreadNotificationSubscribers(context.action(session2), {
                    documentId: document.id,
                    commentThreadId,
                    isFirstComment: false,
                }),
            ).toEqual({
                accountIds: new Set([
                    session1.account.id,
                    session3.account.id,
                    session4.account.id,
                ]),
            });

            expect(
                await getDocumentCommentThreadNotificationSubscribers(context.action(session3), {
                    documentId: document.id,
                    commentThreadId,
                    isFirstComment: false,
                }),
            ).toEqual({
                accountIds: new Set([
                    session1.account.id,
                    session3.account.id,
                    session4.account.id,
                ]),
            });
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
                }),
            ).toEqual({
                accountIds: new Set([
                    session1.account.id,
                    session5.account.id,
                    session2.account.id,
                ]),
            });

            expect(
                await getDocumentCommentThreadNotificationSubscribers(context.action(session1), {
                    documentId: document.id,
                    commentThreadId,
                    isFirstComment: false,
                }),
            ).toEqual({accountIds: new Set([session5.account.id, session2.account.id])});

            expect(
                await getDocumentCommentThreadNotificationSubscribers(context.action(session7), {
                    documentId: document.id,
                    commentThreadId,
                    isFirstComment: true,
                }),
            ).toEqual({
                accountIds: new Set([
                    session1.account.id,
                    session5.account.id,
                    session2.account.id,
                ]),
            });

            expect(
                await getDocumentCommentThreadNotificationSubscribers(context.action(session7), {
                    documentId: document.id,
                    commentThreadId,
                    isFirstComment: false,
                }),
            ).toEqual({accountIds: new Set([session5.account.id, session2.account.id])});

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
                }),
            ).toEqual({
                accountIds: new Set([
                    session1.account.id,
                    session5.account.id,
                    session2.account.id,
                ]),
            });

            expect(
                await getDocumentCommentThreadNotificationSubscribers(context.action(session1), {
                    documentId: document.id,
                    commentThreadId,
                    isFirstComment: false,
                }),
            ).toEqual({
                accountIds: new Set([
                    session5.account.id,
                    session1.account.id,
                    session2.account.id,
                ]),
            });

            expect(
                await getDocumentCommentThreadNotificationSubscribers(context.action(session7), {
                    documentId: document.id,
                    commentThreadId,
                    isFirstComment: true,
                }),
            ).toEqual({
                accountIds: new Set([
                    session1.account.id,
                    session5.account.id,
                    session2.account.id,
                ]),
            });

            expect(
                await getDocumentCommentThreadNotificationSubscribers(context.action(session7), {
                    documentId: document.id,
                    commentThreadId,
                    isFirstComment: false,
                }),
            ).toEqual({
                accountIds: new Set([
                    session5.account.id,
                    session1.account.id,
                    session2.account.id,
                ]),
            });

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
                }),
            ).toEqual({
                accountIds: new Set([
                    session1.account.id,
                    session5.account.id,
                    session3.account.id,
                    session2.account.id,
                ]),
            });

            expect(
                await getDocumentCommentThreadNotificationSubscribers(context.action(session1), {
                    documentId: document.id,
                    commentThreadId,
                    isFirstComment: false,
                }),
            ).toEqual({
                accountIds: new Set([
                    session5.account.id,
                    session1.account.id,
                    session3.account.id,
                    session2.account.id,
                ]),
            });

            expect(
                await getDocumentCommentThreadNotificationSubscribers(context.action(session7), {
                    documentId: document.id,
                    commentThreadId,
                    isFirstComment: true,
                }),
            ).toEqual({
                accountIds: new Set([
                    session1.account.id,
                    session5.account.id,
                    session3.account.id,
                    session2.account.id,
                ]),
            });

            expect(
                await getDocumentCommentThreadNotificationSubscribers(context.action(session7), {
                    documentId: document.id,
                    commentThreadId,
                    isFirstComment: false,
                }),
            ).toEqual({
                accountIds: new Set([
                    session5.account.id,
                    session1.account.id,
                    session3.account.id,
                    session2.account.id,
                ]),
            });

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
                }),
            ).toEqual({
                accountIds: new Set([
                    session1.account.id,
                    session5.account.id,
                    session3.account.id,
                    session2.account.id,
                    session4.account.id,
                ]),
            });

            expect(
                await getDocumentCommentThreadNotificationSubscribers(context.action(session1), {
                    documentId: document.id,
                    commentThreadId,
                    isFirstComment: false,
                }),
            ).toEqual({
                accountIds: new Set([
                    session5.account.id,
                    session1.account.id,
                    session3.account.id,
                    session2.account.id,
                    session4.account.id,
                ]),
            });

            expect(
                await getDocumentCommentThreadNotificationSubscribers(context.action(session7), {
                    documentId: document.id,
                    commentThreadId,
                    isFirstComment: true,
                }),
            ).toEqual({
                accountIds: new Set([
                    session1.account.id,
                    session5.account.id,
                    session3.account.id,
                    session2.account.id,
                    session4.account.id,
                ]),
            });

            expect(
                await getDocumentCommentThreadNotificationSubscribers(context.action(session7), {
                    documentId: document.id,
                    commentThreadId,
                    isFirstComment: false,
                }),
            ).toEqual({
                accountIds: new Set([
                    session5.account.id,
                    session1.account.id,
                    session3.account.id,
                    session2.account.id,
                    session4.account.id,
                ]),
            });

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
                }),
            ).toEqual({
                accountIds: new Set([
                    session1.account.id,
                    session5.account.id,
                    session3.account.id,
                    session2.account.id,
                    session4.account.id,
                    session6.account.id,
                ]),
            });

            expect(
                await getDocumentCommentThreadNotificationSubscribers(context.action(session1), {
                    documentId: document.id,
                    commentThreadId,
                    isFirstComment: false,
                }),
            ).toEqual({
                accountIds: new Set([
                    session5.account.id,
                    session1.account.id,
                    session3.account.id,
                    session2.account.id,
                    session4.account.id,
                    session6.account.id,
                ]),
            });

            expect(
                await getDocumentCommentThreadNotificationSubscribers(context.action(session7), {
                    documentId: document.id,
                    commentThreadId,
                    isFirstComment: true,
                }),
            ).toEqual({
                accountIds: new Set([
                    session1.account.id,
                    session5.account.id,
                    session3.account.id,
                    session2.account.id,
                    session4.account.id,
                    session6.account.id,
                ]),
            });

            expect(
                await getDocumentCommentThreadNotificationSubscribers(context.action(session7), {
                    documentId: document.id,
                    commentThreadId,
                    isFirstComment: false,
                }),
            ).toEqual({
                accountIds: new Set([
                    session5.account.id,
                    session1.account.id,
                    session3.account.id,
                    session2.account.id,
                    session4.account.id,
                    session6.account.id,
                ]),
            });
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

    test("creating a comment thread does not return an updated comment thread", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();

        const document = await TestDocument.create(session);

        const {range} = await document.type(session, "Hello");
        await document.type(session, ", world!");

        const commentThreadId = generateId<DocumentCommentThreadId>();

        const {updatedCommentThreads} = await document.update(
            session,
            [new AddMarkStep(range.from, range.to, schema.marks.comment.create({commentThreadId}))],
            {
                createCommentThreads: [
                    {
                        commentThreadId,
                        initialCommentContent: createSimpleMessageContent("test1"),
                    },
                ],
            },
        );

        expect(updatedCommentThreads.length).toEqual(0);
    });

    test("can resolve comment thread", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();

        const document = await TestDocument.create(session);

        const {range} = await document.type(session, "Hello");
        await document.type(session, ", world!");

        const commentThread = await document.createCommentThread(session, range, "test1");

        expect(await commentThread.get(session)).toEqual(
            new DocumentCommentThreadModel({
                id: commentThread.id,
                documentId: document.id,
                createdTime: expect.any(Date),
                version: 0,
                fallbackContentSnippet: null,
                isResolved: false,
                commentCount: 1,
                lastCommentChangeTime: null,
                firstCommentAuthor: await session.get(),
            }),
        );

        const {updatedCommentThreads} = await document.update(
            session,
            [
                new RemoveAllMarksStep(
                    schema.marks.comment.create({commentThreadId: commentThread.id}),
                ),
            ],
            {resolveCommentThreadIds: [commentThread.id]},
        );

        expect(updatedCommentThreads.length).toEqual(1);
        expect(updatedCommentThreads[0]).toEqual(await commentThread.get(session));
        expect(updatedCommentThreads[0]).toEqual(
            new DocumentCommentThreadModel({
                id: commentThread.id,
                documentId: document.id,
                createdTime: expect.any(Date),
                version: 1,
                fallbackContentSnippet: expect.any(Object),
                isResolved: true,
                commentCount: 1,
                lastCommentChangeTime: null,
                firstCommentAuthor: await session.get(),
            }),
        );
    });

    test("can double resolve comment thread", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();

        const document = await TestDocument.create(session);

        const {range} = await document.type(session, "Hello");
        await document.type(session, ", world!");

        const commentThread = await document.createCommentThread(session, range, "test1");

        expect(await commentThread.get(session)).toEqual(
            new DocumentCommentThreadModel({
                id: commentThread.id,
                documentId: document.id,
                createdTime: expect.any(Date),
                version: 0,
                fallbackContentSnippet: null,
                isResolved: false,
                commentCount: 1,
                lastCommentChangeTime: null,
                firstCommentAuthor: await session.get(),
            }),
        );

        {
            const {updatedCommentThreads} = await document.update(
                session,
                [
                    new RemoveAllMarksStep(
                        schema.marks.comment.create({commentThreadId: commentThread.id}),
                    ),
                ],
                {resolveCommentThreadIds: [commentThread.id]},
            );

            expect(updatedCommentThreads.length).toEqual(1);
            expect(updatedCommentThreads[0]).toEqual(await commentThread.get(session));
            expect(updatedCommentThreads[0]).toEqual(
                new DocumentCommentThreadModel({
                    id: commentThread.id,
                    documentId: document.id,
                    createdTime: expect.any(Date),
                    version: 1,
                    fallbackContentSnippet: expect.any(Object),
                    isResolved: true,
                    commentCount: 1,
                    lastCommentChangeTime: null,
                    firstCommentAuthor: await session.get(),
                }),
            );

            const resolvedCommentThreadRanges = await getResolvedDocumentCommentThreadRanges(
                session.action(),
                {
                    documentId: document.id,
                    commentThreadId: commentThread.id,
                },
            );

            expect(resolvedCommentThreadRanges).toEqual({
                version: 4,
                ranges: [range],
            });
        }

        {
            const {updatedCommentThreads} = await document.update(
                session,
                [
                    new RemoveAllMarksStep(
                        schema.marks.comment.create({commentThreadId: commentThread.id}),
                    ),
                ],
                {resolveCommentThreadIds: [commentThread.id]},
            );

            expect(updatedCommentThreads.length).toEqual(1);
            expect(updatedCommentThreads[0]).toEqual(await commentThread.get(session));
            expect(updatedCommentThreads[0]).toEqual(
                new DocumentCommentThreadModel({
                    id: commentThread.id,
                    documentId: document.id,
                    createdTime: expect.any(Date),
                    version: 1,
                    fallbackContentSnippet: expect.any(Object),
                    isResolved: true,
                    commentCount: 1,
                    lastCommentChangeTime: null,
                    firstCommentAuthor: await session.get(),
                }),
            );

            const resolvedCommentThreadRanges = await getResolvedDocumentCommentThreadRanges(
                session.action(),
                {
                    documentId: document.id,
                    commentThreadId: commentThread.id,
                },
            );

            expect(resolvedCommentThreadRanges).toEqual({
                version: 4,
                ranges: [range],
            });
        }
    });

    test("can't resolve comment thread which doesn't exist", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();

        const document = await TestDocument.create(session);

        await document.type(session, "Hello");
        await document.type(session, ", world!");

        const fakeCommentThreadId = generateId<DocumentCommentThreadId>();

        expect((await getDocument(session.action(), document.id)).version).toEqual(2);

        await expect(
            document.update(
                session,
                [
                    new RemoveAllMarksStep(
                        schema.marks.comment.create({commentThreadId: fakeCommentThreadId}),
                    ),
                ],
                {resolveCommentThreadIds: [fakeCommentThreadId]},
            ),
        ).rejects.toThrow(NotFoundError);

        expect((await getDocument(session.action(), document.id)).version).toEqual(2);
    });

    test("can't resolve comment thread if there are no other steps", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();

        const document = await TestDocument.create(session);

        const {range} = await document.type(session, "Hello");
        await document.type(session, ", world!");

        const commentThread = await document.createCommentThread(session, range, "test1");

        expect(await commentThread.get(session)).toEqual(
            new DocumentCommentThreadModel({
                id: commentThread.id,
                documentId: document.id,
                createdTime: expect.any(Date),
                version: 0,
                fallbackContentSnippet: null,
                isResolved: false,
                commentCount: 1,
                lastCommentChangeTime: null,
                firstCommentAuthor: await session.get(),
            }),
        );

        await expect(
            document.update(session, [], {resolveCommentThreadIds: [commentThread.id]}),
        ).rejects.toThrow(InvalidArgumentError);
    });

    test("can't resolve comment thread if there isn't a `removeAllMarks` step", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();

        const document = await TestDocument.create(session);

        const {range} = await document.type(session, "Hello");
        await document.type(session, ", world!");

        const commentThread = await document.createCommentThread(session, range, "test1");

        expect(await commentThread.get(session)).toEqual(
            new DocumentCommentThreadModel({
                id: commentThread.id,
                documentId: document.id,
                createdTime: expect.any(Date),
                version: 0,
                fallbackContentSnippet: null,
                isResolved: false,
                commentCount: 1,
                lastCommentChangeTime: null,
                firstCommentAuthor: await session.get(),
            }),
        );

        await expect(
            document.update(
                session,
                [
                    new RemoveMarkStep(
                        range.from,
                        range.to,
                        schema.marks.comment.create({commentThreadId: commentThread.id}),
                    ),
                ],
                {resolveCommentThreadIds: [commentThread.id]},
            ),
        ).rejects.toThrow(InvalidArgumentError);
    });

    test("can't resolve comment thread if there is a `removeAllMarks` step for a different comment thread", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();

        const document = await TestDocument.create(session);

        const {range} = await document.type(session, "Hello");
        await document.type(session, ", world!");

        const commentThread = await document.createCommentThread(session, range, "test1");

        expect(await commentThread.get(session)).toEqual(
            new DocumentCommentThreadModel({
                id: commentThread.id,
                documentId: document.id,
                createdTime: expect.any(Date),
                version: 0,
                fallbackContentSnippet: null,
                isResolved: false,
                commentCount: 1,
                lastCommentChangeTime: null,
                firstCommentAuthor: await session.get(),
            }),
        );

        await expect(
            document.update(
                session,
                [
                    new RemoveAllMarksStep(
                        schema.marks.comment.create({commentThreadId: generateId()}),
                    ),
                ],
                {resolveCommentThreadIds: [commentThread.id]},
            ),
        ).rejects.toThrow(InvalidArgumentError);
    });

    test("can't resolve comment thread if there is another step alongside a `removeAllMarks` step", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();

        const document = await TestDocument.create(session);

        const {range: range1} = await document.type(session, "Hello");
        const {range: range2} = await document.type(session, ", world!");

        const commentThread = await document.createCommentThread(session, range2, "test1");

        expect(await commentThread.get(session)).toEqual(
            new DocumentCommentThreadModel({
                id: commentThread.id,
                documentId: document.id,
                createdTime: expect.any(Date),
                version: 0,
                fallbackContentSnippet: null,
                isResolved: false,
                commentCount: 1,
                lastCommentChangeTime: null,
                firstCommentAuthor: await session.get(),
            }),
        );

        await expect(
            document.update(
                session,
                [
                    new RemoveAllMarksStep(
                        schema.marks.comment.create({commentThreadId: commentThread.id}),
                    ),
                    new ReplaceStep(range1.from, range1.to, textSlice("Hellloooooo")),
                ],
                {resolveCommentThreadIds: [commentThread.id]},
            ),
        ).rejects.toThrow(
            new InvalidArgumentError(
                "Can only update with `removeAllMarks` steps when resolving a comment thread",
            ),
        );
    });

    test("can resolve multiple comment threads at once", async () => {
        const space = await TestSpace.create(context);
        const session1 = await space.createSession();
        const session2 = await space.createSession();

        const document = await TestDocument.create(session1);

        const {range: range1} = await document.type(session1, "Hello");
        await document.type(session1, " ");
        const {range: range2} = await document.type(session1, "wonderful");
        await document.type(session1, " ");
        const {range: range3} = await document.type(session1, "world");
        await document.type(session1, "!");

        const commentThread1 = await document.createCommentThread(session1, range1, "test1");
        const commentThread2 = await document.createCommentThread(session2, range2, "test2");
        const commentThread3 = await document.createCommentThread(session1, range3, "test3");

        expect(await commentThread1.get(session1)).toEqual(
            new DocumentCommentThreadModel({
                id: commentThread1.id,
                documentId: document.id,
                createdTime: expect.any(Date),
                version: 0,
                fallbackContentSnippet: null,
                isResolved: false,
                commentCount: 1,
                lastCommentChangeTime: null,
                firstCommentAuthor: await session1.get(),
            }),
        );
        expect(await commentThread2.get(session1)).toEqual(
            new DocumentCommentThreadModel({
                id: commentThread2.id,
                documentId: document.id,
                createdTime: expect.any(Date),
                version: 0,
                fallbackContentSnippet: null,
                isResolved: false,
                commentCount: 1,
                lastCommentChangeTime: null,
                firstCommentAuthor: await session2.get(),
            }),
        );
        expect(await commentThread3.get(session1)).toEqual(
            new DocumentCommentThreadModel({
                id: commentThread3.id,
                documentId: document.id,
                createdTime: expect.any(Date),
                version: 0,
                fallbackContentSnippet: null,
                isResolved: false,
                commentCount: 1,
                lastCommentChangeTime: null,
                firstCommentAuthor: await session1.get(),
            }),
        );

        const {updatedCommentThreads} = await document.update(
            session1,
            [
                new RemoveAllMarksStep(
                    schema.marks.comment.create({commentThreadId: commentThread2.id}),
                ),
                new RemoveAllMarksStep(
                    schema.marks.comment.create({commentThreadId: commentThread1.id}),
                ),
                new RemoveAllMarksStep(
                    schema.marks.comment.create({commentThreadId: commentThread3.id}),
                ),
            ],
            {resolveCommentThreadIds: [commentThread1.id, commentThread2.id, commentThread3.id]},
        );

        expect(updatedCommentThreads.length).toEqual(3);
        expect(updatedCommentThreads.find(({id}) => id === commentThread1.id)).toEqual(
            await commentThread1.get(session1),
        );
        expect(updatedCommentThreads.find(({id}) => id === commentThread2.id)).toEqual(
            await commentThread2.get(session1),
        );
        expect(updatedCommentThreads.find(({id}) => id === commentThread3.id)).toEqual(
            await commentThread3.get(session1),
        );
        expect(updatedCommentThreads.find(({id}) => id === commentThread1.id)).toEqual(
            new DocumentCommentThreadModel({
                id: commentThread1.id,
                documentId: document.id,
                createdTime: expect.any(Date),
                version: 1,
                fallbackContentSnippet: {
                    doc: schema.node("doc", {}, [
                        schema.node("title"),
                        schema.node("paragraph", {}, [
                            schema.text("Hello", [
                                schema.mark("comment", {commentThreadId: commentThread1.id}),
                            ]),
                            schema.text(" wonderful world!"),
                        ]),
                    ]),
                    references: emptyDocumentContentReferences,
                },
                isResolved: true,
                commentCount: 1,
                lastCommentChangeTime: null,
                firstCommentAuthor: await session1.get(),
            }),
        );
        expect(updatedCommentThreads.find(({id}) => id === commentThread2.id)).toEqual(
            new DocumentCommentThreadModel({
                id: commentThread2.id,
                documentId: document.id,
                createdTime: expect.any(Date),
                version: 1,
                fallbackContentSnippet: {
                    doc: schema.node("doc", {}, [
                        schema.node("title"),
                        schema.node("paragraph", {}, [
                            schema.text("Hello "),
                            schema.text("wonderful", [
                                schema.mark("comment", {commentThreadId: commentThread2.id}),
                            ]),
                            schema.text(" world!"),
                        ]),
                    ]),
                    references: emptyDocumentContentReferences,
                },
                isResolved: true,
                commentCount: 1,
                lastCommentChangeTime: null,
                firstCommentAuthor: await session2.get(),
            }),
        );
        expect(updatedCommentThreads.find(({id}) => id === commentThread3.id)).toEqual(
            new DocumentCommentThreadModel({
                id: commentThread3.id,
                documentId: document.id,
                createdTime: expect.any(Date),
                version: 1,
                fallbackContentSnippet: {
                    doc: schema.node("doc", {}, [
                        schema.node("title"),
                        schema.node("paragraph", {}, [
                            schema.text("Hello wonderful "),
                            schema.text("world", [
                                schema.mark("comment", {commentThreadId: commentThread3.id}),
                            ]),
                            schema.text("!"),
                        ]),
                    ]),
                    references: emptyDocumentContentReferences,
                },
                isResolved: true,
                commentCount: 1,
                lastCommentChangeTime: null,
                firstCommentAuthor: await session1.get(),
            }),
        );
    });

    test("can unresolve comment thread", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();

        const document = await TestDocument.create(session);

        const {range} = await document.type(session, "Hello");
        await document.type(session, ", world!");

        const commentThread = await document.createCommentThread(session, range, "test1");

        expect(await commentThread.get(session)).toEqual(
            new DocumentCommentThreadModel({
                id: commentThread.id,
                documentId: document.id,
                createdTime: expect.any(Date),
                version: 0,
                fallbackContentSnippet: null,
                isResolved: false,
                commentCount: 1,
                lastCommentChangeTime: null,
                firstCommentAuthor: await session.get(),
            }),
        );

        {
            const {updatedCommentThreads} = await document.update(
                session,
                [
                    new RemoveAllMarksStep(
                        schema.marks.comment.create({commentThreadId: commentThread.id}),
                    ),
                ],
                {resolveCommentThreadIds: [commentThread.id]},
            );

            expect(updatedCommentThreads.length).toEqual(1);
            expect(updatedCommentThreads[0]).toEqual(await commentThread.get(session));
            expect(updatedCommentThreads[0]).toEqual(
                new DocumentCommentThreadModel({
                    id: commentThread.id,
                    documentId: document.id,
                    createdTime: expect.any(Date),
                    version: 1,
                    fallbackContentSnippet: expect.any(Object),
                    isResolved: true,
                    commentCount: 1,
                    lastCommentChangeTime: null,
                    firstCommentAuthor: await session.get(),
                }),
            );
        }

        {
            const resolvedCommentThreadRanges = await getResolvedDocumentCommentThreadRanges(
                session.action(),
                {
                    documentId: document.id,
                    commentThreadId: commentThread.id,
                },
            );

            expect(resolvedCommentThreadRanges).toEqual({
                version: 4,
                ranges: [range],
            });

            const {updatedCommentThreads} = await updateDocumentContent(session.action(), {
                id: document.id,
                version: resolvedCommentThreadRanges.version,
                steps: [
                    new AddMarksAfterRemoveAllStep(
                        schema.marks.comment.create({commentThreadId: commentThread.id}),
                        resolvedCommentThreadRanges.ranges,
                    ),
                ],
                unresolveCommentThreadIds: [commentThread.id],
                clientId: generateId(),
            });

            expect(updatedCommentThreads.length).toEqual(1);
            expect(updatedCommentThreads[0]).toEqual(await commentThread.get(session));
            expect(updatedCommentThreads[0]).toEqual(
                new DocumentCommentThreadModel({
                    id: commentThread.id,
                    documentId: document.id,
                    createdTime: expect.any(Date),
                    version: 2,
                    fallbackContentSnippet: expect.any(Object),
                    isResolved: false,
                    commentCount: 1,
                    lastCommentChangeTime: null,
                    firstCommentAuthor: await session.get(),
                }),
            );
        }
    });

    test("can double unresolve comment thread", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();

        const document = await TestDocument.create(session);

        const {range} = await document.type(session, "Hello");
        await document.type(session, ", world!");

        const commentThread = await document.createCommentThread(session, range, "test1");

        expect(await commentThread.get(session)).toEqual(
            new DocumentCommentThreadModel({
                id: commentThread.id,
                documentId: document.id,
                createdTime: expect.any(Date),
                version: 0,
                fallbackContentSnippet: null,
                isResolved: false,
                commentCount: 1,
                lastCommentChangeTime: null,
                firstCommentAuthor: await session.get(),
            }),
        );

        {
            const {updatedCommentThreads} = await document.update(
                session,
                [
                    new RemoveAllMarksStep(
                        schema.marks.comment.create({commentThreadId: commentThread.id}),
                    ),
                ],
                {resolveCommentThreadIds: [commentThread.id]},
            );

            expect(updatedCommentThreads.length).toEqual(1);
            expect(updatedCommentThreads[0]).toEqual(await commentThread.get(session));
            expect(updatedCommentThreads[0]).toEqual(
                new DocumentCommentThreadModel({
                    id: commentThread.id,
                    documentId: document.id,
                    createdTime: expect.any(Date),
                    version: 1,
                    fallbackContentSnippet: expect.any(Object),
                    isResolved: true,
                    commentCount: 1,
                    lastCommentChangeTime: null,
                    firstCommentAuthor: await session.get(),
                }),
            );
        }

        const resolvedCommentThreadRanges = await getResolvedDocumentCommentThreadRanges(
            session.action(),
            {
                documentId: document.id,
                commentThreadId: commentThread.id,
            },
        );

        expect(resolvedCommentThreadRanges).toEqual({
            version: 4,
            ranges: [range],
        });

        {
            const {updatedCommentThreads} = await updateDocumentContent(session.action(), {
                id: document.id,
                version: resolvedCommentThreadRanges.version,
                steps: [
                    new AddMarksAfterRemoveAllStep(
                        schema.marks.comment.create({commentThreadId: commentThread.id}),
                        resolvedCommentThreadRanges.ranges,
                    ),
                ],
                unresolveCommentThreadIds: [commentThread.id],
                clientId: generateId(),
            });

            expect(updatedCommentThreads.length).toEqual(1);
            expect(updatedCommentThreads[0]).toEqual(await commentThread.get(session));
            expect(updatedCommentThreads[0]).toEqual(
                new DocumentCommentThreadModel({
                    id: commentThread.id,
                    documentId: document.id,
                    createdTime: expect.any(Date),
                    version: 2,
                    fallbackContentSnippet: expect.any(Object),
                    isResolved: false,
                    commentCount: 1,
                    lastCommentChangeTime: null,
                    firstCommentAuthor: await session.get(),
                }),
            );
        }

        {
            const {updatedCommentThreads} = await updateDocumentContent(session.action(), {
                id: document.id,
                version: resolvedCommentThreadRanges.version,
                steps: [
                    new AddMarksAfterRemoveAllStep(
                        schema.marks.comment.create({commentThreadId: commentThread.id}),
                        resolvedCommentThreadRanges.ranges,
                    ),
                ],
                unresolveCommentThreadIds: [commentThread.id],
                clientId: generateId(),
            });

            expect(updatedCommentThreads.length).toEqual(1);
            expect(updatedCommentThreads[0]).toEqual(await commentThread.get(session));
            expect(updatedCommentThreads[0]).toEqual(
                new DocumentCommentThreadModel({
                    id: commentThread.id,
                    documentId: document.id,
                    createdTime: expect.any(Date),
                    version: 2,
                    fallbackContentSnippet: expect.any(Object),
                    isResolved: false,
                    commentCount: 1,
                    lastCommentChangeTime: null,
                    firstCommentAuthor: await session.get(),
                }),
            );
        }
    });

    test("can unresolve comment thread when there are no ranges", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();

        const document = await TestDocument.create(session);

        const {range} = await document.type(session, "Hello");
        await document.type(session, ", world!");

        const commentThread = await document.createCommentThread(session, range, "test1");

        expect((await getDocument(session.action(), document.id)).content.doc.toJSON()).toEqual(
            schema
                .node("doc", {}, [
                    schema.node("title"),
                    schema.node("paragraph", {}, [
                        schema.text("Hello", [
                            schema.mark("comment", {commentThreadId: commentThread.id}),
                        ]),
                        schema.text(", world!"),
                    ]),
                ])
                .toJSON(),
        );

        await document.update(session, [new ReplaceStep(range.from, range.to, textSlice(""))]);

        expect((await getDocument(session.action(), document.id)).content.doc.toJSON()).toEqual(
            schema
                .node("doc", {}, [
                    schema.node("title"),
                    schema.node("paragraph", {}, [schema.text(", world!")]),
                ])
                .toJSON(),
        );

        await commentThread.resolve(session);

        expect((await getDocument(session.action(), document.id)).content.doc.toJSON()).toEqual(
            schema
                .node("doc", {}, [
                    schema.node("title"),
                    schema.node("paragraph", {}, [schema.text(", world!")]),
                ])
                .toJSON(),
        );

        {
            const resolvedCommentThreadRanges = await getResolvedDocumentCommentThreadRanges(
                session.action(),
                {
                    documentId: document.id,
                    commentThreadId: commentThread.id,
                },
            );

            expect(resolvedCommentThreadRanges).toEqual({
                version: 5,
                ranges: [],
            });

            const {updatedCommentThreads} = await updateDocumentContent(session.action(), {
                id: document.id,
                version: resolvedCommentThreadRanges.version,
                steps: [
                    new AddMarksAfterRemoveAllStep(
                        schema.marks.comment.create({commentThreadId: commentThread.id}),
                        resolvedCommentThreadRanges.ranges,
                    ),
                ],
                unresolveCommentThreadIds: [commentThread.id],
                clientId: generateId(),
            });

            expect(updatedCommentThreads.length).toEqual(1);
            expect(updatedCommentThreads[0]).toEqual(await commentThread.get(session));
            expect(updatedCommentThreads[0]).toEqual(
                new DocumentCommentThreadModel({
                    id: commentThread.id,
                    documentId: document.id,
                    createdTime: expect.any(Date),
                    version: 3,
                    fallbackContentSnippet: {
                        doc: schema.node("doc", {}, [
                            schema.node("title"),
                            schema.node("paragraph", {}, [
                                schema.text("Hello", [
                                    schema.mark("comment", {commentThreadId: commentThread.id}),
                                ]),
                                schema.text(", world!"),
                            ]),
                        ]),
                        references: emptyDocumentContentReferences,
                    },
                    isResolved: false,
                    commentCount: 1,
                    lastCommentChangeTime: null,
                    firstCommentAuthor: await session.get(),
                }),
            );
        }

        expect((await getDocument(session.action(), document.id)).content.doc.toJSON()).toEqual(
            schema
                .node("doc", {}, [
                    schema.node("title"),
                    schema.node("paragraph", {}, [schema.text(", world!")]),
                ])
                .toJSON(),
        );
    });

    test("can unresolve comment thread when there are multiple ranges", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();

        const document = await TestDocument.create(session);

        const {range: range1} = await document.type(session, "Hello");
        await document.type(session, " ");
        const {range: range2} = await document.type(session, "wonderful");
        await document.type(session, " ");
        const {range: range3} = await document.type(session, "world");
        await document.type(session, "!");

        const commentThread = await document.createCommentThread(session, range1, "test1");

        await document.update(session, [
            new AddMarkStep(
                range2.from,
                range2.to,
                schema.mark("comment", {commentThreadId: commentThread.id}),
            ),
            new AddMarkStep(
                range3.from,
                range3.to,
                schema.mark("comment", {commentThreadId: commentThread.id}),
            ),
        ]);

        expect((await getDocument(session.action(), document.id)).content.doc.toJSON()).toEqual(
            schema
                .node("doc", {}, [
                    schema.node("title"),
                    schema.node("paragraph", {}, [
                        schema.text("Hello", [
                            schema.mark("comment", {commentThreadId: commentThread.id}),
                        ]),
                        schema.text(" "),
                        schema.text("wonderful", [
                            schema.mark("comment", {commentThreadId: commentThread.id}),
                        ]),
                        schema.text(" "),
                        schema.text("world", [
                            schema.mark("comment", {commentThreadId: commentThread.id}),
                        ]),
                        schema.text("!"),
                    ]),
                ])
                .toJSON(),
        );

        await commentThread.resolve(session);

        expect((await getDocument(session.action(), document.id)).content.doc.toJSON()).toEqual(
            schema
                .node("doc", {}, [
                    schema.node("title"),
                    schema.node("paragraph", {}, [schema.text("Hello wonderful world!")]),
                ])
                .toJSON(),
        );

        {
            const resolvedCommentThreadRanges = await getResolvedDocumentCommentThreadRanges(
                session.action(),
                {
                    documentId: document.id,
                    commentThreadId: commentThread.id,
                },
            );

            expect(resolvedCommentThreadRanges).toEqual({
                version: 10,
                ranges: [range1, range2, range3],
            });

            const {updatedCommentThreads} = await updateDocumentContent(session.action(), {
                id: document.id,
                version: resolvedCommentThreadRanges.version,
                steps: [
                    new AddMarksAfterRemoveAllStep(
                        schema.marks.comment.create({commentThreadId: commentThread.id}),
                        resolvedCommentThreadRanges.ranges,
                    ),
                ],
                unresolveCommentThreadIds: [commentThread.id],
                clientId: generateId(),
            });

            expect(updatedCommentThreads.length).toEqual(1);
            expect(updatedCommentThreads[0]).toEqual(await commentThread.get(session));
            expect(updatedCommentThreads[0]).toEqual(
                new DocumentCommentThreadModel({
                    id: commentThread.id,
                    documentId: document.id,
                    createdTime: expect.any(Date),
                    version: 2,
                    fallbackContentSnippet: {
                        doc: schema.node("doc", {}, [
                            schema.node("title"),
                            schema.node("paragraph", {}, [
                                schema.text("Hello", [
                                    schema.mark("comment", {commentThreadId: commentThread.id}),
                                ]),
                                schema.text(" "),
                                schema.text("wonderful", [
                                    schema.mark("comment", {commentThreadId: commentThread.id}),
                                ]),
                                schema.text(" "),
                                schema.text("world", [
                                    schema.mark("comment", {commentThreadId: commentThread.id}),
                                ]),
                                schema.text("!"),
                            ]),
                        ]),
                        references: emptyDocumentContentReferences,
                    },
                    isResolved: false,
                    commentCount: 1,
                    lastCommentChangeTime: null,
                    firstCommentAuthor: await session.get(),
                }),
            );
        }

        expect((await getDocument(session.action(), document.id)).content.doc.toJSON()).toEqual(
            schema
                .node("doc", {}, [
                    schema.node("title"),
                    schema.node("paragraph", {}, [
                        schema.text("Hello", [
                            schema.mark("comment", {commentThreadId: commentThread.id}),
                        ]),
                        schema.text(" "),
                        schema.text("wonderful", [
                            schema.mark("comment", {commentThreadId: commentThread.id}),
                        ]),
                        schema.text(" "),
                        schema.text("world", [
                            schema.mark("comment", {commentThreadId: commentThread.id}),
                        ]),
                        schema.text("!"),
                    ]),
                ])
                .toJSON(),
        );
    });

    test("can't unresolve comment thread which doesn't exist", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();

        const document = await TestDocument.create(session);

        const {range} = await document.type(session, "Hello");
        await document.type(session, ", world!");

        const commentThread = await document.createCommentThread(session, range, "test1");
        const fakeCommentThreadId = generateId<DocumentCommentThreadId>();

        expect(await commentThread.get(session)).toEqual(
            new DocumentCommentThreadModel({
                id: commentThread.id,
                documentId: document.id,
                createdTime: expect.any(Date),
                version: 0,
                fallbackContentSnippet: null,
                isResolved: false,
                commentCount: 1,
                lastCommentChangeTime: null,
                firstCommentAuthor: await session.get(),
            }),
        );

        {
            const {updatedCommentThreads} = await document.update(
                session,
                [
                    new RemoveAllMarksStep(
                        schema.marks.comment.create({commentThreadId: commentThread.id}),
                    ),
                ],
                {resolveCommentThreadIds: [commentThread.id]},
            );

            expect(updatedCommentThreads.length).toEqual(1);
            expect(updatedCommentThreads[0]).toEqual(await commentThread.get(session));
            expect(updatedCommentThreads[0]).toEqual(
                new DocumentCommentThreadModel({
                    id: commentThread.id,
                    documentId: document.id,
                    createdTime: expect.any(Date),
                    version: 1,
                    fallbackContentSnippet: expect.any(Object),
                    isResolved: true,
                    commentCount: 1,
                    lastCommentChangeTime: null,
                    firstCommentAuthor: await session.get(),
                }),
            );
        }

        {
            const resolvedCommentThreadRanges = await getResolvedDocumentCommentThreadRanges(
                session.action(),
                {
                    documentId: document.id,
                    commentThreadId: commentThread.id,
                },
            );

            expect(resolvedCommentThreadRanges).toEqual({
                version: 4,
                ranges: [range],
            });

            expect((await getDocument(session.action(), document.id)).version).toEqual(4);

            await expect(
                updateDocumentContent(session.action(), {
                    id: document.id,
                    version: resolvedCommentThreadRanges.version,
                    steps: [
                        new AddMarksAfterRemoveAllStep(
                            schema.marks.comment.create({commentThreadId: fakeCommentThreadId}),
                            resolvedCommentThreadRanges.ranges,
                        ),
                    ],
                    unresolveCommentThreadIds: [fakeCommentThreadId],
                    clientId: generateId(),
                }),
            ).rejects.toThrow(NotFoundError);

            expect((await getDocument(session.action(), document.id)).version).toEqual(4);
        }
    });

    test("can't unresolve comment thread if there's no `addMarksAfterRemoveAll` step", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();

        const document = await TestDocument.create(session);

        const {range} = await document.type(session, "Hello");
        await document.type(session, ", world!");

        const commentThread = await document.createCommentThread(session, range, "test1");

        expect(await commentThread.get(session)).toEqual(
            new DocumentCommentThreadModel({
                id: commentThread.id,
                documentId: document.id,
                createdTime: expect.any(Date),
                version: 0,
                fallbackContentSnippet: null,
                isResolved: false,
                commentCount: 1,
                lastCommentChangeTime: null,
                firstCommentAuthor: await session.get(),
            }),
        );

        {
            const {updatedCommentThreads} = await document.update(
                session,
                [
                    new RemoveAllMarksStep(
                        schema.marks.comment.create({commentThreadId: commentThread.id}),
                    ),
                ],
                {resolveCommentThreadIds: [commentThread.id]},
            );

            expect(updatedCommentThreads.length).toEqual(1);
            expect(updatedCommentThreads[0]).toEqual(await commentThread.get(session));
            expect(updatedCommentThreads[0]).toEqual(
                new DocumentCommentThreadModel({
                    id: commentThread.id,
                    documentId: document.id,
                    createdTime: expect.any(Date),
                    version: 1,
                    fallbackContentSnippet: expect.any(Object),
                    isResolved: true,
                    commentCount: 1,
                    lastCommentChangeTime: null,
                    firstCommentAuthor: await session.get(),
                }),
            );
        }

        {
            const resolvedCommentThreadRanges = await getResolvedDocumentCommentThreadRanges(
                session.action(),
                {
                    documentId: document.id,
                    commentThreadId: commentThread.id,
                },
            );

            expect(resolvedCommentThreadRanges).toEqual({
                version: 4,
                ranges: [range],
            });

            await expect(
                updateDocumentContent(session.action(), {
                    id: document.id,
                    version: resolvedCommentThreadRanges.version,
                    steps: [
                        new AddMarkStep(
                            range.from,
                            range.to,
                            schema.marks.comment.create({commentThreadId: commentThread.id}),
                        ),
                    ],
                    unresolveCommentThreadIds: [commentThread.id],
                    clientId: generateId(),
                }),
            ).rejects.toThrow(InvalidArgumentError);
        }
    });

    test("can't unresolve comment thread if there's an `addMarksAfterRemoveAll` step for the wrong comment thread", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();

        const document = await TestDocument.create(session);

        const {range} = await document.type(session, "Hello");
        await document.type(session, ", world!");

        const commentThread = await document.createCommentThread(session, range, "test1");

        expect(await commentThread.get(session)).toEqual(
            new DocumentCommentThreadModel({
                id: commentThread.id,
                documentId: document.id,
                createdTime: expect.any(Date),
                version: 0,
                fallbackContentSnippet: null,
                isResolved: false,
                commentCount: 1,
                lastCommentChangeTime: null,
                firstCommentAuthor: await session.get(),
            }),
        );

        {
            const {updatedCommentThreads} = await document.update(
                session,
                [
                    new RemoveAllMarksStep(
                        schema.marks.comment.create({commentThreadId: commentThread.id}),
                    ),
                ],
                {resolveCommentThreadIds: [commentThread.id]},
            );

            expect(updatedCommentThreads.length).toEqual(1);
            expect(updatedCommentThreads[0]).toEqual(await commentThread.get(session));
            expect(updatedCommentThreads[0]).toEqual(
                new DocumentCommentThreadModel({
                    id: commentThread.id,
                    documentId: document.id,
                    createdTime: expect.any(Date),
                    version: 1,
                    fallbackContentSnippet: expect.any(Object),
                    isResolved: true,
                    commentCount: 1,
                    lastCommentChangeTime: null,
                    firstCommentAuthor: await session.get(),
                }),
            );
        }

        {
            const resolvedCommentThreadRanges = await getResolvedDocumentCommentThreadRanges(
                session.action(),
                {
                    documentId: document.id,
                    commentThreadId: commentThread.id,
                },
            );

            expect(resolvedCommentThreadRanges).toEqual({
                version: 4,
                ranges: [range],
            });

            await expect(
                updateDocumentContent(session.action(), {
                    id: document.id,
                    version: resolvedCommentThreadRanges.version,
                    steps: [
                        new AddMarksAfterRemoveAllStep(
                            schema.marks.comment.create({commentThreadId: generateId()}),
                            resolvedCommentThreadRanges.ranges,
                        ),
                    ],
                    unresolveCommentThreadIds: [commentThread.id],
                    clientId: generateId(),
                }),
            ).rejects.toThrow(InvalidArgumentError);
        }
    });

    test("can unresolve multiple comment threads at once", async () => {
        const space = await TestSpace.create(context);
        const session1 = await space.createSession();
        const session2 = await space.createSession();

        const document = await TestDocument.create(session1);

        const {range: range1} = await document.type(session1, "Hello");
        await document.type(session1, " ");
        const {range: range2} = await document.type(session1, "wonderful");
        await document.type(session1, " ");
        const {range: range3} = await document.type(session1, "world");
        await document.type(session1, "!");

        const commentThread1 = await document.createCommentThread(session1, range1, "test1");
        const commentThread2 = await document.createCommentThread(session2, range2, "test2");
        const commentThread3 = await document.createCommentThread(session1, range3, "test3");

        expect(await commentThread1.get(session1)).toEqual(
            new DocumentCommentThreadModel({
                id: commentThread1.id,
                documentId: document.id,
                createdTime: expect.any(Date),
                version: 0,
                fallbackContentSnippet: null,
                isResolved: false,
                commentCount: 1,
                lastCommentChangeTime: null,
                firstCommentAuthor: await session1.get(),
            }),
        );
        expect(await commentThread2.get(session1)).toEqual(
            new DocumentCommentThreadModel({
                id: commentThread2.id,
                documentId: document.id,
                createdTime: expect.any(Date),
                version: 0,
                fallbackContentSnippet: null,
                isResolved: false,
                commentCount: 1,
                lastCommentChangeTime: null,
                firstCommentAuthor: await session2.get(),
            }),
        );
        expect(await commentThread3.get(session1)).toEqual(
            new DocumentCommentThreadModel({
                id: commentThread3.id,
                documentId: document.id,
                createdTime: expect.any(Date),
                version: 0,
                fallbackContentSnippet: null,
                isResolved: false,
                commentCount: 1,
                lastCommentChangeTime: null,
                firstCommentAuthor: await session1.get(),
            }),
        );

        {
            const {updatedCommentThreads} = await document.update(
                session1,
                [
                    new RemoveAllMarksStep(
                        schema.marks.comment.create({commentThreadId: commentThread2.id}),
                    ),
                    new RemoveAllMarksStep(
                        schema.marks.comment.create({commentThreadId: commentThread1.id}),
                    ),
                    new RemoveAllMarksStep(
                        schema.marks.comment.create({commentThreadId: commentThread3.id}),
                    ),
                ],
                {
                    resolveCommentThreadIds: [
                        commentThread1.id,
                        commentThread2.id,
                        commentThread3.id,
                    ],
                },
            );

            expect(updatedCommentThreads.length).toEqual(3);
            expect(updatedCommentThreads.find(({id}) => id === commentThread1.id)).toEqual(
                await commentThread1.get(session1),
            );
            expect(updatedCommentThreads.find(({id}) => id === commentThread2.id)).toEqual(
                await commentThread2.get(session1),
            );
            expect(updatedCommentThreads.find(({id}) => id === commentThread3.id)).toEqual(
                await commentThread3.get(session1),
            );
            expect(updatedCommentThreads.find(({id}) => id === commentThread1.id)).toEqual(
                new DocumentCommentThreadModel({
                    id: commentThread1.id,
                    documentId: document.id,
                    createdTime: expect.any(Date),
                    version: 1,
                    fallbackContentSnippet: {
                        doc: schema.node("doc", {}, [
                            schema.node("title"),
                            schema.node("paragraph", {}, [
                                schema.text("Hello", [
                                    schema.mark("comment", {commentThreadId: commentThread1.id}),
                                ]),
                                schema.text(" wonderful world!"),
                            ]),
                        ]),
                        references: emptyDocumentContentReferences,
                    },
                    isResolved: true,
                    commentCount: 1,
                    lastCommentChangeTime: null,
                    firstCommentAuthor: await session1.get(),
                }),
            );
            expect(updatedCommentThreads.find(({id}) => id === commentThread2.id)).toEqual(
                new DocumentCommentThreadModel({
                    id: commentThread2.id,
                    documentId: document.id,
                    createdTime: expect.any(Date),
                    version: 1,
                    fallbackContentSnippet: {
                        doc: schema.node("doc", {}, [
                            schema.node("title"),
                            schema.node("paragraph", {}, [
                                schema.text("Hello "),
                                schema.text("wonderful", [
                                    schema.mark("comment", {commentThreadId: commentThread2.id}),
                                ]),
                                schema.text(" world!"),
                            ]),
                        ]),
                        references: emptyDocumentContentReferences,
                    },
                    isResolved: true,
                    commentCount: 1,
                    lastCommentChangeTime: null,
                    firstCommentAuthor: await session2.get(),
                }),
            );
            expect(updatedCommentThreads.find(({id}) => id === commentThread3.id)).toEqual(
                new DocumentCommentThreadModel({
                    id: commentThread3.id,
                    documentId: document.id,
                    createdTime: expect.any(Date),
                    version: 1,
                    fallbackContentSnippet: {
                        doc: schema.node("doc", {}, [
                            schema.node("title"),
                            schema.node("paragraph", {}, [
                                schema.text("Hello wonderful "),
                                schema.text("world", [
                                    schema.mark("comment", {commentThreadId: commentThread3.id}),
                                ]),
                                schema.text("!"),
                            ]),
                        ]),
                        references: emptyDocumentContentReferences,
                    },
                    isResolved: true,
                    commentCount: 1,
                    lastCommentChangeTime: null,
                    firstCommentAuthor: await session1.get(),
                }),
            );
        }

        {
            const {updatedCommentThreads} = await updateDocumentContent(session1.action(), {
                id: document.id,
                version: 9,
                steps: [
                    new AddMarksAfterRemoveAllStep(
                        schema.marks.comment.create({commentThreadId: commentThread1.id}),
                        [range1],
                    ),
                    new AddMarksAfterRemoveAllStep(
                        schema.marks.comment.create({commentThreadId: commentThread3.id}),
                        [range3],
                    ),
                    new AddMarksAfterRemoveAllStep(
                        schema.marks.comment.create({commentThreadId: commentThread2.id}),
                        [range2],
                    ),
                ],
                unresolveCommentThreadIds: [
                    commentThread1.id,
                    commentThread2.id,
                    commentThread3.id,
                ],
                clientId: generateId(),
            });

            expect(updatedCommentThreads.length).toEqual(3);
            expect(updatedCommentThreads.find(({id}) => id === commentThread1.id)).toEqual(
                await commentThread1.get(session1),
            );
            expect(updatedCommentThreads.find(({id}) => id === commentThread2.id)).toEqual(
                await commentThread2.get(session1),
            );
            expect(updatedCommentThreads.find(({id}) => id === commentThread3.id)).toEqual(
                await commentThread3.get(session1),
            );
            expect(updatedCommentThreads.find(({id}) => id === commentThread1.id)).toEqual(
                new DocumentCommentThreadModel({
                    id: commentThread1.id,
                    documentId: document.id,
                    createdTime: expect.any(Date),
                    version: 2,
                    fallbackContentSnippet: {
                        doc: schema.node("doc", {}, [
                            schema.node("title"),
                            schema.node("paragraph", {}, [
                                schema.text("Hello", [
                                    schema.mark("comment", {commentThreadId: commentThread1.id}),
                                ]),
                                schema.text(" wonderful world!"),
                            ]),
                        ]),
                        references: emptyDocumentContentReferences,
                    },
                    isResolved: false,
                    commentCount: 1,
                    lastCommentChangeTime: null,
                    firstCommentAuthor: await session1.get(),
                }),
            );
            expect(updatedCommentThreads.find(({id}) => id === commentThread2.id)).toEqual(
                new DocumentCommentThreadModel({
                    id: commentThread2.id,
                    documentId: document.id,
                    createdTime: expect.any(Date),
                    version: 2,
                    fallbackContentSnippet: {
                        doc: schema.node("doc", {}, [
                            schema.node("title"),
                            schema.node("paragraph", {}, [
                                schema.text("Hello "),
                                schema.text("wonderful", [
                                    schema.mark("comment", {commentThreadId: commentThread2.id}),
                                ]),
                                schema.text(" world!"),
                            ]),
                        ]),
                        references: emptyDocumentContentReferences,
                    },
                    isResolved: false,
                    commentCount: 1,
                    lastCommentChangeTime: null,
                    firstCommentAuthor: await session2.get(),
                }),
            );
            expect(updatedCommentThreads.find(({id}) => id === commentThread3.id)).toEqual(
                new DocumentCommentThreadModel({
                    id: commentThread3.id,
                    documentId: document.id,
                    createdTime: expect.any(Date),
                    version: 2,
                    fallbackContentSnippet: {
                        doc: schema.node("doc", {}, [
                            schema.node("title"),
                            schema.node("paragraph", {}, [
                                schema.text("Hello wonderful "),
                                schema.text("world", [
                                    schema.mark("comment", {commentThreadId: commentThread3.id}),
                                ]),
                                schema.text("!"),
                            ]),
                        ]),
                        references: emptyDocumentContentReferences,
                    },
                    isResolved: false,
                    commentCount: 1,
                    lastCommentChangeTime: null,
                    firstCommentAuthor: await session1.get(),
                }),
            );
        }
    });

    test("can resolve then unresolve then resolve again for comment thread", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();

        const document = await TestDocument.create(session);

        const {range} = await document.type(session, "Hello");
        await document.type(session, ", world!");

        const commentThread = await document.createCommentThread(session, range, "test1");

        expect(await commentThread.get(session)).toEqual(
            new DocumentCommentThreadModel({
                id: commentThread.id,
                documentId: document.id,
                createdTime: expect.any(Date),
                version: 0,
                fallbackContentSnippet: null,
                isResolved: false,
                commentCount: 1,
                lastCommentChangeTime: null,
                firstCommentAuthor: await session.get(),
            }),
        );

        {
            const {updatedCommentThreads} = await document.update(
                session,
                [
                    new RemoveAllMarksStep(
                        schema.marks.comment.create({commentThreadId: commentThread.id}),
                    ),
                ],
                {resolveCommentThreadIds: [commentThread.id]},
            );

            expect(updatedCommentThreads.length).toEqual(1);
            expect(updatedCommentThreads[0]).toEqual(await commentThread.get(session));
            expect(updatedCommentThreads[0]).toEqual(
                new DocumentCommentThreadModel({
                    id: commentThread.id,
                    documentId: document.id,
                    createdTime: expect.any(Date),
                    version: 1,
                    fallbackContentSnippet: expect.any(Object),
                    isResolved: true,
                    commentCount: 1,
                    lastCommentChangeTime: null,
                    firstCommentAuthor: await session.get(),
                }),
            );
        }

        {
            const resolvedCommentThreadRanges = await getResolvedDocumentCommentThreadRanges(
                session.action(),
                {
                    documentId: document.id,
                    commentThreadId: commentThread.id,
                },
            );

            expect(resolvedCommentThreadRanges).toEqual({
                version: 4,
                ranges: [range],
            });

            const {updatedCommentThreads} = await updateDocumentContent(session.action(), {
                id: document.id,
                version: resolvedCommentThreadRanges.version,
                steps: [
                    new AddMarksAfterRemoveAllStep(
                        schema.marks.comment.create({commentThreadId: commentThread.id}),
                        resolvedCommentThreadRanges.ranges,
                    ),
                ],
                unresolveCommentThreadIds: [commentThread.id],
                clientId: generateId(),
            });

            expect(updatedCommentThreads.length).toEqual(1);
            expect(updatedCommentThreads[0]).toEqual(await commentThread.get(session));
            expect(updatedCommentThreads[0]).toEqual(
                new DocumentCommentThreadModel({
                    id: commentThread.id,
                    documentId: document.id,
                    createdTime: expect.any(Date),
                    version: 2,
                    fallbackContentSnippet: expect.any(Object),
                    isResolved: false,
                    commentCount: 1,
                    lastCommentChangeTime: null,
                    firstCommentAuthor: await session.get(),
                }),
            );
        }

        {
            const {updatedCommentThreads} = await document.update(
                session,
                [
                    new RemoveAllMarksStep(
                        schema.marks.comment.create({commentThreadId: commentThread.id}),
                    ),
                ],
                {resolveCommentThreadIds: [commentThread.id]},
            );

            expect(updatedCommentThreads.length).toEqual(1);
            expect(updatedCommentThreads[0]).toEqual(await commentThread.get(session));
            expect(updatedCommentThreads[0]).toEqual(
                new DocumentCommentThreadModel({
                    id: commentThread.id,
                    documentId: document.id,
                    createdTime: expect.any(Date),
                    version: 3,
                    fallbackContentSnippet: expect.any(Object),
                    isResolved: true,
                    commentCount: 1,
                    lastCommentChangeTime: null,
                    firstCommentAuthor: await session.get(),
                }),
            );
        }

        {
            const resolvedCommentThreadRanges = await getResolvedDocumentCommentThreadRanges(
                session.action(),
                {
                    documentId: document.id,
                    commentThreadId: commentThread.id,
                },
            );

            expect(resolvedCommentThreadRanges).toEqual({
                version: 6,
                ranges: [range],
            });

            const {updatedCommentThreads} = await updateDocumentContent(session.action(), {
                id: document.id,
                version: resolvedCommentThreadRanges.version,
                steps: [
                    new AddMarksAfterRemoveAllStep(
                        schema.marks.comment.create({commentThreadId: commentThread.id}),
                        resolvedCommentThreadRanges.ranges,
                    ),
                ],
                unresolveCommentThreadIds: [commentThread.id],
                clientId: generateId(),
            });

            expect(updatedCommentThreads.length).toEqual(1);
            expect(updatedCommentThreads[0]).toEqual(await commentThread.get(session));
            expect(updatedCommentThreads[0]).toEqual(
                new DocumentCommentThreadModel({
                    id: commentThread.id,
                    documentId: document.id,
                    createdTime: expect.any(Date),
                    version: 4,
                    fallbackContentSnippet: expect.any(Object),
                    isResolved: false,
                    commentCount: 1,
                    lastCommentChangeTime: null,
                    firstCommentAuthor: await session.get(),
                }),
            );
        }
    });

    test("can unresolve comment thread after updates", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();

        const document = await TestDocument.create(session);

        const {range: range1} = await document.type(session, "Hello");
        await document.type(session, " ");
        const {range: range2} = await document.type(session, "wonderful");
        await document.type(session, " ");
        const {range: range3} = await document.type(session, "world");
        await document.type(session, "!");

        expect((await getDocument(session.action(), document.id)).content.doc.toJSON()).toEqual(
            schema
                .node("doc", {}, [
                    schema.node("title"),
                    schema.node("paragraph", {}, [schema.text("Hello wonderful world!")]),
                ])
                .toJSON(),
        );

        const commentThread = await document.createCommentThread(session, range3, "test1");

        expect(await commentThread.get(session)).toEqual(
            new DocumentCommentThreadModel({
                id: commentThread.id,
                documentId: document.id,
                createdTime: expect.any(Date),
                version: 0,
                fallbackContentSnippet: null,
                isResolved: false,
                commentCount: 1,
                lastCommentChangeTime: null,
                firstCommentAuthor: await session.get(),
            }),
        );

        expect((await getDocument(session.action(), document.id)).content.doc.toJSON()).toEqual(
            schema
                .node("doc", {}, [
                    schema.node("title"),
                    schema.node("paragraph", {}, [
                        schema.text("Hello wonderful "),
                        schema.text("world", [
                            schema.mark("comment", {commentThreadId: commentThread.id}),
                        ]),
                        schema.text("!"),
                    ]),
                ])
                .toJSON(),
        );

        {
            const {newVersion, updatedCommentThreads} = await document.update(
                session,
                [
                    new RemoveAllMarksStep(
                        schema.marks.comment.create({commentThreadId: commentThread.id}),
                    ),
                ],
                {resolveCommentThreadIds: [commentThread.id]},
            );

            expect(newVersion).toEqual(8);
            expect(updatedCommentThreads.length).toEqual(1);
            expect(updatedCommentThreads[0]).toEqual(await commentThread.get(session));
            expect(updatedCommentThreads[0]).toEqual(
                new DocumentCommentThreadModel({
                    id: commentThread.id,
                    documentId: document.id,
                    createdTime: expect.any(Date),
                    version: 1,
                    fallbackContentSnippet: expect.any(Object),
                    isResolved: true,
                    commentCount: 1,
                    lastCommentChangeTime: null,
                    firstCommentAuthor: await session.get(),
                }),
            );
        }

        expect((await getDocument(session.action(), document.id)).content.doc.toJSON()).toEqual(
            schema
                .node("doc", {}, [
                    schema.node("title"),
                    schema.node("paragraph", {}, [schema.text("Hello wonderful world!")]),
                ])
                .toJSON(),
        );

        await document.update(session, [
            new ReplaceStep(range2.from, range2.to, textSlice("wooonderfulll")),
        ]);

        expect((await getDocument(session.action(), document.id)).content.doc.toJSON()).toEqual(
            schema
                .node("doc", {}, [
                    schema.node("title"),
                    schema.node("paragraph", {}, [schema.text("Hello wooonderfulll world!")]),
                ])
                .toJSON(),
        );

        await document.update(session, [
            new ReplaceStep(range1.from, range1.to, textSlice("Hellloooo")),
        ]);

        expect((await getDocument(session.action(), document.id)).content.doc.toJSON()).toEqual(
            schema
                .node("doc", {}, [
                    schema.node("title"),
                    schema.node("paragraph", {}, [schema.text("Hellloooo wooonderfulll world!")]),
                ])
                .toJSON(),
        );

        {
            const resolvedCommentThreadRanges = await getResolvedDocumentCommentThreadRanges(
                session.action(),
                {
                    documentId: document.id,
                    commentThreadId: commentThread.id,
                },
            );

            expect(resolvedCommentThreadRanges).toEqual({
                version: 8,
                ranges: [{from: 19, to: 24}],
            });

            const {newVersion, updatedCommentThreads} = await updateDocumentContent(
                session.action(),
                {
                    id: document.id,
                    version: resolvedCommentThreadRanges.version,
                    steps: [
                        new AddMarksAfterRemoveAllStep(
                            schema.marks.comment.create({commentThreadId: commentThread.id}),
                            resolvedCommentThreadRanges.ranges,
                        ),
                    ],
                    unresolveCommentThreadIds: [commentThread.id],
                    clientId: generateId(),
                },
            );

            expect(newVersion).toEqual(11);
            expect(updatedCommentThreads.length).toEqual(1);
            expect(updatedCommentThreads[0]).toEqual(await commentThread.get(session));
            expect(updatedCommentThreads[0]).toEqual(
                new DocumentCommentThreadModel({
                    id: commentThread.id,
                    documentId: document.id,
                    createdTime: expect.any(Date),
                    version: 2,
                    fallbackContentSnippet: expect.any(Object),
                    isResolved: false,
                    commentCount: 1,
                    lastCommentChangeTime: null,
                    firstCommentAuthor: await session.get(),
                }),
            );
        }

        expect((await getDocument(session.action(), document.id)).content.doc.toJSON()).toEqual(
            schema
                .node("doc", {}, [
                    schema.node("title"),
                    schema.node("paragraph", {}, [
                        schema.text("Hellloooo wooonderfulll "),
                        schema.text("world", [
                            schema.mark("comment", {commentThreadId: commentThread.id}),
                        ]),
                        schema.text("!"),
                    ]),
                ])
                .toJSON(),
        );
    });

    test("can't get comment thread if you don't have access to the space", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();
        const otherSpace = await TestSpace.create(context);
        const otherSession = await otherSpace.createSession();

        const document = await TestDocument.create(session);

        const {range} = await document.type(session, "Hello");
        await document.type(session, ", world!");

        const commentThread = await document.createCommentThread(session, range, "test1");

        await expect(
            getDocumentCommentThread(session.action(), {
                documentId: document.id,
                commentThreadId: commentThread.id,
            }),
        ).resolves.not.toBeNull();
        await expect(
            getDocumentCommentThread(otherSession.action(), {
                documentId: document.id,
                commentThreadId: commentThread.id,
            }),
        ).rejects.toThrow(PermissionDeniedError);
    });

    test("can't get comment thread for a comment which doesn't exist", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();

        const document = await TestDocument.create(session);

        const {range} = await document.type(session, "Hello");
        await document.type(session, ", world!");

        await document.createCommentThread(session, range, "test1");

        await expect(
            getDocumentCommentThread(session.action(), {
                documentId: document.id,
                commentThreadId: generateId(),
            }),
        ).rejects.toThrow(NotFoundError);
    });

    test("can get comment thread", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();

        const document = await TestDocument.create(session);

        const {range} = await document.type(session, "Hello");
        await document.type(session, ", world!");

        const commentThread = await document.createCommentThread(session, range, "test1");

        expect(
            await getDocumentCommentThread(session.action(), {
                documentId: document.id,
                commentThreadId: commentThread.id,
            }),
        ).toEqual(
            new DocumentCommentThreadModel({
                id: commentThread.id,
                documentId: document.id,
                createdTime: expect.any(Date),
                version: 0,
                fallbackContentSnippet: null,
                isResolved: false,
                commentCount: 1,
                lastCommentChangeTime: null,
                firstCommentAuthor: await session.get(),
            }),
        );
    });

    test("can get resolved comment thread ranges", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();

        const document = await TestDocument.create(session);

        const {range} = await document.type(session, "Hello");
        await document.type(session, ", world!");

        const commentThread = await document.createCommentThread(session, range, "test1");

        await commentThread.resolve(session);

        expect(
            await getResolvedDocumentCommentThreadRanges(session.action(), {
                documentId: document.id,
                commentThreadId: commentThread.id,
            }),
        ).toEqual({
            version: 4,
            ranges: [range],
        });
    });

    test("can't get resolved comment thread ranges if comment thread is not resolved", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();

        const document = await TestDocument.create(session);

        const {range} = await document.type(session, "Hello");
        await document.type(session, ", world!");

        const commentThread = await document.createCommentThread(session, range, "test1");

        await expect(
            getResolvedDocumentCommentThreadRanges(session.action(), {
                documentId: document.id,
                commentThreadId: commentThread.id,
            }),
        ).rejects.toThrow(FailedPreconditionError);

        await commentThread.resolve(session);

        expect(
            await getResolvedDocumentCommentThreadRanges(session.action(), {
                documentId: document.id,
                commentThreadId: commentThread.id,
            }),
        ).toEqual({
            version: 4,
            ranges: [range],
        });

        await commentThread.unresolve(session);

        await expect(
            getResolvedDocumentCommentThreadRanges(session.action(), {
                documentId: document.id,
                commentThreadId: commentThread.id,
            }),
        ).rejects.toThrow(FailedPreconditionError);
    });

    test("can't get resolved comment thread ranges if you don't have access to the space", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();
        const otherSpace = await TestSpace.create(context);
        const otherSession = await otherSpace.createSession();

        const document = await TestDocument.create(session);

        const {range} = await document.type(session, "Hello");
        await document.type(session, ", world!");

        const commentThread = await document.createCommentThread(session, range, "test1");

        await commentThread.resolve(session);

        expect(
            await getResolvedDocumentCommentThreadRanges(session.action(), {
                documentId: document.id,
                commentThreadId: commentThread.id,
            }),
        ).toEqual({
            version: 4,
            ranges: [range],
        });

        await expect(
            getResolvedDocumentCommentThreadRanges(otherSession.action(), {
                documentId: document.id,
                commentThreadId: commentThread.id,
            }),
        ).rejects.toThrow(PermissionDeniedError);
    });

    test("can't get resolved comment thread ranges for a comment which doesn't exist", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();

        const document = await TestDocument.create(session);

        const {range} = await document.type(session, "Hello");
        await document.type(session, ", world!");

        const commentThread = await document.createCommentThread(session, range, "test1");

        await commentThread.resolve(session);

        await expect(
            getResolvedDocumentCommentThreadRanges(session.action(), {
                documentId: document.id,
                commentThreadId: generateId(),
            }),
        ).rejects.toThrow(NotFoundError);
    });

    test("can get resolved comment thread ranges if there are no ranges", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();

        const document = await TestDocument.create(session);

        const {range} = await document.type(session, "Hello");
        await document.type(session, ", world!");

        const commentThread = await document.createCommentThread(session, range, "test1");

        await document.update(session, [new ReplaceStep(range.from, range.to, textSlice(""))]);

        await commentThread.resolve(session);

        expect(
            await getResolvedDocumentCommentThreadRanges(session.action(), {
                documentId: document.id,
                commentThreadId: commentThread.id,
            }),
        ).toEqual({
            version: 5,
            ranges: [],
        });
    });

    test("can get resolved comment thread ranges if there are many ranges", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();

        const document = await TestDocument.create(session);

        const {range: range1} = await document.type(session, "Hello");
        await document.type(session, " ");
        const {range: range2} = await document.type(session, "wonderful");
        await document.type(session, " ");
        const {range: range3} = await document.type(session, "world");
        await document.type(session, "!");

        const commentThread = await document.createCommentThread(session, range1, "test1");

        await document.update(session, [
            new AddMarkStep(
                range2.from,
                range2.to,
                schema.mark("comment", {commentThreadId: commentThread.id}),
            ),
            new AddMarkStep(
                range3.from,
                range3.to,
                schema.mark("comment", {commentThreadId: commentThread.id}),
            ),
        ]);

        await commentThread.resolve(session);

        expect(
            await getResolvedDocumentCommentThreadRanges(session.action(), {
                documentId: document.id,
                commentThreadId: commentThread.id,
            }),
        ).toEqual({
            version: 10,
            ranges: [range1, range2, range3],
        });
    });

    test("saves fallback snippet if comment is removed from document not through resolving", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();

        const document = await TestDocument.create(session);

        const {range} = await document.type(session, "Hello");
        await document.type(session, ", world!");

        const commentThread = await document.createCommentThread(session, range, "test1");

        expect(await commentThread.get(session)).toEqual(
            new DocumentCommentThreadModel({
                id: commentThread.id,
                documentId: document.id,
                createdTime: expect.any(Date),
                version: 0,
                fallbackContentSnippet: null,
                isResolved: false,
                commentCount: 1,
                lastCommentChangeTime: null,
                firstCommentAuthor: await session.get(),
            }),
        );

        await document.update(session, [new ReplaceStep(range.from, range.to, textSlice(""))]);

        expect(await commentThread.get(session)).toEqual(
            new DocumentCommentThreadModel({
                id: commentThread.id,
                documentId: document.id,
                createdTime: expect.any(Date),
                version: 1,
                fallbackContentSnippet: {
                    doc: schema.node("doc", {}, [
                        schema.node("title"),
                        schema.node("paragraph", {}, [
                            schema.text("Hello", [
                                schema.mark("comment", {commentThreadId: commentThread.id}),
                            ]),
                            schema.text(", world!"),
                        ]),
                    ]),
                    references: emptyDocumentContentReferences,
                },
                isResolved: false,
                commentCount: 1,
                lastCommentChangeTime: null,
                firstCommentAuthor: await session.get(),
            }),
        );

        await document.update(session, [
            new ReplaceStep(
                range.from,
                range.from,
                textSlice("Helloooo", [
                    schema.mark("comment", {commentThreadId: commentThread.id}),
                ]),
            ),
        ]);

        expect(await commentThread.get(session)).toEqual(
            new DocumentCommentThreadModel({
                id: commentThread.id,
                documentId: document.id,
                createdTime: expect.any(Date),
                version: 1,
                fallbackContentSnippet: {
                    doc: schema.node("doc", {}, [
                        schema.node("title"),
                        schema.node("paragraph", {}, [
                            schema.text("Hello", [
                                schema.mark("comment", {commentThreadId: commentThread.id}),
                            ]),
                            schema.text(", world!"),
                        ]),
                    ]),
                    references: emptyDocumentContentReferences,
                },
                isResolved: false,
                commentCount: 1,
                lastCommentChangeTime: null,
                firstCommentAuthor: await session.get(),
            }),
        );

        await document.update(session, [new ReplaceStep(range.from, range.to + 3, textSlice(""))]);

        expect(await commentThread.get(session)).toEqual(
            new DocumentCommentThreadModel({
                id: commentThread.id,
                documentId: document.id,
                createdTime: expect.any(Date),
                version: 2,
                fallbackContentSnippet: {
                    doc: schema.node("doc", {}, [
                        schema.node("title"),
                        schema.node("paragraph", {}, [
                            schema.text("Helloooo", [
                                schema.mark("comment", {commentThreadId: commentThread.id}),
                            ]),
                            schema.text(", world!"),
                        ]),
                    ]),
                    references: emptyDocumentContentReferences,
                },
                isResolved: false,
                commentCount: 1,
                lastCommentChangeTime: null,
                firstCommentAuthor: await session.get(),
            }),
        );
    });

    test("saves fallback snippet only if comment is completely removed from document not through resolving", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();

        const document = await TestDocument.create(session);

        const {range: range1} = await document.type(session, "Hello");
        await document.type(session, ", ");
        const {range: range2} = await document.type(session, "world");
        await document.type(session, "!");

        const commentThread = await document.createCommentThread(session, range1, "test1");

        await document.update(session, [
            new AddMarkStep(
                range2.from,
                range2.to,
                schema.mark("comment", {commentThreadId: commentThread.id}),
            ),
        ]);

        expect(await commentThread.get(session)).toEqual(
            new DocumentCommentThreadModel({
                id: commentThread.id,
                documentId: document.id,
                createdTime: expect.any(Date),
                version: 0,
                fallbackContentSnippet: null,
                isResolved: false,
                commentCount: 1,
                lastCommentChangeTime: null,
                firstCommentAuthor: await session.get(),
            }),
        );

        await document.update(session, [new ReplaceStep(range1.from, range1.to, textSlice(""))]);

        expect(await commentThread.get(session)).toEqual(
            new DocumentCommentThreadModel({
                id: commentThread.id,
                documentId: document.id,
                createdTime: expect.any(Date),
                version: 0,
                fallbackContentSnippet: null,
                isResolved: false,
                commentCount: 1,
                lastCommentChangeTime: null,
                firstCommentAuthor: await session.get(),
            }),
        );

        await document.update(session, [
            new ReplaceStep(range2.from - 5, range2.to - 5, textSlice("")),
        ]);

        expect(await commentThread.get(session)).toEqual(
            new DocumentCommentThreadModel({
                id: commentThread.id,
                documentId: document.id,
                createdTime: expect.any(Date),
                version: 1,
                fallbackContentSnippet: {
                    doc: schema.node("doc", {}, [
                        schema.node("title"),
                        schema.node("paragraph", {}, [
                            schema.text(", "),
                            schema.text("world", [
                                schema.mark("comment", {commentThreadId: commentThread.id}),
                            ]),
                            schema.text("!"),
                        ]),
                    ]),
                    references: emptyDocumentContentReferences,
                },
                isResolved: false,
                commentCount: 1,
                lastCommentChangeTime: null,
                firstCommentAuthor: await session.get(),
            }),
        );

        await document.update(session, [
            new ReplaceStep(
                range1.from,
                range1.from,
                textSlice("Helloooo", [
                    schema.mark("comment", {commentThreadId: commentThread.id}),
                ]),
            ),
        ]);

        expect(await commentThread.get(session)).toEqual(
            new DocumentCommentThreadModel({
                id: commentThread.id,
                documentId: document.id,
                createdTime: expect.any(Date),
                version: 1,
                fallbackContentSnippet: {
                    doc: schema.node("doc", {}, [
                        schema.node("title"),
                        schema.node("paragraph", {}, [
                            schema.text(", "),
                            schema.text("world", [
                                schema.mark("comment", {commentThreadId: commentThread.id}),
                            ]),
                            schema.text("!"),
                        ]),
                    ]),
                    references: emptyDocumentContentReferences,
                },
                isResolved: false,
                commentCount: 1,
                lastCommentChangeTime: null,
                firstCommentAuthor: await session.get(),
            }),
        );

        await document.update(session, [
            new ReplaceStep(range1.from, range1.to + 3, textSlice("")),
        ]);

        expect(await commentThread.get(session)).toEqual(
            new DocumentCommentThreadModel({
                id: commentThread.id,
                documentId: document.id,
                createdTime: expect.any(Date),
                version: 2,
                fallbackContentSnippet: {
                    doc: schema.node("doc", {}, [
                        schema.node("title"),
                        schema.node("paragraph", {}, [
                            schema.text("Helloooo", [
                                schema.mark("comment", {commentThreadId: commentThread.id}),
                            ]),
                            schema.text(", !"),
                        ]),
                    ]),
                    references: emptyDocumentContentReferences,
                },
                isResolved: false,
                commentCount: 1,
                lastCommentChangeTime: null,
                firstCommentAuthor: await session.get(),
            }),
        );
    });

    test("saves fallback snippet if comment is removed from document through resolving", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();

        const document = await TestDocument.create(session);

        const {range} = await document.type(session, "Hello");
        await document.type(session, ", world!");

        const commentThread = await document.createCommentThread(session, range, "test1");

        expect(await commentThread.get(session)).toEqual(
            new DocumentCommentThreadModel({
                id: commentThread.id,
                documentId: document.id,
                createdTime: expect.any(Date),
                version: 0,
                fallbackContentSnippet: null,
                isResolved: false,
                commentCount: 1,
                lastCommentChangeTime: null,
                firstCommentAuthor: await session.get(),
            }),
        );

        await document.update(
            session,
            [new RemoveAllMarksStep(schema.mark("comment", {commentThreadId: commentThread.id}))],
            {resolveCommentThreadIds: [commentThread.id]},
        );

        expect(await commentThread.get(session)).toEqual(
            new DocumentCommentThreadModel({
                id: commentThread.id,
                documentId: document.id,
                createdTime: expect.any(Date),
                version: 1,
                fallbackContentSnippet: {
                    doc: schema.node("doc", {}, [
                        schema.node("title"),
                        schema.node("paragraph", {}, [
                            schema.text("Hello", [
                                schema.mark("comment", {commentThreadId: commentThread.id}),
                            ]),
                            schema.text(", world!"),
                        ]),
                    ]),
                    references: emptyDocumentContentReferences,
                },
                isResolved: true,
                commentCount: 1,
                lastCommentChangeTime: null,
                firstCommentAuthor: await session.get(),
            }),
        );

        await document.update(session, [
            new ReplaceStep(
                range.from,
                range.to,
                textSlice("Helloooo", [
                    schema.mark("comment", {commentThreadId: commentThread.id}),
                ]),
            ),
        ]);

        expect(await commentThread.get(session)).toEqual(
            new DocumentCommentThreadModel({
                id: commentThread.id,
                documentId: document.id,
                createdTime: expect.any(Date),
                version: 1,
                fallbackContentSnippet: {
                    doc: schema.node("doc", {}, [
                        schema.node("title"),
                        schema.node("paragraph", {}, [
                            schema.text("Hello", [
                                schema.mark("comment", {commentThreadId: commentThread.id}),
                            ]),
                            schema.text(", world!"),
                        ]),
                    ]),
                    references: emptyDocumentContentReferences,
                },
                isResolved: true,
                commentCount: 1,
                lastCommentChangeTime: null,
                firstCommentAuthor: await session.get(),
            }),
        );
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
                fallbackContentSnippet: null,
                commentsSummary: {
                    nextCommentIndex: 0,
                    lastChangeTime: null,
                    commentCountByAuthorId: new Map(),
                    mentionCountByAccountId: new Map(),
                },
                resolutionState: {
                    type: "Unresolved",
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
        async getMessagePayload(context, {roomKey, messageIndex: commentIndex}) {
            const [documentId, commentThreadId] = decodeDocumentCommentRoomKey(roomKey);

            return (
                await getDocumentCommentPayload(context, {
                    documentId,
                    commentThreadId,
                    commentIndex,
                })
            ).payload;
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
