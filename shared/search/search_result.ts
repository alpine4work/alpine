import {themeColors} from "~/shared/design/theme_colors.js";
import {OpensearchSearchHitExplanationSchema} from "~/shared/opensearch/opensearch_search_hit_explanation.js";
import {Schema, SchemaType} from "~/shared/schema/schema.js";
import {SearchAffinityId} from "~/shared/search/search_affinity_id.js";
import {SearchCommandId} from "~/shared/search/search_commands.js";
import {SearchEntityId} from "~/shared/search/search_entity_id.js";
import {AccountModel} from "~/shared/spaces/account_model.js";

export type SearchResultId = SearchEntityId | SearchAffinityId | SearchCommandId;

export const SearchResultIdSchema = Schema.string as Schema<SearchResultId>;

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

const SearchResultTaskCollectionColorMediaSchema = Schema.object({
    type: Schema.value("TaskCollectionColor"),
    color: Schema.enum(themeColors).nullable(),
});

export const SearchResultMediaSchema = Schema.union({
    Account: SearchResultAccountMediaSchema,
    AccountPile: SearchResultAccountPileMediaSchema,
    TaskCollectionColor: SearchResultTaskCollectionColorMediaSchema,
});

export const SearchResultSchema = Schema.object({
    id: SearchResultIdSchema.originalPropertyKey("entityId"),
    score: Schema.float,
    title: Schema.string.nullable(),
    bodyTextSnippet: Schema.array(
        Schema.object({
            isHighlighted: Schema.boolean,
            text: Schema.string,
        }),
    ),
    media: SearchResultMediaSchema.nullable(),
    explanation: OpensearchSearchHitExplanationSchema.optional(),
});
