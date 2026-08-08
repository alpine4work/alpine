import fc, {Arbitrary} from "fast-check";
import {
    AgentWebAccountPage,
    normalizeAgentWebAccountPage,
    parseAgentWebAccountPage,
    printAgentWebAccountPage,
} from "~/server/agents/web/pages/agent_web_account_page.open_source.js";
import {runAgentWebPageGenerativeTests} from "~/server/agents/web/test_helpers/run_agent_web_page_generative_tests.js";
import {
    ApiContentTextArbitrary,
    createIdArbitrary,
} from "~/shared/api/content/test_helpers/api_content_arbitrary.js";
import {
    ApiAccountSpace,
    ApiAccountSpaceInactive,
} from "~/shared/api/specification/types/api_specification_convenience_types.open_source.js";
import {AccountId} from "~/shared/id/types/id_types.open_source.js";

const AgentWebAccountPageStateArbitrary: Arbitrary<ApiAccountSpaceInactive | null> = fc.oneof(
    fc.constant({type: "Removed"}),
    fc.constant({type: "InvitePending"}),
    fc.constant(null),
);

const AgentWebAccountPageRoleArbitrary: Arbitrary<ApiAccountSpace["role"]> = fc.constantFrom(
    "Owner",
    "Admin",
    "Member",
);

const AgentWebAccountPageShortNameArbitrary = ApiContentTextArbitrary.filter(
    text => text.trim() === text,
);

const AgentWebAccountPageArbitrary: Arbitrary<AgentWebAccountPage> = fc.record({
    type: fc.constant("Account"),
    name: ApiContentTextArbitrary,
    state: AgentWebAccountPageStateArbitrary,
    role: AgentWebAccountPageRoleArbitrary,
    shortName: AgentWebAccountPageShortNameArbitrary,
});

runAgentWebPageGenerativeTests({
    print: printAgentWebAccountPage,
    parse: parseAgentWebAccountPage,
    normalize: normalizeAgentWebAccountPage,
    pageLink: createIdArbitrary<AccountId>(),
    page: AgentWebAccountPageArbitrary,
});
