import {
    AgentWebMessagingPageBase,
    agentWebMessagingPageMessageNouns,
    parseAgentWebMessagingPageBase,
    printAgentWebMessagingPageBase,
} from "~/server/agents/web/pages/agent_web_messaging_page_base.js";
import {runAgentWebPageTests} from "~/server/agents/web/pages/run_agent_web_page_tests.js";
import {
    ApiContentInlineElementMark,
    ApiContentInlineElementResponse,
    ApiContentParagraphBlockElementResponse,
    ApiContentResponse,
    ApiContentTextInlineElement,
} from "~/shared/api/specification/types/api_specification_convenience_types.js";
import {assertId, generateId} from "~/shared/id/id.js";
import {AccountId, ChatId, DocumentCommentThreadId} from "~/shared/id/types/id_types.js";

const apostrophe = String.fromCharCode(39);
const doubleQuote = String.fromCharCode(34);
const paginationChatId = generateId<ChatId>();

function content(elements: ApiContentResponse["elements"]): ApiContentResponse {
    return {elements};
}

function paragraph(
    elements: ReadonlyArray<ApiContentInlineElementResponse>,
): ApiContentParagraphBlockElementResponse {
    return {type: "Paragraph", elements};
}

function text(
    text: string,
    marks?: ReadonlyArray<ApiContentInlineElementMark>,
): ApiContentTextInlineElement {
    return {type: "Text", text, marks};
}

runAgentWebPageTests<true, AgentWebMessagingPageBase>({
    print: printAgentWebMessagingPageBase.bind(null, agentWebMessagingPageMessageNouns),
    parse: parseAgentWebMessagingPageBase.bind(null, agentWebMessagingPageMessageNouns),
    tests: [
        {
            name: "simple message log",
            pageLink: true,
            markdown: `\
<time>May 13, 2026 3:00 PM EDT</time>

<human name="Alice">

Hello there.

</human>
`,
            page: {
                preamble: {elements: [], paginationLink: null},
                blocks: [
                    {
                        type: "Time",
                        timeContent: "May 13, 2026 3:00 PM EDT",
                    },
                    {
                        type: "Message",
                        tagName: "human",
                        nameAttribute: "Alice",
                        timeAttribute: null,
                        timeZoneAttribute: null,
                        parent: null,
                        content: content([paragraph([text("Hello there.")])]),
                    },
                ],
            },
        },
        {
            name: "preamble before message log",
            pageLink: true,
            markdown: `\
Viewing the **launch** thread for [Alpine](https://example.com/alpine).

<human name="Alice">

Hello there.

</human>
`,
            page: {
                preamble: {
                    elements: [
                        text("Viewing the "),
                        text("launch", [{type: "Bold"}]),
                        text(" thread for "),
                        text("Alpine", [{type: "Link", url: "https://example.com/alpine"}]),
                        text("."),
                    ],
                    paginationLink: null,
                },
                blocks: [
                    {
                        type: "Message",
                        tagName: "human",
                        nameAttribute: "Alice",
                        timeAttribute: null,
                        timeZoneAttribute: null,
                        parent: null,
                        content: content([paragraph([text("Hello there.")])]),
                    },
                ],
            },
        },
        {
            name: "preamble before time block",
            pageLink: true,
            markdown: `\
The current page starts after the May planning sync.

<time>May 13, 2026 3:00 PM EDT</time>

<human name="Alice">

Hello there.

</human>
`,
            page: {
                preamble: {
                    elements: [text("The current page starts after the May planning sync.")],
                    paginationLink: null,
                },
                blocks: [
                    {
                        type: "Time",
                        timeContent: "May 13, 2026 3:00 PM EDT",
                    },
                    {
                        type: "Message",
                        tagName: "human",
                        nameAttribute: "Alice",
                        timeAttribute: null,
                        timeZoneAttribute: null,
                        parent: null,
                        content: content([paragraph([text("Hello there.")])]),
                    },
                ],
            },
        },
        {
            name: "preamble without message blocks",
            pageLink: true,
            markdown: `\
No messages matched the current filters.
`,
            page: {
                preamble: {
                    elements: [text("No messages matched the current filters.")],
                    paginationLink: null,
                },
                blocks: [],
            },
        },
        {
            name: "preamble with previous page pagination link",
            pageLink: true,
            markdown: `\
Some messages in Engineering Room. [Previous page »](/chat/engineering-room?before=3)
`,
            page: {
                preamble: {
                    elements: [text("Some messages in Engineering Room.")],
                    paginationLink: {
                        text: "Previous page »",
                        target: {
                            type: "Chat",
                            id: paginationChatId,
                            title: "Engineering Room",
                        },
                        searchParams: new URLSearchParams([["before", "3"]]),
                    },
                },
                blocks: [],
            },
            createParseError:
                "Can\u2019t add \u201CPrevious page »\u201D link when creating messages markdown. Try again without the \u201CPrevious page »\u201D link.",
        },
        {
            name: "preamble with next page pagination link",
            pageLink: true,
            markdown: `\
Some messages in Engineering Room. [Next page »](/chat/engineering-room?after=9)
`,
            page: {
                preamble: {
                    elements: [text("Some messages in Engineering Room.")],
                    paginationLink: {
                        text: "Next page »",
                        target: {
                            type: "Chat",
                            id: paginationChatId,
                            title: "Engineering Room",
                        },
                        searchParams: new URLSearchParams([["after", "9"]]),
                    },
                },
                blocks: [],
            },
            createParseError:
                "Can\u2019t add \u201CNext page »\u201D link when creating messages markdown. Try again without the \u201CNext page »\u201D link.",
        },
        {
            name: "bot message with reply preview and rich content",
            pageLink: true,
            markdown: `\
<bot name="Assistant" time="12 minutes later">

<blockquote cite="Alice">

Can you review **this**?

</blockquote>

## Plan

Review **now** and *carefully*.

\`\`\`javascript
const done = true;
\`\`\`

</bot>
`,
            page: {
                preamble: {elements: [], paginationLink: null},
                blocks: [
                    {
                        type: "Message",
                        tagName: "bot",
                        nameAttribute: "Assistant",
                        timeAttribute: "12 minutes later",
                        timeZoneAttribute: null,
                        parent: {
                            nameAttribute: "Alice",
                            previewContent: content([
                                paragraph([
                                    text("Can you review "),
                                    text("this", [{type: "Bold"}]),
                                    text("?"),
                                ]),
                            ]),
                        },
                        content: content([
                            {
                                type: "Heading",
                                level: 1,
                                elements: [text("Plan")],
                            },
                            paragraph([
                                text("Review "),
                                text("now", [{type: "Bold"}]),
                                text(" and "),
                                text("carefully", [{type: "Italic"}]),
                                text("."),
                            ]),
                            {
                                type: "Code",
                                language: "javascript",
                                lines: [
                                    {
                                        elements: [{type: "Text", text: "const done = true;"}],
                                    },
                                ],
                            },
                        ]),
                    },
                ],
            },
        },
        {
            name: "escaped messaging html",
            pageLink: true,
            markdown: `\
<time>May & \u0022Later\u0022 \\<soon></time>

<human name="Alice &amp; Bob&#39;s &quot;Team&quot;" time="5 &lt; 10 &amp; &quot;later&quot;" timezone="GMT+0 &amp; east">

<blockquote cite="Carol &amp; Dan&#39;s &quot;Team&quot;">

Quoted reply.

</blockquote>

Escaped attributes survive.

</human>
`,
            page: {
                preamble: {elements: [], paginationLink: null},
                blocks: [
                    {
                        type: "Time",
                        timeContent: `May & ${doubleQuote}Later${doubleQuote} <soon>`,
                    },
                    {
                        type: "Message",
                        tagName: "human",
                        nameAttribute: `Alice & Bob${apostrophe}s ${doubleQuote}Team${doubleQuote}`,
                        timeAttribute: `5 < 10 & ${doubleQuote}later${doubleQuote}`,
                        timeZoneAttribute: "GMT+0 & east",
                        parent: {
                            nameAttribute: `Carol & Dan${apostrophe}s ${doubleQuote}Team${doubleQuote}`,
                            previewContent: content([paragraph([text("Quoted reply.")])]),
                        },
                        content: content([paragraph([text("Escaped attributes survive.")])]),
                    },
                ],
            },
        },
        {
            name: "message content with html blocks",
            pageLink: true,
            markdown: `\
<human name="Alice">

<hr />

<p></p>

After the empty paragraph.

</human>
`,
            page: {
                preamble: {elements: [], paginationLink: null},
                blocks: [
                    {
                        type: "Message",
                        tagName: "human",
                        nameAttribute: "Alice",
                        timeAttribute: null,
                        timeZoneAttribute: null,
                        parent: null,
                        content: content([
                            {type: "Divider"},
                            paragraph([]),
                            paragraph([text("After the empty paragraph.")]),
                        ]),
                    },
                ],
            },
        },
        {
            name: "content after message",
            pageLink: true,
            markdown: `\
<human name="Alice">

Hello.

</human>

Hello outside.
`,
            parseError:
                "Unexpected markdown on line 7. Messages markdown must be a list of `<human>` or `<bot>` elements.",
        },
        {
            name: "preamble with multiple paragraphs",
            pageLink: true,
            markdown: `\
First paragraph.

Second paragraph.

<human name="Alice">

Hello.

</human>
`,
            parseError:
                "Unexpected markdown on line 1. Messages markdown must be a list of `<human>` or `<bot>` elements. Though it may start with a single paragraph with a short description of what we\u2019re looking at.",
        },
        {
            name: "preamble with non paragraph block",
            pageLink: true,
            markdown: `\
## Thread context

<human name="Alice">

Hello.

</human>
`,
            parseError:
                "Unexpected markdown on line 1. Messages markdown must be a list of `<human>` or `<bot>` elements. Though it may start with a single paragraph with a short description of what we\u2019re looking at.",
        },
        {
            name: "message without name attribute",
            pageLink: true,
            markdown: `\
<human>

Hello.

</human>
`,
            parseError:
                "`<human>` element on line 1 is missing the `name` attribute. All messages must include the name of the author.",
        },
        {
            name: "unclosed message",
            pageLink: true,
            markdown: `\
<bot name="Assistant">

Hello.
`,
            parseError:
                "`<bot>` element on line 1 is missing a closing tag. Add a `</bot>` closing tag and try again.",
        },
        {
            name: "nested message",
            pageLink: true,
            markdown: `\
<human name="Alice">

<bot name="Assistant">

Nested.

</bot>

</human>
`,
            parseError:
                "Can\u2019t open a new `<bot>` element on line 3. " +
                "There\u2019s already an open `<human>` element and you can\u2019t nest message elements.",
        },
        {
            name: "close message without open tag",
            pageLink: true,
            markdown: `\
</human>
`,
            parseError:
                "Can\u2019t close `</human>` element on line 1. " +
                "There isn\u2019t a matching `<human>` open tag.",
        },
        {
            name: "close mismatched message tag",
            pageLink: true,
            markdown: `\
<human name="Alice">

</bot>
`,
            parseError:
                "Can\u2019t close `</bot>` element on line 3. " +
                "There isn\u2019t a matching `<bot>` open tag.",
        },
        {
            name: "blockquote outside message",
            pageLink: true,
            markdown: `\
<blockquote cite="Alice">

Hello.

</blockquote>
`,
            parseError:
                "Can\u2019t add `<blockquote>` element on line 1. `<blockquote>` elements can only be used at the beginning of a `<human>` or `<bot>` message element to indicate that the message is a reply to some other message.",
        },
        {
            name: "blockquote after message content",
            pageLink: true,
            markdown: `\
<human name="Alice">

Message first.

<blockquote cite="Bob">

Late reply.

</blockquote>

</human>
`,
            parseError:
                "Can\u2019t add `<blockquote>` element on line 5. `<blockquote>` elements can only be used at the beginning of a `<human>` or `<bot>` message element to indicate that the message is a reply to some other message.",
        },
        {
            name: "second blockquote after reply preview",
            pageLink: true,
            markdown: `\
<human name="Alice">

<blockquote cite="Bob">

First reply.

</blockquote>

<blockquote cite="Carol">

Second reply.

</blockquote>

</human>
`,
            parseError:
                "Can\u2019t add `<blockquote>` element on line 9. `<blockquote>` elements can only be used at the beginning of a `<human>` or `<bot>` message element to indicate that the message is a reply to some other message.",
        },
        {
            name: "nested blockquote",
            pageLink: true,
            markdown: `\
<human name="Alice">

<blockquote cite="Bob">

<blockquote cite="Carol">

Nested reply.

</blockquote>

</blockquote>

</human>
`,
            parseError:
                "Can\u2019t open a new `<blockquote>` element on line 5. " +
                "There\u2019s already an open `<blockquote>` element and you can\u2019t nest `<blockquote>` elements. " +
                "If you\u2019re trying to reply to a message that itself is replying to another message then just include the content of the message you\u2019re replying to and omit the extra `<blockquote>` element.",
        },
        {
            name: "unclosed blockquote",
            pageLink: true,
            markdown: `\
<human name="Alice">

<blockquote cite="Bob">

Quoted.

</human>
`,
            parseError:
                "`<blockquote>` element on line 3 is missing a closing tag. Add a `</blockquote>` closing tag and try again.",
        },
        {
            name: "blockquote without cite attribute",
            pageLink: true,
            markdown: `\
<human name="Alice">

<blockquote>

Quoted.

</blockquote>

</human>
`,
            parseError:
                "`<blockquote>` element on line 1 is missing the `cite` attribute. Must include the name of the message author you\u2019re replying to.",
        },
        {
            name: "close blockquote without open tag",
            pageLink: true,
            markdown: `\
</blockquote>
`,
            parseError:
                "Can\u2019t close `</blockquote>` element on line 1. " +
                "There isn\u2019t a matching `<blockquote>` open tag.",
        },
        {
            name: "close blockquote without reply preview",
            pageLink: true,
            markdown: `\
<human name="Alice">

</blockquote>

</human>
`,
            parseError:
                "Can\u2019t close `</blockquote>` element on line 3. " +
                "There isn\u2019t a matching `<blockquote>` open tag.",
        },
        {
            name: "close blockquote twice",
            pageLink: true,
            markdown: `\
<human name="Alice">

<blockquote cite="Bob">

Quoted.

</blockquote>

</blockquote>

</human>
`,
            parseError:
                "Can\u2019t close `</blockquote>` element on line 9. " +
                "There isn\u2019t a matching `<blockquote>` open tag.",
        },
        {
            name: "message with inline html content",
            pageLink: true,
            markdown: `\
<human name="Alice">Hello.</human>
`,
            printMarkdown: `\
<human name="Alice">

Hello.

</human>
`,
            page: {
                preamble: {elements: [], paginationLink: null},
                blocks: [
                    {
                        type: "Message",
                        tagName: "human",
                        nameAttribute: "Alice",
                        timeAttribute: null,
                        timeZoneAttribute: null,
                        parent: null,
                        content: content([paragraph([text("Hello.")])]),
                    },
                ],
            },
        },
        {
            name: "message without newline between tags",
            pageLink: true,
            markdown: `\
<human name="Alice">
Hello there.
</human>
`,
            parseError:
                "Must add an empty new line between the `<human>` open tag and markdown text. Otherwise, due to a quirk in markdown, the text on line 2 will be parsed as HTML instead of markdown. The `<human>` element must be formatted like this: `<human>\\n\\n...\\n\\n</human>`.",
        },
        {
            name: "message without newline between tags (attached to open tag)",
            pageLink: true,
            markdown: `\
<human name="Alice">
foo

bar

</human>
`,
            parseError:
                "Must add an empty new line between the `<human>` open tag and markdown text. Otherwise, due to a quirk in markdown, the text on line 2 will be parsed as HTML instead of markdown. The `<human>` element must be formatted like this: `<human>\\n\\n...\\n\\n</human>`.",
        },
        {
            name: "message without newline between tags (attached to closed tag)",
            pageLink: true,
            markdown: `\
<human name="Alice">

foo

bar
</human>
`,
            printMarkdown: `\
<human name="Alice">

foo

bar&#x20;

</human>
`,
            page: {
                preamble: {elements: [], paginationLink: null},
                blocks: [
                    {
                        type: "Message",
                        tagName: "human",
                        nameAttribute: "Alice",
                        timeAttribute: null,
                        timeZoneAttribute: null,
                        parent: null,
                        content: content([paragraph([text("foo")]), paragraph([text("bar ")])]),
                    },
                ],
            },
        },
        {
            name: "parent on one line",
            pageLink: true,
            markdown: `\
<human name="Alice">

<blockquote cite="Bob">Hello, world!</blockquote>

Hello there.

</human>
`,
            parseError:
                "Must add an empty new line between the `<blockquote>` open tag and markdown text. Otherwise, due to a quirk in markdown, the text on line 3 will be parsed as HTML instead of markdown. The `<blockquote>` element must be formatted like this: `<blockquote>\\n\\n...\\n\\n</blockquote>`.",
        },
        {
            name: "parent without newline between tags",
            pageLink: true,
            markdown: `\
<human name="Alice">

<blockquote cite="Bob">
Hello, world!
</blockquote>

Hello there.

</human>
`,
            parseError:
                "Must add an empty new line between the `<blockquote>` open tag and markdown text. Otherwise, due to a quirk in markdown, the text on line 4 will be parsed as HTML instead of markdown. The `<blockquote>` element must be formatted like this: `<blockquote>\\n\\n...\\n\\n</blockquote>`.",
        },
        {
            name: "parent without newline between tags (attached to open tag)",
            pageLink: true,
            markdown: `\
<human name="Alice">

<blockquote cite="Bob">
foo

bar

</blockquote>

Hello there.

</human>
`,
            parseError:
                "Must add an empty new line between the `<blockquote>` open tag and markdown text. Otherwise, due to a quirk in markdown, the text on line 4 will be parsed as HTML instead of markdown. The `<blockquote>` element must be formatted like this: `<blockquote>\\n\\n...\\n\\n</blockquote>`.",
        },
        {
            name: "parent without newline between tags (attached to closed tag)",
            pageLink: true,
            markdown: `\
<human name="Alice">

<blockquote cite="Bob">

foo

bar
</blockquote>

Hello there.

</human>
`,
            printMarkdown: `\
<human name="Alice">

<blockquote cite="Bob">

foo

bar

</blockquote>

Hello there.

</human>
`,
            page: {
                preamble: {elements: [], paginationLink: null},
                blocks: [
                    {
                        type: "Message",
                        tagName: "human",
                        nameAttribute: "Alice",
                        timeAttribute: null,
                        timeZoneAttribute: null,
                        parent: {
                            nameAttribute: "Bob",
                            previewContent: content([
                                paragraph([text("foo")]),
                                paragraph([text("bar")]),
                            ]),
                        },
                        content: content([paragraph([text("Hello there.")])]),
                    },
                ],
            },
        },
        {
            name: "empty time",
            pageLink: true,
            markdown: `\
<time></time>
`,
            page: {
                preamble: {elements: [], paginationLink: null},
                blocks: [{type: "Time", timeContent: ""}],
            },
        },
        {
            only: "NOCOMMIT",
            name: "mention in preamble",
            pageLink: true,
            markdown: `\
[](/human/unknown)
`,
            page: {
                preamble: {
                    elements: [
                        {
                            type: "Mention",
                            target: {
                                type: "Account",
                                id: assertId<AccountId>("00000000000000000000000000"),
                                title: "",
                                shortName: "",
                            },
                            isAccountShortName: false,
                            marks: [],
                        },
                    ],
                    paginationLink: null,
                },
                blocks: [],
            },
        },
    ],
});
