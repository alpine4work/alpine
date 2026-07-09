import {ApiClientMock} from "~/server/agents/api/test_helpers/api_client_mock.js";
import {AgentWebContext} from "~/server/agents/web/agent_web_context.js";
import {getAgentWebTaskQueryCursorForHashIfExists} from "~/server/agents/web/agent_web_task_query_cursor_hash.js";
import {callAgentWebReadTool} from "~/server/agents/web/call_agent_web_read_tool.js";
import {callAgentWebUpdateTool} from "~/server/agents/web/call_agent_web_update_tool.js";
import {createAgentWebPageStoredLinkPathname} from "~/server/agents/web/create_agent_web_page_stored_link_pathname.js";
import {agentWebTaskCollectionPageApiTasksBatchCount} from "~/server/agents/web/pages/agent_web_task_collection_page.js";
import {createAgentWebSessionStorageForTest} from "~/server/agents/web/test_helpers/create_agent_web_session_storage_for_test.js";
import {
    ApiTaskCollectionColor,
    ApiTaskQueryDefaultsResponse,
} from "~/shared/api/specification/types/api_specification_convenience_types.js";
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
import {ApiTaskQueryCursor} from "~/shared/id/types/api_task_query_cursor.js";
import {AccountId, BotId, SpaceId, TaskCollectionId, TaskId} from "~/shared/id/types/id_types.js";
import {testTracer} from "~/shared/tracer/dev/test_tracer.js";

const spaceId = generateId<SpaceId>();
const collectionId = generateId<TaskCollectionId>();
const launchTaskId = generateId<TaskId>();
const specTaskId = generateId<TaskId>();
const otherTaskId = generateId<TaskId>();

const otherTaskReference = {
    type: "Task" as const,
    id: otherTaskId,
    title: "Other task",
    status: {type: "Open" as const, isActive: false},
};

const {span} = testTracer.startSpan("call_agent_web_update_tool_for_task_collection.test.ts");
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

type UpdateToolUpdate = Parameters<typeof callAgentWebUpdateTool>[1]["updates"][number];

beforeEach(async () => {
    await storage.deleteAll();
    await createAgentWebPageStoredLinkPathname(storage, context.botAccount);
    await createAgentWebPageStoredLinkPathname(storage, {
        type: "TaskCollection",
        id: collectionId,
        title: "Roadmap",
    });
    await createAgentWebPageStoredLinkPathname(storage, otherTaskReference);
});

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

async function expectInvalidUpdateDisplayMessage({
    path = "/task-collection/roadmap",
    updates,
    expected,
}: {
    path?: string;
    updates: ReadonlyArray<UpdateToolUpdate>;
    expected: string;
}) {
    const result = await captureResultPromise(
        async () => await callAgentWebUpdateTool(context, {path, updates}),
    );

    if (result.ok) {
        throw new InternalError("Expected update tool call to throw");
    }

    expect(printDisplayMessage(getDisplayMessage(result.error))).toEqual(expected);
    expect(result.error).toBeInstanceOf(InvalidArgumentError);
}

async function expectUnimplementedUpdate({
    updates,
    expected,
}: {
    updates: ReadonlyArray<UpdateToolUpdate>;
    expected: string;
}) {
    const result = await captureResultPromise(
        async () =>
            await callAgentWebUpdateTool(context, {path: "/task-collection/roadmap", updates}),
    );

    if (result.ok) {
        throw new InternalError("Expected update tool call to throw");
    }

    expect(result.error).toBeInstanceOf(UnimplementedError);
    expect(result.error).toHaveProperty("message", expected);
}

function mockGetCollectionTasks({
    color = "Red",
    defaults = {filters: [], sorts: []},
    cursor,
    nextCursor = null,
}: {
    color?: ApiTaskCollectionColor | null;
    defaults?: ApiTaskQueryDefaultsResponse;
    cursor?: ApiTaskQueryCursor;
    nextCursor?: ApiTaskQueryCursor | null;
} = {}) {
    api.mockGet("/task-collections/{id}/tasks", {
        params: {
            path: {id: collectionId},
            query: {
                limit: agentWebTaskCollectionPageApiTasksBatchCount,
                cursor,
            },
        },
        data: {
            spaceId,
            collection: {
                id: collectionId,
                name: "Roadmap",
                ...(color !== null ? {color} : {}),
                defaults,
            },
            nextCursor,
            tasks: [
                {
                    cursor: "task-cursor-0" as ApiTaskQueryCursor,
                    task: {
                        id: launchTaskId,
                        title: "Launch task",
                        status: {type: "Open" as const, isActive: false},
                    },
                },
                {
                    cursor: "task-cursor-1" as ApiTaskQueryCursor,
                    task: {
                        id: specTaskId,
                        title: "Spec task",
                        status: {type: "Open" as const, isActive: false},
                    },
                },
            ],
        },
    });
}

function mockCollectionPatch() {
    api.mockPatch("/task-collections/{id}", {
        params: {path: {id: collectionId}},
        data: {
            spaceId,
            collection: {
                id: collectionId,
                name: "Roadmap",
                defaults: {filters: [], sorts: []},
            },
        },
    });
}

function getCollectionPatchRequests() {
    return api
        .getRequestHistory()
        .filter(request => request.method === "PATCH" && request.path === "/task-collections/{id}");
}

async function readTaskCollectionPage({
    color = "Red",
    defaults,
    nextCursor,
    limit = "10kb",
}: {
    color?: ApiTaskCollectionColor | null;
    defaults?: ApiTaskQueryDefaultsResponse;
    nextCursor?: ApiTaskQueryCursor | null;
    limit?: string;
} = {}) {
    mockGetCollectionTasks({color, defaults, nextCursor});

    return await callAgentWebReadTool(context, {
        path: "/task-collection/roadmap",
        limit,
    });
}

function getTaskCollectionNextPagePath(response: string): string {
    const match = response.match(/\[Next page »\]\(([^)]+)\)/);

    if (match === null) throw new InternalError("Expected task collection next page link");

    return match[1]!;
}

async function getTaskCollectionNextPageCursor(path: string): Promise<ApiTaskQueryCursor> {
    const cursorHash = new URL(path, "https://agent-web.local").searchParams.get("after");

    if (cursorHash === null) throw new InternalError("Expected task collection cursor hash");

    const cursor = await getAgentWebTaskQueryCursorForHashIfExists(
        storage,
        collectionId,
        cursorHash,
    );

    if (cursor === undefined) throw new InternalError("Expected task collection cursor");

    return cursor;
}

test("updates the task collection name", async () => {
    await readTaskCollectionPage();
    mockCollectionPatch();

    await expect(
        callAgentWebUpdateTool(context, {
            path: "/task-collection/roadmap",
            updates: [{old: "# Roadmap", new: "# Roadmap 2026", replaceAll: false}],
        }),
    ).resolves.toEqual("Update was successful.\n");

    expect(getCollectionPatchRequests()[0]?.body).toEqual({
        patches: [{type: "SetName", name: "Roadmap 2026"}],
    });
});

test("updates the task collection color", async () => {
    await readTaskCollectionPage();
    mockCollectionPatch();

    await expect(
        callAgentWebUpdateTool(context, {
            path: "/task-collection/roadmap",
            updates: [{old: "Color: Red", new: "Color: Blue", replaceAll: false}],
        }),
    ).resolves.toEqual("Update was successful.\n");

    expect(getCollectionPatchRequests()[0]?.body).toEqual({
        patches: [{type: "SetColor", color: "Blue"}],
    });
});

test("adds a task collection color", async () => {
    await readTaskCollectionPage({color: null});
    mockCollectionPatch();

    await expect(
        callAgentWebUpdateTool(context, {
            path: "/task-collection/roadmap",
            updates: [{old: "# Roadmap", new: "# Roadmap\n\nColor: Green", replaceAll: false}],
        }),
    ).resolves.toEqual("Update was successful.\n");

    expect(getCollectionPatchRequests()[0]?.body).toEqual({
        patches: [{type: "SetColor", color: "Green"}],
    });
});

test("removes the task collection color by removing the color line", async () => {
    await readTaskCollectionPage();
    mockCollectionPatch();

    await expect(
        callAgentWebUpdateTool(context, {
            path: "/task-collection/roadmap",
            updates: [{old: "\n\nColor: Red", new: "", replaceAll: false}],
        }),
    ).resolves.toEqual("Update was successful.\n");

    expect(getCollectionPatchRequests()[0]?.body).toEqual({
        patches: [{type: "SetColor", color: null}],
    });
});

test("removes the task collection color with a none color", async () => {
    await readTaskCollectionPage();
    mockCollectionPatch();

    await expect(
        callAgentWebUpdateTool(context, {
            path: "/task-collection/roadmap",
            updates: [{old: "Color: Red", new: "Color: None", replaceAll: false}],
        }),
    ).resolves.toEqual("Update was successful.\n");

    expect(getCollectionPatchRequests()[0]?.body).toEqual({
        patches: [{type: "SetColor", color: null}],
    });
});

test("updates the task collection name and color together", async () => {
    await readTaskCollectionPage();
    mockCollectionPatch();

    await expect(
        callAgentWebUpdateTool(context, {
            path: "/task-collection/roadmap",
            updates: [
                {old: "# Roadmap", new: "# Roadmap 2026", replaceAll: false},
                {old: "Color: Red", new: "Color: Blue", replaceAll: false},
            ],
        }),
    ).resolves.toEqual("Update was successful.\n");

    expect(getCollectionPatchRequests()).toHaveLength(1);
    expect(getCollectionPatchRequests()[0]?.body).toEqual({
        patches: [
            {type: "SetName", name: "Roadmap 2026"},
            {type: "SetColor", color: "Blue"},
        ],
    });
});

test("makes no API calls when only a task link label changes", async () => {
    await readTaskCollectionPage();

    await expect(
        callAgentWebUpdateTool(context, {
            path: "/task-collection/roadmap",
            updates: [
                {
                    old: "[Launch task (Open)](/task/launch-task)",
                    new: "[Renamed task](/task/launch-task)",
                    replaceAll: false,
                },
            ],
        }),
    ).resolves.toEqual("Update was successful.\n");

    expect(getCollectionPatchRequests()).toHaveLength(0);
});

test("throws unimplemented when removing a task", async () => {
    await readTaskCollectionPage();

    await expectUnimplementedUpdate({
        updates: [
            {
                old: "\n\n- [Spec task (Open)](/task/spec-task)",
                new: "",
                replaceAll: false,
            },
        ],
        expected: "Changing the tasks in a task collection hasn\u2019t been implemented yet",
    });
});

test("throws unimplemented when adding a task", async () => {
    await readTaskCollectionPage();

    await expectUnimplementedUpdate({
        updates: [
            {
                old: "- [Spec task (Open)](/task/spec-task)",
                new: "- [Spec task (Open)](/task/spec-task)\n\n- [Other task](/task/other-task)",
                replaceAll: false,
            },
        ],
        expected: "Changing the tasks in a task collection hasn\u2019t been implemented yet",
    });
});

test("throws unimplemented when reordering tasks", async () => {
    await readTaskCollectionPage();

    await expectUnimplementedUpdate({
        updates: [
            {
                old: "- [Launch task (Open)](/task/launch-task)\n\n- [Spec task (Open)](/task/spec-task)",
                new: "- [Spec task (Open)](/task/spec-task)\n\n- [Launch task (Open)](/task/launch-task)",
                replaceAll: false,
            },
        ],
        expected: "Changing the tasks in a task collection hasn\u2019t been implemented yet",
    });
});

const roadmapDefaults: ApiTaskQueryDefaultsResponse = {
    filters: [
        {
            type: "Status",
            operation: {type: "OneOf", statuses: [{type: "Open", isActive: false}]},
        },
    ],
    sorts: [
        {type: "Priority", direction: "Descending"},
        {type: "Due", direction: "Ascending"},
    ],
};

test("throws unimplemented when changing the default filters and sorts", async () => {
    await readTaskCollectionPage({defaults: roadmapDefaults});

    await expectUnimplementedUpdate({
        updates: [
            {
                old: "status=open&sort=-priority,due",
                new: "status=open,closed&sort=-priority,due",
                replaceAll: false,
            },
        ],
        expected:
            "Changing the default filters and sorts of a task collection hasn\u2019t been " +
            "implemented yet",
    });
});

test("throws unimplemented when removing the default filters and sorts", async () => {
    await readTaskCollectionPage({defaults: roadmapDefaults});

    await expectUnimplementedUpdate({
        updates: [
            {
                old: "\n\nDefault filters and sorts:\n\n```\nstatus=open&sort=-priority,due\n```",
                new: "",
                replaceAll: false,
            },
        ],
        expected:
            "Changing the default filters and sorts of a task collection hasn\u2019t been " +
            "implemented yet",
    });
});

test("rejects an unknown status filter in the default filters", async () => {
    await readTaskCollectionPage({defaults: roadmapDefaults});

    await expectInvalidUpdateDisplayMessage({
        updates: [{old: "status=open", new: "status=done", replaceAll: false}],
        expected:
            "Unexpected task status filter `status=done`. Try again with `open`, " +
            "`open-active`, or `closed` (e.g. `status=open` or `status[not]=closed`).",
    });
});

test("rejects changing a task link to an unknown task", async () => {
    await readTaskCollectionPage();

    await expectInvalidUpdateDisplayMessage({
        updates: [
            {
                old: "[Spec task (Open)](/task/spec-task)",
                new: "[Missing task](/task/missing-task)",
                replaceAll: false,
            },
        ],
        expected:
            "Couldn\u2019t find a task for the link \u201CMissing task\u201D on line 7. Try again " +
            "with a link to a task you\u2019ve seen before (e.g. `[My Task (Open)](/task/my-task)`).",
    });
});

test("rejects an unexpected task collection color", async () => {
    await readTaskCollectionPage();

    await expectInvalidUpdateDisplayMessage({
        updates: [{old: "Color: Red", new: "Color: Magenta", replaceAll: false}],
        expected:
            "Unexpected task collection color \u201CMagenta\u201D on line 3. Try again with " +
            "\u201CRed\u201D, \u201COrange\u201D, \u201CYellow\u201D, \u201CGreen\u201D, \u201CCyan\u201D, " +
            "\u201CBlue\u201D, \u201CIndigo\u201D, \u201CPurple\u201D, \u201CPink\u201D, or remove the color entirely.",
    });
});

test("rejects unexpected markdown after the task list", async () => {
    await readTaskCollectionPage();

    await expectInvalidUpdateDisplayMessage({
        updates: [
            {
                old: "- [Spec task (Open)](/task/spec-task)",
                new: "- [Spec task (Open)](/task/spec-task)\n\nThe end.",
                replaceAll: false,
            },
        ],
        expected:
            "Unexpected markdown on line 9. Try again with only a color (e.g. `Color: Red`) " +
            "followed by a task list (an unordered list where every item is a task link) after " +
            "the task collection name.",
    });
});

test("rejects removing the end of tasks marker", async () => {
    await readTaskCollectionPage();

    await expectInvalidUpdateDisplayMessage({
        updates: [{old: "\n\nEnd of tasks.", new: "", replaceAll: false}],
        expected:
            "You can\u2019t update the \u201CEnd of tasks\u201D marker. Only a `read` tool call " +
            "can tell you whether you\u2019ve seen all of a collection\u2019s tasks. Try " +
            "again with a more specific update that leaves the \u201CEnd of tasks\u201D marker " +
            "unchanged.",
    });

    expect(getCollectionPatchRequests()).toHaveLength(0);
});

test("rejects changing the next page link cursor", async () => {
    const nextCursor = "task-cursor-next" as ApiTaskQueryCursor;
    const response = await readTaskCollectionPage({nextCursor, limit: "140b"});
    const nextPagePath = getTaskCollectionNextPagePath(response);

    await expectInvalidUpdateDisplayMessage({
        updates: [
            {
                old: nextPagePath,
                new: nextPagePath.replace(/after=[^&]+/, "after=d4e5f6"),
                replaceAll: false,
            },
        ],
        expected:
            "You can\u2019t update the \u201CNext page \u00bb\u201D link in task collection " +
            "markdown. Try again with a more specific update that leaves the " +
            "\u201CNext page \u00bb\u201D link unchanged.",
    });
});

test("rejects removing the next page link", async () => {
    const nextCursor = "task-cursor-next" as ApiTaskQueryCursor;
    const response = await readTaskCollectionPage({nextCursor, limit: "140b"});
    const nextPagePath = getTaskCollectionNextPagePath(response);

    await expectInvalidUpdateDisplayMessage({
        updates: [
            {
                old: `[Next page »](${nextPagePath})`,
                new: "",
                replaceAll: false,
            },
        ],
        expected:
            "You can\u2019t update the \u201CNext page \u00bb\u201D link in task collection " +
            "markdown. Try again with a more specific update that leaves the " +
            "\u201CNext page \u00bb\u201D link unchanged.",
    });
});

test("rejects adding the end of tasks marker", async () => {
    const nextCursor = "task-cursor-next" as ApiTaskQueryCursor;
    const response = await readTaskCollectionPage({nextCursor, limit: "140b"});

    await expectInvalidUpdateDisplayMessage({
        updates: [
            {
                old: response,
                new: `${response}\n\nEnd of tasks.`,
                replaceAll: false,
            },
        ],
        expected:
            "You can\u2019t update the \u201CEnd of tasks\u201D marker. Only a `read` tool call " +
            "can tell you whether you\u2019ve seen all of a collection\u2019s tasks. Try " +
            "again with a more specific update that leaves the \u201CEnd of tasks\u201D marker " +
            "unchanged.",
    });
});

test("rejects renaming the task collection on a later page", async () => {
    const nextCursor = "task-cursor-next" as ApiTaskQueryCursor;
    const response = await readTaskCollectionPage({nextCursor, limit: "140b"});
    const nextPagePath = getTaskCollectionNextPagePath(response);
    const nextPageCursor = await getTaskCollectionNextPageCursor(nextPagePath);

    mockGetCollectionTasks({cursor: nextPageCursor});
    await callAgentWebReadTool(context, {path: nextPagePath, limit: "10kb"});

    await expectInvalidUpdateDisplayMessage({
        path: nextPagePath,
        updates: [
            {
                old: "Tasks in Roadmap.",
                new: "Tasks in Roadmap 2026.",
                replaceAll: false,
            },
        ],
        expected:
            "You can only update the task collection name on the first page of the " +
            "collection. You must leave the `Tasks in My Collection.` line at the start of " +
            "the collection markdown in place. Try calling the `read` tool to navigate to " +
            "the first page of the collection and you can call the `update` tool on that " +
            "page to update the name.",
    });
});
