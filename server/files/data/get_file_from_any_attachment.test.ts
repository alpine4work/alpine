import {FileChatAuthorizer} from "~/server/chat/data/file_chat_authorizer.js";
import {getOrCreateChatForAccounts} from "~/server/chat/data/get_or_create_chat_for_accounts.js";
import {FileDocumentAuthorizer} from "~/server/documents/data/documents_actions.js";
import {TestDocument} from "~/server/documents/test_helpers/test_document.js";
import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {getFileFromAnyAttachment} from "~/server/files/data/get_file_from_any_attachment.js";
import {TestFile} from "~/server/files/test_helpers/test_file.js";
import {FilePostAuthorizer} from "~/server/forum/data/file_post_authorizer.js";
import {TestChannel} from "~/server/forum/test_helpers/test_channel.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {FileTaskAuthorizer} from "~/server/tasks/data/task_table.js";
import {TestTask} from "~/server/tasks/test_helpers/test_task.js";
import {InternalError, PermissionDeniedError} from "~/shared/error/error.js";
import {FileAttachmentTarget} from "~/shared/files/file_attachment_target.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {generateChronologicalId} from "~/shared/id/chronological_id.js";
import {FileId} from "~/shared/id/types/id_types.js";

const context = createTestContext();

function getAuthorizer(target: FileAttachmentTarget) {
    switch (target.type) {
        case "ChatMessages":
            return FileChatAuthorizer.bind(target);
        case "Document":
        case "DocumentComments":
            return FileDocumentAuthorizer.bind(target);
        case "Post":
        case "PostDraft":
        case "PostComments":
            return FilePostAuthorizer.bind(target);
        case "TaskNotes":
        case "TaskComments":
            return FileTaskAuthorizer.bind(target);
        default:
            throw exhaustive(target);
    }
}

test("throws NotFoundError for nonexistent file", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const fakeFileId = generateChronologicalId<FileId>();

    await expect(
        getFileFromAnyAttachment(session.action(), fakeFileId, getAuthorizer),
    ).rejects.toThrow("File not found");
});

test("throws PermissionDeniedError when file has no attachment targets", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();
    const file = await TestFile.create(session);

    await expect(
        getFileFromAnyAttachment(session.action(), file.id, getAuthorizer),
    ).rejects.toThrow("File is not attached to any entity");
});

describe("Document attachment", () => {
    test("returns file when actor has access to document", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();
        const document = await TestDocument.create(session, {title: "Doc", access: "Public"});

        const file = await TestFile.create(session);
        await document.attachFile(session, file);

        const result = await getFileFromAnyAttachment(session.action(), file.id, getAuthorizer);

        expect(result.id).toBe(file.id);
        expect(result.spaceId).toBe(space.id);
    });

    test("throws when actor lacks access to document", async () => {
        const space = await TestSpace.create(context);
        const [owner, viewer] = await space.createSessions(2);

        const document = await TestDocument.create(owner, {
            title: "Private Doc",
            access: "Private",
        });

        const file = await TestFile.create(owner);
        await document.attachFile(owner, file);

        await expect(
            getFileFromAnyAttachment(viewer.action(), file.id, getAuthorizer),
        ).rejects.toThrow(PermissionDeniedError);
    });
});

describe("Post attachment", () => {
    test("returns file when actor has access to post", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();
        const channel = await TestChannel.create(session);

        const file = await TestFile.create(session);
        await channel.createPost(session, "Post with file", {files: [file]});

        const result = await getFileFromAnyAttachment(session.action(), file.id, getAuthorizer);

        expect(result.id).toBe(file.id);
    });
});

describe("Task attachment", () => {
    test("returns file when actor has access to task", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();
        const task = await TestTask.create(session, {title: "Task with file"});

        const file = await TestFile.create(session);
        await task.attachFile(session, file);

        const result = await getFileFromAnyAttachment(session.action(), file.id, getAuthorizer);

        expect(result.id).toBe(file.id);
    });

    test("throws when actor is in a different space", async () => {
        const space1 = await TestSpace.create(context);
        const space1Session = await space1.createSession();

        const space2 = await TestSpace.create(context);
        const space2Session = await space2.createSession();

        const task = await TestTask.create(space1Session, {title: "Task with file"});
        const file = await TestFile.create(space1Session);
        await task.attachFile(space1Session, file);

        await expect(
            getFileFromAnyAttachment(space2Session.action(), file.id, getAuthorizer),
        ).rejects.toThrow(PermissionDeniedError);
    });
});

describe("Chat attachment", () => {
    test("returns file when actor has access to chat", async () => {
        const space = await TestSpace.create(context);
        const [session1, session2] = await space.createSessions(2);

        const chatId = await getOrCreateChatForAccounts(session1.action(), {
            spaceId: space.id,
            otherAccountIds: [session2.account.id],
        });

        const file = await TestFile.create(session1);
        await file.attach(session1, FileChatAuthorizer.bind({type: "ChatMessages", chatId}));

        const result = await getFileFromAnyAttachment(session1.action(), file.id, getAuthorizer);

        expect(result.id).toBe(file.id);
    });

    test("throws when actor is not a member of the chat", async () => {
        const space = await TestSpace.create(context);
        const [session1, session2, session3] = await space.createSessions(3);

        const chatId = await getOrCreateChatForAccounts(session1.action(), {
            spaceId: space.id,
            otherAccountIds: [session2.account.id],
        });

        const file = await TestFile.create(session1);
        await file.attach(session1, FileChatAuthorizer.bind({type: "ChatMessages", chatId}));

        await expect(
            getFileFromAnyAttachment(session3.action(), file.id, getAuthorizer),
        ).rejects.toThrow(PermissionDeniedError);
    });
});

describe("multiple attachment targets", () => {
    test("succeeds if any target grants access", async () => {
        const space = await TestSpace.create(context);
        const [owner, viewer] = await space.createSessions(2);

        // Attach file to a private document (viewer can't access) and a public document
        // (viewer can access).
        const privateDoc = await TestDocument.create(owner, {
            title: "Private",
            access: "Private",
        });
        const publicDoc = await TestDocument.create(owner, {
            title: "Public",
            access: "Public",
        });

        const file = await TestFile.create(owner);
        await privateDoc.attachFile(owner, file);
        await file
            .from(owner, FileDocumentAuthorizer.bind({type: "Document", documentId: privateDoc.id}))
            .then(f =>
                f.attach(
                    owner,
                    FileDocumentAuthorizer.bind({type: "Document", documentId: publicDoc.id}),
                ),
            );

        const result = await getFileFromAnyAttachment(viewer.action(), file.id, getAuthorizer);

        expect(result.id).toBe(file.id);
    });

    test("fails if no target grants access", async () => {
        const space = await TestSpace.create(context);
        const [owner, viewer] = await space.createSessions(2);

        const privateDoc1 = await TestDocument.create(owner, {
            title: "Private 1",
            access: "Private",
        });
        const privateDoc2 = await TestDocument.create(owner, {
            title: "Private 2",
            access: "Private",
        });

        const file = await TestFile.create(owner);
        await privateDoc1.attachFile(owner, file);
        await file
            .from(
                owner,
                FileDocumentAuthorizer.bind({type: "Document", documentId: privateDoc1.id}),
            )
            .then(f =>
                f.attach(
                    owner,
                    FileDocumentAuthorizer.bind({type: "Document", documentId: privateDoc2.id}),
                ),
            );

        await expect(
            getFileFromAnyAttachment(viewer.action(), file.id, getAuthorizer),
        ).rejects.toThrow("No access to file through any attachment target");
    });

    test("does not swallow unexpected errors from authorizer", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();

        const document = await TestDocument.create(session, {
            title: "Doc",
            access: "Public",
        });

        const file = await TestFile.create(session);
        await document.attachFile(session, file);

        // An authorizer that throws InternalError should propagate, not be swallowed.
        const brokenGetAuthorizer = () => ({
            target: {type: "Document" as const, documentId: document.id},
            authorizeTargetAccessIfPossible: () => {
                throw new InternalError("database connection failed");
            },
        });

        await expect(
            getFileFromAnyAttachment(
                session.action(),
                file.id,
                brokenGetAuthorizer as unknown as typeof getAuthorizer,
            ),
        ).rejects.toThrow("database connection failed");
    });
});
