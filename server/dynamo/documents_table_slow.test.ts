/*!
 * We put our slow to run `DocumentsTable` tests in this file so they can be
 * run in parallel with our faster `DocumentsTable` tests.
 *
 * Or so that in development you only run the fast tests for fast
 * iteration speed.
 */

import {Fragment, Slice} from "prosemirror-model";
import {ReplaceStep} from "prosemirror-transform";
import {TestServerContext} from "~/server/context/server_context";
import {
    createDocument,
    getDocument,
    getDocumentContentSteps,
    getDocumentsTableForTest,
    updateDocumentContent,
    updateDocumentSnapshotBeforeDeletingStepsTestCheckpoint,
} from "~/server/dynamo/documents_table";
import {
    emptyDocumentContent,
    DocumentContentProsemirrorSchema as schema,
} from "~/shared/documents/document_content_schema";
import {generateId} from "~/shared/id/id";

jest.useFakeTimers();

function textSlice(text: string) {
    return new Slice(Fragment.from(schema.text(text)), 0, 0);
}

test(
    "snapshot updates after many steps committed individually",
    async () => {
        const documentId = generateId();

        await createDocument({
            id: documentId,
            content: emptyDocumentContent,
        });

        let text = "";

        const snapshotVersions = new Set();

        for (let i = 1; i <= 240; i++) {
            const newText = `${i} `;

            await updateDocumentContent(new TestServerContext(), {
                id: documentId,
                version: i - 1,
                steps: [new ReplaceStep(3 + text.length, 3 + text.length, textSlice(newText))],
                clientId: generateId(),
            });

            await TestServerContext.waitForTasks();

            text += newText;

            if (i % 10 === 0) {
                snapshotVersions.add(
                    (
                        await getDocumentsTableForTest().getPartialItem(
                            {
                                partitionType: "Document",
                                documentId,
                                sortRangeType: "Snapshot",
                            },
                            {
                                attributes: ["version"],
                            },
                        )
                    )?.version,
                );

                const document = await getDocument(documentId);
                expect(document?.version).toEqual(i);
                expect(document?.content.toJSON()).toEqual(
                    schema
                        .node("doc", {}, [
                            schema.node("title", {}, []),
                            schema.node("paragraph", {}, [schema.text(text)]),
                        ])
                        .toJSON(),
                );

                // Running all timers should force our next update to read from the cache.
                jest.runAllTimers();
            }
        }

        expect(Array.from(snapshotVersions)).toEqual([0, 100, 200]);

        // Some tests to make sure we can read steps across a snapshot boundary.

        expect(
            (await getDocumentContentSteps({id: documentId, startVersion: 0, endVersion: 240}))
                .length,
        ).toEqual(240);

        expect(
            (await getDocumentContentSteps({id: documentId, startVersion: 10, endVersion: 20}))
                .length,
        ).toEqual(10);

        expect(
            (await getDocumentContentSteps({id: documentId, startVersion: 110, endVersion: 120}))
                .length,
        ).toEqual(10);

        expect(
            (await getDocumentContentSteps({id: documentId, startVersion: 210, endVersion: 220}))
                .length,
        ).toEqual(10);

        expect(
            (await getDocumentContentSteps({id: documentId, startVersion: 180, endVersion: 220}))
                .length,
        ).toEqual(40);
    },
    // 3min timeout for this test
    1000 * 60 * 3,
);

test(
    "snapshot updates after many steps committed at once",
    async () => {
        const documentId = generateId();

        await createDocument({
            id: documentId,
            content: emptyDocumentContent,
        });

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

            await updateDocumentContent(new TestServerContext(), {
                id: documentId,
                version: i - 1,
                steps: [step1, step2, step3, step4, step5, step6],
                clientId: generateId(),
            });

            await TestServerContext.waitForTasks();

            snapshotVersions.add(
                (
                    await getDocumentsTableForTest().getPartialItem(
                        {
                            partitionType: "Document",
                            documentId,
                            sortRangeType: "Snapshot",
                        },
                        {
                            attributes: ["version"],
                        },
                    )
                )?.version,
            );

            const document = await getDocument(documentId);
            expect(document?.version).toEqual(i + 5);
            expect(document?.content.toJSON()).toEqual(
                schema
                    .node("doc", {}, [
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
        const documentId = generateId();

        await createDocument({
            id: documentId,
            content: emptyDocumentContent,
        });

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
                updateDocumentSnapshotBeforeDeletingStepsTestCheckpoint.pauseForTest(documentId);

            const requestPromise = updateDocumentContent(new TestServerContext(), {
                id: documentId,
                version: i - 1,
                steps: [step1, step2, step3, step4, step5, step6],
                clientId: generateId(),
            }).then(async () => {
                // The checkpoint may not be called within the `updateDocumentContent()`
                // function. So to avoid waiting forever, make sure to call it here at the end
                // of the request.
                await updateDocumentSnapshotBeforeDeletingStepsTestCheckpoint.waitForTest(
                    documentId,
                );
            });

            const requestPauseResult = await requestPausePromise;

            await TestServerContext.waitForTasks();

            // Read the document before the request is unpaused so old steps have not been
            // deleted yet.
            const document = await getDocument(documentId);
            expect(document?.version).toEqual(i + 5);
            expect(document?.content.toJSON()).toEqual(
                schema
                    .node("doc", {}, [
                        schema.node("title", {}, []),
                        schema.node("paragraph", {}, [schema.text(text)]),
                    ])
                    .toJSON(),
            );

            requestPauseResult.unpause();

            await requestPromise;
        }
    },
    // 2min timeout for this test
    1000 * 60 * 2,
);

test(
    "can update document at a version before the document snapshot",
    async () => {
        const documentId = generateId();

        await createDocument({
            id: documentId,
            content: emptyDocumentContent,
        });

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
            jest.runAllTimers();

            await updateDocumentContent(new TestServerContext(), {
                id: documentId,
                version: 0,
                steps: [step1, step2, step3, step4, step5, step6],
                clientId: generateId(),
            });

            await TestServerContext.waitForTasks();

            // Read the document before the request is unpaused so old steps have not been
            // deleted yet.
            const document = await getDocument(documentId);
            expect(document?.version).toEqual(i + 5);
            expect(document?.content.toJSON()).toEqual(
                schema
                    .node("doc", {}, [
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
