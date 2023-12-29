import {AccountModel} from "~/shared/accounts/account_model.js";
import {Schema, SchemaType} from "~/shared/schema/schema.js";
import {SearchEntityOrEntityAffinityIdSchema} from "~/shared/search/search_entity_affinity_id.js";

/**
 * A search result object representing one of many different kinds of content
 * types in our system. Returned by one of our search endpoints.
 */
export type SearchResult = SchemaType<typeof SearchResultSchema>;

export type SearchResultMedia = SchemaType<typeof SearchResultMediaSchema>;

const SearchResultAccountMediaSchema = Schema.object({
    type: Schema.value("Account"),
    account: AccountModel.schema,
});

const SearchResultAccountPileMediaSchema = Schema.object({
    type: Schema.value("AccountPile"),
    previewAccounts: Schema.array(AccountModel.schema).minLength(1),
    accountCount: Schema.integer,
});

export const SearchResultMediaSchema = Schema.union({
    Account: SearchResultAccountMediaSchema,
    AccountPile: SearchResultAccountPileMediaSchema,
});

export const SearchResultSchema = Schema.object({
    entityId: SearchEntityOrEntityAffinityIdSchema,
    score: Schema.float, // NOCOMMIT: In debug mode we need more info?
    title: Schema.string.nullable(),
    bodyTextSnippet: Schema.array(
        Schema.object({
            isHighlighted: Schema.boolean,
            text: Schema.string,
        }),
    ),
    media: SearchResultMediaSchema.nullable(),
});
