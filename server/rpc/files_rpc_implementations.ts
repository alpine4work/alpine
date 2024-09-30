import {FileChatAuthorizer} from "~/server/chat/data/chat_table.js";
import {FileDocumentAuthorizer} from "~/server/documents/data/documents_table.js";
import {FileAuthorizer, getFileFromAttachment} from "~/server/files/data/files_table.js";
import {FileChannelAuthorizer, FilePostAuthorizer} from "~/server/forum/data/forum_table.js";
import {implementRpcs} from "~/server/rpc/internal/implement_rpcs.js";
import {FileTaskAuthorizer} from "~/server/tasks/data/task_table.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import * as definitions from "~/shared/rpc/files_rpc_definitions.js";

export default implementRpcs(definitions, {
    getFilePreviewUrl: {
        visibility: ["AppClient"],
        execute: async (context, input) => {
            const target = input.fromAttachmentTarget;
            let fileAuthorizer: FileAuthorizer;

            switch (target.type) {
                case "Document":
                case "DocumentComment":
                    fileAuthorizer = FileDocumentAuthorizer.bind(target);
                    break;
                case "Post":
                case "PostComment":
                    fileAuthorizer = FilePostAuthorizer.bind(target);
                    break;
                case "ChatMessage":
                    fileAuthorizer = FileChatAuthorizer.bind(target);
                    break;
                case "ChannelDescription":
                    fileAuthorizer = FileChannelAuthorizer.bind(target);
                    break;
                case "TaskNotes":
                case "TaskComment":
                    fileAuthorizer = FileTaskAuthorizer.bind(target);
                    break;
                default:
                    throw exhaustive(target);
            }

            const file = await getFileFromAttachment(
                context,
                input.spaceId,
                input.fileId,
                fileAuthorizer,
            );

            let previewUrl: URL | null = null;

            // If there was an error while processing then don't generate a preview URL
            // since the client will render an error message, not a preview.
            //
            // It's ok to generate a signed URL here since `getFileFromAttachment()`
            // authorizes that the actor has access to the file.
            if (file.preview && (!("ok" in file.preview) || file.preview.ok === true)) {
                previewUrl = await context.files.dangerouslySignFilePreviewUrlWithoutAuthorization(
                    input.spaceId,
                    input.fileId,
                    file,
                );
            }

            return {previewUrlSearch: previewUrl?.search ?? null};
        },
    },
});
