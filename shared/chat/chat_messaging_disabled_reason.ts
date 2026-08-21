import {Schema, SchemaType} from "~/shared/schema/schema.js";

/**
 * Describes why messaging is disabled in a chat, along with what to show the
 * actor.
 *
 * A `null` reason means messaging is enabled. When present, the chat view disables
 * the message input and displays `message` (plus an optional `link` action, e.g. a
 * link to fix the underlying problem). This keeps the chat view generic — it
 * renders whatever reason it's given without knowing why messaging is disabled.
 */
export const ChatMessagingDisabledReasonSchema = Schema.object({
    message: Schema.string,
    link: Schema.object({
        label: Schema.string,
        url: Schema.string,
    }).nullable(),
});

export type ChatMessagingDisabledReason = SchemaType<typeof ChatMessagingDisabledReasonSchema>;
