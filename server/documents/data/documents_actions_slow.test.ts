/**
 * We put our slow to run `DocumentsTable` tests in this file so they can be
 * run in parallel with our faster `DocumentsTable` tests.
 *
 * Or so that in development you only run the fast tests for fast
 * iteration speed.
 *
 * NOTE(calebmer, 2023-01-09): After getting rid of LocalStack in tests, this
 * test is not as slow as it used to be. Should we rename and change timeouts?
 */

import {Fragment, Slice} from "prosemirror-model";
import {ReplaceStep} from "prosemirror-transform";
import {
    getDocumentContentSteps,
    getDocumentsTableForTest,
    updateDocumentContent,
    updateDocumentSnapshotBeforeDeletingStepsTestCheckpoint,
} from "~/server/documents/data/documents_actions.js";
import {TestDocument} from "~/server/documents/test_helpers/test_document.js";
import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {ProcessContextModule} from "~/shared/context/process_context_module.js";
import {DocumentContentProsemirrorSchema as schema} from "~/shared/documents/document_content_schema.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {generateId} from "~/shared/id/id.js";

import.meta.jest.setTimeout(1000 * 20);

const context = createTestContext();

function textSlice(text: string) {
    return new Slice(Fragment.from(schema.text(text)), 0, 0);
}

beforeEach(() => {
    import.meta.jest.useFakeTimers();
});

// Important that this goes after `createTestContext()` which will register
// `afterEach` hooks that clean up some timers (specifically
// `TestLocalJobSender` which cleans up any delayed jobs).
afterEach(() => {
    const hadNoTimers = import.meta.jest.getTimerCount() === 0;
    import.meta.jest.clearAllTimers();
    assert(hadNoTimers, "Expected all timers to be cleaned up by the end of each test");
});

test(
    "snapshot updates after many steps committed individually",
    async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();

        const document = await TestDocument.create(session);

        let text = "";

        const snapshotVersions = new Set();

        for (let i = 1; i <= 240; i++) {
            const newText = `${i} `;

            await updateDocumentContent(session.action(), {
                id: document.id,
                version: i - 1,
                steps: [new ReplaceStep(3 + text.length, 3 + text.length, textSlice(newText))],
                clientId: generateId(),
            });

            await ProcessContextModule.waitForTestTasks();

            text += newText;

            if (i % 10 === 0) {
                snapshotVersions.add(
                    (
                        await getDocumentsTableForTest().getPartialItemIfExists(
                            context,
                            {
                                partitionType: "Document",
                                documentId: document.id,
                                sortRangeType: "Snapshot",
                            },
                            {
                                attributes: ["version"],
                            },
                        )
                    )?.version,
                );

                const documentResult = await document.get();
                expect(documentResult.version).toEqual(i);
                expect(documentResult.content.doc.toJSON()).toEqual(
                    schema
                        .node("doc", {accessPolicy: document.initialAccessPolicy}, [
                            schema.node("title", {}, []),
                            schema.node("paragraph", {}, [schema.text(text)]),
                        ])
                        .toJSON(),
                );

                // Running all timers should force our next update to read from the cache.
                import.meta.jest.runAllTimers();
            }
        }

        expect(Array.from(snapshotVersions)).toEqual([0, 100, 200]);

        // Some tests to make sure we can read steps across a snapshot boundary.

        expect(
            (
                await getDocumentContentSteps(session.action(), {
                    id: document.id,
                    startVersion: 0,
                    endVersion: 240,
                })
            ).length,
        ).toEqual(240);

        expect(
            (
                await getDocumentContentSteps(session.action(), {
                    id: document.id,
                    startVersion: 10,
                    endVersion: 20,
                })
            ).length,
        ).toEqual(10);

        expect(
            (
                await getDocumentContentSteps(session.action(), {
                    id: document.id,
                    startVersion: 110,
                    endVersion: 120,
                })
            ).length,
        ).toEqual(10);

        expect(
            (
                await getDocumentContentSteps(session.action(), {
                    id: document.id,
                    startVersion: 210,
                    endVersion: 220,
                })
            ).length,
        ).toEqual(10);

        expect(
            (
                await getDocumentContentSteps(session.action(), {
                    id: document.id,
                    startVersion: 180,
                    endVersion: 220,
                })
            ).length,
        ).toEqual(40);
    },
    // 3min timeout for this test
    1000 * 60 * 3,
);

test(
    "snapshot updates after many steps committed at once",
    async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();

        const document = await TestDocument.create(session);

        let text = "";

        const snapshotVersions = new Set();

        for (let i = 1; i <= 320; i += 6) {
            const newText1 = `${i} `;
            const newText2 = `${i + 1} `;
            const newText3 = `${i + 2} `;
            const newText4 = `${i + 3} `;
            const newText5 = `${i + 4} `;
            const newText6 = `${i + 5} `;

            const step1 = new ReplaceStep(3 + text.length, 3 + text.length, textSlice(newText1));
            text += newText1;
            const step2 = new ReplaceStep(3 + text.length, 3 + text.length, textSlice(newText2));
            text += newText2;
            const step3 = new ReplaceStep(3 + text.length, 3 + text.length, textSlice(newText3));
            text += newText3;
            const step4 = new ReplaceStep(3 + text.length, 3 + text.length, textSlice(newText4));
            text += newText4;
            const step5 = new ReplaceStep(3 + text.length, 3 + text.length, textSlice(newText5));
            text += newText5;
            const step6 = new ReplaceStep(3 + text.length, 3 + text.length, textSlice(newText6));
            text += newText6;

            await updateDocumentContent(session.action(), {
                id: document.id,
                version: i - 1,
                steps: [step1, step2, step3, step4, step5, step6],
                clientId: generateId(),
            });

            await ProcessContextModule.waitForTestTasks();

            snapshotVersions.add(
                (
                    await getDocumentsTableForTest().getPartialItemIfExists(
                        context,
                        {
                            partitionType: "Document",
                            documentId: document.id,
                            sortRangeType: "Snapshot",
                        },
                        {
                            attributes: ["version"],
                        },
                    )
                )?.version,
            );

            const documentResult = await document.get();
            expect(documentResult.version).toEqual(i + 5);
            expect(documentResult.content.doc.toJSON()).toEqual(
                schema
                    .node("doc", {accessPolicy: document.initialAccessPolicy}, [
                        schema.node("title", {}, []),
                        schema.node("paragraph", {}, [schema.text(text)]),
                    ])
                    .toJSON(),
            );
        }

        expect(Array.from(snapshotVersions)).toEqual([0, 102, 204, 300]);
    },
    // 3min timeout for this test
    1000 * 60 * 3,
);

test(
    "can read document while in the middle of updating a snapshot",
    async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();

        const document = await TestDocument.create(session);

        let text = "";

        for (let i = 1; i <= 240; i += 6) {
            const newText1 = `${i} `;
            const newText2 = `${i + 1} `;
            const newText3 = `${i + 2} `;
            const newText4 = `${i + 3} `;
            const newText5 = `${i + 4} `;
            const newText6 = `${i + 5} `;

            const step1 = new ReplaceStep(3 + text.length, 3 + text.length, textSlice(newText1));
            text += newText1;
            const step2 = new ReplaceStep(3 + text.length, 3 + text.length, textSlice(newText2));
            text += newText2;
            const step3 = new ReplaceStep(3 + text.length, 3 + text.length, textSlice(newText3));
            text += newText3;
            const step4 = new ReplaceStep(3 + text.length, 3 + text.length, textSlice(newText4));
            text += newText4;
            const step5 = new ReplaceStep(3 + text.length, 3 + text.length, textSlice(newText5));
            text += newText5;
            const step6 = new ReplaceStep(3 + text.length, 3 + text.length, textSlice(newText6));
            text += newText6;

            const requestPausePromise =
                updateDocumentSnapshotBeforeDeletingStepsTestCheckpoint.pauseForTest(document.id);

            const requestPromise = updateDocumentContent(session.action(), {
                id: document.id,
                version: i - 1,
                steps: [step1, step2, step3, step4, step5, step6],
                clientId: generateId(),
            }).then(async () => {
                // The checkpoint may not be called within the `updateDocumentContent()`
                // function. So to avoid waiting forever, make sure to call it here at the end
                // of the request.
                await updateDocumentSnapshotBeforeDeletingStepsTestCheckpoint.waitForTest(
                    document.id,
                );
            });

            const requestPauseResult = await requestPausePromise;

            // Read the document before the request is unpaused so old steps have not been
            // deleted yet.
            const documentResult = await document.get();
            expect(documentResult.version).toEqual(i + 5);
            expect(documentResult.content.doc.toJSON()).toEqual(
                schema
                    .node("doc", {accessPolicy: document.initialAccessPolicy}, [
                        schema.node("title", {}, []),
                        schema.node("paragraph", {}, [schema.text(text)]),
                    ])
                    .toJSON(),
            );

            requestPauseResult.unpause();

            await requestPromise;
            await ProcessContextModule.waitForTestTasks();
        }
    },
    // 2min timeout for this test
    1000 * 60 * 2,
);

test(
    "can update document at a version before the document snapshot",
    async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();

        const document = await TestDocument.create(session);

        let text = "";

        for (let i = 1; i <= 240; i += 6) {
            const newText1 = `${i} `;
            const newText2 = `${i + 1} `;
            const newText3 = `${i + 2} `;
            const newText4 = `${i + 3} `;
            const newText5 = `${i + 4} `;
            const newText6 = `${i + 5} `;

            const initialTextLength = text.length;
            const step1 = new ReplaceStep(
                3 + (text.length - initialTextLength),
                3 + (text.length - initialTextLength),
                textSlice(newText1),
            );
            text += newText1;
            const step2 = new ReplaceStep(
                3 + (text.length - initialTextLength),
                3 + (text.length - initialTextLength),
                textSlice(newText2),
            );
            text += newText2;
            const step3 = new ReplaceStep(
                3 + (text.length - initialTextLength),
                3 + (text.length - initialTextLength),
                textSlice(newText3),
            );
            text += newText3;
            const step4 = new ReplaceStep(
                3 + (text.length - initialTextLength),
                3 + (text.length - initialTextLength),
                textSlice(newText4),
            );
            text += newText4;
            const step5 = new ReplaceStep(
                3 + (text.length - initialTextLength),
                3 + (text.length - initialTextLength),
                textSlice(newText5),
            );
            text += newText5;
            const step6 = new ReplaceStep(
                3 + (text.length - initialTextLength),
                3 + (text.length - initialTextLength),
                textSlice(newText6),
            );
            text += newText6;

            // Make sure to expire the cache. We need to do that so we don't keep all steps
            // in the cache and instead need to go read them from the database.
            import.meta.jest.runAllTimers();

            await updateDocumentContent(session.action(), {
                id: document.id,
                version: 0,
                steps: [step1, step2, step3, step4, step5, step6],
                clientId: generateId(),
            });

            await ProcessContextModule.waitForTestTasks();

            // Read the document before the request is unpaused so old steps have not been
            // deleted yet.
            const documentResult = await document.get();
            expect(documentResult.version).toEqual(i + 5);
            expect(documentResult.content.doc.toJSON()).toEqual(
                schema
                    .node("doc", {accessPolicy: document.initialAccessPolicy}, [
                        schema.node("title", {}, []),
                        schema.node("paragraph", {}, [schema.text(text)]),
                    ])
                    .toJSON(),
            );
        }
    },
    // 3min timeout for this test
    1000 * 60 * 3,
);
