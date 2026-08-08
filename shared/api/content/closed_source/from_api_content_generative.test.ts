import fc from "fast-check";
import {fromApiContent} from "~/shared/api/content/closed_source/from_api_content.js";
import {intoApiContent} from "~/shared/api/content/closed_source/into_api_content.js";
import {normalizeApiContent} from "~/shared/api/content/normalize_api_content.open_source.js";
import {ApiContentArbitrary} from "~/shared/api/content/test_helpers/api_content_arbitrary.js";
import {DocumentWithoutTitleContentProsemirrorSchema} from "~/shared/documents/document_content_schema.js";

import.meta.jest.setTimeout(30 * 1000);
fc.configureGlobal({interruptAfterTimeLimit: 20 * 1000});

test("can convert ProseMirror content to API content and back", () => {
    fc.assert(
        fc.property(ApiContentArbitrary, expectedApiContent => {
            const content = fromApiContent(
                DocumentWithoutTitleContentProsemirrorSchema,
                // IMPORTANT: Don't normalize before passing into `fromApiContent()`!
                // `fromApiContent()` should work with arbitrary content. `fromApiContent()` should
                // smartly treat content not in normalized form as if it were in normalized form.
                expectedApiContent,
            );

            // Make sure the ProseMirror content is well formed.
            content.check();

            const actualApiContent = intoApiContent(content, {
                getAccountIfExists: () => undefined,
                getSearchEntityMentionTitleIfExists: () => undefined,
                getSearchTaskEntityDisplayStatusIfExists: () => undefined,
                getFileIfExists: () => undefined,
            });

            expect(normalizeApiContent(actualApiContent)).toEqual(
                normalizeApiContent(expectedApiContent),
            );
        }),
        {
            // Run until we reach our 10s timeout.
            numRuns: Infinity,
        },
    );
});
