import {createAgentWebPageStoredLinkPathname} from "~/server/agents/web/create_agent_web_page_stored_link_pathname.js";
import {
    AgentWebTaskPage,
    normalizeAgentWebTaskPage,
    parseAgentWebTaskPage,
    printAgentWebTaskPage,
} from "~/server/agents/web/pages/agent_web_task_page.js";
import {runAgentWebPageTests} from "~/server/agents/web/test_helpers/run_agent_web_page_tests.js";
import {
    ApiAccountReferenceResponse,
    ApiTaskCollectionReferenceResponse,
} from "~/shared/api/specification/types/api_specification_convenience_types.js";
import {generateId} from "~/shared/id/id.js";
import {AccountId, BotId, TaskCollectionId, TaskId} from "~/shared/id/types/id_types.js";

const taskId = generateId<TaskId>();

function accountReference({
    name,
    botId,
}: {
    name: string;
    botId?: BotId;
}): ApiAccountReferenceResponse {
    return {
        type: "Account",
        id: generateId<AccountId>(),
        title: name,
        shortName: name,
        ...(botId ? {bot: {id: botId}} : {}),
    };
}

function collectionReference({name}: {name: string}): ApiTaskCollectionReferenceResponse {
    return {
        type: "TaskCollection",
        id: generateId<TaskCollectionId>(),
        title: name,
    };
}

const aliceReference = accountReference({name: "Alice"});
const bobReference = accountReference({name: "Bob"});
const engineeringReference = collectionReference({name: "Engineering"});
const roadmapReference = collectionReference({name: "Roadmap"});

runAgentWebPageTests<TaskId, AgentWebTaskPage>({
    print: printAgentWebTaskPage,
    parse: parseAgentWebTaskPage,
    normalize: normalizeAgentWebTaskPage,
    tests: [
        {
            name: "minimal open task page",
            pageLink: taskId,
            markdown: `\
# Write spec

- Status: Open
`,
            page: {
                type: "Task",
                title: "Write spec",
                status: {type: "Open", isActive: false},
                assignee: null,
                collections: [],
                priority: null,
                dueDateString: null,
            },
        },
        {
            name: "nested collections print as inline collection list",
            pageLink: taskId,
            markdown: `\
# Ship task page

- status: Open (Active)
- assignee: [Alice](/human/alice)
- collections:
  - [Engineering](/task-collection/engineering)
  - [Roadmap](/task-collection/roadmap)
- priority: urgent
- due date: 2027-07-12
`,
            printMarkdown: `\
# Ship task page

- Status: Open (Active)
- Assignee: [Alice](/human/alice)
- Collections: [Engineering](/task-collection/engineering), [Roadmap](/task-collection/roadmap)
- Priority: Urgent
- Due date: 2027-07-12
`,
            page: {
                type: "Task",
                title: "Ship task page",
                status: {type: "Open", isActive: true},
                assignee: aliceReference,
                collections: [engineeringReference, roadmapReference],
                priority: {type: "Urgent"},
                dueDateString: "2027-07-12",
            },
        },
        {
            name: "closed task page",
            pageLink: taskId,
            markdown: `\
# Closed task

- Status: Closed
`,
            page: {
                type: "Task",
                title: "Closed task",
                status: {type: "Closed"},
                assignee: null,
                collections: [],
                priority: null,
                dueDateString: null,
            },
        },
        {
            name: "low priority task page",
            pageLink: taskId,
            markdown: `\
# Low priority

- Status: Open
- Priority: Low
`,
            page: {
                type: "Task",
                title: "Low priority",
                status: {type: "Open", isActive: false},
                assignee: null,
                collections: [],
                priority: {type: "Low"},
                dueDateString: null,
            },
        },
        {
            name: "medium priority task page",
            pageLink: taskId,
            markdown: `\
# Medium priority

- Status: Open
- Priority: Medium
`,
            page: {
                type: "Task",
                title: "Medium priority",
                status: {type: "Open", isActive: false},
                assignee: null,
                collections: [],
                priority: {type: "Medium"},
                dueDateString: null,
            },
        },
        {
            name: "high priority task page",
            pageLink: taskId,
            markdown: `\
# High priority

- Status: Open
- Priority: High
`,
            page: {
                type: "Task",
                title: "High priority",
                status: {type: "Open", isActive: false},
                assignee: null,
                collections: [],
                priority: {type: "High"},
                dueDateString: null,
            },
        },
        {
            name: "blank optional fields are hidden when printed",
            pageLink: taskId,
            markdown: `\
# Blank optional fields

- status: open
- assignee:
- collections:
- priority:
- due date:
`,
            printMarkdown: `\
# Blank optional fields

- Status: Open
`,
            page: {
                type: "Task",
                title: "Blank optional fields",
                status: {type: "Open", isActive: false},
                assignee: null,
                collections: [],
                priority: null,
                dueDateString: null,
            },
        },
        {
            name: "task page without fields",
            pageLink: taskId,
            markdown: `\
# Only title
`,
            printMarkdown: `\
# Only title

- Status: Open
`,
            page: {
                type: "Task",
                title: "Only title",
                status: {type: "Open", isActive: false},
                assignee: null,
                collections: [],
                priority: null,
                dueDateString: null,
            },
        },
        {
            name: "task page without title",
            pageLink: taskId,
            markdown: `\
- status: open
`,
            parseError:
                "A title is required for tasks. Try again but make sure the task starts with a markdown h1 (e.g. `# My Task`).",
        },
        {
            name: "task page with additional h1",
            pageLink: taskId,
            markdown: `\
# Main task

- status: open

# Extra task
`,
            parseError:
                "Unexpected markdown on line 5. Try again with only allowed sections like fields (an unordered list with items like `- Priority: Medium`) or notes (markdown after the h2 `## Notes`).",
        },
        {
            name: "task page with ordered field list",
            pageLink: taskId,
            markdown: `\
# Ordered fields

1. status: open
`,
            parseError:
                "Unexpected markdown on line 3. Try again with either fields (an unordered list with items like `- Priority: Medium`) or notes (markdown after the h2 `## Notes`) after the task title.",
        },
        {
            name: "task page with field missing colon",
            pageLink: taskId,
            markdown: `\
# Missing colon

- status open
`,
            parseError:
                "Unexpected markdown on line 3. Try again with an unordered list item for each task field where the field name is followed by the field value with a colon in between (e.g. `- Priority: Medium`).",
        },
        {
            name: "task page with linked field name",
            pageLink: taskId,
            markdown: `\
# Linked field name

- [status](/status): open
`,
            parseError:
                "Unexpected markdown on line 3. Try again with an unordered list item for each task field where the field name is followed by the field value with a colon in between (e.g. `- Priority: Medium`).",
        },
        {
            name: "task page with unknown field",
            pageLink: taskId,
            markdown: `\
# Unknown field

- owner: [Alice](/human/alice)
`,
            parseError:
                "Unknown task field \u201Cowner\u201D on line 3. Try again with one of \u201CStatus\u201D, \u201CAssignee\u201D, \u201CCollections\u201D, \u201CPriority\u201D, or \u201CDue date\u201D.",
        },
        {
            name: "task page with duplicate field",
            pageLink: taskId,
            markdown: `\
# Duplicate field

- status: open
- status: Open (Active)
`,
            parseError:
                "Duplicate task field \u201Cstatus\u201D on line 4. Try again with each task field only present once in the field list.",
        },
        {
            name: "task page with fields out of printed order",
            pageLink: taskId,
            markdown: `\
# Out of order

- assignee: [Alice](/human/alice)
- priority: high
`,
            setupStorage: async storage => {
                await createAgentWebPageStoredLinkPathname(storage, aliceReference);
            },
            printMarkdown: `\
# Out of order

- Status: Open
- Assignee: [Alice](/human/alice)
- Priority: High
`,
            page: {
                type: "Task",
                title: "Out of order",
                status: {type: "Open", isActive: false},
                assignee: aliceReference,
                collections: [],
                priority: {type: "High"},
                dueDateString: null,
            },
        },
        {
            name: "task page with invalid status",
            pageLink: taskId,
            markdown: `\
# Invalid status

- status: pending
`,
            parseError:
                "Unexpected task status \u201Cpending\u201D on line 3. Try again with \u201COpen\u201D, \u201COpen (Active)\u201D, or \u201CClosed\u201D.",
        },
        {
            name: "task page with invalid priority",
            pageLink: taskId,
            markdown: `\
# Invalid priority

- status: open
- priority: immediate
`,
            parseError:
                "Unexpected task priority \u201Cimmediate\u201D on line 4. Try again with \u201CLow\u201D, \u201CMedium\u201D, \u201CHigh\u201D, or \u201CUrgent\u201D.",
        },
        {
            name: "task page with unvalidated due date string",
            pageLink: taskId,
            markdown: `\
# Unvalidated due date

- status: open
- due date: 2027-02-29
`,
            printMarkdown: `\
# Unvalidated due date

- Status: Open
- Due date: 2027-02-29
`,
            page: {
                type: "Task",
                title: "Unvalidated due date",
                status: {type: "Open", isActive: false},
                assignee: null,
                collections: [],
                priority: null,
                dueDateString: "2027-02-29",
            },
        },
        {
            name: "task page with assignee link to collection",
            pageLink: taskId,
            markdown: `\
# Wrong assignee link

- status: open
- assignee: [Engineering](/task-collection/engineering)
`,
            setupStorage: async storage => {
                await createAgentWebPageStoredLinkPathname(storage, engineeringReference);
            },
            parseError:
                "Unexpected task assignee link \u201CEngineering\u201D on line 4. Try again with a link to a human or bot you\u2019ve seen before (e.g. `[John](/human/john-doe)`).",
        },
        {
            name: "task page with inline comma-separated collections",
            pageLink: taskId,
            markdown: `\
# Inline collections

- status: open
- collections: [Engineering](/task-collection/engineering), [Roadmap](/task-collection/roadmap)
`,
            setupStorage: async storage => {
                await createAgentWebPageStoredLinkPathname(storage, engineeringReference);
                await createAgentWebPageStoredLinkPathname(storage, roadmapReference);
            },
            printMarkdown: `\
# Inline collections

- Status: Open
- Collections: [Engineering](/task-collection/engineering), [Roadmap](/task-collection/roadmap)
`,
            page: {
                type: "Task",
                title: "Inline collections",
                status: {type: "Open", isActive: false},
                assignee: null,
                collections: [engineeringReference, roadmapReference],
                priority: null,
                dueDateString: null,
            },
        },
        {
            name: "task page with singular collection and due fields",
            pageLink: taskId,
            markdown: `\
# Singular fields

- Due: 2027-07-12
- Collection: [Engineering](/task-collection/engineering)
- Status: Open (Active)
`,
            setupStorage: async storage => {
                await createAgentWebPageStoredLinkPathname(storage, engineeringReference);
            },
            printMarkdown: `\
# Singular fields

- Status: Open (Active)
- Collections: [Engineering](/task-collection/engineering)
- Due date: 2027-07-12
`,
            page: {
                type: "Task",
                title: "Singular fields",
                status: {type: "Open", isActive: true},
                assignee: null,
                collections: [engineeringReference],
                priority: null,
                dueDateString: "2027-07-12",
            },
        },
        {
            name: "task page with inline collections and no comma",
            pageLink: taskId,
            markdown: `\
# Inline collections no comma

- status: open
- collections: [Engineering](/task-collection/engineering) [Roadmap](/task-collection/roadmap)
`,
            setupStorage: async storage => {
                await createAgentWebPageStoredLinkPathname(storage, engineeringReference);
                await createAgentWebPageStoredLinkPathname(storage, roadmapReference);
            },
            printMarkdown: `\
# Inline collections no comma

- Status: Open
- Collections: [Engineering](/task-collection/engineering), [Roadmap](/task-collection/roadmap)
`,
            page: {
                type: "Task",
                title: "Inline collections no comma",
                status: {type: "Open", isActive: false},
                assignee: null,
                collections: [engineeringReference, roadmapReference],
                priority: null,
                dueDateString: null,
            },
        },
        {
            name: "task page with inline collections and",
            pageLink: taskId,
            markdown: `\
# Inline collections and

- status: open
- collections: [Engineering](/task-collection/engineering) and [Roadmap](/task-collection/roadmap)
`,
            setupStorage: async storage => {
                await createAgentWebPageStoredLinkPathname(storage, engineeringReference);
                await createAgentWebPageStoredLinkPathname(storage, roadmapReference);
            },
            printMarkdown: `\
# Inline collections and

- Status: Open
- Collections: [Engineering](/task-collection/engineering), [Roadmap](/task-collection/roadmap)
`,
            page: {
                type: "Task",
                title: "Inline collections and",
                status: {type: "Open", isActive: false},
                assignee: null,
                collections: [engineeringReference, roadmapReference],
                priority: null,
                dueDateString: null,
            },
        },
        {
            name: "task page with adjacent inline collections",
            pageLink: taskId,
            markdown: `\
# Adjacent inline collections

- status: open
- collections: [Engineering](/task-collection/engineering)[Roadmap](/task-collection/roadmap)
`,
            setupStorage: async storage => {
                await createAgentWebPageStoredLinkPathname(storage, engineeringReference);
                await createAgentWebPageStoredLinkPathname(storage, roadmapReference);
            },
            printMarkdown: `\
# Adjacent inline collections

- Status: Open
- Collections: [Engineering](/task-collection/engineering), [Roadmap](/task-collection/roadmap)
`,
            page: {
                type: "Task",
                title: "Adjacent inline collections",
                status: {type: "Open", isActive: false},
                assignee: null,
                collections: [engineeringReference, roadmapReference],
                priority: null,
                dueDateString: null,
            },
        },
        {
            name: "task page with collection link to account",
            pageLink: taskId,
            markdown: `\
# Wrong collection link

- status: open
- assignee: [Bob](/human/bob)
- collections:
  - [Alice](/human/alice)
`,
            setupStorage: async storage => {
                await createAgentWebPageStoredLinkPathname(storage, aliceReference);
                await createAgentWebPageStoredLinkPathname(storage, bobReference);
            },
            parseError:
                "Unexpected markdown in task collection list item on line 6. Try again with a single collection link (e.g. `[My Collection](/task-collection/my-collection)`) in each nested list item.",
        },
    ],
});
