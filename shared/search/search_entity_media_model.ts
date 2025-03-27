import {themeColors} from "~/shared/design/core/theme_colors.js";
import {Schema, SchemaType} from "~/shared/schema/schema.js";
import {AccountModel} from "~/shared/spaces/account_model.js";

export type SearchEntityMediaModel = SchemaType<typeof SearchEntityMediaModelSchema>;

export const SearchEntityAccountMediaModelSchema = Schema.object({
    type: Schema.value("Account"),
    account: AccountModel.schema,
});

export const SearchEntityAccountPileMediaModelSchema = Schema.object({
    type: Schema.value("AccountPile"),
    previewAccounts: Schema.array(AccountModel.schema).minLength(1),
    accountCount: Schema.integer,
});

export const SearchEntityTaskCollectionColorMediaModelSchema = Schema.object({
    type: Schema.value("TaskCollectionColor"),
    color: Schema.enum(themeColors).nullable(),
});

export const SearchEntityTaskDisplayStatusMediaModelSchema = Schema.object({
    type: Schema.value("TaskDisplayStatus"),
    displayStatus: Schema.enum(["OpenInactive", "OpenActive", "Closed"]),
});

export const SearchEntityMediaModelSchema = Schema.union({
    Account: SearchEntityAccountMediaModelSchema,
    AccountPile: SearchEntityAccountPileMediaModelSchema,
    TaskCollectionColor: SearchEntityTaskCollectionColorMediaModelSchema,
    TaskDisplayStatus: SearchEntityTaskDisplayStatusMediaModelSchema,
});
