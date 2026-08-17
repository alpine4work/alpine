import fc, {Arbitrary} from "fast-check";
import {
    AgentWebSpacePage,
    normalizeAgentWebSpacePage,
    parseAgentWebSpacePage,
    printAgentWebSpacePage,
} from "~/server/agents/web/pages/agent_web_space_page.open_source.js";
import {runAgentWebPageGenerativeTests} from "~/server/agents/web/test_helpers/run_agent_web_page_generative_tests.js";
import {
    ApiAccountReferenceArbitrary,
    ApiContentTextArbitrary,
    createIdArbitrary,
} from "~/shared/api/content/test_helpers/api_content_arbitrary.js";
import {SpaceId} from "~/shared/id/types/id_types.open_source.js";

const AgentWebSpacePageArbitrary: Arbitrary<AgentWebSpacePage> = fc.record({
    type: fc.constant("Space"),
    name: ApiContentTextArbitrary,
    members: fc.array(
        ApiAccountReferenceArbitrary.filter(member => member.bot === undefined),
        {maxLength: 12},
    ),
});

runAgentWebPageGenerativeTests({
    print: printAgentWebSpacePage,
    parse: parseAgentWebSpacePage,
    normalize: normalizeAgentWebSpacePage,
    pageLink: createIdArbitrary<SpaceId>(),
    page: AgentWebSpacePageArbitrary,
});
