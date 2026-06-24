/* eslint-disable cyberworlds/string-quotes */

import {
    ApiContentKeyDecoder,
    ApiContentKeyEncoder,
} from "~/shared/api/content/api_content_key_encoder.js";
import {fromApiContent} from "~/shared/api/content/from_api_content.js";
import {getApiContentPositionPos} from "~/shared/api/content/get_api_content_position_pos.js";
import {intoApiContent} from "~/shared/api/content/into_api_content.js";
import {findApiContentRanges} from "~/shared/api/markdown/find_api_content_ranges.js";
import {parseApiContentFromMarkdown} from "~/shared/api/markdown/parse_api_content_from_markdown.js";
import {DocumentContentProsemirrorSchema} from "~/shared/documents/document_content_schema.js";
import {quote} from "~/shared/helpers/string/quote.js";
import {CommitBlocker} from "~/shared/helpers/types/commit_blocker.js";
import {generateChronologicalId} from "~/shared/id/chronological_id.js";
import {generateId} from "~/shared/id/id.js";
import {FileId} from "~/shared/id/types/id_types.js";

const fileId1 = generateChronologicalId<FileId>();
const fileId2 = generateChronologicalId<FileId>();
const fileId3 = generateChronologicalId<FileId>();

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
        ranges: [{from: 4, to: 5, slice: "<bold(break)>"}],
    },
    {
        haystack: "foo<br/>bar",
        needle: "**<br/>**",
        ranges: [{from: 4, to: 5, slice: "<break>"}],
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
        ranges: [{from: 5, to: 8, slice: '<"bar">'}],
    },
    {
        haystack: "# foo bar\n\nqux",
        needle: "bar\n\nqux",
        ranges: [{from: 5, to: 13, slice: '<heading("bar"), paragraph("qux")>'}],
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
        ranges: [],
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
        haystack: "<pre><code>foo bar qux</code></pre>",
        needle: "<pre><code>bar</code></pre>",
        ranges: [{from: 6, to: 9, slice: '<"bar">'}],
    },
    {
        haystack: "<pre><code>bar bar</code></pre>",
        needle: "<pre><code>bar</code></pre>",
        ranges: [
            {from: 2, to: 5, slice: '<"bar">'},
            {from: 6, to: 9, slice: '<"bar">'},
        ],
    },
    {
        haystack: "<pre><code>foo bar qux</code></pre>",
        needle: "bar",
        ranges: [{from: 6, to: 9, slice: '<"bar">'}],
    },
    {
        haystack: "<pre><code>\n\nfoo bar qux\n\n</code></pre>",
        needle: "bar",
        ranges: [{from: 8, to: 11, slice: '<"bar">'}],
    },
    {
        haystack: "<pre><code>\n\nfoo *bar* qux\n\n</code></pre>",
        needle: "*bar*",
        // Our heuristic that tries to treat `Paragraph` block as valid text for a `Code`
        // block unfortunately doesn't work in all cases.
        ranges: [],
    },
    {
        haystack: "<pre><code>\n\nfoo <em>bar</em> qux\n\n</code></pre>",
        needle: "<em>bar</em>",
        ranges: [{from: 8, to: 11, slice: '<italic("bar")>'}],
    },
    {
        haystack: "foo bar qux",
        needle: "<pre><code>bar</code></pre>",
        ranges: [],
    },
    {
        haystack: "<pre><code>bar</code></pre>",
        needle: "`bar`",
        ranges: [],
    },
    {
        haystack: "`bar`",
        needle: "<pre><code>bar</code></pre>",
        ranges: [],
    },
    {
        haystack: '<pre><code class="language-python">bar</code></pre>',
        needle: '<pre><code class="language-python">bar</code></pre>',
        ranges: [{from: 2, to: 5, slice: '<"bar">'}],
    },
    {
        haystack: '<pre><code class="language-javascript">bar</code></pre>',
        needle: '<pre><code class="language-python">bar</code></pre>',
        ranges: [],
    },
    {
        haystack: "<pre><code>foo\nbar\nqux</code></pre>",
        needle: "<pre><code>bar\nqux</code></pre>",
        ranges: [{from: 7, to: 15, slice: '<codeBlockLine("bar"), codeBlockLine("qux")>'}],
    },
    {
        haystack: "<pre><code>foo\nbar\nqux</code></pre>",
        needle: "<pre><code>foo\nbar</code></pre>",
        ranges: [{from: 2, to: 10, slice: '<codeBlockLine("foo"), codeBlockLine("bar")>'}],
    },
    {
        haystack: "<pre><code>foo\nbar</code></pre>",
        needle: "<pre><code>foobar</code></pre>",
        ranges: [],
    },
    {
        haystack: "<pre><code>foobar</code></pre>",
        needle: "<pre><code>foo\nbar</code></pre>",
        ranges: [],
    },
    {
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
        haystack: "<pre><code>foo\n\nbar</code></pre>",
        needle: "<pre><code>foo\nbar</code></pre>",
        ranges: [],
    },
    {
        haystack: "<pre><code>foo\nbar</code></pre>",
        needle: "<pre><code>foo\n\nbar</code></pre>",
        ranges: [],
    },
    {
        haystack: "<pre><code>foo</code></pre>",
        needle: "<pre><code></code></pre>",
        ranges: [],
    },
    {
        haystack: "<pre><code></code></pre>",
        needle: "<pre><code>foo</code></pre>",
        ranges: [],
    },
    {
        haystack: "<pre><code><strong>bar</strong></code></pre>",
        needle: "<pre><code><strong>bar</strong></code></pre>",
        ranges: [{from: 2, to: 5, slice: '<bold("bar")>'}],
    },
    {
        haystack: "<pre><code><strong>bar</strong></code></pre>",
        needle: "<pre><code>bar</code></pre>",
        ranges: [],
    },
    {
        haystack: "<pre><code>bar</code></pre>",
        needle: "<pre><code><strong>bar</strong></code></pre>",
        ranges: [],
    },
    {
        haystack: "<pre><code><strong><em>both</em></strong></code></pre>",
        needle: "<pre><code><em><strong>both</strong></em></code></pre>",
        ranges: [{from: 2, to: 6, slice: '<bold(italic("both"))>'}],
    },
    {
        haystack: '<pre><code><a href="https://example.com">link</a></code></pre>',
        needle: '<pre><code><a href="https://example.com">link</a></code></pre>',
        ranges: [{from: 2, to: 6, slice: '<link("link")>'}],
    },
    {
        haystack: '<pre><code><a href="https://example.com">link</a></code></pre>',
        needle: '<pre><code><a href="https://other.com">link</a></code></pre>',
        ranges: [],
    },
    {
        haystack: '<pre><code><mark class="highlight-red">hot</mark></code></pre>',
        needle: '<pre><code><mark class="highlight-red">hot</mark></code></pre>',
        ranges: [{from: 2, to: 5, slice: '<highlight("hot")>'}],
    },
    {
        haystack: '<pre><code><mark class="highlight-red">hot</mark></code></pre>',
        needle: "<pre><code><mark>hot</mark></code></pre>",
        ranges: [],
    },
    {
        haystack: "<pre><code>bar</code></pre>\n\n<pre><code>bar</code></pre>",
        needle: "<pre><code>bar</code></pre>",
        ranges: [
            {from: 2, to: 5, slice: '<"bar">'},
            {from: 9, to: 12, slice: '<"bar">'},
        ],
    },
    {
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
        haystack: "---",
        needle: "---",
        ranges: [{from: 0, to: 1, slice: "<divider>"}],
    },
    {
        haystack: "before\n\n---\n\nafter",
        needle: "---",
        ranges: [{from: 8, to: 9, slice: "<divider>"}],
    },
    {
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
        haystack: "before\n\n---\n\nmiddle\n\n---\n\nafter",
        needle: "---",
        ranges: [
            {from: 8, to: 9, slice: "<divider>"},
            {from: 17, to: 18, slice: "<divider>"},
        ],
    },
    {
        haystack: `![](https://alpine.inc/file/${fileId1}/content)`,
        needle: `![](https://alpine.inc/file/${fileId1}/content)`,
        ranges: [{from: 1, to: 2, slice: "<file>"}],
    },
    {
        haystack: `![](https://alpine.inc/file/${fileId1}/content)`,
        needle: `![](https://alpine.inc/file/${fileId2}/content)`,
        ranges: [],
    },
    {
        haystack: `before\n\n![](https://alpine.inc/file/${fileId1}/content)\n\nafter`,
        needle: `![](https://alpine.inc/file/${fileId1}/content)`,
        ranges: [{from: 9, to: 10, slice: "<file>"}],
    },
    {
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
        haystack: `![](https://alpine.inc/file/${fileId1}/content)\n\n---\n\n![](https://alpine.inc/file/${fileId2}/content)`,
        needle: `![](https://alpine.inc/file/${fileId1}/content)\n\n---`,
        ranges: [{from: 1, to: 4, slice: "<fileRow(file), divider>"}],
    },
    {
        haystack: `\
<div style="display: flex; align-items: stretch">
<img src="https://alpine.inc/file/${fileId1}/content" style="flex: 0 0 50%"/>
<img src="https://alpine.inc/file/${fileId2}/content" style="flex: 0 0 50%"/>
</div>`,
        needle: `![](https://alpine.inc/file/${fileId2}/content)`,
        ranges: [{from: 2, to: 3, slice: "<file>"}],
    },
    {
        haystack: `\
<div style="display: flex; align-items: stretch">
<img src="https://alpine.inc/file/${fileId1}/content" style="flex: 0 0 50%"/>
<img src="https://alpine.inc/file/${fileId2}/content" style="flex: 0 0 50%"/>
</div>`,
        needle: `<img src="https://alpine.inc/file/${fileId2}/content" style="flex: 0 0 50%"/>`,
        ranges: [{from: 2, to: 3, slice: "<file>"}],
    },
    {
        haystack: `\
<div style="display: flex; align-items: stretch">
<img src="https://alpine.inc/file/${fileId1}/content" style="flex: 0 0 50%"/>
<img src="https://alpine.inc/file/${fileId2}/content" style="flex: 0 0 50%"/>
</div>`,
        needle: `<img src="https://alpine.inc/file/${fileId2}/content"/>`,
        ranges: [{from: 2, to: 3, slice: "<file>"}],
    },
    {
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
        haystack: `![](https://alpine.inc/file/${fileId1}/content)\n\n![](https://alpine.inc/file/${fileId2}/content)`,
        needle: `\
<div style="display: flex; align-items: stretch">
<img src="https://alpine.inc/file/${fileId1}/content" style="flex: 0 0 50%"/>
<img src="https://alpine.inc/file/${fileId2}/content" style="flex: 0 0 50%"/>
</div>`,
        ranges: [],
    },
    {
        haystack: `![](https://alpine.inc/file/${fileId1}/content)\n\n![](https://alpine.inc/file/${fileId2}/content)`,
        needle: `![](https://alpine.inc/file/${fileId2}/content)`,
        ranges: [{from: 4, to: 5, slice: "<file>"}],
    },
    {
        haystack: `\
<div style="display: flex; align-items: stretch">
<img src="https://alpine.inc/file/${fileId1}/content" style="flex: 0 0 50%"/>
<img src="https://alpine.inc/file/${fileId2}/content" style="flex: 0 0 50%"/>
</div>`,
        needle: `![](https://alpine.inc/file/${fileId1}/content)\n\n![](https://alpine.inc/file/${fileId2}/content)`,
        ranges: [],
    },
    {
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
        haystack: `\
<div style="float: left; clear: both">
<img src="https://alpine.inc/file/${fileId1}/content"/>
</div>`,
        needle: `![](https://alpine.inc/file/${fileId1}/content)`,
        ranges: [{from: 1, to: 2, slice: "<file>"}],
    },
    {
        haystack: `\
<div style="float: left; clear: both">
<img src="https://alpine.inc/file/${fileId1}/content"/>
</div>`,
        needle: `<img src="https://alpine.inc/file/${fileId1}/content"/>`,
        ranges: [{from: 1, to: 2, slice: "<file>"}],
    },
    {
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
        haystack: `\
| First | Second |
| --- | --- |
| Alpha target | Beta |`,
        needle: "target",
        ranges: [{from: 31, to: 37, slice: '<"target">'}],
    },
    {
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
