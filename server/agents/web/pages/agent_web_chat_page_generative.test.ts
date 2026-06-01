import fc, {Arbitrary} from "fast-check";
import {
    AgentWebChatPage,
    AgentWebChatPagePreamble,
    normalizeAgentWebChatPage,
    parseAgentWebChatPage,
    printAgentWebChatPage,
} from "~/server/agents/web/pages/agent_web_chat_page.js";
import {runAgentWebPageGenerativeTests} from "~/server/agents/web/pages/run_agent_web_page_generative_tests.js";
import {createAgentWebMessagingPageArbitrary} from "~/server/agents/web/test_helpers/agent_web_messaging_page_arbitrary.js";
import {
    ApiAccountTargetArbitrary,
    ApiContentTextArbitrary,
    createIdArbitrary,
    createUnionArbitrary,
} from "~/shared/api/markdown/test_helpers/api_content_arbitrary.js";
import {assertNonEmptyReadonlyArray} from "~/shared/helpers/array/non_empty_readonly_array.js";
import {ChatId} from "~/shared/id/types/id_types.js";

const AgentWebChatPagePreambleArbitrary = createUnionArbitrary<AgentWebChatPagePreamble>({
    Direct: fc.record({
        type: fc.constant("Direct"),
        members: fc
            .array(ApiAccountTargetArbitrary, {minLength: 1, maxLength: 7})
            .map(assertNonEmptyReadonlyArray),
    }),
    Room: fc.record({
        type: fc.constant("Room"),
        name: ApiContentTextArbitrary,
    }),
});

const AgentWebChatPageArbitrary: Arbitrary<AgentWebChatPage> = fc.record({
    type: fc.constant("Chat"),
    ...createAgentWebMessagingPageArbitrary<AgentWebChatPagePreamble>(
        AgentWebChatPagePreambleArbitrary,
    ),
});

runAgentWebPageGenerativeTests({
    print: printAgentWebChatPage,
    parse: parseAgentWebChatPage,
    normalize: normalizeAgentWebChatPage,
    pageLink: createIdArbitrary<ChatId>(),
    page: AgentWebChatPageArbitrary,
});
