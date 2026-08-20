import {parseApiContentFromMarkdown} from "~/shared/api/content/parse_api_content_from_markdown.open_source.js";
import {addKeysToApiContentForTest} from "~/shared/api/content/test_helpers/add_keys_to_api_content_for_test.js";
import {assertApiContentIsResponseForTest} from "~/shared/api/content/test_helpers/assert_api_content_is_response_for_test.js";
import {ApiContent} from "~/shared/api/specification/types/api_specification_convenience_types.open_source.js";
import {assert} from "~/shared/helpers/control/assert.open_source.js";

/**
 * Parses a string as `ApiContent` for tests. Use this to mock API responses. This
 * function is designed to be simple and easy to use. It doesn't support parsing
 * Markdown with response properties. Like `Mention`s or `File`s.
 */
export function parseApiContentResponseFromMarkdownForTest(string: string): ApiContent {
    assert(process.env.NODE_ENV === "test");

    const contentWithoutResponse = parseApiContentFromMarkdown(string);
    const content = assertApiContentIsResponseForTest(contentWithoutResponse);
    return addKeysToApiContentForTest(content);
}
