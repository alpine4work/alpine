import fc from "fast-check";
import {parseApiContentFromAgentWebMarkdown} from "~/server/agents/web/parse_api_content_from_agent_web_markdown.open_source.js";
import {printApiContentToAgentWebMarkdown} from "~/server/agents/web/print_api_content_to_agent_web_markdown.open_source.js";
import {createAgentWebSessionStorageForTest} from "~/server/agents/web/test_helpers/create_agent_web_session_storage_for_test.js";
import {intoApiContent} from "~/shared/api/content/closed_source/into_api_content.js";
import {addKeysToApiContentForTest} from "~/shared/api/content/test_helpers/add_keys_to_api_content_for_test.js";
import {apiContentArbitrarySpaceId} from "~/shared/api/content/test_helpers/api_content_arbitrary.js";
import {visitAndProduceApiContent} from "~/shared/api/content/visit_and_produce_api_content.open_source.js";
import {
    unzipKeysFromApiContentResponse,
    zipKeysIntoApiContentResponse,
} from "~/shared/api/content/zip_or_unzip_keys_from_api_content_response.open_source.js";
import {ApiContent} from "~/shared/api/specification/types/api_specification_convenience_types.open_source.js";
import {DocumentWithoutTitleContentProsemirrorSchema} from "~/shared/documents/document_content_schema.js";
import {generateId} from "~/shared/id/id.open_source.js";
import {DocumentId} from "~/shared/id/types/id_types.open_source.js";
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
                    getAccountIfExists: () => undefined,
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

            const normalizeFileGalleryRowWidths = (content: ApiContent): ApiContent => {
                return visitAndProduceApiContent(content, {
                    visitBlockElement: element => {
                        if (element.type !== "FileGallery") return;

                        for (const row of element.rows) {
                            for (let index = 0; index < row.items.length; index++) {
                                const item = row.items[index]!;
                                // We don't want to delete `width` since we want conform to the response type. So
                                // instead set `width` to a dummy value where all widths are shared evenly across
                                // the row.
                                //
                                // We have the same logic in `parseApiContentBlockElementsFromMarkdown()`.
                                item.width =
                                    index !== row.items.length - 1
                                        ? Math.round((1 / row.items.length) * 100) / 100
                                        : (100 -
                                              (row.items.length - 1) *
                                                  Math.round((1 / row.items.length) * 100)) /
                                          100;
                            }
                        }
                    },
                });
            };

            // Do not normalize! We should produce the same output after zipping/unzipping
            // whether or not the content is normalized.
            //
            // With the exception of `FileGallery` rows which have their widths normalized.
            // Because file gallery row width doesn't survive printing/parsing to/from
            // markdown.
            expect(normalizeFileGalleryRowWidths(actualContent)).toEqual(
                normalizeFileGalleryRowWidths(expectedContent),
            );
        }),
        {
            // Run until we reach our 10s timeout.
            numRuns: Infinity,
        },
    );
});
