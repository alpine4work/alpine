import fc from "fast-check";
import {parseApiContentFromAgentWebMarkdown} from "~/server/agents/web/parse_api_content_from_agent_web_markdown.js";
import {printApiContentToAgentWebMarkdown} from "~/server/agents/web/print_api_content_to_agent_web_markdown.js";
import {createAgentWebSessionStorageForTest} from "~/server/agents/web/test_helpers/create_agent_web_session_storage_for_test.js";
import {normalizeApiContentResponse} from "~/shared/api/markdown/normalize_api_content.js";
import {
    ApiContentResponseArbitrary,
    apiContentArbitrarySpaceId,
} from "~/shared/api/markdown/test_helpers/api_content_arbitrary.js";
import {generateId} from "~/shared/id/id.js";
import {DocumentId} from "~/shared/id/types/id_types.js";

const storage = createAgentWebSessionStorageForTest(apiContentArbitrarySpaceId);

test("can parse exact same content that was printed", async () => {
    await fc.assert(
        fc.asyncProperty(ApiContentResponseArbitrary, async content => {
            const documentId = generateId<DocumentId>();

            const markdown = await printApiContentToAgentWebMarkdown(storage, content, {
                documentId,
            });

            expect(
                // Unlike `parseApiContentFromMarkdown()`, we don't expect
                // `parseApiContentFromAgentWebMarkdown()` to return normalized content.
                normalizeApiContentResponse(
                    await parseApiContentFromAgentWebMarkdown(storage, markdown, {
                        documentId,
                    }),
                ),
            ).toEqual(normalizeApiContentResponse(content));
        }),
        {
            // Run until we reach our 10s timeout.
            numRuns: Infinity,
        },
    );
});
