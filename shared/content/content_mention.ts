import {ContentMentionAccountId} from "~/shared/id/types/id_types";
import {Schema, SchemaType} from "~/shared/schema/schema";

export type ContentMention = SchemaType<typeof ContentMentionSchema>;

/**
 * A mention references some entity, like an account, inline in content.
 */
export const ContentMentionSchema = Schema.object({
    // See the documentation comment on `ContentMentionAccountId`. We use it
    // instead of `AccountId` to force you to use `getAccountIfExists()` and
    // similar methods instead of assuming the account exists. If you
    // copy/paste mentions across spaces an account which did exist may not
    // exist anymore.
    accountId: Schema.id<ContentMentionAccountId>(),
    isShort: Schema.boolean.default(false),
});

/**
 * The name to use in a mention when we can't find an associated account in
 * our `ContentReferences`.
 */
export const missingAccountContentMentionName = "Unknown";
