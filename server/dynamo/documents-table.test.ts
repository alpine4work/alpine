import {Fragment, Slice} from "prosemirror-model";
import {ReplaceStep} from "prosemirror-transform";
import {
    DocumentContentCacheForUpdate,
    createDocument,
    documentContentCacheEvictionTimeoutMs,
    getDocumentsTableForTest,
    readDocument,
    readInternalDocumentTestCounter,
    updateDocumentContent,
    updateDocumentContentBeforeExecuteTransactionTestCheckpoint,
} from "~/server/dynamo/documents-table";
import {RequestContext} from "~/server/request/request-context";
import {
    emptyDocumentContent,
    isDocumentContent,
    DocumentContentProsemirrorSchema as schema,
} from "~/shared/content/document-content-schema";
import {DataLossError, FailedPreconditionError, NotFoundError} from "~/shared/error/error";
import {assert} from "~/shared/helpers/control/assert";
import {generateId} from "~/shared/id/id";

jest.useFakeTimers();

function textSlice(text: string) {
    return new Slice(Fragment.from(schema.text(text)), 0, 0);
}

const otherCache = new DocumentContentCacheForUpdate();

afterEach(() => {
    const hadNoTimers = jest.getTimerCount() === 0;
    jest.clearAllTimers();
    assert(hadNoTimers, "Expected all timers to be cleaned up by the end of each test");
});

test("creates a document", async () => {
    await createDocument(RequestContext.test(), {
        id: generateId(),
        content: emptyDocumentContent,
    });
});

test("can not create a document with the same id twice", async () => {
    const id = generateId();

    await createDocument(RequestContext.test(), {
        id,
        content: emptyDocumentContent,
    });

    await expect(async () => {
        await createDocument(RequestContext.test(), {
            id,
            content: emptyDocumentContent,
        });
    }).rejects.toThrow(FailedPreconditionError);
});

test("can idempotently create a document twice", async () => {
    const id = generateId();
    const requestContext = RequestContext.test();

    await createDocument(requestContext, {
        id,
        content: emptyDocumentContent,
    });

    await createDocument(requestContext, {
        id,
        content: emptyDocumentContent,
    });
});

test("can not idempotently create a document twice if the content is different", async () => {
    const id = generateId();
    const requestContext = RequestContext.test();

    await createDocument(requestContext, {
        id,
        content: emptyDocumentContent,
    });

    const otherContent = schema.node("doc", {}, [
        schema.node("title", {}, [schema.text("Foo bar")]),
        schema.node("paragraph", {}, [schema.text("Hello, world!")]),
    ]);
    assert(isDocumentContent(otherContent));

    await expect(async () => {
        await createDocument(requestContext, {
            id,
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

    await createDocument(RequestContext.test(), {
        id: documentId,
        content,
    });

    const document = await readDocument(RequestContext.test(), documentId);

    expect(document).toEqual({
        id: documentId,
        title: "Foo bar",
        version: 0,
        content,
    });
});

test("can update a document with a single step", async () => {
    const documentId = generateId();

    await createDocument(RequestContext.test(), {
        id: documentId,
        content: emptyDocumentContent,
    });

    await updateDocumentContent(RequestContext.test(), {
        id: documentId,
        version: 0,
        steps: [new ReplaceStep(3, 3, textSlice("a"))],
        clientId: generateId(),
    });

    {
        const document = await readDocument(RequestContext.test(), documentId);
        expect(document?.version).toEqual(1);
        expect(document?.content.toJSON()).toEqual(
            schema
                .node("doc", {}, [
                    schema.node("title", {}, []),
                    schema.node("paragraph", {}, [schema.text("a")]),
                ])
                .toJSON(),
        );
    }

    await updateDocumentContent(RequestContext.test(), {
        id: documentId,
        version: 1,
        steps: [new ReplaceStep(4, 4, textSlice("b"))],
        clientId: generateId(),
    });

    {
        const document = await readDocument(RequestContext.test(), documentId);
        expect(document?.version).toEqual(2);
        expect(document?.content.toJSON()).toEqual(
            schema
                .node("doc", {}, [
                    schema.node("title", {}, []),
                    schema.node("paragraph", {}, [schema.text("ab")]),
                ])
                .toJSON(),
        );
    }

    await updateDocumentContent(RequestContext.test(), {
        id: documentId,
        version: 2,
        steps: [new ReplaceStep(5, 5, textSlice("c"))],
        clientId: generateId(),
    });

    {
        const document = await readDocument(RequestContext.test(), documentId);
        expect(document?.version).toEqual(3);
        expect(document?.content.toJSON()).toEqual(
            schema
                .node("doc", {}, [
                    schema.node("title", {}, []),
                    schema.node("paragraph", {}, [schema.text("abc")]),
                ])
                .toJSON(),
        );
    }
});

test("can update a document with multiple steps", async () => {
    const documentId = generateId();

    await createDocument(RequestContext.test(), {
        id: documentId,
        content: emptyDocumentContent,
    });

    await updateDocumentContent(RequestContext.test(), {
        id: documentId,
        version: 0,
        steps: [new ReplaceStep(3, 3, textSlice("a"))],
        clientId: generateId(),
    });

    {
        const document = await readDocument(RequestContext.test(), documentId);
        expect(document?.version).toEqual(1);
        expect(document?.content.toJSON()).toEqual(
            schema
                .node("doc", {}, [
                    schema.node("title", {}, []),
                    schema.node("paragraph", {}, [schema.text("a")]),
                ])
                .toJSON(),
        );
    }

    await updateDocumentContent(RequestContext.test(), {
        id: documentId,
        version: 1,
        steps: [
            new ReplaceStep(4, 4, textSlice("b")),
            new ReplaceStep(5, 5, textSlice("c")),
            new ReplaceStep(6, 6, textSlice("d")),
        ],
        clientId: generateId(),
    });

    {
        const document = await readDocument(RequestContext.test(), documentId);
        expect(document?.version).toEqual(4);
        expect(document?.content.toJSON()).toEqual(
            schema
                .node("doc", {}, [
                    schema.node("title", {}, []),
                    schema.node("paragraph", {}, [schema.text("abcd")]),
                ])
                .toJSON(),
        );
    }
});

test("can not update a document if the version is greater than the current version", async () => {
    const documentId = generateId();

    await createDocument(RequestContext.test(), {
        id: documentId,
        content: emptyDocumentContent,
    });

    await updateDocumentContent(RequestContext.test(), {
        id: documentId,
        version: 0,
        steps: [new ReplaceStep(3, 3, textSlice("a"))],
        clientId: generateId(),
    });

    {
        const document = await readDocument(RequestContext.test(), documentId);
        expect(document?.version).toEqual(1);
        expect(document?.content.toJSON()).toEqual(
            schema
                .node("doc", {}, [
                    schema.node("title", {}, []),
                    schema.node("paragraph", {}, [schema.text("a")]),
                ])
                .toJSON(),
        );
    }

    await expect(async () => {
        await updateDocumentContent(RequestContext.test(), {
            id: documentId,
            version: 2,
            steps: [new ReplaceStep(5, 5, textSlice("c"))],
            clientId: generateId(),
        });
    }).rejects.toThrow(FailedPreconditionError);

    {
        const document = await readDocument(RequestContext.test(), documentId);
        expect(document?.version).toEqual(1);
        expect(document?.content.toJSON()).toEqual(
            schema
                .node("doc", {}, [
                    schema.node("title", {}, []),
                    schema.node("paragraph", {}, [schema.text("a")]),
                ])
                .toJSON(),
        );
    }
});

test("can update a document if the version is one less than the current version", async () => {
    const documentId = generateId();

    await createDocument(RequestContext.test(), {
        id: documentId,
        content: emptyDocumentContent,
    });

    await updateDocumentContent(RequestContext.test(), {
        id: documentId,
        version: 0,
        steps: [new ReplaceStep(3, 3, textSlice("a"))],
        clientId: generateId(),
    });

    {
        const document = await readDocument(RequestContext.test(), documentId);
        expect(document?.version).toEqual(1);
        expect(document?.content.toJSON()).toEqual(
            schema
                .node("doc", {}, [
                    schema.node("title", {}, []),
                    schema.node("paragraph", {}, [schema.text("a")]),
                ])
                .toJSON(),
        );
    }

    await updateDocumentContent(RequestContext.test(), {
        id: documentId,
        version: 1,
        steps: [new ReplaceStep(4, 4, textSlice("b"))],
        clientId: generateId(),
    });

    {
        const document = await readDocument(RequestContext.test(), documentId);
        expect(document?.version).toEqual(2);
        expect(document?.content.toJSON()).toEqual(
            schema
                .node("doc", {}, [
                    schema.node("title", {}, []),
                    schema.node("paragraph", {}, [schema.text("ab")]),
                ])
                .toJSON(),
        );
    }

    await updateDocumentContent(RequestContext.test(), {
        id: documentId,
        version: 1,
        steps: [new ReplaceStep(4, 4, textSlice("c"))],
        clientId: generateId(),
    });

    {
        const document = await readDocument(RequestContext.test(), documentId);
        expect(document?.version).toEqual(3);
        expect(document?.content.toJSON()).toEqual(
            schema
                .node("doc", {}, [
                    schema.node("title", {}, []),
                    schema.node("paragraph", {}, [schema.text("abc")]),
                ])
                .toJSON(),
        );
    }
});

test("can update a document if the version is many steps behind the current version", async () => {
    const documentId = generateId();

    await createDocument(RequestContext.test(), {
        id: documentId,
        content: emptyDocumentContent,
    });

    await updateDocumentContent(RequestContext.test(), {
        id: documentId,
        version: 0,
        steps: [new ReplaceStep(3, 3, textSlice("a"))],
        clientId: generateId(),
    });

    {
        const document = await readDocument(RequestContext.test(), documentId);
        expect(document?.version).toEqual(1);
        expect(document?.content.toJSON()).toEqual(
            schema
                .node("doc", {}, [
                    schema.node("title", {}, []),
                    schema.node("paragraph", {}, [schema.text("a")]),
                ])
                .toJSON(),
        );
    }

    await updateDocumentContent(RequestContext.test(), {
        id: documentId,
        version: 1,
        steps: [new ReplaceStep(4, 4, textSlice("b"))],
        clientId: generateId(),
    });

    await updateDocumentContent(RequestContext.test(), {
        id: documentId,
        version: 2,
        steps: [new ReplaceStep(5, 5, textSlice("c"))],
        clientId: generateId(),
    });

    await updateDocumentContent(RequestContext.test(), {
        id: documentId,
        version: 3,
        steps: [new ReplaceStep(6, 6, textSlice("d"))],
        clientId: generateId(),
    });

    await updateDocumentContent(RequestContext.test(), {
        id: documentId,
        version: 4,
        steps: [new ReplaceStep(7, 7, textSlice("e"))],
        clientId: generateId(),
    });

    {
        const document = await readDocument(RequestContext.test(), documentId);
        expect(document?.version).toEqual(5);
        expect(document?.content.toJSON()).toEqual(
            schema
                .node("doc", {}, [
                    schema.node("title", {}, []),
                    schema.node("paragraph", {}, [schema.text("abcde")]),
                ])
                .toJSON(),
        );
    }

    await updateDocumentContent(RequestContext.test(), {
        id: documentId,
        version: 1,
        steps: [new ReplaceStep(4, 4, textSlice("f"))],
        clientId: generateId(),
    });

    {
        const document = await readDocument(RequestContext.test(), documentId);
        expect(document?.version).toEqual(6);
        expect(document?.content.toJSON()).toEqual(
            schema
                .node("doc", {}, [
                    schema.node("title", {}, []),
                    schema.node("paragraph", {}, [schema.text("abcdef")]),
                ])
                .toJSON(),
        );
    }
});

test("can update a document with many steps if the version is one less than the current version", async () => {
    const documentId = generateId();

    await createDocument(RequestContext.test(), {
        id: documentId,
        content: emptyDocumentContent,
    });

    await updateDocumentContent(RequestContext.test(), {
        id: documentId,
        version: 0,
        steps: [new ReplaceStep(3, 3, textSlice("a"))],
        clientId: generateId(),
    });

    {
        const document = await readDocument(RequestContext.test(), documentId);
        expect(document?.version).toEqual(1);
        expect(document?.content.toJSON()).toEqual(
            schema
                .node("doc", {}, [
                    schema.node("title", {}, []),
                    schema.node("paragraph", {}, [schema.text("a")]),
                ])
                .toJSON(),
        );
    }

    await updateDocumentContent(RequestContext.test(), {
        id: documentId,
        version: 1,
        steps: [new ReplaceStep(4, 4, textSlice("b"))],
        clientId: generateId(),
    });

    {
        const document = await readDocument(RequestContext.test(), documentId);
        expect(document?.version).toEqual(2);
        expect(document?.content.toJSON()).toEqual(
            schema
                .node("doc", {}, [
                    schema.node("title", {}, []),
                    schema.node("paragraph", {}, [schema.text("ab")]),
                ])
                .toJSON(),
        );
    }

    await updateDocumentContent(RequestContext.test(), {
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

    {
        const document = await readDocument(RequestContext.test(), documentId);
        expect(document?.version).toEqual(6);
        expect(document?.content.toJSON()).toEqual(
            schema
                .node("doc", {}, [
                    schema.node("title", {}, []),
                    schema.node("paragraph", {}, [schema.text("abcdef")]),
                ])
                .toJSON(),
        );
    }
});

test("can update a document with many steps if the version is many steps behind the current version", async () => {
    const documentId = generateId();

    await createDocument(RequestContext.test(), {
        id: documentId,
        content: emptyDocumentContent,
    });

    await updateDocumentContent(RequestContext.test(), {
        id: documentId,
        version: 0,
        steps: [new ReplaceStep(3, 3, textSlice("a"))],
        clientId: generateId(),
    });

    {
        const document = await readDocument(RequestContext.test(), documentId);
        expect(document?.version).toEqual(1);
        expect(document?.content.toJSON()).toEqual(
            schema
                .node("doc", {}, [
                    schema.node("title", {}, []),
                    schema.node("paragraph", {}, [schema.text("a")]),
                ])
                .toJSON(),
        );
    }

    await updateDocumentContent(RequestContext.test(), {
        id: documentId,
        version: 1,
        steps: [new ReplaceStep(4, 4, textSlice("b"))],
        clientId: generateId(),
    });

    await updateDocumentContent(RequestContext.test(), {
        id: documentId,
        version: 2,
        steps: [new ReplaceStep(5, 5, textSlice("c"))],
        clientId: generateId(),
    });

    await updateDocumentContent(RequestContext.test(), {
        id: documentId,
        version: 3,
        steps: [new ReplaceStep(6, 6, textSlice("d"))],
        clientId: generateId(),
    });

    await updateDocumentContent(RequestContext.test(), {
        id: documentId,
        version: 4,
        steps: [new ReplaceStep(7, 7, textSlice("e"))],
        clientId: generateId(),
    });

    {
        const document = await readDocument(RequestContext.test(), documentId);
        expect(document?.version).toEqual(5);
        expect(document?.content.toJSON()).toEqual(
            schema
                .node("doc", {}, [
                    schema.node("title", {}, []),
                    schema.node("paragraph", {}, [schema.text("abcde")]),
                ])
                .toJSON(),
        );
    }

    await updateDocumentContent(RequestContext.test(), {
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

    {
        const document = await readDocument(RequestContext.test(), documentId);
        expect(document?.version).toEqual(9);
        expect(document?.content.toJSON()).toEqual(
            schema
                .node("doc", {}, [
                    schema.node("title", {}, []),
                    schema.node("paragraph", {}, [schema.text("abcdefghi")]),
                ])
                .toJSON(),
        );
    }
});

test("when two document updates race the loser will rebase", async () => {
    const documentId = generateId();

    await createDocument(RequestContext.test(), {
        id: documentId,
        content: emptyDocumentContent,
    });

    await updateDocumentContent(RequestContext.test(), {
        id: documentId,
        version: 0,
        steps: [new ReplaceStep(3, 3, textSlice("a"))],
        clientId: generateId(),
    });

    {
        const document = await readDocument(RequestContext.test(), documentId);
        expect(document?.version).toEqual(1);
        expect(document?.content.toJSON()).toEqual(
            schema
                .node("doc", {}, [
                    schema.node("title", {}, []),
                    schema.node("paragraph", {}, [schema.text("a")]),
                ])
                .toJSON(),
        );
    }

    const request2Context = RequestContext.test();
    const request2PausePromise =
        updateDocumentContentBeforeExecuteTransactionTestCheckpoint.pauseForTest(request2Context);
    const request2Promise = updateDocumentContent(request2Context, {
        id: documentId,
        version: 1,
        steps: [new ReplaceStep(4, 4, textSlice("b"))],
        clientId: generateId(),
    });

    const {unpause: unpauseRequest2} = await request2PausePromise;

    {
        const document = await readDocument(RequestContext.test(), documentId);
        expect(document?.version).toEqual(1);
        expect(document?.content.toJSON()).toEqual(
            schema
                .node("doc", {}, [
                    schema.node("title", {}, []),
                    schema.node("paragraph", {}, [schema.text("a")]),
                ])
                .toJSON(),
        );
    }

    await updateDocumentContent(RequestContext.test(), {
        id: documentId,
        version: 1,
        steps: [new ReplaceStep(4, 4, textSlice("c"))],
        clientId: generateId(),
    });

    {
        const document = await readDocument(RequestContext.test(), documentId);
        expect(document?.version).toEqual(2);
        expect(document?.content.toJSON()).toEqual(
            schema
                .node("doc", {}, [
                    schema.node("title", {}, []),
                    schema.node("paragraph", {}, [schema.text("ac")]),
                ])
                .toJSON(),
        );
    }

    unpauseRequest2();

    await request2Promise;

    {
        const document = await readDocument(RequestContext.test(), documentId);
        expect(document?.version).toEqual(3);
        expect(document?.content.toJSON()).toEqual(
            schema
                .node("doc", {}, [
                    schema.node("title", {}, []),
                    schema.node("paragraph", {}, [schema.text("acb")]),
                ])
                .toJSON(),
        );
    }
});

test("can not apply an invalid step", async () => {
    const documentId = generateId();

    await createDocument(RequestContext.test(), {
        id: documentId,
        content: emptyDocumentContent,
    });

    await updateDocumentContent(RequestContext.test(), {
        id: documentId,
        version: 0,
        steps: [new ReplaceStep(3, 3, textSlice("a"))],
        clientId: generateId(),
    });

    {
        const document = await readDocument(RequestContext.test(), documentId);
        expect(document?.version).toEqual(1);
        expect(document?.content.toJSON()).toEqual(
            schema
                .node("doc", {}, [
                    schema.node("title", {}, []),
                    schema.node("paragraph", {}, [schema.text("a")]),
                ])
                .toJSON(),
        );
    }

    await expect(async () => {
        await updateDocumentContent(RequestContext.test(), {
            id: documentId,
            version: 1,
            steps: [new ReplaceStep(5, 5, textSlice("b"))],
            clientId: generateId(),
        });
    }).rejects.toThrow(FailedPreconditionError);

    {
        const document = await readDocument(RequestContext.test(), documentId);
        expect(document?.version).toEqual(1);
        expect(document?.content.toJSON()).toEqual(
            schema
                .node("doc", {}, [
                    schema.node("title", {}, []),
                    schema.node("paragraph", {}, [schema.text("a")]),
                ])
                .toJSON(),
        );
    }
});

test("can not apply an invalid step even when rebasing", async () => {
    const documentId = generateId();

    await createDocument(RequestContext.test(), {
        id: documentId,
        content: emptyDocumentContent,
    });

    await updateDocumentContent(RequestContext.test(), {
        id: documentId,
        version: 0,
        steps: [new ReplaceStep(3, 3, textSlice("a"))],
        clientId: generateId(),
    });

    {
        const document = await readDocument(RequestContext.test(), documentId);
        expect(document?.version).toEqual(1);
        expect(document?.content.toJSON()).toEqual(
            schema
                .node("doc", {}, [
                    schema.node("title", {}, []),
                    schema.node("paragraph", {}, [schema.text("a")]),
                ])
                .toJSON(),
        );
    }

    await updateDocumentContent(RequestContext.test(), {
        id: documentId,
        version: 1,
        steps: [new ReplaceStep(4, 4, textSlice("b"))],
        clientId: generateId(),
    });

    {
        const document = await readDocument(RequestContext.test(), documentId);
        expect(document?.version).toEqual(2);
        expect(document?.content.toJSON()).toEqual(
            schema
                .node("doc", {}, [
                    schema.node("title", {}, []),
                    schema.node("paragraph", {}, [schema.text("ab")]),
                ])
                .toJSON(),
        );
    }

    await expect(async () => {
        await updateDocumentContent(RequestContext.test(), {
            id: documentId,
            version: 1,
            steps: [new ReplaceStep(5, 5, textSlice("c"))],
            clientId: generateId(),
        });
    }).rejects.toThrow(FailedPreconditionError);

    {
        const document = await readDocument(RequestContext.test(), documentId);
        expect(document?.version).toEqual(2);
        expect(document?.content.toJSON()).toEqual(
            schema
                .node("doc", {}, [
                    schema.node("title", {}, []),
                    schema.node("paragraph", {}, [schema.text("ab")]),
                ])
                .toJSON(),
        );
    }
});

test("a single rebased step may end up as a noop", async () => {
    const documentId = generateId();

    await createDocument(RequestContext.test(), {
        id: documentId,
        content: emptyDocumentContent,
    });

    await updateDocumentContent(RequestContext.test(), {
        id: documentId,
        version: 0,
        steps: [new ReplaceStep(3, 3, textSlice("foobar"))],
        clientId: generateId(),
    });

    {
        const document = await readDocument(RequestContext.test(), documentId);
        expect(document?.version).toEqual(1);
        expect(document?.content.toJSON()).toEqual(
            schema
                .node("doc", {}, [
                    schema.node("title", {}, []),
                    schema.node("paragraph", {}, [schema.text("foobar")]),
                ])
                .toJSON(),
        );
    }

    await updateDocumentContent(RequestContext.test(), {
        id: documentId,
        version: 1,
        steps: [new ReplaceStep(5, 7, Slice.empty)],
        clientId: generateId(),
    });

    {
        const document = await readDocument(RequestContext.test(), documentId);
        expect(document?.version).toEqual(2);
        expect(document?.content.toJSON()).toEqual(
            schema
                .node("doc", {}, [
                    schema.node("title", {}, []),
                    schema.node("paragraph", {}, [schema.text("foar")]),
                ])
                .toJSON(),
        );
    }

    await updateDocumentContent(RequestContext.test(), {
        id: documentId,
        version: 1,
        steps: [new ReplaceStep(6, 6, textSlice("x"))],
        clientId: generateId(),
    });

    {
        const document = await readDocument(RequestContext.test(), documentId);
        expect(document?.version).toEqual(2);
        expect(document?.content.toJSON()).toEqual(
            schema
                .node("doc", {}, [
                    schema.node("title", {}, []),
                    schema.node("paragraph", {}, [schema.text("foar")]),
                ])
                .toJSON(),
        );
    }
});

test("many rebased steps may end up as a noop", async () => {
    const documentId = generateId();

    await createDocument(RequestContext.test(), {
        id: documentId,
        content: emptyDocumentContent,
    });

    await updateDocumentContent(RequestContext.test(), {
        id: documentId,
        version: 0,
        steps: [new ReplaceStep(3, 3, textSlice("foobur"))],
        clientId: generateId(),
    });

    {
        const document = await readDocument(RequestContext.test(), documentId);
        expect(document?.version).toEqual(1);
        expect(document?.content.toJSON()).toEqual(
            schema
                .node("doc", {}, [
                    schema.node("title", {}, []),
                    schema.node("paragraph", {}, [schema.text("foobur")]),
                ])
                .toJSON(),
        );
    }

    await updateDocumentContent(RequestContext.test(), {
        id: documentId,
        version: 1,
        steps: [new ReplaceStep(5, 7, Slice.empty)],
        clientId: generateId(),
    });

    {
        const document = await readDocument(RequestContext.test(), documentId);
        expect(document?.version).toEqual(2);
        expect(document?.content.toJSON()).toEqual(
            schema
                .node("doc", {}, [
                    schema.node("title", {}, []),
                    schema.node("paragraph", {}, [schema.text("four")]),
                ])
                .toJSON(),
        );
    }

    await updateDocumentContent(RequestContext.test(), {
        id: documentId,
        version: 1,
        steps: [
            new ReplaceStep(6, 6, textSlice("x")),
            new ReplaceStep(7, 7, textSlice("y")),
            new ReplaceStep(8, 8, textSlice("z")),
        ],
        clientId: generateId(),
    });

    {
        const document = await readDocument(RequestContext.test(), documentId);
        expect(document?.version).toEqual(2);
        expect(document?.content.toJSON()).toEqual(
            schema
                .node("doc", {}, [
                    schema.node("title", {}, []),
                    schema.node("paragraph", {}, [schema.text("four")]),
                ])
                .toJSON(),
        );
    }
});

test("some rebased steps may end up as a noop", async () => {
    const documentId = generateId();

    await createDocument(RequestContext.test(), {
        id: documentId,
        content: emptyDocumentContent,
    });

    await updateDocumentContent(RequestContext.test(), {
        id: documentId,
        version: 0,
        steps: [new ReplaceStep(3, 3, textSlice("foobur"))],
        clientId: generateId(),
    });

    {
        const document = await readDocument(RequestContext.test(), documentId);
        expect(document?.version).toEqual(1);
        expect(document?.content.toJSON()).toEqual(
            schema
                .node("doc", {}, [
                    schema.node("title", {}, []),
                    schema.node("paragraph", {}, [schema.text("foobur")]),
                ])
                .toJSON(),
        );
    }

    await updateDocumentContent(RequestContext.test(), {
        id: documentId,
        version: 1,
        steps: [new ReplaceStep(5, 7, Slice.empty)],
        clientId: generateId(),
    });

    {
        const document = await readDocument(RequestContext.test(), documentId);
        expect(document?.version).toEqual(2);
        expect(document?.content.toJSON()).toEqual(
            schema
                .node("doc", {}, [
                    schema.node("title", {}, []),
                    schema.node("paragraph", {}, [schema.text("four")]),
                ])
                .toJSON(),
        );
    }

    await updateDocumentContent(RequestContext.test(), {
        id: documentId,
        version: 1,
        steps: [
            new ReplaceStep(6, 6, textSlice("x")),
            new ReplaceStep(7, 7, textSlice("y")),
            new ReplaceStep(11, 11, textSlice("z")),
        ],
        clientId: generateId(),
    });

    {
        const document = await readDocument(RequestContext.test(), documentId);
        expect(document?.version).toEqual(3);
        expect(document?.content.toJSON()).toEqual(
            schema
                .node("doc", {}, [
                    schema.node("title", {}, []),
                    schema.node("paragraph", {}, [schema.text("fourz")]),
                ])
                .toJSON(),
        );
    }
});

test("reads the document on first update but not on subsequent updates", async () => {
    const documentId = generateId();

    await createDocument(RequestContext.test(), {
        id: documentId,
        content: emptyDocumentContent,
    });

    {
        const context = RequestContext.test();
        const {getCount} = readInternalDocumentTestCounter.recordForTest(context);
        expect(getCount()).toEqual(0);

        await updateDocumentContent(context, {
            id: documentId,
            version: 0,
            steps: [new ReplaceStep(3, 3, textSlice("a"))],
            clientId: generateId(),
        });

        expect(getCount()).toEqual(1);
    }

    {
        const document = await readDocument(RequestContext.test(), documentId);
        expect(document?.version).toEqual(1);
        expect(document?.content.toJSON()).toEqual(
            schema
                .node("doc", {}, [
                    schema.node("title", {}, []),
                    schema.node("paragraph", {}, [schema.text("a")]),
                ])
                .toJSON(),
        );
    }

    {
        const context = RequestContext.test();
        const {getCount} = readInternalDocumentTestCounter.recordForTest(context);
        expect(getCount()).toEqual(0);

        await updateDocumentContent(context, {
            id: documentId,
            version: 1,
            steps: [new ReplaceStep(4, 4, textSlice("b"))],
            clientId: generateId(),
        });

        expect(getCount()).toEqual(0);
    }

    {
        const document = await readDocument(RequestContext.test(), documentId);
        expect(document?.version).toEqual(2);
        expect(document?.content.toJSON()).toEqual(
            schema
                .node("doc", {}, [
                    schema.node("title", {}, []),
                    schema.node("paragraph", {}, [schema.text("ab")]),
                ])
                .toJSON(),
        );
    }

    {
        const context = RequestContext.test();
        const {getCount} = readInternalDocumentTestCounter.recordForTest(context);
        expect(getCount()).toEqual(0);

        await updateDocumentContent(context, {
            id: documentId,
            version: 2,
            steps: [new ReplaceStep(5, 5, textSlice("c"))],
            clientId: generateId(),
        });

        expect(getCount()).toEqual(0);
    }

    {
        const document = await readDocument(RequestContext.test(), documentId);
        expect(document?.version).toEqual(3);
        expect(document?.content.toJSON()).toEqual(
            schema
                .node("doc", {}, [
                    schema.node("title", {}, []),
                    schema.node("paragraph", {}, [schema.text("abc")]),
                ])
                .toJSON(),
        );
    }

    {
        const context = RequestContext.test();
        const {getCount} = readInternalDocumentTestCounter.recordForTest(context);
        expect(getCount()).toEqual(0);

        await updateDocumentContent(context, {
            id: documentId,
            version: 3,
            steps: [new ReplaceStep(6, 6, textSlice("d"))],
            clientId: generateId(),
        });

        expect(getCount()).toEqual(0);
    }

    {
        const document = await readDocument(RequestContext.test(), documentId);
        expect(document?.version).toEqual(4);
        expect(document?.content.toJSON()).toEqual(
            schema
                .node("doc", {}, [
                    schema.node("title", {}, []),
                    schema.node("paragraph", {}, [schema.text("abcd")]),
                ])
                .toJSON(),
        );
    }
});

test("can't update a document that doesn't exist", async () => {
    const documentId = generateId();

    await expect(async () => {
        await updateDocumentContent(RequestContext.test(), {
            id: documentId,
            version: 0,
            steps: [new ReplaceStep(3, 3, textSlice("a"))],
            clientId: generateId(),
        });
    }).rejects.toThrow(NotFoundError);
});

test("won't cache a document that doesn't exist when updating", async () => {
    const documentId = generateId();

    {
        const context = RequestContext.test();
        const {getCount} = readInternalDocumentTestCounter.recordForTest(context);
        expect(getCount()).toEqual(0);

        await expect(async () => {
            await updateDocumentContent(context, {
                id: documentId,
                version: 0,
                steps: [new ReplaceStep(3, 3, textSlice("a"))],
                clientId: generateId(),
            });
        }).rejects.toThrow(NotFoundError);

        expect(getCount()).toEqual(1);
    }

    {
        const context = RequestContext.test();
        const {getCount} = readInternalDocumentTestCounter.recordForTest(context);
        expect(getCount()).toEqual(0);

        await expect(async () => {
            await updateDocumentContent(context, {
                id: documentId,
                version: 0,
                steps: [new ReplaceStep(3, 3, textSlice("a"))],
                clientId: generateId(),
            });
        }).rejects.toThrow(NotFoundError);

        expect(getCount()).toEqual(1);
    }
});

test("can't read a corrupted document", async () => {
    const documentId = generateId();

    await createDocument(RequestContext.test(), {
        id: documentId,
        content: emptyDocumentContent,
    });

    await getDocumentsTableForTest().deleteItem(RequestContext.test(), {
        partitionType: "Document",
        documentId,
        sortRangeType: "Snapshot",
    });

    await expect(async () => {
        await readDocument(RequestContext.test(), documentId);
    }).rejects.toThrow(DataLossError);
});

test("can't update a corrupted document", async () => {
    const documentId = generateId();

    await createDocument(RequestContext.test(), {
        id: documentId,
        content: emptyDocumentContent,
    });

    await getDocumentsTableForTest().deleteItem(RequestContext.test(), {
        partitionType: "Document",
        documentId,
        sortRangeType: "Snapshot",
    });

    await expect(async () => {
        await updateDocumentContent(RequestContext.test(), {
            id: documentId,
            version: 0,
            steps: [new ReplaceStep(3, 3, textSlice("b"))],
            clientId: generateId(),
        });
    }).rejects.toThrow(DataLossError);
});

test("won't cache a corrupted document while updating", async () => {
    const documentId = generateId();

    await createDocument(RequestContext.test(), {
        id: documentId,
        content: emptyDocumentContent,
    });

    await getDocumentsTableForTest().deleteItem(RequestContext.test(), {
        partitionType: "Document",
        documentId,
        sortRangeType: "Snapshot",
    });

    {
        const context = RequestContext.test();
        const {getCount} = readInternalDocumentTestCounter.recordForTest(context);
        expect(getCount()).toEqual(0);

        await expect(async () => {
            await updateDocumentContent(context, {
                id: documentId,
                version: 0,
                steps: [new ReplaceStep(3, 3, textSlice("b"))],
                clientId: generateId(),
            });
        }).rejects.toThrow(DataLossError);

        expect(getCount()).toEqual(1);
    }

    {
        const context = RequestContext.test();
        const {getCount} = readInternalDocumentTestCounter.recordForTest(context);
        expect(getCount()).toEqual(0);

        await expect(async () => {
            await updateDocumentContent(context, {
                id: documentId,
                version: 0,
                steps: [new ReplaceStep(3, 3, textSlice("b"))],
                clientId: generateId(),
            });
        }).rejects.toThrow(DataLossError);

        expect(getCount()).toEqual(1);
    }
});

test("updates made in parallel will only read the document once", async () => {
    const documentId = generateId();

    await createDocument(RequestContext.test(), {
        id: documentId,
        content: emptyDocumentContent,
    });

    const request1Context = RequestContext.test();
    const {getCount: getRequest1Count} =
        readInternalDocumentTestCounter.recordForTest(request1Context);
    expect(getRequest1Count()).toEqual(0);

    const request1Promise = updateDocumentContent(request1Context, {
        id: documentId,
        version: 0,
        steps: [new ReplaceStep(3, 3, textSlice("a"))],
        clientId: generateId(),
    });

    const request2Context = RequestContext.test();
    const {getCount: getRequest2Count} =
        readInternalDocumentTestCounter.recordForTest(request2Context);
    expect(getRequest2Count()).toEqual(0);

    const request2Promise = updateDocumentContent(request2Context, {
        id: documentId,
        version: 0,
        steps: [new ReplaceStep(3, 3, textSlice("b"))],
        clientId: generateId(),
    });

    const request3Context = RequestContext.test();
    const {getCount: getRequest3Count} =
        readInternalDocumentTestCounter.recordForTest(request3Context);
    expect(getRequest3Count()).toEqual(0);

    const request3Promise = updateDocumentContent(request3Context, {
        id: documentId,
        version: 0,
        steps: [new ReplaceStep(3, 3, textSlice("c"))],
        clientId: generateId(),
    });

    const request4Context = RequestContext.test();
    const {getCount: getRequest4Count} =
        readInternalDocumentTestCounter.recordForTest(request4Context);
    expect(getRequest4Count()).toEqual(0);

    const request4Promise = updateDocumentContent(request4Context, {
        id: documentId,
        version: 0,
        steps: [new ReplaceStep(3, 3, textSlice("d"))],
        clientId: generateId(),
    });

    await Promise.all([request1Promise, request2Promise, request3Promise, request4Promise]);

    expect(
        [getRequest1Count(), getRequest2Count(), getRequest3Count(), getRequest4Count()].sort(),
    ).toEqual([0, 0, 0, 1]);

    {
        const document = await readDocument(RequestContext.test(), documentId);
        expect(document?.version).toEqual(4);
        expect(document?.content.child(1).textContent.split("").sort().join("")).toEqual("abcd");
    }
});

test("if a document was deleted in the database then the cache will pick that up", async () => {
    const documentId = generateId();

    await createDocument(RequestContext.test(), {
        id: documentId,
        content: emptyDocumentContent,
    });

    {
        const context = RequestContext.test();
        const {getCount} = readInternalDocumentTestCounter.recordForTest(context);
        expect(getCount()).toEqual(0);

        await updateDocumentContent(context, {
            id: documentId,
            version: 0,
            steps: [new ReplaceStep(3, 3, textSlice("a"))],
            clientId: generateId(),
        });

        expect(getCount()).toEqual(1);
    }

    await getDocumentsTableForTest().deleteItem(RequestContext.test(), {
        partitionType: "Document",
        documentId,
        sortRangeType: "Attributes",
    });

    {
        const context = RequestContext.test();
        const {getCount} = readInternalDocumentTestCounter.recordForTest(context);
        expect(getCount()).toEqual(0);

        await expect(async () => {
            await updateDocumentContent(context, {
                id: documentId,
                version: 1,
                steps: [new ReplaceStep(4, 4, textSlice("b"))],
                clientId: generateId(),
            });
        }).rejects.toThrowError(NotFoundError);

        expect(getCount()).toEqual(0);
    }
});

test("updates may happen with different caches", async () => {
    const documentId = generateId();

    await createDocument(RequestContext.test(), {
        id: documentId,
        content: emptyDocumentContent,
    });

    {
        const context = RequestContext.test();
        const {getCount} = readInternalDocumentTestCounter.recordForTest(context);
        expect(getCount()).toEqual(0);

        await updateDocumentContent(context, {
            id: documentId,
            version: 0,
            steps: [new ReplaceStep(3, 3, textSlice("a"))],
            clientId: generateId(),
        });

        expect(getCount()).toEqual(1);
    }

    {
        const document = await readDocument(RequestContext.test(), documentId);
        expect(document?.version).toEqual(1);
        expect(document?.content.toJSON()).toEqual(
            schema
                .node("doc", {}, [
                    schema.node("title", {}, []),
                    schema.node("paragraph", {}, [schema.text("a")]),
                ])
                .toJSON(),
        );
    }

    {
        const context = RequestContext.test();
        const {getCount} = readInternalDocumentTestCounter.recordForTest(context);
        expect(getCount()).toEqual(0);

        await updateDocumentContent(context, {
            id: documentId,
            version: 1,
            steps: [new ReplaceStep(4, 4, textSlice("b"))],
            clientId: generateId(),
        });

        expect(getCount()).toEqual(0);
    }

    {
        const document = await readDocument(RequestContext.test(), documentId);
        expect(document?.version).toEqual(2);
        expect(document?.content.toJSON()).toEqual(
            schema
                .node("doc", {}, [
                    schema.node("title", {}, []),
                    schema.node("paragraph", {}, [schema.text("ab")]),
                ])
                .toJSON(),
        );
    }

    {
        const context = RequestContext.test();
        const {getCount} = readInternalDocumentTestCounter.recordForTest(context);
        expect(getCount()).toEqual(0);

        await updateDocumentContent(context, {
            id: documentId,
            version: 2,
            steps: [new ReplaceStep(5, 5, textSlice("c"))],
            clientId: generateId(),
            cacheOverrideForTest: otherCache,
        });

        expect(getCount()).toEqual(1);
    }

    {
        const document = await readDocument(RequestContext.test(), documentId);
        expect(document?.version).toEqual(3);
        expect(document?.content.toJSON()).toEqual(
            schema
                .node("doc", {}, [
                    schema.node("title", {}, []),
                    schema.node("paragraph", {}, [schema.text("abc")]),
                ])
                .toJSON(),
        );
    }

    {
        const context = RequestContext.test();
        const {getCount} = readInternalDocumentTestCounter.recordForTest(context);
        expect(getCount()).toEqual(0);

        await updateDocumentContent(context, {
            id: documentId,
            version: 3,
            steps: [new ReplaceStep(6, 6, textSlice("d"))],
            clientId: generateId(),
            cacheOverrideForTest: otherCache,
        });

        expect(getCount()).toEqual(0);
    }

    {
        const document = await readDocument(RequestContext.test(), documentId);
        expect(document?.version).toEqual(4);
        expect(document?.content.toJSON()).toEqual(
            schema
                .node("doc", {}, [
                    schema.node("title", {}, []),
                    schema.node("paragraph", {}, [schema.text("abcd")]),
                ])
                .toJSON(),
        );
    }

    {
        const context = RequestContext.test();
        const {getCount} = readInternalDocumentTestCounter.recordForTest(context);
        expect(getCount()).toEqual(0);

        await updateDocumentContent(context, {
            id: documentId,
            version: 4,
            steps: [new ReplaceStep(7, 7, textSlice("e"))],
            clientId: generateId(),
        });

        expect(getCount()).toEqual(1);
    }

    {
        const document = await readDocument(RequestContext.test(), documentId);
        expect(document?.version).toEqual(5);
        expect(document?.content.toJSON()).toEqual(
            schema
                .node("doc", {}, [
                    schema.node("title", {}, []),
                    schema.node("paragraph", {}, [schema.text("abcde")]),
                ])
                .toJSON(),
        );
    }

    {
        const context = RequestContext.test();
        const {getCount} = readInternalDocumentTestCounter.recordForTest(context);
        expect(getCount()).toEqual(0);

        await updateDocumentContent(context, {
            id: documentId,
            version: 5,
            steps: [new ReplaceStep(8, 8, textSlice("f"))],
            clientId: generateId(),
            cacheOverrideForTest: otherCache,
        });

        expect(getCount()).toEqual(1);
    }

    {
        const document = await readDocument(RequestContext.test(), documentId);
        expect(document?.version).toEqual(6);
        expect(document?.content.toJSON()).toEqual(
            schema
                .node("doc", {}, [
                    schema.node("title", {}, []),
                    schema.node("paragraph", {}, [schema.text("abcdef")]),
                ])
                .toJSON(),
        );
    }
});

test("reads the document again after an expiration timer fires", async () => {
    const documentId = generateId();

    await createDocument(RequestContext.test(), {
        id: documentId,
        content: emptyDocumentContent,
    });

    {
        const context = RequestContext.test();
        const {getCount} = readInternalDocumentTestCounter.recordForTest(context);
        expect(getCount()).toEqual(0);

        await updateDocumentContent(context, {
            id: documentId,
            version: 0,
            steps: [new ReplaceStep(3, 3, textSlice("a"))],
            clientId: generateId(),
        });

        expect(getCount()).toEqual(1);
    }

    {
        const document = await readDocument(RequestContext.test(), documentId);
        expect(document?.version).toEqual(1);
        expect(document?.content.toJSON()).toEqual(
            schema
                .node("doc", {}, [
                    schema.node("title", {}, []),
                    schema.node("paragraph", {}, [schema.text("a")]),
                ])
                .toJSON(),
        );
    }

    {
        const context = RequestContext.test();
        const {getCount} = readInternalDocumentTestCounter.recordForTest(context);
        expect(getCount()).toEqual(0);

        await updateDocumentContent(context, {
            id: documentId,
            version: 1,
            steps: [new ReplaceStep(4, 4, textSlice("b"))],
            clientId: generateId(),
        });

        expect(getCount()).toEqual(0);
    }

    {
        const document = await readDocument(RequestContext.test(), documentId);
        expect(document?.version).toEqual(2);
        expect(document?.content.toJSON()).toEqual(
            schema
                .node("doc", {}, [
                    schema.node("title", {}, []),
                    schema.node("paragraph", {}, [schema.text("ab")]),
                ])
                .toJSON(),
        );
    }

    jest.runAllTimers();

    {
        const context = RequestContext.test();
        const {getCount} = readInternalDocumentTestCounter.recordForTest(context);
        expect(getCount()).toEqual(0);

        await updateDocumentContent(context, {
            id: documentId,
            version: 2,
            steps: [new ReplaceStep(5, 5, textSlice("c"))],
            clientId: generateId(),
        });

        expect(getCount()).toEqual(1);
    }

    {
        const document = await readDocument(RequestContext.test(), documentId);
        expect(document?.version).toEqual(3);
        expect(document?.content.toJSON()).toEqual(
            schema
                .node("doc", {}, [
                    schema.node("title", {}, []),
                    schema.node("paragraph", {}, [schema.text("abc")]),
                ])
                .toJSON(),
        );
    }

    {
        const context = RequestContext.test();
        const {getCount} = readInternalDocumentTestCounter.recordForTest(context);
        expect(getCount()).toEqual(0);

        await updateDocumentContent(context, {
            id: documentId,
            version: 3,
            steps: [new ReplaceStep(6, 6, textSlice("d"))],
            clientId: generateId(),
        });

        expect(getCount()).toEqual(0);
    }

    {
        const document = await readDocument(RequestContext.test(), documentId);
        expect(document?.version).toEqual(4);
        expect(document?.content.toJSON()).toEqual(
            schema
                .node("doc", {}, [
                    schema.node("title", {}, []),
                    schema.node("paragraph", {}, [schema.text("abcd")]),
                ])
                .toJSON(),
        );
    }
});

test("resets the timer eviction timer on every update", async () => {
    const documentId = generateId();

    await createDocument(RequestContext.test(), {
        id: documentId,
        content: emptyDocumentContent,
    });

    {
        const context = RequestContext.test();
        const {getCount} = readInternalDocumentTestCounter.recordForTest(context);
        expect(getCount()).toEqual(0);

        await updateDocumentContent(context, {
            id: documentId,
            version: 0,
            steps: [new ReplaceStep(3, 3, textSlice("a"))],
            clientId: generateId(),
        });

        expect(getCount()).toEqual(1);
    }

    {
        const document = await readDocument(RequestContext.test(), documentId);
        expect(document?.version).toEqual(1);
        expect(document?.content.toJSON()).toEqual(
            schema
                .node("doc", {}, [
                    schema.node("title", {}, []),
                    schema.node("paragraph", {}, [schema.text("a")]),
                ])
                .toJSON(),
        );
    }

    jest.advanceTimersByTime(documentContentCacheEvictionTimeoutMs);

    {
        const context = RequestContext.test();
        const {getCount} = readInternalDocumentTestCounter.recordForTest(context);
        expect(getCount()).toEqual(0);

        await updateDocumentContent(context, {
            id: documentId,
            version: 1,
            steps: [new ReplaceStep(4, 4, textSlice("b"))],
            clientId: generateId(),
        });

        expect(getCount()).toEqual(1);
    }

    {
        const document = await readDocument(RequestContext.test(), documentId);
        expect(document?.version).toEqual(2);
        expect(document?.content.toJSON()).toEqual(
            schema
                .node("doc", {}, [
                    schema.node("title", {}, []),
                    schema.node("paragraph", {}, [schema.text("ab")]),
                ])
                .toJSON(),
        );
    }

    jest.advanceTimersByTime(documentContentCacheEvictionTimeoutMs / 2);

    {
        const context = RequestContext.test();
        const {getCount} = readInternalDocumentTestCounter.recordForTest(context);
        expect(getCount()).toEqual(0);

        await updateDocumentContent(context, {
            id: documentId,
            version: 2,
            steps: [new ReplaceStep(5, 5, textSlice("c"))],
            clientId: generateId(),
        });

        expect(getCount()).toEqual(0);
    }

    {
        const document = await readDocument(RequestContext.test(), documentId);
        expect(document?.version).toEqual(3);
        expect(document?.content.toJSON()).toEqual(
            schema
                .node("doc", {}, [
                    schema.node("title", {}, []),
                    schema.node("paragraph", {}, [schema.text("abc")]),
                ])
                .toJSON(),
        );
    }

    jest.advanceTimersByTime(documentContentCacheEvictionTimeoutMs / 2);

    {
        const context = RequestContext.test();
        const {getCount} = readInternalDocumentTestCounter.recordForTest(context);
        expect(getCount()).toEqual(0);

        await updateDocumentContent(context, {
            id: documentId,
            version: 3,
            steps: [new ReplaceStep(6, 6, textSlice("d"))],
            clientId: generateId(),
        });

        expect(getCount()).toEqual(0);
    }

    {
        const document = await readDocument(RequestContext.test(), documentId);
        expect(document?.version).toEqual(4);
        expect(document?.content.toJSON()).toEqual(
            schema
                .node("doc", {}, [
                    schema.node("title", {}, []),
                    schema.node("paragraph", {}, [schema.text("abcd")]),
                ])
                .toJSON(),
        );
    }

    jest.advanceTimersByTime(documentContentCacheEvictionTimeoutMs / 2);

    {
        const context = RequestContext.test();
        const {getCount} = readInternalDocumentTestCounter.recordForTest(context);
        expect(getCount()).toEqual(0);

        await updateDocumentContent(context, {
            id: documentId,
            version: 4,
            steps: [new ReplaceStep(7, 7, textSlice("e"))],
            clientId: generateId(),
        });

        expect(getCount()).toEqual(0);
    }

    {
        const document = await readDocument(RequestContext.test(), documentId);
        expect(document?.version).toEqual(5);
        expect(document?.content.toJSON()).toEqual(
            schema
                .node("doc", {}, [
                    schema.node("title", {}, []),
                    schema.node("paragraph", {}, [schema.text("abcde")]),
                ])
                .toJSON(),
        );
    }

    jest.advanceTimersByTime(documentContentCacheEvictionTimeoutMs);

    {
        const context = RequestContext.test();
        const {getCount} = readInternalDocumentTestCounter.recordForTest(context);
        expect(getCount()).toEqual(0);

        await updateDocumentContent(context, {
            id: documentId,
            version: 5,
            steps: [new ReplaceStep(8, 8, textSlice("f"))],
            clientId: generateId(),
        });

        expect(getCount()).toEqual(1);
    }

    {
        const document = await readDocument(RequestContext.test(), documentId);
        expect(document?.version).toEqual(6);
        expect(document?.content.toJSON()).toEqual(
            schema
                .node("doc", {}, [
                    schema.node("title", {}, []),
                    schema.node("paragraph", {}, [schema.text("abcdef")]),
                ])
                .toJSON(),
        );
    }
});

test("updates the document title whenever it changes", async () => {
    const documentId = generateId();

    await createDocument(RequestContext.test(), {
        id: documentId,
        content: emptyDocumentContent,
    });

    {
        const document = await readDocument(RequestContext.test(), documentId);
        expect(document?.version).toEqual(0);
        expect(document?.title).toEqual("");
        expect(document?.content.toJSON()).toEqual(
            schema
                .node("doc", {}, [schema.node("title", {}, []), schema.node("paragraph", {}, [])])
                .toJSON(),
        );
    }

    await updateDocumentContent(RequestContext.test(), {
        id: documentId,
        version: 0,
        steps: [new ReplaceStep(3, 3, textSlice("b"))],
        clientId: generateId(),
    });

    {
        const document = await readDocument(RequestContext.test(), documentId);
        expect(document?.version).toEqual(1);
        expect(document?.title).toEqual("");
        expect(document?.content.toJSON()).toEqual(
            schema
                .node("doc", {}, [
                    schema.node("title", {}, []),
                    schema.node("paragraph", {}, [schema.text("b")]),
                ])
                .toJSON(),
        );
    }

    await updateDocumentContent(RequestContext.test(), {
        id: documentId,
        version: 1,
        steps: [new ReplaceStep(1, 1, textSlice("f"))],
        clientId: generateId(),
    });

    {
        const document = await readDocument(RequestContext.test(), documentId);
        expect(document?.version).toEqual(2);
        expect(document?.title).toEqual("f");
        expect(document?.content.toJSON()).toEqual(
            schema
                .node("doc", {}, [
                    schema.node("title", {}, [schema.text("f")]),
                    schema.node("paragraph", {}, [schema.text("b")]),
                ])
                .toJSON(),
        );
    }

    await updateDocumentContent(RequestContext.test(), {
        id: documentId,
        version: 2,
        steps: [new ReplaceStep(5, 5, textSlice("a"))],
        clientId: generateId(),
    });

    {
        const document = await readDocument(RequestContext.test(), documentId);
        expect(document?.version).toEqual(3);
        expect(document?.title).toEqual("f");
        expect(document?.content.toJSON()).toEqual(
            schema
                .node("doc", {}, [
                    schema.node("title", {}, [schema.text("f")]),
                    schema.node("paragraph", {}, [schema.text("ba")]),
                ])
                .toJSON(),
        );
    }

    await updateDocumentContent(RequestContext.test(), {
        id: documentId,
        version: 3,
        steps: [new ReplaceStep(2, 2, textSlice("o")), new ReplaceStep(3, 3, textSlice("o"))],
        clientId: generateId(),
    });

    {
        const document = await readDocument(RequestContext.test(), documentId);
        expect(document?.version).toEqual(5);
        expect(document?.title).toEqual("foo");
        expect(document?.content.toJSON()).toEqual(
            schema
                .node("doc", {}, [
                    schema.node("title", {}, [schema.text("foo")]),
                    schema.node("paragraph", {}, [schema.text("ba")]),
                ])
                .toJSON(),
        );
    }

    await updateDocumentContent(RequestContext.test(), {
        id: documentId,
        version: 5,
        steps: [new ReplaceStep(8, 8, textSlice("r"))],
        clientId: generateId(),
    });

    {
        const document = await readDocument(RequestContext.test(), documentId);
        expect(document?.version).toEqual(6);
        expect(document?.title).toEqual("foo");
        expect(document?.content.toJSON()).toEqual(
            schema
                .node("doc", {}, [
                    schema.node("title", {}, [schema.text("foo")]),
                    schema.node("paragraph", {}, [schema.text("bar")]),
                ])
                .toJSON(),
        );
    }

    await updateDocumentContent(RequestContext.test(), {
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

    {
        const document = await readDocument(RequestContext.test(), documentId);
        expect(document?.version).toEqual(7);
        expect(document?.title).toEqual("foo");
        expect(document?.content.toJSON()).toEqual(
            schema
                .node("doc", {}, [
                    schema.node("title", {}, [schema.text("foo")]),
                    schema.node("paragraph", {}, [schema.text("bar")]),
                    schema.node("paragraph", {}, []),
                ])
                .toJSON(),
        );
    }

    await updateDocumentContent(RequestContext.test(), {
        id: documentId,
        version: 7,
        steps: [new ReplaceStep(4, 6, Slice.empty, true)],
        clientId: generateId(),
    });

    {
        const document = await readDocument(RequestContext.test(), documentId);
        expect(document?.version).toEqual(8);
        expect(document?.title).toEqual("foobar");
        expect(document?.content.toJSON()).toEqual(
            schema
                .node("doc", {}, [
                    schema.node("title", {}, [schema.text("foobar")]),
                    schema.node("paragraph", {}, []),
                ])
                .toJSON(),
        );
    }
});
