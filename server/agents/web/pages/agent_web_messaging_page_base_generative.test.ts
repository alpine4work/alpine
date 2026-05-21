import fc, {Arbitrary} from "fast-check";
import {
    AgentWebMessagingPageBase,
    AgentWebMessagingPageBasePreamble,
    AgentWebMessagingPageBlock,
    AgentWebMessagingPageMessageBlock,
    AgentWebMessagingPageTimeBlock,
    agentWebMessagingPageMessageNouns,
    normalizeAgentWebMessagingPageBase,
    parseAgentWebMessagingPageBase,
    printAgentWebMessagingPageBase,
} from "~/server/agents/web/pages/agent_web_messaging_page_base.js";
import {runAgentWebPageGenerativeTests} from "~/server/agents/web/pages/run_agent_web_page_generative_tests.js";
import {
    ApiContentInlineElementWithoutCommentMarkArbitrary,
    ApiContentTextArbitrary,
    ApiContentWithoutCommentMarkArbitrary,
    ApiMentionTargetArbitrary,
    createUnionArbitrary,
} from "~/shared/api/markdown/test_helpers/api_content_arbitrary.js";

const AgentWebMessagingPageTimeBlockArbitrary: Arbitrary<AgentWebMessagingPageTimeBlock> =
    fc.record({
        type: fc.constant("Time"),
        timeContent: ApiContentTextArbitrary,
    });

const AgentWebMessagingPageMessageBlockArbitrary: Arbitrary<AgentWebMessagingPageMessageBlock> =
    fc.record({
        type: fc.constant("Message"),
        tagName: fc.oneof(fc.constant("human"), fc.constant("bot")),
        nameAttribute: ApiContentTextArbitrary,
        timeAttribute: fc.oneof(ApiContentTextArbitrary, fc.constant(null)),
        timeZoneAttribute: fc.oneof(ApiContentTextArbitrary, fc.constant(null)),
        parent: fc.oneof(
            {weight: 10, arbitrary: fc.constant(null)},
            {
                weight: 1,
                arbitrary: fc.record({
                    nameAttribute: ApiContentTextArbitrary,
                    previewContent: ApiContentWithoutCommentMarkArbitrary,
                }),
            },
        ),
        content: ApiContentWithoutCommentMarkArbitrary,
    });

const AgentWebMessagingPageBlockArbitrary = createUnionArbitrary<AgentWebMessagingPageBlock>({
    Time: {weight: 1, arbitrary: AgentWebMessagingPageTimeBlockArbitrary},
    Message: {weight: 10, arbitrary: AgentWebMessagingPageMessageBlockArbitrary},
});

const AgentWebMessagingPagePaginationLinkArbitrary: Arbitrary<
    AgentWebMessagingPageBasePreamble["paginationLink"]
> = fc.oneof(
    {weight: 10, arbitrary: fc.constant(null)},
    {
        weight: 1,
        arbitrary: fc.record({
            text: fc.constant("Previous page »"),
            target: ApiMentionTargetArbitrary,
            searchParams: fc
                .integer({min: 0})
                .map(index => new URLSearchParams([["before", `${index}`]])),
        }),
    },
    {
        weight: 1,
        arbitrary: fc.record({
            text: fc.constant("Next page »"),
            target: ApiMentionTargetArbitrary,
            searchParams: fc
                .integer({min: 0})
                .map(index => new URLSearchParams([["after", `${index}`]])),
        }),
    },
);

const AgentWebMessagingPageBaseArbitrary: Arbitrary<AgentWebMessagingPageBase> = fc.record({
    preamble: fc.record({
        elements: fc.array(ApiContentInlineElementWithoutCommentMarkArbitrary, {maxLength: 4}),
        paginationLink: AgentWebMessagingPagePaginationLinkArbitrary,
    }),
    blocks: fc.array(AgentWebMessagingPageBlockArbitrary),
});

runAgentWebPageGenerativeTests({
    print: printAgentWebMessagingPageBase.bind(null, agentWebMessagingPageMessageNouns),
    parse: parseAgentWebMessagingPageBase.bind(null, agentWebMessagingPageMessageNouns),
    normalize: normalizeAgentWebMessagingPageBase,
    pageLink: fc.constant(true),
    page: AgentWebMessagingPageBaseArbitrary,
});
