import {Fragment, Slice} from "prosemirror-model";
import {ReplaceStep, Step} from "prosemirror-transform";
import {createTestWorkerContext} from "~/server/cloudflare/test_helpers/create_test_worker_context.js";
import {DocumentCollaborationStepCache} from "~/server/documents/collaboration/document_collaboration_step_cache.js";
import {
    createDocument,
    getDocumentContentStepsTestCounter,
    updateDocumentContent,
} from "~/server/documents/data/documents_actions.js";
import {createTestSession} from "~/server/dynamo/test_helpers/create_test_session.js";
import {createTestSpace} from "~/server/dynamo/test_helpers/create_test_space.js";
import {DocumentContentProsemirrorSchema as schema} from "~/shared/documents/document_content_schema.js";
import {FailedPreconditionError} from "~/shared/error/error.js";
import {generateId} from "~/shared/id/id.js";

const context = createTestWorkerContext();
const space = createTestSpace(context);
const session = createTestSession(context, space);

function textSlice(text: string) {
    if (text.length === 0) return Slice.empty;
    return new Slice(Fragment.from(schema.text(text)), 0, 0);
}

function massageSteps(steps: Array<{step: Step}>) {
    return steps.map(({step}) => step.toJSON());
}

test("fails when the end version is greater than the last end version to be passed in", async () => {
    const {id} = await createDocument(context.action(session), {spaceId: space.id});

    await updateDocumentContent(context.action(session), {
        id,
        version: 0,
        steps: [
            new ReplaceStep(3, 3, textSlice("a")),
            new ReplaceStep(4, 4, textSlice("b")),
            new ReplaceStep(5, 5, textSlice("c")),
            new ReplaceStep(6, 6, textSlice("d")),
            new ReplaceStep(7, 7, textSlice("e")),
            new ReplaceStep(8, 8, textSlice("f")),
            new ReplaceStep(9, 9, textSlice("g")),
            new ReplaceStep(10, 10, textSlice("h")),
            new ReplaceStep(11, 11, textSlice("i")),
            new ReplaceStep(12, 12, textSlice("j")),
            new ReplaceStep(13, 13, textSlice("k")),
            new ReplaceStep(14, 14, textSlice("l")),
        ],
        clientId: generateId(),
    });

    const stepCache = new DocumentCollaborationStepCache(id, 10);

    await expect(async () => {
        await stepCache.getSteps(context.action(session), 7, 11);
    }).rejects.toEqual(
        new FailedPreconditionError("End version is greater than the last version in the document"),
    );
});

test("gets the correct steps", async () => {
    const {id} = await createDocument(context.action(session), {spaceId: space.id});

    await updateDocumentContent(context.action(session), {
        id,
        version: 0,
        steps: [
            new ReplaceStep(3, 3, textSlice("a")),
            new ReplaceStep(4, 4, textSlice("b")),
            new ReplaceStep(5, 5, textSlice("c")),
            new ReplaceStep(6, 6, textSlice("d")),
            new ReplaceStep(7, 7, textSlice("e")),
            new ReplaceStep(8, 8, textSlice("f")),
            new ReplaceStep(9, 9, textSlice("g")),
            new ReplaceStep(10, 10, textSlice("h")),
            new ReplaceStep(11, 11, textSlice("i")),
            new ReplaceStep(12, 12, textSlice("j")),
            new ReplaceStep(13, 13, textSlice("k")),
            new ReplaceStep(14, 14, textSlice("l")),
        ],
        clientId: generateId(),
    });

    const stepCache = new DocumentCollaborationStepCache(id, 10);

    expect(massageSteps(await stepCache.getSteps(context.action(session), 7, 10))).toEqual(
        [
            new ReplaceStep(10, 10, textSlice("h")),
            new ReplaceStep(11, 11, textSlice("i")),
            new ReplaceStep(12, 12, textSlice("j")),
        ].map(step => step.toJSON()),
    );

    expect(massageSteps(await stepCache.getSteps(context.action(session), 5, 10))).toEqual(
        [
            new ReplaceStep(8, 8, textSlice("f")),
            new ReplaceStep(9, 9, textSlice("g")),
            new ReplaceStep(10, 10, textSlice("h")),
            new ReplaceStep(11, 11, textSlice("i")),
            new ReplaceStep(12, 12, textSlice("j")),
        ].map(step => step.toJSON()),
    );

    expect(massageSteps(await stepCache.getSteps(context.action(session), 2, 5))).toEqual(
        [
            new ReplaceStep(5, 5, textSlice("c")),
            new ReplaceStep(6, 6, textSlice("d")),
            new ReplaceStep(7, 7, textSlice("e")),
        ].map(step => step.toJSON()),
    );

    expect(massageSteps(await stepCache.getSteps(context.action(session), 4, 8))).toEqual(
        [
            new ReplaceStep(7, 7, textSlice("e")),
            new ReplaceStep(8, 8, textSlice("f")),
            new ReplaceStep(9, 9, textSlice("g")),
            new ReplaceStep(10, 10, textSlice("h")),
        ].map(step => step.toJSON()),
    );
});

test("gets the correct steps in the fewest database reads", async () => {
    const {id} = await createDocument(context.action(session), {spaceId: space.id});

    await updateDocumentContent(context.action(session), {
        id,
        version: 0,
        steps: [
            new ReplaceStep(3, 3, textSlice("a")),
            new ReplaceStep(4, 4, textSlice("b")),
            new ReplaceStep(5, 5, textSlice("c")),
            new ReplaceStep(6, 6, textSlice("d")),
            new ReplaceStep(7, 7, textSlice("e")),
            new ReplaceStep(8, 8, textSlice("f")),
            new ReplaceStep(9, 9, textSlice("g")),
            new ReplaceStep(10, 10, textSlice("h")),
            new ReplaceStep(11, 11, textSlice("i")),
            new ReplaceStep(12, 12, textSlice("j")),
            new ReplaceStep(13, 13, textSlice("k")),
            new ReplaceStep(14, 14, textSlice("l")),
        ],
        clientId: generateId(),
    });

    const recording1 = getDocumentContentStepsTestCounter.recordForTest({
        id,
        startVersion: 7,
        endVersion: 10,
    });

    const recording2 = getDocumentContentStepsTestCounter.recordForTest({
        id,
        startVersion: 5,
        endVersion: 7,
    });

    const recording3 = getDocumentContentStepsTestCounter.recordForTest({
        id,
        startVersion: 2,
        endVersion: 5,
    });

    expect(recording1.getCount()).toEqual(0);
    expect(recording2.getCount()).toEqual(0);
    expect(recording3.getCount()).toEqual(0);

    const stepCache = new DocumentCollaborationStepCache(id, 10);

    expect(recording1.getCount()).toEqual(0);
    expect(recording2.getCount()).toEqual(0);
    expect(recording3.getCount()).toEqual(0);

    expect(massageSteps(await stepCache.getSteps(context.action(session), 7, 10))).toEqual(
        [
            new ReplaceStep(10, 10, textSlice("h")),
            new ReplaceStep(11, 11, textSlice("i")),
            new ReplaceStep(12, 12, textSlice("j")),
        ].map(step => step.toJSON()),
    );

    expect(recording1.getCount()).toEqual(1);
    expect(recording2.getCount()).toEqual(0);
    expect(recording3.getCount()).toEqual(0);

    expect(massageSteps(await stepCache.getSteps(context.action(session), 5, 10))).toEqual(
        [
            new ReplaceStep(8, 8, textSlice("f")),
            new ReplaceStep(9, 9, textSlice("g")),
            new ReplaceStep(10, 10, textSlice("h")),
            new ReplaceStep(11, 11, textSlice("i")),
            new ReplaceStep(12, 12, textSlice("j")),
        ].map(step => step.toJSON()),
    );

    expect(recording1.getCount()).toEqual(1);
    expect(recording2.getCount()).toEqual(1);
    expect(recording3.getCount()).toEqual(0);

    expect(massageSteps(await stepCache.getSteps(context.action(session), 2, 5))).toEqual(
        [
            new ReplaceStep(5, 5, textSlice("c")),
            new ReplaceStep(6, 6, textSlice("d")),
            new ReplaceStep(7, 7, textSlice("e")),
        ].map(step => step.toJSON()),
    );

    expect(recording1.getCount()).toEqual(1);
    expect(recording2.getCount()).toEqual(1);
    expect(recording3.getCount()).toEqual(1);

    expect(massageSteps(await stepCache.getSteps(context.action(session), 4, 8))).toEqual(
        [
            new ReplaceStep(7, 7, textSlice("e")),
            new ReplaceStep(8, 8, textSlice("f")),
            new ReplaceStep(9, 9, textSlice("g")),
            new ReplaceStep(10, 10, textSlice("h")),
        ].map(step => step.toJSON()),
    );

    expect(recording1.getCount()).toEqual(1);
    expect(recording2.getCount()).toEqual(1);
    expect(recording3.getCount()).toEqual(1);
});

test("gets the correct steps in the fewest database reads even when reading in parallel", async () => {
    const {id} = await createDocument(context.action(session), {spaceId: space.id});

    await updateDocumentContent(context.action(session), {
        id,
        version: 0,
        steps: [
            new ReplaceStep(3, 3, textSlice("a")),
            new ReplaceStep(4, 4, textSlice("b")),
            new ReplaceStep(5, 5, textSlice("c")),
            new ReplaceStep(6, 6, textSlice("d")),
            new ReplaceStep(7, 7, textSlice("e")),
            new ReplaceStep(8, 8, textSlice("f")),
            new ReplaceStep(9, 9, textSlice("g")),
            new ReplaceStep(10, 10, textSlice("h")),
            new ReplaceStep(11, 11, textSlice("i")),
            new ReplaceStep(12, 12, textSlice("j")),
            new ReplaceStep(13, 13, textSlice("k")),
            new ReplaceStep(14, 14, textSlice("l")),
        ],
        clientId: generateId(),
    });

    const recording1 = getDocumentContentStepsTestCounter.recordForTest({
        id,
        startVersion: 7,
        endVersion: 10,
    });

    const recording2 = getDocumentContentStepsTestCounter.recordForTest({
        id,
        startVersion: 5,
        endVersion: 7,
    });

    const recording3 = getDocumentContentStepsTestCounter.recordForTest({
        id,
        startVersion: 2,
        endVersion: 5,
    });

    expect(recording1.getCount()).toEqual(0);
    expect(recording2.getCount()).toEqual(0);
    expect(recording3.getCount()).toEqual(0);

    const stepCache = new DocumentCollaborationStepCache(id, 10);

    expect(recording1.getCount()).toEqual(0);
    expect(recording2.getCount()).toEqual(0);
    expect(recording3.getCount()).toEqual(0);

    expect(
        await Promise.all([
            stepCache.getSteps(context.action(session), 7, 10).then(massageSteps),
            stepCache.getSteps(context.action(session), 5, 10).then(massageSteps),
            stepCache.getSteps(context.action(session), 5, 8).then(massageSteps),
            stepCache.getSteps(context.action(session), 2, 5).then(massageSteps),
            stepCache.getSteps(context.action(session), 4, 8).then(massageSteps),
        ]),
    ).toEqual([
        [
            new ReplaceStep(10, 10, textSlice("h")),
            new ReplaceStep(11, 11, textSlice("i")),
            new ReplaceStep(12, 12, textSlice("j")),
        ].map(step => step.toJSON()),
        [
            new ReplaceStep(8, 8, textSlice("f")),
            new ReplaceStep(9, 9, textSlice("g")),
            new ReplaceStep(10, 10, textSlice("h")),
            new ReplaceStep(11, 11, textSlice("i")),
            new ReplaceStep(12, 12, textSlice("j")),
        ].map(step => step.toJSON()),
        [
            new ReplaceStep(8, 8, textSlice("f")),
            new ReplaceStep(9, 9, textSlice("g")),
            new ReplaceStep(10, 10, textSlice("h")),
        ].map(step => step.toJSON()),
        [
            new ReplaceStep(5, 5, textSlice("c")),
            new ReplaceStep(6, 6, textSlice("d")),
            new ReplaceStep(7, 7, textSlice("e")),
        ].map(step => step.toJSON()),
        [
            new ReplaceStep(7, 7, textSlice("e")),
            new ReplaceStep(8, 8, textSlice("f")),
            new ReplaceStep(9, 9, textSlice("g")),
            new ReplaceStep(10, 10, textSlice("h")),
        ].map(step => step.toJSON()),
    ]);

    expect(recording1.getCount()).toEqual(1);
    expect(recording2.getCount()).toEqual(1);
    expect(recording3.getCount()).toEqual(1);
});
