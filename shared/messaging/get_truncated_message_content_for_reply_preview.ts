import {emptyContentReferences} from "~/shared/content/content_references.js";
import {getContentSnippet} from "~/shared/content/get_content_snippet.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {
    MessageContentProsemirrorSchema,
    MessageContentWithReferences,
    assertMessageContent,
} from "~/shared/messaging/message_content_schema.js";
import {MessageModel} from "~/shared/messaging/message_model.js";

/**
 * Get the content to render in a reply preview of a message. A content payload
 * will be truncated to enough content to fill a single line. A deleted payload
 * will show a placeholder informing the user the message is deleted.
 */
export function getTruncatedMessageContentForReplyPreview({
    message,
    messageStartOfSentenceNoun,
}: {
    message: MessageModel;
    messageStartOfSentenceNoun: string;
}): MessageContentWithReferences {
    switch (message.payload.type) {
        case "Content": {
            return {
                doc: assertMessageContent(
                    getContentSnippet(message.payload.content.doc.resolve(0), 1),
                ),
                references: message.payload.content.references,
            };
        }
        case "Deleted": {
            // NOTE(calebmer): We render deleted messages with the same style as a normal
            // message in a reply because if we render with the deleted style (no
            // background, 1px border) it's just too light when scaled down and made
            // translucent. The user can click on the reply to jump to the actual message
            // with the correct treatment.
            return {
                doc: assertMessageContent(
                    MessageContentProsemirrorSchema.node("doc", {}, [
                        MessageContentProsemirrorSchema.node("paragraph", {}, [
                            MessageContentProsemirrorSchema.text(
                                `${messageStartOfSentenceNoun} deleted`,
                                [MessageContentProsemirrorSchema.mark("italic")],
                            ),
                        ]),
                    ]),
                ),
                references: emptyContentReferences,
            };
        }
        default:
            throw exhaustive(message.payload);
    }
}
