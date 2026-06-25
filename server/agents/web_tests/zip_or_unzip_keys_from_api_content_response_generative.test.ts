import fc from "fast-check";
import {parseApiContentFromAgentWebMarkdown} from "~/server/agents/web/parse_api_content_from_agent_web_markdown.js";
import {printApiContentToAgentWebMarkdown} from "~/server/agents/web/print_api_content_to_agent_web_markdown.js";
import {createAgentWebSessionStorageForTest} from "~/server/agents/web/test_helpers/create_agent_web_session_storage_for_test.js";
import {intoApiContent} from "~/shared/api/content/closed_source/into_api_content.js";
import {apiContentArbitrarySpaceId} from "~/shared/api/content/test_helpers/api_content_arbitrary.js";
import {addKeysToApiContentForTest} from "~/shared/api/content/test_helpers/add_keys_to_api_content_for_test.js";
import {
    unzipKeysFromApiContentResponse,
    zipKeysIntoApiContentResponse,
} from "~/shared/api/content/zip_or_unzip_keys_from_api_content_response.js";
import {DocumentWithoutTitleContentProsemirrorSchema} from "~/shared/documents/document_content_schema.js";
import {generateId} from "~/shared/id/id.js";
import {DocumentId} from "~/shared/id/types/id_types.js";
import {getProsemirrorNodeArbitrary} from "~/shared/prosemirror/test_helpers/get_prosemirror_node_arbitrary.js";

import.meta.jest.setTimeout(20 * 1000);
fc.configureGlobal({interruptAfterTimeLimit: 10 * 1000});

const storage = createAgentWebSessionStorageForTest(apiContentArbitrarySpaceId);

const DocumentContentArbitrary = getProsemirrorNodeArbitrary(
    DocumentWithoutTitleContentProsemirrorSchema.topNodeType,
    new Set(Object.values(DocumentWithoutTitleContentProsemirrorSchema.marks)),
);

test("can zip/unzip keys from parsed/printed API content", async () => {
    await fc.assert(
        fc.asyncProperty(DocumentContentArbitrary, async expectedInternalContent => {
            await storage.deleteAll();

            const documentId = generateId<DocumentId>();

            const expectedContent = addKeysToApiContentForTest(
                intoApiContent(expectedInternalContent, {
                    getAccountMentionTitleIfExists: () => undefined,
                    getSearchEntityMentionTitleIfExists: () => undefined,
                    getSearchTaskEntityDisplayStatusIfExists: () => undefined,
                    getFileIfExists: () => undefined,
                }),
            );

            const {content: expectedContentWithoutKeys, keys} =
                unzipKeysFromApiContentResponse(expectedContent);

            const expectedMarkdown = await printApiContentToAgentWebMarkdown(
                storage,
                expectedContentWithoutKeys,
                {documentId},
            );

            const actualContentWithoutKeys = await parseApiContentFromAgentWebMarkdown(
                storage,
                expectedMarkdown,
                {documentId},
            );

            const actualContent = zipKeysIntoApiContentResponse({
                content: actualContentWithoutKeys,
                keys,
            });

            expect(actualContent).toEqual(expectedContent);
        }),
        {
            // Run until we reach our 10s timeout.
            numRuns: Infinity,
        },
    );
});
