import fc, {Arbitrary} from "fast-check";
import {
    AgentWebTaskViewPage,
    normalizeAgentWebTaskViewPage,
    parseAgentWebTaskViewPage,
    printAgentWebTaskViewPage,
} from "~/server/agents/web/pages/agent_web_task_view_page.open_source.js";
import {
    AgentWebTaskQueryPagePaginationArbitrary,
    AgentWebTaskQueryPageUniqueTasksArbitrary,
} from "~/server/agents/web/test_helpers/agent_web_task_query_page_arbitrary.js";
import {runAgentWebPageGenerativeTests} from "~/server/agents/web/test_helpers/run_agent_web_page_generative_tests.js";

const AgentWebTaskViewPageArbitrary: Arbitrary<AgentWebTaskViewPage> = fc.record({
    type: fc.constant("TaskView"),
    pagination: fc.oneof(
        {weight: 5, arbitrary: fc.constant(null)},
        {weight: 1, arbitrary: AgentWebTaskQueryPagePaginationArbitrary},
    ),
    tasks: AgentWebTaskQueryPageUniqueTasksArbitrary,
    isEndOfTasks: fc.boolean(),
});

runAgentWebPageGenerativeTests({
    print: printAgentWebTaskViewPage,
    parse: parseAgentWebTaskViewPage,
    normalize: normalizeAgentWebTaskViewPage,
    pageLink: fc.constant(null),
    page: AgentWebTaskViewPageArbitrary,
});
