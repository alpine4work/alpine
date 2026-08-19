import {Slice} from "prosemirror-model";
import {DocAttrStep, ReplaceStep} from "prosemirror-transform";
import {getDocumentHistoryDiff} from "~/server/documents/data/get_document_history_diff.js";
import {TestDocument} from "~/server/documents/test_helpers/test_document.js";
import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {TestFile} from "~/server/files/test_helpers/test_file.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";

const context = createTestContext();

test("loads references for the ending document-history version", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();
    const document = await TestDocument.create(session);
    const file = await TestFile.create(session);

    await document.attachFile(session, file);
    const contentWithFile = await document.getContent();
    await document.update(session, [
        new ReplaceStep(2, 2 + contentWithFile.child(1).nodeSize, Slice.empty),
    ]);

    const diff = await getDocumentHistoryDiff(session.action(), {
        id: document.id,
        startVersion: 0,
        endVersion: 1,
    });

    expect(diff.contentReferences.fileById?.has(file.id)).toBe(true);
});

test("loads references for deleted document-history content", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();
    const document = await TestDocument.create(session);
    const file = await TestFile.create(session);

    await document.attachFile(session, file);
    const contentWithFile = await document.getContent();
    await document.update(session, [
        new ReplaceStep(2, 2 + contentWithFile.child(1).nodeSize, Slice.empty),
    ]);

    const diff = await getDocumentHistoryDiff(session.action(), {
        id: document.id,
        startVersion: 1,
        endVersion: 2,
    });

    expect(diff.contentReferences.fileById?.has(file.id)).toBe(true);
});

test("rejects history comparisons larger than 500 steps", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();
    const document = await TestDocument.create(session);
    const startVersion = await document.getVersion();
    const steps = Array.from(
        {length: 501},
        (_, index) => new DocAttrStep("hasPresentShortcut", index % 2 === 0),
    );

    await document.update(session, steps);
    const endVersion = startVersion + steps.length;

    await expect(
        getDocumentHistoryDiff(session.action(), {
            id: document.id,
            startVersion,
            endVersion,
        }),
    ).rejects.toThrow("Document history comparisons may contain at most 500 steps");
});
