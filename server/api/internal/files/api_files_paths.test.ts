import {TestLocalEdgeServiceContextModule} from "~/admin/environment/test/unit/test_local_edge_service_context_module.js";
import {apiFilesPaths} from "~/server/api/internal/files/api_files_paths.js";
import {createTestApiServer} from "~/server/api/internal/test_helpers/create_test_api_server.js";
import {TestBot} from "~/server/bots/test_helpers/test_bot.js";
import {documentsInjection} from "~/server/documents/data/documents_injection.js";
import {TestDocument} from "~/server/documents/test_helpers/test_document.js";
import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {TestFile} from "~/server/files/test_helpers/test_file.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {unknownFileId} from "~/shared/api/content/unknown_file_id.js";
import {generateChronologicalId} from "~/shared/id/chronological_id.js";
import {FileId} from "~/shared/id/types/id_types.js";

const context = createTestContext({documentsInjection}).cloneWithHelpers({
    edge: new TestLocalEdgeServiceContextModule({
        broadcastToDurableObject: () => {},
        sendRequestToDurableObject: () => Promise.resolve({newVersion: 1}),
    }),
});

const server = createTestApiServer(context, apiFilesPaths);

test("can get a signed URL for a file attached to a document", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession({role: "Admin"});

    const bot = await TestBot.createAndInstantiate(session);
    const apiKey = await bot.createApiKey(session);

    const document = await TestDocument.create(session, {
        title: "Doc with file",
        access: "Private",
    });
    const file = await TestFile.create(session);
    await document.attachFile(session, file);

    const response = await server.GET(`/files/${file.id}`, {
        headers: {authorization: `bearer ${apiKey}`},
    });

    expect(response).toMatchObject({
        status: 200,
        body: {
            signedUrl: expect.any(String),
        },
    });
});

test("can get a signed URL for a file uploaded by another account", async () => {
    const space = await TestSpace.create(context);
    const uploaderSession = await space.createSession({role: "Admin"});
    const botOwnerSession = await space.createSession({role: "Admin"});

    const bot = await TestBot.createAndInstantiate(botOwnerSession);
    const apiKey = await bot.createApiKey(botOwnerSession);

    const document = await TestDocument.create(uploaderSession, {
        title: "Doc with file",
        access: "Public",
    });
    const file = await TestFile.create(uploaderSession);
    await document.attachFile(uploaderSession, file);

    const response = await server.GET(`/files/${file.id}`, {
        headers: {authorization: `bearer ${apiKey}`},
    });

    expect(response).toMatchObject({
        status: 200,
        body: {
            signedUrl: expect.any(String),
        },
    });
});

test("cannot access a file from a different space", async () => {
    const space1 = await TestSpace.create(context);
    const space1Session = await space1.createSession({role: "Admin"});

    const space2 = await TestSpace.create(context);
    const space2Session = await space2.createSession({role: "Admin"});

    const bot = await TestBot.createAndInstantiate(space1Session);
    const apiKey = await bot.createApiKey(space1Session);

    const document = await TestDocument.create(space2Session, {
        title: "Doc with file",
        access: "Private",
    });
    const file = await TestFile.create(space2Session);
    await document.attachFile(space2Session, file);

    const response = await server.GET(`/files/${file.id}`, {
        headers: {authorization: `bearer ${apiKey}`},
    });

    expect(response).toMatchObject({
        status: 403,
    });
});

test("cannot access a file that is not attached to any entity", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession({role: "Admin"});

    const bot = await TestBot.createAndInstantiate(session);
    const apiKey = await bot.createApiKey(session);

    const file = await TestFile.create(session);

    const response = await server.GET(`/files/${file.id}`, {
        headers: {authorization: `bearer ${apiKey}`},
    });

    expect(response).toMatchObject({
        status: 403,
    });
});

test("returns 404 for a nonexistent file", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession({role: "Admin"});

    const bot = await TestBot.createAndInstantiate(session);
    const apiKey = await bot.createApiKey(session);

    const nonexistentFileId = generateChronologicalId<FileId>();
    const response = await server.GET(`/files/${nonexistentFileId}`, {
        headers: {authorization: `bearer ${apiKey}`},
    });

    expect(response).toMatchObject({
        status: 404,
    });
});

test("returns a transparent pixel placeholder for the unknown file id", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession({role: "Admin"});

    const bot = await TestBot.createAndInstantiate(session);
    const apiKey = await bot.createApiKey(session);

    const response = await server.GET(`/files/${unknownFileId}`, {
        headers: {authorization: `bearer ${apiKey}`},
    });

    expect(response).toMatchObject({
        status: 200,
        body: {
            id: unknownFileId,
            contentType: "image/png",
            signedUrl: expect.stringContaining("data:image/png;base64,"),
            isUploading: false,
        },
    });
});

test("returns transparent pixel content for the unknown file id", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession({role: "Admin"});

    const bot = await TestBot.createAndInstantiate(session);
    const apiKey = await bot.createApiKey(session);

    const response = await server.GET(`/files/${unknownFileId}/content`, {
        headers: {authorization: `bearer ${apiKey}`},
    });

    expect(response).toMatchObject({
        status: 200,
        headers: expect.objectContaining({
            "content-type": "image/png",
            "cache-control": "public, max-age=31536000, immutable",
        }),
    });
});

test("file access follows sharing across multiple attachment targets", async () => {
    const space = await TestSpace.create(context);
    const userASession = await space.createSession({role: "Admin"});
    const userBSession = await space.createSession({role: "Admin"});

    const bot = await TestBot.createAndInstantiate(userBSession);
    const apiKey = await bot.createApiKey(userBSession);

    const file = await TestFile.create(userASession);

    // User A creates a private document with the file. User B's bot can't access the
    // file because the document is private to user A.
    const doc1 = await TestDocument.create(userASession, {
        title: "Doc 1",
        access: "Private",
    });
    await doc1.attachFile(userASession, file);

    expect(
        await server.GET(`/files/${file.id}`, {
            headers: {authorization: `bearer ${apiKey}`},
        }),
    ).toMatchObject({status: 403});

    // Doc 1 is shared with the whole space. Now user B's bot can fetch the file.
    await doc1.access.grantDefault(userASession, "View");

    expect(
        await server.GET(`/files/${file.id}`, {
            headers: {authorization: `bearer ${apiKey}`},
        }),
    ).toMatchObject({status: 200});

    // User A also attaches the file to a second private document. User B's bot still
    // has access through doc 1.
    const doc2 = await TestDocument.create(userASession, {
        title: "Doc 2",
        access: "Private",
    });
    await doc2.attachFile(userASession, file);

    expect(
        await server.GET(`/files/${file.id}`, {
            headers: {authorization: `bearer ${apiKey}`},
        }),
    ).toMatchObject({status: 200});

    // Doc 1 is unshared. User B's bot loses access through doc 1, and doc 2 is still
    // private. User B's bot can't access the file.
    await doc1.access.revokeDefault(userASession);

    expect(
        await server.GET(`/files/${file.id}`, {
            headers: {authorization: `bearer ${apiKey}`},
        }),
    ).toMatchObject({status: 403});

    // Doc 2 is shared with the whole space. Now user B's bot can fetch the file again.
    await doc2.access.grantDefault(userASession, "View");

    expect(
        await server.GET(`/files/${file.id}`, {
            headers: {authorization: `bearer ${apiKey}`},
        }),
    ).toMatchObject({status: 200});

    // Doc 1 is re-shared. User B's bot can access via both targets.
    await doc1.access.grantDefault(userASession, "View");

    expect(
        await server.GET(`/files/${file.id}`, {
            headers: {authorization: `bearer ${apiKey}`},
        }),
    ).toMatchObject({status: 200});

    // Both documents are unshared. User B's bot can no longer access the file.
    await doc1.access.revokeDefault(userASession);
    await doc2.access.revokeDefault(userASession);

    expect(
        await server.GET(`/files/${file.id}`, {
            headers: {authorization: `bearer ${apiKey}`},
        }),
    ).toMatchObject({status: 403});
});
