import {AccountId} from "~/shared/id/types/id_types";
import {Schema, SchemaType} from "~/shared/schema/schema";

export type ContentMention = SchemaType<typeof ContentMentionSchema>;

export const ContentMentionSchema = Schema.object({
    accountId: Schema.id<AccountId>(),
});
