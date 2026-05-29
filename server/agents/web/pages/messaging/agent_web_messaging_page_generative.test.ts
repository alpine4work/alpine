import fc, {Arbitrary} from "fast-check";
import {
    AgentWebMessagingPage,
    AgentWebMessagingPageBlock,
    AgentWebMessagingPageMessageBlock,
    AgentWebMessagingPagePreamblePagination,
    AgentWebMessagingPageTimeBlock,
    agentWebMessagingPageMessageNouns,
} from "~/server/agents/web/pages/messaging/agent_web_messaging_page.js";
import {normalizeAgentWebMessagingPage} from "~/server/agents/web/pages/messaging/normalize_agent_web_messaging_page.js";
import {parseAgentWebMessagingPage} from "~/server/agents/web/pages/messaging/parse_agent_web_messaging_page.js";
import {printAgentWebMessagingPage} from "~/server/agents/web/pages/messaging/print_agent_web_messaging_page.js";
import {runAgentWebPageGenerativeTests} from "~/server/agents/web/pages/run_agent_web_page_generative_tests.js";
import {
    ApiAccountTargetArbitrary,
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
        idAttribute: fc.oneof(
            {weight: 10, arbitrary: fc.constant(null)},
            {
                weight: 1,
                arbitrary: fc
                    .tuple(fc.integer({min: 0}), fc.integer({min: 1, max: 10}))
                    .map(([startMessageIndex, length]) => ({
                        startMessageIndex,
                        endMessageIndex: startMessageIndex + length,
                    })),
            },
        ),
        author: ApiAccountTargetArbitrary,
        timeAttribute: fc.oneof(ApiContentTextArbitrary, fc.constant(null)),
        timeZoneAttribute: fc.oneof(ApiContentTextArbitrary, fc.constant(null)),
        parent: fc.oneof(
            {weight: 10, arbitrary: fc.constant(null)},
            {
                weight: 1,
                arbitrary: fc.record({
                    citeAttribute: fc
                        .tuple(fc.integer({min: 0}), fc.integer({min: 1, max: 10}))
                        .map(([startMessageIndex, length]) => ({
                            startMessageIndex,
                            endMessageIndex: startMessageIndex + length,
                        })),
                    author: ApiAccountTargetArbitrary,
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

const AgentWebMessagingPagePreamblePaginationArbitrary: Arbitrary<AgentWebMessagingPagePreamblePagination> =
    fc.oneof(
        fc.record({
            target: ApiMentionTargetArbitrary,
            previousLink: fc.record({beforeMessageIndex: fc.integer({min: 0})}),
            nextLink: fc.constant(null),
        }),
        fc.record({
            target: ApiMentionTargetArbitrary,
            previousLink: fc.constant(null),
            nextLink: fc.record({afterMessageIndex: fc.integer({min: 0})}),
        }),
        fc.record({
            target: ApiMentionTargetArbitrary,
            previousLink: fc.record({beforeMessageIndex: fc.integer({min: 0})}),
            nextLink: fc.record({afterMessageIndex: fc.integer({min: 0})}),
        }),
    );

const AgentWebMessagingPageArbitrary: Arbitrary<AgentWebMessagingPage> = fc.record({
    preamble: fc.record({
        elements: fc.array(ApiContentInlineElementWithoutCommentMarkArbitrary, {maxLength: 4}),
        pagination: fc.oneof(
            {weight: 10, arbitrary: fc.constant(null)},
            {weight: 1, arbitrary: AgentWebMessagingPagePreamblePaginationArbitrary},
        ),
    }),
    isEndOfMessages: fc.boolean(),
    blocks: fc.array(AgentWebMessagingPageBlockArbitrary),
});

runAgentWebPageGenerativeTests({
    print: printAgentWebMessagingPage.bind(null, agentWebMessagingPageMessageNouns),
    parse: parseAgentWebMessagingPage.bind(null, agentWebMessagingPageMessageNouns),
    normalize: normalizeAgentWebMessagingPage,
    pageLink: fc.constant(true),
    page: AgentWebMessagingPageArbitrary,
});
