import fc, {Arbitrary} from "fast-check";
import {
    AgentWebMessagingPageBase,
    AgentWebMessagingPageBasePreamblePagination,
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
    ApiAccountTargetArbitrary,
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

const AgentWebMessagingPageBasePreamblePaginationArbitrary: Arbitrary<AgentWebMessagingPageBasePreamblePagination> =
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

const AgentWebMessagingPageBaseArbitrary: Arbitrary<AgentWebMessagingPageBase> = fc.record({
    preamble: fc.record({
        elements: fc.array(ApiContentInlineElementWithoutCommentMarkArbitrary, {maxLength: 4}),
        pagination: fc.oneof(
            {weight: 10, arbitrary: fc.constant(null)},
            {weight: 1, arbitrary: AgentWebMessagingPageBasePreamblePaginationArbitrary},
        ),
    }),
    isEndOfMessages: fc.boolean(),
    blocks: fc.array(AgentWebMessagingPageBlockArbitrary),
});

runAgentWebPageGenerativeTests({
    print: printAgentWebMessagingPageBase.bind(null, agentWebMessagingPageMessageNouns),
    parse: parseAgentWebMessagingPageBase.bind(null, agentWebMessagingPageMessageNouns),
    normalize: normalizeAgentWebMessagingPageBase,
    pageLink: fc.constant(true),
    page: AgentWebMessagingPageBaseArbitrary,
});
