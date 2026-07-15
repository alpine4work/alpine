import {addMinutes} from "date-fns";
import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {testMessagingImplementation} from "~/server/messaging/test_helpers/suite/test_messaging_implementation.js";
import {authorizeSpaceAccess} from "~/server/spaces/authorize_space_access.js";
import {spacesInjection} from "~/server/spaces/spaces_injection.js";
import {TestAccount} from "~/server/spaces/test_helpers/test_account.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {authorizeTaskAccess} from "~/server/tasks/data/authorization/authorize_task_access.js";
import {FileTaskAuthorizer} from "~/server/tasks/data/authorization/file_task_authorizer.js";
import {
    backfillTaskComments,
    completeTaskCommentStream,
    createTaskComment,
    deleteTaskComment,
    deleteTaskCommentReaction,
    getTaskComment,
    getTaskCommentParentContent,
    getTaskCommentPayload,
    getTaskCommentPayloadsFromEnd,
    getTaskCommentPayloadsFromEndWithParents,
    getTaskCommentPayloadsFromStart,
    getTaskCommentPayloadsFromStartWithParents,
    getTaskCommentsFromEnd,
    getTaskCommentsFromStart,
    getTaskNotesContentAndOptionalInitialCommentsIfExists,
    pingTaskCommentStream,
    putTaskCommentMessageApprovalDecisions,
    putTaskCommentStreamPart,
    setTaskCommentReaction,
    updateTaskCommentContent,
} from "~/server/tasks/data/task_messaging.js";
import {tasksInjection} from "~/server/tasks/data/tasks_injection.js";
import {getTaskCommentsSummaryItemIfExistsForTest} from "~/server/tasks/data/test_helpers/get_task_comments_summary_item_if_exists_for_test.js";
import {getTaskItemForTest} from "~/server/tasks/data/test_helpers/get_task_item_for_test.js";
import {TestTask} from "~/server/tasks/data/test_helpers/test_task.js";
import {TestTaskCollection} from "~/server/tasks/data/test_helpers/test_task_collection.js";
import {AccessPolicyAccountGrant} from "~/shared/access/access_policy.js";
import {emptyContentReferences} from "~/shared/content/content_references.js";
import {createSimpleMessageContent} from "~/shared/content/message_content_schema.js";
import {PermissionDeniedError} from "~/shared/error/error.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {defaultTimeZone} from "~/shared/helpers/intl/time_zone.js";
import {sumIterable} from "~/shared/helpers/iterable/sum_iterable.js";
import {emptyMap} from "~/shared/helpers/map/empty_map.js";
import {generateId} from "~/shared/id/id.js";
import {AccountId, TaskId} from "~/shared/id/types/id_types.js";
import {emptyReactionSet} from "~/shared/reactions/reaction_set.js";
import {TaskCommentModel} from "~/shared/tasks/model/task_comment_model.js";
import {createSimpleTaskNotesContent} from "~/shared/tasks/task_notes_content_schema.js";
import {generateServerSynchronizationCheckpointForTest} from "~/shared/web_socket/server_synchronization_checkpoint.js";

const taskMessagingContext = createTestContext({
    spacesInjection,
    tasksInjection,
    notificationsInjection: {
        archiveInboxTaskEntryAfterSetTaskCommentReaction: async () => {},
    },
});

async function createTaskCommentAccessScenario() {
    const space = await TestSpace.create(taskMessagingContext);

    const [
        unauthorizedSession,
        viewerSession,
        commenterSession,
        editorSession,
        manageSession,
        creatorSession,
        assigneeSession,
    ] = await runAllPromises([
        space.createSession(),
        space.createSession(),
        space.createSession(),
        space.createSession(),
        space.createSession(),
        space.createSession(),
        space.createSession(),
    ]);

    const task = await TestTask.create(creatorSession);

    const content1 = createSimpleMessageContent("test1");
    const taskComment = await createTaskComment(taskMessagingContext.action(creatorSession), {
        taskId: task.id,
        parent: null,
        content: content1,
        fileIds: [],
        createdTimeZone: defaultTimeZone,
    });

    const collection = await TestTaskCollection.create(creatorSession);

    await collection.access.set(creatorSession, {
        type: "Local",
        accountGrantById: new Map<AccountId, AccessPolicyAccountGrant>([
            [creatorSession.account.id, {level: "Manage", generation: 0}],
            [manageSession.account.id, {level: "Manage", generation: 1}],
            [editorSession.account.id, {level: "Edit"}],
            [commenterSession.account.id, {level: "Comment"}],
            [viewerSession.account.id, {level: "View"}],
        ]),
        defaultGrant: null,
        urlGrant: null,
    });

    await task.addCollection(creatorSession, collection);

    return {
        task,
        taskCommentIdAndIndex: {
            taskId: task.id,
            commentIndex: taskComment.index,
        },
        unauthorizedSession,
        viewerSession,
        commenterSession,
        editorSession,
        manageSession,
        creatorSession,
        assigneeSession,
    };
}

describe("getTaskComment()", () => {
    test("throws error for users that only have view access when trying to access task comments", async () => {
        const {
            task,
            taskCommentIdAndIndex,
            unauthorizedSession,
            viewerSession,
            commenterSession,
            editorSession,
            manageSession,
            creatorSession,
            assigneeSession,
        } = await createTaskCommentAccessScenario();

        await expect(
            getTaskComment(assigneeSession.action(), taskCommentIdAndIndex),
        ).rejects.toThrow(PermissionDeniedError);

        await task.updateAssignee(creatorSession, assigneeSession);

        await expect(
            getTaskComment(assigneeSession.action(), taskCommentIdAndIndex),
        ).resolves.not.toBeNull();

        await expect(
            getTaskComment(unauthorizedSession.action(), taskCommentIdAndIndex),
        ).rejects.toThrow(PermissionDeniedError);
        await expect(getTaskComment(viewerSession.action(), taskCommentIdAndIndex)).rejects.toThrow(
            PermissionDeniedError,
        );
        await expect(
            getTaskComment(commenterSession.action(), taskCommentIdAndIndex),
        ).resolves.not.toBeNull();
        await expect(
            getTaskComment(editorSession.action(), taskCommentIdAndIndex),
        ).resolves.not.toBeNull();
        await expect(
            getTaskComment(manageSession.action(), taskCommentIdAndIndex),
        ).resolves.not.toBeNull();
        await expect(
            getTaskComment(creatorSession.action(), taskCommentIdAndIndex),
        ).resolves.not.toBeNull();
    });
});

describe("getTaskCommentPayload()", () => {
    test("throws error for users that only have view access when trying to access task comment payloads", async () => {
        const {
            taskCommentIdAndIndex,
            unauthorizedSession,
            viewerSession,
            commenterSession,
            editorSession,
            manageSession,
            creatorSession,
        } = await createTaskCommentAccessScenario();

        await expect(
            getTaskCommentPayload(unauthorizedSession.action(), taskCommentIdAndIndex),
        ).rejects.toThrow(PermissionDeniedError);
        await expect(
            getTaskCommentPayload(viewerSession.action(), taskCommentIdAndIndex),
        ).rejects.toThrow(PermissionDeniedError);
        await expect(
            getTaskCommentPayload(commenterSession.action(), taskCommentIdAndIndex),
        ).resolves.not.toBeNull();
        await expect(
            getTaskCommentPayload(editorSession.action(), taskCommentIdAndIndex),
        ).resolves.not.toBeNull();
        await expect(
            getTaskCommentPayload(manageSession.action(), taskCommentIdAndIndex),
        ).resolves.not.toBeNull();
        await expect(
            getTaskCommentPayload(creatorSession.action(), taskCommentIdAndIndex),
        ).resolves.not.toBeNull();
    });
});

describe("getTaskCommentsFromStart()", () => {
    test("throws error for users that only have view access when trying to get task comments from start", async () => {
        const space = await TestSpace.create(taskMessagingContext);

        const [
            unauthorizedSession,
            viewerSession,
            commenterSession,
            editorSession,
            manageSession,
            creatorSession,
            assigneeSession,
        ] = await runAllPromises([
            space.createSession(),
            space.createSession(),
            space.createSession(),
            space.createSession(),
            space.createSession(),
            space.createSession(),
            space.createSession(),
        ]);

        const task = await TestTask.create(creatorSession);

        const collection = await TestTaskCollection.create(creatorSession);
        await collection.access.grantDefault(creatorSession);
        await task.addCollection(creatorSession, collection);

        await task.createComment(creatorSession, "test1");
        await task.createComment(creatorSession, "test2");
        await task.createComment(creatorSession, "test3");

        await collection.access.set(creatorSession, {
            type: "Local",
            accountGrantById: new Map<AccountId, AccessPolicyAccountGrant>([
                [creatorSession.account.id, {level: "Manage", generation: 0}],
                [manageSession.account.id, {level: "Manage", generation: 1}],
                [editorSession.account.id, {level: "Edit"}],
                [commenterSession.account.id, {level: "Comment"}],
                [viewerSession.account.id, {level: "View"}],
            ]),
            defaultGrant: null,
            urlGrant: null,
        });

        await task.updateAssignee(creatorSession, assigneeSession);

        await expect(
            getTaskCommentsFromStart(assigneeSession.action(), {
                taskId: task.id,
                limit: 10,
                afterCommentIndex: 0,
                beforeCommentIndex: 2,
            }),
        ).resolves.not.toBeNull();

        await expect(
            getTaskCommentsFromStart(unauthorizedSession.action(), {
                taskId: task.id,
                limit: 10,
                afterCommentIndex: 0,
                beforeCommentIndex: 2,
            }),
        ).rejects.toThrow(PermissionDeniedError);

        await expect(
            getTaskCommentsFromStart(viewerSession.action(), {
                taskId: task.id,
                limit: 10,
                afterCommentIndex: 0,
                beforeCommentIndex: 2,
            }),
        ).rejects.toThrow(PermissionDeniedError);

        await expect(
            getTaskCommentsFromStart(commenterSession.action(), {
                taskId: task.id,
                limit: 10,
                afterCommentIndex: 0,
                beforeCommentIndex: 2,
            }),
        ).resolves.not.toBeNull();

        await expect(
            getTaskCommentsFromStart(editorSession.action(), {
                taskId: task.id,
                limit: 10,
                afterCommentIndex: 0,
                beforeCommentIndex: 2,
            }),
        ).resolves.not.toBeNull();

        await expect(
            getTaskCommentsFromStart(manageSession.action(), {
                taskId: task.id,
                limit: 10,
                afterCommentIndex: 0,
                beforeCommentIndex: 2,
            }),
        ).resolves.not.toBeNull();

        await expect(
            getTaskCommentsFromStart(creatorSession.action(), {
                taskId: task.id,
                limit: 10,
                afterCommentIndex: 0,
                beforeCommentIndex: 2,
            }),
        ).resolves.not.toBeNull();
    });
});

describe("getTaskCommentsFromEnd()", () => {
    test("throws error for users that only have view access when trying to get task comments from end", async () => {
        const space = await TestSpace.create(taskMessagingContext);

        const [
            unauthorizedSession,
            viewerSession,
            commenterSession,
            editorSession,
            manageSession,
            creatorSession,
            assigneeSession,
        ] = await runAllPromises([
            space.createSession(),
            space.createSession(),
            space.createSession(),
            space.createSession(),
            space.createSession(),
            space.createSession(),
            space.createSession(),
        ]);

        const task = await TestTask.create(creatorSession);

        const collection = await TestTaskCollection.create(creatorSession);
        await collection.access.grantDefault(creatorSession);
        await task.addCollection(creatorSession, collection);

        await task.createComment(creatorSession, "test1");
        await task.createComment(creatorSession, "test2");
        await task.createComment(creatorSession, "test3");

        await collection.access.set(creatorSession, {
            type: "Local",
            accountGrantById: new Map<AccountId, AccessPolicyAccountGrant>([
                [creatorSession.account.id, {level: "Manage", generation: 0}],
                [manageSession.account.id, {level: "Manage", generation: 1}],
                [editorSession.account.id, {level: "Edit"}],
                [commenterSession.account.id, {level: "Comment"}],
                [viewerSession.account.id, {level: "View"}],
            ]),
            defaultGrant: null,
            urlGrant: null,
        });

        await task.updateAssignee(creatorSession, assigneeSession);

        await expect(
            getTaskCommentsFromEnd(assigneeSession.action(), {
                taskId: task.id,
                limit: 10,
                afterCommentIndex: 0,
                beforeCommentIndex: 2,
            }),
        ).resolves.not.toBeNull();

        await expect(
            getTaskCommentsFromEnd(unauthorizedSession.action(), {
                taskId: task.id,
                limit: 10,
                afterCommentIndex: 0,
                beforeCommentIndex: 2,
            }),
        ).rejects.toThrow(PermissionDeniedError);

        await expect(
            getTaskCommentsFromEnd(viewerSession.action(), {
                taskId: task.id,
                limit: 10,
                afterCommentIndex: 0,
                beforeCommentIndex: 2,
            }),
        ).rejects.toThrow(PermissionDeniedError);

        await expect(
            getTaskCommentsFromEnd(commenterSession.action(), {
                taskId: task.id,
                limit: 10,
                afterCommentIndex: 0,
                beforeCommentIndex: 2,
            }),
        ).resolves.not.toBeNull();

        await expect(
            getTaskCommentsFromEnd(editorSession.action(), {
                taskId: task.id,
                limit: 10,
                afterCommentIndex: 0,
                beforeCommentIndex: 2,
            }),
        ).resolves.not.toBeNull();

        await expect(
            getTaskCommentsFromEnd(manageSession.action(), {
                taskId: task.id,
                limit: 10,
                afterCommentIndex: 0,
                beforeCommentIndex: 2,
            }),
        ).resolves.not.toBeNull();

        await expect(
            getTaskCommentsFromEnd(creatorSession.action(), {
                taskId: task.id,
                limit: 10,
                afterCommentIndex: 0,
                beforeCommentIndex: 2,
            }),
        ).resolves.not.toBeNull();
    });
});

describe("getTaskNotesContentAndOptionalInitialCommentsIfExists()", () => {
    test("returns null for users that only have view access when trying to get initial task comments", async () => {
        const space = await TestSpace.create(taskMessagingContext);

        const [
            unauthorizedSession,
            viewerSession,
            commenterSession,
            editorSession,
            manageSession,
            creatorSession,
            assigneeSession,
        ] = await runAllPromises([
            space.createSession(),
            space.createSession(),
            space.createSession(),
            space.createSession(),
            space.createSession(),
            space.createSession(),
            space.createSession(),
        ]);

        const task = await TestTask.create(creatorSession);

        await task.typeNotes(creatorSession, "Test notes");

        const collection = await TestTaskCollection.create(creatorSession);
        await collection.access.grantDefault(creatorSession);
        await task.addCollection(creatorSession, collection);

        await collection.access.set(creatorSession, {
            type: "Local",
            accountGrantById: new Map<AccountId, AccessPolicyAccountGrant>([
                [creatorSession.account.id, {level: "Manage", generation: 0}],
                [manageSession.account.id, {level: "Manage", generation: 1}],
                [editorSession.account.id, {level: "Edit"}],
                [commenterSession.account.id, {level: "Comment"}],
                [viewerSession.account.id, {level: "View"}],
            ]),
            defaultGrant: null,
            urlGrant: null,
        });

        await task.updateAssignee(creatorSession, assigneeSession);

        const comment0 = await task.createComment(creatorSession, "test1");
        const comment1 = await task.createComment(assigneeSession, "test2");
        const comment2 = await task.createComment(creatorSession, "test3");

        await expect(
            getTaskNotesContentAndOptionalInitialCommentsIfExists(assigneeSession.action(), {
                taskId: task.id,
                commentsLimit: 10,
            }),
        ).resolves.toEqual({
            notes: {
                version: 1,
                content: {
                    doc: createSimpleTaskNotesContent("Test notes"),
                    references: emptyContentReferences,
                },
            },
            initialComments: {
                checkpoint: expect.any(Date),
                commentCount: 3,
                otherReferencedComments: [],
                comments: [
                    new TaskCommentModel({
                        taskId: task.id,
                        index: 0,
                        version: 0,
                        author: await creatorSession.get(),
                        createdTime: comment0.createdTime,
                        createdTimeZone: defaultTimeZone,
                        payload: {
                            type: "Content",
                            parent: null,
                            content: {
                                doc: createSimpleMessageContent("test1"),
                                references: emptyContentReferences,
                            },
                            contentUpdate: null,
                            files: [],
                            reactionsByPos: emptyMap,
                            filesReactions: emptyReactionSet,
                        },
                        stream: null,
                    }),
                    new TaskCommentModel({
                        taskId: task.id,
                        index: 1,
                        version: 0,
                        author: await assigneeSession.get(),
                        createdTime: comment1.createdTime,
                        createdTimeZone: defaultTimeZone,
                        payload: {
                            type: "Content",
                            parent: null,
                            content: {
                                doc: createSimpleMessageContent("test2"),
                                references: emptyContentReferences,
                            },
                            contentUpdate: null,
                            files: [],
                            reactionsByPos: emptyMap,
                            filesReactions: emptyReactionSet,
                        },
                        stream: null,
                    }),
                    new TaskCommentModel({
                        taskId: task.id,
                        index: 2,
                        version: 0,
                        author: await creatorSession.get(),
                        createdTime: comment2.createdTime,
                        createdTimeZone: defaultTimeZone,
                        payload: {
                            type: "Content",
                            parent: null,
                            content: {
                                doc: createSimpleMessageContent("test3"),
                                references: emptyContentReferences,
                            },
                            contentUpdate: null,
                            files: [],
                            reactionsByPos: emptyMap,
                            filesReactions: emptyReactionSet,
                        },
                        stream: null,
                    }),
                ],
            },
        });

        await expect(
            getTaskNotesContentAndOptionalInitialCommentsIfExists(unauthorizedSession.action(), {
                taskId: task.id,
                commentsLimit: 10,
            }),
        ).rejects.toThrow(PermissionDeniedError);

        await expect(
            getTaskNotesContentAndOptionalInitialCommentsIfExists(viewerSession.action(), {
                taskId: task.id,
                commentsLimit: 10,
            }),
        ).resolves.toEqual({
            notes: {
                version: 1,
                content: {
                    doc: createSimpleTaskNotesContent("Test notes"),
                    references: emptyContentReferences,
                },
            },
            initialComments: null,
        });

        await expect(
            getTaskNotesContentAndOptionalInitialCommentsIfExists(commenterSession.action(), {
                taskId: task.id,
                commentsLimit: 10,
            }),
        ).resolves.toEqual({
            notes: {
                version: 1,
                content: {
                    doc: createSimpleTaskNotesContent("Test notes"),
                    references: emptyContentReferences,
                },
            },
            initialComments: {
                checkpoint: expect.any(Date),
                commentCount: 3,
                otherReferencedComments: [],
                comments: [
                    new TaskCommentModel({
                        taskId: task.id,
                        index: 0,
                        version: 0,
                        author: await creatorSession.get(),
                        createdTime: comment0.createdTime,
                        createdTimeZone: defaultTimeZone,
                        payload: {
                            type: "Content",
                            parent: null,
                            content: {
                                doc: createSimpleMessageContent("test1"),
                                references: emptyContentReferences,
                            },
                            contentUpdate: null,
                            files: [],
                            reactionsByPos: emptyMap,
                            filesReactions: emptyReactionSet,
                        },
                        stream: null,
                    }),
                    new TaskCommentModel({
                        taskId: task.id,
                        index: 1,
                        version: 0,
                        author: await assigneeSession.get(),
                        createdTime: comment1.createdTime,
                        createdTimeZone: defaultTimeZone,
                        payload: {
                            type: "Content",
                            parent: null,
                            content: {
                                doc: createSimpleMessageContent("test2"),
                                references: emptyContentReferences,
                            },
                            contentUpdate: null,
                            files: [],
                            reactionsByPos: emptyMap,
                            filesReactions: emptyReactionSet,
                        },
                        stream: null,
                    }),
                    new TaskCommentModel({
                        taskId: task.id,
                        index: 2,
                        version: 0,
                        author: await creatorSession.get(),
                        createdTime: comment2.createdTime,
                        createdTimeZone: defaultTimeZone,
                        payload: {
                            type: "Content",
                            parent: null,
                            content: {
                                doc: createSimpleMessageContent("test3"),
                                references: emptyContentReferences,
                            },
                            contentUpdate: null,
                            files: [],
                            reactionsByPos: emptyMap,
                            filesReactions: emptyReactionSet,
                        },
                        stream: null,
                    }),
                ],
            },
        });

        await expect(
            getTaskNotesContentAndOptionalInitialCommentsIfExists(editorSession.action(), {
                taskId: task.id,
                commentsLimit: 10,
            }),
        ).resolves.toEqual({
            notes: {
                version: 1,
                content: {
                    doc: createSimpleTaskNotesContent("Test notes"),
                    references: emptyContentReferences,
                },
            },
            initialComments: {
                checkpoint: expect.any(Date),
                commentCount: 3,
                otherReferencedComments: [],
                comments: [
                    new TaskCommentModel({
                        taskId: task.id,
                        index: 0,
                        version: 0,
                        author: await creatorSession.get(),
                        createdTime: comment0.createdTime,
                        createdTimeZone: defaultTimeZone,
                        payload: {
                            type: "Content",
                            parent: null,
                            content: {
                                doc: createSimpleMessageContent("test1"),
                                references: emptyContentReferences,
                            },
                            contentUpdate: null,
                            files: [],
                            reactionsByPos: emptyMap,
                            filesReactions: emptyReactionSet,
                        },
                        stream: null,
                    }),
                    new TaskCommentModel({
                        taskId: task.id,
                        index: 1,
                        version: 0,
                        author: await assigneeSession.get(),
                        createdTime: comment1.createdTime,
                        createdTimeZone: defaultTimeZone,
                        payload: {
                            type: "Content",
                            parent: null,
                            content: {
                                doc: createSimpleMessageContent("test2"),
                                references: emptyContentReferences,
                            },
                            contentUpdate: null,
                            files: [],
                            reactionsByPos: emptyMap,
                            filesReactions: emptyReactionSet,
                        },
                        stream: null,
                    }),
                    new TaskCommentModel({
                        taskId: task.id,
                        index: 2,
                        version: 0,
                        author: await creatorSession.get(),
                        createdTime: comment2.createdTime,
                        createdTimeZone: defaultTimeZone,
                        payload: {
                            type: "Content",
                            parent: null,
                            content: {
                                doc: createSimpleMessageContent("test3"),
                                references: emptyContentReferences,
                            },
                            contentUpdate: null,
                            files: [],
                            reactionsByPos: emptyMap,
                            filesReactions: emptyReactionSet,
                        },
                        stream: null,
                    }),
                ],
            },
        });

        await expect(
            getTaskNotesContentAndOptionalInitialCommentsIfExists(manageSession.action(), {
                taskId: task.id,
                commentsLimit: 10,
            }),
        ).resolves.toEqual({
            notes: {
                version: 1,
                content: {
                    doc: createSimpleTaskNotesContent("Test notes"),
                    references: emptyContentReferences,
                },
            },
            initialComments: {
                checkpoint: expect.any(Date),
                commentCount: 3,
                otherReferencedComments: [],
                comments: [
                    new TaskCommentModel({
                        taskId: task.id,
                        index: 0,
                        version: 0,
                        author: await creatorSession.get(),
                        createdTime: comment0.createdTime,
                        createdTimeZone: defaultTimeZone,
                        payload: {
                            type: "Content",
                            parent: null,
                            content: {
                                doc: createSimpleMessageContent("test1"),
                                references: emptyContentReferences,
                            },
                            contentUpdate: null,
                            files: [],
                            reactionsByPos: emptyMap,
                            filesReactions: emptyReactionSet,
                        },
                        stream: null,
                    }),
                    new TaskCommentModel({
                        taskId: task.id,
                        index: 1,
                        version: 0,
                        author: await assigneeSession.get(),
                        createdTime: comment1.createdTime,
                        createdTimeZone: defaultTimeZone,
                        payload: {
                            type: "Content",
                            parent: null,
                            content: {
                                doc: createSimpleMessageContent("test2"),
                                references: emptyContentReferences,
                            },
                            contentUpdate: null,
                            files: [],
                            reactionsByPos: emptyMap,
                            filesReactions: emptyReactionSet,
                        },
                        stream: null,
                    }),
                    new TaskCommentModel({
                        taskId: task.id,
                        index: 2,
                        version: 0,
                        author: await creatorSession.get(),
                        createdTime: comment2.createdTime,
                        createdTimeZone: defaultTimeZone,
                        payload: {
                            type: "Content",
                            parent: null,
                            content: {
                                doc: createSimpleMessageContent("test3"),
                                references: emptyContentReferences,
                            },
                            contentUpdate: null,
                            files: [],
                            reactionsByPos: emptyMap,
                            filesReactions: emptyReactionSet,
                        },
                        stream: null,
                    }),
                ],
            },
        });

        await expect(
            getTaskNotesContentAndOptionalInitialCommentsIfExists(creatorSession.action(), {
                taskId: task.id,
                commentsLimit: 10,
            }),
        ).resolves.toEqual({
            notes: {
                version: 1,
                content: {
                    doc: createSimpleTaskNotesContent("Test notes"),
                    references: emptyContentReferences,
                },
            },
            initialComments: {
                checkpoint: expect.any(Date),
                commentCount: 3,
                otherReferencedComments: [],
                comments: [
                    new TaskCommentModel({
                        taskId: task.id,
                        index: 0,
                        version: 0,
                        author: await creatorSession.get(),
                        createdTime: comment0.createdTime,
                        createdTimeZone: defaultTimeZone,
                        payload: {
                            type: "Content",
                            parent: null,
                            content: {
                                doc: createSimpleMessageContent("test1"),
                                references: emptyContentReferences,
                            },
                            contentUpdate: null,
                            files: [],
                            reactionsByPos: emptyMap,
                            filesReactions: emptyReactionSet,
                        },
                        stream: null,
                    }),
                    new TaskCommentModel({
                        taskId: task.id,
                        index: 1,
                        version: 0,
                        author: await assigneeSession.get(),
                        createdTime: comment1.createdTime,
                        createdTimeZone: defaultTimeZone,
                        payload: {
                            type: "Content",
                            parent: null,
                            content: {
                                doc: createSimpleMessageContent("test2"),
                                references: emptyContentReferences,
                            },
                            contentUpdate: null,
                            files: [],
                            reactionsByPos: emptyMap,
                            filesReactions: emptyReactionSet,
                        },
                        stream: null,
                    }),
                    new TaskCommentModel({
                        taskId: task.id,
                        index: 2,
                        version: 0,
                        author: await creatorSession.get(),
                        createdTime: comment2.createdTime,
                        createdTimeZone: defaultTimeZone,
                        payload: {
                            type: "Content",
                            parent: null,
                            content: {
                                doc: createSimpleMessageContent("test3"),
                                references: emptyContentReferences,
                            },
                            contentUpdate: null,
                            files: [],
                            reactionsByPos: emptyMap,
                            filesReactions: emptyReactionSet,
                        },
                        stream: null,
                    }),
                ],
            },
        });
    });
});

describe("createTaskComment()", () => {
    test("throws error for users that only have view access when trying to create task comments", async () => {
        const space = await TestSpace.create(taskMessagingContext);

        const [
            unauthorizedSession,
            viewerSession,
            commenterSession,
            editorSession,
            manageSession,
            creatorSession,
            assigneeSession,
        ] = await runAllPromises([
            space.createSession(),
            space.createSession(),
            space.createSession(),
            space.createSession(),
            space.createSession(),
            space.createSession(),
            space.createSession(),
        ]);

        const task = await TestTask.create(creatorSession);

        const content1 = createSimpleMessageContent("test1");
        const taskCommentDetails = {
            taskId: task.id,
            parent: null,
            content: content1,
            fileIds: [],
            createdTimeZone: defaultTimeZone,
        };

        const collection = await TestTaskCollection.create(creatorSession);
        await task.addCollection(creatorSession, collection);

        await collection.access.set(creatorSession, {
            type: "Local",
            accountGrantById: new Map<AccountId, AccessPolicyAccountGrant>([
                [creatorSession.account.id, {level: "Manage", generation: 0}],
                [manageSession.account.id, {level: "Manage", generation: 1}],
                [editorSession.account.id, {level: "Edit"}],
                [commenterSession.account.id, {level: "Comment"}],
                [viewerSession.account.id, {level: "View"}],
            ]),
            defaultGrant: null,
            urlGrant: null,
        });

        await task.updateAssignee(creatorSession, assigneeSession);

        await expect(
            createTaskComment(assigneeSession.action(), taskCommentDetails),
        ).resolves.not.toBeNull();
        await expect(
            createTaskComment(unauthorizedSession.action(), taskCommentDetails),
        ).rejects.toThrow(PermissionDeniedError);
        await expect(createTaskComment(viewerSession.action(), taskCommentDetails)).rejects.toThrow(
            PermissionDeniedError,
        );
        await expect(
            createTaskComment(commenterSession.action(), taskCommentDetails),
        ).resolves.not.toBeNull();
        await expect(
            createTaskComment(editorSession.action(), taskCommentDetails),
        ).resolves.not.toBeNull();
        await expect(
            createTaskComment(manageSession.action(), taskCommentDetails),
        ).resolves.not.toBeNull();
    });
});

describe("updateTaskCommentContent()", () => {
    test("throws error for users that only have view access when trying to update task comments", async () => {
        const space = await TestSpace.create(taskMessagingContext);

        const [
            unauthorizedSession,
            viewerSession,
            commenterSession,
            editorSession,
            manageSession,
            creatorSession,
            assigneeSession,
        ] = await runAllPromises([
            space.createSession(),
            space.createSession(),
            space.createSession(),
            space.createSession(),
            space.createSession(),
            space.createSession(),
            space.createSession(),
        ]);

        const task = await TestTask.create(creatorSession);

        const collection = await TestTaskCollection.create(creatorSession);
        await collection.access.grantDefault(creatorSession);
        await task.addCollection(creatorSession, collection);

        const creatorTaskComment = await task.createComment(creatorSession, "test1");
        const manageTaskComment = await task.createComment(manageSession, "test1");
        const editorTaskComment = await task.createComment(editorSession, "test1");
        const commenterTaskComment = await task.createComment(commenterSession, "test1");
        const viewerTaskComment = await task.createComment(viewerSession, "test1");
        const unauthorizedTaskComment = await task.createComment(unauthorizedSession, "test1");
        const assigneeTaskComment = await task.createComment(assigneeSession, "test1");

        const updatedContent1 = createSimpleMessageContent("updated test1");

        await expect(
            assigneeTaskComment.updateContent(assigneeSession, updatedContent1),
        ).resolves.not.toBeNull();
        await expect(
            unauthorizedTaskComment.updateContent(unauthorizedSession, updatedContent1),
        ).resolves.not.toBeNull();
        await expect(
            viewerTaskComment.updateContent(viewerSession, updatedContent1),
        ).resolves.not.toBeNull();
        await expect(
            creatorTaskComment.updateContent(creatorSession, updatedContent1),
        ).resolves.not.toBeNull();
        await expect(
            commenterTaskComment.updateContent(commenterSession, updatedContent1),
        ).resolves.not.toBeNull();
        await expect(
            editorTaskComment.updateContent(editorSession, updatedContent1),
        ).resolves.not.toBeNull();
        await expect(
            manageTaskComment.updateContent(manageSession, updatedContent1),
        ).resolves.not.toBeNull();

        await collection.access.set(creatorSession, {
            type: "Local",
            accountGrantById: new Map<AccountId, AccessPolicyAccountGrant>([
                [creatorSession.account.id, {level: "Manage", generation: 0}],
                [manageSession.account.id, {level: "Manage", generation: 1}],
                [editorSession.account.id, {level: "Edit"}],
                [commenterSession.account.id, {level: "Comment"}],
                [viewerSession.account.id, {level: "View"}],
            ]),
            defaultGrant: null,
            urlGrant: null,
        });

        await task.updateAssignee(creatorSession, assigneeSession);

        const secondUpdatedTaskComment = createSimpleMessageContent("updated test2");

        await expect(
            assigneeTaskComment.updateContent(assigneeSession, secondUpdatedTaskComment),
        ).resolves.not.toBeNull();
        await expect(
            unauthorizedTaskComment.updateContent(unauthorizedSession, secondUpdatedTaskComment),
        ).rejects.toThrow(PermissionDeniedError);
        await expect(
            viewerTaskComment.updateContent(viewerSession, secondUpdatedTaskComment),
        ).rejects.toThrow(PermissionDeniedError);
        await expect(
            creatorTaskComment.updateContent(creatorSession, secondUpdatedTaskComment),
        ).resolves.not.toBeNull();
        await expect(
            commenterTaskComment.updateContent(commenterSession, secondUpdatedTaskComment),
        ).resolves.not.toBeNull();
        await expect(
            editorTaskComment.updateContent(editorSession, secondUpdatedTaskComment),
        ).resolves.not.toBeNull();
        await expect(
            manageTaskComment.updateContent(manageSession, secondUpdatedTaskComment),
        ).resolves.not.toBeNull();
    });
});

describe("backfillTaskComments()", () => {
    test("throws error for users that only have view access when trying to get task comments from backfill", async () => {
        const space = await TestSpace.create(taskMessagingContext);

        const [
            unauthorizedSession,
            viewerSession,
            commenterSession,
            editorSession,
            manageSession,
            creatorSession,
            assigneeSession,
        ] = await runAllPromises([
            space.createSession(),
            space.createSession(),
            space.createSession(),
            space.createSession(),
            space.createSession(),
            space.createSession(),
            space.createSession(),
        ]);

        const task = await TestTask.create(creatorSession);

        const collection = await TestTaskCollection.create(creatorSession);
        await collection.access.grantDefault(creatorSession);
        await task.addCollection(creatorSession, collection);

        const creatorTaskComment = await task.createComment(creatorSession, "test1");

        await task.createComment(editorSession, "test1");

        await task.createComment(manageSession, "test1");

        await collection.access.set(creatorSession, {
            type: "Local",
            accountGrantById: new Map<AccountId, AccessPolicyAccountGrant>([
                [creatorSession.account.id, {level: "Manage", generation: 0}],
                [manageSession.account.id, {level: "Manage", generation: 1}],
                [editorSession.account.id, {level: "Edit"}],
                [commenterSession.account.id, {level: "Comment"}],
                [viewerSession.account.id, {level: "View"}],
            ]),
            defaultGrant: null,
            urlGrant: null,
        });

        await task.updateAssignee(creatorSession, assigneeSession);

        expect(
            await backfillTaskComments(creatorSession.action(), {
                taskId: task.id,
                checkpoint: generateServerSynchronizationCheckpointForTest(),
                clientCommentCount: 3,
                newCommentLimit: 100,
            }),
        ).toEqual({
            commentCount: 3,
            newComments: [],
            newOtherReferencedComments: [],
            commentUpdatesResult: {
                type: "Available",
                checkpoint: expect.any(Date),
                messages: [],
            },
        });

        const updatedMessageContent1 = createSimpleMessageContent("updated test1");

        await creatorTaskComment.updateContent(creatorSession, updatedMessageContent1);

        expect(
            await backfillTaskComments(assigneeSession.action(), {
                taskId: task.id,
                checkpoint: addMinutes(generateServerSynchronizationCheckpointForTest(), 5),
                clientCommentCount: 3,
                newCommentLimit: 100,
            }),
        ).toEqual({
            commentCount: 3,
            newComments: [],
            newOtherReferencedComments: [],
            commentUpdatesResult: {
                type: "Available",
                checkpoint: expect.any(Date),
                messages: [],
            },
        });

        expect(
            await backfillTaskComments(manageSession.action(), {
                taskId: task.id,
                checkpoint: addMinutes(generateServerSynchronizationCheckpointForTest(), 5),
                clientCommentCount: 3,
                newCommentLimit: 100,
            }),
        ).toEqual({
            commentCount: 3,
            newComments: [],
            newOtherReferencedComments: [],
            commentUpdatesResult: {
                type: "Available",
                checkpoint: expect.any(Date),
                messages: [],
            },
        });

        expect(
            await backfillTaskComments(editorSession.action(), {
                taskId: task.id,
                checkpoint: addMinutes(generateServerSynchronizationCheckpointForTest(), 5),
                clientCommentCount: 3,
                newCommentLimit: 100,
            }),
        ).toEqual({
            commentCount: 3,
            newComments: [],
            newOtherReferencedComments: [],
            commentUpdatesResult: {
                type: "Available",
                checkpoint: expect.any(Date),
                messages: [],
            },
        });

        expect(
            await backfillTaskComments(commenterSession.action(), {
                taskId: task.id,
                checkpoint: addMinutes(generateServerSynchronizationCheckpointForTest(), 5),
                clientCommentCount: 3,
                newCommentLimit: 100,
            }),
        ).toEqual({
            commentCount: 3,
            newComments: [],
            newOtherReferencedComments: [],
            commentUpdatesResult: {
                type: "Available",
                checkpoint: expect.any(Date),
                messages: [],
            },
        });

        await expect(
            backfillTaskComments(viewerSession.action(), {
                taskId: task.id,
                checkpoint: addMinutes(generateServerSynchronizationCheckpointForTest(), 5),
                clientCommentCount: 3,
                newCommentLimit: 100,
            }),
        ).rejects.toThrow(PermissionDeniedError);

        await expect(
            backfillTaskComments(unauthorizedSession.action(), {
                taskId: task.id,
                checkpoint: addMinutes(generateServerSynchronizationCheckpointForTest(), 5),
                clientCommentCount: 3,
                newCommentLimit: 100,
            }),
        ).rejects.toThrow(PermissionDeniedError);
    });
});

describe("deleteTaskComment()", () => {
    test("throws error for users that only have view access when trying to delete task comments", async () => {
        const space = await TestSpace.create(taskMessagingContext);

        const [
            unauthorizedSession,
            viewerSession,
            commenterSession,
            editorSession,
            manageSession,
            creatorSession,
            assigneeSession,
        ] = await runAllPromises([
            space.createSession(),
            space.createSession(),
            space.createSession(),
            space.createSession(),
            space.createSession(),
            space.createSession(),
            space.createSession(),
        ]);

        const task = await TestTask.create(creatorSession);
        const collection = await TestTaskCollection.create(creatorSession);
        await collection.access.grantDefault(creatorSession);
        await task.addCollection(creatorSession, collection);

        await task.updateAssignee(creatorSession, assigneeSession);

        const creatorTaskComment = await task.createComment(creatorSession, "test1");

        const manageTaskComment = await task.createComment(manageSession, "test1");
        const editorTaskComment = await task.createComment(editorSession, "test1");
        const commenterTaskComment = await task.createComment(commenterSession, "test1");
        const viewerTaskComment = await task.createComment(viewerSession, "test1");
        const unauthorizedTaskComment = await task.createComment(unauthorizedSession, "test1");
        const assigneeTaskComment = await task.createComment(assigneeSession, "test1");

        await collection.access.set(creatorSession, {
            type: "Local",
            accountGrantById: new Map<AccountId, AccessPolicyAccountGrant>([
                [creatorSession.account.id, {level: "Manage", generation: 0}],
                [manageSession.account.id, {level: "Manage", generation: 1}],
                [editorSession.account.id, {level: "Edit"}],
                [commenterSession.account.id, {level: "Comment"}],
                [viewerSession.account.id, {level: "View"}],
            ]),
            defaultGrant: null,
            urlGrant: null,
        });

        await expect(
            deleteTaskComment(assigneeSession.action(), {
                taskId: task.id,
                commentIndex: assigneeTaskComment.index,
            }),
        ).resolves.not.toBeNull();
        await expect(
            deleteTaskComment(commenterSession.action(), {
                taskId: task.id,
                commentIndex: commenterTaskComment.index,
            }),
        ).resolves.not.toBeNull();
        await expect(
            deleteTaskComment(editorSession.action(), {
                taskId: task.id,
                commentIndex: editorTaskComment.index,
            }),
        ).resolves.not.toBeNull();
        await expect(
            deleteTaskComment(manageSession.action(), {
                taskId: task.id,
                commentIndex: manageTaskComment.index,
            }),
        ).resolves.not.toBeNull();
        await expect(
            deleteTaskComment(creatorSession.action(), {
                taskId: task.id,
                commentIndex: creatorTaskComment.index,
            }),
        ).resolves.not.toBeNull();

        await expect(
            deleteTaskComment(unauthorizedSession.action(), {
                taskId: task.id,
                commentIndex: unauthorizedTaskComment.index,
            }),
        ).rejects.toThrow(PermissionDeniedError);
        await expect(
            deleteTaskComment(viewerSession.action(), {
                taskId: task.id,
                commentIndex: viewerTaskComment.index,
            }),
        ).rejects.toThrow(PermissionDeniedError);
    });
});

describe("taskMessagingImplementation()", () => {
    testMessagingImplementation<TaskId>(taskMessagingContext, {
        async createRoom(context, spaceId) {
            await authorizeSpaceAccess(context, spaceId);

            const [space, account] = await runAllPromises([
                TestSpace.get(taskMessagingContext, spaceId),
                TestAccount.get(taskMessagingContext, context.actor.getAccountId()),
            ]);

            const session = await space.createSession(account);
            const taskCollection = await TestTaskCollection.create(session);
            await taskCollection.access.grantDefault(session);

            const task = await TestTask.create(session);
            await task.addCollection(session, taskCollection);

            return {
                key: task.id,
                spaceId,
                createdTime: new Date((await task.getItem()).createdTime[0]),
                messageCount: 0,
                messageNoun: "comment",
            };
        },

        async createPrivateRoom(context, spaceId, {insideSessions, insideViewerSession}) {
            await authorizeSpaceAccess(context, spaceId);

            const [space, account] = await runAllPromises([
                TestSpace.get(taskMessagingContext, spaceId),
                TestAccount.get(taskMessagingContext, context.actor.getAccountId()),
            ]);

            const session = await space.createSession(account);

            const taskCollection = await TestTaskCollection.create(session);

            let count = 0;

            await taskCollection.access.set(session, {
                type: "Local",
                accountGrantById: new Map<AccountId, AccessPolicyAccountGrant>([
                    ...insideSessions.map(
                        (insideSession): [AccountId, AccessPolicyAccountGrant] => [
                            insideSession.accountId,
                            insideSession.accountId === context.actor.getAccountId()
                                ? {level: "Manage", generation: 0}
                                : {level: (["Comment", "Edit"] as const)[count++ % 2]!},
                        ],
                    ),
                    ...(insideViewerSession
                        ? [[insideViewerSession.accountId, {level: "View"}] as const]
                        : []),
                ]),
                defaultGrant: null,
                urlGrant: null,
            });

            const task = await TestTask.create(session);
            await task.addCollection(session, taskCollection);

            return {
                key: task.id,
                spaceId,
                createdTime: new Date((await task.getItem()).createdTime[0]),
                messageCount: 0,
                messageNoun: "comment",
                doesInsideViewerSessionHaveRoomAccess: false,
                revokeInsideSession: async (context, revokeSession) => {
                    await taskCollection.access.revoke(session, revokeSession.account.id);
                },
            };
        },

        async getRoom(context, taskId) {
            const [taskItem, taskItemWithCommentAttributes] = await runAllPromises([
                getTaskItemForTest(context, taskId),
                getTaskCommentsSummaryItemIfExistsForTest(context, taskId),
            ]);

            await authorizeTaskAccess(context, taskId, "Comment");

            return {
                key: taskItem.taskId,
                spaceId: taskItem.spaceId,
                createdTime: new Date(taskItem.createdTime[0]),
                messageCount:
                    taskItemWithCommentAttributes !== null
                        ? sumIterable(taskItemWithCommentAttributes.commentCountByAuthorId.values())
                        : 0,
                messageNoun: "comment",
            };
        },
        getMissingRoomKey() {
            return generateId();
        },
        getRoomFileAuthorizer(taskId) {
            return FileTaskAuthorizer.bind({type: "TaskComments", taskId});
        },
        getRoomBotScope(taskId) {
            return {type: "Task", taskId};
        },
        async createMessage(
            context,
            {roomKey: taskId, parent, content, fileIds, isStream, createdTimeZone},
        ) {
            const comment = await createTaskComment(context, {
                taskId,
                parent,
                content,
                fileIds,
                isStream,
                createdTimeZone: createdTimeZone ?? defaultTimeZone,
            });

            return {
                index: comment.index,
                createdTime: comment.createdTime,
            };
        },
        async pingMessageStream(context, {roomKey: taskId, messageIndex}) {
            return await pingTaskCommentStream(context, {taskId, commentIndex: messageIndex});
        },
        async putMessageStreamPart(
            context,
            {
                roomKey: taskId,
                messageIndex: commentIndex,
                partIndex,
                payload,
                isTimeoutErrorCompletion,
            },
        ) {
            return await putTaskCommentStreamPart(context, {
                taskId,
                commentIndex,
                partIndex,
                payload,
                isTimeoutErrorCompletion,
            });
        },
        async putMessageApprovalDecisions(
            context,
            {roomKey: taskId, messageIndex: commentIndex, payload},
        ) {
            const {approvals} = await putTaskCommentMessageApprovalDecisions(context, {
                taskId,
                commentIndex,
                payload,
            });

            return {approvals};
        },
        async completeMessageStream(context, {roomKey: taskId, messageIndex: commentIndex}) {
            return await completeTaskCommentStream(context, {
                taskId,
                commentIndex,
            });
        },
        async getMessage(context, {roomKey: taskId, messageIndex: commentIndex}) {
            return await getTaskComment(context, {taskId, commentIndex});
        },
        async getMessagePayload(context, {roomKey: taskId, messageIndex: commentIndex}) {
            return await getTaskCommentPayload(context, {taskId, commentIndex});
        },
        async getMessageParentContent(context, {roomKey: taskId, parent}) {
            return await getTaskCommentParentContent(context, taskId, {parent});
        },
        async updateMessageContent(
            context,
            {roomKey: taskId, messageIndex: commentIndex, contentVersion, steps},
        ) {
            return await updateTaskCommentContent(context, {
                taskId,
                commentIndex,
                contentVersion,
                steps,
            });
        },
        async deleteMessage(context, {roomKey: taskId, messageIndex: commentIndex}) {
            return await deleteTaskComment(context, {taskId, commentIndex});
        },
        async setMessageReaction(
            context,
            {roomKey: taskId, messageIndex: commentIndex, contentVersion, pos, reaction},
        ) {
            return await setTaskCommentReaction(context, {
                taskId,
                commentIndex,
                contentVersion,
                pos,
                reaction,
            });
        },
        async deleteMessageReaction(
            context,
            {roomKey: taskId, messageIndex: commentIndex, contentVersion, pos},
        ) {
            return await deleteTaskCommentReaction(context, {
                taskId,
                commentIndex,
                contentVersion,
                pos,
            });
        },
        async getMessagesFromStart(
            context,
            {
                roomKey: taskId,
                limit,
                afterMessageIndex: afterCommentIndex,
                beforeMessageIndex: beforeCommentIndex,
            },
        ) {
            const {commentCount, comments, otherReferencedComments} =
                await getTaskCommentsFromStart(context, {
                    taskId,
                    limit,
                    afterCommentIndex,
                    beforeCommentIndex,
                });
            return {
                messageCount: commentCount,
                messages: comments,
                otherReferencedMessages: otherReferencedComments,
            };
        },
        async getMessagesFromEnd(
            context,
            {
                roomKey: taskId,
                limit,
                afterMessageIndex: afterCommentIndex,
                beforeMessageIndex: beforeCommentIndex,
            },
        ) {
            const {commentCount, comments, otherReferencedComments} = await getTaskCommentsFromEnd(
                context,
                {
                    taskId,
                    limit,
                    afterCommentIndex,
                    beforeCommentIndex,
                },
            );
            return {
                messageCount: commentCount,
                messages: comments,
                otherReferencedMessages: otherReferencedComments,
            };
        },
        async getMessagePayloadsFromStart(
            context,
            {roomKey: taskId, limit, afterMessageIndex, beforeMessageIndex},
        ) {
            const {commentCount, comments} = await getTaskCommentPayloadsFromStart(context, {
                taskId,
                limit,
                afterCommentIndex: afterMessageIndex,
                beforeCommentIndex: beforeMessageIndex,
            });
            return {messageCount: commentCount, messages: comments};
        },
        async getMessagePayloadsFromStartWithParents(
            context,
            {roomKey: taskId, limit, afterMessageIndex, beforeMessageIndex},
        ) {
            const {commentCount, comments, parentComments} =
                await getTaskCommentPayloadsFromStartWithParents(
                    context,
                    {
                        taskId,
                        limit,
                        afterCommentIndex: afterMessageIndex,
                        beforeCommentIndex: beforeMessageIndex,
                    },
                    message => Promise.resolve(message),
                );

            return {
                messageCount: commentCount,
                messages: comments,
                parentMessages: parentComments,
            };
        },
        async getMessagePayloadsFromEnd(
            context,
            {roomKey: taskId, limit, afterMessageIndex, beforeMessageIndex},
        ) {
            const {commentCount, comments} = await getTaskCommentPayloadsFromEnd(context, {
                taskId,
                limit,
                afterCommentIndex: afterMessageIndex,
                beforeCommentIndex: beforeMessageIndex,
            });
            return {messageCount: commentCount, messages: comments};
        },
        async getMessagePayloadsFromEndWithParents(
            context,
            {roomKey: taskId, limit, afterMessageIndex, beforeMessageIndex},
        ) {
            const {commentCount, comments, parentComments} =
                await getTaskCommentPayloadsFromEndWithParents(
                    context,
                    {
                        taskId,
                        limit,
                        afterCommentIndex: afterMessageIndex,
                        beforeCommentIndex: beforeMessageIndex,
                    },
                    message => Promise.resolve(message),
                );

            return {
                messageCount: commentCount,
                messages: comments,
                parentMessages: parentComments,
            };
        },
        async backfillMessages(
            context,
            {
                roomKey: taskId,
                checkpoint,
                clientMessageCount: clientCommentCount,
                newMessageLimit: newCommentLimit,
            },
        ) {
            const {commentCount, newComments, newOtherReferencedComments, commentUpdatesResult} =
                await backfillTaskComments(context, {
                    taskId,
                    checkpoint,
                    clientCommentCount,
                    newCommentLimit,
                });
            return {
                messageCount: commentCount,
                newMessages: newComments,
                newOtherReferencedMessages: newOtherReferencedComments,
                messageUpdatesResult: commentUpdatesResult,
            };
        },
    });
});
