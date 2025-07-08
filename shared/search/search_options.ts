import {mapIterable} from "~/shared/helpers/iterable/map_iterable.js";
import {ObjectSchema, Schema, SchemaType} from "~/shared/schema/schema.js";

/**
 * Options that configure details of how a search is executed. If you have
 * internal access you may tweak search options to see how they impact search
 * results.
 *
 * Setting the right search options is more art than science. Small changes may
 * have a major impact on search results.
 */
export type SearchOptions = SchemaType<typeof SearchOptionsActualSchema>;

const SearchOptionsActualSchema = Schema.object({
    /**
     * How much should we boost matches on a search entity's title vs matches on
     * a search entity's body? We multiply the search's title match score with this
     * value.
     *
     * We recommend a value between 1 and 2 (not inclusive).
     *
     * - Should be >1 so that title matches are ranked higher than body matches.
     *
     * - Should be <2 since a body match on two fields should rank higher than a
     *   title match on just one field.
     *
     *   We index attributes into multiple fields (e.g. we have an indexed 2gram
     *   field and 3gram field for phrase matching) and when searching we sum the
     *   scores from each matching field. So when matching two fields you get
     *   approximately double the score of matching just one field. It's not quite
     *   double since frequency statistics kick in but you can roughly think of the
     *   score as doubled.
     */
    titleBoost: Schema.float,

    /**
     * Minimum keyword score contribution for a semantic search result.
     *
     * - If there is only a semantic match (no keyword match) this value is added
     *   to the interpolated semantic score to get the final result.
     *
     * - If there is a keyword match, we take the max of the keyword score and this
     *   value.
     *
     * This lets you set a relevance "floor" for semantic search results. If you
     * got a semantic search result, odds are it's meaningful.
     */
    minKeywordScoreForSemanticResult: Schema.float,

    /**
     * If present, we multiply semantic scores by this number after they're
     * returned from OpenSearch.
     *
     * Cohere in production gives us scores like 0.00000051802067 which are hard
     * to reason about. By setting this to 1000000 we end up with the score
     * 0.51802067 which is easier for our developers to think about.
     *
     * This option has no effect on the user experience. It's only helpful for
     * developers debugging search.
     */
    semanticScoreScaleFromOpensearch: Schema.float,

    /**
     * If present, the minimum semantic score we let OpenSearch return. If
     * OpenSearch can't find a match with a better score than this, it can stop
     * searching early.
     */
    minSemanticScore: Schema.float,

    /**
     * Options related to our English natural language query parsing.
     */
    naturalLanguage: Schema.object({
        /**
         * Control text is text we've removed from the query and made optional. For
         * example in the query "my documents about trains" the subtext "my documents
         * about" is control text and "trains" is regular text.
         *
         * Given our natural language parsing can never be perfect, our query is
         * modified to search for basically
         * `match("trains") && (creatorId === actorId || match("my documents about"))`.
         * But we want to demote hits to "my documents about" under hits on the
         * `creatorId`.
         *
         * This is a delicate balance since we may want to rank great hits on control
         * text (e.g. rare words get matched) higher than hits against our natural
         * language filter.
         */
        controlMatchBoost: Schema.float,

        /**
         * The constant score we give to a hit that matches a filter from our English
         * natural language parser.
         */
        filterConstantScore: Schema.float,

        /**
         * `controlMatchBoost` when we're not confident the user wanted a natural
         * language search.
         *
         * If we're only filtering search entity types (e.g. with the query
         * "documents") we use a higher control match boost since the natural
         * language filter is ambiguous.
         */
        controlMatchBoostIfLowConfidence: Schema.float,

        /**
         * `filterConstantScore` when we're not confident the user wanted a natural
         * language search.
         *
         * If we're only filtering search entity types (e.g. with the query
         * "documents") we use a different, lower, score since the natural language
         * filter is ambiguous.
         */
        filterConstantScoreIfLowConfidence: Schema.float,
    }),

    /**
     * Interpolate between scores returned by `searchBySemantics()` and
     * `searchByKeywords()` using [linear interpolation][1]. This allows us to
     * merge results from the two search systems together. To interpolate we need
     * to pick semantic scores and keyword scores of similar relevance to the user.
     *
     * There are many ways to merge semantic and keyword search results in the
     * Information Retrieval system literature:
     *
     * 1. [Linear interpolation is common and easy][2].
     *
     * 2. After a first-pass search you can re-rank results with a language model.
     *    [Cohere provides an API for this][3]. There's some discussion [in the
     *    literature][4] of how you lose some useful relevance signals from keyword
     *    search with this approach. This approach can be slow since you're
     *    computing full embedding distances for 100 or so top hits with a
     *    language model.
     *
     * 3. [Reciprocal rank fusion (RRF)][5] is easy to implement but weighs each
     *    search system equally. If the first keyword search match is VERY good it
     *    is considered the same as the first semantic search match which could
     *    just be kinda good. It is [provided by new versions of ElasticSearch][6]
     *    (but not OpenSearch). RRF is trivial to implement in user code.
     *
     * We tried RRF (option 3) but the practical effect was: results in both
     * keyword and semantic search shot up to the top, otherwise results alternated
     * between keyword and semantic search results. If we had a really strong
     * keyword search result it would be weighted equally with semantic search
     * results. This approach wasn't particularly encouraging.
     *
     * Re-ranking with a language model (option 2) seems prohibitively slow and
     * expensive. Maybe re-ranking with a cheaper language model we could run on
     * our servers could make sense?
     *
     * So we're going with linear interpolation (option 1) since it's easy to
     * understand, common, and very tunable.
     *
     * [1]: https://en.wikipedia.org/wiki/Linear_interpolation
     * [2]: https://medium.com/@zz1409/combining-embedding-and-keyword-based-search-for-improved-performance-b15b0cfd3152
     * [3]: https://txt.cohere.com/rerank
     * [4]: https://dl.acm.org/doi/abs/10.1145/3471158.3472233
     * [5]: https://plg.uwaterloo.ca/~gvcormac/cormacksigir09-rrf.pdf
     * [6]: https://www.elastic.co/guide/en/elasticsearch/reference/current/rrf.html
     */
    semanticToKeywordScoreInterpolation: Schema.object({
        point1: Schema.object({
            semanticScore: Schema.float,
            keywordScore: Schema.float,
        }),
        point2: Schema.object({
            semanticScore: Schema.float,
            keywordScore: Schema.float,
        }),
    }),

    /**
     * Interpolate between scores returned by `searchByAffinity()` and
     * `searchByKeywords()` using [linear interpolation][1]. This allows us to
     * merge results from the two search systems together. To interpolate we need
     * to pick affinity scores and keyword scores similar relevance to the user.
     *
     * See the documentation on `semanticToKeywordScoreInterpolation` for why we
     * pick linear interpolation as the method to merge search results.
     *
     * [1]: https://en.wikipedia.org/wiki/Linear_interpolation
     */
    affinityToKeywordScoreInterpolation: Schema.object({
        point1: Schema.object({
            affinityScore: Schema.float,
            keywordScore: Schema.float,
        }),
        point2: Schema.object({
            affinityScore: Schema.float,
            keywordScore: Schema.float,
        }),
    }),
});

/**
 * We get a keyword score of ~11 for a relatively rare word like "Spielberg"
 * (contained in ~0.6% documents of [GoodWiki][1] dataset).
 *
 * [1]: https://huggingface.co/datasets/euirim/goodwiki
 */
const greatBodyKeywordScore = 11;

/**
 * We get a keyword score of ~3 for a somewhat common noun like "video"
 * (contained in ~21.9% documents of [GoodWiki][1] dataset)
 *
 * [1]: https://huggingface.co/datasets/euirim/goodwiki
 */
const fineBodyKeywordScore = 3;

/**
 * The standard search options we use in production.
 *
 * You may change these options if you have internal access and enter search
 * debug mode for the purpose of tuning search. Regular usage of search uses
 * these options.
 *
 * Setting the right search options is more art than science. Small changes may
 * have a major impact on search results.
 */
export const standardSearchOptions: SearchOptions = {
    // A title match is much better than a body match. Set a boost close to 2 but
    // still less than 2 so a hit matching multiple body fields can beat a hit
    // matching one title field.
    titleBoost: 1.8,

    // The relevance "floor" for a semantic result. Same as a great body keyword
    // score match.
    minKeywordScoreForSemanticResult: 11,

    // In production, Cohere gives us scores like 5.5198393e-7. Multiply by 1e6 so
    // we end up with scores that instead look like 0.55198393 which you can read
    // in the debug mode search score explanation window.
    semanticScoreScaleFromOpensearch: process.env.NODE_ENV === "production" ? 1e6 : 1,

    // In production, scores under this value are ridiculous. Like the query "dog"
    // matching "asdfasdfasdf". OpenSearch can stop searching if it doesn't find
    // semantic results with scores above this.
    minSemanticScore: process.env.NODE_ENV === "production" ? 0.45 : 0,

    naturalLanguage: {
        // Control matches are worth half as much as a regular text match.
        //
        // Hopefully, because this is so low OpenSearch considers it non-competitive
        // to perform this search most of the time.
        controlMatchBoost: 0.5,

        // Our constant score is approximately `greatBodyKeywordScore * titleBoost`
        // (currently 11 * 1.8). So our constant score is equivalent to one great title
        // match.
        //
        // With `controlMatchBoost` set to 0.5, in order to beat the filter score a hit
        // needs two great title hits (1gram hit and 2gram hit).
        filterConstantScore: 20,

        // If we're not confident the user wanted a natural language search, treat
        // control text keyword matches as if they were regular keyword matches. For
        // example, typing the word "documents" will match entities with the word
        // document and entities of type document about equally.
        controlMatchBoostIfLowConfidence: 1,

        // If we're not confident the user wanted a natural language search, treat
        // matches against our natural language filter about the same as a great
        // body keyword match plus a fine title keyword match (currently 11 + 3 * 1.8).
        filterConstantScoreIfLowConfidence: 16.4,
    },

    semanticToKeywordScoreInterpolation: {
        // Our first point is for a high confidence signal:
        point1: {
            keywordScore: greatBodyKeywordScore,

            semanticScore:
                // Cohere in production and `all-MiniLM-L6-v2` in development produce different
                // scores.
                //
                // NOTE(calebmer, 2025-04-14): These values are looking kinda similar now that
                // we're using the `l2` space in our `hnsw` search both in development and
                // production. Is that a coincidence or can we consolidate on the same values
                // for development and production?
                process.env.NODE_ENV === "production"
                    ? // We got this score when searching (with Cohere in production) "second quarter roadmap" and
                      // getting a passage from my update email after the notification cycle talking about the plan for
                      // next cycle (which started in ~June) and the plan for the next couple years. Great match.
                      465450.1
                    : // This is the score from the `all-MiniLM-L6-v2` model for "british currency
                      // history" vs a passage from the first section of the "[Penny (British decimal
                      // coin)][1]" Wikipedia article which is an excellent match.
                      //
                      // [1]: https://en.wikipedia.org/wiki/Penny_(British_decimal_coin)
                      0.6,
        },

        // Our second point is for a low confidence signal:
        point2: {
            keywordScore: fineBodyKeywordScore,

            semanticScore:
                // Cohere in production and `all-MiniLM-L6-v2` in development produce different
                // scores.
                //
                // NOTE(calebmer, 2025-04-14): These values are looking kinda similar now that
                // we're using the `l2` space in our `hnsw` search both in development and
                // production. Is that a coincidence or can we consolidate on the same values
                // for development and production?
                process.env.NODE_ENV === "production"
                    ? // We got this score when searching (with Cohere in production) "business
                      // conference" and getting a passage from the dummy document "PureStream
                      // Project Brief: Trade Show Participation" which starts with "Showcase our
                      // eco-friendly water boiler product at a major industry trade show".
                      //
                      // While an industry trade show isn't exactly a business conference, it is
                      // pretty close.
                      441937.03
                    : // This is the score from the `all-MiniLM-L6-v2` model for "marketing result"
                      // vs a passage from the "[Big King][1]" Wikipedia article's [double supreme
                      // advertising][2] section.
                      //
                      // The passage is indeed about ads and the results of those ads. So relevant
                      // but only somewhat so.
                      //
                      // [1]: https://en.wikipedia.org/wiki/Big_King
                      // [2]: https://en.wikipedia.org/wiki/Big_King#Double_Supreme
                      0.45,
        },
    },

    affinityToKeywordScoreInterpolation: {
        // Our first point is for a high confidence signal:
        point1: {
            keywordScore: greatBodyKeywordScore,

            // An affinity score of 21 is equivalent to ~1.75 hours of viewing time for a
            // search entity (without considering decay)
            affinityScore: 21,
        },

        // Our second point is for a low confidence signal:
        point2: {
            keywordScore: fineBodyKeywordScore,

            // An affinity score of 1 is equivalent to viewing a search entity once
            // (without considering decay)
            affinityScore: 1,
        },
    },
};

// Add all our standard search options as `default()`s so when loading search
// options from local storage we automatically fill in new options with
// standard values.
export const SearchOptionsSchema = addDeepDefaultsToSchema(
    SearchOptionsActualSchema,
    standardSearchOptions,
);

function addDeepDefaultsToSchema<Value extends {[key: string]: unknown}>(
    objectSchema: ObjectSchema<Value>,
    object: Value,
): ObjectSchema<Value> {
    return Schema.object(
        Object.fromEntries(
            mapIterable(objectSchema.propertySchemaByKey, ([key, propertySchema]) => {
                const propertyValueSchema =
                    propertySchema.valueSchema instanceof ObjectSchema
                        ? addDeepDefaultsToSchema(propertySchema.valueSchema, object[key] as any)
                        : propertySchema.valueSchema;

                return [key, propertyValueSchema.default(object[key])];
            }),
        ),
    ) as ObjectSchema<any>;
}
