import {assertAssignableTypes} from "~/shared/helpers/control/assert_assignable_types.js";
import {OpensearchSearchHitExplanationSchema} from "~/shared/opensearch/opensearch_search_hit_explanation.js";
import {OrderKeySchema} from "~/shared/schema/helpers/order_key_schema.js";
import {createModelUnionSchema} from "~/shared/schema/model/create_model_union_schema.js";
import {Model} from "~/shared/schema/model/model.js";
import {Schema, SchemaType} from "~/shared/schema/schema.js";
import {SearchAffinityEntityId, SearchEntityId} from "~/shared/search/search_entity_id.js";
import {SearchAffinityEntityModel, SearchEntityModel} from "~/shared/search/search_entity_model.js";
import {AccountModel} from "~/shared/spaces/account_model.js";

// Use a custom discriminator key for this outer wrapper so it doesn't collide with
// the inner `type` discriminator on `SearchEntityModelDataSchema`. Without this, a
// `SearchEntityModel(type=Site)` would serialize as `{type: "Default", ...}`
// (overwriting the inner `Site`), and on deserialize the inner union would throw
// `Unknown type` because `"Default"` isn't a valid inner variant.
const SearchEntityResultModelSchema = createModelUnionSchema(
    {
        Account: AccountModel,
        Default: SearchEntityModel,
    },
    {typeKey: "_modelType"},
);

const SearchAffinityEntityResultModelSchema = SearchEntityResultModelSchema as Schema<
    AccountModel | SearchAffinityEntityModel
>;

const SearchEntityResultObjectSchema = Schema.object({
    model: SearchEntityResultModelSchema,
    score: Schema.float,
    bodyTextSnippet: Schema.array(
        Schema.object({
            isHighlighted: Schema.boolean,
            text: Schema.string,
        }),
    ),
    explanation: OpensearchSearchHitExplanationSchema.optional(),
    parsedFilter: Schema.object({
        summary: Schema.string,
    }).nullable(),
});

/**
 * Search result returned by `searchByKeywords()` and `searchBySemantics()`.
 */
export class SearchEntityResultModel extends Model(SearchEntityResultObjectSchema) {
    public readonly id: SearchEntityId;

    constructor(data: SchemaType<typeof SearchEntityResultObjectSchema>) {
        super(data);
        this.id = this.model.getSearchEntityId();
    }
}

const SearchAffinityEntityResultObjectSchema = Schema.object({
    model: SearchAffinityEntityResultModelSchema,
    score: Schema.float,
    favoriteOrderKey: OrderKeySchema.nullable(),
});

/**
 * Search result returned by `searchByAffinity()`.
 */
export class SearchAffinityEntityResultModel extends Model(SearchAffinityEntityResultObjectSchema) {
    public readonly id: SearchAffinityEntityId;

    // These properties don't exist on this result type.
    public readonly bodyTextSnippet?: never;
    public readonly explanation?: never;

    constructor(data: SchemaType<typeof SearchAffinityEntityResultObjectSchema>) {
        super(data);
        this.id = this.model.getSearchEntityId();
    }
}

const SearchFavoriteEntityResultObjectSchema = Schema.object({
    model: SearchAffinityEntityResultModelSchema,
    score: Schema.float,
    favoriteOrderKey: OrderKeySchema,
});

/**
 * Search result returned by the `favoriteResults` property in
 * `searchByAffinity()`.
 */
export class SearchFavoriteEntityResultModel extends Model(SearchFavoriteEntityResultObjectSchema) {
    public readonly id: SearchAffinityEntityId;

    // These properties don't exist on this result type.
    public readonly bodyTextSnippet?: never;
    public readonly explanation?: never;

    constructor(data: SchemaType<typeof SearchFavoriteEntityResultObjectSchema>) {
        super(data);
        this.id = this.model.getSearchEntityId();
    }
}

// Favorite results are assignable to affinity results.
assertAssignableTypes<SearchFavoriteEntityResultModel, SearchAffinityEntityResultModel>();
