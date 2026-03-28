import {createAgentWebPageStoredLinkPathname} from "~/server/agents/web/create_agent_web_page_stored_link_pathname.js";
import {
    AgentWebPostPage,
    normalizeAgentWebPostPage,
    parseAgentWebPostPage,
    printAgentWebPostPage,
} from "~/server/agents/web/pages/agent_web_post_page.js";
import {runAgentWebPageTests} from "~/server/agents/web/test_helpers/run_agent_web_page_tests.js";
import {
    ApiAccountReferenceResponse,
    ApiContentInlineElementResponse,
    ApiContentParagraphBlockElementResponse,
    ApiContentResponse,
    ApiContentTextInlineElement,
    ApiPostReferenceResponse,
} from "~/shared/api/specification/types/api_specification_convenience_types.js";
import {generateId} from "~/shared/id/id.js";
import {AccountId, BotId, ChannelId, PostId} from "~/shared/id/types/id_types.js";

const postId = generateId<PostId>();
const paginationPostId = generateId<PostId>();
const announcementsChannelId = generateId<ChannelId>();
const launchPostReference: ApiPostReferenceResponse = {
    type: "Post",
    id: paginationPostId,
    title: "Launch",
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
Post in [Announcements](/channel/announcements).

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
                subType: "Head",
                preamble: {
                    type: "Head",
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
Post that\u2019s not in any channel.

<time>May 14th at 10:55am EDT</time>

<post from="[Alice](/human/alice)" timezone="PDT">

Post body from the west coast.

</post>
`,
            page: {
                type: "Post",
                subType: "Head",
                preamble: {type: "Head", channel: null},
                pagination: null,
                isEndOfMessages: false,
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
Comments on [post](/post/launch). [Next page »](/post/launch?after=1)

<comment id="0-1" from="[Alice](/human/alice)">

First comment.

Second comment.

</comment>
`,
            page: {
                type: "Post",
                subType: "Tail",
                preamble: {type: "Tail", post: launchPostReference},
                pagination: {
                    pageLink: launchPostReference,
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
Post in [Announcements](/channel/announcements). [« Previous page](/post/launch?before=post) | [Next page »](/post/launch?after=post)

<time>May 14th at 10:55am EDT</time>

<post from="[Alice](/human/alice)">

Post body.

</post>
`,
            page: {
                type: "Post",
                subType: "Head",
                preamble: {
                    type: "Head",
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
Post in [Announcements](/channel/announcements). [Next page »](/post/launch?after=post)

<time>May 14th at 10:55am EDT</time>

<post from="[Alice](/human/alice)">

Post body.

</post>
`,
            page: {
                type: "Post",
                subType: "Head",
                preamble: {
                    type: "Head",
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
Post in [Announcements](/channel/announcements). [Previous page »](/post/launch?before=post)

<time>May 14th at 10:55am EDT</time>

<post from="[Alice](/human/alice)">

Post body.

</post>
`,
            page: {
                type: "Post",
                subType: "Head",
                preamble: {
                    type: "Head",
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
Post that\u2019s not in any channel.

<time>May 14th at 10:55am EDT</time>

<post from="[Alice](/human/alice)">

Post body.

</post>
`,
            page: {
                type: "Post",
                subType: "Head",
                preamble: {type: "Head", channel: null},
                pagination: null,
                isEndOfMessages: false,
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
                ],
            },
        },
        {
            name: "post block without opening time",
            pageLink: postId,
            markdown: `\
Post that\u2019s not in any channel.

<post from="[Alice](/human/alice)">

Post body.

</post>
`,
            page: {
                type: "Post",
                subType: "Head",
                preamble: {type: "Head", channel: null},
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
            name: "post block after comment",
            pageLink: postId,
            markdown: `\
Post that\u2019s not in any channel.

<time>May 14th at 10:55am EDT</time>

<comment id="0" from="[Bob](/human/bob)">

First comment.

</comment>

<post from="[Alice](/human/alice)">

Post body.

</post>
`,
            setupStorage: async storage => {
                await createAgentWebPageStoredLinkPathname(storage, aliceReference);
                await createAgentWebPageStoredLinkPathname(storage, bobReference);
            },
            parseError:
                "A `<post>` must be the first thing in post markdown after the first line which " +
                "states what channel the post is in (e.g. `Post in [My Channel](/channel/my-channel).`) " +
                "and there must only be one `<post>`. Try again with one `<post>` at the start " +
                "of the markdown.",
        },
        {
            name: "post block on tail page",
            pageLink: postId,
            markdown: `\
Comments on [post](/post/launch).

<time>May 14th at 10:55am EDT</time>

<post from="[Alice](/human/alice)">

Post body.

</post>
`,
            setupStorage: async storage => {
                await createAgentWebPageStoredLinkPathname(storage, launchPostReference);
                await createAgentWebPageStoredLinkPathname(storage, aliceReference);
            },
            parseError:
                "Can\u2019t add a `<post>` to a post\u2019s comments section. Remove the `<post>` " +
                "and try again.",
        },
        {
            name: "post missing from attribute",
            pageLink: postId,
            markdown: `\
Post that\u2019s not in any channel.

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
Post that\u2019s not in any channel.

<post from="[Alice](/human/alice)" in="[Announcements](/channel/announcements)">

Post body.
`,
            parseError:
                "`<post>` on line 3 is missing a closing tag. Add a `</post>` closing tag " +
                "and try again.",
        },
        {
            name: "post page with no comments",
            pageLink: postId,
            markdown: `\
Post in [Announcements](/channel/announcements).

<time>May 14th at 10:55am EDT</time>

<post from="[Alice](/human/alice)">

Post body.

</post>

End of comments.
`,
            page: {
                type: "Post",
                subType: "Head",
                preamble: {
                    type: "Head",
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
                ],
            },
        },
        {
            name: "post page with no comments and no initial time",
            pageLink: postId,
            markdown: `\
Post in [Announcements](/channel/announcements).

<post from="[Alice](/human/alice)">

Post body.

</post>

End of comments.
`,
            page: {
                type: "Post",
                subType: "Head",
                preamble: {
                    type: "Head",
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
            name: "post page with no comments, no end comment marker, and no initial time",
            pageLink: postId,
            markdown: `\
Post in [Announcements](/channel/announcements).

<post from="[Alice](/human/alice)">

Post body.

</post>
`,
            page: {
                type: "Post",
                subType: "Head",
                preamble: {
                    type: "Head",
                    channel: {
                        type: "Channel",
                        id: announcementsChannelId,
                        title: "Announcements",
                    },
                },
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
    ],
});
