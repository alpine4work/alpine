import {updateDocumentSnapshotForTest} from "~/server/documents/data/documents_actions.js";
import {getDocumentContentAtVersion} from "~/server/documents/data/get_document_content_at_version.js";
import {TestDocument} from "~/server/documents/test_helpers/test_document.js";
import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";

const context = createTestContext();

test("reconstructs document content on both sides of a snapshot", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();
    const document = await TestDocument.create(session);

    const contentAtVersion0 = await document.getContent();
    await document.type(session, "a");
    const contentAtVersion1 = await document.getContent();

    await updateDocumentSnapshotForTest(session.action(), document.id);

    await document.type(session, "b");
    const contentAtVersion2 = await document.getContent();
    await document.type(session, "c");
    const contentAtVersion3 = await document.getContent();

    expect(
        (
            await getDocumentContentAtVersion(session.action(), {id: document.id, version: 0})
        ).toJSON(),
    ).toEqual(contentAtVersion0.toJSON());
    expect(
        (
            await getDocumentContentAtVersion(session.action(), {id: document.id, version: 1})
        ).toJSON(),
    ).toEqual(contentAtVersion1.toJSON());
    expect(
        (
            await getDocumentContentAtVersion(session.action(), {id: document.id, version: 2})
        ).toJSON(),
    ).toEqual(contentAtVersion2.toJSON());
    expect(
        (
            await getDocumentContentAtVersion(session.action(), {id: document.id, version: 3})
        ).toJSON(),
    ).toEqual(contentAtVersion3.toJSON());
});
