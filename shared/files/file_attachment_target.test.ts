import {
    FileAttachmentTarget,
    deserializeFileAttachmentTargetString,
    serializeFileAttachmentTargetString,
} from "~/shared/files/file_attachment_target.js";
import {decodeBase64} from "~/shared/helpers/binary/base64.js";
import {generateChronologicalId} from "~/shared/id/chronological_id.js";
import {generateId} from "~/shared/id/id.js";

const fileAttachmentTargetByType: {
    [Key in FileAttachmentTarget["type"]]: FileAttachmentTarget & {type: Key};
} = {
    ChatMessages: {
        type: "ChatMessages",
        chatId: generateId(),
    },
    Document: {
        type: "Document",
        documentId: generateId(),
    },
    DocumentComments: {
        type: "DocumentComments",
        documentId: generateId(),
    },
    Post: {
        type: "Post",
        postId: generateId(),
    },
    PostDraft: {
        type: "PostDraft",
        accountId: generateId(),
        draftId: generateChronologicalId(),
    },
    PostComments: {
        type: "PostComments",
        postId: generateId(),
    },
    TaskNotes: {
        type: "TaskNotes",
        taskId: generateId(),
    },
    TaskComments: {
        type: "TaskComments",
        taskId: generateId(),
    },
};

for (const [type, target] of Object.entries(fileAttachmentTargetByType)) {
    test(`can serialize attachment target type \`${type}\` to base64 string and back`, () => {
        expect(target.type).toEqual(type);

        const targetString = serializeFileAttachmentTargetString(target);

        // Make sure the string is base64.
        decodeBase64(targetString, "Rfc4648Url");

        expect(deserializeFileAttachmentTargetString(targetString)).toEqual(target);
    });
}
