import {
    OpensearchIndexAnalysisCustomAnalyzer,
    OpensearchIndexAnalysisCustomFilter,
} from "~/server/opensearch/opensearch_index_analysis.js";

/**
 * We add the `word_delimiter_graph` filter to the [default English language
 * analyzer][1] to split up identifiers, allowing us to search them. For
 * example `["FY2024Q3"]` is split into `["FY", "2024", "Q", "3"]` so you can
 * search `"Q3"` and find what you're looking for. It also splits
 * camelCase/PascalCase which helps programming queries (e.g. if we had
 * `["TaskRealtimeService"]` it becomes `["Task", "Realtime", "Service"]`).
 *
 * We expect identifiers with naming schemes like these to be common in large
 * businesses. In businesses with a big software presence we expect queries
 * like these to be very common.
 *
 * When localizing our product we should consider adding additional analyzers
 * for other languages.
 *
 * [1]: https://www.elastic.co/guide/en/elasticsearch/reference/current/analysis-lang-analyzer.html#english-analyzer
 */
export const opensearchIndexEnglishWithWordDelimiterGraphAnalyzer =
    new OpensearchIndexAnalysisCustomAnalyzer("english_with_word_delimiter_graph", {
        tokenizer: "standard",
        filter: [
            new OpensearchIndexAnalysisCustomFilter("english_possessive_stemmer", {
                type: "stemmer",
                language: "possessive_english",
            }),
            "lowercase",
            new OpensearchIndexAnalysisCustomFilter("english_stop", {
                type: "stop",
                stopwords: "_english_",
            }),
            new OpensearchIndexAnalysisCustomFilter("english_stemmer", {
                type: "stemmer",
                language: "english",
            }),
            new OpensearchIndexAnalysisCustomFilter("english_word_delimiter_graph", {
                type: "word_delimiter_graph",
                // English possessives are already stemmed.
                stem_english_possessive: false,
            }),
        ],
    });
