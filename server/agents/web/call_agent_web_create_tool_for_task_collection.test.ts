import {ApiClientMock} from "~/server/agents/api/test_helpers/api_client_mock.js";
import {AgentWebContext} from "~/server/agents/web/agent_web_context.js";
import {callAgentWebCreateTool} from "~/server/agents/web/call_agent_web_create_tool.js";
import {createAgentWebPageStoredLinkPathname} from "~/server/agents/web/create_agent_web_page_stored_link_pathname.js";
import {createAgentWebSessionStorageForTest} from "~/server/agents/web/test_helpers/create_agent_web_session_storage_for_test.js";
import {ApiTaskCollectionColor} from "~/shared/api/specification/types/api_specification_convenience_types.js";
import {
    ErrorBase,
    InternalError,
    InvalidArgumentError,
    UnimplementedError,
} from "~/shared/error/error.js";
import {ErrorDisplayMessage} from "~/shared/error/types/error_display_message_type.js";
import {captureResultPromise} from "~/shared/helpers/control/capture_result_promise.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {defaultTimeZone} from "~/shared/helpers/intl/time_zone.js";
import {generateId} from "~/shared/id/id.js";
import {AccountId, BotId, SpaceId, TaskCollectionId, TaskId} from "~/shared/id/types/id_types.js";
import {testTracer} from "~/shared/tracer/dev/test_tracer.js";

const spaceId = generateId<SpaceId>();
const launchTaskId = generateId<TaskId>();

const launchTaskReference = {
    type: "Task" as const,
    id: launchTaskId,
    title: "Launch task",
    status: {type: "Open" as const, isActive: false},
};

const {span} = testTracer.startSpan("call_agent_web_create_tool_for_task_collection.test.ts");
const api = new ApiClientMock();
const storage = createAgentWebSessionStorageForTest(spaceId);

const context: AgentWebContext = {
    spaceId,
    api,
    storage,
    span,
    timeZone: defaultTimeZone,
    botAccount: {
        type: "Account",
        id: generateId<AccountId>(),
        title: "ChatGPT",
        shortName: "ChatGPT",
        bot: {id: generateId<BotId>()},
        pathname: "/bot/chatgpt",
    },
};

beforeEach(async () => {
    await storage.deleteAll();
    await createAgentWebPageStoredLinkPathname(storage, context.botAccount);
    await createAgentWebPageStoredLinkPathname(storage, launchTaskReference);
});

function mockCreateTaskCollection({
    id = generateId<TaskCollectionId>(),
    name,
    color,
}: {
    id?: TaskCollectionId;
    name: string;
    color?: ApiTaskCollectionColor;
}) {
    api.mockPost("/task-collections", {
        params: "Any",
        data: {
            spaceId,
            collection: {
                id,
                name,
                ...(color !== undefined ? {color} : {}),
                defaults: {filters: [], sorts: []},
            },
        },
    });
}

function getCreateTaskCollectionRequests() {
    return api
        .getRequestHistory()
        .filter(request => request.method === "POST" && request.path === "/task-collections");
}

function printDisplayMessage(displayMessage: ErrorDisplayMessage): string {
    let string = "";

    for (const segment of displayMessage) {
        switch (segment.type) {
            case "Text":
            case "SensitiveText":
            case "Link":
                string += segment.text;
                break;
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

async function expectInvalidCreateDisplayMessage({
    content,
    expected,
}: {
    content: string;
    expected: string;
}) {
    const result = await captureResultPromise(
        async () => await callAgentWebCreateTool(context, {type: "task-collection", content}),
    );

    if (result.ok) {
        throw new InternalError("Expected create tool call to throw");
    }

    expect(printDisplayMessage(getDisplayMessage(result.error))).toEqual(expected);
    expect(result.error).toBeInstanceOf(InvalidArgumentError);
}

test.each([
    ["without", ""],
    ["with", "\n\nEnd of tasks."],
])("creates a task collection %s the end of tasks marker", async (_name, endOfTasksMarker) => {
    mockCreateTaskCollection({name: "Roadmap"});

    await expect(
        callAgentWebCreateTool(context, {
            type: "task-collection",
            content: `# Roadmap${endOfTasksMarker}`,
        }),
    ).resolves.toEqual(
        "Create was successful. New task collection: [Roadmap](/task-collection/roadmap).\n",
    );

    expect(getCreateTaskCollectionRequests()).toHaveLength(1);
    expect(getCreateTaskCollectionRequests()[0]?.body).toEqual({
        spaceId,
        collection: {
            name: "Roadmap",
            color: undefined,
        },
    });
});

test("creates a task collection with a color", async () => {
    mockCreateTaskCollection({name: "Roadmap", color: "Blue"});

    await expect(
        callAgentWebCreateTool(context, {
            type: "task-collection",
            content: `\
# Roadmap

Color: Blue`,
        }),
    ).resolves.toEqual(
        "Create was successful. New task collection: [Roadmap](/task-collection/roadmap).\n",
    );

    expect(getCreateTaskCollectionRequests()[0]?.body).toEqual({
        spaceId,
        collection: {
            name: "Roadmap",
            color: "Blue",
        },
    });
});

test("creates a task collection with a none color", async () => {
    mockCreateTaskCollection({name: "Roadmap"});

    await expect(
        callAgentWebCreateTool(context, {
            type: "task-collection",
            content: `\
# Roadmap

Color: None`,
        }),
    ).resolves.toEqual(
        "Create was successful. New task collection: [Roadmap](/task-collection/roadmap).\n",
    );

    expect(getCreateTaskCollectionRequests()[0]?.body).toEqual({
        spaceId,
        collection: {
            name: "Roadmap",
            color: undefined,
        },
    });
});

test("creates a task collection with the normalized task collect type", async () => {
    mockCreateTaskCollection({name: "Roadmap"});

    await expect(
        callAgentWebCreateTool(context, {
            type: "task-collect",
            content: "# Roadmap",
        }),
    ).resolves.toEqual(
        "Create was successful. New task collection: [Roadmap](/task-collection/roadmap).\n",
    );
});

test("throws unimplemented when creating a task collection with tasks", async () => {
    const result = await captureResultPromise(
        async () =>
            await callAgentWebCreateTool(context, {
                type: "task-collection",
                content: `\
# Roadmap

Color: Red

- [Launch task](/task/launch-task)`,
            }),
    );

    if (result.ok) {
        throw new InternalError("Expected create tool call to throw");
    }

    expect(result.error).toBeInstanceOf(UnimplementedError);
    expect(result.error).toHaveProperty(
        "message",
        "Adding tasks while creating a task collection hasn\u2019t been implemented yet",
    );
    expect(getCreateTaskCollectionRequests()).toHaveLength(0);
});

test("throws unimplemented when creating a task collection with default filters and sorts", async () => {
    const result = await captureResultPromise(
        async () =>
            await callAgentWebCreateTool(context, {
                type: "task-collection",
                content: `\
# Roadmap

Default filters and sorts:

\`\`\`
?status=open&sort=-priority,due
\`\`\``,
            }),
    );

    if (result.ok) {
        throw new InternalError("Expected create tool call to throw");
    }

    expect(result.error).toBeInstanceOf(UnimplementedError);
    expect(result.error).toHaveProperty(
        "message",
        "Setting the default filters and sorts while creating a task collection " +
            "hasn\u2019t been implemented yet",
    );
    expect(getCreateTaskCollectionRequests()).toHaveLength(0);
});

test("rejects creating a task collection without a name", async () => {
    await expectInvalidCreateDisplayMessage({
        content: "Color: Red",
        expected:
            "Task collection markdown must start with a task collection name (e.g. " +
            "`# My Collection`) when creating a task collection. Try again with a task " +
            "collection name.",
    });

    expect(getCreateTaskCollectionRequests()).toHaveLength(0);
});

test("rejects creating a later task collection page", async () => {
    await expectInvalidCreateDisplayMessage({
        content: "Tasks in Roadmap.",
        expected:
            "Task collection markdown must start with a task collection name (e.g. " +
            "`# My Collection`) when creating a task collection. Try again with a task " +
            "collection name.",
    });

    expect(getCreateTaskCollectionRequests()).toHaveLength(0);
});

test("rejects creating a task collection with an unexpected color", async () => {
    await expectInvalidCreateDisplayMessage({
        content: `\
# Roadmap

Color: Magenta`,
        expected:
            "Unexpected task collection color \u201CMagenta\u201D on line 3. Try again with " +
            "\u201CRed\u201D, \u201COrange\u201D, \u201CYellow\u201D, \u201CGreen\u201D, \u201CCyan\u201D, " +
            "\u201CBlue\u201D, \u201CIndigo\u201D, \u201CPurple\u201D, \u201CPink\u201D, or remove the color entirely.",
    });

    expect(getCreateTaskCollectionRequests()).toHaveLength(0);
});

test("rejects creating a task collection with an unknown task link", async () => {
    await expectInvalidCreateDisplayMessage({
        content: `\
# Roadmap

- [Missing task](/task/missing-task)`,
        expected:
            "Couldn\u2019t find a task for the link \u201CMissing task\u201D on line 3. Try again " +
            "with a link to a task you\u2019ve seen before (e.g. `[My Task (Open)](/task/my-task)`).",
    });

    expect(getCreateTaskCollectionRequests()).toHaveLength(0);
});

test("rejects creating a task collection with a next page link", async () => {
    await createAgentWebPageStoredLinkPathname(storage, {
        type: "TaskCollection",
        id: generateId<TaskCollectionId>(),
        title: "Roadmap",
    });

    await expectInvalidCreateDisplayMessage({
        content: `\
# Roadmap 2026

[Next page »](/task-collection/roadmap?after=a1b2c3)`,
        expected:
            "You can\u2019t include a \u201CNext page »\u201D link when creating a task collection. " +
            "Try again without a \u201CNext page »\u201D link.",
    });

    expect(getCreateTaskCollectionRequests()).toHaveLength(0);
});
