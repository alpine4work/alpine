import fc, {Arbitrary} from "fast-check";
import {
    AgentWebTaskCollectionPage,
    apiTaskCollectionColors,
    normalizeAgentWebTaskCollectionPage,
    parseAgentWebTaskCollectionPage,
    printAgentWebTaskCollectionPage,
} from "~/server/agents/web/pages/agent_web_task_collection_page.js";
import {runAgentWebPageGenerativeTests} from "~/server/agents/web/test_helpers/run_agent_web_page_generative_tests.js";
import {
    ApiContentTextArbitrary,
    ApiTaskReferenceArbitrary,
    createIdArbitrary,
} from "~/shared/api/content/test_helpers/api_content_arbitrary.js";
import {TaskCollectionId} from "~/shared/id/types/id_types.js";

const AgentWebTaskCollectionPageArbitrary: Arbitrary<AgentWebTaskCollectionPage> = fc.record({
    type: fc.constant("TaskCollection"),
    name: ApiContentTextArbitrary,
    color: fc.oneof(
        {weight: 2, arbitrary: fc.constant(null)},
        {weight: 1, arbitrary: fc.constantFrom(...apiTaskCollectionColors)},
    ),
    tasks: fc.array(ApiTaskReferenceArbitrary),
});

runAgentWebPageGenerativeTests({
    print: printAgentWebTaskCollectionPage,
    parse: parseAgentWebTaskCollectionPage,
    normalize: normalizeAgentWebTaskCollectionPage,
    pageLink: createIdArbitrary<TaskCollectionId>(),
    page: AgentWebTaskCollectionPageArbitrary,
});
