import {createAgentWebPageStoredLinkPathname} from "~/server/agents/web/create_agent_web_page_stored_link_pathname.js";
import {
    AgentWebTaskCollectionPage,
    AgentWebTaskCollectionPageTask,
    normalizeAgentWebTaskCollectionPage,
    parseAgentWebTaskCollectionPage,
    printAgentWebTaskCollectionPage,
} from "~/server/agents/web/pages/agent_web_task_collection_page.js";
import {runAgentWebPageTests} from "~/server/agents/web/test_helpers/run_agent_web_page_tests.js";
import {
    ApiAccountReferenceResponse,
    ApiTaskCollectionReferenceResponse,
    ApiTaskReferenceResponse,
} from "~/shared/api/specification/types/api_specification_convenience_types.js";
import {generateId} from "~/shared/id/id.js";
import {AccountId, TaskCollectionId, TaskId} from "~/shared/id/types/id_types.js";

const collectionId = generateId<TaskCollectionId>();

const writeSpecTaskReference: ApiTaskReferenceResponse = {
    type: "Task",
    id: generateId<TaskId>(),
    title: "Write spec",
    status: {type: "Open", isActive: false},
};

const shipLaunchTaskReference: ApiTaskReferenceResponse = {
    type: "Task",
    id: generateId<TaskId>(),
    title: "Ship launch",
    status: {type: "Closed"},
};

const planLaunchTaskReference: ApiTaskReferenceResponse = {
    type: "Task",
    id: generateId<TaskId>(),
    title: "Plan launch",
    status: {type: "Open", isActive: false},
};

const aliceReference: ApiAccountReferenceResponse = {
    type: "Account",
    id: generateId<AccountId>(),
    title: "Alice",
    shortName: "Alice",
};

const engineeringReference: ApiTaskCollectionReferenceResponse = {
    type: "TaskCollection",
    id: generateId<TaskCollectionId>(),
    title: "Engineering",
};

function collectionPageTask(
    task: ApiTaskReferenceResponse,
    fields: Partial<Omit<AgentWebTaskCollectionPageTask, "task">> = {},
): AgentWebTaskCollectionPageTask {
    return {
        task,
        parent: null,
        assignee: null,
        priority: null,
        dueDateString: null,
        ...fields,
    };
}

runAgentWebPageTests<TaskCollectionId, AgentWebTaskCollectionPage>({
    print: printAgentWebTaskCollectionPage,
    parse: parseAgentWebTaskCollectionPage,
    normalize: normalizeAgentWebTaskCollectionPage,
    tests: [
        {
            name: "task collection page with color and tasks",
            pageLink: collectionId,
            markdown: `\
# Roadmap

Color: Red

- [Write spec (Open)](/task/write-spec)

- [Ship launch (Closed)](/task/ship-launch)
`,
            page: {
                type: "TaskCollection",
                name: "Roadmap",
                color: "Red",
                pagination: null,
                tasks: [
                    collectionPageTask(writeSpecTaskReference),
                    collectionPageTask(shipLaunchTaskReference),
                ],
            },
        },
        {
            name: "task collection page without color",
            pageLink: collectionId,
            markdown: `\
# Roadmap

- [Write spec (Open)](/task/write-spec)
`,
            page: {
                type: "TaskCollection",
                name: "Roadmap",
                color: null,
                pagination: null,
                tasks: [collectionPageTask(writeSpecTaskReference)],
            },
        },
        {
            name: "task collection page without tasks",
            pageLink: collectionId,
            markdown: `\
# Roadmap

Color: Blue
`,
            page: {
                type: "TaskCollection",
                name: "Roadmap",
                color: "Blue",
                pagination: null,
                tasks: [],
            },
        },
        {
            name: "task collection page with only a name",
            pageLink: collectionId,
            markdown: `\
# Roadmap
`,
            page: {
                type: "TaskCollection",
                name: "Roadmap",
                color: null,
                pagination: null,
                tasks: [],
            },
        },
        {
            name: "task collection page with none color",
            pageLink: collectionId,
            markdown: `\
# Roadmap

Color: None
`,
            printMarkdown: `\
# Roadmap
`,
            page: {
                type: "TaskCollection",
                name: "Roadmap",
                color: null,
                pagination: null,
                tasks: [],
            },
        },
        {
            name: "task collection page with lowercase color",
            pageLink: collectionId,
            markdown: `\
# Roadmap

color: red
`,
            printMarkdown: `\
# Roadmap

Color: Red
`,
            page: {
                type: "TaskCollection",
                name: "Roadmap",
                color: "Red",
                pagination: null,
                tasks: [],
            },
        },
        {
            name: "empty task collection page",
            pageLink: collectionId,
            markdown: `\
#
`,
            page: {
                type: "TaskCollection",
                name: "",
                color: null,
                pagination: null,
                tasks: [],
            },
        },
        {
            name: "task collection page with a next page link",
            pageLink: collectionId,
            markdown: `\
# Roadmap

Color: Red

[Next page »](/task-collection/roadmap?after=a1b2c3)

- [Write spec (Open)](/task/write-spec)

- [Ship launch (Closed)](/task/ship-launch)
`,
            page: {
                type: "TaskCollection",
                name: "Roadmap",
                color: "Red",
                pagination: {nextCursorHash: "a1b2c3"},
                tasks: [
                    collectionPageTask(writeSpecTaskReference),
                    collectionPageTask(shipLaunchTaskReference),
                ],
            },
        },
        {
            name: "task collection page with a next page link and no color",
            pageLink: collectionId,
            markdown: `\
# Roadmap

[Next page »](/task-collection/roadmap?after=a1b2c3)

- [Write spec (Open)](/task/write-spec)
`,
            page: {
                type: "TaskCollection",
                name: "Roadmap",
                color: null,
                pagination: {nextCursorHash: "a1b2c3"},
                tasks: [collectionPageTask(writeSpecTaskReference)],
            },
        },
        {
            name: "task collection page with only a next page link",
            pageLink: collectionId,
            markdown: `\
# Roadmap

[Next page »](/task-collection/roadmap?after=a1b2c3)
`,
            page: {
                type: "TaskCollection",
                name: "Roadmap",
                color: null,
                pagination: {nextCursorHash: "a1b2c3"},
                tasks: [],
            },
        },
        {
            name: "next page link without an after cursor",
            pageLink: collectionId,
            setupStorage: async storage => {
                await createAgentWebPageStoredLinkPathname(storage, {
                    type: "TaskCollection",
                    id: collectionId,
                    title: "Roadmap",
                });
            },
            markdown: `\
# Roadmap

[Next page »](/task-collection/roadmap)
`,
            parseError:
                "Expected \u201CNext page »\u201D to link to a task collection page with an " +
                "`?after` cursor. Try again with a valid task collection pagination link.",
        },
        {
            name: "next page link to another entity type",
            pageLink: collectionId,
            setupStorage: async storage => {
                await createAgentWebPageStoredLinkPathname(storage, aliceReference);
            },
            markdown: `\
# Roadmap

[Next page »](/human/alice?after=a1b2c3)
`,
            parseError:
                "Expected \u201CNext page »\u201D to link to a task collection page with an " +
                "`?after` cursor. Try again with a valid task collection pagination link.",
        },
        {
            name: "next page link to an unknown path",
            pageLink: collectionId,
            markdown: `\
# Roadmap

[Next page »](/task-collection/missing?after=a1b2c3)
`,
            parseError:
                "Expected \u201CNext page »\u201D to link to a task collection page with an " +
                "`?after` cursor. Try again with a valid task collection pagination link.",
        },
        {
            name: "unexpected color field after the next page link",
            pageLink: collectionId,
            setupStorage: async storage => {
                await createAgentWebPageStoredLinkPathname(storage, {
                    type: "TaskCollection",
                    id: collectionId,
                    title: "Roadmap",
                });
            },
            markdown: `\
# Roadmap

[Next page »](/task-collection/roadmap?after=a1b2c3)

Color: Red
`,
            parseError:
                "Unexpected markdown on line 5. Try again with only a color (e.g. `Color: Red`) " +
                "followed by a task list (an unordered list where every item is a task link) " +
                "after the task collection name.",
        },
        {
            name: "unexpected second next page link",
            pageLink: collectionId,
            setupStorage: async storage => {
                await createAgentWebPageStoredLinkPathname(storage, {
                    type: "TaskCollection",
                    id: collectionId,
                    title: "Roadmap",
                });
            },
            markdown: `\
# Roadmap

[Next page »](/task-collection/roadmap?after=a1b2c3)

[Next page »](/task-collection/roadmap?after=d4e5f6)
`,
            parseError:
                "Unexpected markdown on line 5. Try again with only a color (e.g. `Color: Red`) " +
                "followed by a task list (an unordered list where every item is a task link) " +
                "after the task collection name.",
        },
        {
            name: "unexpected next page link after the task list",
            pageLink: collectionId,
            setupStorage: async storage => {
                await createAgentWebPageStoredLinkPathname(storage, writeSpecTaskReference);
                await createAgentWebPageStoredLinkPathname(storage, {
                    type: "TaskCollection",
                    id: collectionId,
                    title: "Roadmap",
                });
            },
            markdown: `\
# Roadmap

- [Write spec (Open)](/task/write-spec)

[Next page »](/task-collection/roadmap?after=a1b2c3)
`,
            parseError:
                "Unexpected markdown on line 5. Try again with only a color (e.g. `Color: Red`) " +
                "followed by a task list (an unordered list where every item is a task link) " +
                "after the task collection name.",
        },
        {
            name: "task collection page with all task fields",
            pageLink: collectionId,
            markdown: `\
# Roadmap

Color: Red

- [Write spec (Open)](/task/write-spec)
  - Parent: [Ship launch](/task/ship-launch)
  - Assignee: [Alice](/human/alice)
  - Priority: High
  - Due date: July 12th, 2027

- [Ship launch (Closed)](/task/ship-launch)
`,
            page: {
                type: "TaskCollection",
                name: "Roadmap",
                color: "Red",
                pagination: null,
                tasks: [
                    collectionPageTask(writeSpecTaskReference, {
                        parent: shipLaunchTaskReference,
                        assignee: aliceReference,
                        priority: {type: "High"},
                        dueDateString: "July 12th, 2027",
                    }),
                    collectionPageTask(shipLaunchTaskReference),
                ],
            },
        },
        {
            name: "task collection page with some task fields",
            pageLink: collectionId,
            markdown: `\
# Roadmap

- [Write spec (Open)](/task/write-spec)
  - Parent: [Plan launch](/task/plan-launch)

- [Ship launch (Closed)](/task/ship-launch)
  - Priority: Low
`,
            page: {
                type: "TaskCollection",
                name: "Roadmap",
                color: null,
                pagination: null,
                tasks: [
                    collectionPageTask(writeSpecTaskReference, {
                        parent: planLaunchTaskReference,
                    }),
                    collectionPageTask(shipLaunchTaskReference, {
                        priority: {type: "Low"},
                    }),
                ],
            },
        },
        {
            name: "task fields print in canonical order",
            pageLink: collectionId,
            markdown: `\
# Roadmap

- [Write spec (Open)](/task/write-spec)
  - Due date: July 12th, 2027
  - Assignee: [Alice](/human/alice)
`,
            printMarkdown: `\
# Roadmap

- [Write spec (Open)](/task/write-spec)
  - Assignee: [Alice](/human/alice)
  - Due date: July 12th, 2027
`,
            page: {
                type: "TaskCollection",
                name: "Roadmap",
                color: null,
                pagination: null,
                tasks: [
                    collectionPageTask(writeSpecTaskReference, {
                        assignee: aliceReference,
                        dueDateString: "July 12th, 2027",
                    }),
                ],
            },
        },
        {
            name: "lowercase task field labels are supported",
            pageLink: collectionId,
            markdown: `\
# Roadmap

- [Write spec (Open)](/task/write-spec)
  - assignee: [Alice](/human/alice)
  - priority: high
  - due: July 12th, 2027
`,
            printMarkdown: `\
# Roadmap

- [Write spec (Open)](/task/write-spec)
  - Assignee: [Alice](/human/alice)
  - Priority: High
  - Due date: July 12th, 2027
`,
            page: {
                type: "TaskCollection",
                name: "Roadmap",
                color: null,
                pagination: null,
                tasks: [
                    collectionPageTask(writeSpecTaskReference, {
                        assignee: aliceReference,
                        priority: {type: "High"},
                        dueDateString: "July 12th, 2027",
                    }),
                ],
            },
        },
        {
            name: "blank task fields are hidden when printed",
            pageLink: collectionId,
            markdown: `\
# Roadmap

- [Write spec (Open)](/task/write-spec)
  - Parent:
  - Assignee:
  - Priority:
  - Due date:
`,
            printMarkdown: `\
# Roadmap

- [Write spec (Open)](/task/write-spec)
`,
            page: {
                type: "TaskCollection",
                name: "Roadmap",
                color: null,
                pagination: null,
                tasks: [collectionPageTask(writeSpecTaskReference)],
            },
        },
        {
            name: "missing task collection name",
            pageLink: collectionId,
            markdown: `\
## Roadmap

Color: Red
`,
            parseError:
                "A name is required for task collections. Try again but make sure the task " +
                "collection markdown starts with a markdown h1 (e.g. `# My Collection`) on line 1.",
        },
        {
            name: "unknown task collection color",
            pageLink: collectionId,
            markdown: `\
# Roadmap

Color: Magenta
`,
            parseError:
                "Unexpected task collection color \u201CMagenta\u201D on line 3. Try again with " +
                "\u201CRed\u201D, \u201COrange\u201D, \u201CYellow\u201D, \u201CGreen\u201D, " +
                "\u201CCyan\u201D, \u201CBlue\u201D, \u201CIndigo\u201D, \u201CPurple\u201D, " +
                "\u201CPink\u201D, or remove the color entirely.",
        },
        {
            name: "unknown task collection field",
            pageLink: collectionId,
            markdown: `\
# Roadmap

Priority: High
`,
            parseError:
                "Unknown task collection field \u201CPriority\u201D on line 3. Try again with " +
                "the \u201CColor\u201D field (e.g. `Color: Red`).",
        },
        {
            name: "unexpected paragraph without a field",
            pageLink: collectionId,
            markdown: `\
# Roadmap

Tasks for the launch.
`,
            parseError:
                "Unexpected markdown on line 3. Try again with only a color (e.g. `Color: Red`) " +
                "followed by a task list (an unordered list where every item is a task link) " +
                "after the task collection name.",
        },
        {
            name: "unexpected second color field",
            pageLink: collectionId,
            markdown: `\
# Roadmap

Color: Red

Color: Blue
`,
            parseError:
                "Unexpected markdown on line 5. Try again with only a color (e.g. `Color: Red`) " +
                "followed by a task list (an unordered list where every item is a task link) " +
                "after the task collection name.",
        },
        {
            name: "unexpected color field after task list",
            pageLink: collectionId,
            markdown: `\
# Roadmap

- [Write spec (Open)](/task/write-spec)

Color: Red
`,
            parseError:
                "Unexpected markdown on line 5. Try again with only a color (e.g. `Color: Red`) " +
                "followed by a task list (an unordered list where every item is a task link) " +
                "after the task collection name.",
        },
        {
            name: "unexpected ordered task list",
            pageLink: collectionId,
            markdown: `\
# Roadmap

1. [Write spec (Open)](/task/write-spec)
`,
            parseError:
                "Unexpected markdown on line 3. Try again with only a color (e.g. `Color: Red`) " +
                "followed by a task list (an unordered list where every item is a task link) " +
                "after the task collection name.",
        },
        {
            name: "task list item without a link",
            pageLink: collectionId,
            markdown: `\
# Roadmap

- Write spec
`,
            parseError:
                "Unexpected markdown in the task list item on line 3. Try again with a single " +
                "task link (e.g. `- [My Task (Open)](/task/my-task)`) in each task list item, " +
                "optionally followed by a nested list of task fields (e.g. `- Priority: Medium`).",
        },
        {
            name: "task list item with extra content after the link",
            pageLink: collectionId,
            markdown: `\
# Roadmap

- [Write spec (Open)](/task/write-spec) is important
`,
            parseError:
                "Unexpected markdown in the task list item on line 3. Try again with a single " +
                "task link (e.g. `- [My Task (Open)](/task/my-task)`) in each task list item, " +
                "optionally followed by a nested list of task fields (e.g. `- Priority: Medium`).",
        },
        {
            name: "task list item with multiple links",
            pageLink: collectionId,
            markdown: `\
# Roadmap

- [Write spec (Open)](/task/write-spec) [Ship launch (Closed)](/task/ship-launch)
`,
            parseError:
                "Unexpected markdown in the task list item on line 3. Try again with a single " +
                "task link (e.g. `- [My Task (Open)](/task/my-task)`) in each task list item, " +
                "optionally followed by a nested list of task fields (e.g. `- Priority: Medium`).",
        },
        {
            name: "task list item with an ordered task field list",
            pageLink: collectionId,
            markdown: `\
# Roadmap

- [Write spec (Open)](/task/write-spec)
  1. Priority: High
`,
            parseError:
                "Unexpected markdown in the task list item on line 3. Try again with a single " +
                "task link (e.g. `- [My Task (Open)](/task/my-task)`) in each task list item, " +
                "optionally followed by a nested list of task fields (e.g. `- Priority: Medium`).",
        },
        {
            name: "task list item with content after the task field list",
            pageLink: collectionId,
            markdown: `\
# Roadmap

- [Write spec (Open)](/task/write-spec)
  - Priority: High

  More about this task.
`,
            parseError:
                "Unexpected markdown in the task list item on line 3. Try again with a single " +
                "task link (e.g. `- [My Task (Open)](/task/my-task)`) in each task list item, " +
                "optionally followed by a nested list of task fields (e.g. `- Priority: Medium`).",
        },
        {
            name: "unknown task link",
            pageLink: collectionId,
            markdown: `\
# Roadmap

- [Missing task](/task/missing-task)
`,
            parseError:
                "Couldn\u2019t find a task for the link \u201CMissing task\u201D on line 3. Try " +
                "again with a link to a task you\u2019ve seen before (e.g. `[My Task (Open)](/task/my-task)`).",
        },
        {
            name: "task link to another entity type",
            pageLink: collectionId,
            setupStorage: async storage => {
                await createAgentWebPageStoredLinkPathname(storage, aliceReference);
            },
            markdown: `\
# Roadmap

- [Alice](/human/alice)
`,
            parseError:
                "Couldn\u2019t find a task for the link \u201CAlice\u201D on line 3. Try again " +
                "with a link to a task you\u2019ve seen before (e.g. `[My Task (Open)](/task/my-task)`).",
        },
        {
            name: "status task field isn\u2019t allowed in a task collection",
            pageLink: collectionId,
            setupStorage: async storage => {
                await createAgentWebPageStoredLinkPathname(storage, writeSpecTaskReference);
            },
            markdown: `\
# Roadmap

- [Write spec (Open)](/task/write-spec)
  - Status: Open
`,
            parseError:
                "Unknown task field \u201CStatus\u201D on line 4. Try again with one of " +
                "\u201CParent\u201D, \u201CAssignee\u201D, \u201CPriority\u201D, or \u201CDue date\u201D.",
        },
        {
            name: "collections task field isn\u2019t allowed in a task collection",
            pageLink: collectionId,
            setupStorage: async storage => {
                await createAgentWebPageStoredLinkPathname(storage, writeSpecTaskReference);
                await createAgentWebPageStoredLinkPathname(storage, engineeringReference);
            },
            markdown: `\
# Roadmap

- [Write spec (Open)](/task/write-spec)
  - Collections: [Engineering](/task-collection/engineering)
`,
            parseError:
                "Unknown task field \u201CCollections\u201D on line 4. Try again with one of " +
                "\u201CParent\u201D, \u201CAssignee\u201D, \u201CPriority\u201D, or \u201CDue date\u201D.",
        },
        {
            name: "unknown task field in a task list item",
            pageLink: collectionId,
            setupStorage: async storage => {
                await createAgentWebPageStoredLinkPathname(storage, writeSpecTaskReference);
            },
            markdown: `\
# Roadmap

- [Write spec (Open)](/task/write-spec)
  - Subtasks: 5 open
`,
            parseError:
                "Unknown task field \u201CSubtasks\u201D on line 4. Try again with one of " +
                "\u201CParent\u201D, \u201CAssignee\u201D, \u201CPriority\u201D, or \u201CDue date\u201D.",
        },
        {
            name: "duplicate task field in a task list item",
            pageLink: collectionId,
            setupStorage: async storage => {
                await createAgentWebPageStoredLinkPathname(storage, writeSpecTaskReference);
            },
            markdown: `\
# Roadmap

- [Write spec (Open)](/task/write-spec)
  - Priority: High
  - Priority: Low
`,
            parseError:
                "Duplicate task field \u201CPriority\u201D on line 5. Try again with each task " +
                "field only present once in the field list.",
        },
        {
            name: "duplicate task field with a due date alias",
            pageLink: collectionId,
            setupStorage: async storage => {
                await createAgentWebPageStoredLinkPathname(storage, writeSpecTaskReference);
            },
            markdown: `\
# Roadmap

- [Write spec (Open)](/task/write-spec)
  - Due: July 12th, 2027
  - Due date: July 13th, 2027
`,
            parseError:
                "Duplicate task field \u201CDue date\u201D on line 5. Try again with each task " +
                "field only present once in the field list.",
        },
        {
            name: "task field without a colon",
            pageLink: collectionId,
            setupStorage: async storage => {
                await createAgentWebPageStoredLinkPathname(storage, writeSpecTaskReference);
            },
            markdown: `\
# Roadmap

- [Write spec (Open)](/task/write-spec)
  - Priority High
`,
            parseError:
                "Unexpected markdown on line 4. Try again with an unordered list item for each " +
                "task field where the field name is followed by the field value with a colon in " +
                "between (e.g. `- Priority: Medium`).",
        },
        {
            name: "unexpected markdown nested in a task field",
            pageLink: collectionId,
            setupStorage: async storage => {
                await createAgentWebPageStoredLinkPathname(storage, writeSpecTaskReference);
            },
            markdown: `\
# Roadmap

- [Write spec (Open)](/task/write-spec)
  - Priority: High
    - Nested markdown
`,
            parseError:
                "Unexpected markdown after task field \u201CPriority\u201D on line 5. Try again " +
                "with an unordered list item for each task field where the field name is " +
                "followed by the field value with a colon in between (e.g. `- Priority: Medium`).",
        },
        {
            name: "invalid task priority in a task list item",
            pageLink: collectionId,
            setupStorage: async storage => {
                await createAgentWebPageStoredLinkPathname(storage, writeSpecTaskReference);
            },
            markdown: `\
# Roadmap

- [Write spec (Open)](/task/write-spec)
  - Priority: Immediate
`,
            parseError:
                "Unexpected task priority \u201CImmediate\u201D on line 4. Try again with " +
                "\u201CLow\u201D, \u201CMedium\u201D, or \u201CHigh\u201D.",
        },
        {
            name: "task parent link to another entity type",
            pageLink: collectionId,
            setupStorage: async storage => {
                await createAgentWebPageStoredLinkPathname(storage, writeSpecTaskReference);
                await createAgentWebPageStoredLinkPathname(storage, aliceReference);
            },
            markdown: `\
# Roadmap

- [Write spec (Open)](/task/write-spec)
  - Parent: [Alice](/human/alice)
`,
            parseError:
                "Unexpected task parent link \u201CAlice\u201D on line 4. Try again with a link " +
                "to a task you\u2019ve seen before (e.g. `[My Task](/task/my-task)`).",
        },
        {
            name: "task assignee link to another entity type",
            pageLink: collectionId,
            setupStorage: async storage => {
                await createAgentWebPageStoredLinkPathname(storage, writeSpecTaskReference);
                await createAgentWebPageStoredLinkPathname(storage, engineeringReference);
            },
            markdown: `\
# Roadmap

- [Write spec (Open)](/task/write-spec)
  - Assignee: [Engineering](/task-collection/engineering)
`,
            parseError:
                "Unexpected task assignee link \u201CEngineering\u201D on line 4. Try again with " +
                "a link to a human or bot you\u2019ve seen before (e.g. `[John](/human/john-doe)`).",
        },
    ],
});
