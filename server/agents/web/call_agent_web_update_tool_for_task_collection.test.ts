import {ApiClientMock} from "~/server/agents/api/test_helpers/api_client_mock.js";
import {AgentWebContext} from "~/server/agents/web/agent_web_context.js";
import {
    createAgentWebTaskQueryCursorHash,
    getAgentWebTaskQueryCursorForHashIfExists,
} from "~/server/agents/web/agent_web_task_query_cursor_hash.js";
import {callAgentWebReadTool} from "~/server/agents/web/call_agent_web_read_tool.js";
import {callAgentWebUpdateTool} from "~/server/agents/web/call_agent_web_update_tool.js";
import {createAgentWebPageStoredLinkPathname} from "~/server/agents/web/create_agent_web_page_stored_link_pathname.js";
import {createAgentWebSessionStorageForTest} from "~/server/agents/web/test_helpers/create_agent_web_session_storage_for_test.js";
import {
    ApiAccountReferenceResponse,
    ApiTaskCollectionColor,
    ApiTaskCollectionReferenceResponse,
    ApiTaskPriority,
    ApiTaskQueryDefaultsResponse,
    ApiTaskReferenceResponse,
    ApiTaskStatus,
    ApiTaskSubtasks,
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
const reviewTaskId = generateId<TaskId>();
const qaTaskId = generateId<TaskId>();
const task6Id = generateId<TaskId>();
const task7Id = generateId<TaskId>();
const task8Id = generateId<TaskId>();

const agentWebTaskCollectionPageApiTasksBatchCount = 31;

const otherTaskReference = {
    type: "Task" as const,
    id: otherTaskId,
    title: "Other task",
    status: {type: "Open" as const, isActive: false},
};

const reviewTaskReference = {
    type: "Task" as const,
    id: reviewTaskId,
    title: "Review task",
    status: {type: "Open" as const, isActive: false},
};

const qaTaskReference = {
    type: "Task" as const,
    id: qaTaskId,
    title: "QA task",
    status: {type: "Open" as const, isActive: false},
};

const task6Reference = {
    type: "Task" as const,
    id: task6Id,
    title: "Task 6",
    status: {type: "Open" as const, isActive: false},
};

const task7Reference = {
    type: "Task" as const,
    id: task7Id,
    title: "Task 7",
    status: {type: "Open" as const, isActive: false},
};

const task8Reference = {
    type: "Task" as const,
    id: task8Id,
    title: "Task 8",
    status: {type: "Open" as const, isActive: false},
};

const aliceReference: ApiAccountReferenceResponse = {
    type: "Account",
    id: generateId<AccountId>(),
    title: "Alice",
    shortName: "Alice",
};

const bobReference: ApiAccountReferenceResponse = {
    type: "Account",
    id: generateId<AccountId>(),
    title: "Bob",
    shortName: "Bob",
};

const otherCollectionReference: ApiTaskCollectionReferenceResponse = {
    type: "TaskCollection",
    id: generateId<TaskCollectionId>(),
    title: "Other collection",
};

const designCollectionReference: ApiTaskCollectionReferenceResponse = {
    type: "TaskCollection",
    id: generateId<TaskCollectionId>(),
    title: "Design",
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
    await createAgentWebPageStoredLinkPathname(storage, reviewTaskReference);
    await createAgentWebPageStoredLinkPathname(storage, qaTaskReference);
    await createAgentWebPageStoredLinkPathname(storage, aliceReference);
    await createAgentWebPageStoredLinkPathname(storage, bobReference);
    await createAgentWebPageStoredLinkPathname(storage, otherCollectionReference);
    await createAgentWebPageStoredLinkPathname(storage, designCollectionReference);
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
    launchTaskTitle = "Launch task",
    specTaskTitle = "Spec task",
    includeOtherTask = false,
    otherTaskTitle = otherTaskReference.title,
    additionalTasks = [],
    specTaskStatus = {type: "Open", isActive: false},
    specTaskSubtasks = {openTaskCount: 0, closedTaskCount: 0},
    specTaskParent = null,
    specTaskAssignee = null,
    specTaskCollections = [],
    specTaskPriority = null,
    specTaskDueDate = null,
}: {
    color?: ApiTaskCollectionColor | null;
    defaults?: ApiTaskQueryDefaultsResponse;
    cursor?: ApiTaskQueryCursor;
    nextCursor?: ApiTaskQueryCursor | null;
    launchTaskTitle?: string;
    specTaskTitle?: string;
    includeOtherTask?: boolean;
    otherTaskTitle?: string;
    additionalTasks?: ReadonlyArray<ApiTaskReferenceResponse>;
    specTaskStatus?: ApiTaskStatus;
    specTaskSubtasks?: ApiTaskSubtasks;
    specTaskParent?: ApiTaskReferenceResponse | null;
    specTaskAssignee?: ApiAccountReferenceResponse | null;
    specTaskCollections?: ReadonlyArray<ApiTaskCollectionReferenceResponse>;
    specTaskPriority?: ApiTaskPriority | null;
    specTaskDueDate?: string | null;
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
                        title: launchTaskTitle,
                        status: {type: "Open" as const, isActive: false},
                        subtasks: {openTaskCount: 0, closedTaskCount: 0},
                    },
                },
                {
                    cursor: "task-cursor-1" as ApiTaskQueryCursor,
                    task: {
                        id: specTaskId,
                        title: specTaskTitle,
                        status: specTaskStatus,
                        subtasks: specTaskSubtasks,
                        ...(specTaskParent
                            ? {
                                  parent: {
                                      task: {
                                          id: specTaskParent.id,
                                          title: specTaskParent.title,
                                          status: specTaskParent.status,
                                      },
                                  },
                              }
                            : {}),
                        ...(specTaskAssignee
                            ? {
                                  assignee: {
                                      id: specTaskAssignee.id,
                                      name: specTaskAssignee.title,
                                      shortName: specTaskAssignee.shortName,
                                      bot: specTaskAssignee.bot,
                                  },
                              }
                            : {}),
                        collections: specTaskCollections.map(collection => ({
                            collection: {id: collection.id, name: collection.title},
                        })),
                        ...(specTaskPriority ? {priority: specTaskPriority} : {}),
                        ...(specTaskDueDate ? {due: {date: specTaskDueDate}} : {}),
                    },
                },
                ...[
                    ...(includeOtherTask ? [{...otherTaskReference, title: otherTaskTitle}] : []),
                    ...additionalTasks,
                ].map((task, index) => ({
                    cursor: `task-cursor-${index + 2}` as ApiTaskQueryCursor,
                    task: {
                        id: task.id,
                        title: task.title,
                        status: task.status,
                        subtasks: {openTaskCount: 0, closedTaskCount: 0},
                    },
                })),
            ],
        },
    });
}

function mockQueryCollectionTasks(): void {
    api.mockPost("/task-collections/{id}/tasks/query", {
        params: {path: {id: collectionId}},
        data: {
            spaceId,
            collection: {
                id: collectionId,
                name: "Roadmap",
                color: "Red",
                defaults: {filters: [], sorts: []},
            },
            nextCursor: null,
            tasks: [
                {
                    cursor: "task-cursor-0" as ApiTaskQueryCursor,
                    task: {
                        id: launchTaskId,
                        title: "Launch task",
                        status: {type: "Open" as const, isActive: false},
                        subtasks: {openTaskCount: 0, closedTaskCount: 0},
                    },
                },
                {
                    cursor: "task-cursor-1" as ApiTaskQueryCursor,
                    task: {
                        id: specTaskId,
                        title: "Spec task",
                        status: {type: "Open" as const, isActive: false},
                        subtasks: {openTaskCount: 0, closedTaskCount: 0},
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

function createMovedTaskCursor(id: TaskId): ApiTaskQueryCursor {
    return `moved-task-cursor-${id}` as ApiTaskQueryCursor;
}

function mockTaskPatch(...ids: ReadonlyArray<TaskId>) {
    api.mockPatch("/tasks", {
        params: "Any",
        data: {
            spaceId,
            tasks: ids.map(id => ({
                task: {
                    id,
                    title: "ignored",
                    status: {type: "Open", isActive: false},
                    collections: [],
                    notes: {version: 0, content: {elements: []}},
                },
                collections: [
                    {
                        collection: {id: collectionId},
                        movedCursor: createMovedTaskCursor(id),
                    },
                ],
            })),
        } as any,
    });
}

function getCollectionPatchRequests() {
    return api
        .getRequestHistory()
        .filter(request => request.method === "PATCH" && request.path === "/task-collections/{id}");
}

function getBatchTaskPatchRequests() {
    return api
        .getRequestHistory()
        .filter(request => request.method === "PATCH" && request.path === "/tasks");
}

function getTaskPatchRequests() {
    return getBatchTaskPatchRequests().flatMap(request => {
        const patchesByTaskId = new Map<TaskId, Array<unknown>>();

        for (const {id, patch} of request.body.patches) {
            const patches = patchesByTaskId.get(id);

            if (patches === undefined) {
                patchesByTaskId.set(id, [patch]);
            } else {
                patches.push(patch);
            }
        }

        return Array.from(patchesByTaskId, ([, patches]) => ({
            ...request,
            body: {patches},
        }));
    });
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

async function readTaskCollectionPageWithPopulatedSpecTask() {
    mockGetCollectionTasks({
        specTaskParent: otherTaskReference,
        specTaskAssignee: aliceReference,
        specTaskCollections: [otherCollectionReference],
        specTaskPriority: {type: "High"},
        specTaskDueDate: "2027-07-12",
    });

    return await callAgentWebReadTool(context, {
        path: "/task-collection/roadmap",
        limit: "10kb",
    });
}

async function updateSpecTaskField({old, new: newValue}: {old: string; new: string}) {
    mockTaskPatch(specTaskId);

    await callAgentWebUpdateTool(context, {
        path: "/task-collection/roadmap",
        updates: [{old, new: newValue, replaceAll: false}],
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

async function createTaskCollectionTailPagePath(afterCursor: ApiTaskQueryCursor): Promise<string> {
    const afterCursorHash = await createAgentWebTaskQueryCursorHash(
        storage,
        collectionId,
        afterCursor,
    );

    return `/task-collection/roadmap?after=${afterCursorHash}`;
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

test("updates a task title in its link label", async () => {
    await readTaskCollectionPage();
    mockTaskPatch(launchTaskId);

    await expect(
        callAgentWebUpdateTool(context, {
            path: "/task-collection/roadmap",
            updates: [
                {
                    old: "[Launch task (Open)](/task/launch-task)",
                    new: "[Renamed task (Open)](/task/launch-task)",
                    replaceAll: false,
                },
            ],
        }),
    ).resolves.toEqual("Update was successful.\n");

    expect(getTaskPatchRequests().map(request => request.body)).toEqual([
        {patches: [{type: "SetTitle", title: "Renamed task"}]},
    ]);
});

test("updates a 200 character task title without truncating it", async () => {
    const oldTitle = "a".repeat(200);
    const newTitle = "b".repeat(200);
    const taskPath = `/task/${"a".repeat(50)}`;

    mockGetCollectionTasks({launchTaskTitle: oldTitle});
    await callAgentWebReadTool(context, {
        path: "/task-collection/roadmap",
        limit: "10kb",
    });
    mockTaskPatch(launchTaskId);

    await expect(
        callAgentWebUpdateTool(context, {
            path: "/task-collection/roadmap",
            updates: [
                {
                    old: `[${oldTitle} (Open)](${taskPath})`,
                    new: `[${newTitle} (Open)](${taskPath})`,
                    replaceAll: false,
                },
            ],
        }),
    ).resolves.toEqual("Update was successful.\n");

    expect(getTaskPatchRequests().map(request => request.body)).toEqual([
        {patches: [{type: "SetTitle", title: newTitle}]},
    ]);
});

test("updates a task status in its link label", async () => {
    await readTaskCollectionPage();
    mockTaskPatch(specTaskId);

    await expect(
        callAgentWebUpdateTool(context, {
            path: "/task-collection/roadmap",
            updates: [
                {
                    old: "[Spec task (Open)](/task/spec-task)",
                    new: "[Spec task (Closed)](/task/spec-task)",
                    replaceAll: false,
                },
            ],
        }),
    ).resolves.toEqual("Update was successful.\n");

    expect(getTaskPatchRequests().map(request => request.body)).toEqual([
        {patches: [{type: "SetStatus", status: {type: "Closed"}}]},
    ]);
});

test("sets an assigned open task as active", async () => {
    mockGetCollectionTasks({specTaskAssignee: aliceReference});
    await callAgentWebReadTool(context, {
        path: "/task-collection/roadmap",
        limit: "10kb",
    });
    mockTaskPatch(specTaskId);

    await expect(
        callAgentWebUpdateTool(context, {
            path: "/task-collection/roadmap",
            updates: [
                {
                    old: "[Spec task (Open)](/task/spec-task)",
                    new: "[Spec task (Open, active)](/task/spec-task)",
                    replaceAll: false,
                },
            ],
        }),
    ).resolves.toEqual("Update was successful.\n");

    expect(getTaskPatchRequests().map(request => request.body)).toEqual([
        {patches: [{type: "SetStatus", status: {type: "Open", isActive: true}}]},
    ]);
});

test("sets an open task as active while assigning it", async () => {
    await readTaskCollectionPage();
    mockTaskPatch(specTaskId);

    await expect(
        callAgentWebUpdateTool(context, {
            path: "/task-collection/roadmap",
            updates: [
                {
                    old: "- [Spec task (Open)](/task/spec-task)",
                    new:
                        "- [Spec task (Open, active)](/task/spec-task)\n" +
                        "  - Assignee: [Alice](/human/alice)",
                    replaceAll: false,
                },
            ],
        }),
    ).resolves.toEqual("Update was successful.\n");

    expect(getTaskPatchRequests().map(request => request.body)).toEqual([
        {
            patches: [
                {type: "SetStatus", status: {type: "Open", isActive: true}},
                {type: "SetAssignee", assignee: aliceReference},
            ],
        },
    ]);
});

test("rejects setting an unassigned open task as active", async () => {
    await readTaskCollectionPage();

    await expectInvalidUpdateDisplayMessage({
        updates: [
            {
                old: "[Spec task (Open)](/task/spec-task)",
                new: "[Spec task (Open, active)](/task/spec-task)",
                replaceAll: false,
            },
        ],
        expected:
            "Can\u2019t set \u201CSpec task\u201D task as active if there\u2019s no assignee. We don\u2019t " +
            "recommend setting a task as active unless you\u2019re about to work on the task or " +
            "you know someone else is currently working on the task. Try again and either " +
            "set the task as open but inactive (e.g. `(Open)`) or set an assignee " +
            "(e.g. `- Assignee: [ChatGPT](/bot/chatgpt)`).",
    });
});

test("preserves active status when updating a task title in its link label", async () => {
    mockGetCollectionTasks({
        specTaskStatus: {type: "Open", isActive: true},
        specTaskAssignee: aliceReference,
    });
    await callAgentWebReadTool(context, {
        path: "/task-collection/roadmap",
        limit: "10kb",
    });
    mockTaskPatch(specTaskId);

    await expect(
        callAgentWebUpdateTool(context, {
            path: "/task-collection/roadmap",
            updates: [
                {
                    old: "[Spec task (Open, active)](/task/spec-task)",
                    new: "[Renamed spec task (Open, active)](/task/spec-task)",
                    replaceAll: false,
                },
            ],
        }),
    ).resolves.toEqual("Update was successful.\n");

    expect(getTaskPatchRequests().map(request => request.body)).toEqual([
        {patches: [{type: "SetTitle", title: "Renamed spec task"}]},
    ]);
});

test("sets an active task as inactive", async () => {
    mockGetCollectionTasks({
        specTaskStatus: {type: "Open", isActive: true},
        specTaskAssignee: aliceReference,
    });
    await callAgentWebReadTool(context, {
        path: "/task-collection/roadmap",
        limit: "10kb",
    });
    mockTaskPatch(specTaskId);

    await expect(
        callAgentWebUpdateTool(context, {
            path: "/task-collection/roadmap",
            updates: [
                {
                    old: "[Spec task (Open, active)](/task/spec-task)",
                    new: "[Spec task (Open, inactive)](/task/spec-task)",
                    replaceAll: false,
                },
            ],
        }),
    ).resolves.toEqual("Update was successful.\n");

    expect(getTaskPatchRequests().map(request => request.body)).toEqual([
        {patches: [{type: "SetStatus", status: {type: "Open", isActive: false}}]},
    ]);
});

test("rejects removing the assignee from an active task", async () => {
    mockGetCollectionTasks({
        specTaskStatus: {type: "Open", isActive: true},
        specTaskAssignee: aliceReference,
    });
    await callAgentWebReadTool(context, {
        path: "/task-collection/roadmap",
        limit: "10kb",
    });

    await expectInvalidUpdateDisplayMessage({
        updates: [
            {
                old: "\n  - Assignee: [Alice](/human/alice)",
                new: "",
                replaceAll: false,
            },
        ],
        expected:
            "Can\u2019t remove the assignee from the active \u201CSpec task\u201D task. An active task " +
            "implies someone is currently working on the task and so an assignee is required " +
            "so we know who that is. Try again but set the task as inactive first (e.g. " +
            "`(Open)`).",
    });
});

test("changes the assignee of an active task", async () => {
    mockGetCollectionTasks({
        specTaskStatus: {type: "Open", isActive: true},
        specTaskAssignee: aliceReference,
    });
    await callAgentWebReadTool(context, {
        path: "/task-collection/roadmap",
        limit: "10kb",
    });
    mockTaskPatch(specTaskId);

    await expect(
        callAgentWebUpdateTool(context, {
            path: "/task-collection/roadmap",
            updates: [
                {
                    old: "[Alice](/human/alice)",
                    new: "[Bob](/human/bob)",
                    replaceAll: false,
                },
            ],
        }),
    ).resolves.toEqual("Update was successful.\n");

    expect(getTaskPatchRequests().map(request => request.body)).toEqual([
        {patches: [{type: "SetAssignee", assignee: bobReference}]},
    ]);
});

test("sets an active task as inactive while removing its assignee", async () => {
    mockGetCollectionTasks({
        specTaskStatus: {type: "Open", isActive: true},
        specTaskAssignee: aliceReference,
    });
    await callAgentWebReadTool(context, {
        path: "/task-collection/roadmap",
        limit: "10kb",
    });
    mockTaskPatch(specTaskId);

    await expect(
        callAgentWebUpdateTool(context, {
            path: "/task-collection/roadmap",
            updates: [
                {
                    old:
                        "- [Spec task (Open, active)](/task/spec-task)\n" +
                        "  - Assignee: [Alice](/human/alice)",
                    new: "- [Spec task (Open, inactive)](/task/spec-task)",
                    replaceAll: false,
                },
            ],
        }),
    ).resolves.toEqual("Update was successful.\n");

    expect(getTaskPatchRequests().map(request => request.body)).toEqual([
        {
            patches: [
                {type: "SetStatus", status: {type: "Open", isActive: false}},
                {type: "SetAssignee", assignee: null},
            ],
        },
    ]);
});

test("reopens a task as inactive from its link label", async () => {
    mockGetCollectionTasks({specTaskStatus: {type: "Closed"}});
    await callAgentWebReadTool(context, {
        path: "/task-collection/roadmap",
        limit: "10kb",
    });
    mockTaskPatch(specTaskId);

    await expect(
        callAgentWebUpdateTool(context, {
            path: "/task-collection/roadmap",
            updates: [
                {
                    old: "[Spec task (Closed)](/task/spec-task)",
                    new: "[Spec task (Open)](/task/spec-task)",
                    replaceAll: false,
                },
            ],
        }),
    ).resolves.toEqual("Update was successful.\n");

    expect(getTaskPatchRequests().map(request => request.body)).toEqual([
        {patches: [{type: "SetStatus", status: {type: "Open", isActive: false}}]},
    ]);
});

test("updates task fields", async () => {
    await readTaskCollectionPage();
    mockTaskPatch(launchTaskId);

    await expect(
        callAgentWebUpdateTool(context, {
            path: "/task-collection/roadmap",
            updates: [
                {
                    old: "- [Launch task (Open)](/task/launch-task)",
                    new:
                        "- [Launch task (Open)](/task/launch-task)\n" +
                        "  - Parent: [Other task](/task/other-task)\n" +
                        "  - Assignee: [Alice](/human/alice)\n" +
                        "  - Collections: [Other collection](/task-collection/other-collection)\n" +
                        "  - Priority: High\n" +
                        "  - Due date: July 12, 2027",
                    replaceAll: false,
                },
            ],
        }),
    ).resolves.toEqual("Update was successful.\n");

    expect(getTaskPatchRequests().map(request => request.body)).toEqual([
        {
            patches: [
                {type: "SetParent", parent: {task: {id: otherTaskId}}},
                {type: "SetAssignee", assignee: aliceReference},
                {type: "SetDue", due: {date: "2027-07-12"}},
                {type: "SetPriority", priority: {type: "High"}},
                {type: "AddCollection", item: {collection: otherCollectionReference}},
            ],
        },
    ]);
});

test("updates only a task parent while leaving its other fields unchanged", async () => {
    await readTaskCollectionPageWithPopulatedSpecTask();
    await updateSpecTaskField({
        old: "Parent: [Other task](/task/other-task)",
        new: "Parent: [Launch task](/task/launch-task)",
    });

    expect(getTaskPatchRequests().map(request => request.body)).toEqual([
        {patches: [{type: "SetParent", parent: {task: {id: launchTaskId}}}]},
    ]);
});

test("updates only a task assignee while leaving its other fields unchanged", async () => {
    await readTaskCollectionPageWithPopulatedSpecTask();
    await updateSpecTaskField({
        old: "Assignee: [Alice](/human/alice)",
        new: "Assignee: [Bob](/human/bob)",
    });

    expect(getTaskPatchRequests().map(request => request.body)).toEqual([
        {patches: [{type: "SetAssignee", assignee: bobReference}]},
    ]);
});

test("updates only a task due date while leaving its other fields unchanged", async () => {
    await readTaskCollectionPageWithPopulatedSpecTask();
    await updateSpecTaskField({
        old: "Due date: July 12th, 2027",
        new: "Due date: July 14th, 2027",
    });

    expect(getTaskPatchRequests().map(request => request.body)).toEqual([
        {patches: [{type: "SetDue", due: {date: "2027-07-14"}}]},
    ]);
});

test("updates only a task priority while leaving its other fields unchanged", async () => {
    await readTaskCollectionPageWithPopulatedSpecTask();
    await updateSpecTaskField({old: "Priority: High", new: "Priority: Low"});

    expect(getTaskPatchRequests().map(request => request.body)).toEqual([
        {patches: [{type: "SetPriority", priority: {type: "Low"}}]},
    ]);
});

test("updates only task collections while leaving its other fields unchanged", async () => {
    await readTaskCollectionPageWithPopulatedSpecTask();
    await updateSpecTaskField({
        old: "Collections: [Other collection](/task-collection/other-collection)",
        new:
            "Collections: [Other collection](/task-collection/other-collection), " +
            "[Design](/task-collection/design)",
    });

    expect(getTaskPatchRequests().map(request => request.body)).toEqual([
        {
            patches: [{type: "AddCollection", item: {collection: designCollectionReference}}],
        },
    ]);
});

test("rejects updating task subtask counts", async () => {
    mockGetCollectionTasks({
        specTaskSubtasks: {openTaskCount: 3, closedTaskCount: 4},
    });
    await callAgentWebReadTool(context, {
        path: "/task-collection/roadmap",
        limit: "10kb",
    });

    await expectInvalidUpdateDisplayMessage({
        updates: [
            {
                old: "Subtasks: 3 open, 4 closed",
                new: "Subtasks: 2 open, 5 closed",
                replaceAll: false,
            },
        ],
        expected:
            "Can\u2019t change the \u201CSpec task\u201D task\u2019s subtasks by updating " +
            "\u201CSubtasks: 3 open, 4 closed\u201D to \u201CSubtasks: 2 open, 5 closed\u201D since we don\u2019t " +
            "know which underlying subtasks you\u2019re trying to add, remove, open, or close. " +
            "Try again with an update that leaves the `Subtasks` field unchanged.",
    });
});

test("removes a task from a manually ordered collection", async () => {
    await readTaskCollectionPage();
    mockTaskPatch(specTaskId);

    await expect(
        callAgentWebUpdateTool(context, {
            path: "/task-collection/roadmap",
            updates: [
                {
                    old: "\n\n- [Spec task (Open)](/task/spec-task)",
                    new: "",
                    replaceAll: false,
                },
            ],
        }),
    ).resolves.toEqual("Update was successful.\n");

    expect(getTaskPatchRequests().map(request => request.body)).toEqual([
        {patches: [{type: "RemoveCollection", collectionId}]},
    ]);
});

test("adds a task at the end of a manually ordered collection", async () => {
    await readTaskCollectionPage();
    mockTaskPatch(otherTaskId);

    await expect(
        callAgentWebUpdateTool(context, {
            path: "/task-collection/roadmap",
            updates: [
                {
                    old: "- [Spec task (Open)](/task/spec-task)",
                    new:
                        "- [Spec task (Open)](/task/spec-task)\n\n" +
                        "- [Other task (Open)](/task/other-task)",
                    replaceAll: false,
                },
            ],
        }),
    ).resolves.toEqual("Update was successful.\n");

    expect(getTaskPatchRequests().map(request => request.body)).toEqual([
        {
            patches: [
                {
                    type: "AddCollection",
                    item: {
                        collection: {
                            type: "TaskCollection",
                            id: collectionId,
                            title: "Roadmap",
                        },
                    },
                },
                {
                    type: "MoveInCollection",
                    collectionId,
                    position: {type: "End"},
                },
            ],
        },
    ]);
});

test("adds a task at the start of a manually ordered collection", async () => {
    await readTaskCollectionPage();
    mockTaskPatch(otherTaskId);

    await expect(
        callAgentWebUpdateTool(context, {
            path: "/task-collection/roadmap",
            updates: [
                {
                    old: "- [Launch task (Open)](/task/launch-task)",
                    new:
                        "- [Other task (Open)](/task/other-task)\n\n" +
                        "- [Launch task (Open)](/task/launch-task)",
                    replaceAll: false,
                },
            ],
        }),
    ).resolves.toEqual("Update was successful.\n");

    expect(getTaskPatchRequests().map(request => request.body)).toEqual([
        {
            patches: [
                {
                    type: "AddCollection",
                    item: {
                        collection: {
                            type: "TaskCollection",
                            id: collectionId,
                            title: "Roadmap",
                        },
                    },
                },
                {
                    type: "MoveInCollection",
                    collectionId,
                    position: {type: "Start"},
                },
            ],
        },
    ]);
});

test("moves a task to the end of a manually ordered collection", async () => {
    await readTaskCollectionPage();
    mockTaskPatch(launchTaskId);

    await expect(
        callAgentWebUpdateTool(context, {
            path: "/task-collection/roadmap",
            updates: [
                {
                    old: "- [Launch task (Open)](/task/launch-task)\n\n- [Spec task (Open)](/task/spec-task)",
                    new: "- [Spec task (Open)](/task/spec-task)\n\n- [Launch task (Open)](/task/launch-task)",
                    replaceAll: false,
                },
            ],
        }),
    ).resolves.toEqual("Update was successful.\n");

    expect(getTaskPatchRequests().map(request => request.body)).toEqual([
        {
            patches: [
                {
                    type: "MoveInCollection",
                    collectionId,
                    position: {type: "End"},
                },
            ],
        },
    ]);
});

test("moves a task to the start of a manually ordered tail page", async () => {
    const afterCursor = "page-after-cursor" as ApiTaskQueryCursor;
    const path = await createTaskCollectionTailPagePath(afterCursor);
    mockGetCollectionTasks({cursor: afterCursor, includeOtherTask: true});
    await callAgentWebReadTool(context, {path, limit: "10kb"});
    mockTaskPatch(otherTaskId);

    await expect(
        callAgentWebUpdateTool(context, {
            path,
            updates: [
                {
                    old:
                        "- [Launch task (Open)](/task/launch-task)\n\n" +
                        "- [Spec task (Open)](/task/spec-task)\n\n" +
                        "- [Other task (Open)](/task/other-task)",
                    new:
                        "- [Other task (Open)](/task/other-task)\n\n" +
                        "- [Launch task (Open)](/task/launch-task)\n\n" +
                        "- [Spec task (Open)](/task/spec-task)",
                    replaceAll: false,
                },
            ],
        }),
    ).resolves.toEqual("Update was successful.\n");

    expect(getTaskPatchRequests().map(request => request.body)).toEqual([
        {
            patches: [
                {
                    type: "MoveInCollection",
                    collectionId,
                    position: {
                        type: "Between",
                        afterCursor,
                        beforeCursor: "task-cursor-0",
                    },
                },
            ],
        },
    ]);
});

test("moves a task to the end of a manually ordered tail page", async () => {
    const afterCursor = "page-after-cursor" as ApiTaskQueryCursor;
    const path = await createTaskCollectionTailPagePath(afterCursor);
    mockGetCollectionTasks({cursor: afterCursor});
    await callAgentWebReadTool(context, {path, limit: "10kb"});
    mockTaskPatch(launchTaskId);

    await expect(
        callAgentWebUpdateTool(context, {
            path,
            updates: [
                {
                    old: "- [Launch task (Open)](/task/launch-task)\n\n- [Spec task (Open)](/task/spec-task)",
                    new: "- [Spec task (Open)](/task/spec-task)\n\n- [Launch task (Open)](/task/launch-task)",
                    replaceAll: false,
                },
            ],
        }),
    ).resolves.toEqual("Update was successful.\n");

    expect(getTaskPatchRequests().map(request => request.body)).toEqual([
        {
            patches: [
                {
                    type: "MoveInCollection",
                    collectionId,
                    position: {type: "End"},
                },
            ],
        },
    ]);
});

test("moves a task to the end of a truncated manually ordered page", async () => {
    mockGetCollectionTasks({
        includeOtherTask: true,
        otherTaskTitle: "X".repeat(160),
    });
    const response = await callAgentWebReadTool(context, {
        path: "/task-collection/roadmap",
        limit: "230b",
    });

    expect(response).toContain("- [Spec task (Open)](/task/spec-task)");
    expect(response).not.toContain("X".repeat(160));

    mockTaskPatch(launchTaskId);

    await expect(
        callAgentWebUpdateTool(context, {
            path: "/task-collection/roadmap",
            updates: [
                {
                    old: "- [Launch task (Open)](/task/launch-task)\n\n- [Spec task (Open)](/task/spec-task)",
                    new: "- [Spec task (Open)](/task/spec-task)\n\n- [Launch task (Open)](/task/launch-task)",
                    replaceAll: false,
                },
            ],
        }),
    ).resolves.toEqual("Update was successful.\n");

    expect(getTaskPatchRequests().map(request => request.body)).toEqual([
        {
            patches: [
                {
                    type: "MoveInCollection",
                    collectionId,
                    position: {
                        type: "Between",
                        afterCursor: "task-cursor-1",
                        beforeCursor: "task-cursor-2",
                    },
                },
            ],
        },
    ]);
});

test("atomically moves tasks with the same position in page order", async () => {
    mockGetCollectionTasks({
        includeOtherTask: true,
        additionalTasks: [reviewTaskReference],
    });
    await callAgentWebReadTool(context, {
        path: "/task-collection/roadmap",
        limit: "10kb",
    });
    mockTaskPatch(launchTaskId, specTaskId);

    await expect(
        callAgentWebUpdateTool(context, {
            path: "/task-collection/roadmap",
            updates: [
                {
                    old:
                        "- [Launch task (Open)](/task/launch-task)\n\n" +
                        "- [Spec task (Open)](/task/spec-task)\n\n" +
                        "- [Other task (Open)](/task/other-task)\n\n" +
                        "- [Review task (Open)](/task/review-task)",
                    new:
                        "- [Other task (Open)](/task/other-task)\n\n" +
                        "- [Review task (Open)](/task/review-task)\n\n" +
                        "- [Launch task (Open)](/task/launch-task)\n\n" +
                        "- [Spec task (Open)](/task/spec-task)",
                    replaceAll: false,
                },
            ],
        }),
    ).resolves.toEqual("Update was successful.\n");

    expect({
        batchRequestBodies: getBatchTaskPatchRequests().map(request => request.body),
        individualRequestCount: api
            .getRequestHistory()
            .filter(request => request.path === "/tasks/{id}").length,
    }).toEqual({
        batchRequestBodies: [
            {
                spaceId,
                patches: [
                    {
                        id: launchTaskId,
                        patch: {
                            type: "MoveInCollection",
                            collectionId,
                            position: {type: "End"},
                        },
                    },
                    {
                        id: specTaskId,
                        patch: {
                            type: "MoveInCollection",
                            collectionId,
                            position: {type: "End"},
                        },
                    },
                ],
            },
        ],
        individualRequestCount: 0,
    });
});

test("moves only task 4 when moving it after task 8", async () => {
    mockGetCollectionTasks({
        launchTaskTitle: "Task 1",
        specTaskTitle: "Task 2",
        additionalTasks: [
            {...otherTaskReference, title: "Task 3"},
            {...reviewTaskReference, title: "Task 4"},
            {...qaTaskReference, title: "Task 5"},
            task6Reference,
            task7Reference,
            task8Reference,
        ],
    });
    const response = await callAgentWebReadTool(context, {
        path: "/task-collection/roadmap",
        limit: "10kb",
    });
    mockTaskPatch(reviewTaskId);

    const taskListItems = response.split("\n").filter(line => line.startsWith("- [Task "));
    if (taskListItems.length !== 8) throw new InternalError("Expected eight task list items");

    await expect(
        callAgentWebUpdateTool(context, {
            path: "/task-collection/roadmap",
            updates: [
                {
                    old: `${taskListItems[3]!}\n\n`,
                    new: "",
                    replaceAll: false,
                },
                {
                    old: taskListItems[7]!,
                    new: `${taskListItems[7]!}\n\n${taskListItems[3]!}`,
                    replaceAll: false,
                },
            ],
        }),
    ).resolves.toEqual("Update was successful.\n");

    expect(getBatchTaskPatchRequests().map(request => request.body)).toEqual([
        {
            spaceId,
            patches: [
                {
                    id: reviewTaskId,
                    patch: {
                        type: "MoveInCollection",
                        collectionId,
                        position: {type: "End"},
                    },
                },
            ],
        },
    ]);
});

test("uses a moved cursor in a later task move", async () => {
    mockGetCollectionTasks({
        includeOtherTask: true,
        additionalTasks: [reviewTaskReference, qaTaskReference],
    });
    await callAgentWebReadTool(context, {
        path: "/task-collection/roadmap",
        limit: "10kb",
    });
    mockTaskPatch(specTaskId);

    const initialTaskList =
        "- [Launch task (Open)](/task/launch-task)\n\n" +
        "- [Spec task (Open)](/task/spec-task)\n\n" +
        "- [Other task (Open)](/task/other-task)\n\n" +
        "- [Review task (Open)](/task/review-task)\n\n" +
        "- [QA task (Open)](/task/qa-task)";
    const taskListAfterFirstMove =
        "- [Launch task (Open)](/task/launch-task)\n\n" +
        "- [Other task (Open)](/task/other-task)\n\n" +
        "- [Review task (Open)](/task/review-task)\n\n" +
        "- [QA task (Open)](/task/qa-task)\n\n" +
        "- [Spec task (Open)](/task/spec-task)";

    await callAgentWebUpdateTool(context, {
        path: "/task-collection/roadmap",
        updates: [{old: initialTaskList, new: taskListAfterFirstMove, replaceAll: false}],
    });

    mockTaskPatch(launchTaskId);

    await expect(
        callAgentWebUpdateTool(context, {
            path: "/task-collection/roadmap",
            updates: [
                {
                    old: taskListAfterFirstMove,
                    new:
                        "- [Other task (Open)](/task/other-task)\n\n" +
                        "- [Review task (Open)](/task/review-task)\n\n" +
                        "- [QA task (Open)](/task/qa-task)\n\n" +
                        "- [Launch task (Open)](/task/launch-task)\n\n" +
                        "- [Spec task (Open)](/task/spec-task)",
                    replaceAll: false,
                },
            ],
        }),
    ).resolves.toEqual("Update was successful.\n");

    expect(getBatchTaskPatchRequests().map(request => request.body)).toEqual([
        {
            spaceId,
            patches: [
                {
                    id: specTaskId,
                    patch: {
                        type: "MoveInCollection",
                        collectionId,
                        position: {type: "End"},
                    },
                },
            ],
        },
        {
            spaceId,
            patches: [
                {
                    id: launchTaskId,
                    patch: {
                        type: "MoveInCollection",
                        collectionId,
                        position: {
                            type: "Between",
                            afterCursor: "task-cursor-4",
                            beforeCursor: createMovedTaskCursor(specTaskId),
                        },
                    },
                },
            ],
        },
    ]);
});

const roadmapDefaults: ApiTaskQueryDefaultsResponse = {
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
};

test("rejects removing a task from a collection with default filters and sorts", async () => {
    await readTaskCollectionPage({defaults: roadmapDefaults});

    await expectInvalidUpdateDisplayMessage({
        updates: [
            {
                old: "\n\n- [Spec task (Open)](/task/spec-task)",
                new: "",
                replaceAll: false,
            },
        ],
        expected:
            "Tasks may only be added, removed, or reordered on a manually ordered " +
            "collection page. A collection is manually ordered when the page URL has no " +
            "sorts and the collection has no default filters or sorts. Try again on a " +
            "manually ordered collection page.",
    });
});

test("rejects removing a task from a collection page with URL sorts", async () => {
    const path = "/task-collection/roadmap?sort=created";
    mockQueryCollectionTasks();
    await callAgentWebReadTool(context, {path, limit: "10kb"});

    await expectInvalidUpdateDisplayMessage({
        path,
        updates: [
            {
                old: "\n\n- [Spec task (Open)](/task/spec-task)",
                new: "",
                replaceAll: false,
            },
        ],
        expected:
            "Tasks may only be added, removed, or reordered on a manually ordered " +
            "collection page. A collection is manually ordered when the page URL has no " +
            "sorts and the collection has no default filters or sorts. Try again on a " +
            "manually ordered collection page.",
    });
});

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
            "`open-inactive`, `open-active`, or `closed` (e.g. `status=open` or " +
            "`status[not]=closed`).",
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
            "Couldn\u2019t find a task for the link \u201CMissing task\u201D on line 7. You may only " +
            "add a task you\u2019ve previously seen to a collection. Try calling the `create` " +
            "tool to create a new task and then add that new task to the collection, or " +
            "try calling the `search` tool to find an existing task you want to add to " +
            "the collection.",
    });
});

test("rejects replacing a task link path with a duplicate task", async () => {
    await readTaskCollectionPage();

    await expectInvalidUpdateDisplayMessage({
        updates: [
            {
                old:
                    "- [Launch task (Open)](/task/launch-task)\n\n" +
                    "- [Spec task (Open)](/task/spec-task)\n\n" +
                    "End of tasks.",
                new:
                    "- [Launch task (Open)](/task/spec-task)\n\n" +
                    "- [Spec task (Open)](/task/spec-task)",
                replaceAll: false,
            },
        ],
        expected:
            "The \u201CSpec task\u201D task appears more than once on this task collection page. " +
            "Each task may only appear once. Try again after removing the duplicate task " +
            "link.",
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

test("makes no API calls when removing the end of tasks marker", async () => {
    await readTaskCollectionPage();

    await expect(
        callAgentWebUpdateTool(context, {
            path: "/task-collection/roadmap",
            updates: [{old: "\n\nEnd of tasks.", new: "", replaceAll: false}],
        }),
    ).resolves.toEqual("Update was successful.\n");

    expect(getCollectionPatchRequests()).toHaveLength(0);
});

test("rejects changing the next page link cursor", async () => {
    const nextCursor = "task-cursor-next" as ApiTaskQueryCursor;
    const response = await readTaskCollectionPage({nextCursor, limit: "100b"});
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
    const response = await readTaskCollectionPage({nextCursor, limit: "100b"});
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
    await readTaskCollectionPage({nextCursor, limit: "100b"});

    await expectInvalidUpdateDisplayMessage({
        updates: [
            {
                old: "- [Launch task (Open)](/task/launch-task)",
                new: "- [Launch task (Open)](/task/launch-task)\n\nEnd of tasks.",
                replaceAll: false,
            },
        ],
        expected:
            "Can\u2019t add the \u201CEnd of tasks\u201D marker in an update. Only a `read` tool " +
            "call can tell you whether you\u2019re at the end of a task list or not. Try " +
            "again without adding the \u201CEnd of tasks\u201D marker.",
    });
});

test("rejects renaming the task collection on a later page", async () => {
    const nextCursor = "task-cursor-next" as ApiTaskQueryCursor;
    const response = await readTaskCollectionPage({nextCursor, limit: "100b"});
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
