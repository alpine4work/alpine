import {CalendarDate} from "@internationalized/date";
import {ApiServiceBotActionContext} from "~/server/api/internal/shared/api_service_context.js";
import {apiTasksPaths} from "~/server/api/internal/tasks/api_tasks_paths.js";
import {createTestApiServer} from "~/server/api/internal/test_helpers/create_test_api_server.js";
import {TestBot} from "~/server/bots/test_helpers/test_bot.js";
import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {TestSpaceSession} from "~/server/spaces/test_helpers/test_space_session.js";
import {backfillTaskActionTransactionHistory} from "~/server/tasks/data/backfill_task_action_transaction_history.js";
import {getTaskNotesContentSteps} from "~/server/tasks/data/get_task_notes_content_steps.js";
import {getTaskNotesContentWithoutReferences} from "~/server/tasks/data/get_task_notes_content_without_references.js";
import {getTaskQueryNormalizedSortCursorForIndexDoc} from "~/server/tasks/data/get_task_query_normalized_sort_cursor_for_index_doc.js";
import {tasksInjection} from "~/server/tasks/data/tasks_injection.js";
import {getTaskItemForTest} from "~/server/tasks/data/test_helpers/get_task_item_for_test.js";
import {TestTask} from "~/server/tasks/data/test_helpers/test_task.js";
import {testTaskClock} from "~/server/tasks/data/test_helpers/test_task_clock.js";
import {TestTaskCollection} from "~/server/tasks/data/test_helpers/test_task_collection.js";
import {updateTaskNotesContent} from "~/server/tasks/data/update_task_notes_content.js";
import {TestTaskRealtimeServer} from "~/server/tasks/realtime/test_helpers/test_task_realtime_server.js";
import {ProcessContextModule} from "~/shared/context/process_context_module.js";
import {InternalError} from "~/shared/error/error.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {zeroHybridLogicalTime} from "~/shared/helpers/clock/hybrid_logical_clock.js";
import {initialOrderKey} from "~/shared/helpers/sort/order_key.js";
import {assertId, generateId} from "~/shared/id/id.js";
import {TaskCollectionId, TaskId} from "~/shared/id/types/id_types.js";
import {diffProsemirrorNodes} from "~/shared/prosemirror/diff_prosemirror_nodes.js";
import {TaskUpdateTaskAction} from "~/shared/tasks/actions/task_action.js";
import {encodeApiTaskQueryCursor} from "~/shared/tasks/model/api_task_query_cursor_encoder.js";
import {
    TaskNotesCollaborationUpdateContentWithDiffRequestBodySchema,
    TaskNotesCollaborationUpdateContentWithDiffResponseBodySchema,
} from "~/shared/tasks/task_notes_collaboration_protocol.js";
import {
    TaskNotesContentProsemirrorSchema,
    assertTaskNotesContent,
} from "~/shared/tasks/task_notes_content_schema.js";
import {TaskPosition} from "~/shared/tasks/task_position.js";
import {TaskQueryNormalizedSort} from "~/shared/tasks/task_query_normalized_sort.js";

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

async function getTaskUpdateActionsSince(space: TestSpace, startTime: Date) {
    const transactions = await backfillTaskActionTransactionHistory(
        space.systemAction(),
        space.id,
        startTime,
    );

    return transactions
        .flatMap(transaction => transaction.actions)
        .filter((action): action is TaskUpdateTaskAction => action.type === "UpdateTask");
}

function getApiErrorMessage(response: {body: unknown}) {
    return (response.body as {error?: {message?: string}}).error?.message;
}

function expectedApiErrorResponse(status: number, message: string) {
    return {
        status,
        headers: expect.objectContaining({"content-type": "application/json"}),
        body: {
            error: expect.objectContaining({
                message: expect.stringMatching(message),
            }),
        },
    };
}

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

test("returns open and closed subtask counts", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession({name: "Alice Smith", role: "Admin"});

    const bot = await TestBot.createAndInstantiate(session);
    const apiKey = await bot.createApiKey(session);
    const collection = await TestTaskCollection.create(session, {
        name: "Tasks with subtasks",
        access: "Public",
    });
    const parentTask = await TestTask.create(session, {
        title: "Parent task",
        collections: [collection],
    });

    await TestTask.create(session, {title: "Open subtask", parent: parentTask});
    await TestTask.create(session, {
        title: "Closed subtask 1",
        status: "Closed",
        parent: parentTask,
    });
    await TestTask.create(session, {
        title: "Closed subtask 2",
        status: "Closed",
        parent: parentTask,
    });
    await ProcessContextModule.waitForTestTasks();

    const taskResponse = await server.GET(`/tasks/${parentTask.id}`, {
        headers: {authorization: `bearer ${apiKey}`},
    });
    const taskCollectionResponse = await server.GET(`/task-collections/${collection.id}/tasks`, {
        headers: {authorization: `bearer ${apiKey}`},
    });

    expect({
        task: taskResponse.body.task.subtasks,
        taskWithoutNotes: taskCollectionResponse.body.tasks[0].task.subtasks,
    }).toEqual({
        task: {openTaskCount: 1, closedTaskCount: 2},
        taskWithoutNotes: {openTaskCount: 1, closedTaskCount: 2},
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
                collections: [
                    {
                        collection: {id: activeCollection.id, name: "Active"},
                    },
                ],
            }),
        }),
    });
});

test("does not return private task collections when reading a task", async () => {
    const space = await TestSpace.create(context);
    const session1 = await space.createSession({name: "Alice Smith", role: "Admin"});
    const session2 = await space.createSession({name: "Bob Johnson", role: "Admin"});

    const bot = await TestBot.createAndInstantiate(session1);
    const apiKey = await bot.createApiKey(session1);

    const publicCollection = await TestTaskCollection.create(session2, {
        name: "Public Collection",
        access: "Public",
    });
    const privateCollection = await TestTaskCollection.create(session2, {
        name: "Private Collection",
        access: "Private",
    });
    const task = await TestTask.create(session2, {
        title: "Task with mixed collection access",
        collections: [publicCollection, privateCollection],
    });

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
                title: "Task with mixed collection access",
                collections: [
                    {
                        collection: {id: publicCollection.id, name: "Public Collection"},
                    },
                ],
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
                priority: {type: "High"},
            }),
        }),
    });
});

test("GET and PATCH /tasks/{id} return matching errors without task access", async () => {
    const space = await TestSpace.create(context);
    const session1 = await space.createSession({role: "Admin"});
    const session2 = await space.createSession();

    const bot = await TestBot.createAndInstantiate(session1);
    const apiKey = await bot.createApiKey(session1);

    const task = await TestTask.create(session2);

    await ProcessContextModule.waitForTestTasks();

    const [getResponse, patchResponse] = await runAllPromises([
        server.GET(`/tasks/${task.id}`, {
            headers: {authorization: `bearer ${apiKey}`},
        }),
        server.PATCH(`/tasks/${task.id}`, {
            headers: {authorization: `bearer ${apiKey}`},
            body: {
                patches: [{type: "SetTitle", title: "Updated Title"}],
            },
        }),
    ]);

    expect({
        getResponse,
        patchResponse,
        sameErrorMessage: getApiErrorMessage(getResponse) === getApiErrorMessage(patchResponse),
    }).toEqual({
        getResponse: expectedApiErrorResponse(403, "You aren\u2019t allowed to access this task"),
        patchResponse: expectedApiErrorResponse(403, "You aren\u2019t allowed to access this task"),
        sameErrorMessage: true,
    });
});

test("GET and PATCH /tasks/{id} return matching errors for a non-existent task", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession({role: "Admin"});

    const bot = await TestBot.createAndInstantiate(session);
    const apiKey = await bot.createApiKey(session);

    await ProcessContextModule.waitForTestTasks();

    const taskId = generateId<TaskId>();
    const [getResponse, patchResponse] = await runAllPromises([
        server.GET(`/tasks/${taskId}`, {
            headers: {authorization: `bearer ${apiKey}`},
        }),
        server.PATCH(`/tasks/${taskId}`, {
            headers: {authorization: `bearer ${apiKey}`},
            body: {
                patches: [{type: "SetTitle", title: "Updated Title"}],
            },
        }),
    ]);

    expect({
        getResponse,
        patchResponse,
        sameErrorMessage: getApiErrorMessage(getResponse) === getApiErrorMessage(patchResponse),
    }).toEqual({
        getResponse: expectedApiErrorResponse(404, "doesn\u2019t exist"),
        patchResponse: expectedApiErrorResponse(404, "doesn\u2019t exist"),
        sameErrorMessage: true,
    });
});

test("GET and PATCH /tasks/{id} return matching errors for a task in a different space", async () => {
    const space = await TestSpace.create(context);
    const otherSpace = await TestSpace.create(context);
    const session = await space.createSession({role: "Admin"});
    const otherSession = await otherSpace.createSession({role: "Admin"});

    const bot = await TestBot.createAndInstantiate(session);
    const apiKey = await bot.createApiKey(session);

    const task = await TestTask.create(otherSession);

    await ProcessContextModule.waitForTestTasks();

    const [getResponse, patchResponse] = await runAllPromises([
        server.GET(`/tasks/${task.id}`, {
            headers: {authorization: `bearer ${apiKey}`},
        }),
        server.PATCH(`/tasks/${task.id}`, {
            headers: {authorization: `bearer ${apiKey}`},
            body: {
                patches: [{type: "SetTitle", title: "Updated Title"}],
            },
        }),
    ]);

    expect({
        getResponse,
        patchResponse,
        sameErrorMessage: getApiErrorMessage(getResponse) === getApiErrorMessage(patchResponse),
    }).toEqual({
        getResponse: expectedApiErrorResponse(403, "You don\u2019t have access to this space"),
        patchResponse: expectedApiErrorResponse(403, "You don\u2019t have access to this space"),
        sameErrorMessage: true,
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
                id: expect.any(String),
                creator: {id: bot.id},
                status: {type: "Open", isActive: false},
                title: "",
                collections: [],
                subtasks: {openTaskCount: 0, closedTaskCount: 0},
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
                priority: {type: "High"},
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
                priority: {type: "High"},
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
                parent: {
                    task: {
                        id: parentTask.id,
                        title: "Parent task",
                        status: {type: "Open", isActive: false},
                    },
                },
                collections: [
                    {
                        collection: {id: collections[0].id, name: "Roadmap"},
                    },
                    {
                        collection: {id: collections[1].id, name: "Engineering"},
                    },
                ],
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

test.each([
    {name: "insert into empty title", initial: "", updated: "Seed title"},
    {name: "prepend word", initial: "beta gamma", updated: "alpha beta gamma"},
    {name: "append word", initial: "alpha beta", updated: "alpha beta gamma"},
    {name: "delete middle word", initial: "alpha beta gamma", updated: "alpha gamma"},
    {name: "delete all text", initial: "alpha beta gamma", updated: ""},
    {name: "replace middle word", initial: "alpha beta gamma", updated: "alpha delta gamma"},
    {
        name: "replace punctuation-delimited word",
        initial: "Fix login, signup, and logout.",
        updated: "Fix login, billing, and logout.",
    },
    {
        name: "replace repeated phrase",
        initial: "repeat word repeat word",
        updated: "repeat word changed word",
    },
    {name: "preserve doubled whitespace", initial: "alpha beta", updated: "alpha  beta"},
])("title diffing handles word-boundary edit: $name", async ({initial, updated}) => {
    const space = await TestSpace.create(context);
    const session = await space.createSession({name: "Alice Smith", role: "Admin"});

    const bot = await TestBot.createAndInstantiate(session);
    const apiKey = await bot.createApiKey(session);

    const task = await TestTask.create(session, {title: initial});

    await ProcessContextModule.waitForTestTasks();

    const response = await server.PATCH(`/tasks/${task.id}`, {
        headers: {authorization: `bearer ${apiKey}`},
        body: {
            patches: [{type: "SetTitle", title: updated}],
        },
    });

    expect(response).toMatchObject({
        status: 200,
        body: expect.objectContaining({
            task: expect.objectContaining({
                id: task.id,
                title: updated,
            }),
        }),
    });
});

test("title updates only touch changed words so concurrent edits can merge", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession({name: "Alice Smith", role: "Admin"});

    const bot = await TestBot.createAndInstantiate(session);
    const apiKey = await bot.createApiKey(session);

    const task = await TestTask.create(session, {title: "one two three four"});

    await ProcessContextModule.waitForTestTasks();

    const [firstWordResponse, thirdWordResponse] = await runAllPromises([
        server.PATCH(`/tasks/${task.id}`, {
            headers: {authorization: `bearer ${apiKey}`},
            body: {
                patches: [{type: "SetTitle", title: "ONE two three four"}],
            },
        }),
        server.PATCH(`/tasks/${task.id}`, {
            headers: {authorization: `bearer ${apiKey}`},
            body: {
                patches: [{type: "SetTitle", title: "one two THREE four"}],
            },
        }),
    ]);

    await ProcessContextModule.waitForTestTasks();

    const finalResponse = await server.GET(`/tasks/${task.id}`, {
        headers: {authorization: `bearer ${apiKey}`},
    });

    expect({
        patchStatuses: [firstWordResponse.status, thirdWordResponse.status],
        title: finalResponse.status === 200 ? finalResponse.body.task.title : undefined,
    }).toEqual({
        patchStatuses: [200, 200],
        title: "ONE two THREE four",
    });
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
                message:
                    "Actor must be a member of the same space the task is in. Try again without an actor or with an actor in the same space as the task.",
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
                {type: "SetAssignee", assignee: {id: session2.account.id}},
                {type: "SetPriority", priority: {type: "Urgent"}},
                {type: "SetDue", due: {date: "2026-06-15"}},
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
                priority: {type: "Urgent"},
                due: {date: "2026-06-15"},
            }),
        }),
    });

    const actor = {
        accountId: session1.account.id,
        from: {type: "Bot", accountId: bot.id},
    };

    // Actions are generated one-by-one from the patches in request order.
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
                    taskAction: expect.objectContaining({type: "UpdateAssignee"}),
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
                    taskAction: expect.objectContaining({type: "UpdateDueDate"}),
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
                {type: "SetDue", due: null},
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
                parent: {
                    task: {
                        id: parentTask.id,
                        title: "Parent task",
                        status: {type: "Open", isActive: false},
                    },
                },
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

test("returns a private parent placeholder when reading a task", async () => {
    const space = await TestSpace.create(context);
    const session1 = await space.createSession({name: "Alice Smith", role: "Admin"});
    const session2 = await space.createSession({name: "Bob Johnson", role: "Admin"});

    const bot = await TestBot.createAndInstantiate(session1);
    const apiKey = await bot.createApiKey(session1);

    const collection = await TestTaskCollection.create(session2, {
        name: "Public Collection",
        access: "Public",
    });
    const parentTask = await TestTask.create(session2, {title: "Private Parent"});
    const childTask = await TestTask.create(session2, {
        title: "Child Task",
        parent: parentTask,
        collections: [collection],
    });

    await ProcessContextModule.waitForTestTasks();

    expect(
        await server.GET(`/tasks/${childTask.id}`, {
            headers: {authorization: `bearer ${apiKey}`},
        }),
    ).toEqual({
        status: 200,
        headers: expect.objectContaining({"content-type": "application/json"}),
        body: expect.objectContaining({
            spaceId: space.id,
            task: expect.objectContaining({
                id: childTask.id,
                title: "Child Task",
                parent: {
                    task: {
                        id: parentTask.id,
                        title: "Private task",
                        status: {type: "Closed"},
                    },
                },
                collections: [
                    {
                        collection: {id: collection.id, name: "Public Collection"},
                    },
                ],
            }),
        }),
    });
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
                priority: {type: "High"},
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

    const startTime = new Date();
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

    expect(
        (await getTaskUpdateActionsSince(space, startTime)).map(action => action.taskAction),
    ).toEqual([
        expect.objectContaining({
            type: "UpdateAssignee",
            assignee: expect.objectContaining({assigneeId: bot.id}),
        }),
        expect.objectContaining({
            type: "UpdateStatus",
            status: {type: "Open"},
            assigneeStatus: expect.objectContaining({type: "Active"}),
        }),
    ]);
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

    const startTime = new Date();
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

    expect(
        (await getTaskUpdateActionsSince(space, startTime)).map(action => action.taskAction),
    ).toEqual([
        expect.objectContaining({
            type: "UpdateStatus",
            status: {type: "Open"},
            assigneeStatus: expect.objectContaining({type: "Active"}),
        }),
    ]);
});

test("SetStatus Open clears active status without clearing assignee", async () => {
    const space = await TestSpace.create(context);
    const session1 = await space.createSession({name: "Alice Smith", role: "Admin"});
    const session2 = await space.createSession({name: "Bob Johnson"});

    const bot = await TestBot.createAndInstantiate(session1);
    const apiKey = await bot.createApiKey(session1);

    const task = await TestTask.create(session1, {title: "Active Task"});
    await task.updateAssignee(session1, session2, {assigneeStatus: "Active"});

    await ProcessContextModule.waitForTestTasks();

    const startTime = new Date();
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

    expect(
        (await getTaskUpdateActionsSince(space, startTime)).map(action => action.taskAction),
    ).toEqual([{type: "UpdateStatus", status: {type: "Open"}}]);
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

test("setting active status before changing assignee leaves the new assignee inactive", async () => {
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
                {type: "SetAssignee", assignee: {id: session2.account.id}},
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
                status: {type: "Open", isActive: false},
            }),
        }),
    });
});

test("multiple title patches in one request diff against prior title patches", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession({name: "Alice Smith", role: "Admin"});

    const bot = await TestBot.createAndInstantiate(session);
    const apiKey = await bot.createApiKey(session);

    const task = await TestTask.create(session, {title: "one three"});

    await ProcessContextModule.waitForTestTasks();

    const startTime = new Date();
    const response = await server.PATCH(`/tasks/${task.id}`, {
        headers: {authorization: `bearer ${apiKey}`},
        body: {
            patches: [
                {type: "SetTitle", title: "one two three"},
                {type: "SetTitle", title: "one two three four"},
            ],
        },
    });

    expect(response).toMatchObject({
        status: 200,
        body: expect.objectContaining({
            task: expect.objectContaining({
                id: task.id,
                title: "one two three four",
            }),
        }),
    });

    expect(
        (await getTaskUpdateActionsSince(space, startTime)).map(action => action.taskAction.type),
    ).toEqual(["UpdateTitle", "UpdateTitle"]);
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
                {type: "SetAssignee", assignee: {id: session2.account.id}},
                {type: "SetStatus", status: {type: "Open", isActive: true}},
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
                patches: [
                    {
                        type: "AddCollection",
                        item: {collection: {id: collection.id}},
                    },
                ],
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

describe("MoveInCollection patch", () => {
    async function createMoveCollectionFixture() {
        const space = await TestSpace.create(context);
        const session = await space.createSession({name: "Alice Smith", role: "Admin"});

        const bot = await TestBot.createAndInstantiate(session);
        const apiKey = await bot.createApiKey(session);

        const collection = await TestTaskCollection.create(session, {
            name: "Move Collection",
            access: "Public",
        });

        return {space, session, apiKey, collection};
    }

    async function getTaskCollectionListing(
        apiKey: string,
        collectionId: TaskCollectionId,
        {limit}: {limit?: number} = {},
    ): Promise<{taskIds: Array<TaskId>; cursors: Array<string>}> {
        const response = await server.GET(
            `/task-collections/${collectionId}/tasks${limit !== undefined ? `?limit=${limit}` : ""}`,
            {
                headers: {authorization: `bearer ${apiKey}`},
            },
        );

        expect(response.status).toBe(200);

        const items: ReadonlyArray<{
            cursor: string;
            task: {
                id: TaskId;
            };
        }> = response.body.tasks;

        return {
            taskIds: items.map(({task}) => task.id),
            cursors: items.map(({cursor}) => cursor),
        };
    }

    function createCollectionPosition() {
        return {orderTime: testTaskClock.now(), orderKey: initialOrderKey};
    }

    async function updateTasksToCollectionPosition(
        session: TestSpaceSession,
        collection: TestTaskCollection,
        tasks: ReadonlyArray<TestTask>,
        position: TaskPosition,
    ) {
        await runAllPromises(
            tasks.map(task => task.updateCollectionPosition(session, collection, position)),
        );
    }

    test("can move a task to the start of a collection", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession({name: "Alice Smith", role: "Admin"});

        const bot = await TestBot.createAndInstantiate(session);
        const apiKey = await bot.createApiKey(session);

        const collection = await TestTaskCollection.create(session, {
            name: "Move Collection",
            access: "Public",
        });
        const task1 = await TestTask.create(session, {title: "Task 1", collections: collection});
        const task2 = await TestTask.create(session, {title: "Task 2", collections: collection});
        const task3 = await TestTask.create(session, {title: "Task 3", collections: collection});

        await ProcessContextModule.waitForTestTasks();

        const response = await server.PATCH(`/tasks/${task3.id}`, {
            headers: {authorization: `bearer ${apiKey}`},
            body: {
                patches: [
                    {
                        type: "MoveInCollection",
                        collectionId: collection.id,
                        position: {type: "Start"},
                    },
                ],
            },
        });

        expect(response.status).toBe(200);
        await ProcessContextModule.waitForTestTasks();

        expect(await getTaskCollectionListing(apiKey, collection.id)).toMatchObject({
            taskIds: [task3.id, task1.id, task2.id],
        });
    });

    test("can move a task to the end of a collection", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession({name: "Alice Smith", role: "Admin"});

        const bot = await TestBot.createAndInstantiate(session);
        const apiKey = await bot.createApiKey(session);

        const collection = await TestTaskCollection.create(session, {
            name: "Move Collection",
            access: "Public",
        });
        const task1 = await TestTask.create(session, {title: "Task 1", collections: collection});
        const task2 = await TestTask.create(session, {title: "Task 2", collections: collection});
        const task3 = await TestTask.create(session, {title: "Task 3", collections: collection});

        await ProcessContextModule.waitForTestTasks();

        const response = await server.PATCH(`/tasks/${task1.id}`, {
            headers: {authorization: `bearer ${apiKey}`},
            body: {
                patches: [
                    {
                        type: "MoveInCollection",
                        collectionId: collection.id,
                        position: {type: "End"},
                    },
                ],
            },
        });

        expect(response.status).toBe(200);
        await ProcessContextModule.waitForTestTasks();

        expect(await getTaskCollectionListing(apiKey, collection.id)).toMatchObject({
            taskIds: [task2.id, task3.id, task1.id],
        });
    });

    test("can move a task between two tasks in a collection", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession({name: "Alice Smith", role: "Admin"});

        const bot = await TestBot.createAndInstantiate(session);
        const apiKey = await bot.createApiKey(session);

        const collection = await TestTaskCollection.create(session, {
            name: "Move Collection",
            access: "Public",
        });
        const task1 = await TestTask.create(session, {title: "Task 1", collections: collection});
        const task2 = await TestTask.create(session, {title: "Task 2", collections: collection});
        const task3 = await TestTask.create(session, {title: "Task 3", collections: collection});

        await ProcessContextModule.waitForTestTasks();

        const {cursors} = await getTaskCollectionListing(apiKey, collection.id);

        const response = await server.PATCH(`/tasks/${task3.id}`, {
            headers: {authorization: `bearer ${apiKey}`},
            body: {
                patches: [
                    {
                        type: "MoveInCollection",
                        collectionId: collection.id,
                        position: {
                            type: "Between",
                            afterCursor: cursors[0],
                            beforeCursor: cursors[1],
                        },
                    },
                ],
            },
        });

        expect(response.status).toBe(200);
        await ProcessContextModule.waitForTestTasks();

        expect(await getTaskCollectionListing(apiKey, collection.id)).toMatchObject({
            taskIds: [task1.id, task3.id, task2.id],
        });
    });

    test("can move a task between two tasks that share the exact same position", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession({name: "Alice Smith", role: "Admin"});

        const bot = await TestBot.createAndInstantiate(session);
        const apiKey = await bot.createApiKey(session);

        const collection = await TestTaskCollection.create(session, {
            name: "Move Collection",
            access: "Public",
        });
        const task1 = await TestTask.create(session, {title: "Task 1", collections: collection});
        const task2 = await TestTask.create(session, {title: "Task 2", collections: collection});
        const task3 = await TestTask.create(session, {title: "Task 3", collections: collection});
        const movedTask = await TestTask.create(session, {
            title: "Moved Task",
            collections: collection,
        });

        // Give the first three tasks the exact same position (like task duplication does)
        // and keep the moved task at the end.
        const tiedPosition = {orderTime: testTaskClock.now(), orderKey: initialOrderKey};
        await task1.updateCollectionPosition(session, collection, tiedPosition);
        await task2.updateCollectionPosition(session, collection, tiedPosition);
        await task3.updateCollectionPosition(session, collection, tiedPosition);
        await movedTask.updateCollectionPosition(session, collection, {
            orderTime: testTaskClock.now(),
            orderKey: initialOrderKey,
        });

        await ProcessContextModule.waitForTestTasks();

        const {taskIds, cursors} = await getTaskCollectionListing(apiKey, collection.id);
        expect(taskIds).toEqual([task1.id, task2.id, task3.id, movedTask.id]);

        const startTime = new Date();
        const response = await server.PATCH(`/tasks/${movedTask.id}`, {
            headers: {authorization: `bearer ${apiKey}`},
            body: {
                patches: [
                    {
                        type: "MoveInCollection",
                        collectionId: collection.id,
                        position: {
                            type: "Between",
                            afterCursor: cursors[0],
                            beforeCursor: cursors[1],
                        },
                    },
                ],
            },
        });

        expect(response.status).toBe(200);
        await ProcessContextModule.waitForTestTasks();

        expect(await getTaskCollectionListing(apiKey, collection.id)).toMatchObject({
            taskIds: [task1.id, movedTask.id, task2.id, task3.id],
        });

        // The tasks sharing the position were re-keyed to make room for the moved task.
        expect(
            await backfillTaskActionTransactionHistory(space.systemAction(), space.id, startTime),
        ).toEqual([
            expect.objectContaining({
                actions: [
                    expect.objectContaining({
                        taskId: movedTask.id,
                        taskAction: expect.objectContaining({type: "UpdateCollectionPosition"}),
                    }),
                    expect.objectContaining({
                        taskId: task2.id,
                        taskAction: expect.objectContaining({type: "UpdateCollectionPosition"}),
                    }),
                    expect.objectContaining({
                        taskId: task3.id,
                        taskAction: expect.objectContaining({type: "UpdateCollectionPosition"}),
                    }),
                ],
            }),
        ]);
    });

    test("can move a task between tied positions that reach the collection end", async () => {
        const {space, session, apiKey, collection} = await createMoveCollectionFixture();

        const movedTask = await TestTask.create(session, {
            title: "Moved Task",
            collections: collection,
        });
        const tiedTasks = await runAllPromises(
            Array.from({length: 4}, (_, index) =>
                TestTask.create(session, {
                    title: `Tied Task ${index + 1}`,
                    collections: collection,
                }),
            ),
        );

        await movedTask.updateCollectionPosition(session, collection, createCollectionPosition());
        await updateTasksToCollectionPosition(
            session,
            collection,
            tiedTasks,
            createCollectionPosition(),
        );

        await ProcessContextModule.waitForTestTasks();

        const {taskIds, cursors} = await getTaskCollectionListing(apiKey, collection.id);
        expect(taskIds).toEqual([movedTask.id, ...tiedTasks.map(task => task.id)]);

        const startTime = new Date();
        const response = await server.PATCH(`/tasks/${movedTask.id}`, {
            headers: {authorization: `bearer ${apiKey}`},
            body: {
                patches: [
                    {
                        type: "MoveInCollection",
                        collectionId: collection.id,
                        position: {
                            type: "Between",
                            afterCursor: cursors[1],
                            beforeCursor: cursors[2],
                        },
                    },
                ],
            },
        });

        expect(response.status).toBe(200);
        await ProcessContextModule.waitForTestTasks();

        expect(await getTaskCollectionListing(apiKey, collection.id)).toMatchObject({
            taskIds: [
                tiedTasks[0]!.id,
                movedTask.id,
                tiedTasks[1]!.id,
                tiedTasks[2]!.id,
                tiedTasks[3]!.id,
            ],
        });

        expect(
            await backfillTaskActionTransactionHistory(space.systemAction(), space.id, startTime),
        ).toEqual([
            expect.objectContaining({
                actions: [
                    expect.objectContaining({
                        taskId: movedTask.id,
                        taskAction: expect.objectContaining({type: "UpdateCollectionPosition"}),
                    }),
                    expect.objectContaining({
                        taskId: tiedTasks[1]!.id,
                        taskAction: expect.objectContaining({type: "UpdateCollectionPosition"}),
                    }),
                    expect.objectContaining({
                        taskId: tiedTasks[2]!.id,
                        taskAction: expect.objectContaining({type: "UpdateCollectionPosition"}),
                    }),
                    expect.objectContaining({
                        taskId: tiedTasks[3]!.id,
                        taskAction: expect.objectContaining({type: "UpdateCollectionPosition"}),
                    }),
                ],
            }),
        ]);
    });

    test("can move a task into four tied positions followed by non-tied positions", async () => {
        const {space, session, apiKey, collection} = await createMoveCollectionFixture();

        const tasks = await runAllPromises(
            Array.from({length: 10}, (_, index) =>
                TestTask.create(session, {
                    title: `Task ${index + 1}`,
                    collections: collection,
                }),
            ),
        );

        await tasks[0]!.updateCollectionPosition(session, collection, createCollectionPosition());
        await updateTasksToCollectionPosition(
            session,
            collection,
            tasks.slice(1, 5),
            createCollectionPosition(),
        );
        await runAllPromises(
            tasks
                .slice(5)
                .map(task =>
                    task.updateCollectionPosition(session, collection, createCollectionPosition()),
                ),
        );

        await ProcessContextModule.waitForTestTasks();

        const {taskIds, cursors} = await getTaskCollectionListing(apiKey, collection.id);
        expect(taskIds).toEqual(tasks.map(task => task.id));

        const startTime = new Date();
        const response = await server.PATCH(`/tasks/${tasks[9]!.id}`, {
            headers: {authorization: `bearer ${apiKey}`},
            body: {
                patches: [
                    {
                        type: "MoveInCollection",
                        collectionId: collection.id,
                        position: {
                            type: "Between",
                            afterCursor: cursors[2],
                            beforeCursor: cursors[3],
                        },
                    },
                ],
            },
        });

        expect(response.status).toBe(200);
        await ProcessContextModule.waitForTestTasks();

        expect(await getTaskCollectionListing(apiKey, collection.id)).toMatchObject({
            taskIds: [
                tasks[0]!.id,
                tasks[1]!.id,
                tasks[2]!.id,
                tasks[9]!.id,
                tasks[3]!.id,
                tasks[4]!.id,
                tasks[5]!.id,
                tasks[6]!.id,
                tasks[7]!.id,
                tasks[8]!.id,
            ],
        });

        expect(
            await backfillTaskActionTransactionHistory(space.systemAction(), space.id, startTime),
        ).toEqual([
            expect.objectContaining({
                actions: [
                    expect.objectContaining({
                        taskId: tasks[9]!.id,
                        taskAction: expect.objectContaining({type: "UpdateCollectionPosition"}),
                    }),
                    expect.objectContaining({
                        taskId: tasks[3]!.id,
                        taskAction: expect.objectContaining({type: "UpdateCollectionPosition"}),
                    }),
                    expect.objectContaining({
                        taskId: tasks[4]!.id,
                        taskAction: expect.objectContaining({type: "UpdateCollectionPosition"}),
                    }),
                ],
            }),
        ]);
    });

    test("can move a task into a forty task tied position sequence", async () => {
        const {space, session, apiKey, collection} = await createMoveCollectionFixture();

        const movedTask = await TestTask.create(session, {
            title: "Moved Task",
            collections: collection,
        });
        const tiedTasks = await runAllPromises(
            Array.from({length: 40}, (_, index) =>
                TestTask.create(session, {
                    title: `Tied Task ${index + 1}`,
                    collections: collection,
                }),
            ),
        );

        await movedTask.updateCollectionPosition(session, collection, createCollectionPosition());
        await updateTasksToCollectionPosition(
            session,
            collection,
            tiedTasks,
            createCollectionPosition(),
        );

        await ProcessContextModule.waitForTestTasks();

        const {taskIds, cursors} = await getTaskCollectionListing(apiKey, collection.id, {
            limit: 50,
        });
        expect(taskIds).toEqual([movedTask.id, ...tiedTasks.map(task => task.id)]);

        const startTime = new Date();
        const response = await server.PATCH(`/tasks/${movedTask.id}`, {
            headers: {authorization: `bearer ${apiKey}`},
            body: {
                patches: [
                    {
                        type: "MoveInCollection",
                        collectionId: collection.id,
                        position: {
                            type: "Between",
                            afterCursor: cursors[3],
                            beforeCursor: cursors[4],
                        },
                    },
                ],
            },
        });

        expect(response.status).toBe(200);
        await ProcessContextModule.waitForTestTasks();

        expect(await getTaskCollectionListing(apiKey, collection.id, {limit: 50})).toMatchObject({
            taskIds: [
                tiedTasks[0]!.id,
                tiedTasks[1]!.id,
                tiedTasks[2]!.id,
                movedTask.id,
                ...tiedTasks.slice(3).map(task => task.id),
            ],
        });

        expect(
            await backfillTaskActionTransactionHistory(space.systemAction(), space.id, startTime),
        ).toEqual([
            expect.objectContaining({
                actions: [
                    expect.objectContaining({
                        taskId: movedTask.id,
                        taskAction: expect.objectContaining({type: "UpdateCollectionPosition"}),
                    }),
                    ...tiedTasks.slice(3).map(task =>
                        expect.objectContaining({
                            taskId: task.id,
                            taskAction: expect.objectContaining({
                                type: "UpdateCollectionPosition",
                            }),
                        }),
                    ),
                ],
            }),
        ]);
    });

    test("can add a task to a collection and move it in the same patch request", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession({name: "Alice Smith", role: "Admin"});

        const bot = await TestBot.createAndInstantiate(session);
        const apiKey = await bot.createApiKey(session);

        const collection = await TestTaskCollection.create(session, {
            name: "Move Collection",
            access: "Public",
        });
        const task1 = await TestTask.create(session, {title: "Task 1", collections: collection});
        const task2 = await TestTask.create(session, {title: "Task 2", collections: collection});
        const newTask = await TestTask.create(session, {title: "New Task"});

        await ProcessContextModule.waitForTestTasks();

        const response = await server.PATCH(`/tasks/${newTask.id}`, {
            headers: {authorization: `bearer ${apiKey}`},
            body: {
                patches: [
                    {
                        type: "AddCollection",
                        item: {collection: {id: collection.id}},
                    },
                    {
                        type: "MoveInCollection",
                        collectionId: collection.id,
                        position: {type: "Start"},
                    },
                ],
            },
        });

        expect(response.status).toBe(200);
        await ProcessContextModule.waitForTestTasks();

        expect(await getTaskCollectionListing(apiKey, collection.id)).toMatchObject({
            taskIds: [newTask.id, task1.id, task2.id],
        });
    });

    test("can\u2019t move a task between identical cursors for the same task", async () => {
        const {session, apiKey, collection} = await createMoveCollectionFixture();

        const task1 = await TestTask.create(session, {title: "Task 1", collections: collection});
        const task2 = await TestTask.create(session, {title: "Task 2", collections: collection});
        const movedTask = await TestTask.create(session, {
            title: "Moved Task",
            collections: collection,
        });

        await ProcessContextModule.waitForTestTasks();

        const {taskIds, cursors} = await getTaskCollectionListing(apiKey, collection.id);
        expect(taskIds).toEqual([task1.id, task2.id, movedTask.id]);

        expect(
            await server.PATCH(`/tasks/${movedTask.id}`, {
                headers: {authorization: `bearer ${apiKey}`},
                body: {
                    patches: [
                        {
                            type: "MoveInCollection",
                            collectionId: collection.id,
                            position: {
                                type: "Between",
                                afterCursor: cursors[0],
                                beforeCursor: cursors[0],
                            },
                        },
                    ],
                },
            }),
        ).toEqual({
            status: 400,
            headers: expect.objectContaining({"content-type": "application/json"}),
            body: {
                error: expect.objectContaining({
                    message:
                        "The `MoveInCollection` patch `afterCursor` is for the same task as `beforeCursor`. Try again but with two `TaskQueryCursor`s from different tasks.",
                }),
            },
        });
    });

    test("can\u2019t move a task between different cursors for the same task", async () => {
        const {session, apiKey, collection} = await createMoveCollectionFixture();

        const task1 = await TestTask.create(session, {title: "Task 1", collections: collection});
        const task2 = await TestTask.create(session, {title: "Task 2", collections: collection});
        const task3 = await TestTask.create(session, {title: "Task 3", collections: collection});

        await ProcessContextModule.waitForTestTasks();

        const initialListing = await getTaskCollectionListing(apiKey, collection.id);
        expect(initialListing.taskIds).toEqual([task1.id, task2.id, task3.id]);

        const moveResponse = await server.PATCH(`/tasks/${task1.id}`, {
            headers: {authorization: `bearer ${apiKey}`},
            body: {
                patches: [
                    {
                        type: "MoveInCollection",
                        collectionId: collection.id,
                        position: {type: "End"},
                    },
                ],
            },
        });

        expect(moveResponse.status).toBe(200);
        await ProcessContextModule.waitForTestTasks();

        const updatedListing = await getTaskCollectionListing(apiKey, collection.id);
        expect(updatedListing.taskIds).toEqual([task2.id, task3.id, task1.id]);

        expect(
            await server.PATCH(`/tasks/${task2.id}`, {
                headers: {authorization: `bearer ${apiKey}`},
                body: {
                    patches: [
                        {
                            type: "MoveInCollection",
                            collectionId: collection.id,
                            position: {
                                type: "Between",
                                afterCursor: initialListing.cursors[0],
                                beforeCursor: updatedListing.cursors[2],
                            },
                        },
                    ],
                },
            }),
        ).toEqual({
            status: 400,
            headers: expect.objectContaining({"content-type": "application/json"}),
            body: {
                error: expect.objectContaining({
                    message:
                        "The `MoveInCollection` patch `afterCursor` is for the same task as `beforeCursor`. Try again but with two `TaskQueryCursor`s from different tasks.",
                }),
            },
        });
    });

    test("can\u2019t move a task in a collection it\u2019s not in", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession({name: "Alice Smith", role: "Admin"});

        const bot = await TestBot.createAndInstantiate(session);
        const apiKey = await bot.createApiKey(session);

        const collection = await TestTaskCollection.create(session, {
            name: "Move Collection",
            access: "Public",
        });
        const task = await TestTask.create(session, {title: "Task outside collection"});

        await ProcessContextModule.waitForTestTasks();

        expect(
            await server.PATCH(`/tasks/${task.id}`, {
                headers: {authorization: `bearer ${apiKey}`},
                body: {
                    patches: [
                        {
                            type: "MoveInCollection",
                            collectionId: collection.id,
                            position: {type: "End"},
                        },
                    ],
                },
            }),
        ).toEqual({
            status: 400,
            headers: expect.objectContaining({"content-type": "application/json"}),
            body: {
                error: expect.objectContaining({
                    message:
                        "The task isn\u2019t in the collection you\u2019re moving it within. Try again after adding the task to the collection with an `AddCollection` patch.",
                }),
            },
        });
    });

    test("can\u2019t move a task between cursors in the wrong order", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession({name: "Alice Smith", role: "Admin"});

        const bot = await TestBot.createAndInstantiate(session);
        const apiKey = await bot.createApiKey(session);

        const collection = await TestTaskCollection.create(session, {
            name: "Move Collection",
            access: "Public",
        });
        await TestTask.create(session, {title: "Task 1", collections: collection});
        await TestTask.create(session, {title: "Task 2", collections: collection});
        const task3 = await TestTask.create(session, {title: "Task 3", collections: collection});

        await ProcessContextModule.waitForTestTasks();

        const {cursors} = await getTaskCollectionListing(apiKey, collection.id);

        expect(
            await server.PATCH(`/tasks/${task3.id}`, {
                headers: {authorization: `bearer ${apiKey}`},
                body: {
                    patches: [
                        {
                            type: "MoveInCollection",
                            collectionId: collection.id,
                            position: {
                                type: "Between",
                                afterCursor: cursors[1],
                                beforeCursor: cursors[0],
                            },
                        },
                    ],
                },
            }),
        ).toEqual({
            status: 400,
            headers: expect.objectContaining({"content-type": "application/json"}),
            body: {
                error: expect.objectContaining({
                    message:
                        "The `MoveInCollection` patch `afterCursor` is positioned after `beforeCursor`. Try again but swap the order of `afterCursor` and `beforeCursor`.",
                }),
            },
        });
    });

    test("can\u2019t move a task between tied cursors in the wrong created-time order", async () => {
        const {session, apiKey, collection} = await createMoveCollectionFixture();

        const beforeTask = await TestTask.create(session, {
            title: "Before Task",
            collections: collection,
        });
        const afterTask = await TestTask.create(session, {
            title: "After Task",
            collections: collection,
        });
        const movedTask = await TestTask.create(session, {
            title: "Moved Task",
            collections: collection,
        });

        await updateTasksToCollectionPosition(
            session,
            collection,
            [beforeTask, afterTask],
            createCollectionPosition(),
        );

        await ProcessContextModule.waitForTestTasks();

        const {taskIds, cursors} = await getTaskCollectionListing(apiKey, collection.id);
        expect(taskIds.slice(-2)).toEqual([beforeTask.id, afterTask.id]);

        const beforeCursor = cursors[taskIds.indexOf(beforeTask.id)];
        const afterCursor = cursors[taskIds.indexOf(afterTask.id)];

        expect(
            await server.PATCH(`/tasks/${movedTask.id}`, {
                headers: {authorization: `bearer ${apiKey}`},
                body: {
                    patches: [
                        {
                            type: "MoveInCollection",
                            collectionId: collection.id,
                            position: {
                                type: "Between",
                                afterCursor,
                                beforeCursor,
                            },
                        },
                    ],
                },
            }),
        ).toEqual({
            status: 400,
            headers: expect.objectContaining({"content-type": "application/json"}),
            body: {
                error: expect.objectContaining({
                    message:
                        "The `MoveInCollection` patch `afterCursor` is positioned after `beforeCursor`. Try again but swap the order of `afterCursor` and `beforeCursor`.",
                }),
            },
        });
    });
});

describe("MoveInParent patch", () => {
    const parentPositionSorts = [
        {type: "ParentPosition", direction: "Ascending", missing: "Last"},
        {type: "CreatedTime", direction: "Ascending", missing: "Last"},
    ] as const satisfies ReadonlyArray<TaskQueryNormalizedSort>;

    async function createMoveParentFixture() {
        const space = await TestSpace.create(context);
        const session = await space.createSession({name: "Alice Smith", role: "Admin"});

        const bot = await TestBot.createAndInstantiate(session);
        const apiKey = await bot.createApiKey(session);

        const parentTask = await TestTask.create(session, {title: "Parent Task"});
        const task1 = await TestTask.create(session, {title: "Task 1", parent: parentTask});
        const task2 = await TestTask.create(session, {title: "Task 2", parent: parentTask});
        const task3 = await TestTask.create(session, {title: "Task 3", parent: parentTask});

        await ProcessContextModule.waitForTestTasks();

        return {space, session, apiKey, parentTask, task1, task2, task3};
    }

    async function getParentTaskListing(session: TestSpaceSession, parentTaskId: TaskId) {
        const {tasks} = await context.getTaskRealtimeServer().loadQuery(session, {
            filters: {
                displayStatusFilter: {
                    ifOpenActive: true,
                    ifOpenInactive: true,
                    ifClosed: true,
                },
                parentFilter: {parentTaskId},
            },
            sorts: parentPositionSorts,
        });

        return {
            taskIds: tasks.map(task => task.id),
            cursors: tasks.map(task =>
                encodeApiTaskQueryCursor(
                    parentPositionSorts,
                    getTaskQueryNormalizedSortCursorForIndexDoc(parentPositionSorts, task),
                ),
            ),
        };
    }

    test("can move a task to the start of its parent\u2019s subtasks", async () => {
        const {session, apiKey, parentTask, task1, task2, task3} = await createMoveParentFixture();

        await server.PATCH(`/tasks/${task3.id}`, {
            headers: {authorization: `bearer ${apiKey}`},
            body: {
                patches: [{type: "MoveInParent", position: {type: "Start"}}],
            },
        });
        await ProcessContextModule.waitForTestTasks();

        expect(await getParentTaskListing(session, parentTask.id)).toMatchObject({
            taskIds: [task3.id, task1.id, task2.id],
        });
    });

    test("can set a parent and move within it in the same patch list", async () => {
        const {session, apiKey, parentTask, task1, task2, task3} = await createMoveParentFixture();
        const movedTask = await TestTask.create(session, {title: "Moved Task"});
        await ProcessContextModule.waitForTestTasks();

        await server.PATCH(`/tasks/${movedTask.id}`, {
            headers: {authorization: `bearer ${apiKey}`},
            body: {
                patches: [
                    {type: "SetParent", parent: {task: {id: parentTask.id}}},
                    {type: "MoveInParent", position: {type: "Start"}},
                ],
            },
        });
        await ProcessContextModule.waitForTestTasks();

        expect(await getParentTaskListing(session, parentTask.id)).toMatchObject({
            taskIds: [movedTask.id, task1.id, task2.id, task3.id],
        });
    });

    test("can move a task to the end of its parent\u2019s subtasks", async () => {
        const {session, apiKey, parentTask, task1, task2, task3} = await createMoveParentFixture();

        await server.PATCH(`/tasks/${task1.id}`, {
            headers: {authorization: `bearer ${apiKey}`},
            body: {
                patches: [{type: "MoveInParent", position: {type: "End"}}],
            },
        });
        await ProcessContextModule.waitForTestTasks();

        expect(await getParentTaskListing(session, parentTask.id)).toMatchObject({
            taskIds: [task2.id, task3.id, task1.id],
        });
    });

    test("can move a task between two of its parent\u2019s subtasks", async () => {
        const {session, apiKey, parentTask, task1, task2, task3} = await createMoveParentFixture();
        const {cursors} = await getParentTaskListing(session, parentTask.id);

        await server.PATCH(`/tasks/${task3.id}`, {
            headers: {authorization: `bearer ${apiKey}`},
            body: {
                patches: [
                    {
                        type: "MoveInParent",
                        position: {
                            type: "Between",
                            afterCursor: cursors[0],
                            beforeCursor: cursors[1],
                        },
                    },
                ],
            },
        });
        await ProcessContextModule.waitForTestTasks();

        expect(await getParentTaskListing(session, parentTask.id)).toMatchObject({
            taskIds: [task1.id, task3.id, task2.id],
        });
    });

    test("can move a task between subtasks with tied parent positions", async () => {
        const {space, session, apiKey, parentTask, task1, task2, task3} =
            await createMoveParentFixture();
        const movedTask = await TestTask.create(session, {
            title: "Moved Task",
            parent: parentTask,
        });

        const tiedTime = testTaskClock.now();
        await runAllPromises(
            [task1, task2, task3].map(task =>
                task.updateParentTask(session, parentTask, {time: tiedTime}),
            ),
        );
        await movedTask.updateParentTask(session, parentTask);
        await ProcessContextModule.waitForTestTasks();

        const {cursors} = await getParentTaskListing(session, parentTask.id);
        const startTime = new Date();

        await server.PATCH(`/tasks/${movedTask.id}`, {
            headers: {authorization: `bearer ${apiKey}`},
            body: {
                patches: [
                    {
                        type: "MoveInParent",
                        position: {
                            type: "Between",
                            afterCursor: cursors[0],
                            beforeCursor: cursors[1],
                        },
                    },
                ],
            },
        });
        await ProcessContextModule.waitForTestTasks();

        const [listing, history] = await runAllPromises([
            getParentTaskListing(session, parentTask.id),
            backfillTaskActionTransactionHistory(space.systemAction(), space.id, startTime),
        ]);

        expect({listing, history}).toEqual({
            listing: expect.objectContaining({
                taskIds: [task1.id, movedTask.id, task2.id, task3.id],
            }),
            history: [
                expect.objectContaining({
                    actions: [
                        expect.objectContaining({
                            taskId: movedTask.id,
                            taskAction: expect.objectContaining({type: "UpdateParentPosition"}),
                        }),
                        expect.objectContaining({
                            taskId: task2.id,
                            taskAction: expect.objectContaining({type: "UpdateParentPosition"}),
                        }),
                        expect.objectContaining({
                            taskId: task3.id,
                            taskAction: expect.objectContaining({type: "UpdateParentPosition"}),
                        }),
                    ],
                }),
            ],
        });
    });

    test("can\u2019t move a task that doesn\u2019t have a parent", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession({name: "Alice Smith", role: "Admin"});
        const bot = await TestBot.createAndInstantiate(session);
        const apiKey = await bot.createApiKey(session);
        const task = await TestTask.create(session, {title: "Task without parent"});

        await ProcessContextModule.waitForTestTasks();

        expect(
            await server.PATCH(`/tasks/${task.id}`, {
                headers: {authorization: `bearer ${apiKey}`},
                body: {
                    patches: [{type: "MoveInParent", position: {type: "End"}}],
                },
            }),
        ).toEqual({
            status: 400,
            headers: expect.objectContaining({"content-type": "application/json"}),
            body: {
                error: expect.objectContaining({
                    message:
                        "The task doesn\u2019t have a parent to move within. Try again after setting the task\u2019s parent with a `SetParent` patch.",
                }),
            },
        });
    });
});

describe("/tasks/{id}/reference", () => {
    test("can read task mention with open status", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession({name: "Alice Smith", role: "Admin"});

        const bot = await TestBot.createAndInstantiate(session);
        const apiKey = await bot.createApiKey(session);

        const task = await TestTask.create(session, {title: "Test Task Title"});

        await ProcessContextModule.waitForTestTasks();

        expect(
            await server.GET(`/tasks/${task.id}/reference`, {
                headers: {authorization: `bearer ${apiKey}`},
            }),
        ).toEqual({
            status: 200,
            headers: expect.objectContaining({"content-type": "application/json"}),
            body: {
                spaceId: space.id,
                reference: {
                    type: "Task",
                    id: task.id,
                    title: "Test Task Title",
                    status: {type: "Open", isActive: false},
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
            await server.GET(`/tasks/${task.id}/reference`, {
                headers: {authorization: `bearer ${apiKey}`},
            }),
        ).toEqual({
            status: 200,
            headers: expect.objectContaining({"content-type": "application/json"}),
            body: {
                spaceId: space.id,
                reference: {
                    type: "Task",
                    id: task.id,
                    title: "Closed Task",
                    status: {type: "Closed"},
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
            await server.GET(`/tasks/${task.id}/reference`, {
                headers: {authorization: `bearer ${apiKey}`},
            }),
        ).toEqual({
            status: 200,
            headers: expect.objectContaining({"content-type": "application/json"}),
            body: {
                spaceId: space.id,
                reference: {
                    type: "Task",
                    id: task.id,
                    title: "Active Task",
                    status: {type: "Open", isActive: true},
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
            await server.GET(`/tasks/${task.id}/reference`, {
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
            await server.GET(`/tasks/${generateId<TaskId>()}/reference`, {
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
            await server.GET(`/tasks/${task.id}/reference`, {
                headers: {authorization: `bearer ${apiKey}`},
            }),
        ).toEqual({
            status: 200,
            headers: expect.objectContaining({"content-type": "application/json"}),
            body: {
                spaceId: space.id,
                reference: {
                    type: "Task",
                    id: task.id,
                    title: "Scoped Task",
                    status: {type: "Open", isActive: false},
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
                message:
                    "Actor must be a member of the same space the task collection is in. Try again without an actor or with an actor in the same space as the task collection.",
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
                defaults: {filters: [], sorts: []},
            },
        },
    });
});

test("can read task collection default filters and sorts", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession({name: "Alice Smith", role: "Admin"});

    const bot = await TestBot.createAndInstantiate(session);
    const apiKey = await bot.createApiKey(session);

    const collection = await TestTaskCollection.create(session, {
        name: "Prioritized Tasks",
        access: "Public",
    });

    await collection.updateDefaults(session, {
        filters: [
            {
                type: "Priority",
                operation: {type: "OneOf", priorities: new Set(["High", "Urgent"])},
            },
        ],
        sorts: [{type: "DueDate", direction: "Ascending"}],
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
                name: "Prioritized Tasks",
                defaults: {
                    filters: [
                        {
                            type: "Priority",
                            operation: {
                                type: "OneOf",
                                priorities: [{type: "High"}, {type: "Urgent"}],
                            },
                        },
                    ],
                    sorts: [{type: "Due", direction: "Ascending"}],
                },
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

describe("/task-collections/{id}/reference", () => {
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
            await server.GET(`/task-collections/${collection.id}/reference`, {
                headers: {authorization: `bearer ${apiKey}`},
            }),
        ).toEqual({
            status: 200,
            headers: expect.objectContaining({"content-type": "application/json"}),
            body: {
                spaceId: space.id,
                reference: {
                    type: "TaskCollection",
                    id: collection.id,
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
            await server.GET(`/task-collections/${collection.id}/reference`, {
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
            await server.GET(`/task-collections/${generateId<TaskCollectionId>()}/reference`, {
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
    type TaskCollectionTasksResponse = {
        body: {
            nextCursor: string | null;
            tasks: ReadonlyArray<{
                cursor: string;
                task: {
                    id: TaskId;
                    collections?: ReadonlyArray<{
                        collection: {id: TaskCollectionId};
                    }>;
                };
            }>;
        };
    };

    function getTaskCollectionTaskIds(response: TaskCollectionTasksResponse): Array<TaskId> {
        return response.body.tasks.map(({task}) => task.id);
    }

    function getTaskCollectionNextCursor(response: TaskCollectionTasksResponse): string {
        expect(response.body.nextCursor).toEqual(expect.any(String));
        return response.body.nextCursor!;
    }

    function getTaskCollectionTaskCursors(response: TaskCollectionTasksResponse): Array<string> {
        return response.body.tasks.map(({cursor}) => cursor);
    }

    function getTestTaskIds(tasks: ReadonlyArray<TestTask>): Array<TaskId> {
        return tasks.map(task => task.id);
    }

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
                        cursor: expect.any(String),
                        task: {
                            creator: {id: session.account.id},
                            id: task1.id,
                            title: "First Task",
                            status: {type: "Open", isActive: false},
                            subtasks: {openTaskCount: 0, closedTaskCount: 0},
                            collections: [
                                {
                                    collection: {id: collection.id, name: "Public Collection"},
                                },
                            ],
                        },
                    },
                    {
                        cursor: expect.any(String),
                        task: {
                            creator: {id: session.account.id},
                            id: task2.id,
                            title: "Second Task",
                            status: {type: "Open", isActive: false},
                            subtasks: {openTaskCount: 0, closedTaskCount: 0},
                            collections: [
                                {
                                    collection: {id: collection.id, name: "Public Collection"},
                                },
                            ],
                        },
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

        expect(response.status).toBe(200);
        expect(getTaskCollectionTaskIds(response)).toEqual([task1.id, task2.id, task3.id]);
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
            body: expect.objectContaining({
                spaceId: space.id,
                tasks: [
                    {
                        cursor: expect.any(String),
                        task: {
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
                            priority: {type: "High"},
                            subtasks: {openTaskCount: 0, closedTaskCount: 0},
                            collections: [
                                {
                                    collection: {
                                        id: collection.id,
                                        name: "Collection with Details",
                                    },
                                },
                            ],
                        },
                    },
                ],
                nextCursor: null,
            }),
        });
    });

    test("does not return private collection references on listed tasks", async () => {
        const space = await TestSpace.create(context);
        const session1 = await space.createSession({name: "Alice Smith", role: "Admin"});
        const session2 = await space.createSession({name: "Bob Johnson", role: "Admin"});

        const bot = await TestBot.createAndInstantiate(session1);
        const apiKey = await bot.createApiKey(session1);

        const mainCollection = await TestTaskCollection.create(session2, {
            name: "Main Collection",
            access: "Public",
        });
        const publicCollection = await TestTaskCollection.create(session2, {
            name: "Public Collection",
            access: "Public",
        });
        const privateCollection = await TestTaskCollection.create(session2, {
            name: "Private Collection",
            access: "Private",
        });
        const task = await TestTask.create(session2, {
            title: "Task with mixed collection references",
            collections: [mainCollection, publicCollection, privateCollection],
        });

        await ProcessContextModule.waitForTestTasks();

        const response = await server.GET(`/task-collections/${mainCollection.id}/tasks`, {
            headers: {authorization: `bearer ${apiKey}`},
        });

        expect(response).toEqual({
            status: 200,
            headers: expect.objectContaining({"content-type": "application/json"}),
            body: expect.objectContaining({
                spaceId: space.id,
                collection: {
                    id: mainCollection.id,
                    creator: {id: session2.account.id},
                    name: "Main Collection",
                    defaults: {filters: [], sorts: []},
                },
                tasks: [
                    expect.objectContaining({
                        cursor: expect.any(String),
                        task: expect.objectContaining({
                            id: task.id,
                            title: "Task with mixed collection references",
                            collections: [
                                {
                                    collection: {
                                        id: mainCollection.id,
                                        name: "Main Collection",
                                    },
                                },
                                {
                                    collection: {
                                        id: publicCollection.id,
                                        name: "Public Collection",
                                    },
                                },
                            ],
                        }),
                    }),
                ],
                nextCursor: null,
            }),
        });
    });

    test("returns a private parent placeholder on listed tasks", async () => {
        const space = await TestSpace.create(context);
        const session1 = await space.createSession({name: "Alice Smith", role: "Admin"});
        const session2 = await space.createSession({name: "Bob Johnson", role: "Admin"});

        const bot = await TestBot.createAndInstantiate(session1);
        const apiKey = await bot.createApiKey(session1);

        const collection = await TestTaskCollection.create(session2, {
            name: "Public Collection",
            access: "Public",
        });
        const parentTask = await TestTask.create(session2, {title: "Private Parent"});
        const childTask = await TestTask.create(session2, {
            title: "Child Task",
            parent: parentTask,
            collections: [collection],
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
                collection: {
                    id: collection.id,
                    creator: {id: session2.account.id},
                    name: "Public Collection",
                    defaults: {filters: [], sorts: []},
                },
                tasks: [
                    expect.objectContaining({
                        cursor: expect.any(String),
                        task: expect.objectContaining({
                            id: childTask.id,
                            title: "Child Task",
                            parent: {
                                task: {
                                    id: parentTask.id,
                                    title: "Private task",
                                    status: {type: "Closed"},
                                },
                            },
                            collections: [
                                {
                                    collection: {id: collection.id, name: "Public Collection"},
                                },
                            ],
                        }),
                    }),
                ],
                nextCursor: null,
            }),
        });
    });

    test("applies the collection default filters and sorts", async () => {
        const space = await TestSpace.create(context);
        const session1 = await space.createSession({name: "Alice Smith", role: "Admin"});

        const bot = await TestBot.createAndInstantiate(session1);
        const apiKey = await bot.createApiKey(session1);

        const collection = await TestTaskCollection.create(session1, {
            name: "Filtered and Sorted Collection",
            access: "Public",
        });

        await collection.updateDefaults(session1, {
            filters: [
                {
                    type: "Priority",
                    operation: {type: "OneOf", priorities: new Set(["High", "Urgent"])},
                },
            ],
            sorts: [{type: "Priority", direction: "Descending"}],
        });

        const lowTask = await TestTask.create(session1, {title: "Low Task", priority: "Low"});
        const highTask = await TestTask.create(session1, {title: "High Task", priority: "High"});
        const urgentTask = await TestTask.create(session1, {
            title: "Urgent Task",
            priority: "Urgent",
        });
        const closedUrgentTask = await TestTask.create(session1, {
            title: "Closed Urgent Task",
            priority: "Urgent",
            status: "Closed",
        });

        await runAllPromises([
            lowTask.addCollection(session1, collection),
            highTask.addCollection(session1, collection),
            urgentTask.addCollection(session1, collection),
            closedUrgentTask.addCollection(session1, collection),
        ]);

        await ProcessContextModule.waitForTestTasks();

        const response = await server.GET(`/task-collections/${collection.id}/tasks`, {
            headers: {authorization: `bearer ${apiKey}`},
        });

        expect(response.status).toBe(200);
        expect(response.body.collection.defaults).toEqual({
            filters: [
                {
                    type: "Priority",
                    operation: {
                        type: "OneOf",
                        priorities: [{type: "High"}, {type: "Urgent"}],
                    },
                },
            ],
            sorts: [{type: "Priority", direction: "Descending"}],
        });
        expect(getTaskCollectionTaskIds(response)).toEqual([urgentTask.id, highTask.id]);
    });

    test("paginates through a collection once", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession({name: "Alice Smith", role: "Admin"});

        const bot = await TestBot.createAndInstantiate(session);
        const apiKey = await bot.createApiKey(session);

        const collection = await TestTaskCollection.create(session, {
            name: "Paginated Collection",
            access: "Public",
        });

        const tasks = await runAllPromises(
            Array.from({length: 4}, (_, i) => TestTask.create(session, {title: `Task ${i + 1}`})),
        );

        for (const task of tasks) {
            await task.addCollection(session, collection);
        }

        await ProcessContextModule.waitForTestTasks();

        const firstPageResponse = await server.GET(
            `/task-collections/${collection.id}/tasks?limit=2`,
            {
                headers: {authorization: `bearer ${apiKey}`},
            },
        );
        expect(firstPageResponse.status).toBe(200);
        expect(getTaskCollectionTaskIds(firstPageResponse)).toEqual([tasks[0]!.id, tasks[1]!.id]);

        const secondPageResponse = await server.GET(
            `/task-collections/${collection.id}/tasks?limit=2&cursor=${getTaskCollectionNextCursor(firstPageResponse)}`,
            {
                headers: {authorization: `bearer ${apiKey}`},
            },
        );
        expect(secondPageResponse.status).toBe(200);
        expect(secondPageResponse.body.nextCursor).toBeNull();
        expect(getTaskCollectionTaskIds(secondPageResponse)).toEqual([tasks[2]!.id, tasks[3]!.id]);
    });

    test("paginates twice through a collection with different limits", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession({name: "Alice Smith", role: "Admin"});

        const bot = await TestBot.createAndInstantiate(session);
        const apiKey = await bot.createApiKey(session);

        const collection = await TestTaskCollection.create(session, {
            name: "Multi-Page Collection",
            access: "Public",
        });

        const tasks = await runAllPromises(
            Array.from({length: 7}, (_, i) => TestTask.create(session, {title: `Task ${i + 1}`})),
        );

        for (const task of tasks) {
            await task.addCollection(session, collection);
        }

        await ProcessContextModule.waitForTestTasks();

        const firstPageResponse = await server.GET(
            `/task-collections/${collection.id}/tasks?limit=2`,
            {
                headers: {authorization: `bearer ${apiKey}`},
            },
        );
        expect(firstPageResponse.status).toBe(200);
        expect(getTaskCollectionTaskIds(firstPageResponse)).toEqual([tasks[0]!.id, tasks[1]!.id]);

        const secondPageResponse = await server.GET(
            `/task-collections/${collection.id}/tasks?limit=3&cursor=${getTaskCollectionNextCursor(firstPageResponse)}`,
            {
                headers: {authorization: `bearer ${apiKey}`},
            },
        );
        expect(secondPageResponse.status).toBe(200);
        expect(getTaskCollectionTaskIds(secondPageResponse)).toEqual([
            tasks[2]!.id,
            tasks[3]!.id,
            tasks[4]!.id,
        ]);

        const thirdPageResponse = await server.GET(
            `/task-collections/${collection.id}/tasks?limit=2&cursor=${getTaskCollectionNextCursor(secondPageResponse)}`,
            {
                headers: {authorization: `bearer ${apiKey}`},
            },
        );
        expect(thirdPageResponse.status).toBe(200);
        expect(thirdPageResponse.body.nextCursor).toBeNull();
        expect(getTaskCollectionTaskIds(thirdPageResponse)).toEqual([tasks[5]!.id, tasks[6]!.id]);
    });

    test("paginates ten tasks across multiple pages", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession({name: "Alice Smith", role: "Admin"});

        const bot = await TestBot.createAndInstantiate(session);
        const apiKey = await bot.createApiKey(session);

        const collection = await TestTaskCollection.create(session, {
            name: "Ten Task Collection",
            access: "Public",
        });
        const tasks = await runAllPromises(
            Array.from({length: 10}, (_, i) => TestTask.create(session, {title: `Task ${i + 1}`})),
        );

        for (const task of tasks) {
            await task.addCollection(session, collection);
        }

        await ProcessContextModule.waitForTestTasks();

        const firstPageResponse = await server.GET(
            `/task-collections/${collection.id}/tasks?limit=4`,
            {
                headers: {authorization: `bearer ${apiKey}`},
            },
        );
        expect(firstPageResponse.status).toBe(200);
        expect(getTaskCollectionTaskIds(firstPageResponse)).toEqual(
            getTestTaskIds(tasks.slice(0, 4)),
        );

        const secondPageResponse = await server.GET(
            `/task-collections/${collection.id}/tasks?limit=4&cursor=${getTaskCollectionNextCursor(firstPageResponse)}`,
            {
                headers: {authorization: `bearer ${apiKey}`},
            },
        );
        expect(secondPageResponse.status).toBe(200);
        expect(getTaskCollectionTaskIds(secondPageResponse)).toEqual(
            getTestTaskIds(tasks.slice(4, 8)),
        );

        const thirdPageResponse = await server.GET(
            `/task-collections/${collection.id}/tasks?limit=4&cursor=${getTaskCollectionNextCursor(secondPageResponse)}`,
            {
                headers: {authorization: `bearer ${apiKey}`},
            },
        );
        expect(thirdPageResponse.status).toBe(200);
        expect(thirdPageResponse.body.nextCursor).toBeNull();
        expect(getTaskCollectionTaskIds(thirdPageResponse)).toEqual(getTestTaskIds(tasks.slice(8)));
    });

    test("returns null cursor when limit exactly matches collection size", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession({name: "Alice Smith", role: "Admin"});

        const bot = await TestBot.createAndInstantiate(session);
        const apiKey = await bot.createApiKey(session);

        const collection = await TestTaskCollection.create(session, {
            name: "Exact Limit Collection",
            access: "Public",
        });
        const tasks = await runAllPromises(
            Array.from({length: 4}, (_, i) => TestTask.create(session, {title: `Task ${i + 1}`})),
        );

        for (const task of tasks) {
            await task.addCollection(session, collection);
        }

        await ProcessContextModule.waitForTestTasks();

        const response = await server.GET(`/task-collections/${collection.id}/tasks?limit=4`, {
            headers: {authorization: `bearer ${apiKey}`},
        });

        expect(response.status).toBe(200);
        expect(response.body.nextCursor).toBeNull();
        expect(getTaskCollectionTaskIds(response)).toEqual(getTestTaskIds(tasks));
    });

    test("returns an underfilled page when limit is larger than collection size", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession({name: "Alice Smith", role: "Admin"});

        const bot = await TestBot.createAndInstantiate(session);
        const apiKey = await bot.createApiKey(session);

        const collection = await TestTaskCollection.create(session, {
            name: "Underfilled Collection",
            access: "Public",
        });
        const tasks = await runAllPromises(
            Array.from({length: 4}, (_, i) => TestTask.create(session, {title: `Task ${i + 1}`})),
        );

        for (const task of tasks) {
            await task.addCollection(session, collection);
        }

        await ProcessContextModule.waitForTestTasks();

        const response = await server.GET(`/task-collections/${collection.id}/tasks?limit=10`, {
            headers: {authorization: `bearer ${apiKey}`},
        });

        expect(response.status).toBe(200);
        expect(response.body.nextCursor).toBeNull();
        expect(getTaskCollectionTaskIds(response)).toEqual(getTestTaskIds(tasks));
    });

    test("returns an underfilled final page after a cursor", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession({name: "Alice Smith", role: "Admin"});

        const bot = await TestBot.createAndInstantiate(session);
        const apiKey = await bot.createApiKey(session);

        const collection = await TestTaskCollection.create(session, {
            name: "Underfilled Final Page Collection",
            access: "Public",
        });
        const tasks = await runAllPromises(
            Array.from({length: 7}, (_, i) => TestTask.create(session, {title: `Task ${i + 1}`})),
        );

        for (const task of tasks) {
            await task.addCollection(session, collection);
        }

        await ProcessContextModule.waitForTestTasks();

        const firstPageResponse = await server.GET(
            `/task-collections/${collection.id}/tasks?limit=3`,
            {
                headers: {authorization: `bearer ${apiKey}`},
            },
        );
        expect(firstPageResponse.status).toBe(200);
        expect(getTaskCollectionTaskIds(firstPageResponse)).toEqual(
            getTestTaskIds(tasks.slice(0, 3)),
        );

        const secondPageResponse = await server.GET(
            `/task-collections/${collection.id}/tasks?limit=10&cursor=${getTaskCollectionNextCursor(firstPageResponse)}`,
            {
                headers: {authorization: `bearer ${apiKey}`},
            },
        );
        expect(secondPageResponse.status).toBe(200);
        expect(secondPageResponse.body.nextCursor).toBeNull();
        expect(getTaskCollectionTaskIds(secondPageResponse)).toEqual(
            getTestTaskIds(tasks.slice(3)),
        );
    });

    test("repeats cached pagination with the same cursors and tasks", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession({name: "Alice Smith", role: "Admin"});

        const bot = await TestBot.createAndInstantiate(session);
        const apiKey = await bot.createApiKey(session);

        const collection = await TestTaskCollection.create(session, {
            name: "Cached Pagination Collection",
            access: "Public",
        });
        const tasks = await runAllPromises(
            Array.from({length: 8}, (_, i) => TestTask.create(session, {title: `Task ${i + 1}`})),
        );

        for (const task of tasks) {
            await task.addCollection(session, collection);
        }

        await ProcessContextModule.waitForTestTasks();

        const firstPageResponse = await server.GET(
            `/task-collections/${collection.id}/tasks?limit=3`,
            {
                headers: {authorization: `bearer ${apiKey}`},
            },
        );
        expect(firstPageResponse.status).toBe(200);
        expect(getTaskCollectionTaskIds(firstPageResponse)).toEqual(
            getTestTaskIds(tasks.slice(0, 3)),
        );

        const secondPagePath =
            `/task-collections/${collection.id}/tasks?limit=3` +
            `&cursor=${getTaskCollectionNextCursor(firstPageResponse)}`;
        const secondPageResponse = await server.GET(secondPagePath, {
            headers: {authorization: `bearer ${apiKey}`},
        });
        expect(secondPageResponse.status).toBe(200);
        expect(getTaskCollectionTaskIds(secondPageResponse)).toEqual(
            getTestTaskIds(tasks.slice(3, 6)),
        );

        const repeatedFirstPageResponse = await server.GET(
            `/task-collections/${collection.id}/tasks?limit=3`,
            {
                headers: {authorization: `bearer ${apiKey}`},
            },
        );
        expect(repeatedFirstPageResponse.status).toBe(200);
        expect(getTaskCollectionTaskIds(repeatedFirstPageResponse)).toEqual(
            getTaskCollectionTaskIds(firstPageResponse),
        );
        expect(getTaskCollectionTaskCursors(repeatedFirstPageResponse)).toEqual(
            getTaskCollectionTaskCursors(firstPageResponse),
        );
        expect(repeatedFirstPageResponse.body.nextCursor).toEqual(
            firstPageResponse.body.nextCursor,
        );

        const repeatedSecondPageResponse = await server.GET(secondPagePath, {
            headers: {authorization: `bearer ${apiKey}`},
        });
        expect(repeatedSecondPageResponse.status).toBe(200);
        expect(getTaskCollectionTaskIds(repeatedSecondPageResponse)).toEqual(
            getTaskCollectionTaskIds(secondPageResponse),
        );
        expect(getTaskCollectionTaskCursors(repeatedSecondPageResponse)).toEqual(
            getTaskCollectionTaskCursors(secondPageResponse),
        );
        expect(repeatedSecondPageResponse.body.nextCursor).toEqual(
            secondPageResponse.body.nextCursor,
        );
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
                        cursor: expect.any(String),
                        task: expect.objectContaining({
                            id: task.id,
                            title: "Only Task",
                        }),
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

        const [task1, task2, task3] = await runAllPromises([
            TestTask.create(session, {title: "Task 1"}),
            TestTask.create(session, {title: "Task 2"}),
            TestTask.create(session, {title: "Task 3"}),
        ]);

        await runAllPromises([
            task1.addCollection(session, collection),
            task2.addCollection(session, collection),
            task3.addCollection(session, collection),
        ]);

        await ProcessContextModule.waitForTestTasks();
        const response = await server.GET(`/task-collections/${collection.id}/tasks?limit=1`, {
            headers: {authorization: `bearer ${apiKey}`},
        });

        expect(response).toEqual({
            status: 200,
            headers: expect.objectContaining({"content-type": "application/json"}),
            body: expect.objectContaining({
                spaceId: space.id,
                tasks: [
                    expect.objectContaining({
                        cursor: expect.any(String),
                        task: expect.objectContaining({id: task1.id, title: "Task 1"}),
                    }),
                ],
                nextCursor: expect.any(String),
            }),
        });
    });

    test("returns 400 response for cursor strings in the incorrect format", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession({name: "Alice Smith", role: "Admin"});

        const bot = await TestBot.createAndInstantiate(session);
        const apiKey = await bot.createApiKey(session);

        const collection = await TestTaskCollection.create(session, {
            name: "Cursor Format Collection",
            access: "Public",
        });

        await ProcessContextModule.waitForTestTasks();

        const response = await server.GET(
            `/task-collections/${collection.id}/tasks?cursor=not-a-task-cursor`,
            {
                headers: {authorization: `bearer ${apiKey}`},
            },
        );

        expect(response).toEqual({
            status: 400,
            headers: expect.objectContaining({"content-type": "application/json"}),
            body: {
                error: expect.objectContaining({
                    message: expect.stringMatching("Invalid task query cursor for this collection"),
                }),
            },
        });
    });

    test("returns 400 response for a cursor from a different collection", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession({name: "Alice Smith", role: "Admin"});

        const bot = await TestBot.createAndInstantiate(session);
        const apiKey = await bot.createApiKey(session);

        const collection1 = await TestTaskCollection.create(session, {
            name: "First Collection",
            access: "Public",
        });
        const collection2 = await TestTaskCollection.create(session, {
            name: "Second Collection",
            access: "Public",
        });
        const [task1, task2] = await runAllPromises([
            TestTask.create(session, {title: "Task 1"}),
            TestTask.create(session, {title: "Task 2"}),
        ]);

        await runAllPromises([
            task1.addCollection(session, collection1),
            task2.addCollection(session, collection1),
            task1.addCollection(session, collection2),
        ]);
        await ProcessContextModule.waitForTestTasks();

        const collection1Response = await server.GET(
            `/task-collections/${collection1.id}/tasks?limit=1`,
            {
                headers: {authorization: `bearer ${apiKey}`},
            },
        );
        expect(collection1Response.status).toBe(200);

        const response = await server.GET(
            `/task-collections/${collection2.id}/tasks?cursor=${getTaskCollectionNextCursor(collection1Response)}`,
            {
                headers: {authorization: `bearer ${apiKey}`},
            },
        );

        expect(response).toEqual({
            status: 400,
            headers: expect.objectContaining({"content-type": "application/json"}),
            body: {
                error: expect.objectContaining({
                    message: expect.stringMatching("Invalid task query cursor for this collection"),
                }),
            },
        });
    });

    test("returns 400 response for a cursor from different default sorts", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession({name: "Alice Smith", role: "Admin"});

        const bot = await TestBot.createAndInstantiate(session);
        const apiKey = await bot.createApiKey(session);

        const collection = await TestTaskCollection.create(session, {
            name: "Changing Sorts Collection",
            access: "Public",
        });
        const [task1, task2] = await runAllPromises([
            TestTask.create(session, {title: "Task 1", priority: "Low"}),
            TestTask.create(session, {title: "Task 2", priority: "High"}),
        ]);

        await runAllPromises([
            task1.addCollection(session, collection),
            task2.addCollection(session, collection),
        ]);
        await ProcessContextModule.waitForTestTasks();

        const firstPageResponse = await server.GET(
            `/task-collections/${collection.id}/tasks?limit=1`,
            {
                headers: {authorization: `bearer ${apiKey}`},
            },
        );

        await collection.updateDefaults(session, {
            filters: [],
            sorts: [{type: "Priority", direction: "Descending"}],
        });
        await ProcessContextModule.waitForTestTasks();

        const response = await server.GET(
            `/task-collections/${collection.id}/tasks?cursor=${getTaskCollectionNextCursor(firstPageResponse)}`,
            {
                headers: {authorization: `bearer ${apiKey}`},
            },
        );

        expect(response).toEqual({
            status: 400,
            headers: expect.objectContaining({"content-type": "application/json"}),
            body: {
                error: expect.objectContaining({
                    message: expect.stringMatching("Invalid task query cursor for this collection"),
                }),
            },
        });
    });

    test("includes a parent reference when the parent task is above afterCursor", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession({name: "Alice Smith", role: "Admin"});

        const bot = await TestBot.createAndInstantiate(session);
        const apiKey = await bot.createApiKey(session);

        const collection = await TestTaskCollection.create(session, {
            name: "Parent Above Cursor Collection",
            access: "Public",
        });
        const parentTask = await TestTask.create(session, {title: "Parent Task"});
        const childTask = await TestTask.create(session, {
            title: "Child Task",
            parent: parentTask,
        });

        await parentTask.addCollection(session, collection);
        await childTask.addCollection(session, collection);
        await ProcessContextModule.waitForTestTasks();

        const firstPageResponse = await server.GET(
            `/task-collections/${collection.id}/tasks?limit=1`,
            {
                headers: {authorization: `bearer ${apiKey}`},
            },
        );

        const secondPageResponse = await server.GET(
            `/task-collections/${collection.id}/tasks?limit=1&cursor=${getTaskCollectionNextCursor(firstPageResponse)}`,
            {
                headers: {authorization: `bearer ${apiKey}`},
            },
        );

        expect(secondPageResponse).toEqual({
            status: 200,
            headers: expect.objectContaining({"content-type": "application/json"}),
            body: expect.objectContaining({
                tasks: [
                    expect.objectContaining({
                        cursor: expect.any(String),
                        task: expect.objectContaining({
                            id: childTask.id,
                            parent: {
                                task: {
                                    id: parentTask.id,
                                    title: "Parent Task",
                                    status: {type: "Open", isActive: false},
                                },
                            },
                        }),
                    }),
                ],
                nextCursor: null,
            }),
        });
    });

    test("includes a parent reference when the parent task is above but not equal to afterCursor", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession({name: "Alice Smith", role: "Admin"});

        const bot = await TestBot.createAndInstantiate(session);
        const apiKey = await bot.createApiKey(session);

        const collection = await TestTaskCollection.create(session, {
            name: "Parent Above Non-Cursor Collection",
            access: "Public",
        });
        const parentTask = await TestTask.create(session, {title: "Parent Task"});
        const cursorTask = await TestTask.create(session, {title: "Cursor Task"});
        const childTask = await TestTask.create(session, {
            title: "Child Task",
            parent: parentTask,
        });

        await parentTask.addCollection(session, collection);
        await cursorTask.addCollection(session, collection);
        await childTask.addCollection(session, collection);
        await ProcessContextModule.waitForTestTasks();

        const firstPageResponse = await server.GET(
            `/task-collections/${collection.id}/tasks?limit=2`,
            {
                headers: {authorization: `bearer ${apiKey}`},
            },
        );
        expect(firstPageResponse.status).toBe(200);
        expect(getTaskCollectionTaskIds(firstPageResponse)).toEqual([parentTask.id, cursorTask.id]);

        const secondPageResponse = await server.GET(
            `/task-collections/${collection.id}/tasks?limit=1&cursor=${getTaskCollectionNextCursor(firstPageResponse)}`,
            {
                headers: {authorization: `bearer ${apiKey}`},
            },
        );

        expect(secondPageResponse).toEqual({
            status: 200,
            headers: expect.objectContaining({"content-type": "application/json"}),
            body: expect.objectContaining({
                tasks: [
                    expect.objectContaining({
                        cursor: expect.any(String),
                        task: expect.objectContaining({
                            id: childTask.id,
                            parent: {
                                task: {
                                    id: parentTask.id,
                                    title: "Parent Task",
                                    status: {type: "Open", isActive: false},
                                },
                            },
                        }),
                    }),
                ],
                nextCursor: null,
            }),
        });
    });

    test("includes a parent reference when the parent task is after endCursor", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession({name: "Alice Smith", role: "Admin"});

        const bot = await TestBot.createAndInstantiate(session);
        const apiKey = await bot.createApiKey(session);

        const collection = await TestTaskCollection.create(session, {
            name: "Parent After End Cursor Collection",
            access: "Public",
        });
        const parentTask = await TestTask.create(session, {title: "Parent Task"});
        const childTask = await TestTask.create(session, {
            title: "Child Task",
            parent: parentTask,
        });
        const siblingTask = await TestTask.create(session, {title: "Sibling Task"});

        await childTask.addCollection(session, collection);
        await siblingTask.addCollection(session, collection);
        await parentTask.addCollection(session, collection);
        await ProcessContextModule.waitForTestTasks();

        const response = await server.GET(`/task-collections/${collection.id}/tasks?limit=1`, {
            headers: {authorization: `bearer ${apiKey}`},
        });

        expect(response).toEqual({
            status: 200,
            headers: expect.objectContaining({"content-type": "application/json"}),
            body: expect.objectContaining({
                tasks: [
                    expect.objectContaining({
                        cursor: expect.any(String),
                        task: expect.objectContaining({
                            id: childTask.id,
                            parent: {
                                task: {
                                    id: parentTask.id,
                                    title: "Parent Task",
                                    status: {type: "Open", isActive: false},
                                },
                            },
                        }),
                    }),
                ],
                nextCursor: expect.any(String),
            }),
        });
    });

    test("paginates when the previous page end task moves into the next page", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession({name: "Alice Smith", role: "Admin"});

        const bot = await TestBot.createAndInstantiate(session);
        const apiKey = await bot.createApiKey(session);

        const collection = await TestTaskCollection.create(session, {
            name: "Moving Later Collection",
            access: "Public",
        });
        const tasks = await runAllPromises(
            Array.from({length: 5}, (_, i) => TestTask.create(session, {title: `Task ${i + 1}`})),
        );

        for (const task of tasks) {
            await task.addCollection(session, collection);
        }
        await ProcessContextModule.waitForTestTasks();

        const firstPageResponse = await server.GET(
            `/task-collections/${collection.id}/tasks?limit=3`,
            {
                headers: {authorization: `bearer ${apiKey}`},
            },
        );
        expect(firstPageResponse.status).toBe(200);
        expect(getTaskCollectionTaskIds(firstPageResponse)).toEqual([
            tasks[0]!.id,
            tasks[1]!.id,
            tasks[2]!.id,
        ]);

        await tasks[2]!.updateCollectionPosition(session, collection, {
            orderTime: testTaskClock.now(),
            orderKey: initialOrderKey,
        });
        await ProcessContextModule.waitForTestTasks();

        const secondPageResponse = await server.GET(
            `/task-collections/${collection.id}/tasks?limit=3&cursor=${getTaskCollectionNextCursor(firstPageResponse)}`,
            {
                headers: {authorization: `bearer ${apiKey}`},
            },
        );
        expect(secondPageResponse.status).toBe(200);
        expect(secondPageResponse.body.nextCursor).toBeNull();
        expect(getTaskCollectionTaskIds(secondPageResponse)).toEqual([
            tasks[3]!.id,
            tasks[4]!.id,
            tasks[2]!.id,
        ]);
    });

    test("paginates when the previous page end task moves to an earlier page", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession({name: "Alice Smith", role: "Admin"});

        const bot = await TestBot.createAndInstantiate(session);
        const apiKey = await bot.createApiKey(session);

        const collection = await TestTaskCollection.create(session, {
            name: "Moving Earlier Collection",
            access: "Public",
        });
        const tasks = await runAllPromises(
            Array.from({length: 5}, (_, i) => TestTask.create(session, {title: `Task ${i + 1}`})),
        );

        for (const task of tasks) {
            await task.addCollection(session, collection);
        }
        await ProcessContextModule.waitForTestTasks();

        const firstPageResponse = await server.GET(
            `/task-collections/${collection.id}/tasks?limit=3`,
            {
                headers: {authorization: `bearer ${apiKey}`},
            },
        );
        expect(firstPageResponse.status).toBe(200);
        expect(getTaskCollectionTaskIds(firstPageResponse)).toEqual([
            tasks[0]!.id,
            tasks[1]!.id,
            tasks[2]!.id,
        ]);

        await tasks[2]!.updateCollectionPosition(session, collection, {
            orderTime: zeroHybridLogicalTime,
            orderKey: initialOrderKey,
        });
        await ProcessContextModule.waitForTestTasks();

        const secondPageResponse = await server.GET(
            `/task-collections/${collection.id}/tasks?limit=3&cursor=${getTaskCollectionNextCursor(firstPageResponse)}`,
            {
                headers: {authorization: `bearer ${apiKey}`},
            },
        );
        expect(secondPageResponse.status).toBe(200);
        expect(secondPageResponse.body.nextCursor).toBeNull();
        expect(getTaskCollectionTaskIds(secondPageResponse)).toEqual([tasks[3]!.id, tasks[4]!.id]);
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
                        cursor: expect.any(String),
                        task: expect.objectContaining({
                            id: task.id,
                            collections: [
                                {
                                    collection: {
                                        id: activeCollection.id,
                                        name: "Active Collection",
                                    },
                                },
                            ],
                        }),
                    }),
                ],
            }),
        });
    });
});

describe("POST /task-collections/{id}/tasks/query", () => {
    test("applies explicit filters and sorts while paginating", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession({name: "Alice Smith", role: "Admin"});

        const bot = await TestBot.createAndInstantiate(session);
        const apiKey = await bot.createApiKey(session);

        const collection = await TestTaskCollection.create(session, {
            name: "Queried Collection",
            access: "Public",
        });

        await collection.updateDefaults(session, {
            filters: [
                {
                    type: "Priority",
                    operation: {type: "OneOf", priorities: new Set(["Low"])},
                },
            ],
            sorts: [{type: "Priority", direction: "Ascending"}],
        });

        const [lowTask, highTask, urgentTask] = await runAllPromises([
            TestTask.create(session, {title: "Low Task", priority: "Low"}),
            TestTask.create(session, {title: "High Task", priority: "High"}),
            TestTask.create(session, {title: "Urgent Task", priority: "Urgent"}),
        ]);

        await runAllPromises([
            lowTask.addCollection(session, collection),
            highTask.addCollection(session, collection),
            urgentTask.addCollection(session, collection),
        ]);
        await ProcessContextModule.waitForTestTasks();

        const body = {
            filters: [
                {
                    type: "Priority",
                    operation: {
                        type: "OneOf",
                        priorities: [{type: "High"}, {type: "Urgent"}],
                    },
                },
            ],
            sorts: [{type: "Priority", direction: "Descending"}],
        };
        const firstPageResponse = await server.POST(
            `/task-collections/${collection.id}/tasks/query`,
            {
                headers: {authorization: `bearer ${apiKey}`},
                body: {...body, limit: 1},
            },
        );

        expect(firstPageResponse.status).toBe(200);
        expect(firstPageResponse.body.tasks.map(({task}: {task: {id: TaskId}}) => task.id)).toEqual(
            [urgentTask.id],
        );
        expect(firstPageResponse.body.nextCursor).toEqual(expect.any(String));

        const secondPageResponse = await server.POST(
            `/task-collections/${collection.id}/tasks/query`,
            {
                headers: {authorization: `bearer ${apiKey}`},
                body: {
                    ...body,
                    limit: 1,
                    cursor: firstPageResponse.body.nextCursor,
                },
            },
        );

        expect(secondPageResponse.status).toBe(200);
        expect(
            secondPageResponse.body.tasks.map(({task}: {task: {id: TaskId}}) => task.id),
        ).toEqual([highTask.id]);
        expect(secondPageResponse.body.nextCursor).toBeNull();
    });

    test("uses default filters when filters are omitted and provided sorts", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession({name: "Alice Smith", role: "Admin"});

        const bot = await TestBot.createAndInstantiate(session);
        const apiKey = await bot.createApiKey(session);

        const collection = await TestTaskCollection.create(session, {
            name: "Default Filters Collection",
            access: "Public",
        });

        await collection.updateDefaults(session, {
            filters: [
                {
                    type: "Priority",
                    operation: {type: "OneOf", priorities: new Set(["High", "Urgent"])},
                },
            ],
            sorts: [{type: "Priority", direction: "Ascending"}],
        });

        const [lowTask, highTask, urgentTask] = await runAllPromises([
            TestTask.create(session, {title: "Low Task", priority: "Low"}),
            TestTask.create(session, {title: "High Task", priority: "High"}),
            TestTask.create(session, {title: "Urgent Task", priority: "Urgent"}),
        ]);

        await runAllPromises([
            lowTask.addCollection(session, collection),
            highTask.addCollection(session, collection),
            urgentTask.addCollection(session, collection),
        ]);
        await ProcessContextModule.waitForTestTasks();

        const response = await server.POST(`/task-collections/${collection.id}/tasks/query`, {
            headers: {authorization: `bearer ${apiKey}`},
            body: {sorts: [{type: "Priority", direction: "Descending"}]},
        });

        expect(response.status).toBe(200);
        expect(response.body.tasks.map(({task}: {task: {id: TaskId}}) => task.id)).toEqual([
            urgentTask.id,
            highTask.id,
        ]);
    });

    test("uses provided filters and default sorts when sorts are omitted", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession({name: "Alice Smith", role: "Admin"});

        const bot = await TestBot.createAndInstantiate(session);
        const apiKey = await bot.createApiKey(session);

        const collection = await TestTaskCollection.create(session, {
            name: "Default Sorts Collection",
            access: "Public",
        });

        await collection.updateDefaults(session, {
            filters: [
                {
                    type: "Priority",
                    operation: {type: "OneOf", priorities: new Set(["Low"])},
                },
            ],
            sorts: [{type: "Priority", direction: "Descending"}],
        });

        const [lowTask, highTask, urgentTask] = await runAllPromises([
            TestTask.create(session, {title: "Low Task", priority: "Low"}),
            TestTask.create(session, {title: "High Task", priority: "High"}),
            TestTask.create(session, {title: "Urgent Task", priority: "Urgent"}),
        ]);

        await runAllPromises([
            lowTask.addCollection(session, collection),
            highTask.addCollection(session, collection),
            urgentTask.addCollection(session, collection),
        ]);
        await ProcessContextModule.waitForTestTasks();

        const response = await server.POST(`/task-collections/${collection.id}/tasks/query`, {
            headers: {authorization: `bearer ${apiKey}`},
            body: {
                filters: [
                    {
                        type: "Priority",
                        operation: {
                            type: "OneOf",
                            priorities: [{type: "High"}, {type: "Urgent"}],
                        },
                    },
                ],
            },
        });

        expect(response.status).toBe(200);
        expect(response.body.tasks.map(({task}: {task: {id: TaskId}}) => task.id)).toEqual([
            urgentTask.id,
            highTask.id,
        ]);
    });

    test("paginates 12 tasks five at a time with custom sorts", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession({name: "Alice Smith", role: "Admin"});

        const bot = await TestBot.createAndInstantiate(session);
        const apiKey = await bot.createApiKey(session);
        const collection = await TestTaskCollection.create(session, {
            name: "Custom Sorted Pagination Collection",
            access: "Public",
        });
        const tasks: Array<TestTask> = [];

        for (let index = 0; index < 12; index++) {
            const task = await TestTask.create(session, {title: `Task ${index + 1}`});
            await task.addCollection(session, collection);
            tasks.push(task);
        }
        await ProcessContextModule.waitForTestTasks();

        const body = {
            limit: 5,
            sorts: [{type: "CreatedTime", direction: "Descending"}],
        };
        const firstPageResponse = await server.POST(
            `/task-collections/${collection.id}/tasks/query`,
            {
                headers: {authorization: `bearer ${apiKey}`},
                body,
            },
        );
        const secondPageResponse = await server.POST(
            `/task-collections/${collection.id}/tasks/query`,
            {
                headers: {authorization: `bearer ${apiKey}`},
                body: {...body, cursor: firstPageResponse.body.nextCursor},
            },
        );
        const thirdPageResponse = await server.POST(
            `/task-collections/${collection.id}/tasks/query`,
            {
                headers: {authorization: `bearer ${apiKey}`},
                body: {...body, cursor: secondPageResponse.body.nextCursor},
            },
        );
        const expectedTaskIds = tasks.map(task => task.id).reverse();

        expect({
            statuses: [
                firstPageResponse.status,
                secondPageResponse.status,
                thirdPageResponse.status,
            ],
            taskIdsByPage: [firstPageResponse, secondPageResponse, thirdPageResponse].map(
                response => response.body.tasks.map(({task}: {task: {id: TaskId}}) => task.id),
            ),
            nextCursors: [
                firstPageResponse.body.nextCursor,
                secondPageResponse.body.nextCursor,
                thirdPageResponse.body.nextCursor,
            ],
        }).toEqual({
            statuses: [200, 200, 200],
            taskIdsByPage: [
                expectedTaskIds.slice(0, 5),
                expectedTaskIds.slice(5, 10),
                expectedTaskIds.slice(10, 12),
            ],
            nextCursors: [expect.any(String), expect.any(String), null],
        });
    });

    test("rejects a cursor from a query with different sorts", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession({name: "Alice Smith", role: "Admin"});

        const bot = await TestBot.createAndInstantiate(session);
        const apiKey = await bot.createApiKey(session);
        const collection = await TestTaskCollection.create(session, {
            name: "Mismatched Sort Cursor Collection",
            access: "Public",
        });
        const [firstTask, secondTask] = await runAllPromises([
            TestTask.create(session, {title: "First Task", priority: "Low"}),
            TestTask.create(session, {title: "Second Task", priority: "High"}),
        ]);

        await runAllPromises([
            firstTask.addCollection(session, collection),
            secondTask.addCollection(session, collection),
        ]);
        await ProcessContextModule.waitForTestTasks();

        const firstPageResponse = await server.POST(
            `/task-collections/${collection.id}/tasks/query`,
            {
                headers: {authorization: `bearer ${apiKey}`},
                body: {
                    limit: 1,
                    sorts: [{type: "CreatedTime", direction: "Descending"}],
                },
            },
        );
        const mismatchedSortResponse = await server.POST(
            `/task-collections/${collection.id}/tasks/query`,
            {
                headers: {authorization: `bearer ${apiKey}`},
                body: {
                    limit: 1,
                    cursor: firstPageResponse.body.nextCursor,
                    sorts: [{type: "Priority", direction: "Ascending"}],
                },
            },
        );

        expect({
            firstPage: {
                status: firstPageResponse.status,
                nextCursor: firstPageResponse.body.nextCursor,
            },
            mismatchedSortResponse,
        }).toEqual({
            firstPage: {status: 200, nextCursor: expect.any(String)},
            mismatchedSortResponse: expectedApiErrorResponse(
                400,
                "Invalid task query cursor for this collection",
            ),
        });
    });
});

describe("/tasks/{id}/subtasks", () => {
    test("GET and POST require access to the parent task", async () => {
        const space = await TestSpace.create(context);
        const session1 = await space.createSession({role: "Admin"});
        const session2 = await space.createSession();

        const bot = await TestBot.createAndInstantiate(session1);
        const apiKey = await bot.createApiKey(session1);
        const parentTask = await TestTask.create(session2);
        await TestTask.create(session2, {parent: parentTask});
        await ProcessContextModule.waitForTestTasks();

        const [getResponse, postResponse] = await runAllPromises([
            server.GET(`/tasks/${parentTask.id}/subtasks`, {
                headers: {authorization: `bearer ${apiKey}`},
            }),
            server.POST(`/tasks/${parentTask.id}/subtasks/query`, {
                headers: {authorization: `bearer ${apiKey}`},
                body: {},
            }),
        ]);

        expect({getResponse, postResponse}).toEqual({
            getResponse: expectedApiErrorResponse(
                403,
                "You aren\u2019t allowed to access this task",
            ),
            postResponse: expectedApiErrorResponse(
                403,
                "You aren\u2019t allowed to access this task",
            ),
        });
    });

    test("GET returns the full task and all of its direct subtasks", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession({name: "Alice Smith", role: "Admin"});

        const bot = await TestBot.createAndInstantiate(session);
        const apiKey = await bot.createApiKey(session);
        const parentTask = await TestTask.create(session, {title: "Parent Task"});
        const openSubtask = await TestTask.create(session, {
            title: "Open Subtask",
            parent: parentTask,
        });
        const closedSubtask = await TestTask.create(session, {
            title: "Closed Subtask",
            status: "Closed",
            parent: parentTask,
        });
        await TestTask.create(session, {title: "Grandchild", parent: openSubtask});
        await TestTask.create(session, {title: "Unrelated Task"});
        await ProcessContextModule.waitForTestTasks();

        const response = await server.GET(`/tasks/${parentTask.id}/subtasks`, {
            headers: {authorization: `bearer ${apiKey}`},
        });

        expect({
            status: response.status,
            spaceId: response.body.spaceId,
            task: response.body.task,
            nextCursor: response.body.nextCursor,
            taskIds: response.body.tasks.map(({task}: {task: {id: TaskId}}) => task.id),
        }).toEqual({
            status: 200,
            spaceId: space.id,
            task: expect.objectContaining({
                id: parentTask.id,
                title: "Parent Task",
                subtasks: {openTaskCount: 1, closedTaskCount: 1},
                notes: expect.objectContaining({version: 0}),
            }),
            nextCursor: null,
            taskIds: [openSubtask.id, closedSubtask.id],
        });
    });

    test("GET paginates 12 subtasks five at a time", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession({name: "Alice Smith", role: "Admin"});

        const bot = await TestBot.createAndInstantiate(session);
        const apiKey = await bot.createApiKey(session);
        const parentTask = await TestTask.create(session, {title: "Parent Task"});
        const subtasks: Array<TestTask> = [];

        for (let index = 0; index < 12; index++) {
            subtasks.push(
                await TestTask.create(session, {
                    title: `Subtask ${index + 1}`,
                    parent: parentTask,
                }),
            );
        }
        await ProcessContextModule.waitForTestTasks();

        const firstPageResponse = await server.GET(`/tasks/${parentTask.id}/subtasks?limit=5`, {
            headers: {authorization: `bearer ${apiKey}`},
        });
        const secondPageResponse = await server.GET(
            `/tasks/${parentTask.id}/subtasks?limit=5&cursor=${firstPageResponse.body.nextCursor}`,
            {headers: {authorization: `bearer ${apiKey}`}},
        );
        const thirdPageResponse = await server.GET(
            `/tasks/${parentTask.id}/subtasks?limit=5&cursor=${secondPageResponse.body.nextCursor}`,
            {headers: {authorization: `bearer ${apiKey}`}},
        );
        const expectedTaskIds = subtasks.map(task => task.id);

        expect({
            statuses: [
                firstPageResponse.status,
                secondPageResponse.status,
                thirdPageResponse.status,
            ],
            taskIdsByPage: [firstPageResponse, secondPageResponse, thirdPageResponse].map(
                response => response.body.tasks.map(({task}: {task: {id: TaskId}}) => task.id),
            ),
            nextCursors: [
                firstPageResponse.body.nextCursor,
                secondPageResponse.body.nextCursor,
                thirdPageResponse.body.nextCursor,
            ],
        }).toEqual({
            statuses: [200, 200, 200],
            taskIdsByPage: [
                expectedTaskIds.slice(0, 5),
                expectedTaskIds.slice(5, 10),
                expectedTaskIds.slice(10, 12),
            ],
            nextCursors: [expect.any(String), expect.any(String), null],
        });
    });

    test("POST applies custom filters and sorts to direct subtasks", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession({name: "Alice Smith", role: "Admin"});

        const bot = await TestBot.createAndInstantiate(session);
        const apiKey = await bot.createApiKey(session);
        const parentTask = await TestTask.create(session, {title: "Parent Task"});
        const otherParentTask = await TestTask.create(session, {title: "Other Parent Task"});
        await TestTask.create(session, {
            title: "Low Subtask",
            priority: "Low",
            parent: parentTask,
        });
        const highSubtask = await TestTask.create(session, {
            title: "High Subtask",
            priority: "High",
            parent: parentTask,
        });
        const closedUrgentSubtask = await TestTask.create(session, {
            title: "Closed Urgent Subtask",
            status: "Closed",
            priority: "Urgent",
            parent: parentTask,
        });
        await TestTask.create(session, {
            title: "Other Urgent Subtask",
            priority: "Urgent",
            parent: otherParentTask,
        });
        await ProcessContextModule.waitForTestTasks();

        const body = {
            limit: 1,
            filters: [
                {
                    type: "Priority",
                    operation: {
                        type: "OneOf",
                        priorities: [{type: "High"}, {type: "Urgent"}],
                    },
                },
            ],
            sorts: [{type: "Priority", direction: "Descending"}],
        };
        const firstPageResponse = await server.POST(`/tasks/${parentTask.id}/subtasks/query`, {
            headers: {authorization: `bearer ${apiKey}`},
            body,
        });
        const secondPageResponse = await server.POST(`/tasks/${parentTask.id}/subtasks/query`, {
            headers: {authorization: `bearer ${apiKey}`},
            body: {...body, cursor: firstPageResponse.body.nextCursor},
        });

        expect({
            statuses: [firstPageResponse.status, secondPageResponse.status],
            parentTaskIds: [firstPageResponse.body.task.id, secondPageResponse.body.task.id],
            taskIdsByPage: [firstPageResponse, secondPageResponse].map(response =>
                response.body.tasks.map(({task}: {task: {id: TaskId}}) => task.id),
            ),
            nextCursors: [firstPageResponse.body.nextCursor, secondPageResponse.body.nextCursor],
        }).toEqual({
            statuses: [200, 200],
            parentTaskIds: [parentTask.id, parentTask.id],
            taskIdsByPage: [[closedUrgentSubtask.id], [highSubtask.id]],
            nextCursors: [expect.any(String), null],
        });
    });
});
