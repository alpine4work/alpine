import {CalendarDate} from "@internationalized/date";
import {ApiServiceBotActionContext} from "~/server/api/internal/shared/api_service_context.js";
import {apiTasksPaths} from "~/server/api/internal/tasks/api_tasks_paths.js";
import {createTestApiServer} from "~/server/api/internal/test_helpers/create_test_api_server.js";
import {TestBot} from "~/server/bots/test_helpers/test_bot.js";
import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {backfillTaskActionTransactionHistory} from "~/server/tasks/data/backfill_task_action_transaction_history.js";
import {getTaskNotesContentSteps} from "~/server/tasks/data/get_task_notes_content_steps.js";
import {getTaskNotesContentWithoutReferences} from "~/server/tasks/data/get_task_notes_content_without_references.js";
import {tasksInjection} from "~/server/tasks/data/tasks_injection.js";
import {getTaskItemForTest} from "~/server/tasks/data/test_helpers/get_task_item_for_test.js";
import {TestTask} from "~/server/tasks/data/test_helpers/test_task.js";
import {TestTaskCollection} from "~/server/tasks/data/test_helpers/test_task_collection.js";
import {updateTaskNotesContent} from "~/server/tasks/data/update_task_notes_content.js";
import {TestTaskRealtimeServer} from "~/server/tasks/realtime/test_helpers/test_task_realtime_server.js";
import {ProcessContextModule} from "~/shared/context/process_context_module.js";
import {InternalError} from "~/shared/error/error.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {assertId, generateId} from "~/shared/id/id.js";
import {TaskCollectionId, TaskId} from "~/shared/id/types/id_types.js";
import {diffProsemirrorNodes} from "~/shared/prosemirror/diff_prosemirror_nodes.js";
import {
    TaskNotesCollaborationUpdateContentWithDiffRequestBodySchema,
    TaskNotesCollaborationUpdateContentWithDiffResponseBodySchema,
} from "~/shared/tasks/task_notes_collaboration_protocol.js";
import {
    TaskNotesContentProsemirrorSchema,
    assertTaskNotesContent,
} from "~/shared/tasks/task_notes_content_schema.js";

const baseContext = createTestContext({
    shouldStartOpensearch: true,
    tasksInjection,
    sendRequestToDurableObject: async (actualContext, request) => {
        const match = request.url.match(
            /^\/api\/durable-objects\/task-notes\/([^/]+)\/update-content-with-diff/,
        );
        if (!match) return;

        const context = (actualContext as ApiServiceBotActionContext).dynamo
            // Strong consistency isn't required since this logic is test-only. So all requests
            // will be strong consistency implicitly.
            .unexpectStrongReadConsistency();

        const taskId = assertId<TaskId>(match[1]!);

        const requestBody =
            TaskNotesCollaborationUpdateContentWithDiffRequestBodySchema.deserialize(
                request.body ?? null,
            );

        const taskNotes = await getTaskNotesContentWithoutReferences(context, taskId);

        const invertedSteps =
            requestBody.version < taskNotes.version
                ? await getTaskNotesContentSteps(context, {
                      taskId,
                      startVersion: requestBody.version,
                      endVersion: taskNotes.version,
                  })
                : [];

        let oldContent = taskNotes.content;

        for (let index = invertedSteps.length - 1; index >= 0; index--) {
            const step = invertedSteps[index]!;
            const stepResult = step.invertedStep.apply(oldContent);
            if (!stepResult.doc) throw new InternalError(stepResult.failed!);
            oldContent = assertTaskNotesContent(stepResult.doc);
        }

        const requestContent = assertTaskNotesContent(
            TaskNotesContentProsemirrorSchema.nodes.doc.create(null, requestBody.content),
        );

        const steps = diffProsemirrorNodes(oldContent, requestContent);

        const {newVersion} = await updateTaskNotesContent(context, {
            spaceId: taskNotes.spaceId,
            taskId,
            clientVersion: requestBody.version,
            clientSteps: steps,
            clientId: generateId(),
        });

        const newTaskNotes = await getTaskNotesContentWithoutReferences(context, taskId);

        return TaskNotesCollaborationUpdateContentWithDiffResponseBodySchema.serialize({
            ok: true,
            spaceId: taskNotes.spaceId,
            newVersion,
            newContent: newTaskNotes.content,
        });
    },
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
                notes: expect.objectContaining({
                    version: 1,
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

test("does not return deleted task collections when reading a task", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession({name: "Alice Smith", role: "Admin"});

    const bot = await TestBot.createAndInstantiate(session);
    const apiKey = await bot.createApiKey(session);

    const activeCollection = await TestTaskCollection.create(session, {name: "Active"});
    const deletedCollection = await TestTaskCollection.create(session, {name: "Deleted"});
    const task = await TestTask.create(session, {
        title: "Task with stale collection",
        collections: [activeCollection, deletedCollection],
    });

    await deletedCollection.delete(session);
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
                collections: [{collection: {id: activeCollection.id}}],
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
                collections: [],
                notes: {
                    version: 0,
                    content: {
                        elements: [
                            {
                                type: "Paragraph",
                                key: expect.any(String),
                                elements: [],
                            },
                        ],
                    },
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

    const startTime = new Date();
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
                notes: expect.objectContaining({
                    version: 0,
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
        }),
    });

    const actor = {
        accountId: bot.id,
        from: {type: "Bot", accountId: bot.id},
    };

    expect(
        await backfillTaskActionTransactionHistory(space.systemAction(), space.id, startTime),
    ).toEqual([
        expect.objectContaining({
            actions: [
                expect.objectContaining({
                    type: "UpdateTask",
                    taskId: response.body.task.id,
                    taskAction: expect.objectContaining({type: "Create"}),
                }),
                expect.objectContaining({
                    type: "UpdateTask",
                    actor,
                    taskId: response.body.task.id,
                    taskAction: expect.objectContaining({type: "UpdateTitle"}),
                }),
                expect.objectContaining({
                    type: "UpdateTask",
                    actor,
                    taskId: response.body.task.id,
                    taskAction: expect.objectContaining({type: "UpdateAssignee"}),
                }),
                expect.objectContaining({
                    type: "UpdateTask",
                    actor,
                    taskId: response.body.task.id,
                    taskAction: expect.objectContaining({type: "UpdateDueDate"}),
                }),
                expect.objectContaining({
                    type: "UpdateTask",
                    actor,
                    taskId: response.body.task.id,
                    taskAction: expect.objectContaining({type: "UpdatePriority"}),
                }),
            ],
        }),
    ]);
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

test("can create a project task with parent task and collections", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession({name: "Alice Smith", role: "Admin"});

    const bot = await TestBot.createAndInstantiate(session);
    const apiKey = await bot.createApiKey(session);

    const parentTask = await TestTask.create(session, {title: "Parent task"});
    const collections = await runAllPromises([
        TestTaskCollection.create(session, {name: "Roadmap"}),
        TestTaskCollection.create(session, {name: "Engineering"}),
    ]);

    await ProcessContextModule.waitForTestTasks();

    const response = await server.POST("/tasks", {
        headers: {authorization: `bearer ${apiKey}`},
        body: {
            spaceId: space.id,
            task: {
                title: "Project task",
                layout: {type: "Project"},
                parent: {task: {id: parentTask.id}},
                collections: collections.map(collection => ({
                    collection: {id: collection.id},
                })),
            },
        },
    });

    expect(response).toMatchObject({
        status: 200,
        body: {
            spaceId: space.id,
            task: expect.objectContaining({
                title: "Project task",
                layout: {type: "Project"},
                parent: {task: {id: parentTask.id}},
                collections: collections.map(collection => ({
                    collection: {id: collection.id},
                })),
            }),
        },
    });

    const taskModel = await context
        .getTaskRealtimeServer()
        .action(session)
        .tasks.getTaskWithoutDependencies(space.id, response.body.task.id, {
            consistency: "StrongWithinCache",
        });

    expect(taskModel.getParent()?.taskId).toEqual(parentTask.id);
    expect(taskModel.getLayout()).toEqual("Project");
    expect(
        taskModel
            .getCollections()
            .getArray()
            .map(({collectionId}) => collectionId),
    ).toEqual(collections.map(collection => collection.id));
});

// NOTE: File attachment is tested through the full API flow where the bot uploads
// a file first via POST /files, then references it in the task content. The unit
// test would need the bot's own file upload which isn't set up in TestFile.create.
// The handler follows the same attachFileToTargetAsBot pattern as POST /documents.

test("can update a task title", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession({name: "Alice Smith", role: "Admin"});

    const bot = await TestBot.createAndInstantiate(session);
    const apiKey = await bot.createApiKey(session);

    const task = await TestTask.create(session, {title: "Original Title"});

    await ProcessContextModule.waitForTestTasks();

    const startTime = new Date();
    const response = await server.PATCH(`/tasks/${task.id}`, {
        headers: {authorization: `bearer ${apiKey}`},
        body: {
            actor: {id: session.account.id},
            patches: [{type: "SetTitle", title: "Updated Title"}],
        },
    });

    expect(response).toMatchObject({
        status: 200,
        body: expect.objectContaining({
            task: expect.objectContaining({
                id: task.id,
                title: "Updated Title",
            }),
        }),
    });

    expect(
        await backfillTaskActionTransactionHistory(space.systemAction(), space.id, startTime),
    ).toEqual([
        expect.objectContaining({
            actions: [
                expect.objectContaining({
                    type: "UpdateTask",
                    taskId: task.id,
                    actor: {
                        accountId: session.account.id,
                        from: {type: "Bot", accountId: bot.id},
                    },
                    taskAction: expect.objectContaining({type: "UpdateTitle"}),
                }),
            ],
        }),
    ]);
});

test("returns 403 when updating a task with an actor outside the space", async () => {
    const space = await TestSpace.create(context);
    const otherSpace = await TestSpace.create(context);
    const session = await space.createSession({name: "Alice Smith", role: "Admin"});
    const otherSession = await otherSpace.createSession({name: "Mallory Example"});

    const bot = await TestBot.createAndInstantiate(session);
    const apiKey = await bot.createApiKey(session);

    const task = await TestTask.create(session, {title: "Original Title"});

    await ProcessContextModule.waitForTestTasks();

    const response = await server.PATCH(`/tasks/${task.id}`, {
        headers: {authorization: `bearer ${apiKey}`},
        body: {
            actor: {id: otherSession.account.id},
            patches: [{type: "SetTitle", title: "Updated Title"}],
        },
    });

    expect(response).toEqual({
        status: 403,
        headers: expect.objectContaining({"content-type": "application/json"}),
        body: expect.objectContaining({
            error: expect.objectContaining({
                message: "API actor must be a member of the space",
            }),
        }),
    });
});

test("can read task notes content", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession({name: "Alice Smith", role: "Admin"});

    const bot = await TestBot.createAndInstantiate(session);
    const apiKey = await bot.createApiKey(session);

    const task = await TestTask.create(session, {title: "Task with Notes"});
    await task.typeNotes(session, "These are the task notes.");

    await ProcessContextModule.waitForTestTasks();

    const response = await server.GET(`/tasks/${task.id}/notes`, {
        headers: {authorization: `bearer ${apiKey}`},
    });

    expect(response).toMatchObject({
        status: 200,
        body: expect.objectContaining({
            spaceId: space.id,
            notes: expect.objectContaining({
                version: expect.any(Number),
                content: expect.objectContaining({
                    elements: expect.arrayContaining([
                        expect.objectContaining({
                            type: "Paragraph",
                            elements: expect.arrayContaining([
                                expect.objectContaining({
                                    type: "Text",
                                    text: "These are the task notes.",
                                }),
                            ]),
                        }),
                    ]),
                }),
            }),
        }),
    });
});

test("can update task notes content", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession({name: "Alice Smith", role: "Admin"});

    const bot = await TestBot.createAndInstantiate(session);
    const apiKey = await bot.createApiKey(session);

    const task = await TestTask.create(session, {title: "Task with Notes"});
    await task.typeNotes(session, "Old notes");

    await ProcessContextModule.waitForTestTasks();

    const getResponse = await server.GET(`/tasks/${task.id}/notes`, {
        headers: {authorization: `bearer ${apiKey}`},
    });

    const response = await server.PATCH(`/tasks/${task.id}/notes`, {
        headers: {authorization: `bearer ${apiKey}`},
        body: {
            notes: {
                version: getResponse.body.notes.version,
                content: {
                    elements: [
                        {
                            type: "Paragraph",
                            elements: [{type: "Text", text: "Updated notes"}],
                        },
                    ],
                },
            },
        },
    });

    expect(response).toMatchObject({
        status: 200,
        body: expect.objectContaining({
            spaceId: space.id,
            notes: expect.objectContaining({
                version: expect.any(Number),
                content: expect.objectContaining({
                    elements: expect.arrayContaining([
                        expect.objectContaining({
                            type: "Paragraph",
                            elements: expect.arrayContaining([
                                expect.objectContaining({
                                    type: "Text",
                                    text: "Updated notes",
                                }),
                            ]),
                        }),
                    ]),
                }),
            }),
        }),
    });
    expect(response.body.notes.version).toBeGreaterThan(getResponse.body.notes.version);
});

test("can update task status to closed", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession({name: "Alice Smith", role: "Admin"});

    const bot = await TestBot.createAndInstantiate(session);
    const apiKey = await bot.createApiKey(session);

    const task = await TestTask.create(session, {title: "Open Task"});

    await ProcessContextModule.waitForTestTasks();

    const response = await server.PATCH(`/tasks/${task.id}`, {
        headers: {authorization: `bearer ${apiKey}`},
        body: {
            patches: [{type: "SetStatus", status: {type: "Closed"}}],
        },
    });

    expect(response).toMatchObject({
        status: 200,
        body: expect.objectContaining({
            task: expect.objectContaining({
                title: "Open Task",
                status: {type: "Closed"},
            }),
        }),
    });
});

test("can update multiple task fields at once", async () => {
    const space = await TestSpace.create(context);
    const session1 = await space.createSession({name: "Alice Smith", role: "Admin"});
    const session2 = await space.createSession({name: "Bob Johnson"});

    const bot = await TestBot.createAndInstantiate(session1);
    const apiKey = await bot.createApiKey(session1);

    const task = await TestTask.create(session1, {title: "Basic Task"});

    await ProcessContextModule.waitForTestTasks();

    const startTime = new Date();
    const response = await server.PATCH(`/tasks/${task.id}`, {
        headers: {authorization: `bearer ${apiKey}`},
        body: {
            actor: {id: session1.account.id},
            patches: [
                {type: "SetTitle", title: "Updated Task"},
                {type: "SetAssignee", assignee: session2.account.id},
                {type: "SetPriority", priority: "Urgent"},
                {type: "SetDueDate", due: {date: "2026-06-15"}},
            ],
        },
    });

    expect(response).toMatchObject({
        status: 200,
        body: expect.objectContaining({
            task: expect.objectContaining({
                title: "Updated Task",
                assignee: expect.objectContaining({
                    id: session2.account.id,
                    name: "Bob Johnson",
                }),
                priority: "Urgent",
                due: {date: "2026-06-15"},
            }),
        }),
    });

    const actor = {
        accountId: session1.account.id,
        from: {type: "Bot", accountId: bot.id},
    };

    expect(
        await backfillTaskActionTransactionHistory(space.systemAction(), space.id, startTime),
    ).toEqual([
        expect.objectContaining({
            actions: [
                expect.objectContaining({
                    type: "UpdateTask",
                    actor,
                    taskId: task.id,
                    taskAction: expect.objectContaining({type: "UpdateTitle"}),
                }),
                expect.objectContaining({
                    type: "UpdateTask",
                    actor,
                    taskId: task.id,
                    taskAction: expect.objectContaining({type: "UpdateDueDate"}),
                }),
                expect.objectContaining({
                    type: "UpdateTask",
                    actor,
                    taskId: task.id,
                    taskAction: expect.objectContaining({type: "UpdatePriority"}),
                }),
                expect.objectContaining({
                    type: "UpdateTask",
                    actor,
                    taskId: task.id,
                    taskAction: expect.objectContaining({type: "UpdateAssignee"}),
                }),
            ],
        }),
    ]);
});

test("can clear nullable task fields with null", async () => {
    const space = await TestSpace.create(context);
    const session1 = await space.createSession({name: "Alice Smith", role: "Admin"});
    const session2 = await space.createSession({name: "Bob Johnson"});

    const bot = await TestBot.createAndInstantiate(session1);
    const apiKey = await bot.createApiKey(session1);

    const task = await TestTask.create(session1, {
        title: "Task with Fields",
        assignee: session2,
        priority: "High",
        dueDate: new CalendarDate(2026, 12, 31),
    });

    await ProcessContextModule.waitForTestTasks();

    const response = await server.PATCH(`/tasks/${task.id}`, {
        headers: {authorization: `bearer ${apiKey}`},
        body: {
            patches: [
                {type: "SetAssignee", assignee: null},
                {type: "SetPriority", priority: null},
                {type: "SetDueDate", due: null},
            ],
        },
    });

    expect(response).toMatchObject({
        status: 200,
        body: expect.objectContaining({
            task: expect.objectContaining({
                title: "Task with Fields",
            }),
        }),
    });

    // Verify cleared fields are not present
    expect(response.body.task.assignee).toBeUndefined();
    expect(response.body.task.priority).toBeUndefined();
    expect(response.body.task.due).toBeUndefined();
});

test("can update task layout", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession({name: "Alice Smith", role: "Admin"});

    const bot = await TestBot.createAndInstantiate(session);
    const apiKey = await bot.createApiKey(session);

    const task = await TestTask.create(session, {title: "Layout Task"});

    await ProcessContextModule.waitForTestTasks();

    const projectResponse = await server.PATCH(`/tasks/${task.id}`, {
        headers: {authorization: `bearer ${apiKey}`},
        body: {
            patches: [{type: "SetLayout", layout: {type: "Project"}}],
        },
    });

    expect(projectResponse).toMatchObject({
        status: 200,
        body: {
            task: expect.objectContaining({
                id: task.id,
                layout: {type: "Project"},
            }),
        },
    });

    const taskResponse = await server.PATCH(`/tasks/${task.id}`, {
        headers: {authorization: `bearer ${apiKey}`},
        body: {
            patches: [{type: "SetLayout", layout: null}],
        },
    });

    expect(taskResponse.status).toBe(200);
    expect(taskResponse.body.task.layout).toBeUndefined();
});

test("can update and clear parent task", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession({name: "Alice Smith", role: "Admin"});

    const bot = await TestBot.createAndInstantiate(session);
    const apiKey = await bot.createApiKey(session);

    const parentTask = await TestTask.create(session, {title: "Parent task"});
    const task = await TestTask.create(session, {title: "Child task"});

    await ProcessContextModule.waitForTestTasks();

    const setResponse = await server.PATCH(`/tasks/${task.id}`, {
        headers: {authorization: `bearer ${apiKey}`},
        body: {
            patches: [{type: "SetParent", parent: {task: {id: parentTask.id}}}],
        },
    });

    expect(setResponse).toMatchObject({
        status: 200,
        body: {
            task: expect.objectContaining({
                id: task.id,
                parent: {task: {id: parentTask.id}},
            }),
        },
    });

    const clearResponse = await server.PATCH(`/tasks/${task.id}`, {
        headers: {authorization: `bearer ${apiKey}`},
        body: {
            patches: [{type: "SetParent", parent: null}],
        },
    });

    expect(clearResponse.status).toBe(200);
    expect(clearResponse.body.task.parent).toBeUndefined();
});

test("patch only changes the fields that are passed", async () => {
    const space = await TestSpace.create(context);
    const session1 = await space.createSession({name: "Alice Smith", role: "Admin"});
    const session2 = await space.createSession({name: "Bob Johnson"});

    const bot = await TestBot.createAndInstantiate(session1);
    const apiKey = await bot.createApiKey(session1);

    const task = await TestTask.create(session1, {
        title: "Original Title",
        assignee: session2,
        priority: "High",
        dueDate: new CalendarDate(2026, 12, 31),
    });

    await ProcessContextModule.waitForTestTasks();

    // Only update the title, everything else should stay the same
    const response = await server.PATCH(`/tasks/${task.id}`, {
        headers: {authorization: `bearer ${apiKey}`},
        body: {
            patches: [{type: "SetTitle", title: "New Title"}],
        },
    });

    expect(response).toMatchObject({
        status: 200,
        body: expect.objectContaining({
            task: expect.objectContaining({
                title: "New Title",
                assignee: expect.objectContaining({
                    id: session2.account.id,
                    name: "Bob Johnson",
                }),
                priority: "High",
                due: {date: "2026-12-31"},
            }),
        }),
    });
});

test("clearing assignee via patch sets status to inactive", async () => {
    const space = await TestSpace.create(context);
    const session1 = await space.createSession({name: "Alice Smith", role: "Admin"});
    const session2 = await space.createSession({name: "Bob Johnson"});

    const bot = await TestBot.createAndInstantiate(session1);
    const apiKey = await bot.createApiKey(session1);

    const task = await TestTask.create(session1, {title: "Active Task"});
    await task.updateAssignee(session1, session2, {assigneeStatus: "Active"});

    await ProcessContextModule.waitForTestTasks();

    const response = await server.PATCH(`/tasks/${task.id}`, {
        headers: {authorization: `bearer ${apiKey}`},
        body: {
            patches: [{type: "SetAssignee", assignee: null}],
        },
    });

    expect(response).toMatchObject({
        status: 200,
        body: expect.objectContaining({
            task: expect.objectContaining({
                status: {type: "Open", isActive: false},
            }),
        }),
    });
    expect(response.body.task.assignee).toBeUndefined();
});

test("setting active status without assignee auto-assigns the bot", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession({name: "Alice Smith", role: "Admin"});

    const bot = await TestBot.createAndInstantiate(session);
    const apiKey = await bot.createApiKey(session);

    const task = await TestTask.create(session, {title: "No Assignee Task"});

    await ProcessContextModule.waitForTestTasks();

    const response = await server.PATCH(`/tasks/${task.id}`, {
        headers: {authorization: `bearer ${apiKey}`},
        body: {
            patches: [{type: "SetStatus", status: {type: "Open", isActive: true}}],
        },
    });

    expect(response).toMatchObject({
        status: 200,
        body: expect.objectContaining({
            task: expect.objectContaining({
                assignee: expect.objectContaining({
                    id: bot.id,
                    name: bot.initialName,
                }),
                status: {type: "Open", isActive: true},
            }),
        }),
    });
});

test("can set active status when task already has an assignee", async () => {
    const space = await TestSpace.create(context);
    const session1 = await space.createSession({name: "Alice Smith", role: "Admin"});
    const session2 = await space.createSession({name: "Bob Johnson"});

    const bot = await TestBot.createAndInstantiate(session1);
    const apiKey = await bot.createApiKey(session1);

    const task = await TestTask.create(session1, {title: "Assigned Task"});
    await task.updateAssignee(session1, session2);

    await ProcessContextModule.waitForTestTasks();

    const response = await server.PATCH(`/tasks/${task.id}`, {
        headers: {authorization: `bearer ${apiKey}`},
        body: {
            patches: [{type: "SetStatus", status: {type: "Open", isActive: true}}],
        },
    });

    expect(response).toMatchObject({
        status: 200,
        body: expect.objectContaining({
            task: expect.objectContaining({
                assignee: expect.objectContaining({
                    id: session2.account.id,
                    name: "Bob Johnson",
                }),
                status: {type: "Open", isActive: true},
            }),
        }),
    });
});

test("can set an active task back to inactive without clearing assignee", async () => {
    const space = await TestSpace.create(context);
    const session1 = await space.createSession({name: "Alice Smith", role: "Admin"});
    const session2 = await space.createSession({name: "Bob Johnson"});

    const bot = await TestBot.createAndInstantiate(session1);
    const apiKey = await bot.createApiKey(session1);

    const task = await TestTask.create(session1, {title: "Active Task"});
    await task.updateAssignee(session1, session2, {assigneeStatus: "Active"});

    await ProcessContextModule.waitForTestTasks();

    const response = await server.PATCH(`/tasks/${task.id}`, {
        headers: {authorization: `bearer ${apiKey}`},
        body: {
            patches: [{type: "SetStatus", status: {type: "Open", isActive: false}}],
        },
    });

    expect(response).toMatchObject({
        status: 200,
        body: expect.objectContaining({
            task: expect.objectContaining({
                assignee: expect.objectContaining({
                    id: session2.account.id,
                    name: "Bob Johnson",
                }),
                status: {type: "Open", isActive: false},
            }),
        }),
    });
});

test("setting active status while clearing assignee auto-assigns the bot", async () => {
    const space = await TestSpace.create(context);
    const session1 = await space.createSession({name: "Alice Smith", role: "Admin"});
    const session2 = await space.createSession({name: "Bob Johnson"});

    const bot = await TestBot.createAndInstantiate(session1);
    const apiKey = await bot.createApiKey(session1);

    const task = await TestTask.create(session1, {title: "Task"});
    await task.updateAssignee(session1, session2);

    await ProcessContextModule.waitForTestTasks();

    const response = await server.PATCH(`/tasks/${task.id}`, {
        headers: {authorization: `bearer ${apiKey}`},
        body: {
            patches: [
                {type: "SetAssignee", assignee: null},
                {type: "SetStatus", status: {type: "Open", isActive: true}},
            ],
        },
    });

    expect(response).toMatchObject({
        status: 200,
        body: expect.objectContaining({
            task: expect.objectContaining({
                assignee: expect.objectContaining({
                    id: bot.id,
                    name: bot.initialName,
                }),
                status: {type: "Open", isActive: true},
            }),
        }),
    });
});

test("setting active status before changing assignee keeps the task active", async () => {
    const space = await TestSpace.create(context);
    const session1 = await space.createSession({name: "Alice Smith", role: "Admin"});
    const session2 = await space.createSession({name: "Bob Johnson"});

    const bot = await TestBot.createAndInstantiate(session1);
    const apiKey = await bot.createApiKey(session1);

    const task = await TestTask.create(session1, {title: "Task"});
    await task.updateAssignee(session1, session1, {assigneeStatus: "Active"});

    await ProcessContextModule.waitForTestTasks();

    const response = await server.PATCH(`/tasks/${task.id}`, {
        headers: {authorization: `bearer ${apiKey}`},
        body: {
            patches: [
                {type: "SetStatus", status: {type: "Open", isActive: true}},
                {type: "SetAssignee", assignee: session2.account.id},
            ],
        },
    });

    expect(response).toMatchObject({
        status: 200,
        body: expect.objectContaining({
            task: expect.objectContaining({
                assignee: expect.objectContaining({
                    id: session2.account.id,
                    name: "Bob Johnson",
                }),
                status: {type: "Open", isActive: true},
            }),
        }),
    });
});

test("last title patch wins when updating the title multiple times", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession({name: "Alice Smith", role: "Admin"});

    const bot = await TestBot.createAndInstantiate(session);
    const apiKey = await bot.createApiKey(session);

    const task = await TestTask.create(session, {title: "Original Title"});

    await ProcessContextModule.waitForTestTasks();

    const response = await server.PATCH(`/tasks/${task.id}`, {
        headers: {authorization: `bearer ${apiKey}`},
        body: {
            patches: [
                {type: "SetTitle", title: "Intermediate Title"},
                {type: "SetTitle", title: "Final Title"},
            ],
        },
    });

    expect(response).toMatchObject({
        status: 200,
        body: expect.objectContaining({
            task: expect.objectContaining({
                id: task.id,
                title: "Final Title",
            }),
        }),
    });
});

test("can clear and reassign before setting active in the same patch request", async () => {
    const space = await TestSpace.create(context);
    const session1 = await space.createSession({name: "Alice Smith", role: "Admin"});
    const session2 = await space.createSession({name: "Bob Johnson"});

    const bot = await TestBot.createAndInstantiate(session1);
    const apiKey = await bot.createApiKey(session1);

    const task = await TestTask.create(session1, {title: "Task"});
    await task.updateAssignee(session1, session1);

    await ProcessContextModule.waitForTestTasks();

    const response = await server.PATCH(`/tasks/${task.id}`, {
        headers: {authorization: `bearer ${apiKey}`},
        body: {
            patches: [
                {type: "SetAssignee", assignee: null},
                {type: "SetStatus", status: {type: "Open", isActive: true}},
                {type: "SetAssignee", assignee: session2.account.id},
            ],
        },
    });

    expect(response).toMatchObject({
        status: 200,
        body: expect.objectContaining({
            task: expect.objectContaining({
                assignee: expect.objectContaining({
                    id: session2.account.id,
                    name: "Bob Johnson",
                }),
                status: {type: "Open", isActive: true},
            }),
        }),
    });
});

test("adding collections through repeated patch requests appends them to the end", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession({name: "Alice Smith", role: "Admin"});

    const bot = await TestBot.createAndInstantiate(session);
    const apiKey = await bot.createApiKey(session);

    const initialCollection = await TestTaskCollection.create(session, {name: "Initial"});
    const task = await TestTask.create(session, {
        title: "Task",
        collections: initialCollection,
    });
    const appendedCollections = await runAllPromises(
        Array.from({length: 5}, (_, index) =>
            TestTaskCollection.create(session, {name: `Collection ${index + 1}`}),
        ),
    );

    await ProcessContextModule.waitForTestTasks();

    for (const collection of appendedCollections) {
        const response = await server.PATCH(`/tasks/${task.id}`, {
            headers: {authorization: `bearer ${apiKey}`},
            body: {
                patches: [{type: "AddCollection", item: {collection: {id: collection.id}}}],
            },
        });

        expect(response.status).toBe(200);
    }

    const updatedTask = await context
        .getTaskRealtimeServer()
        .action(session)
        .tasks.getTaskWithoutDependencies(space.id, task.id, {
            consistency: "StrongWithinCache",
        });

    expect(
        updatedTask
            .getCollections()
            .getArray()
            .map(({collectionId}) => collectionId),
    ).toEqual([initialCollection.id, ...appendedCollections.map(collection => collection.id)]);
});

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

test("can create a task collection", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession({name: "Alice Smith", role: "Admin"});

    const bot = await TestBot.createAndInstantiate(session);
    const apiKey = await bot.createApiKey(session);

    await ProcessContextModule.waitForTestTasks();

    const startTime = new Date();
    const response = await server.POST("/task-collections", {
        headers: {authorization: `bearer ${apiKey}`},
        body: {
            spaceId: space.id,
            collection: {
                name: "My Project Tasks",
                color: "Blue",
            },
        },
    });

    expect(response).toEqual({
        status: 200,
        headers: expect.objectContaining({"content-type": "application/json"}),
        body: expect.objectContaining({
            spaceId: space.id,
            collection: expect.objectContaining({
                id: expect.any(String),
                creator: {id: bot.id},
                name: "My Project Tasks",
                color: "Blue",
            }),
        }),
    });

    expect(
        await backfillTaskActionTransactionHistory(space.systemAction(), space.id, startTime),
    ).toEqual([
        expect.objectContaining({
            actions: [
                expect.objectContaining({
                    type: "UpdateCollection",
                    collectionId: response.body.collection.id,
                    collectionAction: expect.objectContaining({type: "Create"}),
                }),
                expect.objectContaining({
                    type: "UpdateCollection",
                    actor: {
                        accountId: bot.id,
                        from: {type: "Bot", accountId: bot.id},
                    },
                    collectionId: response.body.collection.id,
                    collectionAction: {type: "UpdateColor", color: "blue"},
                }),
            ],
        }),
    ]);
});

test("can create a task collection with creator", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession({name: "Alice Smith", role: "Admin"});
    const otherSession = await space.createSession({name: "Bob Johnson"});

    const bot = await TestBot.createAndInstantiate(session);
    const apiKey = await bot.createApiKey(session);

    await ProcessContextModule.waitForTestTasks();

    const response = await server.POST("/task-collections", {
        headers: {authorization: `bearer ${apiKey}`},
        body: {
            spaceId: space.id,
            collection: {
                creator: {id: otherSession.account.id},
                name: "Bob\u2019s Tasks",
                color: "Green",
            },
        },
    });

    expect(response).toEqual({
        status: 200,
        headers: expect.objectContaining({"content-type": "application/json"}),
        body: expect.objectContaining({
            spaceId: space.id,
            collection: expect.objectContaining({
                id: expect.any(String),
                creator: {id: otherSession.account.id},
                name: "Bob\u2019s Tasks",
                color: "Green",
            }),
        }),
    });
});

test("can update a task collection name", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession({name: "Alice Smith", role: "Admin"});

    const bot = await TestBot.createAndInstantiate(session);
    const apiKey = await bot.createApiKey(session);

    const collection = await TestTaskCollection.create(session, {
        name: "Original Name",
        access: "Public",
    });

    await ProcessContextModule.waitForTestTasks();

    const startTime = new Date();
    const response = await server.PATCH(`/task-collections/${collection.id}`, {
        headers: {authorization: `bearer ${apiKey}`},
        body: {
            actor: {id: session.account.id},
            patches: [{type: "SetName", name: "Updated Name"}],
        },
    });

    expect(response).toMatchObject({
        status: 200,
        body: expect.objectContaining({
            collection: expect.objectContaining({
                id: collection.id,
                name: "Updated Name",
            }),
        }),
    });

    expect(
        await backfillTaskActionTransactionHistory(space.systemAction(), space.id, startTime),
    ).toEqual([
        expect.objectContaining({
            actions: [
                expect.objectContaining({
                    type: "UpdateCollection",
                    collectionId: collection.id,
                    actor: {
                        accountId: session.account.id,
                        from: {type: "Bot", accountId: bot.id},
                    },
                    collectionAction: {type: "UpdateName", name: "Updated Name"},
                }),
            ],
        }),
    ]);
});

test("returns 403 when updating a task collection with an actor outside the space", async () => {
    const space = await TestSpace.create(context);
    const otherSpace = await TestSpace.create(context);
    const session = await space.createSession({name: "Alice Smith", role: "Admin"});
    const otherSession = await otherSpace.createSession({name: "Mallory Example"});

    const bot = await TestBot.createAndInstantiate(session);
    const apiKey = await bot.createApiKey(session);

    const collection = await TestTaskCollection.create(session, {
        name: "Original Name",
        access: "Public",
    });

    await ProcessContextModule.waitForTestTasks();

    const response = await server.PATCH(`/task-collections/${collection.id}`, {
        headers: {authorization: `bearer ${apiKey}`},
        body: {
            actor: {id: otherSession.account.id},
            patches: [{type: "SetName", name: "Updated Name"}],
        },
    });

    expect(response).toEqual({
        status: 403,
        headers: expect.objectContaining({"content-type": "application/json"}),
        body: expect.objectContaining({
            error: expect.objectContaining({
                message: "API actor must be a member of the space",
            }),
        }),
    });
});

test("can update multiple task collection fields at once", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession({name: "Alice Smith", role: "Admin"});

    const bot = await TestBot.createAndInstantiate(session);
    const apiKey = await bot.createApiKey(session);

    const collection = await TestTaskCollection.create(session, {
        name: "Original Name",
        access: "Public",
    });

    await ProcessContextModule.waitForTestTasks();

    const startTime = new Date();
    const response = await server.PATCH(`/task-collections/${collection.id}`, {
        headers: {authorization: `bearer ${apiKey}`},
        body: {
            actor: {id: session.account.id},
            patches: [
                {type: "SetName", name: "Updated Name"},
                {type: "SetColor", color: "Purple"},
            ],
        },
    });

    expect(response).toMatchObject({
        status: 200,
        body: expect.objectContaining({
            collection: expect.objectContaining({
                id: collection.id,
                name: "Updated Name",
                color: "Purple",
            }),
        }),
    });

    const actor = {
        accountId: session.account.id,
        from: {type: "Bot", accountId: bot.id},
    };

    expect(
        await backfillTaskActionTransactionHistory(space.systemAction(), space.id, startTime),
    ).toEqual([
        expect.objectContaining({
            actions: [
                expect.objectContaining({
                    type: "UpdateCollection",
                    actor,
                    collectionId: collection.id,
                    collectionAction: {type: "UpdateName", name: "Updated Name"},
                }),
                expect.objectContaining({
                    type: "UpdateCollection",
                    actor,
                    collectionId: collection.id,
                    collectionAction: {type: "UpdateColor", color: "purple"},
                }),
            ],
        }),
    ]);
});

test("can clear task collection color with null", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession({name: "Alice Smith", role: "Admin"});

    const bot = await TestBot.createAndInstantiate(session);
    const apiKey = await bot.createApiKey(session);

    const collection = await TestTaskCollection.create(session, {
        name: "Colorful Collection",
        access: "Public",
        color: "blue",
    });

    await ProcessContextModule.waitForTestTasks();

    const response = await server.PATCH(`/task-collections/${collection.id}`, {
        headers: {authorization: `bearer ${apiKey}`},
        body: {
            patches: [{type: "SetColor", color: null}],
        },
    });

    expect(response).toMatchObject({
        status: 200,
        body: expect.objectContaining({
            collection: expect.objectContaining({
                id: collection.id,
                name: "Colorful Collection",
            }),
        }),
    });

    expect(response.body.collection.color).toBeUndefined();
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
        body: {
            spaceId: space.id,
            collection: {
                id: collection.id,
                creator: {id: session.account.id},
                name: "My Project Tasks",
            },
        },
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
            collection: expect.objectContaining({
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
                        collections: [{collection: {id: collection.id}}],
                    },
                    {
                        creator: {id: session.account.id},
                        id: task2.id,
                        title: "Second Task",
                        status: {type: "Open", isActive: false},
                        collections: [{collection: {id: collection.id}}],
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
                        collections: [{collection: {id: collection.id}}],
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
                        collections: [{collection: {id: collection.id}}],
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

    test("does not return deleted collection references on listed tasks", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession({name: "Alice Smith", role: "Admin"});

        const bot = await TestBot.createAndInstantiate(session);
        const apiKey = await bot.createApiKey(session);

        const activeCollection = await TestTaskCollection.create(session, {
            name: "Active Collection",
            access: "Public",
        });
        const deletedCollection = await TestTaskCollection.create(session, {
            name: "Deleted Collection",
            access: "Public",
        });
        const task = await TestTask.create(session, {
            title: "Task in active and deleted collections",
            collections: [activeCollection, deletedCollection],
        });

        await deletedCollection.delete(session);
        await ProcessContextModule.waitForTestTasks();

        const response = await server.GET(`/task-collections/${activeCollection.id}/tasks`, {
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
                        collections: [{collection: {id: activeCollection.id}}],
                    }),
                ],
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
