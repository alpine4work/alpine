import {
    AgentWebMessagingPage,
    agentWebMessagingPageMessageNouns,
} from "~/server/agents/web/pages/messaging/agent_web_messaging_page.js";
import {normalizeAgentWebMessagingPage} from "~/server/agents/web/pages/messaging/normalize_agent_web_messaging_page.js";
import {parseAgentWebMessagingPage} from "~/server/agents/web/pages/messaging/parse_agent_web_messaging_page.js";
import {printAgentWebMessagingPage} from "~/server/agents/web/pages/messaging/print_agent_web_messaging_page.js";
import {runAgentWebPageTests} from "~/server/agents/web/pages/run_agent_web_page_tests.js";
import {
    ApiAccountTargetResponse,
    ApiContentInlineElementMark,
    ApiContentInlineElementResponse,
    ApiContentParagraphBlockElementResponse,
    ApiContentResponse,
    ApiContentTextInlineElement,
} from "~/shared/api/specification/types/api_specification_convenience_types.js";
import {generateChronologicalId} from "~/shared/id/chronological_id.js";
import {assertId, generateId} from "~/shared/id/id.js";
import {AccountId, BotId, ChatId, FileId} from "~/shared/id/types/id_types.js";

const apostrophe = String.fromCharCode(39);
const doubleQuote = String.fromCharCode(34);
const paginationChatId = generateId<ChatId>();
const duplicateFileId = generateChronologicalId<FileId>();

function accountTarget({name, botId}: {name: string; botId?: BotId}): ApiAccountTargetResponse {
    return {
        type: "Account",
        id: generateId<AccountId>(),
        title: name,
        shortName: name,
        ...(botId ? {botId} : {}),
    };
}

const aliceTarget = accountTarget({name: "Alice"});
const bobTarget = accountTarget({name: "Bob"});
const assistantTarget = accountTarget({name: "Assistant", botId: generateId<BotId>()});
const escapedAliceBobTeamTarget = accountTarget({
    name: `Alice & Bob${apostrophe}s ${doubleQuote}Team${doubleQuote}`,
});
const escapedCarolDanTeamTarget = accountTarget({
    name: `Carol & Dan${apostrophe}s ${doubleQuote}Team${doubleQuote}`,
});

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

runAgentWebPageTests<true, AgentWebMessagingPage>({
    print: printAgentWebMessagingPage.bind(null, agentWebMessagingPageMessageNouns),
    parse: parseAgentWebMessagingPage.bind(null, agentWebMessagingPageMessageNouns),
    normalize: normalizeAgentWebMessagingPage,
    tests: [
        {
            name: "simple message log",
            pageLink: true,
            markdown: `\
<time>May 13, 2026 3:00 PM EDT</time>

<message from="[Alice](/human/alice)">

Hello there.

</message>
`,
            page: {
                preamble: {elements: [], pagination: null},
                isEndOfMessages: false,
                blocks: [
                    {
                        type: "Time",
                        timeContent: "May 13, 2026 3:00 PM EDT",
                    },
                    {
                        type: "Message",
                        idAttribute: null,
                        author: aliceTarget,
                        timeAttribute: null,
                        timeZoneAttribute: null,
                        parent: null,
                        content: content([paragraph([text("Hello there.")])]),
                    },
                ],
            },
        },
        {
            name: "message id attributes",
            pageLink: true,
            markdown: `\
<message id="42" from="[Alice](/human/alice)">

Single message block.

</message>

<message id="4-7" from="[Bob](/human/bob)">

Merged message block.

</message>
`,
            page: {
                preamble: {elements: [], pagination: null},
                isEndOfMessages: false,
                blocks: [
                    {
                        type: "Message",
                        idAttribute: {startMessageIndex: 42, endMessageIndex: 43},
                        author: aliceTarget,
                        timeAttribute: null,
                        timeZoneAttribute: null,
                        parent: null,
                        content: content([paragraph([text("Single message block.")])]),
                    },
                    {
                        type: "Message",
                        idAttribute: {startMessageIndex: 4, endMessageIndex: 8},
                        author: bobTarget,
                        timeAttribute: null,
                        timeZoneAttribute: null,
                        parent: null,
                        content: content([paragraph([text("Merged message block.")])]),
                    },
                ],
            },
        },
        {
            name: "message log at end of messages",
            pageLink: true,
            markdown: `\
<message from="[Alice](/human/alice)">

Hello there.

</message>

End of messages.
`,
            page: {
                preamble: {elements: [], pagination: null},
                isEndOfMessages: true,
                blocks: [
                    {
                        type: "Message",
                        idAttribute: null,
                        author: aliceTarget,
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

<message from="[Alice](/human/alice)">

Hello there.

</message>
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
                    pagination: null,
                },
                isEndOfMessages: false,
                blocks: [
                    {
                        type: "Message",
                        idAttribute: null,
                        author: aliceTarget,
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

<message from="[Alice](/human/alice)">

Hello there.

</message>
`,
            page: {
                preamble: {
                    elements: [text("The current page starts after the May planning sync.")],
                    pagination: null,
                },
                isEndOfMessages: false,
                blocks: [
                    {
                        type: "Time",
                        timeContent: "May 13, 2026 3:00 PM EDT",
                    },
                    {
                        type: "Message",
                        idAttribute: null,
                        author: aliceTarget,
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
                    pagination: null,
                },
                isEndOfMessages: false,
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
                    pagination: {
                        target: {
                            type: "Chat",
                            id: paginationChatId,
                            title: "Engineering Room",
                        },
                        previousLink: {beforeMessageIndex: 3},
                        nextLink: null,
                    },
                },
                isEndOfMessages: false,
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
                    pagination: {
                        target: {
                            type: "Chat",
                            id: paginationChatId,
                            title: "Engineering Room",
                        },
                        previousLink: null,
                        nextLink: {afterMessageIndex: 9},
                    },
                },
                isEndOfMessages: false,
                blocks: [],
            },
            createParseError:
                "Can\u2019t add \u201CNext page »\u201D link when creating messages markdown. Try again without the \u201CNext page »\u201D link.",
        },
        {
            name: "preamble with previous and next page pagination links",
            pageLink: true,
            markdown: `\
Some messages in Engineering Room. [« Previous page](/chat/engineering-room?before=3) | [Next page »](/chat/engineering-room?after=9)
`,
            page: {
                preamble: {
                    elements: [text("Some messages in Engineering Room.")],
                    pagination: {
                        target: {
                            type: "Chat",
                            id: paginationChatId,
                            title: "Engineering Room",
                        },
                        previousLink: {beforeMessageIndex: 3},
                        nextLink: {afterMessageIndex: 9},
                    },
                },
                isEndOfMessages: false,
                blocks: [],
            },
            createParseError:
                "Can\u2019t add \u201CNext page »\u201D link when creating messages markdown. Try again without the \u201CNext page »\u201D link.",
        },
        {
            name: "preamble with standalone start-arrow previous page link",
            pageLink: true,
            markdown: `\
Some messages in Engineering Room. [« Previous page](https://example.com/chat?before=3)
`,
            page: {
                preamble: {
                    elements: [
                        text("Some messages in Engineering Room. "),
                        text("« Previous page", [
                            {type: "Link", url: "https://example.com/chat?before=3"},
                        ]),
                    ],
                    pagination: null,
                },
                isEndOfMessages: false,
                blocks: [],
            },
        },
        {
            name: "previous page pagination link with invalid url",
            pageLink: true,
            markdown: `\
Some messages in Engineering Room. [Previous page »](/chat/engineering-room?after=3)
`,
            parseError:
                "Invalid link for \u201CPrevious page »\u201D. Expected a link to more messages with a `before` URL search param. Example: `/chat/my-chat?before=8`. Try again with a different link.",
            createParseError:
                "Can\u2019t add \u201CPrevious page »\u201D link when creating messages markdown. Try again without the \u201CPrevious page »\u201D link.",
        },
        {
            name: "next page pagination link with invalid url",
            pageLink: true,
            markdown: `\
Some messages in Engineering Room. [Next page »](/chat/engineering-room?before=9)
`,
            parseError:
                "Invalid link for \u201CNext page »\u201D. Expected a link to more messages with a `after` URL search param. Example: `/chat/my-chat?after=8`. Try again with a different link.",
            createParseError:
                "Can\u2019t add \u201CNext page »\u201D link when creating messages markdown. Try again without the \u201CNext page »\u201D link.",
        },
        {
            name: "preamble with standalone end-arrow previous page link",
            pageLink: true,
            markdown: `\
Some messages in Engineering Room. [Previous page »](https://alpine.inc/chat/engineering-room?before=3)
`,
            page: {
                preamble: {
                    elements: [
                        text("Some messages in Engineering Room. "),
                        text("Previous page »", [
                            {type: "Link", url: "/chat/engineering-room?before=3"},
                        ]),
                    ],
                    pagination: null,
                },
                isEndOfMessages: false,
                blocks: [],
            },
        },
        {
            name: "bot message with reply preview and rich content",
            pageLink: true,
            markdown: `\
<message from="[Assistant](/bot/assistant)" time="12 minutes later">

<blockquote cite="?message=4">

[Alice](/human/alice): Can you review **this**?

</blockquote>

## Plan

Review **now** and *carefully*.

\`\`\`javascript
const done = true;
\`\`\`

</message>
`,
            page: {
                preamble: {elements: [], pagination: null},
                isEndOfMessages: false,
                blocks: [
                    {
                        type: "Message",
                        idAttribute: null,
                        author: assistantTarget,
                        timeAttribute: "12 minutes later",
                        timeZoneAttribute: null,
                        parent: {
                            citeAttribute: {startMessageIndex: 4, endMessageIndex: 5},
                            author: aliceTarget,
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

<message from="[Alice &amp; Bob&#39;s &quot;Team&quot;](/human/alice-and-bob-s-team)" time="5 &lt; 10 &amp; &quot;later&quot;" timezone="GMT+0 &amp; east">

<blockquote cite="?message=4-7">

[Carol & Dan${apostrophe}s ${doubleQuote}Team${doubleQuote}](/human/carol-and-dan-s-team): Quoted reply.

</blockquote>

Escaped attributes survive.

</message>
`,
            page: {
                preamble: {elements: [], pagination: null},
                isEndOfMessages: false,
                blocks: [
                    {
                        type: "Time",
                        timeContent: `May & ${doubleQuote}Later${doubleQuote} <soon>`,
                    },
                    {
                        type: "Message",
                        idAttribute: null,
                        author: escapedAliceBobTeamTarget,
                        timeAttribute: `5 < 10 & ${doubleQuote}later${doubleQuote}`,
                        timeZoneAttribute: "GMT+0 & east",
                        parent: {
                            citeAttribute: {startMessageIndex: 4, endMessageIndex: 8},
                            author: escapedCarolDanTeamTarget,
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
<message from="[Alice](/human/alice)">

<hr />

<p></p>

After the empty paragraph.

</message>
`,
            page: {
                preamble: {elements: [], pagination: null},
                isEndOfMessages: false,
                blocks: [
                    {
                        type: "Message",
                        idAttribute: null,
                        author: aliceTarget,
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
            name: "content after time block",
            pageLink: true,
            markdown: `\
<time>May 13, 2026 3:00 PM EDT</time>

Hello outside.
`,
            parseError:
                "Unexpected markdown on line 3. Messages markdown must be a list of `<message>`s.",
        },
        {
            name: "preamble with multiple paragraphs",
            pageLink: true,
            markdown: `\
First paragraph.

Second paragraph.
`,
            parseError:
                "Unexpected markdown on line 1. Messages markdown must be a list of `<message>`s. Though it may start with a single paragraph with a short description of what we\u2019re looking at.",
        },
        {
            name: "preamble with non paragraph block",
            pageLink: true,
            markdown: `\
## Thread context
`,
            parseError:
                "Unexpected markdown on line 1. Messages markdown must be a list of `<message>`s. Though it may start with a single paragraph with a short description of what we\u2019re looking at.",
        },
        {
            name: "message with invalid id attribute syntax",
            pageLink: true,
            markdown: `\
<message id=abc from="[Alice](/human/alice)">

Hello.

</message>
`,
            parseError:
                "Invalid `<message>` `id` attribute on line 1. Expected `id` to be an integer like `42` or an integer range like `4-7`. Try again with a valid `id` attribute.",
        },
        {
            name: "message with invalid id attribute range",
            pageLink: true,
            markdown: `\
<message id="7-4" from="[Alice](/human/alice)">

Hello.

</message>
`,
            parseError:
                "Invalid `<message>` `id` attribute on line 1. Expected `id` to be an integer like `42` or an integer range like `4-7`. Try again with a valid `id` attribute.",
        },
        {
            name: "wrong end of messages text",
            pageLink: true,
            markdown: `\
<message from="[Alice](/human/alice)">

Hello.

</message>

End of comments.
`,
            parseError:
                "Unexpected markdown on line 7. Messages markdown must be a list of `<message>`s.",
        },
        {
            name: "message without from attribute",
            pageLink: true,
            markdown: `\
<message>

Hello.

</message>
`,
            parseError:
                "`<message>` on line 1 is missing the `from` attribute. All messages must include a link to the author.",
        },
        {
            name: "unclosed message",
            pageLink: true,
            markdown: `\
<message from="[Assistant](/bot/assistant)">

Hello.
`,
            parseError:
                "`<message>` on line 1 is missing a closing tag. Add a `</message>` closing tag and try again.",
        },
        {
            name: "nested message",
            pageLink: true,
            markdown: `\
<message from="[Alice](/human/alice)">

<message from="[Assistant](/bot/assistant)">

Nested.

</message>

</message>
`,
            parseError:
                "Can\u2019t open a new `<message>` on line 3. " +
                "There\u2019s already an open `<message>` and you can\u2019t nest messages.",
        },
        {
            name: "close message without open tag",
            pageLink: true,
            markdown: `\
</message>
`,
            parseError:
                "Can\u2019t close `</message>` on line 1. " +
                "There isn\u2019t a matching `<message>` open tag.",
        },
        {
            name: "wrong close tag does not close message",
            pageLink: true,
            markdown: `\
<message from="[Alice](/human/alice)">

</comment>
`,
            parseError:
                "`<message>` on line 1 is missing a closing tag. Add a `</message>` closing tag and try again.",
        },
        {
            name: "blockquote outside message",
            pageLink: true,
            markdown: `\
<blockquote cite="[Alice](/human/alice)">

Hello.

</blockquote>
`,
            parseError:
                "Can\u2019t add `<blockquote>` on line 1. `<blockquote>`s can only be used at the beginning of a `<message>` to indicate that the message is a reply to some other message.",
        },
        {
            name: "blockquote after message content",
            pageLink: true,
            markdown: `\
<message from="[Alice](/human/alice)">

Message first.

<blockquote cite="[Bob](/human/bob)">

Late reply.

</blockquote>

</message>
`,
            parseError:
                "Can\u2019t add `<blockquote>` on line 5. `<blockquote>`s can only be used at the beginning of a `<message>` to indicate that the message is a reply to some other message.",
        },
        {
            name: "second blockquote after reply preview",
            pageLink: true,
            markdown: `\
<message from="[Alice](/human/alice)">

<blockquote cite="[Bob](/human/bob)">

First reply.

</blockquote>

<blockquote cite="[Carol](/human/carol)">

Second reply.

</blockquote>

</message>
`,
            parseError:
                "Can\u2019t add `<blockquote>` on line 9. `<blockquote>`s can only be used at the beginning of a `<message>` to indicate that the message is a reply to some other message.",
        },
        {
            name: "nested blockquote",
            pageLink: true,
            markdown: `\
<message from="[Alice](/human/alice)">

<blockquote cite="[Bob](/human/bob)">

<blockquote cite="[Carol](/human/carol)">

Nested reply.

</blockquote>

</blockquote>

</message>
`,
            parseError:
                "Can\u2019t open a new `<blockquote>` on line 5. " +
                "There\u2019s already an open `<blockquote>` and you can\u2019t nest `<blockquote>`s. " +
                "If you\u2019re trying to reply to a message that itself is replying to another message then just include the content of the message you\u2019re replying to and omit the extra `<blockquote>`.",
        },
        {
            name: "unclosed blockquote",
            pageLink: true,
            markdown: `\
<message from="[Alice](/human/alice)">

<blockquote cite="[Bob](/human/bob)">

Quoted.

</message>
`,
            parseError:
                "`<blockquote>` on line 3 is missing a closing tag. Add a `</blockquote>` closing tag and try again.",
        },
        {
            name: "blockquote without cite attribute",
            pageLink: true,
            markdown: `\
<message from="[Alice](/human/alice)">

<blockquote>

Quoted.

</blockquote>

</message>
`,
            parseError:
                "`<blockquote>` on line 1 is missing the `cite` attribute. Must include a relative link to the message you\u2019re replying to.",
        },
        {
            name: "blockquote with author cite link",
            pageLink: true,
            markdown: `\
<message from="[Alice](/human/alice)">

<blockquote cite="[Bob](/human/bob)">

[Bob](/human/bob): Quoted.

</blockquote>

</message>
`,
            parseError:
                "Invalid `<blockquote>` `cite` attribute on line 3. Expected `cite` to be a relative link like `?message=42` or `?message=4-7`. Try again with a valid `cite` attribute.",
        },
        {
            name: "blockquote without author prefix",
            pageLink: true,
            markdown: `\
<message from="[Alice](/human/alice)">

<blockquote cite="?message=2">

Quoted.

</blockquote>

</message>
`,
            parseError:
                "`<blockquote>` content on line 3 must start with a link to the message author followed by a colon. For example: `[John](/human/john-doe): quoted text`. Try again with a link to the message author.",
        },
        {
            name: "close blockquote without open tag",
            pageLink: true,
            markdown: `\
</blockquote>
`,
            parseError:
                "Can\u2019t close `</blockquote>` on line 1. " +
                "There isn\u2019t a matching `<blockquote>` open tag.",
        },
        {
            name: "close blockquote without reply preview",
            pageLink: true,
            markdown: `\
<message from="[Alice](/human/alice)">

</blockquote>

</message>
`,
            parseError:
                "Can\u2019t close `</blockquote>` on line 3. " +
                "There isn\u2019t a matching `<blockquote>` open tag.",
        },
        {
            name: "close blockquote twice",
            pageLink: true,
            markdown: `\
<message from="[Alice](/human/alice)">

<blockquote cite="[Bob](/human/bob)">

Quoted.

</blockquote>

</blockquote>

</message>
`,
            parseError:
                "Can\u2019t close `</blockquote>` on line 9. " +
                "There isn\u2019t a matching `<blockquote>` open tag.",
        },
        {
            name: "message with inline html content",
            pageLink: true,
            markdown: `\
<message from="[Alice](/human/alice)">Hello.</message>
`,
            printMarkdown: `\
<message from="[Alice](/human/alice)">

Hello.

</message>
`,
            page: {
                preamble: {elements: [], pagination: null},
                isEndOfMessages: false,
                blocks: [
                    {
                        type: "Message",
                        idAttribute: null,
                        author: aliceTarget,
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
<message from="[Alice](/human/alice)">
Hello there.
</message>
`,
            parseError:
                "Must add an empty new line between the `<message>` open tag and markdown text. Otherwise, due to a quirk in markdown, the text on line 2 will be parsed as HTML instead of markdown. The `<message>` must be formatted like this: `<message>\\n\\n...\\n\\n</message>`.",
        },
        {
            name: "message without newline between tags (attached to open tag)",
            pageLink: true,
            markdown: `\
<message from="[Alice](/human/alice)">
foo

bar

</message>
`,
            parseError:
                "Must add an empty new line between the `<message>` open tag and markdown text. Otherwise, due to a quirk in markdown, the text on line 2 will be parsed as HTML instead of markdown. The `<message>` must be formatted like this: `<message>\\n\\n...\\n\\n</message>`.",
        },
        {
            name: "message without newline between tags (attached to closed tag)",
            pageLink: true,
            markdown: `\
<message from="[Alice](/human/alice)">

foo

bar
</message>
`,
            printMarkdown: `\
<message from="[Alice](/human/alice)">

foo

bar&#x20;

</message>
`,
            page: {
                preamble: {elements: [], pagination: null},
                isEndOfMessages: false,
                blocks: [
                    {
                        type: "Message",
                        idAttribute: null,
                        author: aliceTarget,
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
<message from="[Alice](/human/alice)">

<blockquote cite="[Bob](/human/bob)">Hello, world!</blockquote>

Hello there.

</message>
`,
            parseError:
                "Must add an empty new line between the `<blockquote>` open tag and markdown text. Otherwise, due to a quirk in markdown, the text on line 3 will be parsed as HTML instead of markdown. The `<blockquote>` must be formatted like this: `<blockquote>\\n\\n...\\n\\n</blockquote>`.",
        },
        {
            name: "parent without newline between tags",
            pageLink: true,
            markdown: `\
<message from="[Alice](/human/alice)">

<blockquote cite="[Bob](/human/bob)">
Hello, world!
</blockquote>

Hello there.

</message>
`,
            parseError:
                "Must add an empty new line between the `<blockquote>` open tag and markdown text. Otherwise, due to a quirk in markdown, the text on line 4 will be parsed as HTML instead of markdown. The `<blockquote>` must be formatted like this: `<blockquote>\\n\\n...\\n\\n</blockquote>`.",
        },
        {
            name: "parent without newline between tags (attached to open tag)",
            pageLink: true,
            markdown: `\
<message from="[Alice](/human/alice)">

<blockquote cite="[Bob](/human/bob)">
foo

bar

</blockquote>

Hello there.

</message>
`,
            parseError:
                "Must add an empty new line between the `<blockquote>` open tag and markdown text. Otherwise, due to a quirk in markdown, the text on line 4 will be parsed as HTML instead of markdown. The `<blockquote>` must be formatted like this: `<blockquote>\\n\\n...\\n\\n</blockquote>`.",
        },
        {
            name: "parent without newline between tags (attached to closed tag)",
            pageLink: true,
            markdown: `\
<message from="[Alice](/human/alice)">

<blockquote cite="?message=2">

[Bob](/human/bob): foo

bar
</blockquote>

Hello there.

</message>
`,
            printMarkdown: `\
<message from="[Alice](/human/alice)">

<blockquote cite="?message=2">

[Bob](/human/bob): foo

bar

</blockquote>

Hello there.

</message>
`,
            page: {
                preamble: {elements: [], pagination: null},
                isEndOfMessages: false,
                blocks: [
                    {
                        type: "Message",
                        idAttribute: null,
                        author: aliceTarget,
                        timeAttribute: null,
                        timeZoneAttribute: null,
                        parent: {
                            citeAttribute: {startMessageIndex: 2, endMessageIndex: 3},
                            author: bobTarget,
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
                preamble: {elements: [], pagination: null},
                isEndOfMessages: false,
                blocks: [{type: "Time", timeContent: ""}],
            },
        },
        {
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
                        },
                    ],
                    pagination: null,
                },
                isEndOfMessages: false,
                blocks: [],
            },
        },
        {
            name: "highlight in preamble",
            pageLink: true,
            markdown: `\
<mark class="highlight-purple"> </mark>
`,
            page: {
                preamble: {
                    elements: [
                        {type: "Text", text: " ", marks: [{type: "Highlight", color: "Purple"}]},
                    ],
                    pagination: null,
                },
                isEndOfMessages: false,
                blocks: [],
            },
        },
        {
            name: "same file id with different sizes",
            pageLink: true,
            markdown: `\
<message from="[Alice](/human/alice)">

First render:

![](/file/image.png)

Second render:

![](/file/image.png)

</message>
`,
            page: {
                preamble: {elements: [], pagination: null},
                isEndOfMessages: false,
                blocks: [
                    {
                        type: "Message",
                        idAttribute: null,
                        author: aliceTarget,
                        timeAttribute: null,
                        timeZoneAttribute: null,
                        parent: null,
                        content: content([
                            paragraph([text("First render:")]),
                            {
                                type: "File",
                                id: duplicateFileId,
                                contentType: "image/png",
                                contentLength: 100,
                            },
                            paragraph([text("Second render:")]),
                            {
                                type: "File",
                                id: duplicateFileId,
                                contentType: "image/png",
                                contentLength: 200,
                            },
                        ]),
                    },
                ],
            },
        },
    ],
});
