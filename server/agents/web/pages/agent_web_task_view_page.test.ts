import {AgentWebTaskQueryPageTask} from "~/server/agents/web/pages/agent_web_task_query_page.open_source.js";
import {
    AgentWebTaskViewPage,
    normalizeAgentWebTaskViewPage,
    parseAgentWebTaskViewPage,
    printAgentWebTaskViewPage,
} from "~/server/agents/web/pages/agent_web_task_view_page.open_source.js";
import {runAgentWebPageTests} from "~/server/agents/web/test_helpers/run_agent_web_page_tests.js";
import {ApiTaskReference} from "~/shared/api/specification/types/api_specification_convenience_types.open_source.js";
import {PrettyMarkdown} from "~/shared/helpers/string/markdown.js";
import {generateId} from "~/shared/id/id.open_source.js";
import {TaskId} from "~/shared/id/types/id_types.open_source.js";

const writeSpecTaskReference: ApiTaskReference = {
    type: "Task",
    id: generateId<TaskId>(),
    title: "Write spec",
    status: {type: "Open", isActive: false},
};

const planLaunchTaskReference: ApiTaskReference = {
    type: "Task",
    id: generateId<TaskId>(),
    title: "Plan launch",
    status: {type: "Open", isActive: true},
};

function taskViewTask(
    task: ApiTaskReference,
    fields: Partial<Omit<AgentWebTaskQueryPageTask, "taskId" | "title" | "status">> = {},
): AgentWebTaskQueryPageTask {
    return {
        taskId: task.id,
        title: task.title,
        status: task.status,
        parent: null,
        subtasks: {openTaskCount: 0, closedTaskCount: 0},
        assignee: null,
        collections: [],
        additionalCollectionsCount: 0,
        priority: null,
        dueDateString: null,
        ...fields,
    };
}

runAgentWebPageTests<null, AgentWebTaskViewPage>({
    print: printAgentWebTaskViewPage,
    parse: parseAgentWebTaskViewPage,
    normalize: normalizeAgentWebTaskViewPage,
    tests: [
        {
            name: "task view page",
            pageLink: null,
            markdown: `\
# Untitled

- [Write spec (Open)](/task/write-spec)

- [Plan launch (Open, active)](/task/plan-launch)
`,
            page: {
                type: "TaskView",
                pagination: null,
                tasks: [
                    taskViewTask(writeSpecTaskReference),
                    taskViewTask(planLaunchTaskReference),
                ],
                isEndOfTasks: false,
            },
        },
        {
            name: "empty task view at the end of tasks",
            pageLink: null,
            markdown: `\
# Untitled

End of tasks.
`,
            page: {
                type: "TaskView",
                pagination: null,
                tasks: [],
                isEndOfTasks: true,
            },
        },
        {
            name: "task view with a filtered and sorted next page link",
            pageLink: null,
            markdown: `\
# Untitled

[Next page »](/task-view?after=a1b2c3&status=open&sort=-priority,due)

- [Write spec (Open)](/task/write-spec)
`,
            page: {
                type: "TaskView",
                pagination: {
                    nextCursorHash: "a1b2c3",
                    query: {
                        filters: [
                            {
                                type: "Status",
                                operation: {
                                    type: "OneOf",
                                    statuses: [
                                        {type: "Open", isActive: false},
                                        {type: "Open", isActive: true},
                                    ],
                                },
                            },
                        ],
                        sorts: [
                            {type: "Priority", direction: "Descending"},
                            {type: "Due", direction: "Ascending"},
                        ],
                    },
                },
                tasks: [taskViewTask(writeSpecTaskReference)],
                isEndOfTasks: false,
            },
        },
        {
            name: "task view includes parent fields",
            pageLink: null,
            markdown: `\
# Untitled

- [Write spec (Open)](/task/write-spec)
  - Parent: [Plan launch](/task/plan-launch)
  - Priority: High
`,
            page: {
                type: "TaskView",
                pagination: null,
                tasks: [
                    taskViewTask(writeSpecTaskReference, {
                        parent: planLaunchTaskReference,
                        priority: {type: "High"},
                    }),
                ],
                isEndOfTasks: false,
            },
        },
        {
            name: "task view rejects a changed heading",
            pageLink: null,
            markdown: "# My tasks\n",
            parseError:
                "Error: Expected \u201c# Untitled\u201d on line 1. Try again without changing the task view heading." as PrettyMarkdown,
        },
        {
            name: "task view rejects an invalid pagination paragraph",
            pageLink: null,
            markdown: "# Untitled\n\nMy tasks.\n",
            parseError:
                ("Error: Expected a \u201cNext page \u00bb\u201d link for pagination on line 3. " +
                    "Try again without changing the task view pagination link.") as PrettyMarkdown,
        },
    ],
});
