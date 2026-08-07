import {Fragment, Slice} from "prosemirror-model";
import {ReplaceStep} from "prosemirror-transform";
import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {spacesInjection} from "~/server/spaces/spaces_injection.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {getTaskNotesContent} from "~/server/tasks/data/get_task_notes_content.js";
import {getTaskNotesContentWithoutReferences} from "~/server/tasks/data/get_task_notes_content_without_references.js";
import {tasksInjection} from "~/server/tasks/data/tasks_injection.js";
import {TestTask} from "~/server/tasks/data/test_helpers/test_task.js";
import {TestTaskCollection} from "~/server/tasks/data/test_helpers/test_task_collection.js";
import {
    updateTaskNotesContent,
    updateTaskNotesContentIdempotently,
} from "~/server/tasks/data/update_task_notes_content.js";
import {emptyContentReferences} from "~/shared/content/content_references.js";
import {
    FailedPreconditionError,
    NotFoundError,
    PermissionDeniedError,
} from "~/shared/error/error.open_source.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.open_source.js";
import {generateId} from "~/shared/id/id.open_source.js";
import {ContentEditorClientId, RpcCallId} from "~/shared/id/types/id_types.open_source.js";
import {
    emptyTaskNotesContent,
    TaskNotesContentProsemirrorSchema as schema,
} from "~/shared/tasks/task_notes_content_schema.js";

const context = createTestContext({
    spacesInjection,
    tasksInjection,
});

function textSlice(text: string) {
    if (text.length === 0) return Slice.empty;
    return new Slice(Fragment.from(schema.text(text)), 0, 0);
}

function paragraphDoc(text: string) {
    return schema.node("doc", {}, [schema.node("paragraph", {}, [schema.text(text)])]);
}

describe("updateTaskNotesContent()", () => {
    test("can update task notes", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();
        const clientId = generateId<ContentEditorClientId>();

        const task = await TestTask.create(session);

        expect(await getTaskNotesContent(session.action(), task.id)).toEqual({
            spaceId: space.id,
            version: 0,
            content: {
                doc: emptyTaskNotesContent,
                references: emptyContentReferences,
            },
        });

        await updateTaskNotesContent(session.action(), {
            spaceId: space.id,
            taskId: task.id,
            clientVersion: 0,
            clientSteps: [
                new ReplaceStep(1, 1, textSlice("a")),
                new ReplaceStep(2, 2, textSlice("b")),
            ],
            clientId,
        });

        expect(await getTaskNotesContent(session.action(), task.id)).toEqual({
            spaceId: space.id,
            version: 2,
            content: {
                doc: schema.node("doc", {}, [schema.node("paragraph", {}, [schema.text("ab")])]),
                references: emptyContentReferences,
            },
        });

        await updateTaskNotesContent(session.action(), {
            spaceId: space.id,
            taskId: task.id,
            clientVersion: 2,
            clientSteps: [new ReplaceStep(3, 3, textSlice("c"))],
            clientId,
        });

        expect(await getTaskNotesContent(session.action(), task.id)).toEqual({
            spaceId: space.id,
            version: 3,
            content: {
                doc: schema.node("doc", {}, [schema.node("paragraph", {}, [schema.text("abc")])]),
                references: emptyContentReferences,
            },
        });

        expect(await getTaskNotesContentWithoutReferences(session.action(), task.id)).toEqual(
            expect.objectContaining({
                spaceId: space.id,
                version: 3,
                content: schema.node("doc", {}, [
                    schema.node("paragraph", {}, [schema.text("abc")]),
                ]),
            }),
        );
    });

    test("can\u2019t update task notes that don\u2019t exist", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();

        await expect(
            updateTaskNotesContent(session.action(), {
                spaceId: space.id,
                taskId: generateId(),
                clientVersion: 0,
                clientSteps: [
                    new ReplaceStep(1, 1, textSlice("a")),
                    new ReplaceStep(2, 2, textSlice("b")),
                ],
                clientId: generateId<ContentEditorClientId>(),
            }),
        ).rejects.toThrow(NotFoundError);
    });

    test("can\u2019t update task notes in a different space", async () => {
        const space = await TestSpace.create(context);
        const otherSpace = await TestSpace.create(context);
        const session = await space.createSession();
        const otherSession = await otherSpace.createSession();

        const task = await TestTask.create(session);
        const collection = await TestTaskCollection.create(session);
        await collection.access.grantDefault(session);
        await task.addCollection(session, collection);

        expect(await getTaskNotesContent(session.action(), task.id)).toEqual({
            spaceId: space.id,
            version: 0,
            content: {
                doc: emptyTaskNotesContent,
                references: emptyContentReferences,
            },
        });

        await expect(
            updateTaskNotesContent(otherSession.action(), {
                spaceId: space.id,
                taskId: task.id,
                clientVersion: 0,
                clientSteps: [
                    new ReplaceStep(1, 1, textSlice("a")),
                    new ReplaceStep(2, 2, textSlice("b")),
                ],
                clientId: generateId<ContentEditorClientId>(),
            }),
        ).rejects.toThrow(PermissionDeniedError);

        expect(await getTaskNotesContent(session.action(), task.id)).toEqual({
            spaceId: space.id,
            version: 0,
            content: {
                doc: emptyTaskNotesContent,
                references: emptyContentReferences,
            },
        });
    });

    test("can update task notes in a public collection", async () => {
        const space = await TestSpace.create(context);
        const session1 = await space.createSession();
        const session2 = await space.createSession();

        const task = await TestTask.create(session1);
        const collection = await TestTaskCollection.create(session1);
        await collection.access.grantDefault(session1);
        await task.addCollection(session1, collection);

        expect(await getTaskNotesContent(session1.action(), task.id)).toEqual({
            spaceId: space.id,
            version: 0,
            content: {
                doc: emptyTaskNotesContent,
                references: emptyContentReferences,
            },
        });

        await updateTaskNotesContent(session2.action(), {
            spaceId: space.id,
            taskId: task.id,
            clientVersion: 0,
            clientSteps: [
                new ReplaceStep(1, 1, textSlice("a")),
                new ReplaceStep(2, 2, textSlice("b")),
            ],
            clientId: generateId<ContentEditorClientId>(),
        });

        expect(await getTaskNotesContent(session1.action(), task.id)).toEqual({
            spaceId: space.id,
            version: 2,
            content: {
                doc: schema.node("doc", {}, [schema.node("paragraph", {}, [schema.text("ab")])]),
                references: emptyContentReferences,
            },
        });
    });

    test("can\u2019t update task notes in a private collection", async () => {
        const space = await TestSpace.create(context);
        const session1 = await space.createSession();
        const session2 = await space.createSession();

        const task = await TestTask.create(session1);
        const collection = await TestTaskCollection.create(session1);
        await task.addCollection(session1, collection);

        expect(await getTaskNotesContent(session1.action(), task.id)).toEqual({
            spaceId: space.id,
            version: 0,
            content: {
                doc: emptyTaskNotesContent,
                references: emptyContentReferences,
            },
        });

        await expect(
            updateTaskNotesContent(session2.action(), {
                spaceId: space.id,
                taskId: task.id,
                clientVersion: 0,
                clientSteps: [
                    new ReplaceStep(1, 1, textSlice("a")),
                    new ReplaceStep(2, 2, textSlice("b")),
                ],
                clientId: generateId<ContentEditorClientId>(),
            }),
        ).rejects.toThrow(PermissionDeniedError);

        expect(await getTaskNotesContent(session1.action(), task.id)).toEqual({
            spaceId: space.id,
            version: 0,
            content: {
                doc: emptyTaskNotesContent,
                references: emptyContentReferences,
            },
        });
    });

    test("rebases an update made against an older version onto newer content", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();

        const task = await TestTask.create(session);
        const clientId = generateId<ContentEditorClientId>();

        await updateTaskNotesContent(session.action(), {
            spaceId: space.id,
            taskId: task.id,
            clientVersion: 0,
            clientSteps: [
                new ReplaceStep(1, 1, textSlice("a")),
                new ReplaceStep(2, 2, textSlice("b")),
            ],
            clientId,
        });

        expect(await getTaskNotesContent(session.action(), task.id)).toEqual({
            spaceId: space.id,
            version: 2,
            content: {
                doc: schema.node("doc", {}, [schema.node("paragraph", {}, [schema.text("ab")])]),
                references: emptyContentReferences,
            },
        });

        await updateTaskNotesContent(session.action(), {
            spaceId: space.id,
            taskId: task.id,
            clientVersion: 1,
            clientSteps: [new ReplaceStep(2, 2, textSlice("c"))],
            clientId,
        });

        expect(await getTaskNotesContent(session.action(), task.id)).toEqual({
            spaceId: space.id,
            version: 3,
            content: {
                doc: schema.node("doc", {}, [schema.node("paragraph", {}, [schema.text("abc")])]),
                references: emptyContentReferences,
            },
        });
    });

    test("drops a rebased step that becomes a noop", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();

        const task = await TestTask.create(session);
        const clientId = generateId<ContentEditorClientId>();

        await updateTaskNotesContent(session.action(), {
            spaceId: space.id,
            taskId: task.id,
            clientVersion: 0,
            clientSteps: [new ReplaceStep(1, 1, textSlice("foobar"))],
            clientId,
        });

        // Delete "ob" from "foobar" leaving "foar" at version 2.
        await updateTaskNotesContent(session.action(), {
            spaceId: space.id,
            taskId: task.id,
            clientVersion: 1,
            clientSteps: [new ReplaceStep(3, 5, Slice.empty)],
            clientId,
        });

        expect(await getTaskNotesContent(session.action(), task.id)).toEqual({
            spaceId: space.id,
            version: 2,
            content: {
                doc: schema.node("doc", {}, [schema.node("paragraph", {}, [schema.text("foar")])]),
                references: emptyContentReferences,
            },
        });

        // This stale update inserts into the range that was deleted above. After rebasing
        // there are no steps left to apply, so the version and content stay unchanged.
        await updateTaskNotesContent(session.action(), {
            spaceId: space.id,
            taskId: task.id,
            clientVersion: 1,
            clientSteps: [new ReplaceStep(4, 4, textSlice("x"))],
            clientId,
        });

        expect(await getTaskNotesContent(session.action(), task.id)).toEqual({
            spaceId: space.id,
            version: 2,
            content: {
                doc: schema.node("doc", {}, [schema.node("paragraph", {}, [schema.text("foar")])]),
                references: emptyContentReferences,
            },
        });
    });

    test("can\u2019t update task notes with a version ahead of the current version", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();

        const task = await TestTask.create(session);
        const clientId = generateId<ContentEditorClientId>();

        await updateTaskNotesContent(session.action(), {
            spaceId: space.id,
            taskId: task.id,
            clientVersion: 0,
            clientSteps: [
                new ReplaceStep(1, 1, textSlice("a")),
                new ReplaceStep(2, 2, textSlice("b")),
            ],
            clientId,
        });

        await expect(
            updateTaskNotesContent(session.action(), {
                spaceId: space.id,
                taskId: task.id,
                clientVersion: 3,
                clientSteps: [new ReplaceStep(3, 3, textSlice("c"))],
                clientId,
            }),
        ).rejects.toThrow(FailedPreconditionError);

        expect(await getTaskNotesContent(session.action(), task.id)).toEqual({
            spaceId: space.id,
            version: 2,
            content: {
                doc: schema.node("doc", {}, [schema.node("paragraph", {}, [schema.text("ab")])]),
                references: emptyContentReferences,
            },
        });
    });

    test("can\u2019t update task notes with a version ahead of the current version when notes are not initialized", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();

        const task = await TestTask.create(session);
        const clientId = generateId<ContentEditorClientId>();

        expect(await getTaskNotesContent(session.action(), task.id)).toEqual({
            spaceId: space.id,
            version: 0,
            content: {
                doc: emptyTaskNotesContent,
                references: emptyContentReferences,
            },
        });

        await expect(
            updateTaskNotesContent(session.action(), {
                spaceId: space.id,
                taskId: task.id,
                clientVersion: 2,
                clientSteps: [new ReplaceStep(1, 1, textSlice("a"))],
                clientId,
            }),
        ).rejects.toThrow(FailedPreconditionError);

        expect(await getTaskNotesContent(session.action(), task.id)).toEqual({
            spaceId: space.id,
            version: 0,
            content: {
                doc: emptyTaskNotesContent,
                references: emptyContentReferences,
            },
        });
    });

    test("counts notes step count contributions for each account", async () => {
        const space = await TestSpace.create(context);
        const session1 = await space.createSession();
        const session2 = await space.createSession();
        const session3 = await space.createSession();

        const task = await TestTask.create(session1);
        const collection = await TestTaskCollection.create(session1);
        await collection.access.grantDefault(session1);
        await task.addCollection(session1, collection);

        expect(
            await getTaskNotesContentWithoutReferences(session1.action(), task.id).then(item =>
                item.stepCountByNonCreatorAccountId.get(),
            ),
        ).toEqual(new Map());

        await task.typeNotes(session1, "Adding another sentence.");

        expect(
            await getTaskNotesContentWithoutReferences(session1.action(), task.id).then(item =>
                item.stepCountByNonCreatorAccountId.get(),
            ),
        ).toEqual(new Map());

        await task.typeNotes(session2, " Yet another sentence.");

        expect(
            await getTaskNotesContentWithoutReferences(session1.action(), task.id).then(item =>
                item.stepCountByNonCreatorAccountId.get(),
            ),
        ).toEqual(new Map([[session2.account.id, 1]]));

        await task.typeNotes(session3, " A third sentence.");

        expect(
            await getTaskNotesContentWithoutReferences(session1.action(), task.id).then(item =>
                item.stepCountByNonCreatorAccountId.get(),
            ),
        ).toEqual(
            new Map([
                [session2.account.id, 1],
                [session3.account.id, 1],
            ]),
        );

        await task.typeNotes(
            session2,
            " I\u2019m going to need to get more creative with test data.",
        );

        expect(
            await getTaskNotesContentWithoutReferences(session1.action(), task.id).then(item =>
                item.stepCountByNonCreatorAccountId.get(),
            ),
        ).toEqual(
            new Map([
                [session2.account.id, 2],
                [session3.account.id, 1],
            ]),
        );

        await task.typeNotes(session2, " How", {secondText: " much wood"});

        expect(
            await getTaskNotesContentWithoutReferences(session1.action(), task.id).then(item =>
                item.stepCountByNonCreatorAccountId.get(),
            ),
        ).toEqual(
            new Map([
                [session2.account.id, 4],
                [session3.account.id, 1],
            ]),
        );

        await task.typeNotes(session1, " could a wood", {secondText: " chuck chuck"});

        expect(
            await getTaskNotesContentWithoutReferences(session1.action(), task.id).then(item =>
                item.stepCountByNonCreatorAccountId.get(),
            ),
        ).toEqual(
            new Map([
                [session2.account.id, 4],
                [session3.account.id, 1],
            ]),
        );

        await task.typeNotes(session2, " if a wood chunk could chunk wood?");

        expect(
            await getTaskNotesContentWithoutReferences(session1.action(), task.id).then(item =>
                item.stepCountByNonCreatorAccountId.get(),
            ),
        ).toEqual(
            new Map([
                [session2.account.id, 5],
                [session3.account.id, 1],
            ]),
        );

        await task.typeNotes(session3, " Nice.");

        expect(
            await getTaskNotesContentWithoutReferences(session1.action(), task.id).then(item =>
                item.stepCountByNonCreatorAccountId.get(),
            ),
        ).toEqual(
            new Map([
                [session2.account.id, 5],
                [session3.account.id, 2],
            ]),
        );
    });

    test("applies steps again when called without a client request token", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();

        const task = await TestTask.create(session);

        const input = {
            spaceId: space.id,
            taskId: task.id,
            clientVersion: 0,
            clientSteps: [new ReplaceStep(1, 1, textSlice("a"))],
            clientId: generateId<ContentEditorClientId>(),
        };

        // The base function isn't idempotent: replaying the same update keeps rebasing and
        // re-applying the steps, duplicating the content.
        await updateTaskNotesContent(session.action(), input);
        await updateTaskNotesContent(session.action(), input);
        await updateTaskNotesContent(session.action(), input);

        expect(await getTaskNotesContent(session.action(), task.id)).toEqual({
            spaceId: space.id,
            version: 3,
            content: {
                doc: paragraphDoc("aaa"),
                references: emptyContentReferences,
            },
        });
    });

    test("idempotently applies an update in sequence when client request token is provided", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();

        const task = await TestTask.create(session);

        const input = {
            spaceId: space.id,
            taskId: task.id,
            clientVersion: 0,
            clientSteps: [new ReplaceStep(1, 1, textSlice("a"))],
            clientId: generateId<ContentEditorClientId>(),
            clientRequestToken: generateId<RpcCallId>(),
        };

        // Replaying the same request with the same token applies the steps exactly once.
        await expect(updateTaskNotesContentIdempotently(session.action(), input)).resolves.toEqual({
            newVersion: 1,
        });
        await expect(updateTaskNotesContentIdempotently(session.action(), input)).resolves.toEqual({
            newVersion: 1,
        });
        await expect(updateTaskNotesContentIdempotently(session.action(), input)).resolves.toEqual({
            newVersion: 1,
        });

        expect(await getTaskNotesContent(session.action(), task.id)).toEqual({
            spaceId: space.id,
            version: 1,
            content: {
                doc: paragraphDoc("a"),
                references: emptyContentReferences,
            },
        });
    });

    test("idempotently applies an update in parallel when client request token is provided", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();

        const task = await TestTask.create(session);

        const input = {
            spaceId: space.id,
            taskId: task.id,
            clientVersion: 0,
            clientSteps: [new ReplaceStep(1, 1, textSlice("a"))],
            clientId: generateId<ContentEditorClientId>(),
            clientRequestToken: generateId<RpcCallId>(),
        };

        await runAllPromises([
            updateTaskNotesContentIdempotently(session.action(), input),
            updateTaskNotesContentIdempotently(session.action(), input),
            updateTaskNotesContentIdempotently(session.action(), input),
        ]);

        expect(await getTaskNotesContent(session.action(), task.id)).toEqual({
            spaceId: space.id,
            version: 1,
            content: {
                doc: paragraphDoc("a"),
                references: emptyContentReferences,
            },
        });
    });

    test("idempotently applies an update that rebased against newer content when client request token is provided", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();

        const task = await TestTask.create(session);
        const clientId = generateId<ContentEditorClientId>();

        await updateTaskNotesContent(session.action(), {
            spaceId: space.id,
            taskId: task.id,
            clientVersion: 0,
            clientSteps: [
                new ReplaceStep(1, 1, textSlice("a")),
                new ReplaceStep(2, 2, textSlice("b")),
            ],
            clientId,
        });

        // This update is against an older version so it gets rebased onto "ab". Replaying
        // it must not rebase and re-apply the step a second time.
        const input = {
            spaceId: space.id,
            taskId: task.id,
            clientVersion: 1,
            clientSteps: [new ReplaceStep(2, 2, textSlice("c"))],
            clientId,
            clientRequestToken: generateId<RpcCallId>(),
        };

        await expect(updateTaskNotesContentIdempotently(session.action(), input)).resolves.toEqual({
            newVersion: 3,
        });
        await expect(updateTaskNotesContentIdempotently(session.action(), input)).resolves.toEqual({
            newVersion: 3,
        });

        expect(await getTaskNotesContent(session.action(), task.id)).toEqual({
            spaceId: space.id,
            version: 3,
            content: {
                doc: paragraphDoc("abc"),
                references: emptyContentReferences,
            },
        });
    });

    test("can\u2019t idempotently update task notes after losing access", async () => {
        const space = await TestSpace.create(context);
        const session1 = await space.createSession();
        const session2 = await space.createSession();

        const task = await TestTask.create(session1);
        await task.access.grant(session1, session2, "Edit");

        const input = {
            spaceId: space.id,
            taskId: task.id,
            clientVersion: 0,
            clientSteps: [new ReplaceStep(1, 1, textSlice("a"))],
            clientId: generateId<ContentEditorClientId>(),
            clientRequestToken: generateId<RpcCallId>(),
        };

        await updateTaskNotesContentIdempotently(session2.action(), input);
        await updateTaskNotesContentIdempotently(session2.action(), input);

        expect(await getTaskNotesContent(session1.action(), task.id)).toEqual({
            spaceId: space.id,
            version: 1,
            content: {
                doc: paragraphDoc("a"),
                references: emptyContentReferences,
            },
        });

        await task.access.revoke(session1, session2);

        // A replay after losing access must still be rejected — the idempotent retry
        // doesn't let a now-unauthorized actor complete the edit.
        await expect(updateTaskNotesContentIdempotently(session2.action(), input)).rejects.toThrow(
            PermissionDeniedError,
        );

        expect(await getTaskNotesContent(session1.action(), task.id)).toEqual({
            spaceId: space.id,
            version: 1,
            content: {
                doc: paragraphDoc("a"),
                references: emptyContentReferences,
            },
        });
    });
});
