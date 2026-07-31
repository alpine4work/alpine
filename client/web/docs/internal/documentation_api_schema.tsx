/* eslint-disable react-refresh/only-export-components -- co-located component factories bind API models for markdown generation. */
import {useDocumentationApiModel} from "~/client/web/docs/internal/documentation_api_context.js";
import {DocumentationApiDocBlock} from "~/client/web/docs/internal/documentation_api_doc_block.js";
import {documentationComponent} from "~/client/web/docs/internal/markdown/documentation_component.js";
import {renderDocumentationApiSchemaNodeToMarkdown} from "~/client/web/docs/render_api_documentation_to_markdown.js";
import {
    DocumentationApiModel,
    DocumentationApiSchemaNode,
} from "~/shared/docs/documentation_api_model.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";

/**
 * Renders a schema's field table inline in an API page:
 * `<Schema name="Content" />` for a named schema, `<Schema webhookPayload />` for
 * the bot webhook payload, or `<Schema errorEnvelope />` for the shared error
 * response. The last two have no name of their own. Named `$ref`s inside link to
 * their own pages.
 */
export const DocumentationApiSchema = createDocumentationApiSchemaComponent(null);

export function createDocumentationApiSchemaComponent(model: DocumentationApiModel | null) {
    return documentationComponent({
        react: function DocumentationApiSchemaView({
            name,
            webhookPayload = false,
            errorEnvelope = false,
        }: {
            name?: string;
            webhookPayload?: boolean;
            errorEnvelope?: boolean;
        }) {
            const contextModel = useDocumentationApiModel();
            const node = getDocumentationApiSchemaNode({
                model: contextModel,
                name,
                webhookPayload,
                errorEnvelope,
            });
            return <DocumentationApiDocBlock node={node} />;
        },
        markdown: props => {
            const markdownModel = assertExists(model, "Expected documentation API model");
            const node = getDocumentationApiSchemaNode({
                model: markdownModel,
                name: typeof props.name === "string" ? props.name : undefined,
                webhookPayload: props.webhookPayload === true,
                errorEnvelope: props.errorEnvelope === true,
            });
            return `${renderDocumentationApiSchemaNodeToMarkdown(markdownModel, node).trimEnd()}\n\n`;
        },
    });
}

function getDocumentationApiSchemaNode({
    model,
    name,
    webhookPayload,
    errorEnvelope,
}: {
    model: DocumentationApiModel;
    name?: string;
    webhookPayload: boolean;
    errorEnvelope: boolean;
}): DocumentationApiSchemaNode | null {
    return errorEnvelope
        ? model.errorSchema
        : webhookPayload
          ? model.webhookPayloadSchema
          : name !== undefined
            ? {$ref: `#/components/schemas/${name}`}
            : null;
}
