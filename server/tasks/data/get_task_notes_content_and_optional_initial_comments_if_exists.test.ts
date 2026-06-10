import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {spacesInjection} from "~/server/spaces/spaces_injection.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {getTaskNotesContentAndOptionalInitialCommentsIfExists} from "~/server/tasks/data/get_task_notes_content_and_optional_initial_comments_if_exists.js";
import {tasksInjection} from "~/server/tasks/data/tasks_injection.js";
import {TestTask} from "~/server/tasks/data/test_helpers/test_task.js";
import {TestTaskCollection} from "~/server/tasks/data/test_helpers/test_task_collection.js";
import {AccessPolicyAccountGrant} from "~/shared/access/access_policy.js";
import {emptyContentReferences} from "~/shared/content/content_references.js";
import {createSimpleMessageContent} from "~/shared/content/message_content_schema.js";
import {PermissionDeniedError} from "~/shared/error/error.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {defaultTimeZone} from "~/shared/helpers/intl/time_zone.js";
import {emptyMap} from "~/shared/helpers/map/empty_map.js";
import {AccountId} from "~/shared/id/types/id_types.js";
import {emptyReactionSet} from "~/shared/reactions/reaction_set.js";
import {TaskCommentModel} from "~/shared/tasks/model/task_comment_model.js";
import {createSimpleTaskNotesContent} from "~/shared/tasks/task_notes_content_schema.js";

const context = createTestContext({
    spacesInjection,
    tasksInjection,
});

describe("getTaskNotesContentAndOptionalInitialCommentsIfExists()", () => {
    test("returns null for users that only have view access when trying to get initial task comments", async () => {
        const space = await TestSpace.create(context);

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
