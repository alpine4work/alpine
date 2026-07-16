import fc, {Arbitrary} from "fast-check";
import {
    AgentWebTaskCollectionPage,
    AgentWebTaskCollectionPageDefaults,
    apiTaskCollectionColors,
    normalizeAgentWebTaskCollectionPage,
    parseAgentWebTaskCollectionPage,
    printAgentWebTaskCollectionPage,
} from "~/server/agents/web/pages/agent_web_task_collection_page.js";
import {
    AgentWebTaskQueryPagePaginationArbitrary,
    AgentWebTaskQueryPageQueryArbitrary,
    AgentWebTaskQueryPageUniqueTasksArbitrary,
} from "~/server/agents/web/test_helpers/agent_web_task_query_page_arbitrary.js";
import {runAgentWebPageGenerativeTests} from "~/server/agents/web/test_helpers/run_agent_web_page_generative_tests.js";
import {
    ApiContentTextArbitrary,
    createIdArbitrary,
} from "~/shared/api/content/test_helpers/api_content_arbitrary.js";
import {TaskCollectionId} from "~/shared/id/types/id_types.js";

// Filters that reference accounts or task collections are left to the task query
// filter generative test since they need stored links to print.
const AgentWebTaskCollectionPageDefaultsArbitrary: Arbitrary<AgentWebTaskCollectionPageDefaults | null> =
    fc.oneof(
        {weight: 2, arbitrary: fc.constant(null)},
        {
            weight: 1,
            arbitrary: AgentWebTaskQueryPageQueryArbitrary.map(defaults =>
                defaults.filters.length > 0 || defaults.sorts.length > 0 ? defaults : null,
            ),
        },
    );

const AgentWebTaskCollectionHeadPageArbitrary: Arbitrary<AgentWebTaskCollectionPage> = fc.record({
    type: fc.constant("TaskCollection"),
    subType: fc.constant("Head"),
    name: ApiContentTextArbitrary,
    color: fc.oneof(
        {weight: 2, arbitrary: fc.constant(null)},
        {weight: 1, arbitrary: fc.constantFrom(...apiTaskCollectionColors)},
    ),
    defaults: AgentWebTaskCollectionPageDefaultsArbitrary,
    pagination: fc.oneof(
        {weight: 2, arbitrary: fc.constant(null)},
        {weight: 1, arbitrary: AgentWebTaskQueryPagePaginationArbitrary},
    ),
    tasks: AgentWebTaskQueryPageUniqueTasksArbitrary,
    isEndOfTasks: fc.boolean(),
});

const AgentWebTaskCollectionTailPageArbitrary: Arbitrary<AgentWebTaskCollectionPage> = fc.record({
    type: fc.constant("TaskCollection"),
    subType: fc.constant("Tail"),
    name: ApiContentTextArbitrary,
    pagination: fc.oneof(
        {weight: 2, arbitrary: fc.constant(null)},
        {weight: 1, arbitrary: AgentWebTaskQueryPagePaginationArbitrary},
    ),
    tasks: AgentWebTaskQueryPageUniqueTasksArbitrary,
    isEndOfTasks: fc.boolean(),
});

runAgentWebPageGenerativeTests({
    print: printAgentWebTaskCollectionPage,
    parse: parseAgentWebTaskCollectionPage,
    normalize: normalizeAgentWebTaskCollectionPage,
    pageLink: createIdArbitrary<TaskCollectionId>(),
    page: fc.oneof(
        AgentWebTaskCollectionHeadPageArbitrary,
        AgentWebTaskCollectionTailPageArbitrary,
    ),
});
