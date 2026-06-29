import fc, {Arbitrary} from "fast-check";
import {
    AgentWebTaskPage,
    normalizeAgentWebTaskPage,
    parseAgentWebTaskPage,
    printAgentWebTaskPage,
} from "~/server/agents/web/pages/agent_web_task_page.js";
import {runAgentWebPageGenerativeTests} from "~/server/agents/web/test_helpers/run_agent_web_page_generative_tests.js";
import {
    ApiAccountReferenceArbitrary,
    ApiContentTextArbitrary,
    ApiTaskCollectionReferenceArbitrary,
    ApiTaskStatusArbitrary,
    createIdArbitrary,
} from "~/shared/api/content/test_helpers/api_content_arbitrary.js";
import {ApiTaskPriority} from "~/shared/api/specification/types/api_specification_convenience_types.js";
import {TaskId} from "~/shared/id/types/id_types.js";

const ApiTaskPriorityArbitrary: Arbitrary<ApiTaskPriority> = fc.oneof(
    fc.constant({type: "Low"} as const),
    fc.constant({type: "Medium"} as const),
    fc.constant({type: "High"} as const),
    fc.constant({type: "Urgent"} as const),
);

const AgentWebTaskPageArbitrary: Arbitrary<AgentWebTaskPage> = fc.record({
    type: fc.constant("Task"),
    title: ApiContentTextArbitrary,
    status: ApiTaskStatusArbitrary,
    assignee: fc.oneof(ApiAccountReferenceArbitrary, fc.constant(null)),
    collections: fc.uniqueArray(ApiTaskCollectionReferenceArbitrary, {
        maxLength: 5,
        selector: collection => collection.id,
    }),
    priority: fc.oneof(ApiTaskPriorityArbitrary, fc.constant(null)),
    dueDateString: fc.oneof(ApiContentTextArbitrary, fc.constant(null)),
});

runAgentWebPageGenerativeTests({
    print: printAgentWebTaskPage,
    parse: parseAgentWebTaskPage,
    normalize: normalizeAgentWebTaskPage,
    pageLink: createIdArbitrary<TaskId>(),
    page: AgentWebTaskPageArbitrary,
});
