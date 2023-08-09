import {JsonValue} from "~/shared/helpers/types/json_value.js";

/**
 * A clause in the OpenSearch query DSL.
 *
 * https://opensearch.org/docs/latest/query-dsl/
 */
export type OpensearchQueryClause<FlattenedKeys extends string> =
    | OpensearchTermQueryClause<FlattenedKeys>
    | OpensearchTermsQueryClause<FlattenedKeys>
    | OpensearchExistsQueryClause<FlattenedKeys>
    | OpensearchRangeQueryClause<FlattenedKeys>
    | OpensearchMatchPhraseQueryClause<FlattenedKeys>
    | OpensearchBooleanQueryClause<FlattenedKeys>;

type OpensearchQueryClauseField<FlattenedKeys extends string, Value> = {
    [Key in FlattenedKeys]?: Value;
};

/**
 * Searches for documents with an exact term in a specific field.
 *
 * https://opensearch.org/docs/latest/query-dsl/term/#term
 */
export type OpensearchTermQueryClause<FlattenedKeys extends string> = {
    terms: OpensearchQueryClauseField<FlattenedKeys, Array<JsonValue>>;
};

/**
 * Searches for documents with one or more terms in a specific field.
 *
 * https://opensearch.org/docs/latest/query-dsl/term/#term
 */
export type OpensearchTermsQueryClause<FlattenedKeys extends string> = {
    term: OpensearchQueryClauseField<FlattenedKeys, JsonValue>;
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
 * Searches for documents with field values in a specific range.
 *
 * https://opensearch.org/docs/latest/query-dsl/term/#range
 */
export type OpensearchRangeQueryClause<FlattenedKeys extends string> = {
    range: OpensearchQueryClauseField<
        FlattenedKeys,
        {gte?: JsonValue; gt?: JsonValue; lte?: JsonValue; lt?: JsonValue}
    >;
};

/**
 * Match documents that contain an exact phrase in a specified order.
 *
 * https://opensearch.org/docs/latest/query-dsl/full-text/#match-phrase
 */
export type OpensearchMatchPhraseQueryClause<FlattenedKeys extends string> = {
    match_phrase: OpensearchQueryClauseField<FlattenedKeys, {query: string; analyzer?: string}>;
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
};

/**
 * Logical and operator that is applied first to reduce your dataset before applying the queries. A query within a filter clause is a yes or no option. If a document matches the query, it is returned in the results; otherwise, it is not. The results of a filter query are generally cached to allow for a faster return. Use the filter query to filter the results based on exact matches, ranges, dates, or numbers.
 */
export type OpensearchFilterBooleanQueryClause<FlattenedKeys extends string> = {
    filter: OpensearchQueryClause<FlattenedKeys> | Array<OpensearchQueryClause<FlattenedKeys>>;
};
