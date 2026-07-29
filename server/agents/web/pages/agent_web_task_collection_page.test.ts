import {
    AgentWebTaskCollectionPage,
    normalizeAgentWebTaskCollectionPage,
    parseAgentWebTaskCollectionPage,
    printAgentWebTaskCollectionPage,
} from "~/server/agents/web/pages/agent_web_task_collection_page.js";
import {AgentWebTaskQueryPageTask} from "~/server/agents/web/pages/agent_web_task_query_page.js";
import {runAgentWebPageTests} from "~/server/agents/web/test_helpers/run_agent_web_page_tests.js";
import {storeAgentWebPageLinkForTest} from "~/server/agents/web/test_helpers/store_agent_web_page_link_for_test.js";
import {
    ApiAccountReferenceResponse,
    ApiTaskCollectionReferenceResponse,
    ApiTaskReferenceResponse,
} from "~/shared/api/specification/types/api_specification_convenience_types.js";
import {markdown} from "~/shared/helpers/string/markdown.js";
import {assertId, generateId} from "~/shared/id/id.js";
import {AccountId, TaskCollectionId, TaskId} from "~/shared/id/types/id_types.js";

const collectionId = generateId<TaskCollectionId>();

const writeSpecTaskReference: ApiTaskReferenceResponse = {
    type: "Task",
    id: generateId<TaskId>(),
    title: "Write spec",
    status: {type: "Open", isActive: false},
};

const activeWriteSpecTaskReference: ApiTaskReferenceResponse = {
    type: "Task",
    id: generateId<TaskId>(),
    title: "Write spec",
    status: {type: "Open", isActive: true},
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

const designReference: ApiTaskCollectionReferenceResponse = {
    type: "TaskCollection",
    id: generateId<TaskCollectionId>(),
    title: "Design",
};

function collectionPageTask(
    task: ApiTaskReferenceResponse,
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
                subType: "Head",
                name: "Roadmap",
                color: "Red",
                defaults: null,
                pagination: null,
                isEndOfTasks: false,
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
                subType: "Head",
                name: "Roadmap",
                color: null,
                defaults: null,
                pagination: null,
                isEndOfTasks: false,
                tasks: [collectionPageTask(writeSpecTaskReference)],
            },
        },
        {
            name: "task collection page with a new link-less task",
            pageLink: collectionId,
            markdown: `\
# Roadmap

- Draft launch brief (Open)
  - Priority: High
  - Due date: July 12th, 2027
`,
            page: {
                type: "TaskCollection",
                subType: "Head",
                name: "Roadmap",
                color: null,
                defaults: null,
                pagination: null,
                isEndOfTasks: false,
                tasks: [
                    {
                        taskId: null,
                        title: "Draft launch brief",
                        status: {type: "Open", isActive: false},
                        parent: null,
                        subtasks: {openTaskCount: 0, closedTaskCount: 0},
                        assignee: null,
                        collections: [],
                        additionalCollectionsCount: 0,
                        priority: {type: "High"},
                        dueDateString: "July 12th, 2027",
                    },
                ],
            },
        },
        {
            name: "active task status is parsed case insensitively",
            pageLink: collectionId,
            markdown: `\
# Roadmap

- [Write spec (oPeN, AcTiVe)](/task/write-spec)
`,
            printMarkdown: `\
# Roadmap

- [Write spec (Open, active)](/task/write-spec)
`,
            page: {
                type: "TaskCollection",
                subType: "Head",
                name: "Roadmap",
                color: null,
                defaults: null,
                pagination: null,
                isEndOfTasks: false,
                tasks: [collectionPageTask(activeWriteSpecTaskReference)],
            },
        },
        {
            name: "explicit inactive task status",
            pageLink: collectionId,
            markdown: `\
# Roadmap

- [Write spec (Open, inactive)](/task/write-spec)
`,
            printMarkdown: `\
# Roadmap

- [Write spec (Open)](/task/write-spec)
`,
            page: {
                type: "TaskCollection",
                subType: "Head",
                name: "Roadmap",
                color: null,
                defaults: null,
                pagination: null,
                isEndOfTasks: false,
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
                subType: "Head",
                name: "Roadmap",
                color: "Blue",
                defaults: null,
                pagination: null,
                isEndOfTasks: false,
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
                subType: "Head",
                name: "Roadmap",
                color: null,
                defaults: null,
                pagination: null,
                isEndOfTasks: false,
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
                subType: "Head",
                name: "Roadmap",
                color: null,
                defaults: null,
                pagination: null,
                isEndOfTasks: false,
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
                subType: "Head",
                name: "Roadmap",
                color: "Red",
                defaults: null,
                pagination: null,
                isEndOfTasks: false,
                tasks: [],
            },
        },
        {
            name: "task collection page with default filters and sorts",
            pageLink: collectionId,
            markdown: `\
# Roadmap

Color: Red

Default filters and sorts:

\`\`\`
status=open&sort=-priority,due
\`\`\`

- [Write spec (Open)](/task/write-spec)
`,
            page: {
                type: "TaskCollection",
                subType: "Head",
                name: "Roadmap",
                color: "Red",
                defaults: {
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
                pagination: null,
                isEndOfTasks: false,
                tasks: [collectionPageTask(writeSpecTaskReference)],
            },
        },
        {
            name: "task collection page with only default filters",
            pageLink: collectionId,
            markdown: `\
# Roadmap

Default filters:

\`\`\`
status=open,closed&priority=high
\`\`\`
`,
            page: {
                type: "TaskCollection",
                subType: "Head",
                name: "Roadmap",
                color: null,
                defaults: {
                    filters: [
                        {
                            type: "Status",
                            operation: {
                                type: "OneOf",
                                statuses: [
                                    {type: "Open", isActive: false},
                                    {type: "Open", isActive: true},
                                    {type: "Closed"},
                                ],
                            },
                        },
                        {
                            type: "Priority",
                            operation: {
                                type: "OneOf",
                                priorities: [{type: "High"}],
                            },
                        },
                    ],
                    sorts: [],
                },
                pagination: null,
                isEndOfTasks: false,
                tasks: [],
            },
        },
        {
            name: "task collection page with only default sorts",
            pageLink: collectionId,
            markdown: `\
# Roadmap

Default sorts:

\`\`\`
sort=-created
\`\`\`
`,
            page: {
                type: "TaskCollection",
                subType: "Head",
                name: "Roadmap",
                color: null,
                defaults: {
                    filters: [],
                    sorts: [{type: "CreatedTime", direction: "Descending"}],
                },
                pagination: null,
                isEndOfTasks: false,
                tasks: [],
            },
        },
        {
            name: "default filters print before default sorts",
            pageLink: collectionId,
            markdown: `\
# Roadmap

Default filters and sorts:

\`\`\`
sort=-created&status=open
\`\`\`
`,
            printMarkdown: `\
# Roadmap

Default filters and sorts:

\`\`\`
status=open&sort=-created
\`\`\`
`,
            page: {
                type: "TaskCollection",
                subType: "Head",
                name: "Roadmap",
                color: null,
                defaults: {
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
                    sorts: [{type: "CreatedTime", direction: "Descending"}],
                },
                pagination: null,
                isEndOfTasks: false,
                tasks: [],
            },
        },
        {
            name: "lowercase defaults label without a search params prefix",
            pageLink: collectionId,
            markdown: `\
# Roadmap

default sorts

\`\`\`
?sort=-created
\`\`\`
`,
            printMarkdown: `\
# Roadmap

Default sorts:

\`\`\`
sort=-created
\`\`\`
`,
            page: {
                type: "TaskCollection",
                subType: "Head",
                name: "Roadmap",
                color: null,
                defaults: {
                    filters: [],
                    sorts: [{type: "CreatedTime", direction: "Descending"}],
                },
                pagination: null,
                isEndOfTasks: false,
                tasks: [],
            },
        },
        {
            name: "empty default filters and sorts are hidden when printed",
            pageLink: collectionId,
            markdown: `\
# Roadmap

Default filters and sorts:

\`\`\`
?
\`\`\`
`,
            printMarkdown: `\
# Roadmap
`,
            page: {
                type: "TaskCollection",
                subType: "Head",
                name: "Roadmap",
                color: null,
                defaults: null,
                pagination: null,
                isEndOfTasks: false,
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
                subType: "Head",
                name: "",
                color: null,
                defaults: null,
                pagination: null,
                isEndOfTasks: false,
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
                subType: "Head",
                name: "Roadmap",
                color: "Red",
                defaults: null,
                pagination: {
                    nextCursorHash: "a1b2c3",
                    query: {filters: [], sorts: []},
                },
                isEndOfTasks: false,
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
                subType: "Head",
                name: "Roadmap",
                color: null,
                defaults: null,
                pagination: {
                    nextCursorHash: "a1b2c3",
                    query: {filters: [], sorts: []},
                },
                isEndOfTasks: false,
                tasks: [collectionPageTask(writeSpecTaskReference)],
            },
        },
        {
            name: "task collection page with a filtered and sorted next page link",
            pageLink: collectionId,
            markdown: `\
# Roadmap

[Next page »](/task-collection/roadmap?after=a1b2c3&status=open&sort=-priority,due)
`,
            page: {
                type: "TaskCollection",
                subType: "Head",
                name: "Roadmap",
                color: null,
                defaults: null,
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
                isEndOfTasks: false,
                tasks: [],
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
                subType: "Head",
                name: "Roadmap",
                color: null,
                defaults: null,
                pagination: {
                    nextCursorHash: "a1b2c3",
                    query: {filters: [], sorts: []},
                },
                isEndOfTasks: false,
                tasks: [],
            },
        },
        {
            name: "task collection page with the end of tasks marker",
            pageLink: collectionId,
            markdown: `\
# Roadmap

Color: Red

- [Write spec (Open)](/task/write-spec)

End of tasks.
`,
            page: {
                type: "TaskCollection",
                subType: "Head",
                name: "Roadmap",
                color: "Red",
                defaults: null,
                pagination: null,
                isEndOfTasks: true,
                tasks: [collectionPageTask(writeSpecTaskReference)],
            },
        },
        {
            name: "empty task collection page with the end of tasks marker",
            pageLink: collectionId,
            markdown: `\
# Roadmap

End of tasks.
`,
            page: {
                type: "TaskCollection",
                subType: "Head",
                name: "Roadmap",
                color: null,
                defaults: null,
                pagination: null,
                isEndOfTasks: true,
                tasks: [],
            },
        },
        {
            name: "task collection tail page with a next page link",
            pageLink: collectionId,
            markdown: `\
Tasks in Roadmap. [Next page »](/task-collection/roadmap?after=a1b2c3)

- [Write spec (Open)](/task/write-spec)

- [Ship launch (Closed)](/task/ship-launch)
`,
            page: {
                type: "TaskCollection",
                subType: "Tail",
                name: "Roadmap",
                pagination: {
                    nextCursorHash: "a1b2c3",
                    query: {filters: [], sorts: []},
                },
                isEndOfTasks: false,
                tasks: [
                    collectionPageTask(writeSpecTaskReference),
                    collectionPageTask(shipLaunchTaskReference),
                ],
            },
            createParseError: markdown`
Error: Task collection markdown must start with a name (e.g. \`# My Collection\`) when creating a
collection. Try again with a name.
            `,
        },
        {
            name: "task collection tail page at the end of tasks",
            pageLink: collectionId,
            createParseError: markdown`
Error: Task collection markdown must start with a name (e.g. \`# My Collection\`) when creating a
collection. Try again with a name.
            `,
            markdown: `\
Tasks in Roadmap.

- [Write spec (Open)](/task/write-spec)

End of tasks.
`,
            page: {
                type: "TaskCollection",
                subType: "Tail",
                name: "Roadmap",
                pagination: null,
                isEndOfTasks: true,
                tasks: [collectionPageTask(writeSpecTaskReference)],
            },
        },
        {
            name: "task collection tail page without tasks",
            pageLink: collectionId,
            createParseError: markdown`
Error: Task collection markdown must start with a name (e.g. \`# My Collection\`) when creating a
collection. Try again with a name.
            `,
            markdown: `\
Tasks in Roadmap.

End of tasks.
`,
            page: {
                type: "TaskCollection",
                subType: "Tail",
                name: "Roadmap",
                pagination: null,
                isEndOfTasks: true,
                tasks: [],
            },
        },
        {
            name: "unexpected markdown after the end of tasks marker",
            pageLink: collectionId,
            markdown: `\
# Roadmap

- [Write spec (Open)](/task/write-spec)

End of tasks.

Color: Red
`,
            parseError: markdown`
Error: Nothing may appear after \u201CEnd of tasks\u201D in task collection markdown. Try again
after removing the extra content after \u201CEnd of tasks\u201D on line 7.
            `,
        },
        {
            name: "unexpected markdown after the end of tasks marker in a tail page",
            pageLink: collectionId,
            markdown: `\
Tasks in Roadmap.

End of tasks.

- [Write spec (Open)](/task/write-spec)
`,
            parseError: markdown`
Error: Nothing may appear after \u201CEnd of tasks\u201D in task collection markdown. Try again
after removing the extra content after \u201CEnd of tasks\u201D on line 5.
            `,
            createParseError: markdown`
Error: Task collection markdown must start with a name (e.g. \`# My Collection\`) when creating a
collection. Try again with a name.
            `,
        },
        {
            name: "unexpected color field in a tail page",
            pageLink: collectionId,
            markdown: `\
Tasks in Roadmap.

Color: Red
`,
            parseError: markdown`
Error: Unexpected markdown on line 3. Try again with only a task list (an unordered list where every
item is a task link) after the line 1 of the task collection markdown.
            `,
            createParseError: markdown`
Error: Task collection markdown must start with a name (e.g. \`# My Collection\`) when creating a
collection. Try again with a name.
            `,
        },
        {
            name: "tail page preamble without a task collection name",
            pageLink: collectionId,
            markdown: `\
Tasks near Roadmap.
`,
            parseError: markdown`
Error: Task collection markdown must start with \u201CTasks in My Collection\u201D (where \u201CMy
Collection\u201D is the actual name of the task collection) when reading a later task collection
page. Try again with a proper task collection preamble on line 1.
            `,
            createParseError: markdown`
Error: Task collection markdown must start with a name (e.g. \`# My Collection\`) when creating a
collection. Try again with a name.
            `,
        },
        {
            name: "tail page preamble with a next page link without an after cursor",
            pageLink: collectionId,
            setupStorage: async storage => {
                await storeAgentWebPageLinkForTest(storage, {
                    type: "TaskCollection",
                    id: collectionId,
                    title: "Roadmap",
                });
            },
            markdown: `\
Tasks in Roadmap. [Next page »](/task-collection/roadmap)
`,
            parseError: markdown`
Error: Expected \u201CNext page »\u201D to link to a task collection page with an \`?after\` cursor.
Try again with a valid task collection pagination link.
            `,
            createParseError: markdown`
Error: Task collection markdown must start with a name (e.g. \`# My Collection\`) when creating a
collection. Try again with a name.
            `,
        },
        {
            name: "next page link without an after cursor",
            pageLink: collectionId,
            setupStorage: async storage => {
                await storeAgentWebPageLinkForTest(storage, {
                    type: "TaskCollection",
                    id: collectionId,
                    title: "Roadmap",
                });
            },
            markdown: `\
# Roadmap

[Next page »](/task-collection/roadmap)
`,
            parseError: markdown`
Error: Expected \u201CNext page »\u201D to link to a task collection page with an \`?after\` cursor.
Try again with a valid task collection pagination link.
            `,
        },
        {
            name: "next page link to another entity type",
            pageLink: collectionId,
            setupStorage: async storage => {
                await storeAgentWebPageLinkForTest(storage, aliceReference);
            },
            markdown: `\
# Roadmap

[Next page »](/human/alice?after=a1b2c3)
`,
            parseError: markdown`
Error: Expected \u201CNext page »\u201D to link to a task collection page with an \`?after\` cursor.
Try again with a valid task collection pagination link.
            `,
        },
        {
            name: "next page link to an unknown path",
            pageLink: collectionId,
            markdown: `\
# Roadmap

[Next page »](/task-collection/missing?after=a1b2c3)
`,
            parseError: markdown`
Error: Expected \u201CNext page »\u201D to link to a task collection page with an \`?after\` cursor.
Try again with a valid task collection pagination link.
            `,
        },
        {
            name: "unexpected color field after the next page link",
            pageLink: collectionId,
            setupStorage: async storage => {
                await storeAgentWebPageLinkForTest(storage, {
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
            parseError: markdown`
Error: Unexpected markdown on line 5. Try again with only a color (e.g. \`Color: Red\`) followed by
a task list (an unordered list where every item is a task link) after the task collection name.
            `,
        },
        {
            name: "unexpected second next page link",
            pageLink: collectionId,
            setupStorage: async storage => {
                await storeAgentWebPageLinkForTest(storage, {
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
            parseError: markdown`
Error: Unexpected markdown on line 5. Try again with only a color (e.g. \`Color: Red\`) followed by
a task list (an unordered list where every item is a task link) after the task collection name.
            `,
        },
        {
            name: "unexpected next page link after the task list",
            pageLink: collectionId,
            setupStorage: async storage => {
                await storeAgentWebPageLinkForTest(storage, [
                    writeSpecTaskReference,
                    {
                        type: "TaskCollection",
                        id: collectionId,
                        title: "Roadmap",
                    },
                ]);
            },
            markdown: `\
# Roadmap

- [Write spec (Open)](/task/write-spec)

[Next page »](/task-collection/roadmap?after=a1b2c3)
`,
            parseError: markdown`
Error: Unexpected markdown on line 5. Try again with only a color (e.g. \`Color: Red\`) followed by
a task list (an unordered list where every item is a task link) after the task collection name.
            `,
        },
        {
            name: "task collection page with all task fields",
            pageLink: collectionId,
            markdown: `\
# Roadmap

Color: Red

- [Write spec (Open)](/task/write-spec)
  - Parent: [Ship launch](/task/ship-launch)
  - Subtasks: 3 open, 4 closed
  - Assignee: [Alice](/human/alice)
  - Collections: [Engineering](/task-collection/engineering), [Design](/task-collection/design)
  - Priority: High
  - Due date: July 12th, 2027

- [Ship launch (Closed)](/task/ship-launch)
`,
            page: {
                type: "TaskCollection",
                subType: "Head",
                name: "Roadmap",
                color: "Red",
                defaults: null,
                pagination: null,
                isEndOfTasks: false,
                tasks: [
                    collectionPageTask(writeSpecTaskReference, {
                        parent: shipLaunchTaskReference,
                        subtasks: {openTaskCount: 3, closedTaskCount: 4},
                        assignee: aliceReference,
                        collections: [engineeringReference, designReference],
                        priority: {type: "High"},
                        dueDateString: "July 12th, 2027",
                    }),
                    collectionPageTask(shipLaunchTaskReference),
                ],
            },
        },
        {
            name: "task collection task with only open subtasks",
            pageLink: collectionId,
            markdown: `\
# Roadmap

- [Write spec (Open)](/task/write-spec)
  - Subtasks: 3 open
`,
            page: {
                type: "TaskCollection",
                subType: "Head",
                name: "Roadmap",
                color: null,
                defaults: null,
                pagination: null,
                isEndOfTasks: false,
                tasks: [
                    collectionPageTask(writeSpecTaskReference, {
                        subtasks: {openTaskCount: 3, closedTaskCount: 0},
                    }),
                ],
            },
        },
        {
            name: "task collection task with only closed subtasks",
            pageLink: collectionId,
            markdown: `\
# Roadmap

- [Write spec (Open)](/task/write-spec)
  - Subtasks: 4 closed
`,
            page: {
                type: "TaskCollection",
                subType: "Head",
                name: "Roadmap",
                color: null,
                defaults: null,
                pagination: null,
                isEndOfTasks: false,
                tasks: [
                    collectionPageTask(writeSpecTaskReference, {
                        subtasks: {openTaskCount: 0, closedTaskCount: 4},
                    }),
                ],
            },
        },
        {
            name: "task collection page with a collections more count",
            pageLink: collectionId,
            markdown: `\
# Roadmap

- [Write spec (Open)](/task/write-spec)
  - Collections: [Engineering](/task-collection/engineering), [Design](/task-collection/design), and 4 more
`,
            page: {
                type: "TaskCollection",
                subType: "Head",
                name: "Roadmap",
                color: null,
                defaults: null,
                pagination: null,
                isEndOfTasks: false,
                tasks: [
                    collectionPageTask(writeSpecTaskReference, {
                        collections: [engineeringReference, designReference],
                        additionalCollectionsCount: 4,
                    }),
                ],
            },
        },
        {
            name: "collections more count without a comma is supported",
            pageLink: collectionId,
            markdown: `\
# Roadmap

- [Write spec (Open)](/task/write-spec)
  - Collections: [Engineering](/task-collection/engineering) and 2 more
`,
            printMarkdown: `\
# Roadmap

- [Write spec (Open)](/task/write-spec)
  - Collections: [Engineering](/task-collection/engineering), and 2 more
`,
            page: {
                type: "TaskCollection",
                subType: "Head",
                name: "Roadmap",
                color: null,
                defaults: null,
                pagination: null,
                isEndOfTasks: false,
                tasks: [
                    collectionPageTask(writeSpecTaskReference, {
                        collections: [engineeringReference],
                        additionalCollectionsCount: 2,
                    }),
                ],
            },
        },
        {
            name: "collections more count is case insensitive",
            pageLink: collectionId,
            markdown: `\
# Roadmap

- [Write spec (Open)](/task/write-spec)
  - Collections: [Engineering](/task-collection/engineering), AND 2 MORE
`,
            printMarkdown: `\
# Roadmap

- [Write spec (Open)](/task/write-spec)
  - Collections: [Engineering](/task-collection/engineering), and 2 more
`,
            page: {
                type: "TaskCollection",
                subType: "Head",
                name: "Roadmap",
                color: null,
                defaults: null,
                pagination: null,
                isEndOfTasks: false,
                tasks: [
                    collectionPageTask(writeSpecTaskReference, {
                        collections: [engineeringReference],
                        additionalCollectionsCount: 2,
                    }),
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
                subType: "Head",
                name: "Roadmap",
                color: null,
                defaults: null,
                pagination: null,
                isEndOfTasks: false,
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
                subType: "Head",
                name: "Roadmap",
                color: null,
                defaults: null,
                pagination: null,
                isEndOfTasks: false,
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
                subType: "Head",
                name: "Roadmap",
                color: null,
                defaults: null,
                pagination: null,
                isEndOfTasks: false,
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
                subType: "Head",
                name: "Roadmap",
                color: null,
                defaults: null,
                pagination: null,
                isEndOfTasks: false,
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
            parseError: markdown`
Error: Task collection markdown must start with the task collection name in a markdown h1 (e.g.
\`# My Collection\`) or \u201CTasks in My Collection\u201D. Try again with a proper start to task
collection markdown on line 1.
            `,
            createParseError: markdown`
Error: Task collection markdown must start with a name (e.g. \`# My Collection\`) when creating a
collection. Try again with a name.
            `,
        },
        {
            name: "unknown task collection color",
            pageLink: collectionId,
            markdown: `\
# Roadmap

Color: Magenta
`,
            parseError: markdown`
Error: Unexpected task collection color \u201CMagenta\u201D on line 3. Try again with
\u201CRed\u201D, \u201COrange\u201D, \u201CYellow\u201D, \u201CGreen\u201D, \u201CCyan\u201D,
\u201CBlue\u201D, \u201CIndigo\u201D, \u201CPurple\u201D, \u201CPink\u201D, or remove the color
entirely.
            `,
        },
        {
            name: "unknown task collection field",
            pageLink: collectionId,
            markdown: `\
# Roadmap

Priority: High
`,
            parseError: markdown`
Error: Unknown task collection field \u201CPriority\u201D on line 3. Try again with the
\u201CColor\u201D field (e.g. \`Color: Red\`).
            `,
        },
        {
            name: "unexpected paragraph without a field",
            pageLink: collectionId,
            markdown: `\
# Roadmap

Tasks for the launch.
`,
            parseError: markdown`
Error: Unexpected markdown on line 3. Try again with only a color (e.g. \`Color: Red\`) followed by
a task list (an unordered list where every item is a task link) after the task collection name.
            `,
        },
        {
            name: "unexpected second color field",
            pageLink: collectionId,
            markdown: `\
# Roadmap

Color: Red

Color: Blue
`,
            parseError: markdown`
Error: Unexpected markdown on line 5. Try again with only a color (e.g. \`Color: Red\`) followed by
a task list (an unordered list where every item is a task link) after the task collection name.
            `,
        },
        {
            name: "unexpected color field after task list",
            pageLink: collectionId,
            markdown: `\
# Roadmap

- [Write spec (Open)](/task/write-spec)

Color: Red
`,
            parseError: markdown`
Error: Unexpected markdown on line 5. Try again with only a color (e.g. \`Color: Red\`) followed by
a task list (an unordered list where every item is a task link) after the task collection name.
            `,
        },
        {
            name: "defaults label without a code block",
            pageLink: collectionId,
            markdown: `\
# Roadmap

Default filters and sorts:
`,
            parseError: markdown`
Error: Expected a code block with filters and sorts after \u201CDefault filters and sorts\u201D on
line 3. Try again with and add filters and sorts (e.g. \`status=open&sort=-priority,due\`) in a code
block after \u201CDefault filters and sorts\u201D.
            `,
        },
        {
            name: "multiple lines in the defaults code block",
            pageLink: collectionId,
            markdown: `\
# Roadmap

Default filters and sorts:

\`\`\`
?status=open
sort=-created
\`\`\`
`,
            parseError: markdown`
Error: Expected a single line of URL search params in the default filters and sorts code block on
line 5. Try again with all the default filters and sorts on one line (e.g.
\`status=open&sort=-priority,due\`).
            `,
        },
        {
            name: "unknown status filter in the defaults code block",
            pageLink: collectionId,
            markdown: `\
# Roadmap

Default filters:

\`\`\`
?status=done
\`\`\`
`,
            parseError: markdown`
Error: Unexpected task status filter \`status=done\`. Try again with \`open\`, \`open-inactive\`,
\`open-active\`, or \`closed\` (e.g. \`status=open\` or \`status[not]=closed\`).
            `,
        },
        {
            name: "unexpected defaults block in a tail page",
            pageLink: collectionId,
            markdown: `\
Tasks in Roadmap.

Default filters and sorts:

\`\`\`
?status=open
\`\`\`
`,
            parseError: markdown`
Error: Unexpected markdown on line 3. Try again with only a task list (an unordered list where every
item is a task link) after the line 1 of the task collection markdown.
            `,
            createParseError: markdown`
Error: Task collection markdown must start with a name (e.g. \`# My Collection\`) when creating a
collection. Try again with a name.
            `,
        },
        {
            name: "unexpected defaults block after the next page link",
            pageLink: collectionId,
            setupStorage: async storage => {
                await storeAgentWebPageLinkForTest(storage, {
                    type: "TaskCollection",
                    id: collectionId,
                    title: "Roadmap",
                });
            },
            markdown: `\
# Roadmap

[Next page »](/task-collection/roadmap?after=a1b2c3)

Default filters:

\`\`\`
?status=open
\`\`\`
`,
            parseError: markdown`
Error: Unexpected markdown on line 5. Try again with only a color (e.g. \`Color: Red\`) followed by
a task list (an unordered list where every item is a task link) after the task collection name.
            `,
        },
        {
            name: "unexpected code block without a defaults label",
            pageLink: collectionId,
            markdown: `\
# Roadmap

\`\`\`
?status=open
\`\`\`
`,
            parseError: markdown`
Error: Unexpected markdown on line 3. Try again with only a color (e.g. \`Color: Red\`) followed by
a task list (an unordered list where every item is a task link) after the task collection name.
            `,
        },
        {
            name: "unexpected ordered task list",
            pageLink: collectionId,
            markdown: `\
# Roadmap

1. [Write spec (Open)](/task/write-spec)
`,
            parseError: markdown`
Error: Unexpected markdown on line 3. Try again with only a color (e.g. \`Color: Red\`) followed by
a task list (an unordered list where every item is a task link) after the task collection name.
            `,
        },
        {
            name: "link-less task list item without a status",
            pageLink: collectionId,
            markdown: `\
# Roadmap

- Write spec
`,
            parseError: markdown`
Error: Missing status at the end of task label on line 3. Task labels must end with \u201C
(Open)\u201D, \u201C (Open, active)\u201D, or \u201C (Closed)\u201D. Try again with a task label
like \u201CMy Task (Open)\u201D.
            `,
        },
        {
            name: "task list item with extra content after the link",
            pageLink: collectionId,
            markdown: `\
# Roadmap

- [Write spec (Open)](/task/write-spec) is important
`,
            parseError: markdown`
Error: Unexpected markdown in the task list item on line 3. Try again with a single task link (e.g.
\`- [My Task (Open)](/task/my-task)\`) in each task list item, optionally followed by a nested list
of task fields (e.g. \`- Priority: Medium\`).
            `,
        },
        {
            name: "task list item with multiple links",
            pageLink: collectionId,
            markdown: `\
# Roadmap

- [Write spec (Open)](/task/write-spec) [Ship launch (Closed)](/task/ship-launch)
`,
            parseError: markdown`
Error: Unexpected markdown in the task list item on line 3. Try again with a single task link (e.g.
\`- [My Task (Open)](/task/my-task)\`) in each task list item, optionally followed by a nested list
of task fields (e.g. \`- Priority: Medium\`).
            `,
        },
        {
            name: "task list item with an ordered task field list",
            pageLink: collectionId,
            markdown: `\
# Roadmap

- [Write spec (Open)](/task/write-spec)
  1. Priority: High
`,
            parseError: markdown`
Error: Unexpected markdown in the task list item on line 3. Try again with a single task link (e.g.
\`- [My Task (Open)](/task/my-task)\`) in each task list item, optionally followed by a nested list
of task fields (e.g. \`- Priority: Medium\`).
            `,
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
            parseError: markdown`
Error: Unexpected markdown in the task list item on line 3. Try again with a single task link (e.g.
\`- [My Task (Open)](/task/my-task)\`) in each task list item, optionally followed by a nested list
of task fields (e.g. \`- Priority: Medium\`).
            `,
        },
        {
            name: "task link label without a status",
            pageLink: collectionId,
            setupStorage: async storage => {
                await storeAgentWebPageLinkForTest(storage, writeSpecTaskReference);
            },
            markdown: `\
# Roadmap

- [Write spec](/task/write-spec)
`,
            parseError: markdown`
Error: Missing status at the end of task label on line 3. Task labels must end with \u201C
(Open)\u201D, \u201C (Open, active)\u201D, or \u201C (Closed)\u201D. Try again with a task label
like \u201CMy Task (Open)\u201D.
            `,
        },
        {
            name: "task link label with an unexpected status",
            pageLink: collectionId,
            setupStorage: async storage => {
                await storeAgentWebPageLinkForTest(storage, writeSpecTaskReference);
            },
            markdown: `\
# Roadmap

- [Write spec (Pending)](/task/write-spec)
`,
            parseError: markdown`
Error: Missing status at the end of task label on line 3. Task labels must end with \u201C
(Open)\u201D, \u201C (Open, active)\u201D, or \u201C (Closed)\u201D. Try again with a task label
like \u201CMy Task (Open)\u201D.
            `,
        },
        {
            name: "unknown task link",
            pageLink: collectionId,
            markdown: `\
# Roadmap

- [Missing task](/task/missing-task)
`,
            parseError: markdown`
Error: Couldn\u2019t find a task for the link \u201CMissing task\u201D on line 3. You may only add a
task you\u2019ve previously seen to a collection. Try calling the \`create\` tool to create a new
task and then add that new task to the collection, or try calling the \`search\` tool to find an
existing task you want to add to the collection.
            `,
        },
        {
            name: "task link to another entity type",
            pageLink: collectionId,
            setupStorage: async storage => {
                await storeAgentWebPageLinkForTest(storage, aliceReference);
            },
            markdown: `\
# Roadmap

- [Alice](/human/alice)
`,
            parseError: markdown`
Error: Couldn\u2019t find a task for the link \u201CAlice\u201D on line 3. You may only add a task
you\u2019ve previously seen to a collection. Try calling the \`create\` tool to create a new task
and then add that new task to the collection, or try calling the \`search\` tool to find an existing
task you want to add to the collection.
            `,
        },
        {
            name: "status task field isn\u2019t allowed in a task collection",
            pageLink: collectionId,
            setupStorage: async storage => {
                await storeAgentWebPageLinkForTest(storage, writeSpecTaskReference);
            },
            markdown: `\
# Roadmap

- [Write spec (Open)](/task/write-spec)
  - Status: Open
`,
            parseError: markdown`
Error: Unknown task field \u201CStatus\u201D on line 4. Try again with one of \u201CParent\u201D,
\u201CSubtasks\u201D, \u201CAssignee\u201D, \u201CCollections\u201D, \u201CPriority\u201D, or
\u201CDue date\u201D.
            `,
        },
        {
            name: "task collection link to another entity type in a task list item",
            pageLink: collectionId,
            setupStorage: async storage => {
                await storeAgentWebPageLinkForTest(storage, [
                    writeSpecTaskReference,
                    aliceReference,
                ]);
            },
            markdown: `\
# Roadmap

- [Write spec (Open)](/task/write-spec)
  - Collections: [Alice](/human/alice)
`,
            parseError: markdown`
Error: Unexpected task collection link \u201CAlice\u201D on line 4. Try again with a link to a task
collection you\u2019ve seen before (e.g. \`[My Collection](/task-collection/my-collection)\`).
            `,
        },
        {
            name: "collections more count without any collection links",
            pageLink: collectionId,
            setupStorage: async storage => {
                await storeAgentWebPageLinkForTest(storage, writeSpecTaskReference);
            },
            markdown: `\
# Roadmap

- [Write spec (Open)](/task/write-spec)
  - Collections: and 3 more
`,
            parseError: markdown`
Error: Unexpected \u201Cand 3 more\u201D without any collection links on line 4. Try again with a
comma separated list of collection links before the \u201Cand 3 more\u201D count (e.g.
\`- Collections: [My Collection](/task-collection/my-collection), and 2 more\`).
            `,
        },
        {
            name: "collections more count must be a number",
            pageLink: collectionId,
            setupStorage: async storage => {
                await storeAgentWebPageLinkForTest(storage, [
                    writeSpecTaskReference,
                    engineeringReference,
                ]);
            },
            markdown: `\
# Roadmap

- [Write spec (Open)](/task/write-spec)
  - Collections: [Engineering](/task-collection/engineering), and two more
`,
            parseError: markdown`
Error: Unexpected markdown for task collections field on line 4. Try again with a comma separated
list of collection links (e.g.
\`- Collections: [My Collection 1](/task-collection/my-collection-1), [My Collection 2](/task-collection/my-collection-2)\`).
            `,
        },
        {
            name: "collections more count before the collection links",
            pageLink: collectionId,
            setupStorage: async storage => {
                await storeAgentWebPageLinkForTest(storage, [
                    writeSpecTaskReference,
                    engineeringReference,
                ]);
            },
            markdown: `\
# Roadmap

- [Write spec (Open)](/task/write-spec)
  - Collections: and 2 more, [Engineering](/task-collection/engineering)
`,
            parseError: markdown`
Error: Unexpected markdown for task collections field on line 4. Try again with a comma separated
list of collection links (e.g.
\`- Collections: [My Collection 1](/task-collection/my-collection-1), [My Collection 2](/task-collection/my-collection-2)\`).
            `,
        },
        {
            name: "unknown task field in a task list item",
            pageLink: collectionId,
            setupStorage: async storage => {
                await storeAgentWebPageLinkForTest(storage, writeSpecTaskReference);
            },
            markdown: `\
# Roadmap

- [Write spec (Open)](/task/write-spec)
  - Checklist: 5 open
`,
            parseError: markdown`
Error: Unknown task field \u201CChecklist\u201D on line 4. Try again with one of \u201CParent\u201D,
\u201CSubtasks\u201D, \u201CAssignee\u201D, \u201CCollections\u201D, \u201CPriority\u201D, or
\u201CDue date\u201D.
            `,
        },
        {
            name: "duplicate task field in a task list item",
            pageLink: collectionId,
            setupStorage: async storage => {
                await storeAgentWebPageLinkForTest(storage, writeSpecTaskReference);
            },
            markdown: `\
# Roadmap

- [Write spec (Open)](/task/write-spec)
  - Priority: High
  - Priority: Low
`,
            parseError: markdown`
Error: Duplicate task field \u201CPriority\u201D on line 5. Try again with each task field only
present once in the field list.
            `,
        },
        {
            name: "duplicate task field with a due date alias",
            pageLink: collectionId,
            setupStorage: async storage => {
                await storeAgentWebPageLinkForTest(storage, writeSpecTaskReference);
            },
            markdown: `\
# Roadmap

- [Write spec (Open)](/task/write-spec)
  - Due: July 12th, 2027
  - Due date: July 13th, 2027
`,
            parseError: markdown`
Error: Duplicate task field \u201CDue date\u201D on line 5. Try again with each task field only
present once in the field list.
            `,
        },
        {
            name: "task field without a colon",
            pageLink: collectionId,
            setupStorage: async storage => {
                await storeAgentWebPageLinkForTest(storage, writeSpecTaskReference);
            },
            markdown: `\
# Roadmap

- [Write spec (Open)](/task/write-spec)
  - Priority High
`,
            parseError: markdown`
Error: Unexpected markdown on line 4. Try again with an unordered list item for each task field
where the field name is followed by the field value with a colon in between (e.g.
\`- Priority: Medium\`).
            `,
        },
        {
            name: "unexpected markdown nested in a task field",
            pageLink: collectionId,
            setupStorage: async storage => {
                await storeAgentWebPageLinkForTest(storage, writeSpecTaskReference);
            },
            markdown: `\
# Roadmap

- [Write spec (Open)](/task/write-spec)
  - Priority: High
    - Nested markdown
`,
            parseError: markdown`
Error: Unexpected markdown after task field \u201CPriority\u201D on line 5. Try again with an
unordered list item for each task field where the field name is followed by the field value with a
colon in between (e.g. \`- Priority: Medium\`).
            `,
        },
        {
            name: "unexpected markdown nested in a task Subtasks field",
            pageLink: collectionId,
            setupStorage: async storage => {
                await storeAgentWebPageLinkForTest(storage, writeSpecTaskReference);
            },
            markdown: `\
# Roadmap

- [Write spec (Open)](/task/write-spec)
  - Subtasks: 3 open, 4 closed
    - Nested markdown
`,
            parseError: markdown`
Error: Unexpected markdown after task field \u201CSubtasks\u201D on line 5. Try again with an
unordered list item for each task field where the field name is followed by the field value with a
colon in between (e.g. \`- Priority: Medium\`).
            `,
        },
        {
            name: "invalid task priority in a task list item",
            pageLink: collectionId,
            setupStorage: async storage => {
                await storeAgentWebPageLinkForTest(storage, writeSpecTaskReference);
            },
            markdown: `\
# Roadmap

- [Write spec (Open)](/task/write-spec)
  - Priority: Immediate
`,
            parseError: markdown`
Error: Unexpected task priority \u201CImmediate\u201D on line 4. Try again with \u201CLow\u201D,
\u201CMedium\u201D, or \u201CHigh\u201D.
            `,
        },
        {
            name: "task parent link to another entity type",
            pageLink: collectionId,
            setupStorage: async storage => {
                await storeAgentWebPageLinkForTest(storage, [
                    writeSpecTaskReference,
                    aliceReference,
                ]);
            },
            markdown: `\
# Roadmap

- [Write spec (Open)](/task/write-spec)
  - Parent: [Alice](/human/alice)
`,
            parseError: markdown`
Error: Unexpected task parent link \u201CAlice\u201D on line 4. Try again with a link to a task
you\u2019ve seen before (e.g. \`[My Task](/task/my-task)\`).
            `,
        },
        {
            name: "task assignee link to another entity type",
            pageLink: collectionId,
            setupStorage: async storage => {
                await storeAgentWebPageLinkForTest(storage, [
                    writeSpecTaskReference,
                    engineeringReference,
                ]);
            },
            markdown: `\
# Roadmap

- [Write spec (Open)](/task/write-spec)
  - Assignee: [Engineering](/task-collection/engineering)
`,
            parseError: markdown`
Error: Unexpected task assignee link \u201CEngineering\u201D on line 4. Try again with a link to a
human or bot you\u2019ve seen before (e.g. \`[John](/human/john-doe)\`).
            `,
        },
        {
            name: "parent task with different title to same task later in collection",
            pageLink: collectionId,
            page: {
                type: "TaskCollection",
                subType: "Head",
                name: "Test",
                color: null,
                defaults: null,
                pagination: null,
                tasks: [
                    {
                        taskId: assertId<TaskId>("pn4e6ceqf466dqdptxtz3qs3y8"),
                        title: "foo",
                        status: {type: "Closed"},
                        parent: {
                            type: "Task",
                            id: assertId<TaskId>("vb58nma5ndj39yfb6gkrbymmer"),
                            title: "bar",
                            status: {type: "Closed"},
                        },
                        subtasks: {openTaskCount: 0, closedTaskCount: 0},
                        assignee: null,
                        priority: {type: "High"},
                        dueDateString: null,
                        collections: [],
                        additionalCollectionsCount: 0,
                    },
                    {
                        taskId: assertId<TaskId>("vb58nma5ndj39yfb6gkrbymmer"),
                        title: "qux",
                        status: {type: "Closed"},
                        parent: null,
                        subtasks: {openTaskCount: 0, closedTaskCount: 0},
                        assignee: null,
                        priority: null,
                        dueDateString: null,
                        collections: [],
                        additionalCollectionsCount: 0,
                    },
                ],
                isEndOfTasks: true,
            },
            markdown: `\
# Test

- [foo (Closed)](/task/foo)
  - Parent: [qux](/task/qux)
  - Priority: High

- [qux (Closed)](/task/qux)

End of tasks.
`,
        },
        {
            name: "parent task with different title to same task earlier in collection",
            pageLink: collectionId,
            page: {
                type: "TaskCollection",
                subType: "Head",
                name: "Test",
                color: null,
                defaults: null,
                pagination: null,
                tasks: [
                    {
                        taskId: assertId<TaskId>("vb58nma5ndj39yfb6gkrbymmer"),
                        title: "qux",
                        status: {type: "Closed"},
                        parent: null,
                        subtasks: {openTaskCount: 0, closedTaskCount: 0},
                        assignee: null,
                        priority: null,
                        dueDateString: null,
                        collections: [],
                        additionalCollectionsCount: 0,
                    },
                    {
                        taskId: assertId<TaskId>("pn4e6ceqf466dqdptxtz3qs3y8"),
                        title: "foo",
                        status: {type: "Closed"},
                        parent: {
                            type: "Task",
                            id: assertId<TaskId>("vb58nma5ndj39yfb6gkrbymmer"),
                            title: "bar",
                            status: {type: "Closed"},
                        },
                        subtasks: {openTaskCount: 0, closedTaskCount: 0},
                        assignee: null,
                        priority: {type: "High"},
                        dueDateString: null,
                        collections: [],
                        additionalCollectionsCount: 0,
                    },
                ],
                isEndOfTasks: true,
            },
            markdown: `\
# Test

- [qux (Closed)](/task/qux)

- [foo (Closed)](/task/foo)
  - Parent: [bar](/task/bar)
  - Priority: High

End of tasks.
`,
        },
    ],
});
