import fc from "fast-check";
import {addKeysToApiContent} from "~/shared/api/content/add_keys_to_api_content.js";
import {ApiContentKeyEncoder} from "~/shared/api/content/api_content_key_encoder.js";
import {intoApiContent} from "~/shared/api/content/into_api_content.js";
import {DocumentWithoutTitleContentProsemirrorSchema} from "~/shared/documents/document_content_schema.js";
import {getProsemirrorNodeArbitrary} from "~/shared/prosemirror/test_helpers/get_prosemirror_node_arbitrary.js";

import.meta.jest.setTimeout(30 * 1000);
fc.configureGlobal({interruptAfterTimeLimit: 20 * 1000});

const DocumentContentArbitrary = getProsemirrorNodeArbitrary(
    DocumentWithoutTitleContentProsemirrorSchema.topNodeType,
    new Set(Object.values(DocumentWithoutTitleContentProsemirrorSchema.marks)),
);

test("can add keys to API content", () => {
    fc.assert(
        fc.property(DocumentContentArbitrary, content => {
            const encoder = new ApiContentKeyEncoder({
                entityId: "Test",
                version: 0,
            });

            const contentWithoutKeys = intoApiContent(content, {
                getAccountMentionTitleIfExists: () => undefined,
                getSearchEntityMentionTitleIfExists: () => undefined,
                getSearchTaskEntityDisplayStatusIfExists: () => undefined,
                getFileIfExists: () => undefined,
            });

            const expectedContent = intoApiContent(content, {
                encoder,
                getAccountMentionTitleIfExists: () => undefined,
                getSearchEntityMentionTitleIfExists: () => undefined,
                getSearchTaskEntityDisplayStatusIfExists: () => undefined,
                getFileIfExists: () => undefined,
            });

            const actualContent = addKeysToApiContent(encoder, contentWithoutKeys);

            expect(actualContent).toEqual(expectedContent);
        }),
        {
            // Run until we reach our 10s timeout.
            numRuns: Infinity,
        },
    );
});
