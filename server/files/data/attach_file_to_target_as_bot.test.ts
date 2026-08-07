import {TestBot} from "~/server/bots/test_helpers/test_bot.js";
import {FileDocumentAuthorizer} from "~/server/documents/data/documents_actions.js";
import {TestDocument} from "~/server/documents/test_helpers/test_document.js";
import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {attachFileToTargetAsBot} from "~/server/files/data/attach_file_to_target_as_bot.js";
import {startUploadingFile} from "~/server/files/data/files_actions.js";
import {getFileFromAnyAttachment} from "~/server/files/data/get_file_from_any_attachment.js";
import {TestFile} from "~/server/files/test_helpers/test_file.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {generateChronologicalId} from "~/shared/id/chronological_id.open_source.js";
import {FileId} from "~/shared/id/types/id_types.open_source.js";

const context = createTestContext({
    documentsInjection: {
        bindFileDocumentAuthorizer: (_context, target) => FileDocumentAuthorizer.bind(target),
    },
});

test("returns metadata for the attached file", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession({role: "Admin"});
    const bot = await TestBot.createAndInstantiate(session);

    const document = await TestDocument.create(session, {
        title: "Doc with file",
        access: "Public",
    });
    const file = await TestFile.create(session);

    // Attach the file to the public document via the session first.
    await document.attachFile(session, file);

    // Now the bot can attach the file to another target because it has access through
    // the existing attachment.
    const doc2 = await TestDocument.create(session, {
        title: "Doc 2",
        access: "Public",
    });
    const attachedFile = await attachFileToTargetAsBot(
        bot.action(),
        file.id,
        FileDocumentAuthorizer.bind({type: "Document", documentId: doc2.id}),
    );

    expect(attachedFile).toMatchObject({
        id: file.id,
        spaceId: space.id,
        contentType: expect.any(String),
        contentLength: expect.any(Number),
    });
});

test("returns metadata for a file uploaded by the bot", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession({role: "Admin"});
    const bot = await TestBot.createAndInstantiate(session);
    const document = await TestDocument.create(session, {
        title: "Doc",
        access: "Public",
    });
    const {fileId} = await startUploadingFile(bot.action(), {
        spaceId: space.id,
        contentType: "image/png",
        contentLength: 123,
    });

    const attachedFile = await attachFileToTargetAsBot(
        bot.action(),
        fileId,
        FileDocumentAuthorizer.bind({type: "Document", documentId: document.id}),
    );

    expect(attachedFile).toMatchObject({
        id: fileId,
        spaceId: space.id,
        contentType: "image/png",
        contentLength: 123,
    });
});

test("non-bot actor is rejected", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession({role: "Admin"});
    const document = await TestDocument.create(session, {
        title: "Doc",
        access: "Public",
    });
    const file = await TestFile.create(session);

    await expect(
        attachFileToTargetAsBot(
            session.action(),
            file.id,
            FileDocumentAuthorizer.bind({type: "Document", documentId: document.id}),
        ),
    ).rejects.toThrow("Only bot actors can attach files to targets");
});

test("nonexistent file throws NotFoundError", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession({role: "Admin"});
    const bot = await TestBot.createAndInstantiate(session);
    const document = await TestDocument.create(session, {
        title: "Doc",
        access: "Public",
    });

    const fakeFileId = generateChronologicalId<FileId>();

    await expect(
        attachFileToTargetAsBot(
            bot.action(),
            fakeFileId,
            FileDocumentAuthorizer.bind({type: "Document", documentId: document.id}),
        ),
    ).rejects.toThrow("File not found");
});

test("file in different space throws NotFoundError", async () => {
    const space1 = await TestSpace.create(context);
    const session1 = await space1.createSession({role: "Admin"});
    const file = await TestFile.create(session1);

    const space2 = await TestSpace.create(context);
    const session2 = await space2.createSession({role: "Admin"});
    const bot = await TestBot.createAndInstantiate(session2);
    const document = await TestDocument.create(session2, {
        title: "Doc",
        access: "Public",
    });

    await expect(
        attachFileToTargetAsBot(
            bot.action(),
            file.id,
            FileDocumentAuthorizer.bind({type: "Document", documentId: document.id}),
        ),
    ).rejects.toThrow("File not found");
});

test("bot can attach file uploaded by another account if it has attachment access", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession({role: "Admin"});
    const bot = await TestBot.createAndInstantiate(session);

    // File uploaded by a regular user and attached to a public document.
    const file = await TestFile.create(session);
    const doc1 = await TestDocument.create(session, {
        title: "Source doc",
        access: "Public",
    });
    await doc1.attachFile(session, file);

    // Bot attaches the same file to a different document because it has access through
    // doc1.
    const doc2 = await TestDocument.create(session, {
        title: "Target doc",
        access: "Public",
    });

    await attachFileToTargetAsBot(
        bot.action(),
        file.id,
        FileDocumentAuthorizer.bind({type: "Document", documentId: doc2.id}),
    );

    const result = await getFileFromAnyAttachment(session.action(), file.id);
    expect(result.id).toBe(file.id);
});

test("bot cannot attach file from another account when attachment target is private", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession({role: "Admin"});
    const bot = await TestBot.createAndInstantiate(session);

    // File uploaded by user and attached to a private document the bot can't access.
    const file = await TestFile.create(session);
    const privateDoc = await TestDocument.create(session, {
        title: "Private doc",
        access: "Private",
    });
    await privateDoc.attachFile(session, file);

    const targetDoc = await TestDocument.create(session, {
        title: "Target doc",
        access: "Public",
    });

    await expect(
        attachFileToTargetAsBot(
            bot.action(),
            file.id,
            FileDocumentAuthorizer.bind({type: "Document", documentId: targetDoc.id}),
        ),
    ).rejects.toThrow("No access to file through any attachment target");
});

test("re-attaching already-attached file is idempotent", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession({role: "Admin"});
    const bot = await TestBot.createAndInstantiate(session);
    const document = await TestDocument.create(session, {
        title: "Doc",
        access: "Public",
    });
    const file = await TestFile.create(session);

    // Attach via session first so the bot has access through the attachment.
    await document.attachFile(session, file);

    const authorizer = FileDocumentAuthorizer.bind({
        type: "Document",
        documentId: document.id,
    });

    // Re-attaching twice should succeed.
    await attachFileToTargetAsBot(bot.action(), file.id, authorizer);
    await attachFileToTargetAsBot(bot.action(), file.id, authorizer);

    const result = await getFileFromAnyAttachment(session.action(), file.id);
    expect(result.id).toBe(file.id);
});
