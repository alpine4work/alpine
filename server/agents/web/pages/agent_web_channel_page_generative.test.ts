import fc, {Arbitrary} from "fast-check";
import {
    AgentWebChannelPage,
    AgentWebChannelPagePostBlock,
    normalizeAgentWebChannelPage,
    parseAgentWebChannelPage,
    printAgentWebChannelPage,
} from "~/server/agents/web/pages/agent_web_channel_page.js";
import {runAgentWebPageGenerativeTests} from "~/server/agents/web/test_helpers/run_agent_web_page_generative_tests.js";
import {
    ApiAccountReferenceArbitrary,
    ApiContentTextArbitrary,
    ApiContentWithoutCommentMarkArbitrary,
    createIdArbitrary,
} from "~/shared/api/content/test_helpers/api_content_arbitrary.js";
import {ChannelId, PostId} from "~/shared/id/types/id_types.js";

const ApiPostReferenceArbitrary = fc.record({
    type: fc.constant("Post"),
    id: createIdArbitrary<PostId>(),
    title: ApiContentTextArbitrary,
});

const AgentWebChannelPagePostBlockArbitrary: Arbitrary<AgentWebChannelPagePostBlock> = fc.record({
    type: fc.constant("Post"),
    author: fc.oneof(
        {weight: 10, arbitrary: ApiAccountReferenceArbitrary},
        {weight: 1, arbitrary: fc.constant(null)},
    ),
    timeAttribute: fc.oneof(
        {weight: 10, arbitrary: ApiContentTextArbitrary},
        {weight: 1, arbitrary: fc.constant(null)},
    ),
    commentCount: fc.integer({min: 0, max: 1000}),
    contentSnippet: ApiContentWithoutCommentMarkArbitrary,
    reference: fc.oneof(
        {weight: 10, arbitrary: ApiPostReferenceArbitrary},
        {weight: 1, arbitrary: fc.constant(null)},
    ),
});

const AgentWebChannelPagePaginationArbitrary = fc.record({
    nextCursor: fc.constantFrom(
        "2026-05-14",
        "2026-05-14T15:05",
        "2026-05-14T15:05:10",
        "2026-05-14T15:05:10.123",
    ),
});

const AgentWebChannelHeadPageArbitrary: Arbitrary<AgentWebChannelPage> = fc.record({
    type: fc.constant("Channel"),
    subType: fc.constant("Head"),
    name: ApiContentTextArbitrary,
    description: ApiContentWithoutCommentMarkArbitrary,
    pagination: fc.oneof(
        {weight: 10, arbitrary: fc.constant(null)},
        {weight: 1, arbitrary: AgentWebChannelPagePaginationArbitrary},
    ),
    posts: fc.array(AgentWebChannelPagePostBlockArbitrary),
    isEndOfPosts: fc.boolean(),
});

const AgentWebChannelTailPageArbitrary: Arbitrary<AgentWebChannelPage> = fc.record({
    type: fc.constant("Channel"),
    subType: fc.constant("Tail"),
    name: ApiContentTextArbitrary,
    pagination: fc.oneof(
        {weight: 10, arbitrary: fc.constant(null)},
        {weight: 1, arbitrary: AgentWebChannelPagePaginationArbitrary},
    ),
    posts: fc.array(AgentWebChannelPagePostBlockArbitrary),
    isEndOfPosts: fc.boolean(),
});

runAgentWebPageGenerativeTests({
    print: printAgentWebChannelPage,
    parse: parseAgentWebChannelPage,
    normalize: normalizeAgentWebChannelPage,
    pageLink: createIdArbitrary<ChannelId>(),
    page: fc.oneof(AgentWebChannelHeadPageArbitrary, AgentWebChannelTailPageArbitrary),
});
