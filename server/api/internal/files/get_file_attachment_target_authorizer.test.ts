import {getFileAttachmentTargetAuthorizer} from "~/server/api/internal/files/get_file_attachment_target_authorizer.js";
import {FileAttachmentTarget} from "~/shared/files/file_attachment_target.js";
import {generateChronologicalId} from "~/shared/id/chronological_id.js";
import {generateId} from "~/shared/id/id.js";
import {
    AccountId,
    ChatId,
    DocumentId,
    PostDraftId,
    PostId,
    TaskId,
} from "~/shared/id/types/id_types.js";

test("ChatMessages returns an authorizer with the correct target", () => {
    const target: FileAttachmentTarget = {
        type: "ChatMessages",
        chatId: generateId<ChatId>(),
    };
    expect(getFileAttachmentTargetAuthorizer(target).target).toBe(target);
});

test("Document returns an authorizer with the correct target", () => {
    const target: FileAttachmentTarget = {
        type: "Document",
        documentId: generateId<DocumentId>(),
    };
    expect(getFileAttachmentTargetAuthorizer(target).target).toBe(target);
});

test("DocumentComments returns an authorizer with the correct target", () => {
    const target: FileAttachmentTarget = {
        type: "DocumentComments",
        documentId: generateId<DocumentId>(),
    };
    expect(getFileAttachmentTargetAuthorizer(target).target).toBe(target);
});

test("Post returns an authorizer with the correct target", () => {
    const target: FileAttachmentTarget = {
        type: "Post",
        postId: generateId<PostId>(),
    };
    expect(getFileAttachmentTargetAuthorizer(target).target).toBe(target);
});

test("PostDraft returns an authorizer with the correct target", () => {
    const target: FileAttachmentTarget = {
        type: "PostDraft",
        spaceId: generateId(),
        accountId: generateId<AccountId>(),
        draftId: generateChronologicalId<PostDraftId>(),
    };
    expect(getFileAttachmentTargetAuthorizer(target).target).toBe(target);
});

test("PostComments returns an authorizer with the correct target", () => {
    const target: FileAttachmentTarget = {
        type: "PostComments",
        postId: generateId<PostId>(),
    };
    expect(getFileAttachmentTargetAuthorizer(target).target).toBe(target);
});

test("TaskNotes returns an authorizer with the correct target", () => {
    const target: FileAttachmentTarget = {
        type: "TaskNotes",
        taskId: generateId<TaskId>(),
    };
    expect(getFileAttachmentTargetAuthorizer(target).target).toBe(target);
});

test("TaskComments returns an authorizer with the correct target", () => {
    const target: FileAttachmentTarget = {
        type: "TaskComments",
        taskId: generateId<TaskId>(),
    };
    expect(getFileAttachmentTargetAuthorizer(target).target).toBe(target);
});
