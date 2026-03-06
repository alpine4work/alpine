import {createDocument} from "~/server/documents/data/documents_actions.js";
import {doesDocumentExist} from "~/server/documents/data/does_document_exist.js";
import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {generateId} from "~/shared/id/id.js";
import {DocumentId} from "~/shared/id/types/id_types.js";

const context = createTestContext();

test("returns false for non-existent document", async () => {
    const space = await TestSpace.create(context);
    const documentId = generateId<DocumentId>();

    const exists = await doesDocumentExist(space.systemAction(), documentId);

    expect(exists).toBe(false);
});

test("returns true for existing document", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const {id: documentId} = await createDocument(session.action(), {spaceId: space.id});

    const exists = await doesDocumentExist(space.systemAction(), documentId);

    expect(exists).toBe(true);
});

test("caches the result", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const {id: documentId} = await createDocument(session.action(), {spaceId: space.id});

    // First call
    const exists1 = await doesDocumentExist(space.systemAction(), documentId);
    expect(exists1).toBe(true);

    // Second call should return cached result
    const exists2 = await doesDocumentExist(space.systemAction(), documentId);
    expect(exists2).toBe(true);
});
