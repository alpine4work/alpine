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
import {updateTaskNotesContent} from "~/server/tasks/data/update_task_notes_content.js";
import {emptyContentReferences} from "~/shared/content/content_references.js";
import {
    FailedPreconditionError,
    NotFoundError,
    PermissionDeniedError,
} from "~/shared/error/error.js";
import {generateId} from "~/shared/id/id.js";
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

describe("updateTaskNotesContent()", () => {
    test("can update task notes", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();

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
            version: 0,
            steps: [new ReplaceStep(1, 1, textSlice("a")), new ReplaceStep(2, 2, textSlice("b"))],
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
            version: 2,
            steps: [new ReplaceStep(3, 3, textSlice("c"))],
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
                version: 0,
                steps: [
                    new ReplaceStep(1, 1, textSlice("a")),
                    new ReplaceStep(2, 2, textSlice("b")),
                ],
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
                version: 0,
                steps: [
                    new ReplaceStep(1, 1, textSlice("a")),
                    new ReplaceStep(2, 2, textSlice("b")),
                ],
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
            version: 0,
            steps: [new ReplaceStep(1, 1, textSlice("a")), new ReplaceStep(2, 2, textSlice("b"))],
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
                version: 0,
                steps: [
                    new ReplaceStep(1, 1, textSlice("a")),
                    new ReplaceStep(2, 2, textSlice("b")),
                ],
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

    test("can\u2019t update task notes with the wrong version", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();

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
            version: 0,
            steps: [new ReplaceStep(1, 1, textSlice("a")), new ReplaceStep(2, 2, textSlice("b"))],
        });

        expect(await getTaskNotesContent(session.action(), task.id)).toEqual({
            spaceId: space.id,
            version: 2,
            content: {
                doc: schema.node("doc", {}, [schema.node("paragraph", {}, [schema.text("ab")])]),
                references: emptyContentReferences,
            },
        });

        await expect(
            updateTaskNotesContent(session.action(), {
                spaceId: space.id,
                taskId: task.id,
                version: 1,
                steps: [new ReplaceStep(3, 3, textSlice("c"))],
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

    test("can\u2019t update task notes with the wrong version when notes are not initialized", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();

        const task = await TestTask.create(session);

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
                version: 2,
                steps: [new ReplaceStep(1, 1, textSlice("a"))],
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
});
