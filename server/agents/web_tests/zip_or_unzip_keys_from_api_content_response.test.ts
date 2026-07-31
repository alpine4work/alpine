import {parseApiContentFromAgentWebMarkdown} from "~/server/agents/web/parse_api_content_from_agent_web_markdown.js";
import {printApiContentToAgentWebMarkdown} from "~/server/agents/web/print_api_content_to_agent_web_markdown.js";
import {createAgentWebSessionStorageForTest} from "~/server/agents/web/test_helpers/create_agent_web_session_storage_for_test.js";
import {apiContentArbitrarySpaceId} from "~/shared/api/content/test_helpers/api_content_arbitrary.js";
import {
    unzipKeysFromApiContentResponse,
    zipKeysIntoApiContentResponse,
} from "~/shared/api/content/zip_or_unzip_keys_from_api_content_response.js";
import {ApiContentKey} from "~/shared/api/specification/types/api_content_key.js";
import {ApiContentResponse} from "~/shared/api/specification/types/api_specification_convenience_types.js";
import {CommitBlocker} from "~/shared/helpers/types/commit_blocker.js";
import {generateId} from "~/shared/id/id.js";
import {DocumentId} from "~/shared/id/types/id_types.js";

const storage = createAgentWebSessionStorageForTest(apiContentArbitrarySpaceId);

const testCases: Array<{
    only?: CommitBlocker;
    name: string;
    content: ApiContentResponse;
}> = [
    {
        name: "table, paragraph, heading",
        content: {
            elements: [
                {
                    type: "Table",
                    width: 1,
                    hasHeaderRow: true,
                    columns: [{width: 1}, {width: 1}],
                    rows: [
                        {
                            cells: [
                                {
                                    elements: [
                                        {
                                            type: "Paragraph",
                                            key: "ULsSvc9F" as ApiContentKey,
                                            elements: [],
                                        },
                                    ],
                                },
                                {
                                    elements: [
                                        {
                                            type: "Paragraph",
                                            key: "Z60eigmL" as ApiContentKey,
                                            elements: [],
                                        },
                                    ],
                                },
                            ],
                        },
                    ],
                },
                {type: "Paragraph", key: "ULsSvc9F" as ApiContentKey, elements: []},
                {type: "Heading", key: "ULsSvc9F" as ApiContentKey, level: 3, elements: []},
            ],
        },
    },
    {
        name: "table with two empty paragraphs",
        content: {
            elements: [
                {
                    type: "Table",
                    width: 1,
                    columns: [{width: 1}, {width: 1}],
                    rows: [
                        {
                            cells: [
                                {
                                    elements: [
                                        {
                                            type: "Paragraph",
                                            key: "hrhY5UBe" as ApiContentKey,
                                            elements: [],
                                        },
                                    ],
                                },
                                {
                                    elements: [
                                        {
                                            type: "Paragraph",
                                            key: "_iQO886F" as ApiContentKey,
                                            elements: [],
                                        },
                                    ],
                                },
                            ],
                        },
                    ],
                },
            ],
        },
    },
];

for (const testCase of testCases) {
    const test = testCase.only ? globalThis.test.only : globalThis.test;
    const expectedContent = testCase.content;

    test(`${testCase.name}`, async () => {
        await storage.deleteAll();

        const documentId = generateId<DocumentId>();

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
    });
}
