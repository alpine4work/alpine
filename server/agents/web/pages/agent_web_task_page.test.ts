import {AgentWebPageStoredLink} from "~/server/agents/web/agent_web_page_stored_link.js";
import {AgentWebSessionStorage} from "~/server/agents/web/agent_web_session_storage.js";
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
    ApiTaskReferenceResponse,
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

function taskReference({name}: {name: string}): ApiTaskReferenceResponse {
    return {
        type: "Task",
        id: generateId<TaskId>(),
        title: name,
        status: {type: "Open", isActive: false},
    };
}

const aliceReference = accountReference({name: "Alice"});
const bobReference = accountReference({name: "Bob"});
const parentReference = taskReference({name: "Parent task"});
const engineeringReference = collectionReference({name: "Engineering"});
const roadmapReference = collectionReference({name: "Roadmap"});
const currentTaskReference: ApiTaskReferenceResponse = {
    type: "Task",
    id: taskId,
    title: "Task with subtasks",
    status: {type: "Open", isActive: false},
};
const subtaskReference = taskReference({name: "Subtask"});
const otherTaskReference = taskReference({name: "Other task"});

const emptyNotes: AgentWebTaskPage["notes"] = {
    elements: [{type: "Paragraph", elements: []}],
};

async function setupTaskPageSubtasksStorage({
    storage,
    storedLinks = [],
}: {
    storage: AgentWebSessionStorage;
    storedLinks?: ReadonlyArray<AgentWebPageStoredLink>;
}) {
    await createAgentWebPageStoredLinkPathname(storage, currentTaskReference);
    await createAgentWebPageStoredLinkPathname(storage, subtaskReference);
    for (const storedLink of storedLinks) {
        await createAgentWebPageStoredLinkPathname(storage, storedLink);
    }
}

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
                parent: null,
                assignee: null,
                collections: [],
                priority: null,
                dueDateString: null,
                notes: emptyNotes,
                subtasks: null,
            },
        },
        {
            name: "task page with parent",
            pageLink: taskId,
            markdown: `\
# Child task

- Status: Open
- Parent: [Parent task](/task/parent-task)
`,
            setupStorage: async storage => {
                await createAgentWebPageStoredLinkPathname(storage, parentReference);
            },
            page: {
                type: "Task",
                title: "Child task",
                status: {type: "Open", isActive: false},
                parent: parentReference,
                assignee: null,
                collections: [],
                priority: null,
                dueDateString: null,
                notes: emptyNotes,
                subtasks: null,
            },
        },
        {
            name: "lowercase field names and values are supported",
            pageLink: taskId,
            markdown: `\
# Lowercase fields

- status: open (active)
- parent: [Parent task](/task/parent-task)
- assignee: [Alice](/human/alice)
- collections: [Engineering](/task-collection/engineering)
- priority: urgent
- due date: 2027-07-12
`,
            setupStorage: async storage => {
                await createAgentWebPageStoredLinkPathname(storage, parentReference);
                await createAgentWebPageStoredLinkPathname(storage, aliceReference);
                await createAgentWebPageStoredLinkPathname(storage, engineeringReference);
            },
            printMarkdown: `\
# Lowercase fields

- Status: Open (active)
- Parent: [Parent task](/task/parent-task)
- Assignee: [Alice](/human/alice)
- Collections: [Engineering](/task-collection/engineering)
- Priority: Urgent
- Due date: 2027-07-12
`,
            page: {
                type: "Task",
                title: "Lowercase fields",
                status: {type: "Open", isActive: true},
                parent: parentReference,
                assignee: aliceReference,
                collections: [engineeringReference],
                priority: {type: "Urgent"},
                dueDateString: "2027-07-12",
                notes: emptyNotes,
                subtasks: null,
            },
        },
        {
            name: "nested collections print as inline collection list",
            pageLink: taskId,
            markdown: `\
# Ship task page

- Status: Open (Active)
- Assignee: [Alice](/human/alice)
- Collections:
  - [Engineering](/task-collection/engineering)
  - [Roadmap](/task-collection/roadmap)
- Priority: Urgent
- Due date: 2027-07-12
`,
            printMarkdown: `\
# Ship task page

- Status: Open (active)
- Assignee: [Alice](/human/alice)
- Collections: [Engineering](/task-collection/engineering), [Roadmap](/task-collection/roadmap)
- Priority: Urgent
- Due date: 2027-07-12
`,
            page: {
                type: "Task",
                title: "Ship task page",
                status: {type: "Open", isActive: true},
                parent: null,
                assignee: aliceReference,
                collections: [engineeringReference, roadmapReference],
                priority: {type: "Urgent"},
                dueDateString: "2027-07-12",
                notes: emptyNotes,
                subtasks: null,
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
                parent: null,
                assignee: null,
                collections: [],
                priority: null,
                dueDateString: null,
                notes: emptyNotes,
                subtasks: null,
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
                parent: null,
                assignee: null,
                collections: [],
                priority: {type: "Low"},
                dueDateString: null,
                notes: emptyNotes,
                subtasks: null,
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
                parent: null,
                assignee: null,
                collections: [],
                priority: {type: "Medium"},
                dueDateString: null,
                notes: emptyNotes,
                subtasks: null,
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
                parent: null,
                assignee: null,
                collections: [],
                priority: {type: "High"},
                dueDateString: null,
                notes: emptyNotes,
                subtasks: null,
            },
        },
        {
            name: "blank optional fields are hidden when printed",
            pageLink: taskId,
            markdown: `\
# Blank optional fields

- Status: Open
- Assignee:
- Collections:
- Priority:
- Due date:
`,
            printMarkdown: `\
# Blank optional fields

- Status: Open
`,
            page: {
                type: "Task",
                title: "Blank optional fields",
                status: {type: "Open", isActive: false},
                parent: null,
                assignee: null,
                collections: [],
                priority: null,
                dueDateString: null,
                notes: emptyNotes,
                subtasks: null,
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
                parent: null,
                assignee: null,
                collections: [],
                priority: null,
                dueDateString: null,
                notes: emptyNotes,
                subtasks: null,
            },
        },
        {
            name: "task page with notes",
            pageLink: taskId,
            markdown: `\
# Notes task

- Status: Open

## Notes

Remember to check the API shape.
`,
            page: {
                type: "Task",
                title: "Notes task",
                status: {type: "Open", isActive: false},
                parent: null,
                assignee: null,
                collections: [],
                priority: null,
                dueDateString: null,
                notes: {
                    elements: [
                        {
                            type: "Paragraph",
                            elements: [{type: "Text", text: "Remember to check the API shape."}],
                        },
                    ],
                },
                subtasks: null,
            },
        },
        {
            name: "task page with notes and no fields",
            pageLink: taskId,
            markdown: `\
# Notes only

## Notes

Remember to check the API shape.
`,
            printMarkdown: `\
# Notes only

- Status: Open

## Notes

Remember to check the API shape.
`,
            page: {
                type: "Task",
                title: "Notes only",
                status: {type: "Open", isActive: false},
                parent: null,
                assignee: null,
                collections: [],
                priority: null,
                dueDateString: null,
                notes: {
                    elements: [
                        {
                            type: "Paragraph",
                            elements: [{type: "Text", text: "Remember to check the API shape."}],
                        },
                    ],
                },
                subtasks: null,
            },
        },
        {
            name: "task page with notes heading",
            pageLink: taskId,
            markdown: `\
# Notes heading task

- Status: Open

## Notes

### Context

Bring logs.
`,
            page: {
                type: "Task",
                title: "Notes heading task",
                status: {type: "Open", isActive: false},
                parent: null,
                assignee: null,
                collections: [],
                priority: null,
                dueDateString: null,
                notes: {
                    elements: [
                        {
                            type: "Heading",
                            level: 1,
                            elements: [{type: "Text", text: "Context"}],
                        },
                        {
                            type: "Paragraph",
                            elements: [{type: "Text", text: "Bring logs."}],
                        },
                    ],
                },
                subtasks: null,
            },
        },
        {
            name: "task page without title",
            pageLink: taskId,
            markdown: `\
- Status: Open
`,
            parseError:
                "Error: A title is required for tasks. Try again but make sure the task starts with a markdown h1 (e.g. `# My Task`).",
        },
        {
            name: "task page with additional h1",
            pageLink: taskId,
            markdown: `\
# Main task

- Status: Open

# Extra task
`,
            parseError:
                "Error: Unexpected markdown on line 5. Try again with only allowed sections like fields (an unordered list with items like `- Priority: Medium`), notes (the h2 `## Notes` and the content after), or subtasks (the h2 `## Subtasks` and an unordered task list) in that exact order (fields, notes, subtasks).",
        },
        {
            name: "task page with ordered field list",
            pageLink: taskId,
            markdown: `\
# Ordered fields

1. Status: Open
`,
            parseError:
                "Error: Unexpected markdown on line 3. Try again with only allowed sections like fields (an unordered list with items like `- Priority: Medium`), notes (the h2 `## Notes` and the content after), or subtasks (the h2 `## Subtasks` and an unordered task list) in that exact order (fields, notes, subtasks).",
        },
        {
            name: "task page with field missing colon",
            pageLink: taskId,
            markdown: `\
# Missing colon

- Status Open
`,
            parseError:
                "Error: Unexpected markdown on line 3. Try again with an unordered list item for each task field where the field name is followed by the field value with a colon in between (e.g. `- Priority: Medium`).",
        },
        {
            name: "task page with linked field name",
            pageLink: taskId,
            markdown: `\
# Linked field name

- [Status](/status): Open
`,
            parseError:
                "Error: Unexpected markdown on line 3. Try again with an unordered list item for each task field where the field name is followed by the field value with a colon in between (e.g. `- Priority: Medium`).",
        },
        {
            name: "task page with unknown field",
            pageLink: taskId,
            markdown: `\
# Unknown field

- Owner: [Alice](/human/alice)
`,
            parseError:
                "Error: Unknown task field \u201COwner\u201D on line 3. Try again with one of \u201CStatus\u201D, \u201CParent\u201D, \u201CAssignee\u201D, \u201CCollections\u201D, \u201CPriority\u201D, or \u201CDue date\u201D.",
        },
        {
            name: "task page with duplicate field",
            pageLink: taskId,
            markdown: `\
# Duplicate field

- Status: Open
- Status: Open (Active)
`,
            parseError:
                "Error: Duplicate task field \u201CStatus\u201D on line 4. Try again with each task field only present once in the field list.",
        },
        {
            name: "task page with fields out of printed order",
            pageLink: taskId,
            markdown: `\
# Out of order

- Assignee: [Alice](/human/alice)
- Priority: High
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
                parent: null,
                assignee: aliceReference,
                collections: [],
                priority: {type: "High"},
                dueDateString: null,
                notes: emptyNotes,
                subtasks: null,
            },
        },
        {
            name: "task page with invalid status",
            pageLink: taskId,
            markdown: `\
# Invalid status

- Status: Pending
`,
            parseError:
                "Error: Unexpected task status \u201CPending\u201D on line 3. Try again with \u201COpen\u201D, \u201COpen (Active)\u201D, or \u201CClosed\u201D.",
        },
        {
            name: "task page with invalid priority",
            pageLink: taskId,
            markdown: `\
# Invalid priority

- Status: Open
- Priority: Immediate
`,
            parseError:
                "Error: Unexpected task priority \u201CImmediate\u201D on line 4. Try again with \u201CLow\u201D, \u201CMedium\u201D, or \u201CHigh\u201D.",
        },
        {
            name: "task page with unvalidated due date string",
            pageLink: taskId,
            markdown: `\
# Unvalidated due date

- Status: Open
- Due date: 2027-02-29
`,
            page: {
                type: "Task",
                title: "Unvalidated due date",
                status: {type: "Open", isActive: false},
                parent: null,
                assignee: null,
                collections: [],
                priority: null,
                dueDateString: "2027-02-29",
                notes: emptyNotes,
                subtasks: null,
            },
        },
        {
            name: "task page with parent link to collection",
            pageLink: taskId,
            markdown: `\
# Wrong parent link

- Status: Open
- Parent: [Engineering](/task-collection/engineering)
`,
            setupStorage: async storage => {
                await createAgentWebPageStoredLinkPathname(storage, engineeringReference);
            },
            parseError:
                "Error: Unexpected task parent link \u201CEngineering\u201D on line 4. Try again with a link to a task you\u2019ve seen before (e.g. `[My Task](/task/my-task)`).",
        },
        {
            name: "task page with assignee link to collection",
            pageLink: taskId,
            markdown: `\
# Wrong assignee link

- Status: Open
- Assignee: [Engineering](/task-collection/engineering)
`,
            setupStorage: async storage => {
                await createAgentWebPageStoredLinkPathname(storage, engineeringReference);
            },
            parseError:
                "Error: Unexpected task assignee link \u201CEngineering\u201D on line 4. Try again with a link to a human or bot you\u2019ve seen before (e.g. `[John](/human/john-doe)`).",
        },
        {
            name: "task page with inline comma-separated collections",
            pageLink: taskId,
            markdown: `\
# Inline collections

- Status: Open
- Collections: [Engineering](/task-collection/engineering), [Roadmap](/task-collection/roadmap)
`,
            setupStorage: async storage => {
                await createAgentWebPageStoredLinkPathname(storage, engineeringReference);
                await createAgentWebPageStoredLinkPathname(storage, roadmapReference);
            },
            page: {
                type: "Task",
                title: "Inline collections",
                status: {type: "Open", isActive: false},
                parent: null,
                assignee: null,
                collections: [engineeringReference, roadmapReference],
                priority: null,
                dueDateString: null,
                notes: emptyNotes,
                subtasks: null,
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

- Status: Open (active)
- Collections: [Engineering](/task-collection/engineering)
- Due date: 2027-07-12
`,
            page: {
                type: "Task",
                title: "Singular fields",
                status: {type: "Open", isActive: true},
                parent: null,
                assignee: null,
                collections: [engineeringReference],
                priority: null,
                dueDateString: "2027-07-12",
                notes: emptyNotes,
                subtasks: null,
            },
        },
        {
            name: "task page with collection text and nested collection list",
            pageLink: taskId,
            markdown: `\
# Mixed collection text

- Status: Open
- Collections: abc
  - [Engineering](/task-collection/engineering)
  - [Roadmap](/task-collection/roadmap)
`,
            parseError:
                "Error: Unexpected markdown for task collections field on line 4. Try again with a comma separated list of collection links (e.g. `- Collections: [My Collection 1](/task-collection/my-collection-1), [My Collection 2](/task-collection/my-collection-2)`).",
        },
        {
            name: "task page with inline collection link and nested collection list",
            pageLink: taskId,
            markdown: `\
# Mixed collection link

- Status: Open
- Collections: [Engineering](/task-collection/engineering)
  - [Roadmap](/task-collection/roadmap)
`,
            setupStorage: async storage => {
                await createAgentWebPageStoredLinkPathname(storage, engineeringReference);
            },
            parseError:
                "Error: Unexpected markdown after task collection list on line 5. Try again with a comma separated list of collection links and nothing else after that (e.g. `- Collections: [My Collection 1](/task-collection/my-collection-1), [My Collection 2](/task-collection/my-collection-2)`).",
        },
        {
            name: "task page with inline collection links and nested collection list",
            pageLink: taskId,
            markdown: `\
# Mixed collection links

- Status: Open
- Collections: [Engineering](/task-collection/engineering), [Roadmap](/task-collection/roadmap)
  - [Engineering](/task-collection/engineering)
`,
            setupStorage: async storage => {
                await createAgentWebPageStoredLinkPathname(storage, engineeringReference);
                await createAgentWebPageStoredLinkPathname(storage, roadmapReference);
            },
            parseError:
                "Error: Unexpected markdown after task collection list on line 5. Try again with a comma separated list of collection links and nothing else after that (e.g. `- Collections: [My Collection 1](/task-collection/my-collection-1), [My Collection 2](/task-collection/my-collection-2)`).",
        },
        {
            name: "task page with collection separator and nested collection list",
            pageLink: taskId,
            markdown: `\
# Mixed collection separator

- Status: Open
- Collections: ,
  - [Engineering](/task-collection/engineering)
`,
            setupStorage: async storage => {
                await createAgentWebPageStoredLinkPathname(storage, engineeringReference);
            },
            parseError:
                "Error: Unexpected markdown after task collection list on line 5. Try again with a comma separated list of collection links and nothing else after that (e.g. `- Collections: [My Collection 1](/task-collection/my-collection-1), [My Collection 2](/task-collection/my-collection-2)`).",
        },
        {
            name: "task page with collection conjunction and nested collection list",
            pageLink: taskId,
            markdown: `\
# Mixed collection conjunction

- Status: Open
- Collections: and
  - [Engineering](/task-collection/engineering)
`,
            setupStorage: async storage => {
                await createAgentWebPageStoredLinkPathname(storage, engineeringReference);
            },
            parseError:
                "Error: Unexpected markdown after task collection list on line 5. Try again with a comma separated list of collection links and nothing else after that (e.g. `- Collections: [My Collection 1](/task-collection/my-collection-1), [My Collection 2](/task-collection/my-collection-2)`).",
        },
        {
            name: "task page with inline collections and no comma",
            pageLink: taskId,
            markdown: `\
# Inline collections no comma

- Status: Open
- Collections: [Engineering](/task-collection/engineering) [Roadmap](/task-collection/roadmap)
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
                parent: null,
                assignee: null,
                collections: [engineeringReference, roadmapReference],
                priority: null,
                dueDateString: null,
                notes: emptyNotes,
                subtasks: null,
            },
        },
        {
            name: "task page with inline collections and",
            pageLink: taskId,
            markdown: `\
# Inline collections and

- Status: Open
- Collections: [Engineering](/task-collection/engineering) and [Roadmap](/task-collection/roadmap)
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
                parent: null,
                assignee: null,
                collections: [engineeringReference, roadmapReference],
                priority: null,
                dueDateString: null,
                notes: emptyNotes,
                subtasks: null,
            },
        },
        {
            name: "task page with adjacent inline collections",
            pageLink: taskId,
            markdown: `\
# Adjacent inline collections

- Status: Open
- Collections: [Engineering](/task-collection/engineering)[Roadmap](/task-collection/roadmap)
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
                parent: null,
                assignee: null,
                collections: [engineeringReference, roadmapReference],
                priority: null,
                dueDateString: null,
                notes: emptyNotes,
                subtasks: null,
            },
        },
        {
            name: "task page with collection link to account",
            pageLink: taskId,
            markdown: `\
# Wrong collection link

- Status: Open
- Assignee: [Bob](/human/bob)
- Collections:
  - [Alice](/human/alice)
`,
            setupStorage: async storage => {
                await createAgentWebPageStoredLinkPathname(storage, aliceReference);
                await createAgentWebPageStoredLinkPathname(storage, bobReference);
            },
            parseError:
                "Error: Unexpected task collection link \u201CAlice\u201D on line 6. Try again with a link to a task collection you\u2019ve seen before (e.g. `[My Collection](/task-collection/my-collection)`).",
        },
        {
            name: "task page with a collections more count",
            pageLink: taskId,
            markdown: `\
# More collections

- Status: Open
- Collections: [Engineering](/task-collection/engineering), and 2 more
`,
            setupStorage: async storage => {
                await createAgentWebPageStoredLinkPathname(storage, engineeringReference);
            },
            parseError:
                "Error: Can\u2019t use \u201Cand 2 more\u201D in the \u201CCollections\u201D task field on line 4 since we wouldn\u2019t know which collections those are. Try again with a link to every collection (e.g. `- Collections: [My Collection 1](/task-collection/my-collection-1), [My Collection 2](/task-collection/my-collection-2)`).",
        },
        {
            name: "task page with notes and subtasks",
            pageLink: taskId,
            markdown: `\
# Task with notes and subtasks

- Status: Open

## Notes

Remember to check the API shape.

## Subtasks

- [Subtask (Open)](/task/subtask)
`,
            setupStorage: storage => setupTaskPageSubtasksStorage({storage}),
            page: {
                type: "Task",
                title: "Task with notes and subtasks",
                status: {type: "Open", isActive: false},
                parent: null,
                assignee: null,
                collections: [],
                priority: null,
                dueDateString: null,
                notes: {
                    elements: [
                        {
                            type: "Paragraph",
                            elements: [{type: "Text", text: "Remember to check the API shape."}],
                        },
                    ],
                },
                subtasks: {
                    tasks: [
                        {
                            taskId: subtaskReference.id,
                            title: subtaskReference.title,
                            status: subtaskReference.status,
                            parent: null,
                            subtasks: {openTaskCount: 0, closedTaskCount: 0},
                            assignee: null,
                            collections: [],
                            additionalCollectionsCount: 0,
                            priority: null,
                            dueDateString: null,
                        },
                    ],
                    seeMore: null,
                },
            },
        },
        {
            name: "task page with notes below subtasks",
            pageLink: taskId,
            markdown: `\
# Task with notes below subtasks

- Status: Open

## Subtasks

- [Subtask (Open)](/task/subtask)

## Notes

Remember to check the API shape.
`,
            setupStorage: storage => setupTaskPageSubtasksStorage({storage}),
            parseError:
                "Error: Unexpected markdown on line 9. Try again with only allowed sections like fields (an unordered list with items like `- Priority: Medium`), notes (the h2 `## Notes` and the content after), or subtasks (the h2 `## Subtasks` and an unordered task list) in that exact order (fields, notes, subtasks).",
        },
        {
            name: "task page with a new link-less subtask",
            pageLink: taskId,
            markdown: `\
# Task with subtasks

- Status: Open

## Subtasks

- Draft launch brief (Open, active)
  - Assignee: [Alice](/human/alice)
`,
            setupStorage: async storage => {
                await createAgentWebPageStoredLinkPathname(storage, aliceReference);
            },
            page: {
                type: "Task",
                title: "Task with subtasks",
                status: {type: "Open", isActive: false},
                parent: null,
                assignee: null,
                collections: [],
                priority: null,
                dueDateString: null,
                notes: emptyNotes,
                subtasks: {
                    tasks: [
                        {
                            taskId: null,
                            title: "Draft launch brief",
                            status: {type: "Open", isActive: true},
                            parent: null,
                            subtasks: {openTaskCount: 0, closedTaskCount: 0},
                            assignee: aliceReference,
                            collections: [],
                            additionalCollectionsCount: 0,
                            priority: null,
                            dueDateString: null,
                        },
                    ],
                    seeMore: null,
                },
            },
        },
        {
            name: "task page subtasks with non-link content after the task list",
            pageLink: taskId,
            markdown: `\
# Task with subtasks

- Status: Open

## Subtasks

- [Subtask (Open)](/task/subtask)

See more tasks.
`,
            setupStorage: storage => setupTaskPageSubtasksStorage({storage}),
            parseError:
                "Error: Expected a task\u2019s subtasks section to end with a valid \u201cSee more »\u201d link with an `?after` URL search param to the task\u2019s subtasks page. Try again with the \u201cSee more\u201d link from the task page you read.",
        },
        {
            name: "task page subtasks with a task collection See more link",
            pageLink: taskId,
            markdown: `\
# Task with subtasks

- Status: Open

## Subtasks

- [Subtask (Open)](/task/subtask)

[See more (2 remaining) »](/task-collection/engineering?after=abc)
`,
            setupStorage: storage =>
                setupTaskPageSubtasksStorage({storage, storedLinks: [engineeringReference]}),
            parseError:
                "Error: Expected a task\u2019s subtasks section to end with a valid \u201cSee more »\u201d link with an `?after` URL search param to the task\u2019s subtasks page. Try again with the \u201cSee more\u201d link from the task page you read.",
        },
        {
            name: "task page subtasks with a task page See more link",
            pageLink: taskId,
            markdown: `\
# Task with subtasks

- Status: Open

## Subtasks

- [Subtask (Open)](/task/subtask)

[See more (2 remaining) »](/task/task-with-subtasks?after=abc)
`,
            setupStorage: storage => setupTaskPageSubtasksStorage({storage}),
            parseError:
                "Error: Expected a task\u2019s subtasks section to end with a valid \u201cSee more »\u201d link with an `?after` URL search param to the task\u2019s subtasks page. Try again with the \u201cSee more\u201d link from the task page you read.",
        },
        {
            name: "task page subtasks with an account See more link",
            pageLink: taskId,
            markdown: `\
# Task with subtasks

- Status: Open

## Subtasks

- [Subtask (Open)](/task/subtask)

[See more (2 remaining) »](/human/alice?after=abc)
`,
            setupStorage: storage =>
                setupTaskPageSubtasksStorage({storage, storedLinks: [aliceReference]}),
            parseError:
                "Error: Expected a task\u2019s subtasks section to end with a valid \u201cSee more »\u201d link with an `?after` URL search param to the task\u2019s subtasks page. Try again with the \u201cSee more\u201d link from the task page you read.",
        },
        {
            name: "task page subtasks with a See more link to the wrong task",
            pageLink: taskId,
            markdown: `\
# Task with subtasks

- Status: Open

## Subtasks

- [Subtask (Open)](/task/subtask)

[See more (2 remaining) »](/task/other-task/subtasks?after=abc)
`,
            setupStorage: storage =>
                setupTaskPageSubtasksStorage({storage, storedLinks: [otherTaskReference]}),
            parseError:
                "Error: Expected a task\u2019s subtasks section to end with a valid \u201cSee more »\u201d link with an `?after` URL search param to the task\u2019s subtasks page. Try again with the \u201cSee more\u201d link from the task page you read.",
            createParseError:
                "Error: You can\u2019t create a task with a \u201cSee more\u201d subtasks link. Try again after removing the link.",
        },
        {
            name: "task page subtasks with sorts in the See more link",
            pageLink: taskId,
            markdown: `\
# Task with subtasks

- Status: Open

## Subtasks

- [Subtask (Open)](/task/subtask)

[See more (2 remaining) »](/task/task-with-subtasks/subtasks?after=abc&sort=-priority)
`,
            setupStorage: storage => setupTaskPageSubtasksStorage({storage}),
            parseError:
                "Error: Expected a task\u2019s subtasks section to end with a valid \u201cSee more »\u201d link with an `?after` URL search param to the task\u2019s subtasks page. Try again with the \u201cSee more\u201d link from the task page you read.",
        },
        {
            name: "task page subtasks with filters in the See more link",
            pageLink: taskId,
            markdown: `\
# Task with subtasks

- Status: Open

## Subtasks

- [Subtask (Open)](/task/subtask)

[See more (2 remaining) »](/task/task-with-subtasks/subtasks?after=abc&status=open)
`,
            setupStorage: storage => setupTaskPageSubtasksStorage({storage}),
            parseError:
                "Error: Expected a task\u2019s subtasks section to end with a valid \u201cSee more »\u201d link with an `?after` URL search param to the task\u2019s subtasks page. Try again with the \u201cSee more\u201d link from the task page you read.",
        },
        {
            name: "task page subtasks with a See more link without an after cursor",
            pageLink: taskId,
            markdown: `\
# Task with subtasks

- Status: Open

## Subtasks

- [Subtask (Open)](/task/subtask)

[See more (2 remaining) »](/task/task-with-subtasks/subtasks)
`,
            setupStorage: storage => setupTaskPageSubtasksStorage({storage}),
            parseError:
                "Error: Expected a task\u2019s subtasks section to end with a valid \u201cSee more »\u201d link with an `?after` URL search param to the task\u2019s subtasks page. Try again with the \u201cSee more\u201d link from the task page you read.",
        },
        {
            name: "task page subtasks with an unexpected See more link label",
            pageLink: taskId,
            markdown: `\
# Task with subtasks

- Status: Open

## Subtasks

- [Subtask (Open)](/task/subtask)

[Show more (2 remaining) »](/task/task-with-subtasks/subtasks?after=abc)
`,
            setupStorage: storage => setupTaskPageSubtasksStorage({storage}),
            parseError:
                "Error: Expected a task\u2019s subtasks section to end with a valid \u201cSee more »\u201d link with an `?after` URL search param to the task\u2019s subtasks page. Try again with the \u201cSee more\u201d link from the task page you read.",
        },
        {
            name: "task page subtasks with zero remaining tasks in the See more link",
            pageLink: taskId,
            markdown: `\
# Task with subtasks

- Status: Open

## Subtasks

- [Subtask (Open)](/task/subtask)

[See more (0 remaining) »](/task/task-with-subtasks/subtasks?after=abc)
`,
            setupStorage: storage => setupTaskPageSubtasksStorage({storage}),
            parseError:
                "Error: Expected a task\u2019s subtasks section to end with a valid \u201cSee more »\u201d link with an `?after` URL search param to the task\u2019s subtasks page. Try again with the \u201cSee more\u201d link from the task page you read.",
        },
        {
            name: "task page subtasks with trailing content in the See more link paragraph",
            pageLink: taskId,
            markdown: `\
# Task with subtasks

- Status: Open

## Subtasks

- [Subtask (Open)](/task/subtask)

[See more (2 remaining) »](/task/task-with-subtasks/subtasks?after=abc) trailing content
`,
            setupStorage: storage => setupTaskPageSubtasksStorage({storage}),
            parseError:
                "Error: Expected a task\u2019s subtasks section to end with a valid \u201cSee more »\u201d link with an `?after` URL search param to the task\u2019s subtasks page. Try again with the \u201cSee more\u201d link from the task page you read.",
        },
        {
            name: "task page subtasks with an unknown task See more link",
            pageLink: taskId,
            markdown: `\
# Task with subtasks

- Status: Open

## Subtasks

- [Subtask (Open)](/task/subtask)

[See more (2 remaining) »](/task/missing/subtasks?after=abc)
`,
            setupStorage: storage => setupTaskPageSubtasksStorage({storage}),
            parseError:
                "Error: Expected a task\u2019s subtasks section to end with a valid \u201cSee more »\u201d link with an `?after` URL search param to the task\u2019s subtasks page. Try again with the \u201cSee more\u201d link from the task page you read.",
        },
    ],
});
