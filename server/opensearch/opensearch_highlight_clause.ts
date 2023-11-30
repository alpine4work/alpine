/**
 * Highlight clause for an OpenSearch search request.
 *
 * https://opensearch.org/docs/latest/search-plugins/searching-data/highlight/
 */
export type OpensearchHighlightClause<FlattenedKeys extends string> =
    OpensearchHighlightClauseOptions & {
        fields: {
            [Key in FlattenedKeys]?: OpensearchHighlightClauseOptions;
        };
    };

/**
 * Options for the highlighter which can either be set at a global or
 * field level.
 *
 * https://opensearch.org/docs/latest/search-plugins/searching-data/highlight/#highlighting-options
 */
type OpensearchHighlightClauseOptions = {
    type?: "unified" | "fvh" | "plain";
    encoder?: "default" | "html";
};
