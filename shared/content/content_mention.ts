import {ContentMentionAccountId} from "~/shared/id/types/id_types.js";
import {Schema, SchemaType} from "~/shared/schema/schema.js";
import {SearchMentionEntityIdSchema} from "~/shared/search/search_entity_id.js";

export type ContentMention = SchemaType<typeof ContentMentionSchema>;

/**
 * A mention references some entity, like an account, inline in content.
 */
export const ContentMentionSchema = Schema.union({
    Account: Schema.object({
        type: Schema.value("Account"),
        // See the documentation comment on `ContentMentionAccountId`. We use it
        // instead of `AccountId` to force you to use `getAccountIfExists()` and
        // similar methods instead of assuming the account exists. If you
        // copy/paste mentions across spaces an account which did exist may not
        // exist anymore.
        accountId: Schema.id<ContentMentionAccountId>(),
        isShort: Schema.boolean.default(false),
    }),
    SearchEntity: Schema.object({
        type: Schema.value("SearchEntity"),
        entityId: SearchMentionEntityIdSchema,
    }),
}).defaultVariant("Account");
