import {Fragment, Slice} from "prosemirror-model";
import {ReplaceStep} from "prosemirror-transform";
import {createTestWorkerContext} from "~/server/cloudflare/test_helpers/create_test_worker_context.js";
import {documentsInjection} from "~/server/documents/data/documents_injection.js";
import {
    testMessagingRealtimeImplementation,
    testMessagingRealtimeImplementationSearchInjection,
} from "~/server/messaging/realtime/test_helpers/test_messaging_realtime_implementation.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {updateTaskNotesContent} from "~/server/tasks/data/task_table.js";
import {TaskNotesCollaborationDurableObject} from "~/server/tasks/notes_collaboration/task_notes_collaboration_durable_object.js";
import {TestTask} from "~/server/tasks/test_helpers/test_task.js";
import {TestTaskCollection} from "~/server/tasks/test_helpers/test_task_collection.js";
import {emptyContentReferences} from "~/shared/content/content_references.js";
import {ProcessContextModule} from "~/shared/context/process_context_module.js";
import {
    FailedPreconditionError,
    NotFoundError,
    PermissionDeniedError,
} from "~/shared/error/error.js";
import {filterMapArray} from "~/shared/helpers/array/filter_map_array.js";
import {generateId} from "~/shared/id/id.js";
import {ContentEditorClientId, TaskId} from "~/shared/id/types/id_types.js";
import {
    createTaskComment,
    deleteTaskComment,
    updateTaskCommentContent,
} from "~/shared/rpc/tasks_rpc_definitions.js";
import {TaskCommentModel} from "~/shared/tasks/model/task_comment_model.js";
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

test("can’t connect to a task that doesn’t exist", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    await expect(connectForTest(context.action(session), generateId())).rejects.toThrow(
        NotFoundError,
    );
});

test("can’t connect to a task in a different space", async () => {
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

test("can’t connect to a task in a private collection", async () => {
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

test("can’t connect to a task in a different space after durable object has been initialized", async () => {
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

test("can’t connect to a task in a private collection after durable object has been initialized", async () => {
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

test("can update a task’s notes", async () => {
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

test("can update a task’s notes with out-of-order updates", async () => {
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

test("can’t update a task’s notes with out-of-order updates if our durable object doesn’t remember enough steps", async () => {
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
        version: 0,
        steps: [new ReplaceStep(1, 1, textSlice("a")), new ReplaceStep(2, 2, textSlice("b"))],
    });

    const client2Id = generateId<ContentEditorClientId>();

    const connection1 = await connectForTest(context.action(session1), task.id);
    const connection2 = await connectForTest(context.action(session2), task.id);

    expect(connection1.takeEvents()).toEqual([]);
    expect(connection2.takeEvents()).toEqual([]);

    await expect(
        connection2.procedures.updateNotesContent({
            version: 0,
            steps: [new ReplaceStep(1, 1, textSlice("c"))],
            clientId: client2Id,
        }),
    ).rejects.toThrow(FailedPreconditionError);

    expect(connection1.takeEvents()).toEqual([]);
    expect(connection2.takeEvents()).toEqual([]);
});

test("can update a task’s notes when our durable object doesn’t remember earlier steps", async () => {
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
        version: 0,
        steps: [new ReplaceStep(1, 1, textSlice("a")), new ReplaceStep(2, 2, textSlice("b"))],
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
        result: {
            type: "Available",
            persistedVersion: 2,
            newVersion: 2,
            steps: [
                {step: new ReplaceStep(1, 1, textSlice("a")), clientId: client1Id},
                {step: new ReplaceStep(2, 2, textSlice("b")), clientId: client1Id},
            ],
            stepsContentReferences: emptyContentReferences,
        },
    });

    expect(connection1.takeEvents()).toEqual([]);
    expect(connection2.takeEvents()).toEqual([]);
});

test("can’t backfill task notes steps our durable object doesn’t remember", async () => {
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
        version: 0,
        steps: [new ReplaceStep(1, 1, textSlice("a")), new ReplaceStep(2, 2, textSlice("b"))],
    });

    const connection2 = await connectForTest(context.action(session2), task.id);

    expect(connection2.takeEvents()).toEqual([]);

    expect(
        await connection2.procedures.backfillNotes({
            version: 0,
        }),
    ).toEqual({
        result: {
            type: "Unavailable",
            newVersion: 2,
            content: {
                doc: schema.node("doc", null, schema.node("paragraph", null, [schema.text("ab")])),
                references: emptyContentReferences,
            },
        },
    });

    expect(connection2.takeEvents()).toEqual([]);
});

test("can current task notes version", async () => {
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
        version: 0,
        steps: [new ReplaceStep(1, 1, textSlice("a")), new ReplaceStep(2, 2, textSlice("b"))],
    });

    const connection2 = await connectForTest(context.action(session2), task.id);

    expect(connection2.takeEvents()).toEqual([]);

    expect(
        await connection2.procedures.backfillNotes({
            version: 2,
        }),
    ).toEqual({
        result: {
            type: "Available",
            persistedVersion: 2,
            newVersion: 2,
            steps: [],
            stepsContentReferences: emptyContentReferences,
        },
    });

    expect(connection2.takeEvents()).toEqual([]);
});

test("can backfill task note steps but can’t update if you only have view access", async () => {
    const space = await TestSpace.create(context);
    const session1 = await space.createSession();
    const session2 = await space.createSession();

    const task = await TestTask.create(session1);
    const collection = await TestTaskCollection.create(session1);
    await task.addCollection(session1, collection);

    await collection.access.set(session1, {
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

    const connection2 = await connectForTest(context.action(session2), task.id);

    expect(
        await connection2.procedures.backfillNotes({
            version: 0,
        }),
    ).toEqual({
        result: {
            type: "Available",
            persistedVersion: 2,
            newVersion: 2,
            steps: [
                {step: new ReplaceStep(1, 1, textSlice("a")), clientId: client1Id},
                {step: new ReplaceStep(2, 2, textSlice("b")), clientId: client1Id},
            ],
            stepsContentReferences: emptyContentReferences,
        },
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
        };
    },
    async connectForTest(context, roomKey) {
        const connection = await connectForTest(context, roomKey);

        return {
            getConnection: () => connection.connection.getConnectionForTest(),
            procedures: {
                backfillMessages: async ({
                    clientMessageCount: clientCommentCount,
                    clientLastMessageChangeTime: clientLastCommentChangeTime,
                    newMessageLimit: newCommentLimit,
                }) => {
                    const {
                        commentCount: messageCount,
                        lastCommentChangeTime: lastMessageChangeTime,
                        newComments: newMessages,
                        newOtherReferencedComments: newOtherReferencedMessages,
                        commentChangesResult: messageChangesResult,
                        typingStateByConnectionId,
                    } = await connection.procedures.backfillComments({
                        clientCommentCount,
                        clientLastCommentChangeTime,
                        newCommentLimit,
                    });
                    return {
                        messageCount,
                        lastMessageChangeTime,
                        newMessages,
                        newOtherReferencedMessages,
                        messageChangesResult,
                        typingStateByConnectionId,
                    };
                },
                createMessage: ({parent, content, fileIds}) =>
                    connection.procedures.createComment({parent, content, fileIds}),
                updateMessageContent: ({messageIndex: commentIndex, contentVersion, steps}) =>
                    connection.procedures.updateCommentContent({
                        commentIndex,
                        contentVersion,
                        steps,
                    }),
                deleteMessage: ({messageIndex: commentIndex}) =>
                    connection.procedures.deleteComment({commentIndex}),
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
    createMessageModel({roomKey: taskId, index, createdTime, author, payload}) {
        return new TaskCommentModel({
            taskId,
            index,
            createdTime,
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
