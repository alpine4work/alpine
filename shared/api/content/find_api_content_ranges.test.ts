/* eslint-disable cyberworlds/string-quotes */

import {
    ApiContentKeyDecoder,
    ApiContentKeyEncoder,
} from "~/shared/api/content/closed_source/api_content_key_encoder.js";
import {fromApiContent} from "~/shared/api/content/closed_source/from_api_content.js";
import {getApiContentPositionPos} from "~/shared/api/content/closed_source/get_api_content_position_pos.js";
import {intoApiContent} from "~/shared/api/content/closed_source/into_api_content.js";
import {findApiContentRanges} from "~/shared/api/content/find_api_content_ranges.js";
import {parseApiContentFromMarkdown} from "~/shared/api/content/parse_api_content_from_markdown.js";
import {DocumentContentProsemirrorSchema} from "~/shared/documents/document_content_schema.js";
import {CommitBlocker} from "~/shared/helpers/types/commit_blocker.js";
import {generateChronologicalId} from "~/shared/id/chronological_id.js";
import {generateId} from "~/shared/id/id.js";
import {FileId} from "~/shared/id/types/id_types.js";

const fileId1 = generateChronologicalId<FileId>();
const fileId2 = generateChronologicalId<FileId>();
const fileId3 = generateChronologicalId<FileId>();

const testCases: Array<{
    only?: CommitBlocker;
    name: string;
    haystack: string;
    needle: string;
    ranges: Array<{
        from: number;
        to: number;
        slice: string;
    }>;
}> = [
    {
        name: "find plain text in paragraph",
        haystack: "foo bar qux",
        needle: "bar",
        ranges: [{from: 5, to: 8, slice: '<"bar">'}],
    },
    {
        name: "find plain text inside quote",
        haystack: "> foo bar qux",
        needle: "bar",
        ranges: [{from: 6, to: 9, slice: '<"bar">'}],
    },
    {
        name: "find plain text inside quoted list",
        haystack: "> - foo bar qux",
        needle: "bar",
        ranges: [{from: 7, to: 10, slice: '<"bar">'}],
    },
    {
        name: "find quoted text inside quote",
        haystack: "> foo bar qux",
        needle: "> bar",
        ranges: [{from: 6, to: 9, slice: '<"bar">'}],
    },
    {
        name: "find list text inside quoted list",
        haystack: "> - foo bar qux",
        needle: "- bar",
        ranges: [{from: 7, to: 10, slice: '<"bar">'}],
    },
    {
        name: "find quoted list text inside quoted list",
        haystack: "> - foo bar qux",
        needle: "> - bar",
        ranges: [{from: 7, to: 10, slice: '<"bar">'}],
    },
    {
        name: "find plain text inside unordered list",
        haystack: "- foo bar qux",
        needle: "bar",
        ranges: [{from: 6, to: 9, slice: '<"bar">'}],
    },
    {
        name: "find unordered list text inside unordered list",
        haystack: "- foo bar qux",
        needle: "- bar",
        ranges: [{from: 6, to: 9, slice: '<"bar">'}],
    },
    {
        name: "reject ordered list text inside unordered list",
        haystack: "- foo bar qux",
        needle: "1. bar",
        ranges: [],
    },
    {
        name: "find ordered list text inside ordered list",
        haystack: "1. foo bar qux",
        needle: "1. bar",
        ranges: [{from: 6, to: 9, slice: '<"bar">'}],
    },
    {
        name: "find open checklist item text",
        haystack: "- [ ] foo bar qux",
        needle: "- [ ] bar",
        ranges: [{from: 6, to: 9, slice: '<"bar">'}],
    },
    {
        name: "reject open checklist item text in checked item",
        haystack: "- [x] foo bar qux",
        needle: "- [ ] bar",
        ranges: [],
    },
    {
        name: "reject text in empty document",
        haystack: "",
        needle: "foo",
        ranges: [],
    },
    {
        name: "reject empty needle",
        haystack: "foo",
        needle: "",
        ranges: [],
    },
    {
        name: "find whole paragraph text",
        haystack: "foo",
        needle: "foo",
        ranges: [{from: 1, to: 4, slice: '<"foo">'}],
    },
    {
        name: "find repeated paragraph text",
        haystack: "foo bar foo",
        needle: "foo",
        ranges: [
            {from: 1, to: 4, slice: '<"foo">'},
            {from: 9, to: 12, slice: '<"foo">'},
        ],
    },
    {
        name: "find adjacent repeated text",
        haystack: "foofoo",
        needle: "foo",
        ranges: [
            {from: 1, to: 4, slice: '<"foo">'},
            {from: 4, to: 7, slice: '<"foo">'},
        ],
    },
    {
        name: "reject missing paragraph text",
        haystack: "foo bar",
        needle: "baz",
        ranges: [],
    },
    {
        name: "find text after partial mismatch",
        haystack: "abx abc",
        needle: "abc",
        ranges: [{from: 5, to: 8, slice: '<"abc">'}],
    },
    {
        name: "find text after paragraph break",
        haystack: "foo\n\nbar",
        needle: "bar",
        ranges: [{from: 6, to: 9, slice: '<"bar">'}],
    },
    {
        name: "find paragraphs across break",
        haystack: "foo\n\nbar",
        needle: "foo\n\nbar",
        ranges: [{from: 1, to: 9, slice: '<paragraph("foo"), paragraph("bar")>'}],
    },
    {
        name: "find paragraph sequence after prefix",
        haystack: "qux\n\nfoo\n\nbar",
        needle: "foo\n\nbar",
        ranges: [{from: 6, to: 14, slice: '<paragraph("foo"), paragraph("bar")>'}],
    },
    {
        name: "find whole multi paragraph document",
        haystack: "qux\n\nfoo\n\nbar",
        needle: "qux\n\nfoo\n\nbar",
        ranges: [
            {from: 1, to: 14, slice: '<paragraph("qux"), paragraph("foo"), paragraph("bar")>'},
        ],
    },
    {
        name: "find leading paragraphs from document",
        haystack: "qux\n\nfoo\n\nbar",
        needle: "qux\n\nfoo",
        ranges: [{from: 1, to: 9, slice: '<paragraph("qux"), paragraph("foo")>'}],
    },
    {
        name: "reject paragraph break inside joined text",
        haystack: "foobar",
        needle: "foo\n\nbar",
        ranges: [],
    },
    {
        name: "reject joined text across paragraph break",
        haystack: "foo\n\nbar",
        needle: "foobar",
        ranges: [],
    },
    {
        name: "reject split needle against joined suffix",
        haystack: "qux\n\nfoobar",
        needle: "qux\n\nfoo\n\nbar",
        ranges: [],
    },
    {
        name: "reject joined needle against split suffix",
        haystack: "qux\n\nfoo\n\nbar",
        needle: "qux\n\nfoobar",
        ranges: [],
    },
    {
        name: "reject space needle across paragraph break",
        haystack: "foo\n\nbar",
        needle: "foo bar",
        ranges: [],
    },
    {
        name: "reject paragraph break needle across space",
        haystack: "foo bar",
        needle: "foo\n\nbar",
        ranges: [],
    },
    {
        name: "reject overlong text needle",
        haystack: "foo bar",
        needle: "foo bar baz",
        ranges: [],
    },
    {
        name: "find hard break inline element",
        haystack: "foo<br/>bar",
        needle: "<br/>",
        ranges: [{from: 4, to: 5, slice: "<break>"}],
    },
    {
        name: "find text surrounding hard break",
        haystack: "foo<br/>bar",
        needle: "foo<br/>bar",
        ranges: [{from: 1, to: 8, slice: '<"foo", break, "bar">'}],
    },
    {
        name: "find bold hard break",
        haystack: "foo**<br/>**bar",
        needle: "**<br/>**",
        ranges: [{from: 4, to: 5, slice: "<bold(break)>"}],
    },
    {
        name: "find unformatted break in bold break",
        haystack: "foo**<br/>**bar",
        needle: "<br/>",
        ranges: [{from: 4, to: 5, slice: "<bold(break)>"}],
    },
    {
        name: "find bold break in plain break",
        haystack: "foo<br/>bar",
        needle: "**<br/>**",
        ranges: [{from: 4, to: 5, slice: "<break>"}],
    },
    {
        name: "find bold text occurrences",
        haystack: "**bold** plain **bold**",
        needle: "**bold**",
        ranges: [
            {from: 1, to: 5, slice: '<bold("bold")>'},
            {from: 12, to: 16, slice: '<bold("bold")>'},
        ],
    },
    {
        name: "find plain text inside bold text",
        haystack: "**foo bar qux**",
        needle: "bar",
        ranges: [{from: 5, to: 8, slice: '<bold("bar")>'}],
    },
    {
        name: "find plain text against bold mark",
        haystack: "**bold** plain",
        needle: "bold",
        ranges: [{from: 1, to: 5, slice: '<bold("bold")>'}],
    },
    {
        name: "reject bold text against plain mark",
        haystack: "bold plain",
        needle: "**bold**",
        ranges: [],
    },
    {
        name: "find html strong text",
        haystack: "**bold**",
        needle: "<strong>bold</strong>",
        ranges: [{from: 1, to: 5, slice: '<bold("bold")>'}],
    },
    {
        name: "find nested bold italic text",
        haystack: "***both***",
        needle: "**_both_**",
        ranges: [{from: 1, to: 5, slice: '<bold(italic("both"))>'}],
    },
    {
        name: "find italic text against bold italic marks",
        haystack: "***both***",
        needle: "_both_",
        ranges: [{from: 1, to: 5, slice: '<bold(italic("both"))>'}],
    },
    {
        name: "find matching link mark",
        haystack: "[link](https://example.com) [link](https://other.com)",
        needle: "[link](https://example.com)",
        ranges: [{from: 1, to: 5, slice: '<link("link")>'}],
    },
    {
        name: "reject mismatched link mark",
        haystack: "[link](https://example.com)",
        needle: "[link](https://other.com)",
        ranges: [],
    },
    {
        name: "find strike text",
        haystack: "~~gone~~",
        needle: "~~gone~~",
        ranges: [{from: 1, to: 5, slice: '<strike("gone")>'}],
    },
    {
        name: "find code mark text",
        haystack: "`code`",
        needle: "`code`",
        ranges: [{from: 1, to: 5, slice: '<code("code")>'}],
    },
    {
        name: "find highlight text",
        haystack: "<mark>highlighted</mark>",
        needle: "<mark>highlighted</mark>",
        ranges: [{from: 1, to: 12, slice: '<highlight("highlighted")>'}],
    },
    {
        name: "reject highlight without matching color",
        haystack: '<mark class="highlight-red">highlighted</mark>',
        needle: "<mark>highlighted</mark>",
        ranges: [],
    },
    {
        name: "reject mismatched highlight color",
        haystack: '<mark class="highlight-blue">highlighted</mark>',
        needle: '<mark class="highlight-red">highlighted</mark>',
        ranges: [],
    },
    {
        name: "find plain text in heading",
        haystack: "# foo bar",
        needle: "bar",
        ranges: [{from: 5, to: 8, slice: '<"bar">'}],
    },
    {
        name: "find heading tail through paragraph",
        haystack: "# foo bar\n\nqux",
        needle: "bar\n\nqux",
        ranges: [{from: 5, to: 13, slice: '<heading("bar"), paragraph("qux")>'}],
    },
    {
        name: "find same level heading text",
        haystack: "# foo bar",
        needle: "# bar",
        ranges: [{from: 5, to: 8, slice: '<"bar">'}],
    },
    {
        name: "find different level heading text",
        haystack: "# foo bar",
        needle: "## bar",
        ranges: [{from: 5, to: 8, slice: '<"bar">'}],
    },
    {
        name: "reject heading text in paragraph",
        haystack: "foo bar",
        needle: "# bar",
        ranges: [],
    },
    {
        name: "reject missing text in quote",
        haystack: "> foo bar",
        needle: "> baz",
        ranges: [],
    },
    {
        name: "reject quote structure in paragraph",
        haystack: "foo bar",
        needle: "> bar",
        ranges: [],
    },
    {
        name: "ignore ordered list start number",
        haystack: "7. foo bar qux",
        needle: "1. bar",
        ranges: [{from: 6, to: 9, slice: '<"bar">'}],
    },
    {
        name: "find nested unordered text",
        haystack: "- parent\n  - nested item",
        needle: "nested",
        ranges: [{from: 12, to: 18, slice: '<"nested">'}],
    },
    {
        name: "find nested unordered item",
        haystack: "- parent\n  - nested item",
        needle: "- nested",
        ranges: [{from: 12, to: 18, slice: '<"nested">'}],
    },
    {
        name: "reject ordered needle in unordered nested list",
        haystack: "- parent\n  - nested item",
        needle: "1. nested",
        ranges: [],
    },
    {
        name: "find nested ordered item",
        haystack: "- parent\n  1. nested item",
        needle: "1. nested",
        ranges: [{from: 12, to: 18, slice: '<"nested">'}],
    },
    {
        name: "reject unordered needle in ordered nested list",
        haystack: "- parent\n  1. nested item",
        needle: "- nested",
        ranges: [],
    },
    {
        name: "find unordered child inside ordered parent",
        haystack: "1. parent\n   - nested item",
        needle: "- nested",
        ranges: [{from: 12, to: 18, slice: '<"nested">'}],
    },
    {
        name: "reject ordered child inside unordered parent",
        haystack: "1. parent\n   - nested item",
        needle: "1. nested",
        ranges: [],
    },
    {
        name: "find checked checklist item text",
        haystack: "- [x] foo bar qux",
        needle: "- [x] bar",
        ranges: [{from: 6, to: 9, slice: '<"bar">'}],
    },
    {
        name: "find plain text inside open checklist",
        haystack: "- [ ] foo bar qux",
        needle: "bar",
        ranges: [{from: 6, to: 9, slice: '<"bar">'}],
    },
    {
        name: "reject text spanning checklist items",
        haystack: "- [ ] todo\n- [x] done",
        needle: "todo\n\ndone",
        ranges: [],
    },
    {
        name: "find account short mention",
        haystack: "hello [@alice](https://alpine.inc/mention/n93hre935d0yd7akahtrwcvv30#short)",
        needle: "[@alice](https://alpine.inc/mention/n93hre935d0yd7akahtrwcvv30#short)",
        ranges: [{from: 7, to: 8, slice: "<mention>"}],
    },
    {
        name: "reject account mention shortness mismatch",
        haystack: "hello [@alice](https://alpine.inc/mention/n93hre935d0yd7akahtrwcvv30#short)",
        needle: "[@alice](https://alpine.inc/mention/n93hre935d0yd7akahtrwcvv30)",
        ranges: [],
    },
    {
        name: "find document mention",
        haystack:
            "[Doc](https://alpine.inc/doc/d93hre935d0yd7akahtrwcvv30#mention) [Doc](https://alpine.inc/doc/d93hre935d0yd7akahtrwcvv31#mention)",
        needle: "[Doc](https://alpine.inc/doc/d93hre935d0yd7akahtrwcvv30#mention)",
        ranges: [{from: 1, to: 2, slice: "<mention>"}],
    },
    {
        name: "find bold account mention",
        haystack: "**[@alice](https://alpine.inc/mention/n93hre935d0yd7akahtrwcvv30#short)**",
        needle: "**[@alice](https://alpine.inc/mention/n93hre935d0yd7akahtrwcvv30#short)**",
        ranges: [{from: 1, to: 2, slice: "<bold(mention)>"}],
    },
    {
        name: "find plain account mention against bold mention",
        haystack: "**[@alice](https://alpine.inc/mention/n93hre935d0yd7akahtrwcvv30#short)**",
        needle: "[@alice](https://alpine.inc/mention/n93hre935d0yd7akahtrwcvv30#short)",
        ranges: [{from: 1, to: 2, slice: "<bold(mention)>"}],
    },
    {
        name: "find code block fragment",
        haystack: "<pre><code>foo bar qux</code></pre>",
        needle: "<pre><code>bar</code></pre>",
        ranges: [{from: 6, to: 9, slice: '<"bar">'}],
    },
    {
        name: "find repeated code block fragment",
        haystack: "<pre><code>bar bar</code></pre>",
        needle: "<pre><code>bar</code></pre>",
        ranges: [
            {from: 2, to: 5, slice: '<"bar">'},
            {from: 6, to: 9, slice: '<"bar">'},
        ],
    },
    {
        name: "find text in single line code block",
        haystack: "<pre><code>foo bar qux</code></pre>",
        needle: "bar",
        ranges: [{from: 6, to: 9, slice: '<"bar">'}],
    },
    {
        name: "find text in code block",
        haystack: "<pre><code>\n\nfoo bar qux\n\n</code></pre>",
        needle: "bar",
        ranges: [{from: 8, to: 11, slice: '<"bar">'}],
    },
    {
        name: "find formatted text in code block",
        haystack: "<pre><code>\n\nfoo *bar* qux\n\n</code></pre>",
        needle: "*bar*",
        // Our heuristic that tries to treat `Paragraph` block as valid text for a `Code`
        // block unfortunately doesn't work in all cases.
        ranges: [],
    },
    {
        name: "find html formatted text in code block",
        haystack: "<pre><code>\n\nfoo <em>bar</em> qux\n\n</code></pre>",
        needle: "<em>bar</em>",
        ranges: [{from: 8, to: 11, slice: '<italic("bar")>'}],
    },
    {
        name: "reject code block needle in paragraph",
        haystack: "foo bar qux",
        needle: "<pre><code>bar</code></pre>",
        ranges: [],
    },
    {
        name: "reject inline code in code block",
        haystack: "<pre><code>bar</code></pre>",
        needle: "`bar`",
        ranges: [],
    },
    {
        name: "reject code block needle in inline code",
        haystack: "`bar`",
        needle: "<pre><code>bar</code></pre>",
        ranges: [],
    },
    {
        name: "find code block with matching language",
        haystack: '<pre><code class="language-python">bar</code></pre>',
        needle: '<pre><code class="language-python">bar</code></pre>',
        ranges: [{from: 2, to: 5, slice: '<"bar">'}],
    },
    {
        name: "reject code block language mismatch",
        haystack: '<pre><code class="language-javascript">bar</code></pre>',
        needle: '<pre><code class="language-python">bar</code></pre>',
        ranges: [],
    },
    {
        name: "find trailing code block lines",
        haystack: "<pre><code>foo\nbar\nqux</code></pre>",
        needle: "<pre><code>bar\nqux</code></pre>",
        ranges: [{from: 7, to: 15, slice: '<codeBlockLine("bar"), codeBlockLine("qux")>'}],
    },
    {
        name: "find leading code block lines",
        haystack: "<pre><code>foo\nbar\nqux</code></pre>",
        needle: "<pre><code>foo\nbar</code></pre>",
        ranges: [{from: 2, to: 10, slice: '<codeBlockLine("foo"), codeBlockLine("bar")>'}],
    },
    {
        name: "reject joined code text across lines",
        haystack: "<pre><code>foo\nbar</code></pre>",
        needle: "<pre><code>foobar</code></pre>",
        ranges: [],
    },
    {
        name: "reject split code text against joined line",
        haystack: "<pre><code>foobar</code></pre>",
        needle: "<pre><code>foo\nbar</code></pre>",
        ranges: [],
    },
    {
        name: "find code block with empty middle line",
        haystack: "<pre><code>foo\n\nbar</code></pre>",
        needle: "<pre><code>foo\n\nbar</code></pre>",
        ranges: [
            {
                from: 2,
                to: 12,
                slice: '<codeBlockLine("foo"), codeBlockLine, codeBlockLine("bar")>',
            },
        ],
    },
    {
        name: "reject missing empty code line",
        haystack: "<pre><code>foo\n\nbar</code></pre>",
        needle: "<pre><code>foo\nbar</code></pre>",
        ranges: [],
    },
    {
        name: "reject extra empty code line",
        haystack: "<pre><code>foo\nbar</code></pre>",
        needle: "<pre><code>foo\n\nbar</code></pre>",
        ranges: [],
    },
    {
        name: "reject empty code block needle",
        haystack: "<pre><code>foo</code></pre>",
        needle: "<pre><code></code></pre>",
        ranges: [],
    },
    {
        name: "reject text code block in empty code block",
        haystack: "<pre><code></code></pre>",
        needle: "<pre><code>foo</code></pre>",
        ranges: [],
    },
    {
        name: "find bold text in code block",
        haystack: "<pre><code><strong>bar</strong></code></pre>",
        needle: "<pre><code><strong>bar</strong></code></pre>",
        ranges: [{from: 2, to: 5, slice: '<bold("bar")>'}],
    },
    {
        name: "find plain code text against bold mark",
        haystack: "<pre><code><strong>bar</strong></code></pre>",
        needle: "<pre><code>bar</code></pre>",
        ranges: [{from: 2, to: 5, slice: '<bold("bar")>'}],
    },
    {
        name: "reject bold code text against plain mark",
        haystack: "<pre><code>bar</code></pre>",
        needle: "<pre><code><strong>bar</strong></code></pre>",
        ranges: [],
    },
    {
        name: "find differently ordered nested code marks",
        haystack: "<pre><code><strong><em>both</em></strong></code></pre>",
        needle: "<pre><code><em><strong>both</strong></em></code></pre>",
        ranges: [{from: 2, to: 6, slice: '<bold(italic("both"))>'}],
    },
    {
        name: "find link mark in code block",
        haystack: '<pre><code><a href="https://example.com">link</a></code></pre>',
        needle: '<pre><code><a href="https://example.com">link</a></code></pre>',
        ranges: [{from: 2, to: 6, slice: '<link("link")>'}],
    },
    {
        name: "reject mismatched link in code block",
        haystack: '<pre><code><a href="https://example.com">link</a></code></pre>',
        needle: '<pre><code><a href="https://other.com">link</a></code></pre>',
        ranges: [],
    },
    {
        name: "find colored highlight in code block",
        haystack: '<pre><code><mark class="highlight-red">hot</mark></code></pre>',
        needle: '<pre><code><mark class="highlight-red">hot</mark></code></pre>',
        ranges: [{from: 2, to: 5, slice: '<highlight("hot")>'}],
    },
    {
        name: "reject uncolored highlight in code block",
        haystack: '<pre><code><mark class="highlight-red">hot</mark></code></pre>',
        needle: "<pre><code><mark>hot</mark></code></pre>",
        ranges: [],
    },
    {
        name: "find code block in repeated code blocks",
        haystack: "<pre><code>bar</code></pre>\n\n<pre><code>bar</code></pre>",
        needle: "<pre><code>bar</code></pre>",
        ranges: [
            {from: 2, to: 5, slice: '<"bar">'},
            {from: 9, to: 12, slice: '<"bar">'},
        ],
    },
    {
        name: "find paragraph followed by code block",
        haystack: "foo\n\n<pre><code>bar</code></pre>\n\nqux",
        needle: "foo\n\n<pre><code>bar</code></pre>",
        ranges: [
            {
                from: 1,
                to: 10,
                slice: '<paragraph("foo"), codeBlock(codeBlockLine("bar"))>',
            },
        ],
    },
    {
        name: "find code block followed by paragraph",
        haystack: "foo\n\n<pre><code>bar</code></pre>\n\nqux",
        needle: "<pre><code>bar</code></pre>\n\nqux",
        ranges: [
            {
                from: 7,
                to: 16,
                slice: '<codeBlock(codeBlockLine("bar")), paragraph("qux")>',
            },
        ],
    },
    {
        name: "find divider block",
        haystack: "---",
        needle: "---",
        ranges: [{from: 0, to: 1, slice: "<divider>"}],
    },
    {
        name: "find divider between paragraphs",
        haystack: "before\n\n---\n\nafter",
        needle: "---",
        ranges: [{from: 8, to: 9, slice: "<divider>"}],
    },
    {
        name: "find document containing divider",
        haystack: "before\n\n---\n\nafter",
        needle: "before\n\n---\n\nafter",
        ranges: [
            {
                from: 1,
                to: 15,
                slice: '<paragraph("before"), divider, paragraph("after")>',
            },
        ],
    },
    {
        name: "find repeated divider blocks",
        haystack: "before\n\n---\n\nmiddle\n\n---\n\nafter",
        needle: "---",
        ranges: [
            {from: 8, to: 9, slice: "<divider>"},
            {from: 17, to: 18, slice: "<divider>"},
        ],
    },
    {
        name: "find matching file block",
        haystack: `![](https://alpine.inc/file/${fileId1}/content)`,
        needle: `![](https://alpine.inc/file/${fileId1}/content)`,
        ranges: [{from: 1, to: 2, slice: "<file>"}],
    },
    {
        name: "reject different file block",
        haystack: `![](https://alpine.inc/file/${fileId1}/content)`,
        needle: `![](https://alpine.inc/file/${fileId2}/content)`,
        ranges: [],
    },
    {
        name: "find file block between paragraphs",
        haystack: `before\n\n![](https://alpine.inc/file/${fileId1}/content)\n\nafter`,
        needle: `![](https://alpine.inc/file/${fileId1}/content)`,
        ranges: [{from: 9, to: 10, slice: "<file>"}],
    },
    {
        name: "find document around file block",
        haystack: `before text\n\n![](https://alpine.inc/file/${fileId1}/content)\n\nafter text`,
        needle: `before text\n\n![](https://alpine.inc/file/${fileId1}/content)\n\nafter text`,
        ranges: [
            {
                from: 1,
                to: 27,
                slice: '<paragraph("before text"), fileRow(file), paragraph("after text")>',
            },
        ],
    },
    {
        name: "find document with paired file blocks",
        haystack: `![](https://alpine.inc/file/${fileId1}/content)\n\nmiddle text\n\n![](https://alpine.inc/file/${fileId2}/content)`,
        needle: `![](https://alpine.inc/file/${fileId1}/content)\n\nmiddle text\n\n![](https://alpine.inc/file/${fileId2}/content)`,
        ranges: [
            {
                from: 1,
                to: 18,
                slice: '<fileRow(file), paragraph("middle text"), fileRow(file)>',
            },
        ],
    },
    {
        name: "reject markdown file rows against gallery",
        haystack: `\
before text

<div style="display: flex; align-items: stretch">
<img src="https://alpine.inc/file/${fileId1}/content" style="flex: 0 0 50%"/>
<img src="https://alpine.inc/file/${fileId2}/content" style="flex: 0 0 50%"/>
</div>

after text`,
        needle: `\
before text

![](https://alpine.inc/file/${fileId1}/content)

![](https://alpine.inc/file/${fileId2}/content)

after text`,
        ranges: [],
    },
    {
        name: "find file block followed by divider",
        haystack: `![](https://alpine.inc/file/${fileId1}/content)\n\n---\n\n![](https://alpine.inc/file/${fileId2}/content)`,
        needle: `![](https://alpine.inc/file/${fileId1}/content)\n\n---`,
        ranges: [{from: 1, to: 4, slice: "<fileRow(file), divider>"}],
    },
    {
        name: "find image markdown in gallery",
        haystack: `\
<div style="display: flex; align-items: stretch">
<img src="https://alpine.inc/file/${fileId1}/content" style="flex: 0 0 50%"/>
<img src="https://alpine.inc/file/${fileId2}/content" style="flex: 0 0 50%"/>
</div>`,
        needle: `![](https://alpine.inc/file/${fileId2}/content)`,
        ranges: [{from: 2, to: 3, slice: "<file>"}],
    },
    {
        name: "find styled image html in gallery",
        haystack: `\
<div style="display: flex; align-items: stretch">
<img src="https://alpine.inc/file/${fileId1}/content" style="flex: 0 0 50%"/>
<img src="https://alpine.inc/file/${fileId2}/content" style="flex: 0 0 50%"/>
</div>`,
        needle: `<img src="https://alpine.inc/file/${fileId2}/content" style="flex: 0 0 50%"/>`,
        ranges: [{from: 2, to: 3, slice: "<file>"}],
    },
    {
        name: "find bare image html in gallery",
        haystack: `\
<div style="display: flex; align-items: stretch">
<img src="https://alpine.inc/file/${fileId1}/content" style="flex: 0 0 50%"/>
<img src="https://alpine.inc/file/${fileId2}/content" style="flex: 0 0 50%"/>
</div>`,
        needle: `<img src="https://alpine.inc/file/${fileId2}/content"/>`,
        ranges: [{from: 2, to: 3, slice: "<file>"}],
    },
    {
        name: "find trailing gallery items",
        haystack: `\
<div style="display: flex; align-items: stretch">
<img src="https://alpine.inc/file/${fileId1}/content" style="flex: 0 0 33%"/>
<img src="https://alpine.inc/file/${fileId2}/content" style="flex: 0 0 33%"/>
<img src="https://alpine.inc/file/${fileId3}/content" style="flex: 0 0 34%"/>
</div>`,
        needle: `\
<div style="display: flex; align-items: stretch">
<img src="https://alpine.inc/file/${fileId2}/content" style="flex: 0 0 50%"/>
<img src="https://alpine.inc/file/${fileId3}/content" style="flex: 0 0 50%"/>
</div>`,
        ranges: [{from: 2, to: 4, slice: "<file, file>"}],
    },
    {
        name: "reject gallery needle against separate file rows",
        haystack: `![](https://alpine.inc/file/${fileId1}/content)\n\n![](https://alpine.inc/file/${fileId2}/content)`,
        needle: `\
<div style="display: flex; align-items: stretch">
<img src="https://alpine.inc/file/${fileId1}/content" style="flex: 0 0 50%"/>
<img src="https://alpine.inc/file/${fileId2}/content" style="flex: 0 0 50%"/>
</div>`,
        ranges: [],
    },
    {
        name: "find later file row",
        haystack: `![](https://alpine.inc/file/${fileId1}/content)\n\n![](https://alpine.inc/file/${fileId2}/content)`,
        needle: `![](https://alpine.inc/file/${fileId2}/content)`,
        ranges: [{from: 4, to: 5, slice: "<file>"}],
    },
    {
        name: "reject separate file rows against gallery",
        haystack: `\
<div style="display: flex; align-items: stretch">
<img src="https://alpine.inc/file/${fileId1}/content" style="flex: 0 0 50%"/>
<img src="https://alpine.inc/file/${fileId2}/content" style="flex: 0 0 50%"/>
</div>`,
        needle: `![](https://alpine.inc/file/${fileId1}/content)\n\n![](https://alpine.inc/file/${fileId2}/content)`,
        ranges: [],
    },
    {
        name: "reject gallery subsequence with wrong tail",
        haystack: `\
some text

<div style="display: flex; align-items: stretch">
<img src="https://alpine.inc/file/${fileId1}/content" style="flex: 0 0 50%"/>
<img src="https://alpine.inc/file/${fileId2}/content" style="flex: 0 0 50%"/>
</div>

<div style="display: flex; align-items: stretch">
<img src="https://alpine.inc/file/${fileId3}/content" style="flex: 0 0 50%"/>
<img src="https://alpine.inc/file/${fileId1}/content" style="flex: 0 0 50%"/>
</div>

<div style="display: flex; align-items: stretch">
<img src="https://alpine.inc/file/${fileId2}/content" style="flex: 0 0 50%"/>
<img src="https://alpine.inc/file/${fileId3}/content" style="flex: 0 0 50%"/>
</div>

some more text`,
        needle: `\
some text

<div style="display: flex; align-items: stretch">
<img src="https://alpine.inc/file/${fileId1}/content" style="flex: 0 0 50%"/>
<img src="https://alpine.inc/file/${fileId2}/content" style="flex: 0 0 50%"/>
</div>

<div style="display: flex; align-items: stretch">
<img src="https://alpine.inc/file/${fileId3}/content" style="flex: 0 0 50%"/>
<img src="https://alpine.inc/file/${fileId1}/content" style="flex: 0 0 50%"/>
</div>

some more text`,
        ranges: [],
    },
    {
        name: "reject mixed gallery and file row sequence",
        haystack: `\
some text

<div style="display: flex; align-items: stretch">
<img src="https://alpine.inc/file/${fileId1}/content" style="flex: 0 0 33%"/>
<img src="https://alpine.inc/file/${fileId2}/content" style="flex: 0 0 33%"/>
<img src="https://alpine.inc/file/${fileId3}/content" style="flex: 0 0 34%"/>
</div>

some more text`,
        needle: `\
some text

<div style="display: flex; align-items: stretch">
<img src="https://alpine.inc/file/${fileId1}/content" style="flex: 0 0 50%"/>
<img src="https://alpine.inc/file/${fileId2}/content" style="flex: 0 0 50%"/>
</div>

![](https://alpine.inc/file/${fileId3}/content)

some more text`,
        ranges: [],
    },
    {
        name: "find markdown file inside float",
        haystack: `\
<div style="float: left; clear: both">
<img src="https://alpine.inc/file/${fileId1}/content"/>
</div>`,
        needle: `![](https://alpine.inc/file/${fileId1}/content)`,
        ranges: [{from: 1, to: 2, slice: "<file>"}],
    },
    {
        name: "find image html inside float",
        haystack: `\
<div style="float: left; clear: both">
<img src="https://alpine.inc/file/${fileId1}/content"/>
</div>`,
        needle: `<img src="https://alpine.inc/file/${fileId1}/content"/>`,
        ranges: [{from: 1, to: 2, slice: "<file>"}],
    },
    {
        name: "find matching file float",
        haystack: `\
<div style="float: left; clear: both">
<img src="https://alpine.inc/file/${fileId1}/content"/>
</div>`,
        needle: `\
<div style="float: left; clear: both">
<img src="https://alpine.inc/file/${fileId1}/content"/>
</div>`,
        ranges: [{from: 1, to: 2, slice: "<file>"}],
    },
    {
        name: "reject opposite file float side",
        haystack: `\
<div style="float: left; clear: both">
<img src="https://alpine.inc/file/${fileId1}/content"/>
</div>`,
        needle: `\
<div style="float: right; clear: both">
<img src="https://alpine.inc/file/${fileId1}/content"/>
</div>`,
        ranges: [],
    },
    {
        name: "reject float needle against gallery",
        haystack: `\
<div style="display: flex; align-items: stretch">
<img src="https://alpine.inc/file/${fileId1}/content" style="flex: 0 0 50%"/>
<img src="https://alpine.inc/file/${fileId2}/content" style="flex: 0 0 50%"/>
</div>`,
        needle: `\
<div style="float: left; clear: both">
<img src="https://alpine.inc/file/${fileId1}/content"/>
</div>`,
        ranges: [],
    },
    {
        name: "find repeated file across float and gallery",
        haystack: `\
<div style="float: left; clear: both">
<img src="https://alpine.inc/file/${fileId1}/content"/>
</div>

<div style="display: flex; align-items: stretch">
<img src="https://alpine.inc/file/${fileId1}/content" style="flex: 0 0 50%"/>
<img src="https://alpine.inc/file/${fileId2}/content" style="flex: 0 0 50%"/>
</div>`,
        needle: `![](https://alpine.inc/file/${fileId1}/content)`,
        ranges: [
            {from: 1, to: 2, slice: "<file>"},
            {from: 4, to: 5, slice: "<file>"},
        ],
    },
    {
        name: "find text in markdown table cell",
        haystack: `\
| First | Second |
| --- | --- |
| Alpha target | Beta |`,
        needle: "target",
        ranges: [{from: 31, to: 37, slice: '<"target">'}],
    },
    {
        name: "find full markdown table inside document",
        haystack: `\
Before

| Name | Status |
| --- | --- |
| Alpha | Done |
| Beta | Todo |

After`,
        needle: `\
| Name | Status |
| --- | --- |
| Alpha | Done |
| Beta | Todo |`,
        ranges: [
            {
                from: 12,
                to: 63,
                slice: '<tableRow(tableCell(paragraph("Name")), tableCell(paragraph("Status"))), tableRow(tableCell(paragraph("Alpha")), tableCell(paragraph("Done"))), tableRow(tableCell(paragraph("Beta")), tableCell(paragraph("Todo")))>',
            },
        ],
    },
    {
        name: "find leading markdown table rows",
        haystack: `\
| Name | Status |
| --- | --- |
| Alpha | Done |
| Beta | Todo |`,
        needle: `\
| Name | Status |
| --- | --- |
| Alpha | Done |`,
        ranges: [
            {
                from: 4,
                to: 37,
                slice: '<tableRow(tableCell(paragraph("Name")), tableCell(paragraph("Status"))), tableRow(tableCell(paragraph("Alpha")), tableCell(paragraph("Done")))>',
            },
        ],
    },
    {
        name: "reject separated cell text as paragraphs",
        haystack: `\
| First | Second |
| --- | --- |
| Alpha | Beta |`,
        needle: `\
Alpha

Beta`,
        ranges: [],
    },
    {
        name: "find multiple paragraphs inside html table cell",
        haystack: `\
<table>
<tbody>
<tr>
<td>

First paragraph

Second paragraph

</td>
<td>

Other cell

</td>
</tr>
</tbody>
</table>`,
        needle: `\
First paragraph

Second paragraph`,
        ranges: [
            {
                from: 4,
                to: 37,
                slice: '<paragraph("First paragraph"), paragraph("Second paragraph")>',
            },
        ],
    },
    {
        name: "find quoted text inside html table cell",
        haystack: `\
<table>
<tbody>
<tr>
<td>

> quoted target

</td>
<td>

Other cell

</td>
</tr>
</tbody>
</table>`,
        needle: "> quoted target",
        ranges: [{from: 5, to: 18, slice: '<"quoted target">'}],
    },
    {
        name: "find list item inside html table cell",
        haystack: `\
<table>
<tbody>
<tr>
<td>

- first item
- second item

</td>
<td>

Other cell

</td>
</tr>
</tbody>
</table>`,
        needle: "- second item",
        ranges: [{from: 19, to: 30, slice: '<"second item">'}],
    },
    {
        name: "find checked task inside html table cell",
        haystack: `\
<table>
<tbody>
<tr>
<td>

- [ ] open task
- [x] done task

</td>
<td>

Other cell

</td>
</tr>
</tbody>
</table>`,
        needle: "- [x] done task",
        ranges: [{from: 18, to: 27, slice: '<"done task">'}],
    },
    {
        name: "reject unchecked task inside checked table cell",
        haystack: `\
<table>
<tbody>
<tr>
<td>

- [ ] open task
- [x] done task

</td>
<td>

Other cell

</td>
</tr>
</tbody>
</table>`,
        needle: "- [ ] done task",
        ranges: [],
    },
    {
        name: "find file inside html table cell",
        haystack: `\
<table>
<tbody>
<tr>
<td>

![](https://alpine.inc/file/${fileId1}/content)

</td>
<td>

Other cell

</td>
</tr>
</tbody>
</table>`,
        needle: `![](https://alpine.inc/file/${fileId1}/content)`,
        ranges: [{from: 4, to: 5, slice: "<file>"}],
    },
    {
        name: "find code block text inside html table cell",
        haystack: `\
<table>
<tbody>
<tr>
<td>

<pre><code>alpha
target
omega</code></pre>

</td>
<td>

Other cell

</td>
</tr>
</tbody>
</table>`,
        needle: "<pre><code>target</code></pre>",
        ranges: [{from: 12, to: 18, slice: '<"target">'}],
    },
    {
        name: "find full html table",
        haystack: `\
<table>
<thead>
<tr>
<th>

Name

</th>
<th>

Details

</th>
</tr>
</thead>
<tbody>
<tr>
<td>

Alpha

More alpha

</td>
<td>

- first detail
- second detail

</td>
</tr>
</tbody>
</table>`,
        needle: `\
<table>
<thead>
<tr>
<th>

Name

</th>
<th>

Details

</th>
</tr>
</thead>
<tbody>
<tr>
<td>

Alpha

More alpha

</td>
<td>

- first detail
- second detail

</td>
</tr>
</tbody>
</table>`,
        ranges: [
            {
                from: 4,
                to: 76,
                slice: '<tableRow(tableCell(paragraph("Name")), tableCell(paragraph("Details"))), tableRow(tableCell(paragraph("Alpha"), paragraph("More alpha")), tableCell(unorderedListItem(paragraph("first detail")), unorderedListItem(paragraph("second detail"))))>',
            },
        ],
    },
    {
        name: "find overlapping repeated text",
        haystack: "aaaaa",
        needle: "aa",
        ranges: [
            {from: 1, to: 3, slice: '<"aa">'},
            {from: 2, to: 4, slice: '<"aa">'},
            {from: 3, to: 5, slice: '<"aa">'},
            {from: 4, to: 6, slice: '<"aa">'},
        ],
    },
];

for (const testCase of testCases) {
    const test = testCase.only ? globalThis.test.only : globalThis.test;

    test(testCase.name, () => {
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
                const from = getApiContentPositionPos(decoder, range.start);
                const to = getApiContentPositionPos(decoder, range.end);

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
