import fc, {Arbitrary} from "fast-check";
import {
    AgentWebTaskSubtasksPage,
    normalizeAgentWebTaskSubtasksPage,
    parseAgentWebTaskSubtasksPage,
    printAgentWebTaskSubtasksPage,
} from "~/server/agents/web/pages/agent_web_task_subtasks_page.js";
import {
    AgentWebTaskQueryPagePaginationArbitrary,
    AgentWebTaskQueryPageTasksArbitrary,
} from "~/server/agents/web/test_helpers/agent_web_query_page_arbitrary.js";
import {runAgentWebPageGenerativeTests} from "~/server/agents/web/test_helpers/run_agent_web_page_generative_tests.js";
import {ApiTaskReferenceArbitrary} from "~/shared/api/content/test_helpers/api_content_arbitrary.js";
import {generateId} from "~/shared/id/id.js";
import {TaskId} from "~/shared/id/types/id_types.js";

const parentTaskId = generateId<TaskId>();

const AgentWebTaskSubtasksPageArbitrary: Arbitrary<AgentWebTaskSubtasksPage> = fc.record({
    type: fc.constant("TaskSubtasks"),
    task: ApiTaskReferenceArbitrary.map(task => ({...task, id: parentTaskId})),
    pagination: fc.oneof(
        {weight: 2, arbitrary: fc.constant(null)},
        {weight: 1, arbitrary: AgentWebTaskQueryPagePaginationArbitrary},
    ),
    tasks: AgentWebTaskQueryPageTasksArbitrary,
    isEndOfTasks: fc.boolean(),
});

runAgentWebPageGenerativeTests({
    print: printAgentWebTaskSubtasksPage,
    parse: parseAgentWebTaskSubtasksPage,
    normalize: normalizeAgentWebTaskSubtasksPage,
    pageLink: fc.constant(parentTaskId),
    page: AgentWebTaskSubtasksPageArbitrary,
});
