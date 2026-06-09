import fc, {Arbitrary} from "fast-check";
import {
    AgentWebPostPage,
    AgentWebPostPageCustomBlock,
    AgentWebPostPagePreamble,
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

const AgentWebPostPagePreambleArbitrary: Arbitrary<AgentWebPostPagePreamble> = fc.record({
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

const AgentWebPostPageArbitrary: Arbitrary<AgentWebPostPage> = fc.record({
    type: fc.constant("Post"),
    ...createAgentWebMessagingPageArbitrary<AgentWebPostPagePreamble, AgentWebPostPageCustomBlock>({
        preambleArbitrary: AgentWebPostPagePreambleArbitrary,
        customBlockArbitrary: AgentWebPostPageCustomBlockArbitrary,
    }),
});

runAgentWebPageGenerativeTests({
    print: printAgentWebPostPage,
    parse: parseAgentWebPostPage,
    normalize: normalizeAgentWebPostPage,
    pageLink: createIdArbitrary<PostId>(),
    page: AgentWebPostPageArbitrary,
});
