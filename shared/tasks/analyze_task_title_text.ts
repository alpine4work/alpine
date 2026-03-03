import {split as splitUnicodeDefaultWordBoundary} from "unicode-default-word-boundary";

/**
 * Analyzes a task title the same way OpenSearch would. We configure OpenSearch to
 * analyze task titles with the [standard analyzer][1] which does two things:
 *
 * 1. Split words using the Unicode [default word boundary specification][2]
 * 2. Lowercase all words
 *
 * The OpenSearch [standard analyzer implementation lives in Apache Lucene][3]. We
 * refer to their implementation when building ours.
 *
 * [1]: https://opensearch.org/docs/latest/analyzers/text-analyzers/
 * [2]: https://unicode.org/reports/tr29/#Default_Word_Boundaries
 * [3]:
 *     https://github.com/apache/lucene/blob/dd4e66dad6726c53f2d89c5b7bcf74216949e4d3/lucene/core/src/java/org/apache/lucene/analysis/standard/StandardAnalyzer.java#L34
 */
export function analyzeTaskTitleText(title: string): Array<string> {
    return splitUnicodeDefaultWordBoundary(title).map(word =>
        // Converts each individual Unicode UTF-16 code point to lowercase based on the
        // mappings in `UnicodeData.txt`. This is the same implementation as the OpenSearch
        // (which uses Lucene under the hood) lowercase text filter used by the standard
        // analyzer.
        //
        // https://tc39.es/ecma262/multipage/text-processing.html#sec-string.prototype.tolowercase
        // https://github.com/apache/lucene/blob/dd4e66dad6726c53f2d89c5b7bcf74216949e4d3/lucene/core/src/java/org/apache/lucene/analysis/CharacterUtils.java#L53-L61
        word.toLowerCase(),
    );
}
