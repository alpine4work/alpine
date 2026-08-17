import {createAgentWebPageStoredLinkPathname} from "~/server/agents/web/create_agent_web_page_stored_link_pathname.open_source.js";
import {
    AgentWebSpacePage,
    normalizeAgentWebSpacePage,
    parseAgentWebSpacePage,
    printAgentWebSpacePage,
} from "~/server/agents/web/pages/agent_web_space_page.open_source.js";
import {runAgentWebPageTests} from "~/server/agents/web/test_helpers/run_agent_web_page_tests.js";
import {ApiAccountReferenceResponse} from "~/shared/api/specification/types/api_specification_convenience_types.open_source.js";
import {markdown} from "~/shared/helpers/string/markdown.js";
import {generateId} from "~/shared/id/id.open_source.js";
import {AccountId, BotId, SpaceId} from "~/shared/id/types/id_types.open_source.js";

const spaceId = generateId<SpaceId>();

const aliceReference: ApiAccountReferenceResponse = {
    type: "Account",
    id: generateId<AccountId>(),
    title: "Alice Smith",
    shortName: "Alice",
};

const bobReference: ApiAccountReferenceResponse = {
    type: "Account",
    id: generateId<AccountId>(),
    title: "Bob Jones",
    shortName: "Bob",
};

const botReference: ApiAccountReferenceResponse = {
    type: "Account",
    id: generateId<AccountId>(),
    title: "Helper Bot",
    shortName: "Helper",
    bot: {id: generateId<BotId>()},
};

runAgentWebPageTests<SpaceId, AgentWebSpacePage>({
    print: printAgentWebSpacePage,
    parse: parseAgentWebSpacePage,
    normalize: normalizeAgentWebSpacePage,
    tests: [
        {
            name: "space page with members",
            pageLink: spaceId,
            markdown: `\
# Product Team

## Members

- [Alice Smith](/human/alice-smith)
- [Bob Jones](/human/bob-jones)
`,
            page: {
                type: "Space",
                name: "Product Team",
                members: [aliceReference, bobReference],
            },
        },
        {
            name: "space page without members",
            pageLink: spaceId,
            markdown: `\
# Empty Space

## Members
`,
            page: {
                type: "Space",
                name: "Empty Space",
                members: [],
            },
        },
        {
            name: "member heading is case insensitive and may be singular",
            pageLink: spaceId,
            markdown: `\
# Product Team

## member

- [Alice Smith](/human/alice-smith)
`,
            printMarkdown: `\
# Product Team

## Members

- [Alice Smith](/human/alice-smith)
`,
            page: {
                type: "Space",
                name: "Product Team",
                members: [aliceReference],
            },
        },
        {
            name: "markdown syntax in names is escaped",
            pageLink: spaceId,
            markdown: `\
# Research & \\[Development]

## Members

- [Alice \\[R\\&D\\]](/human/alice-r-and-d)
`,
            page: {
                type: "Space",
                name: "Research & [Development]",
                members: [
                    {
                        ...aliceReference,
                        title: "Alice [R&D]",
                        shortName: "Alice",
                    },
                ],
            },
        },
        {
            name: "missing space name",
            pageLink: spaceId,
            markdown: `\
Product Team

## Members
`,
            parseError: markdown`
Error: Expected the space name at the start of the page. Try again with a markdown h1 first (e.g.
\`# Acme\`).
            `,
        },
        {
            name: "missing members heading",
            pageLink: spaceId,
            markdown: `\
# Product Team
`,
            parseError: markdown`
Error: Expected a markdown h2 named \u201cMembers\u201d on line unknown. Try again with
\`## Members\` after the space name.
            `,
        },
        {
            name: "unexpected section after members heading",
            pageLink: spaceId,
            markdown: `\
# Product Team

## Members

Extra content.
`,
            parseError: markdown`
Error: Unexpected markdown on line 5. Try again with only an unordered list of human links after
\`## Members\`.
            `,
        },
        {
            name: "ordered member list",
            pageLink: spaceId,
            markdown: `\
# Product Team

## Members

1. [Alice Smith](/human/alice-smith)
`,
            parseError: markdown`
Error: Unexpected markdown on line 5. Try again with only an unordered list of human links after
\`## Members\`.
            `,
        },
        {
            name: "member list item must only contain a link",
            pageLink: spaceId,
            markdown: `\
# Product Team

## Members

- Alice Smith
`,
            parseError: markdown`
Error: Expected a link to a human on line 5 (e.g. \`- [Alice](/human/alice)\`). You may only list
humans you\u2019ve previously seen. Try calling the \`search\` tool to find the human you want to
list, then try again with their link.
            `,
        },
        {
            name: "unknown human link",
            pageLink: spaceId,
            markdown: `\
# Product Team

## Members

- [Unknown](/human/unknown)
`,
            parseError: markdown`
Error: Expected a link to a human on line 5 (e.g. \`- [Alice](/human/alice)\`). You may only list
humans you\u2019ve previously seen. Try calling the \`search\` tool to find the human you want to
list, then try again with their link.
            `,
        },
        {
            name: "bot link is not a member",
            pageLink: spaceId,
            markdown: `\
# Product Team

## Members

- [Helper Bot](/bot/helper-bot)
`,
            setupStorage: async storage => {
                await createAgentWebPageStoredLinkPathname(storage, botReference);
            },
            parseError: markdown`
Error: Expected a link to a human on line 5 (e.g. \`- [Alice](/human/alice)\`). You may only list
humans you\u2019ve previously seen. Try calling the \`search\` tool to find the human you want to
list, then try again with their link.
            `,
        },
    ],
});
