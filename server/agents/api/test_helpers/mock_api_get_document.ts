import {ApiClientMock} from "~/server/agents/api/test_helpers/api_client_mock.js";
import {addKeysToApiContentForTest} from "~/shared/api/content/test_helpers/add_keys_to_api_content_for_test.js";
import {parseApiContentResponseFromMarkdownForTest} from "~/shared/api/content/test_helpers/parse_api_content_response_from_markdown_for_test.js";
import {ApiContentResponseWithOptionalKeys} from "~/shared/api/specification/types/api_content_response_with_optional_keys.open_source.js";
import {AccountId, DocumentId, SpaceId} from "~/shared/id/types/id_types.open_source.js";

export function mockApiGetDocument(
    api: ApiClientMock,
    {
        spaceId,
        documentId,
        title = "Test Document",
        content = "",
        version = 0,
    }: {
        spaceId: SpaceId;
        documentId: DocumentId;
        title?: string;
        content?: string | ApiContentResponseWithOptionalKeys;
        creatorId?: AccountId;
        version?: number;
    },
) {
    api.mockGet("/documents/{id}", {
        params: {path: {id: documentId}},
        data: {
            spaceId,
            document: {
                id: documentId,
                version,
                title,
                content:
                    typeof content === "string"
                        ? parseApiContentResponseFromMarkdownForTest(content)
                        : addKeysToApiContentForTest(content),
            },
        },
    });
}
