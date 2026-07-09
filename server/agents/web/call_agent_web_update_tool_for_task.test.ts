import {ApiClientMock} from "~/server/agents/api/test_helpers/api_client_mock.js";
import {createApiAccountMock} from "~/server/agents/api/test_helpers/create_api_account_mock.js";
import {AgentWebContext} from "~/server/agents/web/agent_web_context.js";
import {callAgentWebReadTool} from "~/server/agents/web/call_agent_web_read_tool.js";
import {callAgentWebUpdateTool} from "~/server/agents/web/call_agent_web_update_tool.js";
import {createAgentWebPageStoredLinkPathname} from "~/server/agents/web/create_agent_web_page_stored_link_pathname.js";
import {createAgentWebSessionStorageForTest} from "~/server/agents/web/test_helpers/create_agent_web_session_storage_for_test.js";
import {addKeysToApiContentForTest} from "~/shared/api/content/test_helpers/add_keys_to_api_content_for_test.js";
import {intoApiAccountReference} from "~/shared/api/specification/into_api_account_reference.js";
import {ApiContentResponseWithoutKeys} from "~/shared/api/specification/types/api_content_response_without_keys.js";
import {ApiTaskResponse} from "~/shared/api/specification/types/api_specification_convenience_types.js";
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
const bobAccount = createApiAccountMock({name: "Bob"});
const parentTaskId = generateId<TaskId>();
const otherParentTaskId = generateId<TaskId>();
const parentTaskReference = {
    type: "Task" as const,
    id: parentTaskId,
    title: "Parent task",
    status: {type: "Open" as const, isActive: false},
};
const otherParentTaskReference = {
    type: "Task" as const,
    id: otherParentTaskId,
    title: "Other parent task",
    status: {type: "Closed" as const},
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

const emptyNotesContent: ApiContentResponseWithoutKeys = {
    elements: [{type: "Paragraph", elements: []}],
};

beforeEach(async () => {
    await createAgentWebPageStoredLinkPathname(storage, intoApiAccountReference(aliceAccount));
    await createAgentWebPageStoredLinkPathname(storage, intoApiAccountReference(bobAccount));
    await createAgentWebPageStoredLinkPathname(storage, parentTaskReference);
    await createAgentWebPageStoredLinkPathname(storage, otherParentTaskReference);
    await createAgentWebPageStoredLinkPathname(storage, engineeringCollectionReference);
    await createAgentWebPageStoredLinkPathname(storage, roadmapCollectionReference);
});

function mockTaskPatch(taskId: TaskId, count = 1) {
    for (let i = 0; i < count; i++) {
        api.mockPatch("/tasks/{id}", {
            params: {path: {id: taskId}},
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
        });
    }
}

function mockTaskNotesPatch({
    taskId,
    version,
    content,
}: {
    taskId: TaskId;
    version: number;
    content: ApiContentResponseWithoutKeys;
}) {
    api.mockPatch("/tasks/{id}/notes", {
        params: {path: {id: taskId}},
        data: {
            spaceId,
            notes: {
                version,
                content: addKeysToApiContentForTest(content),
            },
        },
    });
}

function getTaskPatchRequests() {
    return api
        .getRequestHistory()
        .filter(request => request.method === "PATCH" && request.path === "/tasks/{id}");
}

function getTaskNotesPatchRequests() {
    return api
        .getRequestHistory()
        .filter(request => request.method === "PATCH" && request.path === "/tasks/{id}/notes");
}

function mockGetTask(
    api: ApiClientMock,
    spaceId: SpaceId,
    taskId: TaskId,
    responseData: Omit<ApiTaskResponse, "id">,
): void {
    api.mockGet("/tasks/{id}", {
        params: {path: {id: taskId}},
        data: {
            spaceId,
            task: {
                id: taskId,
                ...responseData,
            },
        },
    });
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
    parent,
    assignee,
    collectionIds = [],
    priority,
    due,
    notesVersion = 0,
    notesContent = emptyNotesContent,
}: {
    taskId?: TaskId;
    title: string;
    status?: {readonly type: "Open"; readonly isActive: boolean} | {readonly type: "Closed"};
    parent?: typeof parentTaskReference | typeof otherParentTaskReference;
    assignee?: typeof aliceAccount;
    collectionIds?: ReadonlyArray<TaskCollectionId>;
    priority?: {readonly type: "Low" | "Medium" | "High" | "Urgent"};
    due?: {readonly date: string};
    notesVersion?: number;
    notesContent?: ApiContentResponseWithoutKeys;
}): Promise<{taskId: TaskId; path: string}> {
    const path = await createAgentWebPageStoredLinkPathname(storage, {
        type: "Task",
        id: taskId,
        title,
        status,
    });

    mockGetTask(api, spaceId, taskId, {
        title,
        status,
        ...(parent
            ? {
                  parent: {
                      task: {
                          id: parent.id,
                          title: parent.title,
                          status: parent.status,
                      },
                  },
              }
            : {}),
        ...(assignee ? {assignee} : {}),
        collections: collectionIds.map(collectionId => ({
            collection: {
                id: collectionId,
                name: collectionId === engineeringCollectionId ? "Engineering" : "Roadmap",
            },
        })),
        ...(priority ? {priority} : {}),
        ...(due ? {due} : {}),
        notes: {
            version: notesVersion,
            content: addKeysToApiContentForTest(notesContent, {
                entityId: `Task:${taskId}`,
                version: notesVersion,
            }),
        },
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

test("adds task notes", async () => {
    const {taskId, path} = await readTask({
        title: "Notes task",
        notesVersion: 4,
    });
    const notesContent: ApiContentResponseWithoutKeys = {
        elements: [
            {
                type: "Paragraph",
                elements: [{type: "Text", text: "Write release notes."}],
            },
        ],
    };
    mockTaskNotesPatch({taskId, version: 5, content: notesContent});

    await expect(
        callAgentWebUpdateTool(context, {
            path,
            updates: [
                {
                    old: "- Status: Open",
                    new: "- Status: Open\n\n## Notes\n\nWrite release notes.",
                    replaceAll: false,
                },
            ],
        }),
    ).resolves.toEqual("Update was successful.\n");

    expect({
        taskPatches: getTaskPatchRequests().map(request => request.body),
        notesPatches: getTaskNotesPatchRequests().map(request => request.body),
    }).toEqual({
        taskPatches: [],
        notesPatches: [{notes: {version: 4, content: notesContent}}],
    });
});

test("adds task notes with heading", async () => {
    const {taskId, path} = await readTask({title: "Notes heading task"});
    const notesContent: ApiContentResponseWithoutKeys = {
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
    };
    mockTaskNotesPatch({taskId, version: 1, content: notesContent});

    await expect(
        callAgentWebUpdateTool(context, {
            path,
            updates: [
                {
                    old: "- Status: Open",
                    new: "- Status: Open\n\n## Notes\n\n### Context\n\nBring logs.",
                    replaceAll: false,
                },
            ],
        }),
    ).resolves.toEqual("Update was successful.\n");

    expect(getTaskNotesPatchRequests().map(request => request.body)).toEqual([
        {notes: {version: 0, content: notesContent}},
    ]);
});

test("clears task notes after reading task with notes set", async () => {
    const oldNotesContent: ApiContentResponseWithoutKeys = {
        elements: [
            {
                type: "Paragraph",
                elements: [{type: "Text", text: "Old notes."}],
            },
        ],
    };
    const {taskId, path} = await readTask({
        title: "Notes task",
        notesVersion: 6,
        notesContent: oldNotesContent,
    });
    mockTaskNotesPatch({taskId, version: 7, content: emptyNotesContent});

    await expect(
        callAgentWebUpdateTool(context, {
            path,
            updates: [{old: "\n\n## Notes\n\nOld notes.", new: "", replaceAll: false}],
        }),
    ).resolves.toEqual("Update was successful.\n");

    expect(getTaskNotesPatchRequests().map(request => request.body)).toEqual([
        {notes: {version: 6, content: emptyNotesContent}},
    ]);
});

test("changes task notes after reading task with notes set", async () => {
    const oldNotesContent: ApiContentResponseWithoutKeys = {
        elements: [
            {
                type: "Paragraph",
                elements: [{type: "Text", text: "Old notes."}],
            },
        ],
    };
    const newNotesContent: ApiContentResponseWithoutKeys = {
        elements: [
            {
                type: "Paragraph",
                elements: [{type: "Text", text: "New notes."}],
            },
        ],
    };
    const {taskId, path} = await readTask({
        title: "Notes task",
        notesVersion: 10,
        notesContent: oldNotesContent,
    });
    mockTaskNotesPatch({taskId, version: 11, content: newNotesContent});

    await expect(
        callAgentWebUpdateTool(context, {
            path,
            updates: [{old: "Old notes.", new: "New notes.", replaceAll: false}],
        }),
    ).resolves.toEqual("Update was successful.\n");

    expect(getTaskNotesPatchRequests().map(request => request.body)).toEqual([
        {notes: {version: 10, content: newNotesContent}},
    ]);
});

test("updates task fields and notes", async () => {
    const {taskId, path} = await readTask({title: "Mixed task"});
    const notesContent: ApiContentResponseWithoutKeys = {
        elements: [
            {
                type: "Paragraph",
                elements: [{type: "Text", text: "Closed after QA."}],
            },
        ],
    };
    mockTaskPatch(taskId);
    mockTaskNotesPatch({taskId, version: 1, content: notesContent});

    await expect(
        callAgentWebUpdateTool(context, {
            path,
            updates: [
                {
                    old: "- Status: Open",
                    new: "- Status: Closed\n\n## Notes\n\nClosed after QA.",
                    replaceAll: false,
                },
            ],
        }),
    ).resolves.toEqual("Update was successful.\n");

    expect({
        taskPatches: getTaskPatchRequests().map(request => request.body),
        notesPatches: getTaskNotesPatchRequests().map(request => request.body),
    }).toEqual({
        taskPatches: [{patches: [{type: "SetStatus", status: {type: "Closed"}}]}],
        notesPatches: [{notes: {version: 0, content: notesContent}}],
    });
});

test("updates task status to active and closed", async () => {
    const {taskId, path} = await readTask({
        title: "Status task",
        assignee: aliceAccount,
    });
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

test("updates task status to explicit inactive open", async () => {
    const {taskId, path} = await readTask({
        title: "Status task",
        status: {type: "Closed"},
    });
    mockTaskPatch(taskId);

    await expect(
        callAgentWebUpdateTool(context, {
            path,
            updates: [
                {
                    old: "- Status: Closed",
                    new: "- Status: Open (Inactive)",
                    replaceAll: false,
                },
            ],
        }),
    ).resolves.toEqual("Update was successful.\n");

    expect(getTaskPatchRequests().map(request => request.body)).toEqual([
        {patches: [{type: "SetStatus", status: {type: "Open", isActive: false}}]},
    ]);
});

test("removes task status after reading task with status set", async () => {
    const {taskId, path} = await readTask({
        title: "Status task",
        status: {type: "Closed"},
    });
    mockTaskPatch(taskId);

    await expect(
        callAgentWebUpdateTool(context, {
            path,
            updates: [{old: "- Status: Closed", new: "", replaceAll: false}],
        }),
    ).resolves.toEqual("Update was successful.\n");

    expect(getTaskPatchRequests().map(request => request.body)).toEqual([
        {patches: [{type: "SetStatus", status: {type: "Open", isActive: false}}]},
    ]);
});

test("changes task status after reading task with status set", async () => {
    const {taskId, path} = await readTask({
        title: "Status task",
        status: {type: "Closed"},
        assignee: aliceAccount,
    });
    mockTaskPatch(taskId);

    await expect(
        callAgentWebUpdateTool(context, {
            path,
            updates: [
                {
                    old: "- Status: Closed",
                    new: "- Status: Open (Active)",
                    replaceAll: false,
                },
            ],
        }),
    ).resolves.toEqual("Update was successful.\n");

    expect(getTaskPatchRequests().map(request => request.body)).toEqual([
        {patches: [{type: "SetStatus", status: {type: "Open", isActive: true}}]},
    ]);
});

test("rejects setting task active without assignee on update", async () => {
    const {path} = await readTask({title: "Status task"});

    await expectUpdateDisplayMessage({
        path,
        updates: [
            {
                old: "- Status: Open",
                new: "- Status: Open (Active)",
                replaceAll: false,
            },
        ],
        expected:
            "Can\u2019t set task as active if there\u2019s no assignee. We don\u2019t recommend setting a task as active unless you\u2019re about to work on the task or you know someone else is currently working on the task. Try again and either set the task as open but inactive (e.g. `- Status: Open`) or set an assignee (e.g. `- Assignee: [ChatGPT](/bot/chatgpt)`).",
    });

    expect(getTaskPatchRequests()).toHaveLength(0);
});

test("sets and clears task parent", async () => {
    const {taskId, path} = await readTask({title: "Parent task child"});
    mockTaskPatch(taskId, 2);

    await callAgentWebUpdateTool(context, {
        path,
        updates: [
            {
                old: "- Status: Open",
                new: "- Status: Open\n- Parent: [Parent task](/task/parent-task)",
                replaceAll: false,
            },
        ],
    });
    await callAgentWebUpdateTool(context, {
        path,
        updates: [
            {
                old: "- Parent: [Parent task](/task/parent-task)",
                new: "- Parent:",
                replaceAll: false,
            },
        ],
    });

    expect(getTaskPatchRequests().map(request => request.body)).toEqual([
        {patches: [{type: "SetParent", parent: {task: {id: parentTaskId}}}]},
        {patches: [{type: "SetParent", parent: null}]},
    ]);
});

test("removes task parent after reading task with parent set", async () => {
    const {taskId, path} = await readTask({
        title: "Parent task child",
        parent: parentTaskReference,
    });
    mockTaskPatch(taskId);

    await expect(
        callAgentWebUpdateTool(context, {
            path,
            updates: [
                {
                    old: "\n- Parent: [Parent task](/task/parent-task)",
                    new: "",
                    replaceAll: false,
                },
            ],
        }),
    ).resolves.toEqual("Update was successful.\n");

    expect(getTaskPatchRequests().map(request => request.body)).toEqual([
        {patches: [{type: "SetParent", parent: null}]},
    ]);
});

test("changes task parent after reading task with parent set", async () => {
    const {taskId, path} = await readTask({
        title: "Parent task child",
        parent: parentTaskReference,
    });
    mockTaskPatch(taskId);

    await expect(
        callAgentWebUpdateTool(context, {
            path,
            updates: [
                {
                    old: "- Parent: [Parent task](/task/parent-task)",
                    new: "- Parent: [Other parent task](/task/other-parent-task)",
                    replaceAll: false,
                },
            ],
        }),
    ).resolves.toEqual("Update was successful.\n");

    expect(getTaskPatchRequests().map(request => request.body)).toEqual([
        {patches: [{type: "SetParent", parent: {task: {id: otherParentTaskId}}}]},
    ]);
});

test("rejects an unknown task parent link on update", async () => {
    const {path} = await readTask({title: "Parent task child"});

    await expectUpdateDisplayMessage({
        path,
        updates: [
            {
                old: "- Status: Open",
                new: "- Status: Open\n- Parent: [Missing](/task/missing)",
                replaceAll: false,
            },
        ],
        expected:
            "Unexpected task parent link \u201CMissing\u201D on line 4. Try again with a link to a task you\u2019ve seen before (e.g. `[My Task](/task/my-task)`).",
    });

    expect(getTaskPatchRequests()).toHaveLength(0);
});

test("rejects task parent link to another entity type on update", async () => {
    const {path} = await readTask({title: "Parent task child"});

    await expectUpdateDisplayMessage({
        path,
        updates: [
            {
                old: "- Status: Open",
                new: "- Status: Open\n- Parent: [Engineering](/task-collection/engineering)",
                replaceAll: false,
            },
        ],
        expected:
            "Unexpected task parent link \u201CEngineering\u201D on line 4. Try again with a link to a task you\u2019ve seen before (e.g. `[My Task](/task/my-task)`).",
    });

    expect(getTaskPatchRequests()).toHaveLength(0);
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

test("removes task assignee after reading task with assignee set", async () => {
    const {taskId, path} = await readTask({
        title: "Assignee task",
        assignee: aliceAccount,
    });
    mockTaskPatch(taskId);

    await expect(
        callAgentWebUpdateTool(context, {
            path,
            updates: [
                {
                    old: "\n- Assignee: [Alice](/human/alice)",
                    new: "",
                    replaceAll: false,
                },
            ],
        }),
    ).resolves.toEqual("Update was successful.\n");

    expect(getTaskPatchRequests().map(request => request.body)).toEqual([
        {patches: [{type: "SetAssignee", assignee: null}]},
    ]);
});

test("changes task assignee after reading task with assignee set", async () => {
    const {taskId, path} = await readTask({
        title: "Assignee task",
        assignee: aliceAccount,
    });
    mockTaskPatch(taskId);

    await expect(
        callAgentWebUpdateTool(context, {
            path,
            updates: [
                {
                    old: "- Assignee: [Alice](/human/alice)",
                    new: "- Assignee: [Bob](/human/bob)",
                    replaceAll: false,
                },
            ],
        }),
    ).resolves.toEqual("Update was successful.\n");

    expect(getTaskPatchRequests().map(request => request.body)).toEqual([
        {patches: [{type: "SetAssignee", assignee: intoApiAccountReference(bobAccount)}]},
    ]);
});

test("rejects removing assignee from active task on update", async () => {
    const {path} = await readTask({
        title: "Assignee task",
        status: {type: "Open", isActive: true},
        assignee: aliceAccount,
    });

    await expectUpdateDisplayMessage({
        path,
        updates: [
            {
                old: "\n- Assignee: [Alice](/human/alice)",
                new: "",
                replaceAll: false,
            },
        ],
        expected:
            "Can\u2019t remove the assignee from an active task. An active task implies someone is currently working on the task and so an assignee is required so we know who that is. Try again but set the task as inactive first (e.g. `- Status: Open`).",
    });

    expect(getTaskPatchRequests()).toHaveLength(0);
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

test("removes task priority after reading task with priority set", async () => {
    const {taskId, path} = await readTask({
        title: "Priority task",
        priority: {type: "Urgent"},
    });
    mockTaskPatch(taskId);

    await expect(
        callAgentWebUpdateTool(context, {
            path,
            updates: [{old: "\n- Priority: Urgent", new: "", replaceAll: false}],
        }),
    ).resolves.toEqual("Update was successful.\n");

    expect(getTaskPatchRequests().map(request => request.body)).toEqual([
        {patches: [{type: "SetPriority", priority: null}]},
    ]);
});

test("changes task priority after reading task with priority set", async () => {
    const {taskId, path} = await readTask({
        title: "Priority task",
        priority: {type: "Urgent"},
    });
    mockTaskPatch(taskId);

    await expect(
        callAgentWebUpdateTool(context, {
            path,
            updates: [{old: "- Priority: Urgent", new: "- Priority: Low", replaceAll: false}],
        }),
    ).resolves.toEqual("Update was successful.\n");

    expect(getTaskPatchRequests().map(request => request.body)).toEqual([
        {patches: [{type: "SetPriority", priority: {type: "Low"}}]},
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
    ["month first with ordinal", "July 12th, 2025", "2025-07-12"],
    // eslint-disable-next-line cyberworlds/string-quotes
    ["abbreviated month with short year", "Jul 12, '25", "2025-07-12"],
    ["day first with ordinal", "12th July 2025", "2025-07-12"],
    ["numeric slash with short year", "7/12/25", "2025-07-12"],
    ["numeric dash with full year", "07-12-2025", "2025-07-12"],
])("sets task due date from parsed date style: %s", async (name, dueDate, expectedDate) => {
    const {taskId, path} = await readTask({title: "Due date task"});
    mockTaskPatch(taskId);

    await expect(
        callAgentWebUpdateTool(context, {
            path,
            updates: [
                {
                    old: "- Status: Open",
                    new: `- Status: Open\n- Due date: ${dueDate}`,
                    replaceAll: false,
                },
            ],
        }),
    ).resolves.toEqual("Update was successful.\n");

    expect(getTaskPatchRequests().map(request => request.body)).toEqual([
        {patches: [{type: "SetDue", due: {date: expectedDate}}]},
    ]);
});

test("sets task due date without year using context year", async () => {
    import.meta.jest.useFakeTimers();
    try {
        import.meta.jest.setSystemTime(new Date("2031-02-03T12:00:00.000Z"));

        const {taskId, path} = await readTask({title: "Due date task"});
        mockTaskPatch(taskId);

        await expect(
            callAgentWebUpdateTool(context, {
                path,
                updates: [
                    {
                        old: "- Status: Open",
                        new: "- Status: Open\n- Due date: July 12",
                        replaceAll: false,
                    },
                ],
            }),
        ).resolves.toEqual("Update was successful.\n");
    } finally {
        import.meta.jest.useRealTimers();
    }

    expect(getTaskPatchRequests().map(request => request.body)).toEqual([
        {patches: [{type: "SetDue", due: {date: "2031-07-12"}}]},
    ]);
});

test("removes task due date after reading task with due date set", async () => {
    const {taskId, path} = await readTask({
        title: "Due date task",
        due: {date: "2027-07-12"},
    });
    mockTaskPatch(taskId);

    await expect(
        callAgentWebUpdateTool(context, {
            path,
            updates: [{old: "\n- Due date: July 12th, 2027", new: "", replaceAll: false}],
        }),
    ).resolves.toEqual("Update was successful.\n");

    expect(getTaskPatchRequests().map(request => request.body)).toEqual([
        {patches: [{type: "SetDue", due: null}]},
    ]);
});

test("changes task due date after reading task with due date set", async () => {
    const {taskId, path} = await readTask({
        title: "Due date task",
        due: {date: "2027-07-12"},
    });
    mockTaskPatch(taskId);

    await expect(
        callAgentWebUpdateTool(context, {
            path,
            updates: [
                {
                    old: "- Due date: July 12th, 2027",
                    new: "- Due date: July 12th, 2025",
                    replaceAll: false,
                },
            ],
        }),
    ).resolves.toEqual("Update was successful.\n");

    expect(getTaskPatchRequests().map(request => request.body)).toEqual([
        {patches: [{type: "SetDue", due: {date: "2025-07-12"}}]},
    ]);
});

test.each([
    ["date with time", "2027-07-12T09:00:00"],
    ["prose date with time", "July 12th, 2025 at 11:00pm"],
    ["multiple dates", "July 12th, 2025 and July 13th, 2025"],
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

test("adds task collection after reading task with collection set", async () => {
    const {taskId, path} = await readTask({
        title: "Collection task",
        collectionIds: [engineeringCollectionId],
    });
    mockTaskPatch(taskId);

    await expect(
        callAgentWebUpdateTool(context, {
            path,
            updates: [
                {
                    old: "- Collections: [Engineering](/task-collection/engineering)",
                    new: "- Collections: [Engineering](/task-collection/engineering), [Roadmap](/task-collection/roadmap)",
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
                    item: {collection: roadmapCollectionReference},
                },
            ],
        },
    ]);
});

test("removes task collection after reading task with two collections set", async () => {
    const {taskId, path} = await readTask({
        title: "Collection task",
        collectionIds: [engineeringCollectionId, roadmapCollectionId],
    });
    mockTaskPatch(taskId);

    await expect(
        callAgentWebUpdateTool(context, {
            path,
            updates: [
                {
                    old: "- Collections: [Engineering](/task-collection/engineering), [Roadmap](/task-collection/roadmap)",
                    new: "- Collections: [Engineering](/task-collection/engineering)",
                    replaceAll: false,
                },
            ],
        }),
    ).resolves.toEqual("Update was successful.\n");

    expect(getTaskPatchRequests().map(request => request.body)).toEqual([
        {patches: [{type: "RemoveCollection", collectionId: roadmapCollectionId}]},
    ]);
});

test("removes task collections after reading task with collection set", async () => {
    const {taskId, path} = await readTask({
        title: "Collection task",
        collectionIds: [engineeringCollectionId],
    });
    mockTaskPatch(taskId);

    await expect(
        callAgentWebUpdateTool(context, {
            path,
            updates: [
                {
                    old: "\n- Collections: [Engineering](/task-collection/engineering)",
                    new: "",
                    replaceAll: false,
                },
            ],
        }),
    ).resolves.toEqual("Update was successful.\n");

    expect(getTaskPatchRequests().map(request => request.body)).toEqual([
        {patches: [{type: "RemoveCollection", collectionId: engineeringCollectionId}]},
    ]);
});

test("changes task collections after reading task with collection set", async () => {
    const {taskId, path} = await readTask({
        title: "Collection task",
        collectionIds: [engineeringCollectionId],
    });
    mockTaskPatch(taskId);

    await expect(
        callAgentWebUpdateTool(context, {
            path,
            updates: [
                {
                    old: "- Collections: [Engineering](/task-collection/engineering)",
                    new: "- Collections: [Roadmap](/task-collection/roadmap)",
                    replaceAll: false,
                },
            ],
        }),
    ).resolves.toEqual("Update was successful.\n");

    expect(getTaskPatchRequests().map(request => request.body)).toEqual([
        {
            patches: [
                {type: "RemoveCollection", collectionId: engineeringCollectionId},
                {
                    type: "AddCollection",
                    item: {collection: roadmapCollectionReference},
                },
            ],
        },
    ]);
});

test("does not patch task when collections are reordered", async () => {
    const {path} = await readTask({
        title: "Collection task",
        collectionIds: [engineeringCollectionId, roadmapCollectionId],
    });

    await expect(
        callAgentWebUpdateTool(context, {
            path,
            updates: [
                {
                    old: "- Collections: [Engineering](/task-collection/engineering), [Roadmap](/task-collection/roadmap)",
                    new: "- Collections: [Roadmap](/task-collection/roadmap), [Engineering](/task-collection/engineering)",
                    replaceAll: false,
                },
            ],
        }),
    ).resolves.toEqual("Update was successful.\n");

    expect(getTaskPatchRequests()).toHaveLength(0);
});

test("rejects a collections more count on update without calling the API", async () => {
    const {path} = await readTask({
        title: "Collection task",
        collectionIds: [engineeringCollectionId],
    });

    await expectUpdateDisplayMessage({
        path,
        updates: [
            {
                old: "- Collections: [Engineering](/task-collection/engineering)",
                new: "- Collections: [Engineering](/task-collection/engineering), and 2 more",
                replaceAll: false,
            },
        ],
        expected:
            "Can\u2019t use \u201Cand 2 more\u201D in the \u201CCollections\u201D task field on line 4 since we wouldn\u2019t know which collections those are. Try again with a link to every collection (e.g. `- Collections: [My Collection 1](/task-collection/my-collection-1), [My Collection 2](/task-collection/my-collection-2)`).",
    });

    expect(getTaskPatchRequests()).toHaveLength(0);
});
