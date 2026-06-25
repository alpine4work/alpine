import {ApiContentKeyEncoder} from "~/shared/api/content/closed_source/api_content_key_encoder.js";
import {fromApiContent} from "~/shared/api/content/closed_source/from_api_content.js";
import {intoApiContent} from "~/shared/api/content/closed_source/into_api_content.js";
import {parseApiContentFromMarkdown} from "~/shared/api/content/parse_api_content_from_markdown.js";
import {printApiContentToMarkdown} from "~/shared/api/content/print_api_content_to_markdown.js";
import {sliceApiContentRange} from "~/shared/api/content/slice_api_content_range.js";
import {ApiContentPosition} from "~/shared/api/specification/types/api_content_position.js";
import {DocumentContentProsemirrorSchema} from "~/shared/documents/document_content_schema.js";
import {mapResult} from "~/shared/helpers/control/map_result.js";
import {CommitBlocker} from "~/shared/helpers/types/commit_blocker.js";
import {generateId} from "~/shared/id/id.js";

const testCases: Array<{
    only?: CommitBlocker;
    name: string;
    content: string;
    from: number;
    to: number;
    slice: string;
}> = [
    {
        name: "slice plain text in paragraph",
        content: "foo bar qux",
        from: 5,
        to: 8,
        slice: "bar",
    },
    {
        name: "slice plain text inside quote",
        content: "> foo bar qux",
        from: 6,
        to: 9,
        slice: "> bar",
    },
    {
        name: "slice plain text inside quoted list",
        content: "> - foo bar qux",
        from: 7,
        to: 10,
        slice: "> - bar",
    },
    {
        name: "slice quoted text inside quote",
        content: "> foo bar qux",
        from: 6,
        to: 9,
        slice: "> bar",
    },
    {
        name: "slice list text inside quoted list",
        content: "> - foo bar qux",
        from: 7,
        to: 10,
        slice: "> - bar",
    },
    {
        name: "slice quoted list text inside quoted list",
        content: "> - foo bar qux",
        from: 7,
        to: 10,
        slice: "> - bar",
    },
    {
        name: "slice plain text inside unordered list",
        content: "- foo bar qux",
        from: 6,
        to: 9,
        slice: "- bar",
    },
    {
        name: "slice unordered list text inside unordered list",
        content: "- foo bar qux",
        from: 6,
        to: 9,
        slice: "- bar",
    },
    {
        name: "slice ordered list text inside ordered list",
        content: "1. foo bar qux",
        from: 6,
        to: 9,
        slice: "1. bar",
    },
    {
        name: "slice open checklist item text",
        content: "- [ ] foo bar qux",
        from: 6,
        to: 9,
        slice: "- [ ] bar",
    },
    {
        name: "slice whole paragraph text",
        content: "foo",
        from: 1,
        to: 4,
        slice: "foo",
    },
    {
        name: "slice repeated paragraph text first match",
        content: "foo bar foo",
        from: 1,
        to: 4,
        slice: "foo",
    },
    {
        name: "slice repeated paragraph text second match",
        content: "foo bar foo",
        from: 9,
        to: 12,
        slice: "foo",
    },
    {
        name: "slice adjacent repeated text first match",
        content: "foofoo",
        from: 1,
        to: 4,
        slice: "foo",
    },
    {
        name: "slice adjacent repeated text second match",
        content: "foofoo",
        from: 4,
        to: 7,
        slice: "foo",
    },
    {
        name: "slice text after partial mismatch",
        content: "abx abc",
        from: 5,
        to: 8,
        slice: "abc",
    },
    {
        name: "slice text after paragraph break",
        content: `foo

bar`,
        from: 6,
        to: 9,
        slice: "bar",
    },
    {
        name: "slice paragraphs across break",
        content: `foo

bar`,
        from: 1,
        to: 9,
        slice: `foo

bar`,
    },
    {
        name: "slice paragraph sequence after prefix",
        content: `qux

foo

bar`,
        from: 6,
        to: 14,
        slice: `foo

bar`,
    },
    {
        name: "slice whole multi paragraph document",
        content: `qux

foo

bar`,
        from: 1,
        to: 14,
        slice: `qux

foo

bar`,
    },
    {
        name: "slice leading paragraphs from document",
        content: `qux

foo

bar`,
        from: 1,
        to: 9,
        slice: `qux

foo`,
    },
    {
        name: "slice hard break inline element",
        content: "foo<br/>bar",
        from: 4,
        to: 5,
        slice: "<br />",
    },
    {
        name: "slice text surrounding hard break",
        content: "foo<br/>bar",
        from: 1,
        to: 8,
        slice: `foo\\
bar`,
    },
    {
        name: "slice bold hard break",
        content: "foo**<br/>**bar",
        from: 4,
        to: 5,
        slice: "**<br />**",
    },
    {
        name: "slice plain hard break",
        content: "foo<br/>bar",
        from: 4,
        to: 5,
        slice: "<br />",
    },
    {
        name: "slice bold text occurrences first match",
        content: "**bold** plain **bold**",
        from: 1,
        to: 5,
        slice: "**bold**",
    },
    {
        name: "slice bold text occurrences second match",
        content: "**bold** plain **bold**",
        from: 12,
        to: 16,
        slice: "**bold**",
    },
    {
        name: "slice html strong text",
        content: "**bold**",
        from: 1,
        to: 5,
        slice: "**bold**",
    },
    {
        name: "slice nested bold italic text",
        content: "***both***",
        from: 1,
        to: 5,
        slice: "***both***",
    },
    {
        name: "slice matching link mark",
        content: "[link](https://example.com) [link](https://other.com)",
        from: 1,
        to: 5,
        slice: "[link](https://example.com)",
    },
    {
        name: "slice strike text",
        content: "~~gone~~",
        from: 1,
        to: 5,
        slice: "~~gone~~",
    },
    {
        name: "slice code mark text",
        content: "`code`",
        from: 1,
        to: 5,
        slice: "`code`",
    },
    {
        name: "slice highlight text",
        content: "<mark>highlighted</mark>",
        from: 1,
        to: 12,
        slice: '<mark class="highlight-orange">highlighted</mark>',
    },
    {
        name: "slice plain text in heading",
        content: "# foo bar",
        from: 5,
        to: 8,
        slice: "# bar",
    },
    {
        name: "slice heading tail through paragraph",
        content: `# foo bar

qux`,
        from: 5,
        to: 13,
        slice: `# bar

qux`,
    },
    {
        name: "slice same level heading text",
        content: "# foo bar",
        from: 5,
        to: 8,
        slice: "# bar",
    },
    {
        name: "slice different level heading text",
        content: "# foo bar",
        from: 5,
        to: 8,
        slice: "# bar",
    },
    {
        name: "ignore ordered list start number",
        content: "7. foo bar qux",
        from: 6,
        to: 9,
        slice: "7. bar",
    },
    {
        name: "slice nested unordered text",
        content: `- parent
  - nested item`,
        from: 12,
        to: 18,
        slice: "- - nested",
    },
    {
        name: "slice nested unordered item",
        content: `- parent
  - nested item`,
        from: 12,
        to: 18,
        slice: "- - nested",
    },
    {
        name: "slice nested ordered item",
        content: `- parent
  1. nested item`,
        from: 12,
        to: 18,
        slice: "- 1. nested",
    },
    {
        name: "slice unordered child inside ordered parent",
        content: `1. parent
   - nested item`,
        from: 12,
        to: 18,
        slice: `1. <p></p>

   - nested`,
    },
    {
        name: "slice checked checklist item text",
        content: "- [x] foo bar qux",
        from: 6,
        to: 9,
        slice: "- [x] bar",
    },
    {
        name: "slice plain text inside open checklist",
        content: "- [ ] foo bar qux",
        from: 6,
        to: 9,
        slice: "- [ ] bar",
    },
    {
        name: "slice account short mention",
        content: "hello [@alice](https://alpine.inc/mention/n93hre935d0yd7akahtrwcvv30?short)",
        from: 7,
        to: 8,
        slice: "[Unknown](https://alpine.inc/mention/n93hre935d0yd7akahtrwcvv30?short)",
    },
    {
        name: "slice document mention",
        content:
            "[Doc](https://alpine.inc/doc/d93hre935d0yd7akahtrwcvv30?mention) [Doc](https://alpine.inc/doc/d93hre935d0yd7akahtrwcvv31?mention)",
        from: 1,
        to: 2,
        slice: "[Unknown document](https://alpine.inc/doc/d93hre935d0yd7akahtrwcvv30?mention)",
    },
    {
        name: "slice bold account mention",
        content: "**[@alice](https://alpine.inc/mention/n93hre935d0yd7akahtrwcvv30?short)**",
        from: 1,
        to: 2,
        slice: "**[Unknown](https://alpine.inc/mention/n93hre935d0yd7akahtrwcvv30?short)**",
    },
    {
        name: "slice code block fragment",
        content: "<pre><code>foo bar qux</code></pre>",
        from: 6,
        to: 9,
        slice: `\`\`\`text
bar
\`\`\``,
    },
    {
        name: "slice repeated code block fragment first match",
        content: "<pre><code>bar bar</code></pre>",
        from: 2,
        to: 5,
        slice: `\`\`\`text
bar
\`\`\``,
    },
    {
        name: "slice repeated code block fragment second match",
        content: "<pre><code>bar bar</code></pre>",
        from: 6,
        to: 9,
        slice: `\`\`\`text
bar
\`\`\``,
    },
    {
        name: "slice text in single line code block",
        content: "<pre><code>foo bar qux</code></pre>",
        from: 6,
        to: 9,
        slice: `\`\`\`text
bar
\`\`\``,
    },
    {
        name: "slice text in code block",
        content: `<pre><code>

foo bar qux

</code></pre>`,
        from: 8,
        to: 11,
        slice: `\`\`\`text
bar
\`\`\``,
    },
    {
        name: "slice html formatted text in code block",
        content: `<pre><code>

foo <em>bar</em> qux

</code></pre>`,
        from: 8,
        to: 11,
        slice: `<pre>
<code class="language-text">
<em>bar</em>
</code>
</pre>`,
    },
    {
        name: "slice code block with matching language",
        content: '<pre><code class="language-python">bar</code></pre>',
        from: 2,
        to: 5,
        slice: `\`\`\`python
bar
\`\`\``,
    },
    {
        name: "slice trailing code block lines",
        content: `<pre><code>foo
bar
qux</code></pre>`,
        from: 7,
        to: 15,
        slice: `\`\`\`text
bar
qux
\`\`\``,
    },
    {
        name: "slice leading code block lines",
        content: `<pre><code>foo
bar
qux</code></pre>`,
        from: 2,
        to: 10,
        slice: `\`\`\`text
foo
bar
\`\`\``,
    },
    {
        name: "slice code block with empty middle line",
        content: `<pre><code>foo

bar</code></pre>`,
        from: 2,
        to: 12,
        slice: `\`\`\`text
foo

bar
\`\`\``,
    },
    {
        name: "slice bold text in code block",
        content: "<pre><code><strong>bar</strong></code></pre>",
        from: 2,
        to: 5,
        slice: `<pre>
<code class="language-text">
<strong>bar</strong>
</code>
</pre>`,
    },
    {
        name: "slice differently ordered nested code marks",
        content: "<pre><code><strong><em>both</em></strong></code></pre>",
        from: 2,
        to: 6,
        slice: `<pre>
<code class="language-text">
<strong><em>both</em></strong>
</code>
</pre>`,
    },
    {
        name: "slice link mark in code block",
        content: '<pre><code><a href="https://example.com">link</a></code></pre>',
        from: 2,
        to: 6,
        slice: `<pre>
<code class="language-text">
<a href="https://example.com">link</a>
</code>
</pre>`,
    },
    {
        name: "slice colored highlight in code block",
        content: '<pre><code><mark class="highlight-red">hot</mark></code></pre>',
        from: 2,
        to: 5,
        slice: `<pre>
<code class="language-text">
<mark class="highlight-red">hot</mark>
</code>
</pre>`,
    },
    {
        name: "slice code block in repeated code blocks first match",
        content: `<pre><code>bar</code></pre>

<pre><code>bar</code></pre>`,
        from: 2,
        to: 5,
        slice: `\`\`\`text
bar
\`\`\``,
    },
    {
        name: "slice code block in repeated code blocks second match",
        content: `<pre><code>bar</code></pre>

<pre><code>bar</code></pre>`,
        from: 9,
        to: 12,
        slice: `\`\`\`text
bar
\`\`\``,
    },
    {
        name: "slice paragraph followed by code block",
        content: `foo

<pre><code>bar</code></pre>

qux`,
        from: 1,
        to: 10,
        slice: `foo

\`\`\`text
bar
\`\`\``,
    },
    {
        name: "slice code block followed by paragraph",
        content: `foo

<pre><code>bar</code></pre>

qux`,
        from: 7,
        to: 16,
        slice: `\`\`\`text
bar
\`\`\`

qux`,
    },
    {
        name: "slice divider block",
        content: "---",
        from: 0,
        to: 1,
        slice: "<hr />",
    },
    {
        name: "slice divider between paragraphs",
        content: `before

---

after`,
        from: 8,
        to: 9,
        slice: "<hr />",
    },
    {
        name: "slice document containing divider",
        content: `before

---

after`,
        from: 1,
        to: 15,
        slice: `before

---

after`,
    },
    {
        name: "slice repeated divider blocks first match",
        content: `before

---

middle

---

after`,
        from: 8,
        to: 9,
        slice: "<hr />",
    },
    {
        name: "slice repeated divider blocks second match",
        content: `before

---

middle

---

after`,
        from: 17,
        to: 18,
        slice: "<hr />",
    },
    {
        name: "slice matching file block",
        content: "![](https://alpine.inc/file/06ffbh5yh19cp84gjjhmazeypm/content)",
        from: 1,
        to: 2,
        slice: '<object type="application/octet-stream" data="https://alpine.inc/file/06ffbh5yh19cp84gjjhmazeypm/content"></object>',
    },
    {
        name: "slice file block between paragraphs",
        content: `before

![](https://alpine.inc/file/06ffbh5yh19cp84gjjhmazeypm/content)

after`,
        from: 9,
        to: 10,
        slice: '<object type="application/octet-stream" data="https://alpine.inc/file/06ffbh5yh19cp84gjjhmazeypm/content"></object>',
    },
    {
        name: "slice document around file block",
        content: `before text

![](https://alpine.inc/file/06ffbh5yh19cp84gjjhmazeypm/content)

after text`,
        from: 1,
        to: 27,
        slice: `before text

<object type="application/octet-stream" data="https://alpine.inc/file/06ffbh5yh19cp84gjjhmazeypm/content"></object>

after text`,
    },
    {
        name: "slice document with paired file blocks",
        content: `![](https://alpine.inc/file/06ffbh5yh19cp84gjjhmazeypm/content)

middle text

![](https://alpine.inc/file/06ffa46za1s8z2jwj61a4cbr7c/content)`,
        from: 1,
        to: 18,
        slice: `<object type="application/octet-stream" data="https://alpine.inc/file/06ffbh5yh19cp84gjjhmazeypm/content"></object>

middle text

<object type="application/octet-stream" data="https://alpine.inc/file/06ffa46za1s8z2jwj61a4cbr7c/content"></object>`,
    },
    {
        name: "slice file block followed by divider",
        content: `![](https://alpine.inc/file/06ffbh5yh19cp84gjjhmazeypm/content)

---

![](https://alpine.inc/file/06ffa46za1s8z2jwj61a4cbr7c/content)`,
        from: 1,
        to: 4,
        slice: `<object type="application/octet-stream" data="https://alpine.inc/file/06ffbh5yh19cp84gjjhmazeypm/content"></object>

---`,
    },
    {
        name: "slice image markdown in gallery",
        content: `<div style="display: flex; align-items: stretch">
<img src="https://alpine.inc/file/06ffbh5yh19cp84gjjhmazeypm/content" style="flex: 0 0 50%"/>
<img src="https://alpine.inc/file/06ffa46za1s8z2jwj61a4cbr7c/content" style="flex: 0 0 50%"/>
</div>`,
        from: 2,
        to: 3,
        slice: '<object type="application/octet-stream" data="https://alpine.inc/file/06ffa46za1s8z2jwj61a4cbr7c/content"></object>',
    },
    {
        name: "slice styled image html in gallery",
        content: `<div style="display: flex; align-items: stretch">
<img src="https://alpine.inc/file/06ffbh5yh19cp84gjjhmazeypm/content" style="flex: 0 0 50%"/>
<img src="https://alpine.inc/file/06ffa46za1s8z2jwj61a4cbr7c/content" style="flex: 0 0 50%"/>
</div>`,
        from: 2,
        to: 3,
        slice: '<object type="application/octet-stream" data="https://alpine.inc/file/06ffa46za1s8z2jwj61a4cbr7c/content"></object>',
    },
    {
        name: "slice bare image html in gallery",
        content: `<div style="display: flex; align-items: stretch">
<img src="https://alpine.inc/file/06ffbh5yh19cp84gjjhmazeypm/content" style="flex: 0 0 50%"/>
<img src="https://alpine.inc/file/06ffa46za1s8z2jwj61a4cbr7c/content" style="flex: 0 0 50%"/>
</div>`,
        from: 2,
        to: 3,
        slice: '<object type="application/octet-stream" data="https://alpine.inc/file/06ffa46za1s8z2jwj61a4cbr7c/content"></object>',
    },
    {
        name: "slice trailing gallery items",
        content: `<div style="display: flex; align-items: stretch">
<img src="https://alpine.inc/file/06ffbh5yh19cp84gjjhmazeypm/content" style="flex: 0 0 33%"/>
<img src="https://alpine.inc/file/06ffa46za1s8z2jwj61a4cbr7c/content" style="flex: 0 0 33%"/>
<img src="https://alpine.inc/file/06ffa4v2xca222ykdqeaf0pazw/content" style="flex: 0 0 34%"/>
</div>`,
        from: 2,
        to: 4,
        slice: `<div style="display: flex; align-items: stretch">
<object type="application/octet-stream" data="https://alpine.inc/file/06ffa46za1s8z2jwj61a4cbr7c/content" style="flex: 0 0 33%"></object>
<object type="application/octet-stream" data="https://alpine.inc/file/06ffa4v2xca222ykdqeaf0pazw/content" style="flex: 0 0 67%"></object>
</div>`,
    },
    {
        name: "slice later file row",
        content: `![](https://alpine.inc/file/06ffbh5yh19cp84gjjhmazeypm/content)

![](https://alpine.inc/file/06ffa46za1s8z2jwj61a4cbr7c/content)`,
        from: 4,
        to: 5,
        slice: '<object type="application/octet-stream" data="https://alpine.inc/file/06ffa46za1s8z2jwj61a4cbr7c/content"></object>',
    },
    {
        name: "slice markdown file inside float",
        content: `<div style="float: left; clear: both">
<img src="https://alpine.inc/file/06ffbh5yh19cp84gjjhmazeypm/content"/>
</div>`,
        from: 1,
        to: 2,
        slice: `<div style="float: left; clear: both">
<object type="application/octet-stream" data="https://alpine.inc/file/06ffbh5yh19cp84gjjhmazeypm/content"></object>
</div>`,
    },
    {
        name: "slice image html inside float",
        content: `<div style="float: left; clear: both">
<img src="https://alpine.inc/file/06ffbh5yh19cp84gjjhmazeypm/content"/>
</div>`,
        from: 1,
        to: 2,
        slice: `<div style="float: left; clear: both">
<object type="application/octet-stream" data="https://alpine.inc/file/06ffbh5yh19cp84gjjhmazeypm/content"></object>
</div>`,
    },
    {
        name: "slice matching file float",
        content: `<div style="float: left; clear: both">
<img src="https://alpine.inc/file/06ffbh5yh19cp84gjjhmazeypm/content"/>
</div>`,
        from: 1,
        to: 2,
        slice: `<div style="float: left; clear: both">
<object type="application/octet-stream" data="https://alpine.inc/file/06ffbh5yh19cp84gjjhmazeypm/content"></object>
</div>`,
    },
    {
        name: "slice repeated file across float and gallery first match",
        content: `<div style="float: left; clear: both">
<img src="https://alpine.inc/file/06ffbh5yh19cp84gjjhmazeypm/content"/>
</div>

<div style="display: flex; align-items: stretch">
<img src="https://alpine.inc/file/06ffbh5yh19cp84gjjhmazeypm/content" style="flex: 0 0 50%"/>
<img src="https://alpine.inc/file/06ffa46za1s8z2jwj61a4cbr7c/content" style="flex: 0 0 50%"/>
</div>`,
        from: 1,
        to: 2,
        slice: `<div style="float: left; clear: both">
<object type="application/octet-stream" data="https://alpine.inc/file/06ffbh5yh19cp84gjjhmazeypm/content"></object>
</div>`,
    },
    {
        name: "slice repeated file across float and gallery second match",
        content: `<div style="float: left; clear: both">
<img src="https://alpine.inc/file/06ffbh5yh19cp84gjjhmazeypm/content"/>
</div>

<div style="display: flex; align-items: stretch">
<img src="https://alpine.inc/file/06ffbh5yh19cp84gjjhmazeypm/content" style="flex: 0 0 50%"/>
<img src="https://alpine.inc/file/06ffa46za1s8z2jwj61a4cbr7c/content" style="flex: 0 0 50%"/>
</div>`,
        from: 4,
        to: 5,
        slice: '<object type="application/octet-stream" data="https://alpine.inc/file/06ffbh5yh19cp84gjjhmazeypm/content"></object>',
    },
    {
        name: "slice text in markdown table cell",
        content: `| First | Second |
| --- | --- |
| Alpha target | Beta |`,
        from: 31,
        to: 37,
        slice: `| target | |
| - | - |`,
    },
    {
        name: "slice full markdown table inside document",
        content: `Before

| Name | Status |
| --- | --- |
| Alpha | Done |
| Beta | Todo |

After`,
        from: 12,
        to: 63,
        slice: `| Name | Status |
| - | - |
| Alpha | Done |
| Beta | Todo |`,
    },
    {
        name: "slice leading markdown table rows",
        content: `| Name | Status |
| --- | --- |
| Alpha | Done |
| Beta | Todo |`,
        from: 4,
        to: 37,
        slice: `| Name | Status |
| - | - |
| Alpha | Done |`,
    },
    {
        name: "slice multiple paragraphs inside html table cell",
        content: `<table>
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
        from: 4,
        to: 37,
        slice: `<table>
<tbody>
<tr>
<td>

First paragraph

Second paragraph

</td>
<td>

</td>
</tr>
</tbody>
</table>`,
    },
    {
        name: "slice quoted text inside html table cell",
        content: `<table>
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
        from: 5,
        to: 18,
        slice: `<table>
<tbody>
<tr>
<td>

> quoted target

</td>
<td>

</td>
</tr>
</tbody>
</table>`,
    },
    {
        name: "slice list item inside html table cell",
        content: `<table>
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
        from: 19,
        to: 30,
        slice: `<table>
<tbody>
<tr>
<td>

- second item

</td>
<td>

</td>
</tr>
</tbody>
</table>`,
    },
    {
        name: "slice checked task inside html table cell",
        content: `<table>
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
        from: 18,
        to: 27,
        slice: `<table>
<tbody>
<tr>
<td>

- [x] done task

</td>
<td>

</td>
</tr>
</tbody>
</table>`,
    },
    {
        name: "slice file inside html table cell",
        content: `<table>
<tbody>
<tr>
<td>

![](https://alpine.inc/file/06ffbh5yh19cp84gjjhmazeypm/content)

</td>
<td>

Other cell

</td>
</tr>
</tbody>
</table>`,
        from: 4,
        to: 5,
        slice: `<table>
<tbody>
<tr>
<td>

<object type="application/octet-stream" data="https://alpine.inc/file/06ffbh5yh19cp84gjjhmazeypm/content"></object>

</td>
<td>

</td>
</tr>
</tbody>
</table>`,
    },
    {
        name: "slice code block text inside html table cell",
        content: `<table>
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
        from: 12,
        to: 18,
        slice: `<table>
<tbody>
<tr>
<td>

\`\`\`text
target
\`\`\`

</td>
<td>

</td>
</tr>
</tbody>
</table>`,
    },
    {
        name: "slice full html table",
        content: `<table>
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
        from: 4,
        to: 76,
        slice: `<table>
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
    },
    {
        name: "slice overlapping repeated text first match",
        content: "aaaaa",
        from: 1,
        to: 3,
        slice: "aa",
    },
    {
        name: "slice overlapping repeated text second match",
        content: "aaaaa",
        from: 2,
        to: 4,
        slice: "aa",
    },
    {
        name: "slice overlapping repeated text third match",
        content: "aaaaa",
        from: 3,
        to: 5,
        slice: "aa",
    },
    {
        name: "slice overlapping repeated text fourth match",
        content: "aaaaa",
        from: 4,
        to: 6,
        slice: "aa",
    },
];

for (const testCase of testCases) {
    const test = testCase.only ? globalThis.test.only : globalThis.test;

    test(`${testCase.name}`, () => {
        const documentId = generateId();

        const encoder = new ApiContentKeyEncoder({
            entityId: `Document:${documentId}`,
            version: 0,
        });

        const contentNode = fromApiContent(
            DocumentContentProsemirrorSchema,
            parseApiContentFromMarkdown(testCase.content),
        );

        const content = intoApiContent(contentNode, {
            encoder,
            getAccountMentionTitleIfExists: () => undefined,
            getSearchEntityMentionTitleIfExists: () => undefined,
            getSearchTaskEntityDisplayStatusIfExists: () => undefined,
            getFileIfExists: () => undefined,
        });

        const $from = contentNode.resolve(testCase.from);
        const $to = contentNode.resolve(testCase.to);

        const start: ApiContentPosition =
            $from.nodeAfter && !$from.nodeAfter.type.isInline
                ? {
                      type: "Before",
                      key: encoder.encode({pos: testCase.from, nodeSize: $from.nodeAfter.nodeSize}),
                  }
                : {
                      type: "Inline",
                      key: encoder.encode({
                          pos: $from.before(),
                          nodeSize: $from.parent.nodeSize,
                      }),
                      index: $from.parentOffset,
                  };

        const end: ApiContentPosition =
            $to.nodeBefore && !$to.nodeBefore.type.isInline
                ? {
                      type: "After",
                      key: encoder.encode({
                          pos: testCase.to - 1,
                          nodeSize: $to.nodeBefore.nodeSize,
                      }),
                  }
                : {
                      type: "Inline",
                      key: encoder.encode({
                          pos: $to.before(),
                          nodeSize: $to.parent.nodeSize,
                      }),
                      index: $to.parentOffset,
                  };

        expect(
            mapResult(sliceApiContentRange(content, {start, end}), slice => {
                const sliceString = printApiContentToMarkdown(slice);
                return sliceString.endsWith("\n") ? sliceString.slice(0, -1) : sliceString;
            }),
        ).toEqual({
            ok: true,
            value: testCase.slice,
        });
    });
}
