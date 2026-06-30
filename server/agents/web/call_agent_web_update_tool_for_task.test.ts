import {ApiClientMock} from "~/server/agents/api/test_helpers/api_client_mock.js";
import {createApiAccountMock} from "~/server/agents/api/test_helpers/create_api_account_mock.js";
import {AgentWebContext} from "~/server/agents/web/agent_web_context.js";
import {callAgentWebReadTool} from "~/server/agents/web/call_agent_web_read_tool.js";
import {callAgentWebUpdateTool} from "~/server/agents/web/call_agent_web_update_tool.js";
import {createAgentWebPageStoredLinkPathname} from "~/server/agents/web/create_agent_web_page_stored_link_pathname.js";
import {createAgentWebSessionStorageForTest} from "~/server/agents/web/test_helpers/create_agent_web_session_storage_for_test.js";
import {intoApiAccountReference} from "~/shared/api/specification/into_api_account_reference.js";
import {ErrorBase, InternalError} from "~/shared/error/error.js";
import {ErrorDisplayMessage} from "~/shared/error/types/error_display_message_type.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {defaultTimeZone} from "~/shared/helpers/intl/time_zone.js";
import {generateId} from "~/shared/id/id.js";
import {AccountId, BotId, SpaceId, TaskCollectionId, TaskId} from "~/shared/id/types/id_types.js";
import {testTracer} from "~/shared/tracer/dev/test_tracer.js";

const {span} = testTracer.startSpan("call_agent_web_update_tool_for_task.test.ts");
const api = new ApiClientMock();
const spaceId = generateId<SpaceId>();
const storage = createAgentWebSessionStorageForTest(spaceId);

const botAccountId = generateId<AccountId>();
const botId = generateId<BotId>();
const aliceAccount = createApiAccountMock({name: "Alice"});
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
    await createAgentWebPageStoredLinkPathname(storage, intoApiAccountReference(aliceAccount));
    await createAgentWebPageStoredLinkPathname(storage, engineeringCollectionReference);
    await createAgentWebPageStoredLinkPathname(storage, roadmapCollectionReference);
});

function mockTaskPatch(taskId: TaskId, count = 1) {
    for (let i = 0; i < count; i++) {
        api.mockPatch(
            "/tasks/{id}",
            {
                data: {
                    spaceId,
                    task: {
                        id: taskId,
                        title: "ignored",
                        status: {type: "Open", isActive: false},
                        collections: [],
                        notes: {version: 0, content: {elements: []}},
                    },
                } as any,
            },
            {path: {id: taskId}},
        );
    }
}

function getTaskPatchRequests() {
    return api
        .getRequestHistory()
        .filter(request => request.method === "PATCH" && request.path === "/tasks/{id}");
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

async function expectUpdateDisplayMessage({
    path,
    updates,
    expected,
}: {
    path: string;
    updates: Parameters<typeof callAgentWebUpdateTool>[1]["updates"];
    expected: string;
}) {
    let error: unknown;

    try {
        await callAgentWebUpdateTool(context, {path, updates});
    } catch (actualError) {
        error = actualError;
    }

    if (!error) throw new InternalError("Expected update tool call to throw");

    expect(printDisplayMessage(getDisplayMessage(error))).toEqual(expected);
}

async function readTask({
    taskId = generateId<TaskId>(),
    title,
    status = {type: "Open", isActive: false} as const,
    assignee,
    collectionIds = [],
    priority,
    due,
}: {
    taskId?: TaskId;
    title: string;
    status?: {readonly type: "Open"; readonly isActive: boolean} | {readonly type: "Closed"};
    assignee?: typeof aliceAccount;
    collectionIds?: ReadonlyArray<TaskCollectionId>;
    priority?: {readonly type: "Low" | "Medium" | "High" | "Urgent"};
    due?: {readonly date: string};
}): Promise<{taskId: TaskId; path: string}> {
    const path = await createAgentWebPageStoredLinkPathname(storage, {
        type: "Task",
        id: taskId,
        title,
        status,
    });

    api.mockGetTask(spaceId, taskId, {
        title,
        status,
        ...(assignee ? {assignee} : {}),
        collections: collectionIds.map(collectionId => ({
            collection: {
                id: collectionId,
                name: collectionId === engineeringCollectionId ? "Engineering" : "Roadmap",
            },
        })),
        ...(priority ? {priority} : {}),
        ...(due ? {due} : {}),
    });

    await callAgentWebReadTool(context, {path, limit: "10kb"});

    return {taskId, path};
}

test("updates task title", async () => {
    const {taskId, path} = await readTask({title: "Original title"});
    mockTaskPatch(taskId);

    await expect(
        callAgentWebUpdateTool(context, {
            path,
            updates: [{old: "# Original title", new: "# New title", replaceAll: false}],
        }),
    ).resolves.toEqual("Update was successful.\n");

    expect(getTaskPatchRequests().map(request => request.body)).toEqual([
        {patches: [{type: "SetTitle", title: "New title"}]},
    ]);
});

test("updates task status to active and closed", async () => {
    const {taskId, path} = await readTask({title: "Status task"});
    mockTaskPatch(taskId, 2);

    await callAgentWebUpdateTool(context, {
        path,
        updates: [{old: "- Status: Open", new: "- Status: Open (Active)", replaceAll: false}],
    });
    await callAgentWebUpdateTool(context, {
        path,
        updates: [{old: "- Status: Open (Active)", new: "- Status: Closed", replaceAll: false}],
    });

    expect(getTaskPatchRequests().map(request => request.body)).toEqual([
        {patches: [{type: "SetStatus", status: {type: "Open", isActive: true}}]},
        {patches: [{type: "SetStatus", status: {type: "Closed"}}]},
    ]);
});

test("sets and clears task assignee", async () => {
    const {taskId, path} = await readTask({title: "Assignee task"});
    mockTaskPatch(taskId, 2);

    await callAgentWebUpdateTool(context, {
        path,
        updates: [
            {
                old: "- Status: Open",
                new: "- Status: Open\n- Assignee: [Alice](/human/alice)",
                replaceAll: false,
            },
        ],
    });
    await callAgentWebUpdateTool(context, {
        path,
        updates: [
            {
                old: "- Assignee: [Alice](/human/alice)",
                new: "- Assignee:",
                replaceAll: false,
            },
        ],
    });

    expect(getTaskPatchRequests().map(request => request.body)).toEqual([
        {patches: [{type: "SetAssignee", assignee: intoApiAccountReference(aliceAccount)}]},
        {patches: [{type: "SetAssignee", assignee: null}]},
    ]);
});

test("sets and clears task assignee by removing assignee field entirely", async () => {
    const {taskId, path} = await readTask({title: "Assignee task"});
    mockTaskPatch(taskId, 2);

    await callAgentWebUpdateTool(context, {
        path,
        updates: [
            {
                old: "- Status: Open",
                new: "- Status: Open\n- Assignee: [Alice](/human/alice)",
                replaceAll: false,
            },
        ],
    });
    await callAgentWebUpdateTool(context, {
        path,
        updates: [
            {
                old: "\n- Assignee: [Alice](/human/alice)",
                new: "",
                replaceAll: false,
            },
        ],
    });

    expect(getTaskPatchRequests().map(request => request.body)).toEqual([
        {patches: [{type: "SetAssignee", assignee: intoApiAccountReference(aliceAccount)}]},
        {patches: [{type: "SetAssignee", assignee: null}]},
    ]);
});

test("sets and clears task priority", async () => {
    const {taskId, path} = await readTask({title: "Priority task"});
    mockTaskPatch(taskId, 2);

    await callAgentWebUpdateTool(context, {
        path,
        updates: [
            {
                old: "- Status: Open",
                new: "- Status: Open\n- Priority: Urgent",
                replaceAll: false,
            },
        ],
    });
    await callAgentWebUpdateTool(context, {
        path,
        updates: [{old: "- Priority: Urgent", new: "- Priority:", replaceAll: false}],
    });

    expect(getTaskPatchRequests().map(request => request.body)).toEqual([
        {patches: [{type: "SetPriority", priority: {type: "Urgent"}}]},
        {patches: [{type: "SetPriority", priority: null}]},
    ]);
});

test("sets and clears task due date", async () => {
    const {taskId, path} = await readTask({title: "Due date task"});
    mockTaskPatch(taskId, 2);

    await callAgentWebUpdateTool(context, {
        path,
        updates: [
            {
                old: "- Status: Open",
                new: "- Status: Open\n- Due date: 2027-07-12",
                replaceAll: false,
            },
        ],
    });
    await callAgentWebUpdateTool(context, {
        path,
        updates: [{old: "- Due date: 2027-07-12", new: "- Due date:", replaceAll: false}],
    });

    expect(getTaskPatchRequests().map(request => request.body)).toEqual([
        {patches: [{type: "SetDue", due: {date: "2027-07-12"}}]},
        {patches: [{type: "SetDue", due: null}]},
    ]);
});

test.each([
    ["date with time", "2027-07-12T09:00:00"],
    ["not a date", "sometime after launch"],
])("rejects improperly formatted due date on update: %s", async (_name, dueDate) => {
    const {path} = await readTask({title: "Invalid due date task"});

    await expectUpdateDisplayMessage({
        path,
        updates: [
            {
                old: "- Status: Open",
                new: `- Status: Open\n- Due date: ${dueDate}`,
                replaceAll: false,
            },
        ],
        expected: `Unexpected task due date \u201C${dueDate}\u201D. Try again with a date like \u201CJuly 12, 2027\u201D (not including the time, just the date).`,
    });

    expect(getTaskPatchRequests()).toHaveLength(0);
});

test("adds and removes task collections", async () => {
    const {taskId, path} = await readTask({title: "Collection task"});
    mockTaskPatch(taskId, 2);

    await callAgentWebUpdateTool(context, {
        path,
        updates: [
            {
                old: "- Status: Open",
                new: "- Status: Open\n- Collections: [Engineering](/task-collection/engineering)",
                replaceAll: false,
            },
        ],
    });
    await callAgentWebUpdateTool(context, {
        path,
        updates: [
            {
                old: "\n- Collections: [Engineering](/task-collection/engineering)",
                new: "",
                replaceAll: false,
            },
        ],
    });

    expect(getTaskPatchRequests().map(request => request.body)).toEqual([
        {
            patches: [
                {
                    type: "AddCollection",
                    item: {collection: engineeringCollectionReference},
                },
            ],
        },
        {patches: [{type: "RemoveCollection", collectionId: engineeringCollectionId}]},
    ]);
});
