import {AccountId} from "~/shared/id/types/id_types";
import {Schema, SchemaType} from "~/shared/schema/schema";

export type ContentMention = SchemaType<typeof ContentMentionSchema>;

/**
 * A mention references some entity, like an account, inline in content.
 */
export const ContentMentionSchema = Schema.object({
    accountId: Schema.id<AccountId>(),
    isShort: Schema.boolean.default(false),
});

/**
 * The name to use in a mention when we can't find an associated account in
 * our `ContentReferences`.
 */
export const missingAccountContentMentionName = "Unknown";
