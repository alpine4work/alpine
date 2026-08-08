import fc from "fast-check";
import {DocumentWithoutTitleContentProsemirrorSchema} from "~/shared/documents/document_content_schema.js";
import {InternalError} from "~/shared/error/error.open_source.js";
import {diffProsemirrorNodes} from "~/shared/prosemirror/diff_prosemirror_nodes.js";
import {getProsemirrorNodeArbitrary} from "~/shared/prosemirror/test_helpers/get_prosemirror_node_arbitrary.js";

import.meta.jest.setTimeout(30 * 1000);
fc.configureGlobal({interruptAfterTimeLimit: 20 * 1000});

const DocumentContentArbitrary = getProsemirrorNodeArbitrary(
    DocumentWithoutTitleContentProsemirrorSchema.topNodeType,
    new Set(Object.values(DocumentWithoutTitleContentProsemirrorSchema.marks)),
);

test("can apply diffed steps to produce new node from old node", () => {
    fc.assert(
        fc.property(
            fc.tuple(DocumentContentArbitrary, DocumentContentArbitrary),
            ([oldDoc, newDoc]) => {
                const steps = diffProsemirrorNodes(oldDoc, newDoc);

                const doc = steps.reduce((doc, step, index) => {
                    const stepResult = step.apply(doc);

                    if (!stepResult.doc) {
                        throw new InternalError(
                            `Step failed: ${stepResult.failed!}\n\nStep index: ${index}\nStart doc: ${doc.toString()}`,
                        );
                    }

                    return stepResult.doc;
                }, oldDoc);

                expect(doc.toJSON()).toEqual(newDoc.toJSON());
            },
        ),
        {
            // Run until we reach our 10s timeout.
            numRuns: Infinity,
        },
    );
});
