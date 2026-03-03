import {stemmer} from "stemmer";
import {findSpans as findUnicodeDefaultWordBoundarySpans} from "unicode-default-word-boundary";
import {
    OpensearchIndexAnalysisCustomAnalyzer,
    OpensearchIndexAnalysisCustomFilter,
} from "~/server/opensearch/opensearch_index_analysis.js";

/**
 * We add the `word_delimiter_graph` filter to the [default English language
 * analyzer][1] to split up identifiers, allowing us to search them. For example
 * `["FY2024Q3"]` is split into `["FY", "2024", "Q", "3"]` so you can search `"Q3"`
 * and find what you're looking for. It also splits camelCase/PascalCase which
 * helps programming queries (e.g. if we had `["TaskRealtimeService"]` it becomes
 * `["Task", "Realtime", "Service"]`).
 *
 * We expect identifiers with naming schemes like these to be common in large
 * businesses. In businesses with a big software presence we expect queries like
 * these to be very common.
 *
 * When localizing our product we should consider adding additional analyzers for
 * other languages.
 *
 * One important difference with the [English analyzer][1] is we don't remove stop
 * words since they can change semantic meaning and removing them may lead to a
 * loss in query precision. [Read this blog post from 2013][2] for more
 * information. In 2013 ElasticSearch introduced a parameter `cutoff_frequency`
 * which provided similar search performance to a query with stop words removed
 * without reducing precision. [In 2019 `cutoff_frequency` was deprecated][3] since
 * ElasticSearch out of the box has good performance for queries with common terms.
 *
 * [1]:
 *     https://www.elastic.co/guide/en/elasticsearch/reference/current/analysis-lang-analyzer.html#english-analyzer
 * [2]:
 *     https://www.elastic.co/blog/stop-stopping-stop-words-a-look-at-common-terms-query
 * [3]: https://github.com/elastic/elasticsearch/issues/37096
 */
export const opensearchIndexEnglishWithWordDelimiterGraphAnalyzer =
    // Numbered with `_2` to avoid conflicting with our original
    // `english_with_word_delimiter_graph` analyzer used by `TaskCollectionNameType`.
    new OpensearchIndexAnalysisCustomAnalyzer("english_with_word_delimiter_graph_2", {
        tokenizer: "standard",
        filter: [
            new OpensearchIndexAnalysisCustomFilter("english_possessive_stemmer", {
                type: "stemmer",
                language: "possessive_english",
            }),
            "lowercase",
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

/**
 * Approximately tries to analyze the provided text in JavaScript as if we were the
 * OpenSearch `opensearchIndexEnglishWithWordDelimiterGraphAnalyzer` analyzer. This
 * is only approximate. We don't attempt to exactly match OpenSearch's
 * implementation. For instance, at the moment we don't implement anything to do
 * with the `word_delimiter_graph` filter.
 *
 * Useful for doing some OpenSearch-like work within our services that doesn't
 * require exact OpenSearch compatibility. Like highlighting text from an
 * alternative search engine.
 */
export function approximatelyAnalyzeLikeOpensearchIndexEnglishWithWordDelimeterGraphAnalyzer(
    text: string,
) {
    const tokens: Array<{
        sourceStartIndex: number;
        sourceLength: number;
        text: string;
    }> = [];

    // `standard` tokenizer. See:
    // https://www.elastic.co/guide/en/elasticsearch/reference/current/analysis-standard-analyzer.html
    const spans = findUnicodeDefaultWordBoundarySpans(text);

    for (const span of spans) {
        let text = span.text;

        // Remove whitespace spans. See:
        // https://github.com/eddieantonio/unicode-default-word-boundary/blob/4085db79a22a5222a64df1a5cc27997d6a10e037/src/index.ts#L106-L118
        // https://unicode.org/reports/tr29/#Default_Word_Boundaries
        // eslint-disable-next-line no-control-regex
        if (/^[\u000D\u000A\u000B\u000C\u0085\u2028\u2029]|\p{Zs}+$/u.test(text)) {
            continue;
        }

        // `stemmer` filter with `possessive_english` language. See:
        // https://www.elastic.co/guide/en/elasticsearch/reference/current/analysis-stemmer-tokenfilter.html
        // https://github.com/apache/lucene/blob/5d6086e1994d766a3dd39a47b14a8cd80a7280e6/lucene/analysis/common/src/java/org/apache/lucene/analysis/en/EnglishPossessiveFilter.java#L32-L50
        if (
            text.length >= 2 &&
            // eslint-disable-next-line cyberworlds/string-quotes
            (text[text.length - 2] === "'" ||
                text[text.length - 2] === "\u2019" ||
                text[text.length - 2] === "\uFF07") &&
            (text[text.length - 1] === "s" || text[text.length - 1] === "S")
        ) {
            text = text.slice(0, -2);
        }

        // `lowercase` filter. See:
        // https://www.elastic.co/guide/en/elasticsearch/reference/current/analysis-lowercase-tokenfilter.html
        text = text.toLowerCase();

        // `stemmer` filter with `english` language. Uses the Porter stemming algorithm.
        // See:
        // https://www.elastic.co/guide/en/elasticsearch/reference/current/analysis-stemmer-tokenfilter.html
        // https://snowballstem.org/algorithms/porter/stemmer.html
        text = stemmer(text);

        // Throw out non-alphanumeric tokens like `word_delimiter_graph`. We don't
        // currently split at letter-number transitions or case transitions like
        // `word_delimiter_graph`.
        // https://www.elastic.co/guide/en/elasticsearch/reference/current/analysis-word-delimiter-graph-tokenfilter.html
        if (/^[^\p{Ll}\p{Lm}\p{Lo}\p{Lt}\p{Lu}\p{Nd}|\p{Nl}|\p{No}]+$/u.test(text)) {
            continue;
        }

        tokens.push({
            sourceStartIndex: span.start,
            sourceLength: span.length,
            text,
        });
    }

    return tokens;
}
