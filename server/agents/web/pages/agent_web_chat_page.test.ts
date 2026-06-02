import {
    AgentWebChatPage,
    normalizeAgentWebChatPage,
    parseAgentWebChatPage,
    printAgentWebChatPage,
} from "~/server/agents/web/pages/agent_web_chat_page.js";
import {runAgentWebPageTests} from "~/server/agents/web/pages/run_agent_web_page_tests.js";
import {
    ApiAccountTargetResponse,
    ApiContentInlineElementResponse,
    ApiContentParagraphBlockElementResponse,
    ApiContentResponse,
    ApiContentTextInlineElement,
} from "~/shared/api/specification/types/api_specification_convenience_types.js";
import {generateId} from "~/shared/id/id.js";
import {AccountId, BotId, ChatId} from "~/shared/id/types/id_types.js";

const chatId = generateId<ChatId>();
const paginationChatId = generateId<ChatId>();

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
const carolTarget = accountTarget({name: "Carol"});
const danTarget = accountTarget({name: "Dan"});
const assistantTarget = accountTarget({name: "Assistant", botId: generateId<BotId>()});
const escapedTeamTarget = accountTarget({
    name: `Alice & Bob\u2019s \u201CTeam\u201D`,
});

function content(elements: ApiContentResponse["elements"]): ApiContentResponse {
    return {elements};
}

function paragraph(
    elements: ReadonlyArray<ApiContentInlineElementResponse>,
): ApiContentParagraphBlockElementResponse {
    return {type: "Paragraph", elements};
}

function text(text: string): ApiContentTextInlineElement {
    return {type: "Text", text};
}

const invalidPreambleError =
    "Chat markdown must start with \u201CChat with\u201D followed by a list of chat members " +
    "(e.g. `Chat with [John](/human/john-doe) and [Jane](/human/jane-doe).` or for " +
    "chats with 2+ members `Chat with A, B, and C.`). Chat markdown for named chat " +
    "rooms must start with a markdown h1 (e.g. `# My Chat Room`). Try again with a " +
    "proper start to chat markdown on line 1.";
const previousPageCreateParseError =
    "Can\u2019t add \u201cPrevious page »\u201d link when creating messages markdown. " +
    "Try again without the \u201cPrevious page »\u201d link.";
const nextPageCreateParseError =
    "Can\u2019t add \u201cNext page »\u201d link when creating messages markdown. " +
    "Try again without the \u201cNext page »\u201d link.";

runAgentWebPageTests<ChatId, AgentWebChatPage>({
    print: printAgentWebChatPage,
    parse: parseAgentWebChatPage,
    normalize: normalizeAgentWebChatPage,
    tests: [
        {
            name: "direct chat with one member",
            pageLink: chatId,
            markdown: `\
Chat with [Alice](/human/alice).
`,
            page: {
                type: "Chat",
                preamble: {type: "Direct", members: [aliceTarget]},
                pagination: null,
                isEndOfMessages: false,
                blocks: [],
            },
        },
        {
            name: "direct chat with one member without period",
            pageLink: chatId,
            markdown: `\
Chat with [Alice](/human/alice)
`,
            printMarkdown: `\
Chat with [Alice](/human/alice).
`,
            page: {
                type: "Chat",
                preamble: {type: "Direct", members: [aliceTarget]},
                pagination: null,
                isEndOfMessages: false,
                blocks: [],
            },
        },
        {
            name: "direct chat with bot member",
            pageLink: chatId,
            markdown: `\
Chat with [Assistant](/bot/assistant).
`,
            page: {
                type: "Chat",
                preamble: {type: "Direct", members: [assistantTarget]},
                pagination: null,
                isEndOfMessages: false,
                blocks: [],
            },
        },
        {
            name: "direct chat with two members",
            pageLink: chatId,
            markdown: `\
Chat with [Alice](/human/alice) and [Bob](/human/bob).
`,
            page: {
                type: "Chat",
                preamble: {type: "Direct", members: [aliceTarget, bobTarget]},
                pagination: null,
                isEndOfMessages: false,
                blocks: [],
            },
        },
        {
            name: "direct chat with two members and oxford comma",
            pageLink: chatId,
            markdown: `\
Chat with [Alice](/human/alice), and [Bob](/human/bob).
`,
            printMarkdown: `\
Chat with [Alice](/human/alice) and [Bob](/human/bob).
`,
            page: {
                type: "Chat",
                preamble: {type: "Direct", members: [aliceTarget, bobTarget]},
                pagination: null,
                isEndOfMessages: false,
                blocks: [],
            },
        },
        {
            name: "direct chat with three members",
            pageLink: chatId,
            markdown: `\
Chat with [Alice](/human/alice), [Bob](/human/bob), and [Carol](/human/carol).
`,
            page: {
                type: "Chat",
                preamble: {type: "Direct", members: [aliceTarget, bobTarget, carolTarget]},
                pagination: null,
                isEndOfMessages: false,
                blocks: [],
            },
        },
        {
            name: "direct chat with three members without period",
            pageLink: chatId,
            markdown: `\
Chat with [Alice](/human/alice), [Bob](/human/bob), and [Carol](/human/carol)
`,
            printMarkdown: `\
Chat with [Alice](/human/alice), [Bob](/human/bob), and [Carol](/human/carol).
`,
            page: {
                type: "Chat",
                preamble: {type: "Direct", members: [aliceTarget, bobTarget, carolTarget]},
                pagination: null,
                isEndOfMessages: false,
                blocks: [],
            },
        },
        {
            name: "direct chat with three members without oxford comma",
            pageLink: chatId,
            markdown: `\
Chat with [Alice](/human/alice), [Bob](/human/bob) and [Carol](/human/carol).
`,
            printMarkdown: `\
Chat with [Alice](/human/alice), [Bob](/human/bob), and [Carol](/human/carol).
`,
            page: {
                type: "Chat",
                preamble: {type: "Direct", members: [aliceTarget, bobTarget, carolTarget]},
                pagination: null,
                isEndOfMessages: false,
                blocks: [],
            },
        },
        {
            name: "direct chat with four members",
            pageLink: chatId,
            markdown: `\
Chat with [Alice](/human/alice), [Bob](/human/bob), [Carol](/human/carol), and [Dan](/human/dan).
`,
            page: {
                type: "Chat",
                preamble: {
                    type: "Direct",
                    members: [aliceTarget, bobTarget, carolTarget, danTarget],
                },
                pagination: null,
                isEndOfMessages: false,
                blocks: [],
            },
        },
        {
            name: "direct chat with escaped member name",
            pageLink: chatId,
            markdown: `\
Chat with [Alice & Bob\u2019s \u201CTeam\u201D](/human/alice-and-bobs-team).
`,
            page: {
                type: "Chat",
                preamble: {type: "Direct", members: [escapedTeamTarget]},
                pagination: null,
                isEndOfMessages: false,
                blocks: [],
            },
        },
        {
            name: "direct chat preamble before message",
            pageLink: chatId,
            markdown: `\
Chat with [Alice](/human/alice) and [Bob](/human/bob).

<message from="[Alice](/human/alice)">

Hello Bob.

</message>
`,
            page: {
                type: "Chat",
                preamble: {type: "Direct", members: [aliceTarget, bobTarget]},
                pagination: null,
                isEndOfMessages: false,
                blocks: [
                    {
                        type: "Message",
                        idAttribute: null,
                        author: aliceTarget,
                        timeAttribute: null,
                        timeZoneAttribute: null,
                        parent: null,
                        content: content([paragraph([text("Hello Bob.")])]),
                    },
                ],
            },
        },
        {
            name: "direct chat with previous page pagination link",
            pageLink: chatId,
            markdown: `\
Chat with [Alice](/human/alice). [Previous page »](/chat/alice?before=3)
`,
            page: {
                type: "Chat",
                preamble: {type: "Direct", members: [aliceTarget]},
                pagination: {
                    pageLink: {
                        type: "Chat",
                        id: paginationChatId,
                        title: "Alice",
                    },
                    previousLink: {beforeMessageIndex: 3},
                    nextLink: null,
                },
                isEndOfMessages: false,
                blocks: [],
            },
            createParseError: previousPageCreateParseError,
        },
        {
            name: "direct chat with next page pagination link",
            pageLink: chatId,
            markdown: `\
Chat with [Alice](/human/alice). [Next page »](/chat/alice?after=9)
`,
            page: {
                type: "Chat",
                preamble: {type: "Direct", members: [aliceTarget]},
                pagination: {
                    pageLink: {
                        type: "Chat",
                        id: paginationChatId,
                        title: "Alice",
                    },
                    previousLink: null,
                    nextLink: {afterMessageIndex: 9},
                },
                isEndOfMessages: false,
                blocks: [],
            },
            createParseError: nextPageCreateParseError,
        },
        {
            name: "room chat",
            pageLink: chatId,
            markdown: `\
# Engineering Room
`,
            page: {
                type: "Chat",
                preamble: {type: "Room", name: "Engineering Room"},
                pagination: null,
                isEndOfMessages: false,
                blocks: [],
            },
        },
        {
            name: "room chat with formatted heading",
            pageLink: chatId,
            markdown: `\
# **Launch** Room
`,
            printMarkdown: `\
# Launch Room
`,
            page: {
                type: "Chat",
                preamble: {type: "Room", name: "Launch Room"},
                pagination: null,
                isEndOfMessages: false,
                blocks: [],
            },
        },
        {
            name: "room chat preamble before time and message",
            pageLink: chatId,
            markdown: `\
# Engineering Room

<time>May 13, 2026 3:00 PM EDT</time>

<message from="[Alice](/human/alice)">

Room update.

</message>
`,
            page: {
                type: "Chat",
                preamble: {type: "Room", name: "Engineering Room"},
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
                        author: aliceTarget,
                        timeAttribute: null,
                        timeZoneAttribute: null,
                        parent: null,
                        content: content([paragraph([text("Room update.")])]),
                    },
                ],
            },
        },
        {
            name: "room chat with previous page pagination link",
            pageLink: chatId,
            markdown: `\
# Engineering Room

[Previous page »](/chat/engineering-room?before=3)
`,
            page: {
                type: "Chat",
                preamble: {type: "Room", name: "Engineering Room"},
                pagination: {
                    pageLink: {
                        type: "Chat",
                        id: paginationChatId,
                        title: "Engineering Room",
                    },
                    previousLink: {beforeMessageIndex: 3},
                    nextLink: null,
                },
                isEndOfMessages: false,
                blocks: [],
            },
            createParseError: previousPageCreateParseError,
        },
        {
            name: "room chat with next page pagination link",
            pageLink: chatId,
            markdown: `\
# Engineering Room

[Next page »](/chat/engineering-room?after=9)
`,
            page: {
                type: "Chat",
                preamble: {type: "Room", name: "Engineering Room"},
                pagination: {
                    pageLink: {
                        type: "Chat",
                        id: paginationChatId,
                        title: "Engineering Room",
                    },
                    previousLink: null,
                    nextLink: {afterMessageIndex: 9},
                },
                isEndOfMessages: false,
                blocks: [],
            },
            createParseError: nextPageCreateParseError,
        },
        {
            name: "direct chat with no members",
            pageLink: chatId,
            markdown: `\
Chat with .
`,
            parseError: invalidPreambleError,
        },
        {
            name: "direct chat with wrong separator",
            pageLink: chatId,
            markdown: `\
Chat with Alice and Bob.
`,
            parseError: invalidPreambleError,
        },
        {
            name: "direct chat with multiple paragraphs",
            pageLink: chatId,
            markdown: `\
Chat with Alice.

Extra paragraph.
`,
            parseError: invalidPreambleError,
        },
        {
            name: "room chat with h2 preamble",
            pageLink: chatId,
            markdown: `\
## Engineering Room
`,
            parseError: invalidPreambleError,
        },
    ],
});
