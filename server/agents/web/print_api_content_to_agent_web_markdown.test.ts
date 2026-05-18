import {
    decode as decodeO200kBase,
    encode as encodeO200kBase,
} from "gpt-tokenizer/esm/encoding/o200k_base";
import {AgentWebMarkdownStreamParser} from "~/server/agents/web/agent_web_markdown_stream_parser.js";
import {parseApiContentFromAgentWebMarkdown} from "~/server/agents/web/parse_api_content_from_agent_web_markdown.js";
import {printApiContentToAgentWebMarkdown} from "~/server/agents/web/print_api_content_to_agent_web_markdown.js";
import {createAgentWebSessionStorageForTest} from "~/server/agents/web/test_helpers/create_agent_web_session_storage_for_test.js";
import {normalizeApiContentResponse} from "~/shared/api/markdown/normalize_api_content.js";
import {
    ApiContentBlockElementResponse,
    ApiContentResponse,
} from "~/shared/api/specification/types/api_specification_convenience_types.js";
import {randomInteger} from "~/shared/helpers/number/random_integer.js";
import {CommitBlocker} from "~/shared/helpers/types/commit_blocker.js";
import {generateChronologicalId} from "~/shared/id/chronological_id.js";
import {generateId} from "~/shared/id/id.js";
import {
    AccountId,
    BotId,
    DocumentCommentThreadId,
    DocumentId,
    FileId,
    SpaceId,
    TaskId,
} from "~/shared/id/types/id_types.js";

const spaceId = generateId<SpaceId>();
const documentId = generateId<DocumentId>();
const otherDocumentId = generateId<DocumentId>();
const taskId = generateId<TaskId>();
const threadId1 = generateId<DocumentCommentThreadId>();
const threadId2 = generateId<DocumentCommentThreadId>();
const threadId3 = generateId<DocumentCommentThreadId>();
const threadId4 = generateId<DocumentCommentThreadId>();
const threadId5 = generateId<DocumentCommentThreadId>();
const calebAccountId = generateId<AccountId>();
const chatGptAccountId = generateId<AccountId>();
const chatGptBotId = generateId<BotId>();
const file1Id = generateChronologicalId<FileId>();
const file2Id = generateChronologicalId<FileId>();
const file3Id = generateChronologicalId<FileId>();
const file4Id = generateChronologicalId<FileId>();
const file5Id = generateChronologicalId<FileId>();
const file6Id = generateChronologicalId<FileId>();

const exampleUrl = `https://example.com/${generateId()}/${generateId()}/${generateId()}`;
const exampleTruncatedUrl = exampleUrl.slice(0, 40) + "…" + exampleUrl.slice(-10);
const otherExampleUrl = exampleUrl.slice(0, 70) + "ZZZ" + exampleUrl.slice(73);

const exampleUrlWithHash = exampleUrl.slice(0, -4) + "#" + exampleUrl.slice(-4);
const exampleTruncatedUrlWithHash =
    exampleUrlWithHash.slice(0, 40) + "…" + exampleUrlWithHash.slice(-10);
const otherExampleUrlWithHash =
    exampleUrlWithHash.slice(0, 70) + "ZZZ" + exampleUrlWithHash.slice(73);

const storage = createAgentWebSessionStorageForTest(spaceId);

const testCases: Array<{
    only?: CommitBlocker;
    name: string;
    content: ApiContentResponse;
    markdown: string;
}> = [
    {
        name: "heading depth increment",
        content: {
            elements: [
                {
                    type: "Heading",
                    level: 1,
                    elements: [{type: "Text", text: "Heading 1"}],
                },
                {
                    type: "Heading",
                    level: 2,
                    elements: [{type: "Text", text: "Heading 2"}],
                },
                {
                    type: "Heading",
                    level: 3,
                    elements: [{type: "Text", text: "Heading 3"}],
                },
            ],
        },
        markdown: `\
## Heading 1

### Heading 2

#### Heading 3
`,
    },
    {
        name: "task mention element",
        content: {
            elements: [
                {
                    type: "Paragraph",
                    elements: [
                        {type: "Text", text: "Review "},
                        {
                            type: "Mention",
                            target: {
                                type: "Task",
                                id: taskId,
                                title: "Fix auth",
                                status: {type: "Open", isActive: true},
                            },
                        },
                        {type: "Text", text: " today"},
                    ],
                },
            ],
        },
        markdown: `\
Review [Fix auth (Open)](/task/fix-auth) today
`,
    },
    {
        name: "mention element with italic mark",
        content: {
            elements: [
                {
                    type: "Paragraph",
                    elements: [
                        {type: "Text", text: "Review ", marks: [{type: "Italic"}]},
                        {
                            type: "Mention",
                            target: {
                                type: "Task",
                                id: taskId,
                                title: "Fix auth",
                                status: {type: "Open", isActive: true},
                            },
                            marks: [{type: "Italic"}],
                        },
                        {type: "Text", text: " today", marks: [{type: "Italic"}]},
                    ],
                },
            ],
        },
        markdown: `\
*Review [Fix auth (Open)](/task/fix-auth) today*
`,
    },
    {
        name: "mention element with code mark",
        content: {
            elements: [
                {
                    type: "Paragraph",
                    elements: [
                        {type: "Text", text: "Review ", marks: [{type: "Code"}]},
                        {
                            type: "Mention",
                            target: {
                                type: "Task",
                                id: taskId,
                                title: "Fix auth",
                                status: {type: "Open", isActive: true},
                            },
                            marks: [{type: "Code"}],
                        },
                        {type: "Text", text: " today", marks: [{type: "Code"}]},
                    ],
                },
            ],
        },
        markdown: `\
\`Review \`<code>[Fix auth (Open)](/task/fix-auth)</code>\` today\`
`,
    },
    {
        name: "mention element with link mark",
        content: {
            elements: [
                {
                    type: "Paragraph",
                    elements: [
                        {
                            type: "Text",
                            text: "Review ",
                            marks: [{type: "Link", url: "https://example.com"}],
                        },
                        {
                            type: "Mention",
                            target: {
                                type: "Task",
                                id: taskId,
                                title: "Fix auth",
                                status: {type: "Open", isActive: true},
                            },
                            marks: [{type: "Link", url: "https://example.com"}],
                        },
                        {
                            type: "Text",
                            text: " today",
                            marks: [{type: "Link", url: "https://example.com"}],
                        },
                    ],
                },
            ],
        },
        markdown: `\
[Review ](https://example.com)<a href="https://example.com">[Fix auth (Open)](/task/fix-auth)</a>[ today](https://example.com)
`,
    },
    {
        name: "duplicated mention elements",
        content: {
            elements: [
                {
                    type: "Paragraph",
                    elements: [
                        {type: "Text", text: "See "},
                        {
                            type: "Mention",
                            target: {
                                type: "Document",
                                id: documentId,
                                title: "Product Spec",
                            },
                        },
                        {type: "Text", text: " and "},
                        {
                            type: "Mention",
                            target: {
                                type: "Document",
                                id: otherDocumentId,
                                title: "Product Spec",
                            },
                        },
                    ],
                },
            ],
        },
        markdown: `\
See [Product Spec](/document/product-spec) and [Product Spec](/document/product-spec-2)
`,
    },
    {
        name: "human account mention element",
        content: {
            elements: [
                {
                    type: "Paragraph",
                    elements: [
                        {type: "Text", text: "Hello "},
                        {
                            type: "Mention",
                            target: {
                                type: "Account",
                                id: calebAccountId,
                                title: "Caleb Meredith",
                                shortName: "Caleb",
                            },
                        },
                        {type: "Text", text: "!"},
                    ],
                },
            ],
        },
        markdown: `\
Hello [Caleb Meredith](/human/caleb-meredith)!
`,
    },
    {
        name: "human short account mention element",
        content: {
            elements: [
                {
                    type: "Paragraph",
                    elements: [
                        {type: "Text", text: "Hello "},
                        {
                            type: "Mention",
                            target: {
                                type: "Account",
                                id: calebAccountId,
                                title: "Caleb Meredith",
                                shortName: "Caleb",
                            },
                            isAccountShortName: true,
                        },
                        {type: "Text", text: "!"},
                    ],
                },
            ],
        },
        markdown: `\
Hello [Caleb](/human/caleb-meredith)!
`,
    },
    {
        name: "bot account mention element",
        content: {
            elements: [
                {
                    type: "Paragraph",
                    elements: [
                        {type: "Text", text: "Hello "},
                        {
                            type: "Mention",
                            target: {
                                type: "Account",
                                id: chatGptAccountId,
                                title: "ChatGPT",
                                shortName: "ChatGPT",
                                botId: chatGptBotId,
                            },
                        },
                        {type: "Text", text: "!"},
                    ],
                },
            ],
        },
        markdown: `\
Hello [ChatGPT](/bot/chatgpt)!
`,
    },
    {
        name: "bot short account mention element",
        content: {
            elements: [
                {
                    type: "Paragraph",
                    elements: [
                        {type: "Text", text: "Hello "},
                        {
                            type: "Mention",
                            target: {
                                type: "Account",
                                id: chatGptAccountId,
                                title: "ChatGPT",
                                shortName: "ChatGPT",
                                botId: chatGptBotId,
                            },
                            isAccountShortName: true,
                        },
                        {type: "Text", text: "!"},
                    ],
                },
            ],
        },
        markdown: `\
Hello [ChatGPT](/bot/chatgpt#short)!
`,
    },
    {
        name: "link mark without truncation",
        content: {
            elements: [
                {
                    type: "Paragraph",
                    elements: [
                        {type: "Text", text: "Visit "},
                        {
                            type: "Text",
                            text: "example",
                            marks: [{type: "Link", url: "https://example.com"}],
                        },
                        {type: "Text", text: " for more"},
                    ],
                },
            ],
        },
        markdown: `\
Visit [example](https://example.com) for more
`,
    },
    {
        name: "link mark without truncation mixed between text and code block",
        content: {
            elements: [
                {
                    type: "Paragraph",
                    elements: [
                        {type: "Text", text: "Visit "},
                        {
                            type: "Text",
                            text: "example",
                            marks: [{type: "Link", url: "https://example.com"}],
                        },
                        {type: "Text", text: " for more"},
                    ],
                },
                {
                    type: "Code",
                    language: "text",
                    lines: [
                        {
                            elements: [
                                {type: "Text", text: "Visit "},
                                {
                                    type: "Text",
                                    text: "example",
                                    marks: [{type: "Link", url: "https://example.com"}],
                                },
                                {type: "Text", text: " for more"},
                            ],
                        },
                    ],
                },
            ],
        },
        markdown: `\
Visit [example](https://example.com) for more

<pre>
<code class="language-text">
Visit <a href="https://example.com">example</a> for more
</code>
</pre>
`,
    },
    {
        name: "link mark starting with slash",
        content: {
            elements: [
                {
                    type: "Paragraph",
                    elements: [
                        {type: "Text", text: "Visit "},
                        {
                            type: "Text",
                            text: "this doc",
                            marks: [{type: "Link", url: "/document/hello-world"}],
                        },
                        {type: "Text", text: " for more"},
                    ],
                },
            ],
        },
        markdown: `\
Visit [this doc](https://alpine.inc/document/hello-world) for more
`,
    },
    {
        name: "link mark",
        content: {
            elements: [
                {
                    type: "Paragraph",
                    elements: [
                        {type: "Text", text: "Visit "},
                        {
                            type: "Text",
                            text: "https://example.com",
                            marks: [{type: "Link", url: exampleUrl}],
                        },
                        {type: "Text", text: " for more"},
                    ],
                },
            ],
        },
        markdown: `\
Visit [https://example.com](${exampleTruncatedUrl}) for more
`,
    },
    {
        name: "duplicated link marks",
        content: {
            elements: [
                {
                    type: "Paragraph",
                    elements: [
                        {type: "Text", text: "Visit "},
                        {
                            type: "Text",
                            text: "https://example.com",
                            marks: [{type: "Link", url: exampleUrl}],
                        },
                        {type: "Text", text: " and "},
                        {
                            type: "Text",
                            text: "https://example.com",
                            marks: [{type: "Link", url: otherExampleUrl}],
                        },
                        {type: "Text", text: " for more"},
                    ],
                },
            ],
        },
        markdown: `\
Visit [https://example.com](${exampleTruncatedUrl}) and [https://example.com](${exampleTruncatedUrl}#2) for more
`,
    },
    {
        name: "duplicated link marks with hash",
        content: {
            elements: [
                {
                    type: "Paragraph",
                    elements: [
                        {type: "Text", text: "Visit "},
                        {
                            type: "Text",
                            text: "https://example.com",
                            marks: [{type: "Link", url: exampleUrlWithHash}],
                        },
                        {type: "Text", text: " and "},
                        {
                            type: "Text",
                            text: "https://example.com",
                            marks: [{type: "Link", url: otherExampleUrlWithHash}],
                        },
                        {type: "Text", text: " for more"},
                    ],
                },
            ],
        },
        markdown: `\
Visit [https://example.com](${exampleTruncatedUrlWithHash}) and [https://example.com](${exampleTruncatedUrlWithHash}-2) for more
`,
    },
    {
        name: "code block with link marks",
        content: {
            elements: [
                {
                    type: "Code",
                    language: "html",
                    lines: [
                        {
                            elements: [
                                {type: "Text", text: "Visit "},
                                {
                                    type: "Text",
                                    text: "https://example.com",
                                    marks: [{type: "Link", url: exampleUrl}],
                                },
                                {type: "Text", text: " for more"},
                            ],
                        },
                    ],
                },
            ],
        },
        markdown: `\
<pre>
<code class="language-html">
Visit <a href="${exampleTruncatedUrl}">https://example.com</a> for more
</code>
</pre>
`,
    },
    {
        name: "duplicated code block with link marks",
        content: {
            elements: [
                {
                    type: "Code",
                    language: "html",
                    lines: [
                        {
                            elements: [
                                {type: "Text", text: "Visit "},
                                {
                                    type: "Text",
                                    text: "https://example.com",
                                    marks: [{type: "Link", url: exampleUrl}],
                                },
                                {type: "Text", text: " and "},
                                {
                                    type: "Text",
                                    text: "https://example.com",
                                    marks: [{type: "Link", url: otherExampleUrl}],
                                },
                                {type: "Text", text: " for more"},
                            ],
                        },
                    ],
                },
            ],
        },
        markdown: `\
<pre>
<code class="language-html">
Visit <a href="${exampleTruncatedUrl}">https://example.com</a> and <a href="${exampleTruncatedUrl}#2">https://example.com</a> for more
</code>
</pre>
`,
    },
    {
        name: "code block with link marks (link ends with HTML entity)",
        content: {
            elements: [
                {
                    type: "Code",
                    language: "html",
                    lines: [
                        {
                            elements: [
                                {type: "Text", text: "Visit "},
                                {
                                    type: "Text",
                                    text: "https://example.com",
                                    marks: [{type: "Link", url: `${exampleUrl}&`}],
                                },
                                {type: "Text", text: " for more"},
                            ],
                        },
                    ],
                },
            ],
        },
        markdown: `\
<pre>
<code class="language-html">
Visit <a href="${exampleUrl.slice(0, 40) + "…" + exampleUrl.slice(-9)}&amp;">https://example.com</a> for more
</code>
</pre>
`,
    },
    {
        name: "code block with link marks (link starts with HTML entity)",
        content: {
            elements: [
                {
                    type: "Code",
                    language: "html",
                    lines: [
                        {
                            elements: [
                                {type: "Text", text: "Visit "},
                                {
                                    type: "Text",
                                    text: "https://example.com",
                                    marks: [{type: "Link", url: `&${exampleUrl}`}],
                                },
                                {type: "Text", text: " for more"},
                            ],
                        },
                    ],
                },
            ],
        },
        markdown: `\
<pre>
<code class="language-html">
Visit <a href="&amp;${exampleUrl.slice(0, 39) + "…" + exampleUrl.slice(-10)}">https://example.com</a> for more
</code>
</pre>
`,
    },
    {
        name: "code block with link marks (link contains HTML entity)",
        content: {
            elements: [
                {
                    type: "Code",
                    language: "html",
                    lines: [
                        {
                            elements: [
                                {type: "Text", text: "Visit "},
                                {
                                    type: "Text",
                                    text: "https://example.com",
                                    marks: [
                                        {
                                            type: "Link",
                                            url: `${exampleUrl}&https://alpine.inc`,
                                        },
                                    ],
                                },
                                {type: "Text", text: " for more"},
                            ],
                        },
                    ],
                },
            ],
        },
        markdown: `\
<pre>
<code class="language-html">
Visit <a href="${exampleUrl.slice(0, 40)}…alpine.inc">https://example.com</a> for more
</code>
</pre>
`,
    },
    {
        name: "code block with link marks (link contains multiple HTML entities)",
        content: {
            elements: [
                {
                    type: "Code",
                    language: "html",
                    lines: [
                        {
                            elements: [
                                {type: "Text", text: "Visit "},
                                {
                                    type: "Text",
                                    text: "https://example.com",
                                    marks: [
                                        {
                                            type: "Link",
                                            url: `${exampleUrl}&&&https://alpine.inc`,
                                        },
                                    ],
                                },
                                {type: "Text", text: " for more"},
                            ],
                        },
                    ],
                },
            ],
        },
        markdown: `\
<pre>
<code class="language-html">
Visit <a href="${exampleUrl.slice(0, 40)}…alpine.inc">https://example.com</a> for more
</code>
</pre>
`,
    },
    {
        name: "link mark mixed between text and code block",
        content: {
            elements: [
                {
                    type: "Paragraph",
                    elements: [
                        {type: "Text", text: "Visit "},
                        {
                            type: "Text",
                            text: "example",
                            marks: [{type: "Link", url: exampleUrl}],
                        },
                        {type: "Text", text: " for more"},
                    ],
                },
                {
                    type: "Code",
                    language: "text",
                    lines: [
                        {
                            elements: [
                                {type: "Text", text: "Visit "},
                                {
                                    type: "Text",
                                    text: "example",
                                    marks: [{type: "Link", url: exampleUrl}],
                                },
                                {type: "Text", text: " for more"},
                            ],
                        },
                    ],
                },
            ],
        },
        markdown: `\
Visit [example](${exampleTruncatedUrl}) for more

<pre>
<code class="language-text">
Visit <a href="${exampleTruncatedUrl}">example</a> for more
</code>
</pre>
`,
    },
    {
        name: "table width and column widths are truncated",
        content: {
            elements: [
                {
                    type: "Table",
                    width: 1.5524444444444445,
                    columns: [
                        {width: 1},
                        {width: 1.1848341232227486},
                        {width: 1.6666666666666667},
                        {width: 1},
                        {width: 0.6666666666666667},
                    ],
                    hasHeaderRow: false,
                    hasHeaderColumn: true,
                    rows: [
                        {
                            cells: [
                                {
                                    elements: [
                                        {
                                            type: "Paragraph",
                                            elements: [{type: "Text", text: "Label"}],
                                        },
                                    ],
                                },
                                {
                                    elements: [
                                        {
                                            type: "Paragraph",
                                            elements: [{type: "Text", text: "Value"}],
                                        },
                                    ],
                                },
                            ],
                        },
                    ],
                },
            ],
        },
        markdown: `\
<table data-width="1.55" data-column-widths="1,1.18,1.67,1,0.67">
<tbody>
<tr>
<th>

Label

</th>
<td>

Value

</td>
</tr>
</tbody>
</table>
`,
    },
    {
        name: "table column widths increase fraction digits for small values",
        content: {
            elements: [
                {
                    type: "Table",
                    width: 1,
                    columns: [{width: 0.00123}, {width: 0.00124}],
                    hasHeaderRow: false,
                    hasHeaderColumn: true,
                    rows: [
                        {
                            cells: [
                                {
                                    elements: [
                                        {
                                            type: "Paragraph",
                                            elements: [{type: "Text", text: "Label"}],
                                        },
                                    ],
                                },
                                {
                                    elements: [
                                        {
                                            type: "Paragraph",
                                            elements: [{type: "Text", text: "Value"}],
                                        },
                                    ],
                                },
                            ],
                        },
                    ],
                },
            ],
        },
        markdown: `\
<table data-column-widths="0.00123,0.00124">
<tbody>
<tr>
<th>

Label

</th>
<td>

Value

</td>
</tr>
</tbody>
</table>
`,
    },
    {
        name: "table width and column widths deduplication (identical widths reused)",
        content: {
            elements: [
                {
                    type: "Table",
                    width: 1.2341,
                    columns: [{width: 9.8761}, {width: 0}],
                    hasHeaderRow: false,
                    hasHeaderColumn: true,
                    rows: [
                        {
                            cells: [
                                {
                                    elements: [
                                        {
                                            type: "Paragraph",
                                            elements: [{type: "Text", text: "Label"}],
                                        },
                                    ],
                                },
                                {
                                    elements: [
                                        {
                                            type: "Paragraph",
                                            elements: [{type: "Text", text: "Value"}],
                                        },
                                    ],
                                },
                            ],
                        },
                    ],
                },
                {
                    type: "Table",
                    width: 1.2341,
                    columns: [{width: 9.8761}, {width: 0}],
                    hasHeaderRow: false,
                    hasHeaderColumn: true,
                    rows: [
                        {
                            cells: [
                                {
                                    elements: [
                                        {
                                            type: "Paragraph",
                                            elements: [{type: "Text", text: "Label"}],
                                        },
                                    ],
                                },
                                {
                                    elements: [
                                        {
                                            type: "Paragraph",
                                            elements: [{type: "Text", text: "Value"}],
                                        },
                                    ],
                                },
                            ],
                        },
                    ],
                },
            ],
        },
        markdown: `\
<table data-width="1.23" data-column-widths="9.88,0">
<tbody>
<tr>
<th>

Label

</th>
<td>

Value

</td>
</tr>
</tbody>
</table>

<table data-width="1.23" data-column-widths="9.88,0">
<tbody>
<tr>
<th>

Label

</th>
<td>

Value

</td>
</tr>
</tbody>
</table>
`,
    },
    {
        name: "table width and column widths deduplication (2 copies)",
        content: {
            elements: [
                {
                    type: "Table",
                    width: 1.2341,
                    columns: [{width: 9.8761}, {width: 0}],
                    hasHeaderRow: false,
                    hasHeaderColumn: true,
                    rows: [
                        {
                            cells: [
                                {
                                    elements: [
                                        {
                                            type: "Paragraph",
                                            elements: [{type: "Text", text: "Label"}],
                                        },
                                    ],
                                },
                                {
                                    elements: [
                                        {
                                            type: "Paragraph",
                                            elements: [{type: "Text", text: "Value"}],
                                        },
                                    ],
                                },
                            ],
                        },
                    ],
                },
                {
                    type: "Table",
                    width: 1.2342,
                    columns: [{width: 9.8762}, {width: 0}],
                    hasHeaderRow: false,
                    hasHeaderColumn: true,
                    rows: [
                        {
                            cells: [
                                {
                                    elements: [
                                        {
                                            type: "Paragraph",
                                            elements: [{type: "Text", text: "Label"}],
                                        },
                                    ],
                                },
                                {
                                    elements: [
                                        {
                                            type: "Paragraph",
                                            elements: [{type: "Text", text: "Value"}],
                                        },
                                    ],
                                },
                            ],
                        },
                    ],
                },
            ],
        },
        markdown: `\
<table data-width="1.23" data-column-widths="9.88,0">
<tbody>
<tr>
<th>

Label

</th>
<td>

Value

</td>
</tr>
</tbody>
</table>

<table data-width="1.234" data-column-widths="9.876,0">
<tbody>
<tr>
<th>

Label

</th>
<td>

Value

</td>
</tr>
</tbody>
</table>
`,
    },
    {
        name: "table width and column widths deduplication (5 copies)",
        content: {
            elements: [
                {
                    type: "Table",
                    width: 1.2341,
                    columns: [{width: 9.8761}, {width: 0}],
                    hasHeaderRow: false,
                    hasHeaderColumn: true,
                    rows: [
                        {
                            cells: [
                                {
                                    elements: [
                                        {
                                            type: "Paragraph",
                                            elements: [{type: "Text", text: "Label"}],
                                        },
                                    ],
                                },
                                {
                                    elements: [
                                        {
                                            type: "Paragraph",
                                            elements: [{type: "Text", text: "Value"}],
                                        },
                                    ],
                                },
                            ],
                        },
                    ],
                },
                {
                    type: "Table",
                    width: 1.2342,
                    columns: [{width: 9.8762}, {width: 0}],
                    hasHeaderRow: false,
                    hasHeaderColumn: true,
                    rows: [
                        {
                            cells: [
                                {
                                    elements: [
                                        {
                                            type: "Paragraph",
                                            elements: [{type: "Text", text: "Label"}],
                                        },
                                    ],
                                },
                                {
                                    elements: [
                                        {
                                            type: "Paragraph",
                                            elements: [{type: "Text", text: "Value"}],
                                        },
                                    ],
                                },
                            ],
                        },
                    ],
                },
                {
                    type: "Table",
                    width: 1.2343,
                    columns: [{width: 9.8763}, {width: 0}],
                    hasHeaderRow: false,
                    hasHeaderColumn: true,
                    rows: [
                        {
                            cells: [
                                {
                                    elements: [
                                        {
                                            type: "Paragraph",
                                            elements: [{type: "Text", text: "Label"}],
                                        },
                                    ],
                                },
                                {
                                    elements: [
                                        {
                                            type: "Paragraph",
                                            elements: [{type: "Text", text: "Value"}],
                                        },
                                    ],
                                },
                            ],
                        },
                    ],
                },
                {
                    type: "Table",
                    width: 1.2344,
                    columns: [{width: 9.8764}, {width: 0}],
                    hasHeaderRow: false,
                    hasHeaderColumn: true,
                    rows: [
                        {
                            cells: [
                                {
                                    elements: [
                                        {
                                            type: "Paragraph",
                                            elements: [{type: "Text", text: "Label"}],
                                        },
                                    ],
                                },
                                {
                                    elements: [
                                        {
                                            type: "Paragraph",
                                            elements: [{type: "Text", text: "Value"}],
                                        },
                                    ],
                                },
                            ],
                        },
                    ],
                },
                {
                    type: "Table",
                    width: 1.2345,
                    columns: [{width: 9.8765}, {width: 0}],
                    hasHeaderRow: false,
                    hasHeaderColumn: true,
                    rows: [
                        {
                            cells: [
                                {
                                    elements: [
                                        {
                                            type: "Paragraph",
                                            elements: [{type: "Text", text: "Label"}],
                                        },
                                    ],
                                },
                                {
                                    elements: [
                                        {
                                            type: "Paragraph",
                                            elements: [{type: "Text", text: "Value"}],
                                        },
                                    ],
                                },
                            ],
                        },
                    ],
                },
            ],
        },
        markdown: `\
<table data-width="1.23" data-column-widths="9.88,0">
<tbody>
<tr>
<th>

Label

</th>
<td>

Value

</td>
</tr>
</tbody>
</table>

<table data-width="1.234" data-column-widths="9.876,0">
<tbody>
<tr>
<th>

Label

</th>
<td>

Value

</td>
</tr>
</tbody>
</table>

<table data-width="1.2343" data-column-widths="9.8763,0">
<tbody>
<tr>
<th>

Label

</th>
<td>

Value

</td>
</tr>
</tbody>
</table>

<table data-width="1.2344" data-column-widths="9.8764,0">
<tbody>
<tr>
<th>

Label

</th>
<td>

Value

</td>
</tr>
</tbody>
</table>

<table data-width="1.2345" data-column-widths="9.877,0">
<tbody>
<tr>
<th>

Label

</th>
<td>

Value

</td>
</tr>
</tbody>
</table>
`,
    },
    {
        name: "comment transformation reuses comment thread number",
        content: {
            elements: [
                {
                    type: "Paragraph",
                    elements: [
                        {
                            type: "Text",
                            text: "alpha",
                            marks: [{type: "Comment", threadId: threadId1}],
                        },
                        {type: "Text", text: " "},
                        {
                            type: "Text",
                            text: "beta",
                            marks: [{type: "Comment", threadId: threadId2}],
                        },
                        {type: "Text", text: " "},
                        {
                            type: "Text",
                            text: "gamma",
                            marks: [{type: "Comment", threadId: threadId1}],
                        },
                    ],
                },
            ],
        },
        markdown: `\
<comment id="1">alpha</comment> <comment id="2">beta</comment> <comment id="1">gamma</comment>
`,
    },
    {
        name: "comment transformation increments comment numbers",
        content: {
            elements: [
                {
                    type: "Paragraph",
                    elements: [
                        {
                            type: "Text",
                            text: "one",
                            marks: [{type: "Comment", threadId: threadId1}],
                        },
                        {type: "Text", text: " "},
                        {
                            type: "Text",
                            text: "two",
                            marks: [{type: "Comment", threadId: threadId2}],
                        },
                        {type: "Text", text: " "},
                        {
                            type: "Text",
                            text: "three",
                            marks: [{type: "Comment", threadId: threadId3}],
                        },
                        {type: "Text", text: " "},
                        {
                            type: "Text",
                            text: "four",
                            marks: [{type: "Comment", threadId: threadId4}],
                        },
                        {type: "Text", text: " "},
                        {
                            type: "Text",
                            text: "five",
                            marks: [{type: "Comment", threadId: threadId5}],
                        },
                    ],
                },
            ],
        },
        markdown: `\
<comment id="1">one</comment> <comment id="2">two</comment> <comment id="3">three</comment> <comment id="4">four</comment> <comment id="5">five</comment>
`,
    },
    {
        name: "comment transformation in code blocks",
        content: {
            elements: [
                {
                    type: "Code",
                    language: "html",
                    lines: [
                        {
                            elements: [
                                {
                                    type: "Text",
                                    text: "alpha",
                                    marks: [{type: "Comment", threadId: threadId1}],
                                },
                                {type: "Text", text: " "},
                                {
                                    type: "Text",
                                    text: "beta",
                                    marks: [{type: "Comment", threadId: threadId2}],
                                },
                                {type: "Text", text: " "},
                                {
                                    type: "Text",
                                    text: "gamma",
                                    marks: [{type: "Comment", threadId: threadId1}],
                                },
                            ],
                        },
                    ],
                },
            ],
        },
        markdown: `\
<pre>
<code class="language-html">
<comment id="1">alpha</comment> <comment id="2">beta</comment> <comment id="1">gamma</comment>
</code>
</pre>
`,
    },
    {
        name: "comment transformation mixed with code blocks",
        content: {
            elements: [
                {
                    type: "Paragraph",
                    elements: [
                        {type: "Text", text: "Test: "},
                        {
                            type: "Text",
                            text: "one",
                            marks: [{type: "Comment", threadId: threadId1}],
                        },
                        {type: "Text", text: " "},
                        {
                            type: "Text",
                            text: "two",
                            marks: [{type: "Comment", threadId: threadId2}],
                        },
                    ],
                },
                {
                    type: "Code",
                    language: "html",
                    lines: [
                        {
                            elements: [
                                {
                                    type: "Text",
                                    text: "three",
                                    marks: [{type: "Comment", threadId: threadId3}],
                                },
                                {type: "Text", text: " "},
                                {
                                    type: "Text",
                                    text: "four",
                                    marks: [{type: "Comment", threadId: threadId4}],
                                },
                            ],
                        },
                    ],
                },
                {
                    type: "Paragraph",
                    elements: [
                        {type: "Text", text: "Test: "},
                        {
                            type: "Text",
                            text: "five",
                            marks: [{type: "Comment", threadId: threadId5}],
                        },
                    ],
                },
            ],
        },
        markdown: `\
Test: <comment id="1">one</comment> <comment id="2">two</comment>

<pre>
<code class="language-html">
<comment id="3">three</comment> <comment id="4">four</comment>
</code>
</pre>

Test: <comment id="5">five</comment>
`,
    },
    {
        name: "unfinished escaped HTML tag at content end",
        content: {
            elements: [
                {
                    type: "Paragraph",
                    elements: [
                        {type: "Text", text: "<", marks: []},
                        {type: "Text", text: "A", marks: []},
                    ],
                },
            ],
        },
        markdown: `\
\\<A
`,
    },
    {
        name: "unfinished HTML tag inside code block",
        content: {
            elements: [
                {
                    type: "Code",
                    language: "java",
                    lines: [
                        {
                            elements: [
                                {type: "Text", text: "<", marks: []},
                                {type: "Text", text: "A", marks: []},
                            ],
                        },
                    ],
                },
            ],
        },
        markdown: `\
\`\`\`java
<A
\`\`\`
`,
    },
    {
        name: "task preview element",
        content: {
            elements: [
                {
                    type: "Paragraph",
                    elements: [{type: "Text", text: "Review this today:"}],
                },
                {
                    type: "Preview",
                    target: {
                        type: "Task",
                        id: taskId,
                        title: "Fix auth",
                        status: {type: "Open", isActive: true},
                    },
                },
            ],
        },
        markdown: `\
Review this today:

![Fix auth (Open)](/task/fix-auth)
`,
    },
    {
        name: "image file element",
        content: {
            elements: [
                {
                    type: "File",
                    id: file1Id,
                    contentType: "image/png",
                    contentLength: 100,
                },
            ],
        },
        markdown: `\
![](/file/image.png)
`,
    },
    {
        name: "video file element",
        content: {
            elements: [
                {
                    type: "File",
                    id: file1Id,
                    contentType: "video/mp4",
                    contentLength: 100,
                },
            ],
        },
        markdown: `\
<video src="/file/video.mp4"></video>
`,
    },
    {
        name: "audio file element",
        content: {
            elements: [
                {
                    type: "File",
                    id: file1Id,
                    contentType: "audio/webm",
                    contentLength: 100,
                },
            ],
        },
        markdown: `\
<audio src="/file/audio.weba"></audio>
`,
    },
    {
        name: "PDF file element",
        content: {
            elements: [
                {
                    type: "File",
                    id: file1Id,
                    contentType: "application/pdf",
                    contentLength: 100,
                },
            ],
        },
        markdown: `\
<object data="/file/file.pdf"></object>
`,
    },
    {
        name: "file row (2)",
        content: {
            elements: [
                {
                    type: "FileGallery",
                    rows: [
                        {
                            items: [
                                {
                                    width: 0.5,
                                    element: {
                                        type: "File",
                                        id: file1Id,
                                        contentType: "image/png",
                                        contentLength: 100,
                                    },
                                },
                                {
                                    width: 0.5,
                                    element: {
                                        type: "File",
                                        id: file2Id,
                                        contentType: "video/mp4",
                                        contentLength: 200,
                                    },
                                },
                            ],
                        },
                    ],
                },
            ],
        },
        markdown: `\
<div style="display: flex">
<img src="/file/image.png" />
<video src="/file/video.mp4"></video>
</div>
`,
    },
    {
        name: "file row with previews",
        content: {
            elements: [
                {
                    type: "FileGallery",
                    rows: [
                        {
                            items: [
                                {
                                    width: 0.5,
                                    element: {
                                        type: "Preview",
                                        target: {
                                            type: "Task",
                                            id: taskId,
                                            title: "Fix auth",
                                            status: {type: "Open", isActive: true},
                                        },
                                    },
                                },
                                {
                                    width: 0.5,
                                    element: {
                                        type: "Preview",
                                        target: {
                                            type: "Document",
                                            id: documentId,
                                            title: "My Document",
                                        },
                                    },
                                },
                            ],
                        },
                    ],
                },
            ],
        },
        markdown: `\
<div style="display: flex">
<img alt="Fix auth (Open)" src="/task/fix-auth" />
<img alt="My Document" src="/document/my-document" />
</div>
`,
    },
    {
        name: "file row (3)",
        content: {
            elements: [
                {
                    type: "FileGallery",
                    rows: [
                        {
                            items: [
                                {
                                    width: 0.3,
                                    element: {
                                        type: "File",
                                        id: file1Id,
                                        contentType: "image/png",
                                        contentLength: 100,
                                    },
                                },
                                {
                                    width: 0.3,
                                    element: {
                                        type: "File",
                                        id: file2Id,
                                        contentType: "video/mp4",
                                        contentLength: 200,
                                    },
                                },
                                {
                                    width: 0.4,
                                    element: {
                                        type: "File",
                                        id: file3Id,
                                        contentType: "application/pdf",
                                        contentLength: 300,
                                    },
                                },
                            ],
                        },
                    ],
                },
            ],
        },
        markdown: `\
<div style="display: flex">
<img src="/file/image.png" />
<video src="/file/video.mp4"></video>
<object data="/file/file.pdf"></object>
</div>
`,
    },
    {
        name: "file gallery",
        content: {
            elements: [
                {
                    type: "FileGallery",
                    rows: [
                        {
                            items: [
                                {
                                    width: 0.3,
                                    element: {
                                        type: "File",
                                        id: file1Id,
                                        contentType: "image/png",
                                        contentLength: 100,
                                    },
                                },
                                {
                                    width: 0.3,
                                    element: {
                                        type: "File",
                                        id: file2Id,
                                        contentType: "video/mp4",
                                        contentLength: 200,
                                    },
                                },
                                {
                                    width: 0.4,
                                    element: {
                                        type: "File",
                                        id: file3Id,
                                        contentType: "application/pdf",
                                        contentLength: 300,
                                    },
                                },
                            ],
                        },
                        {
                            items: [
                                {
                                    width: 0.5,
                                    element: {
                                        type: "File",
                                        id: file4Id,
                                        contentType: "audio/webm",
                                        contentLength: 400,
                                    },
                                },
                                {
                                    width: 0.5,
                                    element: {
                                        type: "File",
                                        id: file5Id,
                                        contentType: "image/gif",
                                        contentLength: 500,
                                    },
                                },
                            ],
                        },
                    ],
                },
            ],
        },
        markdown: `\
<div style="display: flex">
<img src="/file/image.png" />
<video src="/file/video.mp4"></video>
<object data="/file/file.pdf"></object>
</div>

<div style="display: flex">
<audio src="/file/audio.weba"></audio>
<img src="/file/image.gif" />
</div>
`,
    },
    {
        name: "file gallery with row with one item",
        content: {
            elements: [
                {
                    type: "FileGallery",
                    rows: [
                        {
                            items: [
                                {
                                    width: 0.3,
                                    element: {
                                        type: "File",
                                        id: file1Id,
                                        contentType: "image/png",
                                        contentLength: 100,
                                    },
                                },
                                {
                                    width: 0.3,
                                    element: {
                                        type: "File",
                                        id: file2Id,
                                        contentType: "video/mp4",
                                        contentLength: 200,
                                    },
                                },
                                {
                                    width: 0.4,
                                    element: {
                                        type: "File",
                                        id: file3Id,
                                        contentType: "application/pdf",
                                        contentLength: 300,
                                    },
                                },
                            ],
                        },
                        {
                            items: [
                                {
                                    width: 1,
                                    element: {
                                        type: "File",
                                        id: file6Id,
                                        contentType: "image/avif",
                                        contentLength: 600,
                                    },
                                },
                            ],
                        },
                        {
                            items: [
                                {
                                    width: 0.5,
                                    element: {
                                        type: "File",
                                        id: file4Id,
                                        contentType: "audio/webm",
                                        contentLength: 400,
                                    },
                                },
                                {
                                    width: 0.5,
                                    element: {
                                        type: "File",
                                        id: file5Id,
                                        contentType: "image/gif",
                                        contentLength: 500,
                                    },
                                },
                            ],
                        },
                    ],
                },
            ],
        },
        markdown: `\
<div style="display: flex">
<img src="/file/image.png" />
<video src="/file/video.mp4"></video>
<object data="/file/file.pdf"></object>
</div>

![](/file/image.avif)

<div style="display: flex">
<audio src="/file/audio.weba"></audio>
<img src="/file/image.gif" />
</div>
`,
    },
    {
        name: "file float",
        content: {
            elements: [
                {
                    type: "FileFloat",
                    side: "Left",
                    element: {
                        type: "File",
                        id: file1Id,
                        contentType: "image/png",
                        contentLength: 100,
                    },
                },
            ],
        },
        markdown: `\
<div style="float: left">
<img src="/file/image.png" />
</div>
`,
    },
    {
        name: "file float with preview",
        content: {
            elements: [
                {
                    type: "FileFloat",
                    side: "Left",
                    element: {
                        type: "Preview",
                        target: {
                            type: "Task",
                            id: taskId,
                            title: "Fix auth",
                            status: {type: "Open", isActive: true},
                        },
                    },
                },
            ],
        },
        markdown: `\
<div style="float: left">
<img alt="Fix auth (Open)" src="/task/fix-auth" />
</div>
`,
    },
];

for (const {only, name, content: expectedContent, markdown: expectedMarkdown} of testCases) {
    const describe = only ? globalThis.describe.only : globalThis.describe;

    describe(name, () => {
        test("prints to agent web markdown", async () => {
            const contextDocumentId = generateId<DocumentId>();

            const actualMarkdown = await printApiContentToAgentWebMarkdown(
                storage,
                expectedContent,
                {documentId: contextDocumentId},
            );

            expect(actualMarkdown).toEqual(expectedMarkdown);
        });

        test("parses agent web markdown back to content", async () => {
            const contextDocumentId = generateId<DocumentId>();

            const actualMarkdown = await printApiContentToAgentWebMarkdown(
                storage,
                expectedContent,
                {documentId: contextDocumentId},
            );

            const actualContent = await parseApiContentFromAgentWebMarkdown(
                storage,
                actualMarkdown,
                {documentId: contextDocumentId},
            );

            expect(normalizeApiContentResponse(actualContent)).toEqual(
                normalizeApiContentResponse(expectedContent, {
                    withoutFileGalleryElementRowItemWidth: true,
                }),
            );
        });

        test("parses agent web markdown back to content with `AgentWebMarkdownStreamParser`", async () => {
            const contextDocumentId = generateId<DocumentId>();

            const actualMarkdown = await printApiContentToAgentWebMarkdown(
                storage,
                expectedContent,
                {documentId: contextDocumentId},
            );

            const parser = new AgentWebMarkdownStreamParser({
                storage,
                documentId: contextDocumentId,
            });
            const markdownTokens = encodeO200kBase(actualMarkdown);

            let nextUpdate = randomInteger(1, 5);

            for (const markdownToken of markdownTokens) {
                parser.pushText(null, decodeO200kBase([markdownToken]));

                // Update randomly within the message to exercise parse throttling choosing to
                // update at arbitrary times.
                nextUpdate--;
                if (nextUpdate === 0) {
                    await parser.update(null);
                    nextUpdate = randomInteger(1, 5);
                }
            }

            // Always perform one last update.
            await parser.update(null);

            const elements: Array<ApiContentBlockElementResponse> = [];

            for (const part of parser.getParts()) {
                // We only push text so there should be only content parts.
                if (part.payload.type !== "Content") continue;

                for (const element of part.payload.content.elements) {
                    elements.push(element);
                }
            }

            const actualContent: ApiContentResponse = {elements};

            expect(normalizeApiContentResponse(actualContent)).toEqual(
                normalizeApiContentResponse(expectedContent, {
                    withoutFileGalleryElementRowItemWidth: true,
                }),
            );
        });
    });
}
