import {Fragment, Slice} from "prosemirror-model";
import {ReplaceStep} from "prosemirror-transform";
import {
    createDocument,
    readDocument,
    updateDocument,
    updateDocumentBeforeExecuteTransactionTestCheckpoint,
} from "~/server/dynamo/documents-table";
import {RequestContext} from "~/server/request/request-context";
import {
    emptyDocumentContent,
    isDocumentContent,
    DocumentContentProsemirrorSchema as schema,
} from "~/shared/content/document-content-schema";
import {FailedPreconditionError} from "~/shared/error/error";
import {assert} from "~/shared/helpers/control/assert";
import {generateId} from "~/shared/id/id";

function textSlice(text: string) {
    return new Slice(Fragment.from(schema.text(text)), 0, 0);
}

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

    await updateDocument(RequestContext.test(), {
        id: documentId,
        version: 0,
        steps: [new ReplaceStep(3, 3, textSlice("a"))],
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

    await updateDocument(RequestContext.test(), {
        id: documentId,
        version: 1,
        steps: [new ReplaceStep(4, 4, textSlice("b"))],
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

    await updateDocument(RequestContext.test(), {
        id: documentId,
        version: 2,
        steps: [new ReplaceStep(5, 5, textSlice("c"))],
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

    await updateDocument(RequestContext.test(), {
        id: documentId,
        version: 0,
        steps: [new ReplaceStep(3, 3, textSlice("a"))],
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

    await updateDocument(RequestContext.test(), {
        id: documentId,
        version: 1,
        steps: [
            new ReplaceStep(4, 4, textSlice("b")),
            new ReplaceStep(5, 5, textSlice("c")),
            new ReplaceStep(6, 6, textSlice("d")),
        ],
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

    await updateDocument(RequestContext.test(), {
        id: documentId,
        version: 0,
        steps: [new ReplaceStep(3, 3, textSlice("a"))],
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
        await updateDocument(RequestContext.test(), {
            id: documentId,
            version: 2,
            steps: [new ReplaceStep(5, 5, textSlice("c"))],
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

test("can not update a document if the version is less than the current version", async () => {
    const documentId = generateId();

    await createDocument(RequestContext.test(), {
        id: documentId,
        content: emptyDocumentContent,
    });

    await updateDocument(RequestContext.test(), {
        id: documentId,
        version: 0,
        steps: [new ReplaceStep(3, 3, textSlice("a"))],
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

    await updateDocument(RequestContext.test(), {
        id: documentId,
        version: 1,
        steps: [new ReplaceStep(4, 4, textSlice("b"))],
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
        await updateDocument(RequestContext.test(), {
            id: documentId,
            version: 1,
            steps: [new ReplaceStep(5, 5, textSlice("c"))],
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

test("one document update wins when two document updates race", async () => {
    const documentId = generateId();

    await createDocument(RequestContext.test(), {
        id: documentId,
        content: emptyDocumentContent,
    });

    await updateDocument(RequestContext.test(), {
        id: documentId,
        version: 0,
        steps: [new ReplaceStep(3, 3, textSlice("a"))],
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
        updateDocumentBeforeExecuteTransactionTestCheckpoint.pauseForTest(request2Context);
    const request2Promise = updateDocument(request2Context, {
        id: documentId,
        version: 1,
        steps: [new ReplaceStep(4, 4, textSlice("b"))],
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

    await updateDocument(RequestContext.test(), {
        id: documentId,
        version: 1,
        steps: [new ReplaceStep(4, 4, textSlice("c"))],
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

    await expect(request2Promise).rejects.toThrowError(FailedPreconditionError);

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
});
