import {assertAssignableTypes} from "~/shared/helpers/control/assert_assignable_types.js";
import {OrderKeySchema} from "~/shared/schema/helpers/order_key_schema.js";
import {Schema, SchemaType} from "~/shared/schema/schema.js";
import {SearchAffinityEntityIdSchema} from "~/shared/search/search_entity_id.js";
import {SearchEntityMediaModelSchema} from "~/shared/search/search_entity_media_model.js";

/**
 * Search result returned during affinity search like `searchByAffinity()`.
 */
export type SearchAffinityEntityResult = SchemaType<typeof SearchAffinityEntityResultSchema> & {
    // So you can access these properties on `SearchEntityResult | SearchEntityAffinityResult`.
    readonly bodyTextSnippet?: never;
    readonly explanation?: never;
};

export type SearchFavoriteAffinityEntityResult = SchemaType<
    typeof SearchFavoriteAffinityEntityResultSchema
> & {
    // So you can access these properties on `SearchEntityResult | SearchEntityAffinityResult`.
    readonly bodyTextSnippet?: never;
    readonly explanation?: never;
};

const SearchAffinityEntityResultBaseSchema = Schema.object({
    id: SearchAffinityEntityIdSchema,
    score: Schema.float,
    title: Schema.string,
    media: SearchEntityMediaModelSchema.nullable(),
});

export const SearchAffinityEntityResultSchema = SearchAffinityEntityResultBaseSchema.merge(
    Schema.object({
        favoriteOrderKey: OrderKeySchema.nullable(),
    }),
);

export const SearchFavoriteAffinityEntityResultSchema = SearchAffinityEntityResultBaseSchema.merge(
    Schema.object({
        favoriteOrderKey: OrderKeySchema,
    }),
);

// Favorite results are assignable to generic affinity results.
assertAssignableTypes<SearchFavoriteAffinityEntityResult, SearchAffinityEntityResult>();
