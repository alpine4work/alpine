import {CalendarDate} from "@internationalized/date";
import {apiTasksPaths} from "~/server/api/internal/tasks/api_tasks_paths.js";
import {createTestApiServer} from "~/server/api/internal/test_helpers/create_test_api_server.js";
import {TestBot} from "~/server/bots/test_helpers/test_bot.js";
import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {getTaskItemForTest} from "~/server/tasks/data/task_table.js";
import {tasksInjection} from "~/server/tasks/data/tasks_injection.js";
import {TestTaskRealtimeServer} from "~/server/tasks/realtime/test_helpers/test_task_realtime_server.js";
import {TestTask} from "~/server/tasks/test_helpers/test_task.js";
import {TestTaskCollection} from "~/server/tasks/test_helpers/test_task_collection.js";
import {ProcessContextModule} from "~/shared/context/process_context_module.js";
import {generateId} from "~/shared/id/id.js";
import {TaskCollectionId, TaskId} from "~/shared/id/types/id_types.js";

const baseContext = createTestContext({
    shouldStartOpensearch: true,
    tasksInjection,
});

const context = TestTaskRealtimeServer.with(baseContext);

const server = createTestApiServer(context, apiTasksPaths);

test("can read task information", async () => {
    const space = await TestSpace.create(context);
    const session1 = await space.createSession({name: "Alice Smith", role: "Admin"});
    const session2 = await space.createSession({name: "Bob Johnson"});

    const bot = await TestBot.createAndInstantiate(session1);
    const apiKey = await bot.createApiKey(session2);

    const task = await TestTask.create(session1);
    await task.typeTitle(session1, "Hello, world!");
    await task.updateAssignee(session1, session2);

    await ProcessContextModule.waitForTestTasks();

    expect(
        await server.GET(`/tasks/${task.id}`, {
            headers: {authorization: `bearer ${apiKey}`},
        }),
    ).toEqual({
        status: 200,
        headers: expect.objectContaining({"content-type": "application/json"}),
        body: expect.objectContaining({
            spaceId: space.id,
            task: expect.objectContaining({
                id: task.id,
                creator: {id: session1.account.id},
                status: expect.objectContaining({type: "Open"}),
                title: "Hello, world!",
                assignee: expect.objectContaining({
                    id: session2.account.id,
                    name: "Bob Johnson",
                }),
            }),
        }),
    });
});

test("can read task with notes content", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession({name: "Alice Smith", role: "Admin"});

    const bot = await TestBot.createAndInstantiate(session);
    const apiKey = await bot.createApiKey(session);

    const task = await TestTask.create(session, {title: "Task with Notes"});
    await task.typeNotes(session, "These are some task notes with important details.");

    await ProcessContextModule.waitForTestTasks();

    expect(
        await server.GET(`/tasks/${task.id}`, {
            headers: {authorization: `bearer ${apiKey}`},
        }),
    ).toEqual({
        status: 200,
        headers: expect.objectContaining({"content-type": "application/json"}),
        body: expect.objectContaining({
            spaceId: space.id,
            task: expect.objectContaining({
                id: task.id,
                title: "Task with Notes",
                content: expect.objectContaining({
                    elements: expect.arrayContaining([
                        expect.objectContaining({
                            type: "Paragraph",
                            elements: expect.arrayContaining([
                                expect.objectContaining({
                                    type: "Text",
                                    text: "These are some task notes with important details.",
                                }),
                            ]),
                        }),
                    ]),
                }),
            }),
        }),
    });
});

test("can read task with due date", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession({name: "Alice Smith", role: "Admin"});

    const bot = await TestBot.createAndInstantiate(session);
    const apiKey = await bot.createApiKey(session);

    const task = await TestTask.create(session, {title: "Task with Due Date"});

    const dueDate = new CalendarDate(2025, 12, 31);
    await task.updateDueDate(session, dueDate);

    await ProcessContextModule.waitForTestTasks();

    expect(
        await server.GET(`/tasks/${task.id}`, {
            headers: {authorization: `bearer ${apiKey}`},
        }),
    ).toEqual({
        status: 200,
        headers: expect.objectContaining({"content-type": "application/json"}),
        body: expect.objectContaining({
            spaceId: space.id,
            task: expect.objectContaining({
                id: task.id,
                title: "Task with Due Date",
                due: expect.objectContaining({
                    date: "2025-12-31",
                }),
            }),
        }),
    });
});

test("can read task with closed status", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession({name: "Alice Smith", role: "Admin"});

    const bot = await TestBot.createAndInstantiate(session);
    const apiKey = await bot.createApiKey(session);

    const task = await TestTask.create(session, {title: "Closed Task"});
    await task.updateStatus(session, "Closed");

    await ProcessContextModule.waitForTestTasks();

    expect(
        await server.GET(`/tasks/${task.id}`, {
            headers: {authorization: `bearer ${apiKey}`},
        }),
    ).toEqual({
        status: 200,
        headers: expect.objectContaining({"content-type": "application/json"}),
        body: expect.objectContaining({
            spaceId: space.id,
            task: expect.objectContaining({
                id: task.id,
                title: "Closed Task",
                status: expect.objectContaining({
                    type: "Closed",
                }),
            }),
        }),
    });
});

test("can read task with active status", async () => {
    const space = await TestSpace.create(context);
    const session1 = await space.createSession({name: "Alice Smith", role: "Admin"});
    const session2 = await space.createSession({name: "Bob Johnson"});

    const bot = await TestBot.createAndInstantiate(session1);
    const apiKey = await bot.createApiKey(session2);

    const task = await TestTask.create(session1, {title: "Active Task"});
    await task.updateAssignee(session1, session2, {assigneeStatus: "Active"});

    await ProcessContextModule.waitForTestTasks();

    expect(
        await server.GET(`/tasks/${task.id}`, {
            headers: {authorization: `bearer ${apiKey}`},
        }),
    ).toEqual({
        status: 200,
        headers: expect.objectContaining({"content-type": "application/json"}),
        body: expect.objectContaining({
            spaceId: space.id,
            task: expect.objectContaining({
                id: task.id,
                title: "Active Task",
                status: expect.objectContaining({
                    type: "Open",
                    isActive: true,
                }),
                assignee: expect.objectContaining({
                    id: session2.account.id,
                    name: "Bob Johnson",
                }),
            }),
        }),
    });
});

test("can read task with inactive status", async () => {
    const space = await TestSpace.create(context);
    const session1 = await space.createSession({name: "Alice Smith", role: "Admin"});
    const session2 = await space.createSession({name: "Bob Johnson"});

    const bot = await TestBot.createAndInstantiate(session1);
    const apiKey = await bot.createApiKey(session2);

    const task = await TestTask.create(session1, {title: "Inactive Task"});
    await task.updateAssignee(session1, session2, {assigneeStatus: "Inactive"});

    await ProcessContextModule.waitForTestTasks();

    expect(
        await server.GET(`/tasks/${task.id}`, {
            headers: {authorization: `bearer ${apiKey}`},
        }),
    ).toEqual({
        status: 200,
        headers: expect.objectContaining({"content-type": "application/json"}),
        body: expect.objectContaining({
            spaceId: space.id,
            task: expect.objectContaining({
                id: task.id,
                title: "Inactive Task",
                status: expect.objectContaining({
                    type: "Open",
                    isActive: false,
                }),
                assignee: expect.objectContaining({
                    id: session2.account.id,
                    name: "Bob Johnson",
                }),
            }),
        }),
    });
});

test("can read task with high priority", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession({name: "Alice Smith", role: "Admin"});

    const bot = await TestBot.createAndInstantiate(session);
    const apiKey = await bot.createApiKey(session);

    const task = await TestTask.create(session, {title: "High Priority Task"});
    await task.updatePriority(session, "High");

    await ProcessContextModule.waitForTestTasks();

    expect(
        await server.GET(`/tasks/${task.id}`, {
            headers: {authorization: `bearer ${apiKey}`},
        }),
    ).toEqual({
        status: 200,
        headers: expect.objectContaining({"content-type": "application/json"}),
        body: expect.objectContaining({
            spaceId: space.id,
            task: expect.objectContaining({
                id: task.id,
                title: "High Priority Task",
                priority: "High",
            }),
        }),
    });
});

test("can\u2019t read task information without access", async () => {
    const space = await TestSpace.create(context);
    const session1 = await space.createSession({role: "Admin"});
    const session2 = await space.createSession();

    const bot = await TestBot.createAndInstantiate(session1);
    const apiKey = await bot.createApiKey(session1);

    const task = await TestTask.create(session2);

    await ProcessContextModule.waitForTestTasks();

    expect(
        await server.GET(`/tasks/${task.id}`, {
            headers: {authorization: `bearer ${apiKey}`},
        }),
    ).toEqual({
        status: 403,
        headers: expect.objectContaining({"content-type": "application/json"}),
        body: {
            error: expect.objectContaining({
                message: expect.stringMatching("You aren\u2019t allowed"),
            }),
        },
    });
});

test("can\u2019t read task information for non-existent task", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession({role: "Admin"});

    const bot = await TestBot.createAndInstantiate(session);
    const apiKey = await bot.createApiKey(session);

    await ProcessContextModule.waitForTestTasks();

    expect(
        await server.GET(`/tasks/${generateId<TaskId>()}`, {
            headers: {authorization: `bearer ${apiKey}`},
        }),
    ).toEqual({
        status: 404,
        headers: expect.objectContaining({"content-type": "application/json"}),
        body: {
            error: expect.objectContaining({
                message: expect.stringMatching("doesn\u2019t exist"),
            }),
        },
    });
});

test("can create an empty task", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession({name: "Alice Smith", role: "Admin"});

    const bot = await TestBot.createAndInstantiate(session);
    const apiKey = await bot.createApiKey(session);

    await ProcessContextModule.waitForTestTasks();

    const response = await server.POST("/tasks", {
        headers: {authorization: `bearer ${apiKey}`},
        body: {
            spaceId: space.id,
            task: {},
        },
    });

    expect(response).toEqual({
        status: 200,
        headers: expect.objectContaining({"content-type": "application/json"}),
        body: {
            spaceId: space.id,
            task: {
                id: response.body.task.id,
                creator: {id: bot.id},
                status: {type: "Open", isActive: false},
                title: "",
                content: {
                    elements: [
                        {
                            type: "Paragraph",
                            elements: [],
                        },
                    ],
                },
            },
        },
    });
});

test("can create a task with all fields", async () => {
    const space = await TestSpace.create(context);
    const session1 = await space.createSession({name: "Alice Smith", role: "Admin"});
    const session2 = await space.createSession({name: "Bob Johnson"});

    const bot = await TestBot.createAndInstantiate(session1);
    const apiKey = await bot.createApiKey(session2);

    await ProcessContextModule.waitForTestTasks();

    const response = await server.POST("/tasks", {
        headers: {authorization: `bearer ${apiKey}`},
        body: {
            spaceId: space.id,
            task: {
                title: "Full task",
                assignee: {id: session2.account.id},
                due: {date: "2026-12-31"},
                priority: "High",
                content: {
                    elements: [
                        {
                            type: "Paragraph",
                            elements: [{type: "Text", text: "Task notes here."}],
                        },
                    ],
                },
            },
        },
    });

    expect(response).toEqual({
        status: 200,
        headers: expect.objectContaining({"content-type": "application/json"}),
        body: expect.objectContaining({
            spaceId: space.id,
            task: expect.objectContaining({
                id: expect.any(String),
                status: {type: "Open", isActive: false},
                title: "Full task",
                assignee: expect.objectContaining({
                    id: session2.account.id,
                    name: "Bob Johnson",
                }),
                due: {date: "2026-12-31"},
                priority: "High",
                content: expect.objectContaining({
                    elements: expect.arrayContaining([
                        expect.objectContaining({
                            type: "Paragraph",
                            elements: expect.arrayContaining([
                                expect.objectContaining({
                                    type: "Text",
                                    text: "Task notes here.",
                                }),
                            ]),
                        }),
                    ]),
                }),
            }),
        }),
    });
});

test("can create a task with creator", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession({name: "Alice Smith", role: "Admin"});

    const bot = await TestBot.createAndInstantiate(session);
    const apiKey = await bot.createApiKey(session);

    await ProcessContextModule.waitForTestTasks();

    const response = await server.POST("/tasks", {
        headers: {authorization: `bearer ${apiKey}`},
        body: {
            spaceId: space.id,
            task: {
                title: "Task with Creator",
                creator: {
                    id: session.account.id,
                },
                content: {
                    elements: [
                        {
                            type: "Paragraph",
                            elements: [{type: "Text", text: "Hello from the creator!"}],
                        },
                    ],
                },
            },
        },
    });

    expect(response).toEqual({
        status: 200,
        headers: expect.objectContaining({"content-type": "application/json"}),
        body: expect.objectContaining({
            spaceId: space.id,
            task: expect.objectContaining({
                id: expect.any(String),
                title: "Task with Creator",
                creator: {id: session.account.id},
            }),
        }),
    });

    expect(await getTaskItemForTest(context, response.body.task.id)).toMatchObject({
        creatorId: session.account.id,
        creatorFrom: {type: "Bot", accountId: bot.id},
    });
});

test("can create a task with closed status", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession({name: "Alice Smith", role: "Admin"});

    const bot = await TestBot.createAndInstantiate(session);
    const apiKey = await bot.createApiKey(session);

    await ProcessContextModule.waitForTestTasks();

    const response = await server.POST("/tasks", {
        headers: {authorization: `bearer ${apiKey}`},
        body: {
            spaceId: space.id,
            task: {
                title: "Already done",
                status: {type: "Closed"},
                content: {elements: []},
            },
        },
    });

    expect(response).toEqual({
        status: 200,
        headers: expect.objectContaining({"content-type": "application/json"}),
        body: expect.objectContaining({
            task: expect.objectContaining({
                title: "Already done",
                status: {type: "Closed"},
            }),
        }),
    });
});

test("can create an active task without an assignee (auto-assigns bot)", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession({name: "Alice Smith", role: "Admin"});

    const bot = await TestBot.createAndInstantiate(session);
    const apiKey = await bot.createApiKey(session);

    await ProcessContextModule.waitForTestTasks();

    const response = await server.POST("/tasks", {
        headers: {authorization: `bearer ${apiKey}`},
        body: {
            spaceId: space.id,
            task: {
                title: "Active task",
                status: {type: "Open", isActive: true},
                content: {elements: []},
            },
        },
    });

    expect(response).toEqual({
        status: 200,
        headers: expect.objectContaining({"content-type": "application/json"}),
        body: expect.objectContaining({
            task: expect.objectContaining({
                title: "Active task",
                status: {type: "Open", isActive: true},
                assignee: expect.objectContaining({
                    id: bot.id,
                }),
            }),
        }),
    });
});

// TODO: Add test for creating a subtask (parentTaskId) once we have a read format
// for parent tasks. \
// TODO: Add test for creating a task with layout once we have a read format. \
// TODO: Add test for creating a task with collectionIds once we have a read format
// for collection membership.

// NOTE: File attachment is tested through the full API flow where the bot uploads
// a file first via POST /files, then references it in the task content. The unit
// test would need the bot's own file upload which isn't set up in TestFile.create.
// The handler follows the same attachFileToTargetAsBot pattern as POST /documents.

describe("/tasks/{id}/mention", () => {
    test("can read task mention with open status", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession({name: "Alice Smith", role: "Admin"});

        const bot = await TestBot.createAndInstantiate(session);
        const apiKey = await bot.createApiKey(session);

        const task = await TestTask.create(session, {title: "Test Task Title"});

        await ProcessContextModule.waitForTestTasks();

        expect(
            await server.GET(`/tasks/${task.id}/mention`, {
                headers: {authorization: `bearer ${apiKey}`},
            }),
        ).toEqual({
            status: 200,
            headers: expect.objectContaining({"content-type": "application/json"}),
            body: {
                spaceId: space.id,
                mention: {
                    target: {
                        type: "Task",
                        id: task.id,
                        status: {type: "Open", isActive: false},
                    },
                    title: "Test Task Title",
                },
            },
        });
    });

    test("can read task mention with closed status", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession({name: "Alice Smith", role: "Admin"});

        const bot = await TestBot.createAndInstantiate(session);
        const apiKey = await bot.createApiKey(session);

        const task = await TestTask.create(session, {title: "Closed Task"});
        await task.updateStatus(session, "Closed");

        await ProcessContextModule.waitForTestTasks();

        expect(
            await server.GET(`/tasks/${task.id}/mention`, {
                headers: {authorization: `bearer ${apiKey}`},
            }),
        ).toEqual({
            status: 200,
            headers: expect.objectContaining({"content-type": "application/json"}),
            body: {
                spaceId: space.id,
                mention: {
                    target: {
                        type: "Task",
                        id: task.id,
                        status: {type: "Closed"},
                    },
                    title: "Closed Task",
                },
            },
        });
    });

    test("can read task mention with active status", async () => {
        const space = await TestSpace.create(context);
        const session1 = await space.createSession({name: "Alice Smith", role: "Admin"});
        const session2 = await space.createSession({name: "Bob Johnson"});

        const bot = await TestBot.createAndInstantiate(session1);
        const apiKey = await bot.createApiKey(session2);

        const task = await TestTask.create(session1, {title: "Active Task"});
        await task.updateAssignee(session1, session2, {assigneeStatus: "Active"});

        await ProcessContextModule.waitForTestTasks();

        expect(
            await server.GET(`/tasks/${task.id}/mention`, {
                headers: {authorization: `bearer ${apiKey}`},
            }),
        ).toEqual({
            status: 200,
            headers: expect.objectContaining({"content-type": "application/json"}),
            body: {
                spaceId: space.id,
                mention: {
                    target: {
                        type: "Task",
                        id: task.id,
                        status: {type: "Open", isActive: true},
                    },
                    title: "Active Task",
                },
            },
        });
    });

    test("can\u2019t read task mention without access", async () => {
        const space = await TestSpace.create(context);
        const session1 = await space.createSession({role: "Admin"});
        const session2 = await space.createSession();

        const bot = await TestBot.createAndInstantiate(session1);
        const apiKey = await bot.createApiKey(session1);

        const task = await TestTask.create(session2);

        await ProcessContextModule.waitForTestTasks();

        expect(
            await server.GET(`/tasks/${task.id}/mention`, {
                headers: {authorization: `bearer ${apiKey}`},
            }),
        ).toEqual({
            status: 403,
            headers: expect.objectContaining({"content-type": "application/json"}),
            body: {
                error: expect.objectContaining({
                    message: expect.stringMatching("You aren\u2019t allowed to access this task."),
                }),
            },
        });
    });

    test("can\u2019t read task mention for non-existent task", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession({role: "Admin"});

        const bot = await TestBot.createAndInstantiate(session);
        const apiKey = await bot.createApiKey(session);

        await ProcessContextModule.waitForTestTasks();

        expect(
            await server.GET(`/tasks/${generateId<TaskId>()}/mention`, {
                headers: {authorization: `bearer ${apiKey}`},
            }),
        ).toEqual({
            status: 404,
            headers: expect.objectContaining({"content-type": "application/json"}),
            body: {
                error: expect.objectContaining({
                    message: expect.stringMatching("This task doesn\u2019t exist"),
                }),
            },
        });
    });

    test("can read task mention with task scope", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession({name: "Alice Smith", role: "Admin"});

        const bot = await TestBot.createAndInstantiate(session);
        const task = await TestTask.create(session, {title: "Scoped Task"});
        const apiKey = await bot.createApiKey({type: "Task", taskId: task.id});

        await ProcessContextModule.waitForTestTasks();

        expect(
            await server.GET(`/tasks/${task.id}/mention`, {
                headers: {authorization: `bearer ${apiKey}`},
            }),
        ).toEqual({
            status: 200,
            headers: expect.objectContaining({"content-type": "application/json"}),
            body: {
                spaceId: space.id,
                mention: {
                    target: {
                        type: "Task",
                        id: task.id,
                        status: {type: "Open", isActive: false},
                    },
                    title: "Scoped Task",
                },
            },
        });
    });
});

test("can read task collection information", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession({name: "Alice Smith", role: "Admin"});

    const bot = await TestBot.createAndInstantiate(session);
    const apiKey = await bot.createApiKey(session);

    const collection = await TestTaskCollection.create(session, {
        name: "My Project Tasks",
        access: "Public",
    });

    await ProcessContextModule.waitForTestTasks();

    expect(
        await server.GET(`/task-collections/${collection.id}`, {
            headers: {authorization: `bearer ${apiKey}`},
        }),
    ).toEqual({
        status: 200,
        headers: expect.objectContaining({"content-type": "application/json"}),
        body: expect.objectContaining({
            spaceId: space.id,
            taskCollection: expect.objectContaining({
                id: collection.id,
                name: "My Project Tasks",
            }),
        }),
    });
});

test("can\u2019t read task collection information without access", async () => {
    const space = await TestSpace.create(context);
    const session1 = await space.createSession({role: "Admin"});
    const session2 = await space.createSession();

    const bot = await TestBot.createAndInstantiate(session1);
    const apiKey = await bot.createApiKey(session1);

    const collection = await TestTaskCollection.create(session2, {
        access: "Private",
    });

    await ProcessContextModule.waitForTestTasks();

    expect(
        await server.GET(`/task-collections/${collection.id}`, {
            headers: {authorization: `bearer ${apiKey}`},
        }),
    ).toEqual({
        status: 403,
        headers: expect.objectContaining({"content-type": "application/json"}),
        body: {
            error: expect.objectContaining({
                message: expect.stringMatching("You aren\u2019t allowed"),
            }),
        },
    });
});

test("can\u2019t read task collection information for non-existent collection", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession({role: "Admin"});

    const bot = await TestBot.createAndInstantiate(session);
    const apiKey = await bot.createApiKey(session);

    await ProcessContextModule.waitForTestTasks();

    expect(
        await server.GET(`/task-collections/${generateId<TaskCollectionId>()}`, {
            headers: {authorization: `bearer ${apiKey}`},
        }),
    ).toEqual({
        status: 404,
        headers: expect.objectContaining({"content-type": "application/json"}),
        body: {
            error: expect.objectContaining({
                message: expect.stringMatching("doesn\u2019t exist"),
            }),
        },
    });
});

describe("/task-collections/{id}/mention", () => {
    test("can read task collection mention", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession({name: "Alice Smith", role: "Admin"});

        const bot = await TestBot.createAndInstantiate(session);
        const apiKey = await bot.createApiKey(session);

        const collection = await TestTaskCollection.create(session, {
            name: "My Project Tasks",
            access: "Public",
        });

        await ProcessContextModule.waitForTestTasks();

        expect(
            await server.GET(`/task-collections/${collection.id}/mention`, {
                headers: {authorization: `bearer ${apiKey}`},
            }),
        ).toEqual({
            status: 200,
            headers: expect.objectContaining({"content-type": "application/json"}),
            body: {
                spaceId: space.id,
                mention: {
                    target: {
                        type: "TaskCollection",
                        id: collection.id,
                    },
                    title: "My Project Tasks",
                },
            },
        });
    });

    test("can\u2019t read task collection mention without access", async () => {
        const space = await TestSpace.create(context);
        const session1 = await space.createSession({role: "Admin"});
        const session2 = await space.createSession();

        const bot = await TestBot.createAndInstantiate(session1);
        const apiKey = await bot.createApiKey(session1);

        const collection = await TestTaskCollection.create(session2, {
            access: "Private",
        });

        await ProcessContextModule.waitForTestTasks();

        expect(
            await server.GET(`/task-collections/${collection.id}/mention`, {
                headers: {authorization: `bearer ${apiKey}`},
            }),
        ).toEqual({
            status: 403,
            headers: expect.objectContaining({"content-type": "application/json"}),
            body: {
                error: expect.objectContaining({
                    message: expect.stringMatching(
                        "You aren\u2019t allowed to access this task collection.",
                    ),
                }),
            },
        });
    });

    test("can\u2019t read task collection mention for non-existent collection", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession({role: "Admin"});

        const bot = await TestBot.createAndInstantiate(session);
        const apiKey = await bot.createApiKey(session);

        await ProcessContextModule.waitForTestTasks();

        expect(
            await server.GET(`/task-collections/${generateId<TaskCollectionId>()}/mention`, {
                headers: {authorization: `bearer ${apiKey}`},
            }),
        ).toEqual({
            status: 404,
            headers: expect.objectContaining({"content-type": "application/json"}),
            body: {
                error: expect.objectContaining({
                    message: expect.stringMatching("This task collection doesn\u2019t exist"),
                }),
            },
        });
    });
});

test("can read task information with task scope", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession({name: "Alice Smith", role: "Admin"});

    const bot = await TestBot.createAndInstantiate(session);
    const task = await TestTask.create(session, {title: "Hello, world!"});
    const apiKey = await bot.createApiKey({type: "Task", taskId: task.id});

    await ProcessContextModule.waitForTestTasks();

    expect(
        await server.GET(`/tasks/${task.id}`, {
            headers: {authorization: `bearer ${apiKey}`},
        }),
    ).toEqual({
        status: 200,
        headers: expect.objectContaining({"content-type": "application/json"}),
        body: expect.objectContaining({
            spaceId: space.id,
            task: expect.objectContaining({
                id: task.id,
                status: expect.objectContaining({type: "Open"}),
                title: "Hello, world!",
            }),
        }),
    });
});

test("can read task collection information with task scope", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession({name: "Alice Smith", role: "Admin"});

    const task = await TestTask.create(session, {title: "Hello, world!"});
    const collection = await TestTaskCollection.create(session, {
        name: "My Project Tasks",
        access: "Public",
    });
    await task.addCollection(session, collection);

    const bot = await TestBot.createAndInstantiate(session);
    const apiKey = await bot.createApiKey({type: "Task", taskId: task.id});

    await ProcessContextModule.waitForTestTasks();

    expect(
        await server.GET(`/task-collections/${collection.id}`, {
            headers: {authorization: `bearer ${apiKey}`},
        }),
    ).toEqual({
        status: 200,
        headers: expect.objectContaining({"content-type": "application/json"}),
        body: expect.objectContaining({
            spaceId: space.id,
            taskCollection: expect.objectContaining({
                id: collection.id,
                name: "My Project Tasks",
            }),
        }),
    });
});

describe("/task-collections/{id}/tasks", () => {
    test("returns 403 response if actor is not authorized to access collection", async () => {
        const space = await TestSpace.create(context);
        const session1 = await space.createSession({name: "Alice Smith", role: "Admin"});
        const session2 = await space.createSession({name: "Bob Johnson", role: "Admin"});

        const bot = await TestBot.createAndInstantiate(session1);
        const apiKey = await bot.createApiKey(session1);

        // Create a private collection owned by session2
        const collection = await TestTaskCollection.create(session2, {
            name: "Private Collection",
            access: "Private",
        });

        // Create a task in the collection
        const task = await TestTask.create(session2, {title: "Task in Private Collection"});
        await task.addCollection(session2, collection);

        await ProcessContextModule.waitForTestTasks();

        // Bot for session1 should not see tasks in session2's private collection
        const response = await server.GET(`/task-collections/${collection.id}/tasks`, {
            headers: {authorization: `bearer ${apiKey}`},
        });

        expect(response).toEqual({
            status: 403,
            headers: expect.objectContaining({"content-type": "application/json"}),
            body: expect.objectContaining({
                error: expect.objectContaining({
                    message: expect.stringMatching(
                        "You aren\u2019t allowed to access this collection. Ask someone with access to share it with you.",
                    ),
                    stack: expect.stringContaining(
                        "PermissionDeniedError: Actor doesn\u2019t have `View` access level",
                    ),
                }),
            }),
        });
    });

    test("returns tasks if authorized", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession({name: "Alice Smith", role: "Admin"});

        const bot = await TestBot.createAndInstantiate(session);
        const apiKey = await bot.createApiKey(session);

        const collection = await TestTaskCollection.create(session, {
            name: "Public Collection",
            access: "Public",
        });

        const task1 = await TestTask.create(session, {title: "First Task"});
        const task2 = await TestTask.create(session, {title: "Second Task"});

        await task1.addCollection(session, collection);
        await task2.addCollection(session, collection);

        await ProcessContextModule.waitForTestTasks();

        const response = await server.GET(`/task-collections/${collection.id}/tasks`, {
            headers: {authorization: `bearer ${apiKey}`},
        });

        expect(response).toEqual({
            status: 200,
            headers: expect.objectContaining({"content-type": "application/json"}),
            body: expect.objectContaining({
                spaceId: space.id,
                tasks: [
                    {
                        creator: {id: session.account.id},
                        id: task1.id,
                        title: "First Task",
                        status: {type: "Open", isActive: false},
                    },
                    {
                        creator: {id: session.account.id},
                        id: task2.id,
                        title: "Second Task",
                        status: {type: "Open", isActive: false},
                    },
                ],
                nextCursor: null,
            }),
        });

        expect(response.body.tasks).toHaveLength(2);
    });

    test("returns tasks in correct order by collection position", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession({name: "Alice Smith", role: "Admin"});

        const bot = await TestBot.createAndInstantiate(session);
        const apiKey = await bot.createApiKey(session);

        const collection = await TestTaskCollection.create(session, {
            name: "Ordered Collection",
            access: "Public",
        });

        // Create tasks in specific order
        const task1 = await TestTask.create(session, {title: "Task A"});
        const task2 = await TestTask.create(session, {title: "Task B"});
        const task3 = await TestTask.create(session, {title: "Task C"});

        // Add them to the collection in order
        await task1.addCollection(session, collection);
        await task2.addCollection(session, collection);
        await task3.addCollection(session, collection);

        await ProcessContextModule.waitForTestTasks();

        const response = await server.GET(`/task-collections/${collection.id}/tasks`, {
            headers: {authorization: `bearer ${apiKey}`},
        });

        expect(response).toEqual({
            status: 200,
            headers: expect.objectContaining({"content-type": "application/json"}),
            body: expect.objectContaining({
                spaceId: space.id,
                tasks: [
                    expect.objectContaining({id: task1.id, title: "Task A"}),
                    expect.objectContaining({id: task2.id, title: "Task B"}),
                    expect.objectContaining({id: task3.id, title: "Task C"}),
                ],
                nextCursor: null,
            }),
        });
    });

    test("returns tasks with correct content including assignee, due date, and priority", async () => {
        const space = await TestSpace.create(context);
        const session1 = await space.createSession({name: "Alice Smith", role: "Admin"});
        const session2 = await space.createSession({name: "Bob Johnson"});

        const bot = await TestBot.createAndInstantiate(session1);
        const apiKey = await bot.createApiKey(session1);

        const collection = await TestTaskCollection.create(session1, {
            name: "Collection with Details",
            access: "Public",
        });

        const task = await TestTask.create(session1, {title: "Detailed Task"});
        await task.updateAssignee(session1, session2);
        await task.updateDueDate(session1, new CalendarDate(2025, 12, 31));
        await task.updatePriority(session1, "High");
        await task.addCollection(session1, collection);

        await ProcessContextModule.waitForTestTasks();

        const response = await server.GET(`/task-collections/${collection.id}/tasks`, {
            headers: {authorization: `bearer ${apiKey}`},
        });

        expect(response).toEqual({
            status: 200,
            headers: expect.objectContaining({"content-type": "application/json"}),
            body: {
                spaceId: space.id,
                tasks: [
                    {
                        creator: {id: session1.account.id},
                        id: task.id,
                        title: "Detailed Task",
                        status: {type: "Open", isActive: false},
                        assignee: {
                            id: session2.account.id,
                            name: "Bob Johnson",
                            shortName: "Bob",
                            space: {
                                addedTime: expect.any(String),
                                role: "Member",
                            },
                        },
                        due: {
                            date: "2025-12-31",
                        },
                        priority: "High",
                    },
                ],
                nextCursor: null,
            },
        });
    });

    test("filters out closed tasks by default", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession({name: "Alice Smith", role: "Admin"});

        const bot = await TestBot.createAndInstantiate(session);
        const apiKey = await bot.createApiKey(session);

        const collection = await TestTaskCollection.create(session, {
            name: "Mixed Status Collection",
            access: "Public",
        });

        const openTask = await TestTask.create(session, {title: "Open Task"});
        const closedTask = await TestTask.create(session, {title: "Closed Task"});

        await openTask.addCollection(session, collection);
        await closedTask.addCollection(session, collection);
        await closedTask.updateStatus(session, "Closed");

        await ProcessContextModule.waitForTestTasks();

        const response = await server.GET(`/task-collections/${collection.id}/tasks`, {
            headers: {authorization: `bearer ${apiKey}`},
        });

        expect(response).toEqual({
            status: 200,
            headers: expect.objectContaining({"content-type": "application/json"}),
            body: {
                spaceId: space.id,
                tasks: [
                    {
                        creator: {id: session.account.id},
                        id: openTask.id,
                        title: "Open Task",
                        status: expect.objectContaining({type: "Open"}),
                    },
                ],
                nextCursor: null,
            },
        });
    });

    test("includes both active and inactive open tasks", async () => {
        const space = await TestSpace.create(context);
        const session1 = await space.createSession({name: "Alice Smith", role: "Admin"});
        const session2 = await space.createSession({name: "Bob Johnson"});

        const bot = await TestBot.createAndInstantiate(session1);
        const apiKey = await bot.createApiKey(session1);

        const collection = await TestTaskCollection.create(session1, {
            name: "Active/Inactive Collection",
            access: "Public",
        });

        const activeTask = await TestTask.create(session1, {title: "Active Task"});
        const inactiveTask = await TestTask.create(session1, {title: "Inactive Task"});

        await activeTask.updateAssignee(session1, session2, {assigneeStatus: "Active"});
        await inactiveTask.updateAssignee(session1, session2, {assigneeStatus: "Inactive"});

        await activeTask.addCollection(session1, collection);
        await inactiveTask.addCollection(session1, collection);

        await ProcessContextModule.waitForTestTasks();

        const response = await server.GET(`/task-collections/${collection.id}/tasks`, {
            headers: {authorization: `bearer ${apiKey}`},
        });

        expect(response).toEqual({
            status: 200,
            headers: expect.objectContaining({"content-type": "application/json"}),
            body: expect.objectContaining({
                spaceId: space.id,
                tasks: expect.arrayContaining([
                    expect.objectContaining({
                        id: activeTask.id,
                        title: "Active Task",
                        status: expect.objectContaining({type: "Open", isActive: true}),
                    }),
                    expect.objectContaining({
                        id: inactiveTask.id,
                        title: "Inactive Task",
                        status: expect.objectContaining({type: "Open", isActive: false}),
                    }),
                ]),
                nextCursor: null,
            }),
        });

        expect(response.body.tasks).toHaveLength(2);
    });

    test("respects custom limit parameter", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession({name: "Alice Smith", role: "Admin"});

        const bot = await TestBot.createAndInstantiate(session);
        const apiKey = await bot.createApiKey(session);

        const collection = await TestTaskCollection.create(session, {
            name: "Large Collection",
            access: "Public",
        });

        // Create 5 tasks
        const tasks = await Promise.all(
            Array.from({length: 5}, (_, i) => TestTask.create(session, {title: `Task ${i + 1}`})),
        );

        for (const task of tasks) {
            await task.addCollection(session, collection);
        }

        await ProcessContextModule.waitForTestTasks();

        // Request only 3 tasks
        const response = await server.GET(`/task-collections/${collection.id}/tasks?limit=3`, {
            headers: {authorization: `bearer ${apiKey}`},
        });

        expect(response).toEqual({
            status: 200,
            headers: expect.objectContaining({"content-type": "application/json"}),
            body: expect.objectContaining({
                spaceId: space.id,
                tasks: expect.any(Array),
                nextCursor: expect.any(String),
            }),
        });

        expect(response.body.tasks).toHaveLength(3);
        expect(response.body.nextCursor).not.toBeNull();
    });

    test("returns null cursor when all tasks are returned", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession({name: "Alice Smith", role: "Admin"});

        const bot = await TestBot.createAndInstantiate(session);
        const apiKey = await bot.createApiKey(session);

        const collection = await TestTaskCollection.create(session, {
            name: "Small Collection",
            access: "Public",
        });

        const task = await TestTask.create(session, {title: "Only Task"});
        await task.addCollection(session, collection);

        await ProcessContextModule.waitForTestTasks();

        const response = await server.GET(`/task-collections/${collection.id}/tasks?limit=10`, {
            headers: {authorization: `bearer ${apiKey}`},
        });

        expect(response).toEqual({
            status: 200,
            headers: expect.objectContaining({"content-type": "application/json"}),
            body: expect.objectContaining({
                spaceId: space.id,
                tasks: [
                    expect.objectContaining({
                        id: task.id,
                        title: "Only Task",
                    }),
                ],
                nextCursor: null,
            }),
        });
    });

    test("returns nextCursor if there are more tasks", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession({name: "Alice Smith", role: "Admin"});

        const bot = await TestBot.createAndInstantiate(session);
        const apiKey = await bot.createApiKey(session);

        const collection = await TestTaskCollection.create(session, {
            name: "Collection with More Tasks",
            access: "Public",
        });

        const task1 = await TestTask.create(session, {title: "Task 1"});
        const task2 = await TestTask.create(session, {title: "Task 2"});
        const task3 = await TestTask.create(session, {title: "Task 3"});

        await task1.addCollection(session, collection);
        await task2.addCollection(session, collection);
        await task3.addCollection(session, collection);

        await ProcessContextModule.waitForTestTasks();
        const response = await server.GET(`/task-collections/${collection.id}/tasks?limit=1`, {
            headers: {authorization: `bearer ${apiKey}`},
            body: {limit: 2},
        });

        expect(response).toEqual({
            status: 200,
            headers: expect.objectContaining({"content-type": "application/json"}),
            body: expect.objectContaining({
                spaceId: space.id,
                tasks: expect.arrayContaining([
                    expect.objectContaining({id: task1.id, title: "Task 1"}),
                ]),
                nextCursor: expect.any(String),
            }),
        });
    });

    test("returns empty array for collection with no tasks", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession({name: "Alice Smith", role: "Admin"});

        const bot = await TestBot.createAndInstantiate(session);
        const apiKey = await bot.createApiKey(session);

        const collection = await TestTaskCollection.create(session, {
            name: "Empty Collection",
            access: "Public",
        });

        await ProcessContextModule.waitForTestTasks();

        const response = await server.GET(`/task-collections/${collection.id}/tasks`, {
            headers: {authorization: `bearer ${apiKey}`},
        });

        expect(response).toEqual({
            status: 200,
            headers: expect.objectContaining({"content-type": "application/json"}),
            body: expect.objectContaining({
                spaceId: space.id,
                tasks: [],
                nextCursor: null,
            }),
        });
    });

    test("returns empty array for collection with only closed tasks", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession({name: "Alice Smith", role: "Admin"});

        const bot = await TestBot.createAndInstantiate(session);
        const apiKey = await bot.createApiKey(session);

        const collection = await TestTaskCollection.create(session, {
            name: "All Closed Collection",
            access: "Public",
        });

        const task1 = await TestTask.create(session, {title: "Closed Task 1"});
        const task2 = await TestTask.create(session, {title: "Closed Task 2"});

        await task1.addCollection(session, collection);
        await task2.addCollection(session, collection);

        await task1.updateStatus(session, "Closed");
        await task2.updateStatus(session, "Closed");

        await ProcessContextModule.waitForTestTasks();

        const response = await server.GET(`/task-collections/${collection.id}/tasks`, {
            headers: {authorization: `bearer ${apiKey}`},
        });

        expect(response).toEqual({
            status: 200,
            headers: expect.objectContaining({"content-type": "application/json"}),
            body: expect.objectContaining({
                spaceId: space.id,
                tasks: [],
                nextCursor: null,
            }),
        });
    });

    test("only returns open tasks when status is [Open]", async () => {
        const space = await TestSpace.create(context);
        const session1 = await space.createSession({name: "Alice Smith", role: "Admin"});
        const session2 = await space.createSession({name: "Bob Johnson"});

        const bot = await TestBot.createAndInstantiate(session1);
        const apiKey = await bot.createApiKey(session1);

        const collection = await TestTaskCollection.create(session1, {
            name: "Status Filter Collection",
            access: "Public",
        });

        // Create tasks with different statuses
        const closedTask = await TestTask.create(session1, {title: "Closed Task"});
        const activeTask = await TestTask.create(session1, {title: "Active Task"});
        const inactiveTask = await TestTask.create(session1, {title: "Inactive Task"});

        await closedTask.addCollection(session1, collection);
        await activeTask.addCollection(session1, collection);
        await inactiveTask.addCollection(session1, collection);

        await closedTask.updateStatus(session1, "Closed");
        await activeTask.updateAssignee(session1, session2, {assigneeStatus: "Active"});
        await inactiveTask.updateAssignee(session1, session2, {assigneeStatus: "Inactive"});

        await ProcessContextModule.waitForTestTasks();

        const response = await server.GET(`/task-collections/${collection.id}/tasks?status=Open`, {
            headers: {authorization: `bearer ${apiKey}`},
        });

        expect(response).toEqual({
            status: 200,
            headers: expect.objectContaining({"content-type": "application/json"}),
            body: expect.objectContaining({
                spaceId: space.id,
                tasks: [
                    expect.objectContaining({
                        id: activeTask.id,
                        title: "Active Task",
                        status: {type: "Open", isActive: true},
                    }),
                    expect.objectContaining({
                        id: inactiveTask.id,
                        title: "Inactive Task",
                        status: {type: "Open", isActive: false},
                    }),
                ],
                nextCursor: null,
            }),
        });
    });

    test("only returns closed tasks when status is [Closed]", async () => {
        const space = await TestSpace.create(context);
        const session1 = await space.createSession({name: "Alice Smith", role: "Admin"});
        const session2 = await space.createSession({name: "Bob Johnson"});

        const bot = await TestBot.createAndInstantiate(session1);
        const apiKey = await bot.createApiKey(session1);

        const collection = await TestTaskCollection.create(session1, {
            name: "Status Filter Collection",
            access: "Public",
        });

        // Create tasks with different statuses
        const closedTask = await TestTask.create(session1, {title: "Closed Task"});
        const activeTask = await TestTask.create(session1, {title: "Active Task"});
        const inactiveTask = await TestTask.create(session1, {title: "Inactive Task"});

        await closedTask.addCollection(session1, collection);
        await activeTask.addCollection(session1, collection);
        await inactiveTask.addCollection(session1, collection);

        await closedTask.updateStatus(session1, "Closed");
        await activeTask.updateAssignee(session1, session2, {assigneeStatus: "Active"});
        await inactiveTask.updateAssignee(session1, session2, {assigneeStatus: "Inactive"});

        await ProcessContextModule.waitForTestTasks();

        const response = await server.GET(
            `/task-collections/${collection.id}/tasks?status=Closed`,
            {
                headers: {authorization: `bearer ${apiKey}`},
            },
        );

        expect(response).toEqual({
            status: 200,
            headers: expect.objectContaining({"content-type": "application/json"}),
            body: expect.objectContaining({
                spaceId: space.id,
                tasks: [
                    expect.objectContaining({
                        id: closedTask.id,
                        title: "Closed Task",
                        status: {type: "Closed"},
                    }),
                ],
                nextCursor: null,
            }),
        });
    });

    test("can filter tasks by status using repeated query parameters", async () => {
        const space = await TestSpace.create(context);
        const session1 = await space.createSession({name: "Alice Smith", role: "Admin"});
        const session2 = await space.createSession({name: "Bob Johnson"});

        const bot = await TestBot.createAndInstantiate(session1);
        const apiKey = await bot.createApiKey(session1);

        const collection = await TestTaskCollection.create(session1, {
            name: "Status Filter Collection",
            access: "Public",
        });

        // Create tasks with different statuses
        const closedTask = await TestTask.create(session1, {title: "Closed Task"});
        const activeTask = await TestTask.create(session1, {title: "Active Task"});
        const inactiveTask = await TestTask.create(session1, {title: "Inactive Task"});

        await closedTask.addCollection(session1, collection);
        await activeTask.addCollection(session1, collection);
        await inactiveTask.addCollection(session1, collection);

        await closedTask.updateStatus(session1, "Closed");
        await activeTask.updateAssignee(session1, session2, {assigneeStatus: "Active"});
        await inactiveTask.updateAssignee(session1, session2, {assigneeStatus: "Inactive"});

        await ProcessContextModule.waitForTestTasks();

        // Filter for Closed and OpenActive using repeated parameters
        const response = await server.GET(
            `/task-collections/${collection.id}/tasks?status=Closed&status=Open`,
            {
                headers: {authorization: `bearer ${apiKey}`},
            },
        );

        expect(response).toEqual({
            status: 200,
            headers: expect.objectContaining({"content-type": "application/json"}),
            body: expect.objectContaining({
                spaceId: space.id,
                tasks: [
                    expect.objectContaining({
                        id: closedTask.id,
                        title: "Closed Task",
                        status: {type: "Closed"},
                    }),
                    expect.objectContaining({
                        id: activeTask.id,
                        title: "Active Task",
                        status: {type: "Open", isActive: true},
                    }),
                    expect.objectContaining({
                        id: inactiveTask.id,
                        title: "Inactive Task",
                        status: {type: "Open", isActive: false},
                    }),
                ],
                nextCursor: null,
            }),
        });
    });

    test("can filter tasks by status using comma-separated values", async () => {
        const space = await TestSpace.create(context);
        const session1 = await space.createSession({name: "Alice Smith", role: "Admin"});
        const session2 = await space.createSession({name: "Bob Johnson"});

        const bot = await TestBot.createAndInstantiate(session1);
        const apiKey = await bot.createApiKey(session1);

        const collection = await TestTaskCollection.create(session1, {
            name: "Comma-Separated Collection",
            access: "Public",
        });

        const closedTask = await TestTask.create(session1, {title: "Closed Task"});
        const activeTask = await TestTask.create(session1, {title: "Active Task"});
        const inactiveTask = await TestTask.create(session1, {title: "Inactive Task"});

        await closedTask.addCollection(session1, collection);
        await activeTask.addCollection(session1, collection);
        await inactiveTask.addCollection(session1, collection);

        await closedTask.updateStatus(session1, "Closed");
        await activeTask.updateAssignee(session1, session2, {assigneeStatus: "Active"});
        await inactiveTask.updateAssignee(session1, session2, {assigneeStatus: "Inactive"});

        await ProcessContextModule.waitForTestTasks();

        // Filter using comma-separated values
        const response = await server.GET(
            `/task-collections/${collection.id}/tasks?status=Open,Closed`,
            {
                headers: {authorization: `bearer ${apiKey}`},
            },
        );

        expect(response).toEqual({
            status: 200,
            headers: expect.objectContaining({"content-type": "application/json"}),
            body: expect.objectContaining({
                spaceId: space.id,
                tasks: [
                    expect.objectContaining({
                        id: closedTask.id,
                        title: "Closed Task",
                        status: {type: "Closed"},
                    }),
                    expect.objectContaining({
                        id: activeTask.id,
                        title: "Active Task",
                        status: {type: "Open", isActive: true},
                    }),
                    expect.objectContaining({
                        id: inactiveTask.id,
                        title: "Inactive Task",
                        status: {type: "Open", isActive: false},
                    }),
                ],
                nextCursor: null,
            }),
        });
    });

    test("returns 400 error for invalid status enum value", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession({name: "Alice Smith", role: "Admin"});

        const bot = await TestBot.createAndInstantiate(session);
        const apiKey = await bot.createApiKey(session);

        const collection = await TestTaskCollection.create(session, {
            name: "Test Collection",
            access: "Public",
        });

        await ProcessContextModule.waitForTestTasks();

        const response = await server.GET(
            `/task-collections/${collection.id}/tasks?status=OpenActive&status=Closed`,
            {
                headers: {authorization: `bearer ${apiKey}`},
            },
        );

        expect(response).toEqual({
            status: 400,
            headers: expect.objectContaining({"content-type": "application/json"}),
            body: {
                error: {
                    message: "Invalid query parameters.",
                    retry: {
                        able: false,
                    },
                },
            },
        });
    });

    test("returns 400 error for unexpected list length (repeat values)", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession({name: "Alice Smith", role: "Admin"});

        const bot = await TestBot.createAndInstantiate(session);
        const apiKey = await bot.createApiKey(session);

        const collection = await TestTaskCollection.create(session, {
            name: "Test Collection",
            access: "Public",
        });

        await ProcessContextModule.waitForTestTasks();

        // Mix of valid and invalid values
        const response = await server.GET(
            `/task-collections/${collection.id}/tasks?status=Closed&status=Closed&status=Open`,
            {
                headers: {authorization: `bearer ${apiKey}`},
            },
        );

        expect(response).toEqual({
            status: 400,
            headers: expect.objectContaining({"content-type": "application/json"}),
            body: {
                error: {
                    message: "Invalid `status` query parameter.",
                    retry: {
                        able: false,
                    },
                },
            },
        });
    });
});
