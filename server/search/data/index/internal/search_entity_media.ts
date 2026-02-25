import {themeColors} from "~/shared/design/core/theme_colors.js";
import {isReadonlyArray} from "~/shared/helpers/array/is_readonly_array.js";
import {zeroHybridLogicalTime} from "~/shared/helpers/clock/hybrid_logical_clock.js";
import {hasOwnProperty} from "~/shared/helpers/object/has_own_property.js";
import {isObject} from "~/shared/helpers/object/is_object.js";
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

    previewAccountIds: Schema.array(Schema.id<AccountId>())
        .minLength(2)
        .originalPropertyKey("accountIds"),

    // If `null` then we have an unknown number of total accounts.
    //
    // We used to have all `AccountId`s in this object so defaults to the length of
    // `accountIds` (the original property key of `previewAccountIds`).
    accountCount: Schema.integer.nullable().default(value => {
        if (
            isObject(value) &&
            hasOwnProperty(value, "accountIds") &&
            isReadonlyArray(value.accountIds)
        ) {
            return value.accountIds.length;
        } else {
            return null;
        }
    }),
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
