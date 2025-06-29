import {themeColors} from "~/shared/design/core/theme_colors.js";
import {zeroHybridLogicalTime} from "~/shared/helpers/clock/hybrid_logical_clock.js";
import {AccountId} from "~/shared/id/types/id_types.js";
import {HybridLogicalTimeSchema} from "~/shared/schema/helpers/hybrid_logical_time_schema.js";
import {Schema, SchemaType} from "~/shared/schema/schema.js";

export type SearchEntityMedia = SchemaType<typeof SearchEntityMediaSchema>;

export const SearchEntityAccountMediaSchema = Schema.object({
    type: Schema.value("Account"),
    accountId: Schema.id<AccountId>(),
});

export const SearchEntityAccountPileMediaSchema = Schema.object({
    type: Schema.value("AccountPile"),
    accountIds: Schema.array(Schema.id<AccountId>()).minLength(2),
});

export const SearchEntityTaskCollectionColorMediaSchema = Schema.object({
    type: Schema.value("TaskCollectionColor"),
    color: Schema.enum(themeColors).nullable(),
    version: HybridLogicalTimeSchema.default(zeroHybridLogicalTime),
});

export const SearchEntityTaskDisplayStatusMediaSchema = Schema.object({
    type: Schema.value("TaskDisplayStatus"),
    displayStatus: Schema.enum(["OpenInactive", "OpenActive", "Closed"]),
    version: HybridLogicalTimeSchema.default(zeroHybridLogicalTime),
});

export const SearchEntityMediaSchema = Schema.union({
    Account: SearchEntityAccountMediaSchema,
    AccountPile: SearchEntityAccountPileMediaSchema,
    TaskCollectionColor: SearchEntityTaskCollectionColorMediaSchema,
    TaskDisplayStatus: SearchEntityTaskDisplayStatusMediaSchema,
});
