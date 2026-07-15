import {ApiClientMock} from "~/server/agents/api/test_helpers/api_client_mock.js";
import {createApiAccountMock} from "~/server/agents/api/test_helpers/create_api_account_mock.js";
import {createApiTaskMock} from "~/server/agents/api/test_helpers/create_api_task_mock.js";
import {printApiTaskQueryCursorMock} from "~/server/agents/api/test_helpers/mock_api_get_task_collection_tasks.js";
import {AgentWebContext} from "~/server/agents/web/agent_web_context.js";
import {callAgentWebCreateTool} from "~/server/agents/web/call_agent_web_create_tool.js";
import {createAgentWebSessionStorageForTest} from "~/server/agents/web/test_helpers/create_agent_web_session_storage_for_test.js";
import {storeAgentWebPageLinkForTest} from "~/server/agents/web/test_helpers/store_agent_web_page_link_for_test.js";
import {
    ApiTaskResponse,
    ApiTaskWithoutNotesResponse,
} from "~/shared/api/specification/types/api_specification_convenience_types.js";
import {ErrorBase, InternalError} from "~/shared/error/error.js";
import {ErrorDisplayMessage} from "~/shared/error/types/error_display_message_type.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {defaultTimeZone} from "~/shared/helpers/intl/time_zone.js";
import {omitObject} from "~/shared/helpers/object/omit_object.js";
import {generateId} from "~/shared/id/id.js";
import {AccountId, BotId, SpaceId, TaskCollectionId, TaskId} from "~/shared/id/types/id_types.js";
import {testTracer} from "~/shared/tracer/dev/test_tracer.js";

const {span} = testTracer.startSpan("call_agent_web_create_tool_for_task.test.ts");
const api = new ApiClientMock();
const spaceId = generateId<SpaceId>();
const storage = createAgentWebSessionStorageForTest(spaceId);

const botAccountId = generateId<AccountId>();
const botId = generateId<BotId>();
const aliceAccount = createApiAccountMock({name: "Alice"});
const parentTaskId = generateId<TaskId>();
const parentTaskReference = {
    type: "Task" as const,
    id: parentTaskId,
    title: "Parent task",
    status: {type: "Open" as const, isActive: false},
};
const engineeringCollectionId = generateId<TaskCollectionId>();
const roadmapCollectionId = generateId<TaskCollectionId>();
const engineeringCollectionReference = {
    type: "TaskCollection" as const,
    id: engineeringCollectionId,
    title: "Engineering",
};
const roadmapCollectionReference = {
    type: "TaskCollection" as const,
    id: roadmapCollectionId,
    title: "Roadmap",
};

const context: AgentWebContext = {
    spaceId,
    api,
    storage,
    span,
    timeZone: defaultTimeZone,
    botAccount: {
        type: "Account",
        id: botAccountId,
        title: "ChatGPT",
        shortName: "ChatGPT",
        bot: {id: botId},
        pathname: "/bot/chatgpt",
    },
};

beforeEach(async () => {
    await storeAgentWebPageLinkForTest(storage, [
        aliceAccount,
        parentTaskReference,
        engineeringCollectionReference,
        roadmapCollectionReference,
    ]);
});

function mockCreateTask({
    id = generateId<TaskId>(),
    title,
    status,
}: {
    id?: TaskId;
    title: string;
    status: {readonly type: "Open"; readonly isActive: boolean} | {readonly type: "Closed"};
}): TaskId {
    api.mockPost("/tasks", {
        params: "Any",
        data: {
            spaceId,
            task: {
                id,
                title,
                status,
                collections: [],
                notes: {version: 0, content: {elements: []}},
            },
        } as any,
    });

    return id;
}

function getCreateTaskRequests() {
    return api
        .getRequestHistory()
        .filter(request => request.method === "POST" && request.path === "/tasks");
}

function printDisplayMessage(displayMessage: ErrorDisplayMessage): string {
    let string = "";

    for (const segment of displayMessage) {
        switch (segment.type) {
            case "Text":
            case "SensitiveText":
            case "Link": {
                string += segment.text;
                break;
            }
            default:
                throw exhaustive(segment);
        }
    }

    return string;
}

function getDisplayMessage(error: unknown): ErrorDisplayMessage {
    if (error instanceof ErrorBase && error.displayMessage) {
        return error.displayMessage;
    }

    if (error instanceof AggregateError) {
        for (const childError of error.errors) {
            if (childError instanceof ErrorBase && childError.displayMessage) {
                return childError.displayMessage;
            }
        }
    }

    throw error;
}

async function expectCreateDisplayMessage({
    content,
    expected,
}: {
    content: string;
    expected: string;
}) {
    let error: unknown;

    try {
        await callAgentWebCreateTool(context, {type: "task", content});
    } catch (actualError) {
        error = actualError;
    }

    if (!error) throw new InternalError("Expected create tool call to throw");

    expect(printDisplayMessage(getDisplayMessage(error))).toEqual(expected);
}

test("creates a minimal task with default open status", async () => {
    mockCreateTask({
        title: "Minimal task",
        status: {type: "Open", isActive: false},
    });

    await expect(
        callAgentWebCreateTool(context, {
            type: "task",
            content: "# Minimal task",
        }),
    ).resolves.toEqual("Create was successful. New task: [Minimal task](/task/minimal-task).\n");

    expect(getCreateTaskRequests()).toHaveLength(1);
    expect(getCreateTaskRequests()[0]?.body).toEqual({
        spaceId,
        task: {
            title: "Minimal task",
            status: {type: "Open", isActive: false},
            parent: undefined,
            assignee: undefined,
            collections: [],
            priority: undefined,
            due: undefined,
            content: undefined,
        },
    });
});

test("creates a task with explicit inactive open status", async () => {
    mockCreateTask({
        title: "Explicit inactive task",
        status: {type: "Open", isActive: false},
    });

    await expect(
        callAgentWebCreateTool(context, {
            type: "task",
            content: `\
# Explicit inactive task

- Status: Open (Inactive)`,
        }),
    ).resolves.toEqual(
        "Create was successful. New task: [Explicit inactive task](/task/explicit-inactive-task).\n",
    );

    expect(getCreateTaskRequests()[0]?.body).toEqual({
        spaceId,
        task: {
            title: "Explicit inactive task",
            status: {type: "Open", isActive: false},
            parent: undefined,
            assignee: undefined,
            collections: [],
            priority: undefined,
            due: undefined,
            content: undefined,
        },
    });
});

test("creates a task with every supported field", async () => {
    mockCreateTask({
        title: "Create everything",
        status: {type: "Open", isActive: true},
    });

    await expect(
        callAgentWebCreateTool(context, {
            type: "tasks",
            content: `\
# Create everything

- status: Open (Active)
- parent: [Parent task](/task/parent-task)
- assignee: [Alice](/human/alice)
- collections:
  - [Engineering](/task-collection/engineering)
  - [Roadmap](/task-collection/roadmap)
- priority: high
- due date: 2027-07-12`,
        }),
    ).resolves.toEqual(
        "Create was successful. New task: [Create everything](/task/create-everything).\n",
    );

    expect(getCreateTaskRequests()).toHaveLength(1);
    expect(getCreateTaskRequests()[0]?.body).toEqual({
        spaceId,
        task: {
            title: "Create everything",
            status: {type: "Open", isActive: true},
            parent: {task: {id: parentTaskId}},
            assignee: {id: aliceAccount.id},
            collections: [
                {collection: {id: engineeringCollectionId}},
                {collection: {id: roadmapCollectionId}},
            ],
            priority: {type: "High"},
            due: {date: "2027-07-12"},
            content: undefined,
        },
    });
});

test("creates a task with a subtask section", async () => {
    const subtask = createApiTaskMock({index: 701, title: "Existing subtask"});
    await storeAgentWebPageLinkForTest(storage, subtask);

    const taskId = mockCreateTask({
        title: "Create with subtasks",
        status: {type: "Open", isActive: false},
    });
    const createdTask = createApiTaskMock({id: taskId, title: "Create with subtasks"});
    const movedSubtask = createApiTaskMock({
        id: subtask.id,
        title: subtask.title,
        parent: createdTask,
    });

    api.mockGet("/tasks/{id}", {
        params: {path: {id: subtask.id}},
        data: {spaceId, task: withoutNotes(subtask)},
    });
    api.mockPatch("/tasks", {
        params: "Any",
        data: {
            spaceId,
            tasks: [movedSubtask],
            results: [
                {type: "Update", result: {type: "SetParent"}},
                {
                    type: "Update",
                    result: {
                        type: "MoveInParent",
                        cursor: printApiTaskQueryCursorMock(701),
                    },
                },
            ],
        },
    });

    const result = await callAgentWebCreateTool(context, {
        type: "task",
        content: `\
# Create with subtasks

## Subtasks

- [Existing subtask (Open)](/task/existing-subtask)`,
    });

    const taskListPatch = api
        .getRequestHistory()
        .find(request => request.method === "PATCH" && request.path === "/tasks");

    expect({
        result,
        createTask: getCreateTaskRequests()[0]?.body,
        taskListPatch: taskListPatch?.body,
    }).toEqual({
        result: "Create was successful. New task: [Create with subtasks](/task/create-with-subtasks).\n",
        createTask: {
            spaceId,
            task: {
                title: "Create with subtasks",
                status: {type: "Open", isActive: false},
                collections: [],
            },
        },
        taskListPatch: {
            spaceId,
            patches: [
                {
                    type: "Update",
                    id: subtask.id,
                    patch: {type: "SetParent", parent: {task: {id: taskId}}},
                },
                {
                    type: "Update",
                    id: subtask.id,
                    patch: {type: "MoveInParent", position: {type: "End"}},
                },
            ],
        },
    });
});

test("rejects a subtasks See more link on create without calling the API", async () => {
    await expectCreateDisplayMessage({
        content: `\
# Create with subtasks pagination

## Subtasks

- [Parent task (Open)](/task/parent-task)

[See more (2 remaining) »](/task/parent-task/subtasks?after=abcdef)`,
        expected:
            "You can\u2019t create a task with a \u201cSee more\u201d subtasks link. Try again after " +
            "removing the link.",
    });

    expect(getCreateTaskRequests()).toHaveLength(0);
});

test("creates a task with parent and priority", async () => {
    mockCreateTask({
        title: "Create parent field",
        status: {type: "Open", isActive: false},
    });

    await expect(
        callAgentWebCreateTool(context, {
            type: "task",
            content: `\
# Create parent field

- Parent: [Parent task](/task/parent-task)
- Priority: Medium`,
        }),
    ).resolves.toEqual(
        "Create was successful. New task: [Create parent field](/task/create-parent-field).\n",
    );

    expect(getCreateTaskRequests()[0]?.body).toEqual({
        spaceId,
        task: {
            title: "Create parent field",
            status: {type: "Open", isActive: false},
            parent: {task: {id: parentTaskId}},
            collections: [],
            priority: {type: "Medium"},
        },
    });
});

test("creates a task with notes", async () => {
    mockCreateTask({
        title: "Create notes",
        status: {type: "Closed"},
    });

    await expect(
        callAgentWebCreateTool(context, {
            type: "task",
            content: `\
# Create notes

- Status: Closed
- Priority: Low

## Notes

Create notes body.

### Context

Use beta data.`,
        }),
    ).resolves.toEqual("Create was successful. New task: [Create notes](/task/create-notes).\n");

    expect(getCreateTaskRequests()[0]?.body).toEqual({
        spaceId,
        task: {
            title: "Create notes",
            status: {type: "Closed"},
            parent: undefined,
            assignee: undefined,
            collections: [],
            priority: {type: "Low"},
            due: undefined,
            content: {
                elements: [
                    {
                        type: "Paragraph",
                        elements: [{type: "Text", text: "Create notes body."}],
                    },
                    {
                        type: "Heading",
                        level: 1,
                        elements: [{type: "Text", text: "Context"}],
                    },
                    {
                        type: "Paragraph",
                        elements: [{type: "Text", text: "Use beta data."}],
                    },
                ],
            },
        },
    });
});

test("creates a task with empty notes section without sending notes content", async () => {
    mockCreateTask({
        title: "Create empty notes",
        status: {type: "Open", isActive: false},
    });

    await expect(
        callAgentWebCreateTool(context, {
            type: "task",
            content: `\
# Create empty notes

- Status: Open

## Notes`,
        }),
    ).resolves.toEqual(
        "Create was successful. New task: [Create empty notes](/task/create-empty-notes).\n",
    );

    expect(getCreateTaskRequests()[0]?.body).toEqual({
        spaceId,
        task: {
            title: "Create empty notes",
            status: {type: "Open", isActive: false},
            parent: undefined,
            assignee: undefined,
            collections: [],
            priority: undefined,
            due: undefined,
            content: undefined,
        },
    });
});

test("creates a task with assignee and priority", async () => {
    mockCreateTask({
        title: "Create mixed fields",
        status: {type: "Open", isActive: false},
    });

    await expect(
        callAgentWebCreateTool(context, {
            type: "task",
            content: `\
# Create mixed fields

- Assignee: [Alice](/human/alice)
- Priority: Medium`,
        }),
    ).resolves.toEqual(
        "Create was successful. New task: [Create mixed fields](/task/create-mixed-fields).\n",
    );

    expect(getCreateTaskRequests()[0]?.body).toEqual({
        spaceId,
        task: {
            title: "Create mixed fields",
            status: {type: "Open", isActive: false},
            parent: undefined,
            assignee: {id: aliceAccount.id},
            collections: [],
            priority: {type: "Medium"},
            due: undefined,
            content: undefined,
        },
    });
});

test("creates a task with status and inline collections", async () => {
    mockCreateTask({
        title: "Create collection fields",
        status: {type: "Closed"},
    });

    await expect(
        callAgentWebCreateTool(context, {
            type: "task",
            content: `\
# Create collection fields

- Status: Closed
- Collections: [Engineering](/task-collection/engineering), [Roadmap](/task-collection/roadmap)`,
        }),
    ).resolves.toEqual(
        "Create was successful. New task: [Create collection fields](/task/create-collection-fields).\n",
    );

    expect(getCreateTaskRequests()[0]?.body).toEqual({
        spaceId,
        task: {
            title: "Create collection fields",
            status: {type: "Closed"},
            parent: undefined,
            assignee: undefined,
            collections: [
                {collection: {id: engineeringCollectionId}},
                {collection: {id: roadmapCollectionId}},
            ],
            priority: undefined,
            due: undefined,
            content: undefined,
        },
    });
});

test("creates a task with yearless due date using context year", async () => {
    mockCreateTask({
        title: "Create yearless due date",
        status: {type: "Open", isActive: false},
    });

    import.meta.jest.useFakeTimers();
    try {
        import.meta.jest.setSystemTime(new Date("2031-02-03T12:00:00.000Z"));

        await expect(
            callAgentWebCreateTool(context, {
                type: "task",
                content: `\
# Create yearless due date

- Due date: July 12th`,
            }),
        ).resolves.toEqual(
            "Create was successful. New task: [Create yearless due date](/task/create-yearless-due-date).\n",
        );
    } finally {
        import.meta.jest.useRealTimers();
    }

    expect(getCreateTaskRequests()[0]?.body).toEqual({
        spaceId,
        task: {
            title: "Create yearless due date",
            status: {type: "Open", isActive: false},
            parent: undefined,
            assignee: undefined,
            collections: [],
            priority: undefined,
            due: {date: "2031-07-12"},
            content: undefined,
        },
    });
});

test.each([
    ["month first with ordinal", "July 12th, 2025", "2025-07-12"],
    // eslint-disable-next-line cyberworlds/string-quotes
    ["abbreviated month with short year", "Jul 12, '25", "2025-07-12"],
    ["day first with ordinal", "12th July 2025", "2025-07-12"],
    ["numeric slash with short year", "7/12/25", "2025-07-12"],
    ["numeric dash with full year", "07-12-2025", "2025-07-12"],
])(
    "sets task due date from parsed date style on create: %s",
    async (name, dueDate, expectedDate) => {
        const title = `Create due date ${name}`;

        mockCreateTask({
            title,
            status: {type: "Open", isActive: false},
        });

        await callAgentWebCreateTool(context, {
            type: "task",
            content: `\
# ${title}

- Due date: ${dueDate}`,
        });

        expect(getCreateTaskRequests()[0]?.body).toEqual({
            spaceId,
            task: {
                title,
                status: {type: "Open", isActive: false},
                collections: [],
                due: {date: expectedDate},
            },
        });
    },
);

test("rejects a missing task title without calling the API", async () => {
    await expectCreateDisplayMessage({
        content: `\
- Status: Open`,
        expected:
            "A title is required for tasks. Try again but make sure the task starts with a markdown h1 (e.g. `# My Task`).",
    });

    expect(getCreateTaskRequests()).toHaveLength(0);
});

function withoutNotes(task: ApiTaskResponse): ApiTaskWithoutNotesResponse {
    return omitObject(task, ["notes"]);
}

test("rejects an unknown assignee link without calling the API", async () => {
    await expectCreateDisplayMessage({
        content: `\
# Unknown assignee

- status: open
- assignee: [Missing](/human/missing)`,
        expected:
            "Unexpected task assignee link \u201CMissing\u201D on line 4. Try again with a link to a human or bot you\u2019ve seen before (e.g. `[John](/human/john-doe)`).",
    });

    expect(getCreateTaskRequests()).toHaveLength(0);
});

test("rejects an unknown parent link without calling the API", async () => {
    await expectCreateDisplayMessage({
        content: `\
# Unknown parent

- Parent: [Missing](/task/missing)`,
        expected:
            "Unexpected task parent link \u201CMissing\u201D on line 3. Try again with a link to a task you\u2019ve seen before (e.g. `[My Task](/task/my-task)`).",
    });

    expect(getCreateTaskRequests()).toHaveLength(0);
});

test("rejects a parent link to another entity type without calling the API", async () => {
    await expectCreateDisplayMessage({
        content: `\
# Wrong parent

- Parent: [Engineering](/task-collection/engineering)`,
        expected:
            "Unexpected task parent link \u201CEngineering\u201D on line 3. Try again with a link to a task you\u2019ve seen before (e.g. `[My Task](/task/my-task)`).",
    });

    expect(getCreateTaskRequests()).toHaveLength(0);
});

test("rejects an unknown collection link without calling the API", async () => {
    await expectCreateDisplayMessage({
        content: `\
# Unknown collection

- Collections: [Missing](/task-collection/missing)`,
        expected:
            "Unexpected task collection link \u201CMissing\u201D on line 3. Try again with a link to a task collection you\u2019ve seen before (e.g. `[My Collection](/task-collection/my-collection)`).",
    });

    expect(getCreateTaskRequests()).toHaveLength(0);
});

test("rejects a collections more count on create without calling the API", async () => {
    await expectCreateDisplayMessage({
        content: `\
# More collections

- Collections: [Engineering](/task-collection/engineering), and 2 more`,
        expected:
            "Can\u2019t use \u201Cand 2 more\u201D in the \u201CCollections\u201D task field on line 3 since we wouldn\u2019t know which collections those are. Try again with a link to every collection (e.g. `- Collections: [My Collection 1](/task-collection/my-collection-1), [My Collection 2](/task-collection/my-collection-2)`).",
    });

    expect(getCreateTaskRequests()).toHaveLength(0);
});

test("rejects invalid task status without calling the API", async () => {
    await expectCreateDisplayMessage({
        content: `\
# Invalid status

- Status: Pending`,
        expected:
            "Unexpected task status \u201CPending\u201D on line 3. Try again with \u201COpen\u201D, \u201COpen (Active)\u201D, or \u201CClosed\u201D.",
    });

    expect(getCreateTaskRequests()).toHaveLength(0);
});

test("rejects invalid task priority without calling the API", async () => {
    await expectCreateDisplayMessage({
        content: `\
# Invalid priority

- Status: Open
- Priority: Immediate`,
        expected:
            "Unexpected task priority \u201CImmediate\u201D on line 4. Try again with \u201CLow\u201D, \u201CMedium\u201D, or \u201CHigh\u201D.",
    });

    expect(getCreateTaskRequests()).toHaveLength(0);
});

test("rejects active task without assignee on create without calling the API", async () => {
    await expectCreateDisplayMessage({
        content: `\
# Active task

- Status: Open (Active)`,
        expected:
            "Can\u2019t set task as active if there\u2019s no assignee. We don\u2019t recommend setting a task as active unless you\u2019re about to work on the task or you know someone else is currently working on the task. Try again and either set the task as open but inactive (e.g. `- Status: Open`) or set an assignee (e.g. `- Assignee: [ChatGPT](/bot/chatgpt)`).",
    });

    expect(getCreateTaskRequests()).toHaveLength(0);
});

test.each([
    ["date with time", "2027-07-12T09:00:00"],
    ["prose date with time", "July 12th, 2025 at 11:00pm"],
    ["multiple dates", "July 12th, 2025 and July 13th, 2025"],
    ["not a date", "sometime after launch"],
])("rejects improperly formatted due date on create: %s", async (_name, dueDate) => {
    await expectCreateDisplayMessage({
        content: `\
# Invalid due date

- Status: Open
- Due date: ${dueDate}`,
        expected: `Unexpected task due date \u201C${dueDate}\u201D. Try again with a date like \u201CJuly 12, 2027\u201D (not including the time, just the date).`,
    });

    expect(getCreateTaskRequests()).toHaveLength(0);
});
