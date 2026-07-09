import fc, {Arbitrary} from "fast-check";
import {
    AgentWebTaskCollectionPage,
    AgentWebTaskCollectionPageTask,
    apiTaskCollectionColors,
    normalizeAgentWebTaskCollectionPage,
    parseAgentWebTaskCollectionPage,
    printAgentWebTaskCollectionPage,
} from "~/server/agents/web/pages/agent_web_task_collection_page.js";
import {runAgentWebPageGenerativeTests} from "~/server/agents/web/test_helpers/run_agent_web_page_generative_tests.js";
import {
    ApiAccountReferenceArbitrary,
    ApiContentTextArbitrary,
    ApiTaskReferenceArbitrary,
    createIdArbitrary,
} from "~/shared/api/content/test_helpers/api_content_arbitrary.js";
import {ApiTaskPriority} from "~/shared/api/specification/types/api_specification_convenience_types.js";
import {TaskCollectionId} from "~/shared/id/types/id_types.js";

const ApiTaskPriorityArbitrary: Arbitrary<ApiTaskPriority> = fc.oneof(
    fc.constant({type: "Low"}),
    fc.constant({type: "Medium"}),
    fc.constant({type: "High"}),
    fc.constant({type: "Urgent"}),
);

const AgentWebTaskCollectionPageTaskArbitrary: Arbitrary<AgentWebTaskCollectionPageTask> =
    fc.record({
        task: ApiTaskReferenceArbitrary,
        parent: fc.oneof(ApiTaskReferenceArbitrary, fc.constant(null)),
        assignee: fc.oneof(ApiAccountReferenceArbitrary, fc.constant(null)),
        priority: fc.oneof(ApiTaskPriorityArbitrary, fc.constant(null)),
        dueDateString: fc.oneof(
            ApiContentTextArbitrary.filter(text => text.trim() === text && text.length > 0),
            fc.constant(null),
        ),
    });

const AgentWebTaskCollectionPagePaginationArbitrary: Arbitrary<{nextCursorHash: string}> =
    fc.record({
        nextCursorHash: fc
            .integer({min: 0, max: 0xffffff})
            .map(hashNumber => hashNumber.toString(16).padStart(6, "0")),
    });

const AgentWebTaskCollectionPageArbitrary: Arbitrary<AgentWebTaskCollectionPage> = fc.record({
    type: fc.constant("TaskCollection"),
    name: ApiContentTextArbitrary,
    color: fc.oneof(
        {weight: 2, arbitrary: fc.constant(null)},
        {weight: 1, arbitrary: fc.constantFrom(...apiTaskCollectionColors)},
    ),
    pagination: fc.oneof(
        {weight: 2, arbitrary: fc.constant(null)},
        {weight: 1, arbitrary: AgentWebTaskCollectionPagePaginationArbitrary},
    ),
    tasks: fc.array(AgentWebTaskCollectionPageTaskArbitrary),
});

runAgentWebPageGenerativeTests({
    print: printAgentWebTaskCollectionPage,
    parse: parseAgentWebTaskCollectionPage,
    normalize: normalizeAgentWebTaskCollectionPage,
    pageLink: createIdArbitrary<TaskCollectionId>(),
    page: AgentWebTaskCollectionPageArbitrary,
});
