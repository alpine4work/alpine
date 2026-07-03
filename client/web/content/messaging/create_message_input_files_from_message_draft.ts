import {Memo} from "react";
import {MessageInputFile} from "~/client/web/content/messaging/add_message_input_files.js";
import {FileAttachmentTarget} from "~/shared/files/file_attachment_target.js";
import {emptyArray} from "~/shared/helpers/array/empty_array.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {generateId} from "~/shared/id/id.js";
import {
    MessageDraft,
    MessageDraftFile,
    MessageDraftWithFiles,
    isMessageDraftWithHydratedFiles,
} from "~/shared/messaging/message_draft_schema.js";

/**
 * Converts a server draft's hydrated files into the `<MessageInput>`'s file state,
 * returning an empty array when the draft is absent or its files aren't hydrated.
 */
export function createMessageInputFilesFromMessageDraft(
    draft: MessageDraft | MessageDraftWithFiles | undefined,
): ReadonlyArray<MessageInputFile> {
    if (!draft || !isMessageDraftWithHydratedFiles(draft)) return emptyArray;

    return draft.files.map((file: MessageDraftFile) => {
        switch (file.type) {
            case "File":
                return {
                    type: "File",
                    key: generateId(),
                    // The target comes straight from immutable draft data, so its memoization is
                    // expected to be done by the caller.
                    attachmentTarget: file.attachmentTarget
                        ? (file.attachmentTarget satisfies FileAttachmentTarget as Memo<FileAttachmentTarget>)
                        : "Uploader",
                    shouldAttachBeforeCreate: file.shouldAttachBeforeCreate,
                    signedUrlSearch: file.signedUrlSearch,
                    file: file.file,
                };
            case "FileEntity":
                return {
                    type: "FileEntity",
                    key: generateId(),
                    fileEntityId: file.fileId,
                    fileEntityResult: file.fileEntityResult,
                };
            default:
                throw exhaustive(file);
        }
    });
}
