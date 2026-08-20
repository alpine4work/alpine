import {CalendarDate} from "@internationalized/date";
import {ApiServiceBotActionContext} from "~/server/api/internal/shared/api_service_context.js";
import {
    commitTaskPatchesFromApi,
    commitTaskPatchesFromApiBeforeLoadNewReferencesTestCheckpoint,
} from "~/server/api/internal/tasks/internal/commit_task_patches_from_api.js";
import {TestBot} from "~/server/bots/test_helpers/test_bot.js";
import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {tasksInjection} from "~/server/tasks/data/tasks_injection.js";
import {TestTask} from "~/server/tasks/data/test_helpers/test_task.js";
import {TestTaskCollection} from "~/server/tasks/data/test_helpers/test_task_collection.js";
import {TestTaskRealtimeServer} from "~/server/tasks/realtime/test_helpers/test_task_realtime_server.js";
import {ApiTaskPatchRequest} from "~/shared/api/specification/types/api_specification_convenience_types.open_source.js";
import {ProcessContextModule} from "~/shared/context/process_context_module.js";
import {FailedPreconditionError} from "~/shared/error/error.open_source.js";
import {errorDisplayMessage} from "~/shared/error/error_display_message.open_source.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.open_source.js";
import {SpaceId, TaskId} from "~/shared/id/types/id_types.open_source.js";
import {TaskModel} from "~/shared/tasks/model/task_model.js";
import {waitForExpect} from "~/shared/test_helpers/wait_for_expect.js";

const context = TestTaskRealtimeServer.with(
    createTestContext({
        shouldStartOpensearch: true,
        tasksInjection,
    }),
);

/**
 * Commits `patches` against a single existing task and returns the updated task
 * model, mirroring how `PATCH /tasks/{id}` uses `commitTaskPatchesFromApi()`.
 */
async function updateTaskForTest(
    botContext: ApiServiceBotActionContext,
    spaceId: SpaceId,
    taskId: TaskId,
    patches: ReadonlyArray<ApiTaskPatchRequest>,
): Promise<TaskModel> {
    const {tasks} = await commitTaskPatchesFromApi(botContext, {
        spaceId,
        actorId: null,
        patches: patches.map(patch => ({type: "Update", id: taskId, patch})),
    });

    return assertExists(tasks[0]);
}

test("applies a SetTitle patch", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession({name: "Alice Smith", role: "Admin"});
    const bot = await TestBot.createAndInstantiate(session);

    const task = await TestTask.create(session, {title: "Original Title"});

    await ProcessContextModule.waitForTestTasks();

    const updatedTask = await updateTaskForTest(
        context.getTaskRealtimeServer().botAction(bot, session),
        space.id,
        task.id,
        [{type: "SetTitle", title: "Updated Title"}],
    );

    expect(updatedTask.getTitle().getText()).toBe("Updated Title");
});

test("applies a SetAssignee patch", async () => {
    const space = await TestSpace.create(context);
    const session1 = await space.createSession({name: "Alice Smith", role: "Admin"});
    const session2 = await space.createSession({name: "Bob Johnson"});
    const bot = await TestBot.createAndInstantiate(session1);

    const task = await TestTask.create(session1, {title: "Task"});

    await ProcessContextModule.waitForTestTasks();

    const updatedTask = await updateTaskForTest(
        context.getTaskRealtimeServer().botAction(bot, session1),
        space.id,
        task.id,
        [{type: "SetAssignee", assignee: {id: session2.account.id}}],
    );

    expect(updatedTask.getAssignee()?.assignee.accountId).toBe(session2.account.id);
});

test("clearing the assignee with a null SetAssignee patch deactivates the task", async () => {
    const space = await TestSpace.create(context);
    const session1 = await space.createSession({name: "Alice Smith", role: "Admin"});
    const session2 = await space.createSession({name: "Bob Johnson"});
    const bot = await TestBot.createAndInstantiate(session1);

    const task = await TestTask.create(session1, {title: "Active Task"});
    await task.updateAssignee(session1, session2, {assigneeStatus: "Active"});

    await ProcessContextModule.waitForTestTasks();

    const updatedTask = await updateTaskForTest(
        context.getTaskRealtimeServer().botAction(bot, session1),
        space.id,
        task.id,
        [{type: "SetAssignee", assignee: null}],
    );

    expect(updatedTask.getDisplayStatus()).toBe("OpenInactive");
});

test("applies a SetStatus patch that closes the task", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession({name: "Alice Smith", role: "Admin"});
    const bot = await TestBot.createAndInstantiate(session);

    const task = await TestTask.create(session, {title: "Open Task"});

    await ProcessContextModule.waitForTestTasks();

    const updatedTask = await updateTaskForTest(
        context.getTaskRealtimeServer().botAction(bot, session),
        space.id,
        task.id,
        [{type: "SetStatus", status: {type: "Closed"}}],
    );

    expect(updatedTask.getDisplayStatus()).toBe("Closed");
});

test("applies a SetStatus patch that activates the task and auto-assigns the bot", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession({name: "Alice Smith", role: "Admin"});
    const bot = await TestBot.createAndInstantiate(session);

    const task = await TestTask.create(session, {title: "Inactive Task"});

    await ProcessContextModule.waitForTestTasks();

    const updatedTask = await updateTaskForTest(
        context.getTaskRealtimeServer().botAction(bot, session),
        space.id,
        task.id,
        [{type: "SetStatus", status: {type: "Open", isActive: true}}],
    );

    expect({
        displayStatus: updatedTask.getDisplayStatus(),
        assigneeId: updatedTask.getAssignee()?.assignee.accountId,
    }).toEqual({displayStatus: "OpenActive", assigneeId: bot.id});
});

test("applies a SetDue patch", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession({name: "Alice Smith", role: "Admin"});
    const bot = await TestBot.createAndInstantiate(session);

    const task = await TestTask.create(session, {title: "Task"});

    await ProcessContextModule.waitForTestTasks();

    const updatedTask = await updateTaskForTest(
        context.getTaskRealtimeServer().botAction(bot, session),
        space.id,
        task.id,
        [{type: "SetDue", due: {date: "2026-06-15"}}],
    );

    expect(updatedTask.getDueDate()?.toString()).toBe("2026-06-15");
});

test("clearing the due date with a null SetDue patch", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession({name: "Alice Smith", role: "Admin"});
    const bot = await TestBot.createAndInstantiate(session);

    const task = await TestTask.create(session, {
        title: "Task",
        dueDate: new CalendarDate(2026, 12, 31),
    });

    await ProcessContextModule.waitForTestTasks();

    const updatedTask = await updateTaskForTest(
        context.getTaskRealtimeServer().botAction(bot, session),
        space.id,
        task.id,
        [{type: "SetDue", due: null}],
    );

    expect(updatedTask.getDueDate()).toBeNull();
});

test("applies a SetPriority patch", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession({name: "Alice Smith", role: "Admin"});
    const bot = await TestBot.createAndInstantiate(session);

    const task = await TestTask.create(session, {title: "Task"});

    await ProcessContextModule.waitForTestTasks();

    const updatedTask = await updateTaskForTest(
        context.getTaskRealtimeServer().botAction(bot, session),
        space.id,
        task.id,
        [{type: "SetPriority", priority: {type: "High"}}],
    );

    expect(updatedTask.getPriority()).toBe("High");
});

test("applies an AddCollection patch", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession({name: "Alice Smith", role: "Admin"});
    const bot = await TestBot.createAndInstantiate(session);

    const collection = await TestTaskCollection.create(session, {name: "Collection"});
    const task = await TestTask.create(session, {title: "Task"});

    await ProcessContextModule.waitForTestTasks();

    const updatedTask = await updateTaskForTest(
        context.getTaskRealtimeServer().botAction(bot, session),
        space.id,
        task.id,
        [{type: "AddCollection", item: {collection: {id: collection.id}}}],
    );

    expect(
        updatedTask
            .getCollections()
            .getArray()
            .map(({collectionId}) => collectionId),
    ).toEqual([collection.id]);
});

test("reports when access to a parent task is lost after the task update commits", async () => {
    const space = await TestSpace.create(context);
    const session1 = await space.createSession({name: "Alice Smith", role: "Admin"});
    const session2 = await space.createSession({name: "Bob Johnson", role: "Admin"});
    const bot = await TestBot.createAndInstantiate(session1);

    const task = await TestTask.create(session1, {title: "Task"});
    const parent = await TestTask.create(session2, {title: "Parent"});
    await parent.access.grant(session2, session1, "Edit");

    await ProcessContextModule.waitForTestTasks();
    await context.getTaskRealtimeServer().waitForApplyActionTransactions();

    const pausePromise = commitTaskPatchesFromApiBeforeLoadNewReferencesTestCheckpoint.pauseForTest(
        bot.id,
    );
    const updatePromise = updateTaskForTest(
        context.getTaskRealtimeServer().botAction(bot, session1),
        space.id,
        task.id,
        [{type: "SetParent", parent: {task: {id: parent.id}}}],
    );
    const {unpause} = await pausePromise;

    await waitForExpect(async () => {
        expect((await task.getItem()).parentTaskId.value).toBe(parent.id);
    });
    await parent.access.revoke(session2, session1);
    await ProcessContextModule.waitForTestTasks();
    await context.getTaskRealtimeServer().waitForApplyActionTransactions();

    unpause();

    const error = await updatePromise.catch((error: unknown) => error);
    const taskItem = await task.getItem();

    expect({
        isFailedPreconditionError: error instanceof FailedPreconditionError,
        displayMessage: error instanceof FailedPreconditionError ? error.displayMessage : undefined,
        parentTaskId: taskItem.parentTaskId.value,
    }).toEqual({
        isFailedPreconditionError: true,
        displayMessage: errorDisplayMessage`Update was successful, but we couldn\u2019t load the referenced parent task. This was probably due to a race condition. Try reading the updated task again.`,
        parentTaskId: parent.id,
    });
});

test("reports when access to a collection is lost after the task update commits", async () => {
    const space = await TestSpace.create(context);
    const session1 = await space.createSession({name: "Alice Smith", role: "Admin"});
    const session2 = await space.createSession({name: "Bob Johnson", role: "Admin"});
    const bot = await TestBot.createAndInstantiate(session1);

    const task = await TestTask.create(session1, {title: "Task"});
    const collection = await TestTaskCollection.create(session2, {name: "Collection"});
    await collection.access.grant(session2, session1, "Edit");

    await ProcessContextModule.waitForTestTasks();
    await context.getTaskRealtimeServer().waitForApplyActionTransactions();

    const pausePromise = commitTaskPatchesFromApiBeforeLoadNewReferencesTestCheckpoint.pauseForTest(
        bot.id,
    );
    const updatePromise = updateTaskForTest(
        context.getTaskRealtimeServer().botAction(bot, session1),
        space.id,
        task.id,
        [{type: "AddCollection", item: {collection: {id: collection.id}}}],
    );
    const {unpause} = await pausePromise;

    await waitForExpect(async () => {
        expect((await task.getItem()).collections.has(collection.id)).toBe(true);
    });
    await collection.access.revoke(session2, session1);
    await ProcessContextModule.waitForTestTasks();
    await context.getTaskRealtimeServer().waitForApplyActionTransactions();

    unpause();

    const error = await updatePromise.catch((error: unknown) => error);
    const taskItem = await task.getItem();

    expect({
        isFailedPreconditionError: error instanceof FailedPreconditionError,
        displayMessage: error instanceof FailedPreconditionError ? error.displayMessage : undefined,
        hasCollection: taskItem.collections.has(collection.id),
    }).toEqual({
        isFailedPreconditionError: true,
        displayMessage: errorDisplayMessage`Update was successful, but we couldn\u2019t load a referenced collection. This was probably due to a race condition. Try reading the updated task again.`,
        hasCollection: true,
    });
});

test("reports when access to both new task references is lost after commit", async () => {
    const space = await TestSpace.create(context);
    const session1 = await space.createSession({name: "Alice Smith", role: "Admin"});
    const session2 = await space.createSession({name: "Bob Johnson", role: "Admin"});
    const bot = await TestBot.createAndInstantiate(session1);

    const task = await TestTask.create(session1, {title: "Task"});
    const parent = await TestTask.create(session2, {title: "Parent"});
    const collection = await TestTaskCollection.create(session2, {name: "Collection"});
    await parent.access.grant(session2, session1, "Edit");
    await collection.access.grant(session2, session1, "Edit");

    await ProcessContextModule.waitForTestTasks();
    await context.getTaskRealtimeServer().waitForApplyActionTransactions();

    const pausePromise = commitTaskPatchesFromApiBeforeLoadNewReferencesTestCheckpoint.pauseForTest(
        bot.id,
    );
    const updatePromise = updateTaskForTest(
        context.getTaskRealtimeServer().botAction(bot, session1),
        space.id,
        task.id,
        [
            {type: "SetParent", parent: {task: {id: parent.id}}},
            {type: "AddCollection", item: {collection: {id: collection.id}}},
        ],
    );
    const {unpause} = await pausePromise;

    await waitForExpect(async () => {
        const taskItem = await task.getItem();
        expect({
            parentTaskId: taskItem.parentTaskId.value,
            hasCollection: taskItem.collections.has(collection.id),
        }).toEqual({
            parentTaskId: parent.id,
            hasCollection: true,
        });
    });
    await parent.access.revoke(session2, session1);
    await collection.access.revoke(session2, session1);
    await ProcessContextModule.waitForTestTasks();
    await context.getTaskRealtimeServer().waitForApplyActionTransactions();

    unpause();

    const error = await updatePromise.catch((error: unknown) => error);
    const taskItem = await task.getItem();

    expect({
        isFailedPreconditionError: error instanceof FailedPreconditionError,
        displayMessage: error instanceof FailedPreconditionError ? error.displayMessage : undefined,
        parentTaskId: taskItem.parentTaskId.value,
        hasCollection: taskItem.collections.has(collection.id),
    }).toEqual({
        isFailedPreconditionError: true,
        displayMessage: errorDisplayMessage`Update was successful, but we couldn\u2019t load the referenced parent task or a referenced collection. This was probably due to a race condition. Try reading the updated task again.`,
        parentTaskId: parent.id,
        hasCollection: true,
    });
});

test("applies a RemoveCollection patch", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession({name: "Alice Smith", role: "Admin"});
    const bot = await TestBot.createAndInstantiate(session);

    const collection = await TestTaskCollection.create(session, {name: "Collection"});
    const task = await TestTask.create(session, {title: "Task", collections: collection});

    await ProcessContextModule.waitForTestTasks();

    const updatedTask = await updateTaskForTest(
        context.getTaskRealtimeServer().botAction(bot, session),
        space.id,
        task.id,
        [{type: "RemoveCollection", collectionId: collection.id}],
    );

    expect(updatedTask.getCollections().getArray()).toEqual([]);
});

test("applies multiple metadata patches in a single request", async () => {
    const space = await TestSpace.create(context);
    const session1 = await space.createSession({name: "Alice Smith", role: "Admin"});
    const session2 = await space.createSession({name: "Bob Johnson"});
    const bot = await TestBot.createAndInstantiate(session1);

    const task = await TestTask.create(session1, {title: "Basic Task"});

    await ProcessContextModule.waitForTestTasks();

    const updatedTask = await updateTaskForTest(
        context.getTaskRealtimeServer().botAction(bot, session1),
        space.id,
        task.id,
        [
            {type: "SetTitle", title: "Updated Task"},
            {type: "SetAssignee", assignee: {id: session2.account.id}},
            {type: "SetPriority", priority: {type: "Urgent"}},
            {type: "SetDue", due: {date: "2026-06-15"}},
        ],
    );

    expect({
        title: updatedTask.getTitle().getText(),
        assigneeId: updatedTask.getAssignee()?.assignee.accountId,
        priority: updatedTask.getPriority(),
        dueDate: updatedTask.getDueDate()?.toString(),
    }).toEqual({
        title: "Updated Task",
        assigneeId: session2.account.id,
        priority: "Urgent",
        dueDate: "2026-06-15",
    });
});

test("returns the task unchanged when no patches change anything", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession({name: "Alice Smith", role: "Admin"});
    const bot = await TestBot.createAndInstantiate(session);

    const task = await TestTask.create(session, {title: "Unchanged Title"});

    await ProcessContextModule.waitForTestTasks();

    const updatedTask = await updateTaskForTest(
        context.getTaskRealtimeServer().botAction(bot, session),
        space.id,
        task.id,
        [{type: "SetTitle", title: "Unchanged Title"}],
    );

    expect(updatedTask.getTitle().getText()).toBe("Unchanged Title");
});

test("creates a task from a create patch\u2019s derived field patches", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession({name: "Alice Smith", role: "Admin"});
    const bot = await TestBot.createAndInstantiate(session);

    await ProcessContextModule.waitForTestTasks();

    const {tasks, results} = await commitTaskPatchesFromApi(
        context.getTaskRealtimeServer().botAction(bot, session),
        {
            spaceId: space.id,
            actorId: null,
            patches: [
                {
                    type: "Create",
                    task: {
                        title: "Created Task",
                        priority: {type: "High"},
                        status: {type: "Open", isActive: true},
                    },
                },
            ],
        },
    );

    const createdTask = assertExists(tasks[0]);

    expect({
        title: createdTask.getTitle().getText(),
        priority: createdTask.getPriority(),
        displayStatus: createdTask.getDisplayStatus(),
        assigneeId: createdTask.getAssignee()?.assignee.accountId,
        results,
    }).toEqual({
        title: "Created Task",
        priority: "High",
        displayStatus: "OpenActive",
        assigneeId: bot.id,
        results: [{type: "Create", task: {id: createdTask.id}, results: []}],
    });
});

test("creates and updates tasks in one commit with results in patch order", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession({name: "Alice Smith", role: "Admin"});
    const bot = await TestBot.createAndInstantiate(session);

    const existingTask = await TestTask.create(session, {title: "Existing Task"});

    await ProcessContextModule.waitForTestTasks();

    const {tasks, results} = await commitTaskPatchesFromApi(
        context.getTaskRealtimeServer().botAction(bot, session),
        {
            spaceId: space.id,
            actorId: null,
            patches: [
                {
                    type: "Update",
                    id: existingTask.id,
                    patch: {type: "SetTitle", title: "Existing Task updated"},
                },
                {type: "Create", task: {title: "Created Task"}},
            ],
        },
    );

    const createdTask = assertExists(tasks[1]);

    expect({
        taskIds: tasks.map(task => task.id),
        results,
    }).toMatchObject({
        taskIds: [existingTask.id, createdTask.id],
        results: [
            {type: "Update", result: {type: "SetTitle"}},
            {type: "Create", task: {id: createdTask.id}},
        ],
    });
});
