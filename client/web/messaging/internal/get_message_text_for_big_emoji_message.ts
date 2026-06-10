import {shouldDisplayTextAsBigEmojiMessage} from "~/client/web/messaging/internal/should_display_text_as_big_emoji_message.js";
import {MessageModelBase} from "~/shared/messaging/message_model.js";

/**
 * Returns the message text when the payload can be rendered as a big emoji
 * message. Otherwise returns `null`.
 */
export function getMessageTextForBigEmojiMessage(message: MessageModelBase): string | null {
    if (message.payload.type !== "Content") return null;

    if (
        message.payload.content.doc.marks.length === 0 &&
        message.payload.content.doc.childCount === 1 &&
        message.payload.content.doc.firstChild!.type.name === "paragraph" &&
        message.payload.content.doc.firstChild!.marks.length === 0 &&
        message.payload.content.doc.firstChild!.childCount === 1 &&
        message.payload.content.doc.firstChild!.firstChild!.type.name === "text" &&
        message.payload.content.doc.firstChild!.firstChild!.marks.length === 0
    ) {
        const text = message.payload.content.doc.firstChild!.firstChild!.text!;
        if (shouldDisplayTextAsBigEmojiMessage(text)) {
            return text;
        }
    }

    return null;
}
