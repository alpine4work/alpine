import {
    AgentWebChannelPage,
    normalizeAgentWebChannelPage,
    parseAgentWebChannelPage,
    printAgentWebChannelPage,
} from "~/server/agents/web/pages/agent_web_channel_page.js";
import {runAgentWebPageTests} from "~/server/agents/web/test_helpers/run_agent_web_page_tests.js";
import {
    ApiAccountReferenceResponse,
    ApiContentInlineElementResponse,
    ApiContentParagraphBlockElementResponseWithoutKeys,
    ApiContentResponseWithoutKeys,
    ApiContentTextInlineElement,
    ApiPostReferenceResponse,
} from "~/shared/api/specification/types/api_specification_convenience_types.js";
import {markdown} from "~/shared/helpers/string/markdown.js";
import {generateId} from "~/shared/id/id.js";
import {AccountId, BotId, ChannelId, PostId} from "~/shared/id/types/id_types.js";

const channelId = generateId<ChannelId>();
const launchPostId = generateId<PostId>();
const seeMorePostId = generateId<PostId>();
const roadmapPostId = generateId<PostId>();

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

const launchPostReference: ApiPostReferenceResponse = {
    type: "Post",
    id: launchPostId,
    title: "Launch notes",
};

const roadmapPostReference: ApiPostReferenceResponse = {
    type: "Post",
    id: roadmapPostId,
    title: "Roadmap",
};

const seeMorePostReference: ApiPostReferenceResponse = {
    type: "Post",
    id: seeMorePostId,
    title: "See more »",
};

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

function unorderedList(
    items: ReadonlyArray<{
        readonly elements: ReadonlyArray<ApiContentParagraphBlockElementResponseWithoutKeys>;
    }>,
): ApiContentResponseWithoutKeys["elements"][number] {
    return {type: "UnorderedList", items};
}

function listItem(elements: ReadonlyArray<ApiContentParagraphBlockElementResponseWithoutKeys>): {
    readonly elements: ReadonlyArray<ApiContentParagraphBlockElementResponseWithoutKeys>;
} {
    return {elements};
}

function text(
    text: string,
    marks?: ApiContentTextInlineElement["marks"],
): ApiContentTextInlineElement {
    return {type: "Text", text, ...(marks ? {marks} : {})};
}

function mention(reference: ApiPostReferenceResponse): ApiContentInlineElementResponse {
    return {type: "Mention", reference};
}

runAgentWebPageTests<ChannelId, AgentWebChannelPage>({
    print: printAgentWebChannelPage,
    parse: parseAgentWebChannelPage,
    normalize: normalizeAgentWebChannelPage,
    tests: [
        {
            name: "head channel page with posts and pagination",
            pageLink: channelId,
            markdown: `\
# Announcements

Updates from the team.

---

[Next page »](/channel/announcements?after=2026-05-14T15:05:00.000Z)

<post from="[Alice](/human/alice)" time="May 14th at 11:00am EDT" comments="3">

Launch summary.

[See more »](/post/launch-notes)

</post>

<post from="[Bob](/human/bob)" time="May 14th at 11:05am EDT" comments="0">

Roadmap summary.

[See more »](/post/roadmap)

</post>
`,
            page: {
                type: "Channel",
                subType: "Head",
                name: "Announcements",
                description: content([paragraph([text("Updates from the team.")])]),
                pagination: {nextCursor: "2026-05-14T15:05:00.000Z"},
                posts: [
                    {
                        type: "Post",
                        author: aliceReference,
                        timeAttribute: "May 14th at 11:00am EDT",
                        commentCount: 3,
                        contentSnippet: content([paragraph([text("Launch summary.")])]),
                        reference: launchPostReference,
                    },
                    {
                        type: "Post",
                        author: bobReference,
                        timeAttribute: "May 14th at 11:05am EDT",
                        commentCount: 0,
                        contentSnippet: content([paragraph([text("Roadmap summary.")])]),
                        reference: roadmapPostReference,
                    },
                ],
                isEndOfPosts: false,
            },
        },
        {
            name: "head channel page with divider in description",
            pageLink: channelId,
            markdown: `\
# Announcements

Before divider

<hr />

After divider

---

End of posts.
`,
            page: {
                type: "Channel",
                subType: "Head",
                name: "Announcements",
                description: content([
                    paragraph([text("Before divider")]),
                    {type: "Divider"},
                    paragraph([text("After divider")]),
                ]),
                pagination: null,
                posts: [],
                isEndOfPosts: true,
            },
        },
        {
            name: "head channel page with wrong divider in description",
            pageLink: channelId,
            markdown: `\
# Announcements

Before divider

---

After divider
`,
            parseError: markdown`
Error: Expected \`<post>\` blocks in the channel posts section after the divider (\`---\`). Try
again with valid channel posts markdown on line 7 (or if you want to add a divider to your channel
description you can do so with the HTML divider syntax \`<hr />\`).
            `,
        },
        {
            name: "head channel page without posts section",
            pageLink: channelId,
            markdown: `\
# General
`,
            printMarkdown: `\
# General

---
`,
            page: {
                type: "Channel",
                subType: "Head",
                name: "General",
                description: content([]),
                pagination: null,
                posts: [],
                isEndOfPosts: false,
            },
        },
        {
            name: "head channel page with empty description at end of posts",
            pageLink: channelId,
            markdown: `\
# General

---

End of posts.
`,
            page: {
                type: "Channel",
                subType: "Head",
                name: "General",
                description: content([]),
                pagination: null,
                posts: [],
                isEndOfPosts: true,
            },
        },
        {
            name: "tail channel page with posts and pagination",
            pageLink: channelId,
            markdown: `\
Posts in Announcements. [Next page »](/channel/announcements?after=2026-05-14T15:05:00.000Z)

<post from="[Alice](/human/alice)" time="May 14th at 11:00am EDT" comments="0">

Launch summary.

[See more »](/post/launch-notes)

</post>
`,
            page: {
                type: "Channel",
                subType: "Tail",
                name: "Announcements",
                pagination: {nextCursor: "2026-05-14T15:05:00.000Z"},
                posts: [
                    {
                        type: "Post",
                        author: aliceReference,
                        timeAttribute: "May 14th at 11:00am EDT",
                        commentCount: 0,
                        contentSnippet: content([paragraph([text("Launch summary.")])]),
                        reference: launchPostReference,
                    },
                ],
                isEndOfPosts: false,
            },
        },
        {
            name: "tail channel page at end of posts",
            pageLink: channelId,
            markdown: `\
Posts in Announcements.

End of posts.
`,
            page: {
                type: "Channel",
                subType: "Tail",
                name: "Announcements",
                pagination: null,
                posts: [],
                isEndOfPosts: true,
            },
        },
        {
            name: "tail channel page with post without time attribute",
            pageLink: channelId,
            markdown: `\
Posts in Announcements.

<post from="[Alice](/human/alice)" comments="0">

Launch summary.

[See more »](/post/launch-notes)

</post>
`,
            page: {
                type: "Channel",
                subType: "Tail",
                name: "Announcements",
                pagination: null,
                posts: [
                    {
                        type: "Post",
                        author: aliceReference,
                        timeAttribute: null,
                        commentCount: 0,
                        contentSnippet: content([paragraph([text("Launch summary.")])]),
                        reference: launchPostReference,
                    },
                ],
                isEndOfPosts: false,
            },
        },
        {
            name: "tail channel page with see more link in post content snippet",
            pageLink: channelId,
            markdown: `\
Posts in Announcements.

<post from="[Alice](/human/alice)" time="May 14th at 11:00am EDT" comments="0">

Read the full context: [See more »](https://example.com/context)

[See more »](/post/launch-notes)

</post>
`,
            page: {
                type: "Channel",
                subType: "Tail",
                name: "Announcements",
                pagination: null,
                posts: [
                    {
                        type: "Post",
                        author: aliceReference,
                        timeAttribute: "May 14th at 11:00am EDT",
                        commentCount: 0,
                        contentSnippet: content([
                            paragraph([
                                text("Read the full context: "),
                                text("See more »", [
                                    {type: "Link", url: "https://example.com/context"},
                                ]),
                            ]),
                        ]),
                        reference: launchPostReference,
                    },
                ],
                isEndOfPosts: false,
            },
        },
        {
            name: "tail channel page with rich post content snippet",
            pageLink: channelId,
            markdown: `\
Posts in Announcements.

<post from="[Alice](/human/alice)" time="May 14th at 11:00am EDT" comments="0">

Review **launch scope** and *risks*.

- Confirm launch checklist

- Share **owner updates**

[See more »](/post/launch-notes)

</post>
`,
            page: {
                type: "Channel",
                subType: "Tail",
                name: "Announcements",
                pagination: null,
                posts: [
                    {
                        type: "Post",
                        author: aliceReference,
                        timeAttribute: "May 14th at 11:00am EDT",
                        commentCount: 0,
                        contentSnippet: content([
                            paragraph([
                                text("Review "),
                                text("launch scope", [{type: "Bold"}]),
                                text(" and "),
                                text("risks", [{type: "Italic"}]),
                                text("."),
                            ]),
                            unorderedList([
                                listItem([paragraph([text("Confirm launch checklist")])]),
                                listItem([
                                    paragraph([
                                        text("Share "),
                                        text("owner updates", [{type: "Bold"}]),
                                    ]),
                                ]),
                            ]),
                        ]),
                        reference: launchPostReference,
                    },
                ],
                isEndOfPosts: false,
            },
        },
        {
            name: "tail channel page with standalone see more link in post content snippet",
            pageLink: channelId,
            markdown: `\
Posts in Announcements.

<post from="[Alice](/human/alice)" time="May 14th at 11:00am EDT" comments="0">

[See more »](https://example.com/context)

[See more »](/post/launch-notes)

</post>
`,
            page: {
                type: "Channel",
                subType: "Tail",
                name: "Announcements",
                pagination: null,
                posts: [
                    {
                        type: "Post",
                        author: aliceReference,
                        timeAttribute: "May 14th at 11:00am EDT",
                        commentCount: 0,
                        contentSnippet: content([
                            paragraph([
                                text("See more »", [
                                    {type: "Link", url: "https://example.com/context"},
                                ]),
                            ]),
                        ]),
                        reference: launchPostReference,
                    },
                ],
                isEndOfPosts: false,
            },
        },
        {
            name: "tail channel page with standalone see more post mention title in post content snippet",
            pageLink: channelId,
            markdown: `\
Posts in Announcements.

<post from="[Alice](/human/alice)" time="May 14th at 11:00am EDT" comments="0">

[See more »](https://alpine.inc/post/see-more)

</post>
`,
            page: {
                type: "Channel",
                subType: "Tail",
                name: "Announcements",
                pagination: null,
                posts: [
                    {
                        type: "Post",
                        author: aliceReference,
                        timeAttribute: "May 14th at 11:00am EDT",
                        commentCount: 0,
                        contentSnippet: content([
                            paragraph([
                                text("See more »", [{type: "Link", url: "/post/see-more"}]),
                            ]),
                        ]),
                        reference: null,
                    },
                ],
                isEndOfPosts: false,
            },
        },
        {
            name: "tail channel page with standalone see more post mention in post content snippet",
            pageLink: channelId,
            markdown: `\
Posts in Announcements.

<post from="[Alice](/human/alice)" time="May 14th at 11:00am EDT" comments="0">

[See more »](/post/roadmap)

[See more »](/post/launch-notes)

</post>
`,
            printMarkdown: `\
Posts in Announcements.

<post from="[Alice](/human/alice)" time="May 14th at 11:00am EDT" comments="0">

[Roadmap](/post/roadmap)

[See more »](/post/launch-notes)

</post>
`,
            page: {
                type: "Channel",
                subType: "Tail",
                name: "Announcements",
                pagination: null,
                posts: [
                    {
                        type: "Post",
                        author: aliceReference,
                        timeAttribute: "May 14th at 11:00am EDT",
                        commentCount: 0,
                        contentSnippet: content([paragraph([mention(roadmapPostReference)])]),
                        reference: launchPostReference,
                    },
                ],
                isEndOfPosts: false,
            },
        },
        {
            name: "tail channel page without periods",
            pageLink: channelId,
            markdown: `\
Posts in Announcements

End of posts
`,
            printMarkdown: `\
Posts in Announcements.

End of posts.
`,
            page: {
                type: "Channel",
                subType: "Tail",
                name: "Announcements",
                pagination: null,
                posts: [],
                isEndOfPosts: true,
            },
        },
        {
            name: "head channel posts without divider",
            pageLink: channelId,
            markdown: `\
# Announcements

<post comments="0">

Launch notes

[See more »](/post/launch-notes)

</post>
`,
            parseError: markdown`
Error: Channel posts must be separated from the channel description with a divider (e.g. \`---\`).
Try again but add a divider before the posts section.
            `,
        },
        {
            name: "missing channel heading",
            pageLink: channelId,
            markdown: `\
## Announcements

Updates from the team.
`,
            parseError: markdown`
Error: Channel posts markdown must start with the channel name in a heading (e.g. \`# General\`) or
\u201CPosts in General\u201D. Try again with a proper start to channel markdown on line 1.
            `,
        },
        {
            name: "invalid tail channel posts preamble",
            pageLink: channelId,
            markdown: `\
Posts for Announcements

End of posts.
`,
            parseError: markdown`
Error: Channel posts markdown must start with \u201CPosts in My Channel\u201D (where \u201CMy
Channel\u201D is the actual name of the channel) when reading an earlier channel posts page. Try
again with a proper channel posts preamble on line 1.
            `,
        },
        {
            name: "channel content after end of posts",
            pageLink: channelId,
            markdown: `\
Posts in Announcements.

End of posts.

More posts.
`,
            parseError: markdown`
Error: Nothing may appear after \u201CEnd of posts\u201D in channel markdown. Try again after
removing the extra content after \u201CEnd of posts\u201D on line 5.
            `,
        },
        {
            name: "expected channel post block",
            pageLink: channelId,
            markdown: `\
# Announcements

Updates from the team.

---

Not a post.
`,
            parseError: markdown`
Error: Expected \`<post>\` blocks in the channel posts section after the divider (\`---\`). Try
again with valid channel posts markdown on line 7 (or if you want to add a divider to your channel
description you can do so with the HTML divider syntax \`<hr />\`).
            `,
        },
        {
            name: "unclosed channel post block",
            pageLink: channelId,
            markdown: `\
Posts in Announcements.

<post comments="0">

Launch notes
`,
            parseError: markdown`
Error: \`<post>\` on line 3 is missing a closing tag. Add a \`</post>\` closing tag and try again.
            `,
        },
        {
            name: "invalid channel pagination link",
            pageLink: channelId,
            markdown: `\
# Announcements

Updates from the team.

---

[Next page »](/post/launch-notes?after=2026-05-14T15:05:00.000Z)
`,
            parseError: markdown`
Error: Expected \u201CNext page »\u201D to link to a channel page with an \`?after\` cursor. Try
again with a valid channel pagination link.
            `,
        },
        {
            name: "tail channel page with post without see more link",
            pageLink: channelId,
            markdown: `\
Posts in Announcements.

<post comments="0">

Launch notes

</post>
`,
            page: {
                type: "Channel",
                subType: "Tail",
                name: "Announcements",
                pagination: null,
                posts: [
                    {
                        type: "Post",
                        author: null,
                        timeAttribute: null,
                        commentCount: 0,
                        contentSnippet: content([paragraph([text("Launch notes")])]),
                        reference: null,
                    },
                ],
                isEndOfPosts: false,
            },
        },
        {
            name: "tail channel page with non-see-more link at end of post content snippet",
            pageLink: channelId,
            markdown: `\
Posts in Announcements.

<post comments="0">

Launch notes

[Read more »](/post/launch-notes)

</post>
`,
            printMarkdown: `\
Posts in Announcements.

<post comments="0">

Launch notes

[Launch notes](/post/launch-notes)

</post>
`,
            page: {
                type: "Channel",
                subType: "Tail",
                name: "Announcements",
                pagination: null,
                posts: [
                    {
                        type: "Post",
                        author: null,
                        timeAttribute: null,
                        commentCount: 0,
                        contentSnippet: content([
                            paragraph([text("Launch notes")]),
                            paragraph([mention(launchPostReference)]),
                        ]),
                        reference: null,
                    },
                ],
                isEndOfPosts: false,
            },
        },
        {
            name: "invalid channel post author link",
            pageLink: channelId,
            markdown: `\
Posts in Announcements.

<post from="Alice" comments="0">

Launch notes

[See more »](/post/launch-notes)

</post>
`,
            parseError: markdown`
Error: Expected a link to a human or bot on line 3. For example:
\u201C[John](/human/john-doe)\u201D. Instead we found \u201CAlice\u201D. Try again with a valid link
to a human or bot.
            `,
        },
        {
            name: "empty",
            pageLink: channelId,
            markdown: `\
#

---
`,
            page: {
                type: "Channel",
                subType: "Head",
                name: "",
                description: {elements: []},
                pagination: null,
                posts: [],
                isEndOfPosts: false,
            },
        },
        {
            name: "tail channel page with standalone see more mention in post content snippet",
            pageLink: channelId,
            markdown: `\
Posts in Announcements.

<post from="[Alice](/human/alice)" time="May 14th at 11:00am EDT" comments="0">

[See more »](/post/see-more)

[See more »](/post/see-more)

</post>
`,
            printMarkdown: `\
Posts in Announcements.

<post from="[Alice](/human/alice)" time="May 14th at 11:00am EDT" comments="0">

[See more](/post/see-more)

[See more »](/post/see-more)

</post>
`,
            page: {
                type: "Channel",
                subType: "Tail",
                name: "Announcements",
                pagination: null,
                posts: [
                    {
                        type: "Post",
                        author: aliceReference,
                        timeAttribute: "May 14th at 11:00am EDT",
                        commentCount: 0,
                        contentSnippet: content([
                            paragraph([{type: "Mention", reference: seeMorePostReference}]),
                        ]),
                        reference: seeMorePostReference,
                    },
                ],
                isEndOfPosts: false,
            },
        },
        {
            name: "tail channel page with standalone see more mention in post content snippet when post doesn\u2019t have see more link",
            pageLink: channelId,
            markdown: `\
Posts in Announcements.

<post from="[Alice](/human/alice)" time="May 14th at 11:00am EDT" comments="0">

[See more](/post/see-more)

</post>
`,
            page: {
                type: "Channel",
                subType: "Tail",
                name: "Announcements",
                pagination: null,
                posts: [
                    {
                        type: "Post",
                        author: aliceReference,
                        timeAttribute: "May 14th at 11:00am EDT",
                        commentCount: 0,
                        contentSnippet: content([
                            paragraph([{type: "Mention", reference: seeMorePostReference}]),
                        ]),
                        reference: null,
                    },
                ],
                isEndOfPosts: false,
            },
        },
    ],
});
