import {themeColors} from "~/shared/design/core/theme_colors.js";
import {isReadonlyArray} from "~/shared/helpers/array/is_readonly_array.open_source.js";
import {zeroHybridLogicalTime} from "~/shared/helpers/clock/hybrid_logical_clock.js";
import {hasOwnProperty} from "~/shared/helpers/object/has_own_property.open_source.js";
import {isObject} from "~/shared/helpers/object/is_object.open_source.js";
import {AccountId} from "~/shared/id/types/id_types.open_source.js";
import {HybridLogicalTimeSchema} from "~/shared/schema/helpers/hybrid_logical_time_schema.js";
import {Schema, SchemaType} from "~/shared/schema/schema.open_source.js";
import {SiteItemSearchEntityIdSchema} from "~/shared/search/site_item_search_entity_id.js";

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

// NOTE(ifitzsimmons, 2026-05-04): This breaks the convention of having a media
// object for a very specific piece of data (e.g. task status or task collection
// color). However, the existing convention breaks down if the search entity needs
// multiple pieces of information. For example, a site needs the first entity id
// and it may also need to root container id or root container type in order to
// render something like a site preview.
export const SearchEntitySiteMediaSchema = Schema.object({
    type: Schema.value("Site"),
    firstEntityId: SiteItemSearchEntityIdSchema.nullable(),
});

export const SearchEntityMediaSchema = Schema.union({
    Account: SearchEntityAccountMediaSchema,
    AccountPile: SearchEntityAccountPileMediaSchema,
    TaskCollectionColor: SearchEntityTaskCollectionColorMediaSchema,
    TaskDisplayStatus: SearchEntityTaskDisplayStatusMediaSchema,
    Site: SearchEntitySiteMediaSchema,
});
