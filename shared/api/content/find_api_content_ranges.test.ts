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
    {
        haystack: "",
        needle: "foo",
        ranges: [],
    },
    {
        haystack: "foo",
        needle: "",
        ranges: [],
    },
    {
        haystack: "foo",
        needle: "foo",
        ranges: [{from: 1, to: 4, slice: '<"foo">'}],
    },
    {
        haystack: "foo bar foo",
        needle: "foo",
        ranges: [
            {from: 1, to: 4, slice: '<"foo">'},
            {from: 9, to: 12, slice: '<"foo">'},
        ],
    },
    {
        haystack: "foofoo",
        needle: "foo",
        ranges: [
            {from: 1, to: 4, slice: '<"foo">'},
            {from: 4, to: 7, slice: '<"foo">'},
        ],
    },
    {
        haystack: "foo bar",
        needle: "baz",
        ranges: [],
    },
    {
        haystack: "abx abc",
        needle: "abc",
        ranges: [{from: 5, to: 8, slice: '<"abc">'}],
    },
    {
        haystack: "foo\n\nbar",
        needle: "bar",
        ranges: [{from: 6, to: 9, slice: '<"bar">'}],
    },
    {
        haystack: "foo\n\nbar",
        needle: "foo\n\nbar",
        ranges: [{from: 1, to: 9, slice: '<paragraph("foo"), paragraph("bar")>'}],
    },
    {
        haystack: "qux\n\nfoo\n\nbar",
        needle: "foo\n\nbar",
        ranges: [{from: 6, to: 14, slice: '<paragraph("foo"), paragraph("bar")>'}],
    },
    {
        haystack: "qux\n\nfoo\n\nbar",
        needle: "qux\n\nfoo\n\nbar",
        ranges: [
            {from: 1, to: 14, slice: '<paragraph("qux"), paragraph("foo"), paragraph("bar")>'},
        ],
    },
    {
        haystack: "qux\n\nfoo\n\nbar",
        needle: "qux\n\nfoo",
        ranges: [{from: 1, to: 9, slice: '<paragraph("qux"), paragraph("foo")>'}],
    },
    {
        haystack: "foobar",
        needle: "foo\n\nbar",
        ranges: [],
    },
    {
        haystack: "foo\n\nbar",
        needle: "foobar",
        ranges: [],
    },
    {
        haystack: "qux\n\nfoobar",
        needle: "qux\n\nfoo\n\nbar",
        ranges: [],
    },
    {
        haystack: "qux\n\nfoo\n\nbar",
        needle: "qux\n\nfoobar",
        ranges: [],
    },
    {
        haystack: "foo\n\nbar",
        needle: "foo bar",
        ranges: [],
    },
    {
        haystack: "foo bar",
        needle: "foo\n\nbar",
        ranges: [],
    },
    {
        haystack: "foo bar",
        needle: "foo bar baz",
        ranges: [],
    },
    {
        haystack: "foo<br/>bar",
        needle: "<br/>",
        ranges: [{from: 4, to: 5, slice: "<break>"}],
    },
    {
        haystack: "foo<br/>bar",
        needle: "foo<br/>bar",
        ranges: [{from: 1, to: 8, slice: '<"foo", break, "bar">'}],
    },
    {
        haystack: "foo**<br/>**bar",
        needle: "**<br/>**",
        ranges: [{from: 4, to: 5, slice: "<bold(break)>"}],
    },
    {
        haystack: "foo**<br/>**bar",
        needle: "<br/>",
        ranges: [],
    },
    {
        haystack: "foo<br/>bar",
        needle: "**<br/>**",
        ranges: [],
    },
    {
        haystack: "**bold** plain **bold**",
        needle: "**bold**",
        ranges: [
            {from: 1, to: 5, slice: '<bold("bold")>'},
            {from: 12, to: 16, slice: '<bold("bold")>'},
        ],
    },
    {
        haystack: "**bold** plain",
        needle: "bold",
        ranges: [],
    },
    {
        haystack: "bold plain",
        needle: "**bold**",
        ranges: [],
    },
    {
        haystack: "**bold**",
        needle: "<strong>bold</strong>",
        ranges: [{from: 1, to: 5, slice: '<bold("bold")>'}],
    },
    {
        haystack: "***both***",
        needle: "**_both_**",
        ranges: [{from: 1, to: 5, slice: '<bold(italic("both"))>'}],
    },
    {
        haystack: "[link](https://example.com) [link](https://other.com)",
        needle: "[link](https://example.com)",
        ranges: [{from: 1, to: 5, slice: '<link("link")>'}],
    },
    {
        haystack: "[link](https://example.com)",
        needle: "[link](https://other.com)",
        ranges: [],
    },
    {
        haystack: "~~gone~~",
        needle: "~~gone~~",
        ranges: [{from: 1, to: 5, slice: '<strike("gone")>'}],
    },
    {
        haystack: "`code`",
        needle: "`code`",
        ranges: [{from: 1, to: 5, slice: '<code("code")>'}],
    },
    {
        haystack: "<mark>highlighted</mark>",
        needle: "<mark>highlighted</mark>",
        ranges: [{from: 1, to: 12, slice: '<highlight("highlighted")>'}],
    },
    {
        haystack: '<mark class="highlight-red">highlighted</mark>',
        needle: "<mark>highlighted</mark>",
        ranges: [],
    },
    {
        haystack: '<mark class="highlight-blue">highlighted</mark>',
        needle: '<mark class="highlight-red">highlighted</mark>',
        ranges: [],
    },
    {
        haystack: "# foo bar",
        needle: "bar",
        ranges: [],
    },
    {
        haystack: "# foo bar",
        needle: "# bar",
        ranges: [{from: 5, to: 8, slice: '<"bar">'}],
    },
    {
        haystack: "# foo bar",
        needle: "## bar",
        ranges: [{from: 5, to: 8, slice: '<"bar">'}],
    },
    {
        haystack: "foo bar",
        needle: "# bar",
        ranges: [],
    },
    {
        haystack: "> foo bar",
        needle: "> baz",
        ranges: [],
    },
    {
        haystack: "foo bar",
        needle: "> bar",
        ranges: [],
    },
    {
        haystack: "7. foo bar qux",
        needle: "1. bar",
        ranges: [{from: 6, to: 9, slice: '<"bar">'}],
    },
    {
        haystack: "- parent\n  - nested item",
        needle: "nested",
        ranges: [{from: 12, to: 18, slice: '<"nested">'}],
    },
    {
        haystack: "- parent\n  - nested item",
        needle: "- nested",
        ranges: [{from: 12, to: 18, slice: '<"nested">'}],
    },
    {
        haystack: "- parent\n  - nested item",
        needle: "1. nested",
        ranges: [],
    },
    {
        haystack: "- parent\n  1. nested item",
        needle: "1. nested",
        ranges: [{from: 12, to: 18, slice: '<"nested">'}],
    },
    {
        haystack: "- parent\n  1. nested item",
        needle: "- nested",
        ranges: [],
    },
    {
        haystack: "1. parent\n   - nested item",
        needle: "- nested",
        ranges: [{from: 12, to: 18, slice: '<"nested">'}],
    },
    {
        haystack: "1. parent\n   - nested item",
        needle: "1. nested",
        ranges: [],
    },
    {
        haystack: "- [x] foo bar qux",
        needle: "- [x] bar",
        ranges: [{from: 6, to: 9, slice: '<"bar">'}],
    },
    {
        haystack: "- [ ] foo bar qux",
        needle: "bar",
        ranges: [{from: 6, to: 9, slice: '<"bar">'}],
    },
    {
        haystack: "- [ ] todo\n- [x] done",
        needle: "todo\n\ndone",
        ranges: [
            {
                from: 2,
                to: 14,
                slice: '<checkListItem(paragraph("todo")), checkListItem(paragraph("done"))>',
            },
        ],
    },
    {
        haystack: "hello [@alice](https://alpine.inc/mention/n93hre935d0yd7akahtrwcvv30?short)",
        needle: "[@alice](https://alpine.inc/mention/n93hre935d0yd7akahtrwcvv30?short)",
        ranges: [{from: 7, to: 8, slice: "<mention>"}],
    },
    {
        haystack: "hello [@alice](https://alpine.inc/mention/n93hre935d0yd7akahtrwcvv30?short)",
        needle: "[@alice](https://alpine.inc/mention/n93hre935d0yd7akahtrwcvv30)",
        ranges: [],
    },
    {
        haystack:
            "[Doc](https://alpine.inc/doc/d93hre935d0yd7akahtrwcvv30?mention) [Doc](https://alpine.inc/doc/d93hre935d0yd7akahtrwcvv31?mention)",
        needle: "[Doc](https://alpine.inc/doc/d93hre935d0yd7akahtrwcvv30?mention)",
        ranges: [{from: 1, to: 2, slice: "<mention>"}],
    },
    {
        haystack: "**[@alice](https://alpine.inc/mention/n93hre935d0yd7akahtrwcvv30?short)**",
        needle: "**[@alice](https://alpine.inc/mention/n93hre935d0yd7akahtrwcvv30?short)**",
        ranges: [{from: 1, to: 2, slice: "<bold(mention)>"}],
    },
    {
        haystack: "**[@alice](https://alpine.inc/mention/n93hre935d0yd7akahtrwcvv30?short)**",
        needle: "[@alice](https://alpine.inc/mention/n93hre935d0yd7akahtrwcvv30?short)",
        ranges: [],
    },
    {
        haystack: "aaaaa",
        needle: "aa",
        ranges: [
            {from: 1, to: 3, slice: '<"aa">'},
            {from: 3, to: 5, slice: '<"aa">'},
        ],
    },
];

for (const testCase of testCases) {
    const formatForTestTitle = (string: string) => {
        string = string.trim();
        if (string.length > 25) string = string.slice(0, 25) + "…";
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
