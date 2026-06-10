import {themeColors} from "~/shared/design/core/theme_colors.js";
import {HybridLogicalTimeSchema} from "~/shared/schema/helpers/hybrid_logical_time_schema.js";
import {Schema} from "~/shared/schema/schema.js";
import {SiteItemSearchEntityIdSchema} from "~/shared/search/site_item_search_entity_id.js";
import {AccountModel} from "~/shared/spaces/account_model.js";

const SearchEntityAccountMediaModelSchema = Schema.object({
    type: Schema.value("Account"),
    account: AccountModel.schema,
});

export const SearchEntityAccountPileMediaModelSchema = Schema.object({
    type: Schema.value("AccountPile"),
    previewAccounts: Schema.array(AccountModel.schema).minLength(1),
    // If `null` then we have an unknown number of total accounts.
    accountCount: Schema.integer.nullable(),
});

const SearchEntityTaskCollectionColorMediaModelSchema = Schema.object({
    type: Schema.value("TaskCollectionColor"),
    color: Schema.enum(themeColors).nullable(),
    version: HybridLogicalTimeSchema,
});

const SearchEntityTaskDisplayStatusMediaModelSchema = Schema.object({
    type: Schema.value("TaskDisplayStatus"),
    displayStatus: Schema.enum(["OpenInactive", "OpenActive", "Closed"]),
    version: HybridLogicalTimeSchema,
});

// NOTE(ifitzsimmons, 2026-05-04): This breaks the convention of having a media
// object for a very specific piece of data (e.g. task status or task collection
// color). However, the existing convention breaks down if the search entity needs
// multiple pieces of information. For example, a site needs the first entity id
// and it may also need to root container id or root container type in order to
// render something like a site preview.
const SearchEntitySiteMediaModelSchema = Schema.object({
    type: Schema.value("Site"),
    firstEntityId: SiteItemSearchEntityIdSchema.nullable(),
});

export const SearchEntityMediaModelSchema = Schema.union({
    Account: SearchEntityAccountMediaModelSchema,
    AccountPile: SearchEntityAccountPileMediaModelSchema,
    TaskCollectionColor: SearchEntityTaskCollectionColorMediaModelSchema,
    TaskDisplayStatus: SearchEntityTaskDisplayStatusMediaModelSchema,
    Site: SearchEntitySiteMediaModelSchema,
});
