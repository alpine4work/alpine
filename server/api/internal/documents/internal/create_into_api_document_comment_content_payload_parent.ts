import {intoApiMessageContentPayloadParent} from "~/server/api/internal/shared/into_api_message_content_payload_parent.js";
import {ServerBotActionContext} from "~/server/context/server_action_context.js";
import {getDocumentCommentParentContent} from "~/server/documents/data/documents_actions.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {DocumentCommentThreadId, DocumentId, SpaceId} from "~/shared/id/types/id_types.js";
import {MessageContentPayloadParent} from "~/shared/messaging/message_schema.js";

export function createIntoApiDocumentCommentContentPayloadParent(
    context: ServerBotActionContext,
    spaceId: SpaceId,
    documentId: DocumentId,
    commentThreadId: DocumentCommentThreadId,
) {
    return async function (parent: MessageContentPayloadParent) {
        assert(parent.type !== "PostRange");

        const parentContent = await getDocumentCommentParentContent(
            context,
            documentId,
            commentThreadId,
            {
                parent,
                consistency: "StrongWithinCache",
            },
        );
        return await intoApiMessageContentPayloadParent(context, spaceId, {
            ...parent,
            content: parentContent.content,
            authorId: parentContent.authorId,
        });
    };
}
