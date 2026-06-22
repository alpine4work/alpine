import {createAgentWebPageStoredLinkPathname} from "~/server/agents/web/create_agent_web_page_stored_link_pathname.js";
import {
    AgentWebChannelPage,
    normalizeAgentWebChannelPage,
    parseAgentWebChannelPage,
    printAgentWebChannelPage,
} from "~/server/agents/web/pages/agent_web_channel_page.js";
import {runAgentWebPageTests} from "~/server/agents/web/test_helpers/run_agent_web_page_tests.js";
import {
    ApiContentParagraphBlockElementResponseWithoutKeys,
    ApiContentResponseWithoutKeys,
} from "~/shared/api/specification/types/api_content_response_without_keys.js";
import {
    ApiAccountReferenceResponse,
    ApiContentInlineElementResponse,
    ApiContentTextInlineElement,
    ApiPostReferenceResponse,
} from "~/shared/api/specification/types/api_specification_convenience_types.js";
import {generateId} from "~/shared/id/id.js";
import {AccountId, BotId, ChannelId, PostId} from "~/shared/id/types/id_types.js";

const channelId = generateId<ChannelId>();
const launchPostId = generateId<PostId>();
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

function text(text: string): ApiContentTextInlineElement {
    return {type: "Text", text};
}

runAgentWebPageTests<ChannelId, AgentWebChannelPage>({
    print: printAgentWebChannelPage,
    parse: parseAgentWebChannelPage,
    normalize: normalizeAgentWebChannelPage,
    tests: [
        {
            name: "head channel page with posts and pagination",
            pageLink: channelId,
            // NOCOMMIT: Better search param syntax
            markdown: `\
# Announcements

Updates from the team.

---

[Next page »](/channel/announcements?after=2026-05-14T15%3A05%3A00.000Z)

<post from="[Alice](/human/alice)" time="May 14th at 11:00am EDT">

Launch notes

[See more »](/post/launch-notes)

</post>

<post from="[Bob](/human/bob)" time="May 14th at 11:05am EDT">

Roadmap

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
                        reference: launchPostReference,
                    },
                    {
                        type: "Post",
                        author: bobReference,
                        timeAttribute: "May 14th at 11:05am EDT",
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
Posts in Announcements. [Next page »](/channel/announcements?after=2026-05-14T15%3A05%3A00.000Z)

<post from="[Alice](/human/alice)" time="May 14th at 11:00am EDT">

Launch notes

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

<post from="[Alice](/human/alice)">

Launch notes

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

<post>

Launch notes

[See more »](/post/launch-notes)

</post>
`,
            parseError:
                "Channel posts must be separated from the channel description with a divider " +
                "(e.g. `---`). Try again but add a divider before the posts section.",
        },
        {
            name: "missing channel heading",
            pageLink: channelId,
            markdown: `\
## Announcements

Updates from the team.
`,
            parseError:
                "Channel posts markdown must start with the channel name in a heading " +
                "(e.g. `# General`) or \u201CPosts in General\u201D. Try again with a proper start " +
                "to channel markdown on line 1.",
        },
        {
            name: "invalid tail channel posts preamble",
            pageLink: channelId,
            markdown: `\
Posts for Announcements

End of posts.
`,
            parseError:
                "Channel posts markdown must start with \u201CPosts in My Channel\u201D " +
                "(where \u201CMy Channel\u201D is the actual name of the channel) when reading an " +
                "earlier channel posts page. Try again with a proper channel posts preamble on line 1.",
        },
        {
            name: "channel content after end of posts",
            pageLink: channelId,
            markdown: `\
Posts in Announcements.

End of posts.

More posts.
`,
            parseError:
                "Nothing may appear after \u201CEnd of posts\u201D in channel markdown. Try again " +
                "after removing the extra content after \u201CEnd of posts\u201D on line 5.",
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
            parseError:
                "Expected `<post>` blocks in the channel posts section. Try again with valid " +
                "channel posts markdown on line 7.",
        },
        {
            name: "unclosed channel post block",
            pageLink: channelId,
            markdown: `\
Posts in Announcements.

<post>

Launch notes
`,
            parseError:
                "`<post>` on line 3 is missing a closing tag. Add a `</post>` closing tag " +
                "and try again.",
        },
        {
            name: "invalid channel pagination link",
            pageLink: channelId,
            markdown: `\
# Announcements

Updates from the team.

---

[Next page »](/post/launch-notes?after=2026-05-14T15%3A05%3A00.000Z)
`,
            parseError:
                "Expected \u201CNext page »\u201D to link to a channel page with an `?after` cursor. " +
                "Try again with a valid channel pagination link.",
        },
        {
            name: "missing channel post link",
            pageLink: channelId,
            markdown: `\
Posts in Announcements.

<post>

</post>
`,
            parseError:
                "Every channel `<post>` must end with a `[See more »](/post/...)` link. " +
                "Try again with the post link at the end of the `<post>` on line 3.",
        },
        {
            name: "invalid channel post link text",
            pageLink: channelId,
            markdown: `\
Posts in Announcements.

<post>

Launch notes

[Read more »](/post/launch-notes)

</post>
`,
            parseError:
                "Every channel `<post>` must end with a `[See more »](/post/...)` link. " +
                "Try again with the post link at the end of the `<post>` on line 3.",
        },
        {
            name: "channel post link to non-post page",
            pageLink: channelId,
            markdown: `\
Posts in Announcements.

<post>

Launch notes

[See more »](/channel/announcements)

</post>
`,
            setupStorage: async storage => {
                await createAgentWebPageStoredLinkPathname(storage, {
                    type: "Channel",
                    id: channelId,
                    title: "Announcements",
                });
            },
            parseError:
                "Expected `See more »` to link to a post. Try again with a valid post link at " +
                "the end of the `<post>` on line 3.",
        },
        {
            name: "invalid channel post author link",
            pageLink: channelId,
            markdown: `\
Posts in Announcements.

<post from="Alice">

Launch notes

[See more »](/post/launch-notes)

</post>
`,
            parseError:
                "Expected a link to a human or bot on line 3. For example: \u201C" +
                "[John](/human/john-doe)\u201D. Instead we found \u201CAlice\u201D. Try again with a " +
                "valid link to a human or bot.",
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
    ],
});
