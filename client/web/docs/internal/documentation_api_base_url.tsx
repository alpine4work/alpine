/* eslint-disable react-refresh/only-export-components -- co-located component factories bind API models for markdown generation. */
import {DocumentationApiModel} from "~/client/web/docs/documentation_api_model.js";
import {useDocumentationApiModel} from "~/client/web/docs/internal/documentation_api_context.js";
import {
    DocumentationCodeBlock,
    toDocumentationMarkdownCodeBlock,
} from "~/client/web/docs/internal/documentation_code_block.js";
import {documentationComponent} from "~/client/web/docs/internal/markdown/documentation_component.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";

/**
 * A code block showing the API's base URL, read from the OpenAPI spec's server so
 * it never drifts from the reference. Used on the Introduction page.
 */
export const DocumentationApiBaseUrl = createDocumentationApiBaseUrlComponent(null);

export function createDocumentationApiBaseUrlComponent(model: DocumentationApiModel | null) {
    return documentationComponent({
        react: function DocumentationApiBaseUrlView() {
            const contextModel = useDocumentationApiModel();
            return <DocumentationCodeBlock code={contextModel.serverUrl} label="base url" />;
        },
        markdown: () =>
            toDocumentationMarkdownCodeBlock(
                assertExists(model, "Expected documentation API model").serverUrl,
            ),
    });
}
