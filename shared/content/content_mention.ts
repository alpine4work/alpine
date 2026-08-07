import {AccountId} from "~/shared/id/types/id_types.open_source.js";
import {Schema, SchemaType} from "~/shared/schema/schema.open_source.js";
import {SearchMentionEntityIdSchema} from "~/shared/search/search_entity_id.js";

export type ContentMention = SchemaType<typeof ContentMentionSchema>;

/**
 * A mention references some entity, like an account, inline in content.
 */
export const ContentMentionSchema = Schema.union({
    Account: Schema.object({
        type: Schema.value("Account"),
        accountId: Schema.id<AccountId>(),
        isShort: Schema.boolean.default(false),
    }),
    SearchEntity: Schema.object({
        type: Schema.value("SearchEntity"),
        entityId: SearchMentionEntityIdSchema,
    }),
}).defaultVariant("Account");
