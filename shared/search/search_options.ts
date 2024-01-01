import {Schema, SchemaType} from "~/shared/schema/schema.js";

/**
 * Options that configure details of how a search is executed. If you have
 * internal access you may tweak search options to see how they impact search
 * results.
 *
 * Setting the right search options is more art than science. Small changes may
 * have a major impact on search results.
 */
export type SearchOptions = SchemaType<typeof SearchOptionsSchema>;

export const SearchOptionsSchema = Schema.object({
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

    semanticToKeywordScoreInterpolation: {
        // Our first point is for a high confidence signal:
        point1: {
            // We get a keyword score of ~11 for a relatively rare word like "Spielberg"
            // (contained in ~0.6% documents of [GoodWiki][1] dataset)
            //
            // [1]: https://huggingface.co/datasets/euirim/goodwiki
            keywordScore: 11,

            // This is the score from the `all-MiniLM-L6-v2` model for "british currency
            // history" vs a passage from the first section of the "[Penny (British decimal
            // coin)][1]" Wikipedia article which is an excellent match.
            //
            // [1]: https://en.wikipedia.org/wiki/Penny_(British_decimal_coin)
            semanticScore: 0.84,
        },

        // Our second point is for a low confidence signal:
        point2: {
            // We get a keyword score of ~3 for a somewhat common noun like "video"
            // (contained in ~21.9% documents of [GoodWiki][1] dataset)
            //
            // [1]: https://huggingface.co/datasets/euirim/goodwiki
            keywordScore: 3,

            // This is the score from the `all-MiniLM-L6-v2` model for "marketing result"
            // vs a passage from the "[Big King][1]" Wikipedia article's [double supreme
            // advertising][2] section.
            //
            // The passage is indeed about ads and the results of those ads. So relevant
            // but only somewhat so.
            //
            // [1]: https://en.wikipedia.org/wiki/Big_King
            // [2]: https://en.wikipedia.org/wiki/Big_King#Double_Supreme
            semanticScore: 0.67,
        },
    },

    affinityToKeywordScoreInterpolation: {
        // Our first point is for a high confidence signal:
        point1: {
            // We get a keyword score of ~11 for a relatively rare word like "Spielberg"
            // (contained in ~0.6% documents of [GoodWiki][1] dataset)
            //
            // [1]: https://huggingface.co/datasets/euirim/goodwiki
            keywordScore: 11,

            // An affinity score of 21 is equivalent to ~1.75 hours of viewing time for a
            // search entity (without considering decay)
            affinityScore: 21,
        },

        // Our second point is for a low confidence signal:
        point2: {
            // We get a keyword score of ~3 for a somewhat common noun like "video"
            // (contained in ~21.9% documents of [GoodWiki][1] dataset)
            //
            // [1]: https://huggingface.co/datasets/euirim/goodwiki
            keywordScore: 3,

            // An affinity score of 1 is equivalent to viewing a search entity once
            // (without considering decay)
            affinityScore: 1,
        },
    },
};
