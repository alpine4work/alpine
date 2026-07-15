import {RootContent} from "mdast";
import {AgentWebSessionStorage} from "~/server/agents/web/agent_web_session_storage.js";
import {
    AgentWebMessagingPage,
    agentWebMessagingPageMessageNouns,
} from "~/server/agents/web/pages/messaging/agent_web_messaging_page.js";
import {normalizeAgentWebMessagingPage} from "~/server/agents/web/pages/messaging/normalize_agent_web_messaging_page.js";
import {parseAgentWebMessagingPage} from "~/server/agents/web/pages/messaging/parse_agent_web_messaging_page.js";
import {printAgentWebMessagingPage} from "~/server/agents/web/pages/messaging/print_agent_web_messaging_page.js";
import {parseApiContentFromAgentWebMarkdownTree} from "~/server/agents/web/parse_api_content_from_agent_web_markdown.js";
import {printApiContentToAgentWebMarkdownTree} from "~/server/agents/web/print_api_content_to_agent_web_markdown.js";
import {runAgentWebPageTests} from "~/server/agents/web/test_helpers/run_agent_web_page_tests.js";
import {parseMarkdownTree} from "~/shared/api/content/parse_api_content_from_markdown.js";
import {
    ApiContentParagraphBlockElementResponseWithoutKeys,
    ApiContentResponseWithoutKeys,
} from "~/shared/api/specification/types/api_content_response_without_keys.js";
import {
    ApiAccountReferenceResponse,
    ApiContentInlineElementMark,
    ApiContentInlineElementResponse,
    ApiContentTextInlineElement,
} from "~/shared/api/specification/types/api_specification_convenience_types.js";
import {InvalidArgumentError} from "~/shared/error/error.js";
import {errorDisplayMessage} from "~/shared/error/error_display_message.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {quote} from "~/shared/helpers/string/quote.js";
import {generateChronologicalId} from "~/shared/id/chronological_id.js";
import {assertId, generateId} from "~/shared/id/id.js";
import {AccountId, BotId, ChatId, FileId} from "~/shared/id/types/id_types.js";

const apostrophe = String.fromCharCode(39);
const doubleQuote = String.fromCharCode(34);
const paginationChatId = generateId<ChatId>();
const duplicateFileId = generateChronologicalId<FileId>();

type TestCustomBlock = {
    readonly type: "Custom";
    readonly tagName: "custom";
    readonly timeAttribute: null;
    readonly text: string;
};

function accountReference({
    name,
    botId,
}: {
    name: string;
    botId?: BotId;
}): ApiAccountReferenceResponse {
    return {
        type: "Account",
        id: generateId<AccountId>(),
        title: name,
        shortName: name,
        ...(botId ? {bot: {id: botId}} : {}),
    };
}

const aliceReference = accountReference({name: "Alice"});
const bobReference = accountReference({name: "Bob"});
const assistantReference = accountReference({name: "Assistant", botId: generateId<BotId>()});
const escapedAliceBobTeamReference = accountReference({
    name: `Alice & Bob${apostrophe}s ${doubleQuote}Team${doubleQuote}`,
});
const escapedCarolDanTeamReference = accountReference({
    name: `Carol & Dan${apostrophe}s ${doubleQuote}Team${doubleQuote}`,
});

function content(
    elements: ApiContentResponseWithoutKeys["elements"],
): ApiContentResponseWithoutKeys {
    return {elements};
}

function paragraph(
    elements: ReadonlyArray<ApiContentInlineElementResponse>,
): ApiContentParagraphBlockElementResponseWithoutKeys {
    return {type: "Paragraph", elements};
}

function text(
    text: string,
    marks?: ReadonlyArray<ApiContentInlineElementMark>,
): ApiContentTextInlineElement {
    return {type: "Text", text, marks};
}

runAgentWebPageTests<
    true,
    AgentWebMessagingPage<
        {elements: ReadonlyArray<ApiContentInlineElementResponse>},
        TestCustomBlock
    >
>({
    print: (storage, pageLink, page) =>
        printAgentWebMessagingPage(storage, pageLink, page, {
            messageNouns: agentWebMessagingPageMessageNouns,
            printPreamble: async (storage, preamble) => {
                if (preamble.elements.length === 0) return {type: "root", children: []};

                return await printApiContentToAgentWebMarkdownTree(storage, {
                    elements: [{type: "Paragraph", elements: preamble.elements}],
                });
            },
            printCustomBlock: async (storage, customBlock) => ({
                type: "root",
                children: [
                    {type: "html", value: "<custom>"},
                    {type: "paragraph", children: [{type: "text", value: customBlock.text}]},
                    {type: "html", value: "</custom>"},
                ],
            }),
        }),
    parse: (storage, pageLink, root) =>
        parseAgentWebMessagingPage(storage, pageLink, root, {
            messageNouns: agentWebMessagingPageMessageNouns,
            parsePreamble: async (storage, preamble) => {
                const {elements} = await parseApiContentFromAgentWebMarkdownTree(storage, preamble);

                let actualElements: ReadonlyArray<ApiContentInlineElementResponse> = [];

                if (elements.length === 0) {
                    // noop
                } else if (elements.length === 1 && elements[0]!.type === "Paragraph") {
                    actualElements = elements[0].elements;
                } else {
                    throw new InvalidArgumentError("Preamble isn\u2019t a single paragraph", {
                        displayMessage: errorDisplayMessage`Unexpected markdown on line 1. ${agentWebMessagingPageMessageNouns.startOfSentencePluralNoun} markdown must be a list of ${quote(`<${agentWebMessagingPageMessageNouns.noun}>`)}s. Though it may start with a single paragraph with a short description of what we\u2019re looking at.`,
                    });
                }

                return {elements: actualElements};
            },
            parseCustomBlockByTagName: {
                custom: async (storage, root, {openTag, closeTag}) => {
                    assert(openTag === "<custom>");
                    assert(closeTag === "</custom>");

                    assert(root.children[0]?.type === "paragraph");
                    assert(root.children[0].children[0]?.type === "text");

                    return {
                        type: "Custom",
                        tagName: "custom" as const,
                        timeAttribute: null,
                        text: root.children[0].children[0].value,
                    };
                },
            },
        }),
    normalize: page =>
        normalizeAgentWebMessagingPage(page, {
            normalizePreamble: (normalizer, preamble) => {
                normalizer.normalizeInlineElements(preamble.elements);
            },
            normalizeCustomBlock: () => {},
        }),
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
                preamble: {elements: []},
                pagination: null,
                isEndOfMessages: false,
                blocks: [
                    {
                        type: "Time",
                        timeContent: "May 13, 2026 3:00 PM EDT",
                    },
                    {
                        type: "Message",
                        idAttribute: null,
                        author: aliceReference,
                        timeAttribute: null,
                        timeZoneAttribute: null,
                        parent: null,
                        content: content([paragraph([text("Hello there.")])]),
                    },
                ],
            },
        },
        {
            name: "message without author",
            pageLink: true,
            markdown: `\
<message>

Hello from the implicit author.

</message>
`,
            page: {
                preamble: {elements: []},
                pagination: null,
                isEndOfMessages: false,
                blocks: [
                    {
                        type: "Message",
                        idAttribute: null,
                        author: null,
                        timeAttribute: null,
                        timeZoneAttribute: null,
                        parent: null,
                        content: content([paragraph([text("Hello from the implicit author.")])]),
                    },
                ],
            },
        },
        {
            name: "custom block in message log",
            pageLink: true,
            markdown: `\
<time>May 13, 2026 3:00 PM EDT</time>

<custom>

foo

</custom>

<message from="[Alice](/human/alice)">

Hello there.

</message>
`,
            page: {
                preamble: {elements: []},
                pagination: null,
                isEndOfMessages: false,
                blocks: [
                    {
                        type: "Time",
                        timeContent: "May 13, 2026 3:00 PM EDT",
                    },
                    {
                        type: "Custom",
                        tagName: "custom" as const,
                        timeAttribute: null,
                        text: "foo",
                    },
                    {
                        type: "Message",
                        idAttribute: null,
                        author: aliceReference,
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
                preamble: {elements: []},
                pagination: null,
                isEndOfMessages: false,
                blocks: [
                    {
                        type: "Message",
                        idAttribute: {startMessageIndex: 42, endMessageIndex: 43},
                        author: aliceReference,
                        timeAttribute: null,
                        timeZoneAttribute: null,
                        parent: null,
                        content: content([paragraph([text("Single message block.")])]),
                    },
                    {
                        type: "Message",
                        idAttribute: {startMessageIndex: 4, endMessageIndex: 8},
                        author: bobReference,
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
                preamble: {elements: []},
                pagination: null,
                isEndOfMessages: true,
                blocks: [
                    {
                        type: "Message",
                        idAttribute: null,
                        author: aliceReference,
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
                },
                pagination: null,
                isEndOfMessages: false,
                blocks: [
                    {
                        type: "Message",
                        idAttribute: null,
                        author: aliceReference,
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
                },
                pagination: null,
                isEndOfMessages: false,
                blocks: [
                    {
                        type: "Time",
                        timeContent: "May 13, 2026 3:00 PM EDT",
                    },
                    {
                        type: "Message",
                        idAttribute: null,
                        author: aliceReference,
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
                },
                pagination: null,
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
                },
                pagination: {
                    pageLink: {
                        type: "Chat",
                        id: paginationChatId,
                        title: "Engineering Room",
                    },
                    previousLink: {type: "Message", beforeMessageIndex: 3},
                    nextLink: null,
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
                },
                pagination: {
                    pageLink: {
                        type: "Chat",
                        id: paginationChatId,
                        title: "Engineering Room",
                    },
                    previousLink: null,
                    nextLink: {type: "Message", afterMessageIndex: 9},
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
                },
                pagination: {
                    pageLink: {
                        type: "Chat",
                        id: paginationChatId,
                        title: "Engineering Room",
                    },
                    previousLink: {type: "Message", beforeMessageIndex: 3},
                    nextLink: {type: "Message", afterMessageIndex: 9},
                },
                isEndOfMessages: false,
                blocks: [],
            },
            createParseError:
                "Can\u2019t add \u201CNext page »\u201D link when creating messages markdown. Try again without the \u201CNext page »\u201D link.",
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
                preamble: {elements: []},
                pagination: null,
                isEndOfMessages: false,
                blocks: [
                    {
                        type: "Message",
                        idAttribute: null,
                        author: assistantReference,
                        timeAttribute: "12 minutes later",
                        timeZoneAttribute: null,
                        parent: {
                            citeAttribute: {startMessageIndex: 4, endMessageIndex: 5},
                            matchAttribute: null,
                            author: aliceReference,
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
            name: "bot message with reply preview starting with unordered list",
            pageLink: true,
            markdown: `\
<message from="[Assistant](/bot/assistant)">

<blockquote cite="?message=4">

[Alice](/human/alice):

- quoted

</blockquote>

Replying to a list item.

</message>
`,
            page: {
                preamble: {elements: []},
                pagination: null,
                isEndOfMessages: false,
                blocks: [
                    {
                        type: "Message",
                        idAttribute: null,
                        author: assistantReference,
                        timeAttribute: null,
                        timeZoneAttribute: null,
                        parent: {
                            citeAttribute: {startMessageIndex: 4, endMessageIndex: 5},
                            matchAttribute: null,
                            author: aliceReference,
                            previewContent: content([
                                {
                                    type: "UnorderedList",
                                    items: [
                                        {
                                            elements: [paragraph([text("quoted")])],
                                        },
                                    ],
                                },
                            ]),
                        },
                        content: content([paragraph([text("Replying to a list item.")])]),
                    },
                ],
            },
        },
        {
            name: "bot message with reply preview starting with quote block",
            pageLink: true,
            markdown: `\
<message from="[Assistant](/bot/assistant)">

<blockquote cite="?message=4">

[Alice](/human/alice):

> quoted

</blockquote>

Replying to a quote block.

</message>
`,
            page: {
                preamble: {elements: []},
                pagination: null,
                isEndOfMessages: false,
                blocks: [
                    {
                        type: "Message",
                        idAttribute: null,
                        author: assistantReference,
                        timeAttribute: null,
                        timeZoneAttribute: null,
                        parent: {
                            citeAttribute: {startMessageIndex: 4, endMessageIndex: 5},
                            matchAttribute: null,
                            author: aliceReference,
                            previewContent: content([
                                {
                                    type: "Quote",
                                    elements: [paragraph([text("quoted")])],
                                },
                            ]),
                        },
                        content: content([paragraph([text("Replying to a quote block.")])]),
                    },
                ],
            },
        },
        {
            name: "escaped messaging html",
            pageLink: true,
            markdown: `\
<time>May & \u0022Later\u0022 \\<soon></time>

<message from="[Alice &amp; Bob&#39;s &quot;Team&quot;](/human/alice-and-bobs-team)" time="5 &lt; 10 &amp; &quot;later&quot;" timezone="GMT+0 &amp; east">

<blockquote cite="?message=4-7">

[Carol & Dan${apostrophe}s ${doubleQuote}Team${doubleQuote}](/human/carol-and-dans-team): Quoted reply.

</blockquote>

Escaped attributes survive.

</message>
`,
            page: {
                preamble: {elements: []},
                pagination: null,
                isEndOfMessages: false,
                blocks: [
                    {
                        type: "Time",
                        timeContent: `May & ${doubleQuote}Later${doubleQuote} <soon>`,
                    },
                    {
                        type: "Message",
                        idAttribute: null,
                        author: escapedAliceBobTeamReference,
                        timeAttribute: `5 < 10 & ${doubleQuote}later${doubleQuote}`,
                        timeZoneAttribute: "GMT+0 & east",
                        parent: {
                            citeAttribute: {startMessageIndex: 4, endMessageIndex: 8},
                            matchAttribute: null,
                            author: escapedCarolDanTeamReference,
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
                preamble: {elements: []},
                pagination: null,
                isEndOfMessages: false,
                blocks: [
                    {
                        type: "Message",
                        idAttribute: null,
                        author: aliceReference,
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
            page: {
                preamble: {elements: []},
                pagination: null,
                isEndOfMessages: false,
                blocks: [
                    {
                        type: "Message",
                        idAttribute: null,
                        author: null,
                        timeAttribute: null,
                        timeZoneAttribute: null,
                        parent: null,
                        content: content([paragraph([text("Hello.")])]),
                    },
                ],
            },
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
            name: "blockquote with non-integer match attribute",
            pageLink: true,
            markdown: `\
<message from="[Alice](/human/alice)">

<blockquote cite="?message=2" match="second">

[Bob](/human/bob): Quoted.

</blockquote>

</message>
`,
            parseError:
                'Invalid `<blockquote>` `match` attribute on line 3. Try again with a 1-indexed integer like `match="2"`.',
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
                preamble: {elements: []},
                pagination: null,
                isEndOfMessages: false,
                blocks: [
                    {
                        type: "Message",
                        idAttribute: null,
                        author: aliceReference,
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
                preamble: {elements: []},
                pagination: null,
                isEndOfMessages: false,
                blocks: [
                    {
                        type: "Message",
                        idAttribute: null,
                        author: aliceReference,
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

<blockquote cite="?message=2" match="2">

[Bob](/human/bob): foo

bar
</blockquote>

Hello there.

</message>
`,
            printMarkdown: `\
<message from="[Alice](/human/alice)">

<blockquote cite="?message=2" match="2">

[Bob](/human/bob): foo

bar

</blockquote>

Hello there.

</message>
`,
            page: {
                preamble: {elements: []},
                pagination: null,
                isEndOfMessages: false,
                blocks: [
                    {
                        type: "Message",
                        idAttribute: null,
                        author: aliceReference,
                        timeAttribute: null,
                        timeZoneAttribute: null,
                        parent: {
                            citeAttribute: {startMessageIndex: 2, endMessageIndex: 3},
                            matchAttribute: 2,
                            author: bobReference,
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
                preamble: {elements: []},
                pagination: null,
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
                            reference: {
                                type: "Account",
                                id: assertId<AccountId>("00000000000000000000000000"),
                                title: "",
                                shortName: "",
                            },
                        },
                    ],
                },
                pagination: null,
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
                },
                pagination: null,
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
                preamble: {elements: []},
                pagination: null,
                isEndOfMessages: false,
                blocks: [
                    {
                        type: "Message",
                        idAttribute: null,
                        author: aliceReference,
                        timeAttribute: null,
                        timeZoneAttribute: null,
                        parent: null,
                        content: content([
                            paragraph([text("First render:")]),
                            {
                                type: "File",
                                file: {
                                    id: duplicateFileId,
                                    contentType: "image/png",
                                    contentLength: 100,
                                },
                            },
                            paragraph([text("Second render:")]),
                            {
                                type: "File",
                                file: {
                                    id: duplicateFileId,
                                    contentType: "image/png",
                                    contentLength: 200,
                                },
                            },
                        ]),
                    },
                ],
            },
        },
    ],
});

describe("parse custom block HTML nodes", () => {
    async function parseCustomBlockCalls(markdown: string) {
        const calls: Array<{
            openTag: string;
            closeTag: string;
            children: Array<RootContent>;
        }> = [];

        await parseAgentWebMessagingPage(
            {} as AgentWebSessionStorage,
            true,
            parseMarkdownTree(markdown),
            {
                messageNouns: agentWebMessagingPageMessageNouns,
                parsePreamble: async () => ({elements: []}),
                parseCustomBlockByTagName: {
                    custom: async (storage, root, {openTag, closeTag}) => {
                        calls.push({
                            openTag,
                            closeTag,
                            children: root.children.map(removePositionFromRootContent),
                        });

                        return {
                            type: "Custom",
                            tagName: "custom" as const,
                            timeAttribute: null,
                            text: "custom",
                        };
                    },
                },
            },
        );

        return calls;
    }

    function removePositionFromRootContent(node: unknown) {
        return JSON.parse(
            JSON.stringify(node, (key, value) => (key === "position" ? undefined : value)),
        );
    }

    test("passes remaining HTML in the same node to the custom block parser", async () => {
        expect(
            await parseCustomBlockCalls(
                `<custom><table><tbody><tr><td>abc</td></tr></tbody></table></custom>`,
            ),
        ).toEqual([
            {
                openTag: "<custom>",
                closeTag: "</custom>",
                children: [
                    {
                        type: "paragraph",
                        children: [
                            {type: "html", value: "<table>"},
                            {type: "html", value: "<tbody>"},
                            {type: "html", value: "<tr>"},
                            {type: "html", value: "<td>"},
                            {type: "text", value: "abc"},
                            {type: "html", value: "</td>"},
                            {type: "html", value: "</tr>"},
                            {type: "html", value: "</tbody>"},
                            {type: "html", value: "</table>"},
                        ],
                    },
                ],
            },
        ]);
    });

    test("preserves whitespace before custom block tag boundaries", async () => {
        expect(
            await parseCustomBlockCalls(
                `<custom  ><table><tbody><tr><td>abc</td></tr></tbody></table></custom  >`,
            ),
        ).toEqual([
            {
                openTag: "<custom  >",
                closeTag: "</custom  >",
                children: [
                    {
                        type: "paragraph",
                        children: [
                            {type: "html", value: "<table>"},
                            {type: "html", value: "<tbody>"},
                            {type: "html", value: "<tr>"},
                            {type: "html", value: "<td>"},
                            {type: "text", value: "abc"},
                            {type: "html", value: "</td>"},
                            {type: "html", value: "</tr>"},
                            {type: "html", value: "</tbody>"},
                            {type: "html", value: "</table>"},
                        ],
                    },
                ],
            },
        ]);
    });

    test("extracts a custom block from surrounding HTML nodes", async () => {
        expect(
            await parseCustomBlockCalls(`\
<table>
<custom>
<tbody>

abc

</tbody>
</custom>
</table>
`),
        ).toEqual([
            {
                openTag: "<custom>",
                closeTag: "</custom>",
                children: [
                    {type: "html", value: "\n<tbody>"},
                    {type: "paragraph", children: [{type: "text", value: "abc"}]},
                    {type: "html", value: "</tbody>\n"},
                ],
            },
        ]);
    });

    test("preserves markdown parsed as HTML after the custom block open tag", async () => {
        expect(
            await parseCustomBlockCalls(`\
<custom>
*foo*

*bar*

*qux*
</custom>
`),
        ).toEqual([
            {
                openTag: "<custom>",
                closeTag: "</custom>",
                children: [
                    {type: "html", value: "\n*foo*"},
                    {
                        type: "paragraph",
                        children: [
                            {
                                type: "emphasis",
                                children: [{type: "text", value: "bar"}],
                            },
                        ],
                    },
                    {
                        type: "paragraph",
                        children: [
                            {
                                type: "emphasis",
                                children: [{type: "text", value: "qux"}],
                            },
                            {type: "text", value: "\n"},
                        ],
                    },
                ],
            },
        ]);
    });
});
