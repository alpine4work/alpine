import fc, {Arbitrary} from "fast-check";
import {
    AgentWebPostPage,
    AgentWebPostPageCustomBlock,
    AgentWebPostPageHeadPagePreamble,
    AgentWebPostPageTailPagePreamble,
    normalizeAgentWebPostPage,
    parseAgentWebPostPage,
    printAgentWebPostPage,
} from "~/server/agents/web/pages/agent_web_post_page.open_source.js";
import {
    AgentWebMessagingPageBlockArbitrary,
    AgentWebMessagingPagePaginationArbitrary,
    AgentWebMessagingPageTimeBlockArbitrary,
} from "~/server/agents/web/test_helpers/agent_web_messaging_page_arbitrary.js";
import {runAgentWebPageGenerativeTests} from "~/server/agents/web/test_helpers/run_agent_web_page_generative_tests.js";
import {
    ApiAccountReferenceArbitrary,
    ApiChannelReferenceArbitrary,
    ApiContentTextArbitrary,
    ApiContentWithoutCommentMarkArbitrary,
    createIdArbitrary,
} from "~/shared/api/content/test_helpers/api_content_arbitrary.js";
import {PostId} from "~/shared/id/types/id_types.open_source.js";

const ApiPostReferenceArbitrary = fc.record({
    type: fc.constant("Post"),
    id: createIdArbitrary<PostId>(),
    title: ApiContentTextArbitrary,
});

const AgentWebPostPageHeadPagePreambleArbitrary: Arbitrary<AgentWebPostPageHeadPagePreamble> =
    fc.record({
        type: fc.constant("Head"),
        channel: fc.oneof(
            {weight: 1, arbitrary: fc.constant(null)},
            {weight: 10, arbitrary: ApiChannelReferenceArbitrary},
        ),
    });

const AgentWebPostPageCustomBlockArbitrary: Arbitrary<AgentWebPostPageCustomBlock> = fc.record({
    type: fc.constant("Custom"),
    tagName: fc.constant("post"),
    author: ApiAccountReferenceArbitrary,
    timeAttribute: fc.constant(null),
    timeZoneAttribute: fc.oneof(ApiContentTextArbitrary, fc.constant(null)),
    content: ApiContentWithoutCommentMarkArbitrary,
});

const AgentWebPostHeadPageArbitrary: Arbitrary<AgentWebPostPage> = fc.record({
    type: fc.constant("Post"),
    subType: fc.constant("Head"),
    preamble: AgentWebPostPageHeadPagePreambleArbitrary,
    pagination: fc.oneof(
        {weight: 10, arbitrary: fc.constant(null)},
        {weight: 1, arbitrary: AgentWebMessagingPagePaginationArbitrary},
    ),
    isEndOfMessages: fc.boolean(),
    blocks: fc
        .tuple(
            fc.oneof(
                fc.tuple(AgentWebPostPageCustomBlockArbitrary),
                fc.tuple(
                    AgentWebMessagingPageTimeBlockArbitrary,
                    AgentWebPostPageCustomBlockArbitrary,
                ),
            ),
            fc.array(AgentWebMessagingPageBlockArbitrary),
        )
        .map(([blocks1, blocks2]) => [...blocks1, ...blocks2]),
});

const AgentWebPostPageTailPagePreambleArbitrary: Arbitrary<AgentWebPostPageTailPagePreamble> =
    fc.record({
        type: fc.constant("Tail"),
        post: ApiPostReferenceArbitrary,
    });

const AgentWebPostTailPageArbitrary: Arbitrary<AgentWebPostPage> = fc.record({
    type: fc.constant("Post"),
    subType: fc.constant("Tail"),
    preamble: AgentWebPostPageTailPagePreambleArbitrary,
    pagination: fc.oneof(
        {weight: 10, arbitrary: fc.constant(null)},
        {weight: 1, arbitrary: AgentWebMessagingPagePaginationArbitrary},
    ),
    isEndOfMessages: fc.boolean(),
    blocks: fc.array(AgentWebMessagingPageBlockArbitrary),
});

const AgentWebPostPageArbitrary: Arbitrary<AgentWebPostPage> = fc.oneof(
    AgentWebPostHeadPageArbitrary,
    AgentWebPostTailPageArbitrary,
);

runAgentWebPageGenerativeTests({
    print: printAgentWebPostPage,
    parse: parseAgentWebPostPage,
    normalize: normalizeAgentWebPostPage,
    pageLink: createIdArbitrary<PostId>(),
    page: AgentWebPostPageArbitrary,
});
