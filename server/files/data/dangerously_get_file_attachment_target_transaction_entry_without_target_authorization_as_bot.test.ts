import {TestBot} from "~/server/bots/test_helpers/test_bot.js";
import {FileDocumentAuthorizer} from "~/server/documents/data/documents_actions.js";
import {TestDocument} from "~/server/documents/test_helpers/test_document.js";
import {DynamoTableSchema} from "~/server/dynamo/core/dynamo_table_schema.js";
import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {dangerouslyGetFileAttachmentTargetTransactionEntryWithoutTargetAuthorizationAsBot} from "~/server/files/data/dangerously_get_file_attachment_target_transaction_entry_without_target_authorization_as_bot.js";
import {getFileFromAttachment, startUploadingFile} from "~/server/files/data/files_actions.js";
import {TestFile} from "~/server/files/test_helpers/test_file.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {generateChronologicalId} from "~/shared/id/chronological_id.open_source.js";
import {FileId} from "~/shared/id/types/id_types.open_source.js";

const context = createTestContext({
    documentsInjection: {
        bindFileDocumentAuthorizer: (_context, target) => FileDocumentAuthorizer.bind(target),
    },
});

test("returns an entry that attaches a file uploaded by the bot", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession({role: "Admin"});
    const bot = await TestBot.createAndInstantiate(session);
    const document = await TestDocument.create(session);
    const {fileId} = await startUploadingFile(bot.action(), {
        spaceId: space.id,
        contentType: "image/png",
        contentLength: 123,
    });
    const authorizer = FileDocumentAuthorizer.bind({
        type: "DocumentComments",
        documentId: document.id,
    });

    const entry =
        await dangerouslyGetFileAttachmentTargetTransactionEntryWithoutTargetAuthorizationAsBot(
            bot.action(),
            fileId,
            authorizer,
        );
    await DynamoTableSchema.executeTransaction(bot.action(), [entry]);

    await expect(
        getFileFromAttachment(session.action(), fileId, authorizer),
    ).resolves.toMatchObject({
        id: fileId,
    });
});

test("does not attach the file before the returned entry is executed", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession({role: "Admin"});
    const bot = await TestBot.createAndInstantiate(session);
    const document = await TestDocument.create(session);
    const {fileId} = await startUploadingFile(bot.action(), {
        spaceId: space.id,
        contentType: "image/png",
        contentLength: 123,
    });
    const authorizer = FileDocumentAuthorizer.bind({
        type: "DocumentComments",
        documentId: document.id,
    });

    await dangerouslyGetFileAttachmentTargetTransactionEntryWithoutTargetAuthorizationAsBot(
        bot.action(),
        fileId,
        authorizer,
    );

    await expect(getFileFromAttachment(session.action(), fileId, authorizer)).rejects.toThrow(
        "File isn\u2019t attached to target",
    );
});

test("allows a bot to attach another account\u2019s file when it has attachment access", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession({role: "Admin"});
    const bot = await TestBot.createAndInstantiate(session);
    const file = await TestFile.create(session);
    const sourceDocument = await TestDocument.create(session, {access: "Public"});
    await sourceDocument.attachFile(session, file);
    const targetDocument = await TestDocument.create(session);
    const authorizer = FileDocumentAuthorizer.bind({
        type: "DocumentComments",
        documentId: targetDocument.id,
    });

    const entry =
        await dangerouslyGetFileAttachmentTargetTransactionEntryWithoutTargetAuthorizationAsBot(
            bot.action(),
            file.id,
            authorizer,
        );
    await DynamoTableSchema.executeTransaction(bot.action(), [entry]);

    await expect(
        getFileFromAttachment(session.action(), file.id, authorizer),
    ).resolves.toMatchObject({id: file.id});
});

test("rejects another account\u2019s file when the bot has no attachment access", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession({role: "Admin"});
    const bot = await TestBot.createAndInstantiate(session);
    const file = await TestFile.create(session);
    const sourceDocument = await TestDocument.create(session, {access: "Private"});
    await sourceDocument.attachFile(session, file);
    const targetDocument = await TestDocument.create(session);

    await expect(
        dangerouslyGetFileAttachmentTargetTransactionEntryWithoutTargetAuthorizationAsBot(
            bot.action(),
            file.id,
            FileDocumentAuthorizer.bind({
                type: "DocumentComments",
                documentId: targetDocument.id,
            }),
        ),
    ).rejects.toThrow("No access to file through any attachment target");
});

test("rejects non-bot actors", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession({role: "Admin"});
    const document = await TestDocument.create(session);
    const file = await TestFile.create(session);

    await expect(
        dangerouslyGetFileAttachmentTargetTransactionEntryWithoutTargetAuthorizationAsBot(
            session.action(),
            file.id,
            FileDocumentAuthorizer.bind({
                type: "DocumentComments",
                documentId: document.id,
            }),
        ),
    ).rejects.toThrow("Only bot actors can attach files to targets");
});

test("rejects a nonexistent file", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession({role: "Admin"});
    const bot = await TestBot.createAndInstantiate(session);
    const document = await TestDocument.create(session);

    await expect(
        dangerouslyGetFileAttachmentTargetTransactionEntryWithoutTargetAuthorizationAsBot(
            bot.action(),
            generateChronologicalId<FileId>(),
            FileDocumentAuthorizer.bind({
                type: "DocumentComments",
                documentId: document.id,
            }),
        ),
    ).rejects.toThrow("File not found");
});
