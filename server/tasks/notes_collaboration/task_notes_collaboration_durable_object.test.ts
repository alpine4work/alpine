import {Fragment, Slice} from "prosemirror-model";
import {ReplaceStep} from "prosemirror-transform";
import {createTestWorkerContext} from "~/server/cloudflare/test_helpers/create_test_worker_context.js";
import {documentsInjection} from "~/server/documents/data/documents_injection.js";
import {
    testMessagingRealtimeImplementation,
    testMessagingRealtimeImplementationSearchInjection,
} from "~/server/messaging/realtime/test_helpers/test_messaging_realtime_implementation.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {TestTask} from "~/server/tasks/data/test_helpers/test_task.js";
import {TestTaskCollection} from "~/server/tasks/data/test_helpers/test_task_collection.js";
import {updateTaskNotesContent} from "~/server/tasks/data/update_task_notes_content.js";
import {TaskNotesCollaborationDurableObject} from "~/server/tasks/notes_collaboration/task_notes_collaboration_durable_object.js";
import {emptyContentReferences} from "~/shared/content/content_references.js";
import {ProcessContextModule} from "~/shared/context/process_context_module.js";
import {InternalError, NotFoundError, PermissionDeniedError} from "~/shared/error/error.js";
import {filterMapArray} from "~/shared/helpers/array/filter_map_array.js";
import {defaultTimeZone} from "~/shared/helpers/intl/time_zone.js";
import {generateId} from "~/shared/id/id.js";
import {ContentEditorClientId, TaskId} from "~/shared/id/types/id_types.js";
import {
    createTaskComment,
    deleteTaskComment,
    updateTaskCommentContent,
} from "~/shared/rpc/tasks_rpc_definitions.js";
import {TaskCommentModel} from "~/shared/tasks/model/task_comment_model.js";
import {taskNotesBackfillFutureVersionErrorMessage} from "~/shared/tasks/task_error_messages.js";
import {TaskNotesContentProsemirrorSchema as schema} from "~/shared/tasks/task_notes_content_schema.js";

const context = createTestWorkerContext({
    documentsInjection,
    searchInjection: testMessagingRealtimeImplementationSearchInjection,
});
const {connectForTest} = TaskNotesCollaborationDurableObject.test(context);

function textSlice(text: string) {
    if (text.length === 0) return Slice.empty;
    return new Slice(Fragment.from(schema.text(text)), 0, 0);
}

test("can connect to a task", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const task = await TestTask.create(session);

    await connectForTest(context.action(session), task.id);
});

test("can connect to a task in a public collection", async () => {
    const space = await TestSpace.create(context);
    const session1 = await space.createSession();
    const session2 = await space.createSession();

    const task = await TestTask.create(session1);
    const collection = await TestTaskCollection.create(session1);
    await collection.access.grantDefault(session1);
    await task.addCollection(session1, collection);

    await connectForTest(context.action(session2), task.id);
});

test("can\u2019t connect to a task that doesn\u2019t exist", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    await expect(connectForTest(context.action(session), generateId())).rejects.toThrow(
        NotFoundError,
    );
});

test("can\u2019t connect to a task in a different space", async () => {
    const space = await TestSpace.create(context);
    const otherSpace = await TestSpace.create(context);
    const session1 = await space.createSession();
    const session2 = await otherSpace.createSession();

    const task = await TestTask.create(session1);
    const collection = await TestTaskCollection.create(session1);
    await collection.access.grantDefault(session1);
    await task.addCollection(session1, collection);

    await expect(connectForTest(context.action(session2), task.id)).rejects.toThrow(
        PermissionDeniedError,
    );
});

test("can\u2019t connect to a task in a private collection", async () => {
    const space = await TestSpace.create(context);
    const session1 = await space.createSession();
    const session2 = await space.createSession();

    const task = await TestTask.create(session1);
    const collection = await TestTaskCollection.create(session1);
    await task.addCollection(session1, collection);

    await expect(connectForTest(context.action(session2), task.id)).rejects.toThrow(
        PermissionDeniedError,
    );
});

test("can\u2019t connect to a task in a different space after durable object has been initialized", async () => {
    const space = await TestSpace.create(context);
    const otherSpace = await TestSpace.create(context);
    const session1 = await space.createSession();
    const session2 = await otherSpace.createSession();

    const task = await TestTask.create(session1);
    const collection = await TestTaskCollection.create(session1);
    await collection.access.grantDefault(session1);
    await task.addCollection(session1, collection);

    await connectForTest(context.action(session1), task.id);

    await expect(connectForTest(context.action(session2), task.id)).rejects.toThrow(
        PermissionDeniedError,
    );
});

test("can\u2019t connect to a task in a private collection after durable object has been initialized", async () => {
    const space = await TestSpace.create(context);
    const session1 = await space.createSession();
    const session2 = await space.createSession();

    const task = await TestTask.create(session1);
    const collection = await TestTaskCollection.create(session1);
    await task.addCollection(session1, collection);

    await connectForTest(context.action(session1), task.id);

    await expect(connectForTest(context.action(session2), task.id)).rejects.toThrow(
        PermissionDeniedError,
    );
});

test("can update a task\u2019s notes", async () => {
    const space = await TestSpace.create(context);
    const session1 = await space.createSession();
    const session2 = await space.createSession();

    const task = await TestTask.create(session1);
    const collection = await TestTaskCollection.create(session1);
    await collection.access.grantDefault(session1);
    await task.addCollection(session1, collection);

    const client1Id = generateId<ContentEditorClientId>();
    const client2Id = generateId<ContentEditorClientId>();

    const connection1 = await connectForTest(context.action(session1), task.id);
    const connection2 = await connectForTest(context.action(session2), task.id);

    expect(connection1.takeEvents()).toEqual([]);
    expect(connection2.takeEvents()).toEqual([]);

    await connection1.procedures.updateNotesContent({
        version: 0,
        steps: [new ReplaceStep(1, 1, textSlice("a")), new ReplaceStep(2, 2, textSlice("b"))],
        clientId: client1Id,
    });

    expect(connection1.takeEvents()).toEqual([
        {
            type: "UpdateNotesContentWithoutPersistence",
            newVersion: 2,
            steps: [new ReplaceStep(1, 1, textSlice("a")), new ReplaceStep(2, 2, textSlice("b"))],
            stepsContentReferences: emptyContentReferences,
            clientId: client1Id,
        },
    ]);

    expect(connection2.takeEvents()).toEqual([
        {
            type: "UpdateNotesContentWithoutPersistence",
            newVersion: 2,
            steps: [new ReplaceStep(1, 1, textSlice("a")), new ReplaceStep(2, 2, textSlice("b"))],
            stepsContentReferences: emptyContentReferences,
            clientId: client1Id,
        },
    ]);

    await connection2.procedures.updateNotesContent({
        version: 2,
        steps: [new ReplaceStep(3, 3, textSlice("c"))],
        clientId: client2Id,
    });

    expect(connection1.takeEvents()).toEqual([
        {
            type: "UpdateNotesContentWithoutPersistence",
            newVersion: 3,
            steps: [new ReplaceStep(3, 3, textSlice("c"))],
            stepsContentReferences: emptyContentReferences,
            clientId: client2Id,
        },
    ]);

    expect(connection2.takeEvents()).toEqual([
        {
            type: "UpdateNotesContentWithoutPersistence",
            newVersion: 3,
            steps: [new ReplaceStep(3, 3, textSlice("c"))],
            stepsContentReferences: emptyContentReferences,
            clientId: client2Id,
        },
    ]);

    await ProcessContextModule.waitForTestTasks();

    expect(connection1.takeEvents()).toEqual([
        {type: "PersistedContent", newVersion: 2},
        {type: "PersistedContent", newVersion: 3},
    ]);

    expect(connection2.takeEvents()).toEqual([
        {type: "PersistedContent", newVersion: 2},
        {type: "PersistedContent", newVersion: 3},
    ]);
});

test("can update a task\u2019s notes with out-of-order updates", async () => {
    const space = await TestSpace.create(context);
    const session1 = await space.createSession();
    const session2 = await space.createSession();

    const task = await TestTask.create(session1);
    const collection = await TestTaskCollection.create(session1);
    await collection.access.grantDefault(session1);
    await task.addCollection(session1, collection);

    const client1Id = generateId<ContentEditorClientId>();
    const client2Id = generateId<ContentEditorClientId>();

    const connection1 = await connectForTest(context.action(session1), task.id);
    const connection2 = await connectForTest(context.action(session2), task.id);

    expect(connection1.takeEvents()).toEqual([]);
    expect(connection2.takeEvents()).toEqual([]);

    await connection1.procedures.updateNotesContent({
        version: 0,
        steps: [new ReplaceStep(1, 1, textSlice("a")), new ReplaceStep(2, 2, textSlice("b"))],
        clientId: client1Id,
    });

    expect(connection1.takeEvents()).toEqual([
        {
            type: "UpdateNotesContentWithoutPersistence",
            newVersion: 2,
            steps: [new ReplaceStep(1, 1, textSlice("a")), new ReplaceStep(2, 2, textSlice("b"))],
            stepsContentReferences: emptyContentReferences,
            clientId: client1Id,
        },
    ]);

    expect(connection2.takeEvents()).toEqual([
        {
            type: "UpdateNotesContentWithoutPersistence",
            newVersion: 2,
            steps: [new ReplaceStep(1, 1, textSlice("a")), new ReplaceStep(2, 2, textSlice("b"))],
            stepsContentReferences: emptyContentReferences,
            clientId: client1Id,
        },
    ]);

    await connection2.procedures.updateNotesContent({
        version: 0,
        steps: [new ReplaceStep(1, 1, textSlice("c"))],
        clientId: client2Id,
    });

    expect(connection1.takeEvents()).toEqual([
        {
            type: "UpdateNotesContentWithoutPersistence",
            newVersion: 3,
            steps: [new ReplaceStep(3, 3, textSlice("c"))],
            stepsContentReferences: emptyContentReferences,
            clientId: client2Id,
        },
    ]);

    expect(connection2.takeEvents()).toEqual([
        {
            type: "UpdateNotesContentWithoutPersistence",
            newVersion: 3,
            steps: [new ReplaceStep(3, 3, textSlice("c"))],
            stepsContentReferences: emptyContentReferences,
            clientId: client2Id,
        },
    ]);

    await ProcessContextModule.waitForTestTasks();

    expect(connection1.takeEvents()).toEqual([
        {type: "PersistedContent", newVersion: 2},
        {type: "PersistedContent", newVersion: 3},
    ]);

    expect(connection2.takeEvents()).toEqual([
        {type: "PersistedContent", newVersion: 2},
        {type: "PersistedContent", newVersion: 3},
    ]);
});

test("can update a task\u2019s notes with out-of-order updates even if our durable object doesn\u2019t remember enough steps", async () => {
    const space = await TestSpace.create(context);
    const session1 = await space.createSession();
    const session2 = await space.createSession();

    const task = await TestTask.create(session1);
    const collection = await TestTaskCollection.create(session1);
    await collection.access.grantDefault(session1);
    await task.addCollection(session1, collection);

    const client1Id = generateId<ContentEditorClientId>();

    await updateTaskNotesContent(session1.action(), {
        spaceId: space.id,
        taskId: task.id,
        clientVersion: 0,
        clientSteps: [new ReplaceStep(1, 1, textSlice("a")), new ReplaceStep(2, 2, textSlice("b"))],
        clientId: client1Id,
    });

    const client2Id = generateId<ContentEditorClientId>();

    const connection1 = await connectForTest(context.action(session1), task.id);
    const connection2 = await connectForTest(context.action(session2), task.id);

    expect(connection1.takeEvents()).toEqual([]);
    expect(connection2.takeEvents()).toEqual([]);

    // The durable object connected at version 2 so it doesn't remember the steps that
    // took us from version 0 to version 2. Instead of rejecting this update we load
    // those steps from the database and rebase the client's "c" insertion onto the
    // latest content. The rebased step lands after the already-applied "ab".
    await connection2.procedures.updateNotesContent({
        version: 0,
        steps: [new ReplaceStep(1, 1, textSlice("c"))],
        clientId: client2Id,
    });

    expect(connection1.takeEvents()).toEqual([
        {
            type: "UpdateNotesContentWithoutPersistence",
            newVersion: 3,
            steps: [new ReplaceStep(3, 3, textSlice("c"))],
            stepsContentReferences: emptyContentReferences,
            clientId: client2Id,
        },
    ]);

    expect(connection2.takeEvents()).toEqual([
        {
            type: "UpdateNotesContentWithoutPersistence",
            newVersion: 3,
            steps: [new ReplaceStep(3, 3, textSlice("c"))],
            stepsContentReferences: emptyContentReferences,
            clientId: client2Id,
        },
    ]);

    await ProcessContextModule.waitForTestTasks();

    expect(connection1.takeEvents()).toEqual([{type: "PersistedContent", newVersion: 3}]);
    expect(connection2.takeEvents()).toEqual([{type: "PersistedContent", newVersion: 3}]);
});

test("can update a task\u2019s notes when our durable object doesn\u2019t remember earlier steps", async () => {
    const space = await TestSpace.create(context);
    const session1 = await space.createSession();
    const session2 = await space.createSession();

    const task = await TestTask.create(session1);
    const collection = await TestTaskCollection.create(session1);
    await collection.access.grantDefault(session1);
    await task.addCollection(session1, collection);

    const client1Id = generateId<ContentEditorClientId>();

    await updateTaskNotesContent(session1.action(), {
        spaceId: space.id,
        taskId: task.id,
        clientVersion: 0,
        clientSteps: [new ReplaceStep(1, 1, textSlice("a")), new ReplaceStep(2, 2, textSlice("b"))],
        clientId: client1Id,
    });

    const client2Id = generateId<ContentEditorClientId>();

    const connection1 = await connectForTest(context.action(session1), task.id);
    const connection2 = await connectForTest(context.action(session2), task.id);

    expect(connection1.takeEvents()).toEqual([]);
    expect(connection2.takeEvents()).toEqual([]);

    await connection2.procedures.updateNotesContent({
        version: 2,
        steps: [new ReplaceStep(3, 3, textSlice("c"))],
        clientId: client2Id,
    });

    expect(connection1.takeEvents()).toEqual([
        {
            type: "UpdateNotesContentWithoutPersistence",
            newVersion: 3,
            steps: [new ReplaceStep(3, 3, textSlice("c"))],
            stepsContentReferences: emptyContentReferences,
            clientId: client2Id,
        },
    ]);

    expect(connection2.takeEvents()).toEqual([
        {
            type: "UpdateNotesContentWithoutPersistence",
            newVersion: 3,
            steps: [new ReplaceStep(3, 3, textSlice("c"))],
            stepsContentReferences: emptyContentReferences,
            clientId: client2Id,
        },
    ]);

    await ProcessContextModule.waitForTestTasks();

    expect(connection1.takeEvents()).toEqual([{type: "PersistedContent", newVersion: 3}]);
    expect(connection2.takeEvents()).toEqual([{type: "PersistedContent", newVersion: 3}]);
});

test("can backfill task notes steps our durable object remembers", async () => {
    const space = await TestSpace.create(context);
    const session1 = await space.createSession();
    const session2 = await space.createSession();

    const task = await TestTask.create(session1);
    const collection = await TestTaskCollection.create(session1);
    await collection.access.grantDefault(session1);
    await task.addCollection(session1, collection);

    const client1Id = generateId<ContentEditorClientId>();

    const connection1 = await connectForTest(context.action(session1), task.id);

    expect(connection1.takeEvents()).toEqual([]);

    await connection1.procedures.updateNotesContent({
        version: 0,
        steps: [new ReplaceStep(1, 1, textSlice("a")), new ReplaceStep(2, 2, textSlice("b"))],
        clientId: client1Id,
    });

    expect(connection1.takeEvents()).toEqual([
        {
            type: "UpdateNotesContentWithoutPersistence",
            newVersion: 2,
            steps: [new ReplaceStep(1, 1, textSlice("a")), new ReplaceStep(2, 2, textSlice("b"))],
            stepsContentReferences: emptyContentReferences,
            clientId: client1Id,
        },
    ]);

    await ProcessContextModule.waitForTestTasks();

    expect(connection1.takeEvents()).toEqual([{type: "PersistedContent", newVersion: 2}]);

    const connection2 = await connectForTest(context.action(session2), task.id);

    expect(
        await connection2.procedures.backfillNotes({
            version: 0,
        }),
    ).toEqual({
        persistedVersion: 2,
        newVersion: 2,
        steps: [
            {step: new ReplaceStep(1, 1, textSlice("a")), clientId: client1Id},
            {step: new ReplaceStep(2, 2, textSlice("b")), clientId: client1Id},
        ],
        stepsContentReferences: emptyContentReferences,
    });

    expect(connection1.takeEvents()).toEqual([]);
    expect(connection2.takeEvents()).toEqual([]);
});

test("can backfill task notes steps our durable object doesn\u2019t remember by loading them from the database", async () => {
    const space = await TestSpace.create(context);
    const session1 = await space.createSession();
    const session2 = await space.createSession();

    const task = await TestTask.create(session1);
    const collection = await TestTaskCollection.create(session1);
    await collection.access.grantDefault(session1);
    await task.addCollection(session1, collection);

    const client1Id = generateId<ContentEditorClientId>();

    await updateTaskNotesContent(session1.action(), {
        spaceId: space.id,
        taskId: task.id,
        clientVersion: 0,
        clientSteps: [new ReplaceStep(1, 1, textSlice("a")), new ReplaceStep(2, 2, textSlice("b"))],
        clientId: client1Id,
    });

    const connection2 = await connectForTest(context.action(session2), task.id);

    expect(connection2.takeEvents()).toEqual([]);

    // The durable object connected at version 2 so it doesn't remember the steps that
    // took us from version 0 to version 2. Instead of resetting the client's document
    // we load those steps from the database to backfill the client.
    expect(
        await connection2.procedures.backfillNotes({
            version: 0,
        }),
    ).toEqual({
        persistedVersion: 2,
        newVersion: 2,
        steps: [
            {step: new ReplaceStep(1, 1, textSlice("a")), clientId: client1Id},
            {step: new ReplaceStep(2, 2, textSlice("b")), clientId: client1Id},
        ],
        stepsContentReferences: emptyContentReferences,
    });

    expect(connection2.takeEvents()).toEqual([]);
});

test("can update a current task notes version", async () => {
    const space = await TestSpace.create(context);
    const session1 = await space.createSession();
    const session2 = await space.createSession();

    const task = await TestTask.create(session1);
    const collection = await TestTaskCollection.create(session1);
    await collection.access.grantDefault(session1);
    await task.addCollection(session1, collection);

    await updateTaskNotesContent(session1.action(), {
        spaceId: space.id,
        taskId: task.id,
        clientVersion: 0,
        clientSteps: [new ReplaceStep(1, 1, textSlice("a")), new ReplaceStep(2, 2, textSlice("b"))],
        clientId: generateId(),
    });

    const connection2 = await connectForTest(context.action(session2), task.id);

    expect(connection2.takeEvents()).toEqual([]);

    expect(
        await connection2.procedures.backfillNotes({
            version: 2,
        }),
    ).toEqual({
        persistedVersion: 2,
        newVersion: 2,
        steps: [],
        stepsContentReferences: emptyContentReferences,
    });

    expect(connection2.takeEvents()).toEqual([]);
});

test("rejects backfilling a future task notes version with a recoverable error", async () => {
    const space = await TestSpace.create(context);
    const session1 = await space.createSession();

    const task = await TestTask.create(session1);
    const collection = await TestTaskCollection.create(session1);
    await collection.access.grantDefault(session1);
    await task.addCollection(session1, collection);

    const connection1 = await connectForTest(context.action(session1), task.id);

    expect(connection1.takeEvents()).toEqual([]);

    // The durable object is at version 0 but the client claims to be at version 1.
    // This happens when a previous durable object confirmed steps to the client but
    // crashed before persisting them. Because the database is also at version 0 the
    // durable object is not out of sync, so we surface a recoverable error instead of
    // crashing. The client reverts its unpersisted steps and backfills again.
    await expect(connection1.procedures.backfillNotes({version: 1})).rejects.toThrow(
        taskNotesBackfillFutureVersionErrorMessage,
    );

    expect(connection1.isClosed()).toEqual(false);
    expect(connection1.takeEvents()).toEqual([]);
});

test("destroys the durable object when backfilling a future version the database has persisted", async () => {
    const space = await TestSpace.create(context);
    const session1 = await space.createSession();

    const task = await TestTask.create(session1);
    const collection = await TestTaskCollection.create(session1);
    await collection.access.grantDefault(session1);
    await task.addCollection(session1, collection);

    // Initialize the durable object at version 0.
    const connection1 = await connectForTest(context.action(session1), task.id);

    expect(connection1.takeEvents()).toEqual([]);

    // Persist steps directly to the database (bypassing the durable object) so the
    // database advances to version 2 while the durable object stays at version 0.
    await updateTaskNotesContent(session1.action(), {
        spaceId: space.id,
        taskId: task.id,
        clientVersion: 0,
        clientSteps: [new ReplaceStep(1, 1, textSlice("a")), new ReplaceStep(2, 2, textSlice("b"))],
        clientId: generateId(),
    });

    // The client backfills a version ahead of the in-memory version of the durable
    // object. Since the database is actually ahead, the durable object is stale and
    // must not tell the client to revert persisted steps. Instead it destroys itself
    // so the next connection reloads from the database at the correct version.
    await expect(connection1.procedures.backfillNotes({version: 1})).rejects.toThrow("out of sync");

    expect(connection1.isClosed()).toEqual(true);
    expect((connection1.getCloseError() as InternalError).message).toEqual(
        "Task notes version in durable object is out of sync with the actual task notes version",
    );

    // After the stale durable object was destroyed a fresh connection reloads from the
    // database at the correct version and can backfill from version 0.
    const session2 = await space.createSession();
    const connection2 = await connectForTest(context.action(session2), task.id);

    expect((await connection2.procedures.backfillNotes({version: 0})).newVersion).toEqual(2);
});

test("can backfill task note steps but can\u2019t update if you only have view access", async () => {
    const space = await TestSpace.create(context);
    const session1 = await space.createSession();
    const session2 = await space.createSession();

    const task = await TestTask.create(session1);
    const collection = await TestTaskCollection.create(session1);
    await task.addCollection(session1, collection);

    await collection.access.set(session1, {
        type: "Local",
        accountGrantById: new Map([[session1.account.id, {level: "Manage", generation: 0}]]),
        defaultGrant: {level: "View"},
        urlGrant: null,
    });

    const client1Id = generateId<ContentEditorClientId>();
    const client2Id = generateId<ContentEditorClientId>();

    const connection1 = await connectForTest(context.action(session1), task.id);

    expect(connection1.takeEvents()).toEqual([]);

    await connection1.procedures.updateNotesContent({
        version: 0,
        steps: [new ReplaceStep(1, 1, textSlice("a")), new ReplaceStep(2, 2, textSlice("b"))],
        clientId: client1Id,
    });

    expect(connection1.takeEvents()).toEqual([
        {
            type: "UpdateNotesContentWithoutPersistence",
            newVersion: 2,
            steps: [new ReplaceStep(1, 1, textSlice("a")), new ReplaceStep(2, 2, textSlice("b"))],
            stepsContentReferences: emptyContentReferences,
            clientId: client1Id,
        },
    ]);

    await ProcessContextModule.waitForTestTasks();

    expect(connection1.takeEvents()).toEqual([{type: "PersistedContent", newVersion: 2}]);

    const connection2 = await connectForTest(context.action(session2), task.id, {
        accessLevel: "View",
    });

    expect(
        await connection2.procedures.backfillNotes({
            version: 0,
        }),
    ).toEqual({
        persistedVersion: 2,
        newVersion: 2,
        steps: [
            {step: new ReplaceStep(1, 1, textSlice("a")), clientId: client1Id},
            {step: new ReplaceStep(2, 2, textSlice("b")), clientId: client1Id},
        ],
        stepsContentReferences: emptyContentReferences,
    });

    expect(connection1.takeEvents()).toEqual([]);
    expect(connection2.takeEvents()).toEqual([]);

    await expect(
        connection2.procedures.updateNotesContent({
            version: 2,
            steps: [new ReplaceStep(3, 3, textSlice("c"))],
            clientId: client2Id,
        }),
    ).rejects.toThrow(PermissionDeniedError);

    expect(connection1.takeEvents()).toEqual([]);
    expect(connection2.takeEvents()).toEqual([]);

    await ProcessContextModule.waitForTestTasks();

    expect(connection1.takeEvents()).toEqual([]);
    expect(connection2.takeEvents()).toEqual([]);
});

testMessagingRealtimeImplementation<TaskId>(context, {
    async createRoom(sessions) {
        const task = await TestTask.create(sessions[0]);
        const collection = await TestTaskCollection.create(sessions[0], {access: "Public"});
        await task.addCollection(sessions[0], collection);

        return {
            key: task.id,
            spaceId: task.space.id,
            createdTime: new Date(task.createdTime[0]),
            messageCount: 0,
            messageNoun: "comment",
        };
    },
    async connectForTest(context, roomKey) {
        const connection = await connectForTest(context, roomKey);

        return {
            getConnection: () => connection.connection.getConnectionForTest(),
            procedures: {
                backfillMessages: async ({
                    checkpoint,
                    clientMessageCount: clientCommentCount,
                    newMessageLimit: newCommentLimit,
                }) => {
                    const {
                        commentCount: messageCount,
                        newComments: newMessages,
                        newOtherReferencedComments: newOtherReferencedMessages,
                        commentUpdatesResult: messageUpdatesResult,
                        typingStateByConnectionId,
                    } = await connection.procedures.backfillComments({
                        checkpoint,
                        clientCommentCount,
                        newCommentLimit,
                    });
                    return {
                        messageCount,
                        newMessages,
                        newOtherReferencedMessages,
                        messageUpdatesResult,
                        typingStateByConnectionId,
                    };
                },
                createMessage: ({parent, content, fileIds}) =>
                    connection.procedures.createComment({
                        parent,
                        content,
                        fileIds,
                        createdTimeZone: defaultTimeZone,
                    }),
                updateMessageContent: ({messageIndex: commentIndex, contentVersion, steps}) =>
                    connection.procedures.updateCommentContent({
                        commentIndex,
                        contentVersion,
                        steps,
                    }),
                deleteMessage: ({messageIndex: commentIndex}) =>
                    connection.procedures.deleteComment({commentIndex}),
                setMessageReaction: ({messageIndex: commentIndex, contentVersion, pos, reaction}) =>
                    connection.procedures.setCommentReaction({
                        commentIndex,
                        contentVersion,
                        pos,
                        reaction,
                    }),
                deleteMessageReaction: ({messageIndex: commentIndex, contentVersion, pos}) =>
                    connection.procedures.deleteCommentReaction({
                        commentIndex,
                        contentVersion,
                        pos,
                    }),
                startTypingInMessageInput: ({}) =>
                    connection.procedures.startTypingInCommentInput({}),
                stopTypingInMessageInput: ({}) =>
                    connection.procedures.stopTypingInCommentInput({}),
            },
            takeEvents: () => {
                return filterMapArray(connection.takeEvents(), event => {
                    if (event.type !== "Comments") return;
                    return event.event;
                });
            },
        };
    },
    createMessageModel({roomKey: taskId, index, version, createdTime, author, payload}) {
        return new TaskCommentModel({
            taskId,
            index,
            version,
            createdTime,
            createdTimeZone: defaultTimeZone,
            author,
            payload,
            stream: null,
        });
    },
    createMessage(context, {roomKey: taskId, parent, content, fileIds}) {
        return createTaskComment(context, {
            taskId,
            parent,
            content,
            fileIds,
            createdTimeZone: defaultTimeZone,
        });
    },
    updateMessageContent(
        context,
        {roomKey: taskId, messageIndex: commentIndex, contentVersion, steps},
    ) {
        return updateTaskCommentContent(context, {
            taskId,
            commentIndex,
            contentVersion,
            steps,
        });
    },
    deleteMessage(context, {roomKey: taskId, messageIndex: commentIndex}) {
        return deleteTaskComment(context, {taskId, commentIndex});
    },
});
