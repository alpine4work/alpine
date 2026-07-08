import {parseApiContentFromMarkdown} from "~/shared/api/content/parse_api_content_from_markdown.js";
import {addKeysToApiContentForTest} from "~/shared/api/content/test_helpers/add_keys_to_api_content_for_test.js";
import {assertApiContentIsResponseForTest} from "~/shared/api/content/test_helpers/assert_api_content_as_response_for_test.js";
import {ApiContentResponse} from "~/shared/api/specification/types/api_specification_convenience_types.js";
import {assert} from "~/shared/helpers/control/assert.js";

/**
 * Parses a string as `ApiContentResponse` for tests. Use this to mock API
 * responses. This function is designed to be simple and easy to use. It doesn't
 * support parsing Markdown with response properties. Like `Mention`s or `File`s.
 */
export function parseApiContentResponseFromMarkdownForTest(string: string): ApiContentResponse {
    assert(process.env.NODE_ENV === "test");

    const contentWithoutResponse = parseApiContentFromMarkdown(string);
    const content = assertApiContentIsResponseForTest(contentWithoutResponse);
    return addKeysToApiContentForTest(content);
}
