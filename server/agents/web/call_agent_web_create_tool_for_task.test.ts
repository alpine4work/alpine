import {ApiClientMock} from "~/server/agents/api/test_helpers/api_client_mock.js";
import {createApiAccountMock} from "~/server/agents/api/test_helpers/create_api_account_mock.js";
import {AgentWebContext} from "~/server/agents/web/agent_web_context.js";
import {callAgentWebCreateTool} from "~/server/agents/web/call_agent_web_create_tool.js";
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

const {span} = testTracer.startSpan("call_agent_web_create_tool_for_task.test.ts");
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
            assignee: undefined,
            collections: [],
            priority: undefined,
            due: undefined,
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
            assignee: {id: aliceAccount.id},
            collections: [
                {collection: {id: engineeringCollectionId}},
                {collection: {id: roadmapCollectionId}},
            ],
            priority: {type: "High"},
            due: {date: "2027-07-12"},
        },
    });
});

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

test.each([
    ["date with time", "2027-07-12T09:00:00"],
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
