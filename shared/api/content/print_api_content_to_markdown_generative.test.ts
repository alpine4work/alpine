import fc from "fast-check";
import {normalizeApiContent} from "~/shared/api/content/normalize_api_content.js";
import {parseApiContentFromMarkdown} from "~/shared/api/content/parse_api_content_from_markdown.js";
import {printApiContentToMarkdown} from "~/shared/api/content/print_api_content_to_markdown.js";
import {ApiContentArbitrary} from "~/shared/api/content/test_helpers/api_content_arbitrary.js";

import.meta.jest.setTimeout(30 * 1000);
fc.configureGlobal({interruptAfterTimeLimit: 20 * 1000});

test("can parse exact same content that was printed", () => {
    fc.assert(
        fc.property(ApiContentArbitrary, content => {
            const markdown = printApiContentToMarkdown(content);

            expect(
                // The parser is expected to return content in normalized form. Do not wrap
                // `parseApiContentFromMarkdown()` in a call to `normalizeApiContent()`!
                parseApiContentFromMarkdown(markdown),
            ).toEqual(normalizeApiContent(content));
        }),
        {
            // Run until we reach our 10s timeout.
            numRuns: Infinity,
        },
    );
});
