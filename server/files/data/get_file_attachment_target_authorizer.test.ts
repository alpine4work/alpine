import {InjectedFileAuthorizer} from "~/server/context/injection_context_module.js";
import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {getFileAttachmentTargetAuthorizer} from "~/server/files/data/get_file_attachment_target_authorizer.js";
import {FileAttachmentTarget} from "~/shared/files/file_attachment_target.js";
import {generateChronologicalId} from "~/shared/id/chronological_id.open_source.js";
import {generateId} from "~/shared/id/id.open_source.js";
import {
    AccountId,
    ChatId,
    DocumentId,
    PostDraftId,
    PostId,
    SpaceId,
    TaskId,
} from "~/shared/id/types/id_types.open_source.js";

const context = createTestContext({
    chatInjection: {
        bindFileChatAuthorizer: (_context, target) => createInjectedFileAuthorizer(target),
    },
    documentsInjection: {
        bindFileDocumentAuthorizer: (_context, target) => createInjectedFileAuthorizer(target),
    },
    forumInjection: {
        bindFilePostAuthorizer: (_context, target) => createInjectedFileAuthorizer(target),
    },
    tasksInjection: {
        bindFileTaskAuthorizer: (_context, target) => createInjectedFileAuthorizer(target),
    },
});

function createInjectedFileAuthorizer(target: FileAttachmentTarget): InjectedFileAuthorizer {
    return {
        target,
        async authorizeTargetAccess() {},
        async authorizeTargetAccessIfPossible() {
            return {ok: true, value: undefined};
        },
    };
}

function createSystemAction() {
    return context.systemAction(generateId<SpaceId>());
}

test("ChatMessages returns an authorizer with the correct target", () => {
    const target: FileAttachmentTarget = {
        type: "ChatMessages",
        chatId: generateId<ChatId>(),
    };
    expect(getFileAttachmentTargetAuthorizer(createSystemAction(), target).target).toBe(target);
});

test("Document returns an authorizer with the correct target", () => {
    const target: FileAttachmentTarget = {
        type: "Document",
        documentId: generateId<DocumentId>(),
    };
    expect(getFileAttachmentTargetAuthorizer(createSystemAction(), target).target).toBe(target);
});

test("DocumentComments returns an authorizer with the correct target", () => {
    const target: FileAttachmentTarget = {
        type: "DocumentComments",
        documentId: generateId<DocumentId>(),
    };
    expect(getFileAttachmentTargetAuthorizer(createSystemAction(), target).target).toBe(target);
});

test("Post returns an authorizer with the correct target", () => {
    const target: FileAttachmentTarget = {
        type: "Post",
        postId: generateId<PostId>(),
    };
    expect(getFileAttachmentTargetAuthorizer(createSystemAction(), target).target).toBe(target);
});

test("PostDraft returns an authorizer with the correct target", () => {
    const target: FileAttachmentTarget = {
        type: "PostDraft",
        spaceId: generateId<SpaceId>(),
        accountId: generateId<AccountId>(),
        draftId: generateChronologicalId<PostDraftId>(),
    };
    expect(getFileAttachmentTargetAuthorizer(createSystemAction(), target).target).toBe(target);
});

test("PostComments returns an authorizer with the correct target", () => {
    const target: FileAttachmentTarget = {
        type: "PostComments",
        postId: generateId<PostId>(),
    };
    expect(getFileAttachmentTargetAuthorizer(createSystemAction(), target).target).toBe(target);
});

test("TaskNotes returns an authorizer with the correct target", () => {
    const target: FileAttachmentTarget = {
        type: "TaskNotes",
        taskId: generateId<TaskId>(),
    };
    expect(getFileAttachmentTargetAuthorizer(createSystemAction(), target).target).toBe(target);
});

test("TaskComments returns an authorizer with the correct target", () => {
    const target: FileAttachmentTarget = {
        type: "TaskComments",
        taskId: generateId<TaskId>(),
    };
    expect(getFileAttachmentTargetAuthorizer(createSystemAction(), target).target).toBe(target);
});
