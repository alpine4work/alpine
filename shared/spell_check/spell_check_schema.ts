import {AccountId} from "~/shared/id/types/id_types.js";
import {Schema} from "~/shared/schema/schema.js";

export const SpellCheckIgnoredLintSchema = Schema.object({
    /** When was this lint ignore created? */
    createdTime: Schema.date,

    /** Account who created the lint ignore. */
    creatorId: Schema.id<AccountId>(),
});
