import {filterMapArray} from "~/shared/helpers/array/filter_map_array.js";
import {isReadonlyArray} from "~/shared/helpers/array/is_readonly_array.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {JsonValue} from "~/shared/helpers/types/json_value.js";

/**
 * All dynamic values in an OpenSearch query must be wrapped in this class.
 * When `JSON.stringify()`ed the value will be converted to its underlying
 * value.
 *
 * The reason we require wrapping dynamic values is so we can throw them away
 * when generating a query description that's attached to the OpenSearch search
 * span. So when debugging OpenSearch searches you can see the entire request
 * minus any sensitive private values.
 */
export class OpensearchQueryValue<Value extends JsonValue> {
    private readonly _value: Value;

    constructor(value: Value) {
        this._value = value;
    }

    public toJSON() {
        return this._value;
    }
}

/**
 * A clause in the OpenSearch query DSL.
 *
 * https://opensearch.org/docs/latest/query-dsl/
 */
export type OpensearchQueryClause<FlattenedKeys extends string> =
    | OpensearchTermQueryClause<FlattenedKeys>
    | OpensearchTermsQueryClause<FlattenedKeys>
    | OpensearchExistsQueryClause<FlattenedKeys>
    | OpensearchPrefixQueryClause<FlattenedKeys>
    | OpensearchRangeQueryClause<FlattenedKeys>
    | OpensearchMatchQueryClause<FlattenedKeys>
    | OpensearchMatchBooleanPrefixQueryClause<FlattenedKeys>
    | OpensearchMatchPhraseQueryClause<FlattenedKeys>
    | OpensearchMultiMatchQueryClause<FlattenedKeys>
    | OpensearchKnnQueryClause<FlattenedKeys>
    | OpensearchNestedQueryClause<FlattenedKeys>
    | OpensearchBooleanQueryClause<FlattenedKeys>
    | OpensearchDisjunctionMatchQueryClause<FlattenedKeys>
    | OpensearchConstantScoreQueryClause<FlattenedKeys>;

type OpensearchQueryClauseField<FlattenedKeys extends string, Value> = {
    [Key in FlattenedKeys]?: Value;
};

/**
 * Searches for documents with an exact term in a specific field.
 *
 * https://opensearch.org/docs/latest/query-dsl/term/#term
 */
export type OpensearchTermQueryClause<FlattenedKeys extends string> = {
    terms: OpensearchQueryClauseField<
        FlattenedKeys,
        OpensearchQueryValue<ReadonlyArray<JsonValue>>
    >;
};

/**
 * Searches for documents with one or more terms in a specific field.
 *
 * https://opensearch.org/docs/latest/query-dsl/term/#term
 */
export type OpensearchTermsQueryClause<FlattenedKeys extends string> = {
    term: OpensearchQueryClauseField<FlattenedKeys, OpensearchQueryValue<JsonValue>>;
};

/**
 * Searches for documents with any indexed value in a specific field.
 *
 * https://opensearch.org/docs/latest/query-dsl/term/#exists
 */
export type OpensearchExistsQueryClause<FlattenedKeys extends string> = {
    exists: {field: FlattenedKeys};
};

/**
 * Searches for terms that begin with a specific prefix.
 *
 * https://docs.opensearch.org/docs/latest/query-dsl/term/prefix/
 */
export type OpensearchPrefixQueryClause<FlattenedKeys extends string> = {
    prefix: OpensearchQueryClauseField<
        FlattenedKeys,
        {
            value: OpensearchQueryValue<string>;
            boost?: number;
            case_insensitive?: boolean;
        }
    >;
};

/**
 * Searches for documents with field values in a specific range.
 *
 * https://opensearch.org/docs/latest/query-dsl/term/#range
 */
export type OpensearchRangeQueryClause<FlattenedKeys extends string> = {
    range: OpensearchQueryClauseField<
        FlattenedKeys,
        {
            gte?: OpensearchQueryValue<JsonValue>;
            gt?: OpensearchQueryValue<JsonValue>;
            lte?: OpensearchQueryValue<JsonValue>;
            lt?: OpensearchQueryValue<JsonValue>;
        }
    >;
};

/**
 * Use the `match` query for full-text search of a specific document field. The
 * `match` query analyzes the provided search string and returns documents that
 * match any of the string’s terms.
 *
 * https://opensearch.org/docs/latest/query-dsl/full-text/index/#match
 */
export type OpensearchMatchQueryClause<FlattenedKeys extends string> = {
    match: OpensearchQueryClauseField<
        FlattenedKeys,
        {
            query: OpensearchQueryValue<string>;
            analyzer?: string;
            fuzziness?: "AUTO" | number;
            prefix_length?: number;
            boost?: number;
        }
    >;
};

/**
 * Analyzes the provided search string and creates a boolean query from the
 * string’s terms. It uses every term except the last term as a whole word for
 * matching. The last term is used as a prefix.
 *
 * https://docs.opensearch.org/docs/latest/query-dsl/full-text/match-bool-prefix/
 */
export type OpensearchMatchBooleanPrefixQueryClause<FlattenedKeys extends string> = {
    match_bool_prefix: OpensearchQueryClauseField<
        FlattenedKeys,
        {
            query: OpensearchQueryValue<string>;
            analyzer?: string;
            fuzziness?: "AUTO" | number;
            prefix_length?: number;
            boost?: number;
        }
    >;
};

/**
 * Match documents that contain an exact phrase in a specified order.
 *
 * https://opensearch.org/docs/latest/query-dsl/full-text/#match-phrase
 */
export type OpensearchMatchPhraseQueryClause<FlattenedKeys extends string> = {
    match_phrase: OpensearchQueryClauseField<
        FlattenedKeys,
        {query: OpensearchQueryValue<string>; analyzer?: string}
    >;
};

/**
 * You can use the `multi_match` query type to search multiple fields.
 * Multi-match operation functions similarly to the match operation.
 *
 * https://opensearch.org/docs/latest/query-dsl/full-text/index/#multi-match
 */
export type OpensearchMultiMatchQueryClause<FlattenedKeys extends string> = {
    multi_match: {
        query: OpensearchQueryValue<string>;
        type?: "best_fields" | "most_fields" | "phrase_prefix" | "bool_prefix";
        fields: Array<FlattenedKeys | `${FlattenedKeys}^${number}`>;
        fuzziness?: "AUTO" | number;
        prefix_length?: number;
        boost?: number;
    };
};

/**
 * Search an OpenSearch k-NN index.
 *
 * https://opensearch.org/docs/latest/search-plugins/knn/approximate-knn/
 *
 * Notes:
 *
 * - `k` is the number of neighbors the search of each graph will return
 *   (there's a separate graph per shared per segment). Must also provide
 *   `size` at the query level to determine how many results the entire query
 *   should return.
 *
 * - Provide `filter` to perform [efficient k-NN filtering][1] during the
 *   k-NN search request.
 *
 * [1]: https://opensearch.org/docs/latest/search-plugins/knn/filter-search-knn
 */
export type OpensearchKnnQueryClause<FlattenedKeys extends string> = {
    knn: OpensearchQueryClauseField<
        FlattenedKeys,
        {
            vector: OpensearchQueryValue<ReadonlyArray<number>>;
            k: number;
            filter?: OpensearchQueryClause<FlattenedKeys>;
        }
    >;
};

/**
 * Query objects in a `nested` field as if they are separate documents. (They
 * are, indeed, stored as separate documents.)
 *
 * https://opensearch.org/docs/latest/field-types/supported-field-types/nested/
 */
export type OpensearchNestedQueryClause<FlattenedKeys extends string> = {
    nested: {
        path: string;
        query: OpensearchQueryClause<FlattenedKeys>;
        inner_hits?: {
            size?: number;
            _source?: boolean;
            stored_fields?: Array<FlattenedKeys>;
        };
    };
};

/**
 * A Boolean query can combine several query clauses into one advanced query.
 * The clauses are combined with Boolean logic to find matching documents
 * returned in the results.
 *
 * https://opensearch.org/docs/latest/query-dsl/compound/bool/
 */
export type OpensearchBooleanQueryClause<FlattenedKeys extends string> = {
    bool:
        | OpensearchMustBooleanQueryClause<FlattenedKeys>
        | OpensearchMustNotBooleanQueryClause<FlattenedKeys>
        | OpensearchShouldBooleanQueryClause<FlattenedKeys>
        | OpensearchFilterBooleanQueryClause<FlattenedKeys>;
};

/**
 * Logical `and` operator. The results must match all queries in this clause.
 *
 * https://opensearch.org/docs/latest/query-dsl/compound/bool/
 */
export type OpensearchMustBooleanQueryClause<FlattenedKeys extends string> = {
    must: Array<OpensearchQueryClause<FlattenedKeys>>;
    must_not?: OpensearchQueryClause<FlattenedKeys> | Array<OpensearchQueryClause<FlattenedKeys>>;
};

/**
 * Logical `not` operator. All matches are excluded from the results.
 *
 * https://opensearch.org/docs/latest/query-dsl/compound/bool/
 */
export type OpensearchMustNotBooleanQueryClause<FlattenedKeys extends string> = {
    must_not: OpensearchQueryClause<FlattenedKeys> | Array<OpensearchQueryClause<FlattenedKeys>>;
};

/**
 * Logical `or` operator. The results must match at least one of the queries.
 * Matching more `should` clauses increases the document’s relevance score.
 * You can set the minimum number of queries that must match using the
 * `minimum_should_match` parameter. If a query contains a `must` or `filter`
 * clause, the default `minimum_should_match` value is 0. Otherwise, the
 * default `minimum_should_match` value is 1.
 *
 * https://opensearch.org/docs/latest/query-dsl/compound/bool/
 */
export type OpensearchShouldBooleanQueryClause<FlattenedKeys extends string> = {
    minimum_should_match: number;
    should: Array<OpensearchQueryClause<FlattenedKeys>>;
    // Allow for convenient and/or queries.
    must?: Array<OpensearchQueryClause<FlattenedKeys>>;
};

/**
 * Logical and operator that is applied first to reduce your dataset before
 * applying the queries. A query within a filter clause is a yes or no option.
 * If a document matches the query, it is returned in the results; otherwise,
 * it is not. The results of a filter query are generally cached to allow for a
 * faster return. Use the filter query to filter the results based on exact
 * matches, ranges, dates, or numbers.
 */
export type OpensearchFilterBooleanQueryClause<FlattenedKeys extends string> = {
    filter: OpensearchQueryClause<FlattenedKeys> | Array<OpensearchQueryClause<FlattenedKeys>>;
    // Allow some non-filter context `and`ed clauses alongside.
    must?: Array<OpensearchQueryClause<FlattenedKeys>>;
} & (
    | {
          // Allow some non-filter context `or`ed clauses alongside.
          minimum_should_match: number;
          should: Array<OpensearchQueryClause<FlattenedKeys>>;
      }
    | {}
);

/**
 * Disjunction match operator. The result must match at least one of the
 * queries. The winning query is the one with the highest score.
 *
 * https://opensearch.org/docs/latest/query-dsl/compound/disjunction-max/
 */
export type OpensearchDisjunctionMatchQueryClause<FlattenedKeys extends string> = {
    dis_max: {
        queries: Array<OpensearchQueryClause<FlattenedKeys>>;
        tie_breaker?: number;
    };
};

/**
 * A constant score query wraps a filter query and assigns all documents in the
 * results a relevance score equal to the value of the `boost` parameter. Thus,
 * all returned documents have an equal relevance score, and term
 * frequency/inverse document frequency (TF/IDF) is not considered.
 *
 * https://opensearch.org/docs/latest/query-dsl/compound/constant-score/
 */
export type OpensearchConstantScoreQueryClause<FlattenedKeys extends string> = {
    constant_score: {
        filter: OpensearchQueryClause<FlattenedKeys>;
        boost: number;
        /**
         * Used to name a query. The "name" of the query is returned by any result
         * that matches the query in the `matched_queries` array.
         *
         * https://docs.opensearch.org/latest/query-dsl/compound/bool/
         */
        _name?: string;
    };
};

/**
 * Get a string description of the OpenSearch query clause. It is JSON except
 * all `OpensearchQueryValue`s will be replaced with `_` so sensitive user data
 * isn't in our telemetry.
 *
 * Using the `_` character since that's a common symbol in functional
 * programming languages (like Haskell and Rust) to represent a value hole.
 */
export function getOpensearchQueryClauseDescription(
    queryClause: OpensearchQueryClause<string>,
): string {
    const loop = (value: JsonValue): string => {
        if (value === null) return "null";

        switch (typeof value) {
            case "boolean":
            case "number":
            case "string":
                return JSON.stringify(value);
            case "object": {
                if (isReadonlyArray(value)) {
                    return `[${value.map(item => loop(item)).join(",")}]`;
                } else if (value instanceof OpensearchQueryValue) {
                    return "_";
                } else {
                    return `{${filterMapArray(Object.entries(value), ([key, keyValue]) =>
                        keyValue !== undefined
                            ? `${JSON.stringify(key)}:${loop(keyValue)}`
                            : undefined,
                    ).join(",")}}`;
                }
            }
            default:
                throw exhaustive(value);
        }
    };

    return loop(queryClause as JsonValue);
}
