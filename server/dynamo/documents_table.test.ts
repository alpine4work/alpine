import {Fragment, Slice} from "prosemirror-model";
import {ReplaceStep, Step} from "prosemirror-transform";
import {
    DocumentContentCacheForUpdate,
    createDocument,
    documentContentCacheEvictionTimeoutMs,
    getDocument,
    getDocumentContentSteps,
    getDocumentPreview,
    getDocumentsTableForTest,
    getInternalDocumentTestCounter,
    updateDocumentContent,
    updateDocumentContentBeforeExecuteTransactionTestCheckpoint,
} from "~/server/dynamo/documents_table";
import {createTestContext} from "~/server/dynamo/test/create_test_context";
import {createTestSession} from "~/server/dynamo/test/create_test_session";
import {createTestSpace} from "~/server/dynamo/test/create_test_space";
import {
    emptyDocumentContent,
    isDocumentContent,
    DocumentContentProsemirrorSchema as schema,
} from "~/shared/documents/document_content_schema";
import {DocumentModel} from "~/shared/documents/document_model";
import {DataLossError, FailedPreconditionError, NotFoundError} from "~/shared/error/error";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises";
import {assert} from "~/shared/helpers/control/assert";
import {generateId} from "~/shared/id/id";

jest.useFakeTimers();

const context = createTestContext();
const space = createTestSpace(context);
const session = createTestSession(context, space);

function textSlice(text: string) {
    if (text.length === 0) return Slice.empty;
    return new Slice(Fragment.from(schema.text(text)), 0, 0);
}

/**
 * Convert document into a form we can do a deep equality test on.
 */
function massageDocument(document: DocumentModel | null) {
    if (!document) return null;
    return {
        version: document.version,
        content: document.content.toJSON(),
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
    await createDocument(context.request(session), {
        id: generateId(),
        spaceId: space.id,
        content: emptyDocumentContent,
    });
});

test("can not create a document with the same id twice", async () => {
    const id = generateId();

    const content = schema.node("doc", {}, [
        schema.node("title", {}, [schema.text("Foo bar")]),
        schema.node("paragraph", {}, [schema.text("Hello, world!")]),
    ]);
    assert(isDocumentContent(content));

    await createDocument(context.request(session), {
        id,
        spaceId: space.id,
        content: emptyDocumentContent,
    });

    await expect(async () => {
        await createDocument(context.request(session), {
            id,
            spaceId: space.id,
            content,
        });
    }).rejects.toThrow(FailedPreconditionError);
});

test("can idempotently create a document twice", async () => {
    const id = generateId();

    await createDocument(context.request(session), {
        id,
        spaceId: space.id,
        content: emptyDocumentContent,
    });

    await createDocument(context.request(session), {
        id,
        spaceId: space.id,
        content: emptyDocumentContent,
    });
});

test("can not idempotently create a document twice if the content is different", async () => {
    const id = generateId();

    await createDocument(context.request(session), {
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
        await createDocument(context.request(session), {
            id,
            spaceId: space.id,
            content: otherContent,
        });
    }).rejects.toThrow(FailedPreconditionError);
});

test("can read a created document", async () => {
    const documentId = generateId();

    const content = schema.node("doc", {}, [
        schema.node("title", {}, [schema.text("Foo bar")]),
        schema.node("paragraph", {}, [schema.text("Hello, world!")]),
    ]);
    assert(isDocumentContent(content));

    await createDocument(context.request(session), {
        id: documentId,
        spaceId: space.id,
        content,
    });

    expect(massageDocument(await getDocument(context.request(session), documentId))).toEqual({
        version: 0,
        content: content.toJSON(),
    });
    expect(await getDocumentPreview(context.request(session), documentId)).toEqual({
        id: documentId,
        spaceId: space.id,
        createdTime: expect.any(Date),
        version: 0,
        titleWithoutFallback: "Foo bar",
    });
});

test("can update a document with a single step", async () => {
    const documentId = generateId();

    await createDocument(context.request(session), {
        id: documentId,
        spaceId: space.id,
        content: emptyDocumentContent,
    });

    await updateDocumentContent(context.request(session), {
        id: documentId,
        version: 0,
        steps: [new ReplaceStep(3, 3, textSlice("a"))],
        clientId: generateId(),
    });

    expect(massageDocument(await getDocument(context.request(session), documentId))).toEqual({
        version: 1,
        content: schema
            .node("doc", {}, [
                schema.node("title", {}, []),
                schema.node("paragraph", {}, [schema.text("a")]),
            ])
            .toJSON(),
    });

    await updateDocumentContent(context.request(session), {
        id: documentId,
        version: 1,
        steps: [new ReplaceStep(4, 4, textSlice("b"))],
        clientId: generateId(),
    });

    expect(massageDocument(await getDocument(context.request(session), documentId))).toEqual({
        version: 2,
        content: schema
            .node("doc", {}, [
                schema.node("title", {}, []),
                schema.node("paragraph", {}, [schema.text("ab")]),
            ])
            .toJSON(),
    });

    await updateDocumentContent(context.request(session), {
        id: documentId,
        version: 2,
        steps: [new ReplaceStep(5, 5, textSlice("c"))],
        clientId: generateId(),
    });

    expect(massageDocument(await getDocument(context.request(session), documentId))).toEqual({
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
    const documentId = generateId();

    await createDocument(context.request(session), {
        id: documentId,
        spaceId: space.id,
        content: emptyDocumentContent,
    });

    await updateDocumentContent(context.request(session), {
        id: documentId,
        version: 0,
        steps: [new ReplaceStep(3, 3, textSlice("a"))],
        clientId: generateId(),
    });

    expect(massageDocument(await getDocument(context.request(session), documentId))).toEqual({
        version: 1,
        content: schema
            .node("doc", {}, [
                schema.node("title", {}, []),
                schema.node("paragraph", {}, [schema.text("a")]),
            ])
            .toJSON(),
    });

    await updateDocumentContent(context.request(session), {
        id: documentId,
        version: 1,
        steps: [
            new ReplaceStep(4, 4, textSlice("b")),
            new ReplaceStep(5, 5, textSlice("c")),
            new ReplaceStep(6, 6, textSlice("d")),
        ],
        clientId: generateId(),
    });

    expect(massageDocument(await getDocument(context.request(session), documentId))).toEqual({
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
    const documentId = generateId();

    await createDocument(context.request(session), {
        id: documentId,
        spaceId: space.id,
        content: emptyDocumentContent,
    });

    await updateDocumentContent(context.request(session), {
        id: documentId,
        version: 0,
        steps: [new ReplaceStep(3, 3, textSlice("a"))],
        clientId: generateId(),
    });

    expect(massageDocument(await getDocument(context.request(session), documentId))).toEqual({
        version: 1,
        content: schema
            .node("doc", {}, [
                schema.node("title", {}, []),
                schema.node("paragraph", {}, [schema.text("a")]),
            ])
            .toJSON(),
    });

    await expect(async () => {
        await updateDocumentContent(context.request(session), {
            id: documentId,
            version: 2,
            steps: [new ReplaceStep(5, 5, textSlice("c"))],
            clientId: generateId(),
        });
    }).rejects.toThrow(FailedPreconditionError);

    expect(massageDocument(await getDocument(context.request(session), documentId))).toEqual({
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
    const documentId = generateId();

    await createDocument(context.request(session), {
        id: documentId,
        spaceId: space.id,
        content: emptyDocumentContent,
    });

    await updateDocumentContent(context.request(session), {
        id: documentId,
        version: 0,
        steps: [new ReplaceStep(3, 3, textSlice("a"))],
        clientId: generateId(),
    });

    expect(massageDocument(await getDocument(context.request(session), documentId))).toEqual({
        version: 1,
        content: schema
            .node("doc", {}, [
                schema.node("title", {}, []),
                schema.node("paragraph", {}, [schema.text("a")]),
            ])
            .toJSON(),
    });

    await updateDocumentContent(context.request(session), {
        id: documentId,
        version: 1,
        steps: [new ReplaceStep(4, 4, textSlice("b"))],
        clientId: generateId(),
    });

    expect(massageDocument(await getDocument(context.request(session), documentId))).toEqual({
        version: 2,
        content: schema
            .node("doc", {}, [
                schema.node("title", {}, []),
                schema.node("paragraph", {}, [schema.text("ab")]),
            ])
            .toJSON(),
    });

    await updateDocumentContent(context.request(session), {
        id: documentId,
        version: 1,
        steps: [new ReplaceStep(4, 4, textSlice("c"))],
        clientId: generateId(),
    });

    expect(massageDocument(await getDocument(context.request(session), documentId))).toEqual({
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
    const documentId = generateId();

    await createDocument(context.request(session), {
        id: documentId,
        spaceId: space.id,
        content: emptyDocumentContent,
    });

    await updateDocumentContent(context.request(session), {
        id: documentId,
        version: 0,
        steps: [new ReplaceStep(3, 3, textSlice("a"))],
        clientId: generateId(),
    });

    expect(massageDocument(await getDocument(context.request(session), documentId))).toEqual({
        version: 1,
        content: schema
            .node("doc", {}, [
                schema.node("title", {}, []),
                schema.node("paragraph", {}, [schema.text("a")]),
            ])
            .toJSON(),
    });

    await updateDocumentContent(context.request(session), {
        id: documentId,
        version: 1,
        steps: [new ReplaceStep(4, 4, textSlice("b"))],
        clientId: generateId(),
    });

    await updateDocumentContent(context.request(session), {
        id: documentId,
        version: 2,
        steps: [new ReplaceStep(5, 5, textSlice("c"))],
        clientId: generateId(),
    });

    await updateDocumentContent(context.request(session), {
        id: documentId,
        version: 3,
        steps: [new ReplaceStep(6, 6, textSlice("d"))],
        clientId: generateId(),
    });

    await updateDocumentContent(context.request(session), {
        id: documentId,
        version: 4,
        steps: [new ReplaceStep(7, 7, textSlice("e"))],
        clientId: generateId(),
    });

    expect(massageDocument(await getDocument(context.request(session), documentId))).toEqual({
        version: 5,
        content: schema
            .node("doc", {}, [
                schema.node("title", {}, []),
                schema.node("paragraph", {}, [schema.text("abcde")]),
            ])
            .toJSON(),
    });

    await updateDocumentContent(context.request(session), {
        id: documentId,
        version: 1,
        steps: [new ReplaceStep(4, 4, textSlice("f"))],
        clientId: generateId(),
    });

    expect(massageDocument(await getDocument(context.request(session), documentId))).toEqual({
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
    const documentId = generateId();

    await createDocument(context.request(session), {
        id: documentId,
        spaceId: space.id,
        content: emptyDocumentContent,
    });

    await updateDocumentContent(context.request(session), {
        id: documentId,
        version: 0,
        steps: [new ReplaceStep(3, 3, textSlice("a"))],
        clientId: generateId(),
    });

    expect(massageDocument(await getDocument(context.request(session), documentId))).toEqual({
        version: 1,
        content: schema
            .node("doc", {}, [
                schema.node("title", {}, []),
                schema.node("paragraph", {}, [schema.text("a")]),
            ])
            .toJSON(),
    });

    await updateDocumentContent(context.request(session), {
        id: documentId,
        version: 1,
        steps: [new ReplaceStep(4, 4, textSlice("b"))],
        clientId: generateId(),
    });

    expect(massageDocument(await getDocument(context.request(session), documentId))).toEqual({
        version: 2,
        content: schema
            .node("doc", {}, [
                schema.node("title", {}, []),
                schema.node("paragraph", {}, [schema.text("ab")]),
            ])
            .toJSON(),
    });

    await updateDocumentContent(context.request(session), {
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

    expect(massageDocument(await getDocument(context.request(session), documentId))).toEqual({
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
    const documentId = generateId();

    await createDocument(context.request(session), {
        id: documentId,
        spaceId: space.id,
        content: emptyDocumentContent,
    });

    await updateDocumentContent(context.request(session), {
        id: documentId,
        version: 0,
        steps: [new ReplaceStep(3, 3, textSlice("a"))],
        clientId: generateId(),
    });

    expect(massageDocument(await getDocument(context.request(session), documentId))).toEqual({
        version: 1,
        content: schema
            .node("doc", {}, [
                schema.node("title", {}, []),
                schema.node("paragraph", {}, [schema.text("a")]),
            ])
            .toJSON(),
    });

    await updateDocumentContent(context.request(session), {
        id: documentId,
        version: 1,
        steps: [new ReplaceStep(4, 4, textSlice("b"))],
        clientId: generateId(),
    });

    await updateDocumentContent(context.request(session), {
        id: documentId,
        version: 2,
        steps: [new ReplaceStep(5, 5, textSlice("c"))],
        clientId: generateId(),
    });

    await updateDocumentContent(context.request(session), {
        id: documentId,
        version: 3,
        steps: [new ReplaceStep(6, 6, textSlice("d"))],
        clientId: generateId(),
    });

    await updateDocumentContent(context.request(session), {
        id: documentId,
        version: 4,
        steps: [new ReplaceStep(7, 7, textSlice("e"))],
        clientId: generateId(),
    });

    expect(massageDocument(await getDocument(context.request(session), documentId))).toEqual({
        version: 5,
        content: schema
            .node("doc", {}, [
                schema.node("title", {}, []),
                schema.node("paragraph", {}, [schema.text("abcde")]),
            ])
            .toJSON(),
    });

    await updateDocumentContent(context.request(session), {
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

    expect(massageDocument(await getDocument(context.request(session), documentId))).toEqual({
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
    const documentId = generateId();

    await createDocument(context.request(session), {
        id: documentId,
        spaceId: space.id,
        content: emptyDocumentContent,
    });

    await updateDocumentContent(context.request(session), {
        id: documentId,
        version: 0,
        steps: [new ReplaceStep(3, 3, textSlice("a"))],
        clientId: generateId(),
    });

    expect(massageDocument(await getDocument(context.request(session), documentId))).toEqual({
        version: 1,
        content: schema
            .node("doc", {}, [
                schema.node("title", {}, []),
                schema.node("paragraph", {}, [schema.text("a")]),
            ])
            .toJSON(),
    });

    const request2ClientId = generateId();
    const request2PausePromise =
        updateDocumentContentBeforeExecuteTransactionTestCheckpoint.pauseForTest({
            id: documentId,
            clientId: request2ClientId,
        });
    const request2Promise = updateDocumentContent(context.request(session), {
        id: documentId,
        version: 1,
        steps: [new ReplaceStep(4, 4, textSlice("b"))],
        clientId: request2ClientId,
    });

    const {unpause: unpauseRequest2} = await request2PausePromise;

    expect(massageDocument(await getDocument(context.request(session), documentId))).toEqual({
        version: 1,
        content: schema
            .node("doc", {}, [
                schema.node("title", {}, []),
                schema.node("paragraph", {}, [schema.text("a")]),
            ])
            .toJSON(),
    });

    await updateDocumentContent(context.request(session), {
        id: documentId,
        version: 1,
        steps: [new ReplaceStep(4, 4, textSlice("c"))],
        clientId: generateId(),
    });

    expect(massageDocument(await getDocument(context.request(session), documentId))).toEqual({
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

    expect(massageDocument(await getDocument(context.request(session), documentId))).toEqual({
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
    const documentId = generateId();

    await createDocument(context.request(session), {
        id: documentId,
        spaceId: space.id,
        content: emptyDocumentContent,
    });

    await updateDocumentContent(context.request(session), {
        id: documentId,
        version: 0,
        steps: [new ReplaceStep(3, 3, textSlice("a"))],
        clientId: generateId(),
    });

    expect(massageDocument(await getDocument(context.request(session), documentId))).toEqual({
        version: 1,
        content: schema
            .node("doc", {}, [
                schema.node("title", {}, []),
                schema.node("paragraph", {}, [schema.text("a")]),
            ])
            .toJSON(),
    });

    await expect(async () => {
        await updateDocumentContent(context.request(session), {
            id: documentId,
            version: 1,
            steps: [new ReplaceStep(5, 5, textSlice("b"))],
            clientId: generateId(),
        });
    }).rejects.toThrow(FailedPreconditionError);

    expect(massageDocument(await getDocument(context.request(session), documentId))).toEqual({
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
    const documentId = generateId();

    await createDocument(context.request(session), {
        id: documentId,
        spaceId: space.id,
        content: emptyDocumentContent,
    });

    await updateDocumentContent(context.request(session), {
        id: documentId,
        version: 0,
        steps: [new ReplaceStep(3, 3, textSlice("a"))],
        clientId: generateId(),
    });

    expect(massageDocument(await getDocument(context.request(session), documentId))).toEqual({
        version: 1,
        content: schema
            .node("doc", {}, [
                schema.node("title", {}, []),
                schema.node("paragraph", {}, [schema.text("a")]),
            ])
            .toJSON(),
    });

    await updateDocumentContent(context.request(session), {
        id: documentId,
        version: 1,
        steps: [new ReplaceStep(4, 4, textSlice("b"))],
        clientId: generateId(),
    });

    expect(massageDocument(await getDocument(context.request(session), documentId))).toEqual({
        version: 2,
        content: schema
            .node("doc", {}, [
                schema.node("title", {}, []),
                schema.node("paragraph", {}, [schema.text("ab")]),
            ])
            .toJSON(),
    });

    await expect(async () => {
        await updateDocumentContent(context.request(session), {
            id: documentId,
            version: 1,
            steps: [new ReplaceStep(5, 5, textSlice("c"))],
            clientId: generateId(),
        });
    }).rejects.toThrow(FailedPreconditionError);

    expect(massageDocument(await getDocument(context.request(session), documentId))).toEqual({
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
    const documentId = generateId();

    await createDocument(context.request(session), {
        id: documentId,
        spaceId: space.id,
        content: emptyDocumentContent,
    });

    await updateDocumentContent(context.request(session), {
        id: documentId,
        version: 0,
        steps: [new ReplaceStep(3, 3, textSlice("foobar"))],
        clientId: generateId(),
    });

    expect(massageDocument(await getDocument(context.request(session), documentId))).toEqual({
        version: 1,
        content: schema
            .node("doc", {}, [
                schema.node("title", {}, []),
                schema.node("paragraph", {}, [schema.text("foobar")]),
            ])
            .toJSON(),
    });

    await updateDocumentContent(context.request(session), {
        id: documentId,
        version: 1,
        steps: [new ReplaceStep(5, 7, Slice.empty)],
        clientId: generateId(),
    });

    expect(massageDocument(await getDocument(context.request(session), documentId))).toEqual({
        version: 2,
        content: schema
            .node("doc", {}, [
                schema.node("title", {}, []),
                schema.node("paragraph", {}, [schema.text("foar")]),
            ])
            .toJSON(),
    });

    await updateDocumentContent(context.request(session), {
        id: documentId,
        version: 1,
        steps: [new ReplaceStep(6, 6, textSlice("x"))],
        clientId: generateId(),
    });

    expect(massageDocument(await getDocument(context.request(session), documentId))).toEqual({
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
    const documentId = generateId();

    await createDocument(context.request(session), {
        id: documentId,
        spaceId: space.id,
        content: emptyDocumentContent,
    });

    await updateDocumentContent(context.request(session), {
        id: documentId,
        version: 0,
        steps: [new ReplaceStep(3, 3, textSlice("foobur"))],
        clientId: generateId(),
    });

    expect(massageDocument(await getDocument(context.request(session), documentId))).toEqual({
        version: 1,
        content: schema
            .node("doc", {}, [
                schema.node("title", {}, []),
                schema.node("paragraph", {}, [schema.text("foobur")]),
            ])
            .toJSON(),
    });

    await updateDocumentContent(context.request(session), {
        id: documentId,
        version: 1,
        steps: [new ReplaceStep(5, 7, Slice.empty)],
        clientId: generateId(),
    });

    expect(massageDocument(await getDocument(context.request(session), documentId))).toEqual({
        version: 2,
        content: schema
            .node("doc", {}, [
                schema.node("title", {}, []),
                schema.node("paragraph", {}, [schema.text("four")]),
            ])
            .toJSON(),
    });

    await updateDocumentContent(context.request(session), {
        id: documentId,
        version: 1,
        steps: [
            new ReplaceStep(6, 6, textSlice("x")),
            new ReplaceStep(7, 7, textSlice("y")),
            new ReplaceStep(8, 8, textSlice("z")),
        ],
        clientId: generateId(),
    });

    expect(massageDocument(await getDocument(context.request(session), documentId))).toEqual({
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
    const documentId = generateId();

    await createDocument(context.request(session), {
        id: documentId,
        spaceId: space.id,
        content: emptyDocumentContent,
    });

    await updateDocumentContent(context.request(session), {
        id: documentId,
        version: 0,
        steps: [new ReplaceStep(3, 3, textSlice("foobur"))],
        clientId: generateId(),
    });

    expect(massageDocument(await getDocument(context.request(session), documentId))).toEqual({
        version: 1,
        content: schema
            .node("doc", {}, [
                schema.node("title", {}, []),
                schema.node("paragraph", {}, [schema.text("foobur")]),
            ])
            .toJSON(),
    });

    await updateDocumentContent(context.request(session), {
        id: documentId,
        version: 1,
        steps: [new ReplaceStep(5, 7, Slice.empty)],
        clientId: generateId(),
    });

    expect(massageDocument(await getDocument(context.request(session), documentId))).toEqual({
        version: 2,
        content: schema
            .node("doc", {}, [
                schema.node("title", {}, []),
                schema.node("paragraph", {}, [schema.text("four")]),
            ])
            .toJSON(),
    });

    await updateDocumentContent(context.request(session), {
        id: documentId,
        version: 1,
        steps: [
            new ReplaceStep(6, 6, textSlice("x")),
            new ReplaceStep(7, 7, textSlice("y")),
            new ReplaceStep(11, 11, textSlice("z")),
        ],
        clientId: generateId(),
    });

    expect(massageDocument(await getDocument(context.request(session), documentId))).toEqual({
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
    const documentId = generateId();

    await createDocument(context.request(session), {
        id: documentId,
        spaceId: space.id,
        content: emptyDocumentContent,
    });

    const {getCount} = getInternalDocumentTestCounter.recordForTest(documentId);
    expect(getCount()).toEqual(0);

    await updateDocumentContent(context.request(session), {
        id: documentId,
        version: 0,
        steps: [new ReplaceStep(3, 3, textSlice("a"))],
        clientId: generateId(),
    });

    expect(getCount()).toEqual(1);

    expect(massageDocument(await getDocument(context.request(session), documentId))).toEqual({
        version: 1,
        content: schema
            .node("doc", {}, [
                schema.node("title", {}, []),
                schema.node("paragraph", {}, [schema.text("a")]),
            ])
            .toJSON(),
    });

    expect(getCount()).toEqual(2);

    await updateDocumentContent(context.request(session), {
        id: documentId,
        version: 1,
        steps: [new ReplaceStep(4, 4, textSlice("b"))],
        clientId: generateId(),
    });

    expect(getCount()).toEqual(2);

    expect(massageDocument(await getDocument(context.request(session), documentId))).toEqual({
        version: 2,
        content: schema
            .node("doc", {}, [
                schema.node("title", {}, []),
                schema.node("paragraph", {}, [schema.text("ab")]),
            ])
            .toJSON(),
    });

    expect(getCount()).toEqual(3);

    await updateDocumentContent(context.request(session), {
        id: documentId,
        version: 2,
        steps: [new ReplaceStep(5, 5, textSlice("c"))],
        clientId: generateId(),
    });

    expect(getCount()).toEqual(3);

    expect(massageDocument(await getDocument(context.request(session), documentId))).toEqual({
        version: 3,
        content: schema
            .node("doc", {}, [
                schema.node("title", {}, []),
                schema.node("paragraph", {}, [schema.text("abc")]),
            ])
            .toJSON(),
    });

    expect(getCount()).toEqual(4);

    await updateDocumentContent(context.request(session), {
        id: documentId,
        version: 3,
        steps: [new ReplaceStep(6, 6, textSlice("d"))],
        clientId: generateId(),
    });

    expect(getCount()).toEqual(4);

    expect(massageDocument(await getDocument(context.request(session), documentId))).toEqual({
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
    const documentId = generateId();

    await expect(async () => {
        await updateDocumentContent(context.request(session), {
            id: documentId,
            version: 0,
            steps: [new ReplaceStep(3, 3, textSlice("a"))],
            clientId: generateId(),
        });
    }).rejects.toThrow(NotFoundError);
});

test("won't cache a document that doesn't exist when updating", async () => {
    const documentId = generateId();

    const {getCount} = getInternalDocumentTestCounter.recordForTest(documentId);
    expect(getCount()).toEqual(0);

    await expect(async () => {
        await updateDocumentContent(context.request(session), {
            id: documentId,
            version: 0,
            steps: [new ReplaceStep(3, 3, textSlice("a"))],
            clientId: generateId(),
        });
    }).rejects.toThrow(NotFoundError);

    expect(getCount()).toEqual(1);

    await expect(async () => {
        await updateDocumentContent(context.request(session), {
            id: documentId,
            version: 0,
            steps: [new ReplaceStep(3, 3, textSlice("a"))],
            clientId: generateId(),
        });
    }).rejects.toThrow(NotFoundError);

    expect(getCount()).toEqual(2);
});

test("can't read a corrupted document", async () => {
    const documentId = generateId();

    await createDocument(context.request(session), {
        id: documentId,
        spaceId: space.id,
        content: emptyDocumentContent,
    });

    await getDocumentsTableForTest().deleteItem(context, {
        partitionType: "Document",
        documentId,
        sortRangeType: "Snapshot",
    });

    await expect(async () => {
        await getDocument(context.request(session), documentId);
    }).rejects.toThrow(DataLossError);
});

test("can't update a corrupted document", async () => {
    const documentId = generateId();

    await createDocument(context.request(session), {
        id: documentId,
        spaceId: space.id,
        content: emptyDocumentContent,
    });

    await getDocumentsTableForTest().deleteItem(context, {
        partitionType: "Document",
        documentId,
        sortRangeType: "Snapshot",
    });

    await expect(async () => {
        await updateDocumentContent(context.request(session), {
            id: documentId,
            version: 0,
            steps: [new ReplaceStep(3, 3, textSlice("b"))],
            clientId: generateId(),
        });
    }).rejects.toThrow(DataLossError);
});

test("won't cache a corrupted document while updating", async () => {
    const documentId = generateId();

    await createDocument(context.request(session), {
        id: documentId,
        spaceId: space.id,
        content: emptyDocumentContent,
    });

    await getDocumentsTableForTest().deleteItem(context, {
        partitionType: "Document",
        documentId,
        sortRangeType: "Snapshot",
    });

    const {getCount} = getInternalDocumentTestCounter.recordForTest(documentId);
    expect(getCount()).toEqual(0);

    await expect(async () => {
        await updateDocumentContent(context.request(session), {
            id: documentId,
            version: 0,
            steps: [new ReplaceStep(3, 3, textSlice("b"))],
            clientId: generateId(),
        });
    }).rejects.toThrow(DataLossError);

    expect(getCount()).toEqual(1);

    await expect(async () => {
        await updateDocumentContent(context.request(session), {
            id: documentId,
            version: 0,
            steps: [new ReplaceStep(3, 3, textSlice("b"))],
            clientId: generateId(),
        });
    }).rejects.toThrow(DataLossError);

    expect(getCount()).toEqual(2);
});

test("updates made in parallel will only read the document once", async () => {
    async function retryFlakyTest(action: () => Promise<void>): Promise<void> {
        let retryCount = 5;

        while (retryCount > 0) {
            retryCount--;

            try {
                await action();
            } catch (error) {
                // Ignore errors until the last run.
                if (retryCount === 0) {
                    throw error;
                }
            }
        }
    }

    // TODO(calebmer): Should debug why this is flaky and fix the root cause.
    //
    // Maybe by the time you see this the test won't be flaky and you can remove
    // this! Or there will be better flake detection and retry logic built by some
    // team with a cool name. Wouldn't that be neat.
    await retryFlakyTest(async () => {
        const documentId = generateId();

        await createDocument(context.request(session), {
            id: documentId,
            spaceId: space.id,
            content: emptyDocumentContent,
        });

        const {getCount} = getInternalDocumentTestCounter.recordForTest(documentId);
        expect(getCount()).toEqual(0);

        const request1Promise = updateDocumentContent(context.request(session), {
            id: documentId,
            version: 0,
            steps: [new ReplaceStep(3, 3, textSlice("a"))],
            clientId: generateId(),
        });

        const request2Promise = updateDocumentContent(context.request(session), {
            id: documentId,
            version: 0,
            steps: [new ReplaceStep(3, 3, textSlice("b"))],
            clientId: generateId(),
        });

        const request3Promise = updateDocumentContent(context.request(session), {
            id: documentId,
            version: 0,
            steps: [new ReplaceStep(3, 3, textSlice("c"))],
            clientId: generateId(),
        });

        const request4Promise = updateDocumentContent(context.request(session), {
            id: documentId,
            version: 0,
            steps: [new ReplaceStep(3, 3, textSlice("d"))],
            clientId: generateId(),
        });

        await runAllPromises([request1Promise, request2Promise, request3Promise, request4Promise]);

        expect(getCount()).toEqual(1);

        {
            const document = await getDocument(context.request(session), documentId);
            expect(document?.version).toEqual(4);
            expect(document?.content.child(1).textContent.split("").sort().join("")).toEqual(
                "abcd",
            );
        }
    });
});

test("if a document was deleted in the database then the cache will pick that up", async () => {
    const documentId = generateId();

    await createDocument(context.request(session), {
        id: documentId,
        spaceId: space.id,
        content: emptyDocumentContent,
    });

    const {getCount} = getInternalDocumentTestCounter.recordForTest(documentId);
    expect(getCount()).toEqual(0);

    await updateDocumentContent(context.request(session), {
        id: documentId,
        version: 0,
        steps: [new ReplaceStep(3, 3, textSlice("a"))],
        clientId: generateId(),
    });

    expect(getCount()).toEqual(1);

    await getDocumentsTableForTest().deleteItem(context, {
        partitionType: "Document",
        documentId,
        sortRangeType: "Attributes",
    });

    expect(getCount()).toEqual(1);

    await expect(async () => {
        await updateDocumentContent(context.request(session), {
            id: documentId,
            version: 1,
            steps: [new ReplaceStep(4, 4, textSlice("b"))],
            clientId: generateId(),
        });
    }).rejects.toThrowError(NotFoundError);

    expect(getCount()).toEqual(1);
});

test("updates may happen with different caches", async () => {
    const documentId = generateId();

    await createDocument(context.request(session), {
        id: documentId,
        spaceId: space.id,
        content: emptyDocumentContent,
    });

    const {getCount} = getInternalDocumentTestCounter.recordForTest(documentId);
    expect(getCount()).toEqual(0);

    await updateDocumentContent(context.request(session), {
        id: documentId,
        version: 0,
        steps: [new ReplaceStep(3, 3, textSlice("a"))],
        clientId: generateId(),
    });

    expect(getCount()).toEqual(1);

    expect(massageDocument(await getDocument(context.request(session), documentId))).toEqual({
        version: 1,
        content: schema
            .node("doc", {}, [
                schema.node("title", {}, []),
                schema.node("paragraph", {}, [schema.text("a")]),
            ])
            .toJSON(),
    });

    expect(getCount()).toEqual(2);

    await updateDocumentContent(context.request(session), {
        id: documentId,
        version: 1,
        steps: [new ReplaceStep(4, 4, textSlice("b"))],
        clientId: generateId(),
    });

    expect(getCount()).toEqual(2);

    expect(massageDocument(await getDocument(context.request(session), documentId))).toEqual({
        version: 2,
        content: schema
            .node("doc", {}, [
                schema.node("title", {}, []),
                schema.node("paragraph", {}, [schema.text("ab")]),
            ])
            .toJSON(),
    });

    expect(getCount()).toEqual(3);

    await updateDocumentContent(context.request(session), {
        id: documentId,
        version: 2,
        steps: [new ReplaceStep(5, 5, textSlice("c"))],
        clientId: generateId(),
        cacheOverrideForTest: otherCache,
    });

    expect(getCount()).toEqual(4);

    expect(massageDocument(await getDocument(context.request(session), documentId))).toEqual({
        version: 3,
        content: schema
            .node("doc", {}, [
                schema.node("title", {}, []),
                schema.node("paragraph", {}, [schema.text("abc")]),
            ])
            .toJSON(),
    });

    expect(getCount()).toEqual(5);

    await updateDocumentContent(context.request(session), {
        id: documentId,
        version: 3,
        steps: [new ReplaceStep(6, 6, textSlice("d"))],
        clientId: generateId(),
        cacheOverrideForTest: otherCache,
    });

    expect(getCount()).toEqual(5);

    expect(massageDocument(await getDocument(context.request(session), documentId))).toEqual({
        version: 4,
        content: schema
            .node("doc", {}, [
                schema.node("title", {}, []),
                schema.node("paragraph", {}, [schema.text("abcd")]),
            ])
            .toJSON(),
    });

    expect(getCount()).toEqual(6);

    await updateDocumentContent(context.request(session), {
        id: documentId,
        version: 4,
        steps: [new ReplaceStep(7, 7, textSlice("e"))],
        clientId: generateId(),
    });

    expect(getCount()).toEqual(6);

    expect(massageDocument(await getDocument(context.request(session), documentId))).toEqual({
        version: 5,
        content: schema
            .node("doc", {}, [
                schema.node("title", {}, []),
                schema.node("paragraph", {}, [schema.text("abcde")]),
            ])
            .toJSON(),
    });

    expect(getCount()).toEqual(7);

    await updateDocumentContent(context.request(session), {
        id: documentId,
        version: 5,
        steps: [new ReplaceStep(8, 8, textSlice("f"))],
        clientId: generateId(),
        cacheOverrideForTest: otherCache,
    });

    expect(getCount()).toEqual(7);

    expect(massageDocument(await getDocument(context.request(session), documentId))).toEqual({
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
    const documentId = generateId();

    await createDocument(context.request(session), {
        id: documentId,
        spaceId: space.id,
        content: emptyDocumentContent,
    });

    const {getCount} = getInternalDocumentTestCounter.recordForTest(documentId);
    expect(getCount()).toEqual(0);

    await updateDocumentContent(context.request(session), {
        id: documentId,
        version: 0,
        steps: [new ReplaceStep(3, 3, textSlice("a"))],
        clientId: generateId(),
    });

    expect(getCount()).toEqual(1);

    expect(massageDocument(await getDocument(context.request(session), documentId))).toEqual({
        version: 1,
        content: schema
            .node("doc", {}, [
                schema.node("title", {}, []),
                schema.node("paragraph", {}, [schema.text("a")]),
            ])
            .toJSON(),
    });

    expect(getCount()).toEqual(2);

    await updateDocumentContent(context.request(session), {
        id: documentId,
        version: 1,
        steps: [new ReplaceStep(4, 4, textSlice("b"))],
        clientId: generateId(),
    });

    expect(getCount()).toEqual(2);

    expect(massageDocument(await getDocument(context.request(session), documentId))).toEqual({
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

    await updateDocumentContent(context.request(session), {
        id: documentId,
        version: 2,
        steps: [new ReplaceStep(5, 5, textSlice("c"))],
        clientId: generateId(),
    });

    expect(getCount()).toEqual(4);

    expect(massageDocument(await getDocument(context.request(session), documentId))).toEqual({
        version: 3,
        content: schema
            .node("doc", {}, [
                schema.node("title", {}, []),
                schema.node("paragraph", {}, [schema.text("abc")]),
            ])
            .toJSON(),
    });

    expect(getCount()).toEqual(5);

    await updateDocumentContent(context.request(session), {
        id: documentId,
        version: 3,
        steps: [new ReplaceStep(6, 6, textSlice("d"))],
        clientId: generateId(),
    });

    expect(getCount()).toEqual(5);

    expect(massageDocument(await getDocument(context.request(session), documentId))).toEqual({
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
    const documentId = generateId();

    await createDocument(context.request(session), {
        id: documentId,
        spaceId: space.id,
        content: emptyDocumentContent,
    });

    const {getCount} = getInternalDocumentTestCounter.recordForTest(documentId);
    expect(getCount()).toEqual(0);

    await updateDocumentContent(context.request(session), {
        id: documentId,
        version: 0,
        steps: [new ReplaceStep(3, 3, textSlice("a"))],
        clientId: generateId(),
    });

    expect(getCount()).toEqual(1);

    expect(massageDocument(await getDocument(context.request(session), documentId))).toEqual({
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

    await updateDocumentContent(context.request(session), {
        id: documentId,
        version: 1,
        steps: [new ReplaceStep(4, 4, textSlice("b"))],
        clientId: generateId(),
    });

    expect(getCount()).toEqual(3);

    expect(massageDocument(await getDocument(context.request(session), documentId))).toEqual({
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

    await updateDocumentContent(context.request(session), {
        id: documentId,
        version: 2,
        steps: [new ReplaceStep(5, 5, textSlice("c"))],
        clientId: generateId(),
    });

    expect(getCount()).toEqual(4);

    expect(massageDocument(await getDocument(context.request(session), documentId))).toEqual({
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

    await updateDocumentContent(context.request(session), {
        id: documentId,
        version: 3,
        steps: [new ReplaceStep(6, 6, textSlice("d"))],
        clientId: generateId(),
    });

    expect(getCount()).toEqual(5);

    expect(massageDocument(await getDocument(context.request(session), documentId))).toEqual({
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

    await updateDocumentContent(context.request(session), {
        id: documentId,
        version: 4,
        steps: [new ReplaceStep(7, 7, textSlice("e"))],
        clientId: generateId(),
    });

    expect(getCount()).toEqual(6);

    expect(massageDocument(await getDocument(context.request(session), documentId))).toEqual({
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

    await updateDocumentContent(context.request(session), {
        id: documentId,
        version: 5,
        steps: [new ReplaceStep(8, 8, textSlice("f"))],
        clientId: generateId(),
    });

    expect(getCount()).toEqual(8);

    expect(massageDocument(await getDocument(context.request(session), documentId))).toEqual({
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
    const documentId = generateId();

    await createDocument(context.request(session), {
        id: documentId,
        spaceId: space.id,
        content: emptyDocumentContent,
    });

    expect(massageDocument(await getDocument(context.request(session), documentId))).toEqual({
        version: 0,
        content: schema
            .node("doc", {}, [schema.node("title", {}, []), schema.node("paragraph", {}, [])])
            .toJSON(),
    });
    expect(await getDocumentPreview(context.request(session), documentId)).toEqual({
        id: documentId,
        spaceId: space.id,
        createdTime: expect.any(Date),
        version: 0,
        titleWithoutFallback: "",
    });

    await updateDocumentContent(context.request(session), {
        id: documentId,
        version: 0,
        steps: [new ReplaceStep(3, 3, textSlice("b"))],
        clientId: generateId(),
    });

    expect(massageDocument(await getDocument(context.request(session), documentId))).toEqual({
        version: 1,
        content: schema
            .node("doc", {}, [
                schema.node("title", {}, []),
                schema.node("paragraph", {}, [schema.text("b")]),
            ])
            .toJSON(),
    });
    expect(await getDocumentPreview(context.request(session), documentId)).toEqual({
        id: documentId,
        spaceId: space.id,
        createdTime: expect.any(Date),
        version: 1,
        titleWithoutFallback: "",
    });

    await updateDocumentContent(context.request(session), {
        id: documentId,
        version: 1,
        steps: [new ReplaceStep(1, 1, textSlice("f"))],
        clientId: generateId(),
    });

    expect(massageDocument(await getDocument(context.request(session), documentId))).toEqual({
        version: 2,
        content: schema
            .node("doc", {}, [
                schema.node("title", {}, [schema.text("f")]),
                schema.node("paragraph", {}, [schema.text("b")]),
            ])
            .toJSON(),
    });
    expect(await getDocumentPreview(context.request(session), documentId)).toEqual({
        id: documentId,
        spaceId: space.id,
        createdTime: expect.any(Date),
        version: 2,
        titleWithoutFallback: "f",
    });

    await updateDocumentContent(context.request(session), {
        id: documentId,
        version: 2,
        steps: [new ReplaceStep(5, 5, textSlice("a"))],
        clientId: generateId(),
    });

    expect(massageDocument(await getDocument(context.request(session), documentId))).toEqual({
        version: 3,
        content: schema
            .node("doc", {}, [
                schema.node("title", {}, [schema.text("f")]),
                schema.node("paragraph", {}, [schema.text("ba")]),
            ])
            .toJSON(),
    });
    expect(await getDocumentPreview(context.request(session), documentId)).toEqual({
        id: documentId,
        spaceId: space.id,
        createdTime: expect.any(Date),
        version: 3,
        titleWithoutFallback: "f",
    });

    await updateDocumentContent(context.request(session), {
        id: documentId,
        version: 3,
        steps: [new ReplaceStep(2, 2, textSlice("o")), new ReplaceStep(3, 3, textSlice("o"))],
        clientId: generateId(),
    });

    expect(massageDocument(await getDocument(context.request(session), documentId))).toEqual({
        version: 5,
        content: schema
            .node("doc", {}, [
                schema.node("title", {}, [schema.text("foo")]),
                schema.node("paragraph", {}, [schema.text("ba")]),
            ])
            .toJSON(),
    });
    expect(await getDocumentPreview(context.request(session), documentId)).toEqual({
        id: documentId,
        spaceId: space.id,
        createdTime: expect.any(Date),
        version: 5,
        titleWithoutFallback: "foo",
    });

    await updateDocumentContent(context.request(session), {
        id: documentId,
        version: 5,
        steps: [new ReplaceStep(8, 8, textSlice("r"))],
        clientId: generateId(),
    });

    expect(massageDocument(await getDocument(context.request(session), documentId))).toEqual({
        version: 6,
        content: schema
            .node("doc", {}, [
                schema.node("title", {}, [schema.text("foo")]),
                schema.node("paragraph", {}, [schema.text("bar")]),
            ])
            .toJSON(),
    });
    expect(await getDocumentPreview(context.request(session), documentId)).toEqual({
        id: documentId,
        spaceId: space.id,
        createdTime: expect.any(Date),
        version: 6,
        titleWithoutFallback: "foo",
    });

    await updateDocumentContent(context.request(session), {
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

    expect(massageDocument(await getDocument(context.request(session), documentId))).toEqual({
        version: 7,
        content: schema
            .node("doc", {}, [
                schema.node("title", {}, [schema.text("foo")]),
                schema.node("paragraph", {}, [schema.text("bar")]),
                schema.node("paragraph", {}, []),
            ])
            .toJSON(),
    });
    expect(await getDocumentPreview(context.request(session), documentId)).toEqual({
        id: documentId,
        spaceId: space.id,
        createdTime: expect.any(Date),
        version: 7,
        titleWithoutFallback: "foo",
    });

    await updateDocumentContent(context.request(session), {
        id: documentId,
        version: 7,
        steps: [new ReplaceStep(4, 6, Slice.empty, true)],
        clientId: generateId(),
    });

    expect(massageDocument(await getDocument(context.request(session), documentId))).toEqual({
        version: 8,
        content: schema
            .node("doc", {}, [
                schema.node("title", {}, [schema.text("foobar")]),
                schema.node("paragraph", {}, []),
            ])
            .toJSON(),
    });
    expect(await getDocumentPreview(context.request(session), documentId)).toEqual({
        id: documentId,
        spaceId: space.id,
        createdTime: expect.any(Date),
        version: 8,
        titleWithoutFallback: "foobar",
    });
});

test("resolves a conflict when typing in deleted content", async () => {
    const documentId = generateId();

    await createDocument(context.request(session), {
        id: documentId,
        spaceId: space.id,
        content: emptyDocumentContent,
    });

    await updateDocumentContent(context.request(session), {
        id: documentId,
        version: 0,
        steps: [new ReplaceStep(3, 3, textSlice("foo")), new ReplaceStep(6, 6, textSlice("bar"))],
        clientId: generateId(),
    });

    expect(massageDocument(await getDocument(context.request(session), documentId))).toEqual({
        version: 2,
        content: schema
            .node("doc", {}, [
                schema.node("title", {}, []),
                schema.node("paragraph", {}, [schema.text("foobar")]),
            ])
            .toJSON(),
    });

    await updateDocumentContent(context.request(session), {
        id: documentId,
        version: 2,
        steps: [new ReplaceStep(3, 9, textSlice(""))],
        clientId: generateId(),
    });

    expect(massageDocument(await getDocument(context.request(session), documentId))).toEqual({
        version: 3,
        content: schema
            .node("doc", {}, [schema.node("title", {}, []), schema.node("paragraph", {}, [])])
            .toJSON(),
    });

    await updateDocumentContent(context.request(session), {
        id: documentId,
        version: 2,
        steps: [new ReplaceStep(6, 6, textSlice("x"))],
        clientId: generateId(),
    });

    expect(massageDocument(await getDocument(context.request(session), documentId))).toEqual({
        version: 3,
        content: schema
            .node("doc", {}, [schema.node("title", {}, []), schema.node("paragraph", {}, [])])
            .toJSON(),
    });
});

test("resolves a conflict when typing in deleted content and the delete action itself was a conflict", async () => {
    const documentId = generateId();

    await createDocument(context.request(session), {
        id: documentId,
        spaceId: space.id,
        content: emptyDocumentContent,
    });

    await updateDocumentContent(context.request(session), {
        id: documentId,
        version: 0,
        steps: [new ReplaceStep(3, 3, textSlice("foo")), new ReplaceStep(6, 6, textSlice("bar"))],
        clientId: generateId(),
    });

    expect(massageDocument(await getDocument(context.request(session), documentId))).toEqual({
        version: 2,
        content: schema
            .node("doc", {}, [
                schema.node("title", {}, []),
                schema.node("paragraph", {}, [schema.text("foobar")]),
            ])
            .toJSON(),
    });

    await updateDocumentContent(context.request(session), {
        id: documentId,
        version: 2,
        steps: [new ReplaceStep(1, 1, textSlice("x"))],
        clientId: generateId(),
    });

    expect(massageDocument(await getDocument(context.request(session), documentId))).toEqual({
        version: 3,
        content: schema
            .node("doc", {}, [
                schema.node("title", {}, [schema.text("x")]),
                schema.node("paragraph", {}, [schema.text("foobar")]),
            ])
            .toJSON(),
    });

    await updateDocumentContent(context.request(session), {
        id: documentId,
        version: 2,
        steps: [new ReplaceStep(3, 9, textSlice(""))],
        clientId: generateId(),
    });

    expect(massageDocument(await getDocument(context.request(session), documentId))).toEqual({
        version: 4,
        content: schema
            .node("doc", {}, [
                schema.node("title", {}, [schema.text("x")]),
                schema.node("paragraph", {}, []),
            ])
            .toJSON(),
    });

    await updateDocumentContent(context.request(session), {
        id: documentId,
        version: 2,
        steps: [new ReplaceStep(6, 6, textSlice("x"))],
        clientId: generateId(),
    });

    expect(massageDocument(await getDocument(context.request(session), documentId))).toEqual({
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
    const documentId = generateId();

    await createDocument(context.request(session), {
        id: documentId,
        spaceId: space.id,
        content: emptyDocumentContent,
    });

    await updateDocumentContent(context.request(session), {
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
            await getDocumentContentSteps(context.request(session), {
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
            await getDocumentContentSteps(context.request(session), {
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
            await getDocumentContentSteps(context.request(session), {
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
            await getDocumentContentSteps(context.request(session), {
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
            await getDocumentContentSteps(context.request(session), {
                id: documentId,
                startVersion: 2,
                endVersion: 3,
            }),
        ),
    ).toEqual([new ReplaceStep(5, 5, textSlice("c"))].map(step => step.toJSON()));
});

test("can read steps in individual transactions of single steps", async () => {
    const documentId = generateId();

    await createDocument(context.request(session), {
        id: documentId,
        spaceId: space.id,
        content: emptyDocumentContent,
    });

    await updateDocumentContent(context.request(session), {
        id: documentId,
        version: 0,
        steps: [new ReplaceStep(3, 3, textSlice("a"))],
        clientId: generateId(),
    });
    await updateDocumentContent(context.request(session), {
        id: documentId,
        version: 1,
        steps: [new ReplaceStep(4, 4, textSlice("b"))],
        clientId: generateId(),
    });
    await updateDocumentContent(context.request(session), {
        id: documentId,
        version: 2,
        steps: [new ReplaceStep(5, 5, textSlice("c"))],
        clientId: generateId(),
    });
    await updateDocumentContent(context.request(session), {
        id: documentId,
        version: 3,
        steps: [new ReplaceStep(6, 6, textSlice("d"))],
        clientId: generateId(),
    });
    await updateDocumentContent(context.request(session), {
        id: documentId,
        version: 4,
        steps: [new ReplaceStep(7, 7, textSlice("e"))],
        clientId: generateId(),
    });
    await updateDocumentContent(context.request(session), {
        id: documentId,
        version: 5,
        steps: [new ReplaceStep(8, 8, textSlice("f"))],
        clientId: generateId(),
    });

    const massageSteps = (steps: Array<{step: Step}>) => steps.map(({step}) => step.toJSON());

    expect(
        massageSteps(
            await getDocumentContentSteps(context.request(session), {
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
            await getDocumentContentSteps(context.request(session), {
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
            await getDocumentContentSteps(context.request(session), {
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
            await getDocumentContentSteps(context.request(session), {
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
            await getDocumentContentSteps(context.request(session), {
                id: documentId,
                startVersion: 2,
                endVersion: 3,
            }),
        ),
    ).toEqual([new ReplaceStep(5, 5, textSlice("c"))].map(step => step.toJSON()));
});

test("can read steps in a couple multi-step transactions", async () => {
    const documentId = generateId();

    await createDocument(context.request(session), {
        id: documentId,
        spaceId: space.id,
        content: emptyDocumentContent,
    });

    await updateDocumentContent(context.request(session), {
        id: documentId,
        version: 0,
        steps: [new ReplaceStep(3, 3, textSlice("a")), new ReplaceStep(4, 4, textSlice("b"))],
        clientId: generateId(),
    });
    await updateDocumentContent(context.request(session), {
        id: documentId,
        version: 2,
        steps: [new ReplaceStep(5, 5, textSlice("c")), new ReplaceStep(6, 6, textSlice("d"))],
        clientId: generateId(),
    });
    await updateDocumentContent(context.request(session), {
        id: documentId,
        version: 4,
        steps: [new ReplaceStep(7, 7, textSlice("e")), new ReplaceStep(8, 8, textSlice("f"))],
        clientId: generateId(),
    });

    const massageSteps = (steps: Array<{step: Step}>) => steps.map(({step}) => step.toJSON());

    expect(
        massageSteps(
            await getDocumentContentSteps(context.request(session), {
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
            await getDocumentContentSteps(context.request(session), {
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
            await getDocumentContentSteps(context.request(session), {
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
            await getDocumentContentSteps(context.request(session), {
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
            await getDocumentContentSteps(context.request(session), {
                id: documentId,
                startVersion: 2,
                endVersion: 3,
            }),
        ),
    ).toEqual([new ReplaceStep(5, 5, textSlice("c"))].map(step => step.toJSON()));
});
