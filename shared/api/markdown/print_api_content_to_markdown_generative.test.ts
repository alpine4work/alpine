import fc from "fast-check";
import {normalizeApiContent} from "~/shared/api/markdown/normalize_api_content.js";
import {parseApiContentFromMarkdown} from "~/shared/api/markdown/parse_api_content_from_markdown.js";
import {printApiContentToMarkdown} from "~/shared/api/markdown/print_api_content_to_markdown.js";
import {ApiContentArbitrary} from "~/shared/api/markdown/test_helpers/api_content_arbitraries.js";
import {generateId} from "~/shared/id/id.js";
import {SpaceId} from "~/shared/id/types/id_types.js";

import.meta.jest.setTimeout(30 * 1000);
fc.configureGlobal({interruptAfterTimeLimit: 20 * 1000});

const spaceId = generateId<SpaceId>();

test("can parse exact same content that was printed", () => {
    fc.assert(
        fc.property(ApiContentArbitrary, content => {
            const markdown = printApiContentToMarkdown(content, {spaceId});

            expect(parseApiContentFromMarkdown(markdown, {spaceId})).toEqual(
                normalizeApiContent(content),
            );
        }),
        {
            // Run until we reach our 10s timeout.
            numRuns: Infinity,
        },
    );
});
