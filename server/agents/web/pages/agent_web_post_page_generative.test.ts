import fc, {Arbitrary} from "fast-check";
import {
    AgentWebPostPage,
    AgentWebPostPageCustomBlock,
    AgentWebPostPageHeadPagePreamble,
    AgentWebPostPageTailPagePreamble,
    normalizeAgentWebPostPage,
    parseAgentWebPostPage,
    printAgentWebPostPage,
} from "~/server/agents/web/pages/agent_web_post_page.js";
import {runAgentWebPageGenerativeTests} from "~/server/agents/web/pages/run_agent_web_page_generative_tests.js";
import {createAgentWebMessagingPageArbitrary} from "~/server/agents/web/test_helpers/agent_web_messaging_page_arbitrary.js";
import {
    ApiAccountReferenceArbitrary,
    ApiChannelReferenceArbitrary,
    ApiContentTextArbitrary,
    ApiContentWithoutCommentMarkArbitrary,
    createIdArbitrary,
} from "~/shared/api/markdown/test_helpers/api_content_arbitrary.js";
import {PostId} from "~/shared/id/types/id_types.js";

const ApiPostReferenceArbitrary = fc.record({
    type: fc.constant("Post"),
    id: createIdArbitrary<PostId>(),
    title: ApiContentTextArbitrary,
});

const AgentWebPostPageHeadPagePreambleArbitrary: Arbitrary<AgentWebPostPageHeadPagePreamble> =
    fc.record({
        type: fc.constant("HeadPage"),
        channel: fc.oneof(
            {weight: 1, arbitrary: fc.constant(null)},
            {weight: 10, arbitrary: ApiChannelReferenceArbitrary},
        ),
    });

const AgentWebPostPageTailPagePreambleArbitrary: Arbitrary<AgentWebPostPageTailPagePreamble> =
    fc.record({
        type: fc.constant("TailPage"),
        post: ApiPostReferenceArbitrary,
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
    subType: fc.constant("HeadPage"),
    ...createAgentWebMessagingPageArbitrary<
        AgentWebPostPageHeadPagePreamble,
        AgentWebPostPageCustomBlock
    >({
        preambleArbitrary: AgentWebPostPageHeadPagePreambleArbitrary,
        customBlockArbitrary: AgentWebPostPageCustomBlockArbitrary,
    }),
});

const AgentWebPostTailPageArbitrary: Arbitrary<AgentWebPostPage> = fc.record({
    type: fc.constant("Post"),
    subType: fc.constant("TailPage"),
    ...createAgentWebMessagingPageArbitrary<AgentWebPostPageTailPagePreamble>({
        preambleArbitrary: AgentWebPostPageTailPagePreambleArbitrary,
    }),
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
