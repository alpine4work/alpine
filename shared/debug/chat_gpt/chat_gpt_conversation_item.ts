import OpenAi from "openai";
import {ErrorSchema} from "~/shared/error/error_schema.js";
import {Schema, SchemaType} from "~/shared/schema/schema.js";

export type ChatGptConversationItem = SchemaType<typeof ChatGptConversationItemSchema>;

export const ChatGptConversationItemSchema = Schema.unknown<
    (
        | OpenAi.Responses.ResponseInputItem.Message
        | OpenAi.Responses.ResponseInputItem.FunctionCallOutput
        | OpenAi.Responses.ResponseOutputItem
    ) & {
        tokenCount?: number;
        contentHtml?: string;
    }
>();

export const ChatGptConversationStateResponseSchema = Schema.result(
    Schema.object({
        ok: Schema.value(true),
        items: Schema.array(ChatGptConversationItemSchema),
    }),
    Schema.object({
        ok: Schema.value(false),
        error: ErrorSchema,
    }),
);
