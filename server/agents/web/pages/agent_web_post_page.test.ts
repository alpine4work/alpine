import {
    AgentWebPostPage,
    normalizeAgentWebPostPage,
    parseAgentWebPostPage,
    printAgentWebPostPage,
} from "~/server/agents/web/pages/agent_web_post_page.js";
import {runAgentWebPageTests} from "~/server/agents/web/pages/run_agent_web_page_tests.js";
import {
    ApiAccountReferenceResponse,
    ApiContentInlineElementResponse,
    ApiContentParagraphBlockElementResponse,
    ApiContentResponse,
    ApiContentTextInlineElement,
} from "~/shared/api/specification/types/api_specification_convenience_types.js";
import {generateId} from "~/shared/id/id.js";
import {AccountId, BotId, ChannelId, PostId} from "~/shared/id/types/id_types.js";

const postId = generateId<PostId>();
const paginationPostId = generateId<PostId>();
const announcementsChannelId = generateId<ChannelId>();

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

runAgentWebPageTests<PostId, AgentWebPostPage>({
    print: printAgentWebPostPage,
    parse: parseAgentWebPostPage,
    normalize: normalizeAgentWebPostPage,
    tests: [
        {
            name: "post and comments",
            pageLink: postId,
            markdown: `\
Post and comments in [Announcements](/channel/announcements).

<time>May 14th at 10:55am EDT</time>

<post from="[Alice](/human/alice)">

Post body.

</post>

<comment id="0" from="[Bob](/human/bob)">

First comment.

</comment>

End of comments.
`,
            page: {
                type: "Post",
                preamble: {
                    channel: {
                        type: "Channel",
                        id: announcementsChannelId,
                        title: "Announcements",
                    },
                },
                pagination: null,
                isEndOfMessages: true,
                blocks: [
                    {
                        type: "Time",
                        timeContent: "May 14th at 10:55am EDT",
                    },
                    {
                        type: "Custom",
                        tagName: "post",
                        author: aliceReference,
                        timeAttribute: null,
                        timeZoneAttribute: null,
                        content: content([paragraph([text("Post body.")])]),
                    },
                    {
                        type: "Message",
                        idAttribute: {startMessageIndex: 0, endMessageIndex: 1},
                        author: bobReference,
                        timeAttribute: null,
                        timeZoneAttribute: null,
                        parent: null,
                        content: content([paragraph([text("First comment.")])]),
                    },
                ],
            },
        },
        {
            name: "post with timezone attribute",
            pageLink: postId,
            markdown: `\
Post and comments.

<post from="[Alice](/human/alice)" timezone="PDT">

Post body from the west coast.

</post>
`,
            page: {
                type: "Post",
                preamble: {channel: null},
                pagination: null,
                isEndOfMessages: false,
                blocks: [
                    {
                        type: "Custom",
                        tagName: "post",
                        author: aliceReference,
                        timeAttribute: null,
                        timeZoneAttribute: "PDT",
                        content: content([paragraph([text("Post body from the west coast.")])]),
                    },
                ],
            },
        },
        {
            name: "comments-only page with pagination",
            pageLink: postId,
            markdown: `\
Post and comments in [Announcements](/channel/announcements). [Next page »](/post/launch?after=1)

<comment id="0-1" from="[Alice](/human/alice)">

First comment.

Second comment.

</comment>
`,
            page: {
                type: "Post",
                preamble: {
                    channel: {
                        type: "Channel",
                        id: announcementsChannelId,
                        title: "Announcements",
                    },
                },
                pagination: {
                    pageLink: {
                        type: "Post",
                        id: paginationPostId,
                        title: "Launch",
                    },
                    previousLink: null,
                    nextLink: {type: "Message", afterMessageIndex: 1},
                },
                isEndOfMessages: false,
                blocks: [
                    {
                        type: "Message",
                        idAttribute: {startMessageIndex: 0, endMessageIndex: 2},
                        author: aliceReference,
                        timeAttribute: null,
                        timeZoneAttribute: null,
                        parent: null,
                        content: content([
                            paragraph([text("First comment.")]),
                            paragraph([text("Second comment.")]),
                        ]),
                    },
                ],
            },
            createParseError:
                "Can\u2019t add \u201cNext page »\u201d link when creating comments markdown. Try again " +
                "without the \u201cNext page »\u201d link.",
        },
        {
            name: "post page with custom pagination links",
            pageLink: postId,
            markdown: `\
Post and comments in [Announcements](/channel/announcements). [« Previous page](/post/launch?before=post) | [Next page »](/post/launch?after=post)

<post from="[Alice](/human/alice)">

Post body.

</post>
`,
            page: {
                type: "Post",
                preamble: {
                    channel: {
                        type: "Channel",
                        id: announcementsChannelId,
                        title: "Announcements",
                    },
                },
                pagination: {
                    pageLink: {
                        type: "Post",
                        id: paginationPostId,
                        title: "Launch",
                    },
                    previousLink: {type: "Custom", beforeTagName: "post"},
                    nextLink: {type: "Custom", afterTagName: "post"},
                },
                isEndOfMessages: false,
                blocks: [
                    {
                        type: "Custom",
                        tagName: "post",
                        author: aliceReference,
                        timeAttribute: null,
                        timeZoneAttribute: null,
                        content: content([paragraph([text("Post body.")])]),
                    },
                ],
            },
            createParseError:
                "Can\u2019t add \u201cNext page »\u201d link when creating comments markdown. Try again " +
                "without the \u201cNext page »\u201d link.",
        },
        {
            name: "post page with custom next page pagination link",
            pageLink: postId,
            markdown: `\
Post and comments in [Announcements](/channel/announcements). [Next page »](/post/launch?after=post)

<post from="[Alice](/human/alice)">

Post body.

</post>
`,
            page: {
                type: "Post",
                preamble: {
                    channel: {
                        type: "Channel",
                        id: announcementsChannelId,
                        title: "Announcements",
                    },
                },
                pagination: {
                    pageLink: {
                        type: "Post",
                        id: paginationPostId,
                        title: "Launch",
                    },
                    previousLink: null,
                    nextLink: {type: "Custom", afterTagName: "post"},
                },
                isEndOfMessages: false,
                blocks: [
                    {
                        type: "Custom",
                        tagName: "post",
                        author: aliceReference,
                        timeAttribute: null,
                        timeZoneAttribute: null,
                        content: content([paragraph([text("Post body.")])]),
                    },
                ],
            },
            createParseError:
                "Can\u2019t add \u201cNext page »\u201d link when creating comments markdown. Try again " +
                "without the \u201cNext page »\u201d link.",
        },
        {
            name: "post page with custom previous page pagination link",
            pageLink: postId,
            markdown: `\
Post and comments in [Announcements](/channel/announcements). [Previous page »](/post/launch?before=post)

<post from="[Alice](/human/alice)">

Post body.

</post>
`,
            page: {
                type: "Post",
                preamble: {
                    channel: {
                        type: "Channel",
                        id: announcementsChannelId,
                        title: "Announcements",
                    },
                },
                pagination: {
                    pageLink: {
                        type: "Post",
                        id: paginationPostId,
                        title: "Launch",
                    },
                    previousLink: {type: "Custom", beforeTagName: "post"},
                    nextLink: null,
                },
                isEndOfMessages: false,
                blocks: [
                    {
                        type: "Custom",
                        tagName: "post",
                        author: aliceReference,
                        timeAttribute: null,
                        timeZoneAttribute: null,
                        content: content([paragraph([text("Post body.")])]),
                    },
                ],
            },
            createParseError:
                "Can\u2019t add \u201cPrevious page »\u201d link when creating comments markdown. Try again " +
                "without the \u201cPrevious page »\u201d link.",
        },
        {
            name: "post without channel",
            pageLink: postId,
            markdown: `\
Post and comments.

<post from="[Alice](/human/alice)">

Post body.

</post>
`,
            page: {
                type: "Post",
                preamble: {channel: null},
                pagination: null,
                isEndOfMessages: false,
                blocks: [
                    {
                        type: "Custom",
                        tagName: "post",
                        author: aliceReference,
                        timeAttribute: null,
                        timeZoneAttribute: null,
                        content: content([paragraph([text("Post body.")])]),
                    },
                ],
            },
        },
        {
            name: "post missing from attribute",
            pageLink: postId,
            markdown: `\
Post and comments.

<post>

Post body.

</post>
`,
            parseError:
                "`<post>` on line 3 is missing the `from` attribute. The post must include a " +
                "link to the author.",
        },
        {
            name: "post missing closing tag",
            pageLink: postId,
            markdown: `\
Post and comments.

<post from="[Alice](/human/alice)" in="[Announcements](/channel/announcements)">

Post body.
`,
            parseError:
                "`<post>` on line 3 is missing a closing tag. Add a `</post>` closing tag " +
                "and try again.",
        },
    ],
});
