import {Schema as ProsemirrorSchema} from "prosemirror-model";

/**
 * Is this schema the `MessageContent` schema? If it is then we'll apply slightly
 * different styles. Use this sparingly! Content should behave consistently across
 * all surfaces. Use this as a last resort to change the behavior of message
 * content and message content only.
 *
 * This function is written in a way that importing it does not create a dependency
 * on `shared/messaging`.
 */
export function isMessageContentSchema(schema: ProsemirrorSchema): boolean {
    return !!(schema as any)._isMessageContent;
}
