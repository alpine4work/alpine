import {
    decode as decodeO200kBase,
    encode as encodeO200kBase,
} from "gpt-tokenizer/esm/encoding/o200k_base";
import {AgentWebMarkdownStreamParser} from "~/server/agents/web/agent_web_markdown_stream_parser.js";
import {normalizeApiContentForAgentWebMarkdown} from "~/server/agents/web/normalize_api_content_for_agent_web_markdown.js";
import {parseApiContentFromAgentWebMarkdown} from "~/server/agents/web/parse_api_content_from_agent_web_markdown.js";
import {printApiContentToAgentWebMarkdown} from "~/server/agents/web/print_api_content_to_agent_web_markdown.js";
import {createAgentWebSessionStorageForTest} from "~/server/agents/web/test_helpers/create_agent_web_session_storage_for_test.js";
import {
    ApiContentBlockElementResponseWithoutKeys,
    ApiContentResponseWithoutKeys,
} from "~/shared/api/specification/types/api_specification_convenience_types.js";
import {randomInteger} from "~/shared/helpers/number/random_integer.js";
import {CommitBlocker} from "~/shared/helpers/types/commit_blocker.js";
import {generateChronologicalId} from "~/shared/id/chronological_id.js";
import {assertId, generateId} from "~/shared/id/id.js";
import {
    AccountId,
    BotId,
    ChannelId,
    DocumentCommentThreadId,
    DocumentId,
    FileId,
    PostId,
    SiteId,
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
const postId = generateId<PostId>();

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
    content: ApiContentResponseWithoutKeys;
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
                            reference: {
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
Review [Fix auth (Open, active)](/task/fix-auth) today
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
                            reference: {
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
_Review [Fix auth (Open, active)](/task/fix-auth) today_
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
                            reference: {
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
\`Review \`<code>[Fix auth (Open, active)](/task/fix-auth)</code>\` today\`
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
                            reference: {
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
[Review ](https://example.com)<a href="https://example.com">[Fix auth (Open, active)](/task/fix-auth)</a>[ today](https://example.com)
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
                            reference: {
                                type: "Document",
                                id: documentId,
                                title: "Product Spec",
                            },
                        },
                        {type: "Text", text: " and "},
                        {
                            type: "Mention",
                            reference: {
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
                            reference: {
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
                            reference: {
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
                            reference: {
                                type: "Account",
                                id: chatGptAccountId,
                                title: "ChatGPT",
                                shortName: "ChatGPT",
                                bot: {id: chatGptBotId},
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
                            reference: {
                                type: "Account",
                                id: chatGptAccountId,
                                title: "ChatGPT",
                                shortName: "ChatGPT",
                                bot: {id: chatGptBotId},
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
                                            elements: [{type: "Text", text: "a"}],
                                        },
                                    ],
                                },
                                {
                                    elements: [
                                        {
                                            type: "Paragraph",
                                            elements: [{type: "Text", text: "b"}],
                                        },
                                    ],
                                },
                                {
                                    elements: [
                                        {
                                            type: "Paragraph",
                                            elements: [{type: "Text", text: "c"}],
                                        },
                                    ],
                                },
                                {
                                    elements: [
                                        {
                                            type: "Paragraph",
                                            elements: [{type: "Text", text: "d"}],
                                        },
                                    ],
                                },
                                {
                                    elements: [
                                        {
                                            type: "Paragraph",
                                            elements: [{type: "Text", text: "e"}],
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

a

</th>
<td>

b

</td>
<td>

c

</td>
<td>

d

</td>
<td>

e

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
                            marks: [{type: "Comment", thread: {id: threadId1}}],
                        },
                        {type: "Text", text: " "},
                        {
                            type: "Text",
                            text: "beta",
                            marks: [{type: "Comment", thread: {id: threadId2}}],
                        },
                        {type: "Text", text: " "},
                        {
                            type: "Text",
                            text: "gamma",
                            marks: [{type: "Comment", thread: {id: threadId1}}],
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
                            marks: [{type: "Comment", thread: {id: threadId1}}],
                        },
                        {type: "Text", text: " "},
                        {
                            type: "Text",
                            text: "two",
                            marks: [{type: "Comment", thread: {id: threadId2}}],
                        },
                        {type: "Text", text: " "},
                        {
                            type: "Text",
                            text: "three",
                            marks: [{type: "Comment", thread: {id: threadId3}}],
                        },
                        {type: "Text", text: " "},
                        {
                            type: "Text",
                            text: "four",
                            marks: [{type: "Comment", thread: {id: threadId4}}],
                        },
                        {type: "Text", text: " "},
                        {
                            type: "Text",
                            text: "five",
                            marks: [{type: "Comment", thread: {id: threadId5}}],
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
                                    marks: [{type: "Comment", thread: {id: threadId1}}],
                                },
                                {type: "Text", text: " "},
                                {
                                    type: "Text",
                                    text: "beta",
                                    marks: [{type: "Comment", thread: {id: threadId2}}],
                                },
                                {type: "Text", text: " "},
                                {
                                    type: "Text",
                                    text: "gamma",
                                    marks: [{type: "Comment", thread: {id: threadId1}}],
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
                            marks: [{type: "Comment", thread: {id: threadId1}}],
                        },
                        {type: "Text", text: " "},
                        {
                            type: "Text",
                            text: "two",
                            marks: [{type: "Comment", thread: {id: threadId2}}],
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
                                    marks: [{type: "Comment", thread: {id: threadId3}}],
                                },
                                {type: "Text", text: " "},
                                {
                                    type: "Text",
                                    text: "four",
                                    marks: [{type: "Comment", thread: {id: threadId4}}],
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
                            marks: [{type: "Comment", thread: {id: threadId5}}],
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
                    reference: {
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

![Fix auth (Open, active)](/task/fix-auth)
`,
    },
    {
        name: "image file element",
        content: {
            elements: [
                {
                    type: "File",
                    file: {
                        id: file1Id,
                        contentType: "image/png",
                        contentLength: 100,
                    },
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
                    file: {
                        id: file1Id,
                        contentType: "video/mp4",
                        contentLength: 100,
                    },
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
                    file: {
                        id: file1Id,
                        contentType: "audio/webm",
                        contentLength: 100,
                    },
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
                    file: {
                        id: file1Id,
                        contentType: "application/pdf",
                        contentLength: 100,
                    },
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
                                        file: {
                                            id: file1Id,
                                            contentType: "image/png",
                                            contentLength: 100,
                                        },
                                    },
                                },
                                {
                                    width: 0.5,
                                    element: {
                                        type: "File",
                                        file: {
                                            id: file2Id,
                                            contentType: "video/mp4",
                                            contentLength: 200,
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
                                        reference: {
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
                                        reference: {
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
<img alt="Fix auth (Open, active)" src="/task/fix-auth" />
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
                                        file: {
                                            id: file1Id,
                                            contentType: "image/png",
                                            contentLength: 100,
                                        },
                                    },
                                },
                                {
                                    width: 0.3,
                                    element: {
                                        type: "File",
                                        file: {
                                            id: file2Id,
                                            contentType: "video/mp4",
                                            contentLength: 200,
                                        },
                                    },
                                },
                                {
                                    width: 0.4,
                                    element: {
                                        type: "File",
                                        file: {
                                            id: file3Id,
                                            contentType: "application/pdf",
                                            contentLength: 300,
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
                                        file: {
                                            id: file1Id,
                                            contentType: "image/png",
                                            contentLength: 100,
                                        },
                                    },
                                },
                                {
                                    width: 0.3,
                                    element: {
                                        type: "File",
                                        file: {
                                            id: file2Id,
                                            contentType: "video/mp4",
                                            contentLength: 200,
                                        },
                                    },
                                },
                                {
                                    width: 0.4,
                                    element: {
                                        type: "File",
                                        file: {
                                            id: file3Id,
                                            contentType: "application/pdf",
                                            contentLength: 300,
                                        },
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
                                        file: {
                                            id: file4Id,
                                            contentType: "audio/webm",
                                            contentLength: 400,
                                        },
                                    },
                                },
                                {
                                    width: 0.5,
                                    element: {
                                        type: "File",
                                        file: {
                                            id: file5Id,
                                            contentType: "image/gif",
                                            contentLength: 500,
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
                                        file: {
                                            id: file1Id,
                                            contentType: "image/png",
                                            contentLength: 100,
                                        },
                                    },
                                },
                                {
                                    width: 0.3,
                                    element: {
                                        type: "File",
                                        file: {
                                            id: file2Id,
                                            contentType: "video/mp4",
                                            contentLength: 200,
                                        },
                                    },
                                },
                                {
                                    width: 0.4,
                                    element: {
                                        type: "File",
                                        file: {
                                            id: file3Id,
                                            contentType: "application/pdf",
                                            contentLength: 300,
                                        },
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
                                        file: {
                                            id: file6Id,
                                            contentType: "image/avif",
                                            contentLength: 600,
                                        },
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
                                        file: {
                                            id: file4Id,
                                            contentType: "audio/webm",
                                            contentLength: 400,
                                        },
                                    },
                                },
                                {
                                    width: 0.5,
                                    element: {
                                        type: "File",
                                        file: {
                                            id: file5Id,
                                            contentType: "image/gif",
                                            contentLength: 500,
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
                        file: {
                            id: file1Id,
                            contentType: "image/png",
                            contentLength: 100,
                        },
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
                        reference: {
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
<img alt="Fix auth (Open, active)" src="/task/fix-auth" />
</div>
`,
    },
    {
        name: "HTML characters in post preview title",
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
                                        reference: {
                                            type: "Post",
                                            id: assertId<PostId>("036btbmcmnnpqfjnnf42zmft3g"),
                                            // eslint-disable-next-line cyberworlds/string-quotes
                                            title: '"q*>',
                                        },
                                    },
                                },
                                {
                                    width: 0.5,
                                    element: {
                                        type: "File",
                                        file: {
                                            id: assertId<FileId>("r3xsmjpecc4k0qp6tz6tebrm6c"),
                                            contentType: "audio/mpeg",
                                            contentLength: 1200813419,
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
<img alt="&quot;q*&gt;" src="/post/q" />
<audio src="/file/audio.mp3"></audio>
</div>
`,
    },
    {
        name: "account mentions with same ID but different names",
        content: {
            elements: [
                {
                    type: "Paragraph",
                    elements: [
                        {
                            type: "Mention",
                            reference: {
                                type: "Account",
                                id: assertId<AccountId>("9cc1wj4he4p7eka2qjgjpf4hsg"),
                                title: "Caleb",
                                shortName: "Caleb",
                            },
                            isAccountShortName: undefined,
                            marks: undefined,
                        },
                    ],
                },
                {
                    type: "Paragraph",
                    elements: [
                        {
                            type: "Mention",
                            reference: {
                                type: "Account",
                                id: assertId<AccountId>("9cc1wj4he4p7eka2qjgjpf4hsg"),
                                title: "Caleb Meredith",
                                shortName: "Caleb",
                            },
                            isAccountShortName: undefined,
                            marks: undefined,
                        },
                    ],
                },
            ],
        },
        markdown: `\
[Caleb Meredith](/human/caleb-meredith)

[Caleb Meredith](/human/caleb-meredith)
`,
    },
    {
        name: "channels with same ID but different titles",
        content: {
            elements: [
                {
                    type: "Paragraph",
                    elements: [
                        {
                            type: "Mention",
                            reference: {
                                type: "Channel",
                                id: assertId<ChannelId>("a3en105tcat68mbgnkdnj9w7t0"),
                                title: "aaaaaaaa",
                            },
                        },
                    ],
                },
                {
                    type: "Paragraph",
                    elements: [
                        {
                            type: "Mention",
                            reference: {
                                type: "Channel",
                                id: assertId<ChannelId>("a3en105tcat68mbgnkdnj9w7t0"),
                                title: "bbbbbbbb",
                            },
                        },
                    ],
                },
            ],
        },
        markdown: `\
[bbbbbbbb](/channel/bbbbbbbb)

[bbbbbbbb](/channel/bbbbbbbb)
`,
    },
    {
        name: "tasks with same ID but different statuses across mention and preview",
        content: {
            elements: [
                {
                    type: "Paragraph",
                    elements: [
                        {
                            type: "Mention",
                            reference: {
                                type: "Task",
                                id: assertId<TaskId>("q44py4538q3gyt63ykgz44q9ew"),
                                title: "aaaaaaaa",
                                status: {type: "Open", isActive: false},
                            },
                            isAccountShortName: false,
                            marks: [],
                        },
                    ],
                },
                {
                    type: "FileGallery",
                    rows: [
                        {
                            items: [
                                {
                                    width: 1,
                                    element: {
                                        type: "Preview",
                                        reference: {
                                            type: "Task",
                                            id: assertId<TaskId>("q44py4538q3gyt63ykgz44q9ew"),
                                            title: "aaaaaaaa",
                                            status: {type: "Closed"},
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
[aaaaaaaa (Closed)](/task/aaaaaaaa)

![aaaaaaaa (Closed)](/task/aaaaaaaa)
`,
    },
    {
        name: "posts with same ID but different titles across file gallery and mention",
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
                                        reference: {
                                            type: "Post",
                                            id: assertId<PostId>("k9f12ww1stzwy3bcgctwfhrpxw"),
                                            title: "aaaaaaaa",
                                        },
                                    },
                                },
                                {
                                    width: 0.5,
                                    element: {
                                        type: "File",
                                        file: {
                                            id: assertId<FileId>("hkwdk6myqtdq71j7e2rmy0am84"),
                                            contentType: "application/octet-stream",
                                            contentLength: 0,
                                        },
                                    },
                                },
                            ],
                        },
                    ],
                },
                {
                    type: "Paragraph",
                    elements: [
                        {
                            type: "Mention",
                            reference: {
                                type: "Post",
                                id: assertId<PostId>("k9f12ww1stzwy3bcgctwfhrpxw"),
                                title: "bbbbbbbb",
                            },
                        },
                    ],
                },
            ],
        },
        markdown: `\
<div style="display: flex">
<img alt="bbbbbbbb" src="/post/bbbbbbbb" />
<object data="/file/file.bin"></object>
</div>

[bbbbbbbb](/post/bbbbbbbb)
`,
    },
    {
        name: "files with the same ID but different content lengths",
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
                                        file: {
                                            id: file1Id,
                                            contentType: "image/png",
                                            contentLength: 100,
                                        },
                                    },
                                },
                                {
                                    width: 0.5,
                                    element: {
                                        type: "File",
                                        file: {
                                            id: file1Id,
                                            contentType: "video/mp4",
                                            contentLength: 200,
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
<video src="/file/video.mp4"></video>
<video src="/file/video.mp4"></video>
</div>
`,
    },
    {
        name: "post preview with strange title",
        content: {
            elements: [
                {
                    type: "FileFloat",
                    side: "Left",
                    element: {
                        type: "Preview",
                        // eslint-disable-next-line cyberworlds/string-quotes
                        reference: {type: "Post", id: postId, title: '">'},
                    },
                },
            ],
        },
        markdown: `\
<div style="float: left">
<img alt="&quot;&gt;" src="/post/unknown" />
</div>
`,
    },
    {
        name: "almost GFM table with uneven column counts",
        content: {
            elements: [
                {
                    type: "Table",
                    width: 1,
                    hasHeaderRow: true,
                    hasHeaderColumn: false,
                    columns: [{width: 1}, {width: 1}],
                    rows: [
                        {
                            cells: [
                                {elements: [{type: "Paragraph", elements: []}]},
                                {elements: [{type: "Paragraph", elements: []}]},
                                {elements: [{type: "Paragraph", elements: []}]},
                            ],
                        },
                        {
                            cells: [
                                {elements: [{type: "Paragraph", elements: []}]},
                                {elements: [{type: "Paragraph", elements: []}]},
                            ],
                        },
                    ],
                },
            ],
        },
        markdown: `\
<table>
<thead>
<tr>
<th>

</th>
<th>

</th>
<th>

</th>
</tr>
</thead>
<tbody>
<tr>
<td>

</td>
<td>

</td>
</tr>
</tbody>
</table>
`,
    },
    {
        name: "comment on file in gallery",
        content: {
            elements: [
                {
                    type: "Code",
                    language: "dart",
                    lines: [
                        {
                            elements: [
                                {
                                    type: "Text",
                                    text: " ",
                                    marks: [
                                        {
                                            type: "Comment",
                                            thread: {
                                                id: assertId<DocumentCommentThreadId>(
                                                    "00000000000000000000000000",
                                                ),
                                            },
                                        },
                                    ],
                                },
                            ],
                        },
                    ],
                },
                {
                    type: "FileGallery",
                    rows: [
                        {
                            items: [
                                {
                                    width: 0.5,
                                    element: {
                                        type: "File",
                                        file: {
                                            id: assertId<FileId>("sedwmv127rwjkm2vgegznrkxtg"),
                                            contentType: "video/mp4",
                                            contentLength: 0,
                                        },
                                        marks: [
                                            {
                                                type: "Comment",
                                                thread: {
                                                    id: assertId<DocumentCommentThreadId>(
                                                        "01a00000000000000000000000",
                                                    ),
                                                },
                                            },
                                        ],
                                    },
                                },
                                {
                                    width: 0.5,
                                    element: {
                                        type: "File",
                                        file: {
                                            id: assertId<FileId>("00000000000000000000000000"),
                                            contentType: "image/jpeg",
                                            contentLength: 0,
                                        },
                                        marks: [],
                                    },
                                },
                            ],
                        },
                        {
                            items: [
                                {
                                    width: 1,
                                    element: {
                                        type: "Preview",
                                        reference: {
                                            type: "Site",
                                            id: assertId<SiteId>("6hwpxgvn2tzaw6rwjnf6r1wzrm"),
                                            title: "",
                                        },
                                        marks: [],
                                    },
                                },
                            ],
                        },
                    ],
                },
            ],
        },
        markdown: `\
<pre>
<code class="language-dart">
<comment id="1"> </comment>
</code>
</pre>

<div style="display: flex">
<comment id="2"><video src="/file/video.mp4"></video></comment>
<img src="/file/image.jpeg" />
</div>

![](/site/unknown)
`,
    },
];

for (const {only, name, content: expectedContent, markdown: expectedMarkdown} of testCases) {
    const describe = only ? globalThis.describe.only : globalThis.describe;

    const normalizedExpectedContent = normalizeApiContentForAgentWebMarkdown(expectedContent);

    describe(name, () => {
        test("prints to agent web markdown", async () => {
            const contextDocumentId = generateId<DocumentId>();

            const actualMarkdown = await printApiContentToAgentWebMarkdown(
                storage,
                normalizedExpectedContent,
                {documentId: contextDocumentId},
            );

            expect(actualMarkdown).toEqual(expectedMarkdown);
        });

        test("parses agent web markdown back to content", async () => {
            const contextDocumentId = generateId<DocumentId>();

            const actualMarkdown = await printApiContentToAgentWebMarkdown(
                storage,
                normalizedExpectedContent,
                {documentId: contextDocumentId},
            );

            const actualContent = await parseApiContentFromAgentWebMarkdown(
                storage,
                actualMarkdown,
                {documentId: contextDocumentId},
            );

            // We expect `parseApiContentFromAgentWebMarkdown()` to produce normalized content
            // so we don't call `normalizeApiContent()` on `actualContent`.
            expect(actualContent).toEqual(normalizedExpectedContent);
        });

        test("parses agent web markdown back to content with `AgentWebMarkdownStreamParser`", async () => {
            const contextDocumentId = generateId<DocumentId>();

            const actualMarkdown = await printApiContentToAgentWebMarkdown(
                storage,
                normalizedExpectedContent,
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

            const elements: Array<ApiContentBlockElementResponseWithoutKeys> = [];

            for (const part of parser.getParts()) {
                // We only push text so there should be only content parts.
                if (part.payload.type !== "Content") continue;

                for (const element of part.payload.content.elements) {
                    elements.push(element);
                }
            }

            const actualContent: ApiContentResponseWithoutKeys = {elements};

            expect(normalizeApiContentForAgentWebMarkdown(actualContent)).toEqual(
                normalizeApiContentForAgentWebMarkdown(expectedContent),
            );
        });
    });
}
