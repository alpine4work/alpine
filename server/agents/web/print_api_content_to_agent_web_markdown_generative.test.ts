import fc from "fast-check";
import {normalizeApiContentForAgentWebMarkdown} from "~/server/agents/web/normalize_api_content_for_agent_web_markdown.open_source.js";
import {parseApiContentFromAgentWebMarkdown} from "~/server/agents/web/parse_api_content_from_agent_web_markdown.open_source.js";
import {printApiContentToAgentWebMarkdown} from "~/server/agents/web/print_api_content_to_agent_web_markdown.open_source.js";
import {createAgentWebSessionStorageForTest} from "~/server/agents/web/test_helpers/create_agent_web_session_storage_for_test.js";
import {
    ApiContentArbitrary,
    apiContentArbitrarySpaceId,
} from "~/shared/api/content/test_helpers/api_content_arbitrary.js";
import {generateId} from "~/shared/id/id.open_source.js";
import {DocumentId} from "~/shared/id/types/id_types.open_source.js";

import.meta.jest.setTimeout(30 * 1000);
fc.configureGlobal({interruptAfterTimeLimit: 20 * 1000});

const storage = createAgentWebSessionStorageForTest(apiContentArbitrarySpaceId);

test("can parse exact same content that was printed", async () => {
    await fc.assert(
        fc.asyncProperty(ApiContentArbitrary, async content => {
            await storage.deleteAll();

            const documentId = generateId<DocumentId>();

            const normalizedContent = normalizeApiContentForAgentWebMarkdown(content);

            const markdown = await printApiContentToAgentWebMarkdown(storage, normalizedContent, {
                documentId,
            });

            expect(
                // We expect `parseApiContentFromAgentWebMarkdown()` to produce normalized content
                // so we don't call `normalizeApiContent()` here.
                await parseApiContentFromAgentWebMarkdown(storage, markdown, {
                    documentId,
                }),
            ).toEqual(normalizedContent);
        }),
        {
            // Run until we reach our 10s timeout.
            numRuns: Infinity,
        },
    );
});
