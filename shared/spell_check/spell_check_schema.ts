import {AccountId} from "~/shared/id/types/id_types.open_source.js";
import {Schema} from "~/shared/schema/schema.open_source.js";

export const SpellCheckIgnoredLintSchema = Schema.object({
    /** When was this lint ignore created? */
    createdTime: Schema.date,

    /** Account who created the lint ignore. */
    creatorId: Schema.id<AccountId>(),
});
