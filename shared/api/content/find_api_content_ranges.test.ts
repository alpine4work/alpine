/* eslint-disable cyberworlds/string-quotes */

import {
    ApiContentKeyDecoder,
    ApiContentKeyEncoder,
} from "~/shared/api/content/api_content_key_encoder.js";
import {fromApiContent} from "~/shared/api/content/from_api_content.js";
import {intoApiContent} from "~/shared/api/content/into_api_content.js";
import {parseApiContentFromMarkdown} from "~/shared/api/markdown/parse_api_content_from_markdown.js";
import {findApiContentRanges} from "~/shared/api/specification/find_api_content_ranges.js";
import {DocumentContentProsemirrorSchema} from "~/shared/documents/document_content_schema.js";
import {quote} from "~/shared/helpers/string/quote.js";
import {CommitBlocker} from "~/shared/helpers/types/commit_blocker.js";
import {generateId} from "~/shared/id/id.js";

const testCases: Array<{
    only?: CommitBlocker;
    haystack: string;
    needle: string;
    ranges: Array<{
        from: number;
        to: number;
        slice: string;
    }>;
}> = [
    {
        haystack: "foo bar qux",
        needle: "bar",
        ranges: [{from: 5, to: 8, slice: '<"bar">'}],
    },
    {
        haystack: "> foo bar qux",
        needle: "bar",
        ranges: [{from: 6, to: 9, slice: '<"bar">'}],
    },
    {
        haystack: "> - foo bar qux",
        needle: "bar",
        ranges: [{from: 7, to: 10, slice: '<"bar">'}],
    },
    {
        haystack: "> foo bar qux",
        needle: "> bar",
        ranges: [{from: 6, to: 9, slice: '<"bar">'}],
    },
    {
        haystack: "> - foo bar qux",
        needle: "- bar",
        ranges: [{from: 7, to: 10, slice: '<"bar">'}],
    },
    {
        haystack: "> - foo bar qux",
        needle: "> - bar",
        ranges: [{from: 7, to: 10, slice: '<"bar">'}],
    },
    {
        haystack: "- foo bar qux",
        needle: "bar",
        ranges: [{from: 6, to: 9, slice: '<"bar">'}],
    },
    {
        haystack: "- foo bar qux",
        needle: "- bar",
        ranges: [{from: 6, to: 9, slice: '<"bar">'}],
    },
    {
        haystack: "- foo bar qux",
        needle: "1. bar",
        ranges: [],
    },
    {
        haystack: "1. foo bar qux",
        needle: "1. bar",
        ranges: [{from: 6, to: 9, slice: '<"bar">'}],
    },
    {
        haystack: "- [ ] foo bar qux",
        needle: "- [ ] bar",
        ranges: [{from: 6, to: 9, slice: '<"bar">'}],
    },
    {
        haystack: "- [x] foo bar qux",
        needle: "- [ ] bar",
        ranges: [],
    },
];

for (const testCase of testCases) {
    const formatForTestTitle = (string: string) => {
        string = string.trim();
        if (string.length > 25) string = string.slice(0, 25) + "…";
        string = string.replaceAll("\n", "\\n");
        return quote(string);
    };

    test(`find ${formatForTestTitle(testCase.needle)} in ${formatForTestTitle(testCase.haystack)}`, () => {
        const documentId = generateId();

        const encoder = new ApiContentKeyEncoder({
            entityId: `Document:${documentId}`,
            version: 0,
        });

        const decoder = new ApiContentKeyDecoder(`Document:${documentId}`);

        const haystackNode = fromApiContent(
            DocumentContentProsemirrorSchema,
            parseApiContentFromMarkdown(testCase.haystack),
        );

        const haystack = intoApiContent(haystackNode, {
            encoder,
            getAccountMentionTitleIfExists: () => undefined,
            getSearchEntityMentionTitleIfExists: () => undefined,
            getSearchTaskEntityDisplayStatusIfExists: () => undefined,
            getFileIfExists: () => undefined,
        });

        const needle = parseApiContentFromMarkdown(testCase.needle);

        expect(
            Array.from(findApiContentRanges(haystack, needle), range => {
                const from = decoder.decode(range.start.key).pos + 1 + range.start.index;
                const to = decoder.decode(range.end.key).pos + 1 + range.end.index;

                const slice = haystackNode.slice(from, to);

                return {
                    from,
                    to,
                    slice: slice.content.toString(),
                };
            }),
        ).toEqual(testCase.ranges);
    });
}
