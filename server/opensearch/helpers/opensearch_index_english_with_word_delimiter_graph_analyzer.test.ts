import {approximatelyAnalyzeLikeOpensearchIndexEnglishWithWordDelimeterGraphAnalyzer} from "~/server/opensearch/helpers/opensearch_index_english_with_word_delimiter_graph_analyzer.js";

test("removes non-alphanumeric characters", () => {
    expect(
        Array.from(
            approximatelyAnalyzeLikeOpensearchIndexEnglishWithWordDelimeterGraphAnalyzer(
                // eslint-disable-next-line cyberworlds/string-quotes
                "XL---42+'Autocoder'",
            ),
        ),
    ).toEqual([
        {
            sourceStartIndex: 0,
            sourceLength: 2,
            text: "xl",
        },
        {
            sourceStartIndex: 5,
            sourceLength: 2,
            text: "42",
        },
        {
            sourceStartIndex: 9,
            sourceLength: 9,
            text: "autocod",
        },
    ]);
});
